"use client";

import { Field, SelectField } from "../../billing/components/catalog-shared";
import { ingestDocument } from "../actions";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormLabel,
  Switch,
  TextareaAutosize,
  Tooltip,
  Typography,
} from "@mui/material";
import { GridActionsCellItem, type GridColDef, type GridRenderCellParams } from "@mui/x-data-grid";

import DataTable from "@/components/data-grid/data-table";
import EmptyState from "@/components/product/empty-state";
import NiBinEmpty from "@/icons/nexture/ni-bin-empty";
import NiBook from "@/icons/nexture/ni-book";
import NiDocumentFull from "@/icons/nexture/ni-document-full";
import NiPen from "@/icons/nexture/ni-pen";
import NiPlus from "@/icons/nexture/ni-plus";
import NiRefresh from "@/icons/nexture/ni-refresh";
import { createClient } from "@flyee/auth/client";
import { TRUST_LEVEL_LABELS } from "@flyee/knowledge";

type CollectionRow = { id: string; slug: string; name: string; description: string | null; browsable: boolean };
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

/** The old row's secondary line kept the trust level readable, not just numeric. */
const trustLabel = (level: number) => `${level} — ${TRUST_LEVEL_LABELS[level as 1 | 2 | 3 | 4 | 5]}`;

export default function KnowledgeAdmin() {
  const [collections, setCollections] = useState<CollectionRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [documents, setDocuments] = useState<DocumentRow[]>([]);
  const [collectionForm, setCollectionForm] = useState<CollectionForm | null>(null);
  const [documentForm, setDocumentForm] = useState<DocumentForm | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [collectionsLoaded, setCollectionsLoaded] = useState(false);
  const [collectionsFailed, setCollectionsFailed] = useState(false);
  const [documentsLoaded, setDocumentsLoaded] = useState(false);
  const [documentsFailed, setDocumentsFailed] = useState(false);

  const refreshCollections = useCallback(async () => {
    const supabase = createClient();
    // Superadmin console manages global collections (org_id null).
    const { data, error: readError } = await supabase
      .from("knowledge_collections")
      .select("id, slug, name, description, browsable")
      .is("org_id", null)
      .order("name");
    if (readError) {
      // A failed read is an error, never an empty-looking table.
      setError(readError.message);
      setCollectionsFailed(true);
      setCollectionsLoaded(true);
      return;
    }
    setCollections(data ?? []);
    setSelectedId((current) => current ?? data?.[0]?.id ?? null);
    setCollectionsFailed(false);
    setCollectionsLoaded(true);
  }, []);

  const refreshDocuments = useCallback(async (collectionId: string | null) => {
    if (!collectionId) {
      setDocuments([]);
      setDocumentsFailed(false);
      setDocumentsLoaded(true);
      return;
    }
    setDocumentsLoaded(false);
    const supabase = createClient();
    const { data, error: readError } = await supabase
      .from("knowledge_documents")
      .select("id, title, source, trust_level, status, error")
      .eq("collection_id", collectionId)
      .order("created_at");
    if (readError) {
      setError(readError.message);
      setDocumentsFailed(true);
      setDocumentsLoaded(true);
      return;
    }
    setDocuments(data ?? []);
    setDocumentsFailed(false);
    setDocumentsLoaded(true);
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

  const reindexDocument = useCallback(
    async (id: string) => {
      setError(null);
      const result = await ingestDocument(id);
      if (!result.ok) setError(result.error);
      refreshDocuments(selectedId);
    },
    [refreshDocuments, selectedId],
  );

  const deleteDocument = useCallback(
    async (id: string) => {
      setError(null);
      const supabase = createClient();
      const { error: deleteError } = await supabase.from("knowledge_documents").delete().eq("id", id);
      if (deleteError) setError(deleteError.message);
      refreshDocuments(selectedId);
    },
    [refreshDocuments, selectedId],
  );

  const editDocument = useCallback(async (row: DocumentRow) => {
    const supabase = createClient();
    const { data } = await supabase.from("knowledge_documents").select("content").eq("id", row.id).maybeSingle();
    setDocumentForm({
      id: row.id,
      title: row.title,
      source: row.source ?? "",
      trust_level: row.trust_level,
      content: data?.content ?? "",
    });
  }, []);

  const editCollection = useCallback((row: CollectionRow) => {
    setCollectionForm({ ...row, description: row.description ?? "" });
  }, []);

  const toggleBrowsable = useCallback(
    async (row: CollectionRow) => {
      await createClient().from("knowledge_collections").update({ browsable: !row.browsable }).eq("id", row.id);
      await refreshCollections();
    },
    [refreshCollections],
  );

  const collectionColumns = useMemo<GridColDef<CollectionRow>[]>(
    () => [
      {
        field: "name",
        headerName: "Collection",
        flex: 1.5,
        minWidth: 200,
        renderCell: (params: GridRenderCellParams<CollectionRow, string>) => (
          <Box className="flex h-full items-center gap-2">
            <Typography variant="body1" className="text-text-primary truncate font-medium">
              {params.row.name}
            </Typography>
            {params.row.id === selectedId && (
              <span className="bg-accent-1/15 text-accent-1-dark dark:text-accent-1-light flex-none rounded-full px-2 py-0.5 text-xs font-semibold">
                Selected
              </span>
            )}
          </Box>
        ),
      },
      {
        field: "slug",
        headerName: "Slug",
        flex: 1,
        minWidth: 160,
        renderCell: (params: GridRenderCellParams<CollectionRow, string>) => (
          <Box className="flex h-full items-center">
            <Typography variant="body2" className="text-text-secondary truncate">
              {params.row.slug}
            </Typography>
          </Box>
        ),
      },
      {
        field: "description",
        headerName: "Description",
        flex: 1.5,
        minWidth: 200,
        // The searched text must be reachable as the cell value, not only in
        // the rendered node.
        valueGetter: (_, row) => row.description ?? "",
        renderCell: (params: GridRenderCellParams<CollectionRow, string>) => (
          <Box className="flex h-full items-center">
            <Typography variant="body2" className="text-text-secondary truncate">
              {params.value}
            </Typography>
          </Box>
        ),
      },
      {
        // Licensing kill-switch (docs/LICENSING-LIBRARY.md): unlisting a
        // collection hides it from the member acervo without touching RAG. It
        // stays visible on the row, never buried in the kebab.
        field: "browsable",
        headerName: "Browsable",
        minWidth: 120,
        type: "boolean",
        renderCell: (params: GridRenderCellParams<CollectionRow, boolean>) => (
          <Box className="flex h-full items-center">
            <Tooltip title={params.row.browsable ? "Unlist from the acervo" : "List in the acervo"}>
              <Switch
                checked={params.row.browsable}
                onClick={(event) => event.stopPropagation()}
                onChange={() => toggleBrowsable(params.row)}
                size="small"
                slotProps={{
                  input: {
                    "aria-label": params.row.browsable
                      ? `Unlist ${params.row.name} from the acervo`
                      : `List ${params.row.name} in the acervo`,
                  },
                }}
              />
            </Tooltip>
          </Box>
        ),
      },
      {
        field: "actions",
        headerName: "",
        type: "actions",
        minWidth: 70,
        align: "right",
        headerAlign: "right",
        getActions: (params) => [
          <GridActionsCellItem
            key="edit"
            icon={<NiPen size="medium" />}
            label="Edit collection"
            onClick={() => editCollection(params.row)}
            showInMenu
          />,
        ],
      },
    ],
    [editCollection, selectedId, toggleBrowsable],
  );

  const documentColumns = useMemo<GridColDef<DocumentRow>[]>(
    () => [
      {
        field: "title",
        headerName: "Title",
        flex: 2,
        minWidth: 220,
        renderCell: (params: GridRenderCellParams<DocumentRow, string>) => (
          <Box className="flex h-full items-center">
            <Typography variant="body1" className="text-text-primary truncate font-medium">
              {params.value}
            </Typography>
          </Box>
        ),
      },
      {
        field: "source",
        headerName: "Source",
        flex: 1,
        minWidth: 160,
        valueGetter: (_, row) => row.source ?? "",
        renderCell: (params: GridRenderCellParams<DocumentRow, string>) => (
          <Box className="flex h-full items-center">
            <Typography variant="body2" className="text-text-secondary truncate">
              {params.value}
            </Typography>
          </Box>
        ),
      },
      {
        field: "trust_level",
        headerName: "Trust",
        minWidth: 150,
        valueGetter: (_, row) => trustLabel(row.trust_level),
        renderCell: (params: GridRenderCellParams<DocumentRow, string>) => (
          <Box className="flex h-full items-center">
            <span className="bg-grey-100 text-text-secondary truncate rounded-full px-2 py-0.5 text-xs font-semibold">
              {params.value}
            </span>
          </Box>
        ),
      },
      {
        field: "status",
        headerName: "Status",
        minWidth: 120,
        renderCell: (params: GridRenderCellParams<DocumentRow, string>) => (
          <Box className="flex h-full items-center">
            <Chip
              label={params.row.status}
              size="small"
              variant="outlined"
              color={STATUS_COLOR[params.row.status] ?? "default"}
            />
          </Box>
        ),
      },
      {
        // The old row put the ingestion failure in its secondary line — it is
        // the reason the operator scans this list, so it keeps a column.
        field: "error",
        headerName: "Error",
        flex: 1.5,
        minWidth: 180,
        valueGetter: (_, row) => row.error ?? "",
        renderCell: (params: GridRenderCellParams<DocumentRow, string>) =>
          params.value ? (
            <Box className="flex h-full items-center">
              <Tooltip title={params.value}>
                <Typography variant="body2" className="text-text-secondary truncate">
                  {params.value}
                </Typography>
              </Tooltip>
            </Box>
          ) : null,
      },
      {
        field: "actions",
        headerName: "",
        type: "actions",
        minWidth: 70,
        align: "right",
        headerAlign: "right",
        getActions: (params) => [
          <GridActionsCellItem
            key="reindex"
            icon={<NiRefresh size="medium" />}
            label="Re-index"
            onClick={() => reindexDocument(params.row.id)}
            showInMenu
          />,
          <GridActionsCellItem
            key="edit"
            icon={<NiPen size="medium" />}
            label="Edit"
            onClick={() => editDocument(params.row)}
            showInMenu
          />,
          <GridActionsCellItem
            key="delete"
            icon={<NiBinEmpty size="medium" />}
            label="Delete"
            onClick={() => deleteDocument(params.row.id)}
            showInMenu
          />,
        ],
      },
    ],
    [deleteDocument, editDocument, reindexDocument],
  );

  const selectedCollection = collections.find((item) => item.id === selectedId) ?? null;

  return (
    <Box className="flex flex-col gap-4">
      {error && (
        <Alert severity="error" className="neutral bg-background-paper/60!">
          {error}
        </Alert>
      )}

      {/* A failed load is an error, never an empty-looking table. */}
      {!collectionsFailed && (
        <DataTable<CollectionRow>
          rows={collections}
          columns={collectionColumns}
          loading={!collectionsLoaded}
          onRowClick={(row) => setSelectedId(row.id)}
          mainClassName="min-h-[320px]!"
          header={
            <Box>
              <Typography variant="h5" component="h2" className="card-title mb-1">
                Collections
              </Typography>
              <Typography variant="body2" className="text-text-secondary">
                Global collections, referenced by assistants through their slug. Select one to manage its documents.
              </Typography>
            </Box>
          }
          actions={
            <Button
              variant="outlined"
              size="small"
              color="grey"
              startIcon={<NiPlus size="small" />}
              onClick={() => setCollectionForm(EMPTY_COLLECTION)}
            >
              New collection
            </Button>
          }
          noRowsOverlay={
            <EmptyState
              icon={<NiBook size="medium" />}
              title="No collections yet"
              description="A collection groups the documents an assistant retrieves from. Create one, then add documents — they are chunked and embedded automatically."
              action={{ label: "New collection", onClick: () => setCollectionForm(EMPTY_COLLECTION) }}
              className="border-none"
            />
          }
          noResultsOverlay={
            <Typography variant="body2" className="text-text-secondary">
              No collections match your search.
            </Typography>
          }
        />
      )}

      {selectedId && !documentsFailed && (
        <DataTable<DocumentRow>
          rows={documents}
          columns={documentColumns}
          loading={!documentsLoaded}
          header={
            <Box>
              <Typography variant="h5" component="h2" className="card-title mb-1">
                Documents
              </Typography>
              <Typography variant="body2" className="text-text-secondary">
                {selectedCollection ? selectedCollection.name : "Selected collection"}
              </Typography>
            </Box>
          }
          actions={
            <Button
              variant="outlined"
              size="small"
              color="grey"
              startIcon={<NiPlus size="small" />}
              onClick={() => setDocumentForm(EMPTY_DOCUMENT)}
            >
              New document
            </Button>
          }
          noRowsOverlay={
            <EmptyState
              icon={<NiDocumentFull size="medium" />}
              title="No documents yet"
              description="Add content and it will be chunked + embedded automatically."
              action={{ label: "New document", onClick: () => setDocumentForm(EMPTY_DOCUMENT) }}
              className="border-none"
            />
          }
          noResultsOverlay={
            <Typography variant="body2" className="text-text-secondary">
              No documents match your search.
            </Typography>
          }
        />
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
