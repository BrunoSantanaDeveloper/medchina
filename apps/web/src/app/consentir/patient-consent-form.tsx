"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  Alert,
  Box,
  Button,
  Checkbox,
  CircularProgress,
  FormControl,
  FormControlLabel,
  FormLabel,
  Radio,
  RadioGroup,
  TextField,
  Typography,
} from "@mui/material";

import NiCheck from "@/icons/nexture/ni-check";
import NiRefresh from "@/icons/nexture/ni-refresh";
import NiShieldCheck from "@/icons/nexture/ni-shield-check";

const CONSENT_SLUGS = ["audio-recording", "ai-processing", "clinical-images"] as const;
type ConsentSlug = (typeof CONSENT_SLUGS)[number];
type Decision = boolean | null;
type SignerRole = "patient" | "legal_representative";
type ScreenState = "loading" | "ready" | "submitting" | "success" | "expired" | "error";

type ConsentTerm = {
  slug: ConsentSlug;
  title: string;
  body: string;
  version: number;
};

type ResolveResponse = {
  ok?: boolean;
  status?: "pending" | "completed" | "expired" | "cancelled";
  expiresAt?: string;
  practiceName?: string;
  organizationName?: string;
  terms?: ConsentTerm[];
  code?: string;
  error?: { code?: string };
};

type SubmitResponse = {
  ok?: boolean;
  status?: "completed" | "expired";
  code?: string;
  error?: { code?: string };
};

const emptyDecisions = (): Record<ConsentSlug, Decision> => ({
  "audio-recording": null,
  "ai-processing": null,
  "clinical-images": null,
});

const isConsentSlug = (value: unknown): value is ConsentSlug =>
  typeof value === "string" && (CONSENT_SLUGS as readonly string[]).includes(value);

const responseCode = (body: { code?: string; error?: { code?: string } }) => body.code ?? body.error?.code;

const formatCountdown = (milliseconds: number) => {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
};

const tokenFromFragment = () => {
  const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const token = fragment.get("t")?.trim() ?? "";
  return /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
};

