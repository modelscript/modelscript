// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ASTQueryFunction } from "./query-types.js";
import type { WritebackEdit } from "./writeback-types.js";

/**
 * Applies character-offset `WritebackEdit` patches in reverse-offset order so earlier spans remain valid.
 */
export function applyWritebackEdits(sourceText: string, edits: WritebackEdit[]): string {
  if (!edits || edits.length === 0) return sourceText;
  const sorted = [...edits].sort((a, b) => b.startOffset - a.startOffset);
  let out = sourceText;
  for (const edit of sorted) {
    const start = Math.max(0, Math.min(edit.startOffset, out.length));
    const end = Math.max(start, Math.min(edit.endOffset, out.length));
    out = out.slice(0, start) + edit.newText + out.slice(end);
  }
  return out;
}

/**
 * First-Class Column Data Types for Bidirectional Engineering Tabular Editors.
 */
export type TabularColumnType =
  | "string"
  | "number"
  | "boolean"
  | "enum"
  | "xhtml"
  | "date"
  | "reference"
  | "contract"
  | "badge"
  | "quantity"
  | "expression"
  | "custom";

/**
 * Visual styling for pill/badge cells (e.g., ASIL levels, verification status, link stereotypes).
 */
export interface TabularBadgeStyle {
  background?: string | undefined;
  color?: string | undefined;
  borderColor?: string | undefined;
  icon?: string | undefined;
}

/**
 * Option item for `enum` or `reference` columns.
 */
export type TabularOptionItem =
  | string
  | {
      label: string;
      value: string;
      description?: string | undefined;
      badge?: TabularBadgeStyle | undefined;
    };

/**
 * Cell-level live validation result.
 */
export interface TabularValidationResult {
  valid: boolean;
  severity?: "error" | "warning" | "info" | undefined;
  message?: string | undefined;
}

/**
 * Context-aware cell completion item for inline spreadsheet editing.
 */
export interface TabularCompletionItem {
  label: string;
  kind?: string | undefined;
  detail?: string | undefined;
  insertText?: string | undefined;
}

/**
 * Source span tracking for surgical AST/CST/XML writeback on individual rows and cells.
 */
export interface TabularSourceSpan {
  startOffset?: number | undefined;
  endOffset?: number | undefined;
  startLine?: number | undefined;
  startColumn?: number | undefined;
  startCol?: number | undefined;
  endLine?: number | undefined;
  endColumn?: number | undefined;
  endCol?: number | undefined;
}

/**
 * Canonical runtime row representation in a Tabular Sheet.
 */
export interface TabularRow {
  /** Stable unique identifier for the row (e.g., ReqIF SPEC-OBJECT IDENTIFIER or AST node ID) */
  id: string;
  /** Grammar rule or metaclass kind (e.g., 'SPEC-OBJECT', 'SPEC-RELATION', 'RequirementDefinition') */
  kind?: string | undefined;
  /** Hierarchical outline number (e.g., '1.1', '2.1.3') for tree-tables */
  sectionNumber?: string | undefined;
  /** Zero-based nesting depth for hierarchical tree-tables */
  depth?: number | undefined;
  /** Parent row identifier in hierarchical tree-tables */
  parentId?: string | null | undefined;
  /** Child row identifiers in hierarchical tree-tables */
  childIds?: string[] | undefined;
  /** Map of columnId -> cell value */
  cells: Record<string, unknown>;
  /** Optional cell-level source spans for surgical writeback */
  cellSpans?: Record<string, TabularSourceSpan> | undefined;
  /** Row-level source span in the document */
  span?: TabularSourceSpan | undefined;
  /** Optional cell-level diagnostics / validation messages */
  diagnostics?: Record<string, TabularValidationResult> | undefined;
  /** Optional domain metadata attached to the row */
  metadata?: Record<string, unknown> | undefined;
}

/**
 * Declarative or functional writeback specification for a tabular column.
 */
export interface TabularColumnWritebackConfig<FieldName extends string = string> {
  /** Target AST field or attribute name to update */
  field?: FieldName | string | undefined;
  /** Optional string template or formatter for the serialized representation */
  template?: string | ((newValue: unknown, row: TabularRow) => string) | undefined;
  /**
   * Custom surgical mutator returning either character-offset `WritebackEdit`(s)
   * or the updated document text string.
   */
  mutator?:
    | ((
        docText: string,
        row: TabularRow,
        newValue: unknown,
        db?: unknown,
      ) => WritebackEdit | WritebackEdit[] | string | null)
    | undefined;
}

/**
 * Declarative Column Configuration for a Language Tabular Sheet.
 */
export interface TabularColumnConfig<
  RuleName extends string = string,
  FieldName extends string = string,
  QueryName extends string = string,
  ModelAttrs extends Record<string, Record<string, unknown>> = Record<string, Record<string, unknown>>,
