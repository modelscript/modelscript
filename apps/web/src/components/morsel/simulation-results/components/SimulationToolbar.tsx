// SPDX-License-Identifier: AGPL-3.0-or-later

import { CheckIcon, CopyIcon, DownloadIcon, PinIcon, XIcon } from "@primer/octicons-react";
import { ActionList, ActionMenu, Button } from "@primer/react";
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

const toggleBtnSx = (active: boolean): React.CSSProperties =>
  active
    ? {
        background: "var(--ms-brand-soft)",
        color: "var(--fgColor-accent, var(--ms-brand))",
        borderColor: "var(--borderColor-accent-muted, transparent)",
      }
    : {};

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
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
        <select
          value={xAxisVar}
          onChange={(e) => onXAxisVarChange(e.target.value)}
          aria-label="X-axis variable"
          title="X-axis variable (choose a state for a phase portrait)"
          style={{
            height: 28,
            fontSize: 12,
            padding: "0 6px",
            marginRight: 4,
            borderRadius: 6,
            border: "1px solid var(--borderColor-muted, var(--ms-border))",
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

        <Button
          size="small"
          variant="invisible"
          aria-pressed={isNormalized}
          style={toggleBtnSx(isNormalized)}
          onClick={() => onToggleNormalized(!isNormalized)}
          title="Normalize curves to 0–100%"
        >
          Normalize
        </Button>
        <Button
          size="small"
          variant="invisible"
          aria-pressed={isLogScale}
          style={toggleBtnSx(isLogScale)}
          onClick={() => onToggleLogScale(!isLogScale)}
        >
          Log
        </Button>
        <Button
          size="small"
          variant="invisible"
          aria-pressed={cursorMode}
          style={toggleBtnSx(cursorMode)}
          onClick={onToggleCursorMode}
          title="Dual-cursor measurement (click plot to place C1 / C2)"
        >
          Cursors
        </Button>
        <Button
          size="small"
          variant="invisible"
          aria-pressed={showStats}
          style={toggleBtnSx(showStats)}
          onClick={onToggleShowStats}
          title="Min / max / peak-to-peak / mean / final"
        >
          Stats
        </Button>
        {isComparingBaseline ? (
          <Button
            size="small"
            variant="invisible"
            trailingVisual={() => <XIcon size={12} />}
            style={toggleBtnSx(true)}
            onClick={onClearBaseline}
            title="Clear pinned baseline (dashed lines)"
          >
            Baseline
          </Button>
        ) : (
          <Button
            size="small"
            variant="invisible"
            leadingVisual={() => <PinIcon size={12} />}
            onClick={onPinBaseline}
            title="Pin this run as a baseline for comparison"
          >
            Pin run
          </Button>
        )}
      </div>

      <ActionMenu>
        <ActionMenu.Button size="small" leadingVisual={() => <DownloadIcon size={12} />}>
          Export
        </ActionMenu.Button>
        <ActionMenu.Overlay>
          <ActionList>
            <ActionList.Item onSelect={onExportCsv}>CSV</ActionList.Item>
            <ActionList.Item onSelect={onExportJson}>JSON</ActionList.Item>
            <ActionList.Item onSelect={onExportParquet}>Parquet</ActionList.Item>
            <ActionList.Divider />
            <ActionList.Item onSelect={onCopyClipboard}>
              <ActionList.LeadingVisual>
                {copied ? <CheckIcon size={12} /> : <CopyIcon size={12} />}
              </ActionList.LeadingVisual>
              {copied ? "Copied" : "Copy as TSV"}
            </ActionList.Item>
          </ActionList>
        </ActionMenu.Overlay>
      </ActionMenu>
    </div>
  );
};
