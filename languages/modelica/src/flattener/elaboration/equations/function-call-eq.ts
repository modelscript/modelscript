// SPDX-License-Identifier: AGPL-3.0-or-later

import { BinOp, DAEBuilder, EqKind, ExprKind, Variability, VarType } from "@modelscript/runtime";
import type { SyntaxNode } from "../../../../src-gen/bindings.js";
import { ModelicaErrorCode } from "../../../errors.js";
import type { ModelicaFlattener } from "../../class-flattener.js";
import { isSignedAsciiNumberText } from "../../expressions/cst-utils.js";
import { castToRealExpr, evalDaeExpr, isRealExpr } from "../../expressions/index.js";
import { getFunctionCallInfoCst } from "./cst-helpers.js";

/**
 * Determines whether a lowered arena function-call expression `callId` is a `assert(cond, ...)`
 * call whose condition `cond` is statically known to evaluate to `true` at compile time.
 *
 * Inspects literal `true` conditions as well as constant, final-parameter, and enumeration
 * relational expressions so redundant assertions can be elided during flattening.
 *
 * @param callId - Arena expression ID of the candidate function call.
 * @param dae - Active `DAEBuilder` containing variable metadata and expression nodes.
 * @returns `true` if `callId` is an `assert(...)` whose condition statically evaluates to `true`.
 */
export function isStaticTrueAssert(callId: number, dae: DAEBuilder): boolean {
  if (callId < 0 || dae.getExprKind(callId) !== ExprKind.Call) return false;
  const fname = dae.interner.resolve(dae.getExprData1(callId));
  if (fname !== "assert") return false;
  const firstArg = dae.getExprLeft(callId);
  if (firstArg < 0) return false;
  if (dae.getExprKind(firstArg) === ExprKind.BoolLiteral && dae.getExprData1(firstArg) === 1) {
    return true;
  }
  const isStaticOrEnumExpr = (id: number): boolean => {
    if (id < 0) return false;
    const k = dae.getExprKind(id);
    if (
      k === ExprKind.IntLiteral ||
      k === ExprKind.RealLiteral ||
      k === ExprKind.BoolLiteral ||
      k === ExprKind.StringLiteral ||
      k === ExprKind.EnumLiteral
    ) {
      return true;
    }
    if (k === ExprKind.Name) {
      const name = dae.interner.resolve(dae.getExprData1(id));
      if (!name) return false;
      if (name === "true" || name === "false") return true;
      const vIdx = dae.lookupVariable(name);
      if (vIdx >= 0) {
        const v = dae.getVarVariability(vIdx);
        if (v === Variability.Constant) return true;
        if (v === Variability.Parameter && (dae.isVarFinal(vIdx) || dae.getVarType(vIdx) === VarType.Enumeration)) {
          return true;
        }
        return false;
      }
      return name.includes(".");
    }
    if (k === ExprKind.Unary || k === ExprKind.Negate) {
      return isStaticOrEnumExpr(dae.getExprLeft(id));
    }
    if (k === ExprKind.Binary) {
      const l = dae.getExprLeft(id);
      const r = dae.getExprRight(id);
      const op = dae.getExprData1(id);
      if (op === BinOp.Or) {
        if (
          (isStaticOrEnumExpr(l) && evalDaeExpr(l, dae) === true) ||
          (isStaticOrEnumExpr(r) && evalDaeExpr(r, dae) === true)
        ) {
          return true;
        }
      }
      return isStaticOrEnumExpr(l) && isStaticOrEnumExpr(r);
    }
    return false;
  };
  return isStaticOrEnumExpr(firstArg) && evalDaeExpr(firstArg, dae) === true;
}

/**
 * Validates and lowers a standalone function-call equation (e.g. `assert(...)`, `terminate(...)`,
 * `reinit(v, expr)`, or `Connections.branch`/`root`/`potentialRoot`/`isRoot` graph operators)
 * into the `DAEBuilder` equation arena or enclosing `when`/`elsewhen` clause.
 *
 * Enforces MLS §12.7 semantic constraints on `reinit`:
 * - Must appear inside a `when` equation (`REINIT_OUTSIDE_WHEN`).
 * - First argument must be a continuous `Real` state variable, not a loop iterator, literal,
 *   parameter, constant, or discrete variable.
 * - Vector `reinit(arr, valArr)` calls are scalarized element-by-element.
 *
 * Overconstrained connection graph operators (`Connections.branch`, `root`, `potentialRoot`, `isRoot`)
 * are recorded directly onto `dae.extensionMetadata.overconstrainedGraph` rather than emitted as equations.
 *
 * @param flattener - Active `ModelicaFlattener` instance.
 * @param node - CST node of the `function_call` equation.
 * @param dae - Target `DAEBuilder` arena.
 * @param prefix - Current hierarchical component instance prefix.
 * @param substitutions - Active `for`-loop iterator bindings.
 * @param isInitial - Whether the equation resides in an `initial equation` section.
 * @param whenIdx - Enclosing `when` equation index in `dae`, or `-1` if outside `when`.
 * @param elseWhenClause - Enclosing `elsewhen` branch accumulator, if any.
 */
