"use client";

import type { ConsoleEvent } from "./event-model";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Alert, Box, Chip, Typography } from "@mui/material";
import { GridActionsCellItem, type GridColDef } from "@mui/x-data-grid";

import DataTable from "@/components/data-grid/data-table";
import ConfirmActionDialog from "@/components/product/confirm-action-dialog";
import EmptyState from "@/components/product/empty-state";
import { StatTile } from "@/components/product/home-tiles";
import IllustrationAccounts from "@/icons/illustrations/illustration-accounts";
import IllustrationDocumentation from "@/icons/illustrations/illustration-documentation";
import NiBinFull from "@/icons/nexture/ni-bin-full";
import NiMessageDots from "@/icons/nexture/ni-message-dots";
import NiPhone from "@/icons/nexture/ni-phone";
import NiUserMinus from "@/icons/nexture/ni-user-minus";
import NiUsers from "@/icons/nexture/ni-users";
import { recordAudit } from "@/lib/audit";
import { fetchAllPages } from "@/lib/fetch-all-pages";
import { aboutEvent, eventPath, normalizeChannel } from "@/lib/live-event-common";
import { whatsappDeepLink } from "@/lib/whatsapp-link";
import { createClient } from "@flyee/auth/client";
import { formatPhoneBr } from "@flyee/fields";

type LeadRel = {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  marketing_accepted_at: string | null;
  marketing_revoked_at: string | null;
  opted_out_at: string | null;
};

type Row = {
  id: string;
  leadId: string;
  name: string;
  phone: string;
  email: string | null;
  createdAt: string;
  channel: string;
  groupClicked: boolean;
  whatsappStarted: boolean;
  lastOpened: string | null;
  watchedMinutes: number | null;
  marketing: boolean;
  optedOut: boolean;
  afterEvent: boolean;
};

type Filter = "all" | "no-group" | "started";

const DATE_TIME = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "America/Sao_Paulo",
});

/** Midnight in Brasília, for "conversations opened today". */
function startOfTodayBrasilia(): number {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
  return new Date(`${today}T00:00:00-03:00`).getTime();
}

const one = <T,>(value: T | T[] | null): T | null => (Array.isArray(value) ? (value[0] ?? null) : value);

/**
 * The people registered for THIS event — the 1:1 list (docs/PAGINA-EVENTO.md
 * §7). WhatsApp is one conversation per click, never a bulk action: a number
 * that messages many people who never saved it is what WhatsApp restricts.
 * The queue to work is "no group click"; the people to answer first are the
 * ones who started the conversation themselves.
 *
 * Opting out and erasing act on the PERSON (all her events) — the same actions
 * /admin/leads offers; the ad-audience export lives there, person by person.
 */
