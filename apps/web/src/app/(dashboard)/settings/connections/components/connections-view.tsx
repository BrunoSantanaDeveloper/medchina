"use client";

import SettingsMenu from "../../components/settings-menu";
import { revokeConnection } from "../actions";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useState, useTransition } from "react";

import {
  Alert,
  Box,
  Breadcrumbs,
  Button,
  Card,
  CardContent,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Drawer,
  Grid,
  Tooltip,
  Typography,
} from "@mui/material";

import EmptyState from "@/components/product/empty-state";
import IllustrationIntegrate from "@/icons/illustrations/illustration-integrate";
import NiListCircle from "@/icons/nexture/ni-list-circle";
import NiPlug from "@/icons/nexture/ni-plug";
import { SCOPE_LABEL_KEYS } from "@/lib/oauth/scopes";

export type ConnectionSummary = {
  /** oauth_clients row id — what the revoke action targets. */
  clientRowId: string;
  clientName: string;
  scopes: string[];
  connectedAt: string;
  lastUsedAt: string | null;
};

/**
 * The professional's control panel over external assistants: what is
 * connected, when it was last used, and an immediate way out. The how-to
 * card doubles as the empty state's path to value — connecting happens in
 * the ASSISTANT's app, so the one action we can give her is the URL.
 */
