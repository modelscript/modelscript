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
import { matchIrFunctionalGroup } from "../catalog/jcamp-dx-std-schemas.js";
import { renderJcampDxSpectrumSvg, type SpectrumYDisplayMode } from "../diagram/spectrum-svg.js";
import { lintJcampDx } from "../lints/index.js";
import { parseJcampDx } from "../parser/jcamp-parser.js";
import { jcampDxToCsv } from "../projections/index.js";
import { findSpectralPeaks } from "../solver/spectroscopy.js";

type JcampTabId = "spectrum" | "peaks" | "metadata" | "lints";

export const JcampDxPanel: React.FC<LanguagePanelProps> = ({
  code,
  dialect,
  colorMode,
  mode,
  viewConfig,
  isFullScreen = false,
  host,
}) => {
  const [activeTab, setActiveTab] = useState<JcampTabId>("spectrum");
  const [yMode, setYMode] = useState<SpectrumYDisplayMode>("native");
  const [showPeaks, setShowPeaks] = useState<boolean>(true);

  const computed = useMemo(() => {
    if (!code.trim()) {
      return {
        block: null,
        lints: [] as ReturnType<typeof lintJcampDx>,
        peaks: [] as ReturnType<typeof findSpectralPeaks>,
        error: undefined as string | undefined,
      };
    }
    try {
      const doc = parseJcampDx(code);
      const block = doc.primary;
      const lints = lintJcampDx(doc);
      const pts = block ? (block.points.length > 0 ? block.points : block.peakTable) : [];
      const isTrans = (block?.yUnits ?? "").toUpperCase().includes("TRANS");
      const peaks =
        pts.length >= 3
          ? findSpectralPeaks(pts, {
              mode: isTrans ? "minima" : "maxima",
              minProminence: 0.02,
            })
          : [];
      return { block, lints, peaks, error: undefined };
    } catch (err) {
      return {
        block: null,
        lints: [],
        peaks: [],
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }, [code]);

  const title =
    (typeof viewConfig?.["title"] === "string" && viewConfig["title"]) || computed.block?.title || "JCAMP-DX Spectrum";

  const svg = useMemo(() => {
    if (!computed.block) return "";
    try {
      return renderJcampDxSpectrumSvg(computed.block, {
        yMode,
        showPeaks,
        colorMode: colorMode === "light" ? "light" : "dark",
      });
    } catch {
      return "";
    }
  }, [computed.block, yMode, showPeaks, colorMode]);

  const pointCount =
    (computed.block?.points.length ?? 0) > 0
      ? (computed.block?.points.length ?? 0)
      : (computed.block?.peakTable.length ?? 0);

  const kpis = useMemo<PanelKpiItem[]>(() => {
    const diagCount = computed.lints.length;
    return [
      { label: "Data Type", value: computed.block?.dataType || "—", tone: "info" },
      { label: "Points", value: pointCount },
      { label: "Peaks", value: computed.peaks.length },
      { label: "Diagnostics", value: diagCount, tone: diagCount > 0 ? "warning" : "success" },
    ];
  }, [computed.block, pointCount, computed.peaks.length, computed.lints.length]);

  const isIr =
    (computed.block?.dataType ?? "").toUpperCase().includes("INFRARED") ||
    (computed.block?.xUnits ?? "").toUpperCase().includes("1/CM");

  const nextYMode = (): void => {
    setYMode((prev) => (prev === "native" ? "absorbance" : prev === "absorbance" ? "transmittance" : "native"));
  };

  return (
    <PanelShell mode={mode} colorMode={colorMode} isFullScreen={isFullScreen}>
      <PanelToolbar
        title={title}
        subtitle={`JCAMP-DX ${computed.block?.jcampDxVersion || "4.24"} Spectroscopy`}
        badge={computed.error ? { label: "Parse Error", tone: "danger" } : { label: "JCAMP-DX", tone: "info" }}
        actions={
          <>
            {activeTab === "spectrum" && (
              <>
                <PanelButton onClick={nextYMode}>
                  Y: {yMode === "native" ? "Native" : yMode === "absorbance" ? "Absorbance" : "Transmittance"}
                </PanelButton>
                <PanelButton onClick={() => setShowPeaks((p) => !p)}>
                  {showPeaks ? "Hide Peaks" : "Show Peaks"}
                </PanelButton>
              </>
            )}
            {host.exportFile && computed.block && (
              <>
                <PanelButton onClick={() => host.exportFile?.("spectrum.svg", svg, "image/svg+xml")} disabled={!svg}>
                  Export SVG
                </PanelButton>
                <PanelButton
                  onClick={() => host.exportFile?.("spectrum.csv", jcampDxToCsv(computed.block!), "text/csv")}
                >
                  Export CSV
                </PanelButton>
              </>
            )}
            {mode === "artifact" && host.openInAnsatzEditor && code && (
              <PanelButton
                variant="primary"
                onClick={() => host.openInAnsatzEditor?.(code, dialect || "jcamp-dx", title)}
              >
                Open in Ansatz Editor
              </PanelButton>
            )}
          </>
        }
      />

      <PanelKpiStrip items={kpis} />

      <PanelTabBar<JcampTabId>
        activeTab={activeTab}
        onSelect={setActiveTab}
        tabs={[
          { id: "spectrum", label: "Spectrum" },
          { id: "peaks", label: "Peaks", count: computed.peaks.length },
          { id: "metadata", label: "Metadata", count: computed.block?.ldrs.length ?? 0 },
          { id: "lints", label: "Lints", count: computed.lints.length },
        ]}
      />

      {activeTab === "spectrum" && (
        <PanelSvgStage
          svg={svg}
          onRevealLine={host.onRevealLine}
          emptyMessage={computed.error ?? "Load a JCAMP-DX (.jdx / .dx / .jcamp) spectrum to render."}
        />
      )}

      {activeTab === "peaks" && (
        <div style={{ flex: 1, overflow: "auto", padding: "10px 12px" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid var(--ms-border)", color: "var(--ms-text-2)" }}>
                <th style={{ padding: "5px 6px" }}>X ({computed.block?.xUnits || "units"})</th>
                <th style={{ padding: "5px 6px" }}>Y ({computed.block?.yUnits || "intensity"})</th>
                <th style={{ padding: "5px 6px" }}>Prominence</th>
                {isIr && <th style={{ padding: "5px 6px" }}>IR Assignment</th>}
              </tr>
            </thead>
            <tbody>
              {computed.peaks.map((pk, idx) => {
                const fg = isIr ? matchIrFunctionalGroup(pk.x) : undefined;
                return (
                  <tr key={idx} style={{ borderBottom: "1px solid var(--ms-border-subtle)" }}>
                    <td style={{ padding: "5px 6px", fontFamily: "monospace" }}>{pk.x.toFixed(2)}</td>
                    <td style={{ padding: "5px 6px", fontFamily: "monospace" }}>{pk.y.toFixed(4)}</td>
                    <td style={{ padding: "5px 6px", fontFamily: "monospace" }}>{pk.prominence.toFixed(4)}</td>
                    {isIr && <td style={{ padding: "5px 6px" }}>{fg ? `${fg.bond} (${fg.group})` : "—"}</td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === "metadata" && (
        <div style={{ flex: 1, overflow: "auto", padding: "10px 12px" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid var(--ms-border)", color: "var(--ms-text-2)" }}>
                <th style={{ padding: "5px 6px" }}>LDR Label</th>
                <th style={{ padding: "5px 6px" }}>Value</th>
                <th style={{ padding: "5px 6px" }}>Line</th>
              </tr>
            </thead>
            <tbody>
              {(computed.block?.ldrs ?? [])
                .filter((l) => l.label !== "XYDATA" && l.label !== "PEAK TABLE")
                .map((ldr, idx) => (
                  <tr
                    key={idx}
                    style={{
                      borderBottom: "1px solid var(--ms-border-subtle)",
                      cursor: host.onRevealLine ? "pointer" : "default",
                    }}
                    onClick={() => host.onRevealLine?.(ldr.line)}
                  >
                    <td style={{ padding: "5px 6px", fontFamily: "monospace", fontWeight: 600 }}>##{ldr.label}=</td>
                    <td style={{ padding: "5px 6px" }}>{ldr.value.slice(0, 120)}</td>
                    <td style={{ padding: "5px 6px", fontFamily: "monospace" }}>{ldr.line}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === "lints" && (
        <div style={{ flex: 1, overflow: "auto", padding: "10px 12px" }}>
          {computed.lints.length === 0 ? (
            <div style={{ fontSize: "12px", color: "var(--ms-text-2)", padding: "12px 4px" }}>
              No diagnostics — spectrum conforms to JCAMP-DX rules.
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
                    key={idx}
                    style={{
                      borderBottom: "1px solid var(--ms-border-subtle)",
                      cursor: host.onRevealLine ? "pointer" : "default",
                    }}
                    onClick={() => host.onRevealLine?.(d.line)}
                  >
                    <td style={{ padding: "5px 6px", fontFamily: "monospace", fontWeight: 600 }}>{d.code}</td>
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

export default JcampDxPanel;
