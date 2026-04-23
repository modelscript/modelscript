// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Dataset Table Viewer Component
 *
 * Interactive data preview panel for CSV/TSV datasets bundled with packages.
 * Shows column metadata, basic statistics, and a scrollable preview table.
 */

import { Label, Text } from "@primer/react";
import React, { useState } from "react";
import styled, { css, keyframes } from "styled-components";

/* ─── types ─── */

interface DatasetColumn {
  name: string;
  type: "number" | "string" | "boolean";
  min?: number;
  max?: number;
  mean?: number;
  unique?: number;
}

interface DatasetViewerProps {
  config: {
    columns?: DatasetColumn[];
    rowCount?: number;
    format?: string;
    previewRows?: string[][];
    hasHeader?: boolean;
  };
  artifactPath: string;
}

/* ─── styled ─── */

const fadeIn = keyframes`
  from { opacity: 0; transform: translateY(4px); }
  to   { opacity: 1; transform: translateY(0); }
`;

const glassCard = css`
  background: var(--color-glass-bg);
  backdrop-filter: blur(12px);
  border: 1px solid var(--color-glass-border);
  border-radius: 8px;
`;

const ViewerWrap = styled.div`
  ${glassCard}
  padding: 24px;
  margin-bottom: 16px;
  animation: ${fadeIn} 0.3s ease;
`;

const Header = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--color-border);
`;

const Title = styled.h3`
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--color-text-heading);
  display: flex;
  align-items: center;
  gap: 8px;
`;

const StatsGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 12px;
  margin-bottom: 20px;
`;

const StatCard = styled.div`
  ${glassCard}
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const StatLabel = styled.span`
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.6px;
  color: var(--color-text-muted);
  font-weight: 500;
`;

const StatValue = styled.span`
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text-heading);
  font-family: "SFMono-Regular", Consolas, monospace;
`;

const StatDetail = styled.span`
  font-size: 11px;
  color: var(--color-text-muted);
  font-family: "SFMono-Regular", Consolas, monospace;
`;

const PreviewWrap = styled.div`
  overflow-x: auto;
  border-radius: 6px;
  border: 1px solid var(--color-border);
