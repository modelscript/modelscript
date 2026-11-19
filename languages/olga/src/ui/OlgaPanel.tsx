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
  renderOlgaBathymetry3dSvg,
  renderOlgaElevationProfileSvg,
  renderOlgaPvtEnvelopeSvg,
  renderOlgaSchematicSvg,
  renderOlgaSlugStatisticsSvg,
  renderOlgaWellboreIprSvg,
  type OlgaModelLike,
} from "@modelscript/diagram/olga-diagram-builder";
import React, { useMemo, useState } from "react";
import {
  lintOlgaModel,
  parseOlga,
  parseOlgaPpl,
  parseOlgaTpl,
  profileDatasetToSnapshots,
  projectOlgaToSysml2,
  simulateDriftFlux,
  verifyFlowAssuranceTrajectory,
  type OlgaModel,
  type OlgaSimulationResult,
} from "../index.js";

type OlgaTabId = "schematic" | "elevation" | "bathymetry3d" | "pvt" | "ipr" | "slug" | "compliance";

interface OlgaComputedState {
  model: OlgaModel;
  simResult: OlgaSimulationResult | null;
  lints: ReturnType<typeof lintOlgaModel>;
  compliance: ReturnType<typeof verifyFlowAssuranceTrajectory> | null;
  parseError?: string | undefined;
}

function buildEmptyOlgaModel(title: string): OlgaModel {
  return {
    title,
    startTime: 0,
    endTime: 100,
    minDt: 0.1,
    maxDt: 1.0,
    flowpaths: [],
    nodes: [],
  };
}

