// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  ChevronDownIcon,
  ChevronUpIcon,
  DownloadIcon,
  GraphIcon,
  SearchIcon,
  TableIcon,
  XCircleFillIcon,
} from "@primer/octicons-react";
import { Button, Text, TextInput } from "@primer/react";
import DOMPurify from "dompurify";
import Papa from "papaparse";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import styled from "styled-components";
import { useTheme } from "../../theme";
import Box from "../Box";
import Spinner from "../Spinner";
import { adaptSvgMarkupForTheme } from "./svg-theme.js";

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

export const CsvViewer: React.FC<CsvViewerProps> = ({ viewConfig, isFullScreen, thumbnailUrl }) => {
  const { theme } = useTheme();
  const isDark = theme === "dark";

  const [csvData, setCsvData] = useState<string[][]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showStats, setShowStats] = useState(false);

  // User tab selection override (null = auto default to chart if available, else table)
  const [userSelectedMode, setUserSelectedMode] = useState<"chart" | "table" | null>(() =>
    viewConfig?.initialMode === "table" || viewConfig?.initialMode === "chart" ? viewConfig.initialMode : null,
  );

  useEffect(() => {
    if (viewConfig?.initialMode === "table" || viewConfig?.initialMode === "chart") {
      setUserSelectedMode(viewConfig.initialMode);
    } else {
      setUserSelectedMode(null);
    }
  }, [viewConfig?.initialMode]);

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
        const parsed = Papa.parse<string[]>(text, {
          skipEmptyLines: true,
          ...(effectiveDelimiter ? { delimiter: effectiveDelimiter } : {}),
        });

        if (parsed.errors && parsed.errors.length > 0 && parsed.data.length === 0) {
          throw new Error(parsed.errors[0]?.message || "Failed to parse tabular data");
        }

        setCsvData(parsed.data || []);
      } catch (err: any) {
        setError(err.message || "Failed to parse tabular format");
      }
    },
    [effectiveDelimiter],
  );

  useEffect(() => {
    setError(null);

    // 1. Structured DatasetDetails from dataset-handler
    if (viewConfig?.columns && (viewConfig.previewRows || viewConfig.rows)) {
      setLoading(false);
      const headerRow = viewConfig.columns.map((c) => c.name);
      const dataRows = viewConfig.previewRows || viewConfig.rows || [];
      setCsvData([headerRow, ...dataRows]);
      return;
    }

    // 2. Direct string or 2D array via code or data
    const inlineSource = viewConfig?.code ?? viewConfig?.data;
    if (inlineSource) {
      setLoading(false);
      if (typeof inlineSource === "string") {
        parseCsvText(inlineSource);
      } else if (Array.isArray(inlineSource)) {
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
    setCsvData([]);
  }, [viewConfig, parseCsvText]);

  const hasExplicitColumns = Boolean(viewConfig?.columns && (viewConfig.previewRows || viewConfig.rows));
  const hasHeader = hasExplicitColumns ? true : viewConfig?.hasHeader !== false;

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

  // Search filtering
  const filteredRows = useMemo(() => {
    if (!isFiltering) return rawRows;
    const q = searchQuery.trim().toLowerCase();
    return rawRows.filter((row) => row.some((cell) => String(cell).toLowerCase().includes(q)));
  }, [rawRows, searchQuery, isFiltering]);

  // Column sorting
  const sortedRows = useMemo(() => {
    if (sortCol === null) return filteredRows;
    return [...filteredRows].sort((a, b) => {
      const valA = a[sortCol] ?? "";
      const valB = b[sortCol] ?? "";
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

  // Pagination
  const totalRows = sortedRows.length;
  const reportedTotal = viewConfig?.rowCount || rawRows.length;
  const totalPages = Math.ceil(totalRows / pageSize) || 1;
  const currentPage = Math.min(page, totalPages);
  const paginatedRows = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return sortedRows.slice(start, start + pageSize);
  }, [sortedRows, currentPage, pageSize]);

  const handleHeaderClick = (idx: number) => {
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

  const formatBadge = (viewConfig?.format || "CSV").toUpperCase();
  const hasMultiplePages = totalPages > 1;
  const showPageSizeSelector = rawRows.length > 25;
  const showBottomBar = hasMultiplePages || isFiltering || reportedTotal > rawRows.length;

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

          <TableContainer>
            <StyledTable>
              <thead>
                <tr>
                  {headers.map((h, i) => {
                    const colMeta = columnsMeta[i];
                    const unitBadge = colMeta?.unit && !h.includes(`[${colMeta.unit}]`) ? colMeta.unit : undefined;
                    return (
                      <th key={i} onClick={() => handleHeaderClick(i)} title={`Sort by ${h}`}>
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
                          {sortCol === i ? sortAsc ? <ChevronUpIcon size={12} /> : <ChevronDownIcon size={12} /> : null}
                        </Box>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {paginatedRows.map((row, rIdx) => (
                  <tr key={rIdx}>
                    {row.map((cell, cIdx) => (
                      <td key={cIdx} title={String(cell)}>
                        {String(cell)}
                      </td>
                    ))}
                  </tr>
                ))}
                {paginatedRows.length === 0 && (
                  <tr>
                    <td
                      colSpan={headers.length || 1}
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
