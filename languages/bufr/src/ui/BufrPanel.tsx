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
import { renderBufrSoundingSvg } from "../diagram/sounding-diagram.js";
import { lintBufr } from "../lints/index.js";
import { parseBufrText } from "../parser/text-parser.js";
import { bufrToCsv } from "../projections/bufrToCsv.js";
import { bufrToEpw } from "../projections/bufrToEpw.js";
import { expandBufrDescriptors } from "../solver/descriptor-tree.js";
import { solveBufrMeteorology } from "../solver/meteo-qa.js";

type BufrTabId = "sounding" | "descriptors" | "subsets" | "lints";

export const BufrPanel: React.FC<LanguagePanelProps> = ({
  code,
  dialect,
  colorMode,
  mode,
  viewConfig,
  isFullScreen = false,
  host,
}) => {
  const [activeTab, setActiveTab] = useState<BufrTabId>("sounding");

  const computed = useMemo(() => {
    if (!code.trim()) {
      return {
        message: null,
        lints: [] as ReturnType<typeof lintBufr>,
        expanded: [] as ReturnType<typeof expandBufrDescriptors>["elements"],
        solution: null as ReturnType<typeof solveBufrMeteorology> | null,
        error: undefined as string | undefined,
      };
    }
    try {
      const message = parseBufrText(code);
      const lints = lintBufr(message);
      const delayedCounts: number[] = [];
      if (message.subsets[0]) {
        for (const obs of message.subsets[0].values) {
          if ((obs.descriptor === "0-31-001" || obs.descriptor === "0-31-002") && typeof obs.value === "number") {
            delayedCounts.push(obs.value);
          }
        }
      }
      const expanded = expandBufrDescriptors(message.section3.descriptors, {
        customTableB: message.customTableB,
        customTableD: message.customTableD,
        delayedCounts,
      }).elements;
      const solution = solveBufrMeteorology(message);
      return { message, lints, expanded, solution, error: undefined };
    } catch (err) {
      return {
        message: null,
        lints: [],
        expanded: [],
        solution: null,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }, [code]);

  const title =
    (typeof viewConfig?.["title"] === "string" && viewConfig["title"]) ||
    computed.message?.name ||
    "WMO BUFR Meteorological Sounding";

  const svg = useMemo(() => {
    if (!computed.message) return "";
    try {
      return renderBufrSoundingSvg(computed.message);
    } catch {
      return "";
    }
  }, [computed.message]);

  const kpis = useMemo<PanelKpiItem[]>(() => {
    const edition = computed.message?.section0.edition ?? 4;
    const subsets = computed.message?.subsets.length ?? 0;
    const levels = computed.solution?.soundingLevels.length ?? 0;
    const diagCount = computed.lints.length;
    return [
      { label: "Edition", value: `BUFR ${edition}`, tone: "info" },
      { label: "Subsets", value: subsets },
      { label: "Sounding Levels", value: levels },
      { label: "Diagnostics", value: diagCount, tone: diagCount > 0 ? "warning" : "success" },
    ];
  }, [computed.message, computed.solution, computed.lints]);

  return (
    <PanelShell mode={mode} colorMode={colorMode} isFullScreen={isFullScreen}>
      <PanelToolbar
        title={title}
        subtitle="WMO FM 94 BUFR Meteorology"
        badge={computed.error ? { label: "Parse Error", tone: "danger" } : { label: "BUFR", tone: "info" }}
        actions={
          <>
            {activeTab === "sounding" && host.exportFile && (
              <PanelButton onClick={() => host.exportFile?.("bufr-sounding.svg", svg, "image/svg+xml")} disabled={!svg}>
                Export SVG
              </PanelButton>
            )}
            {host.exportFile && computed.message && (
              <PanelButton
                onClick={() => {
                  if (computed.message) {
                    host.exportFile?.("bufr-data.csv", bufrToCsv(computed.message), "text/csv");
                  }
                }}
              >
                Export CSV
              </PanelButton>
            )}
            {host.exportFile && computed.message && (
              <PanelButton
                onClick={() => {
                  if (computed.message) {
                    host.exportFile?.("bufr-weather.epw", bufrToEpw(computed.message), "text/plain");
                  }
                }}
              >
                Export EPW
              </PanelButton>
            )}
            {mode === "artifact" && host.openInMorsel && code && (
              <PanelButton variant="primary" onClick={() => host.openInMorsel?.(code, dialect || "bufr", title)}>
                Open in Morsel
              </PanelButton>
            )}
          </>
        }
      />

      <PanelKpiStrip items={kpis} />

      <PanelTabBar<BufrTabId>
        activeTab={activeTab}
        onSelect={setActiveTab}
        tabs={[
          { id: "sounding", label: "Sounding & Station" },
          { id: "descriptors", label: "Descriptors", count: computed.expanded.length },
          { id: "subsets", label: "Subsets", count: computed.message?.subsets.length ?? 0 },
          { id: "lints", label: "Lints", count: computed.lints.length },
        ]}
      />

      {activeTab === "sounding" && (
        <PanelSvgStage
          svg={svg}
          onRevealLine={host.onRevealLine}
          emptyMessage={computed.error ?? "Load a WMO BUFR (.bufr / .bfr) message to render the sounding profile."}
        />
      )}

      {activeTab === "descriptors" && (
        <div style={{ flex: 1, overflow: "auto", padding: "10px 12px" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid var(--ms-border)", color: "var(--ms-text-2)" }}>
                <th style={{ padding: "5px 6px" }}>F-X-Y</th>
                <th style={{ padding: "5px 6px" }}>Element Name</th>
                <th style={{ padding: "5px 6px" }}>Unit</th>
                <th style={{ padding: "5px 6px" }}>Scale</th>
                <th style={{ padding: "5px 6px" }}>Bits</th>
                <th style={{ padding: "5px 6px" }}>Sequence Path</th>
              </tr>
            </thead>
            <tbody>
              {computed.expanded.map((el, idx) => (
                <tr key={`${el.descriptor.code}-${idx}`} style={{ borderBottom: "1px solid var(--ms-border)" }}>
                  <td style={{ padding: "5px 6px", fontFamily: "monospace" }}>{el.descriptor.code}</td>
                  <td style={{ padding: "5px 6px" }}>{el.tableB?.name ?? "Unknown"}</td>
                  <td style={{ padding: "5px 6px", color: "var(--ms-text-2)" }}>{el.tableB?.unit ?? "-"}</td>
                  <td style={{ padding: "5px 6px", fontFamily: "monospace" }}>{el.effectiveScale}</td>
                  <td style={{ padding: "5px 6px", fontFamily: "monospace" }}>{el.effectiveBitWidth}</td>
                  <td style={{ padding: "5px 6px", fontFamily: "monospace", color: "var(--ms-text-2)" }}>
                    {el.sequencePath.join(" > ") || "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === "subsets" && (
        <div style={{ flex: 1, overflow: "auto", padding: "10px 12px" }}>
          {(computed.message?.subsets ?? []).map((subset) => (
            <div key={subset.index} style={{ marginBottom: "14px" }}>
              <div style={{ fontWeight: 600, fontSize: "12px", marginBottom: "6px" }}>
                Subset {subset.index} ({subset.values.length} values)
              </div>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px" }}>
                <thead>
                  <tr
                    style={{ textAlign: "left", borderBottom: "1px solid var(--ms-border)", color: "var(--ms-text-2)" }}
                  >
                    <th style={{ padding: "4px 6px" }}>Descriptor</th>
                    <th style={{ padding: "4px 6px" }}>Name</th>
                    <th style={{ padding: "4px 6px" }}>Value</th>
                    <th style={{ padding: "4px 6px" }}>Unit</th>
                  </tr>
                </thead>
                <tbody>
                  {subset.values.map((obs, idx) => (
                    <tr
                      key={`${obs.descriptor}-${idx}`}
                      style={{ borderBottom: "1px solid var(--ms-border)", cursor: obs.line ? "pointer" : "default" }}
                      onClick={() => obs.line && host.onRevealLine?.(obs.line)}
                    >
                      <td style={{ padding: "4px 6px", fontFamily: "monospace" }}>{obs.descriptor}</td>
                      <td style={{ padding: "4px 6px" }}>{obs.name ?? "-"}</td>
                      <td style={{ padding: "4px 6px", fontFamily: "monospace" }}>
                        {obs.value === null ? "MISSING" : String(obs.value)}
                      </td>
                      <td style={{ padding: "4px 6px", color: "var(--ms-text-2)" }}>{obs.unit ?? "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}

      {activeTab === "lints" && (
        <div style={{ flex: 1, overflow: "auto", padding: "10px 12px" }}>
          {computed.lints.length === 0 ? (
            <div style={{ fontSize: "12px", color: "var(--ms-text-2)" }}>
              No BUFR structural or meteorological QA diagnostics.
            </div>
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
                    style={{ borderBottom: "1px solid var(--ms-border)", cursor: "pointer" }}
                    onClick={() => host.onRevealLine?.(d.line)}
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

export default BufrPanel;
