// SPDX-License-Identifier: AGPL-3.0-or-later

/* eslint-disable @typescript-eslint/no-explicit-any */
import { ChevronDownIcon, ChevronUpIcon, GraphIcon, SearchIcon } from "@primer/octicons-react";
import { Button, Spinner, Text, TextInput } from "@primer/react";
import Papa from "papaparse";
import React, { useEffect, useMemo, useState } from "react";
import styled from "styled-components";
import Box from "../Box";

export interface DatasetColumn {
  name: string;
  type: "number" | "string" | "boolean" | string;
  min?: number;
  max?: number;
  mean?: number;
  unique?: number;
}

export interface CsvViewerProps {
  viewConfig: {
    data?: string | string[][];
    url?: string;
    columns?: DatasetColumn[];
    previewRows?: string[][];
    rows?: string[][];
    rowCount?: number;
    format?: "csv" | "tsv" | "json" | string;
    hasHeader?: boolean;
    delimiter?: string;
    [key: string]: unknown;
  };
  isFullScreen?: boolean;
}

const TableWrapper = styled.div<{ $isFullScreen?: boolean }>`
  width: 100%;
  height: ${(props) => (props.$isFullScreen ? "100%" : "440px")};
  display: flex;
  flex-direction: column;
  background: var(--color-canvas-default, #0d1117);
  border: 1px solid var(--color-border-default, #30363d);
  border-radius: ${(props) => (props.$isFullScreen ? "0" : "8px")};
  overflow: hidden;
  font-family: inherit;
`;

const Toolbar = styled.div`
  height: 44px;
  min-height: 44px;
  background: var(--surface-hud, rgba(14, 20, 36, 0.7));
  border-bottom: 1px solid var(--color-border-default, #30363d);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px;
  gap: 12px;
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
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
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 6px;
  padding: 6px 8px;
  display: flex;
  flex-direction: column;
  gap: 3px;
`;

const TypePill = styled.span<{ $type?: string }>`
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
  }

  tr:hover td {
    background: rgba(255, 255, 255, 0.02);
    color: var(--color-text-primary, #e6edf3);
  }
`;

const PaginationBar = styled.div`
  height: 38px;
  min-height: 38px;
  background: var(--color-canvas-subtle, #161b22);
  border-top: 1px solid var(--color-border-default, #30363d);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px;
  font-size: 11.5px;
  color: var(--color-text-muted, #8b949e);
`;

