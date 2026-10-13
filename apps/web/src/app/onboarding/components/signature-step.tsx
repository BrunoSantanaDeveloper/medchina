"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { Alert, Box, TextField } from "@mui/material";

import SignaturePreview from "@/components/product/signature-preview";
import { recordAudit } from "@/lib/audit";
import { createClient } from "@flyee/auth/client";

/** Mirrors `profiles_professional_credentials_lengths` (migration 0095). */
const TITLE_MAX = 120;
const REGISTRATION_MAX = 60;

export type SignatureValues = { title: string; registration: string };

/**
 * Step 2 of the preparation: how she signs.
 *
 * The job: decide what prints under her name on every atestado, receituário
 * and plano terapêutico — and see it on the page as she types. Asked here
 * because it needs no patient, and because the alternative is finding out on
 * the first printed document that it was signed by a name alone.
 *
 * Both fields are optional and free text on purpose: acupuncture in Brazil has
 * no single council, so a fixed (council, number) shape would refuse the
 * credential of whoever is not on the list (0095).
 *
 * Saving with both fields empty writes nothing and reports `null`, so the page
 * can tell "she decided to leave it" from "she filled it in".
 */
export default function SignatureStep({
  formId,
  userId,
  orgId,
  displayName,
  practiceName,
  initial,
  onSubmittingChange,
  onCompleted,
}: {
  /** The wizard's primary button submits this form (`form={formId}`). */
  formId: string;
  userId: string;
  orgId: string;
  displayName: string;
  practiceName: string;
  initial: SignatureValues;
  onSubmittingChange: (submitting: boolean) => void;
  /** `null` when there was nothing to save. */
  onCompleted: (values: SignatureValues | null) => void;
}) {
  const t = useTranslations("product");
  const [title, setTitle] = useState(initial.title);
  const [registration, setRegistration] = useState(initial.registration);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    onSubmittingChange(submitting);
  }, [onSubmittingChange, submitting]);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;
    const next = { title: title.trim(), registration: registration.trim() };
    const unchanged = next.title === initial.title.trim() && next.registration === initial.registration.trim();
    if (unchanged) {
      // Nothing typed, or nothing different from what is stored: no write.
      onCompleted(next.title || next.registration ? next : null);
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const supabase = createClient();
      const { error: updateError } = await supabase
        .from("profiles")
        .update({
          professional_title: next.title || null,
          professional_registration: next.registration || null,
        })
        .eq("id", userId);
      if (updateError) {
        setError(t("prep-save-error"));
        return;
      }
      // What signs her documents changed: that belongs in the trail. Presence
      // only — the credential itself is hers and already on the profile.
      void recordAudit(supabase, "profile.credentials.updated", {
        orgId,
        entityType: "profile",
        entityId: userId,
        metadata: { hasTitle: Boolean(next.title), hasRegistration: Boolean(next.registration), origin: "onboarding" },
      });
      window.dispatchEvent(new Event("medchina:profile-updated"));
      onCompleted(next.title || next.registration ? next : null);
    } catch {
      setError(t("prep-save-error"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Box component="form" id={formId} onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <Box className="grid gap-4 md:grid-cols-2">
        <Box className="flex flex-col gap-4">
          <TextField
            label={t("settings-professional-title")}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder={t("settings-professional-title-placeholder")}
            helperText={t("settings-professional-title-help")}
            disabled={submitting}
            fullWidth
            slotProps={{ htmlInput: { maxLength: TITLE_MAX }, inputLabel: { shrink: true } }}
          />
          <TextField
            label={t("settings-professional-registration")}
            value={registration}
            onChange={(event) => setRegistration(event.target.value)}
            placeholder={t("settings-professional-registration-placeholder")}
            helperText={t("settings-professional-registration-help")}
            disabled={submitting}
            fullWidth
            slotProps={{ htmlInput: { maxLength: REGISTRATION_MAX }, inputLabel: { shrink: true } }}
          />
        </Box>
        <SignaturePreview name={displayName} title={title} registration={registration} practiceName={practiceName} />
      </Box>

      {error && <Alert severity="error">{error}</Alert>}
    </Box>
  );
}
