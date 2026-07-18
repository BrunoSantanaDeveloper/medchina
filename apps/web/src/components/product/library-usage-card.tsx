"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";

import { Alert, Box, Card, CardContent, LinearProgress, Typography } from "@mui/material";

import { useCurrentOrg } from "@/hooks/use-current-org";
import NiBook from "@/icons/nexture/ni-book";
import { LIBRARY_ASSISTANT_SLUG } from "@/lib/clinical-library";
import { isSupabaseConfigured } from "@flyee/auth";
import { createClient } from "@flyee/auth/client";

type MessageAllowance = { allowed?: boolean; unlimited?: boolean; used?: number; limit?: number };

/**
 * The clinical library's monthly message quota: what is left, and what happens
 * when it runs out — the same single-question card as AudioUsageCard, for the
 * product's other currency (PRD §5.8 pattern; quota from migration 0042).
 *
 * Lives on the billing page, where "how much of my plan have I used?" is the
 * question the page exists to answer. Amber near the limit, never red — a
 * commercial limit is not clinical risk (docs/DESIGN.md).
 */
export default function LibraryUsageCard() {
  const t = useTranslations("product");
  const { orgId } = useCurrentOrg();
  const [allowance, setAllowance] = useState<MessageAllowance | null>(null);

  const load = useCallback(async () => {
    if (!isSupabaseConfigured || !orgId) return;
    const supabase = createClient();
    const { data } = await supabase.rpc("org_message_allowance", {
      target_org: orgId,
      target_assistant: LIBRARY_ASSISTANT_SLUG,
    });
    if (data) setAllowance(data as MessageAllowance);
  }, [orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!allowance) return null;

  const unlimited = allowance.unlimited === true;
  // No subscription / suspended: the page's subscription card is the answer.
  if (!unlimited && allowance.allowed === false && (allowance.limit ?? 0) === 0) return null;

  const used = allowance.used ?? 0;
  const limit = allowance.limit ?? 0;
  const remaining = Math.max(limit - used, 0);
  const percent = limit > 0 ? Math.floor((used * 100) / limit) : 0;
  const nearLimit = !unlimited && percent >= 80;

  return (
    <Card component="section">
      <CardContent className="flex flex-col gap-3">
        <Box className="flex flex-row items-center gap-2">
          <NiBook size="medium" className="text-primary" />
          <Typography variant="h6" component="h2">
            {t("library-usage-title")}
          </Typography>
        </Box>

        {unlimited ? (
          <Typography variant="body2" className="text-text-secondary leading-6">
            {t("library-usage-unlimited")}
          </Typography>
        ) : (
          <>
            <Box className="flex flex-row items-baseline gap-2">
              <Typography variant="h3" component="p" className="text-text-primary mb-0 tabular-nums">
                {remaining}
              </Typography>
              <Typography variant="body2" className="text-text-secondary">
                {t("library-usage-remaining-of", { limit })}
              </Typography>
            </Box>

            <LinearProgress
              variant="determinate"
              value={Math.min(percent, 100)}
              color={nearLimit ? "warning" : "primary"}
              aria-label={t("library-usage-title")}
            />

            {percent >= 100 ? (
              <Alert severity="warning" className="neutral bg-background-paper/60!">
                {t("library-usage-limit-over")}
              </Alert>
            ) : nearLimit ? (
              <Alert severity="warning" className="neutral bg-background-paper/60!">
                {t("library-usage-near-limit", { percent })}
              </Alert>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
