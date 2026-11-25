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
import { renderNetcdfHeatmapSvg } from "../diagram/heatmap-svg.js";
import { lintNetcdf } from "../lints/index.js";
import { parseCdl } from "../parser/cdl-parser.js";
import { computeFieldStats, computeVariableShape, unpackVariableValues } from "../solver/field-ops.js";

type NetcdfTabId = "heatmap" | "variables" | "lints";

export const NetcdfPanel: React.FC<LanguagePanelProps> = ({
  code,
  dialect,
  colorMode,
  mode,
  viewConfig,
  isFullScreen = false,
  host,
}) => {
  const [activeTab, setActiveTab] = useState<NetcdfTabId>("heatmap");
  const [selectedVar, setSelectedVar] = useState<string>("");
  const [sliceIndex, setSliceIndex] = useState<number>(0);

  const computed = useMemo(() => {
    if (!code.trim()) {
      return { dataset: null, lints: [] as ReturnType<typeof lintNetcdf>, error: undefined as string | undefined };
    }
    try {
      const dataset = parseCdl(code);
      const lints = lintNetcdf(dataset);
      return { dataset, lints, error: undefined };
    } catch (err) {
      return { dataset: null, lints: [], error: err instanceof Error ? err.message : String(err) };
    }
  }, [code]);

  const numericVars = useMemo(
    () => (computed.dataset?.variables ?? []).filter((v) => v.type !== "char"),
    [computed.dataset],
  );

  const activeVarName = useMemo(() => {
    if (selectedVar && numericVars.some((v) => v.name === selectedVar)) {
      return selectedVar;
    }
    const dimNames = new Set((computed.dataset?.dimensions ?? []).map((d) => d.name));
    const gridVar = numericVars.find(
      (v) => v.dimensions.length >= 2 && !(v.dimensions.length === 1 && dimNames.has(v.name)),
    );
    return gridVar?.name ?? numericVars[0]?.name ?? "";
  }, [selectedVar, numericVars, computed.dataset]);

  const activeVar = useMemo(
    () => computed.dataset?.variables.find((v) => v.name === activeVarName),
    [computed.dataset, activeVarName],
  );

  const maxSliceIndex = useMemo(() => {
    if (!computed.dataset || !activeVar || activeVar.dimensions.length < 3) return 0;
    const shape = computeVariableShape(computed.dataset, activeVar);
    return Math.max(0, (shape[0] ?? 1) - 1);
  }, [computed.dataset, activeVar]);

  const safeSliceIndex = Math.min(sliceIndex, maxSliceIndex);

  const title =
    (typeof viewConfig?.["title"] === "string" && viewConfig["title"]) ||
    computed.dataset?.name ||
    "NetCDF Classic Dataset";

  const svg = useMemo(() => {
    if (!computed.dataset) return "";
    try {
      return renderNetcdfHeatmapSvg(computed.dataset, {
        variableName: activeVarName || undefined,
        sliceIndex: safeSliceIndex,
        colorMode: colorMode === "light" ? "light" : "dark",
      });
    } catch {
      return "";
    }
  }, [computed.dataset, activeVarName, safeSliceIndex, colorMode]);

  const kpis = useMemo<PanelKpiItem[]>(() => {
    const dimCount = computed.dataset?.dimensions.length ?? 0;
    const varCount = computed.dataset?.variables.length ?? 0;
    const attrCount = computed.dataset?.globalAttributes.length ?? 0;
    const diagCount = computed.lints.length;
    return [
      { label: "Dimensions", value: dimCount, tone: "info" },
      { label: "Variables", value: varCount },
      { label: "Global Attrs", value: attrCount },
      { label: "Diagnostics", value: diagCount, tone: diagCount > 0 ? "warning" : "success" },
    ];
  }, [computed.dataset, computed.lints]);

  return (
    <PanelShell mode={mode} colorMode={colorMode} isFullScreen={isFullScreen}>
      <PanelToolbar
        title={title}
        subtitle="Unidata NetCDF Classic & CDL"
        badge={computed.error ? { label: "Parse Error", tone: "danger" } : { label: "NetCDF", tone: "info" }}
        actions={
          <>
            {activeTab === "heatmap" && numericVars.length > 0 && (
              <select
                aria-label="Select NetCDF variable"
                value={activeVarName}
                onChange={(e) => {
                  setSelectedVar(e.target.value);
                  setSliceIndex(0);
                }}
                style={{
                  fontSize: "11px",
                  padding: "3px 6px",
                  borderRadius: "4px",
                  border: "1px solid var(--ms-border)",
                  background: "var(--ms-bg-alt)",
                  color: "var(--ms-text)",
                  fontFamily: "var(--ms-font-mono)",
                }}
              >
                {numericVars.map((v) => (
                  <option key={v.name} value={v.name}>
                    {v.name} ({v.type})
                  </option>
                ))}
              </select>
            )}
            {activeTab === "heatmap" && maxSliceIndex > 0 && (
              <select
                aria-label="Select leading-axis slice"
                value={safeSliceIndex}
                onChange={(e) => setSliceIndex(Number(e.target.value))}
                style={{
                  fontSize: "11px",
                  padding: "3px 6px",
                  borderRadius: "4px",
                  border: "1px solid var(--ms-border)",
                  background: "var(--ms-bg-alt)",
                  color: "var(--ms-text)",
                  fontFamily: "var(--ms-font-mono)",
                }}
              >
                {Array.from({ length: maxSliceIndex + 1 }, (_, i) => (
                  <option key={i} value={i}>
                    slice {i}
                  </option>
                ))}
              </select>
            )}
            {activeTab === "heatmap" && host.exportFile && (
              <PanelButton
                onClick={() => host.exportFile?.(`${title}-heatmap.svg`, svg, "image/svg+xml")}
                disabled={!svg}
              >
                Export SVG
              </PanelButton>
            )}
            {mode === "artifact" && host.openInAnsatzEditor && code && (
              <PanelButton
                variant="primary"
                onClick={() => host.openInAnsatzEditor?.(code, dialect || "netcdf", title)}
              >
                Open in Ansatz Editor
              </PanelButton>
            )}
          </>
        }
      />

      <PanelKpiStrip items={kpis} />

      <PanelTabBar<NetcdfTabId>
        activeTab={activeTab}
        onSelect={setActiveTab}
        tabs={[
          { id: "heatmap", label: "2D Heatmap" },
          { id: "variables", label: "Schema & Metadata", count: computed.dataset?.variables.length ?? 0 },
          { id: "lints", label: "Lints", count: computed.lints.length },
        ]}
      />

      {activeTab === "heatmap" && (
        <PanelSvgStage
          svg={svg}
          onRevealLine={host.onRevealLine}
          emptyMessage={computed.error ?? "Load a NetCDF CDL (.cdl) dataset to render the 2D field heatmap."}
        />
      )}

      {activeTab === "variables" && (
        <div
          style={{
            flex: 1,
            overflow: "auto",
            padding: "10px 12px",
            display: "flex",
            flexDirection: "column",
            gap: "14px",
          }}
        >
          <div>
            <div style={{ fontSize: "11px", fontWeight: 600, marginBottom: "6px", color: "var(--ms-text-2)" }}>
              Dimensions ({computed.dataset?.dimensions.length ?? 0})
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px" }}>
              <thead>
                <tr
                  style={{ textAlign: "left", borderBottom: "1px solid var(--ms-border)", color: "var(--ms-text-2)" }}
                >
                  <th style={{ padding: "4px 6px" }}>Name</th>
                  <th style={{ padding: "4px 6px" }}>Size</th>
                  <th style={{ padding: "4px 6px" }}>Kind</th>
                </tr>
              </thead>
              <tbody>
                {(computed.dataset?.dimensions ?? []).map((d, idx) => (
                  <tr
                    key={`${d.name}-${idx}`}
                    style={{ borderBottom: "1px solid var(--ms-divider)", fontFamily: "var(--ms-font-mono)" }}
                  >
                    <td style={{ padding: "4px 6px", fontWeight: 600 }}>{d.name}</td>
                    <td style={{ padding: "4px 6px" }}>{d.size}</td>
                    <td style={{ padding: "4px 6px", color: "var(--ms-text-2)" }}>
                      {d.isUnlimited ? "UNLIMITED" : "Fixed"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div>
            <div style={{ fontSize: "11px", fontWeight: 600, marginBottom: "6px", color: "var(--ms-text-2)" }}>
              Variables ({computed.dataset?.variables.length ?? 0})
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px" }}>
              <thead>
                <tr
                  style={{ textAlign: "left", borderBottom: "1px solid var(--ms-border)", color: "var(--ms-text-2)" }}
                >
                  <th style={{ padding: "4px 6px" }}>Name</th>
                  <th style={{ padding: "4px 6px" }}>Type</th>
                  <th style={{ padding: "4px 6px" }}>Shape</th>
                  <th style={{ padding: "4px 6px" }}>Units</th>
                  <th style={{ padding: "4px 6px" }}>Min / Max</th>
                </tr>
              </thead>
              <tbody>
                {(computed.dataset?.variables ?? []).map((v, idx) => {
                  const unitsAttr = v.attributes.find((a) => a.name === "units");
                  const stats = v.type !== "char" ? computeFieldStats(unpackVariableValues(v)) : null;
                  const rangeStr =
                    stats && stats.validCount > 0 ? `${stats.min.toFixed(2)} .. ${stats.max.toFixed(2)}` : "—";
                  return (
                    <tr
                      key={`${v.name}-${idx}`}
                      style={{ borderBottom: "1px solid var(--ms-divider)", fontFamily: "var(--ms-font-mono)" }}
                    >
                      <td style={{ padding: "4px 6px", fontWeight: 600 }}>{v.name}</td>
                      <td style={{ padding: "4px 6px" }}>{v.type}</td>
                      <td style={{ padding: "4px 6px" }}>({v.dimensions.join(", ")})</td>
                      <td style={{ padding: "4px 6px", color: "var(--ms-text-2)" }}>
                        {unitsAttr ? String(unitsAttr.value) : "—"}
                      </td>
                      <td style={{ padding: "4px 6px", color: "var(--ms-text-2)" }}>{rangeStr}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div>
            <div style={{ fontSize: "11px", fontWeight: 600, marginBottom: "6px", color: "var(--ms-text-2)" }}>
              Global Attributes ({computed.dataset?.globalAttributes.length ?? 0})
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px" }}>
              <thead>
                <tr
                  style={{ textAlign: "left", borderBottom: "1px solid var(--ms-border)", color: "var(--ms-text-2)" }}
                >
                  <th style={{ padding: "4px 6px" }}>Attribute</th>
                  <th style={{ padding: "4px 6px" }}>Value</th>
                </tr>
              </thead>
              <tbody>
                {(computed.dataset?.globalAttributes ?? []).map((ga, idx) => (
                  <tr
                    key={`${ga.name}-${idx}`}
                    style={{ borderBottom: "1px solid var(--ms-divider)", fontFamily: "var(--ms-font-mono)" }}
                  >
                    <td style={{ padding: "4px 6px", fontWeight: 600 }}>:{ga.name}</td>
                    <td style={{ padding: "4px 6px", color: "var(--ms-text-2)" }}>
                      {Array.isArray(ga.value) ? ga.value.join(", ") : String(ga.value)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
            <div style={{ color: "var(--ms-text-2)" }}>No NetCDF / CF-1.x lint diagnostics.</div>
          ) : (
            computed.lints.map((d, idx) => (
              <div
                key={`${d.code}-${idx}`}
                onClick={() => {
                  if (d.line && host.onRevealLine) host.onRevealLine(d.line);
                }}
                style={{
                  padding: "7px 10px",
                  borderRadius: "6px",
                  background: "var(--ms-bg-alt)",
                  border: "1px solid var(--ms-border)",
                  cursor: d.line && host.onRevealLine ? "pointer" : "default",
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

export default NetcdfPanel;