export default function EventRegistrations({ event }: { event: ConsoleEvent }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [optOutRow, setOptOutRow] = useState<Row | null>(null);
  const [purgeRow, setPurgeRow] = useState<Row | null>(null);

  const refresh = useCallback(async () => {
    const supabase = createClient();
    const { data, error } = await fetchAllPages((from, to) =>
      supabase
        .from("live_event_registrations")
        .select(
          "id, created_at, origem, utm_source, group_clicked_at, whatsapp_started_at, last_whatsapp_opened_at, after_event, " +
            "leads!inner(id, name, phone, email, marketing_accepted_at, marketing_revoked_at, opted_out_at), " +
            "live_event_presence(watched_seconds)",
        )
        .eq("event_id", event.id)
        .order("created_at", { ascending: false })
        .order("id", { ascending: true })
        .range(from, to),
    );
    if (error) {
      setLoadError(error);
      return;
    }
    setLoadError(null);
    setRows(
      data.map((raw) => {
        const row = raw as unknown as Record<string, unknown>;
        const lead = one(row.leads as LeadRel | LeadRel[] | null) as LeadRel;
        const presence = one(
          row.live_event_presence as { watched_seconds: number } | { watched_seconds: number }[] | null,
        );
        return {
          id: row.id as string,
          leadId: lead.id,
          name: lead.name,
          phone: lead.phone,
          email: lead.email,
          createdAt: row.created_at as string,
          // The spelling the results use (live_event_channel), so the two agree.
          channel: normalizeChannel((row.origem as string | null) || (row.utm_source as string | null)),
          groupClicked: Boolean(row.group_clicked_at),
          whatsappStarted: Boolean(row.whatsapp_started_at),
          lastOpened: (row.last_whatsapp_opened_at as string | null) ?? null,
          watchedMinutes: presence ? Math.round(presence.watched_seconds / 60) : null,
          marketing: Boolean(lead.marketing_accepted_at && !lead.marketing_revoked_at && !lead.opted_out_at),
          optedOut: Boolean(lead.opted_out_at),
          afterEvent: Boolean(row.after_event),
        };
      }),
    );
  }, [event.id]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const withoutGroup = useMemo(() => (rows ?? []).filter((row) => !row.groupClicked && !row.optedOut), [rows]);
  const started = useMemo(() => (rows ?? []).filter((row) => row.whatsappStarted && !row.optedOut), [rows]);
  const openedToday = useMemo(() => {
    const since = startOfTodayBrasilia();
    return (rows ?? []).filter((row) => row.lastOpened && new Date(row.lastOpened).getTime() >= since).length;
  }, [rows]);

  const visible = filter === "no-group" ? withoutGroup : filter === "started" ? started : (rows ?? []);

  const openConversation = useCallback(
    async (row: Row) => {
      const firstName = row.name.split(" ")[0] ?? "";
      const link = whatsappDeepLink(
        row.phone,
        `Oi, ${firstName}! Aqui é da equipe do MedChina. Você se inscreveu no ao vivo ${aboutEvent(event)}. ` +
          "Qualquer dúvida sobre o evento, é só responder por aqui. Se não foi você que se inscreveu, responda SAIR.",
      );
      if (!link) {
        setNotice({ tone: "error", text: "Este número não forma um link de WhatsApp válido." });
        return;
      }
      window.open(link, "_blank", "noopener");
      const supabase = createClient();
      await supabase
        .from("live_event_registrations")
        .update({ last_whatsapp_opened_at: new Date().toISOString() })
        .eq("id", row.id);
      recordAudit(supabase, "admin.leads.whatsapp_opened", { entityType: "lead", entityId: row.leadId });
      refresh();
    },
    [event, refresh],
  );

  const columns: GridColDef<Row>[] = useMemo(
    () => [
      { field: "name", headerName: "Nome", flex: 1, minWidth: 160 },
      {
        field: "phone",
        headerName: "WhatsApp",
        minWidth: 140,
        valueFormatter: (value: string) => formatPhoneBr(value),
      },
      {
        field: "email",
        headerName: "E-mail",
        flex: 1,
        minWidth: 180,
        valueFormatter: (value: string | null) => value ?? "—",
      },
      {
        field: "createdAt",
        headerName: "Inscrição",
        minWidth: 120,
        valueFormatter: (value: string) => DATE_TIME.format(new Date(value)),
      },
      { field: "channel", headerName: "Canal", minWidth: 100 },
      {
        field: "groupClicked",
        headerName: "Grupo",
        minWidth: 90,
        renderCell: ({ row }) =>
          row.groupClicked ? (
            <Chip size="small" label="Clicou" color="success" variant="outlined" className="text-text-primary!" />
          ) : (
            "—"
          ),
      },
      {
        field: "whatsappStarted",
        headerName: "Conversa",
        minWidth: 100,
        renderCell: ({ row }) =>
          row.whatsappStarted ? (
            <Chip size="small" label="Iniciou" color="success" variant="outlined" className="text-text-primary!" />
          ) : (
            "—"
          ),
      },
      {
        field: "watchedMinutes",
        headerName: "Assistiu",
        minWidth: 90,
        valueFormatter: (value: number | null) => (value === null ? "—" : `${value} min`),
      },
      {
        field: "marketing",
        headerName: "Novidades",
        minWidth: 100,
        renderCell: ({ row }) =>
          row.optedOut ? (
            <Chip size="small" label="Saiu" color="grey" variant="outlined" />
          ) : row.marketing ? (
            <Chip size="small" label="Autorizou" color="primary" variant="outlined" />
          ) : (
            "—"
          ),
      },
      {
        field: "actions",
        headerName: "",
        type: "actions",
        minWidth: 70,
        align: "right",
        headerAlign: "right",
        getActions: ({ row }) => [
          <GridActionsCellItem
            key="whatsapp"
            icon={<NiMessageDots size="medium" />}
            label="Abrir conversa no WhatsApp"
            onClick={() => openConversation(row)}
            disabled={row.optedOut}
            showInMenu
          />,
          <GridActionsCellItem
            key="optout"
            icon={<NiUserMinus size="medium" />}
            label="Descadastrar"
            onClick={() => setOptOutRow(row)}
            disabled={row.optedOut}
            showInMenu
          />,
          <GridActionsCellItem
            key="purge"
            icon={<NiBinFull size="medium" />}
            label="Excluir (LGPD)"
            onClick={() => setPurgeRow(row)}
            showInMenu
          />,
        ],
      },
    ],
    [openConversation],
  );

  if (loadError) {
    // A failed load is an error, never an empty-looking table.
    return (
      <Alert severity="error" className="neutral bg-background-paper/60!">
        Não foi possível carregar as inscrições: {loadError}
      </Alert>
    );
  }

  return (
    <Box className="flex flex-col gap-4">
      <Box className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatTile
          icon={<NiUsers size="large" />}
          tone="primary"
          label="Todas as inscrições"
          value={rows?.length ?? "…"}
          onClick={() => setFilter("all")}
          pressed={filter === "all"}
        />
        <StatTile
          icon={<NiMessageDots size="large" />}
          tone="accent-3"
          label="Sem clique no grupo"
          hint="A fila do 1:1: inscritas que ainda não abriram o grupo de avisos"
          value={rows ? withoutGroup.length : "…"}
          onClick={() => setFilter("no-group")}
          pressed={filter === "no-group"}
        />
        <StatTile
          icon={<NiPhone size="large" />}
          tone="secondary"
          label="Iniciaram conversa"
          hint="Mandaram mensagem para o número do evento — responda primeiro"
          value={rows ? started.length : "…"}
          onClick={() => setFilter("started")}
          pressed={filter === "started"}
        />
      </Box>

      {notice ? (
        <Alert severity={notice.tone} className="neutral bg-background-paper/60!" onClose={() => setNotice(null)}>
          {notice.text}
        </Alert>
      ) : null}

      <DataTable<Row>
        rows={visible}
        columns={columns}
        loading={rows === null}
        enableExport={false}
        // The job here is choosing the next 1:1, and the row's actions sit in
        // the last column: on a laptop the MIT grid (no column pinning) would
        // push them past the edge. E-mail and news consent are one tap away in
        // the columns panel.
        initialColumnVisibility={{ email: false, marketing: false }}
        header={
          <Typography variant="body2" color="text.secondary">
            Conversas abertas hoje: {openedToday}. Uma por vez, nunca em lote.
          </Typography>
        }
        noRowsOverlay={
          <EmptyState
            layout="row"
            illustration={filter === "all" ? <IllustrationAccounts /> : <IllustrationDocumentation />}
            title={filter === "all" ? "Nenhuma inscrição neste evento" : "Ninguém neste recorte"}
            description={
              filter === "all"
                ? "As inscrições aparecem aqui assim que a página abrir e alguém se inscrever."
                : "Mude o recorte nos contadores acima."
            }
            action={filter === "all" ? { label: "Ver a página do evento", href: eventPath(event.slug) } : undefined}
          />
        }
      />

      {optOutRow ? (
        <ConfirmActionDialog
          key={optOutRow.leadId}
          title={`Descadastrar ${optOutRow.name.split(" ")[0]}`}
          consequences={[
            "Ela deixa de receber mensagens de eventos por WhatsApp e por e-mail — deste e de qualquer outro evento.",
            "Sai da lista de público de anúncio.",
          ]}
          stays={["A linha continua até o prazo de retenção, justamente para o pedido de sair ser respeitado."]}
          reasonPlaceholder="Ex.: respondeu SAIR no WhatsApp em 26/09"
          confirmLabel="Descadastrar"
          onConfirm={async (reason) => {
            const supabase = createClient();
            const now = new Date().toISOString();
            const { error } = await supabase
              .from("leads")
              .update({ opted_out_at: now, ...(optOutRow.marketing ? { marketing_revoked_at: now } : {}) })
              .eq("id", optOutRow.leadId);
            if (error) return error.message;
            recordAudit(supabase, "admin.leads.opted_out", {
              entityType: "lead",
              entityId: optOutRow.leadId,
              metadata: { reason },
            });
            setNotice({ tone: "success", text: "Descadastrada." });
            setOptOutRow(null);
            refresh();
            return null;
          }}
          onClose={() => setOptOutRow(null)}
        />
      ) : null}

      {purgeRow ? (
        <ConfirmActionDialog
          key={purgeRow.leadId}
          title={`Excluir os dados de ${purgeRow.name.split(" ")[0]}`}
          intro="Pedido de exclusão (LGPD, art. 18). Não há como desfazer."
          consequences={[
            "Apaga o contato e as inscrições dela em TODOS os eventos, a presença e os links pessoais.",
            "Apaga também o histórico de versões dessas linhas.",
          ]}
          stays={["A trilha de auditoria guarda só quem excluiu, quando e o motivo — nunca o nome ou o telefone."]}
          reasonPlaceholder="Ex.: pediu exclusão por e-mail em 26/09"
          confirmLabel="Excluir definitivamente"
          tone="danger"
          onConfirm={async (reason) => {
            const supabase = createClient();
            const { data, error } = await supabase.rpc("purge_lead", {
              target_lead: purgeRow.leadId,
              target_reason: reason,
            });
            const result = (data ?? {}) as { ok?: boolean; code?: string };
            if (error) return error.message;
            if (!result.ok)
              return result.code === "not_found" ? "Este contato já não existe." : "Não foi possível excluir.";
            setNotice({ tone: "success", text: "Dados excluídos, com o histórico." });
            setPurgeRow(null);
            refresh();
            return null;
          }}
          onClose={() => setPurgeRow(null)}
        />
      ) : null}
    </Box>
  );
}
