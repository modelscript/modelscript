// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Collapsible Multi-Modal Zonotope Generator Ribbon (`ZonotopeGeneratorRibbon`).
 *
 * Dockable horizontal control strip above the Ansatz editor/visualizer split providing:
 *   - Generator count (`m = N`) & pending visual override badge
 *   - Brush mode selector (`select`, `lock-zero`, `couple-pos`, `couple-neg`, `tolerance-handle`)
 *   - Global stress-test scrub bar (`0% -> 100% Spec -> 200% Stress`)
 *   - Quick actions (`Reset ξ=0`, `Snap ξ*`, `Scramble` preview toggle)
 *   - Live Constrained-Zonotope feasibility pill (`<1 ms` HC4 local + optional debounced/on-demand exact API)
 *     opening an expandable `Cξ ≤ d` linear constraints drawer
 *   - Interactive `ε_1..ε_m` generator chips with color swatches, relation tags, and per-generator `ξ_k ∈ [-1, 1]` sliders
 */

import { useCallback, useEffect, useMemo, useRef, useState, type FC, type FormEvent } from "react";
import type { AnsatzRelationalHypergraphRecord } from "../util/lsp-bridge.js";
import {
  checkZonotopeFeasibility,
  extractNumericParamsFromSource,
  type FeasibilityCheckResult,
} from "../util/zonotope-feasibility.js";
import {
  buildGeneratorSummaries,
  getGeneratorColor,
  parseLinearConstraintExpression,
  REL_TYPE_SHORT_LABELS,
  type ConstraintModality,
  type LinearConstraintSpec,
  type ZonotopeBrushMode,
  type ZonotopeWorkbenchState,
} from "../util/zonotope-workbench-state.js";

export interface ZonotopeGeneratorRibbonProps {
  colorMode: "light" | "dark";
  sourceCode: string;
  hypergraphRecord: AnsatzRelationalHypergraphRecord | null;
  state: ZonotopeWorkbenchState;
  worstCaseXiByGroupId?: Record<number, number> | undefined;
  apiBaseUrl?: string | undefined;
  collapsed?: boolean | undefined;
  onToggleCollapsed?: (() => void) | undefined;
  onChangeXi: (groupId: number, xi: number) => void;
  onChangeStressScale: (scale: number) => void;
  onSelectGroup: (groupId: number | null) => void;
  onChangeBrush: (brush: ZonotopeBrushMode) => void;
  onToggleScramblePreview: () => void;
  onResetNominal: () => void;
  onSnapWorstCase: () => void;
  onAddConstraint: (constraint: LinearConstraintSpec) => void;
  onRemoveConstraint: (constraintId: string) => void;
  onViolatingSymbolsChange?: ((symbols: string[]) => void) | undefined;
}

interface ServerConstraintCheckDto {
  feasible?: boolean | undefined;
  engine?: string | undefined;
  conflictingConstraintIds?: string[] | undefined;
  tightenedBounds?: Record<string, [number, number]> | undefined;
  nominalBounds?: Record<string, [number, number]> | undefined;
  volumeRetention?: number | undefined;
  elapsedMs?: number | undefined;
  error?: string | undefined;
}

interface ServerFeasibilitySnapshot {
  feasible: boolean;
  conflictingConstraintIds: string[];
  tightenedBounds: Record<string, [number, number]>;
  volumeRetention: number;
  elapsedMs: number;
  engine: string;
}

const BRUSH_OPTIONS: ReadonlyArray<{
  mode: ZonotopeBrushMode;
  label: string;
  title: string;
}> = [
  { mode: "select", label: "Select", title: "Inspect & highlight generator group ε_k" },
  { mode: "lock-zero", label: "🔒 Lock(0)", title: "Lock clicked token / symbol to group_id = 0 (invariant)" },
  { mode: "couple-pos", label: "+1 Sync", title: "Couple tokens / blocks with positive +1.0 generator correlation" },
  { mode: "couple-neg", label: "-1 Inv", title: "Couple tokens / blocks with negative -1.0 inverse correlation" },
  { mode: "tolerance-handle", label: "📐 Tol", title: "Edit tolerance cone / GD&T shell bounds" },
];

