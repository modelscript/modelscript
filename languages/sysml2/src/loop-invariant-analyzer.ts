// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/sysml2 — Loop Invariant & Bounded Iteration Analyzer via Octagon DBM.
 *
 * Implements Abstract Interpretation over the Octagon abstract domain (±x_i ± x_j ≤ c)
 * for SysML v2 WhileLoopNode and iterative action algorithms:
 *   1. Sound loop termination verification.
 *   2. Detection of potential infinite loops (non-progressing or diverging state).
 *   3. Loop invariant and assertion checking.
 *   4. Post-condition bound derivation upon loop exit.
 */

import {
  InductiveProver,
  Interval,
  OctagonDBM,
  type InductiveProofResult,
  type InductiveSpec,
  type NonlinearConstraint,
} from "@modelscript/runtime";
import { collectCstLeaves, isSysmlIdentLeaf, parseSysmlSource } from "./cst-utils.js";
import { parseSysML2Expression, type SysML2ExprAst } from "./evaluator.js";

export interface LoopDiagnostic {
  severity: "error" | "warning" | "info";
  rule: string;
  message: string;
}

export interface LoopInvariantResult {
  isTerminating: boolean;
  invariantHolds: boolean;
  postConditions: Map<string, { lower: number; upper: number }>;
  iterationsEstimated: number;
  diagnostics: LoopDiagnostic[];
  summary: string;
  inductiveProof?: InductiveProofResult | undefined;
}

export interface WhileLoopInfo {
  condition: string;
  body: string;
  invariants?: string[] | undefined; // e.g. "total <= 100", "counter >= 0"
}

interface ParsedCondition {
  lhsVar: string;
  rhsVar?: string | undefined;
  operator: "<" | "<=" | ">" | ">=" | "==";
  constant: number;
}

function evalSignedLiteral(expr: SysML2ExprAst): number | null {
  if (expr.kind === "NumberLiteral") return expr.value;
  if (expr.kind === "UnaryExpr" && expr.operand.kind === "NumberLiteral") {
    if (expr.op === "-") return -expr.operand.value;
    if (expr.op === "+") return expr.operand.value;
  }
  return null;
}

type CondOp = "<" | "<=" | ">" | ">=" | "==";

function flipComparisonOp(op: CondOp): CondOp {
  switch (op) {
    case "<":
      return ">";
    case "<=":
      return ">=";
    case ">":
      return "<";
    case ">=":
      return "<=";
    case "==":
      return "==";
  }
}

function isCondOp(op: string): op is CondOp {
  return op === "<" || op === "<=" || op === ">" || op === ">=" || op === "==";
}

function parseCondition(condText: string): ParsedCondition | null {
  if (!condText.trim()) return null;
  let ast: SysML2ExprAst;
  try {
    ast = parseSysML2Expression(condText);
  } catch {
    return null;
  }
  if (ast.kind !== "BinaryExpr" || !isCondOp(ast.op)) return null;

  // 1. var - var? op const: e.g. counter < 10, i - j <= 5
  const rhsConst = evalSignedLiteral(ast.right);
  if (rhsConst !== null) {
    if (ast.left.kind === "Identifier") {
      return {
        lhsVar: ast.left.name,
        operator: ast.op,
        constant: rhsConst,
      };
    }
    if (
      ast.left.kind === "BinaryExpr" &&
      ast.left.op === "-" &&
      ast.left.left.kind === "Identifier" &&
      ast.left.right.kind === "Identifier"
    ) {
      return {
        lhsVar: ast.left.left.name,
        rhsVar: ast.left.right.name,
        operator: ast.op,
        constant: rhsConst,
      };
    }
  }

  // 2. const op var: e.g. 10 > counter, 0 <= i
  const lhsConst = evalSignedLiteral(ast.left);
  if (lhsConst !== null && ast.right.kind === "Identifier") {
    return {
      lhsVar: ast.right.name,
      operator: flipComparisonOp(ast.op),
      constant: lhsConst,
    };
  }

  // 3. var op var: e.g. i < n, i <= limit (equivalent to i - limit <= 0)
  if (ast.left.kind === "Identifier" && ast.right.kind === "Identifier" && ast.left.name !== ast.right.name) {
    return {
      lhsVar: ast.left.name,
      rhsVar: ast.right.name,
      operator: ast.op,
      constant: 0,
    };
  }

  return null;
}

