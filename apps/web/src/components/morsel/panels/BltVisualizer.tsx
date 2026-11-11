// SPDX-License-Identifier: AGPL-3.0-or-later

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BltBlock, BltDagEdge, BltModelAnalysis, DependencyKind } from "./blt-types.js";

export interface BltVisualizerProps {
  analysis: BltModelAnalysis;
  colorMode: "dark" | "light";
  onRevealLine?: ((line: number, identifier?: string) => void) | undefined;
  sourceMode?: "flattened" | "source" | undefined;
  hasFlattenedDae?: boolean | undefined;
  isFlattening?: boolean | undefined;
  onSourceModeChange?: ((mode: "flattened" | "source") => void) | undefined;
}

type BltViewMode = "matrix" | "pipeline" | "dag" | "tables";
type MatrixRenderMode = "grid" | "spy";

const ROW_HEIGHT = 24;
const COL_WIDTH = 28;
const ROW_HEADER_WIDTH = 230;
const COL_HEADER_HEIGHT = 128;
const ROW_OVERSCAN = 8;
const COL_OVERSCAN = 12;

function formatCompactVarHeader(name: string, maxLen = 19): string {
  if (name.length <= maxLen) return name;
  // Preserve `der(...)` wrapper or prefix + leaf suffix so `block1.y` vs `block2.y` stay distinct
  const headLen = Math.ceil((maxLen - 1) * 0.45);
  const tailLen = maxLen - 1 - headLen;
  return `${name.slice(0, headLen)}…${name.slice(name.length - tailLen)}`;
}

