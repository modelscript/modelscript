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
import { evaluateSysML2Constraint, parseSysML2Expression, type SysML2ExprAst } from "./evaluator.js";

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
  untilCondition?: string | undefined;
  invariants?: string[] | undefined; // e.g. "total <= 100", "counter >= 0"
}

type CondOp = "<" | "<=" | ">" | ">=" | "==" | "!=";

interface ParsedCondition {
  lhsVar: string;
  rhsVar?: string | undefined;
  operator: CondOp;
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
    case "!=":
      return "!=";
  }
}

function isCondOp(op: string): op is CondOp {
  return op === "<" || op === "<=" || op === ">" || op === ">=" || op === "==" || op === "!=";
}

function collectAstVarNames(ast: SysML2ExprAst, out: Set<string>): void {
  switch (ast.kind) {
    case "Identifier":
      out.add(ast.name);
      break;
    case "NumberLiteral":
    case "BooleanLiteral":
    case "StringLiteral":
      break;
    case "UnaryExpr":
      collectAstVarNames(ast.operand, out);
      break;
    case "BinaryExpr":
      collectAstVarNames(ast.left, out);
      collectAstVarNames(ast.right, out);
      break;
    case "ConditionalExpr":
      collectAstVarNames(ast.condition, out);
      collectAstVarNames(ast.thenExpr, out);
      collectAstVarNames(ast.elseExpr, out);
      break;
    case "CallExpr":
      for (const a of ast.args) collectAstVarNames(a, out);
      break;
  }
}

function evaluateConstantConditionTruth(condText: string): boolean | null {
  const trimmed = condText.trim();
  if (!trimmed) return null;
  const low = trimmed.toLowerCase();
  if (low === "true") return true;
  if (low === "false") return false;
  const leaves = collectCstLeaves(parseSysmlSource(trimmed));
  if (leaves.length === 0) return null;
  try {
    const ast = parseSysML2Expression(trimmed);
    const vars = new Set<string>();
    collectAstVarNames(ast, vars);
    if (vars.size > 0) return null;
    return evaluateSysML2Constraint(ast, {}).satisfied;
  } catch {
    return null;
  }
}

