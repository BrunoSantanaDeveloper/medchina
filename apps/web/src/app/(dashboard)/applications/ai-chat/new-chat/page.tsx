"use client";

import ChatMessage from "../components/chat-message";
import { Conversation } from "../components/types";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MouseEvent, useEffect, useRef, useState } from "react";

import {
  Box,
  Breadcrumbs,
  Button,
  Card,
  CardContent,
  Chip,
  FormControl,
  TextareaAutosize,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from "@mui/material";
import { Grid } from "@mui/material";

import NiArrowOutUp from "@/icons/nexture/ni-arrow-out-up";
import NiSendRight from "@/icons/nexture/ni-send-right";
import NiSendUpRight from "@/icons/nexture/ni-send-up-right";
import { cn } from "@/lib/utils";
import { isSupabaseConfigured } from "@gogo/auth";
import { createClient } from "@gogo/auth/client";

type AssistantOption = { slug: string; name: string; description: string | null };
type PendingAttachment = { kind: "image" | "audio"; path: string; mime: string; name: string };

const DEMO_ANSWER = `###### Demo mode

The AI backend is not configured. Set NEXT_PUBLIC_SUPABASE_URL, apply the migrations and add a provider key (ANTHROPIC_API_KEY, GEMINI_API_KEY or OPENROUTER_API_KEY) to chat with a real assistant configured in /admin/ai.`;

export default function NewChat() {
  const router = useRouter();

  // Real assistants (the instruction sets) replace the demo toggle values.
  const [assistants, setAssistants] = useState<AssistantOption[]>([]);
  const [assistantSlug, setAssistantSlug] = useState<string | null>(null);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const [sending, setSending] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [inputValue, setInputValue] = useState("");
  const [conversation, setConversation] = useState<Conversation[]>([]);

  useEffect(() => {
    const load = async () => {
      if (!isSupabaseConfigured) return;
      const supabase = createClient();
      const [{ data: assistantRows }, userResult] = await Promise.all([
        supabase.from("assistants").select("slug, name, description").eq("is_active", true).order("sort"),
        supabase.auth.getUser(),
      ]);
      setAssistants(assistantRows ?? []);
      setAssistantSlug(assistantRows?.[0]?.slug ?? null);
      const user = userResult.data.user;
      if (user) {
        const { data: membership } = await supabase
          .from("memberships")
          .select("org_id")
          .eq("user_id", user.id)
          .order("created_at")
          .limit(1)
          .maybeSingle();
        setOrgId(membership?.org_id ?? null);
      }
    };
    load();
  }, []);

  const liveMode = isSupabaseConfigured && assistantSlug !== null && orgId !== null;

  const handleAssistantChange = (_event: MouseEvent<HTMLElement>, slug: string | null) => {
    if (!slug) return;
    setAssistantSlug(slug);
    // Each assistant has its own instructions — start a fresh conversation.
    setConversationId(null);
    setConversation([]);
  };

  const handleUploadClick = () => fileInputRef.current?.click();

  const handleFileSelected = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !orgId) return;
    const kind = file.type.startsWith("audio") ? "audio" : "image";
    const path = `${orgId}/${crypto.randomUUID()}-${file.name}`;
    const supabase = createClient();
    const { error } = await supabase.storage.from("ai-attachments").upload(path, file);
    if (!error) {
      setPendingAttachments((current) => [...current, { kind, path, mime: file.type, name: file.name }]);
    }
  };

  const appendMessage = (message: Conversation) => setConversation((prev) => [...prev, message]);

  const sendUserInput = async (text?: string) => {
    const content = (text ?? inputValue).trim();
    if ((content === "" && pendingAttachments.length === 0) || sending) return;

    appendMessage({ id: crypto.randomUUID(), type: "User", message: content });
    setInputValue("");

    if (!liveMode) {
      setTimeout(
        () => appendMessage({ id: crypto.randomUUID(), type: "AI", animate: true, message: DEMO_ANSWER }),
        300,
      );
      return;
    }

    const attachments = pendingAttachments.map(({ kind, path, mime }) => ({ kind, path, mime }));
    setPendingAttachments([]);
    setSending(true);

    const aiMessageId = crypto.randomUUID();
    appendMessage({ id: aiMessageId, type: "AI", animate: false, message: "..." });
    const updateAiMessage = (message: string) =>
      setConversation((prev) => prev.map((item) => (item.id === aiMessageId ? { ...item, message } : item)));

    try {
      const response = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId, assistantSlug, conversationId, message: content, attachments }),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        updateAiMessage(`###### Request failed\n\n${data?.error ?? `HTTP ${response.status}`}`);
        return;
      }

      const newConversationId = response.headers.get("X-Conversation-Id");
      if (newConversationId) setConversationId(newConversationId);

      const reader = response.body?.getReader();
      if (!reader) return;
      const decoder = new TextDecoder();
      let fullText = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        fullText += decoder.decode(value, { stream: true });
        updateAiMessage(fullText);
      }
    } catch (error) {
      updateAiMessage(`###### Request failed\n\n${error instanceof Error ? error.message : "Network error"}`);
    } finally {
      setSending(false);
    }
  };

  const handleInputKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendUserInput();
    }
  };

  // Scrolling
  const scrollToBottom = () => {
    window.scrollTo({ top: document.body.scrollHeight, left: 0 });
  };

  const [isAnimating, setIsAnimating] = useState(false);
  useEffect(() => {
    let intervalId: ReturnType<typeof setInterval>;
    if (isAnimating || sending) {
      intervalId = setInterval(scrollToBottom, 100);
    }
    return () => clearInterval(intervalId);
  }, [isAnimating, sending]);

  useEffect(() => {
    scrollToBottom();
  }, [conversation]);

  const activeAssistant = assistants.find((assistant) => assistant.slug === assistantSlug);

  return (
    <Box className="relative flex h-full min-h-[calc(100vh-12rem)] flex-col items-center gap-5">
      <Grid container spacing={5} className="w-full" size={12}>
        <Grid container spacing={2.5} className="w-full" size={12}>
          <Grid size={{ md: "grow", xs: 12 }}>
            <Box className="flex flex-row items-center gap-2">
              <Typography variant="h1" component="h1" className="mb-0">
                AI Chat
              </Typography>
              {activeAssistant && (
                <Tooltip title={activeAssistant.description ?? ""}>
                  <Chip label={activeAssistant.name} size="small" variant="outlined" color="primary" />
                </Tooltip>
              )}
            </Box>

            <Breadcrumbs>
              <Link color="inherit" href="/dashboards/default">
                Home
              </Link>
              <Link color="inherit" href="/applications">
                Applications
              </Link>
              <Typography variant="body2">AI Chat</Typography>
            </Breadcrumbs>
          </Grid>

          <Grid size={{ xs: 12, md: "auto" }} className="flex flex-row items-start gap-2">
            <Button
              size="medium"
              color="primary"
              variant="contained"
              startIcon={<NiSendUpRight size={"medium"} />}
              onClick={() => {
                router.push("/settings/billing");
              }}
            >
              Upgrade
            </Button>
          </Grid>
        </Grid>
      </Grid>

      <Box
        className={cn(
          "flex w-full max-w-200 flex-1 flex-col items-center justify-center pb-32 sm:px-4",
          conversation.length > 0 && "items-end justify-start gap-5",
        )}
      >
        {conversation.length === 0 ? (
          <Box className="flex flex-col items-center gap-4">
            <Typography
              variant="h1"
              className="from-primary-dark via-primary to-primary-light inline-block bg-linear-to-r bg-clip-text text-center text-transparent rtl:bg-linear-to-l"
            >
              How can I help?
            </Typography>

            <Box className="mt-2 flex flex-col items-center gap-1">
              <Button
                variant="outlined"
                color="grey"
                className="hover:text-primary"
                onClick={() => sendUserInput("What can you help me with?")}
              >
                What can you help me with?
              </Button>
              <Button
                variant="outlined"
                color="grey"
                className="hover:text-primary"
                onClick={() => sendUserInput("Summarize what this product does.")}
              >
                Summarize what this product does.
              </Button>
            </Box>
          </Box>
        ) : (
          conversation.map((conversationMessage) => {
            return (
              <ChatMessage
                key={conversationMessage.id}
                conversation={conversationMessage}
                onAnimationStart={() => {
                  setIsAnimating(true);
                }}
                onAnimationEnd={() => {
                  setIsAnimating(false);
                }}
                onFeedbackQuestionClick={(question) => sendUserInput(question)}
              />
            );
          })
        )}
      </Box>

      <Box className="bg-background fixed bottom-0 z-2 w-full p-4 sm:max-w-160 lg:max-w-200">
        <Card>
          <CardContent className="flex flex-col gap-4 p-2!">
            <FormControl className="MuiTextField-root relative mb-0 w-full">
              <TextareaAutosize
                minRows={2}
                maxRows={3}
                className="MuiInputBase-root MuiInput-root outlined autosize bg-background-paper! w-full resize-none pe-20! outline-none!"
                placeholder="Chat with the AI assistant..."
                onChange={(event) => setInputValue(event.target.value)}
                onKeyDown={handleInputKeyDown}
                value={inputValue}
              />
              <Box className="absolute end-0 flex flex-row">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*,audio/*"
                  className="hidden"
                  onChange={handleFileSelected}
                />
                <Tooltip title="Attach image or audio" arrow enterDelay={2000}>
                  <Button
                    className="icon-only"
                    size="medium"
                    color="grey"
                    variant="text"
                    onClick={handleUploadClick}
                    disabled={!liveMode}
                    startIcon={<NiArrowOutUp size={"medium"} />}
                  />
                </Tooltip>
                <Tooltip title="Send" arrow enterDelay={2000}>
                  <Button
                    className="icon-only ms-1"
                    size="medium"
                    color="primary"
                    variant="pastel"
                    onClick={() => sendUserInput()}
                    disabled={sending}
                    startIcon={<NiSendRight size={"medium"} />}
                  />
                </Tooltip>
              </Box>
            </FormControl>

            {pendingAttachments.length > 0 && (
              <Box className="flex flex-row flex-wrap gap-1 px-4">
                {pendingAttachments.map((attachment) => (
                  <Chip
                    key={attachment.path}
                    label={`${attachment.kind}: ${attachment.name}`}
                    size="small"
                    variant="outlined"
                    onDelete={() =>
                      setPendingAttachments((current) => current.filter((item) => item.path !== attachment.path))
                    }
                  />
                ))}
              </Box>
            )}

            {assistants.length > 0 && (
              <ToggleButtonGroup
                size="tiny"
                color="primary"
                value={assistantSlug}
                exclusive
                onChange={handleAssistantChange}
                className="mb-2 hidden px-4 md:flex"
              >
                {assistants.map((assistant) => (
                  <ToggleButton
                    key={assistant.slug}
                    size="tiny"
                    value={assistant.slug}
                    className="[.Mui-selected]:bg-primary/10! [.Mui-selected]:text-primary! px-3!"
                  >
                    {assistant.name}
                  </ToggleButton>
                ))}
              </ToggleButtonGroup>
            )}
          </CardContent>
        </Card>
      </Box>
    </Box>
  );
}