> {
  /** Unique column identifier (e.g., 'identifier', 'longName', 'text', 'asilLevel', 'contract') */
  id: string;
  /** Human-readable column header title */
  header: string;
  /** Tooltip / documentation for the column header */
  description?: string | undefined;
  /** Semantic data type of the column */
  type: TabularColumnType;
  /**
   * Source AST field name, property key, or extractor function that computes the cell value
   * from a row/node.
   */
  field?:
    | FieldName
    | string
    | ASTQueryFunction<RuleName, FieldName, QueryName, ModelAttrs>
    | ((row: unknown, db?: unknown) => unknown)
    | undefined;
  /** Default column width in pixels or CSS units */
  width?: number | string | undefined;
  /** Minimum column width in pixels */
  minWidth?: number | undefined;
  /** Maximum column width in pixels */
  maxWidth?: number | undefined;
  /** Whether the column is pinned to the left or right edge of the viewport */
  pinned?: "left" | "right" | undefined;
  /** Whether the column supports sorting (default: true) */
  sortable?: boolean | undefined;
  /** Whether the column participates in search/filtering (default: true) */
  filterable?: boolean | undefined;
  /** Whether rows can be grouped by this column */
  groupable?: boolean | undefined;
  /** Whether cells in this column can be edited inline (default: true unless read-only ID) */
  editable?: boolean | ((row: TabularRow) => boolean) | undefined;
  /** Whether the column is hidden by default */
  hidden?: boolean | undefined;
  /** Whether the column was dynamically discovered from document schema (e.g. ReqIF SPEC-TYPE) */
  isDynamic?: boolean | undefined;
  /** Render cell content in a monospace engineering font */
  mono?: boolean | undefined;
  /** Horizontal cell text alignment */
  align?: "left" | "center" | "right" | undefined;
  /** Physical or engineering unit suffix (e.g., 'ms', '%', 'Nm') */
  unit?: string | undefined;
  /** Allowed options for `enum` or `reference` columns */
  options?: TabularOptionItem[] | ((row: TabularRow, db?: unknown) => TabularOptionItem[]) | undefined;
  /** Visual badge color map keyed by cell string value */
  badgeMap?: Record<string, TabularBadgeStyle> | undefined;
  /** Optional display formatter */
  format?: ((value: unknown, row: TabularRow) => string) | undefined;
  /** Live cell validation callback */
  validate?: ((value: unknown, row: TabularRow, db?: unknown) => TabularValidationResult | null) | undefined;
  /** Context-aware autocompletion callback for inline cell editing */
  complete?: ((prefix: string, row: TabularRow, db?: unknown) => TabularCompletionItem[]) | undefined;
  /** Bidirectional writeback specification for edits to this column */
  writeback?: TabularColumnWritebackConfig<FieldName> | undefined;
}

/**
 * Summary KPI telemetry card displayed in the ribbon above a tabular view.
 * Clicking a KPI card can optionally filter the rows in the table.
 */
export interface TabularKpiConfig {
  id: string;
  label: string;
  description?: string | undefined;
  icon?: string | undefined;
  accentColor?: string | undefined;
  /** Computes the live KPI metric from the current sheet rows and document */
  compute: (
    rows: TabularRow[],
    docText?: string,
    db?: unknown,
  ) => {
    value: string | number;
    sublabel?: string | undefined;
    status?: "ok" | "warn" | "error" | "neutral" | undefined;
  };
  /** Optional row filter predicate activated when the user clicks this KPI card */
  filterPredicate?: ((row: TabularRow) => boolean) | undefined;
}

/**
 * Computed runtime KPI item returned to the UI.
 */
export interface CompiledTabularKpi {
  id: string;
  label: string;
  description?: string | undefined;
  icon?: string | undefined;
  accentColor?: string | undefined;
  value: string | number;
  sublabel?: string | undefined;
  status: "ok" | "warn" | "error" | "neutral";
  hasFilter: boolean;
}

/**
 * Hierarchical tree-table configuration (e.g. ReqIF SPEC-HIERARCHY or nested SysML parts).
 */
export interface TabularHierarchyConfig<FieldName extends string = string> {
  /** Field storing the parent reference */
  parentField?: FieldName | string | undefined;
  /** Field storing nested child nodes */
  childrenField?: FieldName | string | undefined;
  /** Column ID that displays the hierarchical outline number (e.g., '1.2.1') */
  sectionColumn?: string | undefined;
  /** Column ID that renders tree indentation and expand/collapse chevrons */
  indentColumn?: string | undefined;
  /** Whether parent rows can be collapsed/expanded (default: true) */
  collapsible?: boolean | undefined;
  /** Whether rows can be reordered or reparented (default: true) */
  allowReorder?: boolean | undefined;
}