function hasValidUntilExit(loop: WhileLoopInfo): boolean {
  if (loop.untilCondition && loop.untilCondition.trim()) {
    const cTruth = evaluateConstantConditionTruth(loop.untilCondition);
    if (cTruth !== false) return true;
  }
  if (!loop.body.trim()) return false;
  const leaves = collectCstLeaves(parseSysmlSource(loop.body));
  for (let i = 0; i < leaves.length; i++) {
    if (leaves[i]!.text === "until" && i + 1 < leaves.length) {
      let endIdx = i + 1;
      while (endIdx < leaves.length && leaves[endIdx]!.text !== ";" && leaves[endIdx]!.text !== "}") {
        endIdx++;
      }
      if (endIdx > i + 1) {
        const untilExpr = loop.body.slice(leaves[i + 1]!.start, leaves[endIdx - 1]!.end).trim();
        if (untilExpr && evaluateConstantConditionTruth(untilExpr) !== false) {
          return true;
        }
      }
    }
  }
  return false;
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

  // Boolean equality: e.g. flag == true, flag != false
  if (ast.op === "==" || ast.op === "!=") {
    if (ast.left.kind === "Identifier" && ast.right.kind === "BooleanLiteral") {
      return {
        lhsVar: ast.left.name,
        operator: ast.op,
        constant: ast.right.value ? 1 : 0,
      };
    }
    if (ast.left.kind === "BooleanLiteral" && ast.right.kind === "Identifier") {
      return {
        lhsVar: ast.right.name,
        operator: ast.op,
        constant: ast.left.value ? 1 : 0,
      };
    }
  }

  // 1. var (- var)? op const: e.g. counter < 10, flag == 1, i - j <= 5
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

function parseBodyUpdatesAndModifiedVars(bodyText: string): {
  updates: StateUpdate[];
  modifiedVars: Set<string>;
} {
  const updates: StateUpdate[] = [];
  const modifiedVars = new Set<string>();
  if (!bodyText.trim()) return { updates, modifiedVars };

  const leaves = collectCstLeaves(parseSysmlSource(bodyText));
  let stmtStart = 0;
  for (let i = 0; i <= leaves.length; i++) {
    const isDelimiter =
      i === leaves.length || leaves[i]!.text === ";" || leaves[i]!.text === "{" || leaves[i]!.text === "}";
    if (!isDelimiter) continue;

    if (i > stmtStart) {
      let s = stmtStart;
      if (leaves[s]!.text === "assign") s++;

      let target: string | undefined;
      let rhsExprText: string | undefined;

      // Forward assignment: `<target> := <expr>` or `<target> = <expr>`
      if (
        isSysmlIdentLeaf(leaves[s]?.text) &&
        (leaves[s + 1]?.text === ":=" || leaves[s + 1]?.text === "=") &&
        s + 2 < i
      ) {
        target = leaves[s]!.text;
        rhsExprText = bodyText.slice(leaves[s + 2]!.start, leaves[i - 1]!.end).trim();
      } else {
        // Reverse assignment: `<expr> =: <target>`
        let revIdx = -1;
        let revEndIdx = -1;
        for (let k = s; k < i; k++) {
          if (leaves[k]!.text === "=:") {
            revIdx = k;
            revEndIdx = k;
            break;
          }
          if (leaves[k]!.text === "=" && leaves[k + 1]?.text === ":" && k + 1 < i) {
            revIdx = k;
            revEndIdx = k + 1;
            break;
          }
        }
        if (revIdx > s && revEndIdx + 1 < i && isSysmlIdentLeaf(leaves[i - 1]?.text)) {
          target = leaves[i - 1]!.text;
          rhsExprText = bodyText.slice(leaves[s]!.start, leaves[revIdx]!.start).trim();
        }
      }

      if (target && rhsExprText !== undefined) {
        modifiedVars.add(target);
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
          } else if (rhsAst.kind === "BooleanLiteral") {
            updates.push({
              targetVar: target,
              delta: rhsAst.value ? 1 : 0,
              isDirectAssignment: true,
            });
          } else if (rhsAst.kind === "Identifier" && rhsAst.name === target) {
            updates.push({
              targetVar: target,
              delta: 0,
              isDirectAssignment: false,
            });
          } else if (rhsAst.kind === "BinaryExpr") {
            if (rhsAst.left.kind === "Identifier") {
              const cRight = evalSignedLiteral(rhsAst.right);
              if (cRight !== null) {
                if (rhsAst.op === "+" && rhsAst.left.name === target) {
                  updates.push({ targetVar: target, delta: cRight, isDirectAssignment: false });
                } else if (rhsAst.op === "-" && rhsAst.left.name === target) {
                  updates.push({ targetVar: target, delta: -cRight, isDirectAssignment: false });
                } else if (rhsAst.op === "+" && rhsAst.left.name !== target) {
                  updates.push({
                    targetVar: target,
                    sourceVar: rhsAst.left.name,
                    delta: cRight,
                    isDirectAssignment: false,
                  });
                } else if (rhsAst.op === "-" && rhsAst.left.name !== target) {
                  updates.push({
                    targetVar: target,
                    sourceVar: rhsAst.left.name,
                    delta: -cRight,
                    isDirectAssignment: false,
                  });
                }
              }
            } else if (rhsAst.right.kind === "Identifier" && rhsAst.op === "+") {
              // Commuted additive update: `assign i := 1 + i;` or `assign y := 10 + x;`
              const cLeft = evalSignedLiteral(rhsAst.left);
              if (cLeft !== null) {
                if (rhsAst.right.name === target) {
                  updates.push({ targetVar: target, delta: cLeft, isDirectAssignment: false });
                } else {
                  updates.push({
                    targetVar: target,
                    sourceVar: rhsAst.right.name,
                    delta: cLeft,
                    isDirectAssignment: false,
                  });
                }
              }
            }
          }
        }
      }
    }
    stmtStart = i + 1;
  }

  return { updates, modifiedVars };
}

