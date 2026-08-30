"use client";

import { useLocale } from "next-intl";
import { type ReactNode, type SyntheticEvent, useMemo, useState } from "react";

import {
  Badge,
  Box,
  Button,
  FilledInput,
  FormControl,
  Grid,
  IconButton,
  InputAdornment,
  InputLabel,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  type PopoverVirtualElement,
  Select,
  type SelectProps,
  Tooltip,
} from "@mui/material";
import {
  ColumnsPanelTrigger,
  DataGrid,
  ExportCsv,
  ExportPrint,
  FilterPanelTrigger,
  type GridColDef,
  type GridFilterModel,
  type GridRowIdGetter,
  type GridRowParams,
  type GridRowSpacingParams,
  type GridValidRowModel,
  QuickFilter,
  QuickFilterClear,
  QuickFilterControl,
  Toolbar,
} from "@mui/x-data-grid";
import { deDE, esES, frFR, ptBR } from "@mui/x-data-grid/locales";

import { DataGridPaginationFullPage } from "@/components/data-grid/data-grid-pagination";
import NiArrowDown from "@/icons/nexture/ni-arrow-down";
import NiArrowInDown from "@/icons/nexture/ni-arrow-in-down";
import NiArrowUp from "@/icons/nexture/ni-arrow-up";
import NiBinEmpty from "@/icons/nexture/ni-bin-empty";
import NiChevronDownSmall from "@/icons/nexture/ni-chevron-down-small";
import NiChevronLeftRightSmall from "@/icons/nexture/ni-chevron-left-right-small";
import NiCols from "@/icons/nexture/ni-cols";
import NiCross from "@/icons/nexture/ni-cross";
import NiDocumentFull from "@/icons/nexture/ni-document-full";
import NiEllipsisVertical from "@/icons/nexture/ni-ellipsis-vertical";
import NiEyeInactive from "@/icons/nexture/ni-eye-inactive";
import NiFilter from "@/icons/nexture/ni-filter";
import NiFilterPlus from "@/icons/nexture/ni-filter-plus";
import NiPrinter from "@/icons/nexture/ni-printer";
import NiSearch from "@/icons/nexture/ni-search";
import { cn } from "@/lib/utils";

/**
 * The app's ONE table model, distilled from the template's full-page DataGrid
 * showcase (ui/mui-x/data-grid/full-page): floating rounded rows, a toolbar
 * with columns/filter/export surface buttons plus the page's primary action, a
 * full-width quick-filter search bar, per-row kebab menus (build an
 * `type: "actions"` column with `GridActionsCellItem showInMenu` — the kebab
 * icon comes from this component's slots), and a numbered-pagination footer
 * with a rows-per-page select.
 *
 * A table is the right shape only when the job is scan/compare/manage many
 * rows (.claude/rules/app-ux.md). Zero-data content comes from the CALLER via
 * `noRowsOverlay` — the three-way distinction between truly-empty, filtered-
 * empty and no-search-match is page knowledge, and an error must never be
 * rendered as an empty table.
 *
 * Grid chrome labels (column menu, filter panel, pagination) localize through
 * MUI X's own locale packs keyed off the app locale; the toolbar labels are
 * the caller's (i18n'd in product surfaces, plain EN in the admin consoles).
 */

export type DataTableLabels = {
  search: string;
  columns: string;
  filters: string;
  export: string;
  print: string;
  exportCsv: string;
};

const DEFAULT_LABELS: DataTableLabels = {
  search: "Search",
  columns: "Columns",
  filters: "Filters",
  export: "Export",
  print: "Print",
  exportCsv: "Export CSV",
};

const GRID_LOCALES: Record<string, (typeof ptBR)["components"]["MuiDataGrid"]["defaultProps"]["localeText"]> = {
  "pt-BR": ptBR.components.MuiDataGrid.defaultProps.localeText,
  es: esES.components.MuiDataGrid.defaultProps.localeText,
  fr: frFR.components.MuiDataGrid.defaultProps.localeText,
  de: deDE.components.MuiDataGrid.defaultProps.localeText,
};

type DataTableToolbarProps = {
  header?: ReactNode;
  actions?: ReactNode;
  filters?: ReactNode;
  labels: DataTableLabels;
  enableExport: boolean;
};

/**
 * Module-level (stable) toolbar so parent re-renders never REMOUNT the quick
 * filter input — a remount would drop focus mid-keystroke whenever the page
 * mirrors the query for its no-match empty state.
 */
