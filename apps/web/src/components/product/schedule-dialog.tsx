"use client";

import dayjs, { type Dayjs } from "dayjs";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";

import {
  Alert,
  Autocomplete,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  TextField,
  Typography,
} from "@mui/material";
import { DateTimePicker, LocalizationProvider } from "@mui/x-date-pickers";
import { AdapterDayjs } from "@mui/x-date-pickers/AdapterDayjs";

import { isSupabaseConfigured } from "@flyee/auth";
import { createClient } from "@flyee/auth/client";

type PatientOption = { id: string; fullName: string };

export type ScheduleSeed = {
  consultationId?: string;
  patientId?: string;
  startAt?: string;
  durationMinutes?: number;
  reason?: string;
};

const DURATIONS = [30, 45, 50, 60, 90, 120];

/**
 * Schedule or reschedule a consultation (PRD §9.3). A scheduled consultation is
 * a consultation with status 'scheduled' and `started_at` as its appointment
 * time — so this creates or moves that row, and opening it later IS Modo
 * Consulta on the same record.
 *
 * A simple time conflict is checked against the workspace's calendar (the
 * `consultation_schedule_conflict` RPC, shared with any future surface). A
 * conflict does not hard-block — it warns and asks for confirmation, because a
 * professional sometimes double-books deliberately and the software should not
 * override her judgement (PRD §9.3 "evitar conflito simples").
 */
export default function ScheduleDialog({
  open,
  orgId,
  seed,
  onClose,
  onSaved,
}: {
  open: boolean;
  orgId: string;
  /** Present ⇒ reschedule that consultation; absent ⇒ create a new one. */
  seed?: ScheduleSeed;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations("product");
  const [patients, setPatients] = useState<PatientOption[]>([]);
  const [patient, setPatient] = useState<PatientOption | null>(null);
  const [start, setStart] = useState<Dayjs | null>(null);
  const [duration, setDuration] = useState(50);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);

  const isReschedule = Boolean(seed?.consultationId);

  // Reset the form to the seed each time the dialog opens.
  useEffect(() => {
    if (!open) return;
    setError(null);
    setConflict(false);
    setStart(seed?.startAt ? dayjs(seed.startAt) : dayjs().add(1, "hour").minute(0).second(0));
    setDuration(seed?.durationMinutes ?? 50);
    setReason(seed?.reason ?? "");
  }, [open, seed]);

  // Patients for the picker (reschedule keeps its patient fixed).
  useEffect(() => {
    if (!open || !isSupabaseConfigured) return;
    const load = async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from("patients")
        .select("id, full_name")
        .eq("org_id", orgId)
        .order("full_name", { ascending: true });
      const options = (data ?? []).map((row) => ({ id: row.id, fullName: row.full_name }));
      setPatients(options);
      if (seed?.patientId) setPatient(options.find((option) => option.id === seed.patientId) ?? null);
      else setPatient(null);
    };
    load();
  }, [open, orgId, seed?.patientId]);

  const canSave = useMemo(() => Boolean(patient && start && duration > 0), [patient, start, duration]);

  const save = async (force = false) => {
    if (!patient || !start) return;
    setBusy(true);
    setError(null);
    const supabase = createClient();

    // Simple conflict check — unless she already chose to override.
    if (!force) {
      const { data: hasConflict } = await supabase.rpc("consultation_schedule_conflict", {
        target_org: orgId,
        start_at: start.toISOString(),
        duration_minutes: duration,
        exclude_id: seed?.consultationId ?? null,
      });
      if (hasConflict) {
        setConflict(true);
        setBusy(false);
        return;
      }
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();

    const payload = {
      started_at: start.toISOString(),
      duration_minutes: duration,
      chief_complaint: reason.trim() || null,
    };

    const result = isReschedule
      ? await supabase.from("consultations").update(payload).eq("id", seed!.consultationId!)
      : await supabase.from("consultations").insert({
          ...payload,
          org_id: orgId,
          patient_id: patient.id,
          status: "scheduled",
          created_by: user?.id ?? null,
        });

    setBusy(false);
    if (result.error) {
      setError(result.error.message);
      return;
    }
    onSaved();
    onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{isReschedule ? t("agenda-reschedule-title") : t("agenda-schedule-title")}</DialogTitle>
      <DialogContent className="flex flex-col gap-4 pt-2!">
        {error && (
          <Alert severity="warning" className="neutral bg-background-paper/60!">
            {error}
          </Alert>
        )}

        <Autocomplete
          options={patients}
          getOptionLabel={(option) => option.fullName}
          value={patient}
          onChange={(_, value) => setPatient(value)}
          disabled={isReschedule}
          isOptionEqualToValue={(a, b) => a.id === b.id}
          renderInput={(params) => <TextField {...params} label={t("agenda-field-patient")} />}
          noOptionsText={t("agenda-no-patients")}
        />

        <LocalizationProvider dateAdapter={AdapterDayjs}>
          <DateTimePicker
            label={t("agenda-field-datetime")}
            value={start}
            onChange={(value) => {
              setStart(value);
              setConflict(false);
            }}
            ampm={false}
            format="DD/MM/YYYY HH:mm"
          />
        </LocalizationProvider>

        <TextField
          select
          label={t("agenda-field-duration")}
          value={duration}
          onChange={(event) => {
            setDuration(Number(event.target.value));
            setConflict(false);
          }}
        >
          {DURATIONS.map((minutes) => (
            <MenuItem key={minutes} value={minutes}>
              {t("agenda-minutes", { minutes })}
            </MenuItem>
          ))}
        </TextField>

        <TextField
          label={t("agenda-field-reason")}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          multiline
          minRows={2}
          placeholder={t("agenda-field-reason-hint")}
        />

        {/* A conflict warns, it does not block — the professional decides. */}
        {conflict && (
          <Alert severity="warning" className="neutral bg-background-paper/60! flex flex-col gap-2">
            <Typography variant="body2">{t("agenda-conflict")}</Typography>
            <Button variant="outlined" color="grey" size="small" className="self-start" onClick={() => save(true)}>
              {t("agenda-schedule-anyway")}
            </Button>
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button color="grey" onClick={onClose} disabled={busy}>
          {t("agenda-cancel")}
        </Button>
        <Button variant="contained" color="primary" onClick={() => save(false)} disabled={busy || !canSave}>
          {isReschedule ? t("agenda-save") : t("agenda-confirm")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
