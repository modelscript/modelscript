// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/sysml2 — SMT-Powered Decision Logic Exhaustiveness & Disjointness Prover.
 *
 * Provides push-button formal verification of SysML v2 decision tables, `decide` nodes,
 * `case` statements, and state transition guards (Imandra computational logic equivalent):
 *   1. Exhaustiveness: Proves that ¬(⋁ G_i) is UNSAT (no unhandled input scenario).
 *   2. Disjointness / Determinism: Proves that G_i ∧ G_j is UNSAT for all i ≠ j (no ambiguous race condition).
 *   3. Dead-Branch Detection: Proves that each G_i is SAT (no mathematically unreachable dead code).
 */

import type { QueryDB, SymbolEntry } from "@modelscript/runtime";
import { DpllTSolver, Interval, type ExprNode, type NonlinearConstraint } from "@modelscript/runtime";
import { extractActivityGraphFromQueryDB, extractActivityGraphFromText, type ActivityGraph } from "./activity-cfa.js";
import { collectCstLeaves, isSysmlIdentLeaf, parseSysmlSource, readDottedChainFromLeaves } from "./cst-utils.js";
import {
  checkGuardsMutuallyExclusive,
  extractVariables,
  parseGuardConstraints,
  type GuardConstraint,
} from "./state-machine-verifier.js";

export interface DecisionBranch {
  id: string;
  name?: string | undefined;
  guardText: string;
  isElse?: boolean | undefined;
  targetName?: string | undefined;
}

export interface DecisionTableVerificationResult {
  isExhaustive: boolean;
  isDeterministic: boolean;
  hasDeadBranches: boolean;
  unhandledScenarioBox?: Record<string, [number, number]> | undefined;
  suggestedFixCondition?: string | undefined;
  suggestedQuickFix?: string | undefined;
  overlappingBranches: {
    branchA: string;
    branchB: string;
    witnessBox: Record<string, [number, number]>;
  }[];
  deadBranches: string[];
  summary: string;
}

export interface DecisionTableOptions {
  domainBounds?: Map<string, [number, number]> | undefined;
  defaultRange?: [number, number] | undefined;
  variableTypes?: Map<string, string> | undefined;
}

function extractMaxAbsExprConst(node: ExprNode): number {
  switch (node.kind) {
    case "const":
      return Number.isFinite(node.value) ? Math.abs(node.value) : 0;
    case "var":
      return 0;
    case "neg":
    case "sqr":
    case "sqrt":
    case "sin":
    case "cos":
      return extractMaxAbsExprConst(node.child);
    case "add":
    case "sub":
    case "mul":
    case "div":
    case "pow":
      return Math.max(extractMaxAbsExprConst(node.left), extractMaxAbsExprConst(node.right));
    case "call": {
      let m = 0;
      for (const a of node.args) m = Math.max(m, extractMaxAbsExprConst(a));
      return m;
    }
  }
}

function classifyScalarDomainKind(typeName: string | undefined): "natural" | "positive" | "integer" | "real" {
  if (!typeName) return "real";
  const last = (typeName.includes("::") ? typeName.split("::").pop()! : typeName).trim();
  if (last === "Natural") return "natural";
  if (last === "Positive") return "positive";
  if (last === "Integer") return "integer";
  return "real";
}

/**
 * Converts a GuardConstraint into a runtime NonlinearConstraint, preserving `!=` and strict inequalities.
 */
export function toNonlinearConstraint(g: GuardConstraint): NonlinearConstraint {
  if (g.nonlinear) {
    return g.nonlinear;
  }
  return {
    expr: { kind: "var", name: g.variable },
    rel: g.operator,
    rhs: g.value,
  };
}

/**
 * Negates a single constraint into an array of equivalent non-linear inequalities.
 */
function negateNlConstraint(c: NonlinearConstraint): NonlinearConstraint[] {
  if (c.rel === "<=") {
    return [{ expr: c.expr, rel: ">", rhs: c.rhs }];
  } else if (c.rel === "<") {
    return [{ expr: c.expr, rel: ">=", rhs: c.rhs }];
  } else if (c.rel === ">=") {
    return [{ expr: c.expr, rel: "<", rhs: c.rhs }];
  } else if (c.rel === ">") {
    return [{ expr: c.expr, rel: "<=", rhs: c.rhs }];
  } else if (c.rel === "!=") {
    return [{ expr: c.expr, rel: "==", rhs: c.rhs }];
  } else {
    return [
      { expr: c.expr, rel: "<", rhs: c.rhs },
      { expr: c.expr, rel: ">", rhs: c.rhs },
    ];
  }
}