/**
 * Link stereotype descriptor for 2D Traceability Matrix (RTM) sheets.
 */
export interface TabularMatrixLinkKind {
  id: string;
  label: string;
  shortLabel?: string | undefined;
  description?: string | undefined;
  badge?: TabularBadgeStyle | undefined;
}

/**
 * Runtime 2D matrix cell representation.
 */
export interface TabularMatrixCell {
  rowId: string;
  colId: string;
  relationId?: string | undefined;
  kind: string;
  label?: string | undefined;
  span?: TabularSourceSpan | undefined;
}

/**
 * Runtime 2D matrix payload for `"matrix"` sheets.
 */
export interface TabularMatrixData {
  rowHeaders: { id: string; label: string; subtitle?: string | undefined; badge?: string | undefined }[];
  colHeaders: { id: string; label: string; subtitle?: string | undefined; badge?: string | undefined }[];
  linkKinds: TabularMatrixLinkKind[];
  cells: Record<string, TabularMatrixCell>;
  coveragePercent: number;
}

/**
 * Declarative 2D Matrix Sheet Configuration (e.g. Requirements Traceability Matrix).
 */
export interface TabularMatrixConfig<RuleName extends string = string> {
  /** Sheet ID providing the matrix row headers */
  rowSheet?: string | undefined;
  /** Sheet ID providing the matrix column headers */
  colSheet?: string | undefined;
  /** Grammar rule representing a relationship edge (e.g. 'SPEC-RELATION') */
  cellRule?: NoInfer<RuleName> | string | undefined;
  /** Available link stereotypes that cycle or can be selected in a matrix cell */
  linkKinds: TabularMatrixLinkKind[];
  /** Extracts the 2D matrix structure from the document */
  extractMatrix?: ((docText: string, db?: unknown) => TabularMatrixData) | undefined;
  /** Applies a cell link creation, update, or deletion in the 2D matrix */
  mutateCell?:
    | ((docText: string, rowId: string, colId: string, newKind: string | null, db?: unknown) => TabularMutationResult)
    | undefined;
}

/**
 * Mutation request sent from the IDE Webview, Post Artifact Viewer, or CLI to the Tabular Engine.
 */
export type TabularMutationRequest =
  | {
      kind: "updateCell";
      sheetId: string;
      rowId: string;
      columnId: string;
      value: unknown;
    }
  | {
      kind: "insertRow";
      sheetId: string;
      afterRowId?: string | undefined;
      parentId?: string | undefined;
      initialCells?: Record<string, unknown> | undefined;
    }
  | {
      kind: "deleteRow";
      sheetId: string;
      rowId: string;
    }
  | {
      kind: "moveRow";
      sheetId: string;
      rowId: string;
      targetParentId?: string | null | undefined;
      targetIndex?: number | undefined;
    }
  | {
      kind: "toggleMatrixCell";
      sheetId: string;
      rowId: string;
      colId: string;
      newKind: string | null;
    }
  | {
      kind: "batchUpdate";
      sheetId: string;
      updates: { rowId: string; columnId: string; value: unknown }[];
    };

/**
 * Result of executing a bidirectional tabular mutation.
 */
export interface TabularMutationResult {
  success: boolean;
  /** Surgical character-offset edits applied to the underlying source text */
  edits: WritebackEdit[];
  /** Complete updated source text after applying the mutation */
  newText: string;
  /** Optional ID of a newly inserted row or relation */
  affectedRowId?: string | undefined;
  /** Optional diagnostic or error message if the mutation failed validation */
  error?: string | undefined;
}

/**
 * Sheet-level mutation handlers for row insertion, deletion, reordering, and cell writeback.
 */
export interface TabularMutationHandlers {
  updateCell?:
    | ((docText: string, rowId: string, columnId: string, newValue: unknown, db?: unknown) => TabularMutationResult)
    | undefined;
  insertRow?:
    | ((
        docText: string,
        options: {
          afterRowId?: string | undefined;
          parentId?: string | undefined;
          initialCells?: Record<string, unknown> | undefined;
        },
        db?: unknown,
      ) => TabularMutationResult)
    | undefined;
  deleteRow?: ((docText: string, rowId: string, db?: unknown) => TabularMutationResult) | undefined;
  moveRow?:
    | ((
        docText: string,
        rowId: string,
        targetParentId?: string | null | undefined,
        targetIndex?: number | undefined,
        db?: unknown,
      ) => TabularMutationResult)
    | undefined;
}

/**
 * Kind of Tabular Sheet Projection.
 * - `"flat"`: Standard 2D engineering data grid with sorting, filtering, grouping, and pinning.
 * - `"tree"`: Hierarchical outline tree-table (e.g. ReqIF `SPEC-HIERARCHY` or BOM assembly tree).
 * - `"matrix"`: 2D cross-reference / traceability matrix (e.g. ReqIF RTM `SPEC-RELATIONS` grid).
 * - `"pivot"`: Aggregated summary table grouped by domain dimensions.
 */
