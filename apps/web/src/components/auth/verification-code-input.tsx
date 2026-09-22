"use client";

import { useCallback, useId, useMemo, useRef } from "react";

import { Box, FormLabel, TextField } from "@mui/material";

/**
 * The template's six-box verification field (auth/set-verification), ported.
 *
 * The shape is the template's, verbatim: six `TextField variant="standard"`
 * with the `outlined` class at `size="small"`, in a row with `gap-1 md:gap-2`,
 * one character each. What the template's inline version did NOT do, and a
 * six-digit field has to:
 *
 *  - advance to the next box as you type, and step back on Backspace from an
 *    empty one. Without it the field looks like six boxes and behaves like
 *    one, and every digit costs a click.
 *  - accept a paste anywhere in the row (an authenticator code is copied far
 *    more often than it is typed).
 *  - name itself to assistive technology. Six unlabelled boxes are announced
 *    as six anonymous text fields; each one here says which digit it is, and
 *    the row is grouped under the visible label.
 *  - ask the phone for a numeric keypad, and let the OS autofill an SMS or
 *    authenticator code into the first box (`one-time-code`).
 *
 * Controlled with a single string so the caller never juggles six pieces of
 * state: `value` is the digits typed so far, `length` the code size.
 */
export default function VerificationCodeInput({
  label,
  value,
  onChange,
  onComplete,
  length = 6,
  autoFocus,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** Fired once the last digit lands — usually to submit. */
  onComplete?: (value: string) => void;
  length?: number;
  autoFocus?: boolean;
  disabled?: boolean;
}) {
  const labelId = useId();
  const boxes = useRef<(HTMLInputElement | null)[]>([]);
  const digits = Array.from({ length }, (_, i) => value[i] ?? "");

  // One STABLE setter per box. An inline `inputRef={(el) => ...}` is a new
  // function on every render, so React detaches (null) and re-attaches the ref
  // each time the value changes — and a focus call that lands in that window
  // hits null and the caret disappears. Measured: two Backspaces cleared the
  // whole code and left nothing focused.
  const setBox = useMemo(
    () =>
      Array.from({ length }, (_, index) => (el: HTMLInputElement | null) => {
        boxes.current[index] = el;
      }),
    [length],
  );

  const commit = useCallback(
    (next: string) => {
      const clean = next.replace(/\D/g, "").slice(0, length);
      onChange(clean);
      if (clean.length === length) onComplete?.(clean);
      return clean;
    },
    [length, onChange, onComplete],
  );

  // The move runs after React has painted the new value, so the caret lands on
  // a box that exists.
  const focusBox = useCallback(
    (index: number) => {
      const at = Math.max(0, Math.min(length - 1, index));
      requestAnimationFrame(() => {
        const target = boxes.current[at];
        target?.focus();
        target?.select();
      });
    },
    [length],
  );

  return (
    <Box className="flex flex-col">
      <FormLabel component="label" id={labelId} htmlFor={`${labelId}-0`}>
        {label}
      </FormLabel>
      {/* `group` + the visible label: a screen reader reads "Código, grupo"
          before the first box instead of six loose fields. */}
      <Box role="group" aria-labelledby={labelId} className="flex flex-row gap-1 md:gap-2">
        {digits.map((digit, index) => (
          <TextField
            key={index}
            id={`${labelId}-${index}`}
            variant="standard"
            className="outlined"
            size="small"
            value={digit}
            disabled={disabled}
            autoFocus={autoFocus && index === 0}
            inputRef={setBox[index]}
            onPaste={(event) => {
              event.preventDefault();
              const pasted = event.clipboardData.getData("text/plain");
              const next = commit((value.slice(0, index) + pasted).slice(0, length));
              focusBox(next.length);
            }}
            onChange={(event) => {
              // A box already holding a digit replaces it rather than appending,
              // so overtyping a wrong digit works the way it looks like it does.
              const typed = event.target.value.replace(/\D/g, "");
              if (!typed) return;
              commit(value.slice(0, index) + typed + value.slice(index + typed.length));
              focusBox(index + typed.length);
            }}
            onKeyDown={(event) => {
              if (event.key === "Backspace") {
                event.preventDefault();
                if (digits[index]) {
                  commit(value.slice(0, index) + value.slice(index + 1));
                  return;
                }
                commit(value.slice(0, index - 1) + value.slice(index));
                focusBox(index - 1);
                return;
              }
              if (event.key === "ArrowLeft") {
                event.preventDefault();
                focusBox(index - 1);
              }
              if (event.key === "ArrowRight") {
                event.preventDefault();
                focusBox(index + 1);
              }
            }}
            slotProps={{
              htmlInput: {
                maxLength: 1,
                inputMode: "numeric",
                // Only the first box claims the OTP, or the OS offers to fill
                // all six with the same code.
                autoComplete: index === 0 ? "one-time-code" : "off",
                "aria-label": `${label} — ${index + 1} de ${length}`,
                className: "text-center",
              },
            }}
          />
        ))}
      </Box>
    </Box>
  );
}
