import { NextResponse } from "next/server";

import { recordAudit } from "@/lib/audit";
import { COLLECTION_KIND, type KnowledgeSourceRef, SOURCES_SENTINEL } from "@/lib/clinical-library";
import { describePatientCase, loadPatientCase } from "@/lib/patient-case";
import { alertAfterLibraryMessage, getAudioAllowance } from "@/lib/usage";
import { type ChatAttachment, type ChatMessage, getChatProvider } from "@flyee/ai";
import { createClient } from "@flyee/auth/server";
import {
  type AssistantKnowledgeConfig,
  buildKnowledgeContext,
  isEmbeddingConfigured,
  resolveCollectionIds,
  searchKnowledge,
} from "@flyee/knowledge";

type AttachmentRef = { kind: "image" | "audio"; path: string; mime: string };

type ChatRequest = {
  orgId: string;
  assistantSlug: string;
  conversationId?: string;
  message: string;
  attachments?: AttachmentRef[];
  /** When true, the retrieved knowledge sources open the stream as a sentinel-framed JSON prelude. */
  includeSources?: boolean;
  /**
   * Case review: ground the chat in ONE patient's record. Honored only when
   * CREATING a conversation — on an existing one the stored patient_id is the
   * authority, so a client cannot swap the patient mid-conversation.
   */
  patientId?: string;
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
  // Data-driven monthly quota: the assistant's config names a plans.limits key
  // (e.g. the library assistant → "library_messages"). The SQL RPC is the
  // single source of truth; the UI only displays what it returns.
  const quotaKey = (assistant.config as { quota_limit_key?: string } | null)?.quota_limit_key;
  let messageAllowance: {
    allowed?: boolean;
    unlimited?: boolean;
    used?: number;
    limit?: number;
    window_start?: string;
  } | null = null;
  if (quotaKey) {
    const { data: allowance, error: allowanceError } = await supabase.rpc("org_message_allowance", {
      target_org: body.orgId,
      target_assistant: body.assistantSlug,
    });
    if (allowanceError) return NextResponse.json({ error: allowanceError.message }, { status: 403 });
    messageAllowance = allowance ?? null;
    if (allowance && allowance.allowed === false) {
      return NextResponse.json(
        {
          error: "Monthly message limit reached for this plan.",
          code: "quota_exhausted",
          used: allowance.used ?? 0,
          limit: allowance.limit ?? 0,
        },
        { status: 402 },
      );
    }
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

  // Find or create the conversation. On an existing one, its stored
  // patient_id is authoritative (migration 0044) — the request cannot
  // reassign a conversation to another patient.
  let conversationId = body.conversationId ?? null;
  let casePatientId: string | null = null;
  if (conversationId) {
    const { data: conversation } = await supabase
      .from("conversations")
      .select("id, patient_id")
      .eq("id", conversationId)
      .maybeSingle();
    if (!conversation) return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
    casePatientId = (conversation.patient_id as string | null) ?? null;
  } else {
    casePatientId = body.patientId ?? null;
  }

  // Case review gates, enforced in code (never only in the UI):
  // Pro entitlement (reasoning over the record IS the Pro value, same gate as
  // hypotheses) and the patient's ACTIVE ai-processing consent (sending their
  // record to the model is AI processing — recording consent is not enough).
  let caseContext = "";
  if (casePatientId) {
    const audioAllowance = await getAudioAllowance(supabase, body.orgId);
    if (!audioAllowance?.clinicalReasoning) {
      return NextResponse.json(
        { error: "Case review needs the Pro plan or an active Pro trial.", code: "case_review_not_available" },
        { status: 403 },
      );
    }
    const { data: consented } = await supabase.rpc("has_active_consent", {
      target_org: body.orgId,
      target_patient: casePatientId,
      term_slug: "ai-processing",
    });
    if (!consented) {
      return NextResponse.json(
        {
          error: "This patient has no active AI-processing consent.",
          code: "patient_ai_consent_missing",
          patientId: casePatientId,
        },
        { status: 403 },
      );
    }
    const patientCase = await loadPatientCase(supabase, casePatientId);
    if (!patientCase)
      return NextResponse.json({ error: "Patient not found.", code: "patient_not_found" }, { status: 404 });
    caseContext = [
      "\n\n## Dados registrados do paciente (revisão de caso)",
      "Regras obrigatórias para este contexto:",
      "- Os dados abaixo vêm do prontuário registrado pela profissional. Eles NÃO são fontes da biblioteca: nunca os cite como [n].",
      "- Campo ausente = não investigado ou não registrado. NUNCA trate ausência como negação.",
      "- Fundamente afirmações clínicas gerais nos trechos da biblioteca (citando [n]); os dados do paciente são o caso em revisão, não evidência bibliográfica.",
      "- Nunca conclua diagnóstico nem prescreva conduta para este paciente: prepare leituras, perguntas e pontos de atenção para a profissional decidir.",
      "",
      describePatientCase(patientCase),
    ].join("\n");
  }

  if (!conversationId) {
    const { data: conversation, error: conversationError } = await supabase
      .from("conversations")
      .insert({
        org_id: body.orgId,
        assistant_id: assistant.id,
        created_by: user.id,
        title: body.message.slice(0, 80) || "New conversation",
        patient_id: casePatientId,
      })
      .select("id")
      .single();
    if (conversationError) return NextResponse.json({ error: conversationError.message }, { status: 400 });
    conversationId = conversation.id;
  }

  // Every AI use of a patient's record lands in the audit trail.
  if (casePatientId) {
    await recordAudit(supabase, "library.case_review", {
      orgId: body.orgId,
      entityType: "patient",
      entityId: casePatientId,
      metadata: { conversationId },
    });
  }

  await supabase.from("messages").insert({
    conversation_id: conversationId,
    role: "user",
    content: body.message,
    attachments,
  });

  // 80/95/100% bell alert for the monthly quota, counting THIS message
  // (PRD §5.8 pattern shared with audio minutes). Best-effort by design.
  if (messageAllowance?.unlimited === false && messageAllowance.window_start) {
    await alertAfterLibraryMessage(body.orgId, {
      used: (messageAllowance.used ?? 0) + 1,
      limit: messageAllowance.limit ?? 0,
      windowStart: messageAllowance.window_start,
    });
  }

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
  // Order: base instructions → the patient's case (when reviewing one) →
  // retrieved library excerpts.
  let systemPrompt: string = assistant.system_prompt + caseContext;
  let sources: KnowledgeSourceRef[] = [];
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
      // The prompt numbers excerpts [1..n] in this same order — the refs the
      // client renders must line up with the [n] marks in the answer.
      if (body.includeSources && results.length > 0) {
        const { data: collections } = await supabase
          .from("knowledge_collections")
          .select("id, slug")
          .in("id", [...new Set(results.map((result) => result.collection_id))]);
        const slugById = new Map((collections ?? []).map((row) => [row.id as string, row.slug as string]));
        sources = results.map((result, index) => ({
          index: index + 1,
          title: result.title,
          source: result.source,
          kind: COLLECTION_KIND[slugById.get(result.collection_id) ?? ""] ?? "unknown",
          trustLevel: result.trust_level,
          documentId: result.document_id,
        }));
      }
    } catch {
      // Retrieval must never take the chat down — answer without extra context.
    }
  }

  const encoder = new TextEncoder();
  let fullText = "";

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        // Sentinel-framed prelude: the client that asked for sources splits it
        // off before rendering text. Clients that did not ask see plain text.
        if (body.includeSources) {
          controller.enqueue(encoder.encode(`${SOURCES_SENTINEL}${JSON.stringify({ sources })}${SOURCES_SENTINEL}`));
        }
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
            // Citations persist WITH the answer, so reopening the conversation
            // still shows what grounded it.
            ...(sources.length > 0 ? { metadata: { knowledge_sources: sources } } : {}),
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
