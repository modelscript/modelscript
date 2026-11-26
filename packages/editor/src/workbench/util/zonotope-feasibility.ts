// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Pure client-side zonotope feasibility checker (iterative HC4 interval contraction),
 * multi-dialect numeric parameter extractor, deterministic text paraphrase neighborhood
 * generator, and isomorphic identifier rename scrambler.
 *
 * Intentionally free of `monaco-editor`, DOM, and `@modelscript/runtime` imports
 * so it can execute cleanly in both browser bundles and Node unit tests.
 */

import type {
  ConstraintModality,
  LinearConstraintSpec,
  ModalityPerturbationBudgets,
} from "./zonotope-workbench-state.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NumericParamSpec {
  name: string;
  nominal: number;
  halfWidth: number;
  unit?: string | undefined;
  modality?: ConstraintModality | undefined;
}

export interface FeasibilityCheckResult {
  feasible: boolean;
  conflictingConstraintIds: string[];
  tightenedBounds: Record<string, [number, number]>;
  nominalBounds: Record<string, [number, number]>;
  volumeRetention: number;
  feasibilityRate: number;
  estimatedMShift: number;
  summary: string;
  elapsedMs: number;
}

export interface ParaphraseVariant {
  label: string;
  kind: "unit_equiv" | "synonym" | "bound_reformulation";
  text: string;
  epsilonDistance: number;
}

export interface IsomorphicScrambleSpan {
  groupId: number;
  relTypeId: number;
  relSign: number;
  text: string;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  symbolName?: string | undefined;
}

export interface IsomorphicScrambleResult {
  scrambledSource: string;
  renameMap: Record<string, string>;
  preservedLockedCount: number;
  scrambledGroupCount: number;
  topologySignatureBefore: string;
  topologySignatureAfter: string;
  invariant: boolean;
}

// ---------------------------------------------------------------------------
// Parameter extraction from source (Modelica, ModelScript, SysML2, CAD, prose)
// ---------------------------------------------------------------------------

const GEOMETRIC_NAME_RE =
  /(?:wall|thick|bore|radius|\brad\b|^r_|_r$|length|\blen\b|width|height|diam|\bdia\b|clear|fillet|chamfer|pitch|gap|depth|outer|inner|flange|rib|hole|slot|margin|offset|\btol)/i;

const RESERVED_KEYWORDS = new Set([
  "if",
  "then",
  "else",
  "elseif",
  "for",
  "while",
  "loop",
  "end",
  "model",
  "class",
  "block",
  "record",
  "package",
  "function",
  "connector",
  "equation",
  "algorithm",
  "parameter",
  "constant",
  "discrete",
  "final",
  "Real",
  "Integer",
  "Boolean",
  "String",
  "attribute",
  "part",
  "def",
  "return",
  "true",
  "false",
  "and",
  "or",
  "not",
  "in",
  "when",
  "import",
  "extends",
  "annotation",
  "default",
  "let",
  "const",
  "var",
]);

const KNOWN_UNIT_RE =
  /^(?:mm|cm|m|km|um|µm|in|ft|kg|g|mg|N|kN|MN|Pa|kPa|MPa|GPa|bar|psi|K|°C|degC|C|s|ms|us|µs|min|h|Hz|kHz|MHz|GHz|V|mV|kV|A|mA|kA|W|mW|kW|MW|J|kJ|MJ|F|uF|µF|nF|pF|H|mH|uH|µH|ohm|Ohm|kOhm|MOhm|Ω|kΩ|MΩ|rad|deg|rpm|Nm|N·m|%)(?=$|[\s,;.)\]])/;

const NUM_RE = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/;

/**
 * Masks comments (`//...`, `/*...*\/`) and double-quoted strings (`"..."`)
 * with spaces while preserving exact indices and newline positions.
 */
function maskCommentsAndStrings(source: string): string {
  const chars = source.split("");
  const n = chars.length;
  let i = 0;

  while (i < n) {
    const c = chars[i]!;
    const next = i + 1 < n ? chars[i + 1] : "";

    if (c === "/" && next === "/") {
      chars[i] = " ";
      chars[i + 1] = " ";
      i += 2;
      while (i < n && chars[i] !== "\n") {
        chars[i] = " ";
        i++;
      }
      continue;
    }

    if (c === "/" && next === "*") {
      chars[i] = " ";
      chars[i + 1] = " ";
      i += 2;
      while (i < n) {
        if (chars[i] === "*" && i + 1 < n && chars[i + 1] === "/") {
          chars[i] = " ";
          chars[i + 1] = " ";
          i += 2;
          break;
        }
        if (chars[i] !== "\n") {
          chars[i] = " ";
        }
        i++;
      }
      continue;
    }

    if (c === '"') {
      chars[i] = " ";
      i++;
      while (i < n) {
        if (chars[i] === "\\" && i + 1 < n) {
          if (chars[i] !== "\n") chars[i] = " ";
          if (chars[i + 1] !== "\n") chars[i + 1] = " ";
          i += 2;
          continue;
        }
        const cur = chars[i]!;
        if (cur !== "\n") chars[i] = " ";
        i++;
        if (cur === '"') break;
      }
      continue;
    }

    i++;
  }

  return chars.join("");
}

