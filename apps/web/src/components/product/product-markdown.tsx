"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { Box } from "@mui/material";

import { cn } from "@/lib/utils";

/**
 * Markdown rendering for product surfaces (assistant answers, acervo
 * documents) with the token-driven styles the library chat established.
 * Raw HTML in the source is NOT rendered (react-markdown default).
 */
export default function ProductMarkdown({ children, className }: { children: string; className?: string }) {
  return (
    <Box
      className={cn(
        "text-text-primary text-base leading-relaxed",
        "[&_p]:mb-3 [&_p:last-child]:mb-0",
        "[&_li]:mb-1 [&_ol]:mb-3 [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:mb-3 [&_ul]:list-disc [&_ul]:pl-5",
        "[&_h1]:mb-2 [&_h1]:text-lg [&_h1]:font-semibold [&_h2]:mb-2 [&_h2]:text-base [&_h2]:font-semibold [&_h3]:mb-2 [&_h3]:text-base [&_h3]:font-semibold",
        "[&_strong]:font-semibold",
        "[&_code]:bg-grey-25 [&_code]:rounded [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-sm",
        "[&_blockquote]:border-grey-100 [&_blockquote]:text-text-secondary [&_blockquote]:mb-3 [&_blockquote]:border-l-2 [&_blockquote]:pl-4",
        "[&_th]:border-grey-100 [&_td]:border-grey-50 [&_table]:mb-3 [&_table]:w-full [&_td]:border-b [&_td]:p-2 [&_th]:border-b [&_th]:p-2 [&_th]:text-left",
        className,
      )}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </Box>
  );
}