const MODALITY_OPTIONS: ReadonlyArray<{ value: ConstraintModality; label: string }> = [
  { value: "physics", label: "physics" },
  { value: "3d", label: "3d" },
  { value: "2d", label: "2d" },
  { value: "code", label: "code" },
  { value: "text", label: "text" },
];

function formatXi(val: number): string {
  if (Math.abs(val) < 0.005) return "0.00";
  return val > 0 ? `+${val.toFixed(2)}` : val.toFixed(2);
}

function formatBoundValue(val: number): string {
  if (!Number.isFinite(val)) return val > 0 ? "+∞" : "-∞";
  const abs = Math.abs(val);
  if (abs >= 1000 || (abs > 0 && abs < 0.01)) {
    return val.toExponential(2);
  }
  return Number(val.toFixed(3)).toString();
}

function stressRegimeLabel(scale: number): string {
  if (scale <= 0.01) return "Nominal";
  if (Math.abs(scale - 1.0) < 0.025) return "Spec";
  if (scale > 1.0) return "Stress";
  return "Sub-Spec";
}

export const ZonotopeGeneratorRibbon: FC<ZonotopeGeneratorRibbonProps> = ({
  colorMode,
  sourceCode,
  hypergraphRecord,
  state,
  worstCaseXiByGroupId,
  apiBaseUrl,
  collapsed,
  onToggleCollapsed,
  onChangeXi,
  onChangeStressScale,
  onSelectGroup,
  onChangeBrush,
  onToggleScramblePreview,
  onResetNominal,
  onSnapWorstCase,
  onAddConstraint,
  onRemoveConstraint,
  onViolatingSymbolsChange,
}) => {
  const isDark = colorMode === "dark";
  const normalizedApiBase = (apiBaseUrl ?? "").trim().replace(/\/+$/, "");

  const [localCollapsed, setLocalCollapsed] = useState(false);
  const [constraintsOpen, setConstraintsOpen] = useState(false);
  const [draftExpr, setDraftExpr] = useState("");
  const [draftModality, setDraftModality] = useState<ConstraintModality>("physics");
  const [parseError, setParseError] = useState<string | null>(null);

  const [serverSnapshot, setServerSnapshot] = useState<ServerFeasibilitySnapshot | null>(null);
  const [serverChecking, setServerChecking] = useState(false);
  const [serverFallbackNote, setServerFallbackNote] = useState<string | null>(null);
  const activeAbortRef = useRef<AbortController | null>(null);

  const isCollapsed = collapsed ?? localCollapsed;
  const handleToggleCollapsed = useCallback(() => {
    if (onToggleCollapsed) {
      onToggleCollapsed();
    } else {
      setLocalCollapsed((prev) => !prev);
    }
  }, [onToggleCollapsed]);

  const summaries = useMemo(() => buildGeneratorSummaries(hypergraphRecord), [hypergraphRecord]);

  // Extract base nominal parameter boxes (unscaled) then apply state.stressScale once in feasibility check.
  const extractedParams = useMemo(
    () => extractNumericParamsFromSource(sourceCode, state.budgets, 1.0),
    [sourceCode, state.budgets],
  );

  const clientFeasibility: FeasibilityCheckResult = useMemo(
    () => checkZonotopeFeasibility(extractedParams, state.constraints, state.stressScale),
    [extractedParams, state.constraints, state.stressScale],
  );

  const runExactServerCheck = useCallback(
    async (explicitTrigger: boolean) => {
      if (extractedParams.length === 0 || state.constraints.length === 0) {
        setServerSnapshot(null);
        setServerFallbackNote(null);
        return;
      }

      if (activeAbortRef.current) {
        activeAbortRef.current.abort();
      }
      const controller = new AbortController();
      activeAbortRef.current = controller;

      setServerChecking(true);
      if (explicitTrigger) {
        setServerFallbackNote(null);
      }

      try {
        const res = await fetch(`${normalizedApiBase}/api/v1/recipes/check-constraints`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          signal: controller.signal,
          body: JSON.stringify({
            params: extractedParams.map((p) => ({
              name: p.name,
              nominal: p.nominal,
              halfWidth: p.halfWidth,
            })),
            constraints: state.constraints.map((c) => ({
              id: c.id,
              coeffs: c.coeffs,
              sense: c.sense,
              rhs: c.rhs,
            })),
            stressScale: state.stressScale,
          }),
        });

        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const data = (await res.json()) as ServerConstraintCheckDto;
        if (controller.signal.aborted) return;

        if (typeof data.feasible === "boolean") {
          setServerSnapshot({
            feasible: data.feasible,
            conflictingConstraintIds: Array.isArray(data.conflictingConstraintIds) ? data.conflictingConstraintIds : [],
            tightenedBounds: data.tightenedBounds ?? clientFeasibility.tightenedBounds,
            volumeRetention:
              typeof data.volumeRetention === "number" && Number.isFinite(data.volumeRetention)
                ? data.volumeRetention
                : clientFeasibility.volumeRetention,
            elapsedMs: typeof data.elapsedMs === "number" ? data.elapsedMs : 0,
            engine: data.engine ?? "constrained-zonotope",
          });
          setServerFallbackNote(null);
        } else {
          setServerSnapshot(null);
        }
      } catch (err) {
        if (controller.signal.aborted) return;
        setServerSnapshot(null);
        if (explicitTrigger) {
          const msg = err instanceof Error ? err.message : String(err);
          setServerFallbackNote(`Exact API offline (${msg}) — using instant local HC4`);
        }
      } finally {
        if (!controller.signal.aborted) {
          setServerChecking(false);
        }
      }
    },
    [
      extractedParams,
      state.constraints,
      state.stressScale,
      normalizedApiBase,
      clientFeasibility.tightenedBounds,
      clientFeasibility.volumeRetention,
    ],
  );

  // Invalidate previous exact snapshot on input change, and auto-debounce exact server check when apiBaseUrl is provided.
  useEffect(() => {
    setServerSnapshot(null);
    if (!normalizedApiBase || extractedParams.length === 0 || state.constraints.length === 0) {
      return;
    }
    const timer = window.setTimeout(() => {
      void runExactServerCheck(false);
    }, 350);
    return () => {
      window.clearTimeout(timer);
      if (activeAbortRef.current) {
        activeAbortRef.current.abort();
      }
    };
  }, [normalizedApiBase, extractedParams, state.constraints, state.stressScale, runExactServerCheck]);

  const effectiveFeasible = serverSnapshot ? serverSnapshot.feasible : clientFeasibility.feasible;
  const effectiveVolumeRetention = serverSnapshot ? serverSnapshot.volumeRetention : clientFeasibility.volumeRetention;
  const effectiveConflictingIds = serverSnapshot
    ? serverSnapshot.conflictingConstraintIds
    : clientFeasibility.conflictingConstraintIds;
  const effectiveTightenedBounds = serverSnapshot ? serverSnapshot.tightenedBounds : clientFeasibility.tightenedBounds;

  const conflictingSet = useMemo(() => new Set(effectiveConflictingIds), [effectiveConflictingIds]);

  const violatingSymbols = useMemo(() => {
    if (conflictingSet.size === 0) return [];
    const symbols = new Set<string>();
    for (const c of state.constraints) {
      if (!conflictingSet.has(c.id)) continue;
      for (const [sym, coeff] of Object.entries(c.coeffs)) {
        if (sym.length > 0 && Number.isFinite(coeff) && coeff !== 0) {
          symbols.add(sym);
        }
      }
    }
    return Array.from(symbols).sort();
  }, [conflictingSet, state.constraints]);

  const serializedViolatingSymbols = useMemo(() => JSON.stringify(violatingSymbols), [violatingSymbols]);
  const lastEmittedViolatingSymbolsRef = useRef<string | null>(null);

  useEffect(() => {
    if (!onViolatingSymbolsChange) return;
    if (lastEmittedViolatingSymbolsRef.current === serializedViolatingSymbols) return;
    lastEmittedViolatingSymbolsRef.current = serializedViolatingSymbols;
    onViolatingSymbolsChange(violatingSymbols);
  }, [onViolatingSymbolsChange, serializedViolatingSymbols, violatingSymbols]);

  const handleSubmitConstraint = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      const parsed = parseLinearConstraintExpression(draftExpr, draftModality);
      if (!parsed) {
        setParseError(
          "Invalid linear constraint — use e.g. 'wall_thickness >= 2.0', '2*R1 + R2 <= 250', or 'L1 - L2 == 0'.",
        );
        return;
      }
      setParseError(null);
      onAddConstraint(parsed);
      setDraftExpr("");
    },
    [draftExpr, draftModality, onAddConstraint],
  );

  const pendingCount = state.pendingOverrides.length;
  const worstCaseCount = worstCaseXiByGroupId ? Object.keys(worstCaseXiByGroupId).length : 0;
  const stressPct = Math.round(state.stressScale * 100);

  // Palette tokens
  const border = isDark ? "#30363d" : "#d0d7de";
  const bg = isDark ? "#0d1117" : "#ffffff";
  const bgSubtle = isDark ? "#161b22" : "#f6f8fa";
  const bgPill = isDark ? "#21262d" : "#eaeef2";
  const fg = isDark ? "#e6edf3" : "#1f2328";
  const fgMuted = isDark ? "#8b949e" : "#656d76";
  const accent = isDark ? "#38bdf8" : "#0969da";
  const violet = isDark ? "#a78bfa" : "#8250df";
  const emerald = isDark ? "#34d399" : "#1a7f37";
  const amber = isDark ? "#fbbf24" : "#9a6700";
  const danger = isDark ? "#f87171" : "#cf222e";

  const stressColor = state.stressScale > 1.5 ? danger : state.stressScale > 1.05 ? amber : emerald;

  const tightenedEntries = useMemo(() => {
    const out: Array<{ name: string; lo: number; hi: number }> = [];
    for (const p of extractedParams) {
      const b = effectiveTightenedBounds[p.name];
      if (b) {
        out.push({ name: p.name, lo: b[0], hi: b[1] });
      }
      if (out.length >= 6) break;
    }
    return out;
  }, [extractedParams, effectiveTightenedBounds]);

  return (
    <div
      role="region"
      aria-label="Multi-Modal Zonotope Generator Ribbon"
      style={{
        background: bgSubtle,
        color: fg,
        borderBottom: `1px solid ${border}`,
        display: "flex",
        flexDirection: "column",
        fontSize: 11,
        userSelect: "none",
      }}
    >
      {/* Top Control Row */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          padding: "5px 10px",
          flexWrap: "wrap",
        }}
      >
        {/* Left group: Brand pill + Brush selector */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {/* Brand Pill */}
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "2px 8px",
              borderRadius: 999,
              border: `1px solid ${border}`,
              background: bg,
              fontWeight: 600,
              fontSize: 11,
            }}
          >
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: "50%",
                background: accent,
                boxShadow: `0 0 6px ${accent}`,
                flexShrink: 0,
              }}
            />
            <span>Zonotope Ribbon</span>
            <span
              style={{
                fontFamily: "monospace",
                fontSize: 10,
                padding: "0 5px",
                borderRadius: 999,
                background: isDark ? "rgba(56,189,248,0.16)" : "rgba(9,105,218,0.1)",
                color: accent,
              }}
              title={`Active perturbation generators: ${summaries.length}`}
            >
              m = {summaries.length}
            </span>
            {pendingCount > 0 && (
              <span
                style={{
                  fontFamily: "monospace",
                  fontSize: 10,
                  padding: "0 5px",
                  borderRadius: 999,
                  background: isDark ? "rgba(251,191,36,0.18)" : "rgba(154,103,0,0.12)",
                  color: amber,
                  border: `1px solid ${amber}`,
                }}
                title={`${pendingCount} uncommitted visual label override(s)`}
              >
                {pendingCount} {pendingCount === 1 ? "label" : "labels"}
              </span>
            )}
          </div>

          {/* Brush Selector Segmented Pills */}
          <div
            role="group"
            aria-label="Zonotope Labeling Brush"
            style={{
              display: "inline-flex",
              alignItems: "center",
              padding: 2,
              borderRadius: 7,
              border: `1px solid ${border}`,
              background: bg,
              gap: 2,
            }}
          >
            {BRUSH_OPTIONS.map((opt) => {
              const active = state.activeBrush === opt.mode;
              return (
                <button
                  key={opt.mode}
                  type="button"
                  aria-pressed={active}
                  title={opt.title}
                  onClick={() => onChangeBrush(opt.mode)}
                  style={{
                    padding: "2px 7px",
                    borderRadius: 5,
                    border: active ? `1px solid ${accent}` : "1px solid transparent",
                    background: active ? (isDark ? "rgba(56,189,248,0.18)" : "rgba(9,105,218,0.12)") : "transparent",
                    color: active ? accent : fgMuted,
                    fontSize: 10.5,
                    fontWeight: active ? 700 : 500,
                    cursor: "pointer",
                    lineHeight: 1.4,
                    whiteSpace: "nowrap",
                  }}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Center/Right group: Stress scrub + Quick actions + Feasibility pill + Collapse */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {/* Global Stress-Test Scrub Bar */}
          <label
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "2px 8px",
              borderRadius: 7,
              border: `1px solid ${border}`,
              background: bg,
              fontSize: 10.5,
            }}
            title="Global perturbation stress-test multiplier (0% Nominal → 100% Spec → 200% Stress)"
          >
            <span style={{ color: fgMuted, fontWeight: 600 }}>Stress</span>
            <input
              type="range"
              min={0}
              max={2}
              step={0.05}
              value={state.stressScale}
              onChange={(e) => onChangeStressScale(Number(e.target.value))}
              aria-label="Global stress-test scale"
              style={{ width: 88, margin: 0, accentColor: stressColor, cursor: "pointer" }}
            />
            <span
              style={{
                fontFamily: "monospace",
                fontWeight: 700,
                color: stressColor,
                minWidth: 74,
                textAlign: "right",
              }}
            >
              {stressPct}% {stressRegimeLabel(state.stressScale)}
            </span>
          </label>

          {/* Quick Action Pills */}
          <div style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <button
              type="button"
              onClick={onResetNominal}
              title="Reset all generator coordinates ξ_k = 0 and stress scale to 100% Spec"
              style={{
                padding: "3px 7px",
                borderRadius: 6,
                border: `1px solid ${border}`,
                background: bg,
                color: fg,
                fontSize: 10.5,
                fontFamily: "monospace",
                fontWeight: 600,
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              Reset ξ=0
            </button>
            <button
              type="button"
              onClick={onSnapWorstCase}
              title={
                worstCaseCount > 0
                  ? `Snap all ξ_k to adversarial worst-case corner ξ* (${worstCaseCount} active dims)`
                  : "Snap generators to adversarial worst-case corner ξ*"
              }
              style={{
                padding: "3px 7px",
                borderRadius: 6,
                border: `1px solid ${worstCaseCount > 0 ? amber : border}`,
                background: worstCaseCount > 0 ? (isDark ? "rgba(251,191,36,0.14)" : "rgba(154,103,0,0.08)") : bg,
                color: worstCaseCount > 0 ? amber : fg,
                fontSize: 10.5,
                fontFamily: "monospace",
                fontWeight: 600,
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              Snap ξ*
            </button>
            <button
              type="button"
              aria-pressed={state.scramblePreview}
              onClick={onToggleScramblePreview}
              title="Toggle isomorphic identifier scramble preview (verifies topology invariance under renaming)"
              style={{
                padding: "3px 8px",
                borderRadius: 6,
                border: `1px solid ${state.scramblePreview ? violet : border}`,
                background: state.scramblePreview ? (isDark ? "rgba(167,139,250,0.22)" : "rgba(130,80,223,0.12)") : bg,
                color: state.scramblePreview ? violet : fgMuted,
                fontSize: 10.5,
                fontWeight: state.scramblePreview ? 700 : 600,
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              Scramble
            </button>
          </div>

          {/* Live Constrained-Zonotope Feasibility Status Pill */}
          <button
            type="button"
            aria-expanded={constraintsOpen}
            onClick={() => setConstraintsOpen((prev) => !prev)}
            title="Click to inspect & edit Cξ ≤ d linear constraints"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              padding: "3px 9px",
              borderRadius: 999,
              border: `1px solid ${effectiveFeasible ? emerald : danger}`,
              background: effectiveFeasible
                ? isDark
                  ? "rgba(52,211,153,0.14)"
                  : "rgba(26,127,55,0.1)"
                : isDark
                  ? "rgba(248,113,113,0.18)"
                  : "rgba(207,34,46,0.1)",
              color: effectiveFeasible ? emerald : danger,
              fontSize: 10.5,
              fontWeight: 700,
              fontFamily: "monospace",
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            <span>
              {effectiveFeasible
                ? `✓ Feasible (${Math.round(effectiveVolumeRetention * 100)}% vol)`
                : `⚠ Empty Zonotope Conflict (${effectiveConflictingIds.length})`}
            </span>
            {state.constraints.length > 0 && (
              <span
                style={{
                  fontSize: 9.5,
                  padding: "0 4px",
                  borderRadius: 4,
                  background: bgPill,
                  color: fg,
                }}
              >
                {state.constraints.length} Cξ≤d
              </span>
            )}
            <span style={{ fontSize: 9 }}>{constraintsOpen ? "▴" : "▾"}</span>
          </button>

          {/* Collapse / Expand Chevron */}
          <button
            type="button"
            aria-expanded={!isCollapsed}
            aria-label={isCollapsed ? "Expand generator chips" : "Collapse generator chips"}
            title={isCollapsed ? "Expand ε_1..ε_m generator chips" : "Collapse ε_1..ε_m generator chips"}
            onClick={handleToggleCollapsed}
            style={{
              width: 24,
              height: 24,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: 6,
              border: `1px solid ${border}`,
              background: bg,
              color: fgMuted,
              fontSize: 11,
              cursor: "pointer",
              flexShrink: 0,
            }}
          >
            {isCollapsed ? "▸" : "▾"}
          </button>
        </div>
      </div>

      {/* Expandable Constraints Bar (Cξ ≤ d) */}
      {constraintsOpen && (
        <div
          style={{
            borderTop: `1px solid ${border}`,
            background: bg,
            padding: "8px 10px",
            display: "flex",
            flexDirection: "column",
            gap: 8,
            userSelect: "text",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 8,
              flexWrap: "wrap",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <strong style={{ fontSize: 11 }}>Constrained-Zonotope Linear Constraints (Cξ ≤ d)</strong>
              <span
                style={{
                  fontFamily: "monospace",
                  fontSize: 10,
                  padding: "1px 6px",
                  borderRadius: 4,
                  border: `1px solid ${border}`,
                  background: bgSubtle,
                  color: serverSnapshot ? accent : fgMuted,
                }}
              >
                {serverSnapshot
                  ? `Exact ${serverSnapshot.engine} (${serverSnapshot.elapsedMs.toFixed(1)} ms)`
                  : `Local HC4 (${clientFeasibility.elapsedMs.toFixed(2)} ms)`}
              </span>
              <span style={{ fontSize: 10, color: fgMuted, fontFamily: "monospace" }}>
                {extractedParams.length} numeric param{extractedParams.length === 1 ? "" : "s"} ·{" "}
                {clientFeasibility.summary}
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              {serverFallbackNote && (
                <span style={{ fontSize: 10, color: amber, fontFamily: "monospace" }}>{serverFallbackNote}</span>
              )}
              <button
                type="button"
                disabled={serverChecking || extractedParams.length === 0 || state.constraints.length === 0}
                onClick={() => void runExactServerCheck(true)}
                title="Run exact server-side ConstrainedZonotope feasibility check via /api/v1/recipes/check-constraints"
                style={{
                  padding: "2px 8px",
                  borderRadius: 5,
                  border: `1px solid ${accent}`,
                  background: isDark ? "rgba(56,189,248,0.14)" : "rgba(9,105,218,0.08)",
                  color: accent,
                  fontSize: 10,
                  fontWeight: 600,
                  cursor:
                    serverChecking || extractedParams.length === 0 || state.constraints.length === 0
                      ? "not-allowed"
                      : "pointer",
                  opacity: serverChecking || extractedParams.length === 0 || state.constraints.length === 0 ? 0.5 : 1,
                }}
              >
                {serverChecking ? "Checking…" : "Verify Exact API"}
              </button>
            </div>
          </div>

          {/* Active Constraints List */}
          {state.constraints.length === 0 ? (
            <div style={{ fontSize: 10.5, color: fgMuted, fontStyle: "italic" }}>
              No active Cξ ≤ d constraints yet. Add a linear inequality or equality below to tighten the zonotope box.
            </div>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              {state.constraints.map((c) => {
                const isConflicting = conflictingSet.has(c.id);
                return (
                  <div
                    key={c.id}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "3px 7px",
                      borderRadius: 6,
                      border: `1px solid ${isConflicting ? danger : border}`,
                      background: isConflicting
                        ? isDark
                          ? "rgba(248,113,113,0.18)"
                          : "rgba(207,34,46,0.1)"
                        : bgSubtle,
                      color: isConflicting ? danger : fg,
                      fontFamily: "monospace",
                      fontSize: 10.5,
                    }}
                  >
                    {isConflicting && <span title="Conflicting constraint causing empty zonotope">⚠</span>}
                    <span style={{ fontWeight: 600 }}>{c.expression}</span>
                    <span
                      style={{
                        fontSize: 9,
                        padding: "0 4px",
                        borderRadius: 4,
                        background: bgPill,
                        color: fgMuted,
                      }}
                    >
                      {c.modality}
                    </span>
                    <button
                      type="button"
                      aria-label={`Remove constraint ${c.expression}`}
                      title="Remove constraint"
                      onClick={() => onRemoveConstraint(c.id)}
                      style={{
                        border: "none",
                        background: "transparent",
                        color: isConflicting ? danger : fgMuted,
                        cursor: "pointer",
                        padding: "0 2px",
                        fontSize: 12,
                        lineHeight: 1,
                        fontWeight: 700,
                      }}
                    >
                      ×
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {/* Add Constraint Inline Form */}
          <form
            onSubmit={handleSubmitConstraint}
            style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}
          >
            <input
              type="text"
              value={draftExpr}
              onChange={(e) => {
                setDraftExpr(e.target.value);
                if (parseError) setParseError(null);
              }}
              placeholder="Add Cξ ≤ d (e.g. wall_thickness >= 2.0 or 2*R1 + R2 <= 250)"
              aria-label="Linear constraint expression"
              style={{
                flex: "1 1 260px",
                minWidth: 220,
                background: bgSubtle,
                color: fg,
                border: `1px solid ${parseError ? danger : border}`,
                borderRadius: 5,
                padding: "4px 8px",
                fontSize: 11,
                fontFamily: "monospace",
              }}
            />
            <select
              value={draftModality}
              onChange={(e) => setDraftModality(e.target.value as ConstraintModality)}
              aria-label="Constraint modality"
              style={{
                background: bgSubtle,
                color: fg,
                border: `1px solid ${border}`,
                borderRadius: 5,
                padding: "4px 6px",
                fontSize: 10.5,
                fontFamily: "monospace",
              }}
            >
              {MODALITY_OPTIONS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
            <button
              type="submit"
              style={{
                padding: "4px 10px",
                borderRadius: 5,
                border: `1px solid ${emerald}`,
                background: isDark ? "rgba(52,211,153,0.16)" : "rgba(26,127,55,0.1)",
                color: emerald,
                fontSize: 10.5,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              + Add Cξ ≤ d
            </button>
          </form>

          {parseError && <div style={{ fontSize: 10, color: danger, fontFamily: "monospace" }}>{parseError}</div>}

          {/* Tightened Bounds Preview */}
          {state.constraints.length > 0 && tightenedEntries.length > 0 && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                flexWrap: "wrap",
                fontSize: 10,
                fontFamily: "monospace",
              }}
            >
              <span style={{ color: fgMuted }}>Tightened intervals:</span>
              {tightenedEntries.map((entry) => (
                <span
                  key={entry.name}
                  style={{
                    padding: "1px 6px",
                    borderRadius: 4,
                    background: bgSubtle,
                    border: `1px solid ${border}`,
                    color: fg,
                  }}
                >
                  {entry.name} ∈ [{formatBoundValue(entry.lo)}, {formatBoundValue(entry.hi)}]
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Generator Chips Row (ε_1..ε_m) */}
      {!isCollapsed && (
        <div
          style={{
            borderTop: `1px solid ${border}`,
            padding: "5px 10px",
            display: "flex",
            alignItems: "center",
            gap: 6,
            overflowX: "auto",
            background: bg,
          }}
        >
          {summaries.length === 0 ? (
            <span style={{ fontSize: 10.5, color: fgMuted, fontStyle: "italic", padding: "2px 0" }}>
              Compile or edit model to populate ε_1..ε_m generators (or add Cξ ≤ d constraints)
            </span>
          ) : (
            summaries.map((summary) => {
              const swatch = getGeneratorColor(summary.groupId);
              const isActive = state.activeGroupId === summary.groupId;
              const xiVal = state.xiByGroupId[summary.groupId] ?? 0;
              const worstXi = worstCaseXiByGroupId?.[summary.groupId];
              const relShort = REL_TYPE_SHORT_LABELS[summary.relTypeId] ?? summary.relLabel;

              return (
                <div
                  key={summary.groupId}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "3px 7px",
                    borderRadius: 7,
                    border: `1px solid ${isActive ? swatch.solid : swatch.border}`,
                    background: isActive ? swatch.bg : bgSubtle,
                    boxShadow: isActive ? `0 0 0 1px ${swatch.solid}` : undefined,
                    flexShrink: 0,
                  }}
                >
                  <button
                    type="button"
                    onClick={() => onSelectGroup(isActive ? null : summary.groupId)}
                    title={
                      `${summary.symbolName} · ε_${summary.groupId} (${relShort}, ${summary.spanCount} spans)` +
                      (summary.ontologyIri ? ` · ${summary.ontologyIri}` : "") +
                      (worstXi !== undefined ? ` · ξ*=${formatXi(worstXi)}` : "")
                    }
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 5,
                      border: "none",
                      background: "transparent",
                      color: fg,
                      padding: 0,
                      cursor: "pointer",
                      fontSize: 10.5,
                    }}
                  >
                    <span
                      style={{
                        fontFamily: "monospace",
                        fontWeight: 700,
                        fontSize: 10,
                        padding: "0 4px",
                        borderRadius: 4,
                        background: swatch.bg,
                        border: `1px solid ${swatch.border}`,
                        color: isDark ? swatch.text : swatch.solid,
                      }}
                    >
                      ε_{summary.groupId}
                    </span>
                    <span
                      style={{
                        fontFamily: "monospace",
                        fontWeight: 600,
                        maxWidth: 96,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {summary.symbolName}
                    </span>
                    <span
                      style={{
                        fontSize: 9,
                        fontFamily: "monospace",
                        padding: "0 4px",
                        borderRadius: 4,
                        background: bgPill,
                        color: fgMuted,
                      }}
                    >
                      {relShort}
                    </span>
                  </button>

                  <input
                    type="range"
                    min={-1}
                    max={1}
                    step={0.05}
                    value={xiVal}
                    onChange={(e) => onChangeXi(summary.groupId, Number(e.target.value))}
                    aria-label={`Generator ε_${summary.groupId} (${summary.symbolName}) coordinate ξ`}
                    style={{
                      width: 56,
                      margin: 0,
                      accentColor: swatch.solid,
                      cursor: "pointer",
                    }}
                  />
                  <span
                    style={{
                      fontFamily: "monospace",
                      fontSize: 10,
                      fontWeight: Math.abs(xiVal) > 0.005 ? 700 : 500,
                      color: Math.abs(xiVal) > 0.005 ? (isDark ? swatch.text : swatch.solid) : fgMuted,
                      minWidth: 34,
                      textAlign: "right",
                    }}
                  >
                    {formatXi(xiVal)}
                  </span>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
};

export default ZonotopeGeneratorRibbon;
