// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Pure TypeScript state types, color palette, linear constraint parser,
 * generator summary builder, and API override serializer for the
 * Multi-Modal Zonotope Workbench UI.
 *
 * Intentionally free of `monaco-editor`, DOM, and `@modelscript/runtime` imports
 * so it can execute cleanly in both browser bundles and Node unit tests.
 */

export type ZonotopeBrushMode = "select" | "lock-zero" | "couple-pos" | "couple-neg" | "tolerance-handle";

export type ConstraintModality = "text" | "code" | "2d" | "3d" | "physics";

export interface LinearConstraintSpec {
  id: string;
  expression: string;
  coeffs: Record<string, number>;
  sense: "<=" | ">=" | "==";
  rhs: number;
  modality: ConstraintModality;
}

export interface ModalityPerturbationBudgets {
  textParaphraseRadius: number;
  codeIdentifierScale: number;
  diagramLayoutJitterPx: number;
  diagramAllowRotation: boolean;
  cadToleranceFraction: number;
  physicsParamFraction: number;
}

export interface ZonotopePendingOverride {
  id: string;
  tokenIndex?: number | undefined;
  symbolName?: string | undefined;
  textSnippet?: string | undefined;
  groupId: number;
  relTypeId: number;
  relSign: number;
  modality: ConstraintModality;
  note?: string | undefined;
}

export interface FaultGeneratorSpec {
  id: string;
  componentName: string;
  faultMode: "open_circuit" | "short_circuit" | "stuck_valve" | "sensor_bias" | "actuator_saturation";
  severity: number;
  enabled: boolean;
}

export interface ZonotopeWorkbenchState {
  xiByGroupId: Record<number, number>;
  stressScale: number;
  activeGroupId: number | null;
  constraints: LinearConstraintSpec[];
  budgets: ModalityPerturbationBudgets;
  activeBrush: ZonotopeBrushMode;
  pendingOverrides: ZonotopePendingOverride[];
  faultGenerators: FaultGeneratorSpec[];
  scramblePreview: boolean;
}

export interface ZonotopePaletteSwatch {
  bg: string;
  border: string;
  solid: string;
  text: string;
}

export const DEFAULT_MODALITY_BUDGETS: ModalityPerturbationBudgets = {
  textParaphraseRadius: 0.15,
  codeIdentifierScale: 1.0,
  diagramLayoutJitterPx: 12,
  diagramAllowRotation: false,
  cadToleranceFraction: 0.05,
  physicsParamFraction: 0.05,
};

export function createInitialZonotopeWorkbenchState(): ZonotopeWorkbenchState {
  return {
    xiByGroupId: {},
    stressScale: 1.0,
    activeGroupId: null,
    constraints: [],
    budgets: { ...DEFAULT_MODALITY_BUDGETS },
    activeBrush: "select",
    pendingOverrides: [],
    faultGenerators: [],
    scramblePreview: false,
  };
}

/**
 * 12-color generator palette matching the Monaco hypergraph overlay palette.
 */
export const ZONOTOPE_PALETTE: readonly ZonotopePaletteSwatch[] = [
  { bg: "rgba(56, 189, 248, 0.18)", border: "rgba(56, 189, 248, 0.65)", solid: "#38bdf8", text: "#7dd3fc" }, // sky
  { bg: "rgba(167, 139, 250, 0.18)", border: "rgba(167, 139, 250, 0.65)", solid: "#a78bfa", text: "#c4b5fd" }, // violet
  { bg: "rgba(52, 211, 153, 0.18)", border: "rgba(52, 211, 153, 0.65)", solid: "#34d399", text: "#6ee7b7" }, // emerald
  { bg: "rgba(251, 191, 36, 0.18)", border: "rgba(251, 191, 36, 0.65)", solid: "#fbbf24", text: "#fcd34d" }, // amber
  { bg: "rgba(244, 114, 182, 0.18)", border: "rgba(244, 114, 182, 0.65)", solid: "#f472b6", text: "#f9a8d4" }, // pink
  { bg: "rgba(96, 165, 250, 0.18)", border: "rgba(96, 165, 250, 0.65)", solid: "#60a5fa", text: "#93c5fd" }, // blue
  { bg: "rgba(45, 212, 191, 0.18)", border: "rgba(45, 212, 191, 0.65)", solid: "#2dd4bf", text: "#5eead4" }, // teal
  { bg: "rgba(251, 146, 60, 0.18)", border: "rgba(251, 146, 60, 0.65)", solid: "#fb923c", text: "#fdba74" }, // orange
  { bg: "rgba(192, 132, 252, 0.18)", border: "rgba(192, 132, 252, 0.65)", solid: "#c084fc", text: "#d8b4fe" }, // purple
  { bg: "rgba(163, 230, 53, 0.18)", border: "rgba(163, 230, 53, 0.65)", solid: "#a3e635", text: "#bef264" }, // lime
  { bg: "rgba(248, 113, 113, 0.18)", border: "rgba(248, 113, 113, 0.65)", solid: "#f87171", text: "#fca5a5" }, // red
  { bg: "rgba(34, 211, 238, 0.18)", border: "rgba(34, 211, 238, 0.65)", solid: "#22d3ee", text: "#67e8f9" }, // cyan
];

