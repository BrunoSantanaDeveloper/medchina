"use client";

import { getLeadsConsoleStatus } from "./actions";
import EventsAdmin from "./components/events-admin";
import LeadsAdmin from "./components/leads-admin";
import Link from "next/link";
import { useEffect, useState } from "react";

import { Alert, Breadcrumbs, Card, CardContent, Grid, Tab, Tabs, Typography } from "@mui/material";

import { isSupabaseConfigured } from "@flyee/auth";
import { createClient } from "@flyee/auth/client";

type TabKey = "eventos" | "leads";

/**
 * Leads and live events (docs/PAGINA-EVENTO.md §7) — the platform's contacts
 * WITHOUT an account (FUNIL T2.0) and the events that bring them in.
 *
 * Superadmin only: the admin layout gates the route server-side, RLS is the
 * real fence (every table in migration 0112 is superadmin-only), and this
 * client check only spares a non-admin an empty screen.
 */
export default function AdminLeads() {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [tab, setTab] = useState<TabKey>("eventos");
  const [status, setStatus] = useState<{ emailConfigured: boolean; queueConfigured: boolean } | null>(null);

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
      const isAdmin = Boolean(data?.is_superadmin);
      setAllowed(isAdmin);
      if (isAdmin) setStatus(await getLeadsConsoleStatus());
    };
    check();
  }, []);

  return (
    <Grid container spacing={5}>
      <Grid size={12}>
        <Typography variant="h1" component="h1" className="mb-0">
          Leads e eventos
        </Typography>
        <Breadcrumbs>
          <Link color="inherit" href="/inicio">
            Início
          </Link>
          <Typography variant="body2">Admin</Typography>
          <Typography variant="body2">Leads e eventos</Typography>
        </Breadcrumbs>
      </Grid>

      {allowed === false && (
        <Grid size={12}>
          <Alert severity="error" className="neutral bg-background-paper/60!">
            Esta área é restrita aos superadmins da plataforma.
          </Alert>
        </Grid>
      )}

      {allowed && status && !status.emailConfigured ? (
        <Grid size={12}>
          <Alert severity="warning" className="neutral bg-background-paper/60!">
            O envio de e-mail não está configurado (RESEND_API_KEY): a confirmação e os lembretes não saem. O grupo de
            avisos e a página continuam funcionando.
          </Alert>
        </Grid>
      ) : null}

      {allowed && (
        <Grid size={12}>
          <Tabs
            value={tab}
            onChange={(_, value: TabKey) => setTab(value)}
            aria-label="Leads e eventos"
            className="mb-4"
          >
            <Tab value="eventos" label="Eventos" />
            <Tab value="leads" label="Leads" />
          </Tabs>
          {tab === "eventos" ? (
            <EventsAdmin />
          ) : (
            <Card component="section">
              <CardContent>
                <LeadsAdmin />
              </CardContent>
            </Card>
          )}
        </Grid>
      )}
    </Grid>
  );
}