export function emitFunctionCallEquation(
  flattener: ModelicaFlattener,
  node: SyntaxNode | null | undefined,
  dae: DAEBuilder,
  prefix: string,
  substitutions?: Map<string, number | string>,
  isInitial = false,
  whenIdx = -1,
  elseWhenClause?: {
    bodyEquations: { kind: EqKind; lhsExprId: number; rhsExprId: number }[];
    equations: { kind: EqKind; lhs: number; rhs: number }[];
  } | null,
): void {
  if (!node) return;
  const reinitCall = getFunctionCallInfoCst(node);
  const isReinit =
    reinitCall?.callee === "reinit" ||
    node.child?.(0)?.text?.trim() === "reinit" ||
    node.children?.[0]?.text?.trim() === "reinit";
  if (isReinit) {
    let startB = node.startIndex ?? node.startOffset;
    let endB = node.endIndex ?? node.endOffset;
    if (endB != null && (node.text ?? "").endsWith(";")) {
      endB -= 1;
    }
    const range =
      startB != null && endB != null
        ? {
            startOffset: startB,
            endOffset: endB,
            startPosition: node.startPosition,
            endPosition: node.endPosition,
          }
        : undefined;

    if (whenIdx === -1) {
      dae.diagnostics.push({
        severity: "error",
        code: ModelicaErrorCode.REINIT_OUTSIDE_WHEN.code,
        message: ModelicaErrorCode.REINIT_OUTSIDE_WHEN.message(),
        range,
      });
      return;
    }

    const rawTarget = reinitCall?.args?.[0]?.text?.trim() ?? "";
    if (rawTarget) {
      if (flattener.activeLoopVars.has(rawTarget) || (substitutions && substitutions.has(rawTarget))) {
        dae.diagnostics.push({
          severity: "error",
          code: ModelicaErrorCode.ASSIGNMENT_TO_ITERATOR.code,
          message: ModelicaErrorCode.ASSIGNMENT_TO_ITERATOR.message(rawTarget),
          range,
        });
        return;
      }

      if (isSignedAsciiNumberText(rawTarget) || rawTarget === "true" || rawTarget === "false") {
        dae.diagnostics.push({
          severity: "error",
          code: ModelicaErrorCode.REINIT_ARG1_NOT_VARIABLE.code,
          message: ModelicaErrorCode.REINIT_ARG1_NOT_VARIABLE.message(),
          range,
        });
        return;
      }

      const targetName = prefix ? `${prefix}.${rawTarget}` : rawTarget;
      let vIdx = dae.getVarIdxByName(targetName);
      if (vIdx < 0) {
        vIdx = dae.getVarIdxByName(rawTarget);
      }
      if (vIdx >= 0) {
        const vType = dae.getVarType(vIdx);
        const vVariability = dae.getVarVariability(vIdx);

        if (vType !== VarType.Real) {
          const typeName = vType === VarType.Boolean ? "Boolean" : vType === VarType.Integer ? "Integer" : "String";
          dae.diagnostics.push({
            severity: "error",
            code: ModelicaErrorCode.REINIT_TYPE_MISMATCH.code,
            message: ModelicaErrorCode.REINIT_TYPE_MISMATCH.message(rawTarget, typeName),
            range,
          });
          return;
        }
        if (vVariability === Variability.Parameter) {
          dae.diagnostics.push({
            severity: "error",
            code: ModelicaErrorCode.REINIT_NOT_CONTINUOUS.code,
            message: ModelicaErrorCode.REINIT_NOT_CONTINUOUS.message(rawTarget, "parameter"),
            range,
          });
          return;
        }
        if (vVariability === Variability.Constant) {
          dae.diagnostics.push({
            severity: "error",
            code: ModelicaErrorCode.REINIT_NOT_CONTINUOUS.code,
            message: ModelicaErrorCode.REINIT_NOT_CONTINUOUS.message(rawTarget, "constant"),
            range,
          });
          return;
        }
        if (vVariability === Variability.Discrete) {
          dae.diagnostics.push({
            severity: "error",
            code: ModelicaErrorCode.REINIT_NOT_CONTINUOUS.code,
            message: ModelicaErrorCode.REINIT_NOT_CONTINUOUS.message(rawTarget, "discrete"),
            range,
          });
          return;
        }

        const fullText = (node.text ?? "").trim();
        let arg2Text = "";
        const reinitIdx = fullText.indexOf("reinit");
        if (reinitIdx >= 0) {
          const openParen = fullText.indexOf("(", reinitIdx);
          const commaIdx = fullText.indexOf(",", openParen);
          const closeParen = fullText.lastIndexOf(")");
          if (commaIdx > openParen && closeParen > commaIdx) {
            arg2Text = fullText.slice(commaIdx + 1, closeParen).trim();
          }
        }
        if (arg2Text) {
          if (arg2Text.startsWith("{") && arg2Text.endsWith("}")) {
            const elements = arg2Text
              .slice(1, -1)
              .split(",")
              .map((s) => s.trim());
            const actualType = `Real[${elements.length}]`;
            const expectedType = "Real";
            dae.diagnostics.push({
              severity: "error",
              code: ModelicaErrorCode.REINIT_ARG2_TYPE_MISMATCH.code,
              message: ModelicaErrorCode.REINIT_ARG2_TYPE_MISMATCH.message(arg2Text, actualType, expectedType),
              range,
            });
            return;
          }
        }
      }
    }
  }

  let callId = flattener.lowerExpr(node, dae, prefix, substitutions);
  if (!isInitial && isStaticTrueAssert(callId, dae)) {
    return;
  }

  const ensureOverconstrainedGraph = () => {
    if (!dae.extensionMetadata) dae.extensionMetadata = {};
    if (!dae.extensionMetadata["overconstrainedGraph"]) {
      dae.extensionMetadata["overconstrainedGraph"] = {
        roots: new Set<string>(),
        potentialRoots: new Map<string, number>(),
        branches: [] as { a: string; b: string }[],
        queriedRoots: new Set<string>(),
      };
    }
    return dae.extensionMetadata["overconstrainedGraph"] as {
      roots: Set<string>;
      potentialRoots: Map<string, number>;
      branches: { a: string; b: string }[];
      queriedRoots: Set<string>;
    };
  };

  const resolveOverconstrainedArgName = (argId: number): string | null => {
    if (argId < 0) return null;
    if (dae.getExprKind(argId) === ExprKind.Name) {
      return dae.interner.resolve(dae.getExprData1(argId)) || null;
    }
    if (dae.getExprKind(argId) === ExprKind.ArrayCtor && dae.getExprData1(argId) > 0) {
      const firstEl = dae.getExprLeft(argId);
      if (dae.getExprKind(firstEl) === ExprKind.Name) {
        const elName = dae.interner.resolve(dae.getExprData1(firstEl));
        if (!elName) return null;
        let s = elName;
        while (s.endsWith("]")) {
          const idx = s.lastIndexOf("[");
          if (idx === -1) break;
          s = s.slice(0, idx);
        }
        return s;
      }
    }
    return null;
  };

  if (dae.getExprKind(callId) === ExprKind.BoolLiteral) {
    const callInfo = getFunctionCallInfoCst(node);
    if (
      callInfo &&
      (callInfo.callee === "Connections.isRoot" ||
        callInfo.callee === "Connections.rooted" ||
        callInfo.callee === "isRoot" ||
        callInfo.callee === "rooted")
    ) {
      return;
    }
  }

  if (dae.getExprKind(callId) === ExprKind.Call) {
    const callName = dae.interner.resolve(dae.getExprData1(callId));
    const argCount = dae.getExprRight(callId);
    if ((callName === "Connections.branch" || callName === "branch") && argCount >= 2) {
      const aName = resolveOverconstrainedArgName(dae.getExprLeft(callId));
      const bName = resolveOverconstrainedArgName(dae.getExprLeft(callId + 1));
      if (aName && bName) {
        ensureOverconstrainedGraph().branches.push({ a: aName, b: bName });
      }
      return;
    }
    if (
      (callName === "Connections.root" || callName === "Connections.uniqueRoot" || callName === "uniqueRoot") &&
      argCount >= 1
    ) {
      const aName = resolveOverconstrainedArgName(dae.getExprLeft(callId));
      if (aName) {
        ensureOverconstrainedGraph().roots.add(aName);
      }
      return;
    }
    if ((callName === "Connections.potentialRoot" || callName === "potentialRoot") && argCount >= 1) {
      const aName = resolveOverconstrainedArgName(dae.getExprLeft(callId));
      let priority = 0;
      if (argCount >= 2) {
        const prioExprId = dae.getExprLeft(callId + 1);
        const pVal = evalDaeExpr(prioExprId, dae);
        if (typeof pVal === "number") priority = pVal;
        const prioVars = new Set<string>();
        dae.collectExprVarNames(prioExprId, prioVars);
        for (const vName of prioVars) {
          const vIdx = dae.getVarIdxByName(vName);
          if (vIdx !== -1 && dae.getVarVariability(vIdx) === Variability.Parameter) {
            dae.setVarFinal(vIdx, true);
          }
        }
      }
      if (aName) {
        const graph = ensureOverconstrainedGraph();
        const prev = graph.potentialRoots.get(aName);
        if (prev === undefined || priority < prev) {
          graph.potentialRoots.set(aName, priority);
        }
      }
      return;
    }
    if ((callName === "Connections.isRoot" || callName === "isRoot") && argCount >= 1) {
      const aName = resolveOverconstrainedArgName(dae.getExprLeft(callId));
      if (aName) {
        ensureOverconstrainedGraph().queriedRoots.add(aName);
      }
      return;
    }
    if (callName === "reinit" && dae.getExprRight(callId) >= 2) {
      const arg0 = dae.getExprLeft(callId);
      if (dae.getExprKind(arg0) === ExprKind.Name) {
        const varName = dae.interner.resolve(dae.getExprData1(arg0));
        if (flattener.activeLoopVars.has(varName)) {
          dae.diagnostics.push({
            severity: "error",
            code: ModelicaErrorCode.ASSIGNMENT_TO_ITERATOR.code,
            message: ModelicaErrorCode.ASSIGNMENT_TO_ITERATOR.message(varName),
            range: {
              startOffset: node.startIndex ?? node.startOffset,
              endOffset: node.endIndex ?? node.endOffset,
              startPosition: node.startPosition,
              endPosition: node.endPosition,
            },
          });
          return;
        }
      }
      const arg1 = dae.getExprLeft(callId + 1);
      if (dae.getExprKind(arg0) === ExprKind.ArrayCtor && dae.getExprKind(arg1) === ExprKind.ArrayCtor) {
        const len0 = dae.getExprData1(arg0);
        const len1 = dae.getExprData1(arg1);
        if (len0 === len1) {
          if (!dae.extensionMetadata?.["isOldFrontend"] && len0 > 0) {
            const firstEl0 = dae.getExprLeft(arg0);
            const firstEl0Name =
              dae.getExprKind(firstEl0) === ExprKind.Name
                ? (dae.interner.resolve(dae.getExprData1(firstEl0)) ?? "")
                : "";
            const bIdx = firstEl0Name.lastIndexOf("[");
            const baseArrName = bIdx >= 0 && firstEl0Name.endsWith("]") ? firstEl0Name.slice(0, bIdx) : firstEl0Name;
            if (baseArrName) {
              const realElems: number[] = [];
              for (let i = 0; i < len1; i++) {
                const el1 = i === 0 ? dae.getExprLeft(arg1) : dae.getExprLeft(arg1 + i);
                realElems.push(isRealExpr(el1, dae) ? el1 : castToRealExpr(el1, dae));
              }
              callId = dae.addCallExpr("reinit", [dae.addNameExpr(baseArrName), dae.addArrayCtorExpr(realElems)]);
            }
          } else {
            for (let i = 0; i < len0; i++) {
              const el0 = i === 0 ? dae.getExprLeft(arg0) : dae.getExprLeft(arg0 + i);
              const el1 = i === 0 ? dae.getExprLeft(arg1) : dae.getExprLeft(arg1 + i);
              const scalarCall = dae.addCallExpr("reinit", [el0, el1]);
              if (elseWhenClause) {
                elseWhenClause.equations.push({ kind: EqKind.FunctionCall, lhs: scalarCall, rhs: -1 });
                elseWhenClause.bodyEquations.push({ kind: EqKind.FunctionCall, lhsExprId: scalarCall, rhsExprId: -1 });
              } else if (whenIdx >= 0) {
                dae.addWhenBodyEquation(whenIdx, EqKind.FunctionCall, scalarCall, -1);
              } else {
                const eqKind = isInitial ? EqKind.InitialFunctionCall : EqKind.FunctionCall;
                dae.addEquation(eqKind, scalarCall, -1);
              }
            }
            return;
          }
        }
      }
    }
  }

  if (elseWhenClause) {
    elseWhenClause.equations.push({ kind: EqKind.FunctionCall, lhs: callId, rhs: -1 });
    elseWhenClause.bodyEquations.push({ kind: EqKind.FunctionCall, lhsExprId: callId, rhsExprId: -1 });
  } else if (whenIdx >= 0) {
    dae.addWhenBodyEquation(whenIdx, EqKind.FunctionCall, callId, -1);
  } else {
    const eqKind = isInitial ? EqKind.InitialFunctionCall : EqKind.FunctionCall;
    const eqIdx = dae.addEquation(eqKind, callId, -1);
    const startB = node.startIndex ?? node.startOffset;
    const endB = node.endIndex ?? node.endOffset;
    if (startB != null && endB != null && eqIdx >= 0) {
      dae.setEqSourceRange(eqIdx, startB, endB);
    }
  }
}