function isIdentChar(ch: string): boolean {
  return (ch >= "A" && ch <= "Z") || (ch >= "a" && ch <= "z") || (ch >= "0" && ch <= "9") || ch === "_";
}

function isIdentStart(ch: string): boolean {
  return (ch >= "A" && ch <= "Z") || (ch >= "a" && ch <= "z") || ch === "_";
}

function extractUnitFromModifier(rawModifier: string): string | undefined {
  const match = /\bunit\s*=\s*"([^"]+)"/.exec(rawModifier);
  return match ? match[1] : undefined;
}

/**
 * Extracts numeric parameter assignments from Modelica, ModelScript, SysML2,
 * OpenSCAD/CAD, and specification prose, assigning modality and perturbation
 * half-widths from `budgets` scaled by `stressScale`.
 */
export function extractNumericParamsFromSource(
  source: string,
  budgets: ModalityPerturbationBudgets,
  stressScale = 1.0,
): NumericParamSpec[] {
  if (!source) return [];

  const masked = maskCommentsAndStrings(source);
  const scale = Number.isFinite(stressScale) && stressScale >= 0 ? stressScale : 1.0;
  const seen = new Set<string>();
  const results: NumericParamSpec[] = [];

  const n = masked.length;
  let parenDepth = 0;

  for (let i = 0; i < n; i++) {
    const ch = masked[i]!;
    if (ch === "(") {
      parenDepth++;
      continue;
    }
    if (ch === ")") {
      parenDepth = Math.max(0, parenDepth - 1);
      continue;
    }

    if (parenDepth !== 0) continue;

    // Detect assignment operator: `=`, `:=`, or `:` (key-value)
    let opLen = 0;
    let isColonKeyVal = false;
    if (ch === ":" && i + 1 < n && masked[i + 1] === "=") {
      opLen = 2;
    } else if (ch === "=") {
      const prev = i > 0 ? masked[i - 1]! : "";
      const next = i + 1 < n ? masked[i + 1]! : "";
      // Skip `==`, `!=`, `<=`, `>=`, `=>`, `:=` (handled at `:`)
      if (prev === "=" || prev === "!" || prev === "<" || prev === ">" || prev === ":") {
        continue;
      }
      if (next === "=" || next === ">") {
        continue;
      }
      opLen = 1;
    } else if (ch === ":") {
      const prev = i > 0 ? masked[i - 1]! : "";
      const next = i + 1 < n ? masked[i + 1]! : "";
      if (prev === ":" || next === ":") continue;
      opLen = 1;
      isColonKeyVal = true;
    } else {
      continue;
    }

    // Check RHS starts with a numeric literal (after horizontal whitespace)
    let rhsStart = i + opLen;
    while (rhsStart < n && (masked[rhsStart] === " " || masked[rhsStart] === "\t")) {
      rhsStart++;
    }
    if (rhsStart >= n) continue;

    const numMatch = NUM_RE.exec(masked.slice(rhsStart));
    if (!numMatch) continue;
    const numStr = numMatch[0];
    const nominal = Number(numStr);
    if (!Number.isFinite(nominal)) continue;

    // Reject compound expressions like `x = 2 * y` or `x = 1 + a`
    let afterNum = rhsStart + numStr.length;
    while (afterNum < n && (masked[afterNum] === " " || masked[afterNum] === "\t")) {
      afterNum++;
    }
    const nextChar = afterNum < n ? masked[afterNum]! : "";
    if (nextChar === "*" || nextChar === "/" || nextChar === "+" || nextChar === "-" || nextChar === "^") {
      continue;
    }

    // Extract optional trailing unit: `[N]` or `mm` / `kPa` / etc.
    let unit: string | undefined;
    if (nextChar === "[") {
      const closeIdx = source.indexOf("]", afterNum + 1);
      if (closeIdx > afterNum + 1 && closeIdx - afterNum < 24) {
        const candidateUnit = source.slice(afterNum + 1, closeIdx).trim();
        if (candidateUnit && !candidateUnit.includes("\n")) {
          unit = candidateUnit;
        }
      }
    } else {
      const unitMatch = KNOWN_UNIT_RE.exec(source.slice(afterNum));
      if (unitMatch) {
        unit = unitMatch[0];
      }
    }

    // Walk backward from `i` (within the current line) to find the parameter name
    const lineStart = masked.lastIndexOf("\n", i - 1) + 1;
    let cursor = i - 1;
    let modifierUnit: string | undefined;

    const skipSpacesBack = (): void => {
      while (cursor >= lineStart && (masked[cursor] === " " || masked[cursor] === "\t")) {
        cursor--;
      }
    };

    skipSpacesBack();

    if (!isColonKeyVal) {
      // Optional `default` keyword (SysML2: `attribute isp : Real default := 310.0;`)
      if (cursor >= lineStart) {
        let wordEnd = cursor + 1;
        let wordStart = wordEnd;
        while (wordStart > lineStart && isIdentChar(masked[wordStart - 1]!)) {
          wordStart--;
        }
        const word = masked.slice(wordStart, wordEnd);
        if (word === "default") {
          cursor = wordStart - 1;
          skipSpacesBack();
        }
      }

      // Optional Modelica modifier `(...)` right before `=`
      if (cursor >= lineStart && masked[cursor] === ")") {
        const closePos = cursor;
        let depth = 1;
        cursor--;
        while (cursor >= lineStart && depth > 0) {
          if (masked[cursor] === ")") depth++;
          else if (masked[cursor] === "(") depth--;
          cursor--;
        }
        if (depth === 0) {
          modifierUnit = extractUnitFromModifier(source.slice(cursor + 1, closePos + 1));
          skipSpacesBack();
        }
      }

      // Optional SysML2 type annotation `: Real` right before `=` / `default`
      if (cursor >= lineStart) {
        const typeEnd = cursor + 1;
        let typeStart = typeEnd;
        while (typeStart > lineStart && (isIdentChar(masked[typeStart - 1]!) || masked[typeStart - 1] === ".")) {
          typeStart--;
        }
        let checkColon = typeStart - 1;
        while (checkColon >= lineStart && (masked[checkColon] === " " || masked[checkColon] === "\t")) {
          checkColon--;
        }
        if (checkColon >= lineStart && masked[checkColon] === ":") {
          cursor = checkColon - 1;
          skipSpacesBack();
        }
      }
    }

    // Grab identifier at `cursor`
    if (cursor < lineStart || !isIdentChar(masked[cursor]!)) {
      continue;
    }
    const nameEnd = cursor + 1;
    let nameStart = nameEnd;
    while (nameStart > lineStart && isIdentChar(masked[nameStart - 1]!)) {
      nameStart--;
    }
    const name = masked.slice(nameStart, nameEnd);
    if (!name || !isIdentStart(name[0]!) || RESERVED_KEYWORDS.has(name)) {
      continue;
    }

    // Skip if preceded by `.` (e.g. `obj.prop = 1`? Actually avoid accidental partial matches like `0.5`)
    if (nameStart > lineStart && masked[nameStart - 1] === ".") {
      continue;
    }

    if (seen.has(name)) continue;
    seen.add(name);

    const isGeometric = GEOMETRIC_NAME_RE.test(name);
    const modality: ConstraintModality = isGeometric ? "3d" : "physics";
    const fraction = Math.max(0, isGeometric ? budgets.cadToleranceFraction : budgets.physicsParamFraction);
    const halfWidth = Math.abs(nominal) > 1e-15 ? Math.abs(nominal) * fraction * scale : fraction * scale;

    const spec: NumericParamSpec = {
      name,
      nominal,
      halfWidth,
      modality,
    };
    const resolvedUnit = unit ?? modifierUnit;
    if (resolvedUnit !== undefined) {
      spec.unit = resolvedUnit;
    }
    results.push(spec);
  }

  return results;
}

