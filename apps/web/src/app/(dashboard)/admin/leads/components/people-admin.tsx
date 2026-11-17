"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { Alert, Box, Button, Chip, FormControl, MenuItem, Select, Typography } from "@mui/material";
import { GridActionsCellItem, type GridColDef } from "@mui/x-data-grid";

import DataTable from "@/components/data-grid/data-table";
import ConfirmActionDialog from "@/components/product/confirm-action-dialog";
import EmptyState from "@/components/product/empty-state";
import { StatTile } from "@/components/product/home-tiles";
import IllustrationDocumentation from "@/icons/illustrations/illustration-documentation";
import IllustrationEmail from "@/icons/illustrations/illustration-email";
import NiArrowInDown from "@/icons/nexture/ni-arrow-in-down";
import NiBinFull from "@/icons/nexture/ni-bin-full";
import NiChevronDownSmall from "@/icons/nexture/ni-chevron-down-small";
import NiUserCheck from "@/icons/nexture/ni-user-check";
import NiUserMinus from "@/icons/nexture/ni-user-minus";
import NiUsers from "@/icons/nexture/ni-users";
import { recordAudit } from "@/lib/audit";
import { fetchAllPages } from "@/lib/fetch-all-pages";
import { createClient } from "@flyee/auth/client";
import { formatPhoneBr } from "@flyee/fields";

type EventRel = { id: string; title: string };
type RegistrationRel = { created_at: string; live_events: EventRel | EventRel[] | null };

type Row = {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  events: string[];
  eventIds: string[];
  lastRegistration: string | null;
  marketing: boolean;
  optedOut: boolean;
};

type Filter = "all" | "ads" | "out";

/** The event picker's "every event" value — a Select renders "" as blank. */
const ALL_EVENTS = "todos";

const DATE = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "2-digit",
  timeZone: "America/Sao_Paulo",
});

/** A spreadsheet executes a cell that starts with = + - @: neutralize it. */
function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

/**
 * One row of Meta's customer-list format, under the identifier headers its
 * uploader maps by itself. The phone goes as country code + digits WITHOUT a
 * "+": the plus would trip the formula guard above, and the apostrophe it adds
 * would make the number unmatchable. First and last name are the first and
 * last words — what Meta's `fn`/`ln` expect.
 */
function audienceRow(row: { name: string; phone: string; email: string | null }): string[] {
  const words = row.name.trim().split(/\s+/).filter(Boolean);
  const first = words[0] ?? "";
  const last = words.length > 1 ? words[words.length - 1] : "";
  return [`55${row.phone}`, row.email ?? "", first, last, "BR"];
}

const one = <T,>(value: T | T[] | null): T | null => (Array.isArray(value) ? (value[0] ?? null) : value);

/**
 * The PEOPLE behind the registrations (/admin/leads) — one row per person,
 * across every event she signed up for. What is decided about a person lives
 * here: her consent for news and ads, leaving, and erasure. What is decided
 * about an event — who to message, who attended — lives on that event's
 * screen in /admin/eventos.
 *
 * Three rules shape it:
 *  - The only export is the list that CONSENTED to ads (the optional
 *    "medchina-novidades" term, not revoked, not opted out), one line per
 *    person — the grid's generic export is off, so an unconsented list cannot
 *    leave by accident.
 *  - Leaving is recorded, never deleted: the row stays until retention so the
 *    request to leave is honoured on the next event too.
 *  - Deleting is erasure, through `purge_lead`, which also removes the history
 *    versions; the audit keeps the operator's reason, never the erased data.
 */
