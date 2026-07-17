"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import {
  Alert,
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  FormLabel,
  Radio,
  RadioGroup,
  Typography,
  useMediaQuery,
  useTheme,
} from "@mui/material";

export type ConsentTerm = {
  id: string;
  slug: string;
  version: number;
  title: string;
  body: string;
};

type ConsentSheetProps = {
  open: boolean;
  label: string;
  purpose: string;
  term: ConsentTerm | null;
  active: boolean;
  acceptedAt?: string | null;
  currentMethod?: string | null;
  busy?: boolean;
  onClose: () => void;
  onSubmit: (input: { granted: boolean; method: "verbal" | "in_person" }) => Promise<void>;
};

/** Review-first consent action. Nothing changes until the professional confirms. */
export default function ConsentSheet({
  open,
  label,
  purpose,
  term,
  active,
  acceptedAt,
  currentMethod,
  busy = false,
  onClose,
  onSubmit,
}: ConsentSheetProps) {
  const t = useTranslations("product");
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down("sm"));
  const [method, setMethod] = useState<"verbal" | "in_person">("verbal");
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    if (!open) return;
    setMethod("verbal");
    setConfirmed(false);
  }, [open]);

  const canSubmit = Boolean(term) && confirmed && !busy;

  return (
    <Dialog
      open={open}
      onClose={busy ? undefined : onClose}
      fullWidth
      maxWidth="sm"
      fullScreen={fullScreen}
      aria-labelledby="consent-sheet-title"
    >
      <DialogTitle id="consent-sheet-title">{active ? t("consent-sheet-review-title") : label}</DialogTitle>
      <DialogContent className="flex flex-col gap-4">
        <Alert severity={active ? "success" : "info"} className="neutral">
          {active && acceptedAt
            ? t("consent-sheet-current", { date: new Date(acceptedAt).toLocaleString() })
            : t("consent-sheet-not-current")}
          {active && (
            <Typography variant="body2" className="mt-1">
              {t("consent-sheet-method-recorded", {
                method:
                  currentMethod === "verbal"
                    ? t("consent-sheet-method-verbal")
                    : currentMethod === "in_person"
                      ? t("consent-sheet-method-in-person")
                      : currentMethod === "patient_qr"
                        ? t("consent-sheet-method-patient-qr")
                        : t("consent-sheet-method-other"),
              })}
            </Typography>
          )}
        </Alert>

        <Box>
          <Typography variant="overline" className="text-text-secondary">
            {t("consent-sheet-purpose")}
          </Typography>
          <Typography variant="body2" className="leading-6">
            {purpose}
          </Typography>
          <Typography variant="body2" className="text-text-secondary mt-1 leading-6">
            {t("consent-sheet-refusal-impact")}
          </Typography>
        </Box>

        {term ? (
          <Box className="border-grey-100 bg-background-default rounded-2xl border p-4">
            <Typography variant="subtitle1" component="h3">
              {term.title}
            </Typography>
            <Typography variant="caption" className="text-text-secondary">
              {t("consent-sheet-version", { version: term.version })}
            </Typography>
            <Typography variant="body2" className="mt-3 leading-6 whitespace-pre-line">
              {term.body}
            </Typography>
          </Box>
        ) : (
          <Alert severity="warning" className="neutral">
            {t("consent-term-missing")}
          </Alert>
        )}

        {!active && (
          <FormControl>
            <FormLabel id="consent-method-label">{t("consent-sheet-method")}</FormLabel>
            <RadioGroup
              aria-labelledby="consent-method-label"
              value={method}
              onChange={(event) => setMethod(event.target.value as "verbal" | "in_person")}
            >
              <FormControlLabel value="verbal" control={<Radio />} label={t("consent-sheet-method-verbal")} />
              <FormControlLabel value="in_person" control={<Radio />} label={t("consent-sheet-method-in-person")} />
            </RadioGroup>
          </FormControl>
        )}

        <FormControlLabel
          control={<Checkbox checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />}
          label={t(active ? "consent-sheet-confirm-revoke" : "consent-sheet-confirm-grant")}
        />
        <Typography variant="caption" className="text-text-secondary">
          {t("consent-sheet-recorded-at", { date: new Date().toLocaleString() })}
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button color="grey" variant="text" onClick={onClose} disabled={busy}>
          {t("cancel")}
        </Button>
        <Button
          color={active ? "warning" : "primary"}
          variant={active ? "outlined" : "contained"}
          disabled={!canSubmit}
          onClick={() => onSubmit({ granted: !active, method })}
        >
          {busy ? t("saving") : t(active ? "consent-sheet-revoke" : "consent-sheet-grant")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