// ---------------------------------------------------------------------------
// Iterative HC4 / linear-inequality interval propagation feasibility checker
// ---------------------------------------------------------------------------

interface NormalizedHalfSpace {
  id: string;
  entries: Array<[string, number]>;
  rhs: number;
}

const FEASIBILITY_EPS = 1e-9;
const TIGHTEN_EPS = 1e-12;
const MAX_HC4_ITERATIONS = 16;

function nowMs(): number {
  return typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now();
}

function normalizeConstraints(constraints: LinearConstraintSpec[]): NormalizedHalfSpace[] {
  const halfSpaces: NormalizedHalfSpace[] = [];

  for (const c of constraints) {
    const posEntries: Array<[string, number]> = [];
    const negEntries: Array<[string, number]> = [];

    for (const [varName, coeff] of Object.entries(c.coeffs)) {
      if (!Number.isFinite(coeff) || Math.abs(coeff) < 1e-15) continue;
      posEntries.push([varName, coeff]);
      negEntries.push([varName, -coeff]);
    }
    if (posEntries.length === 0) continue;

    if (c.sense === "<=") {
      halfSpaces.push({ id: c.id, entries: posEntries, rhs: c.rhs });
    } else if (c.sense === ">=") {
      halfSpaces.push({ id: c.id, entries: negEntries, rhs: -c.rhs });
    } else {
      // `==` decomposes into both `<=` and `>=`
      halfSpaces.push({ id: c.id, entries: posEntries, rhs: c.rhs });
      halfSpaces.push({ id: c.id, entries: negEntries, rhs: -c.rhs });
    }
  }

  return halfSpaces;
}