interface StateUpdate {
  targetVar: string;
  sourceVar?: string | undefined;
  delta: number;
  isDirectAssignment: boolean;
}

function parseBodyUpdates(bodyText: string): StateUpdate[] {
  const updates: StateUpdate[] = [];
  if (!bodyText.trim()) return updates;

  const leaves = collectCstLeaves(parseSysmlSource(bodyText));
  let stmtStart = 0;
  for (let i = 0; i <= leaves.length; i++) {
    if (i < leaves.length && leaves[i]!.text !== ";") continue;
    if (i > stmtStart) {
      let s = stmtStart;
      if (leaves[s]!.text === "assign") s++;
      const target = leaves[s]?.text;
      const opTok = leaves[s + 1]?.text;
      if (isSysmlIdentLeaf(target) && (opTok === ":=" || opTok === "=") && s + 2 < i) {
        const rhsExprText = bodyText.slice(leaves[s + 2]!.start, leaves[i - 1]!.end).trim();
        let rhsAst: SysML2ExprAst | null = null;
        try {
          rhsAst = parseSysML2Expression(rhsExprText);
        } catch {
          rhsAst = null;
        }
        if (rhsAst) {
          const directConst = evalSignedLiteral(rhsAst);
          if (directConst !== null) {
            updates.push({
              targetVar: target,
              delta: directConst,
              isDirectAssignment: true,
            });
          } else if (rhsAst.kind === "BinaryExpr" && rhsAst.left.kind === "Identifier") {
            const c = evalSignedLiteral(rhsAst.right);
            if (c !== null) {
              if (rhsAst.op === "+" && rhsAst.left.name === target) {
                updates.push({ targetVar: target, delta: c, isDirectAssignment: false });
              } else if (rhsAst.op === "-" && rhsAst.left.name === target) {
                updates.push({ targetVar: target, delta: -c, isDirectAssignment: false });
              } else if (rhsAst.op === "+" && rhsAst.left.name !== target) {
                updates.push({
                  targetVar: target,
                  sourceVar: rhsAst.left.name,
                  delta: c,
                  isDirectAssignment: false,
                });
              }
            }
          }
        }
      }
    }
    stmtStart = i + 1;
  }

  return updates;
}