export default function ConnectionsView({
  configured,
  connections,
  mcpUrl,
}: {
  configured: boolean;
  connections: ConnectionSummary[];
  mcpUrl: string;
}) {
  const t = useTranslations("product");
  const locale = useLocale();
  const [openDrawer, setOpenDrawer] = useState(false);
  const [confirming, setConfirming] = useState<ConnectionSummary | null>(null);
  const [feedback, setFeedback] = useState<"revoked" | "revoke-failed" | "copied" | null>(null);
  const [pending, startTransition] = useTransition();

  const toggleDrawer = (newOpen: boolean) => () => setOpenDrawer(newOpen);

  const formatDate = (value: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: "long", timeStyle: "short" }).format(new Date(value));

  const copyUrl = async () => {
    try {
      await navigator.clipboard.writeText(mcpUrl);
      setFeedback("copied");
    } catch {
      // Clipboard denied: the URL stays selectable right above the button.
    }
  };

  const confirmRevoke = () => {
    if (!confirming) return;
    const target = confirming;
    startTransition(async () => {
      const result = await revokeConnection(target.clientRowId);
      setConfirming(null);
      setFeedback(result.ok ? "revoked" : "revoke-failed");
      if (result.ok) window.location.reload();
    });
  };

  return (
    <Grid container spacing={5} className="items-start">
      <Grid size={"auto"} className="hidden pr-8 lg:flex">
        <SettingsMenu active="connections" />
      </Grid>
      <Grid size={"grow"} spacing={5} container>
        <Grid size={12} spacing={2.5} container>
          <Grid size={{ xs: 12, md: "grow" }}>
            <Typography variant="h1" component="h1" className="mb-0">
              {t("settings-connections-title")}
            </Typography>
            <Breadcrumbs>
              <Link color="inherit" href="/inicio">
                {t("settings-home")}
              </Link>
              <Link color="inherit" href="/settings">
                {t("settings-title")}
              </Link>
              <Typography variant="body2">{t("settings-connections")}</Typography>
            </Breadcrumbs>
          </Grid>
          <Grid size={{ xs: 12, md: "auto" }} className="lg:hidden">
            <Tooltip title={t("settings-open-menu")}>
              <Button
                className="icon-only surface-standard"
                color="grey"
                variant="surface"
                onClick={toggleDrawer(true)}
                aria-label={t("settings-open-menu")}
              >
                <NiListCircle size={"medium"} />
              </Button>
            </Tooltip>
          </Grid>
        </Grid>

        {!configured && (
          <Grid size={12}>
            <Alert severity="info" className="neutral bg-background-paper/60!">
              {t("settings-unavailable")}
            </Alert>
          </Grid>
        )}

        {configured && (
          <>
            <Grid size={12}>
              <Typography variant="body1" className="text-text-secondary">
                {t("settings-connections-subtitle")}
              </Typography>
            </Grid>

            {feedback === "revoked" && (
              <Grid size={12}>
                <Alert severity="success" className="neutral bg-background-paper/60!" onClose={() => setFeedback(null)}>
                  {t("connections-revoked-success")}
                </Alert>
              </Grid>
            )}
            {feedback === "revoke-failed" && (
              <Grid size={12}>
                <Alert severity="error" className="neutral bg-background-paper/60!" onClose={() => setFeedback(null)}>
                  {t("connections-revoke-failed")}
                </Alert>
              </Grid>
            )}

            <Grid size={12}>
              <Card component="section">
                <CardContent className="flex flex-col gap-3">
                  <Box className="flex flex-row items-center gap-2">
                    <NiPlug size="medium" className="text-primary" />
                    <Typography variant="h6" component="h2">
                      {t("connections-how-title")}
                    </Typography>
                  </Box>
                  <Typography variant="body2" className="text-text-secondary leading-6">
                    {t("connections-how-body")}
                  </Typography>
                  <Box className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <Box className="border-grey-100 bg-background-default/60 grow rounded-lg border px-3 py-2">
                      <Typography variant="caption" component="p" className="text-text-secondary mb-0">
                        {t("connections-mcp-url-label")}
                      </Typography>
                      <Typography variant="body2" className="text-text-primary font-mono break-all select-all">
                        {mcpUrl}
                      </Typography>
                    </Box>
                    <Button variant="outlined" onClick={copyUrl} className="shrink-0">
                      {feedback === "copied" ? t("connections-copied") : t("connections-copy-url")}
                    </Button>
                  </Box>
                  <Typography variant="caption" className="text-text-secondary">
                    {t("connections-plan-note")}
                  </Typography>
                </CardContent>
              </Card>
            </Grid>

            <Grid size={12}>
              {connections.length === 0 ? (
                // A band across the page under the card that explains the
                // connection: the drawing beside the words.
                <EmptyState
                  illustration={<IllustrationIntegrate />}
                  layout="row"
                  title={t("connections-empty-title")}
                  description={t("connections-empty-body")}
                />
              ) : (
                <Box className="flex flex-col gap-4">
                  {connections.map((connection) => (
                    <Card component="section" key={connection.clientRowId}>
                      <CardContent className="flex flex-col gap-3">
                        <Box className="flex flex-row flex-wrap items-center justify-between gap-2">
                          <Box className="flex flex-row items-center gap-2">
                            <NiPlug size="medium" className="text-primary" />
                            <Typography variant="h6" component="h2" className="mb-0">
                              {connection.clientName}
                            </Typography>
                          </Box>
                          <Button color="error" variant="outlined" onClick={() => setConfirming(connection)}>
                            {t("connections-revoke")}
                          </Button>
                        </Box>
                        <Typography variant="body2" className="text-text-secondary">
                          {t("connections-connected-at", { date: formatDate(connection.connectedAt) })}
                          {" · "}
                          {connection.lastUsedAt
                            ? t("connections-last-used", { date: formatDate(connection.lastUsedAt) })
                            : t("connections-never-used")}
                        </Typography>
                        <Box className="flex flex-row flex-wrap items-center gap-1.5">
                          <Typography variant="caption" className="text-text-secondary">
                            {t("connections-scopes-label")}:
                          </Typography>
                          {connection.scopes.map((scope) => (
                            <Chip
                              key={scope}
                              size="small"
                              variant="outlined"
                              label={
                                scope in SCOPE_LABEL_KEYS
                                  ? t(SCOPE_LABEL_KEYS[scope as keyof typeof SCOPE_LABEL_KEYS])
                                  : scope
                              }
                            />
                          ))}
                        </Box>
                      </CardContent>
                    </Card>
                  ))}
                </Box>
              )}
            </Grid>
          </>
        )}

        <Dialog open={confirming !== null} onClose={() => (pending ? null : setConfirming(null))}>
          <DialogTitle>{t("connections-revoke-confirm-title")}</DialogTitle>
          <DialogContent>
            <DialogContentText>
              {t("connections-revoke-confirm-body", { client: confirming?.clientName ?? "" })}
            </DialogContentText>
          </DialogContent>
          <DialogActions>
            <Button color="grey" variant="text" onClick={() => setConfirming(null)} disabled={pending}>
              {t("connections-revoke-cancel")}
            </Button>
            <Button color="error" variant="contained" onClick={confirmRevoke} disabled={pending}>
              {t("connections-revoke")}
            </Button>
          </DialogActions>
        </Dialog>

        <Drawer open={openDrawer} anchor="right" onClose={toggleDrawer(false)}>
          <Box className="min-w-80 p-7">
            <SettingsMenu active="connections" />
          </Box>
        </Drawer>
      </Grid>
    </Grid>
  );
}