function evalLinearInterval(entries: Array<[string, number]>, bounds: Map<string, [number, number]>): [number, number] {
  let minVal = 0;
  let maxVal = 0;
  for (const [varName, coeff] of entries) {
    const b = bounds.get(varName);
    const lo = b ? b[0] : -Infinity;
    const hi = b ? b[1] : Infinity;
    if (coeff > 0) {
      minVal += coeff * lo;
      maxVal += coeff * hi;
    } else {
      minVal += coeff * hi;
      maxVal += coeff * lo;
    }
  }
  return [minVal, maxVal];
}

/**
 * Checks feasibility of a parameter zonotope box under a set of linear
 * constraints using iterative HC4 / linear-inequality interval propagation
 * (up to 16 fixed-point iterations).
 */
export function checkZonotopeFeasibility(
  params: NumericParamSpec[],
  constraints: LinearConstraintSpec[],
  stressScale = 1.0,
): FeasibilityCheckResult {
  const t0 = nowMs();
  const scale = Number.isFinite(stressScale) && stressScale >= 0 ? stressScale : 1.0;

  const nominalBounds: Record<string, [number, number]> = {};
  const workingBounds = new Map<string, [number, number]>();

  for (const p of params) {
    const hw = Math.max(0, Number.isFinite(p.halfWidth) ? p.halfWidth : 0) * scale;
    const lo = p.nominal - hw;
    const hi = p.nominal + hw;
    nominalBounds[p.name] = [lo, hi];
    workingBounds.set(p.name, [lo, hi]);
  }

  const halfSpaces = normalizeConstraints(constraints);
  for (const hs of halfSpaces) {
    for (const [varName] of hs.entries) {
      if (!workingBounds.has(varName)) {
        workingBounds.set(varName, [-Infinity, Infinity]);
      }
    }
  }

  const conflictingIds = new Set<string>();
  const activeTighteningIds = new Set<string>();
  let feasible = true;

  for (let iter = 0; iter < MAX_HC4_ITERATIONS; iter++) {
    let changed = false;

    for (const hs of halfSpaces) {
      const [minLhs] = evalLinearInterval(hs.entries, workingBounds);
      if (minLhs > hs.rhs + FEASIBILITY_EPS) {
        conflictingIds.add(hs.id);
        feasible = false;
        continue;
      }

      // Interval contraction: a_i * x_i <= rhs - min(sum_{j != i} a_j * x_j)
      for (let i = 0; i < hs.entries.length; i++) {
        const [varName, coeff] = hs.entries[i]!;
        let restMin = 0;
        let restFinite = true;

        for (let j = 0; j < hs.entries.length; j++) {
          if (i === j) continue;
          const [otherName, otherCoeff] = hs.entries[j]!;
          const ob = workingBounds.get(otherName);
          const oLo = ob ? ob[0] : -Infinity;
          const oHi = ob ? ob[1] : Infinity;
          const termMin = otherCoeff > 0 ? otherCoeff * oLo : otherCoeff * oHi;
          if (!Number.isFinite(termMin)) {
            restFinite = false;
            break;
          }
          restMin += termMin;
        }

        if (!restFinite) continue;

        const rhsRemaining = hs.rhs - restMin;
        const cur = workingBounds.get(varName) ?? [-Infinity, Infinity];
        const [lo, hi] = cur;

        if (coeff > 0) {
          const newHi = rhsRemaining / coeff;
          if (newHi < lo - FEASIBILITY_EPS) {
            conflictingIds.add(hs.id);
            feasible = false;
          } else if (newHi < hi - TIGHTEN_EPS) {
            workingBounds.set(varName, [lo, Math.max(lo, newHi)]);
            activeTighteningIds.add(hs.id);
            changed = true;
          }
        } else {
          // coeff < 0 flips inequality: x_i >= rhsRemaining / coeff
          const newLo = rhsRemaining / coeff;
          if (newLo > hi + FEASIBILITY_EPS) {
            conflictingIds.add(hs.id);
            feasible = false;
          } else if (newLo > lo + TIGHTEN_EPS) {
            workingBounds.set(varName, [Math.min(hi, newLo), hi]);
            activeTighteningIds.add(hs.id);
            changed = true;
          }
        }
      }
    }

    if (!changed) break;
  }

  // Final verification pass to catch any residual conflicts after the last tightening step
  for (const hs of halfSpaces) {
    const [minLhs] = evalLinearInterval(hs.entries, workingBounds);
    if (minLhs > hs.rhs + FEASIBILITY_EPS) {
      conflictingIds.add(hs.id);
      feasible = false;
    }
  }

  const tightenedBounds: Record<string, [number, number]> = {};
  for (const p of params) {
    const b = workingBounds.get(p.name) ?? nominalBounds[p.name]!;
    tightenedBounds[p.name] = [b[0], b[1]];
  }
  for (const [varName, b] of workingBounds.entries()) {
    if (!(varName in tightenedBounds) && Number.isFinite(b[0]) && Number.isFinite(b[1])) {
      tightenedBounds[varName] = [b[0], b[1]];
    }
  }

  // Compute geometric mean width retention and overall box feasibility rate
  let volumeRetention = 1;
  let feasibilityRate = 1;

  if (!feasible) {
    volumeRetention = 0;
    feasibilityRate = 0;
  } else {
    const ratios: number[] = [];
    for (const p of params) {
      const nom = nominalBounds[p.name]!;
      const tight = tightenedBounds[p.name]!;
      const nomWidth = nom[1] - nom[0];
      if (nomWidth > TIGHTEN_EPS) {
        const tightWidth = Math.max(0, tight[1] - tight[0]);
        ratios.push(Math.min(1, Math.max(0, tightWidth / nomWidth)));
      }
    }

    if (ratios.length > 0) {
      if (ratios.some((r) => r <= TIGHTEN_EPS)) {
        volumeRetention = 0;
        feasibilityRate = 0;
      } else {
        let logSum = 0;
        let prod = 1;
        for (const r of ratios) {
          logSum += Math.log(r);
          prod *= r;
        }
        volumeRetention = Math.min(1, Math.max(0, Math.exp(logSum / ratios.length)));
        feasibilityRate = Math.min(1, Math.max(0, prod));
      }
    }
  }

  const conflictingConstraintIds = Array.from(conflictingIds);
  const stressOverhead = Math.max(0, scale - 1) * Math.max(1, params.length);
  const estimatedMShift =
    Math.round((activeTighteningIds.size + conflictingConstraintIds.length * 2 + stressOverhead) * 100) / 100;

  const summary = !feasible
    ? `Infeasible: ${conflictingConstraintIds.length} conflicting constraint(s) [${conflictingConstraintIds.join(", ")}].`
    : constraints.length === 0
      ? `Feasible (unconstrained across ${params.length} parameter(s), 100% volume retained).`
      : `Feasible across ${constraints.length} constraint(s) (${Math.round(volumeRetention * 100)}% volume retained, ${params.length} parameter(s)).`;

  const elapsedMs = Math.max(0, nowMs() - t0);

  return {
    feasible,
    conflictingConstraintIds,
    tightenedBounds,
    nominalBounds,
    volumeRetention,
    feasibilityRate,
    estimatedMShift,
    summary,
    elapsedMs,
  };
}

