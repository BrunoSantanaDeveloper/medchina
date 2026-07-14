"use client";

import SettingsMenu from "../components/settings-menu";
import { useOrganization } from "../organization/components/use-organization";
import ConnectionsCard from "./components/connections-card";
import Link from "next/link";
import { useState } from "react";

import {
  Alert,
  Box,
  Breadcrumbs,
  Button,
  Drawer,
  FormControl,
  Grid,
  MenuItem,
  Select,
  Tooltip,
  Typography,
} from "@mui/material";

import NiChevronDownSmall from "@/icons/nexture/ni-chevron-down-small";
import NiListCircle from "@/icons/nexture/ni-list-circle";

export default function ConnectionsSettings() {
  const [openDrawer, setOpenDrawer] = useState(false);
  const { configured, loading, orgs, currentOrg, setCurrentOrgId } = useOrganization();

  const toggleDrawer = (newOpen: boolean) => () => {
    setOpenDrawer(newOpen);
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
              Connections
            </Typography>
            <Breadcrumbs>
              <Link color="inherit" href="/inicio">
                Home
              </Link>
              <Link color="inherit" href="/settings">
                Settings
              </Link>
              <Typography variant="body2">Connections</Typography>
            </Breadcrumbs>
          </Grid>
          {orgs.length > 1 && currentOrg && (
            <Grid size={{ xs: 12, md: "auto" }}>
              <FormControl className="outlined w-56" variant="standard" size="small">
                <Select
                  value={currentOrg.id}
                  size="small"
                  variant="standard"
                  IconComponent={NiChevronDownSmall}
                  onChange={(e) => setCurrentOrgId(e.target.value)}
                >
                  {orgs.map((org) => (
                    <MenuItem key={org.id} value={org.id}>
                      {org.name}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
          )}
          <Grid size={{ xs: 12, md: "auto" }} className="lg:hidden">
            <Tooltip title="Table of Contents">
              <Button
                className="icon-only surface-standard"
                color="grey"
                variant="surface"
                onClick={toggleDrawer(true)}
              >
                <NiListCircle size={"medium"} />
              </Button>
            </Tooltip>
          </Grid>
        </Grid>

        {!configured && (
          <Grid size={12}>
            <Alert severity="info" className="neutral bg-background-paper/60!">
              Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to enable
              connections.
            </Alert>
          </Grid>
        )}

        {configured && !loading && orgs.length === 0 && (
          <Grid size={12}>
            <Alert severity="info" className="neutral bg-background-paper/60!">
              You do not belong to any organization yet. Create one in Settings &gt; Organization first.
            </Alert>
          </Grid>
        )}

        {currentOrg && <ConnectionsCard orgId={currentOrg.id} />}

        <Drawer open={openDrawer} anchor="right" onClose={toggleDrawer(false)}>
          <Box className="min-w-80 p-7">
            <SettingsMenu active="connections" />
          </Box>
        </Drawer>
      </Grid>
    </Grid>
  );
}
