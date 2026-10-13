"use client";

import SignupWhatsAppAdmin from "./components/signup-whatsapp-admin";
import SupportAdmin from "./components/support-admin";
import Link from "next/link";
import { useEffect, useState } from "react";

import { Alert, Breadcrumbs, Card, CardContent, Grid, Typography } from "@mui/material";

import { isSupabaseConfigured } from "@flyee/auth";
import { createClient } from "@flyee/auth/client";

/**
 * Superadmin quick-support console (platform_settings). RLS is the real
 * gate; the client-side check only improves UX.
 */
export default function AdminSupport() {
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
          Suporte
        </Typography>
        <Breadcrumbs>
          <Link color="inherit" href="/inicio">
            Início
          </Link>
          <Typography variant="body2">Admin</Typography>
          <Typography variant="body2">Suporte</Typography>
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
              <SupportAdmin />
            </CardContent>
          </Card>
        </Grid>
      )}

      {/* The other WhatsApp decision the operator owns: whether a sign-up has to
          be confirmed by it (migration 0122). */}
      {allowed && (
        <Grid size={12}>
          <Card component="section">
            <CardContent>
              <SignupWhatsAppAdmin />
            </CardContent>
          </Card>
        </Grid>
      )}
    </Grid>
  );
}
