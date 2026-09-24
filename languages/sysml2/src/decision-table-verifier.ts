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
function toNonlinearConstraint(g: GuardConstraint, eps = 1e-3): NonlinearConstraint {
  if (g.nonlinear) {
    return g.nonlinear;
  }
  const varName = g.variable.includes(".") ? g.variable.split(".").pop()! : g.variable;
  if (g.operator === "<") {
    return { expr: { kind: "var", name: varName }, rel: "<=", rhs: g.value - eps };
  } else if (g.operator === ">") {
    return { expr: { kind: "var", name: varName }, rel: ">=", rhs: g.value + eps };
  } else if (g.operator === "<=") {
    return { expr: { kind: "var", name: varName }, rel: "<=", rhs: g.value };
  } else if (g.operator === ">=") {
    return { expr: { kind: "var", name: varName }, rel: ">=", rhs: g.value };
  } else {
    return { expr: { kind: "var", name: varName }, rel: "==", rhs: g.value };
  }
}

/**
 * Negates a single constraint into an array of equivalent non-linear inequalities.
 */
function negateNlConstraint(c: NonlinearConstraint, eps = 1e-3): NonlinearConstraint[] {
  if (c.rel === "<=") {
    return [{ expr: c.expr, rel: ">=", rhs: c.rhs + eps }];
  } else if (c.rel === ">=") {
    return [{ expr: c.expr, rel: "<=", rhs: c.rhs - eps }];
  } else {
    return [
      { expr: c.expr, rel: "<=", rhs: c.rhs - eps },
      { expr: c.expr, rel: ">=", rhs: c.rhs + eps },
    ];
  }
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
      // Each branch pb has a list of negation options
      const branchNegOptions: NonlinearConstraint[][] = [];

      for (const pb of parsedBranches) {
        if (pb.nlConstraints.length === 0) continue;
        const negsForThisBranch: NonlinearConstraint[] = [];
        for (const c of pb.nlConstraints) {
          negsForThisBranch.push(...negateNlConstraint(c));
        }
        if (negsForThisBranch.length > 0) {
          branchNegOptions.push(negsForThisBranch);
        }
      }

      // Generate Cartesian product of negation options (each path is a conjunction of unit constraints)
      function getCartesianPaths(optionsList: NonlinearConstraint[][]): NonlinearConstraint[][] {
        if (optionsList.length === 0) return [[]];
        const [first, ...rest] = optionsList;
        const restCombinations = getCartesianPaths(rest);
        const result: NonlinearConstraint[][] = [];
        for (const item of first!) {
          for (const comb of restCombinations) {
            result.push([item, ...comb]);
          }
        }
        return result;
      }

      const paths = getCartesianPaths(branchNegOptions);

      // Check each path: if any path is DELTA_SAT, an unhandled input scenario was found
      for (const path of paths) {
        const theoryLiterals = new Map<number, NonlinearConstraint>();
        const clauses: number[][] = [];
        let litId = 1;

        for (const c of path) {
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
          maxSubdivisions: 200,
        });

        const res = solver.solve(initialBox);
        if (res.status === "DELTA_SAT") {
          isExhaustive = false;
          unhandledScenarioBox = {};
          if (res.solutionBox) {
            for (const [k, inv] of res.solutionBox.entries()) {
              unhandledScenarioBox[k] = [inv.lo, inv.hi];
            }
          }
          break; // Found an uncovered gap
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
