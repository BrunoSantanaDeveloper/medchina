"use client";

import { useEffect, useState } from "react";

import { Alert, Box, Chip, Skeleton, Typography } from "@mui/material";

import { isSupabaseConfigured } from "@flyee/auth";
import { createClient } from "@flyee/auth/client";

/**
 * Platform view of the MCP connectors (docs/MCP-CONECTORES.md): which
 * workspaces have external assistants connected and how much they call.
 * Superadmin-only via RLS (oauth_tokens/mcp_requests/oauth_clients all have
 * superadmin select policies); admin console copy is hardcoded pt-BR on purpose.
 */

type OrgRow = {
  orgId: string;
  orgName: string;
  clients: string[];
  calls30d: number;
  denied30d: number;
};

export default function McpAdmin() {
  const [rows, setRows] = useState<OrgRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      if (!isSupabaseConfigured) {
        setRows([]);
        return;
      }
      try {
        const supabase = createClient();
        const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

        const [{ data: tokens }, { data: requests }] = await Promise.all([
          supabase
            .from("oauth_tokens")
            .select("org_id, revoked_at, refresh_expires_at, organizations(name), oauth_clients(client_name)")
            .limit(1000),
          supabase.from("mcp_requests").select("org_id, status").gte("created_at", since).limit(5000),
        ]);

        const byOrg = new Map<string, OrgRow>();
        const now = Date.now();
        for (const token of tokens ?? []) {
          const orgId = token.org_id as string;
          const orgRel = token.organizations as { name?: string } | { name?: string }[] | null;
          const clientRel = token.oauth_clients as { client_name?: string } | { client_name?: string }[] | null;
          const orgName = (Array.isArray(orgRel) ? orgRel[0]?.name : orgRel?.name) ?? orgId;
          const clientName = (Array.isArray(clientRel) ? clientRel[0]?.client_name : clientRel?.client_name) ?? "?";
          const live =
            !token.revoked_at &&
            (token.refresh_expires_at ? new Date(token.refresh_expires_at as string).getTime() > now : false);
          if (!live) continue;
          const entry = byOrg.get(orgId) ?? { orgId, orgName, clients: [], calls30d: 0, denied30d: 0 };
          if (!entry.clients.includes(clientName)) entry.clients.push(clientName);
          byOrg.set(orgId, entry);
        }
        for (const request of requests ?? []) {
          const entry = byOrg.get(request.org_id as string);
          if (!entry) continue;
          if (request.status === "ok") entry.calls30d += 1;
          else entry.denied30d += 1;
        }
        setRows([...byOrg.values()].sort((a, b) => b.calls30d - a.calls30d));
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Não foi possível carregar o uso do MCP.");
      }
    };
    load();
  }, []);

  if (error) {
    return (
      <Alert severity="error" className="neutral bg-background-paper/60!">
        {error}
      </Alert>
    );
  }
  if (rows === null) return <Skeleton variant="rounded" height={96} />;
  if (rows.length === 0) {
    return (
      <Typography variant="body2" className="text-text-secondary">
        Nenhum consultório tem assistente externo conectado ainda. As conexões aparecem aqui conforme as profissionais
        autorizam ChatGPT/Claude em /oauth/authorize; o detalhe por chamada fica na trilha de auditoria (mcp.*) e em
        mcp_requests.
      </Typography>
    );
  }

  return (
    <Box className="flex flex-col gap-3">
      {rows.map((row) => (
        <Box key={row.orgId} className="border-grey-100 flex flex-col gap-1 rounded-lg border p-3">
          <Box className="flex flex-row flex-wrap items-center justify-between gap-2">
            <Typography variant="subtitle2" className="mb-0">
              {row.orgName}
            </Typography>
            <Typography variant="caption" className="text-text-secondary">
              {row.calls30d} chamadas atendidas / {row.denied30d} negadas (30 d)
            </Typography>
          </Box>
          <Box className="flex flex-row flex-wrap gap-1">
            {row.clients.map((client) => (
              <Chip key={client} size="small" variant="outlined" label={client} />
            ))}
          </Box>
        </Box>
      ))}
    </Box>
  );
}