export default function PeopleAdmin() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [eventId, setEventId] = useState<string>(ALL_EVENTS);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [optOutRow, setOptOutRow] = useState<Row | null>(null);
  const [purgeRow, setPurgeRow] = useState<Row | null>(null);

  const refresh = useCallback(async () => {
    // Paged: the API caps a response at 1000 rows and a `.limit()` above it
    // silently drops the rest — the counters and the ad export would be wrong
    // from the thousandth person on. A stable order keeps the pages apart.
    const supabase = createClient();
    const { data, error } = await fetchAllPages<unknown>((from, to) =>
      supabase
        .from("leads")
        .select(
          "id, name, phone, email, marketing_accepted_at, marketing_revoked_at, opted_out_at, " +
            "live_event_registrations(created_at, live_events(id, title))",
        )
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .range(from, to),
    );
    if (error) {
      setLoadError(error);
      return;
    }
    setLoadError(null);
    setRows(
      data.map((raw) => {
        const lead = raw as unknown as Record<string, unknown>;
        const registrations = ((lead.live_event_registrations as RegistrationRel[] | null) ?? []).sort((a, b) =>
          b.created_at.localeCompare(a.created_at),
        );
        return {
          id: lead.id as string,
          name: lead.name as string,
          phone: lead.phone as string,
          email: (lead.email as string | null) ?? null,
          events: registrations.map((registration) => one(registration.live_events)?.title ?? "").filter(Boolean),
          eventIds: registrations.map((registration) => one(registration.live_events)?.id ?? "").filter(Boolean),
          lastRegistration: registrations[0]?.created_at ?? null,
          marketing: Boolean(lead.marketing_accepted_at && !lead.marketing_revoked_at && !lead.opted_out_at),
          optedOut: Boolean(lead.opted_out_at),
        };
      }),
    );
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // The events anyone registered for, most recent registration first — an
  // event with no registrations has nobody to show.
  const eventOptions = useMemo(() => {
    const seen = new Map<string, string>();
    const byRecent = [...(rows ?? [])].sort((a, b) =>
      (b.lastRegistration ?? "").localeCompare(a.lastRegistration ?? ""),
    );
    for (const row of byRecent) {
      row.eventIds.forEach((id, index) => {
        if (!seen.has(id)) seen.set(id, row.events[index] ?? id);
      });
    }
    return [...seen].map(([id, title]) => ({ id, title }));
  }, [rows]);
  const selectedEvent = eventOptions.find((option) => option.id === eventId) ?? null;

  // Everything below follows the event picker: the counters, the table and the
  // export are always the SAME slice, so the file holds what the tile counted.
  const inEvent = useMemo(
    () => (rows ?? []).filter((row) => !selectedEvent || row.eventIds.includes(selectedEvent.id)),
    [rows, selectedEvent],
  );
  const eligibleForAds = useMemo(() => inEvent.filter((row) => row.marketing), [inEvent]);
  const optedOut = useMemo(() => inEvent.filter((row) => row.optedOut), [inEvent]);
  const visible = filter === "ads" ? eligibleForAds : filter === "out" ? optedOut : inEvent;

  const exportAudience = useCallback(async () => {
    const lines = [
      ["phone", "email", "fn", "ln", "country"].map(csvCell).join(","),
      ...eligibleForAds.map((row) => audienceRow(row).map(csvCell).join(",")),
    ];
    // A byte-order mark first, so Excel reads the accents as UTF-8.
    const blob = new Blob([String.fromCharCode(0xfeff), lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `publico-anuncios-${selectedEvent ? "evento-" : ""}${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
    // The count only — never the list itself.
    recordAudit(createClient(), "admin.leads.audience_exported", {
      entityType: "lead",
      metadata: { rows: eligibleForAds.length, event: selectedEvent?.id ?? null },
    });
  }, [eligibleForAds, selectedEvent]);

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
        field: "events",
        headerName: "Eventos",
        flex: 1,
        minWidth: 200,
        sortComparator: (a: string[], b: string[]) => a.length - b.length,
        // The latest event, then how many more: event titles are long, and a
        // joined list only ever showed the start of the first one. The whole
        // list is on hover and for assistive technology.
        renderCell: ({ row }) =>
          row.events.length ? (
            <Typography variant="body1" noWrap title={row.events.join(" · ")} aria-label={row.events.join("; ")}>
              {row.events[0]}
              {row.events.length > 1 ? ` (+${row.events.length - 1})` : ""}
            </Typography>
          ) : (
            "—"
          ),
      },
      {
        field: "lastRegistration",
        headerName: "Última inscrição",
        minWidth: 130,
        valueFormatter: (value: string | null) => (value ? DATE.format(new Date(value)) : "—"),
      },
      {
        field: "marketing",
        headerName: "Novidades",
        minWidth: 110,
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
    [],
  );

  if (loadError) {
    // A failed load is an error, never an empty-looking table.
    return (
      <Alert
        severity="error"
        className="neutral bg-background-paper/60!"
        action={
          <Button color="inherit" size="small" onClick={() => void refresh()}>
            Tentar de novo
          </Button>
        }
      >
        Não foi possível carregar as pessoas: {loadError}
      </Alert>
    );
  }

  return (
    <Box className="flex flex-col gap-4">
      <Box className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatTile
          icon={<NiUsers size="large" />}
          tone="primary"
          label={selectedEvent ? "Inscritas no evento" : "Todas as pessoas"}
          hint="Cada pessoa uma vez, com todos os eventos em que se inscreveu"
          value={rows ? inEvent.length : "…"}
          onClick={() => setFilter("all")}
          pressed={filter === "all"}
        />
        <StatTile
          icon={<NiUserCheck size="large" />}
          tone="accent-2"
          label="Elegíveis para anúncio"
          hint="Autorizaram novidades e anúncios, e não saíram — a única lista que pode ir para a Meta"
          value={rows ? eligibleForAds.length : "…"}
          onClick={() => setFilter("ads")}
          pressed={filter === "ads"}
        />
        <StatTile
          icon={<NiUserMinus size="large" />}
          tone="secondary"
          label="Descadastradas"
          hint="Pediram para sair: não recebem mensagens de nenhum evento"
          value={rows ? optedOut.length : "…"}
          onClick={() => setFilter("out")}
          pressed={filter === "out"}
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
        initialColumnVisibility={{ email: false }}
        filters={
          <FormControl className="outlined min-w-56" variant="standard" size="small">
            <Select
              value={selectedEvent ? eventId : ALL_EVENTS}
              size="small"
              variant="standard"
              IconComponent={NiChevronDownSmall}
              onChange={(change) => setEventId(change.target.value)}
              inputProps={{ "aria-label": "Filtrar por evento" }}
            >
              <MenuItem value={ALL_EVENTS}>Todos os eventos</MenuItem>
              {eventOptions.map((option) => (
                <MenuItem key={option.id} value={option.id}>
                  {option.title}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        }
        header={
          <Typography variant="body2" color="text.secondary">
            A conversa 1:1 fica na tela de cada evento, em Eventos ao vivo → Inscritas.
          </Typography>
        }
        actions={
          <Button
            variant="outlined"
            color="grey"
            startIcon={<NiArrowInDown size="medium" />}
            onClick={exportAudience}
            disabled={eligibleForAds.length === 0}
          >
            {selectedEvent ? "Exportar público de anúncio deste evento (CSV)" : "Exportar público de anúncio (CSV)"}
          </Button>
        }
        noRowsOverlay={
          <EmptyState
            layout="row"
            illustration={filter === "all" && !selectedEvent ? <IllustrationEmail /> : <IllustrationDocumentation />}
            title={filter === "all" && !selectedEvent ? "Ninguém se inscreveu ainda" : "Ninguém neste recorte"}
            description={
              filter === "all" && !selectedEvent
                ? "As pessoas aparecem aqui quando se inscrevem na página de um evento."
                : "Mude o evento ou o recorte nos contadores acima."
            }
            action={
              filter === "all" && !selectedEvent ? { label: "Ver os eventos", href: "/admin/eventos" } : undefined
            }
          />
        }
      />

      {optOutRow ? (
        <ConfirmActionDialog
          key={optOutRow.id}
          title={`Descadastrar ${optOutRow.name.split(" ")[0]}`}
          consequences={[
            "Ela deixa de receber mensagens de eventos por WhatsApp e por e-mail — de todos os eventos.",
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
              .eq("id", optOutRow.id);
            if (error) return error.message;
            recordAudit(supabase, "admin.leads.opted_out", {
              entityType: "lead",
              entityId: optOutRow.id,
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
          key={purgeRow.id}
          title={`Excluir os dados de ${purgeRow.name.split(" ")[0]}`}
          intro="Pedido de exclusão (LGPD, art. 18). Não há como desfazer."
          consequences={[
            "Apaga o contato e as inscrições dela em todos os eventos, a presença e os links pessoais.",
            "Apaga também o histórico de versões dessas linhas.",
          ]}
          stays={["A trilha de auditoria guarda só quem excluiu, quando e o motivo — nunca o nome ou o telefone."]}
          reasonPlaceholder="Ex.: pediu exclusão por e-mail em 26/09"
          confirmLabel="Excluir definitivamente"
          tone="danger"
          onConfirm={async (reason) => {
            const supabase = createClient();
            const { data, error } = await supabase.rpc("purge_lead", {
              target_lead: purgeRow.id,
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