const CsvViewer: React.FC<CsvViewerProps> = ({ viewConfig, isFullScreen }) => {
  const [csvData, setCsvData] = useState<string[][]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showStats, setShowStats] = useState(false);

  // Table controls
  const [searchQuery, setSearchQuery] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [sortCol, setSortCol] = useState<number | null>(null);
  const [sortAsc, setSortAsc] = useState(true);

  const columnsMeta: DatasetColumn[] = Array.isArray(viewConfig?.columns) ? viewConfig.columns : [];

  const parseCsvText = (text: string) => {
    try {
      const parsed = Papa.parse<string[]>(text, {
        skipEmptyLines: true,
      });

      if (parsed.errors && parsed.errors.length > 0 && parsed.data.length === 0) {
        throw new Error(parsed.errors[0]?.message || "Failed to parse tabular data");
      }

      setCsvData(parsed.data || []);
    } catch (err: any) {
      setError(err.message || "Failed to parse tabular format");
    }
  };

  useEffect(() => {
    // 1. Structured DatasetDetails from dataset-handler
    if (viewConfig?.columns && (viewConfig.previewRows || viewConfig.rows)) {
      const headerRow = viewConfig.columns.map((c) => c.name);
      const dataRows = viewConfig.previewRows || viewConfig.rows || [];
      setCsvData([headerRow, ...dataRows]);
      return;
    }

    // 2. Direct string or 2D array
    if (viewConfig?.data) {
      if (typeof viewConfig.data === "string") {
        parseCsvText(viewConfig.data);
      } else if (Array.isArray(viewConfig.data)) {
        setCsvData(viewConfig.data);
      }
      return;
    }

    // 3. Remote URL
    if (viewConfig?.url) {
      setLoading(true);
      fetch(viewConfig.url)
        .then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status} loading dataset`);
          return res.text();
        })
        .then((text) => {
          parseCsvText(text);
          setLoading(false);
        })
        .catch((err) => {
          setError(err.message);
          setLoading(false);
        });
      return;
    }

    // Fallback sample data if empty
    setCsvData([
      ["timestamp_s", "angular_velocity_rad_s", "motor_current_a", "temperature_c", "state"],
      ["0.00", "0.000", "0.12", "22.4", "IDLE"],
      ["0.05", "12.450", "2.84", "22.6", "ACCEL"],
      ["0.10", "48.210", "4.15", "23.1", "ACCEL"],
      ["0.15", "96.500", "3.90", "23.8", "CRUISE"],
      ["0.20", "96.480", "2.10", "24.2", "CRUISE"],
      ["0.25", "96.510", "2.12", "24.5", "CRUISE"],
    ]);
  }, [viewConfig]);

  const headers = useMemo(() => csvData[0] || [], [csvData]);
  const rawRows = useMemo(() => csvData.slice(1), [csvData]);

  // Search filtering
  const filteredRows = useMemo(() => {
    if (!searchQuery.trim()) return rawRows;
    const q = searchQuery.toLowerCase();
    return rawRows.filter((row) => row.some((cell) => String(cell).toLowerCase().includes(q)));
  }, [rawRows, searchQuery]);

  // Column sorting
  const sortedRows = useMemo(() => {
    if (sortCol === null) return filteredRows;
    return [...filteredRows].sort((a, b) => {
      const valA = a[sortCol] ?? "";
      const valB = b[sortCol] ?? "";
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

  const formatBadge = (viewConfig?.format || "CSV").toUpperCase();

  if (loading) {
    return (
      <Box p={4} display="flex" justifyContent="center" alignItems="center">
        <Spinner size="small" />
      </Box>
    );
  }

  if (error) {
    return (
      <Box p={4} color="var(--color-danger-fg)">
        <Text>{error}</Text>
      </Box>
    );
  }

  return (
    <TableWrapper $isFullScreen={isFullScreen}>
      <Toolbar>
        <Box display="flex" alignItems="center" gap={2} flex={1} maxWidth="320px">
          <TextInput
            leadingVisual={SearchIcon}
            size="small"
            placeholder="Search dataset rows..."
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setPage(1);
            }}
            aria-label="Filter rows"
            sx={{ width: "100%" }}
          />
        </Box>

        <Box display="flex" alignItems="center" gap={2}>
          <span
            style={{
              fontSize: "10.5px",
              fontFamily: "var(--font-mono, monospace)",
              padding: "2px 6px",
              borderRadius: "4px",
              background: "rgba(255, 255, 255, 0.06)",
              border: "1px solid rgba(255, 255, 255, 0.1)",
              color: "var(--color-text-muted)",
              fontWeight: 600,
            }}
          >
            {formatBadge}
          </span>

          <Text fontSize="12px" color="var(--color-text-muted)">
            {reportedTotal} rows &bull; {headers.length} cols
          </Text>

          {columnsMeta.length > 0 && (
            <Button
              size="small"
              variant={showStats ? "primary" : "default"}
              onClick={() => setShowStats((prev) => !prev)}
              title="Toggle Column Statistics"
            >
              <GraphIcon size={13} />
              <Text fontSize="11px" ml={1}>
                Stats
              </Text>
            </Button>
          )}

          <select
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.target.value));
              setPage(1);
            }}
            style={{
              padding: "4px 8px",
              borderRadius: "6px",
              border: "1px solid var(--color-border-default)",
              background: "var(--color-canvas-default)",
              color: "var(--color-text-primary)",
              fontSize: "12px",
            }}
          >
            <option value={25}>25 / page</option>
            <option value={50}>50 / page</option>
            <option value={100}>100 / page</option>
          </select>
        </Box>
      </Toolbar>

      {showStats && columnsMeta.length > 0 && (
        <StatsDrawer>
          {columnsMeta.map((col) => (
            <StatCard key={col.name}>
              <Box display="flex" alignItems="center" justifyContent="space-between">
                <strong style={{ color: "var(--color-text-primary)", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {col.name}
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
                <span style={{ color: "var(--color-text-muted)", fontSize: "10px" }}>{col.unique} unique values</span>
              )}
            </StatCard>
          ))}
        </StatsDrawer>
      )}

      <TableContainer>
        <StyledTable>
          <thead>
            <tr>
              {headers.map((h, i) => (
                <th key={i} onClick={() => handleHeaderClick(i)}>
                  <Box display="flex" alignItems="center" gap={1}>
                    <span>{h}</span>
                    {sortCol === i ? sortAsc ? <ChevronUpIcon size={12} /> : <ChevronDownIcon size={12} /> : null}
                  </Box>
                </th>
              ))}
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
                  No matching records found.
                </td>
              </tr>
            )}
          </tbody>
        </StyledTable>
      </TableContainer>

      <PaginationBar>
        <span>
          Showing {totalRows === 0 ? 0 : (currentPage - 1) * pageSize + 1}–{Math.min(currentPage * pageSize, totalRows)}{" "}
          of {totalRows} filtered entries
        </span>
        <Box display="flex" gap={1}>
          <Button size="small" disabled={currentPage <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
            Previous
          </Button>
          <Button
            size="small"
            disabled={currentPage >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          >
            Next
          </Button>
        </Box>
      </PaginationBar>
    </TableWrapper>
  );
};

export default CsvViewer;
