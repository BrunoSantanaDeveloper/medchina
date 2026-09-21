"use client";

import OrgsAdmin from "./components/orgs-admin";
import UsersAdmin from "./components/users-admin";
import Link from "next/link";
import { useEffect, useState } from "react";

import { Alert, Box, Breadcrumbs, Card, CardContent, Grid, Tab, Tabs, Typography } from "@mui/material";

import { isSupabaseConfigured } from "@flyee/auth";
import { createClient } from "@flyee/auth/client";

/**
 * Superadmin tenants console. RLS is the real gate (non-superadmins get
 * empty reads and rejected writes); the client-side check only improves UX.
 */
export default function AdminOrganizations() {
  const [tab, setTab] = useState(0);
  const [seen, setSeen] = useState<Set<number>>(() => new Set([0]));
  const [allowed, setAllowed] = useState<boolean | null>(null);

  useEffect(() => {
    const check = async () => {
      if (!isSupabaseConfigured) {
        setAllowed(false);
        return;
      }
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setAllowed(false);
        return;
      }
      const { data } = await supabase.from("profiles").select("is_superadmin").eq("id", user.id).maybeSingle();
      setAllowed(Boolean(data?.is_superadmin));
    };
    check();
  }, []);

  return (
    <Grid container spacing={5}>
      <Grid size={12}>
        <Typography variant="h1" component="h1" className="mb-0">
          Contas e profissionais
        </Typography>
        <Breadcrumbs>
          <Link color="inherit" href="/inicio">
            Início
          </Link>
          <Typography variant="body2">Admin</Typography>
          <Typography variant="body2">Contas</Typography>
        </Breadcrumbs>
      </Grid>

      {allowed === false && (
        <Grid size={12}>
          <Alert severity="error" className="neutral bg-background-paper/60!">
            Esta área é restrita aos superadmins da plataforma.
          </Alert>
        </Grid>
      )}

      {allowed && (
        <Grid size={12}>
          <Card component="section">
            <CardContent>
              <Tabs
                value={tab}
                onChange={(_, value: number) => {
                  setTab(value);
                  setSeen((current) => (current.has(value) ? current : new Set(current).add(value)));
                }}
                className="mb-6"
              >
                <Tab label="Contas" />
                <Tab label="Profissionais" />
              </Tabs>
              {/* Mounted on first visit and kept mounted after it. Unmounting
                  re-ran the RPC and threw away the filter, the search, the
                  page and the member cache every time the operator looked at
                  the other tab — and she moves between them inside a single
                  support call. `seen` keeps the second panel from loading
                  before it is asked for. */}
              <Box hidden={tab !== 0}>{seen.has(0) && <OrgsAdmin />}</Box>
              <Box hidden={tab !== 1}>{seen.has(1) && <UsersAdmin />}</Box>
            </CardContent>
          </Card>
        </Grid>
      )}
    </Grid>
  );
}
