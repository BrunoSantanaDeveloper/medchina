"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";

import { Box, Card, CardContent, Chip, Link as MuiLink, Skeleton, Typography } from "@mui/material";

import ProductMarkdown from "@/components/product/product-markdown";
import type { KnowledgeSourceRef } from "@/lib/clinical-library";
import { trackProductEvent } from "@/lib/product-events";

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
        <ProductMarkdown>{message.content}</ProductMarkdown>

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
                {source.documentId ? (
                  // The citation opens its acervo page — the professional can
                  // read the whole document behind every [n].
                  <MuiLink
                    component={Link}
                    href={`/biblioteca/acervo/${source.documentId}`}
                    variant="body2"
                    underline="hover"
                    className="text-text-primary"
                    // Are the citations trusted at face value, or actually read?
                    onClick={() => trackProductEvent("citation.opened")}
                  >
                    {source.title}
                  </MuiLink>
                ) : (
                  <Typography variant="body2" className="text-text-primary">
                    {source.title}
                  </Typography>
                )}
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
