// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  ChevronDownIcon,
  ChevronUpIcon,
  DownloadIcon,
  GraphIcon,
  PlusIcon,
  SearchIcon,
  TableIcon,
  TrashIcon,
  XCircleFillIcon,
} from "@primer/octicons-react";
import { Button, Text, TextInput } from "@primer/react";
import { useVirtualizer } from "@tanstack/react-virtual";
import DOMPurify from "dompurify";
import Papa from "papaparse";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styled from "styled-components";
import { useEditorTheme as useTheme } from "../host";
import Box from "./Box";
import Spinner from "./Spinner";
import { adaptSvgMarkupForTheme } from "./svg-theme.js";
import {
  applyPasteBlock,
  deleteGridColumn,
  deleteGridRow,
  insertGridColumn,
  insertGridRow,
  normalizeGridRange,
  type ParsedTabularGrid,
  parseTabularGrid,
  serializeGridToCsv,
  serializeRangeToTsv,
  updateGridCell,
} from "./tabular-grid-utils.js";

export interface DatasetColumn {
  name: string;
  type: "number" | "string" | "boolean" | string;
  unit?: string | undefined;
  description?: string | undefined;
  min?: number | undefined;
  max?: number | undefined;
  mean?: number | undefined;
  unique?: number | undefined;
}

export interface CsvViewerProps {
  viewConfig: {
    data?: string | string[][] | undefined;
    code?: string | undefined;
    url?: string | undefined;
    title?: string | undefined;
    maxPreviewRows?: number | undefined;
    columns?: DatasetColumn[] | undefined;
    previewRows?: string[][] | undefined;
    rows?: string[][] | undefined;
    rowCount?: number | undefined;
    format?: "csv" | "tsv" | "json" | string | undefined;
    hasHeader?: boolean | undefined;
    delimiter?: string | undefined;
    initialMode?: "chart" | "table" | undefined;
    svg?: string | undefined;
    thumbnailUrl?: string | undefined;
    thumbnail_url?: string | undefined;
    [key: string]: unknown;
  };
  isFullScreen?: boolean | undefined;
  thumbnailUrl?: string | undefined;
  dialect?: string | undefined;
  editable?: boolean | undefined;
  onCodeChange?: ((newCode: string) => void) | undefined;
  onRevealLine?: ((line: number) => void) | undefined;
}

import { buildClientTelemetrySvg } from "./csv-telemetry-chart.js";
export { buildClientTelemetrySvg };

const TableWrapper = styled.div<{ $isFullScreen?: boolean | undefined }>`
  width: 100%;
  height: ${(props) => (props.$isFullScreen ? "100%" : "440px")};
  max-height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--color-canvas-default, #0d1117);
  border: 1px solid var(--color-border-default, #30363d);
  border-radius: ${(props) => (props.$isFullScreen ? "0" : "8px")};
  overflow: hidden;
  font-family: inherit;
  position: relative;
`;

const Toolbar = styled.div`
  min-height: 44px;
  background: var(--color-canvas-subtle, #161b22);
  border-bottom: 1px solid var(--color-border-default, #30363d);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 12px;
  gap: 10px;
  flex-wrap: wrap;
`;