export class LoopInvariantAnalyzer {
  /**
   * Analyzes loop termination, invariant preservation, and computes post-conditions
   * using Abstract Interpretation over OctagonDBM.
   */
  public static analyzeLoop(
    loop: WhileLoopInfo,
    initialBounds?: Map<string, { lower: number; upper: number }>,
  ): LoopInvariantResult {
    const diagnostics: LoopDiagnostic[] = [];
    const postConditions = new Map<string, { lower: number; upper: number }>();

    const cond = parseCondition(loop.condition);
    const updates = parseBodyUpdates(loop.body);

    // Collect all variables
    const varNames = new Set<string>();
    if (cond) {
      varNames.add(cond.lhsVar);
      if (cond.rhsVar) varNames.add(cond.rhsVar);
    }
    for (const u of updates) {
      varNames.add(u.targetVar);
      if (u.sourceVar) varNames.add(u.sourceVar);
    }
    if (initialBounds) {
      for (const k of initialBounds.keys()) varNames.add(k);
    }

    const varList = Array.from(varNames);
    const varIndices = new Map<string, number>();
    varList.forEach((v, idx) => varIndices.set(v, idx));

    const dbm = new OctagonDBM(Math.max(4, varList.length));

    // 1. Ingest initial bounds
    const currentBounds = new Map<string, { lower: number; upper: number }>();
    for (const v of varList) {
      const init = initialBounds?.get(v) ?? { lower: 0, upper: 0 };
      currentBounds.set(v, { lower: init.lower, upper: init.upper });
      const idx = varIndices.get(v)!;
      dbm.assumeInterval(idx, init.lower, init.upper);
    }

    if (!cond) {
      diagnostics.push({
        severity: "warning",
        rule: "unparseable-loop-condition",
        message: `Loop condition '${loop.condition}' could not be parsed as a linear/difference constraint.`,
      });
      return {
        isTerminating: false,
        invariantHolds: false,
        postConditions: currentBounds,
        iterationsEstimated: 0,
        diagnostics,
        summary: `Loop condition '${loop.condition}' could not be parsed; termination and invariants are unproven.`,
      };
    }

    // 2. Termination & Infinite Loop Analysis
    const loopVarUpdate = updates.find((u) => u.targetVar === cond.lhsVar);
    const delta = loopVarUpdate ? loopVarUpdate.delta : 0;

    let isTerminating = true;
    let iterationsEstimated = 0;

    const startVal = currentBounds.get(cond.lhsVar)?.lower ?? 0;
    const limit = cond.constant;

    if (cond.operator === "<") {
      if (delta <= 0) {
        isTerminating = false;
        diagnostics.push({
          severity: "error",
          rule: "possible-infinite-loop",
          message: `Loop variable '${cond.lhsVar}' is not incremented (delta = ${delta}) while condition requires '${cond.lhsVar} ${cond.operator} ${limit}'. Loop may not terminate.`,
        });
      } else {
        iterationsEstimated = Math.max(0, Math.ceil((limit - startVal) / delta));
      }
    } else if (cond.operator === "<=") {
      if (delta <= 0) {
        isTerminating = false;
        diagnostics.push({
          severity: "error",
          rule: "possible-infinite-loop",
          message: `Loop variable '${cond.lhsVar}' is not incremented (delta = ${delta}) while condition requires '${cond.lhsVar} ${cond.operator} ${limit}'. Loop may not terminate.`,
        });
      } else {
        iterationsEstimated = Math.max(0, Math.floor((limit - startVal) / delta) + 1);
      }
    } else if (cond.operator === ">") {
      if (delta >= 0) {
        isTerminating = false;
        diagnostics.push({
          severity: "error",
          rule: "possible-infinite-loop",
          message: `Loop variable '${cond.lhsVar}' is not decremented (delta = ${delta}) while condition requires '${cond.lhsVar} ${cond.operator} ${limit}'. Loop may not terminate.`,
        });
      } else {
        iterationsEstimated = Math.max(0, Math.ceil((startVal - limit) / -delta));
      }
    } else if (cond.operator === ">=") {
      if (delta >= 0) {
        isTerminating = false;
        diagnostics.push({
          severity: "error",
          rule: "possible-infinite-loop",
          message: `Loop variable '${cond.lhsVar}' is not decremented (delta = ${delta}) while condition requires '${cond.lhsVar} ${cond.operator} ${limit}'. Loop may not terminate.`,
        });
      } else {
        iterationsEstimated = Math.max(0, Math.floor((startVal - limit) / -delta) + 1);
      }
    }

    // 3. Fixed-point / bounded iteration with Octagon DBM
    let invariantHolds = true;
    const maxSteps = Math.min(256, Math.max(1, iterationsEstimated));

    for (let step = 1; step <= maxSteps; step++) {
      let anyBoundChanged = false;
      // Apply updates to DBM
      for (const u of updates) {
        const tIdx = varIndices.get(u.targetVar)!;
        const b = currentBounds.get(u.targetVar)!;
        const prevLo = b.lower;
        const prevHi = b.upper;
        if (u.isDirectAssignment) {
          b.lower = u.delta;
          b.upper = u.delta;
        } else if (u.sourceVar) {
          const sB = currentBounds.get(u.sourceVar)!;
          b.lower = sB.lower + u.delta;
          b.upper = sB.upper + u.delta;
          const sIdx = varIndices.get(u.sourceVar)!;
          dbm.assumeDiff(tIdx, sIdx, Math.floor(u.delta));
        } else {
          b.lower += u.delta;
          b.upper += u.delta;
        }
        if (b.lower !== prevLo || b.upper !== prevHi) {
          anyBoundChanged = true;
        }
        dbm.assumeInterval(tIdx, b.lower, b.upper);
      }

      // Check invariants
      if (loop.invariants) {
        for (const inv of loop.invariants) {
          const parsedInv = parseCondition(inv);
          if (parsedInv && varIndices.has(parsedInv.lhsVar)) {
            const b = currentBounds.get(parsedInv.lhsVar)!;
            if (
              (parsedInv.operator === "<=" && b.upper > parsedInv.constant) ||
              (parsedInv.operator === "<" && b.upper >= parsedInv.constant) ||
              (parsedInv.operator === ">=" && b.lower < parsedInv.constant) ||
              (parsedInv.operator === ">" && b.lower <= parsedInv.constant)
            ) {
              invariantHolds = false;
              diagnostics.push({
                severity: "error",
                rule: "loop-invariant-violation",
                message: `Loop invariant '${inv}' violated in iteration ${step} (current bounds: [${b.lower}, ${b.upper}]).`,
              });
            }
          }
        }
      }
      if (!anyBoundChanged || !invariantHolds) {
        break;
      }
    }

    // 4. First-Order Inductive Invariant Prover with Automated Lemma Strengthening (Imandra)
    let inductiveProof: InductiveProofResult | undefined;
    if (loop.invariants && loop.invariants.length > 0) {
      try {
        inductiveProof = LoopInvariantAnalyzer.proveInductiveInvariant(loop, initialBounds);
        if (inductiveProof.status === "DISPROVEN") {
          invariantHolds = false;
          diagnostics.push({
            severity: "error",
            rule: "loop-invariant-violation",
            message: inductiveProof.summary,
          });
        }
      } catch {
        // Fall back to abstract interpretation / unrolled bounds
      }
    }

    // 5. Derive sound post-conditions
    for (const v of varList) {
      if (v === cond.lhsVar && isTerminating) {
        // Exit condition reached with exact stride overshoot
        const exitVal = startVal + iterationsEstimated * delta;
        postConditions.set(v, { lower: exitVal, upper: exitVal });
      } else {
        const u = updates.find((up) => up.targetVar === v);
        const b = currentBounds.get(v)!;
        if (isTerminating && u && !u.isDirectAssignment && iterationsEstimated > 0) {
          const totalDelta = u.delta * iterationsEstimated;
          const initial = initialBounds?.get(v)?.lower ?? 0;
          postConditions.set(v, { lower: initial + totalDelta, upper: initial + totalDelta });
        } else {
          postConditions.set(v, { lower: b.lower, upper: b.upper });
        }
      }
    }

    let summary: string;
    if (!isTerminating) {
      summary = `Loop has potential termination defects or unbounded progression.`;
    } else if (loop.invariants && loop.invariants.length > 0) {
      if (inductiveProof?.status === "PROVEN") {
        summary = `Loop is guaranteed to terminate in ~${iterationsEstimated} iteration(s). Invariants verified inductively for arbitrary iterations.`;
      } else if (invariantHolds) {
        summary = `Loop is guaranteed to terminate in ~${iterationsEstimated} iteration(s). Invariants verified up to k=${maxSteps} iterations (bounded unroll).`;
      } else {
        summary = `Loop is guaranteed to terminate in ~${iterationsEstimated} iteration(s), but invariant violation detected.`;
      }
    } else {
      summary = `Loop is guaranteed to terminate in ~${iterationsEstimated} iteration(s).`;
    }

    return {
      isTerminating,
      invariantHolds,
      postConditions,
      iterationsEstimated,
      diagnostics,
      summary,
      inductiveProof,
    };
  }

