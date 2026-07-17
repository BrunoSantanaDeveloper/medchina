"use client";

// The picker renders month/weekday names through the dayjs adapter, so every
// supported locale must be registered or the calendar silently falls back to en.
import "dayjs/locale/de";
import "dayjs/locale/es";
import "dayjs/locale/fr";
import "dayjs/locale/pt-br";

import dayjs, { type Dayjs } from "dayjs";
import timezonePlugin from "dayjs/plugin/timezone";
import utc from "dayjs/plugin/utc";
import { useFormik } from "formik";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import * as yup from "yup";

import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  TextField,
  Typography,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import { DateTimePicker, LocalizationProvider } from "@mui/x-date-pickers";
import { AdapterDayjs } from "@mui/x-date-pickers/AdapterDayjs";
import { deDE, enUS, esES, frFR, ptBR } from "@mui/x-date-pickers/locales";

import PatientQuickCreate from "@/components/product/patient-quick-create";
import { type AgendaMutationResult, saveAppointment, type ScheduleConflict } from "@/lib/agenda";
import { listActivePatientOptions, type PatientOption } from "@/lib/patients";
import { trackProductEvent } from "@/lib/product-events";
import { createClient } from "@flyee/auth/client";

dayjs.extend(utc);
dayjs.extend(timezonePlugin);

export type ScheduleSeed = {
  consultationId?: string;
  patientId?: string;
  startAt?: string;
  durationMinutes?: number;
  appointmentNote?: string;
  /** Compatibility with the pre-0028 call site. */
  reason?: string;
};

const DURATIONS = [30, 45, 50, 60, 90, 120];

/** The picker's own chrome (action buttons, aria labels) ships per locale in MUI X. */
const PICKER_LOCALES = { "pt-BR": ptBR, en: enUS, es: esES, fr: frFR, de: deDE } as const;

const pickerLocaleText = (locale: string) =>
  (PICKER_LOCALES[locale as keyof typeof PICKER_LOCALES] ?? ptBR).components.MuiLocalizationProvider.defaultProps
    .localeText;

const patientSecondary = (patient: PatientOption) => {
  const bits: string[] = [];
  if (patient.birthDate) bits.push(new Date(`${patient.birthDate}T00:00:00`).toLocaleDateString());
  if (patient.phone) bits.push(`•••• ${patient.phone.slice(-4)}`);
  return bits.join(" · ");
};

