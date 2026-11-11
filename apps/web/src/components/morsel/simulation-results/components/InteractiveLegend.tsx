// SPDX-License-Identifier: AGPL-3.0-or-later

import React from "react";

export interface InteractiveLegendProps {
  selectedVariables: string[];
  hiddenVars: Set<string>;
  onToggleVariable: (v: string) => void;
  colors: string[];
  sweepResults?: { value: number; y: number[][] }[] | null | undefined;
}

export const InteractiveLegend: React.FC<InteractiveLegendProps> = ({
  selectedVariables,
  hiddenVars,
  onToggleVariable,
  colors,
  sweepResults,
}) => {
  if (selectedVariables.length === 0) return null;

  const sweepCount = sweepResults && sweepResults.length > 0 ? sweepResults.length : null;

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: "6px",
        alignItems: "center",
        padding: "4px 0",
      }}
    >
      {selectedVariables.map((v, i) => {
        const isHidden = hiddenVars.has(v);
        const color = colors[i % colors.length] || "#58a6ff";
        return (
          <button
            key={v}
            onClick={() => onToggleVariable(v)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              padding: "2px 8px",
              borderRadius: "12px",
              fontSize: "11px",
              fontFamily: "monospace",
              cursor: "pointer",
              border: `1px solid ${isHidden ? "var(--color-border-muted)" : color}`,
              background: isHidden ? "transparent" : `${color}15`,
              color: isHidden ? "var(--color-fg-muted)" : "inherit",
              opacity: isHidden ? 0.6 : 1,
              textDecoration: isHidden ? "line-through" : "none",
            }}
            title={`Click to ${isHidden ? "show" : "hide"} ${v}${sweepCount ? ` (${sweepCount} parameter sweeps)` : ""}`}
          >
            <span
              style={{
                width: "8px",
                height: "8px",
                borderRadius: "50%",
                backgroundColor: isHidden ? "var(--color-fg-muted)" : color,
              }}
            />
            {v}
            {sweepCount ? <span style={{ fontSize: "10px", opacity: 0.75 }}>({sweepCount} sweeps)</span> : null}
          </button>
        );
      })}
    </div>
  );
};