const LOCKED_SWATCH: ZonotopePaletteSwatch = {
  bg: "rgba(148, 163, 184, 0.14)",
  border: "rgba(148, 163, 184, 0.5)",
  solid: "#94a3b8",
  text: "#cbd5e1",
};

export function getGeneratorColor(groupId: number): ZonotopePaletteSwatch {
  if (!Number.isFinite(groupId) || groupId <= 0) {
    return LOCKED_SWATCH;
  }
  const idx = (Math.trunc(groupId) - 1) % ZONOTOPE_PALETTE.length;
  return ZONOTOPE_PALETTE[idx] ?? LOCKED_SWATCH;
}

export const REL_TYPE_SHORT_LABELS: Record<number, string> = {
  0: "LOCK",
  1: "SYNC",
  2: "INV",
  3: "ISA",
  4: "FLOW ±1",
  5: "UNIT",
  6: "TOL",
};

// ---------------------------------------------------------------------------
// Linear constraint expression parser
// ---------------------------------------------------------------------------

interface LinearToken {
  kind: "num" | "ident" | "plus" | "minus" | "mul" | "div";
  raw: string;
  value?: number;
}

function tokenizeLinearSide(side: string): LinearToken[] | null {
  const tokens: LinearToken[] = [];
  let i = 0;
  const n = side.length;

  while (i < n) {
    const ch = side[i]!;
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === "+") {
      tokens.push({ kind: "plus", raw: ch });
      i++;
      continue;
    }
    if (ch === "-" || ch === "−") {
      tokens.push({ kind: "minus", raw: "-" });
      i++;
      continue;
    }
    if (ch === "*" || ch === "·" || ch === "×") {
      tokens.push({ kind: "mul", raw: "*" });
      i++;
      continue;
    }
    if (ch === "/") {
      tokens.push({ kind: "div", raw: "/" });
      i++;
      continue;
    }

    // Numeric literal (supports decimals and scientific notation)
    if ((ch >= "0" && ch <= "9") || (ch === "." && i + 1 < n && side[i + 1]! >= "0" && side[i + 1]! <= "9")) {
      const rest = side.slice(i);
      const match = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(rest);
      if (!match) return null;
      const numVal = Number(match[0]);
      if (!Number.isFinite(numVal)) return null;
      tokens.push({ kind: "num", raw: match[0], value: numVal });
      i += match[0].length;
      continue;
    }

    // Identifier (supports dotted paths like motor.R, excluding trailing dot)
    if ((ch >= "A" && ch <= "Z") || (ch >= "a" && ch <= "z") || ch === "_") {
      const rest = side.slice(i);
      const match = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*/.exec(rest);
      if (!match) return null;
      tokens.push({ kind: "ident", raw: match[0] });
      i += match[0].length;
      continue;
    }

    // Unexpected character (e.g., parentheses, exponents, invalid punctuation)
    return null;
  }

  return tokens;
}

interface ParsedLinearSide {
  coeffs: Record<string, number>;
  constant: number;
}

