// SPDX-License-Identifier: AGPL-3.0-or-later

import { CheckCircleFillIcon, DownloadIcon, SearchIcon } from "@primer/octicons-react";
import { Button, Label, Text, TextInput } from "@primer/react";
import React, { useMemo, useState } from "react";
import styled from "styled-components";
import type { BomRedlineItem, BomRedlineSummary } from "./types.js";

export interface BomRedlineViewerProps {
  revAName?: string | undefined;
  revBName?: string | undefined;
  items: BomRedlineItem[];
  defaultVolume?: number | undefined;
  onExportCsv?: (() => void) | undefined;
  onApproveBom?: (() => void) | undefined;
  className?: string | undefined;
}

type FilterCategory = "all" | "changed" | "added" | "removed" | "risk" | "cost_up";

const Container = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
  background: var(--color-canvas-default, #0d1117);
  border: 1px solid var(--color-border-default, #30363d);
  border-radius: 8px;
  padding: 16px;
  color: var(--color-fg-default, #c9d1d9);
  font-family: inherit;
`;

const HeaderBar = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
`;

const MetricsGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 12px;
`;

const MetricCard = styled.div<{ $highlight?: "positive" | "negative" | "warning" | "neutral" | undefined }>`
  background: var(--color-canvas-subtle, #161b22);
  border: 1px solid
    ${({ $highlight }) =>
      $highlight === "negative"
        ? "rgba(218, 54, 51, 0.4)"
        : $highlight === "positive"
          ? "rgba(46, 160, 67, 0.4)"
          : $highlight === "warning"
            ? "rgba(210, 153, 34, 0.4)"
            : "var(--color-border-muted, #21262d)"};
  border-radius: 6px;
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 4px;

  .metric-label {
    font-size: 11px;
    font-weight: 600;
    color: var(--color-fg-muted, #8b949e);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .metric-value {
    font-size: 20px;
    font-weight: 700;
    color: ${({ $highlight }) =>
      $highlight === "negative"
        ? "#f85149"
        : $highlight === "positive"
          ? "#3fb950"
          : $highlight === "warning"
            ? "#d29922"
            : "var(--color-fg-default, #f0f6fc)"};
  }

  .metric-sub {
    font-size: 11px;
    color: var(--color-fg-subtle, #6e7681);
  }
`;

const FilterBar = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 14px;
  background: var(--surface-overlay, #161b22);
  border: 1px solid var(--color-border-muted, #30363d);
  border-radius: 6px;
`;

const TableWrapper = styled.div`
  overflow-x: auto;
  border: 1px solid var(--color-border-default, #30363d);
  border-radius: 6px;
`;

const RedlineTable = styled.table`
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
  text-align: left;

  th {
    background: var(--color-canvas-subtle, #161b22);
    color: var(--color-fg-muted, #8b949e);
    font-weight: 600;
    padding: 8px 12px;
    border-bottom: 1px solid var(--color-border-default, #30363d);
    white-space: nowrap;
  }

  td {
    padding: 10px 12px;
    border-bottom: 1px solid var(--color-border-muted, #21262d);
    vertical-align: middle;
  }

  tr:hover td {
    background: rgba(110, 118, 129, 0.05);
  }
`;

const DiffText = styled.div`
  .old {
    color: #f85149;
    text-decoration: line-through;
    font-size: 11px;
    display: block;
  }
  .new {
    color: #3fb950;
    font-weight: 600;
    display: block;
  }
`;

export function BomRedlineViewer({
  revAName = "Rev A",
  revBName = "Rev B",
  items,
  defaultVolume = 1000,
  onExportCsv,
  onApproveBom,
  className,
}: BomRedlineViewerProps): React.JSX.Element {
  const [filterCategory, setFilterCategory] = useState<FilterCategory>("all");
  const [searchTerm, setSearchTerm] = useState<string>("");
  const [buildVolume, setBuildVolume] = useState<number>(defaultVolume);

  // Compute Summary Metrics
  const summary: BomRedlineSummary = useMemo(() => {
    let revACost = 0;
    let revBCost = 0;
    let added = 0;
    let removed = 0;
    let modified = 0;
    let unchanged = 0;
    let risk = 0;

    items.forEach((item) => {
      const qA = item.quantityRevA || 0;
      const qB = item.quantityRevB || 0;
      const pA = item.unitPriceRevA || 0;
      const pB = item.unitPriceRevB || 0;

      revACost += qA * pA;
      revBCost += qB * pB;

      if (item.status === "added") added++;
      else if (item.status === "removed") removed++;
      else if (item.status === "modified") modified++;
      else unchanged++;

      if (
        item.lifecycleStatus === "EOL" ||
        item.lifecycleStatus === "OBSOLETE" ||
        (item.stockAvailable ?? 0) < qB * buildVolume
      ) {
        risk++;
      }
    });

    return {
      totalItemsRevA: items.filter((i) => i.status !== "added").length,
      totalItemsRevB: items.filter((i) => i.status !== "removed").length,
      addedCount: added,
      removedCount: removed,
      modifiedCount: modified,
      unchangedCount: unchanged,
      totalCostRevA: revACost,
      totalCostRevB: revBCost,
      costDelta: revBCost - revACost,
      riskCount: risk,
    };
  }, [items, buildVolume]);

  // Filter items
  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      // Text search
      if (searchTerm) {
        const term = searchTerm.toLowerCase();
        const matchesMpn = (item.mpnRevB || item.mpnRevA || "").toLowerCase().includes(term);
        const matchesDesig = item.designators.some((d) => d.toLowerCase().includes(term));
        const matchesDesc = item.description.toLowerCase().includes(term);
        const matchesMfr = (item.manufacturerRevB || item.manufacturerRevA || "").toLowerCase().includes(term);
        if (!matchesMpn && !matchesDesig && !matchesDesc && !matchesMfr) return false;
      }

      // Category filter
      switch (filterCategory) {
        case "changed":
          return item.status !== "unchanged";
        case "added":
          return item.status === "added";
        case "removed":
          return item.status === "removed";
        case "risk":
          return (
            item.lifecycleStatus === "EOL" ||
            item.lifecycleStatus === "OBSOLETE" ||
            (item.stockAvailable ?? 0) < (item.quantityRevB || 0) * buildVolume
          );
        case "cost_up":
          return (item.unitPriceRevB || 0) > (item.unitPriceRevA || 0);
        default:
          return true;
      }
    });
  }, [items, filterCategory, searchTerm, buildVolume]);

  const handleExportDefaultCsv = () => {
    if (onExportCsv) {
      onExportCsv();
      return;
    }
    const headers = [
      "Status",
      "Designators",
      "Qty RevA",
      "Qty RevB",
      "MPN RevA",
      "MPN RevB",
      "Manufacturer",
      "Description",
      "Unit Price RevA",
      "Unit Price RevB",
      "Extended Price RevB",
      "Lifecycle",
      "Stock",
    ];
    const rows = filteredItems.map((i) => [
      i.status.toUpperCase(),
      `"${i.designators.join(", ")}"`,
      i.quantityRevA ?? 0,
      i.quantityRevB ?? 0,
      i.mpnRevA ?? "",
      i.mpnRevB ?? "",
      `"${i.manufacturerRevB || i.manufacturerRevA || ""}"`,
      `"${i.description.replace(/"/g, '""')}"`,
      (i.unitPriceRevA ?? 0).toFixed(4),
      (i.unitPriceRevB ?? 0).toFixed(4),
      ((i.quantityRevB ?? 0) * (i.unitPriceRevB ?? 0) * buildVolume).toFixed(2),
      i.lifecycleStatus ?? "ACTIVE",
      i.stockAvailable ?? 0,
    ]);
    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `BOM_Redline_${revAName}_vs_${revBName}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <Container className={className}>
      <HeaderBar>
        <div>
          <Text sx={{ fontSize: 16, fontWeight: 700, display: "block" }}>
            BOM Redline Engineering Review: {revAName} → {revBName}
          </Text>
          <Text sx={{ fontSize: 12, color: "fg.muted" }}>
            Automated multi-tier franchised distributor pricing, availability, and lifecycle comparison
          </Text>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
            <span>Target Volume:</span>
            <input
              type="number"
              min="1"
              value={buildVolume}
              onChange={(e) => setBuildVolume(Math.max(1, parseInt(e.target.value, 10) || 1))}
              style={{
                width: 80,
                padding: "4px 8px",
                background: "var(--color-canvas-subtle, #161b22)",
                color: "var(--color-fg-default, #c9d1d9)",
                border: "1px solid var(--color-border-default, #30363d)",
                borderRadius: 4,
                fontSize: 12,
              }}
            />
          </div>

          <Button leadingVisual={DownloadIcon} size="small" onClick={handleExportDefaultCsv}>
            Export Redline CSV
          </Button>
          {onApproveBom && (
            <Button variant="primary" leadingVisual={CheckCircleFillIcon} size="small" onClick={onApproveBom}>
              Approve BOM
            </Button>
          )}
        </div>
      </HeaderBar>

      <MetricsGrid>
        <MetricCard>
          <div className="metric-label">Unit BOM Cost ({revBName})</div>
          <div className="metric-value">${summary.totalCostRevB.toFixed(2)}</div>
          <div className="metric-sub">
            vs ${summary.totalCostRevA.toFixed(2)} ({revAName})
          </div>
        </MetricCard>

        <MetricCard $highlight={summary.costDelta > 0 ? "negative" : summary.costDelta < 0 ? "positive" : "neutral"}>
          <div className="metric-label">Unit Cost Delta</div>
          <div className="metric-value">
            {summary.costDelta >= 0 ? "+" : ""}${summary.costDelta.toFixed(2)}
          </div>
          <div className="metric-sub">
            {summary.totalCostRevA > 0 ? `${((summary.costDelta / summary.totalCostRevA) * 100).toFixed(1)}%` : "N/A"}{" "}
            delta per board
          </div>
        </MetricCard>

        <MetricCard>
          <div className="metric-label">Batch Cost ({buildVolume.toLocaleString()} units)</div>
          <div className="metric-value">
            ${(summary.totalCostRevB * buildVolume).toLocaleString(undefined, { maximumFractionDigits: 0 })}
          </div>
          <div className="metric-sub">
            {summary.costDelta >= 0 ? "+" : "-"}$
            {Math.abs(summary.costDelta * buildVolume).toLocaleString(undefined, { maximumFractionDigits: 0 })} batch
            delta
          </div>
        </MetricCard>

        <MetricCard $highlight={summary.riskCount > 0 ? "warning" : "positive"}>
          <div className="metric-label">Supply Chain Risk</div>
          <div className="metric-value">{summary.riskCount} Items</div>
          <div className="metric-sub">EOL, obsolete, or stock deficit</div>
        </MetricCard>
      </MetricsGrid>

      <FilterBar>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <Button
            size="small"
            variant={filterCategory === "all" ? "primary" : "default"}
            onClick={() => setFilterCategory("all")}
          >
            All ({items.length})
          </Button>
          <Button
            size="small"
            variant={filterCategory === "changed" ? "primary" : "default"}
            onClick={() => setFilterCategory("changed")}
          >
            Changed ({summary.addedCount + summary.removedCount + summary.modifiedCount})
          </Button>
          <Button
            size="small"
            variant={filterCategory === "added" ? "primary" : "default"}
            onClick={() => setFilterCategory("added")}
          >
            Added ({summary.addedCount})
          </Button>
          <Button
            size="small"
            variant={filterCategory === "removed" ? "primary" : "default"}
            onClick={() => setFilterCategory("removed")}
          >
            Removed ({summary.removedCount})
          </Button>
          <Button
            size="small"
            variant={filterCategory === "risk" ? "danger" : "default"}
            onClick={() => setFilterCategory("risk")}
          >
            High Risk ({summary.riskCount})
          </Button>
        </div>

        <div style={{ width: 220 }}>
          <TextInput
            leadingVisual={SearchIcon}
            size="small"
            placeholder="Search MPN, RefDes, Mfr..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
      </FilterBar>

      <TableWrapper>
        <RedlineTable>
          <thead>
            <tr>
              <th>Status</th>
              <th>Designators</th>
              <th>Manufacturer Part Number (MPN)</th>
              <th>Manufacturer</th>
              <th>Description / Package</th>
              <th>Qty</th>
              <th>Unit Price</th>
              <th>Ext Price ({buildVolume})</th>
              <th>Lifecycle & Stock</th>
            </tr>
          </thead>
          <tbody>
            {filteredItems.map((item, idx) => {
              const qA = item.quantityRevA ?? 0;
              const qB = item.quantityRevB ?? 0;
              const pA = item.unitPriceRevA ?? 0;
              const pB = item.unitPriceRevB ?? 0;
              const extB = qB * pB * buildVolume;

              return (
                <tr key={idx}>
                  <td>
                    {item.status === "added" && <Label variant="success">ADDED</Label>}
                    {item.status === "removed" && <Label variant="danger">REMOVED</Label>}
                    {item.status === "modified" && <Label variant="attention">MODIFIED</Label>}
                    {item.status === "unchanged" && <Label variant="secondary">UNCHANGED</Label>}
                  </td>
                  <td>
                    <strong>{item.designators.join(", ")}</strong>
                  </td>
                  <td>
                    {item.status === "modified" && item.mpnRevA !== item.mpnRevB ? (
                      <DiffText>
                        <span className="old">{item.mpnRevA}</span>
                        <span className="new">{item.mpnRevB}</span>
                      </DiffText>
                    ) : (
                      <span>{item.mpnRevB || item.mpnRevA}</span>
                    )}
                  </td>
                  <td>{item.manufacturerRevB || item.manufacturerRevA || "—"}</td>
                  <td>
                    <div>{item.description}</div>
                    <div style={{ fontSize: 11, color: "var(--color-fg-muted)" }}>
                      {item.packageRevB || item.packageRevA}
                    </div>
                  </td>
                  <td>
                    {qA !== qB ? (
                      <DiffText>
                        <span className="old">{qA}</span>
                        <span className="new">{qB}</span>
                      </DiffText>
                    ) : (
                      <span>{qB}</span>
                    )}
                  </td>
                  <td>
                    {item.status === "modified" && pA !== pB ? (
                      <DiffText>
                        <span className="old">${pA.toFixed(4)}</span>
                        <span className="new">${pB.toFixed(4)}</span>
                      </DiffText>
                    ) : (
                      <span>${(item.status === "removed" ? pA : pB).toFixed(4)}</span>
                    )}
                  </td>
                  <td>
                    <strong>${extB.toFixed(2)}</strong>
                  </td>
                  <td>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      <div style={{ display: "flex", gap: 4 }}>
                        <Label
                          variant={
                            item.lifecycleStatus === "EOL" || item.lifecycleStatus === "OBSOLETE"
                              ? "danger"
                              : item.lifecycleStatus === "NRND"
                                ? "attention"
                                : "success"
                          }
                        >
                          {item.lifecycleStatus || "ACTIVE"}
                        </Label>
                      </div>
                      <div style={{ fontSize: 11, color: "var(--color-fg-muted)" }}>
                        Stock: {(item.stockAvailable ?? 0).toLocaleString()} • LT:{" "}
                        {item.leadTimeWeeks ? `${item.leadTimeWeeks}w` : "In Stock"}
                      </div>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </RedlineTable>
      </TableWrapper>
    </Container>
  );
}
