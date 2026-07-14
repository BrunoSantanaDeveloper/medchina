"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Breadcrumbs,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormLabel,
  Grid,
  Input,
  Skeleton,
  Typography,
} from "@mui/material";

import ConsultationRecorder from "@/components/product/consultation-recorder";
import NiCheckSquare from "@/icons/nexture/ni-check-square";
import NiChevronDownSmall from "@/icons/nexture/ni-chevron-down-small";
import NiLock from "@/icons/nexture/ni-lock";
import { ANAMNESIS_BLOCKS, PROFESSIONAL_OBSERVATION_FIELDS } from "@/lib/anamnesis";
import { recordAudit } from "@/lib/audit";
import { cn } from "@/lib/utils";
import { isSupabaseConfigured } from "@flyee/auth";
import { createClient } from "@flyee/auth/client";

type Consultation = {
  id: string;
  orgId: string;
  patientId: string;
  patientName: string;
  status: string;
  chiefComplaint: string | null;
  summary: string | null;
  startedAt: string;
};

type Addendum = { id: string; body: string; reason: string | null; createdAt: string };

/**
 * The consultation record (PRD §8.3/§8.5). The job: capture what the patient
 * said and what I observed, then close the record with confidence.
 *
 * Two rules the UI must make obvious, because the database enforces them:
 *  - a field left blank stays "não informado" — absence is never a negative
 *    answer (PRD §10.5), so nothing is pre-filled or defaulted;
 *  - once finalized, the record is frozen: corrections become addenda with
 *    author, date and reason (PRD §8.5).
 *
 * Answers save on blur (autosave) so nothing is lost mid-consultation.
 */
