// SPDX-License-Identifier: AGPL-3.0-or-later
/* eslint-disable react-refresh/only-export-components */

import React, { useMemo, useState } from "react";

export interface CaeContinuumInspectorProps {
  code: string;
  lines: string[];
  colorMode: "dark" | "light";
  onRevealLine?: ((line: number, identifier?: string) => void) | undefined;
}

export interface CaeContinuumSummary {
  brep: {
    hasData: boolean;
    vertices: number;
    edges: number;
    faces: number;
    shells: number;
    genus: number;
    eulerChi: number;
    expectedChi: number;
    isWatertightManifold: boolean;
    csgPrimitives: Array<{ kind: string; params: string; line: number }>;
  };
  gdt: Array<{ kind: string; value: string; line: number }>;
  fea: {
    nodeCount: number;
    elementCount: number;
    elementTypes: Record<string, number>;
    materials: string[];
    boundaryCount: number;
    loadCount: number;
  };
  cfd: {
    hasData: boolean;
    mach: number | null;
    reynolds: number | null;
    turbModel: string | null;
    estimatedDeltaY1: number | null;
    markers: Array<{ kind: string; name: string; line: number }>;
  };
}

export function analyzeCaeContinuum(code: string, lines: string[]): CaeContinuumSummary {
  // 1. STEP B-Rep Topological Entity Counting (strictly counting unique topological entities, NOT half-edges!)
  let vertexPointCount = 0;
  let cartesianPointCount = 0;
  let edgeCurveCount = 0;
  let faceCount = 0;
  let closedShellCount = 0;
  let openShellCount = 0;
  let innerBoundCount = 0;

  const csgPrimitives: Array<{ kind: string; params: string; line: number }> = [];
  const gdt: Array<{ kind: string; value: string; line: number }> = [];
  const elementTypes: Record<string, number> = {};
  const materials: string[] = [];
  const cfdMarkers: Array<{ kind: string; name: string; line: number }> = [];

  let nodeCount = 0;
  let elementCount = 0;
  let boundaryCount = 0;
  let loadCount = 0;
  let feaSection: "none" | "node" | "element" | "boundary" | "load" = "none";
  let currentElemType = "SOLID";

  let mach: number | null = null;
  let reynolds: number | null = null;
  let turbModel: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const t = lines[i]!.trim();
    if (!t || t.startsWith("//") || t.startsWith("**") || t.startsWith("%")) continue;

    // STEP ISO-10303-21 entities
    if (t.startsWith("#")) {
      if (/=\s*VERTEX_POINT\s*\(/.test(t)) vertexPointCount++;
      else if (/=\s*CARTESIAN_POINT\s*\(/.test(t)) cartesianPointCount++;
      else if (/=\s*EDGE_CURVE\s*\(/.test(t)) edgeCurveCount++;
      else if (/=\s*(?:ADVANCED_FACE|FACE_SURFACE)\s*\(/.test(t)) faceCount++;
      else if (/=\s*CLOSED_SHELL\s*\(/.test(t)) closedShellCount++;
      else if (/=\s*OPEN_SHELL\s*\(/.test(t)) openShellCount++;
      else if (/=\s*FACE_INNER_BOUND\s*\(/.test(t)) innerBoundCount++;

      const gdtStep =
        /=\s*(FLATNESS_TOLERANCE|CYLINDRICITY_TOLERANCE|POSITION_TOLERANCE|PERPENDICULARITY_TOLERANCE|PARALLELISM_TOLERANCE|CONCENTRICITY_TOLERANCE|SURFACE_PROFILE_TOLERANCE|GEOMETRIC_TOLERANCE|DATUM)\s*\((.*)\)\s*;/.exec(
          t,
        );
      if (gdtStep) {
        gdt.push({ kind: gdtStep[1]!, value: gdtStep[2]!.slice(0, 64), line: i + 1 });
      }
      continue;
    }

    // QIF XML GD&T
    const qifTol = /<(Flatness|Cylindricity|Position|Perpendicularity|ProfileOfSurface|DatumDefinition)\b[^>]*>/i.exec(
      t,
    );
    if (qifTol) {
      gdt.push({ kind: qifTol[1]!, value: t.slice(0, 64), line: i + 1 });
    }

    // OpenSCAD CSG primitives
    const scadM = /^(cube|sphere|cylinder|polyhedron|linear_extrude|rotate_extrude)\s*\(([^)]*)\)/.exec(t);
    if (scadM) {
      csgPrimitives.push({ kind: scadM[1]!, params: scadM[2]!.trim(), line: i + 1 });
    }

    // CalculiX / Abaqus FEA decks
    if (t.startsWith("*")) {
      const upper = t.toUpperCase();
      if (upper.startsWith("*NODE")) {
        feaSection = "node";
      } else if (upper.startsWith("*ELEMENT")) {
        feaSection = "element";
        currentElemType = /\bTYPE\s*=\s*([A-Za-z0-9_]+)/i.exec(t)?.[1]?.toUpperCase() ?? "ELEM";
      } else if (upper.startsWith("*MATERIAL")) {
        feaSection = "none";
        const matName = /\bNAME\s*=\s*([^,\s]+)/i.exec(t)?.[1];
        if (matName) materials.push(matName);
      } else if (upper.startsWith("*BOUNDARY")) {
        feaSection = "boundary";
      } else if (upper.startsWith("*CLOAD") || upper.startsWith("*DLOAD") || upper.startsWith("*DSLOAD")) {
        feaSection = "load";
      } else {
        feaSection = "none";
      }
      continue;
    }

    if (feaSection !== "none" && /^\d+\s*,/.test(t)) {
      if (feaSection === "node") nodeCount++;
      else if (feaSection === "element") {
        elementCount++;
        elementTypes[currentElemType] = (elementTypes[currentElemType] ?? 0) + 1;
      } else if (feaSection === "boundary") boundaryCount++;
      else if (feaSection === "load") loadCount++;
      continue;
    }

    // SU2 / CFD configuration directives
    const machM = /^MACH_NUMBER\s*=\s*([0-9.eE+-]+)/i.exec(t);
    if (machM) mach = Number(machM[1]);
    const reM = /^REYNOLDS_NUMBER\s*=\s*([0-9.eE+-]+)/i.exec(t);
    if (reM) reynolds = Number(reM[1]);
    const turbM = /^(?:KIND_TURB_MODEL|TURB_MODEL)\s*=\s*([A-Za-z0-9_-]+)/i.exec(t);
    if (turbM) turbModel = turbM[1]!;
    const markerM = /^(MARKER_[A-Z0-9_]+)\s*=\s*\(\s*([^)]*)\)/.exec(t);
    if (markerM) {
      cfdMarkers.push({ kind: markerM[1]!, name: markerM[2]!.trim(), line: i + 1 });
    }
  }

  const V = vertexPointCount > 0 ? vertexPointCount : faceCount > 0 ? cartesianPointCount : 0;
  const E = edgeCurveCount;
  const F = faceCount;
  const hasBrep = V > 0 || E > 0 || F > 0;
  const shells = closedShellCount + openShellCount || (hasBrep ? 1 : 0);
  const genus = Math.max(0, Math.floor(innerBoundCount / 2));
  const eulerChi = V - E + F;
  const expectedChi = hasBrep ? 2 * (shells - genus) : 0;
  const isWatertightManifold = hasBrep && openShellCount === 0 && eulerChi === expectedChi;

  // Flat-plate turbulent boundary-layer first-cell wall spacing Δy₁ for y⁺ = 1
  let estimatedDeltaY1: number | null = null;
  if (reynolds !== null && reynolds > 0) {
    const cf = 0.026 / Math.pow(reynolds, 1 / 7);
    const uTauRatio = Math.sqrt(cf / 2);
    estimatedDeltaY1 = 1 / (reynolds * Math.max(uTauRatio, 1e-6));
  }

  return {
    brep: {
      hasData: hasBrep || csgPrimitives.length > 0,
      vertices: V,
      edges: E,
      faces: F,
      shells,
      genus,
      eulerChi,
      expectedChi,
      isWatertightManifold,
      csgPrimitives,
    },
    gdt,
    fea: {
      nodeCount,
      elementCount,
      elementTypes,
      materials,
      boundaryCount,
      loadCount,
    },
    cfd: {
      hasData: mach !== null || reynolds !== null || turbModel !== null || cfdMarkers.length > 0,
      mach,
      reynolds,
      turbModel,
      estimatedDeltaY1,
      markers: cfdMarkers,
    },
  };
}

export const CaeContinuumInspector: React.FC<CaeContinuumInspectorProps> = ({
  code,
  lines,
  colorMode,
  onRevealLine,
}) => {
  const isDark = colorMode === "dark";
  const [subView, setSubView] = useState<"euler" | "gdt" | "fea" | "cfd">("euler");

  const borderCol = isDark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.12)";
  const cardBg = isDark ? "rgba(22, 27, 34, 0.7)" : "rgba(255, 255, 255, 0.9)";
  const textPrimary = isDark ? "#e6edf3" : "#1f2328";
  const textMuted = isDark ? "#8b949e" : "#59636e";

  const { brep, gdt, fea, cfd } = useMemo(() => analyzeCaeContinuum(code, lines), [code, lines]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {[
          { id: "euler", label: `📐 B-Rep Euler-Poincaré (χ = ${brep.eulerChi})` },
          { id: "gdt", label: `🎯 GD&T & Datums (${gdt.length})` },
          { id: "fea", label: `🕸️ FEA Mesh (${fea.elementCount} elems)` },
          { id: "cfd", label: `🌪️ CFD Boundary Layer (${cfd.markers.length} markers)` },
        ].map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setSubView(t.id as typeof subView)}
            style={{
              padding: "6px 12px",
              fontSize: 12,
              fontWeight: 600,
              borderRadius: 6,
              border: `1px solid ${borderCol}`,
              cursor: "pointer",
              backgroundColor: subView === t.id ? "#1f6feb" : cardBg,
              color: subView === t.id ? "#ffffff" : textPrimary,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {subView === "euler" && (
        <div style={{ padding: 14, borderRadius: 8, border: `1px solid ${borderCol}`, backgroundColor: cardBg }}>
          <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 10 }}>
            B-Rep Euler-Poincaré Characteristic: V − E + F = 2(S − G)
          </div>
          {!brep.hasData ? (
            <div style={{ fontSize: 12, color: textMuted }}>
              No STEP B-Rep topological entities (<code>VERTEX_POINT</code>, <code>EDGE_CURVE</code>,{" "}
              <code>ADVANCED_FACE</code>) or OpenSCAD CSG primitives found.
            </div>
          ) : brep.faces > 0 || brep.edges > 0 ? (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(135px, 1fr))", gap: 10 }}>
              <div style={{ padding: 10, borderRadius: 6, border: `1px solid ${borderCol}` }}>
                <div style={{ fontSize: 11, color: textMuted }}>Vertices (V)</div>
                <div style={{ fontSize: 18, fontWeight: 800, fontFamily: "monospace" }}>{brep.vertices}</div>
              </div>
              <div style={{ padding: 10, borderRadius: 6, border: `1px solid ${borderCol}` }}>
                <div style={{ fontSize: 11, color: textMuted }}>Edges (E)</div>
                <div style={{ fontSize: 18, fontWeight: 800, fontFamily: "monospace" }}>{brep.edges}</div>
              </div>
              <div style={{ padding: 10, borderRadius: 6, border: `1px solid ${borderCol}` }}>
                <div style={{ fontSize: 11, color: textMuted }}>Faces (F)</div>
                <div style={{ fontSize: 18, fontWeight: 800, fontFamily: "monospace" }}>{brep.faces}</div>
              </div>
              <div style={{ padding: 10, borderRadius: 6, border: `1px solid ${borderCol}` }}>
                <div style={{ fontSize: 11, color: textMuted }}>Shells S / Genus G</div>
                <div style={{ fontSize: 18, fontWeight: 800, fontFamily: "monospace" }}>
                  {brep.shells} / {brep.genus}
                </div>
              </div>
              <div style={{ padding: 10, borderRadius: 6, border: `1px solid ${borderCol}` }}>
                <div style={{ fontSize: 11, color: textMuted }}>Euler χ = V − E + F</div>
                <div
                  style={{
                    fontSize: 16,
                    fontWeight: 800,
                    fontFamily: "monospace",
                    color: brep.isWatertightManifold ? "#3fb950" : "#f0883e",
                  }}
                >
                  {brep.eulerChi} {brep.isWatertightManifold ? "✓ Closed 2-Manifold" : `(target ${brep.expectedChi})`}
                </div>
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {brep.csgPrimitives.map((p, idx) => (
                <div
                  key={idx}
                  onClick={() => onRevealLine?.(p.line)}
                  style={{
                    padding: "6px 10px",
                    borderRadius: 6,
                    border: `1px solid ${borderCol}`,
                    cursor: "pointer",
                    fontSize: 11,
                    fontFamily: "monospace",
                  }}
                >
                  <strong style={{ color: "#58a6ff" }}>{p.kind}</strong>({p.params}) — L{p.line}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {subView === "gdt" && (
        <div style={{ padding: 14, borderRadius: 8, border: `1px solid ${borderCol}`, backgroundColor: cardBg }}>
          <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 8 }}>
            ASME Y14.5 / ISO 1101 Geometric Dimensioning & Tolerancing (PMI)
          </div>
          {gdt.length === 0 ? (
            <div style={{ fontSize: 12, color: textMuted }}>
              No STEP AP242 PMI geometric tolerance entities or QIF characteristic nominals present in this file.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {gdt.map((item, idx) => (
                <div
                  key={idx}
                  onClick={() => onRevealLine?.(item.line)}
                  style={{
                    padding: "7px 10px",
                    borderRadius: 6,
                    border: `1px solid ${borderCol}`,
                    cursor: "pointer",
                    display: "flex",
                    justifyContent: "space-between",
                    fontSize: 11,
                    fontFamily: "monospace",
                  }}
                >
                  <span style={{ color: "#58a6ff", fontWeight: 700 }}>{item.kind}</span>
                  <span style={{ color: textMuted }}>{item.value}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {subView === "fea" && (
        <div style={{ padding: 14, borderRadius: 8, border: `1px solid ${borderCol}`, backgroundColor: cardBg }}>
          <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 8 }}>
            Finite Element Mesh Discretization & Boundary Conditions
          </div>
          {fea.nodeCount === 0 && fea.elementCount === 0 ? (
            <div style={{ fontSize: 12, color: textMuted }}>
              No FEA <code>*NODE</code> or <code>*ELEMENT</code> blocks parsed.
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
              <div style={{ padding: 10, borderRadius: 6, border: `1px solid ${borderCol}` }}>
                <div style={{ fontSize: 11, color: textMuted }}>Mesh Nodes</div>
                <div style={{ fontSize: 18, fontWeight: 800, fontFamily: "monospace" }}>{fea.nodeCount}</div>
                <div style={{ fontSize: 10, color: textMuted }}>{fea.nodeCount * 3} structural DOF</div>
              </div>
              <div style={{ padding: 10, borderRadius: 6, border: `1px solid ${borderCol}` }}>
                <div style={{ fontSize: 11, color: textMuted }}>Elements</div>
                <div style={{ fontSize: 18, fontWeight: 800, fontFamily: "monospace", color: "#58a6ff" }}>
                  {fea.elementCount}
                </div>
                <div style={{ fontSize: 10, color: textMuted }}>
                  {Object.entries(fea.elementTypes)
                    .map(([k, v]) => `${k}: ${v}`)
                    .join(", ")}
                </div>
              </div>
              <div style={{ padding: 10, borderRadius: 6, border: `1px solid ${borderCol}` }}>
                <div style={{ fontSize: 11, color: textMuted }}>Materials</div>
                <div style={{ fontSize: 14, fontWeight: 700, fontFamily: "monospace" }}>
                  {fea.materials.join(", ") || "Unassigned"}
                </div>
              </div>
              <div style={{ padding: 10, borderRadius: 6, border: `1px solid ${borderCol}` }}>
                <div style={{ fontSize: 11, color: textMuted }}>BCs / Loads</div>
                <div style={{ fontSize: 16, fontWeight: 800, fontFamily: "monospace", color: "#3fb950" }}>
                  {fea.boundaryCount} BC / {fea.loadCount} Load
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {subView === "cfd" && (
        <div style={{ padding: 14, borderRadius: 8, border: `1px solid ${borderCol}`, backgroundColor: cardBg }}>
          <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 8 }}>
            CFD Freestream Regime, Turbulence Closure & y⁺ = 1 Wall Spacing
          </div>
          {!cfd.hasData ? (
            <div style={{ fontSize: 12, color: textMuted }}>
              No CFD solver directives (<code>MACH_NUMBER</code>, <code>REYNOLDS_NUMBER</code>, <code>MARKER_*</code>)
              detected.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 16, fontSize: 12, fontFamily: "monospace" }}>
                <span>Mach: {cfd.mach ?? "—"}</span>
                <span>Re: {cfd.reynolds?.toExponential(2) ?? "—"}</span>
                <span>Turbulence: {cfd.turbModel ?? "Laminar / Euler"}</span>
                {cfd.estimatedDeltaY1 !== null && (
                  <span style={{ color: "#3fb950", fontWeight: 700 }}>
                    Target Δy₁/L (y⁺ ≈ 1): {cfd.estimatedDeltaY1.toExponential(2)}
                  </span>
                )}
              </div>
              {cfd.markers.map((m, idx) => (
                <div
                  key={idx}
                  onClick={() => onRevealLine?.(m.line)}
                  style={{
                    padding: "6px 10px",
                    borderRadius: 6,
                    border: `1px solid ${borderCol}`,
                    cursor: "pointer",
                    fontSize: 11,
                    fontFamily: "monospace",
                    display: "flex",
                    justifyContent: "space-between",
                  }}
                >
                  <span style={{ color: "#58a6ff", fontWeight: 700 }}>{m.kind}</span>
                  <span>{m.name}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