function DataTableToolbar({ header, actions, filters, labels, enableExport }: DataTableToolbarProps) {
  const [anchorElExport, setAnchorElExport] = useState<EventTarget | Element | PopoverVirtualElement | null>(null);
  const openExport = Boolean(anchorElExport);
  const handleClickExport = (event: Event | SyntheticEvent) => setAnchorElExport(event.currentTarget);
  const handleCloseExport = () => setAnchorElExport(null);

  return (
    <Toolbar className="min-h-auto border-none">
      <Grid container spacing={5} className="mb-4 w-full">
        <Grid container spacing={2.5} className="w-full" size={12}>
          <Grid size={{ xs: 12, md: "grow" }}>{header}</Grid>

          <Grid size={{ xs: 12, md: "auto" }} className="flex flex-row flex-wrap items-start gap-2">
            <Tooltip title={labels.columns}>
              <ColumnsPanelTrigger
                render={(props) => (
                  <Button
                    {...props}
                    aria-label={labels.columns}
                    className="icon-only surface-standard flex-none"
                    size="medium"
                    color="grey"
                    variant="surface"
                  >
                    <NiCols size="medium" />
                  </Button>
                )}
              />
            </Tooltip>

            <Tooltip title={labels.filters}>
              <FilterPanelTrigger
                render={(props, state) => (
                  <Button
                    {...props}
                    aria-label={labels.filters}
                    className="icon-only surface-standard flex-none"
                    size="medium"
                    color="grey"
                    variant="surface"
                  >
                    <Badge badgeContent={state.filterCount} color="primary" variant="dot">
                      <NiFilter size="medium" />
                    </Badge>
                  </Button>
                )}
              />
            </Tooltip>

            {enableExport && (
              <>
                <Tooltip title={labels.export}>
                  <Button
                    aria-label={labels.export}
                    className="icon-only surface-standard flex-none"
                    size="medium"
                    color="grey"
                    variant="surface"
                    startIcon={<NiArrowInDown size="medium" />}
                    onClick={handleClickExport}
                  />
                </Tooltip>
                <Menu
                  anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
                  transformOrigin={{ vertical: "top", horizontal: "right" }}
                  anchorEl={anchorElExport as Element}
                  open={openExport}
                  onClose={handleCloseExport}
                  className="mt-1"
                >
                  <ExportPrint
                    render={
                      <MenuItem>
                        <ListItemIcon>
                          <NiPrinter size="medium" />
                        </ListItemIcon>
                        <ListItemText>{labels.print}</ListItemText>
                      </MenuItem>
                    }
                    onClick={handleCloseExport}
                  />
                  <ExportCsv
                    render={
                      <MenuItem>
                        <ListItemIcon>
                          <NiDocumentFull size="medium" />
                        </ListItemIcon>
                        <ListItemText>{labels.exportCsv}</ListItemText>
                      </MenuItem>
                    }
                    onClick={handleCloseExport}
                  />
                </Menu>
              </>
            )}

            {actions}
          </Grid>
        </Grid>

        <Grid container spacing={2.5} className="w-full items-center" size={12}>
          {filters}
          <FormControl variant="filled" size="medium" className="surface mb-0 min-w-48 flex-1">
            <InputLabel>{labels.search}</InputLabel>
            <QuickFilter
              render={() => (
                <QuickFilterControl
                  render={({ ref, ...controlProps }, state) => (
                    <FilledInput
                      {...controlProps}
                      inputRef={ref}
                      endAdornment={
                        <>
                          <InputAdornment position="end" className={cn(state.value === "" && "hidden")}>
                            <QuickFilterClear edge="end" aria-label={labels.search}>
                              <NiCross size="medium" className="text-text-disabled" />
                            </QuickFilterClear>
                          </InputAdornment>
                          <InputAdornment position="end" className={cn(state.value !== "" && "hidden")}>
                            <IconButton edge="end" aria-label={labels.search}>
                              <NiSearch size="medium" className="text-text-disabled" />
                            </IconButton>
                          </InputAdornment>
                        </>
                      }
                    />
                  )}
                />
              )}
            />
          </FormControl>
        </Grid>
      </Grid>
    </Toolbar>
  );
}

declare module "@mui/x-data-grid" {
  interface ToolbarPropsOverrides {
    header?: ReactNode;
    actions?: ReactNode;
    filters?: ReactNode;
    labels: DataTableLabels;
    enableExport: boolean;
  }
}

