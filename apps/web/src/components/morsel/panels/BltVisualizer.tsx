// SPDX-License-Identifier: AGPL-3.0-or-later

import React, { useMemo, useState } from "react";
import type { BltBlock, BltModelAnalysis, DependencyKind } from "./blt-types.js";

export interface BltVisualizerProps {
  analysis: BltModelAnalysis;
  colorMode: "dark" | "light";
  onRevealLine?: ((line: number, identifier?: string) => void) | undefined;
}

type BltViewMode = "matrix" | "pipeline" | "dag" | "tables";

export const BltVisualizer: React.FC<BltVisualizerProps> = ({ analysis, colorMode, onRevealLine }) => {
  const [viewMode, setViewMode] = useState<BltViewMode>("matrix");
  const [useCanonicalOrder, setUseCanonicalOrder] = useState(true);
  const [filterText, setFilterText] = useState("");
  const [hoveredCell, setHoveredCell] = useState<{ eqIdx: number; varIdx: number } | null>(null);
  const [selectedBlockIdx, setSelectedBlockIdx] = useState<number | null>(null);

  const normalizedFilter = filterText.trim().toLowerCase();

  const isDark = colorMode === "dark";
  const borderCol = "var(--color-border-default, rgba(148, 163, 184, 0.18))";
  const cardBg = "var(--color-bg-card, rgba(22, 27, 34, 0.6))";
  const textPrimary = "var(--color-fg-default, #c9d1d9)";
  const textMuted = "var(--color-fg-muted, #8b949e)";

  const { equations, variables, blocks, diagnostics, incidence, matchedEqToVar } = analysis;

  // Active ordering for matrix
  const rowOrder = useMemo(() => {
    const base = useCanonicalOrder ? analysis.permutedEqOrder : equations.map((_, i) => i);
    if (!normalizedFilter) return base;
    return base.filter((eIdx) => equations[eIdx]?.text.toLowerCase().includes(normalizedFilter));
  }, [useCanonicalOrder, analysis.permutedEqOrder, equations, normalizedFilter]);

  const colOrder = useMemo(() => {
    const base = useCanonicalOrder ? analysis.permutedVarOrder : variables.map((_, i) => i);
    if (!normalizedFilter) return base;
    return base.filter((vIdx) => variables[vIdx]?.name.toLowerCase().includes(normalizedFilter));
  }, [useCanonicalOrder, analysis.permutedVarOrder, variables, normalizedFilter]);

  const getBlockForEq = (eqIdx: number): BltBlock | undefined => {
    return blocks.find((b) => b.equations.some((e) => e.id === eqIdx));
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        gap: 16,
        color: textPrimary,
        fontSize: 13,
      }}
    >
      {/* ── 1. Top Diagnostic Banner & Solvability KPIs ── */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          padding: "12px 16px",
          borderRadius: 8,
          border: `1px solid ${borderCol}`,
          backgroundColor: cardBg,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div
            style={{
              width: 10,
              height: 10,
              borderRadius: "50%",
              backgroundColor:
                diagnostics.status === "balanced"
                  ? "#3fb950"
                  : diagnostics.status === "under-determined"
                    ? "#d29922"
                    : "#f85149",
              boxShadow: `0 0 10px ${
                diagnostics.status === "balanced"
                  ? "rgba(63, 185, 80, 0.6)"
                  : diagnostics.status === "under-determined"
                    ? "rgba(210, 153, 34, 0.6)"
                    : "rgba(248, 81, 73, 0.6)"
              }`,
            }}
          />
          <div>
            <div style={{ fontWeight: 700, fontSize: 14 }}>
              BLT Causal Architecture: <span style={{ color: "#58a6ff" }}>{analysis.className}</span>
            </div>
            <div style={{ fontSize: 11, color: textMuted }}>
              Block Lower Triangular Tarjan Decomposition & Bipartite Causal Matching (Cellier & Kofman)
            </div>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            style={{
              padding: "4px 10px",
              borderRadius: 6,
              fontSize: 11,
              fontWeight: 700,
              textTransform: "uppercase",
              backgroundColor:
                diagnostics.status === "balanced"
                  ? "rgba(63, 185, 80, 0.15)"
                  : diagnostics.status === "under-determined"
                    ? "rgba(210, 153, 34, 0.15)"
                    : "rgba(248, 81, 73, 0.15)",
              color:
                diagnostics.status === "balanced"
                  ? "#3fb950"
                  : diagnostics.status === "under-determined"
                    ? "#d29922"
                    : "#f85149",
              border: `1px solid ${
                diagnostics.status === "balanced"
                  ? "rgba(63, 185, 80, 0.3)"
                  : diagnostics.status === "under-determined"
                    ? "rgba(210, 153, 34, 0.3)"
                    : "rgba(248, 81, 73, 0.3)"
              }`,
            }}
          >
            {diagnostics.status === "balanced"
              ? "✓ Well-Determined System"
              : diagnostics.status === "under-determined"
                ? `⚠ Under-Determined (DOF: +${diagnostics.degreesOfFreedom})`
                : `✕ Over-Determined (DOF: ${diagnostics.degreesOfFreedom})`}
          </span>

          {/* Sub-view switcher */}
          <div
            style={{
              display: "inline-flex",
              borderRadius: 6,
              border: `1px solid ${borderCol}`,
              overflow: "hidden",
              backgroundColor: isDark ? "rgba(0,0,0,0.3)" : "rgba(255,255,255,0.8)",
            }}
          >
            {[
              { id: "matrix", label: "Matrix Sparsity" },
              { id: "pipeline", label: "Causal Blocks & Tearing" },
              { id: "dag", label: "Dependency DAG" },
              { id: "tables", label: "System Equations" },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setViewMode(tab.id as BltViewMode)}
                style={{
                  padding: "5px 11px",
                  fontSize: 12,
                  fontWeight: 600,
                  border: "none",
                  cursor: "pointer",
                  backgroundColor: viewMode === tab.id ? "var(--color-accent-fg, #1f6feb)" : "transparent",
                  color: viewMode === tab.id ? "#ffffff" : textMuted,
                  transition: "all 0.15s ease",
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── 2. Solvability KPI Metrics ── */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
          gap: 12,
        }}
      >
        <div
          style={{
            padding: "10px 14px",
            borderRadius: 8,
            border: `1px solid ${borderCol}`,
            backgroundColor: cardBg,
            borderLeft: "3px solid #58a6ff",
          }}
        >
          <div style={{ fontSize: 11, color: textMuted, textTransform: "uppercase", fontWeight: 600 }}>
            System Equations / Unknowns
          </div>
          <div style={{ fontSize: 20, fontWeight: 700, marginTop: 4, fontFamily: "monospace" }}>
            {diagnostics.equationCount} eq / {diagnostics.unknownCount} var
          </div>
          <div style={{ fontSize: 11, color: textMuted, marginTop: 2 }}>
            {diagnostics.parameterCount} constant parameters excluded
          </div>
        </div>

        <div
          style={{
            padding: "10px 14px",
            borderRadius: 8,
            border: `1px solid ${borderCol}`,
            backgroundColor: cardBg,
            borderLeft: `3px solid ${diagnostics.loopCount > 0 ? "#d29922" : "#3fb950"}`,
          }}
        >
          <div style={{ fontSize: 11, color: textMuted, textTransform: "uppercase", fontWeight: 600 }}>
            Algebraic Loops (SCCs)
          </div>
          <div style={{ fontSize: 20, fontWeight: 700, marginTop: 4, fontFamily: "monospace" }}>
            {diagnostics.loopCount > 0 ? `${diagnostics.loopCount} loops (Max: ${diagnostics.maxLoopSize}D)` : "None ✓"}
          </div>
          <div style={{ fontSize: 11, color: textMuted, marginTop: 2 }}>
            {diagnostics.loopCount > 0 ? "Coupled iteration required (Torn)" : "100% Sequential analytic solve"}
          </div>
        </div>

        <div
          style={{
            padding: "10px 14px",
            borderRadius: 8,
            border: `1px solid ${borderCol}`,
            backgroundColor: cardBg,
            borderLeft: "3px solid #bc8cff",
          }}
        >
          <div style={{ fontSize: 11, color: textMuted, textTransform: "uppercase", fontWeight: 600 }}>
            Dynamic ODE States
          </div>
          <div style={{ fontSize: 20, fontWeight: 700, marginTop: 4, fontFamily: "monospace" }}>
            {diagnostics.odeCount} states (der)
          </div>
          <div style={{ fontSize: 11, color: textMuted, marginTop: 2 }}>Integrated via CVODE / IDA / DOPRI5</div>
        </div>

        <div
          style={{
            padding: "10px 14px",
            borderRadius: 8,
            border: `1px solid ${borderCol}`,
            backgroundColor: cardBg,
            borderLeft: "3px solid #3fb950",
          }}
        >
          <div style={{ fontSize: 11, color: textMuted, textTransform: "uppercase", fontWeight: 600 }}>
            Total BLT Blocks
          </div>
          <div style={{ fontSize: 20, fontWeight: 700, marginTop: 4, fontFamily: "monospace" }}>
            {blocks.length} execution stages
          </div>
          <div style={{ fontSize: 11, color: textMuted, marginTop: 2 }}>
            {diagnostics.analyticCount} scalar assignments
          </div>
        </div>
      </div>

      {/* ── 3. View: Interactive BLT Sparsity Matrix ── */}
      {viewMode === "matrix" && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 12,
            padding: 14,
            borderRadius: 8,
            border: `1px solid ${borderCol}`,
            backgroundColor: cardBg,
          }}
        >
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
            }}
          >
            <div>
              <div style={{ fontWeight: 600, fontSize: 13 }}>
                Incidence Matrix & Canonical BLT Partitioning (Equations × Variables)
              </div>
              <div style={{ fontSize: 11, color: textMuted }}>
                Rows represent equations; columns represent unknown variables. Diamonds indicate causal pivot matching;
                boxes along the diagonal highlight coupled algebraic loops.
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <label
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 12,
                  cursor: "pointer",
                  userSelect: "none",
                }}
              >
                <input
                  type="checkbox"
                  checked={useCanonicalOrder}
                  onChange={(e) => setUseCanonicalOrder(e.target.checked)}
                />
                <span style={{ fontWeight: 600 }}>Permuted Canonical BLT Order</span>
              </label>

              <input
                type="search"
                placeholder="Filter equations / variables…"
                value={filterText}
                onChange={(e) => setFilterText(e.target.value)}
                style={{
                  padding: "4px 8px",
                  borderRadius: 6,
                  border: `1px solid ${borderCol}`,
                  backgroundColor: "var(--color-bg-primary)",
                  color: textPrimary,
                  fontSize: 11,
                  minWidth: 180,
                }}
              />
            </div>
          </div>

          {/* Matrix Legend */}
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              gap: 16,
              padding: "6px 10px",
              borderRadius: 6,
              backgroundColor: isDark ? "rgba(0,0,0,0.2)" : "rgba(0,0,0,0.03)",
              fontSize: 11,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <span
                style={{
                  display: "inline-block",
                  width: 10,
                  height: 10,
                  borderRadius: 2,
                  backgroundColor: "#3fb950",
                  transform: "rotate(45deg)",
                }}
              />
              <span style={{ fontWeight: 600 }}>Causal Match Pivot (M: Eq → Var)</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 2, backgroundColor: "#58a6ff" }} />
              <span>Linear Dependency</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 2, backgroundColor: "#d29922" }} />
              <span>Nonlinear Dependency</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 2, backgroundColor: "#bc8cff" }} />
              <span>State Derivative der(x)</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <span
                style={{
                  display: "inline-block",
                  width: 12,
                  height: 12,
                  border: "2px dashed #f0883e",
                  borderRadius: 2,
                }}
              />
              <span style={{ color: "#f0883e", fontWeight: 600 }}>Algebraic Loop SCC Block</span>
            </div>
          </div>

          {/* Matrix Table Container */}
          <div style={{ overflowX: "auto", overflowY: "auto", maxHeight: 520, position: "relative" }}>
            <table style={{ borderCollapse: "collapse", fontSize: 11, fontFamily: "monospace" }}>
              <thead>
                <tr>
                  <th
                    style={{
                      position: "sticky",
                      top: 0,
                      left: 0,
                      zIndex: 3,
                      backgroundColor: cardBg,
                      borderBottom: `2px solid ${borderCol}`,
                      borderRight: `2px solid ${borderCol}`,
                      padding: "4px 8px",
                      textAlign: "left",
                      color: textMuted,
                      minWidth: 140,
                    }}
                  >
                    Equations \ Vars
                  </th>
                  {colOrder.map((vIdx) => {
                    const vr = variables[vIdx]!;
                    const isMatchedCol = hoveredCell?.varIdx === vIdx;
                    return (
                      <th
                        key={vIdx}
                        title={`${vr.name} (${vr.typeName}, ${vr.variability})`}
                        style={{
                          position: "sticky",
                          top: 0,
                          zIndex: 2,
                          backgroundColor: isMatchedCol ? "rgba(56, 139, 253, 0.2)" : cardBg,
                          borderBottom: `2px solid ${borderCol}`,
                          padding: "6px 4px",
                          minWidth: 26,
                          maxWidth: 32,
                          textAlign: "center",
                          verticalAlign: "bottom",
                          writingMode: "vertical-rl",
                          transform: "rotate(180deg)",
                          color: isMatchedCol ? "#58a6ff" : textPrimary,
                          fontWeight: isMatchedCol ? 700 : 500,
                          height: 90,
                          cursor: "pointer",
                        }}
                        onClick={() => onRevealLine?.(vr.line, vr.name)}
                      >
                        {vr.name}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {rowOrder.map((eIdx) => {
                  const eq = equations[eIdx]!;
                  const isHoveredRow = hoveredCell?.eqIdx === eIdx;
                  const matchedVarForEq = matchedEqToVar[eIdx];

                  return (
                    <tr
                      key={eIdx}
                      style={{
                        backgroundColor: isHoveredRow ? "rgba(56, 139, 253, 0.12)" : "transparent",
                      }}
                    >
                      <th
                        style={{
                          position: "sticky",
                          left: 0,
                          zIndex: 1,
                          backgroundColor: isHoveredRow ? "rgba(56, 139, 253, 0.18)" : cardBg,
                          borderRight: `2px solid ${borderCol}`,
                          borderBottom: `1px solid ${borderCol}`,
                          padding: "4px 8px",
                          textAlign: "left",
                          whiteSpace: "nowrap",
                          maxWidth: 220,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          cursor: "pointer",
                          color: isHoveredRow ? "#58a6ff" : textPrimary,
                          fontWeight: isHoveredRow ? 700 : 500,
                        }}
                        onClick={() => onRevealLine?.(eq.line)}
                        title={`Line ${eq.line}: ${eq.text}`}
                      >
                        <span style={{ color: textMuted, marginRight: 6 }}>e{eq.id + 1}</span>
                        {eq.text.length > 28 ? `${eq.text.slice(0, 28)}…` : eq.text}
                      </th>

                      {colOrder.map((vIdx) => {
                        const cellKey = `${eIdx}:${vIdx}`;
                        const kind: DependencyKind | undefined = incidence[cellKey];
                        const isMatch = kind === "matched" || matchedVarForEq === vIdx;
                        const isCrosshair = hoveredCell?.eqIdx === eIdx || hoveredCell?.varIdx === vIdx;

                        // Check if in an algebraic loop block along diagonal
                        const inDiagBlock =
                          useCanonicalOrder &&
                          blocks.some(
                            (b) =>
                              b.isLoop &&
                              b.equations.some((e) => e.id === eIdx) &&
                              b.variables.some((v) => v.id === vIdx),
                          );

                        return (
                          <td
                            key={vIdx}
                            onMouseEnter={() => setHoveredCell({ eqIdx: eIdx, varIdx: vIdx })}
                            onMouseLeave={() => setHoveredCell(null)}
                            onClick={() => onRevealLine?.(eq.line, variables[vIdx]?.name)}
                            title={
                              kind
                                ? `Equation ${eIdx + 1}: ${eq.text}\nVariable: ${variables[vIdx]?.name}\nDependency: ${
                                    isMatch ? "Causal Pivot Match (Solved here)" : kind
                                  }`
                                : undefined
                            }
                            style={{
                              width: 26,
                              height: 24,
                              textAlign: "center",
                              borderBottom: `1px solid ${borderCol}`,
                              borderRight: `1px solid ${borderCol}`,
                              backgroundColor: inDiagBlock
                                ? isDark
                                  ? "rgba(240, 136, 62, 0.08)"
                                  : "rgba(240, 136, 62, 0.05)"
                                : isCrosshair
                                  ? "rgba(56, 139, 253, 0.06)"
                                  : "transparent",
                              cursor: kind ? "pointer" : "default",
                              position: "relative",
                            }}
                          >
                            {isMatch ? (
                              <div
                                style={{
                                  width: 12,
                                  height: 12,
                                  borderRadius: 2,
                                  backgroundColor: "#3fb950",
                                  transform: "rotate(45deg) scale(0.9)",
                                  margin: "auto",
                                  boxShadow: "0 0 6px rgba(63, 185, 80, 0.7)",
                                }}
                              />
                            ) : kind === "derivative" ? (
                              <div
                                style={{
                                  width: 10,
                                  height: 10,
                                  borderRadius: "50%",
                                  backgroundColor: "#bc8cff",
                                  margin: "auto",
                                }}
                              />
                            ) : kind === "nonlinear" ? (
                              <div
                                style={{
                                  width: 10,
                                  height: 10,
                                  borderRadius: 2,
                                  backgroundColor: "#d29922",
                                  margin: "auto",
                                }}
                              />
                            ) : kind === "linear" ? (
                              <div
                                style={{
                                  width: 8,
                                  height: 8,
                                  borderRadius: "50%",
                                  backgroundColor: "#58a6ff",
                                  margin: "auto",
                                }}
                              />
                            ) : null}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Hover Cell Inspector Footer */}
          {hoveredCell && (
            <div
              style={{
                padding: "8px 12px",
                borderRadius: 6,
                backgroundColor: isDark ? "rgba(0,0,0,0.3)" : "rgba(0,0,0,0.04)",
                border: `1px solid ${borderCol}`,
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                fontSize: 12,
              }}
            >
              <div>
                <span style={{ color: textMuted }}>Equation e{hoveredCell.eqIdx + 1}: </span>
                <span style={{ fontWeight: 600, color: "#58a6ff" }}>{equations[hoveredCell.eqIdx]?.text}</span>
              </div>
              <div>
                <span style={{ color: textMuted }}>Variable: </span>
                <span style={{ fontWeight: 600, color: "#3fb950" }}>{variables[hoveredCell.varIdx]?.name}</span>
              </div>
              <div>
                <span style={{ color: textMuted }}>Relation: </span>
                <span style={{ fontWeight: 700 }}>
                  {incidence[`${hoveredCell.eqIdx}:${hoveredCell.varIdx}`] === "matched"
                    ? "🎯 Causal Match Pivot (Equation Solves this Variable)"
                    : incidence[`${hoveredCell.eqIdx}:${hoveredCell.varIdx}`]
                      ? `Dependency (${incidence[`${hoveredCell.eqIdx}:${hoveredCell.varIdx}`]})`
                      : "Independent"}
                </span>
              </div>
              <div>
                <span style={{ color: textMuted }}>Stage: </span>
                <span style={{ fontWeight: 600, color: "#d29922" }}>
                  Block #{getBlockForEq(hoveredCell.eqIdx)?.index !== undefined ? getBlockForEq(hoveredCell.eqIdx)!.index + 1 : 1}
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── 4. View: Causal Pipeline & Tearing Breakdown ── */}
      {viewMode === "pipeline" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ fontSize: 12, color: textMuted }}>
            The Block Lower Triangular sequence executes each strongly connected component in causal forward order.
            Scalar blocks are solved analytically; algebraic loop blocks are solved via simultaneous numerical solvers
            (Newton-Raphson) accelerated by tearing.
          </div>

          {blocks.map((block, idx) => {
            const isSelected = selectedBlockIdx === idx;
            return (
              <div
                key={idx}
                onClick={() => setSelectedBlockIdx(isSelected ? null : idx)}
                style={{
                  borderRadius: 8,
                  border: `1px solid ${
                    isSelected
                      ? "#58a6ff"
                      : block.isLoop
                        ? "rgba(210, 153, 34, 0.4)"
                        : block.blockType === "ode"
                          ? "rgba(188, 140, 255, 0.4)"
                          : borderCol
                  }`,
                  boxShadow: isSelected ? "0 0 10px rgba(88, 166, 255, 0.3)" : "none",
                  backgroundColor: cardBg,
                  overflow: "hidden",
                  cursor: "pointer",
                }}
              >
                {/* Block Header */}
                <div
                  style={{
                    padding: "10px 14px",
                    display: "flex",
                    flexWrap: "wrap",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 10,
                    borderBottom: `1px solid ${borderCol}`,
                    backgroundColor: block.isLoop
                      ? "rgba(210, 153, 34, 0.08)"
                      : block.blockType === "ode"
                        ? "rgba(188, 140, 255, 0.08)"
                        : "transparent",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span
                      style={{
                        padding: "2px 8px",
                        borderRadius: 4,
                        fontSize: 11,
                        fontWeight: 700,
                        backgroundColor: "var(--color-bg-primary)",
                        border: `1px solid ${borderCol}`,
                        fontFamily: "monospace",
                      }}
                    >
                      Stage #{idx + 1}
                    </span>
                    <span style={{ fontWeight: 700, fontSize: 13 }}>
                      {block.isLoop
                        ? `Coupled Algebraic Loop (${block.size}×${block.size} Dimension)`
                        : block.blockType === "ode"
                          ? `ODE Dynamic State Equation (${block.variables[0]?.name})`
                          : `Scalar Analytic Assignment (${block.variables[0]?.name})`}
                    </span>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span
                      style={{
                        padding: "2px 8px",
                        borderRadius: 12,
                        fontSize: 11,
                        fontWeight: 600,
                        backgroundColor: block.isLoop
                          ? "rgba(210, 153, 34, 0.2)"
                          : block.blockType === "ode"
                            ? "rgba(188, 140, 255, 0.2)"
                            : "rgba(63, 185, 80, 0.2)",
                        color: block.isLoop ? "#d29922" : block.blockType === "ode" ? "#bc8cff" : "#3fb950",
                      }}
                    >
                      {block.isLoop ? `${block.blockType.toUpperCase()} SYSTEM` : block.blockType.toUpperCase()}
                    </span>

                    {block.tearing && (
                      <span
                        style={{
                          padding: "2px 8px",
                          borderRadius: 12,
                          fontSize: 11,
                          fontWeight: 700,
                          backgroundColor: "rgba(88, 166, 255, 0.15)",
                          color: "#58a6ff",
                        }}
                      >
                        ⚡ Torn: -{block.tearing.reductionPercent}% Iteration Dim
                      </span>
                    )}
                  </div>
                </div>

                {/* Block Content */}
                <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
                  {/* Equations in block */}
                  <div>
                    <div style={{ fontSize: 11, color: textMuted, marginBottom: 4, fontWeight: 600 }}>
                      EQUATIONS IN STAGE:
                    </div>
                    {block.equations.map((eq, eI) => (
                      <div
                        key={eI}
                        onClick={() => onRevealLine?.(eq.line)}
                        style={{
                          padding: "6px 10px",
                          borderRadius: 6,
                          backgroundColor: "var(--color-bg-primary)",
                          border: `1px solid ${borderCol}`,
                          marginBottom: 4,
                          fontFamily: "monospace",
                          fontSize: 12,
                          display: "flex",
                          justifyContent: "space-between",
                          cursor: "pointer",
                        }}
                      >
                        <span style={{ color: "#58a6ff" }}>{eq.text}</span>
                        <span style={{ color: textMuted, fontSize: 11 }}>Line {eq.line}</span>
                      </div>
                    ))}
                  </div>

                  {/* Variables solved in block */}
                  <div>
                    <div style={{ fontSize: 11, color: textMuted, marginBottom: 4, fontWeight: 600 }}>
                      SOLVED CAUSAL VARIABLES:
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {block.variables.map((vr, vI) => (
                        <span
                          key={vI}
                          onClick={() => onRevealLine?.(vr.line, vr.name)}
                          style={{
                            padding: "3px 8px",
                            borderRadius: 4,
                            backgroundColor: "var(--color-bg-primary)",
                            border: `1px solid ${borderCol}`,
                            fontSize: 11,
                            fontFamily: "monospace",
                            color: "#3fb950",
                            cursor: "pointer",
                            fontWeight: 600,
                          }}
                        >
                          {vr.name} ({vr.typeName})
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Tearing Detailed Panel for Algebraic Loops */}
                  {block.tearing && (
                    <div
                      style={{
                        padding: 10,
                        borderRadius: 6,
                        border: "1px dashed rgba(210, 153, 34, 0.4)",
                        backgroundColor: isDark ? "rgba(0,0,0,0.2)" : "rgba(0,0,0,0.02)",
                      }}
                    >
                      <div style={{ fontWeight: 700, fontSize: 12, color: "#d29922", marginBottom: 6 }}>
                        Tearing Decomposition Heuristic (Minimal Residual System)
                      </div>
                      <div style={{ fontSize: 11, color: textMuted, marginBottom: 6 }}>
                        Iteration / Guessed Variables:{" "}
                        <strong style={{ color: textPrimary }}>{block.tearing.tearingVars.join(", ")}</strong>
                      </div>
                      <div style={{ fontSize: 11, color: textMuted, marginBottom: 6 }}>
                        Residual Equations:{" "}
                        <strong style={{ color: textPrimary }}>{block.tearing.residualEqs.join(" | ")}</strong>
                      </div>
                      {block.tearing.causalChain.length > 0 && (
                        <div style={{ fontSize: 11, color: textMuted }}>
                          Inner Forward Causal Chain:{" "}
                          <span style={{ color: "#58a6ff" }}>
                            {block.tearing.causalChain.map((c) => `${c.solvedVar} ← [${c.eqText}]`).join(" → ")}
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── 5. View: Causal Dependency DAG ── */}
      {viewMode === "dag" && (
        <div
          style={{
            padding: 16,
            borderRadius: 8,
            border: `1px solid ${borderCol}`,
            backgroundColor: cardBg,
            display: "flex",
            flexDirection: "column",
            gap: 14,
          }}
        >
          <div>
            <div style={{ fontWeight: 600, fontSize: 13 }}>Causal Dataflow Graph (Stage → Stage Dependency DAG)</div>
            <div style={{ fontSize: 11, color: textMuted }}>
              Shows directed dependencies between execution blocks. Stages with no mutual dependencies can be solved
              concurrently on WebGPU or multi-threaded CPU solvers.
            </div>
          </div>

          <div
            style={{
              padding: 16,
              borderRadius: 6,
              backgroundColor: "var(--color-bg-primary)",
              border: `1px solid ${borderCol}`,
              overflowX: "auto",
            }}
          >
            {/* Visual Flow Representation */}
            <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 480 }}>
              {blocks.map((b, bIdx) => {
                const incomingEdges = analysis.dagEdges.filter((e) => e.toBlock === bIdx);
                const outgoingEdges = analysis.dagEdges.filter((e) => e.fromBlock === bIdx);

                return (
                  <div
                    key={bIdx}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      padding: 10,
                      borderRadius: 6,
                      border: `1px solid ${borderCol}`,
                      backgroundColor: cardBg,
                    }}
                  >
                    <div
                      style={{
                        padding: "4px 8px",
                        borderRadius: 4,
                        fontSize: 11,
                        fontWeight: 700,
                        backgroundColor: b.isLoop ? "#d29922" : b.blockType === "ode" ? "#bc8cff" : "#3fb950",
                        color: "#ffffff",
                        fontFamily: "monospace",
                        minWidth: 70,
                        textAlign: "center",
                      }}
                    >
                      Stage #{bIdx + 1}
                    </div>

                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: 12 }}>
                        {b.variables.map((v) => v.name).join(", ")}
                      </div>
                      <div style={{ fontSize: 11, color: textMuted, marginTop: 2 }}>
                        {b.equations.map((e) => e.text).join(" ; ")}
                      </div>
                    </div>

                    <div style={{ textAlign: "right", fontSize: 11, color: textMuted }}>
                      {incomingEdges.length > 0 && (
                        <div>
                          Inputs from:{" "}
                          <span style={{ color: "#58a6ff" }}>
                            {incomingEdges.map((e) => `Stage #${e.fromBlock + 1} (${e.sharedVar})`).join(", ")}
                          </span>
                        </div>
                      )}
                      {outgoingEdges.length > 0 && (
                        <div>
                          Feeds into:{" "}
                          <span style={{ color: "#3fb950" }}>
                            {outgoingEdges.map((e) => `Stage #${e.toBlock + 1}`).join(", ")}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ── 6. View: System Equations & Unknowns Table ── */}
      {viewMode === "tables" && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 14,
            padding: 14,
            borderRadius: 8,
            border: `1px solid ${borderCol}`,
            backgroundColor: cardBg,
          }}
        >
          <div style={{ fontWeight: 600, fontSize: 13 }}>System Differential & Algebraic Equations</div>

          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr
                  style={{
                    textAlign: "left",
                    borderBottom: `1px solid ${borderCol}`,
                    backgroundColor: isDark ? "rgba(255,255,255,0.02)" : "rgba(0,0,0,0.02)",
                  }}
                >
                  <th style={{ padding: "8px 12px", color: textMuted }}>#</th>
                  <th style={{ padding: "8px 12px", color: textMuted }}>Kind</th>
                  <th style={{ padding: "8px 12px", color: textMuted }}>Equation Text</th>
                  <th style={{ padding: "8px 12px", color: textMuted }}>Matched Variable</th>
                  <th style={{ padding: "8px 12px", color: textMuted }}>Line</th>
                </tr>
              </thead>
              <tbody>
                {equations.map((eq, idx) => {
                  const matchedVIdx = matchedEqToVar[eq.id];
                  const matchedVar = matchedVIdx !== undefined && matchedVIdx !== -1 ? variables[matchedVIdx] : null;

                  return (
                    <tr
                      key={idx}
                      onClick={() => onRevealLine?.(eq.line)}
                      style={{
                        borderBottom: `1px solid ${borderCol}`,
                        cursor: "pointer",
                        backgroundColor: "var(--color-bg-primary)",
                      }}
                    >
                      <td style={{ padding: "7px 12px", fontFamily: "monospace", color: textMuted }}>e{eq.id + 1}</td>
                      <td style={{ padding: "7px 12px" }}>
                        <span
                          style={{
                            padding: "2px 6px",
                            borderRadius: 4,
                            fontSize: 11,
                            fontWeight: 600,
                            backgroundColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)",
                          }}
                        >
                          {eq.kind}
                        </span>
                      </td>
                      <td style={{ padding: "7px 12px", fontFamily: "monospace", fontWeight: 600 }}>{eq.text}</td>
                      <td style={{ padding: "7px 12px", fontFamily: "monospace", color: "#3fb950" }}>
                        {matchedVar ? matchedVar.name : <span style={{ color: "#f85149" }}>Unmatched</span>}
                      </td>
                      <td style={{ padding: "7px 12px", fontFamily: "monospace", color: textMuted }}>{eq.line}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

export default BltVisualizer;