function parseLinearSide(side: string): ParsedLinearSide | null {
  const tokens = tokenizeLinearSide(side);
  if (!tokens || tokens.length === 0) return null;

  const coeffs: Record<string, number> = {};
  let constant = 0;
  let idx = 0;

  while (idx < tokens.length) {
    let sign = 1;
    let sawSign = false;
    while (idx < tokens.length && (tokens[idx]!.kind === "plus" || tokens[idx]!.kind === "minus")) {
      if (tokens[idx]!.kind === "minus") sign = -sign;
      sawSign = true;
      idx++;
    }

    // Require an explicit +/- separator between terms after the first term
    if (idx > 0 && !sawSign) {
      return null;
    }
    if (idx >= tokens.length) {
      return null;
    }

    // Parse multiplicative term: scalar * ident, ident * scalar, ident / scalar, scalar, or ident
    let coeff = sign;
    let varName: string | null = null;
    let consumedFactor = false;

    while (idx < tokens.length) {
      const tok = tokens[idx]!;
      if (tok.kind === "plus" || tok.kind === "minus") {
        break;
      }

      if (!consumedFactor) {
        if (tok.kind === "num") {
          coeff *= tok.value!;
          consumedFactor = true;
          idx++;
          // Allow implicit multiplication like `2x`
          if (idx < tokens.length && tokens[idx]!.kind === "ident") {
            if (varName !== null) return null;
            varName = tokens[idx]!.raw;
            idx++;
          }
          continue;
        }
        if (tok.kind === "ident") {
          varName = tok.raw;
          consumedFactor = true;
          idx++;
          continue;
        }
        // Leading `*` or `/` without operand
        return null;
      }

      if (tok.kind === "mul" || tok.kind === "div") {
        const isDiv = tok.kind === "div";
        idx++;
        if (idx >= tokens.length) return null;

        // Allow signed divisor/multiplier like `2 * -3`
        let factorSign = 1;
        while (idx < tokens.length && (tokens[idx]!.kind === "plus" || tokens[idx]!.kind === "minus")) {
          if (tokens[idx]!.kind === "minus") factorSign = -factorSign;
          idx++;
        }
        if (idx >= tokens.length) return null;

        const nextTok = tokens[idx]!;
        if (nextTok.kind === "num") {
          const val = nextTok.value! * factorSign;
          if (isDiv) {
            if (Math.abs(val) < 1e-15) return null;
            coeff /= val;
          } else {
            coeff *= val;
          }
          idx++;
          continue;
        }
        if (nextTok.kind === "ident") {
          // Nonlinear (ident * ident) or division by variable (1 / ident)
          if (isDiv || varName !== null) return null;
          coeff *= factorSign;
          varName = nextTok.raw;
          idx++;
          continue;
        }
        return null;
      }

      // Unexpected adjacent token without operator
      return null;
    }

    if (!consumedFactor) return null;

    if (varName !== null) {
      coeffs[varName] = (coeffs[varName] ?? 0) + coeff;
    } else {
      constant += coeff;
    }
  }

  return { coeffs, constant };
}

