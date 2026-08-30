"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { Alert, Box, Chip, Tab, Tabs, Typography } from "@mui/material";
import { GridActionsCellItem, type GridColDef, type GridRenderCellParams } from "@mui/x-data-grid";

import DataTable from "@/components/data-grid/data-table";
import EmptyState from "@/components/product/empty-state";
import NiCheck from "@/icons/nexture/ni-check";
import NiCross from "@/icons/nexture/ni-cross";
import NiMessages from "@/icons/nexture/ni-messages";
import { recordAudit } from "@/lib/audit";
import { createClient } from "@flyee/auth/client";

type CommentRow = {
  id: string;
  postTitle: string;
  authorName: string | null;
  body: string;
  status: "pending" | "approved" | "rejected";
  createdAt: string;
};

const STATUSES = ["pending", "approved", "rejected"] as const;

const STATUS_COLOR: Record<string, "warning" | "success" | "default"> = {
  pending: "warning",
  approved: "success",
  rejected: "default",
};

/**
 * Comment moderation queue: pending comments wait here; approving one
 * makes it public on the post instantly.
 */
export default function BlogCommentsAdmin() {
  const [rows, setRows] = useState<CommentRow[]>([]);
  const [statusTab, setStatusTab] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

  const status = STATUSES[statusTab];

  const refresh = useCallback(async () => {
    const supabase = createClient();
    const { data, error: readError } = await supabase
      .from("blog_comments")
      .select("id, author_name, body, status, created_at, blog_posts(title)")
      .eq("status", status)
      .order("created_at", { ascending: false })
      .limit(200);
    if (readError) {
      setError(readError.message);
      setLoadFailed(true);
      setLoaded(true);
      return;
    }
    setRows(
      (data ?? []).map((row) => ({
        id: row.id,
        postTitle: (row.blog_posts as unknown as { title: string } | null)?.title ?? "?",
        authorName: row.author_name,
        body: row.body,
        status: row.status,
        createdAt: row.created_at,
      })),
    );
    setLoadFailed(false);
    setLoaded(true);
  }, [status]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const moderate = useCallback(
    async (id: string, nextStatus: "approved" | "rejected") => {
      setError(null);
      const supabase = createClient();
      const { error: updateError } = await supabase.from("blog_comments").update({ status: nextStatus }).eq("id", id);
      if (updateError) {
        setError(updateError.message);
        return;
      }
      recordAudit(supabase, `admin.blog.comment.${nextStatus}`, { entityType: "blog_comment", entityId: id });
      refresh();
    },
    [refresh],
  );

  const columns = useMemo<GridColDef<CommentRow>[]>(
    () => [
      {
        field: "body",
        headerName: "Comment",
        flex: 2,
        minWidth: 260,
        renderCell: (params: GridRenderCellParams<CommentRow, string>) => (
          <Box className="flex h-full items-center">
            <Typography variant="body1" className="text-text-primary truncate font-medium">
              {params.value}
            </Typography>
          </Box>
        ),
      },
      {
        field: "authorName",
        headerName: "Author",
        minWidth: 150,
        valueGetter: (_, row) => row.authorName ?? "—",
      },
      {
        field: "postTitle",
        headerName: "Post",
        flex: 1,
        minWidth: 180,
        renderCell: (params: GridRenderCellParams<CommentRow, string>) => (
          <Box className="flex h-full items-center">
            <Typography variant="body2" className="text-text-secondary truncate">
              {params.value}
            </Typography>
          </Box>
        ),
      },
      {
        field: "createdAt",
        headerName: "Received",
        minWidth: 180,
        valueGetter: (_, row) => new Date(row.createdAt).toLocaleString(),
      },
      {
        field: "status",
        headerName: "Status",
        minWidth: 120,
        renderCell: (params: GridRenderCellParams<CommentRow, CommentRow["status"]>) => (
          <Box className="flex h-full items-center">
            <Chip
              label={params.row.status}
              size="small"
              color={STATUS_COLOR[params.row.status]}
              variant="outlined"
              className="capitalize"
            />
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
          ...(params.row.status !== "approved"
            ? [
                <GridActionsCellItem
                  key="approve"
                  icon={<NiCheck size="medium" />}
                  label="Approve"
                  onClick={() => moderate(params.row.id, "approved")}
                  showInMenu
                />,
              ]
            : []),
          ...(params.row.status !== "rejected"
            ? [
                <GridActionsCellItem
                  key="reject"
                  icon={<NiCross size="medium" />}
                  label="Reject"
                  onClick={() => moderate(params.row.id, "rejected")}
                  showInMenu
                />,
              ]
            : []),
        ],
      },
    ],
    [moderate],
  );

  return (
    <Box className="flex flex-col gap-3">
      {/* The status tabs drive the QUERY (one status is fetched at a time),
          so they stay above the table, not in the grid's filter row. */}
      <Tabs value={statusTab} onChange={(_, value) => setStatusTab(value)}>
        <Tab label="Pending" />
        <Tab label="Approved" />
        <Tab label="Rejected" />
      </Tabs>

      {error && (
        <Alert severity="error" className="neutral bg-background-paper/60!">
          {error}
        </Alert>
      )}

      {/* A failed load is an error, never an empty-looking table. */}
      {!loadFailed && (
        <DataTable<CommentRow>
          rows={rows}
          columns={columns}
          loading={!loaded}
          noRowsOverlay={
            <EmptyState
              icon={<NiMessages size="medium" />}
              title={status === "pending" ? "Nothing waiting for review" : `No ${status} comments`}
              description={
                status === "pending"
                  ? "New comments land here before going public — an empty queue means you're up to date."
                  : "Comments you moderate show up under their status."
              }
              className="border-none"
            />
          }
          noResultsOverlay={
            <Typography variant="body2" className="text-text-secondary">
              No comments match your search.
            </Typography>
          }
          pageSize={20}
          pageSizeOptions={[10, 20, 50]}
        />
      )}

      {rows.length > 0 && (
        <Typography variant="body2" className="text-text-secondary">
          Approving makes a comment public on the post immediately.
        </Typography>
      )}
    </Box>
  );
}
