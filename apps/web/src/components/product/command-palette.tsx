"use client";

import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";

import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogTitle,
  InputAdornment,
  List,
  ListItemButton,
  ListItemText,
  ListSubheader,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";

import { useCurrentOrg } from "@/hooks/use-current-org";
import NiCalendar from "@/icons/nexture/ni-calendar";
import NiChevronRightSmall from "@/icons/nexture/ni-chevron-right-small";
import NiSearch from "@/icons/nexture/ni-search";
import NiUser from "@/icons/nexture/ni-user";
import { selectContextConsultations } from "@/lib/command-consultations";
import { PRODUCT_ACTIONS } from "@/lib/product-actions";
import { createClient } from "@flyee/auth/client";
import { remoteEmpty, remoteError, remoteIdle, remoteLoading, type RemoteState, remoteSuccess } from "@flyee/clinical";

type PaletteResult = {
  id: string;
  label: string;
  description: string;
  href: string;
  group: "actions" | "patients" | "consultations";
  kind: "action" | "patient" | "consultation";
};

const OPEN_STATUSES = ["scheduled", "draft", "in_progress", "awaiting_review"];

function cleanTerm(value: string) {
  return value
    .trim()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .slice(0, 80);
}

export default function CommandPalette() {
  const t = useTranslations("product");
  const locale = useLocale();
  const router = useRouter();
  const { orgId } = useCurrentOrg();
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [remoteState, setRemoteState] = useState<RemoteState<PaletteResult[], string>>(() => remoteIdle());
  const [contextActions, setContextActions] = useState<PaletteResult[]>([]);
  const [selected, setSelected] = useState(0);
  const remote = useMemo(() => {
    if (remoteState.status === "success") return remoteState.data;
    if ("previous" in remoteState) return remoteState.previous ?? [];
    return [];
  }, [remoteState]);
  const searching = remoteState.status === "loading";
  const searchError = remoteState.status === "error";

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((current) => !current);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setRemoteState(remoteIdle());
    setContextActions([]);
    setSelected(0);
    window.setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  useEffect(() => {
    if (!open || !orgId) return;
    let active = true;
    const loadLatest = async () => {
      const { data } = await createClient()
        .from("consultations")
        .select("id, status, started_at, scheduled_for, updated_at, patients(full_name)")
        .eq("org_id", orgId)
        .in("status", OPEN_STATUSES)
        .order("updated_at", { ascending: false })
        .limit(20);
      if (!active || !data) return;
      setContextActions(
        selectContextConsultations(data).map(({ kind, consultation: row }) => {
          const patient = row.patients as unknown as { full_name: string } | null;
          return {
            id: `latest-${row.id}`,
            label:
              kind === "review"
                ? t("command-review-consultation")
                : kind === "upcoming"
                  ? t("command-upcoming-appointment")
                  : t("command-continue-consultation"),
            description: t("command-consultation-description", {
              patient: patient?.full_name ?? t("command-patient"),
            }),
            href: `/consultas/${row.id}`,
            group: "actions" as const,
            kind: "action" as const,
          };
        }),
      );
    };
    loadLatest();
    return () => {
      active = false;
    };
  }, [open, orgId, t]);

  useEffect(() => {
    const term = cleanTerm(query);
    if (!open || !orgId || term.length < 2) {
      setRemoteState(remoteIdle());
      return;
    }

    let active = true;
    const timer = window.setTimeout(async () => {
      setRemoteState(remoteLoading());
      const supabase = createClient();
      const digits = term.replace(/\D/g, "");
      const filters = [`full_name.ilike.%${term}%`];
      if (digits.length >= 3) filters.push(`phone.ilike.%${digits}%`);
      const patientsResult = await supabase
        .from("patients")
        .select("id, full_name, phone")
        .eq("org_id", orgId)
        .or(filters.join(","))
        .order("full_name")
        .limit(8);

      if (!active) return;
      if (patientsResult.error) {
        setRemoteState(remoteError("search_failed"));
        return;
      }

      const patients = patientsResult.data ?? [];
      const patientIds = patients.map((patient) => patient.id);
      const consultationResult = patientIds.length
        ? await supabase
            .from("consultations")
            .select("id, status, started_at, scheduled_for, patients(full_name)")
            .eq("org_id", orgId)
            .in("patient_id", patientIds)
            .order("started_at", { ascending: false })
            .limit(6)
        : { data: [], error: null };

      const normalized = term.toLocaleLowerCase(locale);
      const status = [
        { value: "scheduled", words: ["agendada", "agendado", "scheduled"] },
        { value: "draft", words: ["rascunho", "draft"] },
        { value: "in_progress", words: ["andamento", "progress"] },
        { value: "awaiting_review", words: ["revisão", "revisao", "review"] },
        { value: "finalized", words: ["finalizada", "finalizado", "finalized"] },
        { value: "cancelled", words: ["cancelada", "cancelado", "cancelled"] },
      ].find((candidate) => candidate.words.some((word) => normalized.includes(word)))?.value;
      const dateParts = term.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
      const date = dateParts ? new Date(Number(dateParts[3]), Number(dateParts[2]) - 1, Number(dateParts[1])) : null;
      let directConsultationRows: NonNullable<typeof consultationResult.data> = [];
      let directConsultationError = false;
      if (status || (date && !Number.isNaN(date.getTime()))) {
        let directQuery = supabase
          .from("consultations")
          .select("id, status, started_at, scheduled_for, patients(full_name)")
          .eq("org_id", orgId)
          .order("started_at", { ascending: false })
          .limit(8);
        if (status) directQuery = directQuery.eq("status", status);
        if (date && !Number.isNaN(date.getTime())) {
          const end = new Date(date);
          end.setDate(end.getDate() + 1);
          directQuery = directQuery.gte("scheduled_for", date.toISOString()).lt("scheduled_for", end.toISOString());
        }
        const directResult = await directQuery;
        directConsultationRows = (directResult.data ?? []) as NonNullable<typeof consultationResult.data>;
        directConsultationError = Boolean(directResult.error);
      }

      if (!active) return;
      if (consultationResult.error || directConsultationError) {
        setRemoteState(remoteError("search_failed"));
        return;
      }

      const consultations = [...(consultationResult.data ?? []), ...directConsultationRows].filter(
        (consultation, index, rows) => rows.findIndex((row) => row.id === consultation.id) === index,
      );
      const results: PaletteResult[] = [
        ...patients.map((patient) => ({
          id: `patient-${patient.id}`,
          label: patient.full_name,
          description: patient.phone || t("command-patient"),
          href: `/pacientes/${patient.id}`,
          group: "patients" as const,
          kind: "patient" as const,
        })),
        ...consultations.map((consultation) => {
          const patient = consultation.patients as unknown as { full_name: string } | null;
          return {
            id: `consultation-${consultation.id}`,
            label: patient?.full_name ?? t("command-patient"),
            description: t("command-consultation-result", {
              date: new Date(consultation.scheduled_for ?? consultation.started_at).toLocaleDateString(locale),
            }),
            href: `/consultas/${consultation.id}`,
            group: "consultations" as const,
            kind: "consultation" as const,
          };
        }),
      ];
      setRemoteState(results.length === 0 ? remoteEmpty() : remoteSuccess(results));
    }, 225);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [locale, open, orgId, query, t]);

  const actions = useMemo(() => {
    const term = cleanTerm(query).toLocaleLowerCase();
    return PRODUCT_ACTIONS.map<PaletteResult>((action) => ({
      id: action.id,
      label: t(action.labelKey),
      description: t(action.descriptionKey),
      href: action.href,
      group: "actions",
      kind: "action",
    })).filter((action, index) => {
      if (!term) return true;
      const definition = PRODUCT_ACTIONS[index];
      return `${action.label} ${action.description} ${definition.keywords.join(" ")}`
        .toLocaleLowerCase()
        .includes(term);
    });
  }, [query, t]);

  const results = useMemo(
    () => [...(!query ? contextActions : []), ...actions, ...remote],
    [actions, contextActions, query, remote],
  );

  useEffect(() => setSelected(0), [query, results.length]);

  const go = (result: PaletteResult) => {
    setOpen(false);
    router.push(result.href);
  };

  const groupLabel = (group: PaletteResult["group"]) =>
    ({
      actions: t("command-group-actions"),
      patients: t("command-group-patients"),
      consultations: t("command-group-consultations"),
    })[group];

  return (
    <>
      <Tooltip title={t("command-open")} arrow>
        <Button
          variant="text"
          color="text-primary"
          className="hover:bg-grey-25 min-w-0 gap-2"
          onClick={() => setOpen(true)}
          startIcon={<NiSearch size="medium" />}
          aria-label={t("command-open")}
        >
          <Typography component="span" variant="body2" className="hidden text-xs sm:inline">
            Ctrl K
          </Typography>
        </Button>
      </Tooltip>

      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="sm" fullWidth aria-labelledby="command-title">
        <DialogTitle id="command-title" className="pb-2!">
          {t("command-title")}
        </DialogTitle>
        <DialogContent className="px-3! pb-3!">
          <TextField
            inputRef={inputRef}
            fullWidth
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("command-placeholder")}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setSelected((current) => Math.min(current + 1, results.length - 1));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setSelected((current) => Math.max(current - 1, 0));
              } else if (event.key === "Enter" && results[selected]) {
                event.preventDefault();
                go(results[selected]);
              }
            }}
            slotProps={{
              htmlInput: {
                role: "combobox",
                "aria-expanded": true,
                "aria-controls": "command-results",
                "aria-activedescendant": results[selected] ? `command-${results[selected].id}` : undefined,
              },
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <NiSearch size="medium" />
                  </InputAdornment>
                ),
                endAdornment: searching ? <CircularProgress size={18} /> : undefined,
              },
            }}
          />

          {searchError && (
            <Alert severity="warning" className="neutral mt-3">
              {t("command-error")}
            </Alert>
          )}

          <List
            id="command-results"
            role="listbox"
            tabIndex={0}
            aria-label={t("command-title")}
            className="mt-2 max-h-[55vh] overflow-y-auto py-0"
          >
            {results.map((result, index) => {
              const previous = results[index - 1];
              const startsGroup = !previous || previous.group !== result.group;
              return (
                <Fragment key={result.id}>
                  {startsGroup && (
                    <ListSubheader component="div" className="bg-background-paper! px-3! text-xs!">
                      {groupLabel(result.group)}
                    </ListSubheader>
                  )}
                  <ListItemButton
                    id={`command-${result.id}`}
                    role="option"
                    aria-selected={selected === index}
                    selected={selected === index}
                    onMouseMove={() => setSelected(index)}
                    onClick={() => go(result)}
                    className="rounded-xl"
                  >
                    <Box className="bg-grey-25 mr-3 flex h-9 w-9 items-center justify-center rounded-xl">
                      {result.kind === "patient" ? (
                        <NiUser size="small" />
                      ) : result.kind === "consultation" ? (
                        <NiCalendar size="small" />
                      ) : (
                        <NiSearch size="small" />
                      )}
                    </Box>
                    <ListItemText primary={result.label} secondary={result.description} />
                    <NiChevronRightSmall size="small" className="text-text-secondary" />
                  </ListItemButton>
                </Fragment>
              );
            })}
          </List>

          {!searching && !searchError && results.length === 0 && (
            <Typography variant="body2" className="text-text-secondary px-3 py-6 text-center">
              {t("command-empty")}
            </Typography>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
