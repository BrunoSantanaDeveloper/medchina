"use client";

import { Field, RowLine, RowText, SelectField } from "../../billing/components/catalog-shared";
import { ingestDocument } from "../actions";
import { useCallback, useEffect, useState } from "react";

import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  FormLabel,
  TextareaAutosize,
  Tooltip,
  Typography,
} from "@mui/material";

import NiBinEmpty from "@/icons/nexture/ni-bin-empty";
import NiPen from "@/icons/nexture/ni-pen";
import NiPlus from "@/icons/nexture/ni-plus";
import NiRefresh from "@/icons/nexture/ni-refresh";
import { createClient } from "@flyee/auth/client";
import { TRUST_LEVEL_LABELS } from "@flyee/knowledge";

type CollectionRow = { id: string; slug: string; name: string; description: string | null };
type DocumentRow = {
  id: string;
  title: string;
  source: string | null;
  trust_level: number;
  status: string;
  error: string | null;
};

type CollectionForm = { id?: string; slug: string; name: string; description: string };
type DocumentForm = { id?: string; title: string; source: string; trust_level: number; content: string };

const EMPTY_COLLECTION: CollectionForm = { slug: "", name: "", description: "" };
const EMPTY_DOCUMENT: DocumentForm = { title: "", source: "", trust_level: 5, content: "" };

const TRUST_OPTIONS = Object.entries(TRUST_LEVEL_LABELS).map(([value, label]) => ({
  value,
  label: `${value} — ${label}`,
}));

const STATUS_COLOR: Record<string, "default" | "success" | "warning" | "error"> = {
  pending: "warning",
  processing: "warning",
  ready: "success",
  error: "error",
};