// ---------------------------------------------------------------------------
// Deterministic semantic-invariance paraphrase neighborhood (ε_text)
// ---------------------------------------------------------------------------

function formatCleanNumber(val: number): string {
  const rounded = Math.round(val * 10000) / 10000;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

function applyUnitEquivalence(sentence: string): string {
  let out = sentence;

  // Celsius -> Kelvin (must run before Kelvin -> Celsius using sentinel or single-pass regex)
  let didTemp = false;
  out = out.replace(/(-?\d+(?:\.\d+)?)\s*(?:°\s*C|degC|degrees?\s+Celsius)(?=$|[\s,.;:)\]])/gi, (_m, num: string) => {
    didTemp = true;
    return `${formatCleanNumber(Number(num) + 273.15)} K`;
  });
  if (!didTemp) {
    out = out.replace(
      /(\d+(?:\.\d+)?)\s*(?:Kelvin|K)(?=$|[\s,.;:)\]])/g,
      (_m, num: string) => `${formatCleanNumber(Number(num) - 273.15)} °C`,
    );
  }

  // Length: mm <-> m, cm -> mm
  let didLength = false;
  out = out.replace(/(\d+(?:\.\d+)?)\s*mm\b/g, (_m, num: string) => {
    didLength = true;
    return `${formatCleanNumber(Number(num) / 1000)} m`;
  });
  if (!didLength) {
    out = out.replace(/(\d+(?:\.\d+)?)\s*cm\b/g, (_m, num: string) => {
      didLength = true;
      return `${formatCleanNumber(Number(num) * 10)} mm`;
    });
  }
  if (!didLength) {
    out = out.replace(/(\d+(?:\.\d+)?)\s*m\b/g, (_m, num: string) => `${formatCleanNumber(Number(num) * 1000)} mm`);
  }

  // Pressure: kPa <-> bar, MPa -> bar
  let didPressure = false;
  out = out.replace(/(\d+(?:\.\d+)?)\s*kPa\b/g, (_m, num: string) => {
    didPressure = true;
    return `${formatCleanNumber(Number(num) / 100)} bar`;
  });
  if (!didPressure) {
    out = out.replace(/(\d+(?:\.\d+)?)\s*MPa\b/g, (_m, num: string) => {
      didPressure = true;
      return `${formatCleanNumber(Number(num) * 10)} bar`;
    });
  }
  if (!didPressure) {
    out = out.replace(/(\d+(?:\.\d+)?)\s*bar\b/g, (_m, num: string) => `${formatCleanNumber(Number(num) * 100)} kPa`);
  }

  // Time: ms <-> s
  let didTime = false;
  out = out.replace(/(\d+(?:\.\d+)?)\s*ms\b/g, (_m, num: string) => {
    didTime = true;
    return `${formatCleanNumber(Number(num) / 1000)} s`;
  });
  if (!didTime) {
    out = out.replace(
      /(\d+(?:\.\d+)?)\s*(?:seconds?|sec|s)\b/g,
      (_m, num: string) => `${formatCleanNumber(Number(num) * 1000)} ms`,
    );
  }

  return out;
}

