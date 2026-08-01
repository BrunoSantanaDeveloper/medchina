"use client";

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { Box, Card, CardContent, Chip, Grid, Typography } from "@mui/material";

import { describeAgent } from "@/app/(dashboard)/admin/audit/components/access-events-admin";
import { createClient } from "@flyee/auth/client";

type AccessRow = {
  id: string;
  ip: string | null;
  userAgent: string | null;
  aal: string | null;
  createdAt: string;
  /** Set when platform support opened this session on her account (0057). */
  impersonatedBy: string | null;
};

export default function RecentActivityCard() {
  const t = useTranslations("product");
  const locale = useLocale();
  const [rows, setRows] = useState<AccessRow[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    createClient()
      .from("access_events")
      .select("id, ip, user_agent, aal, created_at, impersonated_by")
      .order("created_at", { ascending: false })
      .limit(20)
      .then(({ data }) => {
        if (!active) return;
        setRows(
          (data ?? []).map((row) => ({
            id: row.id,
            ip: row.ip,
            userAgent: row.user_agent,
            aal: row.aal,
            createdAt: row.created_at,
            impersonatedBy: row.impersonated_by ?? null,
          })),
        );
        setLoaded(true);
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <Grid size={12}>
      <Card component="section">
        <CardContent className="flex flex-col gap-4">
          <Typography variant="h5" component="h2" className="card-title">
            {t("security-recent-title")}
          </Typography>
          <Typography variant="body1" className="text-text-secondary">
            {t("security-recent-body")}
          </Typography>
          {loaded && !rows.length && (
            <Typography variant="body2" className="text-text-secondary">
              {t("security-recent-empty")}
            </Typography>
          )}
          {rows.map((row) => (
            <Box key={row.id} className="flex items-center gap-2">
              <Box className="flex-1">
                <Typography variant="body1">
                  {describeAgent(row.userAgent) ?? t("security-unknown-device")}
                  {row.ip ? ` · ${row.ip}` : ""}
                </Typography>
                <Typography variant="body2" className="text-text-secondary">
                  {new Date(row.createdAt).toLocaleString(locale)}
                </Typography>
              </Box>
              {/*
                A support access is labelled as such. Without this it would
                read as an unexplained sign-in from an unknown device — the
                access is legitimate, so it must look legitimate.
              */}
              <Chip
                label={
                  row.impersonatedBy
                    ? t("security-support-access")
                    : row.aal === "aal2"
                      ? t("security-2fa")
                      : t("security-password")
                }
                size="small"
                color={row.impersonatedBy ? "secondary" : row.aal === "aal2" ? "success" : "default"}
                variant="outlined"
              />
            </Box>
          ))}
        </CardContent>
      </Card>
    </Grid>
  );
}
