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
import { DpllTSolver, Interval, type NonlinearConstraint } from "@modelscript/runtime";
import { extractActivityGraphFromQueryDB, extractActivityGraphFromText, type ActivityGraph } from "./activity-cfa.js";
import { extractVariables, parseGuardConstraints, type GuardConstraint } from "./state-machine-verifier.js";

export interface DecisionBranch {
  id: string;
  name?: string;
  guardText: string;
  targetName?: string;
}

export interface DecisionTableVerificationResult {
  isExhaustive: boolean;
  isDeterministic: boolean;
  hasDeadBranches: boolean;
  unhandledScenarioBox?: Record<string, [number, number]>;
  suggestedFixCondition?: string;
  suggestedQuickFix?: string;
  overlappingBranches: {
    branchA: string;
    branchB: string;
    witnessBox: Record<string, [number, number]>;
  }[];
  deadBranches: string[];
  summary: string;
}

export interface DecisionTableOptions {
  domainBounds?: Map<string, [number, number]>;
  defaultRange?: [number, number];
}

/**
 * Converts a GuardConstraint into a runtime NonlinearConstraint.
 */
export function toNonlinearConstraint(g: GuardConstraint): NonlinearConstraint {
  if (g.nonlinear) {
    return g.nonlinear;
  }
  const varName = g.variable;
  if (g.operator === "<" || g.operator === "<=") {
    return { expr: { kind: "var", name: varName }, rel: "<=", rhs: g.value };
  } else if (g.operator === ">" || g.operator === ">=") {
    return { expr: { kind: "var", name: varName }, rel: ">=", rhs: g.value };
  } else {
    return { expr: { kind: "var", name: varName }, rel: "==", rhs: g.value };
  }
}

/**
 * Negates a single constraint into an array of equivalent non-linear inequalities.
 */
function negateNlConstraint(c: NonlinearConstraint): NonlinearConstraint[] {
  if (c.rel === "<=") {
    return [{ expr: c.expr, rel: ">=", rhs: c.rhs }];
  } else if (c.rel === ">=") {
    return [{ expr: c.expr, rel: "<=", rhs: c.rhs }];
  } else {
    return [
      { expr: c.expr, rel: "<=", rhs: c.rhs },
      { expr: c.expr, rel: ">=", rhs: c.rhs },
    ];
  }
}