export type TabularSheetKind = "flat" | "tree" | "matrix" | "pivot";

/**
 * Configuration for a single Tabular Sheet / View within a Language's `tabular` DSL definition.
 */
export interface TabularSheetConfig<
  RuleName extends string = string,
  FieldName extends string = string,
  QueryName extends string = string,
  ModelAttrs extends Record<string, Record<string, unknown>> = Record<string, Record<string, unknown>>,
> {
  /** Unique identifier of the sheet (e.g., 'requirements', 'traceability', 'matrix', 'types') */
  id: string;
  /** Human-readable tab label */
  label?: string | undefined;
  /** Alias for label */
  title?: string | undefined;
  /** Codicon or icon identifier */
  icon?: string | undefined;
  /** Brief description of what this sheet projects */
  description?: string | undefined;
  /** Projection kind (default: 'flat') */
  kind?: TabularSheetKind | undefined;
  /** Grammar rules whose instances populate rows in this sheet */
  rowRules?: (NoInfer<RuleName> | string)[] | undefined;
  /** Primary grammar rule for rows in this sheet */
  sourceRule?: (NoInfer<RuleName> | string) | undefined;
  /** Tree hierarchy configuration when `kind === "tree"` */
  hierarchy?: TabularHierarchyConfig<FieldName> | undefined;
  /** 2D Matrix configuration when `kind === "matrix"` */
  matrix?: TabularMatrixConfig<RuleName> | undefined;
  /** Static columns defined for this sheet */
  columns: TabularColumnConfig<RuleName, FieldName, QueryName, ModelAttrs>[];
  /**
   * Optional dynamic column discovery hook.
   * Critical for schema-driven languages like ReqIF where `SPEC-OBJECT-TYPE` declares
   * custom `ATTRIBUTE-DEFINITION-*` columns per document!
   */
  dynamicColumns?:
    | ((docText: string, db?: unknown) => TabularColumnConfig<RuleName, FieldName, QueryName, ModelAttrs>[])
    | undefined;
  /** Extracts rows for this sheet from the document text and/or CodeGraph database */
  extractRows?: ((docText: string, db?: unknown) => TabularRow[]) | undefined;
  /** Bidirectional mutation handlers for this sheet */
  mutations?: TabularMutationHandlers | undefined;
  /** Live KPI summary cards displayed above this sheet */
  kpis?: TabularKpiConfig[] | undefined;
  /** Supported export formats for this sheet */
  exportFormats?: ("csv" | "tsv" | "json" | "reqif" | "markdown")[] | undefined;
}

/**
 * Top-Level Declarative & Programmatic Bidirectional Tabular View/Editor Configuration
 * for `language({ tabular: ... })`.
 */
export interface TabularConfig<
  RuleName extends string = string,
  FieldName extends string = string,
  QueryName extends string = string,
  ModelAttrs extends Record<string, Record<string, unknown>> = Record<string, Record<string, unknown>>,
> {
  /** Named sheets/views available in the tabular editor */
  sheets: Record<string, TabularSheetConfig<RuleName, FieldName, QueryName, ModelAttrs>>;
  /** ID of the sheet shown by default */
  defaultSheet?: string | undefined;
  /** Enable full-text & per-column filtering (default: true) */
  enableSearch?: boolean | undefined;
  /** Alias for enableSearch */
  enableQuickFilter?: boolean | undefined;
  /** Enable multi-column sorting (default: true) */
  enableMultiColumnSort?: boolean | undefined;
  /** Enable compact/expanded row density toggle (default: true) */
  enableDenseMode?: boolean | undefined;
  /** Enable left/right column freezing (default: true) */
  enableColumnPinning?: boolean | undefined;
  /** Enable multi-row checkbox selection (default: true) */
  enableRowSelection?: boolean | undefined;
  /** Enable batch edit/delete toolbar on selected rows (default: true) */
  enableBatchActions?: boolean | undefined;
  /** Enable RFC 4180 CSV export (default: true) */
  enableCsvExport?: boolean | undefined;
  /** Enable spreadsheet TSV clipboard copy/paste (default: true) */
  enableClipboardTsv?: boolean | undefined;
  /** Enable undo/redo history stack for cell edits (default: true) */
  enableUndoRedo?: boolean | undefined;
  /** Enable click-to-navigate source span synchronization (default: true) */
  enableSourceNavigation?: boolean | undefined;
}

/**
 * Serialized column metadata sent to UI clients (VS Code webviews, React viewers, LSP).
 */
