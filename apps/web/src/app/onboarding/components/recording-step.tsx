"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { Accordion, AccordionDetails, AccordionSummary, Alert, Box, Skeleton, Typography } from "@mui/material";

import MicCheck, { type MicCheckResult } from "@/components/product/mic-check";
import { useOnboardingStatus } from "@/components/product/onboarding-status-provider";
import NiChevronDownSmall from "@/icons/nexture/ni-chevron-down-small";
import NiDocumentCheck from "@/icons/nexture/ni-document-check";
import NiMicrophone from "@/icons/nexture/ni-microphone";
import NiPhone from "@/icons/nexture/ni-phone";
import { createClient } from "@flyee/auth/client";

/** The two authorizations a recorded consultation needs — audio first: without it nothing is captured. */
const RECORDING_TERMS = [
  { slug: "audio-recording", label: "consent-audio-label", purpose: "consent-audio-hint" },
  { slug: "ai-processing", label: "consent-ai-label", purpose: "consent-ai-hint" },
] as const;

type Term = { slug: string; version: number; title: string; body: string };

/**
 * Step 3 of the preparation: leave the recording ready.
 *
 * The job: everything a first recorded consultation depends on that she can
 * settle ALONE — because the alternative is settling it with the patient
 * already talking. Three things, none of which touches a patient:
 *
 *  - the microphone works, and the browser has already been told it may use it;
 *  - she knows she can also capture from her phone;
 *  - she has READ what the patient will be asked to authorize.
 *
 * Nothing is recorded here and no authorization is registered here. Consent is
 * the patient's, given per patient and kept in an auditable table that is never
 * deleted — a step that "registered" one with nobody in the room would make the
 * database assert something that did not happen. The terms are shown read-only,
 * straight from `consent_terms`, the same text the consent screen presents.
 *
 * It is an invitation, never a fork: the page offers "vou registrar digitando"
 * beside "continuar", and both lead to the same next step.
 */
export default function RecordingStep({ onMicResult }: { onMicResult: (result: MicCheckResult) => void }) {
  const t = useTranslations("product");
  const { status, allowance, trialParams } = useOnboardingStatus();
  /** null = still reading · "error" = could not read · otherwise the active terms by slug. */
  const [terms, setTerms] = useState<Record<string, Term> | "error" | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      const { data, error } = await createClient()
        .from("consent_terms")
        .select("slug, version, title, body")
        .in(
          "slug",
          RECORDING_TERMS.map((term) => term.slug),
        )
        .eq("is_active", true)
        .order("version", { ascending: false });
      if (!active) return;
      if (error) {
        setTerms("error");
        return;
      }
      // Newest first, so the first row seen for a slug is its current version.
      const bySlug: Record<string, Term> = {};
      for (const row of (data ?? []) as Term[]) bySlug[row.slug] ??= row;
      setTerms(bySlug);
    };
    void load();
    return () => {
      active = false;
    };
  }, []);

  // Where she stands commercially decides what this step may promise. It is
  // the same reading the header badge shows, so the two cannot disagree — and
  // someone who has just paid is never offered a trial here.
  const commercial =
    status === null
      ? null
      : status.kind === "plan"
        ? t("prep-recording-status-plan", { plan: status.planName ?? t("onboarding-badge-plan-unnamed") })
        : status.kind === "pending_payment"
          ? t("prep-recording-status-pending")
          : status.kind === "payment_unconfirmed"
            ? t("prep-recording-status-unconfirmed")
            : status.kind === "trial"
              ? t("prep-recording-status-trial")
              : allowance?.trialAvailable
                ? trialParams
                  ? t("prep-recording-status-free", trialParams)
                  : t("prep-recording-status-free-generic")
                : t("prep-recording-status-no-trial");

  return (
    <Box className="flex flex-col gap-5">
      {commercial && (
        <Alert severity="info" className="neutral bg-background-paper/60!">
          {commercial}
        </Alert>
      )}

      <Section icon={<NiMicrophone size="medium" />} title={t("prep-recording-mic-title")}>
        <Typography variant="body2" className="text-text-secondary leading-5">
          {t("prep-recording-mic-body")}
        </Typography>
        <MicCheck onResult={onMicResult} />
      </Section>

      <Section icon={<NiPhone size="medium" />} title={t("prep-recording-phone-title")}>
        <Typography variant="body2" className="text-text-secondary leading-5">
          {t("prep-recording-phone-body", { action: t("capture-qr-open") })}
        </Typography>
      </Section>

      <Section icon={<NiDocumentCheck size="medium" />} title={t("prep-recording-terms-title")}>
        <Typography variant="body2" className="text-text-secondary leading-5">
          {t("prep-recording-terms-body")}
        </Typography>
        <Box>
          {RECORDING_TERMS.map((entry) => {
            const term = terms && terms !== "error" ? terms[entry.slug] : undefined;
            return (
              <Accordion key={entry.slug} disableGutters>
                <AccordionSummary
                  expandIcon={<NiChevronDownSmall size="medium" />}
                  id={`prep-term-${entry.slug}-header`}
                  aria-controls={`prep-term-${entry.slug}-content`}
                >
                  <Box className="flex min-w-0 flex-col">
                    <Typography variant="subtitle2" component="span">
                      {t(entry.label)}
                    </Typography>
                    <Typography variant="body2" component="span" className="text-text-secondary leading-5">
                      {t(entry.purpose)}
                    </Typography>
                  </Box>
                </AccordionSummary>
                {/* No id here: the Accordion gives its own region the id named
                    by `aria-controls` above; repeating it would put the same id
                    on two elements. */}
                <AccordionDetails>
                  {terms === null ? (
                    <Skeleton variant="rounded" height={72} />
                  ) : term ? (
                    <Box className="flex flex-col gap-1">
                      <Typography variant="subtitle2" component="p" className="mb-0">
                        {term.title}
                      </Typography>
                      <Typography variant="body2" className="text-text-secondary">
                        {t("consent-sheet-version", { version: term.version })}
                      </Typography>
                      <Typography variant="body2" className="leading-6 whitespace-pre-line">
                        {term.body}
                      </Typography>
                    </Box>
                  ) : (
                    // Not "there is no term": the text could not be read here.
                    // It is still shown when the authorization is registered.
                    <Alert severity="warning" className="neutral bg-background-paper/60!">
                      {t("prep-recording-terms-unavailable")}
                    </Alert>
                  )}
                </AccordionDetails>
              </Accordion>
            );
          })}
        </Box>
      </Section>
    </Box>
  );
}

/** One of the three things this step settles, led by the icon of what it is about. */
function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <Box component="section" className="flex flex-row items-start gap-3">
      <span aria-hidden className="text-primary mt-0.5 inline-flex flex-none">
        {icon}
      </span>
      <Box className="flex min-w-0 flex-1 flex-col gap-2">
        <Typography variant="subtitle1" component="h3" className="mb-0">
          {title}
        </Typography>
        {children}
      </Box>
    </Box>
  );
}