function applyBoundReformulation(sentence: string): string {
  let out = sentence;

  // Requirement modals: SHALL NOT <-> MUST NEVER, SHALL <-> MUST
  if (/\bSHALL\s+NOT\b/.test(out)) {
    out = out.replace(/\bSHALL\s+NOT\b/g, "MUST NEVER");
  } else if (/\bshall\s+not\b/i.test(out)) {
    out = out.replace(/\bshall\s+not\b/gi, "must never");
  } else if (/\bMUST\s+NEVER\b/.test(out)) {
    out = out.replace(/\bMUST\s+NEVER\b/g, "SHALL NOT");
  } else if (/\bmust\s+never\b/i.test(out)) {
    out = out.replace(/\bmust\s+never\b/gi, "shall not");
  } else if (/\bSHALL\b/.test(out)) {
    out = out.replace(/\bSHALL\b/g, "MUST");
  } else if (/\bMUST\b/.test(out)) {
    out = out.replace(/\bMUST\b/g, "SHALL");
  }

  // Inequalities: <= / ≤ <-> at most, >= / ≥ <-> at least
  if (/<=|≤/.test(out)) {
    out = out.replace(/\s*(?:<=|≤)\s*/g, " at most ");
  } else if (/\bat\s+most\b/i.test(out)) {
    out = out.replace(/\bat\s+most\b/gi, "≤");
  } else if (/\bnot\s+exceed\b/i.test(out)) {
    out = out.replace(/\bnot\s+exceed\b/gi, "be ≤");
  }

  if (/>=|≥/.test(out)) {
    out = out.replace(/\s*(?:>=|≥)\s*/g, " at least ");
  } else if (/\bat\s+least\b/i.test(out)) {
    out = out.replace(/\bat\s+least\b/gi, "≥");
  }

  return out.replace(/\s{2,}/g, " ").trim();
}

const ENGINEERING_SYNONYMS: ReadonlyArray<readonly [string, string]> = [
  ["resistive element", "resistor"],
  ["resistor", "resistive element"],
  ["capacitive element", "capacitor"],
  ["capacitor", "capacitive element"],
  ["inductive coil", "inductor"],
  ["inductor", "inductive coil"],
  ["gap allowance", "clearance"],
  ["clearance", "gap allowance"],
  ["shell wall gauge", "wall thickness"],
  ["wall thickness", "shell wall gauge"],
  ["thermal state", "temperature"],
  ["temperature", "thermal state"],
  ["fluid pressure head", "pressure"],
  ["pressure", "fluid pressure head"],
  ["electric potential", "voltage"],
  ["voltage", "electric potential"],
  ["flow control valve", "valve"],
  ["valve", "flow control valve"],
  ["measurement transducer", "sensor"],
  ["sensor", "measurement transducer"],
  ["drive actuator", "actuator"],
  ["actuator", "drive actuator"],
  ["bore diameter", "diameter"],
  ["diameter", "bore diameter"],
  ["housing shell", "enclosure"],
  ["enclosure", "housing shell"],
];