export const OlgaPanel: React.FC<LanguagePanelProps> = ({
  code,
  dialect,
  colorMode,
  mode,
  documentUri,
  viewConfig,
  isFullScreen = false,
  host,
}) => {
  const [activeTab, setActiveTab] = useState<OlgaTabId>("schematic");
  const [snapshotIdx, setSnapshotIdx] = useState<number>(-1);

  const computed = useMemo<OlgaComputedState>(() => {
    const fallbackTitle =
      (typeof viewConfig?.["title"] === "string" && viewConfig["title"]) ||
      (typeof viewConfig?.["pipelineName"] === "string" && viewConfig["pipelineName"]) ||
      "OLGA Multiphase Flow Case";

    if (!code.trim()) {
      return {
        model: buildEmptyOlgaModel(fallbackTitle),
        simResult: null,
        lints: [],
        compliance: null,
      };
    }

    const lowerUri = (documentUri ?? "").toLowerCase();
    try {
      let model: OlgaModel;
      let simResult: OlgaSimulationResult | null = null;

      if (lowerUri.endsWith(".tpl")) {
        simResult = parseOlgaTpl(code);
        model = buildEmptyOlgaModel(`${fallbackTitle} (.tpl)`);
      } else if (lowerUri.endsWith(".ppl")) {
        const pplDataset = parseOlgaPpl(code);
        const profiles = profileDatasetToSnapshots(pplDataset);
        simResult = {
          times: profiles.map((s) => s.time),
          profiles,
          profileDataset: pplDataset,
          trends: {
            inletPressure: profiles.map((s) => s.pressure[0] ?? 50e5),
            arrivalPressure: profiles.map((s) => s.pressure[s.pressure.length - 1] ?? 20e5),
            arrivalTemperature: profiles.map((s) => s.temperature[s.temperature.length - 1] ?? 300),
            arrivalLiquidHoldup: profiles.map((s) => s.liquidHoldup[s.liquidHoldup.length - 1] ?? 0.1),
            arrivalLiquidMassRate: profiles.map(() => 5.0),
            accumulatedLiquidVolume: profiles.map(() => 0),
            peakLiquidSurgeVolume: 0,
          },
        };
        model = buildEmptyOlgaModel(`${fallbackTitle} (.ppl)`);
      } else {
        model = parseOlga(code);
        try {
          simResult = simulateDriftFlux(model);
        } catch {
          simResult = null;
        }
      }

      const lints = lintOlgaModel(model);
      const compliance = simResult ? verifyFlowAssuranceTrajectory(simResult) : null;
      return { model, simResult, lints, compliance };
    } catch (err) {
      return {
        model: buildEmptyOlgaModel(fallbackTitle),
        simResult: null,
        lints: [],
        compliance: null,
        parseError: err instanceof Error ? err.message : String(err),
      };
    }
  }, [code, documentUri, viewConfig]);

  const title = computed.model.title || "OLGA Multiphase Flow";
  const modelLike = computed.model as unknown as OlgaModelLike;

  const snapshots = computed.simResult?.profiles ?? [];
  const effectiveSnapIdx =
    snapshots.length > 0
      ? snapshotIdx < 0 || snapshotIdx >= snapshots.length
        ? snapshots.length - 1
        : snapshotIdx
      : 0;

  const activeSvg = useMemo(() => {
    try {
      switch (activeTab) {
        case "schematic":
          return renderOlgaSchematicSvg({ ...modelLike, title });
        case "elevation":
          return renderOlgaElevationProfileSvg({ ...modelLike, title }, computed.simResult ?? undefined);
        case "bathymetry3d":
          return renderOlgaBathymetry3dSvg({ ...modelLike, title });
        case "pvt":
          return renderOlgaPvtEnvelopeSvg(undefined, computed.simResult ?? undefined, title);
        case "ipr": {
          const firstFp = computed.model.flowpaths?.[0];
          const iprSource = firstFp?.ipr ?? firstFp?.sources?.[0];
          return renderOlgaWellboreIprSvg(iprSource as never, firstFp?.name ?? title);
        }
        case "slug":
          return renderOlgaSlugStatisticsSvg(computed.simResult ?? undefined);
        default:
          return "";
      }
    } catch {
      return "";
    }
  }, [activeTab, modelLike, title, computed.simResult, computed.model.flowpaths]);

  const kpis = useMemo<PanelKpiItem[]>(() => {
    const fpCount = computed.model.flowpaths?.length ?? 0;
    const nodeCount = computed.model.nodes?.length ?? 0;
    const lastSnap = snapshots[effectiveSnapIdx];
    const maxPBar = lastSnap && lastSnap.pressure?.length > 0 ? (Math.max(...lastSnap.pressure) / 1e5).toFixed(1) : "—";
    const avgHoldup =
      lastSnap && lastSnap.liquidHoldup?.length > 0
        ? (
            (lastSnap.liquidHoldup.reduce((a: number, b: number) => a + b, 0) / lastSnap.liquidHoldup.length) *
            100
          ).toFixed(1)
        : "—";
    const passed = computed.compliance?.passed;
    return [
      { label: "Flowpaths", value: fpCount, tone: "info" },
      { label: "Nodes", value: nodeCount },
      { label: "Peak Pressure", value: maxPBar, unit: maxPBar !== "—" ? "bar" : undefined },
      { label: "Avg Holdup", value: avgHoldup, unit: avgHoldup !== "—" ? "%" : undefined },
      {
        label: "Compliance",
        value: passed === undefined ? "N/A" : passed ? "PASS" : "ALERT",
        tone: passed === undefined ? "neutral" : passed ? "success" : "danger",
      },
    ];
  }, [computed.model.flowpaths, computed.model.nodes, computed.compliance, snapshots, effectiveSnapIdx]);

  const handleExportSvg = () => {
    if (!activeSvg || !host.exportFile) return;
    host.exportFile(`olga-${activeTab}.svg`, activeSvg, "image/svg+xml");
  };

  const handleExportSysml = () => {
    if (!host.exportFile && !host.onUpdateProjectFile) return;
    const sysml = projectOlgaToSysml2(computed.model);
    if (host.exportFile) {
      host.exportFile(`${title.replace(/[^a-zA-Z0-9_-]/g, "_")}.sysml`, sysml, "text/plain");
    } else if (host.onUpdateProjectFile) {
      host.onUpdateProjectFile(`${title.replace(/[^a-zA-Z0-9_-]/g, "_")}.sysml`, sysml);
      host.notify?.("info", "Projected OLGA model to SysML v2.");
    }
  };

  return (
    <PanelShell mode={mode} colorMode={colorMode} isFullScreen={isFullScreen}>
      <PanelToolbar
        title={title}
        subtitle={mode === "artifact" ? "OLGA Multiphase Flow" : undefined}
        badge={
          computed.parseError
            ? { label: "Parse Error", tone: "danger" }
            : computed.compliance
              ? {
                  label: computed.compliance.passed ? "Flow Assurance OK" : "Limits Violated",
                  tone: computed.compliance.passed ? "success" : "warning",
                }
              : { label: "OLGA", tone: "info" }
        }
        actions={
          <>
            {activeTab !== "compliance" && host.exportFile && (
              <PanelButton onClick={handleExportSvg} disabled={!activeSvg}>
                Export SVG
              </PanelButton>
            )}
            {mode !== "artifact" && (host.exportFile || host.onUpdateProjectFile) && (
              <PanelButton onClick={handleExportSysml}>Export SysML v2</PanelButton>
            )}
            {mode === "artifact" && host.openInMorsel && code && (
              <PanelButton variant="primary" onClick={() => host.openInMorsel?.(code, dialect || "olga", title)}>
                Open in Morsel
              </PanelButton>
            )}
          </>
        }
      />

      <PanelKpiStrip items={kpis} />

      <PanelTabBar<OlgaTabId>
        activeTab={activeTab}
        onSelect={setActiveTab}
        tabs={[
          { id: "schematic", label: "Schematic P&ID" },
          { id: "elevation", label: "Elevation Z(X)" },
          { id: "bathymetry3d", label: "3D Bathymetry" },
          { id: "pvt", label: "PVT Envelope" },
          { id: "ipr", label: "Wellbore IPR" },
          { id: "slug", label: "Slug Stats" },
          { id: "compliance", label: "Compliance & Lints", count: computed.lints.length },
        ]}
      />

      {snapshots.length > 1 && (activeTab === "elevation" || activeTab === "bathymetry3d") && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            padding: "6px 12px",
            borderBottom: "1px solid var(--ms-border)",
            background: "var(--ms-bg-alt)",
            fontSize: "11px",
          }}
        >
          <span style={{ color: "var(--ms-text-2)" }}>
            Snapshot t = {(snapshots[effectiveSnapIdx]?.time ?? 0).toFixed(1)} s
          </span>
          <input
            type="range"
            min={0}
            max={snapshots.length - 1}
            value={effectiveSnapIdx}
            onChange={(e) => setSnapshotIdx(Number(e.target.value))}
            style={{ flex: 1 }}
          />
          <span style={{ color: "var(--ms-text-3)" }}>
            {effectiveSnapIdx + 1} / {snapshots.length}
          </span>
        </div>
      )}

      {activeTab === "compliance" ? (
        <div
          style={{ flex: 1, overflow: "auto", padding: "12px", display: "flex", flexDirection: "column", gap: "10px" }}
        >
          {computed.parseError && (
            <div
              style={{
                padding: "8px 10px",
                borderRadius: "6px",
                background: "var(--ms-status-fail-bg)",
                color: "var(--ms-status-fail-fg)",
                border: "1px solid var(--ms-status-fail-border)",
              }}
            >
              Parse error: {computed.parseError}
            </div>
          )}
          <div style={{ fontWeight: 600, fontSize: "12px" }}>Model Diagnostics ({computed.lints.length})</div>
          {computed.lints.length === 0 ? (
            <div style={{ color: "var(--ms-text-2)" }}>No OLGA lint issues detected.</div>
          ) : (
            computed.lints.map((diag, idx) => (
              <div
                key={`${diag.code}-${idx}`}
                style={{
                  padding: "8px 10px",
                  borderRadius: "6px",
                  background: "var(--ms-bg-alt)",
                  border: "1px solid var(--ms-border)",
                  display: "flex",
                  justifyContent: "space-between",
                  gap: "8px",
                }}
              >
                <div>
                  <span style={{ fontWeight: 600, marginRight: "6px", fontFamily: "var(--ms-font-mono)" }}>
                    [{diag.code}]
                  </span>
                  <span>{diag.message}</span>
                </div>
                <span style={{ fontSize: "10px", textTransform: "uppercase", color: "var(--ms-text-2)" }}>
                  {diag.severity}
                </span>
              </div>
            ))
          )}
        </div>
      ) : (
        <PanelSvgStage
          svg={activeSvg}
          onRevealLine={host.onRevealLine}
          emptyMessage={
            computed.parseError
              ? `Could not render view: ${computed.parseError}`
              : "Provide an OLGA .opi / .key / .tpl / .ppl document to render flow assurance views."
          }
        />
      )}
    </PanelShell>
  );
};

export default OlgaPanel;
