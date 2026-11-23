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
import { renderHdf4DiagramSvg } from "../diagram/index.js";
import { lintHdf4 } from "../lints/index.js";
import { parseHdf4Ddl } from "../parser/ddl-parser.js";
import { hdf4ToCsv, hdf4ToNetcdfCdl } from "../projections/index.js";
import { analyzeHdf4Document } from "../solver/index.js";
import { HDF4_DATA_TYPE_NAMES } from "../types.js";

type Hdf4TabId = "diagram" | "datasets" | "vgroups" | "projections" | "lints";

export const Hdf4Panel: React.FC<LanguagePanelProps> = ({
  code,
  dialect,
  colorMode,
  mode,
  viewConfig,
  isFullScreen = false,
  host,
}) => {
  const [activeTab, setActiveTab] = useState<Hdf4TabId>("diagram");
  const [selectedSdsName, setSelectedSdsName] = useState<string>("");

  const computed = useMemo(() => {
    if (!code.trim()) {
      return {
        doc: null,
        analysis: null,
        lints: [] as ReturnType<typeof lintHdf4>,
        error: undefined as string | undefined,
      };
    }
    try {
      const doc = parseHdf4Ddl(code);
      const lints = lintHdf4(doc);
      const analysis = analyzeHdf4Document(doc);
      return { doc, analysis, lints, error: undefined };
    } catch (err) {
      return {
        doc: null,
        analysis: null,
        lints: [],
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }, [code]);

  const effectiveSdsName =
    selectedSdsName && computed.doc?.sdsList.some((s) => s.name === selectedSdsName)
      ? selectedSdsName
      : (computed.doc?.sdsList[0]?.name ?? "");

  const title =
    (typeof viewConfig?.["title"] === "string" && viewConfig["title"]) ||
    computed.doc?.name ||
    "NCSA HDF4 Scientific Container";

  const svg = useMemo(() => {
    if (!computed.doc) return "";
    try {
      return renderHdf4DiagramSvg(computed.doc, {
        sdsName: effectiveSdsName || undefined,
        colorMode: colorMode === "light" ? "light" : "dark",
      });
    } catch {
      return "";
    }
  }, [computed.doc, effectiveSdsName, colorMode]);

  const cdlText = useMemo(() => (computed.doc ? hdf4ToNetcdfCdl(computed.doc) : ""), [computed.doc]);
  const csvText = useMemo(
    () => (computed.doc ? hdf4ToCsv(computed.doc, effectiveSdsName || undefined) : ""),
    [computed.doc, effectiveSdsName],
  );

  const kpis = useMemo<PanelKpiItem[]>(() => {
    const sdsCount = computed.doc?.sdsList.length ?? 0;
    const vgCount = computed.doc?.vgroups.length ?? 0;
    const errCount = computed.lints.filter((d) => d.severity === "error").length;
    return [
      { label: "SDS Datasets", value: sdsCount, tone: "info" },
      { label: "Vgroups", value: vgCount },
      { label: "Elements", value: computed.analysis?.totalSdsElements ?? 0 },
      { label: "Errors", value: errCount, tone: errCount > 0 ? "danger" : "success" },
    ];
  }, [computed.doc, computed.analysis, computed.lints]);

  return (
    <PanelShell mode={mode} colorMode={colorMode} isFullScreen={isFullScreen}>
      <PanelToolbar
        title={title}
        subtitle="NCSA HDF4 / EOS-HDF Viewer"
        badge={computed.error ? { label: "Parse Error", tone: "danger" } : { label: "HDF4", tone: "info" }}
        actions={
          <>
            {activeTab === "diagram" && host.exportFile && (
              <PanelButton onClick={() => host.exportFile?.("hdf4-diagram.svg", svg, "image/svg+xml")} disabled={!svg}>
                Export SVG
              </PanelButton>
            )}
            {activeTab === "projections" && host.exportFile && (
              <PanelButton onClick={() => host.exportFile?.(`${title}.cdl`, cdlText, "text/plain")} disabled={!cdlText}>
                Export CDL
              </PanelButton>
            )}
            {mode === "artifact" && host.openInMorsel && code && (
              <PanelButton variant="primary" onClick={() => host.openInMorsel?.(code, dialect || "hdf4", title)}>
                Open in Morsel
              </PanelButton>
            )}
          </>
        }
      />

      <PanelKpiStrip items={kpis} />

      <PanelTabBar<Hdf4TabId>
        activeTab={activeTab}
        onSelect={setActiveTab}
        tabs={[
          { id: "diagram", label: "Hierarchy & Heatmap" },
          { id: "datasets", label: "SDS Datasets", count: computed.doc?.sdsList.length ?? 0 },
          { id: "vgroups", label: "Vgroups", count: computed.doc?.vgroups.length ?? 0 },
          { id: "projections", label: "NetCDF / CSV" },
          { id: "lints", label: "Lints", count: computed.lints.length },
        ]}
      />

      {activeTab === "diagram" && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
          {computed.doc && computed.doc.sdsList.length > 1 && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                padding: "6px 12px",
                borderBottom: "1px solid var(--ms-border)",
                fontSize: "11px",
              }}
            >
              <span style={{ color: "var(--ms-text-2)" }}>Heatmap SDS:</span>
              <select
                value={effectiveSdsName}
                onChange={(e) => setSelectedSdsName(e.target.value)}
                style={{
                  background: "var(--ms-bg-alt)",
                  color: "var(--ms-text-1)",
                  border: "1px solid var(--ms-border)",
                  borderRadius: "4px",
                  padding: "2px 6px",
                  fontSize: "11px",
                }}
              >
                {computed.doc.sdsList.map((s) => (
                  <option key={s.name} value={s.name}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <PanelSvgStage
            svg={svg}
            onRevealLine={host.onRevealLine}
            emptyMessage={
              computed.error ?? "Load an HDF4 (.hdf / .h4 / .hdf4) DDL schema to inspect hierarchy and heatmap."
            }
          />
        </div>
      )}

      {activeTab === "datasets" && (
        <div style={{ flex: 1, overflow: "auto", padding: "10px 12px" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid var(--ms-border)", color: "var(--ms-text-2)" }}>
                <th style={{ padding: "5px 6px" }}>SDS Name</th>
                <th style={{ padding: "5px 6px" }}>Type</th>
                <th style={{ padding: "5px 6px" }}>Shape</th>
                <th style={{ padding: "5px 6px" }}>Min</th>
                <th style={{ padding: "5px 6px" }}>Max</th>
                <th style={{ padding: "5px 6px" }}>Mean</th>
                <th style={{ padding: "5px 6px" }}>Std</th>
              </tr>
            </thead>
            <tbody>
              {(computed.doc?.sdsList ?? []).map((s, idx) => {
                const st = computed.analysis?.sdsStats[s.name];
                return (
                  <tr
                    key={`${s.name}-${idx}`}
                    onClick={() => {
                      setSelectedSdsName(s.name);
                      setActiveTab("diagram");
                    }}
                    style={{
                      borderBottom: "1px solid var(--ms-divider)",
                      fontFamily: "var(--ms-font-mono)",
                      cursor: "pointer",
                    }}
                  >
                    <td style={{ padding: "4px 6px", fontWeight: 600 }}>{s.name}</td>
                    <td style={{ padding: "4px 6px" }}>{HDF4_DATA_TYPE_NAMES[s.dataType] ?? s.dataType}</td>
                    <td style={{ padding: "4px 6px" }}>{s.dims.map((d) => `${d.name}:${d.size}`).join(" x ")}</td>
                    <td style={{ padding: "4px 6px" }}>{st ? st.min.toFixed(3) : "—"}</td>
                    <td style={{ padding: "4px 6px" }}>{st ? st.max.toFixed(3) : "—"}</td>
                    <td style={{ padding: "4px 6px" }}>{st ? st.mean.toFixed(3) : "—"}</td>
                    <td style={{ padding: "4px 6px" }}>{st ? st.std.toFixed(3) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === "vgroups" && (
        <div style={{ flex: 1, overflow: "auto", padding: "10px 12px" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid var(--ms-border)", color: "var(--ms-text-2)" }}>
                <th style={{ padding: "5px 6px" }}>Vgroup</th>
                <th style={{ padding: "5px 6px" }}>Class</th>
                <th style={{ padding: "5px 6px" }}>Ref</th>
                <th style={{ padding: "5px 6px" }}>Members</th>
              </tr>
            </thead>
            <tbody>
              {(computed.doc?.vgroups ?? []).map((vg, idx) => (
                <tr
                  key={`${vg.name}-${idx}`}
                  style={{ borderBottom: "1px solid var(--ms-divider)", fontFamily: "var(--ms-font-mono)" }}
                >
                  <td style={{ padding: "4px 6px", fontWeight: 600 }}>{vg.name}</td>
                  <td style={{ padding: "4px 6px", color: "var(--ms-text-2)" }}>{vg.vgroupClass ?? "—"}</td>
                  <td style={{ padding: "4px 6px" }}>{vg.ref}</td>
                  <td style={{ padding: "4px 6px" }}>
                    {vg.members.map((m) => `${m.kind}:${m.name}`).join(", ") || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === "projections" && (
        <div
          style={{
            flex: 1,
            overflow: "auto",
            padding: "10px 12px",
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "12px",
          }}
        >
          <div>
            <div style={{ fontSize: "11px", fontWeight: 600, marginBottom: "6px" }}>NetCDF CDL</div>
            <pre
              style={{
                margin: 0,
                padding: "8px",
                borderRadius: "6px",
                background: "var(--ms-bg-alt)",
                border: "1px solid var(--ms-border)",
                fontFamily: "var(--ms-font-mono)",
                fontSize: "10.5px",
                overflow: "auto",
              }}
            >
              {cdlText || "// No CDL output"}
            </pre>
          </div>
          <div>
            <div style={{ fontSize: "11px", fontWeight: 600, marginBottom: "6px" }}>
              CSV ({effectiveSdsName || "Dataset"})
            </div>
            <pre
              style={{
                margin: 0,
                padding: "8px",
                borderRadius: "6px",
                background: "var(--ms-bg-alt)",
                border: "1px solid var(--ms-border)",
                fontFamily: "var(--ms-font-mono)",
                fontSize: "10.5px",
                overflow: "auto",
              }}
            >
              {csvText || "# No CSV output"}
            </pre>
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
            <div style={{ color: "var(--ms-text-2)" }}>No HDF4 lint diagnostics.</div>
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

export default Hdf4Panel;
