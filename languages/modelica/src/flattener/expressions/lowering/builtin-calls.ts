// SPDX-License-Identifier: AGPL-3.0-or-later

import { ExprKind } from "@modelscript/dsl";
import {
  BinOp,
  Causality,
  DAEBuilder,
  inferArenaExprVarType,
  UnaryOp,
  Variability,
  VarType,
  varTypeName,
  type SymbolEntry,
} from "@modelscript/runtime";
import { type SyntaxNode } from "../../../../src-gen/bindings.js";
import { ModelicaErrorCode } from "../../../errors.js";
import { resolveQualified } from "../../../queries.js";
import { getElementDiagRange } from "../../support/range-utils.js";
import { getFlatteningState, getNamedArrayShape, setExprArrayShape } from "../../support/state.js";
import type { LoweringContext } from "../../types.js";
import {
  findOperatorRecordComponentType,
  getArrayCtorElements,
  getArrayCtorRank,
  getArrayCtorShape,
  resolveOperatorRecord,
} from "../binary-ops.js";
import {
  collapseAsciiWhitespace,
  expandDottedArrayMemberRef,
  expandVarToArrayCtor,
  extractFunctionCallArgExprNodesCst,
  isAsciiDigitsOnly,
  isDottedIdentifierChain,
  resolveScopedName,
} from "../cst-utils.js";
import { castToRealExpr, evalDaeExpr, getExprDims, isRealExpr } from "../eval.js";
import { vectorizeFunctionCall } from "../functions.js";

import { asStateExt, collectCstIdentifiers, cstHasTokenText, getDaeExtMeta } from "./helpers.js";
import type {
  BuiltinCallParams,
  LowerExprFn,
  NameResolver,
  OperatorFnData,
  OverconstrainedGraphExt,
  SymbolMetaLike,
} from "./types.js";

export function lowerSpecialBuiltinCSTExpression(
  node: SyntaxNode,
  firstChildToken: string,
  dae: DAEBuilder,
  ctx: LoweringContext,
  lowerExpr: LowerExprFn,
): number | null {
  const { prefix = "", substitutions, imports, db, flattener } = ctx;
  const type = node.type;
  // ============================================================================
  // Symbolic Differentiation: der(...)
  // Validates differentiability (must be Real and continuous/parameter/constant)
  // and recursively distributes der() across arrays, negations, conditionals,
  // and arithmetic expressions (sum, product, quotient, and power rules).
  // ============================================================================
  // Der expression: der ( ... )
  if (
    type === "der" ||
    ((type === "primary" || type === "lhs_primary") && (firstChildToken === "der" || node.child(0)?.type === "der"))
  ) {
    let argNode = node.child(2);
    if (!argNode || argNode.type === ")") argNode = node.child(1);
    if (argNode?.type === "function_call_args") {
      argNode = argNode.child(1);
    }
    while (
      argNode &&
      (argNode.type === "expression_list" ||
        argNode.type === "function_arguments" ||
        argNode.type === "function_argument" ||
        argNode.type === "expression" ||
        argNode.type === "lhs_expression" ||
        argNode.type === "primary" ||
        argNode.type === "lhs_primary") &&
      argNode.childCount === 1
    ) {
      argNode = argNode.child(0);
    }
    const rawName = argNode?.text?.trim() ?? "";
    let argVIdx = -1;
    if (isDottedIdentifierChain(rawName)) {
      argVIdx = dae.getVarIdxByName(prefix ? `${prefix}.${rawName}` : rawName);
    }
    if (argVIdx >= 0) {
      const varType = dae.getVarType(argVIdx);
      if (varType !== VarType.Real) {
        let cur: SyntaxNode | null | undefined = node;
        while (
          cur &&
          cur.type !== "component_clause" &&
          cur.type !== "simple_equation" &&
          cur.type !== "statement" &&
          cur.type !== "assignment_statement"
        ) {
          cur = cur.parent;
        }
        const diagRange = getElementDiagRange(cur ?? node);
        if (dae.extensionMetadata?.["isOldFrontend"]) {
          dae.diagnostics.push({
            severity: "error",
            code: ModelicaErrorCode.FUNCTION_ARG_TYPE_MISMATCH.code,
            message: `Argument '${rawName}' to der has illegal type ${varTypeName(varType)}, must be a subtype of Real.`,
            range: diagRange,
          });
        } else {
          dae.diagnostics.push({
            severity: "error",
            code: ModelicaErrorCode.ARGUMENT_NOT_DIFFERENTIABLE.code,
            message: ModelicaErrorCode.ARGUMENT_NOT_DIFFERENTIABLE.message(rawName),
            range: diagRange,
          });
        }
        return -1;
      }
    }
    const argId = lowerExpr(argNode, dae, prefix, substitutions, imports, db, flattener);
    const isZeroRealExpr = (id: number): boolean =>
      dae.getExprKind(id) === ExprKind.RealLiteral && dae.getExprRealValue(id) === 0;
    // Recursively push der() inward through array constructors and algebraic operators
    const distributeDer = (exprId: number): number => {
      const k = dae.getExprKind(exprId);
      if (k === ExprKind.ArrayCtor) {
        const elems = getArrayCtorElements(exprId, dae);
        return dae.addArrayCtorExpr(elems.map((e) => distributeDer(e)));
      }
      if (k === ExprKind.Negate) {
        const innerDer = distributeDer(dae.getExprLeft(exprId));
        if (isZeroRealExpr(innerDer)) return innerDer;
        return dae.addNegateExpr(innerDer);
      }
      if (k === ExprKind.Unary && dae.getExprData1(exprId) === UnaryOp.Negate) {
        const innerDer = distributeDer(dae.getExprLeft(exprId));
        if (isZeroRealExpr(innerDer)) return innerDer;
        return dae.addUnaryExpr(UnaryOp.Negate, innerDer);
      }
      if (k === ExprKind.IfElse && !flattener?.options?.omcCompatibility) {
        return dae.addIfElseExpr(
          dae.getExprData1(exprId),
          distributeDer(dae.getExprLeft(exprId)),
          distributeDer(dae.getExprRight(exprId)),
        );
      }
      if (k === ExprKind.Binary) {
        const op = dae.getExprData1(exprId);
        const leftId = dae.getExprLeft(exprId);
        const rightId = dae.getExprRight(exprId);
        // Linearity: d(u +/- v)/dt = du/dt +/- dv/dt
        if (op === BinOp.Add || op === BinOp.Sub) {
          const dLeft = distributeDer(leftId);
          const dRight = distributeDer(rightId);
          if (!flattener?.options?.omcCompatibility) {
            if (isZeroRealExpr(dLeft) && isZeroRealExpr(dRight)) return dLeft;
            if (isZeroRealExpr(dRight)) return dLeft;
            if (isZeroRealExpr(dLeft)) {
              return op === BinOp.Add ? dRight : dae.addNegateExpr(dRight);
            }
          }
          return dae.addBinaryExpr(op, dLeft, dRight);
        }
        if (!flattener?.options?.omcCompatibility) {
          // Product rule: d(u * v)/dt = (du/dt)*v + u*(dv/dt)
          if (op === BinOp.Mul) {
            const dLeft = distributeDer(leftId);
            const dRight = distributeDer(rightId);
            const leftZero = isZeroRealExpr(dLeft);
            const rightZero = isZeroRealExpr(dRight);
            if (leftZero && rightZero) return dLeft;
            if (leftZero) return dae.addBinaryExpr(BinOp.Mul, leftId, dRight);
            if (rightZero) return dae.addBinaryExpr(BinOp.Mul, dLeft, rightId);
            return dae.addBinaryExpr(
              BinOp.Add,
              dae.addBinaryExpr(BinOp.Mul, dLeft, rightId),
              dae.addBinaryExpr(BinOp.Mul, leftId, dRight),
            );
          }
          // Quotient rule: d(u / v)/dt = ((du/dt)*v - u*(dv/dt)) / v^2
          if (op === BinOp.Div) {
            const dLeft = distributeDer(leftId);
            const dRight = distributeDer(rightId);
            const leftZero = isZeroRealExpr(dLeft);
            const rightZero = isZeroRealExpr(dRight);
            if (leftZero && rightZero) return dLeft;
            if (rightZero) return dae.addBinaryExpr(BinOp.Div, dLeft, rightId);
            const num = leftZero
              ? dae.addNegateExpr(dae.addBinaryExpr(BinOp.Mul, leftId, dRight))
              : dae.addBinaryExpr(
                  BinOp.Sub,
                  dae.addBinaryExpr(BinOp.Mul, dLeft, rightId),
                  dae.addBinaryExpr(BinOp.Mul, leftId, dRight),
                );
            const den = dae.addBinaryExpr(BinOp.Pow, rightId, dae.addRealLiteral(2.0));
            return dae.addBinaryExpr(BinOp.Div, num, den);
          }
          // Power rule for constant exponents: d(u^n)/dt = n * u^(n-1) * (du/dt)
          if (op === BinOp.Pow) {
            const expVal = evalDaeExpr(rightId, dae);
            if (typeof expVal === "number") {
              if (expVal === 0) return dae.addRealLiteral(0.0);
              const dLeft = distributeDer(leftId);
              if (isZeroRealExpr(dLeft)) return dLeft;
              if (expVal === 1) return dLeft;
              const coeff = dae.addRealLiteral(expVal);
              const basePow =
                expVal === 2 ? leftId : dae.addBinaryExpr(BinOp.Pow, leftId, dae.addRealLiteral(expVal - 1));
              return dae.addBinaryExpr(BinOp.Mul, dae.addBinaryExpr(BinOp.Mul, coeff, basePow), dLeft);
            }
          }
        }
      }
      if (k === ExprKind.RealLiteral || k === ExprKind.IntLiteral) {
        return dae.addRealLiteral(0.0);
      }
      // Time-invariant constants and parameters differentiate to 0.0; discrete variables are rejected
      if (k === ExprKind.Name) {
        const vName = dae.interner.resolve(dae.getExprData1(exprId));
        if (vName && dae.hasArrayElements(vName)) {
          const ctor = expandVarToArrayCtor(vName, dae);
          if (ctor !== null) return distributeDer(ctor);
        }
        let vIdx = dae.getVarIdxByName(vName);
        if (vIdx < 0 && prefix) {
          vIdx = dae.getVarIdxByName(prefix + "." + vName);
        }
        if (vIdx >= 0) {
          const varType = dae.getVarType(vIdx);
          const varVar = dae.getVarVariability(vIdx);
          if (varType !== VarType.Real) {
            const shortName = vName.includes(".") ? vName.split(".").pop()! : vName;
            let cur: SyntaxNode | null | undefined = node;
            while (
              cur &&
              cur.type !== "component_clause" &&
              cur.type !== "simple_equation" &&
              cur.type !== "statement" &&
              cur.type !== "assignment_statement"
            ) {
              cur = cur.parent;
            }
            const diagRange = getElementDiagRange(cur ?? node);
            if (dae.extensionMetadata?.["isOldFrontend"]) {
              dae.diagnostics.push({
                severity: "error",
                code: ModelicaErrorCode.FUNCTION_ARG_TYPE_MISMATCH.code,
                message: `Argument '${shortName}' to der has illegal type ${varTypeName(varType)}, must be a subtype of Real.`,
                range: diagRange,
              });
            } else {
              dae.diagnostics.push({
                severity: "error",
                code: ModelicaErrorCode.ARGUMENT_NOT_DIFFERENTIABLE.code,
                message: ModelicaErrorCode.ARGUMENT_NOT_DIFFERENTIABLE.message(shortName),
                range: diagRange,
              });
            }
            return -1;
          }
          if (varVar === Variability.Constant || varVar === Variability.Parameter) {
            return dae.addRealLiteral(0.0);
          }
          if (varVar === Variability.Discrete) {
            const shortName = vName.includes(".") ? vName.split(".").pop()! : vName;
            dae.diagnostics.push({
              severity: "error",
              code: ModelicaErrorCode.ARGUMENT_NOT_DIFFERENTIABLE.code,
              message: ModelicaErrorCode.ARGUMENT_NOT_DIFFERENTIABLE.message(shortName),
              range: {
                startPosition: node.startPosition,
                endPosition: node.endPosition,
              },
            });
            return exprId;
          }
        }
      }
      if (k === ExprKind.Subscript) {
        const baseId = dae.getExprData1(exprId);
        if (dae.getExprKind(baseId) === ExprKind.Name) {
          const vName = dae.interner.resolve(dae.getExprData1(baseId));
          let vIdx = dae.getVarIdxByName(vName);
          if (vIdx < 0 && prefix) {
            vIdx = dae.getVarIdxByName(prefix + "." + vName);
          }
          if (vIdx >= 0) {
            const varType = dae.getVarType(vIdx);
            const varVar = dae.getVarVariability(vIdx);
            if (varType !== VarType.Real) {
              const shortName = vName.includes(".") ? vName.split(".").pop()! : vName;
              let cur: SyntaxNode | null | undefined = node;
              while (
                cur &&
                cur.type !== "component_clause" &&
                cur.type !== "simple_equation" &&
                cur.type !== "statement" &&
                cur.type !== "assignment_statement"
              ) {
                cur = cur.parent;
              }
              const diagRange = getElementDiagRange(cur ?? node);
              dae.diagnostics.push({
                severity: "error",
                code: ModelicaErrorCode.FUNCTION_ARG_TYPE_MISMATCH.code,
                message: `Argument '${shortName}' to der has illegal type ${varTypeName(varType)}, must be a subtype of Real.`,
                range: diagRange,
              });
              return -1;
            }
            if (varVar === Variability.Constant || varVar === Variability.Parameter) {
              return dae.addRealLiteral(0.0);
            }
            if (varVar === Variability.Discrete) {
              const shortName = vName.includes(".") ? vName.split(".").pop()! : vName;
              dae.diagnostics.push({
                severity: "error",
                code: ModelicaErrorCode.ARGUMENT_NOT_DIFFERENTIABLE.code,
                message: ModelicaErrorCode.ARGUMENT_NOT_DIFFERENTIABLE.message(shortName),
                range: {
                  startPosition: node.startPosition,
                  endPosition: node.endPosition,
                },
              });
              return exprId;
            }
          }
        }
      }
      const constVal = evalDaeExpr(exprId, dae);
      if (typeof constVal === "number") {
        return dae.addRealLiteral(0.0);
      }
      return dae.addDerExpr(exprId);
    };
    return distributeDer(argId);
  }

  // ============================================================================
  // Discrete Pre-Value Operator: pre(...)
  // Distributes pre() element-wise across arrays and verifies that any continuous
  // Real variable referenced inside a when-clause is actually assigned in a when-clause
  // (inferring discrete variability per Modelica specification).
  // ============================================================================
  // Pre expression: pre ( ... )
  if (
    type === "pre" ||
    ((type === "primary" || type === "lhs_primary" || type === "function_call") &&
      (firstChildToken === "pre" || node.child(0)?.text?.startsWith("pre(")))
  ) {
    let argNode = node.child(2) ?? node.child(1);
    if (!argNode || argNode.type === ")") argNode = node.child(1);
    if (argNode?.type === "function_call_args") {
      argNode = argNode.child(1);
    }
    while (
      argNode &&
      (argNode.type === "expression_list" ||
        argNode.type === "function_arguments" ||
        argNode.type === "function_argument" ||
        argNode.type === "expression" ||
        argNode.type === "lhs_expression" ||
        argNode.type === "primary" ||
        argNode.type === "lhs_primary") &&
      argNode.childCount === 1
    ) {
      argNode = argNode.child(0);
    }
    const argId = lowerExpr(argNode, dae, prefix, substitutions, imports, db, flattener);
    const distributePre = (exprId: number): number => {
      const k = dae.getExprKind(exprId);
      if (k === ExprKind.ArrayCtor) {
        const elems = getArrayCtorElements(exprId, dae);
        return dae.addArrayCtorExpr(elems.map((e) => distributePre(e)));
      }
      if (k === ExprKind.Name) {
        const vName = dae.interner.resolve(dae.getExprData1(exprId));
        if (vName && dae.hasArrayElements(vName)) {
          const ctor = expandVarToArrayCtor(vName, dae);
          if (ctor !== null) return distributePre(ctor);
        }
        if (vName) {
          let vIdx = dae.getVarIdxByName(vName);
          if (vIdx < 0 && prefix) vIdx = dae.getVarIdxByName(`${prefix}.${vName}`);
          if (vIdx >= 0) {
            const vari = dae.getVarVariability(vIdx);
            const vt = dae.getVarType(vIdx);
            if (
              !flattener?.isOldFrontend &&
              !dae.extensionMetadata?.["isOldFrontend"] &&
              vari === Variability.Continuous &&
              vt !== VarType.Integer &&
              vt !== VarType.Boolean &&
              vt !== VarType.String &&
              vt !== VarType.Clock
            ) {
              let isWhenCondition = false;
              let seenBodyEqOrStmt = false;
              let cur: SyntaxNode | null | undefined = node;
              while (cur) {
                if (
                  cur.type === "simple_equation" ||
                  cur.type === "some_equation" ||
                  cur.type === "assignment_statement" ||
                  cur.type === "statement" ||
                  cur.type === "statement_or_procedure" ||
                  cur.type === "if_equation" ||
                  cur.type === "if_statement" ||
                  cur.type === "for_equation" ||
                  cur.type === "for_statement"
                ) {
                  seenBodyEqOrStmt = true;
                }
                if (cur.type === "when_equation" || cur.type === "when_statement") {
                  isWhenCondition = !seenBodyEqOrStmt;
                  break;
                }
                cur = cur.parent;
              }
              if (isWhenCondition) {
                let isAssignedInWhen = false;
                let root: SyntaxNode | null | undefined = node;
                while (root && root.parent) {
                  root = root.parent;
                }
                if (root) {
                  const leafName = vName.includes(".") ? vName.split(".").pop()! : vName;
                  const stack = [root];
                  while (stack.length > 0) {
                    const n = stack.pop();
                    if (!n) continue;
                    if (n.type === "when_statement" || n.type === "when_equation") {
                      const innerStack = [...(n.children || [])];
                      while (innerStack.length > 0) {
                        const inNode = innerStack.pop();
                        if (!inNode) continue;
                        if (inNode.type === "function_call") {
                          const calleeName = inNode.childForFieldName?.("name")?.text?.trim();
                          if (calleeName === "reinit") {
                            const argNodes = extractFunctionCallArgExprNodesCst(inNode);
                            if (argNodes[0] && collectCstIdentifiers(argNodes[0]).includes(leafName)) {
                              isAssignedInWhen = true;
                              break;
                            }
                          }
                        } else if (inNode.type === "simple_equation") {
                          const lhs = inNode.childForFieldName?.("lhs") ?? inNode.child?.(0);
                          if (lhs && collectCstIdentifiers(lhs).includes(leafName)) {
                            isAssignedInWhen = true;
                            break;
                          }
                        } else if (inNode.type === "assignment_statement") {
                          const target = inNode.childForFieldName?.("target") ?? inNode.child?.(0);
                          if (target && collectCstIdentifiers(target).includes(leafName)) {
                            isAssignedInWhen = true;
                            break;
                          }
                        } else if (
                          inNode.type === "statement" &&
                          inNode.childCount >= 4 &&
                          inNode.child?.(0)?.text === "("
                        ) {
                          const outList = inNode.children?.find((ch) => ch.type === "output_expression_list");
                          if (outList && collectCstIdentifiers(outList).includes(leafName)) {
                            isAssignedInWhen = true;
                            break;
                          }
                        }
                        for (const c of inNode.children || []) {
                          innerStack.push(c);
                        }
                      }
                      if (isAssignedInWhen) break;
                    }
                    for (const child of n.children || []) {
                      stack.push(child);
                    }
                  }
                }
                if (!isAssignedInWhen) {
                  const diagRange = getElementDiagRange(cur ?? node);
                  dae.diagnostics.push({
                    severity: "error",
                    code: ModelicaErrorCode.FUNCTION_ARG_TYPE_MISMATCH.code,
                    message: `Argument 1 of pre must be a discrete expression, but ${vName} is continuous.`,
                    range: diagRange,
                  });
                  return -1;
                }
              }
            }
          }
        }
      }
      return dae.addPreExpr(exprId);
    };
    return distributePre(argId);
  }

  // Builtin initial() and terminal()
  if (
    (type === "primary" || type === "lhs_primary") &&
    node.childCount >= 2 &&
    (node.child(0)?.text?.trim() === "initial" || node.child(0)?.text?.trim() === "terminal") &&
    ((node.childCount === 3 && node.child(1)?.text === "(" && node.child(2)?.text === ")") ||
      (node.childCount === 2 && node.child(1)?.type === "function_call_args" && node.child(1)?.childCount === 2))
  ) {
    const fnName = node.child(0)?.text?.trim() ?? "initial";
    return dae.addCallExpr(fnName, []);
  }

  return null;
}