const ModeToggleGroup = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 2px;
  border-radius: 6px;
  background: var(--color-canvas-default, rgba(255, 255, 255, 0.04));
  border: 1px solid var(--color-border-default, #30363d);
`;

const ModeToggleButton = styled.button<{ $active: boolean }>`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  border-radius: 4px;
  border: none;
  font-size: 11px;
  font-weight: ${(p) => (p.$active ? 600 : 500)};
  font-family: var(--font-mono, monospace);
  cursor: pointer;
  background: ${(p) => (p.$active ? "var(--color-neutral-muted, rgba(127, 127, 127, 0.15))" : "transparent")};
  color: ${(p) => (p.$active ? "var(--color-fg-default, #f1f5f9)" : "var(--color-fg-muted, #8b949e)")};
  transition:
    background 0.12s ease,
    color 0.12s ease;

  &:hover {
    color: var(--color-fg-default, #f1f5f9);
  }
`;

const ChartContainer = styled.div<{ $isFullScreen?: boolean | undefined; $isDark?: boolean | undefined }>`
  flex: 1;
  width: 100%;
  height: ${(props) => (props.$isFullScreen ? "100%" : "calc(100% - 44px)")};
  min-height: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  position: relative;
  background: var(--color-canvas-default, #0d1117);
  overflow: hidden;
  padding: 8px 12px;

  svg {
    max-width: 100%;
    max-height: 100%;
    width: auto;
    height: auto;
    border-radius: 4px;
    box-shadow: none;
  }
`;

const SwitchToTablePill = styled.button`
  position: absolute;
  bottom: 14px;
  right: 14px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 12px;
  background: var(--color-canvas-default, #0d1117);
  border: 1px solid var(--color-border-default, #30363d);
  border-radius: 20px;
  color: var(--color-fg-default, #e6edf3);
  font-size: 11.5px;
  font-weight: 500;
  cursor: pointer;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
  transition: all 0.15s ease;
  z-index: 5;

  &:hover {
    background: var(--color-canvas-subtle, #161b22);
    border-color: var(--color-border-default, #30363d);
    transform: translateY(-1px);
  }
`;

const StatsDrawer = styled.div`
  background: var(--color-canvas-subtle, #161b22);
  border-bottom: 1px solid var(--color-border-default, #30363d);
  padding: 10px 14px;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 8px;
  max-height: 150px;
  overflow-y: auto;
  font-size: 11.5px;
`;

const StatCard = styled.div`
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid var(--color-border-subtle, rgba(255, 255, 255, 0.08));
  border-radius: 6px;
  padding: 6px 8px;
  display: flex;
  flex-direction: column;
  gap: 3px;
`;

const TypePill = styled.span<{ $type?: string | undefined }>`
  display: inline-block;
  font-size: 9.5px;
  font-family: var(--font-mono, monospace);
  padding: 1px 4px;
  border-radius: 3px;
  font-weight: 600;
  text-transform: uppercase;

  ${(props) => {
    switch (props.$type?.toLowerCase()) {
      case "number":
        return "background: rgba(6, 182, 212, 0.15); color: #22d3ee; border: 1px solid rgba(6, 182, 212, 0.3);";
      case "boolean":
        return "background: rgba(168, 85, 247, 0.15); color: #c084fc; border: 1px solid rgba(168, 85, 247, 0.3);";
      default:
        return "background: rgba(255, 255, 255, 0.06); color: #94a3b8; border: 1px solid rgba(255, 255, 255, 0.1);";
    }
  }}
`;

const TableContainer = styled.div`
  flex: 1;
  overflow: auto;
`;

const StyledTable = styled.table`
  width: 100%;
  border-collapse: collapse;
  font-size: 12.5px;
  text-align: left;
  font-variant-numeric: tabular-nums;

  th {
    position: sticky;
    top: 0;
    background: var(--color-canvas-subtle, #161b22);
    border-bottom: 2px solid var(--color-border-default, #30363d);
    padding: 8px 12px;
    font-weight: 600;
    color: var(--color-text-primary, #e6edf3);
    cursor: pointer;
    user-select: none;
    white-space: nowrap;
    z-index: 2;

    &:first-child {
      left: 0;
      z-index: 3;
      border-right: 1px solid var(--color-border-subtle, #21262d);
    }

    &:hover {
      background: rgba(255, 255, 255, 0.05);
    }
  }

  td {
    padding: 7px 12px;
    border-bottom: 1px solid var(--color-border-subtle, #21262d);
    color: var(--color-text-secondary, #8b949e);
    white-space: nowrap;
    max-width: 300px;
    overflow: hidden;
    text-overflow: ellipsis;

    &:first-child {
      position: sticky;
      left: 0;
      z-index: 1;
      background: var(--color-canvas-default, #0d1117);
      color: var(--color-text-primary, #e6edf3);
      font-weight: 500;
      border-right: 1px solid var(--color-border-subtle, #21262d);
    }
  }

  tr:hover td {
    background: rgba(255, 255, 255, 0.02);
    color: var(--color-text-primary, #e6edf3);

    &:first-child {
      background: var(--color-canvas-subtle, #161b22);
    }
  }
`;

const CellInput = styled.input`
  width: 100%;
  min-width: 72px;
  padding: 2px 6px;
  margin: -3px -6px;
  font-size: 12.5px;
  font-family: inherit;
  font-variant-numeric: tabular-nums;
  color: var(--color-text-primary, #e6edf3);
  background: var(--color-canvas-default, #0d1117);
  border: 1.5px solid var(--ms-brand, #0891b2);
  border-radius: 4px;
  outline: none;
  box-sizing: border-box;
`;

const RowActionBtn = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  padding: 0;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--color-text-muted, #8b949e);
  cursor: pointer;
  opacity: 0.55;
  transition:
    opacity 0.12s ease,
    color 0.12s ease,
    background-color 0.12s ease;

  &:hover {
    opacity: 1;
    color: var(--color-danger-fg, #f85149);
    background: rgba(248, 81, 73, 0.12);
  }
`;

const PaginationBar = styled.div`
  height: 36px;
  min-height: 36px;
  background: var(--color-canvas-subtle, #161b22);
  border-top: 1px solid var(--color-border-default, #30363d);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px;
  font-size: 11.5px;
  color: var(--color-text-muted, #8b949e);
  gap: 8px;
`;

export const CsvViewer: React.FC<CsvViewerProps> = ({
  viewConfig,
  isFullScreen,
  thumbnailUrl,
  dialect,
  editable,
  onCodeChange,
  onRevealLine,
}) => {
  const { theme } = useTheme();
  const isDark = theme === "dark";

  const [csvData, setCsvData] = useState<string[][]>([]);
  const [parsedMeta, setParsedMeta] = useState<ParsedTabularGrid | null>(null);
  const [activeTableId, setActiveTableId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showStats, setShowStats] = useState(false);

  // Interactive cell selection, range, undo/redo & inline editing state
  const [activeCell, setActiveCell] = useState<{ row: number; col: number } | null>(null);
  const [selectionAnchor, setSelectionAnchor] = useState<{ row: number; col: number } | null>(null);
  const [editingCell, setEditingCell] = useState<{ row: number; col: number } | null>(null);
  const [editValue, setEditValue] = useState("");
  const cellInputRef = useRef<HTMLInputElement | null>(null);
  const tableContainerRef = useRef<HTMLDivElement | null>(null);
  const [history, setHistory] = useState<Array<{ headers: string[]; rows: string[][] }>>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);

  // User tab selection override (null = auto default to table when editable, else chart if available)
  const [userSelectedMode, setUserSelectedMode] = useState<"chart" | "table" | null>(() => {
    if (viewConfig?.initialMode === "table" || viewConfig?.initialMode === "chart") return viewConfig.initialMode;
    if (onCodeChange) return "table";
    return null;
  });

  useEffect(() => {
    if (viewConfig?.initialMode === "table" || viewConfig?.initialMode === "chart") {
      setUserSelectedMode(viewConfig.initialMode);
    } else if (onCodeChange) {
      setUserSelectedMode("table");
    } else {
      setUserSelectedMode(null);
    }
  }, [viewConfig?.initialMode, onCodeChange]);

  // SVG markup state (either directly in viewConfig.svg or fetched from thumbnailUrl)
  const [svgMarkup, setSvgMarkup] = useState<string | null>(() => {
    if (typeof viewConfig?.svg === "string" && viewConfig.svg.trim().startsWith("<svg")) {
      return viewConfig.svg.trim();
    }
    return null;
  });

  const resolvedThumbUrl = useMemo(() => {
    const candidate =
      (typeof viewConfig?.thumbnailUrl === "string" && viewConfig.thumbnailUrl) ||
      (typeof viewConfig?.thumbnail_url === "string" && viewConfig.thumbnail_url) ||
      (typeof thumbnailUrl === "string" && thumbnailUrl) ||
      null;
    return candidate;
  }, [viewConfig?.thumbnailUrl, viewConfig?.thumbnail_url, thumbnailUrl]);

  useEffect(() => {
    if (typeof viewConfig?.svg === "string" && viewConfig.svg.trim().startsWith("<svg")) {
      setSvgMarkup(viewConfig.svg.trim());
      return;
    }
    setSvgMarkup(null);
    if (resolvedThumbUrl && (resolvedThumbUrl.endsWith(".svg") || resolvedThumbUrl.includes(".svg"))) {
      let active = true;
      const controller = new AbortController();
      fetch(resolvedThumbUrl, { signal: controller.signal })
        .then((res) => (res.ok ? res.text() : null))
        .then((text) => {
          if (active && !controller.signal.aborted && text && text.includes("<svg")) {
            setSvgMarkup(text.trim());
          }
        })
        .catch(() => {});
      return () => {
        active = false;
        controller.abort();
      };
    }
  }, [viewConfig?.svg, resolvedThumbUrl]);

  // Table controls
  const [searchQuery, setSearchQuery] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(() =>
    typeof viewConfig?.maxPreviewRows === "number" && viewConfig.maxPreviewRows > 0 ? viewConfig.maxPreviewRows : 50,
  );
  const [sortCol, setSortCol] = useState<number | null>(null);
  const [sortAsc, setSortAsc] = useState(true);

  const effectiveDelimiter = useMemo(() => {
    if (typeof viewConfig?.delimiter === "string" && viewConfig.delimiter.length > 0) {
      return viewConfig.delimiter;
    }
    if (typeof viewConfig?.format === "string" && viewConfig.format.toLowerCase() === "tsv") {
      return "\t";
    }
    return undefined;
  }, [viewConfig?.delimiter, viewConfig?.format]);

  const parseCsvText = useCallback(
    (text: string) => {
      try {
        const parsed = parseTabularGrid(text, {
          dialect: dialect ?? (typeof viewConfig?.format === "string" ? viewConfig.format : undefined),
          format: typeof viewConfig?.format === "string" ? viewConfig.format : undefined,
          delimiter: effectiveDelimiter,
          hasHeader: viewConfig?.hasHeader,
        });
        setParsedMeta(parsed);
        if (parsed.tables && parsed.tables.length > 0) {
          const target = parsed.tables.find((t) => t.id === activeTableId) ?? parsed.tables[0]!;
          setActiveTableId(target.id);
          setCsvData(target.headers.length > 0 ? [target.headers, ...target.rows] : target.rows);
        } else {
          setActiveTableId(null);
          setCsvData(parsed.headers.length > 0 ? [parsed.headers, ...parsed.rows] : parsed.rows);
        }
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to parse tabular format");
      }
    },
    [dialect, viewConfig?.format, effectiveDelimiter, viewConfig?.hasHeader, activeTableId],
  );

  useEffect(() => {
    setError(null);

    // 1. Structured DatasetDetails from dataset-handler
    if (viewConfig?.columns && (viewConfig.previewRows || viewConfig.rows)) {
      setLoading(false);
      setParsedMeta(null);
      const headerRow = viewConfig.columns.map((c) => c.name);
      const dataRows = viewConfig.previewRows || viewConfig.rows || [];
      setCsvData([headerRow, ...dataRows]);
      return;
    }

    // 2. Direct string or 2D array via code or data
    const inlineSource = viewConfig?.code ?? viewConfig?.data;
    if (inlineSource !== undefined && inlineSource !== null) {
      setLoading(false);
      if (typeof inlineSource === "string") {
        parseCsvText(inlineSource);
      } else if (Array.isArray(inlineSource)) {
        setParsedMeta(null);
        setCsvData(inlineSource);
      }
      return;
    }

    // 3. Remote URL
    if (viewConfig?.url) {
      let active = true;
      const controller = new AbortController();
      setLoading(true);
      fetch(viewConfig.url, { signal: controller.signal })
        .then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status} loading dataset`);
          return res.text();
        })
        .then((text) => {
          if (!active || controller.signal.aborted) return;
          parseCsvText(text);
          setLoading(false);
        })
        .catch((err) => {
          if (!active || controller.signal.aborted || err?.name === "AbortError") return;
          setError(err.message);
          setLoading(false);
        });
      return () => {
        active = false;
        controller.abort();
      };
    }

    setLoading(false);
    setParsedMeta(null);
    setCsvData([]);
  }, [viewConfig, parseCsvText]);

  useEffect(() => {
    if (!loading && typeof window !== "undefined") {
      (window as unknown as { __ARTIFACT_READY?: boolean }).__ARTIFACT_READY = true;
    }
  }, [loading, csvData]);

  useEffect(() => {
    if (editingCell && cellInputRef.current) {
      cellInputRef.current.focus();
      cellInputRef.current.select();
    }
  }, [editingCell]);

  const hasExplicitColumns = Boolean(viewConfig?.columns && (viewConfig.previewRows || viewConfig.rows));
  const hasHeader = parsedMeta ? true : hasExplicitColumns ? true : viewConfig?.hasHeader !== false;

  const isEditable = useMemo(() => {
    if (editable === false) return false;
    if (!onCodeChange) return false;
    if (parsedMeta) return parsedMeta.editable;
    return editable === true;
  }, [editable, onCodeChange, parsedMeta]);

  const headers = useMemo(() => {
    const firstRow = csvData[0] || [];
    if (!hasHeader) {
      return firstRow.map((_, idx) => `Col ${idx + 1}`);
    }
    return firstRow;
  }, [csvData, hasHeader]);

  const maxPreviewRows = typeof viewConfig?.maxPreviewRows === "number" ? viewConfig.maxPreviewRows : 0;
  const rawRows = useMemo(() => {
    const sliced = hasHeader ? csvData.slice(1) : csvData;
    if (maxPreviewRows > 0) {
      return sliced.slice(0, maxPreviewRows);
    }
    return sliced;
  }, [csvData, hasHeader, maxPreviewRows]);

  const applyGridSnapshot = useCallback(
    (nextHeaders: string[], nextRows: string[][]) => {
      const nextMatrix = hasHeader && nextHeaders.length > 0 ? [nextHeaders, ...nextRows] : nextRows;
      setCsvData(nextMatrix);
      if (onCodeChange) {
        const delim = parsedMeta?.delimiter ?? effectiveDelimiter ?? ",";
        const comments = parsedMeta?.leadingComments ?? [];
        const includeHdr = parsedMeta ? viewConfig?.hasHeader !== false : hasHeader;
        onCodeChange(serializeGridToCsv(nextHeaders, nextRows, delim, comments, includeHdr));
      }
    },
    [hasHeader, onCodeChange, parsedMeta, effectiveDelimiter, viewConfig?.hasHeader],
  );

  const emitGridChange = useCallback(
    (nextHeaders: string[], nextRows: string[][]) => {
      setHistory((prev) => {
        const base =
          historyIdx >= 0
            ? prev.slice(0, historyIdx + 1)
            : [{ headers: [...headers], rows: rawRows.map((r) => [...r]) }];
        const next = [...base, { headers: [...nextHeaders], rows: nextRows.map((r) => [...r]) }].slice(-50);
        setHistoryIdx(next.length - 1);
        return next;
      });
      applyGridSnapshot(nextHeaders, nextRows);
    },
    [applyGridSnapshot, historyIdx, headers, rawRows],
  );

  const canUndo = isEditable && historyIdx > 0;
  const canRedo = isEditable && historyIdx >= 0 && historyIdx < history.length - 1;

  const handleUndo = useCallback(() => {
    if (!canUndo) return;
    const targetIdx = historyIdx - 1;
    const snap = history[targetIdx];
    if (!snap) return;
    setHistoryIdx(targetIdx);
    setEditingCell(null);
    applyGridSnapshot(snap.headers, snap.rows);
  }, [canUndo, historyIdx, history, applyGridSnapshot]);

  const handleRedo = useCallback(() => {
    if (!canRedo) return;
    const targetIdx = historyIdx + 1;
    const snap = history[targetIdx];
    if (!snap) return;
    setHistoryIdx(targetIdx);
    setEditingCell(null);
    applyGridSnapshot(snap.headers, snap.rows);
  }, [canRedo, historyIdx, history, applyGridSnapshot]);

  const startEditingCell = useCallback(
    (row: number, col: number, initialVal?: string) => {
      if (!isEditable) return;
      const currentVal =
        initialVal !== undefined ? initialVal : row === -1 ? (headers[col] ?? "") : (rawRows[row]?.[col] ?? "");
      setActiveCell({ row, col });
      setEditingCell({ row, col });
      setEditValue(currentVal);
    },
    [isEditable, headers, rawRows],
  );

  const commitCellEdit = useCallback(
    (nextMove?: "down" | "right" | "left" | null) => {
      if (!editingCell) return;
      const { row, col } = editingCell;
      const currentVal = row === -1 ? (headers[col] ?? "") : (rawRows[row]?.[col] ?? "");
      if (editValue !== currentVal) {
        const updated = updateGridCell(headers, rawRows, row, col, editValue);
        emitGridChange(updated.headers, updated.rows);
      }
      setEditingCell(null);

      if (nextMove === "down" && row + 1 < rawRows.length) {
        setActiveCell({ row: row + 1, col });
      } else if (nextMove === "right") {
        if (col + 1 < headers.length) {
          setActiveCell({ row, col: col + 1 });
        } else if (row + 1 < rawRows.length) {
          setActiveCell({ row: row + 1, col: 0 });
        }
      } else if (nextMove === "left") {
        if (col - 1 >= 0) {
          setActiveCell({ row, col: col - 1 });
        } else if (row - 1 >= 0) {
          setActiveCell({ row: row - 1, col: Math.max(0, headers.length - 1) });
        }
      }
    },
    [editingCell, editValue, headers, rawRows, emitGridChange],
  );

  const handleAddRow = useCallback(() => {
    if (!isEditable) return;
    const afterIdx = activeCell && activeCell.row >= 0 ? activeCell.row : undefined;
    const nextRows = insertGridRow(headers, rawRows, afterIdx);
    emitGridChange(headers, nextRows);
    const newRowIdx = afterIdx !== undefined ? afterIdx + 1 : nextRows.length - 1;
    setActiveCell({ row: newRowIdx, col: 0 });
    setEditingCell({ row: newRowIdx, col: 0 });
    setEditValue("");
  }, [isEditable, activeCell, headers, rawRows, emitGridChange]);

  const handleDeleteRow = useCallback(
    (rowIdx: number) => {
      if (!isEditable) return;
      const nextRows = deleteGridRow(rawRows, rowIdx);
      emitGridChange(headers, nextRows);
      setEditingCell(null);
      setActiveCell(null);
    },
    [isEditable, headers, rawRows, emitGridChange],
  );

  const handleAddColumn = useCallback(() => {
    if (!isEditable) return;
    const afterCol = activeCell ? activeCell.col : undefined;
    const updated = insertGridColumn(headers, rawRows, afterCol);
    emitGridChange(updated.headers, updated.rows);
    const newColIdx = afterCol !== undefined ? afterCol + 1 : updated.headers.length - 1;
    setActiveCell({ row: -1, col: newColIdx });
    setEditingCell({ row: -1, col: newColIdx });
    setEditValue(updated.headers[newColIdx] ?? "");
  }, [isEditable, activeCell, headers, rawRows, emitGridChange]);

  const handleDeleteColumn = useCallback(
    (colIdx: number) => {
      if (!isEditable || headers.length <= 1) return;
      const updated = deleteGridColumn(headers, rawRows, colIdx);
      emitGridChange(updated.headers, updated.rows);
      setEditingCell(null);
      setActiveCell(null);
    },
    [isEditable, headers, rawRows, emitGridChange],
  );

  const columnsMeta = useMemo<DatasetColumn[]>(() => {
    if (Array.isArray(viewConfig?.columns) && viewConfig.columns.length > 0) {
      return viewConfig.columns;
    }
    if (headers.length === 0 || rawRows.length === 0) return [];
    return headers.map((h, colIdx) => {
      let min = Infinity;
      let max = -Infinity;
      let sum = 0;
      let numCount = 0;
      let boolCount = 0;
      let nonEmptyCount = 0;
      const uniqueSet = new Set<string>();
      for (const row of rawRows) {
        const raw = row[colIdx];
        const str = raw !== undefined && raw !== null ? String(raw).trim() : "";
        if (str === "") continue;
        nonEmptyCount++;
        uniqueSet.add(str);
        const n = Number(str);
        if (Number.isFinite(n)) {
          numCount++;
          if (n < min) min = n;
          if (n > max) max = n;
          sum += n;
        } else if (str.toLowerCase() === "true" || str.toLowerCase() === "false") {
          boolCount++;
        }
      }
      const isNumber = nonEmptyCount > 0 && numCount / nonEmptyCount >= 0.6;
      const isBoolean = !isNumber && nonEmptyCount > 0 && boolCount / nonEmptyCount >= 0.8;
      return {
        name: h,
        type: isNumber ? "number" : isBoolean ? "boolean" : "string",
        min: isNumber && numCount > 0 ? min : undefined,
        max: isNumber && numCount > 0 ? max : undefined,
        mean: isNumber && numCount > 0 ? sum / numCount : undefined,
        unique: uniqueSet.size,
      };
    });
  }, [viewConfig, headers, rawRows]);

  const chartTitle = (typeof viewConfig?.title === "string" && viewConfig.title.trim()) || "Dataset Telemetry";
  const fallbackChartSvg = useMemo(() => {
    if (svgMarkup) return null;
    if (headers.length > 0 && rawRows.length > 0) {
      return buildClientTelemetrySvg(headers, rawRows, chartTitle);
    }
    return null;
  }, [svgMarkup, headers, rawRows, chartTitle]);

  const rawActiveSvg = svgMarkup || fallbackChartSvg;

  const displaySvg = useMemo(() => {
    if (!rawActiveSvg) return null;
    const themed = adaptSvgMarkupForTheme(rawActiveSvg, isDark);
    return typeof DOMPurify.sanitize === "function"
      ? DOMPurify.sanitize(themed, { USE_PROFILES: { svg: true, svgFilters: true } })
      : themed;
  }, [rawActiveSvg, isDark]);

  const hasChart = Boolean(displaySvg || resolvedThumbUrl);
  const activeMode: "chart" | "table" = userSelectedMode ?? (hasChart ? "chart" : "table");

  const isFiltering = searchQuery.trim().length > 0;

  const indexedRows = useMemo(
    () =>
      rawRows.map((row, idx) => ({
        row,
        originalIdx: idx,
        lineNumber: parsedMeta?.rowLineNumbers[idx] ?? idx + (hasHeader ? 2 : 1),
      })),
    [rawRows, parsedMeta, hasHeader],
  );

  // Search filtering
  const filteredRows = useMemo(() => {
    if (!isFiltering) return indexedRows;
    const q = searchQuery.trim().toLowerCase();
    return indexedRows.filter((entry) => entry.row.some((cell) => String(cell).toLowerCase().includes(q)));
  }, [indexedRows, searchQuery, isFiltering]);

  // Column sorting
  const sortedRows = useMemo(() => {
    if (sortCol === null) return filteredRows;
    return [...filteredRows].sort((a, b) => {
      const valA = a.row[sortCol] ?? "";
      const valB = b.row[sortCol] ?? "";
      const isEmptyA = String(valA).trim() === "";
      const isEmptyB = String(valB).trim() === "";
      if (isEmptyA && isEmptyB) return 0;
      if (isEmptyA) return 1;
      if (isEmptyB) return -1;

      const numA = Number(valA);
      const numB = Number(valB);

      if (!isNaN(numA) && !isNaN(numB)) {
        return sortAsc ? numA - numB : numB - numA;
      }
      return sortAsc ? String(valA).localeCompare(String(valB)) : String(valB).localeCompare(String(valA));
    });
  }, [filteredRows, sortCol, sortAsc]);

  // Virtualization for large datasets (>200 rows) vs pagination for smaller ones
  const totalRows = sortedRows.length;
  const reportedTotal = viewConfig?.rowCount || rawRows.length;
  const isVirtualized = totalRows > 200;
  const totalPages = isVirtualized ? 1 : Math.ceil(totalRows / pageSize) || 1;
  const currentPage = Math.min(page, totalPages);

  const rowVirtualizer = useVirtualizer({
    count: isVirtualized ? totalRows : 0,
    getScrollElement: () => tableContainerRef.current,
    estimateSize: () => 31,
    overscan: 12,
  });

  const paginatedRows = useMemo(() => {
    if (isVirtualized) {
      return rowVirtualizer.getVirtualItems().map((vItem) => sortedRows[vItem.index]!);
    }
    const start = (currentPage - 1) * pageSize;
    return sortedRows.slice(start, start + pageSize);
  }, [isVirtualized, rowVirtualizer, sortedRows, currentPage, pageSize]);

  const virtualItems = isVirtualized ? rowVirtualizer.getVirtualItems() : [];
  const virtualPaddingTop = isVirtualized && virtualItems.length > 0 ? virtualItems[0]!.start : 0;
  const virtualPaddingBottom =
    isVirtualized && virtualItems.length > 0
      ? Math.max(0, rowVirtualizer.getTotalSize() - virtualItems[virtualItems.length - 1]!.end)
      : 0;

  const selectedRange = useMemo(() => {
    if (!activeCell) return null;
    if (selectionAnchor) return normalizeGridRange(selectionAnchor, activeCell);
    return { startRow: activeCell.row, startCol: activeCell.col, endRow: activeCell.row, endCol: activeCell.col };
  }, [activeCell, selectionAnchor]);

  const handleHeaderClick = (idx: number) => {
    if (editingCell) return;
    if (sortCol === idx) {
      if (sortAsc) {
        setSortAsc(false);
      } else {
        setSortCol(null);
        setSortAsc(true);
      }
    } else {
      setSortCol(idx);
      setSortAsc(true);
    }
  };

  const handleDownloadCsv = (e: React.MouseEvent) => {
    e.stopPropagation();
    const rawTitle = (typeof viewConfig?.title === "string" && viewConfig.title.trim()) || "dataset";
    const filename = rawTitle.toLowerCase().endsWith(".csv") ? rawTitle : `${rawTitle}.csv`;

    if (typeof viewConfig?.url === "string" && viewConfig.url.trim()) {
      const a = document.createElement("a");
      a.href = viewConfig.url;
      a.download = filename;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.click();
      return;
    }

    const csvString =
      typeof viewConfig?.code === "string"
        ? viewConfig.code
        : typeof viewConfig?.data === "string"
          ? viewConfig.data
          : Papa.unparse(csvData);

    const blob = new Blob([csvString], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const formatBadge = (parsedMeta?.format || viewConfig?.format || dialect || "CSV").toUpperCase();
  const hasMultiplePages = !isVirtualized && totalPages > 1;
  const showPageSizeSelector = !isVirtualized && rawRows.length > 25;
  const showBottomBar = hasMultiplePages || isFiltering || reportedTotal > rawRows.length || isVirtualized;

  if (loading) {
    return (
      <TableWrapper $isFullScreen={isFullScreen}>
        <Box p={4} flex={1} display="flex" justifyContent="center" alignItems="center">
          <Spinner size="small" />
        </Box>
      </TableWrapper>
    );
  }

  if (error) {
    return (
      <TableWrapper $isFullScreen={isFullScreen}>
        <Box p={4} flex={1} display="flex" justifyContent="center" alignItems="center" color="var(--color-danger-fg)">
          <Text>{error}</Text>
        </Box>
      </TableWrapper>
    );
  }

  return (
    <TableWrapper $isFullScreen={isFullScreen}>
      <Toolbar>
        <Box display="flex" alignItems="center" gap={2} flex={1} style={{ minWidth: "180px", maxWidth: "340px" }}>
          <TextInput
            leadingVisual={SearchIcon}
            trailingAction={
              isFiltering ? (
                <TextInput.Action
                  onClick={() => {
                    setSearchQuery("");
                    setPage(1);
                  }}
                  icon={XCircleFillIcon}
                  aria-label="Clear filter"
                  sx={{ color: "fg.subtle" }}
                />
              ) : undefined
            }
            size="small"
            placeholder={`Filter ${reportedTotal} rows, ${headers.length} cols...`}
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setPage(1);
              if (e.target.value.trim().length > 0 && activeMode === "chart") {
                setUserSelectedMode("table");
              }
            }}
            onFocus={() => {
              if (isFiltering && activeMode === "chart") {
                setUserSelectedMode("table");
              }
            }}
            aria-label="Filter rows"
            sx={{ width: "100%" }}
          />
        </Box>

        <Box display="flex" alignItems="center" gap={2} style={{ flexShrink: 0, marginLeft: "auto" }}>
          {hasChart && (
            <ModeToggleGroup role="tablist" aria-label="Dataset view mode">
              <ModeToggleButton
                type="button"
                role="tab"
                aria-selected={activeMode === "chart"}
                $active={activeMode === "chart"}
                onClick={() => setUserSelectedMode("chart")}
                title="Show Visual Telemetry Chart"
              >
                <GraphIcon size={12} />
                <span>Chart</span>
              </ModeToggleButton>
              <ModeToggleButton
                type="button"
                role="tab"
                aria-selected={activeMode === "table"}
                $active={activeMode === "table"}
                onClick={() => setUserSelectedMode("table")}
                title="Inspect Tabular Data"
              >
                <TableIcon size={12} />
                <span>Table</span>
              </ModeToggleButton>
            </ModeToggleGroup>
          )}

          <span
            style={{
              fontSize: "11px",
              fontFamily: "var(--font-mono, monospace)",
              padding: "2px 8px",
              borderRadius: "5px",
              background: "rgba(255, 255, 255, 0.05)",
              border: "1px solid rgba(255, 255, 255, 0.1)",
              color: "var(--color-text-muted, #8b949e)",
              fontWeight: 600,
              whiteSpace: "nowrap",
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
            }}
          >
            <strong style={{ color: "var(--color-text-primary, #e6edf3)" }}>{formatBadge}</strong>
            <span>&middot;</span>
            <span>
              {isFiltering ? `${totalRows} / ${reportedTotal}` : reportedTotal} rows &times; {headers.length} cols
            </span>
          </span>

          {parsedMeta?.tables && parsedMeta.tables.length > 1 && (
            <select
              value={activeTableId ?? parsedMeta.tables[0]?.id ?? ""}
              onChange={(e) => {
                const nextId = e.target.value;
                const target = parsedMeta.tables?.find((t) => t.id === nextId);
                if (target) {
                  setActiveTableId(target.id);
                  setCsvData(target.headers.length > 0 ? [target.headers, ...target.rows] : target.rows);
                  setPage(1);
                  setSortCol(null);
                }
              }}
              aria-label="Select dataset table"
              style={{
                padding: "3px 8px",
                borderRadius: "6px",
                border: "1px solid var(--color-border-default)",
                background: "var(--color-canvas-default)",
                color: "var(--color-text-primary)",
                fontSize: "11.5px",
                whiteSpace: "nowrap",
              }}
            >
              {parsedMeta.tables.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.rows.length})
                </option>
              ))}
            </select>
          )}

          {isEditable && activeMode === "table" && (
            <>
              <Button size="small" disabled={!canUndo} onClick={handleUndo} title="Undo grid edit (Ctrl/Cmd+Z)">
                <Text fontSize="11px">Undo</Text>
              </Button>
              <Button size="small" disabled={!canRedo} onClick={handleRedo} title="Redo grid edit (Ctrl/Cmd+Shift+Z)">
                <Text fontSize="11px">Redo</Text>
              </Button>
              <Button size="small" onClick={handleAddRow} title="Insert a new row">
                <PlusIcon size={12} />
                <Text fontSize="11px" ml={1}>
                  Row
                </Text>
              </Button>
              <Button size="small" onClick={handleAddColumn} title="Insert a new column">
                <PlusIcon size={12} />
                <Text fontSize="11px" ml={1}>
                  Col
                </Text>
              </Button>
            </>
          )}

          {columnsMeta.length > 0 && (
            <Button
              size="small"
              variant={showStats && activeMode === "table" ? "primary" : "default"}
              onClick={() => {
                if (activeMode === "chart") {
                  setUserSelectedMode("table");
                }
                setShowStats((prev) => !prev);
              }}
              title="Toggle column summary statistics (min, max, average)"
            >
              <GraphIcon size={13} />
              <Text fontSize="11px" ml={1}>
                Stats
              </Text>
            </Button>
          )}

          {activeMode === "table" && showPageSizeSelector && (
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setPage(1);
              }}
              aria-label="Rows per page"
              style={{
                padding: "3px 8px",
                borderRadius: "6px",
                border: "1px solid var(--color-border-default)",
                background: "var(--color-canvas-default)",
                color: "var(--color-text-primary)",
                fontSize: "11.5px",
                whiteSpace: "nowrap",
              }}
            >
              <option value={25}>25 / page</option>
              <option value={50}>50 / page</option>
              <option value={100}>100 / page</option>
            </select>
          )}

          {csvData.length > 0 && (
            <Button
              size="small"
              onClick={handleDownloadCsv}
              title="Download CSV file"
              aria-label="Download CSV file"
              sx={{ px: 2 }}
            >
              <DownloadIcon size={13} />
            </Button>
          )}
        </Box>
      </Toolbar>

      {activeMode === "chart" ? (
        <ChartContainer $isFullScreen={isFullScreen} $isDark={isDark}>
          {displaySvg ? (
            <div
              style={{
                width: "100%",
                height: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
              dangerouslySetInnerHTML={{ __html: displaySvg }}
            />
          ) : resolvedThumbUrl ? (
            <img
              src={resolvedThumbUrl}
              alt={typeof viewConfig?.title === "string" ? viewConfig.title : "Telemetry Chart Preview"}
              style={{
                maxWidth: "100%",
                maxHeight: "100%",
                objectFit: "contain",
                borderRadius: "6px",
                boxShadow: "0 4px 20px rgba(0, 0, 0, 0.35)",
              }}
            />
          ) : null}

          <SwitchToTablePill
            type="button"
            onClick={() => setUserSelectedMode("table")}
            title="Switch to full interactive tabular view"
          >
            <TableIcon size={13} />
            <span>
              View Tabular Data ({reportedTotal} {reportedTotal === 1 ? "row" : "rows"})
            </span>
          </SwitchToTablePill>
        </ChartContainer>
      ) : (
        <>
          {showStats && columnsMeta.length > 0 && (
            <StatsDrawer>
              {columnsMeta.map((col) => (
                <StatCard key={col.name}>
                  <Box display="flex" alignItems="center" justifyContent="space-between" gap={1}>
                    <strong
                      style={{ color: "var(--color-text-primary)", overflow: "hidden", textOverflow: "ellipsis" }}
                    >
                      {col.name}
                      {col.unit ? (
                        <span style={{ color: "#22d3ee", fontWeight: 500, marginLeft: 4 }}>[{col.unit}]</span>
                      ) : null}
                    </strong>
                    <TypePill $type={col.type}>{col.type}</TypePill>
                  </Box>
                  {col.type === "number" && (
                    <Box display="flex" gap={2} color="var(--color-text-muted)" fontSize="10.5px">
                      <span>min: {col.min !== undefined ? col.min.toFixed(2) : "—"}</span>
                      <span>max: {col.max !== undefined ? col.max.toFixed(2) : "—"}</span>
                      {col.mean !== undefined && <span>avg: {col.mean.toFixed(2)}</span>}
                    </Box>
                  )}
                  {col.unique !== undefined && (
                    <span style={{ color: "var(--color-text-muted)", fontSize: "10px" }}>
                      {col.unique} unique values
                    </span>
                  )}
                </StatCard>
              ))}
            </StatsDrawer>
          )}

          <TableContainer
            ref={tableContainerRef}
            onCopy={(e) => {
              if (editingCell || !selectedRange || selectedRange.startRow < 0) return;
              e.preventDefault();
              e.clipboardData.setData("text/plain", serializeRangeToTsv(rawRows, selectedRange));
            }}
            onPaste={(e) => {
              if (!isEditable || editingCell || !activeCell || activeCell.row < 0) return;
              const pasteText = e.clipboardData.getData("text/plain");
              if (!pasteText) return;
              e.preventDefault();
              const updated = applyPasteBlock(headers, rawRows, activeCell.row, activeCell.col, pasteText);
              emitGridChange(updated.headers, updated.rows);
            }}
            onKeyDown={(e) => {
              if (!isEditable || editingCell) return;
              const isMod = e.metaKey || e.ctrlKey;
              if (isMod && e.key.toLowerCase() === "z") {
                e.preventDefault();
                if (e.shiftKey) handleRedo();
                else handleUndo();
              } else if (isMod && e.key.toLowerCase() === "y") {
                e.preventDefault();
                handleRedo();
              }
            }}
          >
            <StyledTable>
              <thead>
                <tr>
                  {(isEditable || Boolean(onRevealLine)) && (
                    <th
                      style={{
                        width: isEditable ? 58 : 42,
                        minWidth: isEditable ? 58 : 42,
                        textAlign: "center",
                        cursor: "default",
                        color: "var(--color-text-muted)",
                        fontSize: "11px",
                      }}
                      title="Row number"
                    >
                      #
                    </th>
                  )}
                  {headers.map((h, i) => {
                    const colMeta = columnsMeta[i];
                    const unitBadge = colMeta?.unit && !h.includes(`[${colMeta.unit}]`) ? colMeta.unit : undefined;
                    const isEditingHeader = isEditable && editingCell?.row === -1 && editingCell?.col === i;
                    return (
                      <th
                        key={i}
                        onClick={() => handleHeaderClick(i)}
                        onDoubleClick={(e) => {
                          if (isEditable) {
                            e.stopPropagation();
                            startEditingCell(-1, i, h);
                          }
                        }}
                        title={isEditable ? `Click to sort, double-click to rename "${h}"` : `Sort by ${h}`}
                      >
                        {isEditingHeader ? (
                          <CellInput
                            ref={cellInputRef}
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onClick={(e) => e.stopPropagation()}
                            onBlur={() => commitCellEdit(null)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                commitCellEdit(null);
                              } else if (e.key === "Tab") {
                                e.preventDefault();
                                commitCellEdit(e.shiftKey ? "left" : "right");
                              } else if (e.key === "Escape") {
                                e.preventDefault();
                                setEditingCell(null);
                              }
                            }}
                          />
                        ) : (
                          <Box display="flex" alignItems="center" justifyContent="space-between" gap={1}>
                            <Box display="flex" alignItems="center" gap={1}>
                              <span>{h}</span>
                              {unitBadge && (
                                <span
                                  style={{
                                    color: "#22d3ee",
                                    fontSize: "10.5px",
                                    fontFamily: "var(--font-mono, monospace)",
                                  }}
                                >
                                  [{unitBadge}]
                                </span>
                              )}
                              {sortCol === i ? (
                                sortAsc ? (
                                  <ChevronUpIcon size={12} />
                                ) : (
                                  <ChevronDownIcon size={12} />
                                )
                              ) : null}
                            </Box>
                            {isEditable && headers.length > 1 && (
                              <RowActionBtn
                                type="button"
                                title={`Delete column "${h}"`}
                                aria-label={`Delete column ${h}`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDeleteColumn(i);
                                }}
                              >
                                <TrashIcon size={11} />
                              </RowActionBtn>
                            )}
                          </Box>
                        )}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {virtualPaddingTop > 0 && (
                  <tr>
                    <td
                      colSpan={(headers.length || 1) + (isEditable || Boolean(onRevealLine) ? 1 : 0)}
                      style={{ height: virtualPaddingTop, padding: 0, border: "none" }}
                    />
                  </tr>
                )}
                {paginatedRows.map((entry) => {
                  const { row, originalIdx, lineNumber } = entry;
                  const showGutter = isEditable || Boolean(onRevealLine);
                  return (
                    <tr key={originalIdx}>
                      {showGutter && (
                        <td
                          style={{
                            textAlign: "center",
                            fontSize: "11px",
                            color: "var(--color-text-muted)",
                            cursor: onRevealLine ? "pointer" : "default",
                            userSelect: "none",
                            padding: "4px 6px",
                          }}
                          title={onRevealLine ? `Jump to line ${lineNumber} in editor` : `Row ${originalIdx + 1}`}
                          onClick={() => onRevealLine?.(lineNumber)}
                        >
                          <Box display="flex" alignItems="center" justifyContent="center" gap={1}>
                            <span>{originalIdx + 1}</span>
                            {isEditable && (
                              <RowActionBtn
                                type="button"
                                title={`Delete row ${originalIdx + 1}`}
                                aria-label={`Delete row ${originalIdx + 1}`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDeleteRow(originalIdx);
                                }}
                              >
                                <TrashIcon size={11} />
                              </RowActionBtn>
                            )}
                          </Box>
                        </td>
                      )}
                      {headers.map((_, cIdx) => {
                        const cell = row[cIdx] ?? "";
                        const isSelected = activeCell?.row === originalIdx && activeCell?.col === cIdx;
                        const isInRange =
                          Boolean(selectedRange) &&
                          originalIdx >= selectedRange!.startRow &&
                          originalIdx <= selectedRange!.endRow &&
                          cIdx >= selectedRange!.startCol &&
                          cIdx <= selectedRange!.endCol;
                        const isEditing = editingCell?.row === originalIdx && editingCell?.col === cIdx;
                        return (
                          <td
                            key={cIdx}
                            title={isEditable ? `${String(cell)} (double-click or type to edit)` : String(cell)}
                            style={{
                              ...(isSelected && !isEditing
                                ? {
                                    outline: "1.5px solid var(--ms-brand, #0891b2)",
                                    outlineOffset: "-1.5px",
                                    background: "rgba(8, 145, 178, 0.14)",
                                  }
                                : isInRange && !isEditing
                                  ? {
                                      background: "rgba(8, 145, 178, 0.08)",
                                    }
                                  : undefined),
                              ...(isEditable ? { cursor: "cell" } : undefined),
                            }}
                            tabIndex={isEditable ? 0 : undefined}
                            onClick={(e) => {
                              if (isEditable) {
                                if (e.shiftKey && activeCell) {
                                  if (!selectionAnchor) setSelectionAnchor(activeCell);
                                  setActiveCell({ row: originalIdx, col: cIdx });
                                } else {
                                  setSelectionAnchor(null);
                                  if (isSelected && !isEditing) {
                                    startEditingCell(originalIdx, cIdx, String(cell));
                                  } else {
                                    setActiveCell({ row: originalIdx, col: cIdx });
                                  }
                                }
                              } else {
                                onRevealLine?.(lineNumber);
                              }
                            }}
                            onDoubleClick={() => {
                              if (isEditable) {
                                setSelectionAnchor(null);
                                startEditingCell(originalIdx, cIdx, String(cell));
                              }
                            }}
                            onKeyDown={(e) => {
                              if (!isEditable || isEditing) return;
                              if (e.key === "Enter" || e.key === "F2") {
                                e.preventDefault();
                                startEditingCell(originalIdx, cIdx, String(cell));
                              } else if (e.key === "ArrowDown" && originalIdx + 1 < rawRows.length) {
                                e.preventDefault();
                                if (e.shiftKey && !selectionAnchor) setSelectionAnchor({ row: originalIdx, col: cIdx });
                                else if (!e.shiftKey) setSelectionAnchor(null);
                                setActiveCell({ row: originalIdx + 1, col: cIdx });
                              } else if (e.key === "ArrowUp" && originalIdx > 0) {
                                e.preventDefault();
                                if (e.shiftKey && !selectionAnchor) setSelectionAnchor({ row: originalIdx, col: cIdx });
                                else if (!e.shiftKey) setSelectionAnchor(null);
                                setActiveCell({ row: originalIdx - 1, col: cIdx });
                              } else if (e.key === "ArrowRight" && cIdx + 1 < headers.length) {
                                e.preventDefault();
                                if (e.shiftKey && !selectionAnchor) setSelectionAnchor({ row: originalIdx, col: cIdx });
                                else if (!e.shiftKey) setSelectionAnchor(null);
                                setActiveCell({ row: originalIdx, col: cIdx + 1 });
                              } else if (e.key === "ArrowLeft" && cIdx > 0) {
                                e.preventDefault();
                                if (e.shiftKey && !selectionAnchor) setSelectionAnchor({ row: originalIdx, col: cIdx });
                                else if (!e.shiftKey) setSelectionAnchor(null);
                                setActiveCell({ row: originalIdx, col: cIdx - 1 });
                              } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
                                e.preventDefault();
                                setSelectionAnchor(null);
                                startEditingCell(originalIdx, cIdx, e.key);
                              }
                            }}
                          >
                            {isEditing ? (
                              <CellInput
                                ref={cellInputRef}
                                value={editValue}
                                onChange={(e) => setEditValue(e.target.value)}
                                onBlur={() => commitCellEdit(null)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") {
                                    e.preventDefault();
                                    commitCellEdit("down");
                                  } else if (e.key === "Tab") {
                                    e.preventDefault();
                                    commitCellEdit(e.shiftKey ? "left" : "right");
                                  } else if (e.key === "Escape") {
                                    e.preventDefault();
                                    setEditingCell(null);
                                  }
                                }}
                              />
                            ) : (
                              String(cell)
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
                {virtualPaddingBottom > 0 && (
                  <tr>
                    <td
                      colSpan={(headers.length || 1) + (isEditable || Boolean(onRevealLine) ? 1 : 0)}
                      style={{ height: virtualPaddingBottom, padding: 0, border: "none" }}
                    />
                  </tr>
                )}
                {paginatedRows.length === 0 && (
                  <tr>
                    <td
                      colSpan={(headers.length || 1) + (isEditable || Boolean(onRevealLine) ? 1 : 0)}
                      style={{ textAlign: "center", padding: "24px", color: "var(--color-text-muted)" }}
                    >
                      {csvData.length === 0 ? "No CSV dataset rows available." : `No rows matching "${searchQuery}".`}
                    </td>
                  </tr>
                )}
              </tbody>
            </StyledTable>
          </TableContainer>

          {showBottomBar && (
            <PaginationBar>
              <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {isFiltering ? (
                  <>
                    Found <strong>{totalRows}</strong> matching {totalRows === 1 ? "row" : "rows"} (filtered from{" "}
                    {rawRows.length} total) &mdash;{" "}
                    <button
                      type="button"
                      onClick={() => {
                        setSearchQuery("");
                        setPage(1);
                      }}
                      style={{
                        background: "none",
                        border: "none",
                        color: "var(--color-accent-fg, #58a6ff)",
                        cursor: "pointer",
                        padding: 0,
                        fontSize: "11.5px",
                        textDecoration: "underline",
                      }}
                    >
                      Reset filter
                    </button>
                  </>
                ) : isVirtualized ? (
                  <>
                    Showing all {totalRows} rows (virtualized) of {reportedTotal}
                  </>
                ) : (
                  <>
                    Showing rows {totalRows === 0 ? 0 : (currentPage - 1) * pageSize + 1}&ndash;
                    {Math.min(currentPage * pageSize, totalRows)} of {reportedTotal}
                  </>
                )}
              </span>
              {hasMultiplePages && (
                <Box display="flex" alignItems="center" gap={1} style={{ flexShrink: 0 }}>
                  <Button size="small" disabled={currentPage <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                    Previous
                  </Button>
                  <Text fontSize="11px" mx={1}>
                    Page {currentPage} of {totalPages}
                  </Text>
                  <Button
                    size="small"
                    disabled={currentPage >= totalPages}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  >
                    Next
                  </Button>
                </Box>
              )}
            </PaginationBar>
          )}
        </>
      )}
    </TableWrapper>
  );
};

export default CsvViewer;
