"use client";

import MessageBubble, { type ThreadMessage } from "./components/message-bubble";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { KeyboardEvent, useCallback, useEffect, useRef, useState } from "react";

import {
  Alert,
  Autocomplete,
  Box,
  Breadcrumbs,
  Button,
  Card,
  CardContent,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Skeleton,
  TextareaAutosize,
  TextField,
  Typography,
} from "@mui/material";

import EmptyState from "@/components/product/empty-state";
import { useAudioAllowance } from "@/hooks/use-audio-allowance";
import { useCurrentOrg } from "@/hooks/use-current-org";
import NiBinEmpty from "@/icons/nexture/ni-bin-empty";
import NiBook from "@/icons/nexture/ni-book";
import NiPen from "@/icons/nexture/ni-pen";
import NiPlus from "@/icons/nexture/ni-plus";
import NiSendUpRight from "@/icons/nexture/ni-send-up-right";
import { type KnowledgeSourceRef, LIBRARY_ASSISTANT_SLUG, SOURCES_SENTINEL } from "@/lib/clinical-library";
import { listActivePatientOptions, type PatientOption } from "@/lib/patients";
import { ensureProTrial } from "@/lib/pro-trial";
import { trackProductEvent } from "@/lib/product-events";
import { cn } from "@/lib/utils";
import { isSupabaseConfigured } from "@flyee/auth";
import { createClient } from "@flyee/auth/client";
import { remoteEmpty, remoteError, remoteLoading, type RemoteState, remoteSuccess } from "@flyee/clinical";

type ConversationRow = {
  id: string;
  title: string | null;
  updated_at: string;
  patientId: string | null;
  patientName: string | null;
};

type CasePatient = { id: string; fullName: string };

type Allowance = { unlimited: boolean; used?: number; limit?: number };

const STARTER_KEYS = ["library-starter-1", "library-starter-2", "library-starter-3", "library-starter-4"] as const;
const CASE_STARTER_KEYS = ["library-case-starter-1", "library-case-starter-2"] as const;

/**
 * The clinical library chat (PRD §9.9) — the professional's study companion
 * OUTSIDE the consultation. The job here: ask a study question (points,
 * formulas, patterns, protocols) and get an answer grounded in the library,
 * with the sources visible. Success = an answer she can trust and trace, not
 * a generic LLM reply — so every answer lists what grounded it, and the
 * header says plainly that this is study support, never clinical conduct.
 */