function negateGuard(g: GuardConstraint): NonlinearConstraint[] {
  if (g.nonlinear) {
    return negateNlConstraint(g.nonlinear);
  }
  const varName = g.variable;
  if (g.operator === "<") {
    return [{ expr: { kind: "var", name: varName }, rel: ">=", rhs: g.value }];
  } else if (g.operator === "<=") {
    return [{ expr: { kind: "var", name: varName }, rel: ">", rhs: g.value }];
  } else if (g.operator === ">") {
    return [{ expr: { kind: "var", name: varName }, rel: "<=", rhs: g.value }];
  } else if (g.operator === ">=") {
    return [{ expr: { kind: "var", name: varName }, rel: "<", rhs: g.value }];
  } else if (g.operator === "!=") {
    return [{ expr: { kind: "var", name: varName }, rel: "==", rhs: g.value }];
  } else {
    return [
      { expr: { kind: "var", name: varName }, rel: "<", rhs: g.value },
      { expr: { kind: "var", name: varName }, rel: ">", rhs: g.value },
    ];
  }
}

function areGuardsDisjoint(guardsA: GuardConstraint[], guardsB: GuardConstraint[]): boolean {
  const vars = new Set<string>();
  for (const g of guardsA) if (!g.nonlinear) vars.add(g.variable);
  for (const g of guardsB) if (!g.nonlinear) vars.add(g.variable);

  for (const v of vars) {
    let loA = -Infinity,
      hiA = Infinity,
      strictLoA = false,
      strictHiA = false;
    const neqA = new Set<number>();
    let loB = -Infinity,
      hiB = Infinity,
      strictLoB = false,
      strictHiB = false;
    const neqB = new Set<number>();

    for (const g of guardsA) {
      if (g.variable !== v || g.nonlinear) continue;
      if (g.operator === "<") {
        if (g.value < hiA || (g.value === hiA && !strictHiA)) {
          hiA = g.value;
          strictHiA = true;
        }
      } else if (g.operator === "<=") {
        if (g.value < hiA) {
          hiA = g.value;
          strictHiA = false;
        }
      } else if (g.operator === ">") {
        if (g.value > loA || (g.value === loA && !strictLoA)) {
          loA = g.value;
          strictLoA = true;
        }
      } else if (g.operator === ">=") {
        if (g.value > loA) {
          loA = g.value;
          strictLoA = false;
        }
      } else if (g.operator === "==") {
        if (g.value > loA) {
          loA = g.value;
          strictLoA = false;
        }
        if (g.value < hiA) {
          hiA = g.value;
          strictHiA = false;
        }
      } else if (g.operator === "!=") {
        neqA.add(g.value);
      }
    }

    for (const g of guardsB) {
      if (g.variable !== v || g.nonlinear) continue;
      if (g.operator === "<") {
        if (g.value < hiB || (g.value === hiB && !strictHiB)) {
          hiB = g.value;
          strictHiB = true;
        }
      } else if (g.operator === "<=") {
        if (g.value < hiB) {
          hiB = g.value;
          strictHiB = false;
        }
      } else if (g.operator === ">") {
        if (g.value > loB || (g.value === loB && !strictLoB)) {
          loB = g.value;
          strictLoB = true;
        }
      } else if (g.operator === ">=") {
        if (g.value > loB) {
          loB = g.value;
          strictLoB = false;
        }
      } else if (g.operator === "==") {
        if (g.value > loB) {
          loB = g.value;
          strictLoB = false;
        }
        if (g.value < hiB) {
          hiB = g.value;
          strictHiB = false;
        }
      } else if (g.operator === "!=") {
        neqB.add(g.value);
      }
    }

    if (hiA < loB || hiB < loA) return true;
    if (hiA === loB && (strictHiA || strictLoB)) return true;
    if (hiB === loA && (strictHiB || strictLoA)) return true;
    if (loA === hiA && neqB.has(loA)) return true;
    if (loB === hiB && neqA.has(loB)) return true;
  }

  for (const gA of guardsA) {
    for (const gB of guardsB) {
      if (gA.variable === gB.variable && Math.abs(gA.value - gB.value) < 1e-4) {
        if (
          (gA.operator === "<" && (gB.operator === ">=" || gB.operator === ">")) ||
          (gB.operator === "<" && (gA.operator === ">=" || gA.operator === ">")) ||
          (gA.operator === "<=" && gB.operator === ">") ||
          (gB.operator === "<=" && gA.operator === ">") ||
          (gA.operator === "==" && gB.operator === "!=") ||
          (gB.operator === "==" && gA.operator === "!=")
        ) {
          return true;
        }
      }
    }
  }
  return false;
}