export interface SerializedTabularColumn {
  id: string;
  header: string;
  description?: string | undefined;
  type: TabularColumnType;
  width?: number | string | undefined;
  minWidth?: number | undefined;
  maxWidth?: number | undefined;
  pinned?: "left" | "right" | undefined;
  sortable: boolean;
  filterable: boolean;
  groupable: boolean;
  editable: boolean;
  hidden: boolean;
  isDynamic: boolean;
  mono?: boolean | undefined;
  align?: "left" | "center" | "right" | undefined;
  unit?: string | undefined;
  options?: TabularOptionItem[] | undefined;
  badgeMap?: Record<string, TabularBadgeStyle> | undefined;
}

/**
 * Summary descriptor for an available sheet tab.
 */
export interface TabularSheetSummary {
  id: string;
  label: string;
  icon?: string | undefined;
  description?: string | undefined;
  kind: TabularSheetKind;
  rowCount?: number | undefined;
}

/**
 * Complete compiled payload returned by `executeTabularSheet(...)`.
 */
export interface CompiledTabularPayload {
  sheetId: string;
  sheetKind: TabularSheetKind;
  availableSheets: TabularSheetSummary[];
  columns: SerializedTabularColumn[];
  rows: TabularRow[];
  totalCount: number;
  kpis: CompiledTabularKpi[];
  hierarchy?: TabularHierarchyConfig | undefined;
  matrix?: TabularMatrixData | undefined;
  capabilities: {
    enableSearch: boolean;
    enableDenseMode: boolean;
    enableColumnPinning: boolean;
    enableRowSelection: boolean;
    enableBatchActions: boolean;
    enableCsvExport: boolean;
    enableClipboardTsv: boolean;
    enableUndoRedo: boolean;
    enableSourceNavigation: boolean;
    canInsertRow: boolean;
    canDeleteRow: boolean;
    canMoveRow: boolean;
  };
}

/**
 * Compiles and normalizes a declarative `TabularConfig` into a runtime descriptor.
 */
export function compileTabularConfig<
  RuleName extends string = string,
  FieldName extends string = string,
  QueryName extends string = string,
  ModelAttrs extends Record<string, Record<string, unknown>> = Record<string, Record<string, unknown>>,
>(config?: TabularConfig<RuleName, FieldName, QueryName, ModelAttrs>) {
  if (!config || !config.sheets) {
    return null;
  }
  const sheetIds = Object.keys(config.sheets);
  const defaultSheet =
    config.defaultSheet && config.sheets[config.defaultSheet] ? config.defaultSheet : (sheetIds[0] ?? "default");

  return {
    config,
    sheetIds,
    defaultSheet,
    capabilities: {
      enableSearch: config.enableSearch ?? true,
      enableDenseMode: config.enableDenseMode ?? true,
      enableColumnPinning: config.enableColumnPinning ?? true,
      enableRowSelection: config.enableRowSelection ?? true,
      enableBatchActions: config.enableBatchActions ?? true,
      enableCsvExport: config.enableCsvExport ?? true,
      enableClipboardTsv: config.enableClipboardTsv ?? true,
      enableUndoRedo: config.enableUndoRedo ?? true,
      enableSourceNavigation: config.enableSourceNavigation ?? true,
    },
  };
}

/**
 * Serializes a `TabularColumnConfig` into a transport-safe `SerializedTabularColumn`.
 */
export function serializeTabularColumn(
  col: TabularColumnConfig,
  sampleRow?: TabularRow,
  db?: unknown,
): SerializedTabularColumn {
  const resolvedOptions =
    typeof col.options === "function" ? col.options(sampleRow ?? { id: "", cells: {} }, db) : col.options;
  const resolvedEditable = typeof col.editable === "function" ? true : (col.editable ?? col.id !== "identifier");

  return {
    id: col.id,
    header: col.header,
    description: col.description,
    type: col.type,
    width: col.width,
    minWidth: col.minWidth,
    maxWidth: col.maxWidth,
    pinned: col.pinned,
    sortable: col.sortable ?? true,
    filterable: col.filterable ?? true,
    groupable: col.groupable ?? false,
    editable: resolvedEditable,
    hidden: col.hidden ?? false,
    isDynamic: col.isDynamic ?? false,
    mono: col.mono,
    align: col.align,
    unit: col.unit,
    options: resolvedOptions,
    badgeMap: col.badgeMap,
  };
}

/**
 * Executes a `TabularConfig` sheet against a document text (and optional CodeGraph/DB),
 * merging static + dynamic schema columns, computing live KPIs, and running cell validations.
 */