export default function PatientConsentForm() {
  const t = useTranslations("product");
  const [state, setState] = useState<ScreenState>("loading");
  const [token, setToken] = useState<string | null>(null);
  const [terms, setTerms] = useState<ConsentTerm[]>([]);
  const [organizationName, setOrganizationName] = useState("");
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [decisions, setDecisions] = useState<Record<ConsentSlug, Decision>>(() => emptyDecisions());
  const [signerRole, setSignerRole] = useState<SignerRole>("patient");
  const [signerName, setSignerName] = useState("");
  const [relationship, setRelationship] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [errorKey, setErrorKey] = useState("consent-public-invalid");
  const idempotencyKey = useRef<string | null>(null);
  const outcomeHeading = useRef<HTMLHeadingElement | null>(null);

  const resolveSession = useCallback(async () => {
    const fragmentToken = tokenFromFragment();
    if (!fragmentToken) {
      setErrorKey("consent-public-invalid");
      setState("error");
      return;
    }

    setToken(fragmentToken);
    setState("loading");
    setErrorKey("consent-public-load-error");
    try {
      const response = await fetch("/api/public/consent/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ token: fragmentToken }),
      });
      const body = (await response.json().catch(() => ({}))) as ResolveResponse;
      const code = responseCode(body);
      if (body.status === "completed") {
        window.history.replaceState(null, "", window.location.pathname);
        setState("success");
        return;
      }
      if (body.status === "expired" || body.status === "cancelled" || code === "consent_link_invalid") {
        setState("expired");
        return;
      }
      if (!response.ok || !body.ok || body.status !== "pending") {
        setErrorKey("consent-public-invalid");
        setState("error");
        return;
      }

      const normalizedTerms = (body.terms ?? []).filter(
        (term): term is ConsentTerm =>
          isConsentSlug(term.slug) &&
          typeof term.title === "string" &&
          typeof term.body === "string" &&
          typeof term.version === "number",
      );
      if (
        normalizedTerms.length !== CONSENT_SLUGS.length ||
        new Set(normalizedTerms.map((term) => term.slug)).size !== CONSENT_SLUGS.length
      ) {
        setErrorKey("consent-public-load-error");
        setState("error");
        return;
      }

      const orderedTerms = CONSENT_SLUGS.map((slug) => normalizedTerms.find((term) => term.slug === slug)).filter(
        (term): term is ConsentTerm => Boolean(term),
      );
      setTerms(orderedTerms);
      setOrganizationName(body.organizationName ?? body.practiceName ?? "");
      setExpiresAt(body.expiresAt ?? null);
      setNow(Date.now());
      setDecisions(emptyDecisions());
      setConfirmed(false);
      idempotencyKey.current = null;
      setState("ready");
    } catch {
      setErrorKey("consent-public-load-error");
      setState("error");
    }
  }, []);

  useEffect(() => {
    void resolveSession();
  }, [resolveSession]);

  useEffect(() => {
    if (state === "success" || state === "expired" || state === "error") outcomeHeading.current?.focus();
  }, [state]);

  useEffect(() => {
    if (state !== "ready" || !expiresAt) return;
    const tick = () => {
      const current = Date.now();
      setNow(current);
      if (current >= new Date(expiresAt).getTime()) setState("expired");
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [expiresAt, state]);

  const allDecided = CONSENT_SLUGS.every((slug) => decisions[slug] !== null);
  const validIdentity = signerName.trim().length > 0 && (signerRole === "patient" || relationship.trim().length > 0);
  const canSubmit = state === "ready" && allDecided && validIdentity && confirmed;
  const busy = state === "submitting";

  const setAll = (decision: boolean) => {
    setDecisions({
      "audio-recording": decision,
      "ai-processing": decision,
      "clinical-images": decision,
    });
  };

  const submit = async () => {
    if (!canSubmit || !token) return;
    setState("submitting");
    setErrorKey("consent-public-submit-error");
    idempotencyKey.current ??= crypto.randomUUID();

    try {
      const response = await fetch("/api/public/consent/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          decisions,
          idempotencyKey: idempotencyKey.current,
          signerRole,
          signerName: signerName.trim(),
          representativeRelationship: signerRole === "legal_representative" ? relationship.trim() : null,
          confirmed: true,
        }),
      });
      const body = (await response.json().catch(() => ({}))) as SubmitResponse;
      const code = responseCode(body);
      if (body.status === "expired" || code === "consent_link_invalid") {
        setState("expired");
        return;
      }
      if (!response.ok || !body.ok) {
        if (code === "consent_terms_changed") {
          setErrorKey("consent-public-term-changed");
          setState("error");
          return;
        }
        setErrorKey("consent-public-submit-error");
        setState("ready");
        return;
      }

      window.history.replaceState(null, "", window.location.pathname);
      setState("success");
    } catch {
      // Keep the same idempotency key: the server may have committed before
      // the network response was lost.
      setState("ready");
      setErrorKey("consent-public-submit-error");
    }
  };

  if (state === "loading") {
    return (
      <Box role="status" aria-live="polite" className="flex min-h-60 flex-col items-center justify-center gap-3">
        <CircularProgress aria-label={t("consent-public-loading")} />
        <Typography variant="body2" className="text-text-primary">
          {t("consent-public-loading")}
        </Typography>
      </Box>
    );
  }

  if (state === "success") {
    return (
      <Box
        role="status"
        aria-live="polite"
        className="flex min-h-60 flex-col items-center justify-center gap-4 text-center"
      >
        <Box className="bg-success/10 text-success flex h-14 w-14 items-center justify-center rounded-full" aria-hidden>
          <NiCheck size="large" />
        </Box>
        <Typography ref={outcomeHeading} tabIndex={-1} variant="h4" component="h1">
          {t("consent-public-success-title")}
        </Typography>
        <Typography variant="body1" className="text-text-primary max-w-md leading-6">
          {t("consent-public-success-body")}
        </Typography>
      </Box>
    );
  }

  if (state === "expired" || state === "error") {
    return (
      <Box role="status" aria-live="polite" className="flex min-h-60 flex-col justify-center gap-4">
        <Typography ref={outcomeHeading} tabIndex={-1} variant="h4" component="h1">
          {t(state === "expired" ? "consent-public-expired-title" : "consent-public-error-title")}
        </Typography>
        <Alert severity={state === "expired" ? "warning" : "error"} className="neutral bg-background-paper/60!">
          <Typography variant="body2" className="text-text-primary">
            {t(state === "expired" ? "consent-public-expired-body" : errorKey)}
          </Typography>
        </Alert>
        {state === "error" && errorKey === "consent-public-load-error" && (
          <Button
            variant="contained"
            onClick={resolveSession}
            startIcon={<NiRefresh aria-hidden />}
            className="min-h-11 self-start"
          >
            {t("retry")}
          </Button>
        )}
      </Box>
    );
  }

  return (
    <Box
      component="form"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      className="flex flex-col gap-6"
    >
      <Box className="flex flex-col gap-2">
        <Typography variant="h3" component="h1">
          {t("consent-public-title")}
        </Typography>
        <Typography variant="body1" className="text-text-primary leading-6">
          {organizationName
            ? t("consent-public-intro-organization", { organization: organizationName })
            : t("consent-public-intro")}
        </Typography>
        <Alert severity="info" icon={<NiShieldCheck aria-hidden />} className="neutral bg-background-paper/60!">
          <Typography variant="body2" className="text-text-primary">
            {t("consent-public-optional-note")}
          </Typography>
        </Alert>
        {expiresAt && (
          <Typography variant="body2" className="text-text-primary" role="status" aria-live="polite">
            {t("consent-public-expires-in", {
              time: formatCountdown(Math.max(0, new Date(expiresAt).getTime() - now)),
            })}
          </Typography>
        )}
      </Box>

      {errorKey === "consent-public-submit-error" && state === "ready" && (
        <Alert severity="error" className="neutral bg-background-paper/60!" role="alert">
          <Typography variant="body2" className="text-text-primary">
            {t(errorKey)}
          </Typography>
        </Alert>
      )}

      <Box className="grid grid-cols-1 gap-2 sm:grid-cols-2" aria-label={t("consent-public-bulk-actions")}>
        <Button
          variant="outlined"
          color="grey"
          onClick={() => setAll(true)}
          disabled={busy}
          className="min-h-11 w-full"
        >
          {t("consent-public-authorize-all")}
        </Button>
        <Button
          variant="outlined"
          color="grey"
          onClick={() => setAll(false)}
          disabled={busy}
          className="min-h-11 w-full"
        >
          {t("consent-public-refuse-all")}
        </Button>
      </Box>

      <Box className="flex flex-col gap-4">
        {terms.map((term) => {
          const decision = decisions[term.slug];
          return (
            <FormControl
              key={term.slug}
              component="fieldset"
              className="border-grey-100 rounded-2xl border p-4"
              disabled={busy}
            >
              <FormLabel component="legend" className="text-text-primary! text-base! font-semibold!">
                {term.title}
              </FormLabel>
              <Typography variant="caption" className="text-text-primary mt-1">
                {t("consent-public-term-version", { version: term.version })}
              </Typography>
              <Typography variant="body2" className="text-text-primary mt-3 leading-6 whitespace-pre-line">
                {term.body}
              </Typography>
              <RadioGroup
                row
                name={`decision-${term.slug}`}
                aria-label={t("consent-public-decision-label", { purpose: term.title })}
                aria-required="true"
                value={decision === null ? "" : decision ? "yes" : "no"}
                onChange={(event) =>
                  setDecisions((current) => ({ ...current, [term.slug]: event.target.value === "yes" }))
                }
                className="mt-3 gap-x-4"
              >
                <FormControlLabel
                  value="yes"
                  control={<Radio />}
                  label={t("consent-public-authorize")}
                  className="min-h-11"
                />
                <FormControlLabel
                  value="no"
                  control={<Radio />}
                  label={t("consent-public-refuse")}
                  className="min-h-11"
                />
              </RadioGroup>
            </FormControl>
          );
        })}
      </Box>

      <FormControl component="fieldset" className="flex flex-col gap-3" disabled={busy}>
        <FormLabel component="legend" className="text-text-primary!">
          {t("consent-public-signer-role")}
        </FormLabel>
        <RadioGroup
          value={signerRole}
          onChange={(event) => setSignerRole(event.target.value as SignerRole)}
          aria-label={t("consent-public-signer-role")}
        >
          <FormControlLabel
            value="patient"
            control={<Radio />}
            label={t("consent-public-signer-patient")}
            className="min-h-11"
          />
          <FormControlLabel
            value="legal_representative"
            control={<Radio />}
            label={t("consent-public-signer-representative")}
            className="min-h-11"
          />
        </RadioGroup>
        <TextField
          required
          fullWidth
          label={t("consent-public-signer-name")}
          value={signerName}
          onChange={(event) => setSignerName(event.target.value)}
          autoComplete="name"
          disabled={busy}
          slotProps={{
            htmlInput: { maxLength: 160 },
            inputLabel: { className: "text-text-primary!" },
          }}
        />
        {signerRole === "legal_representative" && (
          <TextField
            required
            fullWidth
            label={t("consent-public-representative-relationship")}
            value={relationship}
            onChange={(event) => setRelationship(event.target.value)}
            disabled={busy}
            slotProps={{
              htmlInput: { maxLength: 120 },
              inputLabel: { className: "text-text-primary!" },
            }}
          />
        )}
      </FormControl>

      <FormControlLabel
        control={
          <Checkbox checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} disabled={busy} />
        }
        label={t("consent-public-final-confirmation")}
        className="min-h-11 items-start"
      />

      {!allDecided && (
        <Typography variant="body2" className="text-text-primary" role="status" aria-live="polite">
          {t("consent-public-all-decisions-required")}
        </Typography>
      )}

      <Button
        type="submit"
        variant="contained"
        color="primary"
        size="large"
        disabled={!canSubmit || busy}
        className="min-h-12 w-full"
      >
        {state === "submitting" ? t("consent-public-submitting") : t("consent-public-submit")}
      </Button>
    </Box>
  );
}