function areGuardsComplementaryAt(g: GuardConstraint, otherGuards: GuardConstraint[]): boolean {
  for (const other of otherGuards) {
    if (other.variable === g.variable && Math.abs(other.value - g.value) < 1e-4) {
      if (
        (g.operator === "<" && (other.operator === ">=" || other.operator === ">")) ||
        (other.operator === "<" && (g.operator === ">=" || g.operator === ">")) ||
        (g.operator === "<=" && other.operator === ">") ||
        (other.operator === "<=" && g.operator === ">") ||
        (g.operator === "==" && other.operator === "!=") ||
        (other.operator === "==" && g.operator === "!=")
      ) {
        return true;
      }
    }
  }
  return false;
}

function checkUnivariateIntervalExhaustiveness(
  branches: { rawConstraints: GuardConstraint[] }[],
  varName: string,
  domain: [number, number],
  domainOpenLo = false,
  isDiscreteInteger = false,
): { isExhaustive: boolean; gap?: [number, number] | undefined } | null {
  const intervals: { lo: number; hi: number; strictLo: boolean; strictHi: boolean }[] = [];

  for (const b of branches) {
    if (b.rawConstraints.length === 0) return null;
    let lo = -Infinity,
      hi = Infinity;
    let strictLo = false,
      strictHi = false;
    for (const g of b.rawConstraints) {
      if (g.nonlinear || g.variable !== varName) return null;
      if (g.operator === "<") {
        if (g.value < hi || (g.value === hi && !strictHi)) {
          hi = g.value;
          strictHi = true;
        }
      } else if (g.operator === "<=") {
        if (g.value < hi) {
          hi = g.value;
          strictHi = false;
        }
      } else if (g.operator === ">") {
        if (g.value > lo || (g.value === lo && !strictLo)) {
          lo = g.value;
          strictLo = true;
        }
      } else if (g.operator === ">=") {
        if (g.value > lo) {
          lo = g.value;
          strictLo = false;
        }
      } else if (g.operator === "==") {
        if (g.value > lo) {
          lo = g.value;
          strictLo = false;
        }
        if (g.value < hi) {
          hi = g.value;
          strictHi = false;
        }
      } else return null;
    }

    if (isDiscreteInteger) {
      if (Number.isFinite(lo)) {
        lo = strictLo ? Math.floor(lo) + 1 : Math.ceil(lo);
        strictLo = false;
      }
      if (Number.isFinite(hi)) {
        hi = strictHi ? Math.ceil(hi) - 1 : Math.floor(hi);
        strictHi = false;
      }
    }

    if (lo > hi || (lo === hi && (strictLo || strictHi))) {
      // Contradictory dead branch contributes nothing to coverage
      continue;
    }
    intervals.push({ lo, hi, strictLo, strictHi });
  }

  intervals.sort((a, b) => a.lo - b.lo);

  if (isDiscreteInteger) {
    const intDomainLo = domainOpenLo ? Math.floor(domain[0]) + 1 : Math.ceil(domain[0]);
    const intDomainHi = Math.floor(domain[1]);
    let coveredUpTo = intDomainLo - 1;

    for (const inv of intervals) {
      if (inv.hi < intDomainLo) continue;
      if (inv.lo > intDomainHi) break;
      if (inv.lo > coveredUpTo + 1) {
        return { isExhaustive: false, gap: [coveredUpTo + 1, Math.min(intDomainHi, inv.lo - 1)] };
      }
      if (inv.hi > coveredUpTo) {
        coveredUpTo = inv.hi;
      }
    }

    if (coveredUpTo < intDomainHi) {
      return { isExhaustive: false, gap: [coveredUpTo + 1, intDomainHi] };
    }
    return { isExhaustive: true };
  }

  const effectiveDomainLo = domainOpenLo ? 0 : domain[0];
  let currentHi = effectiveDomainLo;
  // When domain is `(0, hi]` (Positive), 0 itself is outside the domain so `x > 0` leaves no gap at 0;
  // when domain is `[lo, hi]`, `lo` itself must be covered by an interval with `inv.lo < lo` or (`inv.lo === lo && !inv.strictLo`).
  let coveredLowerBoundary = domainOpenLo;
  let currentStrictHi = false;

  for (const inv of intervals) {
    if (inv.hi < effectiveDomainLo || (inv.hi === effectiveDomainLo && (inv.strictHi || domainOpenLo))) continue;
    if (inv.lo > domain[1]) break;

    if (!coveredLowerBoundary) {
      if (inv.lo > effectiveDomainLo + 1e-7) {
        return { isExhaustive: false, gap: [effectiveDomainLo, inv.lo] };
      }
      if (Math.abs(inv.lo - effectiveDomainLo) <= 1e-7 && inv.strictLo) {
        return { isExhaustive: false, gap: [effectiveDomainLo, effectiveDomainLo] };
      }
      coveredLowerBoundary = true;
    } else {
      if (inv.lo > currentHi + 1e-7) {
        return { isExhaustive: false, gap: [currentHi, inv.lo] };
      }
      if (Math.abs(inv.lo - currentHi) <= 1e-7 && currentStrictHi && inv.strictLo) {
        return { isExhaustive: false, gap: [currentHi, currentHi] };
      }
    }

    if (inv.hi > currentHi + 1e-7) {
      currentHi = inv.hi;
      currentStrictHi = inv.strictHi;
    } else if (Math.abs(inv.hi - currentHi) <= 1e-7) {
      currentStrictHi = currentStrictHi && inv.strictHi;
    }
  }

  if (!coveredLowerBoundary) {
    return { isExhaustive: false, gap: [effectiveDomainLo, domain[1]] };
  }
  if (currentHi < domain[1] - 1e-7) {
    return { isExhaustive: false, gap: [currentHi, domain[1]] };
  }

  return { isExhaustive: true };
}