export function executeTabularSheet(
  config: TabularConfig,
  docText: string,
  requestedSheetId?: string,
  db?: unknown,
): CompiledTabularPayload {
  const compiled = compileTabularConfig(config);
  if (!compiled) {
    return {
      sheetId: "default",
      sheetKind: "flat",
      availableSheets: [],
      columns: [],
      rows: [],
      totalCount: 0,
      kpis: [],
      capabilities: {
        enableSearch: true,
        enableDenseMode: true,
        enableColumnPinning: true,
        enableRowSelection: true,
        enableBatchActions: true,
        enableCsvExport: true,
        enableClipboardTsv: true,
        enableUndoRedo: true,
        enableSourceNavigation: true,
        canInsertRow: false,
        canDeleteRow: false,
        canMoveRow: false,
      },
    };
  }

  const activeSheetId = requestedSheetId && config.sheets[requestedSheetId] ? requestedSheetId : compiled.defaultSheet;
  const sheet = config.sheets[activeSheetId]!;
  const sheetKind: TabularSheetKind = sheet.kind ?? "flat";

  // 1. Extract rows for the active sheet
  const rows: TabularRow[] = sheet.extractRows ? sheet.extractRows(docText, db) : [];

  // 2. Discover dynamic columns (e.g., ReqIF SPEC-TYPE custom attributes) and merge with static columns
  const dynamicCols = sheet.dynamicColumns ? sheet.dynamicColumns(docText, db) : [];
  const existingIds = new Set(sheet.columns.map((c) => c.id));
  const allColumnConfigs: TabularColumnConfig[] = [
    ...sheet.columns,
    ...dynamicCols.filter((dc) => !existingIds.has(dc.id)).map((dc) => ({ ...dc, isDynamic: true })),
  ];

  // 3. Run cell-level validations if configured
  for (const row of rows) {
    for (const col of allColumnConfigs) {
      if (col.validate) {
        const res = col.validate(row.cells[col.id], row, db);
        if (res && !res.valid) {
          if (!row.diagnostics) row.diagnostics = {};
          row.diagnostics[col.id] = res;
        }
      }
    }
  }

  // 4. Compute available sheet summaries (with row counts when cheap)
  const availableSheets: TabularSheetSummary[] = compiled.sheetIds.map((id) => {
    const s = config.sheets[id]!;
    return {
      id: s.id || id,
      label: s.label ?? s.title ?? (s.id || id),
      icon: s.icon,
      description: s.description,
      kind: s.kind ?? "flat",
      rowCount: id === activeSheetId ? rows.length : undefined,
    };
  });

  // 5. Compute KPIs
  const kpis: CompiledTabularKpi[] = (sheet.kpis ?? []).map((kpi) => {
    const computed = kpi.compute(rows, docText, db);
    return {
      id: kpi.id,
      label: kpi.label,
      description: kpi.description,
      icon: kpi.icon,
      accentColor: kpi.accentColor,
      value: computed.value,
      sublabel: computed.sublabel,
      status: computed.status ?? "neutral",
      hasFilter: typeof kpi.filterPredicate === "function",
    };
  });

  // 6. Extract 2D matrix if this is a matrix sheet
  const matrixData =
    sheetKind === "matrix" && sheet.matrix?.extractMatrix ? sheet.matrix.extractMatrix(docText, db) : undefined;

  const sampleRow = rows[0];
  const serializedColumns = allColumnConfigs.map((col) => serializeTabularColumn(col, sampleRow, db));

  return {
    sheetId: activeSheetId,
    sheetKind,
    availableSheets,
    columns: serializedColumns,
    rows,
    totalCount: rows.length,
    kpis,
    hierarchy: sheet.hierarchy,
    matrix: matrixData,
    capabilities: {
      ...compiled.capabilities,
      canInsertRow: Boolean(sheet.mutations?.insertRow),
      canDeleteRow: Boolean(sheet.mutations?.deleteRow),
      canMoveRow: Boolean(sheet.mutations?.moveRow),
    },
  };
}

/**
 * Validates a proposed cell value against a sheet's `TabularColumnConfig`.
 */
export function validateTabularCell(
  config: TabularConfig,
  docText: string,
  sheetId: string,
  rowId: string,
  columnId: string,
  value: unknown,
  db?: unknown,
): TabularValidationResult {
  const sheet = config.sheets[sheetId] ?? config.sheets[config.defaultSheet ?? ""] ?? Object.values(config.sheets)[0];
  if (!sheet) return { valid: true };

  const dynamicCols = sheet.dynamicColumns ? sheet.dynamicColumns(docText, db) : [];
  const col = sheet.columns.find((c) => c.id === columnId) ?? dynamicCols.find((c) => c.id === columnId);
  if (!col) return { valid: true };

  const rows = sheet.extractRows ? sheet.extractRows(docText, db) : [];
  const row = rows.find((r) => r.id === rowId) ?? { id: rowId, cells: {} };

  if (col.type === "number") {
    const num = typeof value === "number" ? value : Number(String(value).trim());
    if (String(value).trim() !== "" && Number.isNaN(num)) {
      return {
        valid: false,
        severity: "error",
        message: `Expected numeric value for '${col.header}', got '${value}'.`,
      };
    }
  }

  if (col.type === "enum" && col.options) {
    const opts = typeof col.options === "function" ? col.options(row, db) : col.options;
    const allowed = opts.map((o) => (typeof o === "string" ? o : o.value));
    if (value !== "" && value !== null && value !== undefined && !allowed.includes(String(value))) {
      return {
        valid: false,
        severity: "error",
        message: `Invalid option '${value}' for '${col.header}'. Allowed: ${allowed.join(", ")}.`,
      };
    }
  }

  if (col.validate) {
    const customRes = col.validate(value, row, db);
    if (customRes) return customRes;
  }

  return { valid: true };
}

