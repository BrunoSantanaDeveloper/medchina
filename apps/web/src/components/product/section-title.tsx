import type { ReactNode } from "react";

import { Box, Typography } from "@mui/material";

import InfoHint from "@/components/product/info-hint";
import { cn } from "@/lib/utils";

/**
 * The heading of a section or of a card: its title, what it is FOR behind the
 * "i" beside it (`description`), where it stands (`chip`) and its own action
 * at the right (`action`). A screen had a heading and a paragraph under it
 * for each card, read on every visit (the owner, 2026-11-09): a definition
 * read every time is noise after the first.
 *
 * `detail` is the one line that stays in sight under the title, and only for
 * state or data that tells the thing apart (how many a list holds, who a
 * person is) or for what must be read before acting (a consequence, a legal
 * or clinical safety note, that the AI may err, personal data). Clinical
 * safety text is never behind the "i" (see `InfoHint`).
 *
 * Ported from the sibling platform's `SectionTitle`; with no `CardTitle`
 * here, it also heads a card, so it takes `detail` and the heading's size
 * (`variant`) the screens already use. Closest catalog entry: `InfoHint`,
 * which it draws.
 */
export default function SectionTitle({
  id,
  title,
  description,
  detail,
  chip,
  action,
  as = "h2",
  variant = "h5",
  className,
}: {
  /** The heading's id, when the section is labelled by it (`aria-labelledby`). */
  id?: string;
  title: string;
  /** What the section is for, behind the "i" beside the title. At most 200 characters (a test keeps it). */
  description?: string;
  /** One line under the title, shown: state or data, or what must be read before acting. Never a definition. */
  detail?: ReactNode;
  /** Where the section stands, as a chip beside the title. */
  chip?: ReactNode;
  /** The section's own action, at the right (a button, a progress ring). */
  action?: ReactNode;
  as?: "h2" | "h3" | "h4";
  /** The heading's size: h5 for a card, h4 for a section of a hub, h6 or subtitle2 inside a working screen. */
  variant?: "h4" | "h5" | "h6" | "subtitle2";
  className?: string;
}) {
  return (
    <Box className={cn("flex flex-col gap-1", className)}>
      <Box className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Typography id={id} variant={variant} component={as} className="mb-0 min-w-0 break-words">
          {title}
        </Typography>
        {description ? <InfoHint label={description} placement="bottom-start" className="self-center" /> : null}
        {chip ? <Box className="flex items-center">{chip}</Box> : null}
        {action ? <Box className="ml-auto flex items-center gap-2">{action}</Box> : null}
      </Box>
      {detail ? (
        <Typography variant="body2" component="div" className="text-text-secondary">
          {detail}
        </Typography>
      ) : null}
    </Box>
  );
}