export class DecisionTableVerifier {
  /**
   * Verifies an arbitrary set of decision branches for exhaustiveness, disjointness, and dead branches.
   */
  public static verifyDecisionTable(
    branches: DecisionBranch[],
    options: DecisionTableOptions = {},
  ): DecisionTableVerificationResult {
    const defaultRange = options.defaultRange ?? [-1000, 1000];

    if (branches.length === 0) {
      return {
        isExhaustive: false,
        isDeterministic: true,
        hasDeadBranches: false,
        overlappingBranches: [],
        deadBranches: [],
        summary: "Empty decision table: no branches specified.",
      };
    }

    const emptyGuardCount = branches.filter((b) => !b.isElse && b.guardText.trim() === "").length;
    const nonEmptyNonElseCount = branches.filter((b) => {
      const gt = b.guardText.trim().toLowerCase();
      return !b.isElse && gt !== "" && gt !== "else" && gt !== "default" && gt !== "true";
    }).length;

    // Parse each branch guard into a list of NonlinearConstraints
    const parsedBranches = branches.map((b) => {
      const trimmedLower = b.guardText.trim().toLowerCase();
      const isSingleFallback = emptyGuardCount === 1 && nonEmptyNonElseCount >= 1 && trimmedLower === "";
      const isElse = Boolean(b.isElse) || trimmedLower === "else" || trimmedLower === "default" || isSingleFallback;
      const isAlwaysFalse = trimmedLower === "false" || trimmedLower === "not true" || trimmedLower === "!true";
      const isAlwaysTrue = !isElse && (trimmedLower === "true" || trimmedLower === "");

      const raw = isElse || isAlwaysTrue || isAlwaysFalse ? [] : parseGuardConstraints(b.guardText);
      const nl = raw.map((g) => toNonlinearConstraint(g));
      return {
        ...b,
        rawConstraints: raw,
        isElse,
        isAlwaysTrue,
        isAlwaysFalse,
        nlConstraints: nl,
      };
    });

    // Collect all variables and maximum guard constant magnitudes per variable
    const varNames = new Set<string>();
    const maxConstByVar = new Map<string, number>();
    let globalMaxConst = 0;

    for (const pb of parsedBranches) {
      for (const c of pb.nlConstraints) {
        const exprVars = new Set<string>();
        extractVariables(c.expr, exprVars);
        const cMag = Math.max(Number.isFinite(c.rhs) ? Math.abs(c.rhs) : 0, extractMaxAbsExprConst(c.expr));
        globalMaxConst = Math.max(globalMaxConst, cMag);
        for (const v of exprVars) {
          varNames.add(v);
          maxConstByVar.set(v, Math.max(maxConstByVar.get(v) ?? 0, cMag));
        }
      }
    }
    const varList = Array.from(varNames);

    const hasNonIntegerConstForVar = (v: string): boolean => {
      for (const pb of parsedBranches) {
        for (const g of pb.rawConstraints) {
          if (g.variable === v && !g.nonlinear && !Number.isInteger(g.value)) {
            return true;
          }
        }
      }
      return false;
    };

    const resolveEffectiveDomain = (
      v: string,
    ): { boxLo: number; boxHi: number; openLo: boolean; isDiscreteInteger: boolean } => {
      const kind = classifyScalarDomainKind(options.variableTypes?.get(v));
      const isIntKind =
        (kind === "natural" || kind === "positive" || kind === "integer") && !hasNonIntegerConstForVar(v);

      const explicit = options.domainBounds?.get(v);
      if (explicit) {
        return { boxLo: explicit[0], boxHi: explicit[1], openLo: false, isDiscreteInteger: isIntKind };
      }
      const varMax = Math.max(maxConstByVar.get(v) ?? 0, globalMaxConst);
      const expandedRadius = Math.max(1000, 10 * varMax);
      const loDefault = Math.min(defaultRange[0], -expandedRadius);
      const hiDefault = Math.max(defaultRange[1], expandedRadius);

      if (kind === "natural") {
        return { boxLo: 0, boxHi: Math.max(1000, hiDefault), openLo: false, isDiscreteInteger: isIntKind };
      }
      if (kind === "positive") {
        return {
          boxLo: isIntKind ? 1 : 1e-6,
          boxHi: Math.max(1000, hiDefault),
          openLo: !isIntKind,
          isDiscreteInteger: isIntKind,
        };
      }
      return { boxLo: loDefault, boxHi: hiDefault, openLo: false, isDiscreteInteger: isIntKind };
    };

    const buildInitialBox = (): Map<string, Interval> => {
      const box = new Map<string, Interval>();
      for (const v of varList) {
        const d = resolveEffectiveDomain(v);
        box.set(v, new Interval(d.boxLo, d.boxHi));
      }
      return box;
    };

    // 1. Check Dead Branches (Reachability)
    const deadBranches: string[] = [];
    for (const pb of parsedBranches) {
      if (pb.isElse || pb.isAlwaysTrue) continue;
      if (pb.isAlwaysFalse) {
        deadBranches.push(pb.id);
        continue;
      }
      if (pb.nlConstraints.length === 0) {
        // Propositional / enum self-contradiction check (e.g. `a and not a`)
        if (checkGuardsMutuallyExclusive(pb.guardText, pb.guardText).mutuallyExclusive) {
          deadBranches.push(pb.id);
        }
        continue;
      }

      const theoryLiterals = new Map<number, NonlinearConstraint>();
      const clauses: number[][] = [];
      let litId = 1;

      for (const c of pb.nlConstraints) {
        theoryLiterals.set(litId, c);
        clauses.push([litId]);
        litId++;
      }

      const initialBox = buildInitialBox();
      const solver = new DpllTSolver({
        clauses,
        theoryLiterals,
        initialBox,
        delta: 1e-4,
        maxSubdivisions: 500,
      });

      const res = solver.solve(initialBox);
      if (res.status === "UNSAT") {
        deadBranches.push(pb.id);
      }
    }

    // 2. Check Disjointness (Determinism / Guard Collisions)
    const overlappingBranches: {
      branchA: string;
      branchB: string;
      witnessBox: Record<string, [number, number]>;
    }[] = [];

    for (let i = 0; i < parsedBranches.length; i++) {
      for (let j = i + 1; j < parsedBranches.length; j++) {
        const bA = parsedBranches[i]!;
        const bB = parsedBranches[j]!;

        // An "else" branch or dead literal-false branch cannot collide with other branches
        if (bA.isElse || bB.isElse || bA.isAlwaysFalse || bB.isAlwaysFalse) continue;

        if (bA.isAlwaysTrue && bB.isAlwaysTrue) {
          overlappingBranches.push({
            branchA: bA.id,
            branchB: bB.id,
            witnessBox: {},
          });
          continue;
        }

        if (bA.isAlwaysTrue && !deadBranches.includes(bB.id)) {
          overlappingBranches.push({ branchA: bA.id, branchB: bB.id, witnessBox: {} });
          continue;
        }
        if (bB.isAlwaysTrue && !deadBranches.includes(bA.id)) {
          overlappingBranches.push({ branchA: bA.id, branchB: bB.id, witnessBox: {} });
          continue;
        }

        // Propositional / enum branches (no numeric constraints)
        if (bA.nlConstraints.length === 0 || bB.nlConstraints.length === 0) {
          const mutEx = checkGuardsMutuallyExclusive(bA.guardText, bB.guardText);
          if (!mutEx.mutuallyExclusive) {
            overlappingBranches.push({
              branchA: bA.id,
              branchB: bB.id,
              witnessBox: {},
            });
          }
          continue;
        }

        // If guards are strictly disjoint (e.g. x < c vs x >= c, or x == c vs x != c), they do not overlap
        if (areGuardsDisjoint(bA.rawConstraints, bB.rawConstraints)) {
          continue;
        }

        // Test satisfiability of (G_A ∧ G_B)
        const combined = [...bA.nlConstraints, ...bB.nlConstraints];
        if (combined.length === 0) continue;

        const theoryLiterals = new Map<number, NonlinearConstraint>();
        const clauses: number[][] = [];
        let litId = 1;

        for (const c of combined) {
          theoryLiterals.set(litId, c);
          clauses.push([litId]);
          litId++;
        }

        const initialBox = buildInitialBox();
        const solver = new DpllTSolver({
          clauses,
          theoryLiterals,
          initialBox,
          delta: 1e-5,
          maxSubdivisions: 800,
        });

        const res = solver.solve(initialBox);
        if (res.status !== "UNSAT") {
          const witnessBox: Record<string, [number, number]> = {};
          if (res.solutionBox) {
            for (const [k, inv] of res.solutionBox.entries()) {
              witnessBox[k] = [inv.lo, inv.hi];
            }
          }
          overlappingBranches.push({
            branchA: bA.id,
            branchB: bB.id,
            witnessBox,
          });
        }
      }
    }

    // 3. Check Exhaustiveness
    // If any branch is an explicit "else" or "true", exhaustiveness holds trivially
    const hasCatchAll = parsedBranches.some((b) => b.isElse || b.isAlwaysTrue);
    let isExhaustive = true;
    let unhandledScenarioBox: Record<string, [number, number]> | undefined = undefined;

    if (!hasCatchAll) {
      // 3a. Check propositional exhaustiveness when no numeric variables exist (e.g. `isReady` vs `not isReady`)
      if (varList.length === 0) {
        const activeNonFalse = parsedBranches.filter((b) => !b.isAlwaysFalse);
        if (activeNonFalse.length === 0) {
          isExhaustive = false;
        } else {
          const negDisjunction = activeNonFalse.map((b) => `not (${b.guardText})`).join(" and ");
          const checkExhaust = checkGuardsMutuallyExclusive(negDisjunction, "true");
          if (!checkExhaust.mutuallyExclusive) {
            isExhaustive = false;
          }
        }
      } else {
        // 3b. Fast path for 1D interval decision tables
        let handledByFastPath = false;
        if (varList.length === 1) {
          const vName = varList[0]!;
          const effDom = resolveEffectiveDomain(vName);
          const domain: [number, number] = [effDom.openLo ? 0 : effDom.boxLo, effDom.boxHi];
          const uniRes = checkUnivariateIntervalExhaustiveness(
            parsedBranches.filter((b) => !b.isAlwaysFalse),
            vName,
            domain,
            effDom.openLo,
            effDom.isDiscreteInteger,
          );
          if (uniRes) {
            handledByFastPath = true;
            if (!uniRes.isExhaustive) {
              isExhaustive = false;
              unhandledScenarioBox = { [vName]: uniRes.gap! };
            }
          }
        }

        if (!handledByFastPath) {
          const theoryLiterals = new Map<number, NonlinearConstraint>();
          const clauses: number[][] = [];
          let nextLitId = 1;

          for (const pb of parsedBranches) {
            if (pb.isAlwaysFalse) continue;
            const clause: number[] = [];
            if (pb.rawConstraints.length > 0) {
              for (const g of pb.rawConstraints) {
                const negs = negateGuard(g);
                for (const neg of negs) {
                  const litId = nextLitId++;
                  theoryLiterals.set(litId, neg);
                  clause.push(litId);
                }
              }
            } else if (pb.nlConstraints.length > 0) {
              for (const c of pb.nlConstraints) {
                const negs = negateNlConstraint(c);
                for (const neg of negs) {
                  const litId = nextLitId++;
                  theoryLiterals.set(litId, neg);
                  clause.push(litId);
                }
              }
            }
            if (clause.length > 0) {
              clauses.push(clause);
            }
          }

          if (clauses.length > 0) {
            const initialBox = buildInitialBox();
            const solver = new DpllTSolver({
              clauses,
              theoryLiterals,
              initialBox,
              delta: 1e-4,
              maxSubdivisions: 200,
            });

            const res = solver.solve(initialBox);
            if (res.status === "DELTA_SAT") {
              // Check that the uncovered witness is not on a shared boundary facet between complementary guards
              let isComplementaryBoundary = false;
              if (res.solutionBox) {
                for (const pb of parsedBranches) {
                  for (const g of pb.rawConstraints) {
                    const interval = res.solutionBox.get(g.variable);
                    if (
                      interval &&
                      g.value >= interval.lo - 1e-4 &&
                      g.value <= interval.hi + 1e-4 &&
                      interval.hi - interval.lo <= 1e-2
                    ) {
                      for (const otherPb of parsedBranches) {
                        if (otherPb === pb) continue;
                        if (areGuardsComplementaryAt(g, otherPb.rawConstraints)) {
                          isComplementaryBoundary = true;
                          break;
                        }
                      }
                    }
                    if (isComplementaryBoundary) break;
                  }
                  if (isComplementaryBoundary) break;
                }
              }

              if (!isComplementaryBoundary) {
                isExhaustive = false;
                unhandledScenarioBox = {};
                if (res.solutionBox) {
                  for (const [k, inv] of res.solutionBox.entries()) {
                    unhandledScenarioBox[k] = [inv.lo, inv.hi];
                  }
                }
              }
            }
          }
        }
      }
    }

    const isDeterministic = overlappingBranches.length === 0;
    const hasDeadBranches = deadBranches.length > 0;

    let summary = "";
    if (isExhaustive && isDeterministic && !hasDeadBranches) {
      summary = `Decision table verified: fully exhaustive, strictly deterministic (${parsedBranches.length} branches), with zero dead branches.`;
    } else {
      const issues: string[] = [];
      if (!isExhaustive) issues.push("not exhaustive (unhandled input scenario detected)");
      if (!isDeterministic)
        issues.push(`${overlappingBranches.length} overlapping non-deterministic branch collision(s) detected`);
      if (hasDeadBranches) issues.push(`${deadBranches.length} dead branch(es) detected`);
      summary = `Decision table verification failed: ${issues.join("; ")}.`;
    }

    let suggestedFixCondition: string | undefined = undefined;
    let suggestedQuickFix: string | undefined = undefined;
    if (!isExhaustive && unhandledScenarioBox) {
      suggestedFixCondition = DecisionTableVerifier.synthesizeGapCondition(unhandledScenarioBox);
      suggestedQuickFix = DecisionTableVerifier.synthesizeQuickFixSnippet(unhandledScenarioBox);
    }

    return {
      isExhaustive,
      isDeterministic,
      hasDeadBranches,
      unhandledScenarioBox,
      suggestedFixCondition,
      suggestedQuickFix,
      overlappingBranches,
      deadBranches,
      summary,
    };
  }

