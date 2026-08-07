"use client";

import { useTranslations } from "next-intl";

import {
  Alert,
  Box,
  FormControl,
  FormLabel,
  MenuItem,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";

import NiChevronDownSmall from "@/icons/nexture/ni-chevron-down-small";
import type { DateColumnVerdict, DateOrder } from "@/lib/import";
import { type ColumnMapping, type ImportFieldKey, type ParsedTable } from "@/lib/import";

const NONE = "";

/**
 * Step 2 of the import: the professional confirms what each column IS.
 *
 * Two things earn their place here. The sample rows, because a mapping is
 * abstract until you see her own patients under it — this is the one screen in
 * the app where a table IS the job. And the date question, which is asked only
 * when the file cannot answer it: a column proving nothing about day-vs-month
 * order must never be resolved by a default.
 */
export default function ImportMappingStep({
  table,
  fields,
  dateField,
  requiredField,
  mapping,
  surnameColumn,
  dateVerdict,
  dateOrder,
  dateSample,
  onMappingChange,
  onSurnameChange,
  onDateOrderChange,
}: {
  table: ParsedTable;
  /** The fields THIS kind of import can fill, in mapping priority order. */
  fields: readonly ImportFieldKey[];
  /** Which mapped column carries dates, so the order question finds it. */
  dateField: ImportFieldKey;
  /** The one field an import of this kind is useless without. */
  requiredField: ImportFieldKey;
  mapping: ColumnMapping;
  /** Patients only: exports that split the name in two. */
  surnameColumn?: number;
  dateVerdict: DateColumnVerdict | null;
  dateOrder?: DateOrder;
  dateSample: string;
  onMappingChange: (field: ImportFieldKey, index: number | null) => void;
  onSurnameChange?: (index: number | null) => void;
  onDateOrderChange: (order: DateOrder) => void;
}) {
  const t = useTranslations("product");

  const columnOptions = table.headers.map((header, index) => ({
    value: String(index),
    label: header || t("import-column-unnamed", { position: index + 1 }),
  }));

  const renderSelect = (label: string, value: number | undefined, onChange: (index: number | null) => void) => (
    <FormControl className="outlined" variant="standard" size="small" fullWidth>
      <FormLabel component="label">{label}</FormLabel>
      <Select
        value={value === undefined ? NONE : String(value)}
        size="small"
        variant="standard"
        IconComponent={NiChevronDownSmall}
        inputProps={{ "aria-label": label }}
        onChange={(event) => onChange(event.target.value === NONE ? null : Number(event.target.value))}
      >
        <MenuItem value={NONE}>{t("import-column-none")}</MenuItem>
        {columnOptions.map((option) => (
          <MenuItem key={option.value} value={option.value}>
            {option.label}
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  );

  const mappedFields = fields.filter((field) => mapping[field] !== undefined);
  const sampleRows = table.rows.slice(0, 5);
  const askForDateOrder = mapping[dateField] !== undefined && dateVerdict?.ambiguous === true;

  return (
    <Box className="flex flex-col gap-6">
      <Box className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {fields.map((field) =>
          field === "full_name" && onSurnameChange ? (
            <Box key={field} className="flex flex-col gap-4 sm:col-span-2 sm:flex-row">
              <Box className="flex-1">
                {renderSelect(t("import-field-full_name"), mapping.full_name, (index) =>
                  onMappingChange("full_name", index),
                )}
              </Box>
              <Box className="flex-1">{renderSelect(t("import-field-surname"), surnameColumn, onSurnameChange)}</Box>
            </Box>
          ) : (
            <Box key={field}>
              {renderSelect(t(`import-field-${field}`), mapping[field], (index) => onMappingChange(field, index))}
            </Box>
          ),
        )}
      </Box>

      {mapping[requiredField] === undefined && (
        <Alert severity="warning">{t(`import-map-required-${requiredField}`)}</Alert>
      )}

      {askForDateOrder && (
        <Box className="border-grey-100 flex flex-col gap-3 rounded-2xl border p-4">
          <Box className="flex flex-col gap-1">
            <Typography variant="body1" className="text-text-primary font-medium">
              {t("import-date-title")}
            </Typography>
            <Typography variant="body2" className="text-text-secondary">
              {dateVerdict?.reason === "conflicting"
                ? t("import-date-conflicting")
                : t("import-date-hint", { sample: dateSample })}
            </Typography>
          </Box>
          <ToggleButtonGroup
            exclusive
            size="small"
            value={dateOrder ?? null}
            aria-label={t("import-date-title")}
            onChange={(_, value) => value && onDateOrderChange(value as DateOrder)}
            className="self-start"
          >
            <ToggleButton value="dmy">{t("import-date-dmy")}</ToggleButton>
            <ToggleButton value="mdy">{t("import-date-mdy")}</ToggleButton>
          </ToggleButtonGroup>
        </Box>
      )}

      {mapping[dateField] !== undefined && !askForDateOrder && dateVerdict?.order && (
        <Typography variant="body2" className="text-text-secondary">
          {t("import-date-resolved", { order: t(`import-order-${dateVerdict.order}`) })}
        </Typography>
      )}

      <Box className="flex flex-col gap-2">
        <Typography variant="body2" className="text-text-secondary">
          {t("import-sample")}
        </Typography>
        <Box className="border-grey-100 overflow-x-auto rounded-2xl border">
          <Table size="small">
            <TableHead>
              <TableRow>
                {mappedFields.map((field) => (
                  <TableCell key={field}>{t(`import-field-${field}`)}</TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {sampleRows.map((row, index) => (
                <TableRow key={index}>
                  {mappedFields.map((field) => (
                    <TableCell key={field}>
                      {field === "full_name" && surnameColumn !== undefined
                        ? [row[mapping.full_name ?? -1], row[surnameColumn]].filter(Boolean).join(" ")
                        : (row[mapping[field] ?? -1] ?? "")}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
      </Box>
    </Box>
  );
}