export default function Biblioteca() {
  const t = useTranslations("product");
  const format = useFormatter();
  const { orgId } = useCurrentOrg();
  const searchParams = useSearchParams();
  const { allowance: audioAllowance } = useAudioAllowance(orgId);
  // Case review is the Pro value (same entitlement as the hypotheses); the
  // route re-enforces this server-side.
  const canReviewCases = Boolean(audioAllowance?.clinicalReasoning);

  const [conversationsState, setConversationsState] = useState<RemoteState<ConversationRow[], string>>(() =>
    remoteLoading(),
  );
  const [patients, setPatients] = useState<PatientOption[] | null>(null);
  const [casePatient, setCasePatient] = useState<CasePatient | null>(null);
  const [consentMissingId, setConsentMissingId] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; title: string } | null>(null);
  const [deleting, setDeleting] = useState<ConversationRow | null>(null);
  const deepLinkApplied = useRef(false);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [allowance, setAllowance] = useState<Allowance | null>(null);
  const [quotaExhausted, setQuotaExhausted] = useState<{ used: number; limit: number } | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [trialStarted, setTrialStarted] = useState(false);
  const threadEndRef = useRef<HTMLDivElement>(null);

  const loadConversations = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setConversationsState(remoteEmpty());
      return;
    }
    const supabase = createClient();
    const { data, error } = await supabase
      .from("conversations")
      .select("id, title, updated_at, patient_id, patients(full_name), assistants!inner(slug)")
      .eq("assistants.slug", LIBRARY_ASSISTANT_SLUG)
      .order("updated_at", { ascending: false })
      .limit(30);
    if (error) {
      setConversationsState(remoteError(error.message));
      return;
    }
    const rows = (data ?? []).map((row) => ({
      id: row.id as string,
      title: (row.title as string | null) ?? null,
      updated_at: row.updated_at as string,
      patientId: (row.patient_id as string | null) ?? null,
      patientName: ((row.patients as unknown as { full_name?: string } | null)?.full_name as string | null) ?? null,
    }));
    setConversationsState(rows.length === 0 ? remoteEmpty() : remoteSuccess(rows));
  }, []);

  // Patient options exist only for who can review cases (Pro / Pro trial).
  useEffect(() => {
    const load = async () => {
      if (!isSupabaseConfigured || !orgId || !canReviewCases) return;
      const result = await listActivePatientOptions(createClient(), orgId);
      setPatients(result.ok ? result.data : []);
    };
    load();
  }, [orgId, canReviewCases]);

  // Deep link (/biblioteca?paciente=<id>) — applied once, only while nothing
  // else was chosen, so it never steals an ongoing conversation.
  useEffect(() => {
    if (deepLinkApplied.current || !patients) return;
    const requested = searchParams.get("paciente");
    if (!requested) return;
    deepLinkApplied.current = true;
    const match = patients.find((option) => option.id === requested);
    if (match) setCasePatient({ id: match.id, fullName: match.fullName });
  }, [patients, searchParams]);

  const loadAllowance = useCallback(async () => {
    if (!isSupabaseConfigured || !orgId) return;
    const supabase = createClient();
    const { data } = await supabase.rpc("org_message_allowance", {
      target_org: orgId,
      target_assistant: LIBRARY_ASSISTANT_SLUG,
    });
    if (data) setAllowance(data as Allowance);
  }, [orgId]);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    loadAllowance();
  }, [loadAllowance]);

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [messages]);

  const openConversation = useCallback(async (conversation: ConversationRow) => {
    const conversationId = conversation.id;
    setActiveConversationId(conversationId);
    // The stored link is the authority — reopening restores the case chip.
    setCasePatient(
      conversation.patientId ? { id: conversation.patientId, fullName: conversation.patientName ?? "" } : null,
    );
    setConsentMissingId(null);
    setSendError(null);
    setThreadLoading(true);
    setMessages([]);
    const supabase = createClient();
    const { data, error } = await supabase
      .from("messages")
      .select("id, role, content, metadata")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true });
    setThreadLoading(false);
    if (error) {
      setSendError(error.message);
      return;
    }
    setMessages(
      (data ?? []).map((row) => ({
        id: row.id as string,
        role: row.role as "user" | "assistant",
        content: row.content as string,
        sources: (row.metadata as { knowledge_sources?: KnowledgeSourceRef[] } | null)?.knowledge_sources ?? undefined,
      })),
    );
  }, []);

  const renameConversation = useCallback(async () => {
    if (!renaming) return;
    const title = renaming.title.trim();
    if (!title) return;
    await createClient().from("conversations").update({ title }).eq("id", renaming.id);
    setRenaming(null);
    await loadConversations();
  }, [renaming, loadConversations]);

  const removeConversation = useCallback(async () => {
    if (!deleting) return;
    // Messages cascade with the conversation.
    await createClient().from("conversations").delete().eq("id", deleting.id);
    if (activeConversationId === deleting.id) {
      setActiveConversationId(null);
      setMessages([]);
      setCasePatient(null);
    }
    setDeleting(null);
    await loadConversations();
  }, [deleting, activeConversationId, loadConversations]);

  const startNewConversation = useCallback((patient: CasePatient | null = null) => {
    setActiveConversationId(null);
    setMessages([]);
    setSendError(null);
    setConsentMissingId(null);
    setCasePatient(patient);
  }, []);

  const sendMessage = useCallback(
    async (text?: string) => {
      const content = (text ?? input).trim();
      if (!content || sending || !orgId) return;

      setSendError(null);
      setQuotaExhausted(null);
      setInput("");
      setSending(true);

      const assistantMessageId = crypto.randomUUID();
      setMessages((current) => [
        ...current,
        { id: crypto.randomUUID(), role: "user", content },
        { id: assistantMessageId, role: "assistant", content: "" },
      ]);
      const removeAssistantPlaceholder = () =>
        setMessages((current) => current.filter((message) => message.id !== assistantMessageId));

      try {
        const response = await fetch("/api/ai/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            orgId,
            assistantSlug: LIBRARY_ASSISTANT_SLUG,
            conversationId: activeConversationId ?? undefined,
            message: content,
            includeSources: true,
            // Honored only at conversation creation; the stored link rules after.
            patientId: casePatient?.id,
          }),
        });

        if (!response.ok || !response.body) {
          const payload = (await response.json().catch(() => null)) as {
            error?: string;
            code?: string;
            used?: number;
            limit?: number;
            patientId?: string;
          } | null;
          removeAssistantPlaceholder();
          if (payload?.code === "quota_exhausted") {
            // The upgrade signal: how often the free quota is what stops her.
            trackProductEvent("library.quota_hit");
            setQuotaExhausted({ used: payload.used ?? 0, limit: payload.limit ?? 0 });
          } else if (payload?.code === "patient_ai_consent_missing") {
            // Consent is the path, not a dead end: the alert links to granting it.
            setConsentMissingId(payload.patientId ?? casePatient?.id ?? null);
          } else if (payload?.code === "case_review_not_available") {
            setSendError(t("library-case-not-available"));
          } else {
            setSendError(payload?.error ?? t("library-error-generic"));
          }
          return;
        }

        const newConversationId = response.headers.get("X-Conversation-Id");
        const startedNewConversation = Boolean(newConversationId) && !activeConversationId;
        if (newConversationId && !activeConversationId) setActiveConversationId(newConversationId);

        // Does studying between consultations become a habit — and how often
        // does it involve a real patient (the Pro value)?
        trackProductEvent("library.message_sent", { has_patient: casePatient ? "true" : "false" });
        if (startedNewConversation && casePatient) trackProductEvent("case_review.started");

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let inPrelude = true;
        let fullText = "";

        const applyText = (value: string) =>
          setMessages((current) =>
            current.map((message) => (message.id === assistantMessageId ? { ...message, content: value } : message)),
          );
        const applySources = (sources: KnowledgeSourceRef[], retrievalFailed: boolean) =>
          setMessages((current) =>
            current.map((message) =>
              message.id === assistantMessageId ? { ...message, sources, retrievalFailed } : message,
            ),
          );

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          if (inPrelude) {
            if (buffer.startsWith(SOURCES_SENTINEL)) {
              const end = buffer.indexOf(SOURCES_SENTINEL, 1);
              if (end === -1) continue; // prelude still streaming in
              try {
                const parsed = JSON.parse(buffer.slice(1, end)) as {
                  sources?: KnowledgeSourceRef[];
                  retrievalFailed?: boolean;
                };
                if (parsed.sources?.length || parsed.retrievalFailed) {
                  applySources(parsed.sources ?? [], Boolean(parsed.retrievalFailed));
                }
              } catch {
                // A malformed prelude only costs the source list, never the answer.
              }
              buffer = buffer.slice(end + 1);
            }
            inPrelude = false;
          }
          if (buffer) {
            fullText += buffer;
            buffer = "";
            applyText(fullText);
          }
        }

        // The route streams provider failures as a trailing "[error] …" line —
        // surface that as an error, never as a normal-looking answer.
        const errorMatch = fullText.match(/\n?\[error\] (.*)$/s);
        if (errorMatch) {
          const cleaned = fullText.slice(0, errorMatch.index).trimEnd();
          if (cleaned) applyText(cleaned);
          else removeAssistantPlaceholder();
          setSendError(errorMatch[1] || t("library-error-generic"));
        } else if (!fullText) {
          removeAssistantPlaceholder();
          setSendError(t("library-error-generic"));
        }

        await Promise.all([loadConversations(), loadAllowance()]);
        // Using the AI is what the trial is for (migration 0084). Fired after
        // the answer so it can never delay or break the reply.
        void ensureProTrial(orgId, "library").then(({ started }) => {
          if (started) {
            setTrialStarted(true);
            void loadAllowance();
          }
        });
      } catch {
        removeAssistantPlaceholder();
        setSendError(t("library-error-generic"));
      } finally {
        setSending(false);
      }
    },
    [activeConversationId, casePatient, input, loadAllowance, loadConversations, orgId, sending, t],
  );

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
  };

  const composerDisabled = !isSupabaseConfigured || !orgId || sending;
  const showStarters = messages.length === 0 && !threadLoading && !activeConversationId;

  return (
    <Box className="flex flex-col gap-5">
      <Box className="flex flex-row flex-wrap items-start justify-between gap-3">
        <Box>
          <Typography variant="h1" component="h1" className="mb-0">
            {t("library-title")}
          </Typography>
          <Breadcrumbs>
            <Link color="inherit" href="/inicio">
              {t("home-breadcrumb")}
            </Link>
            <Typography variant="body2">{t("library-title")}</Typography>
          </Breadcrumbs>
        </Box>
        <Box className="flex flex-row flex-wrap gap-2">
          <Button
            variant="outlined"
            color="grey"
            startIcon={<NiPen size="small" />}
            href="/biblioteca/protocolos"
            LinkComponent={Link}
          >
            {t("protocols-title")}
          </Button>
          <Button
            variant="outlined"
            color="grey"
            startIcon={<NiBook size="small" />}
            href="/biblioteca/acervo"
            LinkComponent={Link}
          >
            {t("acervo-title")}
          </Button>
          <Button
            variant="outlined"
            color="grey"
            startIcon={<NiPlus size="small" />}
            onClick={() => startNewConversation()}
          >
            {t("library-new-conversation")}
          </Button>
        </Box>
      </Box>

      <Typography variant="body1" className="text-text-secondary max-w-3xl">
        {t("library-subtitle")}
      </Typography>

      {!isSupabaseConfigured && (
        <Alert severity="info" className="neutral">
          {t("library-not-configured")}
        </Alert>
      )}

      <Box className="flex flex-col gap-5 md:flex-row">
        {/* The thread — the reason she is here — leads; history supports. */}
        <Box className="flex min-w-0 flex-1 flex-col gap-4">
          {showStarters ? (
            <Card component="section">
              <CardContent>
                <EmptyState
                  icon={<NiBook />}
                  title={
                    casePatient
                      ? t("library-case-empty-title", { name: casePatient.fullName })
                      : t("library-empty-title")
                  }
                  description={casePatient ? t("library-case-empty-body") : t("library-empty-body")}
                  className="border-0 py-8"
                />
                <Box className="mx-auto flex max-w-xl flex-col gap-2">
                  {(casePatient ? CASE_STARTER_KEYS : STARTER_KEYS).map((key) => (
                    <Button
                      key={key}
                      variant="outlined"
                      color="grey"
                      className="hover:text-primary justify-start text-start"
                      onClick={() => sendMessage(t(key))}
                      disabled={composerDisabled}
                    >
                      {t(key)}
                    </Button>
                  ))}
                </Box>
              </CardContent>
            </Card>
          ) : (
            <Box className="flex flex-col gap-3" aria-live="polite">
              {threadLoading ? (
                <>
                  <Skeleton variant="rounded" height={72} className="rounded-3xl" />
                  <Skeleton variant="rounded" height={140} className="rounded-3xl" />
                </>
              ) : (
                messages.map((message) => <MessageBubble key={message.id} message={message} />)
              )}
              <div ref={threadEndRef} />
            </Box>
          )}

          {/* Case review: explicit patient selection, never inferred from text. */}
          {isSupabaseConfigured && canReviewCases && (
            <Box className="flex flex-row flex-wrap items-center gap-2">
              {casePatient ? (
                <Chip
                  color="primary"
                  variant="outlined"
                  label={t("library-case-chip", { name: casePatient.fullName })}
                  onDelete={() => startNewConversation()}
                />
              ) : (
                <Autocomplete
                  size="small"
                  className="w-full max-w-xs"
                  options={patients ?? []}
                  loading={patients === null}
                  getOptionLabel={(option) => option.fullName}
                  isOptionEqualToValue={(option, value) => option.id === value.id}
                  noOptionsText={t("library-case-none")}
                  onChange={(_event, option) =>
                    option && startNewConversation({ id: option.id, fullName: option.fullName })
                  }
                  renderInput={(params) => <TextField {...params} label={t("library-case-picker")} />}
                />
              )}
            </Box>
          )}
          {isSupabaseConfigured && audioAllowance && !canReviewCases && (
            <Typography variant="body2" className="text-text-secondary">
              {t("library-case-upsell")}{" "}
              <Link href="/settings/billing" className="text-primary underline underline-offset-2">
                {t("library-quota-upgrade")}
              </Link>
            </Typography>
          )}

          {consentMissingId && (
            <Alert
              severity="warning"
              onClose={() => setConsentMissingId(null)}
              action={
                <Button
                  color="inherit"
                  size="small"
                  href={`/pacientes/${consentMissingId}/consentimentos`}
                  LinkComponent={Link}
                >
                  {t("library-case-consent-cta")}
                </Button>
              }
            >
              {t("library-case-consent-missing")}
            </Alert>
          )}

          {quotaExhausted && (
            <Alert
              severity="warning"
              action={
                <Button color="inherit" size="small" href="/settings/billing" LinkComponent={Link}>
                  {t("library-quota-upgrade")}
                </Button>
              }
            >
              {t("library-quota-exhausted", { limit: quotaExhausted.limit })}
            </Alert>
          )}
          {sendError && (
            <Alert severity="error" onClose={() => setSendError(null)}>
              {sendError}
            </Alert>
          )}
          {/* Asking the library is real use of the AI, so it may have started
              the Pro trial (migration 0084). Stated where it happened — a clock
              that starts in silence is a trial that expires "unused". */}
          {trialStarted && (
            <Alert severity="info" onClose={() => setTrialStarted(false)}>
              {t("trial-auto-started")}
            </Alert>
          )}

          <Card component="section">
            <CardContent className="flex flex-row items-end gap-2">
              <TextareaAutosize
                minRows={1}
                maxRows={6}
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={handleComposerKeyDown}
                placeholder={t("library-input-placeholder")}
                aria-label={t("library-input-label")}
                disabled={composerDisabled}
                className={cn(
                  "text-text-primary placeholder:text-text-secondary min-w-0 flex-1 resize-none bg-transparent px-1 py-2 outline-none",
                  composerDisabled && "opacity-60",
                )}
              />
              <Button
                variant="contained"
                color="primary"
                onClick={() => sendMessage()}
                disabled={composerDisabled || !input.trim()}
                aria-label={t("library-send")}
                className="icon-only"
                startIcon={<NiSendUpRight size="small" />}
              />
            </CardContent>
          </Card>

          {allowance && !allowance.unlimited && !quotaExhausted && (
            <Typography variant="body2" className="text-text-secondary">
              {t("library-quota-remaining", { used: allowance.used ?? 0, limit: allowance.limit ?? 0 })}
            </Typography>
          )}
        </Box>

        {/* Study history — reopen a past thread with its citations intact. */}
        <Card component="aside" className="w-full self-start md:w-72 md:shrink-0">
          <CardContent className="flex flex-col gap-2">
            <Typography variant="h6" component="h2">
              {t("library-history-title")}
            </Typography>
            {conversationsState.status === "error" ? (
              <Alert severity="error" action={<Button onClick={loadConversations}>{t("retry")}</Button>}>
                {conversationsState.error}
              </Alert>
            ) : conversationsState.status === "idle" || conversationsState.status === "loading" ? (
              <Skeleton variant="rounded" height={120} className="rounded-2xl" />
            ) : conversationsState.status === "empty" ? (
              <Typography variant="body2" className="text-text-secondary">
                {t("library-history-empty")}
              </Typography>
            ) : (
              <Box component="ul" className="m-0 flex list-none flex-col gap-1 p-0">
                {conversationsState.data.map((conversation) => (
                  <Box component="li" key={conversation.id} className="group flex flex-row items-center gap-1">
                    <Button
                      color="grey"
                      variant={conversation.id === activeConversationId ? "pastel" : "text"}
                      className="min-w-0 flex-1 justify-start text-start"
                      onClick={() => openConversation(conversation)}
                    >
                      <Box className="flex min-w-0 flex-col">
                        <Typography variant="body2" className="text-text-primary truncate">
                          {conversation.title || t("library-untitled-conversation")}
                        </Typography>
                        {conversation.patientName && (
                          <Typography variant="caption" className="text-primary truncate">
                            {conversation.patientName}
                          </Typography>
                        )}
                        <Typography variant="caption" className="text-text-secondary">
                          {format.dateTime(new Date(conversation.updated_at), { dateStyle: "short" })}
                        </Typography>
                      </Box>
                    </Button>
                    <Button
                      size="tiny"
                      color="grey"
                      variant="text"
                      className="icon-only min-w-0 flex-none"
                      aria-label={t("library-conversation-rename-for", {
                        title: conversation.title || t("library-untitled-conversation"),
                      })}
                      onClick={() =>
                        setRenaming({
                          id: conversation.id,
                          title: conversation.title || t("library-untitled-conversation"),
                        })
                      }
                    >
                      <NiPen size="tiny" />
                    </Button>
                    <Button
                      size="tiny"
                      color="grey"
                      variant="text"
                      className="icon-only min-w-0 flex-none"
                      aria-label={t("library-conversation-delete-for", {
                        title: conversation.title || t("library-untitled-conversation"),
                      })}
                      onClick={() => setDeleting(conversation)}
                    >
                      <NiBinEmpty size="tiny" />
                    </Button>
                  </Box>
                ))}
              </Box>
            )}
          </CardContent>
        </Card>
      </Box>

      <Dialog open={Boolean(renaming)} onClose={() => setRenaming(null)} maxWidth="xs" fullWidth>
        <DialogTitle>{t("library-conversation-rename")}</DialogTitle>
        <DialogContent className="pt-2!">
          <TextField
            fullWidth
            label={t("library-conversation-title-field")}
            value={renaming?.title ?? ""}
            onChange={(event) =>
              setRenaming((current) => (current ? { ...current, title: event.target.value } : current))
            }
          />
        </DialogContent>
        <DialogActions>
          <Button color="grey" onClick={() => setRenaming(null)}>
            {t("protocols-cancel")}
          </Button>
          <Button variant="contained" color="primary" onClick={renameConversation} disabled={!renaming?.title.trim()}>
            {t("protocols-save")}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={Boolean(deleting)} onClose={() => setDeleting(null)} maxWidth="xs" fullWidth>
        <DialogTitle>{t("library-conversation-delete")}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" className="text-text-secondary">
            {t("library-conversation-delete-body", {
              title: deleting?.title || t("library-untitled-conversation"),
            })}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button color="grey" onClick={() => setDeleting(null)}>
            {t("protocols-cancel")}
          </Button>
          <Button variant="contained" color="error" onClick={removeConversation}>
            {t("library-conversation-delete")}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