export default function ScheduleDialog({
  open,
  orgId,
  timeZone,
  seed,
  onClose,
  onSaved,
}: {
  open: boolean;
  orgId: string;
  timeZone: string;
  seed?: ScheduleSeed;
  onClose: () => void;
  onSaved: (result: AgendaMutationResult) => void | Promise<void>;
}) {
  const t = useTranslations("product");
  const locale = useLocale();
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down("sm"));
  const [view, setView] = useState<"schedule" | "patient">("schedule");
  const [patients, setPatients] = useState<PatientOption[] | null>(null);
  const [patient, setPatient] = useState<PatientOption | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<ScheduleConflict | null>(null);
  const trackedOpen = useRef(false);
  const saved = useRef(false);

  const isReschedule = Boolean(seed?.consultationId);

  const validationSchema = useMemo(
    () =>
      yup.object({
        patientId: yup.string().required(t("field-required")),
        start: yup
          .mixed<Dayjs>()
          .required(t("field-required"))
          .test("valid", t("agenda-error-invalid-date"), (value) => Boolean(value?.isValid()))
          .test("future", t("agenda-error-past"), (value) => Boolean(value?.isAfter(dayjs()))),
        duration: yup.number().positive().max(1440).required(),
        appointmentNote: yup.string().max(500, t("agenda-error-note-long")),
      }),
    [t],
  );

  const formik = useFormik({
    initialValues: {
      patientId: "",
      start: null as Dayjs | null,
      duration: 50,
      appointmentNote: "",
    },
    validationSchema,
    validateOnMount: true,
    onSubmit: () => undefined,
  });

  useEffect(() => {
    if (!open) return;
    if (!trackedOpen.current) {
      trackProductEvent("appointment.started", { origin: "agenda" });
      trackedOpen.current = true;
      saved.current = false;
    }
    setView("schedule");
    setPatients(null);
    setPatient(null);
    setBusy(false);
    setError(null);
    setConflict(null);
    formik.resetForm({
      values: {
        patientId: "",
        start: seed?.startAt ? dayjs(seed.startAt).tz(timeZone) : dayjs().tz(timeZone).add(1, "hour").startOf("hour"),
        duration: seed?.durationMinutes ?? 50,
        appointmentNote: seed?.appointmentNote ?? seed?.reason ?? "",
      },
    });
    // Formik is intentionally reset only when the dialog/seed changes. Moving
    // to inline patient creation must preserve every scheduling field.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, seed, timeZone]);

  useEffect(() => {
    if (!open) return;
    let active = true;
    const load = async () => {
      const result = await listActivePatientOptions(createClient(), orgId);
      if (!active) return;
      if (!result.ok) {
        setPatients(null);
        setError(t("agenda-patients-load-error"));
        return;
      }
      setPatients(result.data);
      const selected = seed?.patientId ? (result.data.find((option) => option.id === seed.patientId) ?? null) : null;
      setPatient(selected);
      await formik.setFieldValue("patientId", selected?.id ?? "", false);
    };
    load();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, orgId, seed?.patientId, t]);

  const handleClose = () => {
    if (busy) return;
    if (!saved.current && (formik.dirty || view === "patient")) {
      trackProductEvent("appointment.abandoned", { origin: "agenda" });
    }
    trackedOpen.current = false;
    onClose();
  };

  const errorForCode = (code: string) => {
    const known: Record<string, string> = {
      invalid_schedule: t("agenda-error-invalid-date"),
      patient_unavailable: t("agenda-error-patient-unavailable"),
      stale_status: t("agenda-error-stale"),
      not_found: t("agenda-error-not-found"),
      save_failed: t("agenda-save-error"),
      unexpected_response: t("agenda-save-error"),
    };
    return known[code] ?? t("agenda-save-error");
  };

  const save = async (forceConflict = false) => {
    await formik.setTouched({ patientId: true, start: true, duration: true, appointmentNote: true });
    const errors = await formik.validateForm();
    if (!patient || !formik.values.start || Object.keys(errors).length > 0) return;

    setBusy(true);
    setError(null);
    const result = await saveAppointment(createClient(), {
      orgId,
      patientId: patient.id,
      scheduledFor: formik.values.start.toISOString(),
      durationMinutes: formik.values.duration,
      appointmentNote: formik.values.appointmentNote,
      consultationId: seed?.consultationId,
      forceConflict,
    });
    setBusy(false);

    if (!result.ok) {
      if (result.code === "schedule_conflict" && result.conflict) {
        trackProductEvent("appointment.conflict", { origin: "agenda" });
        setConflict(result.conflict);
        return;
      }
      setError(errorForCode(result.code));
      return;
    }

    saved.current = true;
    trackProductEvent("appointment.completed", { origin: "agenda" });
    await onSaved(result);
    trackedOpen.current = false;
    onClose();
  };

  const conflictRange = conflict
    ? `${new Date(conflict.scheduledFor).toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
        timeZone,
      })} · ${conflict.patientName}`
    : "";

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="xs" fullWidth fullScreen={fullScreen}>
      <DialogTitle>
        {view === "patient"
          ? t("patient-quick-title")
          : isReschedule
            ? t("agenda-reschedule-title")
            : t("agenda-schedule-title")}
      </DialogTitle>

      <DialogContent className="pt-2!">
        {view === "patient" ? (
          <PatientQuickCreate
            orgId={orgId}
            existingPatients={patients ?? []}
            onCancel={() => setView("schedule")}
            onCreated={(created) => {
              setPatients((current) =>
                [...(current ?? []), created].sort((a, b) => a.fullName.localeCompare(b.fullName)),
              );
              setPatient(created);
              formik.setFieldValue("patientId", created.id, false);
              setView("schedule");
              setError(null);
            }}
          />
        ) : (
          <Box className="flex flex-col gap-4">
            {error && (
              <Alert severity="error" className="neutral bg-background-paper/60!">
                {error}
              </Alert>
            )}

            <Box className="flex flex-col gap-1">
              <Autocomplete
                options={patients ?? []}
                loading={patients === null && !error}
                getOptionLabel={(option) => option.fullName}
                value={patient}
                onChange={(_, value) => {
                  setPatient(value);
                  formik.setFieldValue("patientId", value?.id ?? "");
                }}
                isOptionEqualToValue={(a, b) => a.id === b.id}
                noOptionsText={patients === null && error ? t("agenda-patients-load-error") : t("agenda-no-patients")}
                loadingText={t("agenda-loading-patients")}
                renderOption={(props, option) => (
                  <li {...props} key={option.id}>
                    <Box className="flex min-w-0 flex-col">
                      <Typography variant="body2" className="text-text-primary font-medium">
                        {option.fullName}
                      </Typography>
                      {patientSecondary(option) && (
                        <Typography variant="body2" className="text-text-secondary text-xs">
                          {patientSecondary(option)}
                        </Typography>
                      )}
                    </Box>
                  </li>
                )}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    required
                    label={t("agenda-field-patient")}
                    error={formik.touched.patientId && Boolean(formik.errors.patientId)}
                    helperText={formik.touched.patientId && formik.errors.patientId}
                  />
                )}
              />
              <Button variant="text" size="small" className="self-start" onClick={() => setView("patient")}>
                {t("agenda-create-patient-inline")}
              </Button>
            </Box>

            <LocalizationProvider
              dateAdapter={AdapterDayjs}
              adapterLocale={locale.toLowerCase()}
              localeText={pickerLocaleText(locale)}
            >
              <DateTimePicker
                timezone={timeZone}
                label={t("agenda-field-datetime")}
                value={formik.values.start}
                onChange={(value) => {
                  formik.setFieldValue("start", value);
                  setConflict(null);
                }}
                onClose={() => formik.setFieldTouched("start", true)}
                ampm={false}
                format="DD/MM/YYYY HH:mm"
                disablePast
                slotProps={{
                  textField: {
                    required: true,
                    error: formik.touched.start && Boolean(formik.errors.start),
                    helperText: formik.touched.start && (formik.errors.start as string | undefined),
                  },
                }}
              />
            </LocalizationProvider>

            <TextField
              select
              required
              name="duration"
              label={t("agenda-field-duration")}
              value={formik.values.duration}
              onChange={(event) => {
                formik.setFieldValue("duration", Number(event.target.value));
                setConflict(null);
              }}
            >
              {DURATIONS.map((minutes) => (
                <MenuItem key={minutes} value={minutes}>
                  {t("agenda-minutes", { minutes })}
                </MenuItem>
              ))}
            </TextField>

            <TextField
              name="appointmentNote"
              label={t("agenda-field-note")}
              value={formik.values.appointmentNote}
              onChange={formik.handleChange}
              onBlur={formik.handleBlur}
              multiline
              minRows={2}
              placeholder={t("agenda-field-note-hint")}
              error={formik.touched.appointmentNote && Boolean(formik.errors.appointmentNote)}
              helperText={formik.touched.appointmentNote && formik.errors.appointmentNote}
            />

            {conflict && (
              <Alert severity="warning" className="neutral bg-background-paper/60! flex flex-col gap-2">
                <Typography variant="body2">{t("agenda-conflict-detail", { appointment: conflictRange })}</Typography>
                <Button
                  variant="outlined"
                  color="grey"
                  size="small"
                  className="self-start"
                  onClick={() => save(true)}
                  disabled={busy}
                >
                  {t("agenda-schedule-anyway")}
                </Button>
              </Alert>
            )}
          </Box>
        )}
      </DialogContent>

      {view === "schedule" && (
        <DialogActions>
          <Button color="grey" onClick={handleClose} disabled={busy}>
            {t("agenda-cancel")}
          </Button>
          <Button
            variant="contained"
            color="primary"
            onClick={() => save(false)}
            disabled={busy || !formik.isValid || patients === null}
          >
            {busy ? t("saving") : isReschedule ? t("agenda-save") : t("agenda-confirm")}
          </Button>
        </DialogActions>
      )}
    </Dialog>
  );
}
