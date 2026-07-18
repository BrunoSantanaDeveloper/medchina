"use client";

import { Box, FormControl, FormLabel, Input, MenuItem, Select, Typography } from "@mui/material";

import NiChevronDownSmall from "@/icons/nexture/ni-chevron-down-small";

/** Display symbols for the currencies the catalog uses; unknown codes fall back to the code itself. */
export const CURRENCY_SYMBOLS: Record<string, string> = { BRL: "R$ ", USD: "$ ", EUR: "€ " };

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
}) => (
  <FormControl className={`outlined ${className}`} variant="standard" size="small" fullWidth>
    <FormLabel component="label">{label}</FormLabel>
    <Input type={type} value={value} onChange={(e) => onChange(e.target.value)} />
  </FormControl>
);

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
}) => (
  <FormControl className="outlined" variant="standard" size="small" fullWidth>
    <FormLabel component="label">{label}</FormLabel>
    <Select
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
