import { NextResponse } from "next/server";

import { recordAudit } from "@/lib/audit";
import { COLLECTION_KIND, type KnowledgeSourceRef, SOURCES_SENTINEL } from "@/lib/clinical-library";
import { describePatientCase, loadPatientCase } from "@/lib/patient-case";
import { buildPracticeScopeContext, normalizeScope } from "@/lib/practice-scope-context";
import { alertAfterLibraryMessage, getAudioAllowance } from "@/lib/usage";
import { type ChatAttachment, type ChatMessage, getChatProvider } from "@flyee/ai";
import { createClient } from "@flyee/auth/server";
import { createServiceClient } from "@flyee/auth/service";
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

/** How many earlier user turns may be folded into the retrieval query. */
const QUERY_CONTEXT_TURNS = 2;

/**
 * The text the library is actually searched with.
 *
 * Retrieval used to embed the raw last message, which is fine for an opening
 * question and useless for the way a study chat really goes: "e as
 * contraindicações?", "e na gestante?" carry no topic at all, so they embedded
 * to nothing in particular and the answer quietly lost its citations exactly
 * where the professional was going deeper. Folding in the previous user turns
 * restores the subject without a second model call.
 *
 * Long messages are left alone — they already carry their own context, and
 * padding them would dilute the vector instead of sharpening it.
 */
function buildRetrievalQuery(message: string, history: { role: string; content: string }[]): string {
  const current = message.trim();
  if (current.length > 160) return current;
  const earlier = history
    .filter((entry) => entry.role === "user")
    .slice(-(QUERY_CONTEXT_TURNS + 1), -1)
    .map((entry) => entry.content.trim())
    .filter(Boolean);
  return earlier.length > 0 ? `${earlier.join("\n")}\n${current}` : current;
}

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
    // Naming the cause matters here for the same reason it does on the
    // recorder: a failed card and an expired quota are resolved by different
    // actions, and only one of them is a purchase (migration 0054).
    const blockedCode = entitlements?.suspended
      ? "suspended"
      : entitlements?.status === "past_due"
        ? "past_due_blocked"
        : "no_subscription";
    return NextResponse.json(
      {
        error: entitlements?.suspended ? "Subscription suspended — contact support." : "No active subscription.",
        code: blockedCode,
      },
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
  let meteredQuota = false;
  if (quotaKey) {
    const { data: allowance, error: allowanceError } = await supabase.rpc("org_message_allowance", {
      target_org: body.orgId,
      target_assistant: body.assistantSlug,
    });
    if (allowanceError) return NextResponse.json({ error: allowanceError.message }, { status: 403 });
    messageAllowance = allowance ?? null;
    // Unlimited plans still stream; they simply have nothing to meter.
    meteredQuota = messageAllowance?.unlimited === false;
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

  // What this professional actually treats with. The same declaration that
  // bounds the therapeutic plan (plan/route.ts) becomes CONTEXT here — the
  // study assistant answered every professional identically, so an
  // auriculotherapist asking for "points for insomnia" got systemic points
  // with nothing acknowledging her practice. Best-effort: a failed read simply
  // injects nothing, which is the same as declaring no scope.
  const { data: profile } = await supabase
    .from("profiles")
    .select("practice_modalities")
    .eq("id", user.id)
    .maybeSingle();
  const practiceScopeContext = buildPracticeScopeContext(profile?.practice_modalities as string[] | null);

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

  // The quota alert is deferred with the meter itself: warning "you have used
  // 19 of 20" for a message the provider never answered would be the same lie
  // the old counter told. Both happen below, once there is an answer.

  // Newest window, oldest-first for the model. Ascending+limit would return the
  // FIRST messages of a long conversation and drop the one just sent.
  const { data: newestFirst } = await supabase
    .from("messages")
    .select("role, content, attachments")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(HISTORY_LIMIT);
  const history = (newestFirst ?? []).slice().reverse();

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

  const chatMessages: ChatMessage[] = history.map((message, index) => ({
    role: message.role as "user" | "assistant",
    content: message.content,
    attachments: index === history.length - 1 ? downloaded : undefined,
  }));

  // Ground the assistant in its configured knowledge collections (RAG).
  // Order: base instructions → who this professional is → the patient's case
  // (when reviewing one) → retrieved library excerpts.
  //
  // The scope block sits right after the base because it is a STABLE quality
  // of the practitioner (it belongs with the instructions), while the case and
  // the excerpts are this round's variable material. It never goes after
  // buildKnowledgeContext, which closes the prompt with the numbered [n]
  // passages the answer must cite.
  let systemPrompt: string = assistant.system_prompt + practiceScopeContext + caseContext;
  let sources: KnowledgeSourceRef[] = [];
  let retrievalFailed = false;
  const knowledgeConfig = (assistant.config as { knowledge?: AssistantKnowledgeConfig } | null)?.knowledge;
  if (knowledgeConfig?.collections?.length && body.message.trim() && isEmbeddingConfigured()) {
    try {
      const collectionIds = await resolveCollectionIds(supabase, knowledgeConfig.collections);
      const results = await searchKnowledge(supabase, buildRetrievalQuery(body.message, history), {
        collectionIds,
        matchCount: knowledgeConfig.matchCount,
        maxTrust: knowledgeConfig.maxTrust,
        // Ties break toward what she practises. Nothing is excluded — a
        // document from another modality still ranks on its own merit, and an
        // untagged one is never demoted (migration 0079).
        modalities: normalizeScope(profile?.practice_modalities as string[] | null),
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
    } catch (error) {
      // Retrieval must never take the chat down — but an answer given WITHOUT
      // the library must not look like one given WITH it. The client is told,
      // and the failure is logged instead of vanishing into an empty catch.
      console.error("[ai/chat] knowledge retrieval failed", error);
      retrievalFailed = true;
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
          controller.enqueue(
            encoder.encode(`${SOURCES_SENTINEL}${JSON.stringify({ sources, retrievalFailed })}${SOURCES_SENTINEL}`),
          );
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

          // The message is METERED here and only here: after the provider
          // produced text. A failed generation costs nothing, and the ledger
          // (migration 0063) survives deleting the conversation, so the quota
          // can no longer be reset by clearing chats. Service role because the
          // meter must not be writable by the browser it meters.
          if (meteredQuota) {
            try {
              const service = createServiceClient();
              await service.rpc("record_library_usage", {
                target_org: body.orgId,
                target_assistant: body.assistantSlug,
                target_conversation: conversationId,
                target_user: user.id,
              });
              // 80/95/100% bell alert, now counting a message that was really
              // answered (PRD §5.8 pattern shared with audio minutes).
              await alertAfterLibraryMessage(body.orgId, {
                used: (messageAllowance?.used ?? 0) + 1,
                limit: messageAllowance?.limit ?? 0,
                windowStart: messageAllowance?.window_start as string,
              });
            } catch (error) {
              // The answer was already delivered; metering is not worth failing
              // the response over, but it must not vanish silently either.
              console.error("[ai/chat] library usage metering failed", error);
            }
          }
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
