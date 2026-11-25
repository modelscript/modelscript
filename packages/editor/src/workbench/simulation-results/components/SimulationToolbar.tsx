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
  isMultiTrack?: boolean | undefined;
  onToggleMultiTrack?: ((v: boolean) => void) | undefined;
  isDualY?: boolean | undefined;
  onToggleDualY?: ((v: boolean) => void) | undefined;
  useCanvas?: boolean | undefined;
  onToggleCanvas?: ((v: boolean) => void) | undefined;
  isComparingBaseline: boolean;
  pinnedRunLabels?: string[] | undefined;
  onPinBaseline: () => void;
  onRemovePinnedRun?: ((index: number) => void) | undefined;
  onClearBaseline: () => void;
  cursorMode: boolean;
  onToggleCursorMode: () => void;
  showStats: boolean;
  onToggleShowStats: () => void;
  onExportCsv: () => void;
  onExportJson: () => void;
  onExportParquet: () => void;
  onExportPsout?: (() => void) | undefined;
  onExportPscadOut?: (() => void) | undefined;
  onExportComtrade?: (() => void) | undefined;
  onExportSnapshot?: (() => void) | undefined;
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
  isMultiTrack = false,
  onToggleMultiTrack,
  isDualY = false,
  onToggleDualY,
  useCanvas = false,
  onToggleCanvas,
  isComparingBaseline,
  pinnedRunLabels,
  onPinBaseline,
  onRemovePinnedRun,
  onClearBaseline,
  cursorMode,
  onToggleCursorMode,
  showStats,
  onToggleShowStats,
  onExportCsv,
  onExportJson,
  onExportParquet,
  onExportPsout,
  onExportPscadOut,
  onExportComtrade,
  onExportSnapshot,
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
        {onToggleMultiTrack && (
          <Button
            size="small"
            variant="invisible"
            aria-pressed={isMultiTrack}
            style={toggleBtnSx(isMultiTrack)}
            onClick={() => onToggleMultiTrack(!isMultiTrack)}
            title="Stack schematic GraphFrames or individual Y-axis tracks"
          >
            Multi-Track
          </Button>
        )}
        {onToggleDualY && (
          <Button
            size="small"
            variant="invisible"
            aria-pressed={isDualY}
            style={toggleBtnSx(isDualY)}
            onClick={() => onToggleDualY(!isDualY)}
            title="Plot second variable group on independent Right Y-Axis (Dual-Y)"
          >
            Dual-Y
          </Button>
        )}
        {onToggleCanvas && (
          <Button
            size="small"
            variant="invisible"
            aria-pressed={useCanvas}
            style={toggleBtnSx(useCanvas)}
            onClick={() => onToggleCanvas(!useCanvas)}
            title="Use GPU/Canvas2D waveform engine (box-zoom, scroll-zoom, Shift+drag pan, 1M pts)"
          >
            Canvas Hi-Res
          </Button>
        )}
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
        {pinnedRunLabels && pinnedRunLabels.length > 0 ? (
          <>
            {pinnedRunLabels.map((lbl, idx) => (
              <Button
                key={lbl}
                size="small"
                variant="invisible"
                trailingVisual={() => <XIcon size={12} />}
                style={toggleBtnSx(true)}
                onClick={() => (onRemovePinnedRun ? onRemovePinnedRun(idx) : onClearBaseline())}
                title={`Remove pinned ${lbl} (dashed overlay)`}
              >
                {lbl}
              </Button>
            ))}
            {pinnedRunLabels.length < 4 && (
              <Button
                size="small"
                variant="invisible"
                leadingVisual={() => <PinIcon size={12} />}
                onClick={onPinBaseline}
                title={`Pin current run for multi-run comparison (${pinnedRunLabels.length}/4)`}
              >
                +Pin
              </Button>
            )}
          </>
        ) : isComparingBaseline ? (
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
            {onExportPsout && <ActionList.Item onSelect={onExportPsout}>PSCAD (.psout)</ActionList.Item>}
            {onExportPscadOut && <ActionList.Item onSelect={onExportPscadOut}>PSCAD (.inf / .out)</ActionList.Item>}
            {onExportComtrade && <ActionList.Item onSelect={onExportComtrade}>COMTRADE (.cfg / .dat)</ActionList.Item>}
            {onExportSnapshot && <ActionList.Item onSelect={onExportSnapshot}>Save Snapshot (.snp)</ActionList.Item>}
            <ActionList.Item
              onSelect={() => {
                const inp = document.createElement("input");
                inp.type = "file";
                inp.accept = ".snp,.json";
                inp.onchange = async () => {
                  const file = inp.files?.[0];
                  if (!file) return;
                  try {
                    const text = await file.text();
                    (window as unknown as { __ansatzInitialSnapshot?: unknown }).__ansatzInitialSnapshot =
                      JSON.parse(text);
                  } catch {
                    (window as unknown as { __ansatzInitialSnapshot?: unknown }).__ansatzInitialSnapshot = undefined;
                  }
                };
                inp.click();
              }}
            >
              Start from Snapshot (.snp)…
            </ActionList.Item>
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
