"use client";

import AiPricesAdmin from "./components/ai-prices-admin";
import AssistantsAdmin from "./components/assistants-admin";
import McpAdmin from "./components/mcp-admin";
import Link from "next/link";
import { useEffect, useState } from "react";

import { Alert, Breadcrumbs, Card, CardContent, Grid, Typography } from "@mui/material";

import { isSupabaseConfigured } from "@flyee/auth";
import { createClient } from "@flyee/auth/client";

/** Superadmin console for AI assistants (RLS is the real gate). */
export default function AdminAi() {
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
          Assistentes de IA
        </Typography>
        <Breadcrumbs>
          <Link color="inherit" href="/inicio">
            Início
          </Link>
          <Typography variant="body2">Admin</Typography>
          <Typography variant="body2">IA</Typography>
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
        <>
          <Grid size={12}>
            <Card component="section">
              <CardContent>
                <AssistantsAdmin />
              </CardContent>
            </Card>
          </Grid>
          {/* The price book sits with the assistants because that is where a
              model is chosen — and choosing one without saying what it costs
              is how the platform spent a year unable to price itself. */}
          <Grid size={12}>
            <Card component="section">
              <CardContent className="flex flex-col gap-3">
                <Typography variant="h6" component="h2" className="mb-0">
                  Custo dos modelos
                </Typography>
                <AiPricesAdmin />
              </CardContent>
            </Card>
          </Grid>
          <Grid size={12}>
            <Card component="section">
              <CardContent className="flex flex-col gap-3">
                <Typography variant="h6" component="h2" className="mb-0">
                  Conectores MCP
                </Typography>
                <Typography variant="body2" className="text-text-secondary">
                  Consultórios com assistentes externos (ChatGPT/Claude) conectados pelo servidor MCP. Pesos e limites
                  de chamada ficam em platform_settings (&apos;mcp&apos;); a disponibilidade por plano, em
                  plans.limits.mcp_access.
                </Typography>
                <McpAdmin />
              </CardContent>
            </Card>
          </Grid>
        </>
      )}
    </Grid>
  );
}
