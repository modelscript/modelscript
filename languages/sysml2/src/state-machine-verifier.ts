// SPDX-License-Identifier: AGPL-3.0-or-later

import type { QueryDB } from "@modelscript/runtime";
import { SmtOctagonDBM } from "./smt-bridge.js";

/**
 * Diagnostic emitted when a state machine transition hazard is identified.
 */
export interface StateDeterminismDiagnostic {
  type: "nondeterminism" | "deadlock";
  stateName: string;
  transitionA?: string;
  transitionB?: string;
  guardA?: string;
  guardB?: string;
  message: string;
  unhandledRange?: string;
}

/**
 * Full result of state machine determinism and completeness verification.
 */
export interface StateDeterminismResult {
  isDeterministic: boolean;
  isComplete: boolean;
  diagnostics: StateDeterminismDiagnostic[];
}

/**
 * Normalized representation of a single comparison constraint.
 */
export interface GuardConstraint {
  variable: string;
  operator: "<=" | "<" | ">=" | ">" | "==" | "!=";
  value: number;
}

/**
 * Parses a textual guard expression into a list of atomic constraints.
 * Supports conjunctions (`&&`, `and`) of simple numeric comparisons.
 */
export function parseGuardConstraints(guardText: string): GuardConstraint[] {
  const constraints: GuardConstraint[] = [];
  // Strip outer brackets if any: e.g. "[x >= 0]"
  let cleaned = guardText.trim();
  if (cleaned.startsWith("[") && cleaned.endsWith("]")) {
    cleaned = cleaned.substring(1, cleaned.length - 1).trim();
  }
  if (cleaned.startsWith("(") && cleaned.endsWith(")")) {
    cleaned = cleaned.substring(1, cleaned.length - 1).trim();
  }

  // Split on "&&" or "and"
  const tokens = cleaned.split(/\s*(?:&&|\band\b)\s*/i);

  for (const token of tokens) {
    const trimmed = token.trim();
    if (!trimmed) continue;

    // Pattern: variable op value e.g. "fuelLevel > 0", "x <= 15.5", "v == 100"
    const match = trimmed.match(/^([a-zA-Z_][a-zA-Z0-9_.]*)\s*(<=|>=|==|!=|<|>)\s*(-?[0-9]+(?:\.[0-9]+)?)$/);
    if (match) {
      constraints.push({
        variable: match[1],
        operator: match[2] as GuardConstraint["operator"],
        value: parseFloat(match[3]),
      });
      continue;
    }

    // Pattern: value op variable e.g. "0 < fuelLevel", "10 >= x"
    const revMatch = trimmed.match(/^(-?[0-9]+(?:\.[0-9]+)?)\s*(<=|>=|==|!=|<|>)\s*([a-zA-Z_][a-zA-Z0-9_.]*)$/);
    if (revMatch) {
      const val = parseFloat(revMatch[1]);
      const op = revMatch[2];
      const variable = revMatch[3];
      let invertedOp: GuardConstraint["operator"];
      switch (op) {
        case "<":
          invertedOp = ">";
          break;
        case "<=":
          invertedOp = ">=";
          break;
        case ">":
          invertedOp = "<";
          break;
        case ">=":
          invertedOp = "<=";
          break;
        default:
          invertedOp = op as GuardConstraint["operator"];
      }
      constraints.push({
        variable,
        operator: invertedOp,
        value: val,
      });
    }
  }

  return constraints;
}

/**
 * Checks whether two guard conditions are mutually exclusive or can overlap.
 * Uses an Octagon DBM to determine feasibility of guardA && guardB.
 */
