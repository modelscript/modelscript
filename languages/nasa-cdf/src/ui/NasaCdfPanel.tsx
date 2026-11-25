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
import { renderNasaCdfStripChartSvg } from "../diagram/strip-chart.js";
import { lintNasaCdf } from "../lints/index.js";
import { parseCdfSkeleton } from "../parser/skt-parser.js";
import { analyzeNasaCdfTelemetry } from "../solver/statistics.js";

type NasaCdfTabId = "chart" | "variables" | "attributes" | "lints";

export const NasaCdfPanel: React.FC<LanguagePanelProps> = ({
  code,
  dialect,
  colorMode,
  mode,
  viewConfig,
  isFullScreen = false,
  host,
}) => {
  const [activeTab, setActiveTab] = useState<NasaCdfTabId>("chart");
  const [selectedChannel, setSelectedChannel] = useState<string>("ALL");

  const computed = useMemo(() => {
    if (!code.trim()) {
      return {
        doc: null,
        summary: null,
        lints: [] as ReturnType<typeof lintNasaCdf>,
        error: undefined as string | undefined,
      };
    }
    try {
      const doc = parseCdfSkeleton(code);
      const lints = lintNasaCdf(doc);
      const summary = analyzeNasaCdfTelemetry(doc);
      return { doc, summary, lints, error: undefined };
    } catch (err) {
      return {
        doc: null,
        summary: null,
        lints: [],
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }, [code]);

  const title =
    (typeof viewConfig?.["title"] === "string" && viewConfig["title"]) ||
    computed.doc?.header.fileName ||
    "NASA CDF Telemetry";

  const channelNames = useMemo(() => {
    const names = (computed.summary?.channels ?? []).map((c) => c.name);
    if (computed.summary?.magneticField) {
      names.push(computed.summary.magneticField.stats.name);
    }
    return names;
  }, [computed.summary]);

  const svg = useMemo(() => {
    if (!computed.doc) return "";
    try {
      return renderNasaCdfStripChartSvg(computed.doc, {
        title,
        channels: selectedChannel === "ALL" ? undefined : [selectedChannel],
      });
    } catch {
      return "";
    }
  }, [computed.doc, title, selectedChannel]);

  const kpis = useMemo<PanelKpiItem[]>(() => {
    const varCount = computed.doc?.variables.length ?? 0;
    const recCount = computed.summary?.recordCount ?? 0;
    const diagCount = computed.lints.length;
    const bMagMean = computed.summary?.magneticField?.stats.mean;
    const items: PanelKpiItem[] = [
      { label: "Variables", value: varCount, tone: "info" },
      { label: "Records", value: recCount },
      { label: "Diagnostics", value: diagCount, tone: diagCount > 0 ? "warning" : "success" },
    ];
    if (bMagMean !== undefined && Number.isFinite(bMagMean)) {
      items.push({
        label: "|B| Mean",
        value: `${bMagMean.toFixed(2)} ${computed.summary?.magneticField?.stats.units || "nT"}`,
        tone: "info",
      });
    }
    return items;
  }, [computed.doc, computed.summary, computed.lints]);

  return (
    <PanelShell mode={mode} colorMode={colorMode} isFullScreen={isFullScreen}>
      <PanelToolbar
        title={title}
        subtitle="NASA Common Data Format (ISTP/SPDF)"
        badge={
          computed.error
            ? { label: "Parse Error", tone: "danger" }
            : { label: `CDF ${computed.doc?.formatVersion ?? "v3"}`, tone: "info" }
        }
        actions={
          <>
            {activeTab === "chart" && channelNames.length > 1 && (
              <select
                aria-label="Filter telemetry channel"
                value={selectedChannel}
                onChange={(e) => setSelectedChannel(e.target.value)}
                style={{
                  fontSize: "11px",
                  padding: "3px 6px",
                  borderRadius: "4px",
                  border: "1px solid var(--ms-border)",
                  background: "var(--ms-bg-alt)",
                  color: "var(--ms-text-1)",
                }}
              >
                <option value="ALL">All Channels ({channelNames.length})</option>
                {channelNames.map((ch) => (
                  <option key={ch} value={ch}>
                    {ch}
                  </option>
                ))}
              </select>
            )}
            {activeTab === "chart" && host.exportFile && (
              <PanelButton
                onClick={() => host.exportFile?.("nasa-cdf-strip-chart.svg", svg, "image/svg+xml")}
                disabled={!svg}
              >
                Export SVG
              </PanelButton>
            )}
            {mode === "artifact" && host.openInAnsatzEditor && code && (
              <PanelButton
                variant="primary"
                onClick={() => host.openInAnsatzEditor?.(code, dialect || "nasa-cdf", title)}
              >
                Open in Ansatz Editor
              </PanelButton>
            )}
          </>
        }
      />

      <PanelKpiStrip items={kpis} />

      <PanelTabBar<NasaCdfTabId>
        activeTab={activeTab}
        onSelect={setActiveTab}
        tabs={[
          { id: "chart", label: "Strip Chart" },
          { id: "variables", label: "Variables", count: computed.doc?.variables.length ?? 0 },
          { id: "attributes", label: "Attributes", count: computed.doc?.globalAttributes.length ?? 0 },
          { id: "lints", label: "Lints", count: computed.lints.length },
        ]}
      />

      {activeTab === "chart" && (
        <PanelSvgStage
          svg={svg}
          onRevealLine={host.onRevealLine}
          emptyMessage={computed.error ?? "Load a NASA CDF Skeleton Table (.skt) to render the telemetry strip chart."}
        />
      )}

      {activeTab === "variables" && (
        <div style={{ flex: 1, overflow: "auto", padding: "10px 12px" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid var(--ms-border)", color: "var(--ms-text-2)" }}>
                <th style={{ padding: "5px 6px" }}>Variable</th>
                <th style={{ padding: "5px 6px" }}>CDF Type</th>
                <th style={{ padding: "5px 6px" }}>Dims</th>
                <th style={{ padding: "5px 6px" }}>Units</th>
                <th style={{ padding: "5px 6px" }}>Records</th>
              </tr>
            </thead>
            <tbody>
              {(computed.doc?.variables ?? []).map((v, idx) => (
                <tr
                  key={`${v.name}-${idx}`}
                  onClick={() => host.onRevealLine?.(v.line)}
                  style={{
                    borderBottom: "1px solid var(--ms-divider)",
                    fontFamily: "var(--ms-font-mono)",
                    cursor: host.onRevealLine ? "pointer" : "default",
                  }}
                >
                  <td style={{ padding: "4px 6px", fontWeight: 600 }}>{v.name}</td>
                  <td style={{ padding: "4px 6px" }}>{v.dataType}</td>
                  <td style={{ padding: "4px 6px" }}>{`${v.numDims}:[${v.dimSizes.join(",")}]`}</td>
                  <td style={{ padding: "4px 6px", color: "var(--ms-text-2)" }}>
                    {String(v.attributes["UNITS"]?.values[0] ?? "—")}
                  </td>
                  <td style={{ padding: "4px 6px" }}>{v.values.length}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === "attributes" && (
        <div style={{ flex: 1, overflow: "auto", padding: "10px 12px" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid var(--ms-border)", color: "var(--ms-text-2)" }}>
                <th style={{ padding: "5px 6px" }}>Global Attribute</th>
                <th style={{ padding: "5px 6px" }}>Type</th>
                <th style={{ padding: "5px 6px" }}>Value</th>
              </tr>
            </thead>
            <tbody>
              {(computed.doc?.globalAttributes ?? []).map((attr, idx) => (
                <tr
                  key={`${attr.name}-${idx}`}
                  onClick={() => host.onRevealLine?.(attr.line)}
                  style={{
                    borderBottom: "1px solid var(--ms-divider)",
                    fontFamily: "var(--ms-font-mono)",
                    cursor: host.onRevealLine ? "pointer" : "default",
                  }}
                >
                  <td style={{ padding: "4px 6px", fontWeight: 600 }}>{attr.name}</td>
                  <td style={{ padding: "4px 6px" }}>{attr.entries[0]?.dataType ?? "—"}</td>
                  <td style={{ padding: "4px 6px", color: "var(--ms-text-2)" }}>
                    {attr.entries.map((e) => e.values.join(", ")).join(" ; ") || "—"}
                  </td>
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
            <div style={{ color: "var(--ms-text-2)" }}>No NASA CDF / ISTP lint diagnostics.</div>
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

export default NasaCdfPanel;
