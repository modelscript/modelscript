// SPDX-License-Identifier: AGPL-3.0-or-later

import React from "react";
import type { VariableStatEntry } from "../types";

export interface StatisticsDrawerProps {
  showStats: boolean;
  statsMap: Record<string, VariableStatEntry>;
  activeVariables: string[];
  selectedVariables: string[];
  colors: string[];
}

export const StatisticsDrawer: React.FC<StatisticsDrawerProps> = ({
  showStats,
  statsMap,
  activeVariables,
  selectedVariables,
  colors,
}) => {
  if (!showStats || Object.keys(statsMap).length === 0) return null;

  return (
    <div
      style={{
        maxHeight: "140px",
        overflowY: "auto",
        border: "1px solid var(--color-border-muted, #21262d)",
        borderRadius: "6px",
        padding: "8px 12px",
        background: "var(--color-canvas-subtle, #161b22)",
        fontSize: "11px",
        fontFamily: "var(--font-mono, monospace)",
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1.5fr repeat(5, 1fr)",
          gap: "8px",
          fontWeight: 600,
          borderBottom: "1px solid var(--color-border-muted, #21262d)",
          paddingBottom: "4px",
          marginBottom: "4px",
          color: "var(--color-fg-muted, #8b949e)",
        }}
      >
        <span>Variable</span>
        <span>Min</span>
        <span>Max</span>
        <span>Pk-Pk</span>
        <span>Mean</span>
        <span>Final</span>
      </div>
      {activeVariables.map((v) => {
        const s = statsMap[v];
        if (!s) return null;
        const color = colors[selectedVariables.indexOf(v) % colors.length] || "#58a6ff";
        return (
          <div
            key={v}
            style={{
              display: "grid",
              gridTemplateColumns: "1.5fr repeat(5, 1fr)",
              gap: "8px",
              padding: "2px 0",
              alignItems: "center",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "6px", overflow: "hidden" }}>
              <span
                style={{
                  width: "8px",
                  height: "8px",
                  borderRadius: "50%",
                  backgroundColor: color,
                  flexShrink: 0,
                }}
              />
              <span style={{ textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap" }}>{v}</span>
            </div>
            <span>{s.min.toFixed(4)}</span>
            <span>{s.max.toFixed(4)}</span>
            <span>{s.peakToPeak.toFixed(4)}</span>
            <span>{s.mean.toFixed(4)}</span>
            <span>{s.finalVal.toFixed(4)}</span>
          </div>
        );
      })}
    </div>
  );
};
