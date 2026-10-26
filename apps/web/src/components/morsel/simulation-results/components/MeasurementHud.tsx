// SPDX-License-Identifier: AGPL-3.0-or-later

import React from "react";
import type { CursorMetricsData } from "../types";

export interface MeasurementHudProps {
  cursorMode: boolean;
  cursor1Time: number | null;
  cursor2Time: number | null;
  activeCursorPlacement: 1 | 2;
  cursorMetrics: CursorMetricsData | null;
  activeVariables: string[];
  onClearCursors: () => void;
}

export const MeasurementHud: React.FC<MeasurementHudProps> = ({
  cursorMode,
  cursor1Time,
  cursor2Time,
  activeCursorPlacement,
  cursorMetrics,
  activeVariables,
  onClearCursors,
}) => {
  if (!cursorMode || (cursor1Time === null && cursor2Time === null)) {
    return null;
  }

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        flexWrap: "wrap",
        gap: "8px",
        padding: "6px 12px",
        background: "var(--color-canvas-subtle, #161b22)",
        border: "1px solid var(--color-accent-cyan, #06b6d4)",
        borderRadius: "6px",
        fontSize: "11px",
        fontFamily: "var(--font-mono, monospace)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
        <span style={{ fontWeight: 600, color: "var(--color-accent-cyan, #06b6d4)" }}>
          📏 Measurement (Click plot to place C{activeCursorPlacement}):
        </span>
        {cursor1Time !== null && (
          <span style={{ color: "#06b6d4" }}>
            C1: <strong>{cursor1Time.toFixed(4)}s</strong>
          </span>
        )}
        {cursor2Time !== null && (
          <span style={{ color: "#ec4899" }}>
            C2: <strong>{cursor2Time.toFixed(4)}s</strong>
          </span>
        )}
        {cursorMetrics && (
          <>
            <span>
              Δt: <strong>{cursorMetrics.dt.toFixed(4)}s</strong>
            </span>
            <span>
              f: <strong>{cursorMetrics.freq.toFixed(2)} Hz</strong>
            </span>
            {activeVariables.slice(0, 3).map((v) => {
              const d = cursorMetrics.deltas[v];
              if (!d) return null;
              return (
                <span key={v} style={{ color: "var(--color-fg-muted)" }}>
                  Δ{v}: <strong style={{ color: "var(--color-fg-default)" }}>{d.dy.toFixed(3)}</strong> (m:{" "}
                  {d.slope.toFixed(2)})
                </span>
              );
            })}
          </>
        )}
      </div>
      <button
        onClick={onClearCursors}
        style={{
          padding: "2px 6px",
          fontSize: "11px",
          borderRadius: "4px",
          border: "1px solid var(--color-border-default)",
          background: "transparent",
          color: "var(--color-fg-muted)",
          cursor: "pointer",
        }}
      >
        Clear Cursors
      </button>
    </div>
  );
};