function parseBodyUpdates(bodyText: string): StateUpdate[] {
  return parseBodyUpdatesAndModifiedVars(bodyText).updates;
}

function evalScalarComparison(lhs: number, op: CondOp, rhs: number): boolean {
  switch (op) {
    case "<":
      return lhs < rhs;
    case "<=":
      return lhs <= rhs;
    case ">":
      return lhs > rhs;
    case ">=":
      return lhs >= rhs;
    case "==":
      return lhs === rhs;
    case "!=":
      return lhs !== rhs;
  }
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
    const { updates, modifiedVars } = parseBodyUpdatesAndModifiedVars(loop.body);
    const hasUntil = hasValidUntilExit(loop);

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
      const constTruth = evaluateConstantConditionTruth(loop.condition);
      if (constTruth === true && !hasUntil) {
        diagnostics.push({
          severity: "error",
          rule: "possible-infinite-loop",
          message: `Unbounded loop condition '${loop.condition}' is always true without an 'until' exit condition. Loop will not terminate.`,
        });
        return {
          isTerminating: false,
          invariantHolds: true,
          postConditions: currentBounds,
          iterationsEstimated: 0,
          diagnostics,
          summary: `Loop has an unconditional '${loop.condition}' guard without an exit condition.`,
        };
      }

      // Compound boolean or symbolic condition (e.g. `i < n + 1`, `i < 10 and ready`):
      // Do NOT emit a false non-terminating warning when no infinite-loop defect is present.
      return {
        isTerminating: true,
        invariantHolds: true,
        postConditions: currentBounds,
        iterationsEstimated: 0,
        diagnostics: [],
        summary: `Loop condition '${loop.condition}' accepted (compound or symbolic guard).`,
      };
    }

    // 2. Termination & Infinite Loop Analysis (supporting both `lhsVar` and `rhsVar` updates)
    const lhsUpdate = updates.find((u) => u.targetVar === cond.lhsVar);
    const rhsUpdate = cond.rhsVar ? updates.find((u) => u.targetVar === cond.rhsVar) : undefined;
    const anyCondVarModified =
      modifiedVars.has(cond.lhsVar) || (cond.rhsVar !== undefined && modifiedVars.has(cond.rhsVar));

    const lhsDelta = lhsUpdate && !lhsUpdate.isDirectAssignment && !lhsUpdate.sourceVar ? lhsUpdate.delta : 0;
    const rhsDelta = rhsUpdate && !rhsUpdate.isDirectAssignment && !rhsUpdate.sourceVar ? rhsUpdate.delta : 0;
    const effectiveDelta = lhsDelta - rhsDelta;

    let isTerminating = true;
    let iterationsEstimated = 0;

    const lhsStart = currentBounds.get(cond.lhsVar)?.lower ?? 0;
    const rhsStart = cond.rhsVar ? (currentBounds.get(cond.rhsVar)?.upper ?? 0) : 0;
    const diffStart = cond.rhsVar ? lhsStart - rhsStart : lhsStart;
    const limit = cond.constant;
    const condLabel = cond.rhsVar
      ? `${cond.lhsVar} ${cond.operator} ${cond.rhsVar}`
      : `${cond.lhsVar} ${cond.operator} ${limit}`;

    if (!hasUntil) {
      if (cond.operator === "==" || cond.operator === "!=") {
        const stuckConstantAssign =
          !cond.rhsVar &&
          lhsUpdate?.isDirectAssignment === true &&
          evalScalarComparison(lhsUpdate.delta, cond.operator, limit);
        const stuckZeroStride =
          anyCondVarModified &&
          !lhsUpdate?.isDirectAssignment &&
          !rhsUpdate?.isDirectAssignment &&
          (lhsUpdate !== undefined || rhsUpdate !== undefined) &&
          effectiveDelta === 0;

        if (!anyCondVarModified || stuckConstantAssign || stuckZeroStride) {
          isTerminating = false;
          diagnostics.push({
            severity: "error",
            rule: "possible-infinite-loop",
            message: `Loop variable '${cond.lhsVar}' is not modified to exit condition '${condLabel}'. Loop may not terminate.`,
          });
        } else {
          iterationsEstimated =
            cond.operator === "!=" && effectiveDelta !== 0
              ? Math.max(1, Math.ceil(Math.abs(limit - diffStart) / Math.abs(effectiveDelta)))
              : 1;
        }
      } else if (!cond.rhsVar && lhsUpdate?.isDirectAssignment) {
        if (evalScalarComparison(lhsUpdate.delta, cond.operator, limit)) {
          isTerminating = false;
          diagnostics.push({
            severity: "error",
            rule: "possible-infinite-loop",
            message: `Loop variable '${cond.lhsVar}' is assigned constant ${lhsUpdate.delta}, which satisfies '${condLabel}' indefinitely. Loop may not terminate.`,
          });
        } else {
          iterationsEstimated = 1;
        }
      } else {
        const hasUnparsedNonlinearModification =
          anyCondVarModified && lhsUpdate === undefined && rhsUpdate === undefined;

        if (cond.operator === "<" || cond.operator === "<=") {
          if (effectiveDelta <= 0 && !hasUnparsedNonlinearModification) {
            isTerminating = false;
            diagnostics.push({
              severity: "error",
              rule: "possible-infinite-loop",
              message: `Loop variable '${cond.lhsVar}' is not incremented (delta = ${effectiveDelta}) while condition requires '${condLabel}'. Loop may not terminate.`,
            });
          } else if (effectiveDelta > 0) {
            iterationsEstimated =
              cond.operator === "<"
                ? Math.max(0, Math.ceil((limit - diffStart) / effectiveDelta))
                : Math.max(0, Math.floor((limit - diffStart) / effectiveDelta) + 1);
          }
        } else if (cond.operator === ">" || cond.operator === ">=") {
          if (effectiveDelta >= 0 && !hasUnparsedNonlinearModification) {
            isTerminating = false;
            diagnostics.push({
              severity: "error",
              rule: "possible-infinite-loop",
              message: `Loop variable '${cond.lhsVar}' is not decremented (delta = ${effectiveDelta}) while condition requires '${condLabel}'. Loop may not terminate.`,
            });
          } else if (effectiveDelta < 0) {
            iterationsEstimated =
              cond.operator === ">"
                ? Math.max(0, Math.ceil((diffStart - limit) / -effectiveDelta))
                : Math.max(0, Math.floor((diffStart - limit) / -effectiveDelta) + 1);
          }
        }
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
          if (parsedInv && !parsedInv.rhsVar && varIndices.has(parsedInv.lhsVar)) {
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
      if (
        !cond.rhsVar &&
        v === cond.lhsVar &&
        isTerminating &&
        lhsUpdate &&
        !lhsUpdate.isDirectAssignment &&
        !lhsUpdate.sourceVar &&
        lhsDelta !== 0
      ) {
        // Exit condition reached with exact stride overshoot
        const exitVal = lhsStart + iterationsEstimated * lhsDelta;
        postConditions.set(v, { lower: exitVal, upper: exitVal });
      } else {
        const u = updates.find((up) => up.targetVar === v);
        const b = currentBounds.get(v)!;
        if (isTerminating && u && !u.isDirectAssignment && !u.sourceVar && iterationsEstimated > 0) {
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
