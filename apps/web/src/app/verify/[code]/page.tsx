import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { Alert, Box, Card, CardContent, Divider, Typography } from "@mui/material";

import { BRAND } from "@/brand";
import Logo from "@/components/logo/logo";
import NiCheckSquare from "@/icons/nexture/ni-check-square";
import { documentKindLabelKey } from "@/lib/document-kinds";
import { isSupabaseConfigured } from "@flyee/auth";
import { createClient } from "@flyee/auth/server";

type VerifyRow = {
  kind: string;
  status: string;
  version: number;
  issued_at: string | null;
  content_hash: string | null;
  organization_name: string;
  superseded: boolean;
};

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("product");
  return {
    title: t("verify-meta-title"),
    description: t("verify-meta-description"),
    // A verification code is a bearer reference to a health document. It is
    // never indexed, never archived, never leaked through a referrer.
    robots: { index: false, follow: false, noarchive: true, nosnippet: true },
    referrer: "no-referrer",
  };
}

/**
 * Public QR target: the authenticity check a PATIENT (or their employer,
 * insurer, another professional) opens after scanning the code printed on a
 * document the practitioner issued.
 *
 * Two rules shape it. It is the only public touchpoint of the practice, so it
 * carries her clinic's name and the product's identity rather than reading
 * like a raw system dump. And it is PHI-thin by construction: the RPC returns
 * no title and no patient (migration 0059) — the answer here is "yes, this
 * document is authentic, issued by X on date Y", nothing about the person or
 * their treatment.
 */
export default async function VerifyDocument({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const t = await getTranslations("product");

  let row: VerifyRow | null = null;
  let lookupFailed = false;
  if (isSupabaseConfigured) {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("verify_document", { code });
    // A failed lookup is NOT the same as "no such document": telling a patient
    // their valid document does not exist because the database blinked would
    // be the worst possible answer here.
    if (error) lookupFailed = true;
    else row = (data?.[0] as VerifyRow | undefined) ?? null;
  }

  // A raw slug means nothing to whoever scanned the QR — an unknown kind falls
  // back to the neutral word rather than leaking an internal identifier.
  const kindLabelKey = documentKindLabelKey(row?.kind);
  const kindLabel = kindLabelKey ? t(kindLabelKey) : t("document-share-generic-kind");
  const issuedAt = row?.issued_at
    ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "long", timeStyle: "short" }).format(new Date(row.issued_at))
    : null;

  return (
    <Box component="main" className="flex min-h-screen flex-col items-center px-4 py-5 sm:py-10">
      <Box className="flex w-full max-w-xl flex-1 flex-col gap-5">
        <Box component="header" className="flex justify-center py-2">
          <Logo classNameFull="h-9 w-auto" classNameMobile="hidden" />
        </Box>

        <Card className="w-full">
          <CardContent className="flex flex-col gap-4 p-5! sm:p-7!">
            <Typography variant="h4" component="h1" className="mb-0">
              {t("verify-title")}
            </Typography>

            {(!isSupabaseConfigured || lookupFailed) && (
              <Alert severity="info" className="neutral bg-background-paper/60!">
                {t("verify-unavailable")}
              </Alert>
            )}

            {isSupabaseConfigured && !lookupFailed && !row && (
              <Alert severity="warning" className="neutral bg-background-paper/60!">
                {t("verify-not-found")}
              </Alert>
            )}

            {row && (
              <>
                <Alert
                  severity={row.status === "issued" ? "success" : "warning"}
                  icon={row.status === "issued" ? <NiCheckSquare /> : undefined}
                  className="neutral bg-background-paper/60!"
                >
                  {row.status === "issued"
                    ? t("verify-authentic")
                    : row.superseded
                      ? t("verify-superseded")
                      : t("verify-revoked")}
                </Alert>
                <Divider />
                <Box className="flex flex-col gap-1">
                  <Typography variant="body1">
                    <strong>{t("verify-issuer")}:</strong> {row.organization_name}
                  </Typography>
                  <Typography variant="body1">
                    <strong>{t("verify-kind")}:</strong> {kindLabel} · <strong>{t("verify-version")}:</strong>{" "}
                    {row.version}
                  </Typography>
                  {issuedAt && (
                    <Typography variant="body1">
                      <strong>{t("verify-issued-at")}:</strong> {issuedAt}
                    </Typography>
                  )}
                  <Typography variant="body1">
                    <strong>{t("verify-code")}:</strong> {code}
                  </Typography>
                </Box>
                <Typography variant="body2" className="text-text-secondary leading-6">
                  {t("verify-privacy-note")}
                </Typography>
                {row.content_hash && (
                  <Typography variant="caption" className="text-text-secondary break-all">
                    {t("verify-hash")}: {row.content_hash}
                  </Typography>
                )}
              </>
            )}
          </CardContent>
        </Card>

        <Typography component="footer" variant="caption" className="text-text-primary px-2 text-center">
          {t("verify-footer", { brand: BRAND.name })}
        </Typography>
      </Box>
    </Box>
  );
}
