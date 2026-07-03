import { NextResponse } from "next/server";

import { type ChatAttachment, type ChatMessage, getChatProvider } from "@gogo/ai";
import { createClient } from "@gogo/auth/server";
import {
  type AssistantKnowledgeConfig,
  buildKnowledgeContext,
  isEmbeddingConfigured,
  resolveCollectionIds,
  searchKnowledge,
} from "@gogo/knowledge";

type AttachmentRef = { kind: "image" | "audio"; path: string; mime: string };

type ChatRequest = {
  orgId: string;
  assistantSlug: string;
  conversationId?: string;
  message: string;
  attachments?: AttachmentRef[];
};

const HISTORY_LIMIT = 30;

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  const body = (await request.json()) as ChatRequest;
  if (!body.message?.trim() && !(body.attachments?.length ?? 0)) {
    return NextResponse.json({ error: "Empty message." }, { status: 400 });
  }

  // Assistant = the instruction set. RLS only exposes active ones.
  const { data: assistant } = await supabase
    .from("assistants")
    .select("*")
    .eq("slug", body.assistantSlug)
    .eq("is_active", true)
    .maybeSingle();
  if (!assistant) return NextResponse.json({ error: "Assistant not found." }, { status: 404 });

  const provider = getChatProvider(assistant.provider);
  const attachments = body.attachments ?? [];
  if (attachments.some((attachment) => attachment.kind === "audio") && !provider.supportsAudio(assistant.model)) {
    return NextResponse.json(
      { error: "This assistant's model does not accept audio. Use a Gemini-backed assistant for audio input." },
      { status: 400 },
    );
  }

  // Subscription gate + credit debit (RLS/RPCs enforce membership).
  const { data: entitlements, error: entitlementsError } = await supabase.rpc("org_entitlements", {
    target_org: body.orgId,
  });
  if (entitlementsError) return NextResponse.json({ error: entitlementsError.message }, { status: 403 });
  if (!entitlements?.active) {
    return NextResponse.json(
      { error: entitlements?.suspended ? "Subscription suspended — contact support." : "No active subscription." },
      { status: 402 },
    );
  }
  if (assistant.credits_per_message > 0) {
    const { error: creditError } = await supabase.rpc("consume_credits", {
      target_org: body.orgId,
      amount: assistant.credits_per_message,
      reason: `AI chat — ${assistant.name}`,
    });
    if (creditError) {
      return NextResponse.json({ error: "Insufficient credits for this assistant." }, { status: 402 });
    }
  }

  // Find or create the conversation.
  let conversationId = body.conversationId ?? null;
  if (!conversationId) {
    const { data: conversation, error: conversationError } = await supabase
      .from("conversations")
      .insert({
        org_id: body.orgId,
        assistant_id: assistant.id,
        created_by: user.id,
        title: body.message.slice(0, 80) || "New conversation",
      })
      .select("id")
      .single();
    if (conversationError) return NextResponse.json({ error: conversationError.message }, { status: 400 });
    conversationId = conversation.id;
  }

  await supabase.from("messages").insert({
    conversation_id: conversationId,
    role: "user",
    content: body.message,
    attachments,
  });

  const { data: history } = await supabase
    .from("messages")
    .select("role, content, attachments")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })
    .limit(HISTORY_LIMIT);

  // Only the newest message carries binary attachments to the model;
  // older ones stay as text (their files remain in storage).
  const downloaded: ChatAttachment[] = [];
  for (const attachment of attachments) {
    const { data: blob } = await supabase.storage.from("ai-attachments").download(attachment.path);
    if (blob) {
      downloaded.push({
        kind: attachment.kind,
        mime: attachment.mime,
        dataBase64: Buffer.from(await blob.arrayBuffer()).toString("base64"),
      });
    }
  }

  const chatMessages: ChatMessage[] = (history ?? []).map((message, index) => ({
    role: message.role as "user" | "assistant",
    content: message.content,
    attachments: index === (history?.length ?? 0) - 1 ? downloaded : undefined,
  }));

  // Ground the assistant in its configured knowledge collections (RAG).
  let systemPrompt: string = assistant.system_prompt;
  const knowledgeConfig = (assistant.config as { knowledge?: AssistantKnowledgeConfig } | null)?.knowledge;
  if (knowledgeConfig?.collections?.length && body.message.trim() && isEmbeddingConfigured()) {
    try {
      const collectionIds = await resolveCollectionIds(supabase, knowledgeConfig.collections);
      const results = await searchKnowledge(supabase, body.message, {
        collectionIds,
        matchCount: knowledgeConfig.matchCount,
        maxTrust: knowledgeConfig.maxTrust,
      });
      systemPrompt += buildKnowledgeContext(results);
    } catch {
      // Retrieval must never take the chat down — answer without extra context.
    }
  }

  const encoder = new TextEncoder();
  let fullText = "";

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const generator = provider.streamChat(
          {
            provider: assistant.provider,
            model: assistant.model,
            systemPrompt,
            temperature: Number(assistant.temperature),
            maxTokens: assistant.max_tokens,
          },
          chatMessages,
        );
        for await (const delta of generator) {
          fullText += delta;
          controller.enqueue(encoder.encode(delta));
        }
        controller.close();
      } catch (error) {
        const message = error instanceof Error ? error.message : "Provider error";
        controller.enqueue(encoder.encode(`\n[error] ${message}`));
        controller.close();
      } finally {
        if (fullText) {
          await supabase.from("messages").insert({
            conversation_id: conversationId,
            role: "assistant",
            content: fullText,
          });
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache",
      "X-Conversation-Id": conversationId ?? "",
    },
  });
}
