"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  Alert,
  Box,
  Breadcrumbs,
  Button,
  Card,
  CardContent,
  Chip,
  Input,
  Skeleton,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";

import EmptyState from "@/components/product/empty-state";
import NiBook from "@/icons/nexture/ni-book";
import NiSearch from "@/icons/nexture/ni-search";
import { normalizePatientName as normalize } from "@/lib/patients";
import { isSupabaseConfigured } from "@flyee/auth";
import { createClient } from "@flyee/auth/client";
import { remoteEmpty, remoteError, remoteLoading, type RemoteState, remoteSuccess } from "@flyee/clinical";

type AcervoDoc = {
  id: string;
  title: string;
  kind: string;
  code: string | null;
  pinyin: string | null;
  meridian: string | null;
};

const KIND_FILTERS = ["all", "acupuncture_point", "herbal_formula", "tung_point"] as const;
type KindFilter = (typeof KIND_FILTERS)[number];
const KIND_LABEL_KEY: Record<string, string> = {
  acupuncture_point: "acervo-kind-points",
  herbal_formula: "acervo-kind-formulas",
  tung_point: "acervo-kind-tung",
};

/** "ID11" → "ID", "EX - CP 5" → "EX", "B35" → "B". */
const meridianOf = (code: string | null): string | null => {
  const match = code?.trim().match(/^[A-Za-z]+/);
  return match ? match[0].toUpperCase() : null;
};

/**
 * The browsable acervo (fase 4, safeguards in docs/LICENSING-LIBRARY.md).
 * The job: find the reference card for a point or formula in seconds — so
 * everything loads once and search/facets filter instantly, offline of any
 * AI. Reading is the value; the chat stays one click away.
 */