export default function ConsultaPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const t = useTranslations("product");

  const [consultation, setConsultation] = useState<Consultation | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [addenda, setAddenda] = useState<Addendum[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [finalizeOpen, setFinalizeOpen] = useState(false);
  const [addendumOpen, setAddendumOpen] = useState(false);
  const [addendumBody, setAddendumBody] = useState("");
  const [addendumReason, setAddendumReason] = useState("");
  const [busy, setBusy] = useState(false);

  // Keeps the last persisted value per field so blur only writes real changes.
  const persisted = useRef<Record<string, string>>({});

  const load = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    const supabase = createClient();
    const [{ data: row }, { data: answerRows }, { data: addendaRows }] = await Promise.all([
      supabase
        .from("consultations")
        .select("id, org_id, patient_id, status, chief_complaint, summary, started_at, patients(full_name)")
        .eq("id", params.id)
        .maybeSingle(),
      supabase.from("anamnesis_answers").select("block_key, field_key, value").eq("consultation_id", params.id),
      supabase
        .from("consultation_addenda")
        .select("id, body, reason, created_at")
        .eq("consultation_id", params.id)
        .order("created_at"),
    ]);

    if (row) {
      const patient = row.patients as unknown as { full_name: string } | null;
      setConsultation({
        id: row.id,
        orgId: row.org_id,
        patientId: row.patient_id,
        patientName: patient?.full_name ?? "—",
        status: row.status,
        chiefComplaint: row.chief_complaint,
        summary: row.summary,
        startedAt: row.started_at,
      });
    }

    const map: Record<string, string> = {};
    for (const answer of answerRows ?? []) {
      map[`${answer.block_key}.${answer.field_key}`] = answer.value as string;
    }
    setAnswers(map);
    persisted.current = { ...map };

    setAddenda(
      (addendaRows ?? []).map((addendum) => ({
        id: addendum.id,
        body: addendum.body,
        reason: addendum.reason,
        createdAt: addendum.created_at,
      })),
    );
  }, [params.id]);

  useEffect(() => {
    load();
  }, [load]);

  const isFinalized = consultation?.status === "finalized";

  const saveAnswer = async (blockKey: string, fieldKey: string) => {
    if (!consultation || isFinalized) return;
    const composite = `${blockKey}.${fieldKey}`;
    const value = (answers[composite] ?? "").trim();
    if (value === (persisted.current[composite] ?? "")) return;

    setSavingKey(composite);
    setError(null);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!value) {
      // Clearing a field REMOVES the answer — an empty field is "not informed",
      // never a stored negative (PRD §10.5).
      const { error: deleteError } = await supabase
        .from("anamnesis_answers")
        .delete()
        .eq("consultation_id", consultation.id)
        .eq("block_key", blockKey)
        .eq("field_key", fieldKey);
      if (deleteError) setError(deleteError.message);
      else delete persisted.current[composite];
      setSavingKey(null);
      return;
    }

    const { error: upsertError } = await supabase.from("anamnesis_answers").upsert(
      {
        org_id: consultation.orgId,
        consultation_id: consultation.id,
        block_key: blockKey,
        field_key: fieldKey,
        value,
        // Typed by the professional; voice/AI sources arrive with the AI pipeline.
        source: PROFESSIONAL_OBSERVATION_FIELDS.has(composite) ? "professional_voice" : "professional",
        state: "clear",
        created_by: user?.id ?? null,
      },
      { onConflict: "consultation_id,block_key,field_key" },
    );

    if (upsertError) setError(upsertError.message);
    else persisted.current[composite] = value;
    setSavingKey(null);
  };

  const saveHeaderField = async (field: "chief_complaint" | "summary", value: string) => {
    if (!consultation || isFinalized) return;
    const supabase = createClient();
    const { error: updateError } = await supabase
      .from("consultations")
      .update({ [field]: value.trim() || null })
      .eq("id", consultation.id);
    if (updateError) setError(updateError.message);
  };

  const finalize = async () => {
    if (!consultation || busy) return;
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { error: updateError } = await supabase
      .from("consultations")
      .update({
        status: "finalized",
        finalized_at: new Date().toISOString(),
        finalized_by: user?.id ?? null,
      })
      .eq("id", consultation.id);

    if (updateError) {
      setError(updateError.message);
      setBusy(false);
      return;
    }
    recordAudit(supabase, "consultation.finalized", {
      orgId: consultation.orgId,
      entityType: "consultation",
      entityId: consultation.id,
    });
    setFinalizeOpen(false);
    setBusy(false);
    await load();
    router.refresh();
  };

  const addAddendum = async () => {
    if (!consultation || !addendumBody.trim() || busy) return;
    setBusy(true);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { error: insertError } = await supabase.from("consultation_addenda").insert({
      org_id: consultation.orgId,
      consultation_id: consultation.id,
      body: addendumBody.trim(),
      reason: addendumReason.trim() || null,
      created_by: user?.id ?? null,
    });
    if (insertError) setError(insertError.message);
    else {
      recordAudit(supabase, "consultation.addendum.created", {
        orgId: consultation.orgId,
        entityType: "consultation",
        entityId: consultation.id,
      });
      setAddendumBody("");
      setAddendumReason("");
      setAddendumOpen(false);
      await load();
    }
    setBusy(false);
  };

  const filledCount = useMemo(() => Object.values(answers).filter((value) => value.trim()).length, [answers]);

  if (!consultation) {
    return <Skeleton variant="rounded" height={420} className="rounded-3xl" />;
  }

  return (
    <Grid container spacing={5}>
      <Grid size={12}>
        <Box className="flex flex-row flex-wrap items-start justify-between gap-3">
          <Box>
            <Typography variant="h1" component="h1" className="mb-0">
              {consultation.patientName}
            </Typography>
            <Breadcrumbs>
              <Link color="inherit" href="/inicio">
                {t("home-breadcrumb")}
              </Link>
              <Link color="inherit" href={`/pacientes/${consultation.patientId}`}>
                {consultation.patientName}
              </Link>
              <Typography variant="body2">{new Date(consultation.startedAt).toLocaleDateString()}</Typography>
            </Breadcrumbs>
          </Box>

          {isFinalized ? (
            <Button variant="outlined" color="grey" onClick={() => setAddendumOpen(true)}>
              {t("consultation-add-addendum")}
            </Button>
          ) : (
            <Button variant="contained" color="primary" onClick={() => setFinalizeOpen(true)} disabled={busy}>
              {t("consultation-finalize")}
            </Button>
          )}
        </Box>
      </Grid>

      {isFinalized && (
        <Grid size={12}>
          <Alert severity="success" icon={<NiLock />} className="neutral bg-background-paper/60!">
            {t("consultation-finalized-notice")}
          </Alert>
        </Grid>
      )}

      {error && (
        <Grid size={12}>
          <Alert severity="error" className="neutral bg-background-paper/60!">
            {error}
          </Alert>
        </Grid>
      )}

      <Grid size={{ xs: 12, lg: 8 }}>
        <Card component="section">
          <CardContent className="flex flex-col gap-4">
            <Box>
              <Typography variant="h5" component="h2" className="card-title">
                {t("consultation-anamnesis-title")}
              </Typography>
              <Typography variant="body2" className="text-text-secondary">
                {t("consultation-anamnesis-subtitle")}
              </Typography>
            </Box>

            <FormControl className="outlined" variant="standard" size="small">
              <FormLabel component="label">{t("field-main-complaint")}</FormLabel>
              <Input
                multiline
                minRows={2}
                disabled={isFinalized}
                defaultValue={consultation.chiefComplaint ?? ""}
                onBlur={(event) => saveHeaderField("chief_complaint", event.target.value)}
              />
            </FormControl>

            {ANAMNESIS_BLOCKS.map((block) => (
              <Accordion
                key={block.key}
                elevation={0}
                disableGutters
                defaultExpanded={block.key === "complaint"}
                className="border-grey-100 bg-background-paper rounded-2xl! border"
              >
                <AccordionSummary expandIcon={<NiChevronDownSmall />} className="px-5! py-2!">
                  <Typography component="h3" variant="subtitle1">
                    {t(block.title)}
                  </Typography>
                </AccordionSummary>
                <AccordionDetails className="flex flex-col gap-1 px-5! pt-0! pb-5!">
                  {block.fields.map((field) => {
                    const composite = `${block.key}.${field.key}`;
                    const isObservation = PROFESSIONAL_OBSERVATION_FIELDS.has(composite);
                    return (
                      <FormControl key={field.key} className="outlined" variant="standard" size="small">
                        <FormLabel component="label" className="flex flex-row items-center gap-2">
                          {t(field.label)}
                          {isObservation && (
                            <span className="bg-accent-1/12 text-accent-1-dark dark:text-accent-1-light rounded-full px-2 py-0.5 text-xs font-semibold">
                              {t("field-observation-badge")}
                            </span>
                          )}
                          {savingKey === composite && (
                            <span className="text-text-secondary text-xs">{t("saving")}</span>
                          )}
                        </FormLabel>
                        <Input
                          multiline={field.multiline}
                          minRows={field.multiline ? 2 : undefined}
                          disabled={isFinalized}
                          value={answers[composite] ?? ""}
                          onChange={(event) =>
                            setAnswers((current) => ({ ...current, [composite]: event.target.value }))
                          }
                          onBlur={() => saveAnswer(block.key, field.key)}
                        />
                      </FormControl>
                    );
                  })}
                </AccordionDetails>
              </Accordion>
            ))}

            <FormControl className="outlined" variant="standard" size="small">
              <FormLabel component="label">{t("consultation-summary")}</FormLabel>
              <Input
                multiline
                minRows={3}
                disabled={isFinalized}
                defaultValue={consultation.summary ?? ""}
                onBlur={(event) => saveHeaderField("summary", event.target.value)}
              />
            </FormControl>
          </CardContent>
        </Card>
      </Grid>

      <Grid size={{ xs: 12, lg: 4 }}>
        <Box className="flex flex-col gap-5">
          {/* Recording is offered only while the consultation is open; a
              finalized record takes no new audio. */}
          {!isFinalized && (
            <ConsultationRecorder
              orgId={consultation.orgId}
              patientId={consultation.patientId}
              consultationId={consultation.id}
            />
          )}

          <Card component="section">
            <CardContent className="flex flex-col gap-2">
              <Typography variant="h6" component="h2">
                {t("consultation-state-title")}
              </Typography>
              <Typography variant="body2" className="text-text-secondary leading-6">
                {t("consultation-state-body", { count: filledCount })}
              </Typography>
              <Typography variant="body2" className="text-text-secondary leading-6">
                {t("consultation-absence-note")}
              </Typography>
            </CardContent>
          </Card>

          {addenda.length > 0 && (
            <Card component="section">
              <CardContent className="flex flex-col gap-3">
                <Typography variant="h6" component="h2">
                  {t("consultation-addenda-title")}
                </Typography>
                {addenda.map((addendum) => (
                  <Box key={addendum.id} className="border-grey-100 rounded-2xl border p-3">
                    <Typography variant="body2" className="text-text-primary leading-6">
                      {addendum.body}
                    </Typography>
                    <Typography variant="body2" className="text-text-secondary mt-1 text-xs">
                      {new Date(addendum.createdAt).toLocaleString()}
                      {addendum.reason ? ` · ${addendum.reason}` : ""}
                    </Typography>
                  </Box>
                ))}
              </CardContent>
            </Card>
          )}
        </Box>
      </Grid>

      {/* Finalizing is irreversible — say so before it happens. */}
      <Dialog open={finalizeOpen} onClose={() => setFinalizeOpen(false)}>
        <DialogTitle className="flex flex-row items-center gap-2">
          <NiCheckSquare size="medium" className="text-primary" />
          {t("consultation-finalize-title")}
        </DialogTitle>
        <DialogContent>
          <Typography variant="body1" className="text-text-secondary leading-6">
            {t("consultation-finalize-body")}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button variant="text" color="grey" onClick={() => setFinalizeOpen(false)}>
            {t("cancel")}
          </Button>
          <Button variant="contained" color="primary" onClick={finalize} disabled={busy}>
            {t("consultation-finalize-confirm")}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={addendumOpen} onClose={() => setAddendumOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>{t("consultation-addendum-title")}</DialogTitle>
        <DialogContent className={cn("flex flex-col gap-2")}>
          <Typography variant="body2" className="text-text-secondary leading-6">
            {t("consultation-addendum-body")}
          </Typography>
          <FormControl className="outlined" variant="standard" size="small">
            <FormLabel component="label">{t("consultation-addendum-text")}</FormLabel>
            <Input
              multiline
              minRows={3}
              value={addendumBody}
              onChange={(event) => setAddendumBody(event.target.value)}
            />
          </FormControl>
          <FormControl className="outlined" variant="standard" size="small">
            <FormLabel component="label">{t("consultation-addendum-reason")}</FormLabel>
            <Input value={addendumReason} onChange={(event) => setAddendumReason(event.target.value)} />
          </FormControl>
        </DialogContent>
        <DialogActions>
          <Button variant="text" color="grey" onClick={() => setAddendumOpen(false)}>
            {t("cancel")}
          </Button>
          <Button variant="contained" color="primary" onClick={addAddendum} disabled={busy || !addendumBody.trim()}>
            {t("consultation-addendum-save")}
          </Button>
        </DialogActions>
      </Dialog>
    </Grid>
  );
}
