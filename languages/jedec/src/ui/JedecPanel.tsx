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
import { renderJedecFuseMatrixSvg } from "../diagram/index.js";
import { lintJedec } from "../lints/index.js";
import { formatHex16 } from "../parser/checksum.js";
import { parseJedec } from "../parser/jedec-parser.js";
import { extractJedecEquations } from "../solver/boolean-extractor.js";
import { simulateJedecVectors } from "../solver/simulator.js";

type JedecTabId = "matrix" | "equations" | "vectors" | "lints";

export const JedecPanel: React.FC<LanguagePanelProps> = ({
  code,
  dialect,
  colorMode,
  mode,
  viewConfig,
  isFullScreen = false,
  host,
}) => {
  const [activeTab, setActiveTab] = useState<JedecTabId>("matrix");

  const computed = useMemo(() => {
    if (!code.trim()) {
      return {
        doc: null,
        extraction: null,
        simulation: null,
        lints: [] as ReturnType<typeof lintJedec>,
        error: undefined as string | undefined,
      };
    }
    try {
      const doc = parseJedec(code);
      const lints = lintJedec(doc);
      const extraction = extractJedecEquations(doc);
      const simulation = simulateJedecVectors(doc);
      return { doc, extraction, simulation, lints, error: undefined };
    } catch (err) {
      return {
        doc: null,
        extraction: null,
        simulation: null,
        lints: [],
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }, [code]);

  const title =
    (typeof viewConfig?.["title"] === "string" && viewConfig["title"]) ||
    (computed.doc ? `${computed.doc.deviceName} Fuse Map` : "JEDEC JESD3 PLD Viewer");

  const svg = useMemo(() => {
    if (!computed.doc) return "";
    try {
      return renderJedecFuseMatrixSvg(computed.doc, {
        theme: colorMode === "light" ? "light" : "dark",
      });
    } catch {
      return "";
    }
  }, [computed.doc, colorMode]);

  const kpis = useMemo<PanelKpiItem[]>(() => {
    const util = computed.extraction?.utilization;
    const sim = computed.simulation;
    const diagCount = computed.lints.length;
    const checksumHex = computed.doc ? `0x${formatHex16(computed.doc.computedFuseChecksum)}` : "—";
    return [
      { label: "Device", value: computed.doc?.deviceName ?? "—", tone: "info" },
      { label: "Fuses (Intact/Total)", value: util ? `${util.intactFuses}/${util.totalFuses}` : "—" },
      { label: "Checksum", value: checksumHex },
      {
        label: "Vectors",
        value: sim && sim.totalVectors > 0 ? `${sim.passedVectors}/${sim.totalVectors}` : "0",
        tone: sim && sim.failedVectors > 0 ? "danger" : "success",
      },
      { label: "Lints", value: diagCount, tone: diagCount > 0 ? "warning" : "success" },
    ];
  }, [computed.doc, computed.extraction, computed.simulation, computed.lints]);

  return (
    <PanelShell mode={mode} colorMode={colorMode} isFullScreen={isFullScreen}>
      <PanelToolbar
        title={title}
        subtitle="JEDEC JESD3 PAL/GAL Fuse-Matrix"
        badge={computed.error ? { label: "Parse Error", tone: "danger" } : { label: "JESD3", tone: "info" }}
        actions={
          <>
            {activeTab === "matrix" && host.exportFile && (
              <PanelButton
                onClick={() => host.exportFile?.("jedec-fuse-matrix.svg", svg, "image/svg+xml")}
                disabled={!svg}
              >
                Export SVG
              </PanelButton>
            )}
            {mode === "artifact" && host.openInMorsel && code && (
              <PanelButton variant="primary" onClick={() => host.openInMorsel?.(code, dialect || "jedec", title)}>
                Open in Morsel
              </PanelButton>
            )}
          </>
        }
      />

      <PanelKpiStrip items={kpis} />

      <PanelTabBar<JedecTabId>
        activeTab={activeTab}
        onSelect={setActiveTab}
        tabs={[
          { id: "matrix", label: "Fuse Matrix" },
          { id: "equations", label: "Boolean Equations", count: computed.extraction?.equations.length ?? 0 },
          { id: "vectors", label: "Test Vectors", count: computed.simulation?.totalVectors ?? 0 },
          { id: "lints", label: "Lints", count: computed.lints.length },
        ]}
      />

      {activeTab === "matrix" && (
        <PanelSvgStage
          svg={svg}
          onRevealLine={host.onRevealLine}
          emptyMessage={computed.error ?? "Load a JEDEC JESD3 (.jed / .jedec) fuse map to inspect the fuse matrix."}
        />
      )}

      {activeTab === "equations" && (
        <div style={{ flex: 1, overflow: "auto", padding: "10px 12px" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid var(--ms-border)", color: "var(--ms-text-2)" }}>
                <th style={{ padding: "5px 6px" }}>Pin</th>
                <th style={{ padding: "5px 6px" }}>Output</th>
                <th style={{ padding: "5px 6px" }}>Polarity</th>
                <th style={{ padding: "5px 6px" }}>OE</th>
                <th style={{ padding: "5px 6px" }}>SOP Equation</th>
              </tr>
            </thead>
            <tbody>
              {(computed.extraction?.equations ?? []).map((eq) => (
                <tr
                  key={eq.pin}
                  style={{ borderBottom: "1px solid var(--ms-divider)", fontFamily: "var(--ms-font-mono)" }}
                >
                  <td style={{ padding: "4px 6px" }}>{eq.pin}</td>
                  <td style={{ padding: "4px 6px", fontWeight: 600 }}>{eq.signalName}</td>
                  <td style={{ padding: "4px 6px" }}>{eq.activeLow ? "Active-Low" : "Active-High"}</td>
                  <td style={{ padding: "4px 6px" }}>{eq.oeTerm ? eq.oeTerm.expression : "1"}</td>
                  <td style={{ padding: "4px 6px" }}>{eq.equation}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === "vectors" && (
        <div style={{ flex: 1, overflow: "auto", padding: "10px 12px" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid var(--ms-border)", color: "var(--ms-text-2)" }}>
                <th style={{ padding: "5px 6px" }}>Vector</th>
                <th style={{ padding: "5px 6px" }}>Pin States</th>
                <th style={{ padding: "5px 6px" }}>Status</th>
                <th style={{ padding: "5px 6px" }}>Checked Outputs</th>
              </tr>
            </thead>
            <tbody>
              {(computed.simulation?.rows ?? []).map((row) => (
                <tr
                  key={row.vectorNumber}
                  style={{ borderBottom: "1px solid var(--ms-divider)", fontFamily: "var(--ms-font-mono)" }}
                >
                  <td style={{ padding: "4px 6px", fontWeight: 600 }}>V{String(row.vectorNumber).padStart(4, "0")}</td>
                  <td style={{ padding: "4px 6px" }}>{row.rawPins}</td>
                  <td style={{ padding: "4px 6px", color: row.passed ? "var(--ms-success)" : "var(--ms-danger)" }}>
                    {row.passed ? "PASS" : "FAIL"}
                  </td>
                  <td style={{ padding: "4px 6px" }}>
                    {row.checks.map((c) => `${c.signalName}:${c.actual}(exp ${c.expected})`).join(", ") || "—"}
                  </td>
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
              No JESD3 diagnostics reported.
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
                    onClick={() => host.onRevealLine?.(d.line)}
                    style={{
                      borderBottom: "1px solid var(--ms-divider)",
                      cursor: host.onRevealLine ? "pointer" : "default",
                    }}
                  >
                    <td style={{ padding: "4px 6px", fontFamily: "var(--ms-font-mono)", fontWeight: 600 }}>{d.code}</td>
                    <td style={{ padding: "4px 6px" }}>{d.severity}</td>
                    <td style={{ padding: "4px 6px", fontFamily: "var(--ms-font-mono)" }}>{d.line}</td>
                    <td style={{ padding: "4px 6px" }}>{d.message}</td>
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