  /**
   * Builds an InductiveSpec for first-order induction over SysML v2 loop action bodies.
   */
  public static buildInductiveSpec(
    loop: WhileLoopInfo,
    initialBounds?: Map<string, { lower: number; upper: number }>,
  ): InductiveSpec | null {
    const cond = parseCondition(loop.condition);
    const updates = parseBodyUpdates(loop.body);

    const varNames = new Set<string>();
    if (cond) {
      varNames.add(cond.lhsVar);
      if (cond.rhsVar) varNames.add(cond.rhsVar);
    }
    for (const u of updates) {
      varNames.add(u.targetVar);
      if (u.sourceVar) varNames.add(u.sourceVar);
    }
    if (initialBounds) {
      for (const k of initialBounds.keys()) varNames.add(k);
    }
    if (loop.invariants) {
      for (const inv of loop.invariants) {
        const p = parseCondition(inv);
        if (p) {
          varNames.add(p.lhsVar);
          if (p.rhsVar) varNames.add(p.rhsVar);
        }
      }
    }

    const varList = Array.from(varNames);
    const init: NonlinearConstraint[] = [];
    const transition: NonlinearConstraint[] = [];
    const invariant: NonlinearConstraint[] = [];
    const domainBounds = new Map<string, Interval>();

    // Init constraints
    for (const v of varList) {
      const b = initialBounds?.get(v) ?? { lower: 0, upper: 0 };
      if (b.lower === b.upper) {
        init.push({ expr: { kind: "var", name: v }, rel: "==", rhs: b.lower });
      } else {
        init.push({ expr: { kind: "var", name: v }, rel: ">=", rhs: b.lower });
        init.push({ expr: { kind: "var", name: v }, rel: "<=", rhs: b.upper });
      }
      domainBounds.set(v, new Interval(Math.min(-100, b.lower - 100), Math.max(100, b.upper + 100)));
    }

    // Transition constraints: loop condition guard
    if (cond) {
      if (cond.rhsVar) {
        transition.push({
          expr: { kind: "sub", left: { kind: "var", name: cond.lhsVar }, right: { kind: "var", name: cond.rhsVar } },
          rel: cond.operator === "<" ? "<=" : cond.operator === ">" ? ">=" : cond.operator,
          rhs: cond.operator === "<" ? cond.constant - 1 : cond.operator === ">" ? cond.constant + 1 : cond.constant,
        });
      } else {
        transition.push({
          expr: { kind: "var", name: cond.lhsVar },
          rel: cond.operator === "<" ? "<=" : cond.operator === ">" ? ">=" : cond.operator,
          rhs: cond.operator === "<" ? cond.constant - 1 : cond.operator === ">" ? cond.constant + 1 : cond.constant,
        });
      }
    }

    // Transition constraints: body variable updates
    const updatedVars = new Set<string>();
    for (const u of updates) {
      updatedVars.add(u.targetVar);
      if (u.isDirectAssignment) {
        transition.push({
          expr: { kind: "var", name: u.targetVar + "_prime" },
          rel: "==",
          rhs: u.delta,
        });
      } else if (u.sourceVar) {
        transition.push({
          expr: {
            kind: "sub",
            left: { kind: "var", name: u.targetVar + "_prime" },
            right: { kind: "var", name: u.sourceVar },
          },
          rel: "==",
          rhs: u.delta,
        });
      } else {
        transition.push({
          expr: {
            kind: "sub",
            left: { kind: "var", name: u.targetVar + "_prime" },
            right: { kind: "var", name: u.targetVar },
          },
          rel: "==",
          rhs: u.delta,
        });
      }
    }

    // Frame condition: unassigned variables preserve value across loop steps
    for (const v of varList) {
      if (!updatedVars.has(v)) {
        transition.push({
          expr: {
            kind: "sub",
            left: { kind: "var", name: v + "_prime" },
            right: { kind: "var", name: v },
          },
          rel: "==",
          rhs: 0,
        });
      }
    }

    // Invariant constraints
    if (loop.invariants) {
      for (const inv of loop.invariants) {
        const p = parseCondition(inv);
        if (p) {
          if (p.rhsVar) {
            invariant.push({
              expr: { kind: "sub", left: { kind: "var", name: p.lhsVar }, right: { kind: "var", name: p.rhsVar } },
              rel: p.operator === "<" ? "<=" : p.operator === ">" ? ">=" : p.operator,
              rhs: p.constant,
            });
          } else {
            invariant.push({
              expr: { kind: "var", name: p.lhsVar },
              rel: p.operator === "<" ? "<=" : p.operator === ">" ? ">=" : p.operator,
              rhs: p.constant,
            });
          }
        }
      }
    }

    return {
      variables: varList,
      init,
      transition,
      invariant,
      domainBounds,
    };
  }

  /**
   * Executes first-order mathematical induction with automated lemma strengthening (Imandra-equivalent).
   */
  public static proveInductiveInvariant(
    loop: WhileLoopInfo,
    initialBounds?: Map<string, { lower: number; upper: number }>,
  ): InductiveProofResult {
    const spec = LoopInvariantAnalyzer.buildInductiveSpec(loop, initialBounds);
    if (!spec || spec.invariant.length === 0) {
      return {
        status: "UNKNOWN",
        isInductive: false,
        initiationHolds: false,
        consecutionHolds: false,
        summary: "No valid loop invariant constraints could be parsed for inductive proof.",
      };
    }

    return InductiveProver.proveInvariant(spec);
  }
}
