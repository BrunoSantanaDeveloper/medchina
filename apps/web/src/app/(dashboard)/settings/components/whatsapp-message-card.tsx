"use client";

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

import { Alert, Box, Button, Card, CardContent, Chip, Grid, Skeleton, TextField, Typography } from "@mui/material";

import SectionTitle from "@/components/product/section-title";
import {
  insertWhatsappToken,
  normalizeWhatsappTemplate,
  renderWhatsappTemplate,
  unknownWhatsappTokens,
  WHATSAPP_TEMPLATE_MAX,
  WHATSAPP_TOKENS,
  type WhatsappToken,
} from "@/lib/whatsapp-template";
import { isSupabaseConfigured } from "@flyee/auth";
import { createClient } from "@flyee/auth/client";

/**
 * "A mensagem que eu mando" — the reminder text, in her words.
 *
 * The job on this card: a professional who sends tomorrow's reminders every
 * evening makes the message sound like her practice instead of like us. The
 * app only PREPARES the text — she presses send from her own number — so the
 * wording was always hers in spirit and nowhere in practice.
 *
 * Success is one edit she can see before it reaches anyone: the preview below
 * the field renders the real tokens with an example patient, because a
 * template language is only safe if you can watch it resolve.
 *
 * Clearing the field is not an empty message — it restores the product
 * default, localized. That is why there is no EmptyState here: an untouched
 * template is already a working configuration, not missing data.
 */
export default function WhatsappMessageCard() {
  const t = useTranslations("product");
  const locale = useLocale();
  const fieldRef = useRef<HTMLTextAreaElement | null>(null);

  // The product default, in the current language: `reminders-message` is an
  // ICU message, and feeding it the token names AS VALUES yields exactly the
  // raw template — no second copy of the sentence to keep in sync, no ICU
  // brace-escaping in the catalogs.
  const defaultTemplate = t("reminders-message", { name: "{name}", date: "{date}", time: "{time}" });

  const [template, setTemplate] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<"saved" | "error" | null>(null);

  const load = async () => {
    setLoading(true);
    setLoadFailed(false);
    if (!isSupabaseConfigured) {
      setLoadFailed(true);
      setLoading(false);
      return;
    }
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setLoadFailed(true);
      setLoading(false);
      return;
    }
    const { data, error } = await supabase
      .from("profiles")
      .select("whatsapp_reminder_template")
      .eq("id", user.id)
      .maybeSingle();
    if (error) {
      // A failed READ is not "she never customised it": showing the default
      // here would invite her to save over a message she never saw.
      setLoadFailed(true);
    } else {
      setTemplate((data?.whatsapp_reminder_template as string | null) ?? defaultTemplate);
    }
    setLoading(false);
  };

  useEffect(() => {
    void load();
    // `defaultTemplate` only changes with the interface language, and reloading
    // on that would discard an edit in progress.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async () => {
    setStatus(null);
    setSaving(true);
    try {
      const supabase = createClient();
      // Saving the untouched default stores NULL, so she keeps following the
      // product copy (and its translations) instead of freezing today's words.
      const normalized = normalizeWhatsappTemplate(template);
      const { data, error } = await supabase.rpc("update_whatsapp_reminder_template", {
        target_template: normalized === defaultTemplate ? null : normalized,
      });
      setStatus(!error && (data as { ok?: boolean } | null)?.ok ? "saved" : "error");
    } catch {
      setStatus("error");
    } finally {
      setSaving(false);
    }
  };

  const insertToken = (token: WhatsappToken) => {
    const field = fieldRef.current;
    const start = field?.selectionStart ?? template.length;
    const end = field?.selectionEnd ?? template.length;
    const { text, caret } = insertWhatsappToken(template, token, start, end);
    setTemplate(text);
    setStatus(null);
    requestAnimationFrame(() => {
      field?.focus();
      field?.setSelectionRange(caret, caret);
    });
  };

  const example = {
    name: t("whatsapp-template-example-name"),
    date: new Intl.DateTimeFormat(locale, { day: "2-digit", month: "2-digit" }).format(new Date()),
    time: new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(
      new Date(new Date().setHours(9, 0, 0, 0)),
    ),
  };
  const unknown = unknownWhatsappTokens(template);
  const isDefault = normalizeWhatsappTemplate(template) === defaultTemplate;

  return (
    <Grid size={12}>
      <Card component="section">
        <CardContent>
          {/* What the message is for is read once: behind the "i" (the owner,
              2026-11-09). The preview below shows it resolve. */}
          <SectionTitle
            className="mb-4"
            title={t("whatsapp-template-title")}
            description={t("whatsapp-template-hint")}
          />

          {status === "saved" && (
            <Alert severity="success" className="neutral bg-background-paper/60! mb-4">
              {t("whatsapp-template-saved")}
            </Alert>
          )}
          {status === "error" && (
            <Alert severity="error" className="neutral bg-background-paper/60! mb-4">
              {t("whatsapp-template-save-error")}
            </Alert>
          )}

          {loading ? (
            <Skeleton variant="rounded" height={150} />
          ) : loadFailed ? (
            <Alert severity="error" action={<Button onClick={() => void load()}>{t("retry")}</Button>}>
              {t("whatsapp-template-load-error")}
            </Alert>
          ) : (
            <Box className="flex flex-col gap-3">
              <TextField
                inputRef={fieldRef}
                label={t("whatsapp-template-field")}
                value={template}
                onChange={(event) => {
                  setTemplate(event.target.value.slice(0, WHATSAPP_TEMPLATE_MAX));
                  setStatus(null);
                }}
                multiline
                minRows={3}
                helperText={t("whatsapp-template-counter", {
                  used: template.length,
                  max: WHATSAPP_TEMPLATE_MAX,
                })}
              />

              {/* Tokens are inserted, never typed: {name} is a spelling test
                  nobody should sit, and a near-miss fails silently. */}
              <Box className="flex flex-row flex-wrap items-center gap-2">
                <Typography variant="body2" className="text-text-secondary text-xs">
                  {t("whatsapp-template-tokens")}
                </Typography>
                {WHATSAPP_TOKENS.map((token) => (
                  <Chip
                    key={token}
                    label={t(`whatsapp-token-${token}`)}
                    size="small"
                    variant="outlined"
                    color="primary"
                    onClick={() => insertToken(token)}
                  />
                ))}
              </Box>

              {unknown.length > 0 && (
                <Alert severity="warning" className="neutral bg-background-paper/60!">
                  {t("whatsapp-template-unknown-token", { tokens: unknown.map((token) => `{${token}}`).join(", ") })}
                </Alert>
              )}

              <Box className="bg-grey-100/60 flex flex-col gap-1 rounded-2xl px-3 py-2">
                <Typography variant="body2" className="text-text-primary text-xs font-semibold">
                  {t("whatsapp-template-preview")}
                </Typography>
                <Typography variant="body2" className="text-text-secondary text-sm leading-6 whitespace-pre-wrap">
                  {renderWhatsappTemplate(template, example)}
                </Typography>
              </Box>

              <Box className="flex flex-row flex-wrap items-center gap-2">
                <Button variant="contained" color="primary" onClick={() => void save()} disabled={saving}>
                  {saving ? t("saving") : t("save")}
                </Button>
                <Button
                  variant="text"
                  color="grey"
                  disabled={saving || isDefault}
                  onClick={() => {
                    setTemplate(defaultTemplate);
                    setStatus(null);
                  }}
                >
                  {t("whatsapp-template-restore")}
                </Button>
              </Box>
            </Box>
          )}
        </CardContent>
      </Card>
    </Grid>
  );
}