`;

const PreviewTable = styled.table`
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
  font-family: "SFMono-Regular", Consolas, monospace;

  th {
    text-align: left;
    padding: 8px 12px;
    color: var(--color-text-heading);
    font-weight: 600;
    font-size: 11px;
    background: var(--color-table-header-bg);
    border-bottom: 2px solid var(--color-border);
    white-space: nowrap;
    position: sticky;
    top: 0;
  }

  td {
    padding: 6px 12px;
    color: var(--color-text-primary);
    border-bottom: 1px solid var(--color-border);
    white-space: nowrap;
    max-width: 200px;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  tr:last-child td {
    border-bottom: none;
  }

  tr:hover td {
    background: var(--color-glass-bg-hover);
  }
`;

const SectionLabel = styled.div`
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.8px;
  color: var(--color-text-muted);
  margin-bottom: 10px;
`;

const TabRow = styled.div`
  display: flex;
  gap: 0;
  border-bottom: 1px solid var(--color-border);
  margin-bottom: 16px;
`;

const ViewTab = styled.button<{ $active: boolean }>`
  padding: 8px 16px;
  font-size: 12px;
  font-weight: 500;
  border: none;
  background: transparent;
  color: ${(p) => (p.$active ? "var(--color-text-heading)" : "var(--color-text-muted)")};
  border-bottom: 2px solid ${(p) => (p.$active ? "var(--color-accent, #6366f1)" : "transparent")};
  margin-bottom: -1px;
  cursor: pointer;
  transition: all 0.2s ease;

  &:hover {
    color: var(--color-text-heading);
  }
`;

/* ─── component ─── */

type ViewId = "preview" | "schema";

const DatasetTableViewer: React.FC<DatasetViewerProps> = ({ config, artifactPath }) => {
  const [activeView, setActiveView] = useState<ViewId>("preview");
  const { columns, rowCount, format, previewRows } = config;

  const numericCols = (columns ?? []).filter((c) => c.type === "number");
  const stringCols = (columns ?? []).filter((c) => c.type === "string");

  return (
    <ViewerWrap>
      <Header>
        <Title>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <line x1="3" y1="9" x2="21" y2="9" />
            <line x1="3" y1="15" x2="21" y2="15" />
            <line x1="9" y1="3" x2="9" y2="21" />
          </svg>
          {artifactPath.split("/").pop() || artifactPath}
        </Title>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {format && (
            <Label variant="accent" style={{ fontSize: 11, padding: "2px 8px" }}>
              {format.toUpperCase()}
            </Label>
          )}
          <Label variant="secondary" style={{ fontSize: 11, padding: "2px 8px" }}>
            {(columns ?? []).length} columns
          </Label>
          <Label variant="secondary" style={{ fontSize: 11, padding: "2px 8px" }}>
            {(rowCount ?? 0).toLocaleString()} rows
          </Label>
        </div>
      </Header>

      {/* Tabs */}
      <TabRow>
        <ViewTab $active={activeView === "preview"} onClick={() => setActiveView("preview")}>
          Data Preview
        </ViewTab>
        <ViewTab $active={activeView === "schema"} onClick={() => setActiveView("schema")}>
          Schema & Statistics
        </ViewTab>
      </TabRow>

      {activeView === "preview" && (
        <>
          {previewRows && previewRows.length > 0 ? (
            <PreviewWrap>
              <PreviewTable>
                <thead>
                  <tr>
                    <th style={{ color: "var(--color-text-muted)", width: 40 }}>#</th>
                    {(columns ?? []).map((col, i) => (
                      <th key={i}>
                        {col.name}
                        <Label
                          variant="secondary"
                          style={{ fontSize: 9, padding: "0 3px", marginLeft: 4, verticalAlign: "middle" }}
                        >
                          {col.type}
                        </Label>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map((row, ri) => (
                    <tr key={ri}>
                      <td style={{ color: "var(--color-text-muted)" }}>{ri + 1}</td>
                      {row.map((cell, ci) => (
                        <td key={ci}>{cell}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </PreviewTable>
            </PreviewWrap>
          ) : (
            <Text style={{ color: "var(--color-text-muted)", fontStyle: "italic", fontSize: 13 }}>
              No preview data available.
            </Text>
          )}
          {(rowCount ?? 0) > (previewRows?.length ?? 0) && (
            <Text
              style={{
                display: "block",
                textAlign: "center",
                color: "var(--color-text-muted)",
                fontSize: 12,
                marginTop: 12,
              }}
            >
              Showing {previewRows?.length ?? 0} of {(rowCount ?? 0).toLocaleString()} rows
            </Text>
          )}
        </>
      )}

      {activeView === "schema" && (
        <>
          {/* Column statistics */}
          {numericCols.length > 0 && (
            <>
              <SectionLabel>Numeric Columns</SectionLabel>
              <StatsGrid>
                {numericCols.map((col) => (
                  <StatCard key={col.name}>
                    <StatLabel>{col.name}</StatLabel>
                    <StatValue>{col.type}</StatValue>
                    {col.min !== undefined && col.max !== undefined && (
                      <StatDetail>
                        range: [{col.min.toFixed(2)}, {col.max.toFixed(2)}]
                      </StatDetail>
                    )}
                    {col.mean !== undefined && <StatDetail>μ = {col.mean.toFixed(4)}</StatDetail>}
                  </StatCard>
                ))}
              </StatsGrid>
            </>
          )}

          {stringCols.length > 0 && (
            <>
              <SectionLabel>Categorical Columns</SectionLabel>
              <StatsGrid>
                {stringCols.map((col) => (
                  <StatCard key={col.name}>
                    <StatLabel>{col.name}</StatLabel>
                    <StatValue>{col.type}</StatValue>
                    {col.unique !== undefined && <StatDetail>{col.unique} unique values</StatDetail>}
                  </StatCard>
                ))}
              </StatsGrid>
            </>
          )}

          {(columns ?? []).length === 0 && (
            <Text style={{ color: "var(--color-text-muted)", fontStyle: "italic", fontSize: 13 }}>
              No schema information available.
            </Text>
          )}
        </>
      )}
    </ViewerWrap>
  );
};

export default DatasetTableViewer;
