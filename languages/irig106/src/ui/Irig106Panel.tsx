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
import { renderIrig106CommutatorSvg } from "../diagram/index.js";
import { lintIrig106 } from "../lints/index.js";
import { parseIrig106 } from "../parser/tmats-parser.js";
import { irig106ToCsv, irig106ToXtce } from "../projections/index.js";
import { buildCommutatorGrid, evaluateConversion } from "../solver/index.js";

type Irig106TabId = "commutator" | "measurements" | "conversions" | "lints";

export const Irig106Panel: React.FC<LanguagePanelProps> = ({
  code,
  dialect,
  colorMode,
  mode,
  viewConfig,
  isFullScreen = false,
  host,
}) => {
  const [activeTab, setActiveTab] = useState<Irig106TabId>("commutator");
  const [rawTestCount, setRawTestCount] = useState<number>(2048);

  const computed = useMemo(() => {
    if (!code.trim()) {
      return {
        model: null,
        grid: null,
        lints: [] as ReturnType<typeof lintIrig106>,
        error: undefined as string | undefined,
      };
    }
    try {
      const model = parseIrig106(code);
      const grid = buildCommutatorGrid(model);
      const lints = lintIrig106(model);
      return { model, grid, lints, error: undefined };
    } catch (err) {
      return { model: null, grid: null, lints: [], error: err instanceof Error ? err.message : String(err) };
    }
  }, [code]);

  const title =
    (typeof viewConfig?.["title"] === "string" && viewConfig["title"]) ||
    computed.model?.name ||
    "IRIG 106 TMATS Telemetry";

  const svg = useMemo(() => {
    if (!computed.grid) return "";
    try {
      return renderIrig106CommutatorSvg(computed.grid);
    } catch {
      return "";
    }
  }, [computed.grid]);

  const kpis = useMemo<PanelKpiItem[]>(() => {
    const bitRate = computed.grid?.bitRateBps ?? 0;
    const bitRateLabel = bitRate >= 1e6 ? `${(bitRate / 1e6).toFixed(2)} Mbps` : `${(bitRate / 1e3).toFixed(1)} kbps`;
    const mfRate = computed.grid?.minorFrameRateHz ?? 0;
    const measCount = computed.grid?.schedules.length ?? 0;
    const util = computed.grid?.utilizationPercent ?? 0;
    const diagCount = computed.lints.length;
    return [
      { label: "Bit Rate", value: bitRateLabel, tone: "info" },
      { label: "Minor Frame", value: `${mfRate.toFixed(1)} Hz` },
      { label: "Channels", value: measCount },
      { label: "Utilization", value: `${util.toFixed(1)}%` },
      { label: "Diagnostics", value: diagCount, tone: diagCount > 0 ? "warning" : "success" },
    ];
  }, [computed.grid, computed.lints]);

  return (
    <PanelShell mode={mode} colorMode={colorMode} isFullScreen={isFullScreen}>
      <PanelToolbar
        title={title}
        subtitle="IRIG 106 Chapter 9 TMATS"
        badge={computed.error ? { label: "Parse Error", tone: "danger" } : { label: "TMATS", tone: "info" }}
        actions={
          <>
            {activeTab === "commutator" && host.exportFile && (
              <PanelButton
                onClick={() => host.exportFile?.("irig106-commutator.svg", svg, "image/svg+xml")}
                disabled={!svg}
              >
                Export SVG
              </PanelButton>
            )}
            {computed.model && host.exportFile && (
              <PanelButton
                onClick={() =>
                  host.exportFile?.("irig106-telemetry.xtce.xml", irig106ToXtce(computed.model!), "application/xml")
                }
              >
                Export XTCE
              </PanelButton>
            )}
            {computed.model && host.exportFile && (
              <PanelButton
                onClick={() => host.exportFile?.("irig106-schedule.csv", irig106ToCsv(computed.model!), "text/csv")}
              >
                Export CSV
              </PanelButton>
            )}
            {mode === "artifact" && host.openInMorsel && code && (
              <PanelButton variant="primary" onClick={() => host.openInMorsel?.(code, dialect || "irig106", title)}>
                Open in Morsel
              </PanelButton>
            )}
          </>
        }
      />

      <PanelKpiStrip items={kpis} />

      <PanelTabBar<Irig106TabId>
        activeTab={activeTab}
        onSelect={setActiveTab}
        tabs={[
          { id: "commutator", label: "PCM Commutator" },
          { id: "measurements", label: "Measurements", count: computed.grid?.schedules.length ?? 0 },
          { id: "conversions", label: "Conversions", count: computed.model?.conversions.size ?? 0 },
          { id: "lints", label: "Lints", count: computed.lints.length },
        ]}
      />

      {activeTab === "commutator" && (
        <PanelSvgStage
          svg={svg}
          onRevealLine={host.onRevealLine}
          emptyMessage={
            computed.error ?? "Load an IRIG 106 Chapter 9 TMATS (.tmats / .tmt) file to inspect the PCM commutator."
          }
        />
      )}

      {activeTab === "measurements" && (
        <div style={{ flex: 1, overflow: "auto", padding: "10px 12px" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid var(--ms-border)", color: "var(--ms-text-2)" }}>
                <th style={{ padding: "5px 6px" }}>Channel</th>
                <th style={{ padding: "5px 6px" }}>Words</th>
                <th style={{ padding: "5px 6px" }}>Frames</th>
                <th style={{ padding: "5px 6px" }}>Mode</th>
                <th style={{ padding: "5px 6px" }}>Sample Rate</th>
                <th style={{ padding: "5px 6px" }}>Nyquist BW</th>
                <th style={{ padding: "5px 6px" }}>Units</th>
              </tr>
            </thead>
            <tbody>
              {(computed.grid?.schedules ?? []).map((s, idx) => (
                <tr
                  key={`${s.name}-${idx}`}
                  onClick={() => host.onRevealLine?.(s.line)}
                  style={{
                    borderBottom: "1px solid var(--ms-divider)",
                    fontFamily: "var(--ms-font-mono)",
                    cursor: host.onRevealLine ? "pointer" : "default",
                  }}
                >
                  <td style={{ padding: "4px 6px", fontWeight: 600 }}>{s.name}</td>
                  <td style={{ padding: "4px 6px" }}>{s.wordPositions.join(", ") || "—"}</td>
                  <td style={{ padding: "4px 6px" }}>{s.framePositions.join(", ") || "—"}</td>
                  <td style={{ padding: "4px 6px", color: "var(--ms-text-2)" }}>{s.commutationType}</td>
                  <td style={{ padding: "4px 6px" }}>{s.sampleRateHz.toFixed(2)} Hz</td>
                  <td style={{ padding: "4px 6px" }}>{s.nyquistBandwidthHz.toFixed(2)} Hz</td>
                  <td style={{ padding: "4px 6px", color: "var(--ms-text-2)" }}>{s.engineeringUnits ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === "conversions" && (
        <div style={{ flex: 1, overflow: "auto", padding: "10px 12px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "10px", fontSize: "11px" }}>
            <label htmlFor="irig106-raw-input" style={{ color: "var(--ms-text-2)" }}>
              Test Raw Counts (x):
            </label>
            <input
              id="irig106-raw-input"
              type="number"
              value={rawTestCount}
              onChange={(e) => setRawTestCount(Number(e.target.value) || 0)}
              style={{
                width: "100px",
                padding: "3px 6px",
                fontFamily: "var(--ms-font-mono)",
                fontSize: "11px",
                background: "var(--ms-bg-alt)",
                color: "var(--ms-text)",
                border: "1px solid var(--ms-border)",
                borderRadius: "4px",
              }}
            />
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid var(--ms-border)", color: "var(--ms-text-2)" }}>
                <th style={{ padding: "5px 6px" }}>DCN</th>
                <th style={{ padding: "5px 6px" }}>Type</th>
                <th style={{ padding: "5px 6px" }}>Coefficients / Rule</th>
                <th style={{ padding: "5px 6px" }}>EU @ x={rawTestCount}</th>
                <th style={{ padding: "5px 6px" }}>Units</th>
              </tr>
            </thead>
            <tbody>
              {Array.from(computed.model?.conversions.values() ?? []).map((c, idx) => {
                const euVal = evaluateConversion(c, rawTestCount);
                return (
                  <tr
                    key={`${c.measurementName}-${idx}`}
                    onClick={() => host.onRevealLine?.(c.line)}
                    style={{
                      borderBottom: "1px solid var(--ms-divider)",
                      fontFamily: "var(--ms-font-mono)",
                      cursor: host.onRevealLine ? "pointer" : "default",
                    }}
                  >
                    <td style={{ padding: "4px 6px", fontWeight: 600 }}>{c.measurementName}</td>
                    <td style={{ padding: "4px 6px" }}>{c.conversionType}</td>
                    <td style={{ padding: "4px 6px", color: "var(--ms-text-2)" }}>
                      {c.coefficients.length > 0 ? `[${c.coefficients.join(", ")}]` : (c.derivedFormula ?? "—")}
                    </td>
                    <td style={{ padding: "4px 6px", fontWeight: 600 }}>{euVal.toFixed(4)}</td>
                    <td style={{ padding: "4px 6px", color: "var(--ms-text-2)" }}>{c.engineeringUnits ?? "—"}</td>
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
            <div style={{ color: "var(--ms-text-2)" }}>No IRIG 106 TMATS diagnostics.</div>
          ) : (
            computed.lints.map((d, idx) => (
              <div
                key={`${d.code}-${idx}`}
                onClick={() => host.onRevealLine?.(d.line)}
                style={{
                  padding: "7px 10px",
                  borderRadius: "6px",
                  background: "var(--ms-bg-alt)",
                  border: "1px solid var(--ms-border)",
                  cursor: host.onRevealLine ? "pointer" : "default",
                }}
              >
                <span style={{ fontWeight: 600, fontFamily: "var(--ms-font-mono)", marginRight: "6px" }}>
                  [{d.code}] (L{d.line})
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

export default Irig106Panel;