export function checkGuardsMutuallyExclusive(
  guardA: string,
  guardB: string,
): { mutuallyExclusive: boolean; overlap?: string } {
  const cA = parseGuardConstraints(guardA);
  const cB = parseGuardConstraints(guardB);

  // If either guard cannot be parsed into numeric constraints, assume they might overlap
  if (cA.length === 0 || cB.length === 0) {
    return { mutuallyExclusive: false, overlap: "non-numeric or complex condition" };
  }

  // Collect all unique variables
  const varMap = new Map<string, number>();
  let nextId = 0;
  const getVarId = (name: string): number => {
    let id = varMap.get(name);
    if (id === undefined) {
      id = nextId++;
      varMap.set(name, id);
    }
    return id;
  };

  for (const c of [...cA, ...cB]) {
    getVarId(c.variable);
  }

  const numVars = Math.max(nextId, 1);
  const dbm = new SmtOctagonDBM(numVars);

  const applyConstraints = (list: GuardConstraint[]): boolean => {
    for (const c of list) {
      const v = getVarId(c.variable);
      const curLo = dbm.getLowerBound(v);
      const curHi = dbm.getUpperBound(v);

      switch (c.operator) {
        case "<=":
          dbm.assumeInterval(v, curLo, Math.floor(c.value));
          break;
        case "<":
          dbm.assumeInterval(v, curLo, Math.floor(c.value - 1e-6));
          break;
        case ">=":
          dbm.assumeInterval(v, Math.ceil(c.value), curHi);
          break;
        case ">":
          dbm.assumeInterval(v, Math.ceil(c.value + 1e-6), curHi);
          break;
        case "==":
          dbm.assumeInterval(v, Math.round(c.value), Math.round(c.value));
          break;
        case "!=":
          // In DBM, != is non-convex; skip or treat conservatively
          break;
      }
      if (dbm.hasNegativeCycle()) return false;
      if (dbm.getLowerBound(v) > dbm.getUpperBound(v)) return false;
    }
    return true;
  };

  // Conjoin guard A and guard B
  const validA = applyConstraints(cA);
  if (!validA) return { mutuallyExclusive: true }; // Guard A itself is unsatisfiable

  const validBoth = applyConstraints(cB);
  if (!validBoth || dbm.hasNegativeCycle()) {
    return { mutuallyExclusive: true };
  }

  // Check if every variable has valid bounds
  for (const [name, id] of varMap) {
    const lo = dbm.getLowerBound(id);
    const hi = dbm.getUpperBound(id);
    if (lo > hi) {
      return { mutuallyExclusive: true };
    }
  }

  // Construct overlapping witness interval
  const parts: string[] = [];
  for (const [name, id] of varMap) {
    const lo = dbm.getLowerBound(id);
    const hi = dbm.getUpperBound(id);
    const loStr = lo <= -100000 ? "-∞" : lo.toString();
    const hiStr = hi >= 100000 ? "∞" : hi.toString();
    parts.push(`${name} ∈ [${loStr}, ${hiStr}]`);
  }

  return {
    mutuallyExclusive: false,
    overlap: parts.join(", "),
  };
}

/**
 * Checks whether a set of guards on a single variable collectively cover all values (-∞, ∞).
 */
export function checkSingleVarExhaustive(
  variable: string,
  constraintsList: GuardConstraint[][],
): { exhaustive: boolean; unhandledRange?: string } {
  // Collect intervals [lo, hi] permitted by each transition
  interface IntervalItem {
    lo: number;
    hi: number;
  }
  const intervals: IntervalItem[] = [];

  for (const cList of constraintsList) {
    let lo = -Infinity;
    let hi = Infinity;
    for (const c of cList) {
      if (c.variable !== variable) continue;
      if (c.operator === ">=" || c.operator === ">") {
        lo = Math.max(lo, c.value);
      } else if (c.operator === "<=" || c.operator === "<") {
        hi = Math.min(hi, c.value);
      } else if (c.operator === "==") {
        lo = Math.max(lo, c.value);
        hi = Math.min(hi, c.value);
      }
    }
    if (lo <= hi) {
      intervals.push({ lo, hi });
    }
  }

  if (intervals.length === 0) return { exhaustive: true };

  // Sort intervals by lower bound
  intervals.sort((a, b) => a.lo - b.lo);

  // Check coverage
  let currentCoverage = -Infinity;
  for (const interval of intervals) {
    if (interval.lo > currentCoverage) {
      // Gap detected!
      const loStr = currentCoverage === -Infinity ? "-∞" : currentCoverage.toString();
      const hiStr = interval.lo === Infinity ? "∞" : interval.lo.toString();
      return {
        exhaustive: false,
        unhandledRange: `${variable} ∈ (${loStr}, ${hiStr})`,
      };
    }
    currentCoverage = Math.max(currentCoverage, interval.hi);
  }

  if (currentCoverage < Infinity) {
    return {
      exhaustive: false,
      unhandledRange: `${variable} ∈ (${currentCoverage}, ∞)`,
    };
  }

  return { exhaustive: true };
}

export interface TransitionDescriptor {
  id: string | number;
  name: string;
  source: string;
  target?: string;
  guardText?: string;
  cstText?: string;
}

/**
 * Verifies all transitions leaving a specified state for determinism and completeness.
 */
