// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  PanelButton,
  PanelKpiStrip,
  PanelShell,
  PanelSvgStage,
  PanelTabBar,
  PanelToolbar,
  type LanguagePanelProps,
  type PanelKpiItem,
} from "@modelscript/design-tokens/panel";
import {
  renderLpsPressureProfileSvg,
  renderLpsSchematicSvg,
  type LpsModelLike,
  type LpsSteadyResultLike,
} from "@modelscript/diagram/lps-diagram-builder";
import React, { useMemo, useState } from "react";
import { lintLpsModel, parseLps, SteadyNetworkSolver } from "../index.js";

type LpsTabId = "schematic" | "profile" | "pipes" | "lints";

export const LpsPanel: React.FC<LanguagePanelProps> = ({
  code,
  dialect,
  colorMode,
  mode,
  viewConfig,
  isFullScreen = false,
  host,
}) => {
  const [activeTab, setActiveTab] = useState<LpsTabId>("schematic");

  const computed = useMemo(() => {
    if (!code.trim()) {
      return {
        model: null,
        steady: null,
        lints: [] as ReturnType<typeof lintLpsModel>,
        error: undefined as string | undefined,
      };
    }
    try {
      const model = parseLps(code);
      let steady: ReturnType<typeof SteadyNetworkSolver.solve> | null = null;
      try {
        steady = SteadyNetworkSolver.solve(model);
      } catch {
        steady = null;
      }
      const lints = lintLpsModel(model);
      return { model, steady, lints, error: undefined };
    } catch (err) {
      return { model: null, steady: null, lints: [], error: err instanceof Error ? err.message : String(err) };
    }
  }, [code]);

  const title =
    (typeof viewConfig?.["title"] === "string" && viewConfig["title"]) ||
    computed.model?.title ||
    "LPS Pipeline Hydraulics";

  const svg = useMemo(() => {
    if (!computed.model) return "";
    try {
      const mLike = computed.model as unknown as LpsModelLike;
      const sLike = (computed.steady ?? undefined) as unknown as LpsSteadyResultLike | undefined;
      return activeTab === "profile" ? renderLpsPressureProfileSvg(mLike, sLike) : renderLpsSchematicSvg(mLike, sLike);
    } catch {
      return "";
    }
  }, [computed.model, computed.steady, activeTab]);

  const kpis = useMemo<PanelKpiItem[]>(() => {
    const pipes = computed.model?.pipes?.length ?? 0;
    const nodes = computed.model?.nodes?.length ?? 0;
    const converged = computed.steady?.converged;
    return [
      { label: "Pipes", value: pipes, tone: "info" },
      { label: "Nodes", value: nodes },
      {
        label: "Steady Solve",
        value: converged === undefined ? "N/A" : converged ? "CONVERGED" : "UNCONVERGED",
        tone: converged === undefined ? "neutral" : converged ? "success" : "warning",
      },
      { label: "Diagnostics", value: computed.lints.length, tone: computed.lints.length > 0 ? "warning" : "success" },
    ];
  }, [computed.model, computed.steady, computed.lints]);

  return (
    <PanelShell mode={mode} colorMode={colorMode} isFullScreen={isFullScreen}>
      <PanelToolbar
        title={title}
        subtitle="PipelineStudio Hydraulics"
        badge={computed.error ? { label: "Parse Error", tone: "danger" } : { label: "LPS", tone: "info" }}
        actions={
          <>
            {(activeTab === "schematic" || activeTab === "profile") && host.exportFile && (
              <PanelButton
                onClick={() => host.exportFile?.(`lps-${activeTab}.svg`, svg, "image/svg+xml")}
                disabled={!svg}
              >
                Export SVG
              </PanelButton>
            )}
            {mode === "artifact" && host.openInAnsatzEditor && code && (
              <PanelButton variant="primary" onClick={() => host.openInAnsatzEditor?.(code, dialect || "lps", title)}>
                Open in Ansatz Editor
              </PanelButton>
            )}
          </>
        }
      />

      <PanelKpiStrip items={kpis} />

      <PanelTabBar<LpsTabId>
        activeTab={activeTab}
        onSelect={setActiveTab}
        tabs={[
          { id: "schematic", label: "Network Schematic" },
          { id: "profile", label: "Pressure Profile" },
          { id: "pipes", label: "Pipes", count: computed.model?.pipes?.length ?? 0 },
          { id: "lints", label: "Lints", count: computed.lints.length },
        ]}
      />

      {(activeTab === "schematic" || activeTab === "profile") && (
        <PanelSvgStage
          svg={svg}
          onRevealLine={host.onRevealLine}
          emptyMessage={computed.error ?? "Load an LPS (.lps / .lpsx) pipeline network model."}
        />
      )}

      {activeTab === "pipes" && (
        <div style={{ flex: 1, overflow: "auto", padding: "10px 12px" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid var(--ms-border)", color: "var(--ms-text-2)" }}>
                <th style={{ padding: "5px 6px" }}>Pipe</th>
                <th style={{ padding: "5px 6px" }}>From → To</th>
                <th style={{ padding: "5px 6px" }}>Length (m)</th>
                <th style={{ padding: "5px 6px" }}>Diameter (m)</th>
              </tr>
            </thead>
            <tbody>
              {(computed.model?.pipes ?? []).map((p, idx) => (
                <tr
                  key={`${p.name}-${idx}`}
                  style={{ borderBottom: "1px solid var(--ms-divider)", fontFamily: "var(--ms-font-mono)" }}
                >
                  <td style={{ padding: "4px 6px", fontWeight: 600 }}>{p.name}</td>
                  <td style={{ padding: "4px 6px" }}>
                    {p.fromNode} → {p.toNode}
                  </td>
                  <td style={{ padding: "4px 6px" }}>{p.length}</td>
                  <td style={{ padding: "4px 6px" }}>{p.diameter}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === "lints" && (
        <div
          style={{
            flex: 1,
            overflow: "auto",
            padding: "10px 12px",
            display: "flex",
            flexDirection: "column",
            gap: "6px",
          }}
        >
          {computed.lints.length === 0 ? (
            <div style={{ color: "var(--ms-text-2)" }}>No LPS lint diagnostics.</div>
          ) : (
            computed.lints.map((d, idx) => (
              <div
                key={`${d.code}-${idx}`}
                style={{
                  padding: "7px 10px",
                  borderRadius: "6px",
                  background: "var(--ms-bg-alt)",
                  border: "1px solid var(--ms-border)",
                }}
              >
                <span style={{ fontWeight: 600, fontFamily: "var(--ms-font-mono)", marginRight: "6px" }}>
                  [{d.code}]
                </span>
                <span>{d.message}</span>
              </div>
            ))
          )}
        </div>
      )}
    </PanelShell>
  );
};

export default LpsPanel;