function negateGuard(g: GuardConstraint, eps = 1e-5): NonlinearConstraint[] {
  if (g.nonlinear) {
    return negateNlConstraint(g.nonlinear);
  }
  const varName = g.variable;
  if (g.operator === "<") {
    return [{ expr: { kind: "var", name: varName }, rel: ">=", rhs: g.value }];
  } else if (g.operator === "<=") {
    return [{ expr: { kind: "var", name: varName }, rel: ">=", rhs: g.value + eps }];
  } else if (g.operator === ">") {
    return [{ expr: { kind: "var", name: varName }, rel: "<=", rhs: g.value }];
  } else if (g.operator === ">=") {
    return [{ expr: { kind: "var", name: varName }, rel: "<=", rhs: g.value - eps }];
  } else {
    return [
      { expr: { kind: "var", name: varName }, rel: "<=", rhs: g.value - eps },
      { expr: { kind: "var", name: varName }, rel: ">=", rhs: g.value + eps },
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
    let loB = -Infinity,
      hiB = Infinity,
      strictLoB = false,
      strictHiB = false;

    for (const g of guardsA) {
      if (g.variable !== v || g.nonlinear) continue;
      if (g.operator === "<") {
        hiA = Math.min(hiA, g.value);
        strictHiA = true;
      } else if (g.operator === "<=") {
        hiA = Math.min(hiA, g.value);
      } else if (g.operator === ">") {
        loA = Math.max(loA, g.value);
        strictLoA = true;
      } else if (g.operator === ">=") {
        loA = Math.max(loA, g.value);
      } else if (g.operator === "==") {
        loA = Math.max(loA, g.value);
        hiA = Math.min(hiA, g.value);
      }
    }

    for (const g of guardsB) {
      if (g.variable !== v || g.nonlinear) continue;
      if (g.operator === "<") {
        hiB = Math.min(hiB, g.value);
        strictHiB = true;
      } else if (g.operator === "<=") {
        hiB = Math.min(hiB, g.value);
      } else if (g.operator === ">") {
        loB = Math.max(loB, g.value);
        strictLoB = true;
      } else if (g.operator === ">=") {
        loB = Math.max(loB, g.value);
      } else if (g.operator === "==") {
        loB = Math.max(loB, g.value);
        hiB = Math.min(hiB, g.value);
      }
    }

    if (hiA < loB || hiB < loA) return true;
    if (hiA === loB && (strictHiA || strictLoB)) return true;
    if (hiB === loA && (strictHiB || strictLoA)) return true;
  }

  for (const gA of guardsA) {
    for (const gB of guardsB) {
      if (gA.variable === gB.variable && Math.abs(gA.value - gB.value) < 1e-4) {
        if (
          (gA.operator === "<" && (gB.operator === ">=" || gB.operator === ">")) ||
          (gB.operator === "<" && (gA.operator === ">=" || gA.operator === ">")) ||
          (gA.operator === "<=" && gB.operator === ">") ||
          (gB.operator === "<=" && gA.operator === ">")
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
        (other.operator === "<=" && g.operator === ">")
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
): { isExhaustive: boolean; gap?: [number, number] } | null {
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
        hi = Math.min(hi, g.value);
        strictHi = true;
      } else if (g.operator === "<=") {
        hi = Math.min(hi, g.value);
      } else if (g.operator === ">") {
        lo = Math.max(lo, g.value);
        strictLo = true;
      } else if (g.operator === ">=") {
        lo = Math.max(lo, g.value);
      } else if (g.operator === "==") {
        lo = Math.max(lo, g.value);
        hi = Math.min(hi, g.value);
      } else return null;
    }
    intervals.push({ lo, hi, strictLo, strictHi });
  }

  intervals.sort((a, b) => a.lo - b.lo);

  let currentHi = domain[0];
  let currentStrictHi = false;
  for (const inv of intervals) {
    if (inv.hi < domain[0]) continue;
    if (inv.lo > domain[1]) break;

    if (inv.lo > currentHi + 1e-7) {
      return { isExhaustive: false, gap: [currentHi, inv.lo] };
    }
    if (Math.abs(inv.lo - currentHi) <= 1e-7 && currentStrictHi && inv.strictLo) {
      return { isExhaustive: false, gap: [currentHi, currentHi] };
    }

    if (inv.hi > currentHi + 1e-7) {
      currentHi = inv.hi;
      currentStrictHi = inv.strictHi;
    } else if (Math.abs(inv.hi - currentHi) <= 1e-7) {
      currentStrictHi = currentStrictHi && inv.strictHi;
    }
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

    // Parse each branch guard into a list of NonlinearConstraints
    const parsedBranches = branches.map((b) => {
      const isElse = b.guardText.trim().toLowerCase() === "else" || b.guardText.trim().toLowerCase() === "default";
      const isAlwaysTrue = b.guardText.trim().toLowerCase() === "true" || b.guardText.trim() === "";

      const raw = isElse || isAlwaysTrue ? [] : parseGuardConstraints(b.guardText);
      const nl = raw.map((g) => toNonlinearConstraint(g));
      return {
        ...b,
        rawConstraints: raw,
        isElse,
        isAlwaysTrue,
        nlConstraints: nl,
      };
    });

    // Collect all variables
    const varNames = new Set<string>();
    for (const pb of parsedBranches) {
      for (const c of pb.nlConstraints) {
        extractVariables(c.expr, varNames);
      }
    }
    const varList = Array.from(varNames);

    // Build default initial box
    const buildInitialBox = (): Map<string, Interval> => {
      const box = new Map<string, Interval>();
      for (const v of varList) {
        const bounds = options.domainBounds?.get(v) ?? defaultRange;
        box.set(v, new Interval(bounds[0], bounds[1]));
      }
      return box;
    };

    // 1. Check Dead Branches (Reachability)
    const deadBranches: string[] = [];
    for (const pb of parsedBranches) {
      if (pb.isElse || pb.isAlwaysTrue) continue;
      if (pb.nlConstraints.length === 0) continue;

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

        // An "else" branch by definition cannot collide with non-else branches
        if (bA.isElse || bB.isElse) continue;

        // If one is always true and the other has constraints, they collide whenever the other is SAT
        if (bA.isAlwaysTrue && bB.isAlwaysTrue) {
          overlappingBranches.push({
            branchA: bA.id,
            branchB: bB.id,
            witnessBox: {},
          });
          continue;
        }

        // If guards are strictly disjoint (e.g. x < c vs x >= c), they do not overlap
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
      // 3a. Fast path for 1D interval decision tables
      let handledByFastPath = false;
      if (varList.length === 1) {
        const vName = varList[0]!;
        const domain = (options.domainBounds?.get(vName) ?? defaultRange) as [number, number];
        const uniRes = checkUnivariateIntervalExhaustiveness(parsedBranches, vName, domain);
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

  /**
   * Verifies all outgoing branches from a specific decide node in an ActivityGraph.
   */
  public static verifyDecideNode(
    graph: ActivityGraph,
    decideNodeName: string,
    options: DecisionTableOptions = {},
  ): DecisionTableVerificationResult {
    const outgoing = graph.flows.filter((f) => f.source === decideNodeName);
    const branches: DecisionBranch[] = outgoing.map((f, idx) => ({
      id: `${decideNodeName}_branch_${idx + 1}`,
      name: f.target,
      guardText: f.guard || "true",
      targetName: f.target,
    }));

    return DecisionTableVerifier.verifyDecisionTable(branches, options);
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
    return DecisionTableVerifier.verifyAllDecisionsInGraph(graph, options);
  }

  /**
   * Verifies all decision nodes from raw SysML v2 activity source text.
   */
  public static verifyAllDecisionsFromText(
    sysmlSource: string,
    options: DecisionTableOptions = {},
  ): Map<string, DecisionTableVerificationResult> {
    const graph = extractActivityGraphFromText(sysmlSource);
    return DecisionTableVerifier.verifyAllDecisionsInGraph(graph, options);
  }
}
