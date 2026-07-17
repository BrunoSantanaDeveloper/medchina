"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { Alert, Box, Button, CircularProgress, Paper, Typography } from "@mui/material";

import { DEFAULTS } from "@/config";
import { recordAudit } from "@/lib/audit";
import { isSupabaseConfigured } from "@flyee/auth";
import { createClient } from "@flyee/auth/client";

type Status = "loading" | "confirm" | "accepting" | "accepted" | "error";

type InvitePreview = {
  organization_name: string;
  invited_by_name: string | null;
  invite_role: string;
  expires_at: string;
  available: boolean;
};

/** An invite changes account access, so it is previewed and explicitly confirmed. */
export default function InvitePage() {
  const { token } = useParams<{ token: string }>();
  const t = useTranslations("auth");
  const [status, setStatus] = useState<Status>("loading");
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [workspaceConflict, setWorkspaceConflict] = useState(false);

  useEffect(() => {
    let active = true;
    const load = async () => {
      if (!isSupabaseConfigured) {
        if (active) setStatus("error");
        return;
      }
      const { data, error } = await createClient().rpc("preview_invite", { invite_token: token }).maybeSingle();
      if (!active) return;
      const row = data as InvitePreview | null;
      if (error || !row?.available) {
        setStatus("error");
        return;
      }
      setPreview(row);
      setStatus("confirm");
    };
    load();
    return () => {
      active = false;
    };
  }, [token]);

  const accept = async () => {
    if (status !== "confirm") return;
    setStatus("accepting");
    const supabase = createClient();
    const { data, error } = await supabase.rpc("accept_invite", { invite_token: token });
    setWorkspaceConflict(Boolean(error?.message.includes("invite_workspace_conflict")));
    if (!error && data) {
      await recordAudit(supabase, "invite.accepted", {
        orgId: data,
        entityType: "organization",
        entityId: data,
      });
    }
    setStatus(error ? "error" : "accepted");
  };

  return (
    <Box className="flex min-h-[60vh] w-full items-center justify-center p-4">
      <Paper
        elevation={3}
        className="bg-background-paper shadow-darker-xs w-[32rem] max-w-full rounded-4xl p-10 sm:p-14"
      >
        <Box className="flex flex-col items-center gap-6 text-center">
          {(status === "loading" || status === "accepting") && (
            <>
              <CircularProgress size={32} />
              <Typography variant="h5" component="h1">
                {t(status === "accepting" ? "invite-accepting" : "invite-loading")}
              </Typography>
            </>
          )}

          {status === "confirm" && preview && (
            <>
              <Typography variant="h4" component="h1">
                {t("invite-title")}
              </Typography>
              <Typography variant="body1" className="text-text-secondary">
                {t("invite-body", {
                  organization: preview.organization_name,
                  inviter: preview.invited_by_name ?? t("invite-someone"),
                })}
              </Typography>
              <Alert severity="info" className="neutral bg-background-paper/60! w-full text-left">
                {t("invite-confirmation")}
              </Alert>
              <Box className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button variant="outlined" color="grey" LinkComponent={Link} href={DEFAULTS.appRoot}>
                  {t("invite-decline")}
                </Button>
                <Button variant="contained" onClick={accept}>
                  {t("invite-accept")}
                </Button>
              </Box>
            </>
          )}

          {status === "accepted" && (
            <>
              <Typography variant="h4" component="h1">
                {t("invite-accepted-title")}
              </Typography>
              <Typography variant="body1" className="text-text-secondary">
                {t("invite-accepted-body", { organization: preview?.organization_name ?? "" })}
              </Typography>
              <Button variant="contained" LinkComponent={Link} href={DEFAULTS.appRoot}>
                {t("invite-go-home")}
              </Button>
            </>
          )}

          {status === "error" && (
            <>
              <Typography variant="h4" component="h1">
                {t("invite-error-title")}
              </Typography>
              <Alert severity="error" className="neutral bg-background-paper/60! w-full">
                {t(workspaceConflict ? "invite-workspace-conflict" : "invite-error-body")}
              </Alert>
              <Button variant="outlined" color="grey" LinkComponent={Link} href={DEFAULTS.appRoot}>
                {t("invite-go-home")}
              </Button>
            </>
          )}
        </Box>
      </Paper>
    </Box>
  );
}