/**
 * Computes context-aware autocompletion items for a cell in a Tabular Sheet.
 */
export function completeTabularCell(
  config: TabularConfig,
  docText: string,
  sheetId: string,
  rowId: string,
  columnId: string,
  prefix: string,
  db?: unknown,
): TabularCompletionItem[] {
  const sheet = config.sheets[sheetId] ?? config.sheets[config.defaultSheet ?? ""] ?? Object.values(config.sheets)[0];
  if (!sheet) return [];

  const dynamicCols = sheet.dynamicColumns ? sheet.dynamicColumns(docText, db) : [];
  const col = sheet.columns.find((c) => c.id === columnId) ?? dynamicCols.find((c) => c.id === columnId);
  if (!col) return [];

  const rows = sheet.extractRows ? sheet.extractRows(docText, db) : [];
  const row = rows.find((r) => r.id === rowId) ?? { id: rowId, cells: {} };

  if (col.complete) {
    return col.complete(prefix, row, db);
  }

  if (col.options) {
    const opts = typeof col.options === "function" ? col.options(row, db) : col.options;
    const lowerPrefix = prefix.toLowerCase();
    return opts
      .map((o) =>
        typeof o === "string"
          ? { label: o, kind: "enum", detail: col.header }
          : { label: o.value, kind: "enum", detail: o.description ?? o.label },
      )
      .filter((item) => !lowerPrefix || item.label.toLowerCase().includes(lowerPrefix));
  }

  return [];
}

/**
 * Applies a bidirectional `TabularMutationRequest` (cell edit, row insert, row delete,
 * row move, matrix cell toggle, or batch update) to the underlying source text.
 */