export default function KnowledgeAdmin() {
  const [collections, setCollections] = useState<CollectionRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [documents, setDocuments] = useState<DocumentRow[]>([]);
  const [collectionForm, setCollectionForm] = useState<CollectionForm | null>(null);
  const [documentForm, setDocumentForm] = useState<DocumentForm | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refreshCollections = useCallback(async () => {
    const supabase = createClient();
    // Superadmin console manages global collections (org_id null).
    const { data } = await supabase
      .from("knowledge_collections")
      .select("id, slug, name, description")
      .is("org_id", null)
      .order("name");
    setCollections(data ?? []);
    setSelectedId((current) => current ?? data?.[0]?.id ?? null);
  }, []);

  const refreshDocuments = useCallback(async (collectionId: string | null) => {
    if (!collectionId) {
      setDocuments([]);
      return;
    }
    const supabase = createClient();
    const { data } = await supabase
      .from("knowledge_documents")
      .select("id, title, source, trust_level, status, error")
      .eq("collection_id", collectionId)
      .order("created_at");
    setDocuments(data ?? []);
  }, []);

  useEffect(() => {
    refreshCollections();
  }, [refreshCollections]);

  useEffect(() => {
    refreshDocuments(selectedId);
  }, [selectedId, refreshDocuments]);

  const saveCollection = async () => {
    if (!collectionForm) return;
    setError(null);
    const supabase = createClient();
    const { error: saveError } = await supabase.from("knowledge_collections").upsert({
      ...(collectionForm.id ? { id: collectionForm.id } : {}),
      org_id: null,
      slug: collectionForm.slug.trim(),
      name: collectionForm.name.trim(),
      description: collectionForm.description || null,
    });
    if (saveError) {
      setError(saveError.message);
      return;
    }
    setCollectionForm(null);
    refreshCollections();
  };

  const deleteCollection = async (id: string) => {
    setError(null);
    const supabase = createClient();
    const { error: deleteError } = await supabase.from("knowledge_collections").delete().eq("id", id);
    if (deleteError) setError(deleteError.message);
    if (selectedId === id) setSelectedId(null);
    refreshCollections();
  };

  const saveDocument = async () => {
    if (!documentForm || !selectedId) return;
    setError(null);
    if (!documentForm.content.trim()) {
      setError("Content is required — it is what gets chunked and embedded.");
      return;
    }
    setBusy(true);
    try {
      const supabase = createClient();
      const { data: saved, error: saveError } = await supabase
        .from("knowledge_documents")
        .upsert({
          ...(documentForm.id ? { id: documentForm.id } : {}),
          collection_id: selectedId,
          title: documentForm.title.trim() || "Untitled",
          source: documentForm.source || null,
          trust_level: documentForm.trust_level,
          content: documentForm.content,
          status: "pending",
          error: null,
        })
        .select("id")
        .single();
      if (saveError || !saved) {
        setError(saveError?.message ?? "Save failed.");
        return;
      }
      setDocumentForm(null);
      const result = await ingestDocument(saved.id);
      if (!result.ok) setError(result.error);
      refreshDocuments(selectedId);
    } finally {
      setBusy(false);
    }
  };

  const reindexDocument = async (id: string) => {
    setError(null);
    const result = await ingestDocument(id);
    if (!result.ok) setError(result.error);
    refreshDocuments(selectedId);
  };

  const deleteDocument = async (id: string) => {
    setError(null);
    const supabase = createClient();
    const { error: deleteError } = await supabase.from("knowledge_documents").delete().eq("id", id);
    if (deleteError) setError(deleteError.message);
    refreshDocuments(selectedId);
  };

  const editDocument = async (row: DocumentRow) => {
    const supabase = createClient();
    const { data } = await supabase.from("knowledge_documents").select("content").eq("id", row.id).maybeSingle();
    setDocumentForm({
      id: row.id,
      title: row.title,
      source: row.source ?? "",
      trust_level: row.trust_level,
      content: data?.content ?? "",
    });
  };

  return (
    <Box className="flex flex-col gap-3">
      <Box className="flex flex-row flex-wrap items-center gap-2">
        {collections.map((collection) => (
          <Chip
            key={collection.id}
            label={collection.name}
            variant={collection.id === selectedId ? "filled" : "outlined"}
            color={collection.id === selectedId ? "primary" : "default"}
            onClick={() => setSelectedId(collection.id)}
          />
        ))}
        <Button
          variant="outlined"
          size="small"
          color="grey"
          startIcon={<NiPlus size="small" />}
          onClick={() => setCollectionForm(EMPTY_COLLECTION)}
        >
          New collection
        </Button>
      </Box>

      {selectedId && (
        <>
          <Divider className="my-1" />
          <Box className="flex flex-row items-center gap-2">
            <Typography variant="h6" className="flex-1">
              Documents
            </Typography>
            <Button
              variant="outlined"
              size="small"
              color="grey"
              startIcon={<NiPen size="small" />}
              onClick={() => {
                const collection = collections.find((item) => item.id === selectedId);
                if (collection) setCollectionForm({ ...collection, description: collection.description ?? "" });
              }}
            >
              Edit collection
            </Button>
            <Button
              variant="outlined"
              size="small"
              color="grey"
              startIcon={<NiPlus size="small" />}
              onClick={() => setDocumentForm(EMPTY_DOCUMENT)}
            >
              New document
            </Button>
          </Box>

          {documents.map((row) => (
            <RowLine key={row.id}>
              <RowText
                primary={row.title}
                secondary={`trust ${row.trust_level} — ${TRUST_LEVEL_LABELS[row.trust_level as 1 | 2 | 3 | 4 | 5]}${row.source ? ` · ${row.source}` : ""}${row.error ? ` · ${row.error}` : ""}`}
              />
              <Chip label={row.status} size="small" variant="outlined" color={STATUS_COLOR[row.status] ?? "default"} />
              <Tooltip title="Re-index">
                <Button
                  className="icon-only"
                  size="small"
                  color="grey"
                  variant="text"
                  onClick={() => reindexDocument(row.id)}
                >
                  <NiRefresh size="medium" />
                </Button>
              </Tooltip>
              <Tooltip title="Edit">
                <Button
                  className="icon-only"
                  size="small"
                  color="grey"
                  variant="text"
                  onClick={() => editDocument(row)}
                >
                  <NiPen size="medium" />
                </Button>
              </Tooltip>
              <Tooltip title="Delete">
                <Button
                  className="icon-only"
                  size="small"
                  color="grey"
                  variant="text"
                  onClick={() => deleteDocument(row.id)}
                >
                  <NiBinEmpty size="medium" />
                </Button>
              </Tooltip>
            </RowLine>
          ))}
          {documents.length === 0 && (
            <Typography variant="body2" className="text-text-secondary">
              No documents yet. Add content and it will be chunked + embedded automatically.
            </Typography>
          )}
        </>
      )}

      {error && (
        <Alert severity="error" className="neutral bg-background-paper/60!">
          {error}
        </Alert>
      )}

      {/* Collection dialog */}
      <Dialog open={collectionForm !== null} onClose={() => setCollectionForm(null)} maxWidth="sm" fullWidth>
        <DialogTitle>{collectionForm?.id ? "Edit collection" : "New collection"}</DialogTitle>
        {collectionForm && (
          <DialogContent className="flex flex-col">
            <Field
              label="Name"
              value={collectionForm.name}
              onChange={(v) => setCollectionForm({ ...collectionForm, name: v })}
            />
            <Field
              label="Slug (referenced by assistants' config.knowledge.collections)"
              value={collectionForm.slug}
              onChange={(v) => setCollectionForm({ ...collectionForm, slug: v })}
            />
            <Field
              label="Description"
              value={collectionForm.description}
              onChange={(v) => setCollectionForm({ ...collectionForm, description: v })}
            />
            {collectionForm.id && (
              <Button
                color="error"
                variant="text"
                size="small"
                className="self-start"
                onClick={() => {
                  deleteCollection(collectionForm.id!);
                  setCollectionForm(null);
                }}
              >
                Delete collection (and all its documents)
              </Button>
            )}
          </DialogContent>
        )}
        <DialogActions>
          <Button color="grey" variant="text" onClick={() => setCollectionForm(null)}>
            Cancel
          </Button>
          <Button variant="contained" onClick={saveCollection}>
            Save
          </Button>
        </DialogActions>
      </Dialog>

      {/* Document dialog */}
      <Dialog open={documentForm !== null} onClose={() => setDocumentForm(null)} maxWidth="md" fullWidth>
        <DialogTitle>{documentForm?.id ? "Edit document" : "New document"}</DialogTitle>
        {documentForm && (
          <DialogContent className="flex flex-col">
            <Field
              label="Title"
              value={documentForm.title}
              onChange={(v) => setDocumentForm({ ...documentForm, title: v })}
            />
            <Field
              label="Source (URL or reference, informational)"
              value={documentForm.source}
              onChange={(v) => setDocumentForm({ ...documentForm, source: v })}
            />
            <SelectField
              label="Trust level"
              value={String(documentForm.trust_level)}
              options={TRUST_OPTIONS}
              onChange={(v) => setDocumentForm({ ...documentForm, trust_level: Number(v) })}
            />
            <FormControl className="outlined" variant="standard" size="small" fullWidth>
              <FormLabel component="label">Content (chunked + embedded on save)</FormLabel>
              <TextareaAutosize
                minRows={10}
                className="MuiInputBase-root MuiInput-root w-full"
                value={documentForm.content}
                onChange={(e) => setDocumentForm({ ...documentForm, content: e.target.value })}
              />
            </FormControl>
          </DialogContent>
        )}
        <DialogActions>
          <Button color="grey" variant="text" onClick={() => setDocumentForm(null)}>
            Cancel
          </Button>
          <Button variant="contained" onClick={saveDocument} disabled={busy}>
            {busy ? "Indexing..." : "Save & index"}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
