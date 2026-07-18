"use client";

import { useTranslations } from "next-intl";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { Box, Card, CardContent, Chip, Skeleton, Typography } from "@mui/material";

import type { KnowledgeSourceRef } from "@/lib/clinical-library";

export type ThreadMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** What grounded the answer — matches the [n] marks in the text. */
  sources?: KnowledgeSourceRef[];
};

/**
 * One message of the study chat. Assistant answers render as Markdown with
 * their retrieved sources listed underneath — the [n] marks in the text point
 * at these entries, so the professional can weigh every claim (PRD §9.9
 * "referência junto à sugestão").
 */
export default function MessageBubble({ message }: { message: ThreadMessage }) {
  const t = useTranslations("product");

  if (message.role === "user") {
    return (
      <Card className="ms-auto w-fit max-w-xs md:max-w-lg">
        <CardContent>
          <Typography variant="body1" className="whitespace-pre-line">
            {message.content}
          </Typography>
        </CardContent>
      </Card>
    );
  }

  // Streaming just started — reserve the space instead of showing a blank card.
  if (!message.content) {
    return (
      <Card className="w-full">
        <CardContent className="flex flex-col gap-2">
          <Skeleton variant="text" className="max-w-md" />
          <Skeleton variant="text" className="max-w-sm" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full">
      <CardContent>
        <Box
          className={[
            "text-text-primary text-base leading-relaxed",
            "[&_p]:mb-3 [&_p:last-child]:mb-0",
            "[&_li]:mb-1 [&_ol]:mb-3 [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:mb-3 [&_ul]:list-disc [&_ul]:pl-5",
            "[&_h1]:mb-2 [&_h1]:text-lg [&_h1]:font-semibold [&_h2]:mb-2 [&_h2]:text-base [&_h2]:font-semibold [&_h3]:mb-2 [&_h3]:text-base [&_h3]:font-semibold",
            "[&_strong]:font-semibold",
            "[&_code]:bg-grey-25 [&_code]:rounded [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-sm",
            "[&_blockquote]:border-grey-100 [&_blockquote]:text-text-secondary [&_blockquote]:mb-3 [&_blockquote]:border-l-2 [&_blockquote]:pl-4",
            "[&_th]:border-grey-100 [&_td]:border-grey-50 [&_table]:mb-3 [&_table]:w-full [&_td]:border-b [&_td]:p-2 [&_th]:border-b [&_th]:p-2 [&_th]:text-left",
          ].join(" ")}
        >
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
        </Box>

        {message.sources && message.sources.length > 0 && (
          <Box className="border-grey-100 mt-4 flex flex-col gap-2 border-t pt-3">
            <Typography variant="overline" component="h3" className="text-text-secondary">
              {t("library-sources-title")}
            </Typography>
            {message.sources.map((source) => (
              <Box key={source.index} className="flex flex-row flex-wrap items-center gap-x-2 gap-y-1">
                <Typography variant="body2" className="text-text-secondary font-mono">
                  [{source.index}]
                </Typography>
                <Typography variant="body2" className="text-text-primary">
                  {source.title}
                </Typography>
                {source.source && (
                  <Typography variant="body2" className="text-text-secondary">
                    — {source.source}
                  </Typography>
                )}
                {source.kind !== "unknown" && (
                  <Chip size="small" variant="outlined" label={t(`library-kind-${source.kind}`)} />
                )}
              </Box>
            ))}
          </Box>
        )}
      </CardContent>
    </Card>
  );
}