  /**
   * Synthesizes a Boolean guard condition expression representing the unhandled input gap.
   */
  public static synthesizeGapCondition(unhandledBox: Record<string, [number, number]>): string {
    const conditions: string[] = [];
    for (const [varName, [lo, hi]] of Object.entries(unhandledBox)) {
      const loFormatted = Math.abs(lo - Math.round(lo)) < 0.05 ? Math.round(lo) : Number(lo.toFixed(2));
      const hiFormatted = Math.abs(hi - Math.round(hi)) < 0.05 ? Math.round(hi) : Number(hi.toFixed(2));
      if (Math.abs(loFormatted - hiFormatted) < 0.01) {
        conditions.push(`${varName} == ${loFormatted}`);
      } else {
        conditions.push(`${varName} >= ${loFormatted} && ${varName} <= ${hiFormatted}`);
      }
    }
    return conditions.length > 0 ? conditions.join(" && ") : "true";
  }

  /**
   * Synthesizes an automated SysML v2 QuickFix code snippet to repair the decision table gap.
   */
  public static synthesizeQuickFixSnippet(unhandledBox: Record<string, [number, number]>): string {
    const cond = DecisionTableVerifier.synthesizeGapCondition(unhandledBox);
    return `else if (${cond}) {\n  // Auto-generated QuickFix for unhandled scenario\n}`;
  }

