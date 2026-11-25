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
import { lookupWmoLevelType, lookupWmoParameterByCode } from "../catalog/grib-std-schemas.js";
import { renderGribMapSvg } from "../diagram/grib-map.js";
import { lintGribDocument } from "../lints/index.js";
import { parseGribDescriptor } from "../parser/text-parser.js";
import { gribToNetCdfCdl } from "../projections/grib-to-cdl.js";
import { gribToCsv } from "../projections/grib-to-csv.js";
import { computeGribFieldStats } from "../solver/packing.js";

type GribTabId = "map" | "messages" | "lints" | "export";

export const GribPanel: React.FC<LanguagePanelProps> = ({
  code,
  dialect,
  colorMode,
  mode,
  viewConfig,
  isFullScreen = false,
  host,
}) => {
  const [activeTab, setActiveTab] = useState<GribTabId>("map");
  const [selectedMsgIdx, setSelectedMsgIdx] = useState<number>(0);
  const [showIsobars, setShowIsobars] = useState<boolean>(true);
  const [showWindBarbs, setShowWindBarbs] = useState<boolean>(true);

  const computed = useMemo(() => {
    if (!code.trim()) {
      return {
        doc: null,
        lints: [] as ReturnType<typeof lintGribDocument>,
        error: undefined as string | undefined,
      };
    }
    try {
      const doc = parseGribDescriptor(code);
      const lints = lintGribDocument(doc);
      return { doc, lints, error: undefined };
    } catch (err) {
      return {
        doc: null,
        lints: [],
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }, [code]);

  const safeMsgIdx = useMemo(() => {
    const count = computed.doc?.messages.length ?? 0;
    if (count === 0) return 0;
    return Math.min(selectedMsgIdx, count - 1);
  }, [computed.doc, selectedMsgIdx]);

  const activeMessage = computed.doc?.messages[safeMsgIdx];

  const title =
    (typeof viewConfig?.["title"] === "string" && viewConfig["title"]) ||
    (activeMessage?.pds?.parameterName
      ? `GRIB1 ${activeMessage.pds.parameterName} @ ${activeMessage.pds.levelValue}`
      : "WMO GRIB Edition 1 Viewer");

  const svg = useMemo(() => {
    if (!computed.doc || computed.doc.messages.length === 0) return "";
    try {
      return renderGribMapSvg(computed.doc, {
        messageIndex: safeMsgIdx,
        showIsobars,
        showWindBarbs,
      });
    } catch {
      return "";
    }
  }, [computed.doc, safeMsgIdx, showIsobars, showWindBarbs]);

  const cdlPreview = useMemo(() => {
    if (!computed.doc || computed.doc.messages.length === 0) return "";
    return gribToNetCdfCdl(computed.doc);
  }, [computed.doc]);

  const csvPreview = useMemo(() => {
    if (!computed.doc || computed.doc.messages.length === 0) return "";
    return gribToCsv(computed.doc);
  }, [computed.doc]);

  const kpis = useMemo<PanelKpiItem[]>(() => {
    const msgCount = computed.doc?.messages.length ?? 0;
    const gridLabel = activeMessage?.gds ? `${activeMessage.gds.ni}×${activeMessage.gds.nj}` : "—";
    const stats = activeMessage?.bds ? computeGribFieldStats(activeMessage.bds.values, activeMessage.gds) : null;
    const meanLabel = stats && stats.validCount > 0 ? stats.areaWeightedMean.toFixed(2) : "—";
    const diagCount = computed.lints.length;
    return [
      { label: "Messages", value: msgCount, tone: "info" },
      { label: "Grid", value: gridLabel },
      { label: "Area Mean", value: meanLabel },
      { label: "Diagnostics", value: diagCount, tone: diagCount > 0 ? "warning" : "success" },
    ];
  }, [computed.doc, activeMessage, computed.lints]);

  return (
    <PanelShell mode={mode} colorMode={colorMode} isFullScreen={isFullScreen}>
      <PanelToolbar
        title={title}
        subtitle="WMO FM 92-VIII GRIB1"
        badge={computed.error ? { label: "Parse Error", tone: "danger" } : { label: "GRIB1", tone: "info" }}
        actions={
          <>
            {activeTab === "map" && (
              <>
                <PanelButton onClick={() => setShowIsobars((v) => !v)}>
                  {showIsobars ? "Hide Isobars" : "Show Isobars"}
                </PanelButton>
                <PanelButton onClick={() => setShowWindBarbs((v) => !v)}>
                  {showWindBarbs ? "Hide Wind" : "Show Wind"}
                </PanelButton>
              </>
            )}
            {activeTab === "map" && host.exportFile && (
              <PanelButton onClick={() => host.exportFile?.("grib-map.svg", svg, "image/svg+xml")} disabled={!svg}>
                Export SVG
              </PanelButton>
            )}
            {activeTab === "export" && host.exportFile && (
              <>
                <PanelButton
                  onClick={() => host.exportFile?.("grib-dataset.cdl", cdlPreview, "text/plain")}
                  disabled={!cdlPreview}
                >
                  Export CDL
                </PanelButton>
                <PanelButton
                  onClick={() => host.exportFile?.("grib-grid.csv", csvPreview, "text/csv")}
                  disabled={!csvPreview}
                >
                  Export CSV
                </PanelButton>
              </>
            )}
            {mode === "artifact" && host.openInAnsatzEditor && code && (
              <PanelButton variant="primary" onClick={() => host.openInAnsatzEditor?.(code, dialect || "grib", title)}>
                Open in Ansatz Editor
              </PanelButton>
            )}
          </>
        }
      />

      <PanelKpiStrip items={kpis} />

      <PanelTabBar<GribTabId>
        activeTab={activeTab}
        onSelect={setActiveTab}
        tabs={[
          { id: "map", label: "Geo Map" },
          { id: "messages", label: "Messages", count: computed.doc?.messages.length ?? 0 },
          { id: "lints", label: "Lints", count: computed.lints.length },
          { id: "export", label: "CDL / CSV" },
        ]}
      />

      {activeTab === "map" && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
          {(computed.doc?.messages.length ?? 0) > 1 && (
            <div
              style={{
                display: "flex",
                gap: "6px",
                padding: "6px 12px",
                borderBottom: "1px solid var(--ms-border)",
                alignItems: "center",
                fontSize: "11px",
              }}
            >
              <span style={{ color: "var(--ms-text-2)" }}>Field:</span>
              {computed.doc?.messages.map((m, idx) => (
                <PanelButton
                  key={m.index}
                  variant={idx === safeMsgIdx ? "primary" : "default"}
                  onClick={() => setSelectedMsgIdx(idx)}
                >
                  #{idx} {m.pds?.parameterName ?? `P${m.pds?.parameterCode ?? "?"}`}
                </PanelButton>
              ))}
            </div>
          )}
          <PanelSvgStage
            svg={svg}
            onRevealLine={host.onRevealLine}
            emptyMessage={
              computed.error ?? "Load a WMO GRIB Edition 1 (.grib / .grb) descriptor to render the geographic heatmap."
            }
          />
        </div>
      )}

      {activeTab === "messages" && (
        <div style={{ flex: 1, overflow: "auto", padding: "10px 12px" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid var(--ms-border)", color: "var(--ms-text-2)" }}>
                <th style={{ padding: "5px 6px" }}>#</th>
                <th style={{ padding: "5px 6px" }}>Parameter</th>
                <th style={{ padding: "5px 6px" }}>Level</th>
                <th style={{ padding: "5px 6px" }}>Grid</th>
                <th style={{ padding: "5px 6px" }}>Bits/Val</th>
                <th style={{ padding: "5px 6px" }}>Date (UTC)</th>
              </tr>
            </thead>
            <tbody>
              {(computed.doc?.messages ?? []).map((m) => {
                const pMeta = m.pds ? lookupWmoParameterByCode(m.pds.parameterCode) : undefined;
                const lMeta = m.pds ? lookupWmoLevelType(m.pds.levelType) : undefined;
                const dt = m.pds
                  ? `${String(m.pds.year).padStart(4, "0")}-${String(m.pds.month).padStart(2, "0")}-${String(m.pds.day).padStart(2, "0")} ${String(m.pds.hour).padStart(2, "0")}:${String(m.pds.minute).padStart(2, "0")}`
                  : "—";
                return (
                  <tr
                    key={m.index}
                    onClick={() => {
                      setSelectedMsgIdx(m.index);
                      setActiveTab("map");
                    }}
                    style={{
                      borderBottom: "1px solid var(--ms-divider)",
                      fontFamily: "var(--ms-font-mono)",
                      cursor: "pointer",
                    }}
                  >
                    <td style={{ padding: "4px 6px" }}>{m.index}</td>
                    <td style={{ padding: "4px 6px", fontWeight: 600 }}>
                      {m.pds?.parameterName ?? pMeta?.mnemonic ?? m.pds?.parameterCode ?? "—"}
                    </td>
                    <td style={{ padding: "4px 6px" }}>
                      {m.pds ? `${m.pds.levelValue} ${lMeta?.mnemonic ?? m.pds.levelType}` : "—"}
                    </td>
                    <td style={{ padding: "4px 6px" }}>{m.gds ? `${m.gds.ni}×${m.gds.nj}` : "—"}</td>
                    <td style={{ padding: "4px 6px" }}>{m.bds?.bitsPerValue ?? "—"}</td>
                    <td style={{ padding: "4px 6px", color: "var(--ms-text-2)" }}>{dt}</td>
                  </tr>
                );
              })}
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
            <div style={{ color: "var(--ms-text-2)" }}>No GRIB Edition 1 lint diagnostics.</div>
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

      {activeTab === "export" && (
        <div style={{ flex: 1, overflow: "auto", padding: "10px 12px" }}>
          <pre
            style={{
              margin: 0,
              fontSize: "11px",
              fontFamily: "var(--ms-font-mono)",
              whiteSpace: "pre-wrap",
              color: "var(--ms-text-1)",
            }}
          >
            {cdlPreview || "No GRIB1 messages available for NetCDF CDL export."}
          </pre>
        </div>
      )}
    </PanelShell>
  );
};

export default GribPanel;
