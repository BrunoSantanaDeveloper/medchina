"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Alert, Box, Breadcrumbs, Button, Drawer, Grid, Tooltip, Typography } from "@mui/material";

import SettingsMenu from "@/app/(dashboard)/settings/components/settings-menu";
import AudioPreferences from "@/app/(dashboard)/settings/organization/components/audio-preferences";
import { useOrganization } from "@/app/(dashboard)/settings/organization/components/use-organization";
import NiListCircle from "@/icons/nexture/ni-list-circle";

export default function ClinicalPreferencesSettings() {
  const t = useTranslations("product");
  const [openDrawer, setOpenDrawer] = useState(false);
  const { configured, loading, currentOrg, refreshOrgs } = useOrganization();

  return (
    <Grid container spacing={5} className="items-start">
      <Grid size="auto" className="hidden pr-8 lg:flex">
        <SettingsMenu active="preferences" />
      </Grid>
      <Grid size="grow" spacing={5} container>
        <Grid size={12} spacing={2.5} container>
          <Grid size={{ xs: 12, md: "grow" }}>
            <Typography variant="h1" component="h1" className="mb-0">
              {t("settings-preferences-title")}
            </Typography>
            <Breadcrumbs>
              <Link color="inherit" href="/inicio">
                {t("settings-home")}
              </Link>
              <Link color="inherit" href="/settings">
                {t("settings-title")}
              </Link>
              <Typography variant="body2">{t("settings-preferences")}</Typography>
            </Breadcrumbs>
          </Grid>
          <Grid size={{ xs: 12, md: "auto" }} className="lg:hidden">
            <Tooltip title={t("settings-open-menu")}>
              <Button
                aria-label={t("settings-open-menu")}
                className="icon-only surface-standard"
                color="grey"
                variant="surface"
                onClick={() => setOpenDrawer(true)}
              >
                <NiListCircle size="medium" />
              </Button>
            </Tooltip>
          </Grid>
        </Grid>

        {!configured && (
          <Grid size={12}>
            <Alert severity="info">{t("settings-unavailable")}</Alert>
          </Grid>
        )}
        {configured && !loading && !currentOrg && (
          <Grid size={12}>
            <Alert severity="info">{t("settings-practice-missing")}</Alert>
          </Grid>
        )}
        {currentOrg && (
          <Grid size={12}>
            <AudioPreferences org={currentOrg} onUpdated={refreshOrgs} />
          </Grid>
        )}

        <Drawer open={openDrawer} anchor="right" onClose={() => setOpenDrawer(false)}>
          <Box className="min-w-80 p-7">
            <SettingsMenu active="preferences" />
          </Box>
        </Drawer>
      </Grid>
    </Grid>
  );
}