export default function Acervo() {
  const t = useTranslations("product");
  const [docsState, setDocsState] = useState<RemoteState<AcervoDoc[], string>>(() => remoteLoading());
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<KindFilter>("all");
  const [meridian, setMeridian] = useState<string | null>(null);

  const load = useCallback(async () => {
    setDocsState(remoteLoading());
    if (!isSupabaseConfigured) {
      setDocsState(remoteEmpty());
      return;
    }
    const supabase = createClient();
    const { data, error } = await supabase
      .from("knowledge_documents")
      .select("id, title, metadata, knowledge_collections!inner(browsable)")
      .eq("knowledge_collections.browsable", true)
      .order("title");
    if (error) {
      setDocsState(remoteError(error.message));
      return;
    }
    const docs = (data ?? []).map((row) => {
      const metadata = (row.metadata ?? {}) as { kind?: string; code?: string; pinyin?: string };
      return {
        id: row.id as string,
        title: row.title as string,
        kind: metadata.kind ?? "unknown",
        code: metadata.code ?? null,
        pinyin: metadata.pinyin ?? null,
        meridian: metadata.kind === "acupuncture_point" ? meridianOf(metadata.code ?? null) : null,
      };
    });
    setDocsState(docs.length === 0 ? remoteEmpty() : remoteSuccess(docs));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const docs = useMemo(() => (docsState.status === "success" ? docsState.data : []), [docsState]);

  const kindCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const doc of docs) counts[doc.kind] = (counts[doc.kind] ?? 0) + 1;
    return counts;
  }, [docs]);

  const meridians = useMemo(() => {
    const counts = new Map<string, number>();
    for (const doc of docs) {
      if (doc.meridian) counts.set(doc.meridian, (counts.get(doc.meridian) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [docs]);

  const filtered = useMemo(() => {
    const q = normalize(query.trim());
    return docs.filter((doc) => {
      if (kind !== "all" && doc.kind !== kind) return false;
      if (kind === "acupuncture_point" && meridian && doc.meridian !== meridian) return false;
      if (!q) return true;
      return [doc.title, doc.code ?? "", doc.pinyin ?? ""].some((field) => normalize(field).includes(q));
    });
  }, [docs, query, kind, meridian]);

  const clearFilters = () => {
    setQuery("");
    setKind("all");
    setMeridian(null);
  };

  return (
    <Box className="flex flex-col gap-5">
      <Box>
        <Typography variant="h1" component="h1" className="mb-0">
          {t("acervo-title")}
        </Typography>
        <Breadcrumbs>
          <Link color="inherit" href="/inicio">
            {t("home-breadcrumb")}
          </Link>
          <Link color="inherit" href="/biblioteca">
            {t("library-title")}
          </Link>
          <Typography variant="body2">{t("acervo-title")}</Typography>
        </Breadcrumbs>
      </Box>

      <Typography variant="body1" className="text-text-secondary max-w-3xl">
        {t("acervo-subtitle")}
      </Typography>

      <Card component="section">
        <CardContent className="flex flex-col gap-4">
          {docsState.status === "error" ? (
            <Alert severity="error" action={<Button onClick={load}>{t("retry")}</Button>}>
              {docsState.error}
            </Alert>
          ) : docsState.status === "idle" || docsState.status === "loading" ? (
            <Skeleton variant="rounded" height={280} className="rounded-3xl" />
          ) : docsState.status === "empty" ? (
            <EmptyState
              icon={<NiBook />}
              title={t("acervo-unavailable-title")}
              description={t("acervo-unavailable-body")}
              action={{ label: t("library-title"), href: "/biblioteca" }}
            />
          ) : (
            <>
              <Box className="border-grey-100 flex flex-row items-center gap-2 rounded-2xl border px-3 py-1.5">
                <NiSearch size="small" className="text-text-secondary" />
                <Input
                  fullWidth
                  disableUnderline
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t("acervo-search-placeholder")}
                  inputProps={{ "aria-label": t("acervo-search-label") }}
                />
              </Box>

              <Box className="flex flex-row flex-wrap items-center gap-3">
                <ToggleButtonGroup
                  exclusive
                  size="small"
                  value={kind}
                  onChange={(_event, value: KindFilter | null) => {
                    if (!value) return;
                    setKind(value);
                    if (value !== "acupuncture_point") setMeridian(null);
                  }}
                  aria-label={t("acervo-kind-label")}
                >
                  <ToggleButton value="all">{t("acervo-kind-all", { count: docs.length })}</ToggleButton>
                  {KIND_FILTERS.filter((value) => value !== "all" && (kindCounts[value] ?? 0) > 0).map((value) => (
                    <ToggleButton key={value} value={value}>
                      {t(KIND_LABEL_KEY[value], { count: kindCounts[value] ?? 0 })}
                    </ToggleButton>
                  ))}
                </ToggleButtonGroup>
              </Box>

              {kind === "acupuncture_point" && meridians.length > 0 && (
                <Box className="flex flex-row flex-wrap items-center gap-1.5" aria-label={t("acervo-meridian-label")}>
                  <Typography variant="body2" className="text-text-secondary">
                    {t("acervo-meridian-label")}
                  </Typography>
                  {meridians.map(([prefix, count]) => (
                    <Chip
                      key={prefix}
                      size="small"
                      label={`${prefix} (${count})`}
                      variant={meridian === prefix ? "filled" : "outlined"}
                      color={meridian === prefix ? "primary" : "default"}
                      onClick={() => setMeridian(meridian === prefix ? null : prefix)}
                    />
                  ))}
                </Box>
              )}

              {filtered.length === 0 ? (
                <EmptyState
                  icon={<NiSearch />}
                  title={t("acervo-empty-title")}
                  description={t("acervo-empty-body")}
                  action={{ label: t("acervo-clear-filters"), onClick: clearFilters }}
                />
              ) : (
                <>
                  <Typography variant="body2" className="text-text-secondary">
                    {t("acervo-count", { count: filtered.length })}
                  </Typography>
                  <Box component="ul" className="m-0 grid list-none gap-1 p-0 sm:grid-cols-2 lg:grid-cols-3">
                    {filtered.map((doc) => (
                      <Box component="li" key={doc.id}>
                        <Button
                          color="grey"
                          variant="text"
                          className="w-full justify-start text-start"
                          href={`/biblioteca/acervo/${doc.id}`}
                          LinkComponent={Link}
                        >
                          <Typography variant="body2" className="text-text-primary truncate">
                            {doc.title}
                          </Typography>
                        </Button>
                      </Box>
                    ))}
                  </Box>
                </>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </Box>
  );
}
