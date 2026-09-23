"use client";

import type { ReactNode } from "react";

import { Box, DialogTitle, IconButton, Typography } from "@mui/material";

import NiCross from "@/icons/nexture/ni-cross";
import { cn } from "@/lib/utils";

/**
 * One header for every product dialog: title, optional status chips, and an
 * explicit CLOSE affordance.
 *
 * The X matters more here than in a generic app. These dialogs are opened from
 * the middle of a consultation (transcript, hypotheses, plan) and the escape
 * hatch used to be a "Fechar" button parked at the bottom of long, scrollable
 * content — so leaving required scrolling back down. The corner control is
 * always in the same place, whatever the content length.
 */
export default function DialogHeader({
  id,
  title,
  onClose,
  closeLabel,
  trailing,
  className,
}: {
  /**
   * Id for the title element, so the Dialog can point `aria-labelledby` at it.
   *
   * Without it a caller has no element to name the dialog by, and pointing
   * `aria-labelledby` at an id that is never rendered leaves the dialog with NO
   * accessible name at all — which is worse than omitting the attribute,
   * because it looks handled. Every hand-rolled dialog in this repo pairs the
   * two (`consent-sheet`, `consent-collection-dialog`, `command-palette`); this
   * lets the shared header do the same.
   */
  id?: string;
  title: string;
  onClose: () => void;
  /** Accessible name for the close control (icon-only button). */
  closeLabel: string;
  /** Chips/status that belong beside the title, never actions. */
  trailing?: ReactNode;
  className?: string;
}) {
  return (
    <DialogTitle id={id} className={cn("flex flex-row items-start gap-3 pr-3!", className)}>
      <Box className="flex min-w-0 flex-1 flex-row flex-wrap items-center gap-2">
        <Typography variant="h5" component="span" className="mb-0 leading-tight">
          {title}
        </Typography>
        {trailing}
      </Box>
      <IconButton size="small" color="grey" aria-label={closeLabel} onClick={onClose} className="-mt-0.5 flex-none">
        <NiCross size="small" />
      </IconButton>
    </DialogTitle>
  );
}