  private static mergeGraphVariableTypes(
    graph: ActivityGraph,
    options: DecisionTableOptions,
    extraTypes?: ReadonlyMap<string, string>,
  ): DecisionTableOptions {
    const mergedTypes = new Map<string, string>(options.variableTypes ?? []);
    if (extraTypes) {
      for (const [k, v] of extraTypes) {
        if (!mergedTypes.has(k)) mergedTypes.set(k, v);
      }
    }
    for (const p of graph.declaredOutputs) {
      if (p.type && !mergedTypes.has(p.name)) mergedTypes.set(p.name, p.type);
    }
    for (const n of graph.nodes) {
      for (const p of n.inputs) {
        if (p.type && !mergedTypes.has(p.name)) mergedTypes.set(p.name, p.type);
      }
      for (const p of n.outputs) {
        if (p.type && !mergedTypes.has(p.name)) mergedTypes.set(p.name, p.type);
      }
    }
    return mergedTypes.size > 0 ? { ...options, variableTypes: mergedTypes } : options;
  }

  /**
   * Verifies all outgoing branches from a specific decide node in an ActivityGraph.
   */
  public static verifyDecideNode(
    graph: ActivityGraph,
    decideNodeName: string,
    options: DecisionTableOptions = {},
  ): DecisionTableVerificationResult {
    const outgoing = graph.flows.filter((f) => f.source === decideNodeName);
    const unguardedCount = outgoing.filter((f) => !f.guard || f.guard.trim() === "").length;
    const guardedCount = outgoing.filter((f) => {
      const g = f.guard?.trim().toLowerCase() ?? "";
      return g !== "" && g !== "else" && g !== "default" && g !== "true";
    }).length;

    const branches: DecisionBranch[] = outgoing.map((f, idx) => {
      const rawGuard = f.guard?.trim() ?? "";
      const rawLower = rawGuard.toLowerCase();
      const isExplicitElse = rawLower === "else" || rawLower === "default";
      // Treat a single unguarded fallback succession (`first d then fallback;`) alongside guarded branches as `else`
      const isImplicitElseFallback = rawGuard === "" && unguardedCount === 1 && guardedCount >= 1;
      const isElse = isExplicitElse || isImplicitElseFallback;

      return {
        id: `${decideNodeName}_branch_${idx + 1}`,
        name: f.target,
        guardText: isElse ? "else" : rawGuard || "true",
        isElse,
        targetName: f.target,
      };
    });

    const enrichedOptions = DecisionTableVerifier.mergeGraphVariableTypes(graph, options);
    return DecisionTableVerifier.verifyDecisionTable(branches, enrichedOptions);
  }

