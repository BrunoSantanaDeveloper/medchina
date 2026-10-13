"use client";

import { useTranslations } from "next-intl";

import { Box, Typography } from "@mui/material";

import { credentialLines } from "@/lib/professional-credentials";

/**
 * The signature block of an issued document, as it will print — shown while
 * she types the two things that go under her name.
 *
 * "Titulação" and "registro" are abstract until she sees them on paper; the
 * preparation asks for them precisely so the first atestado does not go out
 * signed by a name alone. The lines come from `credentialLines`, the SAME
 * function the three PDF renderers use (attendance, plan, prescription), so
 * this cannot drift from what is actually printed: an empty title falls back to
 * the generic "Profissional responsável", an empty registration prints no line.
 *
 * It is a preview of the BLOCK, not of a document: no patient, no body, no QR.
 * Drawing those would be a mock of a record that does not exist.
 *
 * Closest template shape: none — the catalog has no document fragment. It is
 * built in the template's language (grey-100 hairline, rounded-2xl, the type
 * scale) and stays deliberately quiet: paper, a rule, a name.
 */
export default function SignaturePreview({
  name,
  title,
  registration,
  practiceName,
}: {
  /** Her display name — what the documents sign with. */
  name: string;
  title?: string | null;
  registration?: string | null;
  /** Printed at the top of every document. */
  practiceName?: string | null;
}) {
  const t = useTranslations("product");
  const lines = credentialLines(
    { title, registration },
    {
      fallbackTitle: t("plan-doc-professional"),
      registration: (value) => `${t("doc-registration")} ${value}`,
    },
  );

  return (
    <Box
      component="figure"
      className="border-grey-100 bg-background-paper m-0 flex flex-col gap-4 rounded-2xl border p-4"
      aria-label={t("signature-preview-label")}
    >
      <Typography variant="body2" component="figcaption" className="text-text-secondary">
        {t("signature-preview-label")}
      </Typography>
      {practiceName?.trim() && (
        <Typography variant="subtitle2" component="p" className="text-text-primary mb-0">
          {practiceName.trim()}
        </Typography>
      )}
      <Box className="flex flex-col items-center gap-0.5 pt-6 text-center">
        <Box className="border-text-secondary w-full max-w-64 border-t pt-1.5">
          <Typography variant="subtitle2" component="p" className="text-text-primary mb-0 break-words">
            {name.trim() || t("signature-preview-name-missing")}
          </Typography>
          {lines.map((line) => (
            <Typography key={line} variant="body2" className="text-text-secondary break-words">
              {line}
            </Typography>
          ))}
        </Box>
      </Box>
    </Box>
  );
}