function deterministicConstraintId(expression: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < expression.length; i++) {
    hash ^= expression.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `lc_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

/**
 * Parses a linear constraint string such as `"wall_thickness >= 2.0"`,
 * `"2*wall_thickness + bore <= 20"`, `"R1 - R2 == 0"`, or `"0.5 * L1 + 1.5 * L2 <= 10"`
 * into canonical `sum_i (c_i * x_i) <sense> rhs` form.
 *
 * Returns `null` for malformed, empty, constant-only, or nonlinear expressions.
 */
export function parseLinearConstraintExpression(
  expression: string,
  modality: ConstraintModality = "physics",
  id?: string,
): LinearConstraintSpec | null {
  const trimmed = expression.trim();
  if (!trimmed) return null;

  // Locate a single relational operator (reject strict < / > or multiple operators)
  const opMatches = Array.from(trimmed.matchAll(/<=|>=|==|≤|≥|(?<![<>!=])=(?!=)|<|>/g));
  if (opMatches.length !== 1) return null;

  const match = opMatches[0]!;
  const rawOp = match[0];
  let sense: "<=" | ">=" | "==";
  if (rawOp === "<=" || rawOp === "≤") {
    sense = "<=";
  } else if (rawOp === ">=" || rawOp === "≥") {
    sense = ">=";
  } else if (rawOp === "==" || rawOp === "=") {
    sense = "==";
  } else {
    return null;
  }

  const opIndex = match.index;
  if (opIndex === undefined) return null;

  const lhsStr = trimmed.slice(0, opIndex).trim();
  const rhsStr = trimmed.slice(opIndex + rawOp.length).trim();
  if (!lhsStr || !rhsStr) return null;

  const lhs = parseLinearSide(lhsStr);
  const rhs = parseLinearSide(rhsStr);
  if (!lhs || !rhs) return null;

  const combinedCoeffs: Record<string, number> = {};
  const allVars = new Set([...Object.keys(lhs.coeffs), ...Object.keys(rhs.coeffs)]);
  for (const v of allVars) {
    const net = (lhs.coeffs[v] ?? 0) - (rhs.coeffs[v] ?? 0);
    if (Math.abs(net) > 1e-12) {
      combinedCoeffs[v] = Object.is(net, -0) ? 0 : net;
    }
  }

  if (Object.keys(combinedCoeffs).length === 0) {
    return null;
  }

  const netRhsRaw = rhs.constant - lhs.constant;
  const netRhs = Math.abs(netRhsRaw) < 1e-12 ? 0 : netRhsRaw;

  return {
    id: id && id.trim().length > 0 ? id.trim() : deterministicConstraintId(trimmed),
    expression: trimmed,
    coeffs: combinedCoeffs,
    sense,
    rhs: netRhs,
    modality,
  };
}

// ---------------------------------------------------------------------------
// Generator summary builder
// ---------------------------------------------------------------------------

export interface GeneratorSummary {
  groupId: number;
  symbolName: string;
  relTypeId: number;
  relLabel: string;
  relSign: number;
  spanCount: number;
  ontologyIri?: string | undefined;
}

export interface GeneratorSummaryInputSpan {
  groupId: number;
  relTypeId: number;
  relSign: number;
  symbolName?: string | undefined;
  text: string;
  ontologyIri?: string | undefined;
}

/**
 * Aggregates active perturbation generator spans (`groupId > 0`) from a hypergraph
 * record into a sorted summary list ordered ascending by `groupId`.
 */
export function buildGeneratorSummaries(record: { spans: GeneratorSummaryInputSpan[] } | null): GeneratorSummary[] {
  if (!record || record.spans.length === 0) return [];

  interface Acc {
    groupId: number;
    symbolName: string;
    relTypeCounts: Map<number, number>;
    firstRelTypeId: number;
    relSign: number;
    spanCount: number;
    ontologyIri?: string | undefined;
  }

  const byGroup = new Map<number, Acc>();

  for (const span of record.spans) {
    if (span.groupId <= 0) continue;
    let acc = byGroup.get(span.groupId);
    if (!acc) {
      const initialName = (span.symbolName && span.symbolName.trim()) || span.text.trim() || `ε_${span.groupId}`;
      acc = {
        groupId: span.groupId,
        symbolName: initialName,
        relTypeCounts: new Map<number, number>(),
        firstRelTypeId: span.relTypeId,
        relSign: span.relSign,
        spanCount: 0,
        ontologyIri: span.ontologyIri,
      };
      byGroup.set(span.groupId, acc);
    }

    acc.spanCount += 1;
    acc.relTypeCounts.set(span.relTypeId, (acc.relTypeCounts.get(span.relTypeId) ?? 0) + 1);

    if (span.symbolName && span.symbolName.trim() && acc.symbolName === `ε_${span.groupId}`) {
      acc.symbolName = span.symbolName.trim();
    }
    if (acc.relSign === 0 && span.relSign !== 0) {
      acc.relSign = span.relSign;
    }
    if (!acc.ontologyIri && span.ontologyIri) {
      acc.ontologyIri = span.ontologyIri;
    }
  }

  const summaries: GeneratorSummary[] = [];
  for (const acc of byGroup.values()) {
    let primaryRelTypeId = acc.firstRelTypeId;
    let bestCount = -1;
    for (const [relTypeId, count] of acc.relTypeCounts.entries()) {
      if (count > bestCount || (count === bestCount && relTypeId < primaryRelTypeId)) {
        bestCount = count;
        primaryRelTypeId = relTypeId;
      }
    }

    const summary: GeneratorSummary = {
      groupId: acc.groupId,
      symbolName: acc.symbolName,
      relTypeId: primaryRelTypeId,
      relLabel: REL_TYPE_SHORT_LABELS[primaryRelTypeId] ?? `REL_${primaryRelTypeId}`,
      relSign: acc.relSign,
      spanCount: acc.spanCount,
    };
    if (acc.ontologyIri !== undefined) {
      summary.ontologyIri = acc.ontologyIri;
    }
    summaries.push(summary);
  }

  summaries.sort((a, b) => a.groupId - b.groupId);
  return summaries;
}

// ---------------------------------------------------------------------------
// API override converter
// ---------------------------------------------------------------------------

export interface ApiHypergraphOverride {
  tokenIndex?: number;
  symbolName?: string;
  groupId: number;
  relTypeId: number;
  relSign: number;
}

/**
 * Converts workbench pending overrides into the minimal payload format
 * accepted by `POST /api/v1/recipes/patches`.
 */
export function toApiHypergraphOverrides(overrides: ZonotopePendingOverride[]): ApiHypergraphOverride[] {
  return overrides.map((o) => {
    const out: ApiHypergraphOverride = {
      groupId: o.groupId,
      relTypeId: o.relTypeId,
      relSign: o.relSign,
    };
    if (o.tokenIndex !== undefined) {
      out.tokenIndex = o.tokenIndex;
    }
    if (o.symbolName !== undefined && o.symbolName.length > 0) {
      out.symbolName = o.symbolName;
    }
    return out;
  });
}
