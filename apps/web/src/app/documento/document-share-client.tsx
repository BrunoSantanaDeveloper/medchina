"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";

import { Alert, Box, Button, CircularProgress, Typography } from "@mui/material";

import NiCheckSquare from "@/icons/nexture/ni-check-square";
import NiDownloadCloud from "@/icons/nexture/ni-download-cloud";
import { documentKindLabelKey } from "@/lib/document-kinds";
import { isShareLinkToken } from "@/lib/share-link-token";

type Phase = "loading" | "ready" | "invalid" | "revoked" | "network";
type Doc = {
  organizationName?: string;
  kind?: string;
  verifyCode?: string;
  issuedAt?: string;
  downloadUrl: string;
};

/**
 * Where a patient receives the document her practitioner issued.
 *
 * She arrives from a WhatsApp message or an e-mail that carries no clinical
 * content — just this link. Her job here is exactly one thing: get the file.
 * So the page resolves the token on load and puts the download in front of
 * her, with the practice's name and the verification code that proves the
 * document is authentic.
 *
 * Every failure says what to DO (ask the professional for a new link) rather
 * than reporting a status: the person reading this is not a system operator,
 * and a dead end here means she leaves without her treatment plan.
 */
export default function DocumentShareClient() {
  const t = useTranslations("product");
  const [phase, setPhase] = useState<Phase>("loading");
  const [doc, setDoc] = useState<Doc | null>(null);

  const resolve = useCallback(async () => {
    setPhase("loading");
    const token = window.location.hash.replace(/^#/, "");
    if (!isShareLinkToken(token)) {
      setPhase("invalid");
      return;
    }
    try {
      const response = await fetch("/api/public/document/open", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const body = (await response.json().catch(() => ({}))) as { ok?: boolean; code?: string } & Partial<Doc>;
      if (!response.ok || !body.ok || !body.downloadUrl) {
        setPhase(body.code === "document_revoked" ? "revoked" : "invalid");
        return;
      }
      setDoc(body as Doc);
      setPhase("ready");
    } catch {
      // No connection is not an invalid link — offer a retry instead of
      // telling her to go ask for a new one.
      setPhase("network");
    }
  }, []);

  useEffect(() => {
    void resolve();
  }, [resolve]);

  if (phase === "loading") {
    return (
      <Box className="flex items-center justify-center py-8">
        <CircularProgress aria-label={t("loading")} />
      </Box>
    );
  }

  if (phase === "network") {
    return (
      <Box className="flex flex-col gap-3">
        <Typography variant="h5" component="h1">
          {t("document-share-network-title")}
        </Typography>
        <Typography variant="body2" className="text-text-secondary leading-6">
          {t("document-share-network-body")}
        </Typography>
        <Button variant="contained" color="primary" onClick={() => void resolve()} className="self-start">
          {t("retry")}
        </Button>
      </Box>
    );
  }

  if (phase === "invalid" || phase === "revoked") {
    return (
      <Box className="flex flex-col gap-2">
        <Typography variant="h5" component="h1">
          {phase === "revoked" ? t("document-share-revoked-title") : t("document-share-invalid-title")}
        </Typography>
        <Typography variant="body2" className="text-text-secondary leading-6">
          {phase === "revoked" ? t("document-share-revoked-body") : t("document-share-invalid-body")}
        </Typography>
      </Box>
    );
  }

  // `ready` is only ever set together with a document, but proving it here
  // keeps the download button's href non-optional.
  if (!doc) return null;
  // Never print the raw slug to a patient: an unknown kind reads as "documento".
  const labelKey = documentKindLabelKey(doc.kind);
  const kindLabel = labelKey ? t(labelKey) : t("document-share-generic-kind");

  return (
    <Box className="flex flex-col gap-4">
      <Box className="flex flex-col gap-1">
        <Typography variant="h5" component="h1" className="mb-0">
          {kindLabel}
        </Typography>
        {doc.organizationName && (
          <Typography variant="body2" className="text-text-secondary leading-6">
            {t("document-share-issuer", { practice: doc.organizationName })}
          </Typography>
        )}
      </Box>

      <Alert severity="success" icon={<NiCheckSquare />} className="neutral bg-background-paper/60!">
        {t("document-share-ready")}
      </Alert>

      <Button
        variant="contained"
        color="primary"
        size="large"
        fullWidth
        startIcon={<NiDownloadCloud size="tiny" />}
        href={doc.downloadUrl}
        // The signed URL is short-lived; opening it in a new tab keeps this
        // page (and the retry it offers) available if the download stalls.
        target="_blank"
        rel="noopener noreferrer"
      >
        {t("document-share-download")}
      </Button>

      {doc.verifyCode && (
        <Typography variant="body2" className="text-text-secondary text-xs leading-5">
          {t("document-share-verify", { code: doc.verifyCode })}
        </Typography>
      )}
      <Typography variant="body2" className="text-text-secondary text-xs leading-5">
        {t("document-share-privacy")}
      </Typography>
    </Box>
  );
}