export default function DataTable<R extends GridValidRowModel>({
  rows,
  columns,
  getRowId,
  loading = false,
  header,
  actions,
  filters,
  labels: labelOverrides,
  noRowsOverlay,
  noResultsOverlay,
  onRowClick,
  onQuickFilterChange,
  pageSize = 10,
  pageSizeOptions = [10, 25, 50],
  checkboxSelection = false,
  mainClassName = "min-h-[480px]!",
  initialColumnVisibility,
}: {
  rows: readonly R[];
  columns: GridColDef<R>[];
  getRowId?: GridRowIdGetter<R>;
  loading?: boolean;
  /** The page's h1 + breadcrumbs block, rendered inside the toolbar's top row. */
  header?: ReactNode;
  /** The page's primary/secondary actions ("Add item" position, top right). */
  actions?: ReactNode;
  /** Extra controls on the search row (e.g. an active/archived toggle). */
  filters?: ReactNode;
  /** Toolbar copy — i18n'd by product callers; EN defaults suit the admin. */
  labels?: Partial<DataTableLabels>;
  /** Zero-row content. Distinguishing truly-empty from no-match is the page's
   *  job (mirror the query via onQuickFilterChange). */
  noRowsOverlay?: ReactNode;
  /** Shown when rows EXIST but the quick filter matched none of them. */
  noResultsOverlay?: ReactNode;
  onRowClick?: (row: R) => void;
  /** Mirrors the quick-filter text so the page can phrase its empty state. */
  onQuickFilterChange?: (value: string) => void;
  pageSize?: number;
  pageSizeOptions?: number[];
  checkboxSelection?: boolean;
  /** Tailwind class controlling the grid body's minimum height. */
  mainClassName?: string;
  initialColumnVisibility?: Record<string, boolean>;
}) {
  const locale = useLocale();
  const localeText = GRID_LOCALES[locale];

  const initialState = useMemo(
    () => ({
      columns: { columnVisibilityModel: initialColumnVisibility },
      pagination: { paginationModel: { pageSize } },
    }),
    // Initial state is read once by the grid at mount — deliberately static.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  return (
    <DataGrid
      rows={rows as R[]}
      columns={columns}
      getRowId={getRowId}
      loading={loading}
      localeText={localeText}
      initialState={initialState}
      getRowSpacing={(params: GridRowSpacingParams) => ({ top: params.isFirstVisible ? 0 : 5, bottom: 5 })}
      rowHeight={68}
      columnHeaderHeight={32}
      checkboxSelection={checkboxSelection}
      disableRowSelectionOnClick
      pagination
      pageSizeOptions={pageSizeOptions}
      hideFooterSelectedRowCount
      showToolbar
      className={cn("full-page border-none", onRowClick && "[&_.MuiDataGrid-row]:cursor-pointer")}
      onRowClick={onRowClick ? (params: GridRowParams<R>) => onRowClick(params.row) : undefined}
      onFilterModelChange={
        onQuickFilterChange
          ? (model: GridFilterModel) => onQuickFilterChange((model.quickFilterValues ?? []).join(" ").trim())
          : undefined
      }
      slotProps={{
        panel: { className: "mt-1!" },
        main: { className: mainClassName },
        loadingOverlay: { variant: "skeleton", noRowsVariant: "skeleton" },
        toolbar: { header, actions, filters, labels: { ...DEFAULT_LABELS, ...labelOverrides }, enableExport: true },
      }}
      slots={{
        toolbar: DataTableToolbar,
        basePagination: DataGridPaginationFullPage,
        noRowsOverlay: noRowsOverlay
          ? () => <Box className="flex h-full w-full items-center justify-center p-6">{noRowsOverlay}</Box>
          : undefined,
        noResultsOverlay: noResultsOverlay
          ? () => <Box className="flex h-full w-full items-center justify-center p-6">{noResultsOverlay}</Box>
          : undefined,
        columnSortedDescendingIcon: () => <NiArrowDown size="small" />,
        columnSortedAscendingIcon: () => <NiArrowUp size="small" />,
        columnFilteredIcon: () => <NiFilterPlus size="small" />,
        columnReorderIcon: () => <NiChevronLeftRightSmall size="small" />,
        columnMenuIcon: () => <NiEllipsisVertical size="small" />,
        columnMenuSortAscendingIcon: NiArrowUp,
        columnMenuSortDescendingIcon: NiArrowDown,
        columnMenuFilterIcon: NiFilter,
        columnMenuHideIcon: NiEyeInactive,
        columnMenuClearIcon: NiCross,
        columnMenuManageColumnsIcon: NiCols,
        filterPanelDeleteIcon: NiCross,
        filterPanelRemoveAllIcon: NiBinEmpty,
        quickFilterIcon: () => <NiSearch size="medium" />,
        quickFilterClearIcon: () => <NiCross size="medium" />,
        moreActionsIcon: () => <NiEllipsisVertical size="medium" />,
        baseButton: (props) => <Button {...props} variant="pastel" color="grey" />,
        baseSelect: (props) => {
          const propsCasted = props as SelectProps;
          return (
            <FormControl size="small" variant="outlined">
              <InputLabel>{propsCasted.label}</InputLabel>
              <Select {...propsCasted} IconComponent={NiChevronDownSmall} MenuProps={{ className: "outlined" }} />
            </FormControl>
          );
        },
      }}
    />
  );
}
