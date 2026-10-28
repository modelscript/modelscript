// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  CheckIcon,
  CopyIcon,
  CrossReferenceIcon,
  DownloadIcon,
  GraphIcon,
  PinIcon,
  XIcon,
  ZapIcon,
} from "@primer/octicons-react";
import React from "react";

export interface SimulationToolbarProps {
  xAxisVar: string;
  onXAxisVarChange: (v: string) => void;
  allVars: string[];
  isNormalized: boolean;
  onToggleNormalized: (v: boolean) => void;
  isLogScale: boolean;
  onToggleLogScale: (v: boolean) => void;
  isComparingBaseline: boolean;
  onPinBaseline: () => void;
  onClearBaseline: () => void;
  cursorMode: boolean;
  onToggleCursorMode: () => void;
  showStats: boolean;
  onToggleShowStats: () => void;
  onExportCsv: () => void;
  onExportJson: () => void;
  onExportParquet: () => void;
  onCopyClipboard: () => void;
  copied: boolean;
}

export const SimulationToolbar: React.FC<SimulationToolbarProps> = ({
  xAxisVar,
  onXAxisVarChange,
  allVars,
  isNormalized,
  onToggleNormalized,
  isLogScale,
  onToggleLogScale,
  isComparingBaseline,
  onPinBaseline,
  onClearBaseline,
  cursorMode,
  onToggleCursorMode,
  showStats,
  onToggleShowStats,
  onExportCsv,
  onExportJson,
  onExportParquet,
  onCopyClipboard,
  copied,
}) => {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        flexWrap: "wrap",
        gap: "12px",
        borderBottom: "1px solid var(--color-border-muted)",
        paddingBottom: "12px",
      }}
    >
      <h2 style={{ margin: 0, fontSize: "16px", fontWeight: "bold" }}>Simulation Results</h2>

      <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap", fontSize: "12px" }}>
        {/* X-Axis Selector for Phase Portrait */}
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <span style={{ fontWeight: 500, color: "var(--color-fg-muted)" }}>X-Axis:</span>
          <select
            value={xAxisVar}
            onChange={(e) => onXAxisVarChange(e.target.value)}
            style={{
              fontSize: "12px",
              padding: "3px 8px",
              borderRadius: "4px",
              border: "1px solid var(--color-border-default)",
              background: "var(--color-canvas-default)",
              color: "inherit",
            }}
            title="Select X-Axis variable for time-series or state-space phase portrait"
          >
            <option value="time">Time (s)</option>
            {allVars.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </div>

        {/* Normalize Mode Checkbox */}
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: "4px",
            cursor: "pointer",
            userSelect: "none",
          }}
          title="Normalize all variable curves to 0-100% to compare different units and magnitudes"
        >
          <input
            type="checkbox"
            checked={isNormalized}
            onChange={(e) => onToggleNormalized(e.target.checked)}
            style={{ accentColor: "var(--color-accent-fg, #0969da)" }}
          />
          <span>Normalize (0-100%)</span>
        </label>

        {/* Logarithmic Scale Checkbox */}
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: "4px",
            cursor: "pointer",
            userSelect: "none",
          }}
        >
          <input
            type="checkbox"
            checked={isLogScale}
            onChange={(e) => onToggleLogScale(e.target.checked)}
            style={{ accentColor: "var(--color-accent-fg, #0969da)" }}
          />
          <span>Log Scale</span>
        </label>

        {/* Action Buttons */}
        <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
          {/* Baseline Comparison (Run A vs Run B) */}
          {!isComparingBaseline ? (
            <button
              onClick={onPinBaseline}
              style={{
                fontSize: "11px",
                padding: "3px 8px",
                borderRadius: "4px",
                border: "1px solid var(--color-btn-secondary-border, var(--color-border-default))",
                background: "var(--color-btn-secondary-bg, var(--color-canvas-subtle, #f6f8fa))",
                color: "var(--color-btn-secondary-text, var(--color-fg-default, #24292f))",
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: "4px",
                fontWeight: 500,
                transition: "all 0.15s ease",
              }}
              title="Pin current simulation trajectory as Run A baseline"
            >
              <PinIcon size={12} /> Pin Baseline
            </button>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
              <span
                style={{
                  fontSize: "11px",
                  padding: "2px 6px",
                  borderRadius: "4px",
                  background: "rgba(6, 182, 212, 0.15)",
                  border: "1px solid var(--color-accent-cyan, #06b6d4)",
                  color: "var(--color-accent-cyan, #06b6d4)",
                  fontWeight: 600,
                }}
                title="Comparing against pinned baseline (dashed lines)"
              >
                Comparing Run A
              </span>
              <button
                onClick={onClearBaseline}
                style={{
                  fontSize: "11px",
                  padding: "2px 5px",
                  borderRadius: "4px",
                  border: "1px solid var(--color-btn-secondary-border, var(--color-border-default))",
                  background: "transparent",
                  color: "var(--color-fg-muted)",
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                }}
                title="Clear pinned baseline comparison"
              >
                <XIcon size={12} />
              </button>
            </div>
          )}
          <button
            onClick={onToggleCursorMode}
            style={{
              fontSize: "11px",
              padding: "3px 8px",
              borderRadius: "4px",
              border: cursorMode
                ? "1px solid var(--color-accent-cyan, #06b6d4)"
                : "1px solid var(--color-btn-secondary-border, var(--color-border-default))",
              background: cursorMode
                ? "rgba(6, 182, 212, 0.15)"
                : "var(--color-btn-secondary-bg, var(--color-canvas-subtle, #f6f8fa))",
              color: cursorMode
                ? "var(--color-accent-cyan, #06b6d4)"
                : "var(--color-btn-secondary-text, var(--color-fg-default, #24292f))",
              cursor: "pointer",
              fontWeight: cursorMode ? 600 : 500,
              display: "inline-flex",
              alignItems: "center",
              gap: "4px",
              transition: "all 0.15s ease",
            }}
            title="Toggle interactive dual-cursor measurement (click plot to place C1 / C2)"
          >
            <CrossReferenceIcon size={12} /> Cursors
          </button>
          <button
            onClick={onToggleShowStats}
            style={{
              fontSize: "11px",
              padding: "3px 8px",
              borderRadius: "4px",
              border: showStats
                ? "1px solid var(--color-accent-emphasis, #0969da)"
                : "1px solid var(--color-btn-secondary-border, var(--color-border-default))",
              background: showStats
                ? "rgba(9, 105, 218, 0.15)"
                : "var(--color-btn-secondary-bg, var(--color-canvas-subtle, #f6f8fa))",
              color: showStats
                ? "var(--color-accent-fg, #0969da)"
                : "var(--color-btn-secondary-text, var(--color-fg-default, #24292f))",
              cursor: "pointer",
              fontWeight: showStats ? 600 : 500,
              display: "inline-flex",
              alignItems: "center",
              gap: "4px",
              transition: "all 0.15s ease",
            }}
            title="Toggle numerical statistical summary (Min, Max, Pk-Pk, Mean, Final)"
          >
            <GraphIcon size={12} /> Stats
          </button>
          <button
            onClick={onExportCsv}
            style={{
              fontSize: "11px",
              padding: "3px 8px",
              borderRadius: "4px",
              border: "1px solid var(--color-btn-secondary-border, var(--color-border-default))",
              background: "var(--color-btn-secondary-bg, var(--color-canvas-subtle, #f6f8fa))",
              color: "var(--color-btn-secondary-text, var(--color-fg-default, #24292f))",
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: "4px",
              fontWeight: 500,
              transition: "all 0.15s ease",
            }}
            title="Download simulated data as CSV"
          >
            <DownloadIcon size={12} /> CSV
          </button>
          <button
            onClick={onExportJson}
            style={{
              fontSize: "11px",
              padding: "3px 8px",
              borderRadius: "4px",
              border: "1px solid var(--color-btn-secondary-border, var(--color-border-default))",
              background: "var(--color-btn-secondary-bg, var(--color-canvas-subtle, #f6f8fa))",
              color: "var(--color-btn-secondary-text, var(--color-fg-default, #24292f))",
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: "4px",
              fontWeight: 500,
              transition: "all 0.15s ease",
            }}
            title="Download simulated data as JSON"
          >
            <DownloadIcon size={12} /> JSON
          </button>
          <button
            onClick={onExportParquet}
            style={{
              fontSize: "11px",
              padding: "3px 8px",
              borderRadius: "4px",
              border: "1px solid var(--color-btn-secondary-border, var(--color-border-default))",
              background: "var(--color-btn-secondary-bg, var(--color-canvas-subtle, #f6f8fa))",
              color: "var(--color-btn-secondary-text, var(--color-fg-default, #24292f))",
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: "4px",
              fontWeight: 500,
              transition: "all 0.15s ease",
            }}
            title="Download simulated data as Apache Parquet (binary columnar format)"
          >
            <ZapIcon size={12} /> Parquet
          </button>
          <button
            onClick={onCopyClipboard}
            style={{
              fontSize: "11px",
              padding: "3px 8px",
              borderRadius: "4px",
              border: "1px solid var(--color-btn-secondary-border, var(--color-border-default))",
              background: "var(--color-btn-secondary-bg, var(--color-canvas-subtle, #f6f8fa))",
              color: "var(--color-btn-secondary-text, var(--color-fg-default, #24292f))",
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: "4px",
              fontWeight: 500,
              transition: "all 0.15s ease",
            }}
            title="Copy tab-delimited simulation data to clipboard"
          >
            {copied ? (
              <>
                <CheckIcon size={12} /> Copied!
              </>
            ) : (
              <>
                <CopyIcon size={12} /> Copy
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
