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
import { ENDF6_MT_DESCRIPTORS } from "../catalog/endf6-std-schemas.js";
import { renderEndf6CrossSectionSvg } from "../diagram/cross-section-svg.js";
import { lintEndf6Tape } from "../lints/index.js";
import { parseEndf6Tape } from "../parser/tape-parser.js";
import { DEFAULT_TWO_GROUP_BOUNDS, collapseMaterialMultigroup } from "../solver/multigroup.js";

type Endf6TabId = "plot" | "sections" | "multigroup" | "lints";

export const Endf6Panel: React.FC<LanguagePanelProps> = ({
  code,
  dialect,
  colorMode,
  mode,
  viewConfig,
  isFullScreen = false,
  host,
}) => {
  const [activeTab, setActiveTab] = useState<Endf6TabId>("plot");
  const [showResonances, setShowResonances] = useState<boolean>(true);

  const computed = useMemo(() => {
    if (!code.trim()) {
      return { tape: null, lints: [] as ReturnType<typeof lintEndf6Tape>, error: undefined as string | undefined };
    }
    try {
      const tape = parseEndf6Tape(code);
      const lints = lintEndf6Tape(tape);
      return { tape, lints, error: undefined };
    } catch (err) {
      return { tape: null, lints: [], error: err instanceof Error ? err.message : String(err) };
    }
  }, [code]);

  const firstMaterial = useMemo(() => {
    if (!computed.tape) return undefined;
    return computed.tape.materials.values().next().value;
  }, [computed.tape]);

  const title =
    (typeof viewConfig?.["title"] === "string" && viewConfig["title"]) ||
    (firstMaterial ? `${firstMaterial.name} (MAT=${firstMaterial.mat})` : undefined) ||
    computed.tape?.tpid ||
    "ENDF-6 Nuclear Data Viewer";

  const svg = useMemo(() => {
    if (!computed.tape) return "";
    try {
      return renderEndf6CrossSectionSvg(computed.tape, {
        colorMode: colorMode === "light" ? "light" : "dark",
        showResonances,
      });
    } catch {
      return "";
    }
  }, [computed.tape, colorMode, showResonances]);

  const multigroup = useMemo(() => {
    if (!firstMaterial) return null;
    return collapseMaterialMultigroup(firstMaterial, DEFAULT_TWO_GROUP_BOUNDS);
  }, [firstMaterial]);

  const totalMtCount = useMemo(() => {
    if (!computed.tape) return 0;
    let count = 0;
    for (const m of computed.tape.materials.values()) {
      count += m.crossSections.size;
    }
    return count;
  }, [computed.tape]);

  const kpis = useMemo<PanelKpiItem[]>(() => {
    const matCount = computed.tape?.materials.size ?? 0;
    const diagCount = computed.lints.length;
    return [
      { label: "Materials", value: matCount, tone: "info" },
      { label: "MF=3 Reactions", value: totalMtCount },
      { label: "Diagnostics", value: diagCount, tone: diagCount > 0 ? "warning" : "success" },
    ];
  }, [computed.tape, totalMtCount, computed.lints]);

  return (
    <PanelShell mode={mode} colorMode={colorMode} isFullScreen={isFullScreen}>
      <PanelToolbar
        title={title}
        subtitle="ENDF-6 Evaluated Nuclear Data"
        badge={computed.error ? { label: "Parse Error", tone: "danger" } : { label: "ENDF-6", tone: "info" }}
        actions={
          <>
            {activeTab === "plot" && (
              <PanelButton onClick={() => setShowResonances((v) => !v)}>
                {showResonances ? "Hide SLBW" : "Show SLBW"}
              </PanelButton>
            )}
            {activeTab === "plot" && host.exportFile && (
              <PanelButton
                onClick={() => host.exportFile?.("endf6-cross-sections.svg", svg, "image/svg+xml")}
                disabled={!svg}
              >
                Export SVG
              </PanelButton>
            )}
            {mode === "artifact" && host.openInAnsatzEditor && code && (
              <PanelButton variant="primary" onClick={() => host.openInAnsatzEditor?.(code, dialect || "endf6", title)}>
                Open in Ansatz Editor
              </PanelButton>
            )}
          </>
        }
      />

      <PanelKpiStrip items={kpis} />

      <PanelTabBar<Endf6TabId>
        activeTab={activeTab}
        onSelect={setActiveTab}
        tabs={[
          { id: "plot", label: "Cross-Sections σ(E)" },
          { id: "sections", label: "MF/MT Sections", count: totalMtCount },
          { id: "multigroup", label: "Multigroup Collapse", count: multigroup?.groups.length ?? 0 },
          { id: "lints", label: "Lints", count: computed.lints.length },
        ]}
      />

      {activeTab === "plot" && (
        <PanelSvgStage
          svg={svg}
          onRevealLine={host.onRevealLine}
          emptyMessage={
            computed.error ?? "Load an ENDF-6 (.endf / .endf6) tape to render the log-log cross-section plot."
          }
        />
      )}

      {activeTab === "sections" && (
        <div style={{ flex: 1, overflow: "auto", padding: "10px 12px" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid var(--ms-border)", color: "var(--ms-text-2)" }}>
                <th style={{ padding: "5px 6px" }}>MAT</th>
                <th style={{ padding: "5px 6px" }}>Nuclide</th>
                <th style={{ padding: "5px 6px" }}>MF</th>
                <th style={{ padding: "5px 6px" }}>MT</th>
                <th style={{ padding: "5px 6px" }}>Reaction</th>
                <th style={{ padding: "5px 6px" }}>Points</th>
              </tr>
            </thead>
            <tbody>
              {[...(computed.tape?.materials.values() ?? [])].flatMap((mat) =>
                [...mat.crossSections.values()].map((xs) => {
                  const desc = ENDF6_MT_DESCRIPTORS.get(xs.mt);
                  return (
                    <tr
                      key={`${mat.mat}-${xs.mt}`}
                      onClick={() => host.onRevealLine?.(xs.line)}
                      style={{ cursor: "pointer", borderBottom: "1px solid var(--ms-border-subtle)" }}
                    >
                      <td style={{ padding: "5px 6px", fontFamily: "monospace" }}>{mat.mat}</td>
                      <td style={{ padding: "5px 6px" }}>{mat.name}</td>
                      <td style={{ padding: "5px 6px", fontFamily: "monospace" }}>3</td>
                      <td style={{ padding: "5px 6px", fontFamily: "monospace" }}>{xs.mt}</td>
                      <td style={{ padding: "5px 6px" }}>{desc?.name ?? `MT=${xs.mt}`}</td>
                      <td style={{ padding: "5px 6px", fontFamily: "monospace" }}>{xs.tab1.np}</td>
                    </tr>
                  );
                }),
              )}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === "multigroup" && (
        <div style={{ flex: 1, overflow: "auto", padding: "10px 12px" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid var(--ms-border)", color: "var(--ms-text-2)" }}>
                <th style={{ padding: "5px 6px" }}>Group</th>
                <th style={{ padding: "5px 6px" }}>Energy Range (eV)</th>
                <th style={{ padding: "5px 6px" }}>σ_total (b)</th>
                <th style={{ padding: "5px 6px" }}>σ_elastic (b)</th>
                <th style={{ padding: "5px 6px" }}>σ_fission (b)</th>
                <th style={{ padding: "5px 6px" }}>σ_capture (b)</th>
              </tr>
            </thead>
            <tbody>
              {(multigroup?.groups ?? []).map((g) => (
                <tr key={g.group} style={{ borderBottom: "1px solid var(--ms-border-subtle)" }}>
                  <td style={{ padding: "5px 6px", fontFamily: "monospace" }}>G{g.group}</td>
                  <td style={{ padding: "5px 6px", fontFamily: "monospace" }}>
                    {g.eLow.toExponential(2)} – {g.eHigh.toExponential(2)}
                  </td>
                  <td style={{ padding: "5px 6px", fontFamily: "monospace" }}>{g.sigmaTotal.toFixed(4)}</td>
                  <td style={{ padding: "5px 6px", fontFamily: "monospace" }}>{g.sigmaElastic.toFixed(4)}</td>
                  <td style={{ padding: "5px 6px", fontFamily: "monospace" }}>{g.sigmaFission.toFixed(4)}</td>
                  <td style={{ padding: "5px 6px", fontFamily: "monospace" }}>{g.sigmaCapture.toFixed(4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === "lints" && (
        <div style={{ flex: 1, overflow: "auto", padding: "10px 12px" }}>
          {computed.lints.length === 0 ? (
            <div style={{ color: "var(--ms-text-2)", fontSize: "12px" }}>No ENDF-6 validation diagnostics.</div>
          ) : (
            <ul
              style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: "6px" }}
            >
              {computed.lints.map((d, idx) => (
                <li
                  key={`${d.id}-${d.line}-${idx}`}
                  onClick={() => host.onRevealLine?.(d.line)}
                  style={{
                    cursor: "pointer",
                    padding: "6px 8px",
                    borderRadius: "4px",
                    border: "1px solid var(--ms-border)",
                    fontSize: "11px",
                  }}
                >
                  <strong>[{d.id}]</strong> Line {d.line}: {d.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </PanelShell>
  );
};

export default Endf6Panel;