export function lowerBuiltinFunctionCall(params: BuiltinCallParams): number | null {
  const { node, fnName, cleanFnName, argsNode, argExprIds, argNodes, namedArgs, dae, ctx, state } = params;
  const { prefix = "", db, flattener } = ctx;
  if (cleanFnName === "identity") {
    let cur: SyntaxNode | null | undefined = node;
    while (
      cur &&
      cur.type !== "component_clause" &&
      cur.type !== "simple_equation" &&
      cur.type !== "statement" &&
      cur.type !== "assignment_statement"
    ) {
      cur = cur.parent;
    }
    const diagRange = getElementDiagRange(cur ?? node);

    if (argExprIds.length !== 1) {
      dae.diagnostics.push({
        severity: "error",
        code: ModelicaErrorCode.IDENTITY_ARG_COUNT.code,
        message: "Wrong number of arguments to identity.",
        range: diagRange,
      });
      return -1;
    }
    const aid = argExprIds[0]!;
    const k = dae.getExprKind(aid);
    const vt = inferArenaExprVarType(dae, aid);
    const ev = evalDaeExpr(aid, dae);
    if (k === ExprKind.RealLiteral || vt === VarType.Real || (typeof ev === "number" && !Number.isInteger(ev))) {
      dae.diagnostics.push({
        severity: "error",
        code: ModelicaErrorCode.IDENTITY_ARG_COUNT.code,
        message: "First argument to identity in component <NO COMPONENT> must be Integer expression.",
        range: diagRange,
      });
      return -1;
    }
  }

  if (cleanFnName === "sum") {
    if (argExprIds.length === 1) {
      const aid = argExprIds[0]!;
      const k = dae.getExprKind(aid);
      let isArray = false;
      if (k === ExprKind.ArrayCtor) {
        isArray = true;
      } else if (k === ExprKind.Name) {
        const vName = dae.interner.resolve(dae.getExprData1(aid));
        if (vName) {
          if (dae.hasArrayElements(vName)) {
            isArray = true;
          } else {
            const vIdx = dae.lookupVariable(vName);
            if (vIdx >= 0) {
              const shape = dae.getVarShape(vIdx);
              if (shape && shape.length > 0) isArray = true;
              const shapeExprs = dae.getVarShapeExprs ? dae.getVarShapeExprs(vIdx) : null;
              if (shapeExprs && shapeExprs.length > 0) isArray = true;
            }
            if (!isArray) {
              const dims = getExprDims(aid, dae, db);
              if (dims && dims.length > 0) isArray = true;
            }
            if (
              !isArray &&
              expandDottedArrayMemberRef(
                vName,
                prefix ?? "",
                dae,
                db ?? flattener?.db,
                flattener?.currentClassId,
                flattener?.currentRootClassId,
              ).isArray
            ) {
              isArray = true;
            }
            if (!isArray && db) {
              const simpleName = vName.includes(".") ? vName.split(".").pop()! : vName;
              const candidates = db.byName(simpleName);
              for (const cand of candidates) {
                if (cand.kind === "Component") {
                  const rawDims = db.query<unknown[] | null>("arrayDimensions", cand.id);
                  if (rawDims && rawDims.length > 0) {
                    isArray = true;
                    break;
                  }
                }
              }
            }
          }
        }
      } else {
        const dims = getExprDims(aid, dae, db);
        if (dims && dims.length > 0) isArray = true;
      }

      if (!isArray) {
        let cur: SyntaxNode | null | undefined = node;
        while (
          cur &&
          cur.type !== "component_clause" &&
          cur.type !== "simple_equation" &&
          cur.type !== "statement" &&
          cur.type !== "assignment_statement"
        ) {
          cur = cur.parent;
        }
        const diagRange = getElementDiagRange(cur ?? node);
        const isOldFrontend = Boolean(dae.extensionMetadata?.["isOldFrontend"]);
        const argText = argNodes[0]?.text?.trim() ?? "0";
        const vt = inferArenaExprVarType(dae, aid);
        const typeStr = varTypeName(vt ?? VarType.Real);
        const message = isOldFrontend
          ? `In sum(${argText}), the expression is of type ${typeStr}, but is required to be of builtin array type (of any number of dimensions).`
          : `Type mismatch for positional argument 1 in sum(a=${argText}). The argument has type:\n  ${typeStr}\nexpected type:\n  Array`;
        dae.diagnostics.push({
          severity: "error",
          code: ModelicaErrorCode.FUNCTION_ARG_TYPE_MISMATCH.code,
          message,
          range: diagRange,
        });
        return -1;
      }
    }
  }

  if (cleanFnName === "fill" && argExprIds.length >= 2) {
    for (let i = 1; i < argExprIds.length; i++) {
      const aid = argExprIds[i]!;
      if (dae.getExprKind(aid) === ExprKind.Name) {
        const vName = dae.interner.resolve(dae.getExprData1(aid));
        if (vName) {
          const vIdx = dae.lookupVariable(vName);
          if (vIdx >= 0) {
            const v = dae.getVarVariability(vIdx);
            if (
              v !== Variability.Parameter &&
              v !== Variability.Constant &&
              !(dae.classKind === "function" && dae.getVarCausality(vIdx) === Causality.Input)
            ) {
              let isAlgorithm = false;
              let cur: SyntaxNode | null | undefined = node;
              while (cur) {
                if (
                  cur.type === "statement" ||
                  cur.type === "assignment_statement" ||
                  cur.type === "algorithm_section"
                ) {
                  isAlgorithm = true;
                  break;
                }
                cur = cur.parent;
              }
              if (isAlgorithm) {
                continue;
              }
              const diagRange = getElementDiagRange(cur ?? node);
              const callText = node?.text?.trim() ?? `fill(...)`;
              dae.diagnostics.push({
                severity: "error",
                code: ModelicaErrorCode.DIMENSION_NOT_PARAMETER.code,
                message: `Expression '${vName}' that determines the size of dimension '${i}' of '${callText}' is not an evaluable parameter expression.`,
                range: diagRange,
              });
              return -1;
            }
          }
        }
      }
    }
  }

  if (cleanFnName === "matrix" && argExprIds.length === 1) {
    const aid = argExprIds[0]!;
    const shape = getArrayCtorShape(aid, dae);
    if (shape.length >= 3) {
      for (let d = 2; d < shape.length; d++) {
        if (shape[d]! > 1) {
          let cur: SyntaxNode | null | undefined = node;
          while (
            cur &&
            cur.type !== "component_clause" &&
            cur.type !== "simple_equation" &&
            cur.type !== "statement" &&
            cur.type !== "assignment_statement"
          ) {
            cur = cur.parent;
          }
          const diagRange = getElementDiagRange(cur ?? node);
          dae.diagnostics.push({
            severity: "error",
            code: ModelicaErrorCode.FUNCTION_ARG_TYPE_MISMATCH.code,
            message: `Invalid dimension ${d + 1} of argument to matrix, expected dimension size 1 but got ${shape[d]}.`,
            range: diagRange,
          });
          return -1;
        }
      }
    }
  }

  if (cleanFnName === "vector" && argExprIds.length === 1) {
    const aid = argExprIds[0]!;
    const shape = getArrayCtorShape(aid, dae);
    if (shape.filter((s) => s > 1).length > 1) {
      let cur: SyntaxNode | null | undefined = node;
      while (
        cur &&
        cur.type !== "component_clause" &&
        cur.type !== "simple_equation" &&
        cur.type !== "statement" &&
        cur.type !== "assignment_statement"
      ) {
        cur = cur.parent;
      }
      const diagRange = getElementDiagRange(cur ?? node);
      const vt = inferArenaExprVarType(dae, aid);
      const elemType = varTypeName(vt ?? VarType.Real);
      const argText = collapseAsciiWhitespace(argNodes[0]?.text ?? "");
      dae.diagnostics.push({
        severity: "error",
        code: ModelicaErrorCode.FUNCTION_ARG_TYPE_MISMATCH.code,
        message: `Invalid dimensions ${elemType}[${shape.join(", ")}] in vector(${argText}), no more than one dimension may have size > 1.`,
        range: diagRange,
      });
      return -1;
    }
  }

  if (cleanFnName === "symmetric" && argExprIds.length === 1) {
    const aid = argExprIds[0]!;
    const shape = getArrayCtorShape(aid, dae);
    if (shape.length === 2 && shape[0] !== shape[1]) {
      let cur: SyntaxNode | null | undefined = node;
      while (
        cur &&
        cur.type !== "component_clause" &&
        cur.type !== "simple_equation" &&
        cur.type !== "statement" &&
        cur.type !== "assignment_statement"
      ) {
        cur = cur.parent;
      }
      const diagRange = getElementDiagRange(cur ?? node);
      const vt = inferArenaExprVarType(dae, aid);
      const elemType = varTypeName(vt ?? VarType.Real);
      const argText = collapseAsciiWhitespace(argNodes[0]?.text ?? "");
      dae.diagnostics.push({
        severity: "error",
        code: ModelicaErrorCode.FUNCTION_ARG_TYPE_MISMATCH.code,
        message: `Type mismatch for positional argument 1 in symmetric(=${argText}). The argument has type:\n  ${elemType}[${shape[0]}, ${shape[1]}]\nexpected type:\n  Any[n, n]`,
        range: diagRange,
      });
      return -1;
    }
  }

  if (cleanFnName === "promote" && argExprIds.length === 2) {
    const arrId = argExprIds[0]!;
    const targetDimId = argExprIds[1]!;
    let nDims = 0;
    if (dae.getExprKind(arrId) === ExprKind.Name) {
      const vName = dae.interner.resolve(dae.getExprData1(arrId));
      if (vName) {
        const vIdx = dae.lookupVariable(vName);
        if (vIdx >= 0) {
          const s = dae.getVarShape(vIdx);
          if (s && s.length > 0) nDims = s.length;
        }
      }
    }
    if (nDims === 0) {
      const s = getArrayCtorShape(arrId, dae);
      nDims = s.length;
    }
    const targetDim = evalDaeExpr(targetDimId, dae);
    if (typeof targetDim === "number" && nDims > 0 && targetDim < nDims) {
      let cur: SyntaxNode | null | undefined = node;
      while (
        cur &&
        cur.type !== "component_clause" &&
        cur.type !== "simple_equation" &&
        cur.type !== "statement" &&
        cur.type !== "assignment_statement"
      ) {
        cur = cur.parent;
      }
      const diagRange = getElementDiagRange(cur ?? node);
      const targetDimStr = argNodes[1]?.text?.trim() ?? String(targetDim);
      dae.diagnostics.push({
        severity: "error",
        code: ModelicaErrorCode.FUNCTION_ARG_TYPE_MISMATCH.code,
        message: `The second argument '${targetDimStr}' of promote may not be smaller than the number of dimensions (${nDims}) of the first argument.`,
        range: diagRange,
      });
      return -1;
    }
  }

  if (cleanFnName === "smooth") {
    let cur: SyntaxNode | null | undefined = node;
    while (
      cur &&
      cur.type !== "component_clause" &&
      cur.type !== "simple_equation" &&
      cur.type !== "statement" &&
      cur.type !== "assignment_statement"
    ) {
      cur = cur.parent;
    }
    const diagRange = getElementDiagRange(cur ?? node);

    if (argExprIds.length !== 2) {
      const rawArgs = argNodes.map((a) => a?.text?.trim() ?? "").join(", ");
      dae.diagnostics.push({
        severity: "error",
        code: ModelicaErrorCode.FUNCTION_ARG_TYPE_MISMATCH.code,
        message: `No matching function found for smooth(${rawArgs}).\nCandidates are:\n  smooth(Integer, Any) => Any`,
        range: diagRange,
      });
      return -1;
    }

    // Check arg 1: k must be parameter Integer
    const kId = argExprIds[0]!;
    const kText = argNodes[0]?.text?.trim() ?? "";
    let kVarIdx = -1;
    if (dae.getExprKind(kId) === ExprKind.Name) {
      const vName = dae.interner.resolve(dae.getExprData1(kId));
      kVarIdx = vName ? dae.lookupVariable(vName) : -1;
    } else if (kText) {
      kVarIdx = dae.lookupVariable(kText);
    }
    const kType = inferArenaExprVarType(dae, kId);
    if (kType === VarType.Real) {
      dae.diagnostics.push({
        severity: "error",
        code: ModelicaErrorCode.FUNCTION_ARG_TYPE_MISMATCH.code,
        message: `Type mismatch for positional argument 1 in smooth(=${kText}). The argument has type:\n  Real\nexpected type:\n  Integer`,
        range: diagRange,
      });
      return -1;
    }
    if (kVarIdx >= 0) {
      const vari = dae.getVarVariability(kVarIdx);
      if (vari !== Variability.Parameter && vari !== Variability.Constant) {
        dae.diagnostics.push({
          severity: "error",
          code: ModelicaErrorCode.FUNCTION_ARG_TYPE_MISMATCH.code,
          message: `Argument 1 of smooth must be a parameter expression, but ${kText} is continuous.`,
          range: diagRange,
        });
        return -1;
      }
    }

    // Check arg 2: x cannot be String
    const xId = argExprIds[1]!;
    const xText = argNodes[1]?.text?.trim() ?? "";
    const xType = inferArenaExprVarType(dae, xId);
    if (xType === VarType.String) {
      dae.diagnostics.push({
        severity: "error",
        code: ModelicaErrorCode.FUNCTION_ARG_TYPE_MISMATCH.code,
        message: `Type mismatch for positional argument 2 in smooth(=${xText}). The argument has type:\n  String\nexpected type:\n  Real\n  Real[:, ...]\n  Real record\n  Real record[:, ...]`,
        range: diagRange,
      });
      return -1;
    }
  }

  if (cleanFnName === "Integer" && argExprIds.length === 1) {
    const aid = argExprIds[0]!;
    const vt = inferArenaExprVarType(dae, aid);
    const k = dae.getExprKind(aid);
    if (vt === VarType.Real || k === ExprKind.RealLiteral) {
      let cur: SyntaxNode | null | undefined = node;
      while (
        cur &&
        cur.type !== "component_clause" &&
        cur.type !== "simple_equation" &&
        cur.type !== "statement" &&
        cur.type !== "assignment_statement"
      ) {
        cur = cur.parent;
      }
      const diagRange = getElementDiagRange(cur ?? node);
      const argText = argNodes[0]?.text?.trim() ?? "1.0";
      dae.diagnostics.push({
        severity: "error",
        code: ModelicaErrorCode.FUNCTION_ARG_TYPE_MISMATCH.code,
        message: `Type mismatch for positional argument 1 in Integer(e=${argText}). The argument has type:\n  Real\nexpected type:\n  enumeration(:)`,
        range: diagRange,
      });
      return -1;
    }
  }

  if (cleanFnName === "String") {
    let isInvalidStringCall = false;
    const rec = argExprIds.length >= 1 ? resolveOperatorRecord(argExprIds[0]!, argNodes[0], dae, db, flattener) : null;
    let hasRecOverload = false;
    if (rec) {
      const ops = db?.query<Map<string, OperatorFnData[]> | null>("operatorFunctions", rec.symId);
      const strOps = ops?.get("'String'") ?? ops?.get("String");
      if (strOps && strOps.length > 0) hasRecOverload = true;
    }
    if (!hasRecOverload) {
      if (argExprIds.length > 2) {
        isInvalidStringCall = true;
      } else if (argExprIds.length === 1) {
        const aid = argExprIds[0]!;
        const k = dae.getExprKind(aid);
        if (k === ExprKind.Name) {
          const vName = dae.interner.resolve(dae.getExprData1(aid));
          if (vName) {
            const currentPrefix = getFlatteningState(dae, flattener).currentPrefix ?? flattener?.currentPrefix;
            let fullIdx = dae.getVarIdxByName(vName);
            if (fullIdx < 0 && currentPrefix) {
              fullIdx = dae.getVarIdxByName(`${currentPrefix}.${vName}`);
            }
            if (fullIdx >= 0 && !dae.getVarCustomType(fullIdx)) {
              // Valid primitive or enumeration variable in DAE
            } else {
              const scopeId =
                flattener?.currentFlatteningFunctionId ?? flattener?.currentClassId ?? flattener?.currentRootClassId;
              const sym =
                scopeId !== undefined && scopeId !== null
                  ? (db?.query<(n: string) => SymbolEntry | null>("resolveSimpleName", scopeId)?.(vName) ??
                    db?.query<(n: string) => SymbolEntry | null>("resolveName", scopeId)?.(vName) ??
                    db?.byName(vName)[0])
                  : db?.byName(vName)[0];
              const meta = sym?.metadata as SymbolMetaLike | undefined;
              if (meta?.typeSpecifier && !["Real", "Integer", "Boolean", "String"].includes(meta.typeSpecifier)) {
                const typeSym =
                  sym?.parentId !== undefined && sym?.parentId !== null
                    ? (db?.query<(n: string) => SymbolEntry | null>(
                        "resolveSimpleName",
                        sym.parentId,
                      )?.(meta.typeSpecifier) ??
                      db?.query<(n: string) => SymbolEntry | null>("resolveName", sym.parentId)?.(meta.typeSpecifier) ??
                      (db ? resolveQualified(db, meta.typeSpecifier) : null) ??
                      db?.byName(meta.typeSpecifier.split(".").pop()!)[0])
                    : ((db ? resolveQualified(db, meta.typeSpecifier) : null) ??
                      db?.byName(meta.typeSpecifier.split(".").pop()!)[0]);
                const isTypeAliasOrEnum =
                  typeSym &&
                  (typeSym.kind === "type" ||
                    (typeSym.metadata as SymbolMetaLike | undefined)?.restriction === "type" ||
                    (typeSym.metadata as SymbolMetaLike | undefined)?.isEnumeration);
                if (!isTypeAliasOrEnum) {
                  isInvalidStringCall = true;
                }
              }
            }
          }
        }
      }
    }
    if (isInvalidStringCall) {
      let cur: SyntaxNode | null | undefined = node;
      while (
        cur &&
        cur.type !== "component_clause" &&
        cur.type !== "simple_equation" &&
        cur.type !== "statement" &&
        cur.type !== "assignment_statement"
      ) {
        cur = cur.parent;
      }
      const diagRange = getElementDiagRange(cur ?? node);
      const formatArgStr = (aid: number, idx: number): string => {
        const aNode = argNodes[idx];
        const rawText = aNode?.text?.trim() ?? "";
        const k = dae.getExprKind(aid);
        if (k === ExprKind.IntLiteral) return `/*Integer*/ ${rawText}`;
        if (k === ExprKind.BoolLiteral) return `/*Boolean*/ ${rawText}`;
        if (k === ExprKind.RealLiteral) return `/*Real*/ ${rawText}`;
        if (k === ExprKind.StringLiteral) return `/*String*/ ${rawText}`;
        if (k === ExprKind.Name) {
          const vName = dae.interner.resolve(dae.getExprData1(aid));
          const sym = vName ? db?.byName(vName)[0] : null;
          const tSpec = (sym?.metadata as SymbolMetaLike | undefined)?.typeSpecifier;
          if (tSpec) return `/*${tSpec}*/ ${rawText}`;
        }
        const vt = inferArenaExprVarType(dae, aid);
        return `/*${varTypeName(vt ?? VarType.Real)}*/ ${rawText}`;
      };
      const formattedArgs = argExprIds.map(formatArgStr).join(", ");
      const stringCandidates = `  String(enumeration(:) $e, Integer minimumLength = 0, Boolean leftJustified = true) => String\n  String(Integer $i, Integer minimumLength = 0, Boolean leftJustified = true) => String\n  String(Boolean $b, Integer minimumLength = 0, Boolean leftJustified = true) => String\n  String(Real $r, Integer significantDigits = 6, Integer minimumLength = 0, Boolean leftJustified = true) => String\n  String(Real $r, String format) => String`;
      dae.diagnostics.push({
        severity: "error",
        code: ModelicaErrorCode.NO_MATCHING_OPERATOR_FUNCTION.code,
        message: `No matching function found for String(${formattedArgs}).\nCandidates are:\n${stringCandidates}`,
        range: diagRange,
      });
      return -1;
    }
  }

  if (cleanFnName === "abs" && argExprIds.length === 1) {
    const aid = argExprIds[0]!;
    const vt = inferArenaExprVarType(dae, aid);
    if (vt === VarType.Boolean || vt === VarType.String) {
      let cur: SyntaxNode | null | undefined = node;
      while (
        cur &&
        cur.type !== "component_clause" &&
        cur.type !== "simple_equation" &&
        cur.type !== "statement" &&
        cur.type !== "assignment_statement"
      ) {
        cur = cur.parent;
      }
      const diagRange = getElementDiagRange(cur ?? node);
      dae.diagnostics.push({
        severity: "error",
        code: ModelicaErrorCode.NO_MATCHING_OPERATOR_FUNCTION.code,
        message: `No matching function found for abs in component <NO COMPONENT>\ncandidates are .OpenModelica.Internal.intAbs<function>(Integer v) => Integer\n -.OpenModelica.Internal.realAbs<function>(Real v) => Real`,
        range: diagRange,
      });
      return -1;
    }
  }

  if (cleanFnName === "delay") {
    let cur: SyntaxNode | null | undefined = node;
    while (
      cur &&
      cur.type !== "component_clause" &&
      cur.type !== "simple_equation" &&
      cur.type !== "statement" &&
      cur.type !== "assignment_statement"
    ) {
      cur = cur.parent;
    }
    const diagRange = getElementDiagRange(cur ?? node);

    if (argExprIds.length === 2) {
      const dTimeId = argExprIds[1]!;
      const dTimeText = argNodes[1]?.text?.trim() ?? "";
      let vIdx = -1;
      if (dae.getExprKind(dTimeId) === ExprKind.Name) {
        const vName = dae.interner.resolve(dae.getExprData1(dTimeId));
        vIdx = vName ? dae.lookupVariable(vName) : -1;
      } else if (dTimeText) {
        vIdx = dae.lookupVariable(dTimeText);
      }
      if (vIdx >= 0) {
        const vari = dae.getVarVariability(vIdx);
        if (vari !== Variability.Parameter && vari !== Variability.Constant) {
          const isOldFrontend = Boolean(dae.extensionMetadata?.["isOldFrontend"]);
          dae.diagnostics.push({
            severity: "error",
            code: ModelicaErrorCode.FUNCTION_ARG_TYPE_MISMATCH.code,
            message: `Function argument delayTime=${dTimeText} in call to OpenModelica.Internal.delay2 has variability continuous which is not a parameter expression.`,
            range: diagRange,
          });
          if (isOldFrontend) {
            dae.diagnostics.push({
              severity: "error",
              code: ModelicaErrorCode.FUNCTION_ARG_TYPE_MISMATCH.code,
              message: `No matching function found for delay in component <NO COMPONENT>\ncandidates are .OpenModelica.Internal.delay2<function>(Real expr, Real parameter delayTime) => Real\n -.OpenModelica.Internal.delay3<function>(Real expr, Real delayTime, Real parameter delayMax) => Real`,
              range: diagRange,
            });
          }
          return -1;
        }
      }
      argExprIds.push(dTimeId);
    } else if (argExprIds.length === 3) {
      const dMaxId = argExprIds[2]!;
      const dMaxText = argNodes[2]?.text?.trim() ?? "";
      let vIdx = -1;
      if (dae.getExprKind(dMaxId) === ExprKind.Name) {
        const vName = dae.interner.resolve(dae.getExprData1(dMaxId));
        vIdx = vName ? dae.lookupVariable(vName) : -1;
      } else if (dMaxText) {
        vIdx = dae.lookupVariable(dMaxText);
      }
      if (vIdx >= 0) {
        const vari = dae.getVarVariability(vIdx);
        if (vari !== Variability.Parameter && vari !== Variability.Constant) {
          const isOldFrontend = Boolean(dae.extensionMetadata?.["isOldFrontend"]);
          dae.diagnostics.push({
            severity: "error",
            code: ModelicaErrorCode.FUNCTION_ARG_TYPE_MISMATCH.code,
            message: `Function argument delayMax=${dMaxText} in call to OpenModelica.Internal.delay3 has variability continuous which is not a parameter expression.`,
            range: diagRange,
          });
          if (isOldFrontend) {
            dae.diagnostics.push({
              severity: "error",
              code: ModelicaErrorCode.FUNCTION_ARG_TYPE_MISMATCH.code,
              message: `No matching function found for delay in component <NO COMPONENT>\ncandidates are .OpenModelica.Internal.delay2<function>(Real expr, Real parameter delayTime) => Real\n -.OpenModelica.Internal.delay3<function>(Real expr, Real delayTime, Real parameter delayMax) => Real`,
              range: diagRange,
            });
          }
          return -1;
        }
      }
    }
    if (argExprIds.length === 3) {
      for (let i = 0; i < 3; i++) {
        if (!isRealExpr(argExprIds[i]!, dae)) {
          argExprIds[i] = castToRealExpr(argExprIds[i]!, dae);
        }
      }
      const a0 = argExprIds[0]!;
      if (dae.getExprKind(a0) === ExprKind.Binary) {
        const op = dae.getExprData1(a0) as BinOp;
        const lId = dae.getExprLeft(a0);
        const rId = dae.getExprRight(a0);
        if (op === BinOp.Add) {
          if (dae.getExprKind(lId) === ExprKind.RealLiteral) {
            return dae.addBinaryExpr(BinOp.Add, lId, dae.addCallExpr("delay", [rId, argExprIds[1]!, argExprIds[2]!]));
          }
          if (dae.getExprKind(rId) === ExprKind.RealLiteral) {
            return dae.addBinaryExpr(BinOp.Add, rId, dae.addCallExpr("delay", [lId, argExprIds[1]!, argExprIds[2]!]));
          }
        } else if (op === BinOp.Sub && dae.getExprKind(rId) === ExprKind.RealLiteral) {
          const negLit = dae.addRealLiteral(-dae.getExprRealValue(rId));
          return dae.addBinaryExpr(BinOp.Add, negLit, dae.addCallExpr("delay", [lId, argExprIds[1]!, argExprIds[2]!]));
        }
      }
    }
  }

  if (cleanFnName === "sample" && argExprIds.length === 2) {
    const secondArgId = argExprIds[1]!;
    let isClockSecondArg = inferArenaExprVarType(dae, secondArgId) === VarType.Clock;
    if (!isClockSecondArg && dae.getExprKind(secondArgId) === ExprKind.Name) {
      const cName = dae.interner.resolve(dae.getExprData1(secondArgId));
      const cIdx = cName ? dae.getVarIdxByName(cName) : -1;
      if (cIdx >= 0 && dae.getVarType(cIdx) === VarType.Clock) {
        isClockSecondArg = true;
      }
    }
    if (!isClockSecondArg && dae.getExprKind(secondArgId) === ExprKind.Call) {
      const cFn = dae.interner.resolve(dae.getExprData1(secondArgId));
      if (cFn === "Clock" || cFn.startsWith("Clock")) {
        isClockSecondArg = true;
      }
    }
    if (!isClockSecondArg) {
      const startId = argExprIds[0]!;
      const startText = argNodes[0]?.text?.trim() ?? "";
      let vIdx = -1;
      if (dae.getExprKind(startId) === ExprKind.Name) {
        const vName = dae.interner.resolve(dae.getExprData1(startId));
        vIdx = vName ? dae.lookupVariable(vName) : -1;
      } else if (startText) {
        vIdx = dae.lookupVariable(startText);
      }
      if (vIdx >= 0) {
        const vari = dae.getVarVariability(vIdx);
        if (vari !== Variability.Parameter && vari !== Variability.Constant) {
          let cur: SyntaxNode | null | undefined = node;
          while (
            cur &&
            cur.type !== "component_clause" &&
            cur.type !== "simple_equation" &&
            cur.type !== "statement" &&
            cur.type !== "assignment_statement" &&
            cur.type !== "when_equation" &&
            cur.type !== "when_statement"
          ) {
            cur = cur.parent;
          }
          const diagRange = getElementDiagRange(cur ?? node);
          dae.diagnostics.push({
            severity: "error",
            code: ModelicaErrorCode.FUNCTION_ARG_TYPE_MISMATCH.code,
            message: `Function argument start=${startText} in call to sample has variability continuous which is not a parameter expression.`,
            range: diagRange,
          });
          return -1;
        }
      }
    }
  }

  if (cleanFnName === "cardinality") {
    let cur: SyntaxNode | null | undefined = node;
    let inAllowedContext = false;
    while (cur) {
      if (
        (cur.type === "if_equation" || cur.type === "if_statement" || cur.type === "elseif_clause") &&
        cur.child(1) &&
        (cur.child(1) === node || cur.child(1)?.text?.includes("cardinality"))
      ) {
        inAllowedContext = true;
        break;
      }
      if (
        cur.type === "function_call" &&
        (cur.child(0)?.text === "assert" || cur.child(0)?.text?.endsWith(".assert"))
      ) {
        inAllowedContext = true;
        break;
      }
      cur = cur.parent;
    }
    let clause: SyntaxNode | null | undefined = node;
    while (
      clause &&
      clause.type !== "component_clause" &&
      clause.type !== "simple_equation" &&
      clause.type !== "statement" &&
      clause.type !== "assignment_statement" &&
      clause.type !== "if_equation" &&
      clause.type !== "if_statement" &&
      clause.type !== "for_equation" &&
      clause.type !== "for_statement" &&
      clause.type !== "when_equation" &&
      clause.type !== "when_statement"
    ) {
      clause = clause.parent;
    }
    const diagRange = getElementDiagRange(clause ?? node);
    const isOldFrontend = Boolean(
      dae.extensionMetadata?.["isOldFrontend"] ||
      flattener?.options?.isOldFrontend ||
      getDaeExtMeta(dae)?.hasOldInstOption,
    );

    if (!inAllowedContext && !isOldFrontend) {
      dae.diagnostics.push({
        severity: "error",
        code: ModelicaErrorCode.DIMENSION_NOT_PARAMETER.code,
        message: "cardinality may only be used in the condition of an if-statement/equation or an assert.",
        range: diagRange,
      });
      return -1;
    }

    if (argNodes.length > 0) {
      const argNode = argNodes[0];
      const argText = argNode?.text?.trim() ?? "";
      const rootIdent = argText.split(".")[0]?.split("[")[0] ?? "";
      const scopeId = flattener?.currentClassId ?? flattener?.currentRootClassId;
      const resolver = scopeId !== undefined ? db?.query<NameResolver | null>("resolveSimpleName", scopeId) : null;
      const resolved = resolver ? resolver(rootIdent) : db?.byName(rootIdent)?.[0];
      if (resolved && resolved.kind === "Class" && !argText.includes(".")) {
        dae.diagnostics.push({
          severity: "error",
          code: ModelicaErrorCode.CARDINALITY_EXPECTED_COMPONENT.code,
          message: ModelicaErrorCode.CARDINALITY_EXPECTED_COMPONENT.message(argText),
          range: diagRange,
        });
        return -1;
      }

      if (db && argText) {
        const parts = argText.split(".");
        let currScopeId = scopeId;
        let currentType: string | null = null;
        const totalDims: number[] = [];
        let isConnector = false;

        for (let i = 0; i < parts.length; i++) {
          const rawPart = parts[i]!;
          const partName = rawPart.split("[")[0] ?? "";
          const hasExplicitSub = rawPart.includes("[");
          const partResolver =
            currScopeId !== undefined ? db.query<NameResolver | null>("resolveSimpleName", currScopeId) : null;
          const comp = partResolver ? partResolver(partName) : db.byName(partName)[0];
          if (!comp) break;

          currentType = db.query<string | null>("typeSpecifier", comp.id) ?? comp.name;
          const compCst = db.cstNode(comp.id) as SyntaxNode | null | undefined;
          if (!hasExplicitSub && compCst) {
            const subNode = (compCst.children || []).find((c) => c.type === "array_subscripts");
            if (subNode) {
              for (const sc of subNode.children || []) {
                if (sc.type !== "subscript") continue;
                const subText = sc.text?.trim() ?? "";
                if (isAsciiDigitsOnly(subText)) {
                  totalDims.push(parseInt(subText, 10));
                }
              }
            }
          }

          if (currentType) {
            const typeResolver =
              currScopeId !== undefined
                ? (db.query<NameResolver | null>("resolveName", currScopeId) ??
                  db.query<NameResolver | null>("resolveSimpleName", currScopeId))
                : null;
            const simpleTypeName = currentType.includes(".") ? currentType.split(".").pop()! : currentType;
            const resolvedSym = typeResolver?.(currentType);
            const typeClass =
              (resolvedSym && resolvedSym.kind === "Class" ? resolvedSym : null) ??
              db.byName(currentType).find((c) => c.kind === "Class") ??
              db.byName(simpleTypeName).find((c) => c.kind === "Class");
            if (typeClass) {
              currScopeId = typeClass.id;
              const typeClassCst = db.cstNode(typeClass.id) as SyntaxNode | null | undefined;
              const classPrefixesNode = (typeClassCst?.children || []).find((c) => c.type === "class_prefixes");
              const metaPrefix = String(
                (typeClass.metadata as SymbolMetaLike | undefined)?.classKind ??
                  (typeClass.metadata as SymbolMetaLike | undefined)?.classPrefixes ??
                  "",
              );
              const isConnectorPrefix =
                cstHasTokenText(classPrefixesNode, "connector") ||
                collapseAsciiWhitespace(metaPrefix).split(" ").includes("connector");
              if (
                isConnectorPrefix ||
                db.query<boolean>("isConnector", typeClass.id) ||
                db.query<boolean>("isConnector", comp.id)
              ) {
                isConnector = true;
              }
            } else if (db.query<boolean>("isConnector", comp.id)) {
              isConnector = true;
            }
          }
        }

        if ((!isOldFrontend && totalDims.length > 0) || !isConnector) {
          const dimStr = totalDims.length > 0 ? `[${totalDims.join(",")}]` : "";
          const actualTypeStr = `${currentType ?? "Unknown"}${dimStr}`;
          dae.diagnostics.push({
            severity: "error",
            code: ModelicaErrorCode.FUNCTION_ARG_TYPE_MISMATCH.code,
            message: ModelicaErrorCode.FUNCTION_ARG_TYPE_MISMATCH.message(
              `cardinality(c=${argText})`,
              "1",
              actualTypeStr,
              "Connector",
            ),
            range: diagRange,
          });
          return -1;
        }
      }
    }
  }

  if (cleanFnName === "previous" && argExprIds.length === 1) {
    const aNode = argNodes[0];
    const fnArgName = aNode?.text?.trim() ?? "";
    const fnSym = fnArgName ? db?.byName(fnArgName).find((e) => e.kind === "Function" || e.kind === "Class") : null;
    if (
      fnSym &&
      (fnSym.kind === "Function" ||
        (fnSym.metadata as SymbolMetaLike | undefined)?.classKind === "function" ||
        flattener?.isFunctionSym?.(fnSym))
    ) {
      let cur: SyntaxNode | null | undefined = node;
      while (
        cur &&
        cur.type !== "component_clause" &&
        cur.type !== "simple_equation" &&
        cur.type !== "statement" &&
        cur.type !== "assignment_statement"
      ) {
        cur = cur.parent;
      }
      const diagRange = getElementDiagRange(cur ?? node);
      dae.diagnostics.push({
        severity: "error",
        code: ModelicaErrorCode.FUNCTION_ARG_TYPE_MISMATCH.code,
        message: `Type mismatch for positional argument 1 in previous(u=${fnArgName}). The argument has type:\n  ${fnArgName}<function>() => ()\nexpected type:\n  ComponentExpression`,
        range: diagRange,
      });
      return -1;
    }
  }

  if (cleanFnName === "min" || cleanFnName === "max") {
    const isStringArg = (aid: number): boolean => {
      if (aid < 0) return false;
      const k = dae.getExprKind(aid);
      if (k === ExprKind.StringLiteral) return true;
      if (inferArenaExprVarType(dae, aid) === VarType.String) return true;
      if (k === ExprKind.ArrayCtor) {
        const elems = getArrayCtorElements(aid, dae);
        if (elems.length > 0 && isStringArg(elems[0]!)) return true;
      }
      return false;
    };

    let isInvalid = false;
    if (argExprIds.length === 0 || argExprIds.length > 2) {
      isInvalid = true;
    } else if (argExprIds.length === 2) {
      if (isStringArg(argExprIds[0]!) || isStringArg(argExprIds[1]!)) {
        isInvalid = true;
      }
    } else if (argExprIds.length === 1) {
      if (isStringArg(argExprIds[0]!)) {
        isInvalid = true;
      }
    }

    if (isInvalid) {
      const candidates = `  ${cleanFnName}(Real, Real) => Real
  ${cleanFnName}(Integer, Integer) => Integer
  ${cleanFnName}(Boolean, Boolean) => Boolean
  ${cleanFnName}(enumeration(:), enumeration(:)) => enumeration(:)
  ${cleanFnName}(Real[:, ...]) => Real
  ${cleanFnName}(Integer[:, ...]) => Integer
  ${cleanFnName}(Boolean[:, ...]) => Boolean
  ${cleanFnName}(enumeration(:)[:, ...]) => enumeration(:)`;

      let cur: SyntaxNode | null | undefined = node;
      while (
        cur &&
        cur.type !== "simple_equation" &&
        cur.type !== "component_clause" &&
        cur.type !== "statement" &&
        cur.type !== "assignment_statement"
      ) {
        cur = cur.parent;
      }
      const diagNode = cur ?? node;
      const startB = diagNode?.startIndex ?? diagNode?.startOffset;
      const endB = diagNode?.endIndex ?? diagNode?.endOffset;
      const argsText = argsNode?.text?.trim() ?? "()";
      const callArgsStr = argsText.startsWith("(") ? argsText : `(${argsText})`;
      const callStr = `${cleanFnName}${callArgsStr}`;

      dae.diagnostics.push({
        severity: "error",
        code: ModelicaErrorCode.NO_MATCHING_OPERATOR_FUNCTION.code,
        message: `No matching function found for ${callStr}.\nCandidates are:\n${candidates}`,
        range:
          startB != null && endB != null
            ? {
                startOffset: startB,
                endOffset: endB,
                startPosition: diagNode?.startPosition,
                endPosition: diagNode?.endPosition,
              }
            : undefined,
      });
      return -1;
    }
  }

  if (fnName === "sin" || fnName === "cos" || fnName === "tan" || fnName === "exp" || fnName === "log") {
    for (let i = 0; i < argExprIds.length; i++) {
      argExprIds[i] = castToRealExpr(argExprIds[i]!, dae);
    }
  }

  if (fnName === "transition") {
    const fromExpr = namedArgs.get("from") ?? (argExprIds.length >= 1 ? argExprIds[0]! : -1);
    const toExpr = namedArgs.get("to") ?? (argExprIds.length >= 2 ? argExprIds[1]! : -1);
    if (fromExpr >= 0 && toExpr >= 0) {
      const condExpr =
        namedArgs.get("condition") ??
        (argExprIds.length >= 3 ? argExprIds[2]! : dae.addExpression(ExprKind.BoolLiteral, 1));
      const immediateExpr =
        namedArgs.get("immediate") ??
        (argExprIds.length > 3 ? argExprIds[3]! : dae.addExpression(ExprKind.BoolLiteral, 0));
      const resetExpr =
        namedArgs.get("reset") ?? (argExprIds.length > 4 ? argExprIds[4]! : dae.addExpression(ExprKind.BoolLiteral, 1));
      const syncExpr =
        namedArgs.get("synchronize") ??
        (argExprIds.length > 5 ? argExprIds[5]! : dae.addExpression(ExprKind.BoolLiteral, 0));
      const priorityExpr = namedArgs.get("priority") ?? (argExprIds.length > 6 ? argExprIds[6]! : dae.addIntLiteral(1));

      return dae.addCallExpr("transition", [
        fromExpr,
        toExpr,
        condExpr,
        immediateExpr,
        resetExpr,
        syncExpr,
        priorityExpr,
      ]);
    }
  }

  if (fnName === "subSample" && argExprIds.length === 1) {
    argExprIds.push(dae.addIntLiteral(0));
  } else if (fnName === "superSample" && argExprIds.length === 1) {
    argExprIds.push(dae.addIntLiteral(0));
  } else if (fnName === "shiftSample" && argExprIds.length === 2) {
    argExprIds.push(dae.addIntLiteral(1));
  } else if (fnName === "backSample" && argExprIds.length === 2) {
    argExprIds.push(dae.addIntLiteral(1));
  } else if (fnName === "sample") {
    if (argExprIds.length === 1) {
      argExprIds.push(dae.addCallExpr("Clock", []));
    } else if (argExprIds.length === 2) {
      const secondArgId = argExprIds[1]!;
      const secondKind = dae.getExprKind(secondArgId);
      let isClockSecondArg = inferArenaExprVarType(dae, secondArgId) === VarType.Clock;
      if (!isClockSecondArg && secondKind === ExprKind.Name) {
        const vName = dae.interner.resolve(dae.getExprData1(secondArgId));
        const vIdx = vName ? dae.getVarIdxByName(vName) : -1;
        if (vIdx >= 0 && dae.getVarType(vIdx) === VarType.Clock) {
          isClockSecondArg = true;
        }
      }
      if (!isClockSecondArg) {
        for (let i = 0; i < 2; i++) {
          if (!isRealExpr(argExprIds[i]!, dae)) {
            argExprIds[i] = castToRealExpr(argExprIds[i]!, dae);
          }
        }
      }
    }
  } else if (fnName === "Clock") {
    if (argExprIds.length === 1) {
      if (dae.getExprKind(argExprIds[0]!) === ExprKind.IntLiteral) {
        argExprIds.push(dae.addIntLiteral(1));
      } else if (inferArenaExprVarType(dae, argExprIds[0]!) === VarType.Boolean) {
        argExprIds.push(dae.addRealLiteral(0.0));
      }
    } else if (argExprIds.length === 2 && dae.getExprKind(argExprIds[1]!) === ExprKind.Name) {
      const resName = dae.interner.resolve(dae.getExprData1(argExprIds[1]!));
      const resIdx = resName ? dae.getVarIdxByName(resName) : -1;
      if (resIdx >= 0 && dae.getVarType(resIdx) === VarType.Integer && dae.isVarProtected(resIdx)) {
        const bindId = dae.getVarBindingExpr(resIdx);
        if (bindId !== undefined && bindId >= 0 && dae.getExprKind(bindId) === ExprKind.IntLiteral) {
          argExprIds[1] = dae.addIntLiteral(dae.getExprData1(bindId));
        }
      }
    }
  }

  // ==========================================================================
  // Built-In Array Constructors, Reductions, and Linear Algebra Operators
  // ==========================================================================
  // vector(A) / matrix(A): reshape array rank to 1D or 2D by flattening or promoting dimensions
  if ((fnName === "vector" || fnName === "matrix") && argExprIds.length === 1) {
    let argId = argExprIds[0]!;
    if (dae.getExprKind(argId) === ExprKind.Name) {
      const vName = dae.interner.resolve(dae.getExprData1(argId));
      if (vName && dae.hasArrayElements(vName)) {
        const ctor = expandVarToArrayCtor(vName, dae);
        if (ctor !== null) argId = ctor;
      }
    }
    const flattenArrayElems = (exprId: number): number[] => {
      if (exprId < 0) return [];
      if (dae.getExprKind(exprId) === ExprKind.ArrayCtor) {
        const count = dae.getExprData1(exprId);
        const res: number[] = [];
        for (let i = 0; i < count; i++) {
          res.push(...flattenArrayElems(i === 0 ? dae.getExprLeft(exprId) : dae.getExprLeft(exprId + i)));
        }
        return res;
      }
      return [exprId];
    };

    if (fnName === "vector") {
      const flat = flattenArrayElems(argId);
      return dae.addArrayCtorExpr(flat);
    } else {
      const rank = getArrayCtorRank(argId, dae);
      if (rank === 0) {
        return dae.addArrayCtorExpr([dae.addArrayCtorExpr([argId])]);
      } else if (rank === 1) {
        const elems = getArrayCtorElements(argId, dae);
        const rows = elems.map((e) => dae.addArrayCtorExpr([e]));
        return dae.addArrayCtorExpr(rows);
      } else if (rank === 2) {
        return argId;
      } else {
        const outerRows = getArrayCtorElements(argId, dae);
        const rows = outerRows.map((r) => dae.addArrayCtorExpr(flattenArrayElems(r)));
        return dae.addArrayCtorExpr(rows);
      }
    }
  }

  if (fnName === "noClock" && argExprIds.length === 1 && dae.getExprKind(argExprIds[0]!) === ExprKind.ArrayCtor) {
    const elems = getArrayCtorElements(argExprIds[0]!, dae);
    return dae.addArrayCtorExpr(elems.map((el) => dae.addCallExpr("noClock", [el])));
  }

  // Attempt automatic function vectorization (Modelica Section 12.4.6) when array arguments
  // are passed to a scalar function parameter.
  const vectorizedCall = vectorizeFunctionCall(cleanFnName || fnName, argExprIds, dae, flattener, db);
  if (vectorizedCall !== null) {
    return vectorizedCall;
  }
  // array(e1, e2, ...): verify all arguments share identical dimensions and construct an ArrayCtor
  if (fnName === "array" || cleanFnName === "array") {
    if (argExprIds.length > 1) {
      const firstDims = getExprDims(argExprIds[0]!, dae, flattener?.db);
      for (let i = 1; i < argExprIds.length; i++) {
        const dims = getExprDims(argExprIds[i]!, dae, flattener?.db);
        if (firstDims && dims && (firstDims.length !== dims.length || firstDims.some((d, idx) => d !== dims[idx]))) {
          let clauseNode: SyntaxNode | null | undefined = node;
          while (clauseNode && clauseNode.type !== "component_clause") {
            clauseNode = clauseNode.parent;
          }
          const diagNode = clauseNode ?? node;
          const startB = diagNode.startIndex ?? diagNode.startOffset;
          const endB = diagNode.endIndex ?? diagNode.endOffset;
          dae.diagnostics.push({
            severity: "error",
            message: `Different dimension sizes in arguments to array in component <NO COMPONENT>.`,
            range: {
              startOffset: startB,
              endOffset: endB,
              startPosition: diagNode.startPosition,
              endPosition: diagNode.endPosition,
            },
          });
          return -1;
        }
      }
    }
    return dae.addArrayCtorExpr(argExprIds);
  }
  // transpose(A): swap first two dimensions (rows <-> columns) of a 2D+ ArrayCtor
  if (fnName === "transpose" || cleanFnName === "transpose") {
    if (argExprIds.length === 1) {
      let matId = argExprIds[0]!;
      if (dae.getExprKind(matId) === ExprKind.Name) {
        const vName = dae.interner.resolve(dae.getExprData1(matId));
        if (vName && dae.hasArrayElements(vName)) {
          const ctor = expandVarToArrayCtor(vName, dae);
          if (ctor !== null) matId = ctor;
        }
      }
      if (dae.getExprKind(matId) === ExprKind.ArrayCtor) {
        const rows = getArrayCtorElements(matId, dae);
        if (rows.length === 0) return matId;
        const firstRowKind = dae.getExprKind(rows[0]!);
        if (firstRowKind === ExprKind.ArrayCtor) {
          const numRows = rows.length;
          const cols0 = getArrayCtorElements(rows[0]!, dae);
          const numCols = cols0.length;
          const transposedRows: number[] = [];
          for (let c = 0; c < numCols; c++) {
            const newRowCols: number[] = [];
            for (let r = 0; r < numRows; r++) {
              const rCols = getArrayCtorElements(rows[r]!, dae);
              newRowCols.push(rCols[c]!);
            }
            transposedRows.push(dae.addArrayCtorExpr(newRowCols));
          }
          return dae.addArrayCtorExpr(transposedRows);
        }
      }
    }
  }

  // symmetric(A): mirror upper-triangular elements (r <= c) into the lower triangle
  if (fnName === "symmetric" || cleanFnName === "symmetric") {
    if (argExprIds.length === 1) {
      let matId = argExprIds[0]!;
      if (dae.getExprKind(matId) === ExprKind.Name) {
        const vName = dae.interner.resolve(dae.getExprData1(matId));
        if (vName && dae.hasArrayElements(vName)) {
          const ctor = expandVarToArrayCtor(vName, dae);
          if (ctor !== null) matId = ctor;
        }
      }
      if (dae.getExprKind(matId) === ExprKind.ArrayCtor) {
        const rows = getArrayCtorElements(matId, dae);
        if (rows.length === 0) return matId;
        const firstRowKind = dae.getExprKind(rows[0]!);
        if (firstRowKind === ExprKind.ArrayCtor) {
          const numRows = rows.length;
          const cols0 = getArrayCtorElements(rows[0]!, dae);
          const numCols = cols0.length;
          const allElements: number[][] = [];
          for (let r = 0; r < numRows; r++) {
            allElements.push(getArrayCtorElements(rows[r]!, dae));
          }
          const symmetricRows: number[] = [];
          for (let r = 0; r < numRows; r++) {
            const newRowCols: number[] = [];
            for (let c = 0; c < numCols; c++) {
              if (r <= c) {
                newRowCols.push(allElements[r]![c]!);
              } else {
                newRowCols.push(allElements[c]![r]!);
              }
            }
            symmetricRows.push(dae.addArrayCtorExpr(newRowCols));
          }
          return dae.addArrayCtorExpr(symmetricRows);
        }
      }
    }
  }

  // skew(v): construct 3x3 skew-symmetric cross-product matrix [[0, -v3, v2], [v3, 0, -v1], [-v2, v1, 0]]
  if (fnName === "skew" || cleanFnName === "skew") {
    if (argExprIds.length === 1) {
      let vecId = argExprIds[0]!;
      if (dae.getExprKind(vecId) === ExprKind.Name) {
        const vName = dae.interner.resolve(dae.getExprData1(vecId));
        if (vName && dae.hasArrayElements(vName)) {
          const ctor = expandVarToArrayCtor(vName, dae);
          if (ctor !== null) vecId = ctor;
        }
      }
      if (dae.getExprKind(vecId) === ExprKind.ArrayCtor) {
        const elems = getArrayCtorElements(vecId, dae);
        if (elems.length === 3) {
          const v1 = elems[0]!;
          const v2 = elems[1]!;
          const v3 = elems[2]!;
          const val1 = evalDaeExpr(v1, dae);
          const val2 = evalDaeExpr(v2, dae);
          const val3 = evalDaeExpr(v3, dae);
          if (typeof val1 === "number" && typeof val2 === "number" && typeof val3 === "number") {
            const row1 = dae.addArrayCtorExpr([
              dae.addRealLiteral(0.0),
              dae.addRealLiteral(-val3),
              dae.addRealLiteral(val2),
            ]);
            const row2 = dae.addArrayCtorExpr([
              dae.addRealLiteral(val3),
              dae.addRealLiteral(0.0),
              dae.addRealLiteral(-val1),
            ]);
            const row3 = dae.addArrayCtorExpr([
              dae.addRealLiteral(-val2),
              dae.addRealLiteral(val1),
              dae.addRealLiteral(0.0),
            ]);
            return dae.addArrayCtorExpr([row1, row2, row3]);
          }
          const zero = dae.addRealLiteral(0.0);
          const negV3 = dae.addUnaryExpr(UnaryOp.Negate, v3);
          const negV1 = dae.addUnaryExpr(UnaryOp.Negate, v1);
          const negV2 = dae.addUnaryExpr(UnaryOp.Negate, v2);

          const row1 = dae.addArrayCtorExpr([zero, negV3, v2]);
          const row2 = dae.addArrayCtorExpr([v3, zero, negV1]);
          const row3 = dae.addArrayCtorExpr([negV2, v1, zero]);

          return dae.addArrayCtorExpr([row1, row2, row3]);
        }
      }
    }
  }

  // cross(x, y): 3D Euclidean vector cross product [x2*y3 - x3*y2, x3*y1 - x1*y3, x1*y2 - x2*y1]
  if (fnName === "cross" || cleanFnName === "cross") {
    if (argExprIds.length === 2) {
      let xId = argExprIds[0]!;
      let yId = argExprIds[1]!;
      if (dae.getExprKind(xId) === ExprKind.Name) {
        const vName = dae.interner.resolve(dae.getExprData1(xId));
        if (vName && dae.hasArrayElements(vName)) {
          const ctor = expandVarToArrayCtor(vName, dae);
          if (ctor !== null) xId = ctor;
        }
      }
      if (dae.getExprKind(yId) === ExprKind.Name) {
        const vName = dae.interner.resolve(dae.getExprData1(yId));
        if (vName && dae.hasArrayElements(vName)) {
          const ctor = expandVarToArrayCtor(vName, dae);
          if (ctor !== null) yId = ctor;
        }
      }
      if (dae.getExprKind(xId) === ExprKind.ArrayCtor && dae.getExprKind(yId) === ExprKind.ArrayCtor) {
        const xElems = getArrayCtorElements(xId, dae);
        const yElems = getArrayCtorElements(yId, dae);
        if (xElems.length === 3 && yElems.length === 3) {
          const [x1, x2, x3] = xElems;
          const [y1, y2, y3] = yElems;
          const xv1 = evalDaeExpr(x1!, dae);
          const xv2 = evalDaeExpr(x2!, dae);
          const xv3 = evalDaeExpr(x3!, dae);
          const yv1 = evalDaeExpr(y1!, dae);
          const yv2 = evalDaeExpr(y2!, dae);
          const yv3 = evalDaeExpr(y3!, dae);
          if (
            typeof xv1 === "number" &&
            typeof xv2 === "number" &&
            typeof xv3 === "number" &&
            typeof yv1 === "number" &&
            typeof yv2 === "number" &&
            typeof yv3 === "number"
          ) {
            const z1 = dae.addRealLiteral(xv2 * yv3 - xv3 * yv2);
            const z2 = dae.addRealLiteral(xv3 * yv1 - xv1 * yv3);
            const z3 = dae.addRealLiteral(xv1 * yv2 - xv2 * yv1);
            return dae.addArrayCtorExpr([z1, z2, z3]);
          }
          const cx1 = castToRealExpr(x1!, dae);
          const cx2 = castToRealExpr(x2!, dae);
          const cx3 = castToRealExpr(x3!, dae);
          const cy1 = castToRealExpr(y1!, dae);
          const cy2 = castToRealExpr(y2!, dae);
          const cy3 = castToRealExpr(y3!, dae);
          // z1 = x2 * y3 - x3 * y2
          const term1 = dae.addBinaryExpr(BinOp.Mul, cx2, cy3);
          const term2 = dae.addBinaryExpr(BinOp.Mul, cx3, cy2);
          const z1 = dae.addBinaryExpr(BinOp.Sub, term1, term2);

          // z2 = x3 * y1 - x1 * y3
          const term3 = dae.addBinaryExpr(BinOp.Mul, cx3, cy1);
          const term4 = dae.addBinaryExpr(BinOp.Mul, cx1, cy3);
          const z2 = dae.addBinaryExpr(BinOp.Sub, term3, term4);

          // z3 = x1 * y2 - x2 * y1
          const term5 = dae.addBinaryExpr(BinOp.Mul, cx1, cy2);
          const term6 = dae.addBinaryExpr(BinOp.Mul, cx2, cy1);
          const z3 = dae.addBinaryExpr(BinOp.Sub, term5, term6);

          return dae.addArrayCtorExpr([z1, z2, z3]);
        }
      }
    }
  }

  // outerProduct(v1, v2): matrix M[i, j] = v1[i] * v2[j]
  if (fnName === "outerProduct" || cleanFnName === "outerProduct") {
    if (argExprIds.length === 2) {
      let v1Id = argExprIds[0]!;
      let v2Id = argExprIds[1]!;
      if (dae.getExprKind(v1Id) === ExprKind.Name) {
        const vName = dae.interner.resolve(dae.getExprData1(v1Id));
        if (vName && dae.hasArrayElements(vName)) {
          const ctor = expandVarToArrayCtor(vName, dae);
          if (ctor !== null) v1Id = ctor;
        }
      }
      if (dae.getExprKind(v2Id) === ExprKind.Name) {
        const vName = dae.interner.resolve(dae.getExprData1(v2Id));
        if (vName && dae.hasArrayElements(vName)) {
          const ctor = expandVarToArrayCtor(vName, dae);
          if (ctor !== null) v2Id = ctor;
        }
      }
      if (dae.getExprKind(v1Id) === ExprKind.ArrayCtor && dae.getExprKind(v2Id) === ExprKind.ArrayCtor) {
        const v1Elems = getArrayCtorElements(v1Id, dae);
        const v2Elems = getArrayCtorElements(v2Id, dae);
        const isReal = v1Elems.some((e) => isRealExpr(e, dae)) || v2Elems.some((e) => isRealExpr(e, dae));
        const rows: number[] = [];
        for (const e1 of v1Elems) {
          const cols: number[] = [];
          const val1 = evalDaeExpr(e1, dae);
          const k1 = dae.getExprKind(e1);
          const isLit1 = k1 === ExprKind.IntLiteral || k1 === ExprKind.RealLiteral;
          const c1 = isReal ? castToRealExpr(e1, dae) : e1;
          for (const e2 of v2Elems) {
            const val2 = evalDaeExpr(e2, dae);
            const k2 = dae.getExprKind(e2);
            const isLit2 = k2 === ExprKind.IntLiteral || k2 === ExprKind.RealLiteral;
            if (isLit1 && isLit2 && typeof val1 === "number" && typeof val2 === "number") {
              const prod = val1 * val2;
              cols.push(isReal || !Number.isInteger(prod) ? dae.addRealLiteral(prod) : dae.addIntLiteral(prod));
            } else {
              const c2 = isReal ? castToRealExpr(e2, dae) : e2;
              cols.push(dae.addBinaryExpr(BinOp.Mul, c1, c2));
            }
          }
          const rowCtor = dae.addArrayCtorExpr(cols);
          setExprArrayShape(dae, rowCtor, [cols.length]);
          rows.push(rowCtor);
        }
        const matCtor = dae.addArrayCtorExpr(rows);
        setExprArrayShape(dae, matCtor, [rows.length, v2Elems.length]);
        return matCtor;
      }
    }
  }

  // zeros(n1, n2, ...) / ones(n1, n2, ...): construct nested ArrayCtor when dimensions are static
  if (
    flattener?.explicitArrayMode !== "preserve" &&
    (fnName === "zeros" || cleanFnName === "zeros" || fnName === "ones" || cleanFnName === "ones")
  ) {
    const dimVals: number[] = [];
    let allStatic = true;
    for (let i = 0; i < argExprIds.length; i++) {
      const dv = evalDaeExpr(argExprIds[i]!, dae);
      if (typeof dv === "number" && dv >= 0 && Number.isInteger(dv)) {
        dimVals.push(dv);
      } else {
        allStatic = false;
        break;
      }
    }
    if (allStatic && dimVals.length > 0) {
      const valLit = fnName === "ones" || cleanFnName === "ones" ? dae.addIntLiteral(1) : dae.addRealLiteral(0.0);
      const buildCtor = (dimIdx: number): number => {
        if (dimIdx === dimVals.length) return valLit;
        const size = dimVals[dimIdx]!;
        if (size === 0) return dae.addArrayCtorExpr([]);
        const childElem = buildCtor(dimIdx + 1);
        const elems: number[] = [];
        for (let i = 0; i < size; i++) elems.push(childElem);
        return dae.addArrayCtorExpr(elems);
      };
      const resId = buildCtor(0);
      setExprArrayShape(dae, resId, [...dimVals]);
      return resId;
    }
    if (!allStatic && argExprIds.length > 0) {
      const valLit = fnName === "ones" || cleanFnName === "ones" ? dae.addRealLiteral(1.0) : dae.addRealLiteral(0.0);
      return dae.addCallExpr("fill", [valLit, ...argExprIds]);
    }
  }

  // identity(n): n x n Integer identity matrix with 1 on the main diagonal and 0 elsewhere
  if (
    flattener?.explicitArrayMode !== "preserve" &&
    (fnName === "identity" || cleanFnName === "identity") &&
    argExprIds.length === 1
  ) {
    const nVal = evalDaeExpr(argExprIds[0]!, dae);
    if (typeof nVal === "number" && Number.isInteger(nVal) && nVal >= 0) {
      const n = Math.trunc(nVal);
      const rows: number[] = [];
      for (let r = 0; r < n; r++) {
        const cols: number[] = [];
        for (let c = 0; c < n; c++) {
          cols.push(dae.addIntLiteral(r === c ? 1 : 0));
        }
        rows.push(dae.addArrayCtorExpr(cols));
      }
      return dae.addArrayCtorExpr(rows);
    }
  }

  // diagonal(v): n x n square matrix with vector v placed on the main diagonal
  if (
    flattener?.explicitArrayMode !== "preserve" &&
    (fnName === "diagonal" || cleanFnName === "diagonal") &&
    argExprIds.length === 1
  ) {
    let vArg = argExprIds[0]!;
    if (dae.getExprKind(vArg) === ExprKind.Name) {
      const vName = dae.interner.resolve(dae.getExprData1(vArg));
      if (vName && dae.hasArrayElements(vName)) {
        const elemIndices = dae.getArrayElementIndices(vName);
        const allConstLiterals =
          elemIndices.length > 0 &&
          elemIndices.every((eIdx) => {
            const vExpr = dae.getVarExpression(eIdx);
            if (vExpr === undefined || vExpr < 0) return false;
            const k = dae.getExprKind(vExpr);
            return k === ExprKind.RealLiteral || k === ExprKind.IntLiteral;
          });
        if (allConstLiterals) {
          vArg = dae.addArrayCtorExpr(elemIndices.map((eIdx) => dae.getVarExpression(eIdx) ?? -1));
        } else {
          const ctor = expandVarToArrayCtor(vName, dae);
          if (ctor !== null) vArg = ctor;
        }
      }
    }
    if (dae.getExprKind(vArg) === ExprKind.ArrayCtor) {
      let elems = getArrayCtorElements(vArg, dae);
      if (
        elems.length > 0 &&
        elems.every((el) => {
          if (dae.getExprKind(el) !== ExprKind.Name) return false;
          const nStr = dae.interner.resolve(dae.getExprData1(el));
          if (!nStr) return false;
          const vIdx = dae.lookupVariable(nStr);
          if (vIdx < 0) return false;
          const vExpr = dae.getVarExpression(vIdx);
          if (vExpr === undefined || vExpr < 0) return false;
          const k = dae.getExprKind(vExpr);
          return k === ExprKind.RealLiteral || k === ExprKind.IntLiteral;
        })
      ) {
        elems = elems.map((el) => {
          const nStr = dae.interner.resolve(dae.getExprData1(el))!;
          return dae.getVarExpression(dae.lookupVariable(nStr)) ?? -1;
        });
      }
      const n = elems.length;
      const isReal = elems.some((e) => isRealExpr(e, dae));
      const zeroLit = isReal ? dae.addRealLiteral(0.0) : dae.addIntLiteral(0);
      const rows: number[] = [];
      for (let r = 0; r < n; r++) {
        const cols: number[] = [];
        for (let c = 0; c < n; c++) {
          cols.push(r === c ? elems[r]! : zeroLit);
        }
        rows.push(dae.addArrayCtorExpr(cols));
      }
      return dae.addArrayCtorExpr(rows);
    }
  }

  // linspace(x1, x2, n): generate n linearly spaced points between x1 and x2
  if ((fnName === "linspace" || cleanFnName === "linspace") && argExprIds.length === 3) {
    const [startId, stopId, numId] = argExprIds;
    const numVal = evalDaeExpr(numId!, dae);
    const hasNonFinalParamRef = (id: number): boolean => {
      if (id < 0) return false;
      const k = dae.getExprKind(id);
      if (k === ExprKind.Name) {
        const vName = dae.interner.resolve(dae.getExprData1(id));
        if (vName) {
          let vIdx = dae.getVarIdxByName(vName);
          if (vIdx < 0 && vName.includes("[")) vIdx = dae.getVarIdxByName(vName.split("[")[0]!);
          if (vIdx >= 0 && dae.getVarVariability(vIdx) === Variability.Parameter && !dae.isVarFinal(vIdx)) {
            return true;
          }
        }
        return false;
      }
      if (k === ExprKind.Subscript) return hasNonFinalParamRef(dae.getExprData1(id));
      if (k === ExprKind.Binary) {
        return hasNonFinalParamRef(dae.getExprLeft(id)) || hasNonFinalParamRef(dae.getExprRight(id));
      }
      if (k === ExprKind.Unary || k === ExprKind.Negate) return hasNonFinalParamRef(dae.getExprLeft(id));
      return false;
    };
    const startVal = hasNonFinalParamRef(startId!) ? null : evalDaeExpr(startId!, dae);
    const stopVal = hasNonFinalParamRef(stopId!) ? null : evalDaeExpr(stopId!, dae);
    if (typeof numVal === "number" && numVal > 0 && Number.isInteger(numVal)) {
      const elems: number[] = [];
      if (numVal === 1) {
        elems.push(typeof stopVal === "number" ? dae.addRealLiteral(stopVal) : stopId!);
      } else if (typeof startVal === "number" && typeof stopVal === "number") {
        const step = (stopVal - startVal) / (numVal - 1);
        for (let i = 0; i < numVal; i++) {
          elems.push(dae.addRealLiteral(startVal + i * step));
        }
      } else {
        const cStart = castToRealExpr(startId!, dae);
        const cStop = castToRealExpr(stopId!, dae);
        const diff = startVal === 0 ? cStop : dae.addBinaryExpr(BinOp.Sub, cStop, cStart);
        for (let i = 0; i < numVal; i++) {
          if (i === 0) {
            elems.push(cStart);
          } else {
            const frac = i / (numVal - 1);
            const scaled = frac === 1 ? diff : dae.addBinaryExpr(BinOp.Mul, diff, dae.addRealLiteral(frac));
            elems.push(startVal === 0 ? scaled : dae.addBinaryExpr(BinOp.Add, cStart, scaled));
          }
        }
      }
      return dae.addArrayCtorExpr(elems);
    } else {
      const state = getFlatteningState(dae);
      state.linspaceCounter = (state.linspaceCounter ?? 0) + 1;
      if (dae.extensionMetadata?.["isOldFrontend"] && state.tmpVarCounter === undefined) {
        state.tmpVarCounter = 4;
      }
      const iterVar = dae.extensionMetadata?.["isOldFrontend"] ? "i" : `$i_linspace_${state.linspaceCounter}`;
      const iMinus1 = dae.addBinaryExpr(BinOp.Add, dae.addIntLiteral(-1), dae.addNameExpr(iterVar));
      const iCast = dae.addCallExpr("/*Real*/", [iMinus1]);
      const nMinus1 = dae.addBinaryExpr(BinOp.Add, dae.addIntLiteral(-1), numId!);
      const nCast = dae.addCallExpr("/*Real*/", [nMinus1]);
      const frac = dae.addBinaryExpr(BinOp.Div, iCast, nCast);

      let bodyId = frac;
      if (startVal === 0 && stopVal === 1) {
        bodyId = frac;
      } else {
        const diff = dae.addBinaryExpr(BinOp.Sub, stopId!, startId!);
        const scaled = dae.addBinaryExpr(BinOp.Mul, diff, frac);
        bodyId = dae.addBinaryExpr(BinOp.Add, startId!, scaled);
      }
      const rangeId = dae.addRangeExpr(dae.addIntLiteral(1), numId!);
      return dae.addComprehensionExpr("array", bodyId, [{ name: iterVar, rangeId }]);
    }
  }

  // fill(s, n1, n2, ...): replicate scalar/array expression s across dimensions n1 x n2 x ...
  if ((fnName === "fill" || cleanFnName === "fill") && argExprIds.length >= 2) {
    const dimVals: number[] = [];
    let allStatic = true;
    for (let i = 1; i < argExprIds.length; i++) {
      if (dae.getExprKind(argExprIds[i]!) === ExprKind.RealLiteral) {
        const rv = dae.getExprRealValue(argExprIds[i]!);
        const rvStr = Number.isInteger(rv) ? rv.toFixed(1) : String(rv);
        const scopeName =
          (flattener?.currentRootClassId && db ? db.symbol(flattener.currentRootClassId)?.name : "") || dae.name || "";
        const callStr = `${cleanFnName}(${argExprIds
          .map((a) => {
            if (dae.getExprKind(a) === ExprKind.RealLiteral) {
              const v = dae.getExprRealValue(a);
              return Number.isInteger(v) ? v.toFixed(1) : String(v);
            }
            if (dae.getExprKind(a) === ExprKind.IntLiteral) return String(dae.getExprData1(a));
            return "?";
          })
          .join(", ")})`;
        dae.diagnostics.push({
          severity: "error",
          code: ModelicaErrorCode.TYPE_MISMATCH_MODIFIER.code,
          message: `Internal error - Types.matchTypes failed for ${rvStr} from Real to Integer`,
        });
        dae.diagnostics.push({
          severity: "error",
          code: ModelicaErrorCode.TYPE_MISMATCH_MODIFIER.code,
          message: `Internal error Static.elabBuiltinFill failed in component<NO COMPONENT> and scope: ${scopeName} for expression: ${callStr}`,
          range:
            node.startIndex != null && node.endIndex != null
              ? {
                  startOffset: node.startIndex,
                  endOffset: node.endIndex,
                  startPosition: node.startPosition,
                  endPosition: node.endPosition,
                }
              : undefined,
        });
        return -1;
      }
      const dv = evalDaeExpr(argExprIds[i]!, dae);
      if (typeof dv === "number" && dv >= 0 && Number.isInteger(dv)) {
        dimVals.push(dv);
      } else {
        allStatic = false;
        break;
      }
    }
    if (allStatic && dimVals.length > 0 && flattener?.explicitArrayMode !== "preserve") {
      const buildFillCtor = (dimIdx: number): number => {
        if (dimIdx === dimVals.length) return argExprIds[0]!;
        const size = dimVals[dimIdx]!;
        if (size === 0) return dae.addArrayCtorExpr([]);
        const childElem = buildFillCtor(dimIdx + 1);
        const elems: number[] = [];
        for (let i = 0; i < size; i++) elems.push(childElem);
        return dae.addArrayCtorExpr(elems);
      };
      return buildFillCtor(0);
    }
  }

  // sum(A) / product(A): reduce array elements via addition/multiplication, returning identity (0 or 1) for empty arrays
  if (fnName === "sum" || cleanFnName === "sum" || fnName === "product" || cleanFnName === "product") {
    if (argExprIds.length === 1) {
      let arrArg = argExprIds[0]!;
      if (dae.getExprKind(arrArg) === ExprKind.Name) {
        const vName = dae.interner.resolve(dae.getExprData1(arrArg));
        if (vName) {
          const arrShape = getNamedArrayShape(dae, vName);
          if (arrShape && arrShape.some((d) => d === 0)) {
            const vType = getFlatteningState(dae).namedArrayTypes?.get(vName);
            const isInt = vType === VarType.Integer;
            const isSum = fnName === "sum" || cleanFnName === "sum";
            return isSum
              ? isInt
                ? dae.addIntLiteral(0)
                : dae.addRealLiteral(0.0)
              : isInt
                ? dae.addIntLiteral(1)
                : dae.addRealLiteral(1.0);
          }
          if (dae.hasArrayElements(vName)) {
            const ctor = expandVarToArrayCtor(vName, dae);
            if (ctor !== null) arrArg = ctor;
          } else {
            const expanded = expandDottedArrayMemberRef(
              vName,
              prefix ?? "",
              dae,
              db ?? flattener?.db,
              flattener?.currentClassId,
              flattener?.currentRootClassId,
            );
            if (expanded.ctorId !== null) arrArg = expanded.ctorId;
          }
        }
      }
      if (dae.getExprKind(arrArg) === ExprKind.ArrayCtor) {
        const isSum = fnName === "sum" || cleanFnName === "sum";
        const rawElems = getArrayCtorElements(arrArg, dae);
        const flattenElements = (elemId: number): number[] => {
          if (dae.getExprKind(elemId) === ExprKind.ArrayCtor) {
            const sub = getArrayCtorElements(elemId, dae);
            if (!isSum && sub.length > 0 && dae.getExprKind(sub[0]!) === ExprKind.ArrayCtor) {
              return [...sub].reverse().flatMap(flattenElements);
            }
            return sub.flatMap(flattenElements);
          }
          return [elemId];
        };
        const elems = rawElems.flatMap(flattenElements);
        const op = isSum ? BinOp.Add : BinOp.Mul;
        if (elems.length === 0) {
          const argType = inferArenaExprVarType(dae, arrArg);
          const isInt = argType === VarType.Integer;
          return isSum
            ? isInt
              ? dae.addIntLiteral(0)
              : dae.addRealLiteral(0.0)
            : isInt
              ? dae.addIntLiteral(1)
              : dae.addRealLiteral(1.0);
        }
        const allLiterals =
          elems.length > 0 &&
          elems.every((el) => {
            const k = dae.getExprKind(el);
            return k === ExprKind.IntLiteral || k === ExprKind.RealLiteral;
          });
        if (allLiterals) {
          let isReal = false;
          let constVal = isSum ? 0 : 1;
          for (const el of elems) {
            const v = evalDaeExpr(el, dae);
            if (typeof v === "number") {
              if (!Number.isInteger(v) || dae.getExprKind(el) === ExprKind.RealLiteral) {
                isReal = true;
              }
              if (isSum) constVal += v;
              else constVal *= v;
            }
          }
          return isReal ? dae.addRealLiteral(constVal) : dae.addIntLiteral(constVal);
        }
        let res = elems[0]!;
        for (let i = 1; i < elems.length; i++) {
          res = dae.addBinaryExpr(op, res, elems[i]!);
        }
        return res;
      }
    }
  }

  // min(x, y) / max(x, y) and array reductions min(A) / max(A) (including empty-array identity bounds)
  if (fnName === "min" || cleanFnName === "min" || fnName === "max" || cleanFnName === "max") {
    const isMax = fnName === "max" || cleanFnName === "max";
    const redFn = isMax ? "max" : "min";
    if (argExprIds.length === 2) {
      let a0 = argExprIds[0]!;
      let a1 = argExprIds[1]!;
      const k0 = dae.getExprKind(a0);
      const k1 = dae.getExprKind(a1);
      if (k0 === ExprKind.BoolLiteral && k1 === ExprKind.BoolLiteral) {
        const v0 = dae.getExprData1(a0) !== 0;
        const v1 = dae.getExprData1(a1) !== 0;
        return dae.addBoolLiteral(isMax ? v0 || v1 : v0 && v1);
      }
      if (k0 === ExprKind.EnumLiteral && k1 === ExprKind.EnumLiteral) {
        const v0 = dae.getExprData1(a0);
        const v1 = dae.getExprData1(a1);
        return isMax ? (v0 >= v1 ? a0 : a1) : v0 <= v1 ? a0 : a1;
      }
      if (
        (k0 === ExprKind.IntLiteral || k0 === ExprKind.RealLiteral) &&
        (k1 === ExprKind.IntLiteral || k1 === ExprKind.RealLiteral)
      ) {
        const v0 = evalDaeExpr(a0, dae);
        const v1 = evalDaeExpr(a1, dae);
        if (typeof v0 === "number" && typeof v1 === "number") {
          const resVal = isMax ? Math.max(v0, v1) : Math.min(v0, v1);
          const isReal = k0 === ExprKind.RealLiteral || k1 === ExprKind.RealLiteral || !Number.isInteger(resVal);
          return isReal ? dae.addRealLiteral(resVal) : dae.addIntLiteral(resVal);
        }
      }
      const r0 = isRealExpr(a0, dae);
      const r1 = isRealExpr(a1, dae);
      if (r0 && !r1) a1 = castToRealExpr(a1, dae);
      else if (r1 && !r0) a0 = castToRealExpr(a0, dae);
      return dae.addCallExpr(redFn, [a0, a1]);
    }
    if (argExprIds.length === 1) {
      let arrArg = argExprIds[0]!;
      const origIsArrayCtor = dae.getExprKind(arrArg) === ExprKind.ArrayCtor;
      const shouldScalarizeOrExpand =
        origIsArrayCtor ||
        !flattener?.options?.omcCompatibility ||
        Boolean(dae.extensionMetadata?.["scalarizeMinMax"]) ||
        Boolean(flattener?.options?.scalarizeMinMax);
      if (dae.getExprKind(arrArg) === ExprKind.Name) {
        const vName = dae.interner.resolve(dae.getExprData1(arrArg));
        if (vName) {
          const arrShape = getNamedArrayShape(dae, vName);
          if (arrShape && arrShape.some((d) => d === 0)) {
            const fState = getFlatteningState(dae);
            const vType = fState.namedArrayTypes?.get(vName);
            if (vType === VarType.Boolean) {
              return dae.addBoolLiteral(!isMax);
            }
            if (vType === VarType.Integer) {
              return dae.addExpression(
                ExprKind.Name,
                dae.interner.intern(isMax ? "-4611686018427387903" : "4611686018427387903"),
              );
            }
            if (vType === VarType.Real) {
              return dae.addRealLiteral(isMax ? -8.777798510069901e304 : 8.777798510069901e304);
            }
            if (vType === VarType.Enumeration) {
              const enumInfo = asStateExt(fState).namedArrayEnumInfo?.get(vName);
              if (enumInfo && enumInfo.literals.length > 0) {
                let typePath = enumInfo.qual;
                if (!dae.extensionMetadata?.["isOldFrontend"]) {
                  const rootClassId = flattener?.currentRootClassId ?? fState.currentRootClassId;
                  const rootName = rootClassId ? db?.symbol(rootClassId)?.name : "";
                  if (rootName && typePath.startsWith(`${rootName}.`)) {
                    typePath = typePath.slice(rootName.length + 1);
                  }
                }
                const litName = isMax ? enumInfo.literals[0]! : enumInfo.literals[enumInfo.literals.length - 1]!;
                const ord = isMax ? 1 : enumInfo.literals.length;
                return dae.addEnumLiteral(ord, `${typePath}.${litName}`);
              }
            }
          }
          if (dae.hasArrayElements(vName)) {
            const elemIndices = dae.getArrayElementIndices(vName);
            const isEnumOrBoolArray =
              elemIndices.length > 0 &&
              elemIndices.every((eIdx) => {
                const vExpr = dae.getVarExpression(eIdx);
                if (vExpr === undefined || vExpr < 0) return false;
                const k = dae.getExprKind(vExpr);
                return k === ExprKind.EnumLiteral || k === ExprKind.BoolLiteral;
              });
            if (isEnumOrBoolArray) {
              arrArg = dae.addArrayCtorExpr(elemIndices.map((eIdx) => dae.getVarExpression(eIdx) ?? -1));
            } else if (shouldScalarizeOrExpand) {
              const ctor = expandVarToArrayCtor(vName, dae);
              if (ctor !== null) arrArg = ctor;
            }
          }
        }
      }
      if (dae.getExprKind(arrArg) === ExprKind.ArrayCtor) {
        const rawElems = getArrayCtorElements(arrArg, dae);
        const flattenElements = (elemId: number): number[] => {
          if (dae.getExprKind(elemId) === ExprKind.ArrayCtor) {
            const sub = getArrayCtorElements(elemId, dae);
            return sub.flatMap(flattenElements);
          }
          return [elemId];
        };
        let elems = rawElems.flatMap(flattenElements);
        if (
          elems.length > 0 &&
          elems.every((el) => {
            if (dae.getExprKind(el) !== ExprKind.Name) return false;
            const nStr = dae.interner.resolve(dae.getExprData1(el));
            if (!nStr) return false;
            const vIdx = dae.lookupVariable(nStr);
            if (vIdx < 0) return false;
            const vExpr = dae.getVarExpression(vIdx);
            if (vExpr === undefined || vExpr < 0) return false;
            const k = dae.getExprKind(vExpr);
            return k === ExprKind.EnumLiteral || k === ExprKind.BoolLiteral;
          })
        ) {
          elems = elems.map((el) => {
            const nStr = dae.interner.resolve(dae.getExprData1(el))!;
            return dae.getVarExpression(dae.lookupVariable(nStr)) ?? -1;
          });
        }
        if (elems.length === 1 && origIsArrayCtor) {
          return elems[0]!;
        }
        if (elems.length > 0) {
          if (elems.every((el) => dae.getExprKind(el) === ExprKind.BoolLiteral)) {
            const boolVals = elems.map((el) => dae.getExprData1(el) !== 0);
            return dae.addBoolLiteral(isMax ? boolVals.some(Boolean) : boolVals.every(Boolean));
          }
          if (elems.every((el) => dae.getExprKind(el) === ExprKind.EnumLiteral)) {
            return elems.reduce((best, cur) => {
              const bVal = dae.getExprData1(best);
              const cVal = dae.getExprData1(cur);
              return isMax ? (cVal > bVal ? cur : best) : cVal < bVal ? cur : best;
            });
          }
          const allLiterals = elems.every((el) => {
            const k = dae.getExprKind(el);
            return k === ExprKind.IntLiteral || k === ExprKind.RealLiteral;
          });
          if (allLiterals) {
            let isReal = false;
            const vals: number[] = [];
            for (const el of elems) {
              const v = evalDaeExpr(el, dae);
              if (typeof v === "number") {
                if (!Number.isInteger(v) || dae.getExprKind(el) === ExprKind.RealLiteral) {
                  isReal = true;
                }
                vals.push(v);
              }
            }
            if (vals.length === elems.length) {
              const constVal = isMax ? Math.max(...vals) : Math.min(...vals);
              return isReal ? dae.addRealLiteral(constVal) : dae.addIntLiteral(constVal);
            }
          }
          if (shouldScalarizeOrExpand) {
            const hasReal = elems.some((el) => isRealExpr(el, dae));
            const coercedElems = hasReal ? elems.map((el) => castToRealExpr(el, dae)) : elems;
            if (coercedElems.length === 1) return coercedElems[0]!;
            let res = coercedElems[coercedElems.length - 1]!;
            for (let i = coercedElems.length - 2; i >= 0; i--) {
              res = dae.addCallExpr(redFn, [coercedElems[i]!, res]);
            }
            return res;
          }
        }
      }
    }
  }

  // semiLinear(x, positiveSlope, negativeSlope): piecewise-linear operator vectorized across arrays
  if ((fnName === "semiLinear" || cleanFnName === "semiLinear") && argExprIds.length + namedArgs.size === 3) {
    const xArgId = argExprIds[0] ?? namedArgs.get("x");
    const posArgId = argExprIds[1] ?? namedArgs.get("positiveSlope");
    const negArgId = argExprIds[2] ?? namedArgs.get("negativeSlope");
    if (xArgId !== undefined && posArgId !== undefined && negArgId !== undefined) {
      const expandIfArray = (id: number): number => {
        if (dae.getExprKind(id) === ExprKind.Name) {
          const vName = dae.interner.resolve(dae.getExprData1(id));
          if (vName && dae.hasArrayElements(vName)) {
            const ctor = expandVarToArrayCtor(vName, dae);
            if (ctor !== null) return ctor;
          }
        }
        return id;
      };
      const buildSemiLinear = (xId: number, kPosId: number, kNegId: number): number => {
        const xExp = expandIfArray(xId);
        const pExp = expandIfArray(kPosId);
        const nExp = expandIfArray(kNegId);
        if (dae.getExprKind(xExp) === ExprKind.ArrayCtor) {
          const xElems = getArrayCtorElements(xExp, dae);
          const pElems = dae.getExprKind(pExp) === ExprKind.ArrayCtor ? getArrayCtorElements(pExp, dae) : null;
          const nElems = dae.getExprKind(nExp) === ExprKind.ArrayCtor ? getArrayCtorElements(nExp, dae) : null;
          const mapped = xElems.map((xe, idx) =>
            buildSemiLinear(xe, pElems ? (pElems[idx] ?? pExp) : pExp, nElems ? (nElems[idx] ?? nExp) : nExp),
          );
          const ctor = dae.addArrayCtorExpr(mapped);
          const dims = getExprDims(xExp, dae, db);
          if (dims) {
            setExprArrayShape(dae, ctor, dims);
          }
          return ctor;
        }
        return dae.addCallExpr("semiLinear", [
          castToRealExpr(xId, dae),
          castToRealExpr(kPosId, dae),
          castToRealExpr(kNegId, dae),
        ]);
      };
      return buildSemiLinear(xArgId, posArgId, negArgId);
    }
  }

  // homotopy(actual, simplified): nonlinear initialization continuation operator vectorized across arrays
  if ((fnName === "homotopy" || cleanFnName === "homotopy") && argExprIds.length + namedArgs.size === 2) {
    const actArgId = argExprIds[0] ?? namedArgs.get("actual");
    const simpArgId = argExprIds[1] ?? namedArgs.get("simplified");
    if (actArgId !== undefined && simpArgId !== undefined) {
      const expandIfArray = (id: number): number => {
        if (dae.getExprKind(id) === ExprKind.Name) {
          const vName = dae.interner.resolve(dae.getExprData1(id));
          if (vName && dae.hasArrayElements(vName)) {
            const ctor = expandVarToArrayCtor(vName, dae);
            if (ctor !== null) return ctor;
          }
        }
        return id;
      };
      const buildHomotopy = (actId: number, simpId: number): number => {
        const aExp = expandIfArray(actId);
        const sExp = expandIfArray(simpId);
        if (dae.getExprKind(aExp) === ExprKind.ArrayCtor && dae.getExprKind(sExp) === ExprKind.ArrayCtor) {
          const aElems = getArrayCtorElements(aExp, dae);
          const sElems = getArrayCtorElements(sExp, dae);
          if (aElems.length === sElems.length) {
            const mapped = aElems.map((ae, idx) => buildHomotopy(ae, sElems[idx]!));
            const ctor = dae.addArrayCtorExpr(mapped);
            const dims = getExprDims(aExp, dae, db);
            if (dims) {
              setExprArrayShape(dae, ctor, dims);
            }
            return ctor;
          }
        }
        const aCast = castToRealExpr(actId, dae);
        const sCast = castToRealExpr(simpId, dae);
        const callId = dae.addCallExpr("homotopy", [aCast, sCast]);
        const dims = getExprDims(actId, dae, db) ?? getExprDims(simpId, dae, db);
        if (dims) {
          setExprArrayShape(dae, callId, dims);
        }
        return callId;
      };
      return buildHomotopy(actArgId, simpArgId);
    }
  }

  // Overconstrained connection graph operators: Connections.isRoot, Connections.rooted, Connections.uniqueRootIndices
  if ((fnName === "Connections.isRoot" || cleanFnName === "isRoot") && argExprIds.length === 1) {
    const a0 = argExprIds[0]!;
    if (dae.getExprKind(a0) === ExprKind.Name) {
      const connName = dae.interner.resolve(dae.getExprData1(a0));
      if (connName) {
        if (!dae.extensionMetadata) dae.extensionMetadata = {};
        if (!dae.extensionMetadata["overconstrainedGraph"]) {
          dae.extensionMetadata["overconstrainedGraph"] = {
            roots: new Set<string>(),
            potentialRoots: new Map<string, number>(),
            branches: [] as { a: string; b: string }[],
            queriedRoots: new Set<string>(),
          };
        }
        dae.extensionMetadata["overconstrainedGraph"].queriedRoots?.add(connName);
        const graph = dae.extensionMetadata["overconstrainedGraph"] as OverconstrainedGraphExt;
        if (graph.selectedRoots instanceof Set) {
          return dae.addBoolLiteral(graph.selectedRoots.has(connName));
        }
        if (graph.roots instanceof Set && graph.roots.has(connName)) {
          return dae.addBoolLiteral(true);
        }
      }
    }
    return dae.addCallExpr("Connections.isRoot", [a0]);
  }

  if ((fnName === "Connections.rooted" || fnName === "rooted" || cleanFnName === "rooted") && argExprIds.length === 1) {
    const a0 = argExprIds[0]!;
    if (dae.getExprKind(a0) === ExprKind.Name) {
      const connName = dae.interner.resolve(dae.getExprData1(a0));
      if (connName) {
        if (!dae.extensionMetadata) dae.extensionMetadata = {};
        if (!dae.extensionMetadata["overconstrainedGraph"]) {
          dae.extensionMetadata["overconstrainedGraph"] = {
            roots: new Set<string>(),
            potentialRoots: new Map<string, number>(),
            branches: [] as { a: string; b: string }[],
            queriedRoots: new Set<string>(),
          };
        }
        const graph = dae.extensionMetadata["overconstrainedGraph"] as OverconstrainedGraphExt;
        if (graph.rootedMap instanceof Map && graph.rootedMap.has(connName)) {
          return dae.addBoolLiteral(graph.rootedMap.get(connName)!);
        }
      }
    }
    return dae.addCallExpr("Connections.rooted", [a0]);
  }

  if ((fnName === "Connections.uniqueRootIndices" || cleanFnName === "uniqueRootIndices") && argExprIds.length >= 2) {
    const nodesDims = getExprDims(argExprIds[1]!, dae, db);
    if (nodesDims && nodesDims.length === 1 && nodesDims[0] === 1) {
      const ctor = dae.addArrayCtorExpr([dae.addIntLiteral(1)]);
      setExprArrayShape(dae, ctor, [1]);
      return ctor;
    }
    const callId = dae.addCallExpr("Connections.uniqueRootIndices", argExprIds);
    if (nodesDims && nodesDims.length > 0) {
      setExprArrayShape(dae, callId, [nodesDims[0]!]);
    }
    return callId;
  }

  // scalar(A): extract the single scalar element from an array where all dimensions equal 1
  if (fnName === "scalar" || cleanFnName === "scalar") {
    if (argExprIds.length === 1) {
      let curr = argExprIds[0]!;
      if (dae.getExprKind(curr) === ExprKind.Name) {
        const vName = dae.interner.resolve(dae.getExprData1(curr));
        if (vName && dae.hasArrayElements(vName)) {
          const ctor = expandVarToArrayCtor(vName, dae);
          if (ctor !== null) curr = ctor;
        }
      }
      while (dae.getExprKind(curr) === ExprKind.ArrayCtor) {
        const elems = getArrayCtorElements(curr, dae);
        if (elems.length === 1) {
          curr = elems[0]!;
        } else {
          break;
        }
      }
      if (dae.getExprKind(curr) === ExprKind.Call) {
        const innerFn = dae.interner.resolve(dae.getExprData1(curr));
        const innerArgCount = dae.getExprRight(curr);
        if (innerFn === "size" && innerArgCount === 1) {
          const innerArr = dae.getExprLeft(curr);
          return dae.addCallExpr("size", [innerArr, dae.addIntLiteral(1)]);
        }
      }
      return curr;
    }
  }

  // ndims(A): return the number of array dimensions (rank) of A as an Integer literal
  if (fnName === "ndims" || cleanFnName === "ndims") {
    if (argExprIds.length >= 1) {
      const arrId = argExprIds[0]!;
      const dims = getExprDims(arrId, dae, db);
      if (dims && dims.length > 0) {
        return dae.addIntLiteral(dims.length);
      }
    }
  }

  // size(A) / size(A, dim): validate arguments and fold static array shape or dimension size
  if (fnName === "size" || cleanFnName === "size") {
    let eqNode: SyntaxNode | null | undefined = node;
    while (
      eqNode &&
      eqNode.type !== "simple_equation" &&
      eqNode.type !== "component_clause" &&
      eqNode.type !== "statement" &&
      eqNode.type !== "assignment_statement"
    ) {
      eqNode = eqNode.parent;
    }
    const diagNode = eqNode ?? node;
    const startB = diagNode?.startIndex ?? diagNode?.startOffset;
    const endB = diagNode?.endIndex ?? diagNode?.endOffset;
    const range =
      startB != null && endB != null
        ? {
            startOffset: startB,
            endOffset: endB,
            startPosition: diagNode?.startPosition,
            endPosition: diagNode?.endPosition,
          }
        : undefined;

    // 1. Check named arguments (size has no named parameters, e.g. dim)
    if (namedArgs && namedArgs.size > 0) {
      const firstParam = namedArgs.keys().next().value ?? "";
      dae.diagnostics.push({
        severity: "error",
        code: ModelicaErrorCode.FUNCTION_NO_NAMED_PARAMETER.code,
        message: ModelicaErrorCode.FUNCTION_NO_NAMED_PARAMETER.message("size", firstParam),
        range,
      });
      return -1;
    }

    // 2. Check total argument count: size allows 1 or 2 positional arguments
    if (argExprIds.length > 2 || argExprIds.length === 0) {
      const callText = node.text?.trim() ?? "size(...)";
      const candidatesText = "  size(Any[:, ...]) => Integer[:]\n  size(Any[:, ...], Integer) => Integer";
      dae.diagnostics.push({
        severity: "error",
        code: ModelicaErrorCode.NO_MATCHING_OPERATOR_FUNCTION.code,
        message: ModelicaErrorCode.NO_MATCHING_OPERATOR_FUNCTION.message(callText, candidatesText),
        range,
      });
      return -1;
    }

    const arrId = argExprIds[0]!;

    // 3. Check first argument: must be an array expression
    const firstArgKind = dae.getExprKind(arrId);
    let isDefinitelyNotArray = false;
    if (
      firstArgKind === ExprKind.StringLiteral ||
      firstArgKind === ExprKind.RealLiteral ||
      firstArgKind === ExprKind.IntLiteral ||
      firstArgKind === ExprKind.BoolLiteral
    ) {
      isDefinitelyNotArray = true;
    } else if (firstArgKind === ExprKind.Name) {
      const vName = dae.interner.resolve(dae.getExprData1(arrId));
      if (vName) {
        const vIdx = dae.lookupVariable(vName);
        if (vIdx >= 0) {
          const s = dae.getVarShape(vIdx);
          if ((!s || s.length === 0) && !dae.hasArrayElements(vName)) {
            isDefinitelyNotArray = true;
          }
        }
      }
    } else if (firstArgKind === ExprKind.Subscript) {
      const dims = getExprDims(arrId, dae, db);
      if (!dims || dims.length === 0) {
        isDefinitelyNotArray = true;
      }
    }

    if (isDefinitelyNotArray) {
      const argText =
        flattener?.options?.isOldFrontend && firstArgKind === ExprKind.Name
          ? dae.interner.resolve(dae.getExprData1(arrId)) || undefined
          : undefined;
      dae.diagnostics.push({
        severity: "error",
        code: ModelicaErrorCode.SIZE_FIRST_ARG_NOT_ARRAY.code,
        message: ModelicaErrorCode.SIZE_FIRST_ARG_NOT_ARRAY.message(argText),
        range,
      });
      return -1;
    }

    // 1. Check type of 2nd argument (dim)
    if (argExprIds.length >= 2) {
      const aid1 = argExprIds[1]!;
      const t1 = inferArenaExprVarType(dae, aid1);
      if (t1 !== null && t1 !== VarType.Integer) {
        const actualType = varTypeName(t1);
        const argText = argNodes[1]?.text?.trim() ?? "...";
        const callText = `size (dim=${argText})`;
        dae.diagnostics.push({
          severity: "error",
          code: ModelicaErrorCode.FUNCTION_ARG_TYPE_MISMATCH.code,
          message: ModelicaErrorCode.FUNCTION_ARG_TYPE_MISMATCH.message(callText, "2", actualType, "Integer"),
          range,
        });
        return -1;
      }
    }

    if (argExprIds.length >= 2) {
      const aid1 = argExprIds[1]!;
      let vIdx = -1;
      if (dae.getExprKind(aid1) === ExprKind.Name) {
        const vName = dae.interner.resolve(dae.getExprData1(aid1));
        vIdx = vName ? dae.lookupVariable(vName) : -1;
      }
      if (
        vIdx >= 0 &&
        dae.getVarVariability(vIdx) !== Variability.Parameter &&
        dae.getVarVariability(vIdx) !== Variability.Constant
      ) {
        let cur: SyntaxNode | null | undefined = node;
        let inDim = false;
        while (cur) {
          if (
            cur.type === "array_subscripts" &&
            cur.parent &&
            (cur.parent.type === "component_declaration" || cur.parent.type === "component_clause")
          ) {
            inDim = true;
            break;
          }
          cur = cur.parent;
        }
        if (inDim) {
          let cl: SyntaxNode | null | undefined = node;
          while (cl && cl.type !== "component_clause" && cl.type !== "simple_equation") cl = cl.parent;
          const diagRange = getElementDiagRange(cl ?? node);
          const callText = node.text?.trim() ?? "size(...)";
          dae.diagnostics.push({
            severity: "error",
            code: ModelicaErrorCode.DIMENSION_NOT_PARAMETER.code,
            message: `Dimensions must be parameter or constant expression (in ${callText}).`,
            range: diagRange,
          });
          return -1;
        }
      }
    }

    let dims = getExprDims(arrId, dae, db);
    if (!dims || dims.length === 0) {
      const arrKind = dae.getExprKind(arrId);
      if (arrKind === ExprKind.Name) {
        const name = dae.interner.resolve(dae.getExprData1(arrId));
        if (name) {
          const namedShape =
            getNamedArrayShape(dae, name) ?? getNamedArrayShape(dae, resolveScopedName(name, prefix, dae));
          if (namedShape && namedShape.length > 0) {
            dims = namedShape;
          } else {
            const vIdx = dae.lookupVariable(name);
            if (vIdx >= 0) {
              const shape = dae.getVarShape(vIdx);
              if (shape && shape.length > 0) dims = shape;
            }
          }
        }
      } else if (arrKind === ExprKind.ArrayCtor) {
        dims = [dae.getExprData1(arrId)];
      }
    }

    if (dims && dims.length > 0 && argExprIds.length >= 2) {
      const dVal = evalDaeExpr(argExprIds[1]!, dae);
      if (typeof dVal === "number") {
        const dimIdx = Math.trunc(dVal);
        if (dimIdx < 1 || dimIdx > dims.length) {
          const arrName = argNodes[0]?.text?.trim() ?? dae.interner.resolve(dae.getExprData1(arrId)) ?? "array";
          dae.diagnostics.push({
            severity: "error",
            code: ModelicaErrorCode.INVALID_SIZE_INDEX.code,
            message: ModelicaErrorCode.INVALID_SIZE_INDEX.message(dimIdx, arrName, dims.length),
            range,
          });
          return -1;
        }
      }
    }

    let dimArgIsNonFinalParam = false;
    if (argExprIds.length >= 2 && dae.getExprKind(argExprIds[1]!) === ExprKind.Name) {
      let curAnc: SyntaxNode | null | undefined = node;
      let isInsideArraySubscripts = false;
      while (curAnc) {
        if (
          curAnc.type === "array_subscripts" &&
          curAnc.parent &&
          (curAnc.parent.type === "component_declaration" || curAnc.parent.type === "component_clause")
        ) {
          isInsideArraySubscripts = true;
          break;
        }
        curAnc = curAnc.parent;
      }
      if (!isInsideArraySubscripts) {
        const dName = dae.interner.resolve(dae.getExprData1(argExprIds[1]!));
        if (dName) {
          const scopedDName = resolveScopedName(dName, prefix, dae);
          const vIdx =
            dae.getVarIdxByName(scopedDName) >= 0 ? dae.getVarIdxByName(scopedDName) : dae.getVarIdxByName(dName);
          if (vIdx >= 0 && dae.getVarVariability(vIdx) === Variability.Parameter && !dae.isVarFinal(vIdx)) {
            dimArgIsNonFinalParam = true;
          } else if (vIdx < 0 && db) {
            const curScopeId = asStateExt(state).currentScopeId;
            const dSym =
              (curScopeId !== undefined
                ? (db.query<(n: string) => SymbolEntry | null>("resolveName", curScopeId)?.(dName) ??
                  db.childrenOf(curScopeId).find((c) => c.name === dName))
                : null) ?? db.byName(dName)?.find((c) => c.kind === "Component");
            if (dSym && dSym.kind === "Component") {
              const dVar =
                (dSym.metadata as SymbolMetaLike | undefined)?.variability ??
                db.query<string | null>("variability", dSym.id);
              const dFinal = Boolean(
                (dSym.metadata as SymbolMetaLike | undefined)?.isFinal || db.query<boolean>("isFinal", dSym.id),
              );
              if (dVar === "parameter" && !dFinal) {
                dimArgIsNonFinalParam = true;
              }
            }
          }
        }
      }
    }

    if (dims && dims.length > 0 && !dimArgIsNonFinalParam) {
      if (argExprIds.length === 1 && dims.every((d) => d >= 0)) {
        return dae.addArrayCtorExpr(dims.map((d) => dae.addIntLiteral(d)));
      }
      if (argExprIds.length >= 2) {
        const dVal = evalDaeExpr(argExprIds[1]!, dae);
        if (typeof dVal === "number") {
          const dimIdx = Math.trunc(dVal);
          if (dimIdx >= 1 && dimIdx <= dims.length) {
            const d = dims[dimIdx - 1]!;
            if (d >= 0) {
              return dae.addIntLiteral(d);
            }
          }
        }
      }
    }

    let dim = 1;
    if (argExprIds.length >= 2) {
      const dVal = !dimArgIsNonFinalParam ? evalDaeExpr(argExprIds[1]!, dae) : null;
      if (typeof dVal === "number") dim = Math.trunc(dVal);
      else dim = -1;
    }

    const arrKind = dae.getExprKind(arrId);
    if (arrKind === ExprKind.ArrayCtor) {
      if (dim === 1 && argExprIds.length >= 2 && !dimArgIsNonFinalParam) {
        return dae.addIntLiteral(dae.getExprData1(arrId));
      }
    } else if (arrKind === ExprKind.Name) {
      const name = dae.interner.resolve(dae.getExprData1(arrId));
      if (name) {
        const namedShape =
          getNamedArrayShape(dae, name) ?? getNamedArrayShape(dae, resolveScopedName(name, prefix, dae));
        if (namedShape && namedShape.length > 0) {
          if (argExprIds.length === 1 && namedShape.every((d: number) => d >= 0)) {
            return dae.addArrayCtorExpr(namedShape.map((d: number) => dae.addIntLiteral(d)));
          }
          if (namedShape.length >= dim && namedShape[dim - 1]! >= 0) {
            return dae.addIntLiteral(namedShape[dim - 1]!);
          }
        }
        const vIdx = dae.lookupVariable(name);
        if (vIdx >= 0) {
          const shape = dae.getVarShape(vIdx);
          if (shape && shape.length > 0) {
            if (argExprIds.length === 1 && shape.every((d: number) => d >= 0)) {
              return dae.addArrayCtorExpr(shape.map((d: number) => dae.addIntLiteral(d)));
            }
            if (shape.length >= dim && shape[dim - 1]! >= 0) {
              return dae.addIntLiteral(shape[dim - 1]!);
            }
          }
        }

        if (argExprIds.length >= 2) {
          let maxDim = 0;
          const prefixMatch = `${name}[`;
          for (let i = 0; i < dae.varCount; i++) {
            if (!dae.isVarRemoved(i)) {
              const vn = dae.getVarName(i);
              if (vn.startsWith(prefixMatch)) {
                const rest = vn.slice(prefixMatch.length);
                const endBracket = rest.indexOf("]");
                if (endBracket >= 0) {
                  const idxList = rest.slice(0, endBracket).split(",");
                  if (dim >= 1 && dim <= idxList.length) {
                    const val = parseInt(idxList[dim - 1]!.trim(), 10);
                    if (!isNaN(val) && val > maxDim) {
                      maxDim = val;
                    }
                  }
                }
              }
            }
          }
          if (maxDim > 0) {
            return dae.addIntLiteral(maxDim);
          }
          const cType = findOperatorRecordComponentType(name, dae, db, flattener);
          if (cType && cType.isArray && (cType.arrayDim ?? 0) > 0 && dim === 1) {
            return dae.addIntLiteral(cType.arrayDim!);
          }
        }
      }
    }
    if (dae.getExprKind(argExprIds[0]!) === ExprKind.ArrayCtor) {
      const rawArg0 = argNodes[0]?.text?.trim() ?? "";
      if (isDottedIdentifierChain(rawArg0)) {
        argExprIds[0] = dae.addNameExpr(resolveScopedName(rawArg0, prefix, dae));
      }
    }
  }

  // cat(k, A1, A2, ...): concatenate arrays along 1-based dimension k, verifying non-concatenated dimensions match
  if (fnName === "cat" || cleanFnName === "cat") {
    if (argExprIds.length >= 2) {
      const catDim = evalDaeExpr(argExprIds[0]!, dae);
      const arrs = argExprIds.slice(1).map((a) => {
        if (dae.getExprKind(a) === ExprKind.Name) {
          const vName = dae.interner.resolve(dae.getExprData1(a));
          if (vName) {
            const arrShape = getNamedArrayShape(dae, vName);
            if (arrShape && arrShape.some((d) => d === 0)) {
              return dae.addArrayCtorExpr([]);
            }
            if (dae.hasArrayElements(vName)) {
              const ctor = expandVarToArrayCtor(vName, dae);
              if (ctor !== null) return ctor;
            }
          }
        }
        return a;
      });
      if (typeof catDim === "number" && catDim >= 1 && Number.isInteger(catDim)) {
        const allDims = arrs.map((a) => getExprDims(a, dae, db));
        if (allDims.every((d) => d !== null && d.length >= catDim)) {
          const firstDims = allDims[0]!;
          for (let i = 1; i < allDims.length; i++) {
            const curDims = allDims[i]!;
            if (curDims.length !== firstDims.length) {
              dae.diagnostics.push({
                severity: "error",
                message: `Incompatible dimensions in cat(${catDim}, ...): rank mismatch between ${firstDims.length} and ${curDims.length}.`,
              });
              return -1;
            }
            for (let d = 0; d < firstDims.length; d++) {
              if (d + 1 !== catDim && firstDims[d]! > 0 && curDims[d]! > 0 && firstDims[d] !== curDims[d]) {
                dae.diagnostics.push({
                  severity: "error",
                  message: `Incompatible dimensions in cat(${catDim}, ...): dimension ${d + 1} size mismatch (${firstDims[d]} vs ${curDims[d]}).`,
                });
                return -1;
              }
            }
          }
        }
        const catRecursive = (dim: number, arrIds: number[]): number => {
          if (arrIds.length === 0) return dae.addArrayCtorExpr([]);
          if (dim === 1) {
            const flatElems: number[] = [];
            for (const a of arrIds) {
              if (dae.getExprKind(a) === ExprKind.ArrayCtor) {
                flatElems.push(...getArrayCtorElements(a, dae));
              } else {
                flatElems.push(a);
              }
            }
            return dae.addArrayCtorExpr(flatElems);
          }
          const elemLists = arrIds.map((a) =>
            dae.getExprKind(a) === ExprKind.ArrayCtor ? getArrayCtorElements(a, dae) : [a],
          );
          const firstLen = elemLists[0]?.length ?? 0;
          const hasLenMismatch = elemLists.some((l) => l.length !== firstLen);
          if (hasLenMismatch) {
            dae.diagnostics.push({
              severity: "error",
              message: `Incompatible array sizes in cat(${catDim}, ...): outer dimension length mismatch.`,
            });
            return -1;
          }
          const res: number[] = [];
          for (let i = 0; i < firstLen; i++) {
            const slice: number[] = [];
            for (const l of elemLists) {
              slice.push(l[i]!);
            }
            res.push(catRecursive(dim - 1, slice));
          }
          return dae.addArrayCtorExpr(res);
        };
        if (arrs.every((a) => dae.getExprKind(a) === ExprKind.ArrayCtor)) {
          return catRecursive(catDim, arrs);
        }
      }
    }
  }

  return null;
}