export const BltVisualizer: React.FC<BltVisualizerProps> = ({
  analysis,
  colorMode,
  onRevealLine,
  sourceMode,
  hasFlattenedDae,
  isFlattening,
  onSourceModeChange,
}) => {
  const [viewMode, setViewMode] = useState<BltViewMode>("matrix");
  const [matrixMode, setMatrixMode] = useState<MatrixRenderMode>("grid");
  const [useCanonicalOrder, setUseCanonicalOrder] = useState(true);
  const [filterText, setFilterText] = useState("");
  const [hoveredCell, setHoveredCell] = useState<{ eqIdx: number; varIdx: number } | null>(null);
  const [selectedBlockIdx, setSelectedBlockIdx] = useState<number | null>(null);

  // Virtualization scroll state
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const spyCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [scrollState, setScrollState] = useState({
    scrollTop: 0,
    scrollLeft: 0,
    clientWidth: 1080,
    clientHeight: 520,
  });

  const normalizedFilter = filterText.trim().toLowerCase();

  const isDark = colorMode === "dark";
  const borderCol = "var(--color-border-default, rgba(148, 163, 184, 0.18))";
  const cardBg = "var(--color-bg-card, rgba(22, 27, 34, 0.6))";
  // 100% opaque surface tokens for sticky matrix headers so scrolled rows/columns never bleed through
  const solidHeaderBg = isDark ? "#161b22" : "#f6f8fa";
  const solidCornerBg = isDark ? "#0d1117" : "#eaeef2";
  const solidHoverHeaderBg = isDark ? "#1b2c43" : "#dcebff";
  const textPrimary = "var(--color-fg-default, #c9d1d9)";
  const textMuted = "var(--color-fg-muted, #8b949e)";

  const {
    equations,
    variables,
    stateVariables,
    blocks,
    diagnostics,
    incidence,
    matchedEqToVar,
    matchedVarToEq,
    eqToBlock,
    varToBlock,
  } = analysis;

  // Connected submatrix filtering: matching an equation keeps its incident variables,
  // and matching a variable keeps its incident equations so neither axis collapses to empty.
  const { rowOrder, colOrder } = useMemo(() => {
    const baseRows = useCanonicalOrder ? analysis.permutedEqOrder : equations.map((_, i) => i);
    const baseCols = useCanonicalOrder ? analysis.permutedVarOrder : variables.map((_, i) => i);

    if (!normalizedFilter) {
      return { rowOrder: baseRows, colOrder: baseCols };
    }

    const directEqMatches = new Set<number>();
    const directVarMatches = new Set<number>();

    for (let e = 0; e < equations.length; e++) {
      const eq = equations[e]!;
      const label = `e${eq.id + 1}`;
      if (eq.text.toLowerCase().includes(normalizedFilter) || label === normalizedFilter) {
        directEqMatches.add(e);
      }
    }

    for (let v = 0; v < variables.length; v++) {
      const vr = variables[v]!;
      if (vr.name.toLowerCase().includes(normalizedFilter) || vr.typeName.toLowerCase().includes(normalizedFilter)) {
        directVarMatches.add(v);
      }
    }

    const activeEqs = new Set<number>(directEqMatches);
    const activeVars = new Set<number>(directVarMatches);

    // Expand direct variable matches -> equations referencing them
    if (directVarMatches.size > 0) {
      for (let e = 0; e < equations.length; e++) {
        for (const v of directVarMatches) {
          if (incidence[`${e}:${v}`] !== undefined) {
            activeEqs.add(e);
            break;
          }
        }
      }
    }

    // Expand active equations -> variables appearing in directly matched equations (or matched pivots)
    for (const e of activeEqs) {
      const eq = equations[e]!;
      const mv = matchedEqToVar[e];
      if (mv !== undefined && mv !== -1) activeVars.add(mv);
      if (directEqMatches.has(e) || directVarMatches.size === 0) {
        for (let v = 0; v < variables.length; v++) {
          if (incidence[`${e}:${v}`] !== undefined) {
            activeVars.add(v);
          }
        }
      }
      void eq;
    }

    return {
      rowOrder: baseRows.filter((e) => activeEqs.has(e)),
      colOrder: baseCols.filter((v) => activeVars.has(v)),
    };
  }, [
    useCanonicalOrder,
    analysis.permutedEqOrder,
    analysis.permutedVarOrder,
    equations,
    variables,
    incidence,
    matchedEqToVar,
    normalizedFilter,
  ]);

  // Precompute row/col positions for loop block boundary outlines in canonical order (O(R + C))
  const loopBlockBounds = useMemo(() => {
    if (!useCanonicalOrder) return new Map<number, { minR: number; maxR: number; minC: number; maxC: number }>();
    const map = new Map<number, { minR: number; maxR: number; minC: number; maxC: number }>();

    for (let rPos = 0; rPos < rowOrder.length; rPos++) {
      const eIdx = rowOrder[rPos]!;
      const bIdx = eqToBlock[eIdx] ?? -1;
      if (bIdx !== -1 && blocks[bIdx]?.isLoop) {
        const cur = map.get(bIdx);
        if (!cur) {
          map.set(bIdx, { minR: rPos, maxR: rPos, minC: Infinity, maxC: -1 });
        } else {
          if (rPos < cur.minR) cur.minR = rPos;
          if (rPos > cur.maxR) cur.maxR = rPos;
        }
      }
    }

    for (let cPos = 0; cPos < colOrder.length; cPos++) {
      const vIdx = colOrder[cPos]!;
      const bIdx = varToBlock[vIdx] ?? -1;
      if (bIdx !== -1 && blocks[bIdx]?.isLoop) {
        const cur = map.get(bIdx);
        if (cur) {
          if (cPos < cur.minC) cur.minC = cPos;
          if (cPos > cur.maxC) cur.maxC = cPos;
        }
      }
    }

    return map;
  }, [useCanonicalOrder, rowOrder, colOrder, eqToBlock, varToBlock, blocks]);

  // Pre-index DAG incoming and outgoing edges per block in O(B + E_dag)
  const { incomingByBlock, outgoingByBlock } = useMemo(() => {
    const incoming: BltDagEdge[][] = Array.from({ length: blocks.length }, () => []);
    const outgoing: BltDagEdge[][] = Array.from({ length: blocks.length }, () => []);
    for (const edge of analysis.dagEdges) {
      if (outgoing[edge.fromBlock]) outgoing[edge.fromBlock]!.push(edge);
      if (incoming[edge.toBlock]) incoming[edge.toBlock]!.push(edge);
    }
    return { incomingByBlock: incoming, outgoingByBlock: outgoing };
  }, [blocks.length, analysis.dagEdges]);

  // Track viewport size on mount / resize
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const updateSize = () => {
      setScrollState((prev) => {
        if (prev.clientWidth === el.clientWidth && prev.clientHeight === el.clientHeight) return prev;
        return {
          ...prev,
          clientWidth: el.clientWidth || 1080,
          clientHeight: el.clientHeight || 520,
        };
      });
    };
    updateSize();
    if (typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver(updateSize);
      ro.observe(el);
      return () => ro.disconnect();
    }
    return undefined;
  }, [viewMode, matrixMode]);

  const handleMatrixScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const t = e.currentTarget;
    setScrollState({
      scrollTop: t.scrollTop,
      scrollLeft: t.scrollLeft,
      clientWidth: t.clientWidth || 1080,
      clientHeight: t.clientHeight || 520,
    });
  }, []);

  // Compute virtualized 2D window slices
  const totalRows = rowOrder.length;
  const totalCols = colOrder.length;

  const visibleBodyHeight = Math.max(120, scrollState.clientHeight - COL_HEADER_HEIGHT);
  const visibleBodyWidth = Math.max(200, scrollState.clientWidth - ROW_HEADER_WIDTH);

  const startRow = Math.max(0, Math.floor(scrollState.scrollTop / ROW_HEIGHT) - ROW_OVERSCAN);
  const endRow = Math.min(
    totalRows,
    Math.ceil((scrollState.scrollTop + visibleBodyHeight) / ROW_HEIGHT) + ROW_OVERSCAN,
  );

  const startCol = Math.max(0, Math.floor(scrollState.scrollLeft / COL_WIDTH) - COL_OVERSCAN);
  const endCol = Math.min(totalCols, Math.ceil((scrollState.scrollLeft + visibleBodyWidth) / COL_WIDTH) + COL_OVERSCAN);

  const topPadHeight = startRow * ROW_HEIGHT;
  const bottomPadHeight = Math.max(0, (totalRows - endRow) * ROW_HEIGHT);
  const leftPadWidth = startCol * COL_WIDTH;
  const rightPadWidth = Math.max(0, (totalCols - endCol) * COL_WIDTH);

  // Event-delegated cell hover & click handlers (zero per-cell closure allocations)
  const handleTbodyMouseMove = useCallback((e: React.MouseEvent<HTMLTableSectionElement>) => {
    const target = (e.target as HTMLElement | null)?.closest?.("td[data-eidx]") as HTMLElement | null;
    if (!target) {
      setHoveredCell((prev) => (prev === null ? null : null));
      return;
    }
    const eqIdx = Number(target.dataset["eidx"]);
    const varIdx = Number(target.dataset["vidx"]);
    if (Number.isNaN(eqIdx) || Number.isNaN(varIdx)) return;
    setHoveredCell((prev) => (prev && prev.eqIdx === eqIdx && prev.varIdx === varIdx ? prev : { eqIdx, varIdx }));
  }, []);

  const handleTbodyMouseLeave = useCallback(() => {
    setHoveredCell(null);
  }, []);

  const handleTbodyClick = useCallback(
    (e: React.MouseEvent<HTMLTableSectionElement>) => {
      if (!onRevealLine) return;
      const td = (e.target as HTMLElement | null)?.closest?.("td[data-eidx]") as HTMLElement | null;
      if (td) {
        const eqIdx = Number(td.dataset["eidx"]);
        const varIdx = Number(td.dataset["vidx"]);
        const eq = equations[eqIdx];
        const vr = variables[varIdx];
        if (eq) {
          onRevealLine(eq.line, vr?.baseStateName ?? vr?.name);
        }
      }
    },
    [equations, variables, onRevealLine],
  );

  // Draw HiDPI Spy Plot Canvas when in `"spy"` mode
  useEffect(() => {
    if (viewMode !== "matrix" || matrixMode !== "spy") return;
    const canvas = spyCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const cssSize = 440;
    const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    canvas.width = cssSize * dpr;
    canvas.height = cssSize * dpr;
    ctx.scale(dpr, dpr);

    ctx.fillStyle = isDark ? "#0d1117" : "#ffffff";
    ctx.fillRect(0, 0, cssSize, cssSize);

    const pad = 24;
    const plotW = cssSize - pad * 2;
    const plotH = cssSize - pad * 2;
    ctx.strokeStyle = isDark ? "rgba(148, 163, 184, 0.25)" : "rgba(15, 23, 42, 0.2)";
    ctx.lineWidth = 1;
    ctx.strokeRect(pad, pad, plotW, plotH);

    if (rowOrder.length === 0 || colOrder.length === 0) return;

    const colPosMap = new Int32Array(variables.length).fill(-1);
    for (let c = 0; c < colOrder.length; c++) colPosMap[colOrder[c]!] = c;

    const scaleX = plotW / colOrder.length;
    const scaleY = plotH / rowOrder.length;
    const dotSize = Math.max(2, Math.min(7, Math.min(scaleX, scaleY) * 0.82));

    // Draw loop SCC blocks first
    if (useCanonicalOrder) {
      for (const [bIdx, bnd] of loopBlockBounds.entries()) {
        if (bnd.minC === Infinity) continue;
        const bx = pad + bnd.minC * scaleX;
        const by = pad + bnd.minR * scaleY;
        const bw = (bnd.maxC - bnd.minC + 1) * scaleX;
        const bh = (bnd.maxR - bnd.minR + 1) * scaleY;
        ctx.fillStyle = "rgba(240, 136, 62, 0.14)";
        ctx.fillRect(bx, by, bw, bh);
        ctx.strokeStyle = "#f0883e";
        ctx.setLineDash([3, 2]);
        ctx.strokeRect(bx, by, bw, bh);
        ctx.setLineDash([]);
        void bIdx;
      }
    }

    // Draw non-zeros
    for (let r = 0; r < rowOrder.length; r++) {
      const eIdx = rowOrder[r]!;
      const eq = equations[eIdx]!;
      // Check matched + referenced
      for (let c = 0; c < colOrder.length; c++) {
        const vIdx = colOrder[c]!;
        const kind = incidence[`${eIdx}:${vIdx}`];
        if (!kind) continue;
        const cx = pad + (c + 0.5) * scaleX;
        const cy = pad + (r + 0.5) * scaleY;
        ctx.fillStyle =
          kind === "matched"
            ? "#3fb950"
            : kind === "derivative"
              ? "#bc8cff"
              : kind === "nonlinear"
                ? "#d29922"
                : "#58a6ff";
        ctx.fillRect(cx - dotSize / 2, cy - dotSize / 2, dotSize, dotSize);
      }
      void eq;
      void colPosMap;
    }
  }, [
    viewMode,
    matrixMode,
    rowOrder,
    colOrder,
    equations,
    variables.length,
    incidence,
    isDark,
    useCanonicalOrder,
    loopBlockBounds,
  ]);

  // Status badge styling (explicitly handles balanced, under-determined, over-determined, AND singular!)
  const statusTheme =
    diagnostics.status === "balanced"
      ? {
          color: "#3fb950",
          bg: "rgba(63, 185, 80, 0.15)",
          border: "rgba(63, 185, 80, 0.3)",
          glow: "rgba(63, 185, 80, 0.6)",
          label: "✓ Well-Determined System",
        }
      : diagnostics.status === "under-determined"
        ? {
            color: "#d29922",
            bg: "rgba(210, 153, 34, 0.15)",
            border: "rgba(210, 153, 34, 0.3)",
            glow: "rgba(210, 153, 34, 0.6)",
            label: `⚠ Under-Determined (DOF: +${diagnostics.degreesOfFreedom})`,
          }
        : diagnostics.status === "singular"
          ? {
              color: "#f85149",
              bg: "rgba(248, 81, 73, 0.15)",
              border: "rgba(248, 81, 73, 0.3)",
              glow: "rgba(248, 81, 73, 0.6)",
              label: `✕ Structurally Singular (${diagnostics.unmatchedEqs.length} Unmatched)`,
            }
          : {
              color: "#f85149",
              bg: "rgba(248, 81, 73, 0.15)",
              border: "rgba(248, 81, 73, 0.3)",
              glow: "rgba(248, 81, 73, 0.6)",
              label: `✕ Over-Determined (DOF: ${diagnostics.degreesOfFreedom})`,
            };

  const hoveredBlockIdx = hoveredCell ? (eqToBlock[hoveredCell.eqIdx] ?? -1) : -1;
  const hoveredBlock: BltBlock | undefined = hoveredBlockIdx >= 0 ? blocks[hoveredBlockIdx] : undefined;

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
              backgroundColor: statusTheme.color,
              boxShadow: `0 0 10px ${statusTheme.glow}`,
            }}
          />
          <div>
            <div style={{ fontWeight: 700, fontSize: 14, display: "flex", alignItems: "center", gap: 8 }}>
              <span>
                BLT Causal Architecture: <span style={{ color: "#58a6ff" }}>{analysis.className}</span>
              </span>
              {hasFlattenedDae && onSourceModeChange && (
                <span
                  style={{
                    display: "inline-flex",
                    borderRadius: 5,
                    border: `1px solid ${borderCol}`,
                    overflow: "hidden",
                    fontSize: 11,
                  }}
                >
                  <button
                    type="button"
                    onClick={() => onSourceModeChange("flattened")}
                    style={{
                      padding: "2px 8px",
                      fontSize: 10,
                      fontWeight: 600,
                      border: "none",
                      cursor: "pointer",
                      backgroundColor: sourceMode === "flattened" ? "rgba(63, 185, 80, 0.2)" : "transparent",
                      color: sourceMode === "flattened" ? "#3fb950" : textMuted,
                    }}
                  >
                    Flattened DAE
                  </button>
                  <button
                    type="button"
                    onClick={() => onSourceModeChange("source")}
                    style={{
                      padding: "2px 8px",
                      fontSize: 10,
                      fontWeight: 600,
                      border: "none",
                      cursor: "pointer",
                      backgroundColor: sourceMode === "source" ? "rgba(88, 166, 255, 0.2)" : "transparent",
                      color: sourceMode === "source" ? "#58a6ff" : textMuted,
                    }}
                  >
                    Local Class
                  </button>
                </span>
              )}
              {isFlattening && <span style={{ fontSize: 11, fontWeight: 500, color: textMuted }}>Flattening DAE…</span>}
            </div>
            <div style={{ fontSize: 11, color: textMuted }}>
              Block Lower Triangular Tarjan Decomposition & Hopcroft-Karp Causal Matching (Cellier & Kofman)
            </div>
          </div>
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
          <span
            style={{
              padding: "4px 10px",
              borderRadius: 6,
              fontSize: 11,
              fontWeight: 700,
              textTransform: "uppercase",
              backgroundColor: statusTheme.bg,
              color: statusTheme.color,
              border: `1px solid ${statusTheme.border}`,
            }}
          >
            {statusTheme.label}
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
            {diagnostics.parameterCount} parameters · {stateVariables.length} integrated states
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
            {stateVariables.length} states (der)
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
            {diagnostics.analyticCount} scalar · {analysis.dagLevels.length} parallel levels
          </div>
        </div>
      </div>

      {/* Unmatched Singularity / Imbalance Callout */}
      {(diagnostics.unmatchedEqs.length > 0 || diagnostics.unmatchedVars.length > 0) && (
        <div
          style={{
            padding: "10px 14px",
            borderRadius: 8,
            border: `1px solid ${statusTheme.border}`,
            backgroundColor: statusTheme.bg,
            fontSize: 12,
            display: "flex",
            flexDirection: "column",
            gap: 4,
          }}
        >
          <div style={{ fontWeight: 700, color: statusTheme.color }}>
            Causal Matching Diagnostics (
            {diagnostics.status === "singular" ? "Structural Singularity / High-Index Constraint" : "Unbalanced System"}
            )
          </div>
          {diagnostics.unmatchedEqs.length > 0 && (
            <div>
              <span style={{ color: textMuted }}>Unmatched Equations ({diagnostics.unmatchedEqs.length}): </span>
              <span style={{ fontFamily: "monospace" }}>
                {diagnostics.unmatchedEqs
                  .slice(0, 6)
                  .map((eId) => `e${eId + 1} (${equations[eId]?.text.slice(0, 42) ?? ""})`)
                  .join(", ")}
                {diagnostics.unmatchedEqs.length > 6 ? ` +${diagnostics.unmatchedEqs.length - 6} more` : ""}
              </span>
            </div>
          )}
          {diagnostics.unmatchedVars.length > 0 && (
            <div>
              <span style={{ color: textMuted }}>Unmatched Unknowns ({diagnostics.unmatchedVars.length}): </span>
              <span style={{ fontFamily: "monospace" }}>
                {diagnostics.unmatchedVars
                  .slice(0, 10)
                  .map((vId) => variables[vId]?.name)
                  .filter(Boolean)
                  .join(", ")}
                {diagnostics.unmatchedVars.length > 10 ? ` +${diagnostics.unmatchedVars.length - 10} more` : ""}
              </span>
            </div>
          )}
        </div>
      )}

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
                Rows represent equations ({rowOrder.length}); columns represent unknown variables ({colOrder.length}).
                Diamonds indicate causal pivot matching; dashed boxes along the diagonal highlight coupled algebraic
                loops.
              </div>
            </div>

            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
              {(equations.length > 16 || variables.length > 16) && (
                <div
                  style={{
                    display: "inline-flex",
                    borderRadius: 6,
                    border: `1px solid ${borderCol}`,
                    overflow: "hidden",
                  }}
                >
                  <button
                    type="button"
                    onClick={() => setMatrixMode("grid")}
                    style={{
                      padding: "3px 9px",
                      fontSize: 11,
                      fontWeight: 600,
                      border: "none",
                      cursor: "pointer",
                      backgroundColor: matrixMode === "grid" ? "var(--color-accent-fg, #1f6feb)" : "transparent",
                      color: matrixMode === "grid" ? "#ffffff" : textMuted,
                    }}
                  >
                    Interactive Grid
                  </button>
                  <button
                    type="button"
                    onClick={() => setMatrixMode("spy")}
                    style={{
                      padding: "3px 9px",
                      fontSize: 11,
                      fontWeight: 600,
                      border: "none",
                      cursor: "pointer",
                      backgroundColor: matrixMode === "spy" ? "var(--color-accent-fg, #1f6feb)" : "transparent",
                      color: matrixMode === "spy" ? "#ffffff" : textMuted,
                    }}
                  >
                    Overview Spy Plot
                  </button>
                </div>
              )}

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
                  minWidth: 190,
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
              <span
                style={{ display: "inline-block", width: 10, height: 10, borderRadius: 2, backgroundColor: "#58a6ff" }}
              />
              <span>Linear Dependency</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <span
                style={{ display: "inline-block", width: 10, height: 10, borderRadius: 2, backgroundColor: "#d29922" }}
              />
              <span>Nonlinear Dependency</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <span
                style={{ display: "inline-block", width: 10, height: 10, borderRadius: 2, backgroundColor: "#bc8cff" }}
              />
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

          {rowOrder.length === 0 || colOrder.length === 0 ? (
            <div style={{ padding: 24, textAlign: "center", color: textMuted, fontSize: 12 }}>
              No matching equations or unknown variables for the current filter.
            </div>
          ) : matrixMode === "spy" ? (
            <div style={{ display: "flex", justifyContent: "center", padding: 8 }}>
              <canvas
                ref={spyCanvasRef}
                style={{
                  width: 440,
                  height: 440,
                  borderRadius: 6,
                  border: `1px solid ${borderCol}`,
                }}
              />
            </div>
          ) : (
            /* 2D Virtualized Matrix Table Container */
            <div
              ref={scrollContainerRef}
              onScroll={handleMatrixScroll}
              style={{
                overflowX: "auto",
                overflowY: "auto",
                maxHeight: 520,
                position: "relative",
                border: `1px solid ${borderCol}`,
                borderRadius: 6,
                backgroundColor: isDark ? "#0d1117" : "#ffffff",
              }}
            >
              <table
                style={{
                  borderCollapse: "separate",
                  borderSpacing: 0,
                  fontSize: 11,
                  fontFamily: "monospace",
                  tableLayout: "fixed",
                  width: ROW_HEADER_WIDTH + totalCols * COL_WIDTH,
                }}
              >
                <thead>
                  <tr>
                    <th
                      style={{
                        position: "sticky",
                        top: 0,
                        left: 0,
                        zIndex: 4,
                        backgroundColor: solidCornerBg,
                        borderBottom: `2px solid ${borderCol}`,
                        borderRight: `2px solid ${borderCol}`,
                        padding: "6px 10px",
                        textAlign: "left",
                        verticalAlign: "bottom",
                        color: textMuted,
                        width: ROW_HEADER_WIDTH,
                        minWidth: ROW_HEADER_WIDTH,
                        maxWidth: ROW_HEADER_WIDTH,
                        height: COL_HEADER_HEIGHT,
                        boxSizing: "border-box",
                      }}
                    >
                      Equations \ Vars
                    </th>

                    {leftPadWidth > 0 && (
                      <th
                        aria-hidden="true"
                        style={{
                          position: "sticky",
                          top: 0,
                          zIndex: 2,
                          backgroundColor: solidHeaderBg,
                          borderBottom: `2px solid ${borderCol}`,
                          width: leftPadWidth,
                          minWidth: leftPadWidth,
                          padding: 0,
                        }}
                      />
                    )}

                    {colOrder.slice(startCol, endCol).map((vIdx) => {
                      const vr = variables[vIdx]!;
                      const isMatchedCol = hoveredCell?.varIdx === vIdx;
                      const isUnmatchedVar = matchedVarToEq[vIdx] === -1;
                      return (
                        <th
                          key={vIdx}
                          title={`${vr.name} (${vr.typeName}, ${vr.variability})${isUnmatchedVar ? " — UNMATCHED" : ""}`}
                          style={{
                            position: "sticky",
                            top: 0,
                            zIndex: 2,
                            backgroundColor: isMatchedCol ? solidHoverHeaderBg : solidHeaderBg,
                            borderBottom: `2px solid ${borderCol}`,
                            borderRight: `1px solid ${borderCol}`,
                            padding: "6px 4px",
                            width: COL_WIDTH,
                            minWidth: COL_WIDTH,
                            maxWidth: COL_WIDTH,
                            height: COL_HEADER_HEIGHT,
                            boxSizing: "border-box",
                            textAlign: "left",
                            verticalAlign: "bottom",
                            writingMode: "vertical-rl",
                            transform: "rotate(180deg)",
                            overflow: "hidden",
                            whiteSpace: "nowrap",
                            color: isUnmatchedVar ? "#f85149" : isMatchedCol ? "#58a6ff" : textPrimary,
                            fontWeight: isMatchedCol ? 700 : 500,
                            cursor: "pointer",
                          }}
                          onClick={() => onRevealLine?.(vr.line, vr.baseStateName ?? vr.name)}
                        >
                          {formatCompactVarHeader(vr.name)}
                        </th>
                      );
                    })}

                    {rightPadWidth > 0 && (
                      <th
                        aria-hidden="true"
                        style={{
                          position: "sticky",
                          top: 0,
                          zIndex: 2,
                          backgroundColor: solidHeaderBg,
                          borderBottom: `2px solid ${borderCol}`,
                          width: rightPadWidth,
                          minWidth: rightPadWidth,
                          padding: 0,
                        }}
                      />
                    )}
                  </tr>
                </thead>

                <tbody
                  onMouseMove={handleTbodyMouseMove}
                  onMouseLeave={handleTbodyMouseLeave}
                  onClick={handleTbodyClick}
                >
                  {topPadHeight > 0 && (
                    <tr aria-hidden="true" style={{ height: topPadHeight }}>
                      <td
                        colSpan={endCol - startCol + 1 + (leftPadWidth > 0 ? 1 : 0) + (rightPadWidth > 0 ? 1 : 0)}
                        style={{ padding: 0, border: "none" }}
                      />
                    </tr>
                  )}

                  {rowOrder.slice(startRow, endRow).map((eIdx, localR) => {
                    const rPos = startRow + localR;
                    const eq = equations[eIdx]!;
                    const isHoveredRow = hoveredCell?.eqIdx === eIdx;
                    const matchedVarForEq = matchedEqToVar[eIdx];
                    const isUnmatchedEq = matchedVarForEq === -1;
                    const rowBlockIdx = eqToBlock[eIdx] ?? -1;

                    return (
                      <tr key={eIdx} style={{ height: ROW_HEIGHT }}>
                        <th
                          style={{
                            position: "sticky",
                            left: 0,
                            zIndex: 3,
                            backgroundColor: isHoveredRow ? solidHoverHeaderBg : solidHeaderBg,
                            borderRight: `2px solid ${borderCol}`,
                            borderBottom: `1px solid ${borderCol}`,
                            padding: "2px 8px",
                            textAlign: "left",
                            whiteSpace: "nowrap",
                            width: ROW_HEADER_WIDTH,
                            minWidth: ROW_HEADER_WIDTH,
                            maxWidth: ROW_HEADER_WIDTH,
                            height: ROW_HEIGHT,
                            boxSizing: "border-box",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            cursor: "pointer",
                            color: isUnmatchedEq ? "#f85149" : isHoveredRow ? "#58a6ff" : textPrimary,
                            fontWeight: isHoveredRow ? 700 : 500,
                          }}
                          onClick={() => onRevealLine?.(eq.line)}
                          title={`Line ${eq.line} — e${eq.id + 1}: ${eq.text}`}
                        >
                          <span style={{ color: textMuted, marginRight: 6 }}>e{eq.id + 1}</span>
                          {eq.text}
                        </th>

                        {leftPadWidth > 0 && (
                          <td aria-hidden="true" style={{ width: leftPadWidth, padding: 0, border: "none" }} />
                        )}

                        {colOrder.slice(startCol, endCol).map((vIdx, localC) => {
                          const cPos = startCol + localC;
                          const cellKey = `${eIdx}:${vIdx}`;
                          const kind: DependencyKind | undefined = incidence[cellKey];
                          const isMatch = kind === "matched" || matchedVarForEq === vIdx;
                          const isCrosshair = hoveredCell?.eqIdx === eIdx || hoveredCell?.varIdx === vIdx;

                          // O(1) Loop SCC check & perimeter dashed box border
                          const inLoopBlock =
                            useCanonicalOrder &&
                            rowBlockIdx !== -1 &&
                            rowBlockIdx === (varToBlock[vIdx] ?? -2) &&
                            Boolean(blocks[rowBlockIdx]?.isLoop);

                          const bounds = inLoopBlock ? loopBlockBounds.get(rowBlockIdx) : undefined;
                          const topLoopEdge = Boolean(bounds && rPos === bounds.minR);
                          const bottomLoopEdge = Boolean(bounds && rPos === bounds.maxR);
                          const leftLoopEdge = Boolean(bounds && cPos === bounds.minC);
                          const rightLoopEdge = Boolean(bounds && cPos === bounds.maxC);

                          return (
                            <td
                              key={vIdx}
                              data-eidx={eIdx}
                              data-vidx={vIdx}
                              style={{
                                width: COL_WIDTH,
                                height: ROW_HEIGHT,
                                padding: 0,
                                boxSizing: "border-box",
                                textAlign: "center",
                                borderTop: topLoopEdge ? "2px dashed #f0883e" : undefined,
                                borderBottom: bottomLoopEdge ? "2px dashed #f0883e" : `1px solid ${borderCol}`,
                                borderLeft: leftLoopEdge ? "2px dashed #f0883e" : undefined,
                                borderRight: rightLoopEdge ? "2px dashed #f0883e" : `1px solid ${borderCol}`,
                                backgroundColor: inLoopBlock
                                  ? isDark
                                    ? "rgba(240, 136, 62, 0.11)"
                                    : "rgba(240, 136, 62, 0.08)"
                                  : isCrosshair
                                    ? isDark
                                      ? "rgba(56, 139, 253, 0.1)"
                                      : "rgba(56, 139, 253, 0.08)"
                                    : "transparent",
                                cursor: kind ? "pointer" : "default",
                              }}
                            >
                              {isMatch ? (
                                <div
                                  style={{
                                    width: 11,
                                    height: 11,
                                    borderRadius: 2,
                                    backgroundColor: "#3fb950",
                                    transform: "rotate(45deg) scale(0.9)",
                                    margin: "auto",
                                    boxShadow: "0 0 6px rgba(63, 185, 80, 0.65)",
                                    pointerEvents: "none",
                                  }}
                                />
                              ) : kind === "derivative" ? (
                                <div
                                  style={{
                                    width: 9,
                                    height: 9,
                                    borderRadius: "50%",
                                    backgroundColor: "#bc8cff",
                                    margin: "auto",
                                    pointerEvents: "none",
                                  }}
                                />
                              ) : kind === "nonlinear" ? (
                                <div
                                  style={{
                                    width: 9,
                                    height: 9,
                                    borderRadius: 2,
                                    backgroundColor: "#d29922",
                                    margin: "auto",
                                    pointerEvents: "none",
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
                                    pointerEvents: "none",
                                  }}
                                />
                              ) : null}
                            </td>
                          );
                        })}

                        {rightPadWidth > 0 && (
                          <td aria-hidden="true" style={{ width: rightPadWidth, padding: 0, border: "none" }} />
                        )}
                      </tr>
                    );
                  })}

                  {bottomPadHeight > 0 && (
                    <tr aria-hidden="true" style={{ height: bottomPadHeight }}>
                      <td
                        colSpan={endCol - startCol + 1 + (leftPadWidth > 0 ? 1 : 0) + (rightPadWidth > 0 ? 1 : 0)}
                        style={{ padding: 0, border: "none" }}
                      />
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* Persistent Cell Inspector Footer (prevents layout jump on hover/leave) */}
          <div
            style={{
              padding: "8px 12px",
              minHeight: 38,
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
            {hoveredCell ? (
              <>
                <div style={{ maxWidth: "48%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  <span style={{ color: textMuted }}>Equation e{hoveredCell.eqIdx + 1}: </span>
                  <span style={{ fontWeight: 600, color: "#58a6ff", fontFamily: "monospace" }}>
                    {equations[hoveredCell.eqIdx]?.text}
                  </span>
                </div>
                <div>
                  <span style={{ color: textMuted }}>Variable: </span>
                  <span style={{ fontWeight: 600, color: "#3fb950", fontFamily: "monospace" }}>
                    {variables[hoveredCell.varIdx]?.name}
                  </span>
                </div>
                <div>
                  <span style={{ color: textMuted }}>Relation: </span>
                  <span style={{ fontWeight: 700 }}>
                    {incidence[`${hoveredCell.eqIdx}:${hoveredCell.varIdx}`] === "matched"
                      ? "Causal Match Pivot (Solved here)"
                      : incidence[`${hoveredCell.eqIdx}:${hoveredCell.varIdx}`]
                        ? `Dependency (${incidence[`${hoveredCell.eqIdx}:${hoveredCell.varIdx}`]})`
                        : "Independent"}
                  </span>
                </div>
                <div>
                  <span style={{ color: textMuted }}>Stage: </span>
                  <span style={{ fontWeight: 600, color: "#d29922" }}>
                    {hoveredBlock ? `Block #${hoveredBlock.index + 1}` : "Unmatched"}
                  </span>
                </div>
              </>
            ) : (
              <span style={{ color: textMuted, fontSize: 11 }}>
                Hover any cell to inspect equation–variable causality, or click any header/cell to jump to its
                declaration in the editor.
              </span>
            )}
          </div>
        </div>
      )}

      {/* ── 4. View: Causal Pipeline & Tearing Breakdown ── */}
      {viewMode === "pipeline" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ fontSize: 12, color: textMuted }}>
            The Block Lower Triangular sequence executes each strongly connected component in causal forward order.
            Scalar blocks are solved analytically; algebraic loop blocks are solved via simultaneous numerical solvers
            (Newton-Raphson) accelerated by feedback-vertex tearing.
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
                        ⚡ Torn: -{block.tearing.reductionPercent}% Iteration Dim ({block.tearing.tearingVars.length}/
                        {block.size})
                      </span>
                    )}
                  </div>
                </div>

                {/* Block Content */}
                <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
                  <div>
                    <div style={{ fontSize: 11, color: textMuted, marginBottom: 4, fontWeight: 600 }}>
                      EQUATIONS IN STAGE:
                    </div>
                    {block.equations.map((eq, eI) => (
                      <div
                        key={eI}
                        onClick={(ev) => {
                          ev.stopPropagation();
                          onRevealLine?.(eq.line);
                        }}
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
                          gap: 12,
                          cursor: "pointer",
                        }}
                      >
                        <span style={{ color: "#58a6ff", wordBreak: "break-word" }}>{eq.text}</span>
                        <span style={{ color: textMuted, fontSize: 11, whiteSpace: "nowrap" }}>Line {eq.line}</span>
                      </div>
                    ))}
                  </div>

                  <div>
                    <div style={{ fontSize: 11, color: textMuted, marginBottom: 4, fontWeight: 600 }}>
                      SOLVED CAUSAL VARIABLES:
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {block.variables.map((vr, vI) => (
                        <span
                          key={vI}
                          onClick={(ev) => {
                            ev.stopPropagation();
                            onRevealLine?.(vr.line, vr.baseStateName ?? vr.name);
                          }}
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
                        Cycle-Breaking Tearing Decomposition (Feedback Vertex Set)
                      </div>
                      <div style={{ fontSize: 11, color: textMuted, marginBottom: 6 }}>
                        Iteration / Guessed Variables ({block.tearing.tearingVars.length}):{" "}
                        <strong style={{ color: textPrimary, fontFamily: "monospace" }}>
                          {block.tearing.tearingVars.join(", ")}
                        </strong>
                      </div>
                      <div style={{ fontSize: 11, color: textMuted, marginBottom: 6 }}>
                        Residual Equations ({block.tearing.residualEqs.length}):{" "}
                        <strong style={{ color: textPrimary, fontFamily: "monospace" }}>
                          {block.tearing.residualEqs.join(" | ")}
                        </strong>
                      </div>
                      {block.tearing.causalChain.length > 0 && (
                        <div style={{ fontSize: 11, color: textMuted }}>
                          Inner Topological Forward Chain:{" "}
                          <span style={{ color: "#58a6ff", fontFamily: "monospace" }}>
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

      {/* ── 5. View: Causal Dependency DAG (Grouped by Parallel Wave-Front Levels) ── */}
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
            <div style={{ fontWeight: 600, fontSize: 13 }}>
              Causal Dataflow Graph ({analysis.dagLevels.length} Wave-Front Levels · {analysis.dagEdges.length} Dataflow
              Edges)
            </div>
            <div style={{ fontSize: 11, color: textMuted }}>
              Stages within the same wave-front depth have zero mutual dependencies and can execute in parallel across
              SIMD / WebGPU lanes.
            </div>
          </div>

          <div
            style={{
              padding: 16,
              borderRadius: 6,
              backgroundColor: "var(--color-bg-primary)",
              border: `1px solid ${borderCol}`,
              overflowX: "auto",
              display: "flex",
              flexDirection: "column",
              gap: 14,
            }}
          >
            {analysis.dagLevels.map((levelBlocks, lvlIdx) => (
              <div
                key={lvlIdx}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                  padding: 10,
                  borderRadius: 6,
                  border: `1px dashed ${borderCol}`,
                }}
              >
                <div style={{ fontSize: 11, fontWeight: 700, color: textMuted, textTransform: "uppercase" }}>
                  Wave-Front Level {lvlIdx + 1} ({levelBlocks.length}{" "}
                  {levelBlocks.length === 1 ? "stage" : "parallel stages"})
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {levelBlocks.map((bIdx) => {
                    const b = blocks[bIdx]!;
                    const incomingEdges = incomingByBlock[bIdx] ?? [];
                    const outgoingEdges = outgoingByBlock[bIdx] ?? [];

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
                            minWidth: 74,
                            textAlign: "center",
                          }}
                        >
                          Stage #{bIdx + 1}
                        </div>

                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 600, fontSize: 12, fontFamily: "monospace" }}>
                            {b.variables.map((v) => v.name).join(", ")}
                          </div>
                          <div style={{ fontSize: 11, color: textMuted, marginTop: 2, fontFamily: "monospace" }}>
                            {b.equations.map((e) => e.text).join(" ; ")}
                          </div>
                        </div>

                        <div style={{ textAlign: "right", fontSize: 11, color: textMuted }}>
                          {incomingEdges.length > 0 && (
                            <div>
                              Inputs from:{" "}
                              <span style={{ color: "#58a6ff", fontFamily: "monospace" }}>
                                {incomingEdges
                                  .slice(0, 5)
                                  .map((e) => `#${e.fromBlock + 1} (${e.sharedVar})`)
                                  .join(", ")}
                                {incomingEdges.length > 5 ? ` +${incomingEdges.length - 5}` : ""}
                              </span>
                            </div>
                          )}
                          {outgoingEdges.length > 0 && (
                            <div>
                              Feeds into:{" "}
                              <span style={{ color: "#3fb950", fontFamily: "monospace" }}>
                                {Array.from(new Set(outgoingEdges.map((e) => `Stage #${e.toBlock + 1}`)))
                                  .slice(0, 6)
                                  .join(", ")}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── 6. View: System Equations & Unknowns Table ── */}
      {viewMode === "tables" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
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
            <div style={{ fontWeight: 600, fontSize: 13 }}>
              System Differential & Algebraic Equations ({equations.length})
            </div>

            <div style={{ overflowX: "auto", maxHeight: 420, overflowY: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr
                    style={{
                      textAlign: "left",
                      borderBottom: `1px solid ${borderCol}`,
                      backgroundColor: solidHeaderBg,
                      position: "sticky",
                      top: 0,
                    }}
                  >
                    <th style={{ padding: "8px 12px", color: textMuted }}>#</th>
                    <th style={{ padding: "8px 12px", color: textMuted }}>Kind</th>
                    <th style={{ padding: "8px 12px", color: textMuted }}>Equation Text</th>
                    <th style={{ padding: "8px 12px", color: textMuted }}>Matched Variable</th>
                    <th style={{ padding: "8px 12px", color: textMuted }}>Stage</th>
                    <th style={{ padding: "8px 12px", color: textMuted }}>Line</th>
                  </tr>
                </thead>
                <tbody>
                  {equations.map((eq, idx) => {
                    const matchedVIdx = matchedEqToVar[eq.id];
                    const matchedVar = matchedVIdx !== undefined && matchedVIdx !== -1 ? variables[matchedVIdx] : null;
                    const blkIdx = eqToBlock[eq.id] ?? -1;

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
                        <td style={{ padding: "7px 12px", fontFamily: "monospace", color: textMuted }}>
                          {blkIdx >= 0 ? `#${blkIdx + 1}` : "—"}
                        </td>
                        <td style={{ padding: "7px 12px", fontFamily: "monospace", color: textMuted }}>{eq.line}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Unknowns & States Table */}
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
            <div style={{ fontWeight: 600, fontSize: 13 }}>
              Solved Unknowns & State Derivatives ({variables.length})
            </div>

            <div style={{ overflowX: "auto", maxHeight: 360, overflowY: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr
                    style={{
                      textAlign: "left",
                      borderBottom: `1px solid ${borderCol}`,
                      backgroundColor: solidHeaderBg,
                      position: "sticky",
                      top: 0,
                    }}
                  >
                    <th style={{ padding: "8px 12px", color: textMuted }}>#</th>
                    <th style={{ padding: "8px 12px", color: textMuted }}>Variable</th>
                    <th style={{ padding: "8px 12px", color: textMuted }}>Type</th>
                    <th style={{ padding: "8px 12px", color: textMuted }}>Role</th>
                    <th style={{ padding: "8px 12px", color: textMuted }}>Solved By Equation</th>
                    <th style={{ padding: "8px 12px", color: textMuted }}>Line</th>
                  </tr>
                </thead>
                <tbody>
                  {variables.map((vr) => {
                    const eqIdx = matchedVarToEq[vr.id];
                    const solvedEq = eqIdx !== undefined && eqIdx !== -1 ? equations[eqIdx] : null;
                    return (
                      <tr
                        key={vr.id}
                        onClick={() => onRevealLine?.(vr.line, vr.baseStateName ?? vr.name)}
                        style={{
                          borderBottom: `1px solid ${borderCol}`,
                          cursor: "pointer",
                          backgroundColor: "var(--color-bg-primary)",
                        }}
                      >
                        <td style={{ padding: "7px 12px", fontFamily: "monospace", color: textMuted }}>v{vr.id + 1}</td>
                        <td style={{ padding: "7px 12px", fontFamily: "monospace", fontWeight: 600, color: "#3fb950" }}>
                          {vr.name}
                        </td>
                        <td style={{ padding: "7px 12px", fontFamily: "monospace" }}>{vr.typeName}</td>
                        <td style={{ padding: "7px 12px" }}>
                          <span
                            style={{
                              padding: "2px 6px",
                              borderRadius: 4,
                              fontSize: 11,
                              fontWeight: 600,
                              backgroundColor: vr.isDerivative
                                ? "rgba(188, 140, 255, 0.16)"
                                : isDark
                                  ? "rgba(255,255,255,0.08)"
                                  : "rgba(0,0,0,0.06)",
                              color: vr.isDerivative ? "#bc8cff" : textPrimary,
                            }}
                          >
                            {vr.isDerivative ? "State Derivative" : vr.variability}
                          </span>
                        </td>
                        <td style={{ padding: "7px 12px", fontFamily: "monospace" }}>
                          {solvedEq ? (
                            `e${solvedEq.id + 1}: ${solvedEq.text}`
                          ) : (
                            <span style={{ color: "#f85149" }}>Unmatched</span>
                          )}
                        </td>
                        <td style={{ padding: "7px 12px", fontFamily: "monospace", color: textMuted }}>{vr.line}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default BltVisualizer;