export function applyTabularMutation(
  config: TabularConfig,
  docText: string,
  mutation: TabularMutationRequest,
  db?: unknown,
): TabularMutationResult {
  const sheet =
    config.sheets[mutation.sheetId] ?? config.sheets[config.defaultSheet ?? ""] ?? Object.values(config.sheets)[0];

  if (!sheet) {
    return {
      success: false,
      edits: [],
      newText: docText,
      error: `Unknown tabular sheet '${mutation.sheetId}'.`,
    };
  }

  switch (mutation.kind) {
    case "updateCell": {
      const validation = validateTabularCell(
        config,
        docText,
        mutation.sheetId,
        mutation.rowId,
        mutation.columnId,
        mutation.value,
        db,
      );
      if (!validation.valid && validation.severity === "error") {
        return {
          success: false,
          edits: [],
          newText: docText,
          error: validation.message ?? "Cell validation failed.",
        };
      }

      // 1. Check column-specific writeback mutator first
      const dynamicCols = sheet.dynamicColumns ? sheet.dynamicColumns(docText, db) : [];
      const col =
        sheet.columns.find((c) => c.id === mutation.columnId) ?? dynamicCols.find((c) => c.id === mutation.columnId);

      if (col?.writeback?.mutator) {
        const rows = sheet.extractRows ? sheet.extractRows(docText, db) : [];
        const row = rows.find((r) => r.id === mutation.rowId);
        if (row) {
          const res = col.writeback.mutator(docText, row, mutation.value, db);
          if (typeof res === "string") {
            return {
              success: true,
              edits: [{ startOffset: 0, endOffset: docText.length, newText: res }],
              newText: res,
              affectedRowId: mutation.rowId,
            };
          }
          if (res) {
            const edits = Array.isArray(res) ? res : [res];
            const newText = applyWritebackEdits(docText, edits);
            return {
              success: true,
              edits,
              newText,
              affectedRowId: mutation.rowId,
            };
          }
        }
      }

      // 2. Delegate to sheet-level updateCell handler
      if (sheet.mutations?.updateCell) {
        return sheet.mutations.updateCell(docText, mutation.rowId, mutation.columnId, mutation.value, db);
      }

      // 3. Fallback: if the row records an exact cellSpan for this column, patch it surgically
      const rows = sheet.extractRows ? sheet.extractRows(docText, db) : [];
      const row = rows.find((r) => r.id === mutation.rowId);
      const cellSpan = row?.cellSpans?.[mutation.columnId];
      if (cellSpan && cellSpan.startOffset !== undefined && cellSpan.endOffset !== undefined) {
        const formatted =
          typeof col?.writeback?.template === "function"
            ? col.writeback.template(mutation.value, row!)
            : typeof col?.writeback?.template === "string"
              ? col.writeback.template.replace("$value", String(mutation.value))
              : String(mutation.value);
        const edit: WritebackEdit = {
          startOffset: cellSpan.startOffset,
          endOffset: cellSpan.endOffset,
          newText: formatted,
        };
        return {
          success: true,
          edits: [edit],
          newText: applyWritebackEdits(docText, [edit]),
          affectedRowId: mutation.rowId,
        };
      }

      return {
        success: false,
        edits: [],
        newText: docText,
        error: `Column '${mutation.columnId}' on sheet '${mutation.sheetId}' does not support writeback.`,
      };
    }

    case "insertRow": {
      if (!sheet.mutations?.insertRow) {
        return {
          success: false,
          edits: [],
          newText: docText,
          error: `Sheet '${mutation.sheetId}' does not support inserting rows.`,
        };
      }
      return sheet.mutations.insertRow(
        docText,
        {
          afterRowId: mutation.afterRowId,
          parentId: mutation.parentId,
          initialCells: mutation.initialCells,
        },
        db,
      );
    }

    case "deleteRow": {
      if (!sheet.mutations?.deleteRow) {
        return {
          success: false,
          edits: [],
          newText: docText,
          error: `Sheet '${mutation.sheetId}' does not support deleting rows.`,
        };
      }
      return sheet.mutations.deleteRow(docText, mutation.rowId, db);
    }

    case "moveRow": {
      if (!sheet.mutations?.moveRow) {
        return {
          success: false,
          edits: [],
          newText: docText,
          error: `Sheet '${mutation.sheetId}' does not support moving rows.`,
        };
      }
      return sheet.mutations.moveRow(docText, mutation.rowId, mutation.targetParentId, mutation.targetIndex, db);
    }

    case "toggleMatrixCell": {
      if (!sheet.matrix?.mutateCell) {
        return {
          success: false,
          edits: [],
          newText: docText,
          error: `Sheet '${mutation.sheetId}' does not support matrix cell mutations.`,
        };
      }
      return sheet.matrix.mutateCell(docText, mutation.rowId, mutation.colId, mutation.newKind, db);
    }

    case "batchUpdate": {
      let currentText = docText;
      const allEdits: WritebackEdit[] = [];
      for (const item of mutation.updates) {
        const res = applyTabularMutation(
          config,
          currentText,
          {
            kind: "updateCell",
            sheetId: mutation.sheetId,
            rowId: item.rowId,
            columnId: item.columnId,
            value: item.value,
          },
          db,
        );
        if (!res.success) {
          return res;
        }
        currentText = res.newText;
        allEdits.push(...res.edits);
      }
      return {
        success: true,
        edits: allEdits,
        newText: currentText,
      };
    }
  }
}

/**
 * Exports a compiled tabular payload to RFC 4180 CSV text.
 */
export function exportTabularSheetToCsv(payload: CompiledTabularPayload): string {
  const visibleCols = payload.columns.filter((c) => !c.hidden);
  const escapeCsv = (val: unknown): string => {
    const str = val === null || val === undefined ? "" : String(val);
    if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const headerLine = visibleCols.map((c) => escapeCsv(c.header)).join(",");
  const dataLines = payload.rows.map((row) => visibleCols.map((c) => escapeCsv(row.cells[c.id])).join(","));
  return [headerLine, ...dataLines].join("\n");
}

/**
 * Exports a compiled tabular payload (or subset of rows) to Tab-Separated Values (TSV)
 * for direct clipboard paste into Excel / Google Sheets / Polarion / DOORS.
 */
export function exportTabularSheetToTsv(payload: CompiledTabularPayload, rowIds?: string[]): string {
  const visibleCols = payload.columns.filter((c) => !c.hidden);
  const selectedSet = rowIds ? new Set(rowIds) : null;
  const targetRows = selectedSet ? payload.rows.filter((r) => selectedSet.has(r.id)) : payload.rows;

  const cleanTsv = (val: unknown): string =>
    val === null || val === undefined ? "" : String(val).replace(/\t/g, " ").replace(/\r?\n/g, " ");

  const headerLine = visibleCols.map((c) => cleanTsv(c.header)).join("\t");
  const dataLines = targetRows.map((row) => visibleCols.map((c) => cleanTsv(row.cells[c.id])).join("\t"));
  return [headerLine, ...dataLines].join("\n");
}
