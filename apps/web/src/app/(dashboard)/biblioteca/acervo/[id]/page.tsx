"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";

import { Alert, Box, Breadcrumbs, Button, Card, CardContent, Chip, Skeleton, Typography } from "@mui/material";

import EmptyState from "@/components/product/empty-state";
import ProductMarkdown from "@/components/product/product-markdown";
import NiBook from "@/icons/nexture/ni-book";
import { COLLECTION_KIND } from "@/lib/clinical-library";
import { isSupabaseConfigured } from "@flyee/auth";
import { createClient } from "@flyee/auth/client";
import { remoteEmpty, remoteError, remoteLoading, type RemoteState, remoteSuccess } from "@flyee/clinical";

type AcervoDocument = {
  title: string;
  content: string;
  source: string | null;
  kind: "traditional" | "protocol" | "evidence" | "unknown";
};

/**
 * One acervo document: the full reference card, with its attribution — the
 * reading room behind every [n] citation of the chat. Not browsable (or
 * missing) is an honest "unavailable" state (the licensing kill-switch),
 * never a raw error.
 */
export default function AcervoDocumento() {
  const t = useTranslations("product");
  const params = useParams<{ id: string }>();
  const [state, setState] = useState<RemoteState<AcervoDocument, string>>(() => remoteLoading());

  const load = useCallback(async () => {
    setState(remoteLoading());
    if (!isSupabaseConfigured || !params.id) {
      setState(remoteEmpty());
      return;
    }
    const supabase = createClient();
    const { data, error } = await supabase
      .from("knowledge_documents")
      .select("title, content, source, knowledge_collections!inner(slug, browsable)")
      .eq("id", params.id)
      .maybeSingle();
    if (error) {
      setState(remoteError(error.message));
      return;
    }
    const collection = data?.knowledge_collections as unknown as { slug?: string; browsable?: boolean } | null;
    if (!data || !collection?.browsable) {
      // Unknown id and unlisted collection look the same on purpose.
      setState(remoteEmpty());
      return;
    }
    // The card's own "# title" heading would duplicate the page h1; and the
    // cards separate list-like lines with SINGLE newlines, which Markdown
    // would collapse — turn them into hard breaks so each item keeps its line.
    const content = (data.content as string).replace(/^#\s+[^\n]*\n+/, "").replace(/(\S)\n(?!\n)/g, "$1  \n");
    setState(
      remoteSuccess({
        title: data.title as string,
        content,
        source: (data.source as string | null) ?? null,
        kind: COLLECTION_KIND[collection.slug ?? ""] ?? "unknown",
      }),
    );
  }, [params.id]);

  useEffect(() => {
    load();
  }, [load]);

  const doc = state.status === "success" ? state.data : null;

  return (
    <Box className="mx-auto flex w-full max-w-3xl flex-col gap-5">
      <Box>
        <Typography variant="h1" component="h1" className="mb-0">
          {doc?.title ?? t("acervo-title")}
        </Typography>
        <Breadcrumbs>
          <Link color="inherit" href="/inicio">
            {t("home-breadcrumb")}
          </Link>
          <Link color="inherit" href="/biblioteca">
            {t("library-title")}
          </Link>
          <Link color="inherit" href="/biblioteca/acervo">
            {t("acervo-title")}
          </Link>
          {doc && <Typography variant="body2">{doc.title}</Typography>}
        </Breadcrumbs>
      </Box>

      {state.status === "error" ? (
        <Alert severity="error" action={<Button onClick={load}>{t("retry")}</Button>}>
          {state.error}
        </Alert>
      ) : state.status === "idle" || state.status === "loading" ? (
        <Skeleton variant="rounded" height={360} className="rounded-3xl" />
      ) : state.status === "empty" || !doc ? (
        <EmptyState
          icon={<NiBook />}
          title={t("acervo-unavailable-title")}
          description={t("acervo-unavailable-body")}
          action={{ label: t("acervo-back"), href: "/biblioteca/acervo" }}
        />
      ) : (
        <>
          <Card component="article">
            <CardContent className="flex flex-col gap-4">
              <Box className="flex flex-row flex-wrap items-center gap-2">
                {doc.kind !== "unknown" && (
                  <Chip size="small" variant="outlined" label={t(`library-kind-${doc.kind}`)} />
                )}
                {doc.source && (
                  <Typography variant="body2" className="text-text-secondary">
                    {t("acervo-source", { source: doc.source })}
                  </Typography>
                )}
              </Box>
              <ProductMarkdown>{doc.content}</ProductMarkdown>
            </CardContent>
          </Card>

          <Typography variant="body2" className="text-text-secondary">
            {t("acervo-subtitle")}
          </Typography>

          <Box className="flex flex-row flex-wrap gap-2">
            <Button variant="outlined" color="grey" href="/biblioteca/acervo" LinkComponent={Link}>
              {t("acervo-back")}
            </Button>
            <Button variant="contained" color="primary" href="/biblioteca" LinkComponent={Link}>
              {t("acervo-ask")}
            </Button>
          </Box>
        </>
      )}
    </Box>
  );
}
