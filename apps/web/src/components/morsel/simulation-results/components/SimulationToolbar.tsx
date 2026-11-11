// SPDX-License-Identifier: AGPL-3.0-or-later

import { CheckIcon, CopyIcon, DownloadIcon, PinIcon, XIcon } from "@primer/octicons-react";
import React, { useEffect, useRef, useState } from "react";

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

const chipStyle = (active: boolean): React.CSSProperties => ({
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  height: 26,
  padding: "0 10px",
  fontSize: 12,
  fontWeight: active ? 600 : 500,
  borderRadius: 6,
  border: "none",
  cursor: "pointer",
  userSelect: "none",
  background: active ? "var(--ms-brand-soft, rgba(6, 182, 212, 0.14))" : "transparent",
  color: active ? "var(--ms-brand, #0e7490)" : "var(--color-fg-muted, #6b7280)",
  transition: "background 0.12s ease, color 0.12s ease",
});

const menuItemStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  width: "100%",
  padding: "6px 10px",
  fontSize: 12,
  border: "none",
  background: "transparent",
  color: "inherit",
  textAlign: "left",
  cursor: "pointer",
  borderRadius: 4,
};

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
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menuOpen]);

  const run = (fn: () => void) => () => {
    fn();
    setMenuOpen(false);
  };

  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 2, flexWrap: "wrap" }}>
        <select
          value={xAxisVar}
          onChange={(e) => onXAxisVarChange(e.target.value)}
          aria-label="X-axis variable"
          title="X-axis variable (choose a state for a phase portrait)"
          style={{
            height: 26,
            fontSize: 12,
            padding: "0 6px",
            marginRight: 6,
            borderRadius: 6,
            border: "1px solid var(--color-border-muted)",
            background: "transparent",
            color: "inherit",
            maxWidth: 180,
          }}
        >
          <option value="time">x: time</option>
          {allVars.map((v) => (
            <option key={v} value={v}>
              x: {v}
            </option>
          ))}
        </select>

        <button
          type="button"
          style={chipStyle(isNormalized)}
          onClick={() => onToggleNormalized(!isNormalized)}
          title="Normalize curves to 0–100%"
        >
          Normalize
        </button>
        <button type="button" style={chipStyle(isLogScale)} onClick={() => onToggleLogScale(!isLogScale)}>
          Log
        </button>
        <button
          type="button"
          style={chipStyle(cursorMode)}
          onClick={onToggleCursorMode}
          title="Dual-cursor measurement (click plot to place C1 / C2)"
        >
          Cursors
        </button>
        <button
          type="button"
          style={chipStyle(showStats)}
          onClick={onToggleShowStats}
          title="Min / max / peak-to-peak / mean / final"
        >
          Stats
        </button>
        {isComparingBaseline ? (
          <button
            type="button"
            style={chipStyle(true)}
            onClick={onClearBaseline}
            title="Clear pinned baseline (dashed lines)"
          >
            Baseline <XIcon size={12} />
          </button>
        ) : (
          <button
            type="button"
            style={chipStyle(false)}
            onClick={onPinBaseline}
            title="Pin this run as a baseline for comparison"
          >
            <PinIcon size={12} /> Pin run
          </button>
        )}
      </div>

      <div ref={menuRef} style={{ position: "relative" }}>
        <button
          type="button"
          style={{ ...chipStyle(menuOpen), border: "1px solid var(--color-border-muted)" }}
          onClick={() => setMenuOpen((o) => !o)}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
        >
          <DownloadIcon size={12} /> Export
        </button>
        {menuOpen && (
          <div
            role="menu"
            style={{
              position: "absolute",
              right: 0,
              top: 32,
              zIndex: 20,
              minWidth: 160,
              padding: 4,
              borderRadius: 8,
              background: "var(--color-canvas-default, #fff)",
              border: "1px solid var(--color-border-default)",
              boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
            }}
          >
            <button type="button" role="menuitem" style={menuItemStyle} onClick={run(onExportCsv)}>
              CSV
            </button>
            <button type="button" role="menuitem" style={menuItemStyle} onClick={run(onExportJson)}>
              JSON
            </button>
            <button type="button" role="menuitem" style={menuItemStyle} onClick={run(onExportParquet)}>
              Parquet
            </button>
            <button type="button" role="menuitem" style={menuItemStyle} onClick={() => onCopyClipboard()}>
              {copied ? <CheckIcon size={12} /> : <CopyIcon size={12} />} {copied ? "Copied" : "Copy as TSV"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