function preserveCase(template: string, replacement: string): string {
  if (!template) return replacement;
  if (template === template.toUpperCase()) return replacement.toUpperCase();
  const first = template[0]!;
  if (first === first.toUpperCase() && first !== first.toLowerCase()) {
    return replacement.charAt(0).toUpperCase() + replacement.slice(1);
  }
  return replacement;
}

function applyEngineeringSynonyms(sentence: string): string {
  let out = sentence;
  const usedTargets = new Set<string>();

  for (const [src, dst] of ENGINEERING_SYNONYMS) {
    if (usedTargets.has(src)) continue;
    const re = new RegExp(`\\b${src.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi");
    if (re.test(out)) {
      out = out.replace(re, (matched) => preserveCase(matched, dst));
      usedTargets.add(dst);
    }
  }

  return out;
}

/**
 * Deterministically produces up to 3 semantic-invariance paraphrases inside
 * the text perturbation radius `ε_text`.
 */
export function computeParaphraseNeighborhood(sentence: string, radius: number): ParaphraseVariant[] {
  const trimmed = sentence.trim();
  if (!trimmed || !Number.isFinite(radius) || radius <= 0) {
    return [];
  }

  const variants: ParaphraseVariant[] = [];
  const seenTexts = new Set<string>([trimmed]);

  const unitText = applyUnitEquivalence(trimmed);
  if (unitText !== trimmed && !seenTexts.has(unitText)) {
    seenTexts.add(unitText);
    variants.push({
      label: "SI Unit Equivalence",
      kind: "unit_equiv",
      text: unitText,
      epsilonDistance: Math.min(radius, Math.round(radius * 0.25 * 10000) / 10000),
    });
  }

  const boundText = applyBoundReformulation(trimmed);
  if (boundText !== trimmed && !seenTexts.has(boundText)) {
    seenTexts.add(boundText);
    variants.push({
      label: "Bound & Requirement Reformulation",
      kind: "bound_reformulation",
      text: boundText,
      epsilonDistance: Math.min(radius, Math.round(radius * 0.45 * 10000) / 10000),
    });
  }

  const synonymText = applyEngineeringSynonyms(trimmed);
  if (synonymText !== trimmed && !seenTexts.has(synonymText)) {
    seenTexts.add(synonymText);
    variants.push({
      label: "Engineering Synonym Invariance",
      kind: "synonym",
      text: synonymText,
      epsilonDistance: Math.min(radius, Math.round(radius * 0.7 * 10000) / 10000),
    });
  }

  return variants.slice(0, 3);
}

// ---------------------------------------------------------------------------
// Isomorphic identifier rename scramble (code-modality invariance check)
// ---------------------------------------------------------------------------

const IDENT_TOKEN_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

function indexToAlphaSuffix(index: number): string {
  let n = index;
  let out = "";
  do {
    out = String.fromCharCode(97 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

function buildLineStartOffsets(source: string): number[] {
  const offsets: number[] = [0];
  for (let i = 0; i < source.length; i++) {
    if (source.charCodeAt(i) === 10) {
      offsets.push(i + 1);
    }
  }
  return offsets;
}

function lineColToOffset(lineStarts: number[], sourceLen: number, line: number, column: number): number {
  const lineIdx = Math.max(0, Math.min(lineStarts.length - 1, Math.floor(line) - 1));
  const base = lineStarts[lineIdx] ?? 0;
  return Math.max(0, Math.min(sourceLen, base + Math.max(0, Math.floor(column) - 1)));
}

/**
 * Replaces non-locked identifier tokens (`groupId > 0`, matching `/^[A-Za-z_][A-Za-z0-9_]*$/`)
 * consistently per `groupId` with synthetic identifiers `sym_a`, `sym_b`, ... while leaving
 * all `groupId === 0` tokens untouched and verifying identical `(groupId, relTypeId, relSign)`
 * sequence topology.
 */
export function buildIsomorphicRenameScramble(
  source: string,
  record: { spans: IsomorphicScrambleSpan[] },
): IsomorphicScrambleResult {
  const lineStarts = buildLineStartOffsets(source);
  const topologySignatureBefore = record.spans.map((s) => `${s.groupId}:${s.relTypeId}:${s.relSign}`).join("|");

  // Deterministically collect unique groupIds that have at least one identifier span
  const scrambleGroupIds = Array.from(
    new Set(record.spans.filter((s) => s.groupId > 0 && IDENT_TOKEN_RE.test(s.text)).map((s) => s.groupId)),
  ).sort((a, b) => a - b);

  const syntheticByGroup = new Map<number, string>();
  for (let i = 0; i < scrambleGroupIds.length; i++) {
    syntheticByGroup.set(scrambleGroupIds[i]!, `sym_${indexToAlphaSuffix(i)}`);
  }

  let preservedLockedCount = 0;
  const renameMap: Record<string, string> = {};

  interface SpanEdit {
    spanIndex: number;
    startOffset: number;
    endOffset: number;
    replacement: string;
  }

  interface SpanRange {
    spanIndex: number;
    span: IsomorphicScrambleSpan;
    startOffset: number;
    endOffset: number;
    expectedAfter: string;
    isEdit: boolean;
  }

  const spanRanges: SpanRange[] = [];
  const edits: SpanEdit[] = [];

  for (let i = 0; i < record.spans.length; i++) {
    const span = record.spans[i]!;
    const startOffset = lineColToOffset(lineStarts, source.length, span.startLine, span.startColumn);
    const endOffset = lineColToOffset(lineStarts, source.length, span.endLine, span.endColumn);

    if (span.groupId === 0) {
      preservedLockedCount++;
      spanRanges.push({
        spanIndex: i,
        span,
        startOffset,
        endOffset,
        expectedAfter: span.text,
        isEdit: false,
      });
      continue;
    }

    const syntheticName = syntheticByGroup.get(span.groupId);
    if (
      syntheticName !== undefined &&
      IDENT_TOKEN_RE.test(span.text) &&
      endOffset > startOffset &&
      source.slice(startOffset, endOffset) === span.text
    ) {
      renameMap[span.text] = syntheticName;
      edits.push({
        spanIndex: i,
        startOffset,
        endOffset,
        replacement: syntheticName,
      });
      spanRanges.push({
        spanIndex: i,
        span,
        startOffset,
        endOffset,
        expectedAfter: syntheticName,
        isEdit: true,
      });
    } else {
      spanRanges.push({
        spanIndex: i,
        span,
        startOffset,
        endOffset,
        expectedAfter: span.text,
        isEdit: false,
      });
    }
  }

  // Sort edits ascending to filter overlaps cleanly, then apply descending
  edits.sort((a, b) => a.startOffset - b.startOffset || a.endOffset - b.endOffset);
  const nonOverlappingEdits: SpanEdit[] = [];
  let lastEnd = -1;
  for (const edit of edits) {
    if (edit.startOffset >= lastEnd) {
      nonOverlappingEdits.push(edit);
      lastEnd = edit.endOffset;
    }
  }

  let scrambledSource = source;
  for (let i = nonOverlappingEdits.length - 1; i >= 0; i--) {
    const edit = nonOverlappingEdits[i]!;
    scrambledSource =
      scrambledSource.slice(0, edit.startOffset) + edit.replacement + scrambledSource.slice(edit.endOffset);
  }

  // Verify every span's adjusted slice in `scrambledSource` preserves exact token & tuple topology
  const afterTuples: string[] = [];
  const appliedSet = new Set(nonOverlappingEdits.map((e) => e.spanIndex));

  for (const sr of spanRanges) {
    let shiftBefore = 0;
    for (const edit of nonOverlappingEdits) {
      if (edit.endOffset <= sr.startOffset) {
        shiftBefore += edit.replacement.length - (edit.endOffset - edit.startOffset);
      } else {
        break;
      }
    }
    const adjStart = sr.startOffset + shiftBefore;
    const adjLen = appliedSet.has(sr.spanIndex) ? sr.expectedAfter.length : sr.endOffset - sr.startOffset;
    const adjEnd = adjStart + adjLen;
    const actualSlice = scrambledSource.slice(adjStart, adjEnd);

    if (actualSlice === sr.expectedAfter) {
      afterTuples.push(`${sr.span.groupId}:${sr.span.relTypeId}:${sr.span.relSign}`);
    } else {
      afterTuples.push(`MISMATCH:${sr.span.groupId}:${sr.span.relTypeId}:${sr.span.relSign}`);
    }
  }

  const topologySignatureAfter = afterTuples.join("|");
  const scrambledGroupIdsApplied = new Set(nonOverlappingEdits.map((e) => record.spans[e.spanIndex]!.groupId));

  return {
    scrambledSource,
    renameMap,
    preservedLockedCount,
    scrambledGroupCount: scrambledGroupIdsApplied.size,
    topologySignatureBefore,
    topologySignatureAfter,
    invariant: topologySignatureBefore === topologySignatureAfter,
  };
}
