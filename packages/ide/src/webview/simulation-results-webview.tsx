// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEditorTheme } from "@modelscript/editor/host";
import { SimulationResults, type SimulationResultsProps } from "@modelscript/editor/workbench/SimulationResults.js";
import { Ieee2800VerificationCard } from "@modelscript/editor/workbench/simulation-results/components/Ieee2800VerificationCard.js";
import { PscadInstrumentsPanel } from "@modelscript/editor/workbench/simulation-results/components/PscadInstrumentsPanel.js";
import type { Ieee2800ComplianceReport } from "@modelscript/pscad";
import React, { useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { getVsCodeWebviewApi, useVsCodeHostActions, VsCodeEditorHostProvider } from "./shared/vscode-editor-host.js";

export interface WaterComplianceMetric {
  name: string;
  variable: string;
  value: number;
  limit: number;
  direction: "min" | "max" | "range";
  limitMax?: number | undefined;
  unit?: string | undefined;
  pass: boolean;
  clause?: string | undefined;
}

export interface WaterComplianceReport {
  standard: string;
  overallPass: boolean;
  summary: string;
  metrics: WaterComplianceMetric[];
}

export interface SimulationResultsBridgeState {
  data: Record<string, number | string>[];
  variables: string[];
  sweepResults?: { value: number; y: number[][] }[] | undefined;
  complianceReport?: unknown | undefined;
  waterCompliance?: WaterComplianceReport | undefined;
  pscadExports?: SimulationResultsProps["pscadExports"];
  modelName?: string | undefined;
  colorMode: "dark" | "light";
  error?: string | null | undefined;
}

export interface WaterComplianceCardProps {
  report: WaterComplianceReport;
  colorMode: "dark" | "light";
  onExportJson?: (() => void) | undefined;
}

export const WaterComplianceCard: React.FC<WaterComplianceCardProps> = ({ report, colorMode, onExportJson }) => {
  const isDark = colorMode === "dark";
  const borderColor = isDark ? "#30363d" : "#d0d7de";
  const bg = isDark ? "#161b22" : "#f6f8fa";
  const muted = isDark ? "#8b949e" : "#57606a";
  const passBg = "#238636";
  const failBg = "#da3633";

  return (
    <div
      data-testid="water-compliance-card"
      style={{
        border: `1px solid ${borderColor}`,
        borderRadius: "10px",
        background: bg,
        padding: "16px",
        display: "flex",
        flexDirection: "column",
        gap: "12px",
        marginTop: "12px",
      }}
    >
      <div
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "8px" }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <span style={{ fontWeight: 700, fontSize: "14px" }}>💧 {report.standard}</span>
          <span
            style={{
              padding: "2px 10px",
              borderRadius: "999px",
              fontSize: "11px",
              fontWeight: 700,
              color: "#ffffff",
              background: report.overallPass ? passBg : failBg,
              letterSpacing: "0.4px",
            }}
          >
            {report.overallPass ? "PASS" : "FAIL"}
          </span>
        </div>
        {onExportJson && (
          <button
            type="button"
            onClick={onExportJson}
            style={{
              padding: "4px 10px",
              borderRadius: "6px",
              fontSize: "12px",
              fontWeight: 600,
              border: `1px solid ${borderColor}`,
              background: "transparent",
              color: "inherit",
              cursor: "pointer",
            }}
          >
            Export JSON
          </button>
        )}
      </div>

      <div style={{ fontSize: "12px", color: muted }}>{report.summary}</div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "8px" }}>
        {report.metrics.map((m) => (
          <div
            key={`${m.variable}-${m.name}`}
            style={{
              border: `1px solid ${m.pass ? borderColor : "rgba(218, 54, 51, 0.55)"}`,
              borderRadius: "8px",
              padding: "10px 12px",
              background: isDark ? "rgba(255,255,255,0.02)" : "#ffffff",
              display: "flex",
              flexDirection: "column",
              gap: "4px",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "6px" }}>
              <span style={{ fontSize: "12px", fontWeight: 600 }}>{m.name}</span>
              <span
                style={{
                  fontSize: "10px",
                  fontWeight: 700,
                  padding: "1px 6px",
                  borderRadius: "999px",
                  color: "#ffffff",
                  background: m.pass ? passBg : failBg,
                }}
              >
                {m.pass ? "PASS" : "FAIL"}
              </span>
            </div>
            <div style={{ fontSize: "11px", fontFamily: "monospace", color: muted }}>{m.variable}</div>
            <div style={{ fontSize: "13px", fontFamily: "monospace", fontWeight: 600 }}>
              {m.value.toFixed(3)}
              {m.unit ? ` ${m.unit}` : ""}
            </div>
            <div style={{ fontSize: "11px", color: muted }}>
              {m.direction === "range"
                ? `Limit: [${m.limit}, ${m.limitMax ?? m.limit}]${m.unit ? ` ${m.unit}` : ""}`
                : m.direction === "min"
                  ? `Limit: ≥ ${m.limit}${m.unit ? ` ${m.unit}` : ""}`
                  : `Limit: ≤ ${m.limit}${m.unit ? ` ${m.unit}` : ""}`}
              {m.clause ? ` · ${m.clause}` : ""}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

const StudioResultsView: React.FC<{ state: SimulationResultsBridgeState }> = ({ state }) => {
  const { theme } = useEditorTheme();
  const colorMode = state.colorMode ?? theme;

  if (!state.data.length && !state.error) {
    return (
      <div style={{ padding: "20px", color: "var(--vscode-descriptionForeground, #8b949e)", fontSize: "13px" }}>
        Run a simulation to inspect interactive Studio results (high-density canvas, baseline diff, Parquet export, and
        domain instruments).
      </div>
    );
  }

  return (
    <div style={{ width: "100%", height: "100%", overflow: "auto", padding: "12px", boxSizing: "border-box" }}>
      <SimulationResults
        localData={state.data}
        simulationVariables={state.variables}
        sweepResults={state.sweepResults}
        error={state.error}
        colorMode={colorMode}
        modelName={state.modelName}
        complianceReport={state.complianceReport}
        pscadExports={state.pscadExports}
      />
    </div>
  );
};

const PhasorFftView: React.FC<{ state: SimulationResultsBridgeState }> = ({ state }) => {
  const { theme } = useEditorTheme();
  const colorMode = state.colorMode ?? theme;

  if (state.data.length < 4 || state.variables.length === 0) {
    return (
      <div style={{ color: "var(--vscode-descriptionForeground, #8b949e)", fontSize: "13px" }}>
        Run a simulation with at least 4 time steps to inspect Phasor &amp; FFT harmonic analysis.
      </div>
    );
  }

  return (
    <PscadInstrumentsPanel
      data={state.data}
      variables={state.variables}
      colorMode={colorMode}
      nominalFreqHz={state.pscadExports?.nominalFreqHz}
    />
  );
};

const ComplianceCardsView: React.FC<{ state: SimulationResultsBridgeState }> = ({ state }) => {
  const { theme } = useEditorTheme();
  const actions = useVsCodeHostActions();
  const colorMode = state.colorMode ?? theme;

  const hasIeee = Boolean(state.complianceReport);
  const hasWater = Boolean(state.waterCompliance && state.waterCompliance.metrics.length > 0);

  if (!hasIeee && !hasWater) {
    return (
      <div style={{ color: "var(--vscode-descriptionForeground, #8b949e)", fontSize: "13px" }}>
        Run an IEEE 2800-2022 power-grid verification or a water/hydraulics simulation (EPANET, SWMM, HEC-RAS) to view
        domain compliance cards.
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      {hasIeee && (
        <Ieee2800VerificationCard
          report={state.complianceReport as Ieee2800ComplianceReport}
          data={state.data}
          colorMode={colorMode}
          onExportJson={() => {
            actions.exportFile(
              `${state.modelName || "ieee2800"}_compliance.json`,
              JSON.stringify(state.complianceReport, null, 2),
              { encoding: "utf8", mimeType: "application/json" },
            );
          }}
        />
      )}
      {hasWater && state.waterCompliance && (
        <WaterComplianceCard
          report={state.waterCompliance}
          colorMode={colorMode}
          onExportJson={() => {
            actions.exportFile(
              `${state.modelName || "water"}_compliance.json`,
              JSON.stringify(state.waterCompliance, null, 2),
              { encoding: "utf8", mimeType: "application/json" },
            );
          }}
        />
      )}
    </div>
  );
};

export interface MountedSimulationReactPanels {
  update(state: SimulationResultsBridgeState): void;
  unmount(): void;
}

/**
 * Mounts `@modelscript/editor`'s shared `SimulationResults`, `PscadInstrumentsPanel`,
 * `Ieee2800VerificationCard`, and `WaterComplianceCard` React views inside
 * `VsCodeEditorHostProvider` into the corresponding tab containers of `SimulationPanel`.
 */
export function mountSimulationReactPanels(targets: {
  studioEl?: HTMLElement | null | undefined;
  phasorFftEl?: HTMLElement | null | undefined;
  complianceEl?: HTMLElement | null | undefined;
}): MountedSimulationReactPanels {
  const vscodeApi = getVsCodeWebviewApi();
  const studioRoot: Root | null = targets.studioEl ? createRoot(targets.studioEl) : null;
  const phasorRoot: Root | null = targets.phasorFftEl ? createRoot(targets.phasorFftEl) : null;
  const complianceRoot: Root | null = targets.complianceEl ? createRoot(targets.complianceEl) : null;

  const renderAll = (state: SimulationResultsBridgeState) => {
    if (studioRoot) {
      studioRoot.render(
        <VsCodeEditorHostProvider vscodeApi={vscodeApi} initialTheme={state.colorMode}>
          <StudioResultsView state={state} />
        </VsCodeEditorHostProvider>,
      );
    }
    if (phasorRoot) {
      phasorRoot.render(
        <VsCodeEditorHostProvider vscodeApi={vscodeApi} initialTheme={state.colorMode}>
          <PhasorFftView state={state} />
        </VsCodeEditorHostProvider>,
      );
    }
    if (complianceRoot) {
      complianceRoot.render(
        <VsCodeEditorHostProvider vscodeApi={vscodeApi} initialTheme={state.colorMode}>
          <ComplianceCardsView state={state} />
        </VsCodeEditorHostProvider>,
      );
    }
  };

  return {
    update: renderAll,
    unmount() {
      studioRoot?.unmount();
      phasorRoot?.unmount();
      complianceRoot?.unmount();
    },
  };
}

/**
 * Standalone React webview shell mounting `@modelscript/editor`'s `SimulationResults`
 * inside `VsCodeEditorHostProvider` when loaded into a `#root` document.
 */
export const SimulationResultsStandaloneApp: React.FC = () => {
  const { theme } = useEditorTheme();
  const [state, setState] = useState<SimulationResultsBridgeState>({
    data: [],
    variables: [],
    colorMode: theme,
  });

  useEffect(() => {
    const vscodeApi = getVsCodeWebviewApi();
    const onMessage = (ev: MessageEvent) => {
      const msg = ev.data as
        | {
            type?: string;
            isDark?: boolean;
            data?: {
              t?: number[];
              y?: number[][];
              states?: string[];
              sweepResults?: { value: number; y: number[][] }[];
              complianceReport?: unknown;
              waterCompliance?: WaterComplianceReport;
              pscadExports?: SimulationResultsProps["pscadExports"];
              projectName?: string;
              error?: string;
            };
            report?: unknown;
            kind?: "ieee2800" | "water";
          }
        | undefined;
      if (!msg || typeof msg !== "object") return;
      if (msg.type === "simulationData" && msg.data) {
        const t = msg.data.t ?? [];
        const y = msg.data.y ?? [];
        const states = msg.data.states ?? [];
        const rows: Record<string, number | string>[] = t.map((tv, i) => {
          const row: Record<string, number | string> = { time: tv };
          for (let vi = 0; vi < states.length; vi++) {
            const val = y[i]?.[vi];
            if (val !== undefined) row[states[vi]!] = val;
          }
          return row;
        });
        setState({
          data: rows,
          variables: states,
          sweepResults: msg.data.sweepResults,
          complianceReport: msg.data.complianceReport,
          waterCompliance: msg.data.waterCompliance,
          pscadExports: msg.data.pscadExports,
          modelName: msg.data.projectName,
          colorMode: msg.isDark === false ? "light" : "dark",
          error: msg.data.error ?? null,
        });
      } else if (msg.type === "complianceReport" && msg.report) {
        setState((prev) =>
          msg.kind === "water"
            ? { ...prev, waterCompliance: msg.report as WaterComplianceReport }
            : { ...prev, complianceReport: msg.report },
        );
      }
    };
    window.addEventListener("message", onMessage);
    vscodeApi.postMessage({ type: "ready" });
    return () => window.removeEventListener("message", onMessage);
  }, []);

  return <StudioResultsView state={{ ...state, colorMode: theme }} />;
};

if (typeof document !== "undefined") {
  const rootEl = document.getElementById("root");
  if (rootEl) {
    const vscodeApi = getVsCodeWebviewApi();
    createRoot(rootEl).render(
      <VsCodeEditorHostProvider vscodeApi={vscodeApi}>
        <SimulationResultsStandaloneApp />
      </VsCodeEditorHostProvider>,
    );
  }
}