  /**
   * Verifies all decide nodes across a SysML v2 ActivityGraph.
   */
  public static verifyAllDecisionsInGraph(
    graph: ActivityGraph,
    options: DecisionTableOptions = {},
  ): Map<string, DecisionTableVerificationResult> {
    const results = new Map<string, DecisionTableVerificationResult>();
    const decideNodes = graph.nodes.filter((n) => n.kind === "decide");

    for (const d of decideNodes) {
      results.set(d.name, DecisionTableVerifier.verifyDecideNode(graph, d.name, options));
    }

    return results;
  }

  /**
   * Verifies all decision nodes in an action symbol using QueryDB.
   */
  public static verifyAllDecisionsInDb(
    db: QueryDB,
    actionSymbol: SymbolEntry,
    options: DecisionTableOptions = {},
  ): Map<string, DecisionTableVerificationResult> {
    const graph = extractActivityGraphFromQueryDB(db, actionSymbol);
    const extraTypes = new Map<string, string>();

    const collectSymTypes = (children: readonly SymbolEntry[]) => {
      for (const ch of children) {
        if (!ch.name || ch.name === "<anonymous>") continue;
        const typing = db.childrenOf(ch.id).find((c) => c.ruleName === "OwnedFeatureTyping" && c.name);
        const metaType = typeof ch.metadata?.["typeSpecifier"] === "string" ? ch.metadata["typeSpecifier"] : undefined;
        let tName = typing?.name || metaType;
        if (!tName) {
          const txt = db.cstText(ch.startOffset, ch.endOffset, ch) || "";
          const leaves = collectCstLeaves(parseSysmlSource(txt));
          const colonIdx = leaves.findIndex((l) => l.text === ":");
          if (colonIdx !== -1) {
            const tc = readDottedChainFromLeaves(leaves, colonIdx + 1);
            if (tc) tName = tc.text;
          }
        }
        if (tName && !extraTypes.has(ch.name)) {
          extraTypes.set(ch.name, tName);
        }
      }
    };

    collectSymTypes(db.childrenOf(actionSymbol.id));
    if (actionSymbol.parentId !== null) {
      collectSymTypes(db.childrenOf(actionSymbol.parentId));
    }

    const enrichedOptions = DecisionTableVerifier.mergeGraphVariableTypes(graph, options, extraTypes);
    return DecisionTableVerifier.verifyAllDecisionsInGraph(graph, enrichedOptions);
  }

  /**
   * Verifies all decision nodes from raw SysML v2 activity source text.
   */
  public static verifyAllDecisionsFromText(
    sysmlSource: string,
    options: DecisionTableOptions = {},
  ): Map<string, DecisionTableVerificationResult> {
    const graph = extractActivityGraphFromText(sysmlSource);
    const extraTypes = new Map<string, string>();
    const leaves = collectCstLeaves(parseSysmlSource(sysmlSource));
    for (let i = 0; i + 2 < leaves.length; i++) {
      if (leaves[i + 1]!.text === ":" && isSysmlIdentLeaf(leaves[i]!.text)) {
        const tc = readDottedChainFromLeaves(leaves, i + 2);
        if (tc && !extraTypes.has(leaves[i]!.text)) {
          extraTypes.set(leaves[i]!.text, tc.text);
        }
      }
    }
    const enrichedOptions = DecisionTableVerifier.mergeGraphVariableTypes(graph, options, extraTypes);
    return DecisionTableVerifier.verifyAllDecisionsInGraph(graph, enrichedOptions);
  }
}
