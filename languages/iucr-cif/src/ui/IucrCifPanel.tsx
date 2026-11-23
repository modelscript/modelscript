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
import { renderIucrCifSvg } from "../diagram/crystal-svg.js";
import { lintIucrCif } from "../lints/index.js";
import { parseIucrCif } from "../parser/cif-parser.js";
import { cifToPdb, cifToXyz } from "../projections/index.js";
import { solveCrystalStructure } from "../solver/index.js";
import type { CrystalSolution } from "../types.js";

type IucrCifTabId = "combined" | "lattice" | "xrd" | "atoms" | "lints";

export const IucrCifPanel: React.FC<LanguagePanelProps> = ({
  code,
  dialect,
  colorMode,
  mode,
  viewConfig,
  isFullScreen = false,
  host,
}) => {
  const [activeTab, setActiveTab] = useState<IucrCifTabId>("combined");
  const [azimuthDeg, setAzimuthDeg] = useState<number>(32);
  const [elevationDeg, setElevationDeg] = useState<number>(22);

  const computed = useMemo(() => {
    if (!code.trim()) {
      return {
        solution: null as CrystalSolution | null,
        lints: [] as ReturnType<typeof lintIucrCif>,
        error: undefined as string | undefined,
      };
    }
    try {
      const doc = parseIucrCif(code);
      const lints = lintIucrCif(doc);
      const solution = doc.blocks.length > 0 ? solveCrystalStructure(doc) : null;
      return { solution, lints, error: undefined };
    } catch (err) {
      return {
        solution: null as CrystalSolution | null,
        lints: [] as ReturnType<typeof lintIucrCif>,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }, [code]);

  const title =
    (typeof viewConfig?.["title"] === "string" && viewConfig["title"]) ||
    computed.solution?.structure.name ||
    "IUCr CIF Crystal Structure";

  const svg = useMemo(() => {
    if (!computed.solution) return "";
    const view = activeTab === "lattice" ? "lattice" : activeTab === "xrd" ? "xrd" : "combined";
    try {
      return renderIucrCifSvg(computed.solution, {
        view,
        azimuthDeg,
        elevationDeg,
        colorMode: colorMode === "light" ? "light" : "dark",
      });
    } catch {
      return "";
    }
  }, [computed.solution, activeTab, azimuthDeg, elevationDeg, colorMode]);

  const kpis = useMemo<PanelKpiItem[]>(() => {
    const sol = computed.solution;
    const diagCount = computed.lints.length;
    return [
      {
        label: "Space Group",
        value: sol?.structure.spaceGroupName ?? sol?.metric.crystalSystem ?? "—",
        tone: "info",
      },
      {
        label: "Volume (Å³)",
        value: sol ? sol.metric.volume.toFixed(2) : "—",
      },
      {
        label: "Density (g/cm³)",
        value: sol ? sol.densityGCm3.toFixed(3) : "—",
      },
      {
        label: "Atoms / Peaks",
        value: sol ? `${sol.expandedAtoms.length} / ${sol.xrd.peaks.length}` : "0 / 0",
      },
      {
        label: "Diagnostics",
        value: diagCount,
        tone: diagCount > 0 ? "warning" : "success",
      },
    ];
  }, [computed.solution, computed.lints]);

  return (
    <PanelShell mode={mode} colorMode={colorMode} isFullScreen={isFullScreen}>
      <PanelToolbar
        title={title}
        subtitle="IUCr CIF / STAR 1.1 Crystallography & Powder XRD"
        badge={computed.error ? { label: "Parse Error", tone: "danger" } : { label: "CIF 1.1", tone: "info" }}
        actions={
          <>
            {(activeTab === "combined" || activeTab === "lattice") && (
              <>
                <PanelButton onClick={() => setAzimuthDeg((a) => (a - 15 + 360) % 360)}>⟲ Az</PanelButton>
                <PanelButton onClick={() => setAzimuthDeg((a) => (a + 15) % 360)}>⟳ Az</PanelButton>
                <PanelButton onClick={() => setElevationDeg((e) => Math.max(-75, Math.min(75, e + 10)))}>
                  ↑ El
                </PanelButton>
                <PanelButton
                  onClick={() => {
                    setAzimuthDeg(32);
                    setElevationDeg(22);
                  }}
                >
                  Reset
                </PanelButton>
              </>
            )}
            {host.exportFile && svg && (
              <PanelButton onClick={() => host.exportFile?.(`${title}.svg`, svg, "image/svg+xml")}>
                Export SVG
              </PanelButton>
            )}
            {host.exportFile && computed.solution && (
              <PanelButton
                onClick={() =>
                  host.exportFile?.(`${title}.pdb`, cifToPdb(computed.solution!.structure), "chemical/x-pdb")
                }
              >
                PDB
              </PanelButton>
            )}
            {host.exportFile && computed.solution && (
              <PanelButton
                onClick={() =>
                  host.exportFile?.(`${title}.xyz`, cifToXyz(computed.solution!.structure), "chemical/x-xyz")
                }
              >
                XYZ
              </PanelButton>
            )}
            {mode === "artifact" && host.openInMorsel && code && (
              <PanelButton variant="primary" onClick={() => host.openInMorsel?.(code, dialect || "iucr-cif", title)}>
                Open in Morsel
              </PanelButton>
            )}
          </>
        }
      />

      <PanelKpiStrip items={kpis} />

      <PanelTabBar<IucrCifTabId>
        activeTab={activeTab}
        onSelect={setActiveTab}
        tabs={[
          { id: "combined", label: "Lattice + XRD" },
          { id: "lattice", label: "3D Unit Cell" },
          { id: "xrd", label: "Powder XRD", count: computed.solution?.xrd.peaks.length ?? 0 },
          { id: "atoms", label: "Sites & Bonds", count: computed.solution?.expandedAtoms.length ?? 0 },
          { id: "lints", label: "Lints", count: computed.lints.length },
        ]}
      />

      {(activeTab === "combined" || activeTab === "lattice" || activeTab === "xrd") && (
        <PanelSvgStage
          svg={svg}
          onRevealLine={host.onRevealLine}
          emptyMessage={computed.error ?? "Load an IUCr CIF (.cif / .star) file to inspect the crystal lattice & XRD."}
        />
      )}

      {activeTab === "atoms" && (
        <div style={{ flex: 1, overflow: "auto", padding: "10px 12px" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid var(--ms-border)", color: "var(--ms-text-2)" }}>
                <th style={{ padding: "5px 6px" }}>#</th>
                <th style={{ padding: "5px 6px" }}>Label</th>
                <th style={{ padding: "5px 6px" }}>Elem</th>
                <th style={{ padding: "5px 6px" }}>Fract (x, y, z)</th>
                <th style={{ padding: "5px 6px" }}>Cart (Å)</th>
                <th style={{ padding: "5px 6px" }}>Occ</th>
              </tr>
            </thead>
            <tbody>
              {(computed.solution?.expandedAtoms ?? []).map((atom) => (
                <tr key={atom.index} style={{ borderBottom: "1px solid var(--ms-border-subtle)" }}>
                  <td style={{ padding: "4px 6px", fontFamily: "monospace" }}>{atom.index + 1}</td>
                  <td style={{ padding: "4px 6px", fontWeight: 600 }}>{atom.label}</td>
                  <td style={{ padding: "4px 6px", fontFamily: "monospace" }}>{atom.symbol}</td>
                  <td style={{ padding: "4px 6px", fontFamily: "monospace" }}>
                    ({atom.fract[0].toFixed(4)}, {atom.fract[1].toFixed(4)}, {atom.fract[2].toFixed(4)})
                  </td>
                  <td style={{ padding: "4px 6px", fontFamily: "monospace" }}>
                    ({atom.cart[0].toFixed(3)}, {atom.cart[1].toFixed(3)}, {atom.cart[2].toFixed(3)})
                  </td>
                  <td style={{ padding: "4px 6px", fontFamily: "monospace" }}>{atom.occupancy.toFixed(3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === "lints" && (
        <div style={{ flex: 1, overflow: "auto", padding: "10px 12px" }}>
          {computed.lints.length === 0 ? (
            <div style={{ fontSize: "12px", color: "var(--ms-text-2)" }}>
              No crystallographic diagnostics — structure passes all ICIF1001–ICIF5006 checks.
            </div>
          ) : (
            <ul
              style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "6px" }}
            >
              {computed.lints.map((d, idx) => (
                <li
                  key={`${d.code}-${idx}`}
                  onClick={() => host.onRevealLine?.(d.line)}
                  style={{
                    padding: "6px 8px",
                    borderRadius: "6px",
                    border: "1px solid var(--ms-border)",
                    cursor: host.onRevealLine ? "pointer" : "default",
                    fontSize: "11px",
                  }}
                >
                  <strong style={{ fontFamily: "monospace", marginRight: "6px" }}>[{d.code}]</strong>
                  <span>{d.message}</span>
                  <span style={{ marginLeft: "8px", color: "var(--ms-text-2)", fontFamily: "monospace" }}>
                    L{d.line}:{d.column}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </PanelShell>
  );
};

export default IucrCifPanel;
