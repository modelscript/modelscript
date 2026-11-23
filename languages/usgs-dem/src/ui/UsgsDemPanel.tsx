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
import React, { useMemo, useState } from "react";
import { renderUsgsDemMapSvg } from "../diagram/index.js";
import { lintUsgsDem } from "../lints/index.js";
import { parseUsgsDem } from "../parser/index.js";
import { usgsDemToHec1, usgsDemToStl } from "../projections/index.js";
import { computeD8Flow, computeHypsometricIntegral, computeTerrainGridMetrics } from "../solver/index.js";

type UsgsDemTabId = "map" | "profiles" | "topography" | "lints";

export const UsgsDemPanel: React.FC<LanguagePanelProps> = ({
  code,
  dialect,
  colorMode,
  mode,
  viewConfig,
  isFullScreen = false,
  host,
}) => {
  const [activeTab, setActiveTab] = useState<UsgsDemTabId>("map");
  const [showContours, setShowContours] = useState<boolean>(true);
  const [transectPct, setTransectPct] = useState<number>(50);

  const computed = useMemo(() => {
    if (!code.trim()) {
      return {
        model: null,
        lints: [] as ReturnType<typeof lintUsgsDem>,
        hypso: null,
        metrics: null,
        d8: null,
        error: undefined as string | undefined,
      };
    }
    try {
      const model = parseUsgsDem(code);
      const lints = lintUsgsDem(model);
      const hypso = computeHypsometricIntegral(model);
      const metrics = computeTerrainGridMetrics(model);
      const d8 = computeD8Flow(model);
      return { model, lints, hypso, metrics, d8, error: undefined };
    } catch (err) {
      return {
        model: null,
        lints: [],
        hypso: null,
        metrics: null,
        d8: null,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }, [code]);

  const title =
    (typeof viewConfig?.["title"] === "string" && viewConfig["title"]) ||
    computed.model?.header.quadrangleName ||
    "USGS Digital Elevation Model";

  const svg = useMemo(() => {
    if (!computed.model) return "";
    try {
      return renderUsgsDemMapSvg(computed.model, {
        showContours,
        transectFraction: transectPct / 100,
      });
    } catch {
      return "";
    }
  }, [computed.model, showContours, transectPct]);

  const kpis = useMemo<PanelKpiItem[]>(() => {
    const grid = computed.model?.grid;
    const hypso = computed.hypso;
    const diagCount = computed.lints.length;
    return [
      { label: "Grid", value: grid ? `${grid.numCols}×${grid.numRows}` : "—", tone: "info" },
      { label: "Relief", value: hypso ? `${hypso.relief.toFixed(1)}` : "—" },
      {
        label: "Mean Slope",
        value: computed.metrics ? `${computed.metrics.meanSlopeDeg.toFixed(1)}°` : "—",
      },
      { label: "Diagnostics", value: diagCount, tone: diagCount > 0 ? "warning" : "success" },
    ];
  }, [computed]);

  return (
    <PanelShell mode={mode} colorMode={colorMode} isFullScreen={isFullScreen}>
      <PanelToolbar
        title={title}
        subtitle="USGS DEM ASCII Terrain"
        badge={computed.error ? { label: "Parse Error", tone: "danger" } : { label: "USGS DEM", tone: "info" }}
        actions={
          <>
            {activeTab === "map" && (
              <PanelButton onClick={() => setShowContours((v) => !v)}>
                {showContours ? "Hide Contours" : "Show Contours"}
              </PanelButton>
            )}
            {activeTab === "map" && host.exportFile && (
              <PanelButton onClick={() => host.exportFile?.("usgs-dem-map.svg", svg, "image/svg+xml")} disabled={!svg}>
                Export SVG
              </PanelButton>
            )}
            {computed.model && host.exportFile && (
              <PanelButton onClick={() => host.exportFile?.("terrain.stl", usgsDemToStl(computed.model!), "model/stl")}>
                Export STL
              </PanelButton>
            )}
            {computed.model && host.exportFile && (
              <PanelButton
                onClick={() => host.exportFile?.("watershed.hec1", usgsDemToHec1(computed.model!), "text/plain")}
              >
                Export HEC-1
              </PanelButton>
            )}
            {mode === "artifact" && host.openInMorsel && code && (
              <PanelButton variant="primary" onClick={() => host.openInMorsel?.(code, dialect || "usgs-dem", title)}>
                Open in Morsel
              </PanelButton>
            )}
          </>
        }
      />

      <PanelKpiStrip items={kpis} />

      <PanelTabBar<UsgsDemTabId>
        activeTab={activeTab}
        onSelect={setActiveTab}
        tabs={[
          { id: "map", label: "Elevation Map" },
          { id: "profiles", label: "Type B Profiles", count: computed.model?.profiles.length ?? 0 },
          { id: "topography", label: "Topography & D8" },
          { id: "lints", label: "Lints", count: computed.lints.length },
        ]}
      />

      {activeTab === "map" && (
        <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
          {computed.model && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "10px",
                padding: "6px 12px",
                fontSize: "11px",
                color: "var(--ms-text-2)",
                borderBottom: "1px solid var(--ms-border)",
              }}
            >
              <label htmlFor="usgs-dem-transect">Cross-Section Transect (N–S): {transectPct}%</label>
              <input
                id="usgs-dem-transect"
                type="range"
                min={0}
                max={100}
                value={transectPct}
                onChange={(e) => setTransectPct(Number(e.target.value))}
                style={{ width: "160px" }}
              />
            </div>
          )}
          <PanelSvgStage
            svg={svg}
            onRevealLine={host.onRevealLine}
            emptyMessage={computed.error ?? "Load a USGS DEM (.dem) terrain file to render the elevation map."}
          />
        </div>
      )}

      {activeTab === "profiles" && (
        <div style={{ flex: 1, overflow: "auto", padding: "10px 12px" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid var(--ms-border)", color: "var(--ms-text-2)" }}>
                <th style={{ padding: "5px 6px" }}>Col</th>
                <th style={{ padding: "5px 6px" }}>Samples</th>
                <th style={{ padding: "5px 6px" }}>X Origin</th>
                <th style={{ padding: "5px 6px" }}>Y Origin</th>
                <th style={{ padding: "5px 6px" }}>Min Z</th>
                <th style={{ padding: "5px 6px" }}>Max Z</th>
              </tr>
            </thead>
            <tbody>
              {(computed.model?.profiles ?? []).map((p) => (
                <tr
                  key={p.colIndex}
                  onClick={() => host.onRevealLine?.(p.line)}
                  style={{ borderBottom: "1px solid var(--ms-border)", cursor: "pointer" }}
                >
                  <td style={{ padding: "5px 6px", fontFamily: "monospace" }}>{p.colIndex}</td>
                  <td style={{ padding: "5px 6px", fontFamily: "monospace" }}>{p.elevations.length}</td>
                  <td style={{ padding: "5px 6px", fontFamily: "monospace" }}>{p.xOrigin.toFixed(1)}</td>
                  <td style={{ padding: "5px 6px", fontFamily: "monospace" }}>{p.yOrigin.toFixed(1)}</td>
                  <td style={{ padding: "5px 6px", fontFamily: "monospace" }}>{p.minElevation.toFixed(2)}</td>
                  <td style={{ padding: "5px 6px", fontFamily: "monospace" }}>{p.maxElevation.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === "topography" && (
        <div style={{ flex: 1, overflow: "auto", padding: "12px", fontSize: "12px", lineHeight: 1.6 }}>
          {computed.hypso && computed.metrics && computed.d8 ? (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
              <div>
                <strong>Elevation Min / Max:</strong> {computed.hypso.minElevation.toFixed(2)} /{" "}
                {computed.hypso.maxElevation.toFixed(2)}
              </div>
              <div>
                <strong>Mean Elevation:</strong> {computed.hypso.meanElevation.toFixed(2)}
              </div>
              <div>
                <strong>Hypsometric Integral:</strong> {computed.hypso.hypsometricIntegral.toFixed(4)}
              </div>
              <div>
                <strong>Mean / Max Horn Slope:</strong> {computed.metrics.meanSlopeDeg.toFixed(2)}° /{" "}
                {computed.metrics.maxSlopeDeg.toFixed(2)}°
              </div>
              <div>
                <strong>D8 Max Flow Accumulation:</strong> {computed.d8.maxAccumulation} cells
              </div>
              <div>
                <strong>Format:</strong> {computed.model?.format}
              </div>
            </div>
          ) : (
            <div style={{ color: "var(--ms-text-2)" }}>No topographic metrics available.</div>
          )}
        </div>
      )}

      {activeTab === "lints" && (
        <div style={{ flex: 1, overflow: "auto", padding: "10px 12px" }}>
          {computed.lints.length === 0 ? (
            <div style={{ color: "var(--ms-text-2)", fontSize: "12px" }}>No USGS DEM lint diagnostics found.</div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px" }}>
              <thead>
                <tr
                  style={{ textAlign: "left", borderBottom: "1px solid var(--ms-border)", color: "var(--ms-text-2)" }}
                >
                  <th style={{ padding: "5px 6px" }}>Code</th>
                  <th style={{ padding: "5px 6px" }}>Severity</th>
                  <th style={{ padding: "5px 6px" }}>Line</th>
                  <th style={{ padding: "5px 6px" }}>Message</th>
                </tr>
              </thead>
              <tbody>
                {computed.lints.map((d, idx) => (
                  <tr
                    key={`${d.code}-${idx}`}
                    onClick={() => host.onRevealLine?.(d.line)}
                    style={{ borderBottom: "1px solid var(--ms-border)", cursor: "pointer" }}
                  >
                    <td style={{ padding: "5px 6px", fontFamily: "monospace" }}>{d.code}</td>
                    <td style={{ padding: "5px 6px" }}>{d.severity}</td>
                    <td style={{ padding: "5px 6px", fontFamily: "monospace" }}>{d.line}</td>
                    <td style={{ padding: "5px 6px" }}>{d.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </PanelShell>
  );
};

export default UsgsDemPanel;
