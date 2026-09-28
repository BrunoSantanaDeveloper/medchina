"use client";

import { useId } from "react";

import { Box, FormControl, FormLabel, Input, MenuItem, Select, Typography } from "@mui/material";

import NiChevronDownSmall from "@/icons/nexture/ni-chevron-down-small";

/** Display symbols for the currencies the catalog uses; unknown codes fall back to the code itself. */
export const CURRENCY_SYMBOLS: Record<string, string> = { BRL: "R$ ", USD: "$ ", EUR: "€ " };

/**
 * The label is TIED to its control (htmlFor/id for an input, labelId for a
 * select) with a generated id: MUI's FormControl does not wire a sibling
 * FormLabel by itself, so without this every field here had no accessible
 * name for a screen reader or voice control.
 */
export const Field = ({
  label,
  value,
  onChange,
  type = "text",
  className = "",
}: {
  label: string;
  value: string | number;
  onChange: (value: string) => void;
  type?: string;
  className?: string;
}) => {
  const id = useId();
  return (
    <FormControl className={`outlined ${className}`} variant="standard" size="small" fullWidth>
      <FormLabel component="label" htmlFor={id}>
        {label}
      </FormLabel>
      <Input id={id} type={type} value={value} onChange={(e) => onChange(e.target.value)} />
    </FormControl>
  );
};

export const SelectField = ({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) => {
  const id = useId();
  return (
    <FormControl className="outlined" variant="standard" size="small" fullWidth>
      <FormLabel component="label" id={`${id}-label`} htmlFor={id}>
        {label}
      </FormLabel>
      <Select
        id={id}
        labelId={`${id}-label`}
        value={value}
        size="small"
        variant="standard"
        IconComponent={NiChevronDownSmall}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((option) => (
          <MenuItem key={option.value} value={option.value}>
            {option.label}
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  );
};

export const RowLine = ({ children }: { children: React.ReactNode }) => (
  <Box className="border-grey-50 flex flex-row items-center gap-3 border-b pb-3">{children}</Box>
);

export const RowText = ({ primary, secondary }: { primary: string; secondary?: string }) => (
  <Box className="flex min-w-0 grow flex-col">
    <Typography variant="subtitle2" className="truncate">
      {primary}
    </Typography>
    {secondary && (
      <Typography variant="body2" className="text-text-secondary truncate">
        {secondary}
      </Typography>
    )}
  </Box>
);
