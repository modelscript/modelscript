// SPDX-License-Identifier: AGPL-3.0-or-later

import { StringWriter } from "@modelscript/dsl/utils";
import { ArenaDAEPrinter, EqKind, ExprKind } from "@modelscript/runtime";
import { Cst, type SyntaxNode } from "../../../../src-gen/bindings.js";
import { ModelicaErrorCode } from "../../../errors.js";
import { stripAsciiWhitespace } from "../../expressions/cst-utils.js";
import {
  castToRealExpr,
  evalDaeExpr,
  expandVarToArrayCtor,
  getArrayCtorElements,
  isRealExpr,
} from "../../expressions/index.js";
import { getElementDiagRange } from "../../support/range-utils.js";
import { isNamedFunctionCallCst } from "./cst-helpers.js";
import { emitFunctionCallEquation } from "./function-call-eq.js";
import { extractSimpleEquationSides } from "./simple-eq.js";
import type { EquationCstNode, EquationWalkContext } from "./types.js";

export function lowerWhenEquation(
  ctx: EquationWalkContext,
  node: EquationCstNode,
  substitutions: Map<string, number | string> | undefined,
  isInitial: boolean | undefined,
): void {
  const { flattener, prefix, dae } = ctx;
  if (isInitial) {
    const diagRange = getElementDiagRange(node);
    dae.diagnostics.push({
      severity: "error",
      code: ModelicaErrorCode.WHEN_IN_INITIAL_EQUATION.code,
      message: `when-clause is not allowed in initial section.`,
      range: diagRange,
    });
    return;
  }

  // Check condition for noEvent
  const cond =
    Cst.WhenEquation.condition(node) ?? (node.children || []).find((c: SyntaxNode) => c.type === "expression");
  if (cond && cond.text?.trim()?.includes("noEvent")) {
    dae.diagnostics.push({
      severity: "error",
      code: ModelicaErrorCode.WHEN_CONDITION_NOT_DISCRETE.code,
      message: `When-condition '${cond.text.trim()}' is not a discrete-time expression.`,
      range: {
        startPosition: node.startPosition,
        endPosition: node.endPosition,
      },
    });
    return;
  }

  // Check if-equations inside when-equation for consistent LHS branches
  const checkIfInWhen = (n: SyntaxNode | null | undefined): boolean => {
    if (!n) return false;
    if (n.type === "if_equation" || Cst.IfEquation.is(n)) {
      const branches: string[][] = [[]];
      let curBranch = branches[0]!;
      for (const child of n.children || []) {
        const norm = Cst.kind(child);
        const text = child.text?.trim() ?? "";
        if (
          norm === "elseif" ||
          child.type === "elseif" ||
          text === "elseif" ||
          norm === "else" ||
          child.type === "else" ||
          text === "else"
        ) {
          curBranch = [];
          branches.push(curBranch);
        } else {
          const collectSimpleLhs = (sn: SyntaxNode) => {
            if (sn.type === "simple_equation") {
              const lhs = (sn.children || []).find(
                (k: SyntaxNode) => k.type === "lhs_expression" || k.type === "component_reference",
              );
              if (lhs) {
                const v = stripAsciiWhitespace(lhs.text);
                if (!curBranch.includes(v)) curBranch.push(v);
              }
              return;
            }
            for (const c of sn.children || []) {
              collectSimpleLhs(c);
            }
          };
          collectSimpleLhs(child);
        }
      }
      if (branches.length > 1) {
        const baseVars = branches[0]!.slice().sort();
        let mismatch = false;
        for (let b = 1; b < branches.length; b++) {
          const compVars = branches[b]!.slice().sort();
          if (baseVars.length !== compVars.length || baseVars.some((v, i) => v !== compVars[i])) {
            mismatch = true;
            break;
          }
        }
        if (mismatch) {
          dae.diagnostics.push({
            severity: "error",
            code: ModelicaErrorCode.WHEN_IF_BRANCH_LHS_MISMATCH.code,
            message:
              "The branches of an if-equation inside a when-equation must have the same set of component references on the left-hand side.",
            range: {
              startPosition: n.startPosition,
              endPosition: n.endPosition,
            },
          });
          return true;
        }
      }
    }
    for (const c of n.children || []) {
      if (checkIfInWhen(c)) return true;
    }
    return false;
  };

  if (checkIfInWhen(node)) return;

  // Collect elsewhen conditions
  const elseConditions: EquationCstNode[] = [];
  let nextIsElseCond = false;
  for (const child of (node.children || []) as EquationCstNode[]) {
    const norm = Cst.kind(child);
    const text = child.text?.trim() ?? "";
    if (norm === "elsewhen" || child.type === "elsewhen" || text === "elsewhen") {
      nextIsElseCond = true;
    } else if (nextIsElseCond && (child.type === "expression" || !child.isTerminal)) {
      elseConditions.push(child);
      nextIsElseCond = false;
    }
  }

  const isClockNode = (n: SyntaxNode | null | undefined): boolean => {
    if (!n) return false;
    if (isNamedFunctionCallCst(n, ["Clock", ".Clock"])) return true;
    try {
      const eid = flattener.lowerExpr(n, dae, prefix, substitutions);
      if (eid >= 0 && dae.getExprKind(eid) === ExprKind.Call) {
        const callee = dae.interner.resolve(dae.getExprData1(eid));
        if (callee === "Clock" || callee === ".Clock") return true;
      }
    } catch {
      /* ignore lowering errors when probing for Clock() */
    }
    return false;
  };

  if (elseConditions.length > 0) {
    if (isClockNode(cond)) {
      dae.diagnostics.push({
        severity: "error",
        code: ModelicaErrorCode.CLOCKED_WHEN_HAS_ELSEWHEN.code,
        message: "Clocked when equation can not contain elsewhen part.",
        range: {
          startPosition: node.startPosition,
          endPosition: node.endPosition,
        },
      });
      return;
    }
    for (const ec of elseConditions) {
      if (isClockNode(ec)) {
        dae.diagnostics.push({
          severity: "error",
          code: ModelicaErrorCode.CLOCKED_WHEN_BRANCH_IN_WHEN.code,
          message: "Clocked when branch in when equation.",
          range: {
            startPosition: node.startPosition,
            endPosition: node.endPosition,
          },
        });
        return;
      }
    }
  }

  const hasNestedWhen = (node.children || []).some(
    (c: SyntaxNode) => c.type === "when_equation" || c.type === "when_statement",
  );

  const condId = cond ? flattener.lowerExpr(cond, dae, prefix, substitutions) : -1;
  const whenIdx = dae.addWhenEquation(condId);
  const whenMeta = dae.getWhenEquationMeta(whenIdx);
  let currentElseWhenClause: {
    conditionExprId: number;
    bodyEquations: { kind: EqKind; lhsExprId: number; rhsExprId: number }[];
    equations: { kind: EqKind; lhs: number; rhs: number }[];
  } | null = null;

  let hasWhenLhsError = false;
  const expandWhenSide = (exprId: number): number => {
    if (exprId < 0 || flattener.options.arrayMode === "preserve") return exprId;
    const k = dae.getExprKind(exprId);
    if (k === ExprKind.Name) {
      const name = dae.interner.resolve(dae.getExprData1(exprId));
      if (name) {
        const exp = expandVarToArrayCtor(name, dae);
        if (exp !== null) return exp;
      }
    } else if (k === ExprKind.Subscript) {
      const baseId = dae.getExprData1(exprId);
      const subCount = dae.getExprRight(exprId);
      if (dae.getExprKind(baseId) === ExprKind.Name && subCount === 1) {
        const sub0 = dae.getExprLeft(exprId);
        if (dae.getExprKind(sub0) === ExprKind.ArrayCtor) {
          const baseName = dae.interner.resolve(dae.getExprData1(baseId));
          const subElems = getArrayCtorElements(sub0, dae);
          const expandedItems = subElems.map((se) => {
            const v = evalDaeExpr(se, dae);
            if (typeof v === "number" && Number.isInteger(v)) {
              return dae.addNameExpr(`${baseName}[${v}]`);
            }
            return dae.addSubscriptExpr(baseId, [se]);
          });
          return dae.addArrayCtorExpr(expandedItems);
        }
      }
    }
    return exprId;
  };
  const emitWhenEqPair = (lId: number, rId: number) => {
    const lK = dae.getExprKind(lId);
    const rK = dae.getExprKind(rId);
    if (lK === ExprKind.ArrayCtor && rK === ExprKind.ArrayCtor) {
      const lElems = getArrayCtorElements(lId, dae);
      const rElems = getArrayCtorElements(rId, dae);
      if (lElems.length === rElems.length && lElems.length > 0) {
        for (let i = 0; i < lElems.length; i++) {
          emitWhenEqPair(lElems[i]!, rElems[i]!);
        }
        return;
      }
    }
    let finalRhs = rId;
    if (isRealExpr(lId, dae) && !isRealExpr(finalRhs, dae)) {
      finalRhs = castToRealExpr(finalRhs, dae);
    }
    if (currentElseWhenClause) {
      currentElseWhenClause.equations.push({ kind: EqKind.Simple, lhs: lId, rhs: finalRhs });
      currentElseWhenClause.bodyEquations.push({
        kind: EqKind.Simple,
        lhsExprId: lId,
        rhsExprId: finalRhs,
      });
    } else {
      dae.addWhenBodyEquation(whenIdx, EqKind.Simple, lId, finalRhs);
    }
  };
  const collectWhenBody = (n: SyntaxNode | null | undefined) => {
    if (!n || hasWhenLhsError) return;
    if (n.type === "simple_equation") {
      const sides = extractSimpleEquationSides(n, flattener, dae, prefix, substitutions);
      if (sides) {
        let lhsId = sides.lhsExprId;
        const isTupleLhs = sides.isTupleLhs;
        let rhsId = flattener.lowerExpr(sides.rhsNode, dae, prefix, substitutions, isTupleLhs);
        if (isRealExpr(lhsId, dae) && !isRealExpr(rhsId, dae)) {
          rhsId = castToRealExpr(rhsId, dae);
        }
        if (dae.getExprKind(rhsId) === ExprKind.Call) {
          const fnName = dae.interner.resolve(dae.getExprData1(rhsId));
          if (fnName === "fill" && dae.getExprRight(rhsId) >= 2) {
            const arg2 = dae.getExprLeft(rhsId + 1);
            if (evalDaeExpr(arg2, dae) === 0) {
              return;
            }
          }
        }
        const lhsKind = dae.getExprKind(lhsId);
        if (
          lhsKind === ExprKind.Binary ||
          lhsKind === ExprKind.RealLiteral ||
          lhsKind === ExprKind.IntLiteral ||
          lhsKind === ExprKind.Unary
        ) {
          const out = new StringWriter();
          const printer = new ArenaDAEPrinter(out, dae, true);
          printer.printExpr(lhsId);
          const lhsStr = out.toString();
          dae.diagnostics.push({
            severity: "error",
            code: ModelicaErrorCode.INVALID_WHEN_LHS.code,
            message: `Invalid left-hand side of when-equation: ${lhsStr}.`,
            range: {
              startPosition: n.startPosition,
              endPosition: n.endPosition,
            },
          });
          hasWhenLhsError = true;
          return;
        }
        if (isTupleLhs) {
          emitWhenEqPair(lhsId, rhsId);
        } else {
          const expLhs = expandWhenSide(lhsId);
          const expRhs = expandWhenSide(rhsId);
          emitWhenEqPair(expLhs, expRhs);
        }
      }
      return;
    }

    if (n.type === "connect_equation") {
      const rawConn = n.text?.trim();
      const connText = rawConn === undefined ? "connect(...)" : rawConn.endsWith(";") ? rawConn.slice(0, -1) : rawConn;
      dae.diagnostics.push({
        severity: "error",
        code: ModelicaErrorCode.CONNECT_IN_WHEN.code,
        message: ModelicaErrorCode.CONNECT_IN_WHEN.message(connText),
        range: {
          startPosition: n.startPosition,
          endPosition: n.endPosition,
        },
      });
      return;
    }

    if (n.type === "function_call") {
      emitFunctionCallEquation(flattener, n, dae, prefix, substitutions, false, whenIdx, currentElseWhenClause);
      return;
    }

    for (const child of n.children || []) {
      if (child !== cond && child.type !== "when" && child.type !== "then" && child.type !== "end when") {
        collectWhenBody(child);
      }
    }
  };

  let expectElseWhenCond = false;
  for (const kid of (node.children || []) as EquationCstNode[]) {
    const norm = Cst.kind(kid);
    const text = kid.text?.trim() ?? "";
    if (norm === "elsewhen" || kid.type === "elsewhen" || text === "elsewhen") {
      expectElseWhenCond = true;
      continue;
    }
    if (expectElseWhenCond && (kid.type === "expression" || !kid.isTerminal)) {
      const elseCondId = flattener.lowerExpr(kid, dae, prefix, substitutions);
      currentElseWhenClause = {
        conditionExprId: elseCondId,
        bodyEquations: [],
        equations: [],
      };
      whenMeta?.elseWhenClauses.push(currentElseWhenClause);
      expectElseWhenCond = false;
      continue;
    }
    if (kid !== cond && kid.type !== "when" && kid.type !== "then" && kid.type !== "end when") {
      collectWhenBody(kid);
    }
  }

  if (!hasWhenLhsError && !hasNestedWhen && whenMeta && whenMeta.elseWhenClauses.length > 0) {
    const extractLhsSet = (eqs: { kind: EqKind; lhsExprId: number; rhsExprId: number }[]): string[] => {
      const vars = new Set<string>();
      for (const eq of eqs) {
        if (eq.kind === EqKind.Simple) {
          const out = new StringWriter();
          const printer = new ArenaDAEPrinter(out, dae, true);
          printer.printExpr(eq.lhsExprId);
          vars.add(stripAsciiWhitespace(out.toString()));
        }
      }
      return Array.from(vars).sort();
    };
    const baseVars = extractLhsSet(whenMeta.bodyEquations);
    let hasMismatch = false;
    for (const ew of whenMeta.elseWhenClauses) {
      const compVars = extractLhsSet(ew.bodyEquations);
      if (baseVars.length !== compVars.length || baseVars.some((v, i) => v !== compVars[i])) {
        hasMismatch = true;
        break;
      }
    }
    if (hasMismatch) {
      dae.diagnostics.push({
        severity: "error",
        code: ModelicaErrorCode.ELSEWHEN_VARIABLE_MISMATCH.code,
        message: ModelicaErrorCode.ELSEWHEN_VARIABLE_MISMATCH.message(),
        range: {
          startPosition: node.startPosition,
          endPosition: node.endPosition,
        },
      });
      return;
    }
  }
  return;
}