export function verifyStateTransitions(stateName: string, transitions: TransitionDescriptor[]): StateDeterminismResult {
  const diagnostics: StateDeterminismDiagnostic[] = [];
  let isDeterministic = true;
  let isComplete = true;

  const guarded = transitions.filter((t) => t.guardText && t.guardText.trim().length > 0);

  // 1. Pairwise mutual exclusion check (Nondeterminism)
  for (let i = 0; i < guarded.length; i++) {
    for (let j = i + 1; j < guarded.length; j++) {
      const t1 = guarded[i]!;
      const t2 = guarded[j]!;
      const check = checkGuardsMutuallyExclusive(t1.guardText!, t2.guardText!);

      if (!check.mutuallyExclusive) {
        isDeterministic = false;
        diagnostics.push({
          type: "nondeterminism",
          stateName,
          transitionA: t1.name,
          transitionB: t2.name,
          guardA: t1.guardText,
          guardB: t2.guardText,
          message: `Non-deterministic transitions from state '${stateName}': guards '${t1.guardText}' and '${t2.guardText}' can both be satisfied simultaneously under input condition [${check.overlap || "overlap"}].`,
        });
      }
    }
  }

  // 2. Completeness check (Deadlock freedom)
  // If there is an unguarded transition, the state has a default fallback (always complete)
  const hasUnguarded = transitions.some((t) => !t.guardText || t.guardText.trim().length === 0);
  if (!hasUnguarded && guarded.length > 0) {
    const parsedGuards = guarded.map((t) => parseGuardConstraints(t.guardText!));
    // Find variables involved in guards
    const vars = new Set<string>();
    for (const clist of parsedGuards) {
      for (const c of clist) vars.add(c.variable);
    }

    for (const v of vars) {
      const exhaust = checkSingleVarExhaustive(v, parsedGuards);
      if (!exhaust.exhaustive) {
        isComplete = false;
        diagnostics.push({
          type: "deadlock",
          stateName,
          message: `Potential deadlock in state '${stateName}': transition guards do not cover all possible values of '${v}' (unhandled range: ${exhaust.unhandledRange}).`,
          unhandledRange: exhaust.unhandledRange,
        });
      }
    }
  }

  return {
    isDeterministic,
    isComplete,
    diagnostics,
  };
}

/**
 * Analyzes an entire QueryDB to find and verify all state definitions and their transitions.
 */
export function verifyAllStateMachineTransitions(db: QueryDB, scopeFilter?: string): StateDeterminismResult {
  const allEntries = db.allEntries();
  const allDiagnostics: StateDeterminismDiagnostic[] = [];
  let overallDeterministic = true;
  let overallComplete = true;

  // Find all state symbols
  const stateEntries = allEntries.filter(
    (e) => (e.ruleName === "StateDefinition" || e.ruleName === "StateUsage") && e.name,
  );

  // Group transitions by source state
  const transitionEntries = allEntries.filter((e) => e.ruleName === "TransitionUsage");

  for (const state of stateEntries) {
    if (scopeFilter && state.name !== scopeFilter && !state.name.includes(scopeFilter)) {
      continue;
    }

    const stateName = state.name;
    // Transitions whose source matches this state
    const outgoing: TransitionDescriptor[] = [];

    for (const t of transitionEntries) {
      const metaSource = t.metadata?.source;
      let matches = metaSource === stateName;

      // Also check CST text if metadata isn't fully resolved
      if (!matches) {
        const text = db.cstText(t.startByte, t.endByte, t);
        if (text && (text.includes(`first ${stateName}`) || text.includes(`transition ${stateName}`))) {
          matches = true;
        }
      }

      if (matches) {
        let guardText = t.metadata?.guard;
        if (!guardText) {
          // Extract "if <guard>" from CST
          const cstText = db.cstText(t.startByte, t.endByte, t);
          if (cstText) {
            const ifMatch = cstText.match(/\bif\s+([^{;do]+?)(?:\s+do|\s+then|[;{]|$)/);
            if (ifMatch) guardText = ifMatch[1].trim();
          }
        }

        outgoing.push({
          id: t.id,
          name: t.name || `transition_${t.id}`,
          source: stateName,
          target: typeof t.metadata?.target === "string" ? t.metadata.target : undefined,
          guardText: typeof guardText === "string" ? guardText : undefined,
        });
      }
    }

    if (outgoing.length >= 1) {
      const res = verifyStateTransitions(stateName, outgoing);
      if (!res.isDeterministic) overallDeterministic = false;
      if (!res.isComplete) overallComplete = false;
      allDiagnostics.push(...res.diagnostics);
    }
  }

  return {
    isDeterministic: overallDeterministic,
    isComplete: overallComplete,
    diagnostics: allDiagnostics,
  };
}
