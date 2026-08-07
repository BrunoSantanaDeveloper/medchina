"use client";

import SettingsMenu from "../components/settings-menu";
import OrgGeneral from "./components/org-general";
import { useOrganization } from "./components/use-organization";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Alert, Box, Breadcrumbs, Button, Drawer, Grid, Tooltip, Typography } from "@mui/material";

import AccountExportCard from "@/components/product/account-export-card";
import NiListCircle from "@/icons/nexture/ni-list-circle";

/** MVP account model: exactly one practice workspace per professional. */
export default function OrganizationSettings() {
  const t = useTranslations("product");
  const [openDrawer, setOpenDrawer] = useState(false);
  const { configured, loading, currentOrg, refreshOrgs } = useOrganization();

  return (
    <Grid container spacing={5} className="items-start">
      <Grid size="auto" className="hidden pr-8 lg:flex">
        <SettingsMenu active="organization" />
      </Grid>
      <Grid size="grow" spacing={5} container>
        <Grid size={12} spacing={2.5} container>
          <Grid size={{ xs: 12, md: "grow" }}>
            <Typography variant="h1" component="h1" className="mb-0">
              {t("settings-practice-title")}
            </Typography>
            <Breadcrumbs>
              <Link color="inherit" href="/inicio">
                {t("settings-home")}
              </Link>
              <Link color="inherit" href="/settings">
                {t("settings-title")}
              </Link>
              <Typography variant="body2">{t("settings-practice")}</Typography>
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
        {currentOrg && <OrgGeneral org={currentOrg} onUpdated={refreshOrgs} />}

        {/* Portability lives with the practice, not with billing: leaving is
            not a billing action (PRD §9.10). */}
        {currentOrg && (
          <Grid size={12}>
            <AccountExportCard />
          </Grid>
        )}

        <Drawer open={openDrawer} anchor="right" onClose={() => setOpenDrawer(false)}>
          <Box className="min-w-80 p-7">
            <SettingsMenu active="organization" />
          </Box>
        </Drawer>
      </Grid>
    </Grid>
  );
}
