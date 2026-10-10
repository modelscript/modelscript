// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Modelica Flattener - Central Expression Router (lowerCSTExpression).
 *
 * Lowers linear memory parser CST expression nodes directly into DAEBuilder
 * arena expression IDs, performing constant evaluation, type coercion,
 * vectorization, operator records dispatching, and comprehension unfolding.
 */

import { ExprKind } from "@modelscript/dsl";
import {
  ArenaDAEPrinter,
  BinOp,
  Causality,
  DAEBuilder,
  evaluateArenaExpression,
  evaluateArenaFunctionCall,
  inferArenaExprVarType,
  isAssignableType,
  matchVarPath,
  StmtKind,
  UnaryOp,
  Variability,
  VarType,
  varTypeName,
  type QueryDB,
  type SymbolEntry,
  type SymbolId,
} from "@modelscript/runtime";
import { Cst, type SyntaxNode } from "../../../src-gen/bindings.js";
import { BUILTIN_FUNCTIONS } from "../../builtins.js";
import { ModelicaErrorCode } from "../../errors.js";
import { isScopeEncapsulated } from "../../queries.js";
import { getElementDiagRange } from "../support/range-utils.js";
import { getFlatteningState, popLoopVar, pushLoopVar } from "../support/state.js";
import type { ComponentInstanceData } from "../types.js";
import {
  addArrayBinaryExpr,
  areExpressionsEqual,
  broadcastElemBinOp,
  dispatchBinaryOperator,
  dispatchUnaryOperator,
  exprReferencesEnumParameter,
  exprReferencesRuntimeParameter,
  exprsEqual,
  findOperatorRecordComponentType,
  getArrayCtorElements,
  getArrayCtorRank,
  getArrayCtorShape,
  getOperatorNameForBinOp,
  matrixOrVectorMul,
  matrixPower,
  mulWithSimplification,
  negateExpr,
  resolveOperatorRecord,
} from "./binary-ops.js";
import {
  cartesianProduct,
  expandColonToArrayCtor,
  findArraySubscriptsForIter,
  reduceNestedValues,
} from "./comprehensions.js";
import {
  copyExprBetweenDaes,
  evalArithmeticText,
  evaluateCSTNumber,
  evaluateEnumRange,
  expandVarToArrayCtor,
  extractEnumLiteralsFromCst,
  flattenColonNodes,
  getArrayLiteralItems,
  getDaeArrayDimCount,
  getDaeDimSize,
  getEnumLiteralIndex,
  isInsideForIndex,
  isIntegerTypeSpec,
  lookupDbConstant,
  resolveEnumType,
  resolveScopedName,
} from "./cst-utils.js";
import {
  addArenaValueAsExpr,
  castToRealExpr,
  evalDaeExpr,
  exprContainsNonConstantRef,
  getExprDims,
  isRealExpr,
} from "./eval.js";
import {
  getSymbolQualifiedName,
  hasMatchingInnerFunction,
  isOuterFunctionSymbol,
  SCALAR_VECTORIZABLE_FUNCTIONS,
  vectorizeFunctionCall,
} from "./functions.js";

export function lowerCSTExpression(
  node: SyntaxNode | null | undefined,
  dae: DAEBuilder,
  prefix = "",
  substitutions?: Map<string, number | string>,
  imports?: Map<string, string>,
  db?: QueryDB,
  flattener?: any,
  tupleContext?: boolean,
  noArrayExpand?: boolean,
  isAssignmentLhs?: boolean,
): number {
  if (!node) return -1;
  const type = node.type;

  // Single-child unwrap for wrappers
  if (
    (type === "expression" ||
      type === "lhs_expression" ||
      type === "lhs_primary" ||
      type === "simple_expression" ||
      type === "logical_expression" ||
      type === "primary" ||
      type === "expression_list" ||
      type === "Expression" ||
      type === "SimpleExpression" ||
      type === "LogicalExpression" ||
      type === "Primary" ||
      type === "ExpressionList") &&
    node.childCount === 1
  ) {
    return lowerCSTExpression(
      node.child(0),
      dae,
      prefix,
      substitutions,
      imports,
      db,
      flattener,
      tupleContext,
      noArrayExpand,
      isAssignmentLhs,
    );
  }

  // Parenthesized expression: "(" expr ")"
  if (node.childCount === 3 && Cst.kind(node.child(0)) === "(" && Cst.kind(node.child(2)) === ")") {
    return lowerCSTExpression(
      node.child(1),
      dae,
      prefix,
      substitutions,
      imports,
      db,
      flattener,
      tupleContext,
      noArrayExpand,
      isAssignmentLhs,
    );
  }

  // Real or Integer literal
  if (
    type === "unsigned_number" ||
    type === "unsigned_integer" ||
    type === "unsigned_real" ||
    type === "number_literal" ||
    type === "NumberLiteral" ||
    ((type.startsWith("/") || node.childCount === 0) &&
      /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(node.text?.trim() ?? ""))
  ) {
    const text = node.text.trim();
    if (text.includes(".") || text.toLowerCase().includes("e")) {
      return dae.addRealLiteral(parseFloat(text));
    }
    const intVal = parseInt(text, 10);
    return isNaN(intVal) ? dae.addRealLiteral(parseFloat(text)) : dae.addIntLiteral(intVal);
  }

  // Boolean literal
  const rawType = type.replace(/^"|"$/g, "");
  const trimmedText = node.text?.trim() ?? "";
  if (
    rawType === "true" ||
    rawType === "false" ||
    rawType === "boolean_literal" ||
    trimmedText === "true" ||
    trimmedText === "false"
  ) {
    return dae.addExpression(ExprKind.BoolLiteral, rawType === "true" || trimmedText === "true" ? 1 : 0);
  }

  // String literal
  if (type === "string_literal" || type === "StringLiteral") {
    const raw = node.text.trim();
    const str = raw.startsWith('"') && raw.endsWith('"') ? raw.slice(1, -1) : raw;
    return dae.addExpression(ExprKind.StringLiteral, dae.interner.intern(str));
  }

  // "time" keyword
  if (type === "time" || node.text.trim() === "time") {
    if (dae.classKind === "function") {
      let isDecl = false;
      let targetNode: any = node;
      let cur: any = node;
      while (cur) {
        if (cur.type === "component_clause") {
          isDecl = true;
          targetNode = cur;
          break;
        }
        if (cur.type === "component_declaration") {
          isDecl = true;
          targetNode = cur;
        }
        cur = cur.parent;
      }
      if (isDecl) {
        dae.diagnostics.push({
          severity: "error",
          code: ModelicaErrorCode.BUILTIN_TIME_INVALID.code,
          message: "Built-in variable 'time' may only be used in a model or block.",
          range: {
            startPosition: targetNode.startPosition,
            endPosition: targetNode.endPosition,
          },
        });
      } else {
        dae.diagnostics.push({
          severity: "error",
          code: ModelicaErrorCode.BUILTIN_TIME_INVALID.code,
          message: "time is not allowed in a function.",
          range: {
            startPosition: node.startPosition,
            endPosition: node.endPosition,
          },
        });
      }
    }
    return dae.addExpression(ExprKind.Name, dae.interner.intern("time"));
  }

  // "end" keyword outside array subscripts
  if (type === "end" || (type === "identifier" && node.text?.trim() === "end") || node.text?.trim() === "end") {
    let inSubscript = false;
    let cur: any = node.parent;
    while (cur) {
      if (cur.type === "subscript" || cur.type === "array_subscripts") {
        inSubscript = true;
        break;
      }
      cur = cur.parent;
    }
    if (!inSubscript) {
      let targetNode: any = node;
      cur = node.parent;
      while (cur) {
        if (
          cur.type === "simple_equation" ||
          cur.type === "component_clause" ||
          cur.type === "component_declaration" ||
          cur.type === "statement" ||
          cur.type === "assignment_statement"
        ) {
          targetNode = cur;
          break;
        }
        cur = cur.parent;
      }
      dae.diagnostics.push({
        severity: "error",
        code: ModelicaErrorCode.ILLEGAL_END_USAGE.code,
        message: ModelicaErrorCode.ILLEGAL_END_USAGE.message(),
        range: {
          startByte: targetNode.startIndex ?? targetNode.startByte,
          endByte: targetNode.endIndex ?? targetNode.endByte,
          startPosition: targetNode.startPosition,
          endPosition: targetNode.endPosition,
        },
      });
      return dae.addExpression(ExprKind.IntLiteral, 0);
    }
  }

  const firstChildToken = (node.child(0)?.text?.trim() ?? node.child(0)?.type ?? "").replace(/^"|"$/g, "");

  // Der expression: der ( ... )
  if (
    type === "der" ||
    ((type === "primary" || type === "lhs_primary") && (firstChildToken === "der" || node.child(0)?.type === "der"))
  ) {
    let argNode = node.child(2);
    if (!argNode || argNode.type === ")") argNode = node.child(1);
    while (
      argNode &&
      (argNode.type === "expression_list" ||
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
    if (rawName && /^[a-zA-Z_]\w*(\.[a-zA-Z_]\w*)*$/.test(rawName)) {
      argVIdx = dae.getVarIdxByName(prefix ? `${prefix}.${rawName}` : rawName);
    }
    if (argVIdx >= 0) {
      const varType = dae.getVarType(argVIdx);
      if (varType !== VarType.Real) {
        let cur: any = node;
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
        if (dae.extensionMetadata?.isOldFrontend) {
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
    const argId = lowerCSTExpression(argNode, dae, prefix, substitutions, imports, db, flattener);
    const distributeDer = (exprId: number): number => {
      const k = dae.getExprKind(exprId);
      if (k === ExprKind.ArrayCtor) {
        const elems = getArrayCtorElements(exprId, dae);
        return dae.addArrayCtorExpr(elems.map((e) => distributeDer(e)));
      }
      if (k === ExprKind.RealLiteral || k === ExprKind.IntLiteral) {
        return dae.addRealLiteral(0.0);
      }
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
            let cur: any = node;
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
            if (dae.extensionMetadata?.isOldFrontend) {
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
        const baseId = dae.getExprLeft(exprId);
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
              let cur: any = node;
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

  // Pre expression: pre ( ... )
  if (
    type === "pre" ||
    ((type === "primary" || type === "lhs_primary") &&
      (firstChildToken === "pre" || node.child(0)?.text?.startsWith("pre(")))
  ) {
    let argNode = node.child(2) ?? node.child(1);
    while (
      argNode &&
      (argNode.type === "expression_list" ||
        argNode.type === "expression" ||
        argNode.type === "lhs_expression" ||
        argNode.type === "primary" ||
        argNode.type === "lhs_primary") &&
      argNode.childCount === 1
    ) {
      argNode = argNode.child(0);
    }
    const argId = lowerCSTExpression(argNode, dae, prefix, substitutions, imports, db, flattener);
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
              vari === Variability.Continuous &&
              vt !== VarType.Integer &&
              vt !== VarType.Boolean &&
              vt !== VarType.String &&
              vt !== VarType.Clock
            ) {
              let isWhenClause = false;
              let cur: any = node;
              while (cur) {
                if (cur.type === "when_equation" || cur.type === "when_statement") {
                  isWhenClause = true;
                  break;
                }
                cur = cur.parent;
              }
              if (isWhenClause) {
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
      return dae.addPreExpr(exprId);
    };
    return distributePre(argId);
  }

  // Builtin initial() and terminal()
  if (
    (type === "primary" || type === "lhs_primary") &&
    node.childCount >= 1 &&
    (firstChildToken === "initial" ||
      firstChildToken === "terminal" ||
      node.child(0)?.text === "initial" ||
      node.child(0)?.text === "terminal") &&
    (node.text?.replace(/\s+/g, "") === "initial()" || node.text?.replace(/\s+/g, "") === "terminal()")
  ) {
    const fnName = node.child(0)?.text?.trim() ?? "initial";
    return dae.addCallExpr(fnName, []);
  }

  // Function call: component_reference "(" ... ")"
  if (
    type === "function_call" ||
    ((type === "primary" || type === "lhs_primary" || type === "statement" || type === "statement_or_procedure") &&
      node.childCount >= 2 &&
      (node.child(1)?.type === "function_call_args" || node.child(1)?.type === "("))
  ) {
    let fnName = node.child(0)?.text?.trim() ?? "";
    if (imports) {
      const parts = fnName.split(".");
      if (imports.has(parts[0])) {
        fnName = [imports.get(parts[0])!, ...parts.slice(1)].join(".");
      }
    }

    const argsNode = node.child(1);
    let argExprIds: number[] = [];
    const argNodes: any[] = [];
    const namedArgs = new Map<string, number>();
    if (argsNode) {
      const fArgsNode =
        argsNode.type === "function_arguments"
          ? argsNode
          : (argsNode.children || []).find((c: any) => c.type === "function_arguments");
      const hasComprehensionFor = Boolean(
        fArgsNode && (fArgsNode.children || []).some((c: any) => c.text === "for" || c.type === "for_indices"),
      );
      const cleanFn = fnName.startsWith(".") ? fnName.slice(1) : fnName;
      if (
        hasComprehensionFor &&
        (cleanFn === "sum" || cleanFn === "product" || cleanFn === "min" || cleanFn === "max" || cleanFn === "array")
      ) {
        const fChildren = fArgsNode.children || [];
        const forIdx = fChildren.findIndex((c: any) => c.text === "for" || c.type === "for");
        const bodyNode = forIdx > 0 ? fChildren[forIdx - 1] : fChildren[0];
        const forIndicesNode = fChildren.find((c: any) => c.type === "for_indices");

        let baseCompName = "";
        const findCR = (n: any): any => {
          if (!n) return null;
          if (n.type === "component_reference") return n;
          for (const c of n.children || []) {
            const found = findCR(c);
            if (found) return found;
          }
          return null;
        };
        const crNode = findCR(bodyNode);
        if (crNode) {
          baseCompName = crNode.text?.split(".")[0].split("[")[0].trim() ?? "";
        } else if (bodyNode?.text) {
          const match = bodyNode.text.match(/^[a-zA-Z_]\w*/);
          if (match) baseCompName = match[0];
        }
        if (baseCompName) {
          const compType = findOperatorRecordComponentType(baseCompName, dae, db, flattener);
          if (compType) {
            const ops = db?.query<Map<string, any[]> | null>("operatorFunctions", compType.symId);
            if (cleanFn === "sum") {
              const plusOps = ops?.get("'+'") ?? ops?.get("+");
              if (plusOps && plusOps.length > 0) {
                const plusOp = plusOps[0];
                flattener?.usedOperatorFunctions?.set(plusOp.qualifiedName, plusOp.funcSymId);
              }
            } else if (cleanFn === "product") {
              const mulOps = ops?.get("'*'") ?? ops?.get("*");
              if (mulOps && mulOps.length > 0) {
                const mulOp = mulOps[0];
                flattener?.usedOperatorFunctions?.set(mulOp.qualifiedName, mulOp.funcSymId);
              }
            }
          }
        }

        const forIndices = (forIndicesNode?.children || []).filter((k: any) => k.type === "for_index");
        const iters: { name: string; values: (number | string)[] }[] = [];
        for (const fi of forIndices) {
          const varName = (Cst.ForIndex.variable(fi)?.text?.trim() || fi.child(0)?.text?.trim() || "").trim();
          if (!varName) continue;
          const rangeNode = Cst.ForIndex.range(fi) || fi.children?.find?.((k: any) => k.type === "expression");
          let values: (number | string)[] = [];
          const isImplicit = !rangeNode;
          if (rangeNode) {
            flattener?.lowerExpr(rangeNode, dae, prefix, substitutions);
            if (dae.diagnostics.some((d: any) => d.severity === "error")) {
              return;
            }
            const enumRange = evaluateEnumRange(
              rangeNode,
              substitutions,
              flattener?.currentClassId ?? flattener?.currentRootClassId ?? (dae as any).currentClassId,
              db,
              dae,
              prefix,
            );
            if (enumRange !== null && enumRange.length > 0) {
              values = enumRange;
            } else {
              const colonNodes = flattenColonNodes(rangeNode);
              if (colonNodes.length >= 2) {
                const s = evaluateCSTNumber(colonNodes[0], substitutions as any, undefined, db, dae, prefix);
                let e: number | null = null;
                let step = 1;
                if (colonNodes.length === 2) {
                  e = evaluateCSTNumber(colonNodes[1], substitutions as any, undefined, db, dae, prefix);
                } else if (colonNodes.length >= 3) {
                  step = evaluateCSTNumber(colonNodes[1], substitutions as any, undefined, db, dae, prefix) ?? 1;
                  e = evaluateCSTNumber(colonNodes[2], substitutions as any, undefined, db, dae, prefix);
                }
                if (s !== null && e !== null) {
                  if (step === 0 || Math.abs(step) < 1e-12) {
                    dae.diagnostics.push({
                      severity: "error",
                      code: ModelicaErrorCode.RANGE_STEP_TOO_SMALL.code,
                      message: ModelicaErrorCode.RANGE_STEP_TOO_SMALL.message(String(step)),
                      range: { startByte: 0, endByte: 0 },
                    });
                  } else {
                    for (let val = s; step > 0 ? val <= e : val >= e; val += step) values.push(val);
                  }
                }
              } else {
                const rangeText = rangeNode.text?.trim() ?? "";
                if (rangeText.startsWith("{") && rangeText.endsWith("}")) {
                  const items = getArrayLiteralItems(rangeNode);
                  for (const item of items) {
                    const v = evaluateCSTNumber(item, substitutions as any, undefined, db, dae, prefix);
                    if (v !== null) values.push(v);
                  }
                }
              }
            }
          }
          if (values.length === 0) {
            values = findArraySubscriptsForIter(bodyNode, varName, dae, db, prefix, isImplicit, fi);
          }
          if (values.length > 0) {
            iters.push({ name: varName, values });
          }
        }

        if (cleanFn === "sum" || cleanFn === "product" || cleanFn === "min" || cleanFn === "max") {
          let eqNode: any = node;
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
          const startB = diagNode?.startIndex ?? diagNode?.startByte;
          const endB = diagNode?.endIndex ?? diagNode?.endByte;
          const range =
            startB != null && endB != null
              ? {
                  startByte: startB,
                  endByte: endB,
                  startPosition: diagNode?.startPosition,
                  endPosition: diagNode?.endPosition,
                }
              : undefined;

          const testSubs = new Map(substitutions);
          if (iters.length > 0) {
            for (const it of iters) {
              if (it.values.length > 0) testSubs.set(it.name, it.values[0]!);
            }
          }
          const sampleBodyId = lowerCSTExpression(bodyNode, dae, prefix, testSubs, imports, db, flattener);
          if (sampleBodyId >= 0) {
            const bKind = dae.getExprKind(sampleBodyId);
            let actualTypeName = "";
            let isArray = false;
            let isString = false;
            let isBoolean = false;

            if (bKind === ExprKind.StringLiteral) {
              actualTypeName = "String";
              isString = true;
            } else if (bKind === ExprKind.BoolLiteral) {
              actualTypeName = "Boolean";
              isBoolean = true;
            } else if (bKind === ExprKind.IntLiteral) {
              actualTypeName = "Integer";
            } else if (bKind === ExprKind.RealLiteral) {
              actualTypeName = "Real";
            } else if (bKind === ExprKind.ArrayCtor) {
              isArray = true;
              const count = dae.getExprData1(sampleBodyId);
              let elemType = "Integer";
              const firstElem = dae.getExprLeft(sampleBodyId);
              if (firstElem >= 0 && dae.getExprKind(firstElem) === ExprKind.RealLiteral) {
                elemType = "Real";
              }
              actualTypeName = `${elemType}[${count}]`;
            } else {
              const t = inferArenaExprVarType(dae, sampleBodyId);
              if (t === VarType.String) {
                actualTypeName = "String";
                isString = true;
              } else if (t === VarType.Boolean) {
                actualTypeName = "Boolean";
                isBoolean = true;
              } else if (t === VarType.Real) {
                actualTypeName = "Real";
              } else if (t === VarType.Integer) {
                actualTypeName = "Integer";
              }
              const dims = getExprDims(sampleBodyId, dae, db, flattener);
              if (dims && dims.length > 0) {
                isArray = true;
                actualTypeName = `${actualTypeName || "Integer"}[${dims.join(",")}]`;
              }
            }

            if (cleanFn === "min" || cleanFn === "max") {
              if (isString || isArray) {
                dae.diagnostics.push({
                  severity: "error",
                  code: ModelicaErrorCode.REDUCTION_INVALID_EXPR_TYPE.code,
                  message: ModelicaErrorCode.REDUCTION_INVALID_EXPR_TYPE.message(
                    bodyNode.text?.trim() ?? "",
                    actualTypeName,
                    cleanFn,
                    "scalar enumeration, Boolean, Integer, or Real",
                  ),
                  range,
                });
                return -1;
              }
            } else if (cleanFn === "product") {
              if (isString || isBoolean || isArray) {
                dae.diagnostics.push({
                  severity: "error",
                  code: ModelicaErrorCode.REDUCTION_INVALID_EXPR_TYPE.code,
                  message: ModelicaErrorCode.REDUCTION_INVALID_EXPR_TYPE.message(
                    bodyNode.text?.trim() ?? "",
                    actualTypeName,
                    "product",
                    "scalar Integer or Real",
                  ),
                  range,
                });
                return -1;
              }
            } else if (cleanFn === "sum") {
              if (isString || isBoolean) {
                dae.diagnostics.push({
                  severity: "error",
                  code: ModelicaErrorCode.REDUCTION_INVALID_EXPR_TYPE.code,
                  message: ModelicaErrorCode.REDUCTION_INVALID_EXPR_TYPE.message(
                    bodyNode.text?.trim() ?? "",
                    actualTypeName,
                    "sum",
                    "Integer or Real, or operator record",
                  ),
                  range,
                });
                return -1;
              }
            }
          }
        }

        if (cleanFn === "array") {
          if (iters.length === 1) {
            const iter = iters[0]!;
            pushLoopVar(flattener, iter.name);
            try {
              const elemIds: number[] = [];
              for (const val of iter.values) {
                const newSubs = new Map(substitutions);
                newSubs.set(iter.name, val);
                elemIds.push(lowerCSTExpression(bodyNode, dae, prefix, newSubs, imports, db, flattener));
              }
              return dae.addArrayCtorExpr(elemIds);
            } finally {
              popLoopVar(flattener, iter.name);
            }
          } else if (iters.length === 2) {
            const iter1 = iters[0]!;
            const iter2 = iters[1]!;
            pushLoopVar(flattener, iter1.name);
            pushLoopVar(flattener, iter2.name);
            try {
              const rowIds: number[] = [];
              for (const val2 of iter2.values) {
                const colIds: number[] = [];
                for (const val1 of iter1.values) {
                  const newSubs = new Map(substitutions);
                  newSubs.set(iter1.name, val1);
                  newSubs.set(iter2.name, val2);
                  colIds.push(lowerCSTExpression(bodyNode, dae, prefix, newSubs, imports, db, flattener));
                }
                rowIds.push(dae.addArrayCtorExpr(colIds));
              }
              return dae.addArrayCtorExpr(rowIds);
            } finally {
              popLoopVar(flattener, iter1.name);
              popLoopVar(flattener, iter2.name);
            }
          }
        } else if (cleanFn === "sum" || cleanFn === "product") {
          if (iters.length > 0) {
            const tuples = cartesianProduct(iters.map((it) => it.values));
            for (const it of iters) pushLoopVar(flattener, it.name);
            const terms: number[] = [];
            try {
              for (const tuple of tuples) {
                const newSubs = new Map(substitutions);
                for (let idx = 0; idx < iters.length; idx++) {
                  newSubs.set(iters[idx]!.name, tuple[idx]!);
                }
                terms.push(lowerCSTExpression(bodyNode, dae, prefix, newSubs, imports, db, flattener));
              }
            } finally {
              for (const it of iters) popLoopVar(flattener, it.name);
            }

            const numValues: number[] = [];
            let allConstant = true;
            for (const termId of terms) {
              const ev = evalDaeExpr(termId, dae);
              if (typeof ev === "number") {
                numValues.push(ev);
              } else {
                allConstant = false;
                break;
              }
            }
            if (allConstant && numValues.length > 0) {
              const shape = iters.map((it) => it.values.length);
              const resVal = reduceNestedValues(numValues, shape, cleanFn === "sum" ? "sum" : "product");
              const isAllInteger =
                numValues.every((v) => Number.isInteger(v)) && terms.every((t) => !isRealExpr(t, dae));
              return isAllInteger ? dae.addIntLiteral(Math.round(resVal)) : dae.addRealLiteral(resVal);
            } else if (terms.length > 0) {
              const op = cleanFn === "sum" ? BinOp.Add : BinOp.Mul;
              let accId = terms[0]!;
              for (let idx = 1; idx < terms.length; idx++) {
                accId = dae.addBinaryExpr(op, accId, terms[idx]!);
              }
              return accId;
            }
          }
        } else if (cleanFn === "min" || cleanFn === "max") {
          if (forIndices.length === 1) {
            const fi = forIndices[0]!;
            const rangeNode = Cst.ForIndex.range(fi) || fi.children?.find?.((k: any) => k.type === "expression");
            if (rangeNode) {
              const rangeText = rangeNode.text?.trim() ?? "";
              if (rangeText.startsWith("{") && rangeText.endsWith("}")) {
                const items = getArrayLiteralItems(rangeNode);
                const varName = (Cst.ForIndex.variable(fi)?.text?.trim() || fi.child(0)?.text?.trim() || "").trim();
                if (bodyNode.text?.trim() === varName) {
                  let bestNum: number | null = null;
                  const nonConsts: number[] = [];
                  let hasFloat = false;
                  for (const it of items) {
                    const lId = lowerCSTExpression(it, dae, prefix, substitutions, imports, db, flattener);
                    const ev = evalDaeExpr(lId, dae);
                    if (typeof ev === "number") {
                      if (!Number.isInteger(ev)) hasFloat = true;
                      if (bestNum === null) {
                        bestNum = ev;
                      } else {
                        bestNum = cleanFn === "max" ? Math.max(bestNum, ev) : Math.min(bestNum, ev);
                      }
                    } else {
                      nonConsts.push(lId);
                    }
                  }
                  if (bestNum !== null) {
                    const bestId = hasFloat ? dae.addRealLiteral(bestNum) : dae.addIntLiteral(bestNum);
                    if (nonConsts.length === 0) {
                      return bestId;
                    }
                    return dae.addCallExpr(cleanFn, [bestId, ...nonConsts]);
                  } else if (nonConsts.length > 0) {
                    if (nonConsts.length === 1) return nonConsts[0]!;
                    return dae.addCallExpr(cleanFn, nonConsts);
                  }
                }
              }
            }
          }
          if (iters.length === 1 && iters[0]!.values.length === 1) {
            const val = iters[0]!.values[0]!;
            const newSubs = new Map(substitutions);
            newSubs.set(iters[0]!.name, val);
            return lowerCSTExpression(bodyNode, dae, prefix, newSubs, imports, db, flattener);
          }

          const iterators: { name: string; rangeId: number }[] = [];
          if (iters.length > 0) {
            for (const it of iters) {
              const rangeItems = it.values.map((v) =>
                typeof v === "number"
                  ? dae.addIntLiteral(v)
                  : dae.addExpression(ExprKind.Name, dae.interner.intern(String(v))),
              );
              const evalRangeId = dae.addArrayCtorExpr(rangeItems);
              iterators.push({ name: it.name, rangeId: evalRangeId });
            }
          } else if (forIndicesNode) {
            for (const idxNode of forIndicesNode.children || []) {
              if (idxNode.type === "for_index") {
                const varNode = idxNode.childForFieldName?.("variable") ?? idxNode.child(0);
                const rangeNode = idxNode.childForFieldName?.("range") ?? idxNode.child(2) ?? idxNode.child(1);
                const varName = varNode?.text?.trim() ?? "";
                let rangeId = -1;
                if (rangeNode) {
                  rangeId = lowerCSTExpression(rangeNode, dae, prefix, substitutions, imports, db, flattener);
                }
                if (varName) {
                  iterators.push({ name: varName, rangeId });
                }
              }
            }
          }
          for (const it of iters) pushLoopVar(flattener, it.name);
          let bodyId: number;
          try {
            bodyId = lowerCSTExpression(bodyNode, dae, prefix, substitutions, imports, db, flattener);
          } finally {
            for (const it of iters) popLoopVar(flattener, it.name);
          }
          return dae.addComprehensionExpr(cleanFn, bodyId, iterators);
        }

        const iterators: { name: string; rangeId: number }[] = [];
        if (forIndicesNode) {
          for (const idxNode of forIndicesNode.children || []) {
            if (idxNode.type === "for_index") {
              const varNode = idxNode.childForFieldName?.("variable") ?? idxNode.child(0);
              const rangeNode = idxNode.childForFieldName?.("range") ?? idxNode.child(2) ?? idxNode.child(1);
              const varName = varNode?.text?.trim() ?? "";
              let rangeId = -1;
              if (rangeNode) {
                rangeId = lowerCSTExpression(rangeNode, dae, prefix, substitutions, imports, db, flattener);
              }
              if (varName) {
                iterators.push({ name: varName, rangeId });
              }
            }
          }
        }
        const bodyId = lowerCSTExpression(bodyNode, dae, prefix, substitutions, imports, db, flattener);

        return dae.addComprehensionExpr(cleanFn, bodyId, iterators);
      }

      const collectArgs = (n: any) => {
        if (!n) return;
        if (n.type === "named_argument") {
          const propName = n.child(0)?.text?.trim();
          let exprChild = n.child(2) ?? n.child(1);
          if (exprChild && exprChild.type === "function_argument" && exprChild.childCount === 1) {
            exprChild = exprChild.child(0);
          }
          if (propName && exprChild) {
            let exprId = -1;
            if (exprChild.type !== "function_partial_application") {
              exprId = lowerCSTExpression(exprChild, dae, prefix, substitutions, imports, db, flattener);
            }
            namedArgs.set(propName, exprId);
            argNodes.push(exprChild);
            return;
          }
        }
        if (n.type === "function_partial_application") {
          argNodes.push(n);
          argExprIds.push(-1);
          return;
        }
        if (n.type === "function_argument") {
          const firstChild = n.child(0);
          if (firstChild && firstChild.type === "function_partial_application") {
            argNodes.push(firstChild);
            argExprIds.push(-1);
            return;
          }
        }
        if (n.type === "expression") {
          argNodes.push(n);
          argExprIds.push(lowerCSTExpression(n, dae, prefix, substitutions, imports, db, flattener));
          return;
        }
        for (let i = 0; i < n.childCount; i++) {
          collectArgs(n.child(i));
        }
      };
      const state = getFlatteningState(dae);
      const prevInsidePrevious = state.isInsidePrevious;
      if (fnName === "previous") {
        state.isInsidePrevious = true;
      }
      try {
        collectArgs(argsNode);
      } finally {
        state.isInsidePrevious = prevInsidePrevious;
      }
    }
    if (fnName === "integer" && argExprIds.length === 1) {
      const a0 = argExprIds[0];
      const kind = dae.getExprKind(a0);
      if (kind === ExprKind.RealLiteral) {
        return dae.addIntLiteral(Math.floor(dae.getExprRealValue(a0)));
      }
      if (kind === ExprKind.IntLiteral) {
        return a0;
      }
    }
    const cleanFnName = typeof fnName === "string" ? fnName.replace(/^\.+/, "") : "";

    if (/\[.*?\]/.test(node.child(0)?.text ?? "")) {
      const callText = node.child(0)?.text?.trim() ?? cleanFnName;
      let cur: any = node;
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
        code: ModelicaErrorCode.FUNCTION_CALL_CONTAINS_SUBSCRIPTS.code,
        message: ModelicaErrorCode.FUNCTION_CALL_CONTAINS_SUBSCRIPTS.message(callText),
        range: diagRange,
      });
      return -1;
    }

    if (cleanFnName.endsWith(".constructor") || cleanFnName.endsWith(".destructor")) {
      const parts = cleanFnName.split(".");
      parts.pop(); // remove constructor / destructor
      const parentName = parts.join(".");
      const parentSym = flattener?.currentClassId
        ? (db.query<any>("resolveName", flattener.currentClassId)?.(parentName) ??
          db.byName(parts[parts.length - 1]).find((e: any) => e.kind === "Class"))
        : db.byName(parts[parts.length - 1]).find((e: any) => e.kind === "Class");
      if (parentSym) {
        const extendsExtObj = db
          .childrenOf(parentSym.id)
          ?.some((c) => c.kind === "Extends" && c.name === "ExternalObject");
        if (extendsExtObj) {
          const scopeName = flattener?.currentClassId ? (db.symbol(flattener.currentClassId)?.name ?? "") : "";
          let callRange: any = undefined;
          if (node) {
            let n: any = node;
            while (n && n.type !== "component_clause" && n.parent) {
              if (n.type === "statement" || n.type === "function_call") break;
              n = n.parent;
            }
            const diagNode = n?.type === "component_clause" ? n : node;
            callRange = {
              startPosition: diagNode.startPosition,
              endPosition: diagNode.endPosition,
              startByte: diagNode.startIndex ?? diagNode.startByte,
              endByte: diagNode.endIndex ?? diagNode.endByte,
            };
          }
          dae.diagnostics.push({
            severity: "error",
            code: ModelicaErrorCode.VARIABLE_NOT_FOUND.code,
            message: `Function ${cleanFnName} not found in scope ${scopeName}.`,
            range: callRange,
          });
          return -1;
        }
      }
    }

    if (db && flattener && cleanFnName) {
      let calledFnSym: any = null;
      if (flattener.currentClassId) {
        const resolver =
          db.query<any>("resolveName", flattener.currentClassId) ??
          db.query<any>("resolveSimpleName", flattener.currentClassId);
        if (resolver) calledFnSym = resolver(cleanFnName);
      }
      if (!calledFnSym && flattener.currentRootClassId) {
        const resolver =
          db.query<any>("resolveName", flattener.currentRootClassId) ??
          db.query<any>("resolveSimpleName", flattener.currentRootClassId);
        if (resolver) calledFnSym = resolver(cleanFnName);
      }
      if (!calledFnSym) {
        const parts = cleanFnName.split(".");
        const fnBase = parts[parts.length - 1];
        calledFnSym = db.byName(fnBase).find((e: any) => {
          if (e.kind !== "Class" && e.kind !== "Function") return false;
          if (!flattener.isFunctionSym?.(e)) return false;
          if (parts.length > 1) {
            const qual = getSymbolQualifiedName(db, e.id);
            return qual === cleanFnName || qual.endsWith("." + cleanFnName);
          }
          return parts.length === 1;
        });
      }
      const isOuterFn = isOuterFunctionSymbol(db, calledFnSym);
      const hasInnerMatch = isOuterFn && hasMatchingInnerFunction(db, flattener, calledFnSym?.name ?? cleanFnName);
      if (calledFnSym && flattener.isClassPartial?.(calledFnSym.id) && !(isOuterFn && hasInnerMatch)) {
        let callRange: any = undefined;
        if (node) {
          let n: any = node;
          while (n && n.type !== "component_clause" && n.parent) {
            if (n.type === "statement" || n.type === "function_call") break;
            n = n.parent;
          }
          if (n && n.type === "component_clause") {
            callRange = {
              startPosition: n.startPosition,
              endPosition: n.endPosition,
              startByte: n.startIndex ?? n.startByte,
              endByte: n.endIndex ?? n.endByte,
            };
          } else {
            callRange = {
              startPosition: node.startPosition,
              endPosition: node.endPosition,
              startByte: node.startIndex ?? node.startByte,
              endByte: node.endIndex ?? node.endByte,
            };
          }
        }
        dae.diagnostics.push({
          severity: "error",
          code: ModelicaErrorCode.CALLED_FUNCTION_PARTIAL.code,
          message: ModelicaErrorCode.CALLED_FUNCTION_PARTIAL.message(calledFnSym.name || cleanFnName),
          range: callRange,
        });
        return -1;
      }

      if (calledFnSym && flattener.failedFunctionIds?.has(calledFnSym.id)) {
        const isOldFrontend = Boolean(dae.extensionMetadata?.isOldFrontend || flattener?.options?.isOldFrontend);
        if (isOldFrontend && (dae.extensionMetadata as any)?.hasOldInstOption) {
          let cur: any = node;
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
          const scopeName = flattener.currentClassId ? (db.symbol(flattener.currentClassId)?.name ?? "") : "";
          dae.diagnostics.push({
            severity: "error",
            code: ModelicaErrorCode.CLASS_NOT_FOUND.code,
            message: `Class ${cleanFnName} not found in scope ${scopeName} (looking for a function or record).`,
            range: diagRange,
          });
        }
        return -1;
      }

      if (calledFnSym) {
        const fnChildren = db.childrenOf(calledFnSym.id);
        const inputParams = (fnChildren || []).filter((c) => {
          if (c.kind !== "Component") return false;
          const ci = db.query<ComponentInstanceData>("componentInstance", c.id);
          return ci?.causality === "input";
        });

        for (let i = 0; i < inputParams.length && i < argNodes.length; i++) {
          const param = inputParams[i]!;
          const paramCi = db.query<ComponentInstanceData>("componentInstance", param.id);
          const paramTypeName = paramCi?.typeSpecifier;
          if (paramTypeName) {
            const paramTarget =
              db.query<any>("resolveName", calledFnSym.id)?.(paramTypeName) ??
              db
                .byName(paramTypeName.split(".").pop()!)
                .find((e) => (e.kind === "Class" || e.kind === "Function") && flattener.isFunctionSym?.(e)) ??
              db.byName(paramTypeName.split(".").pop()!).find((e) => e.kind === "Class");
            const isParamFunction = paramTarget && flattener.isFunctionSym?.(paramTarget);
            if (isParamFunction) {
              const argNode = argNodes[i];
              let passedFnName = "";
              if (argNode?.type === "function_partial_application") {
                const typeSpecNode =
                  argNode.children?.find((c: any) => c.type === "type_specifier") ?? argNode.child(1);
                passedFnName = typeSpecNode?.text?.trim() ?? "";
              } else {
                passedFnName = argNode?.text?.trim() ?? "";
              }

              const callingScope = flattener.currentClassId ?? flattener.currentRootClassId;
              const argFnSym = callingScope
                ? (db.query<any>("resolveName", callingScope)?.(passedFnName) ??
                  db
                    .byName(passedFnName.split(".").pop()!)
                    .find((e: any) => (e.kind === "Class" || e.kind === "Function") && flattener.isFunctionSym?.(e)))
                : db
                    .byName(passedFnName.split(".").pop()!)
                    .find((e: any) => (e.kind === "Class" || e.kind === "Function") && flattener.isFunctionSym?.(e));

              if (argFnSym && flattener.isFunctionSym?.(argFnSym)) {
                const getFnSig = (sym: any) => {
                  const chs = db.childrenOf(sym.id) || [];
                  const inParams: { name: string; type: string; hasDefault: boolean; defaultVal?: string }[] = [];
                  const outParams: { name: string; type: string }[] = [];
                  for (const ch of chs) {
                    if (ch.kind === "Component") {
                      const ci = db.query<ComponentInstanceData>("componentInstance", ch.id);
                      const cst = db.cstNode(ch.id) as any;
                      const hasDefault = Boolean(
                        ci?.modification?.bindingExpression || (cst?.text && /=/.test(cst.text)),
                      );
                      let defaultVal: string | undefined = undefined;
                      if (hasDefault) {
                        const m = cst?.text?.match(/=\s*([^;]+)/);
                        if (m) defaultVal = m[1].trim();
                      }
                      const t = ci?.typeSpecifier ?? "Real";
                      if (ci?.causality === "input") {
                        inParams.push({ name: ch.name, type: t, hasDefault, defaultVal });
                      } else if (ci?.causality === "output") {
                        outParams.push({ name: ch.name, type: t });
                      }
                    }
                  }
                  return { inParams, outParams };
                };

                const expectedSig = getFnSig(paramTarget);
                const actualSig = getFnSig(argFnSym);

                let isCompatible = true;
                if (actualSig.inParams.filter((p) => !p.hasDefault).length > expectedSig.inParams.length) {
                  isCompatible = false;
                } else {
                  for (let j = 0; j < expectedSig.inParams.length; j++) {
                    if (j >= actualSig.inParams.length) {
                      isCompatible = false;
                      break;
                    }
                    if (expectedSig.inParams[j].type !== actualSig.inParams[j].type) {
                      isCompatible = false;
                      break;
                    }
                  }
                  if (isCompatible && expectedSig.outParams.length !== actualSig.outParams.length) {
                    isCompatible = false;
                  }
                }

                if (!isCompatible) {
                  let cur: any = node;
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
                  const fnQual = getSymbolQualifiedName(db, calledFnSym.id);
                  const argQual = getSymbolQualifiedName(db, argFnSym.id);
                  const paramQual = getSymbolQualifiedName(db, paramTarget.id);

                  const isOldFrontend = Boolean(
                    dae.extensionMetadata?.isOldFrontend || flattener?.options?.isOldFrontend,
                  );

                  const formatInParam = (
                    p: { name: string; type: string; hasDefault: boolean; defaultVal?: string },
                    hasAlgorithm: boolean,
                  ) => {
                    let tStr = p.type;
                    if (hasAlgorithm && (p.type === "Integer" || p.type === "Real" || p.type === "Boolean")) {
                      tStr = `#${p.type}`;
                    }
                    if (p.hasDefault && isOldFrontend) {
                      return `${tStr} ${p.name} := ${p.defaultVal ?? "1"}`;
                    }
                    return `${tStr} ${p.name}`;
                  };

                  const formatSig = (sym: any, prefixName: string, sig: { inParams: any[]; outParams: any[] }) => {
                    const cstText = (db.cstNode(sym.id) as any)?.text ?? "";
                    const hasAlg = /\balgorithm\b/.test(cstText);
                    const inStr = sig.inParams.map((p) => formatInParam(p, hasAlg)).join(", ");
                    let outStr = "";
                    if (sig.outParams.length === 0) {
                      outStr = isOldFrontend ? " => #NORETCALL#" : " => ()";
                    } else {
                      const outHasAlg = hasAlg && isOldFrontend;
                      outStr =
                        " => " +
                        sig.outParams
                          .map(
                            (o) =>
                              `${outHasAlg && (o.type === "Integer" || o.type === "Real" || o.type === "Boolean") ? `#${o.type}` : o.type} ${o.name}`,
                          )
                          .join(", ");
                    }
                    return `${prefixName}<function>(${inStr})${outStr}`;
                  };

                  const argPrefix = argQual.includes(".")
                    ? argQual.startsWith(".")
                      ? argQual
                      : `.${argQual}`
                    : argQual;
                  const paramPrefix = paramQual.includes(".")
                    ? paramQual.startsWith(".")
                      ? paramQual
                      : `.${paramQual}`
                    : param.name;

                  const actualSigStr = formatSig(argFnSym, argPrefix, actualSig);
                  const expectedSigStr = formatSig(paramTarget, paramPrefix, expectedSig);

                  dae.diagnostics.push({
                    severity: "error",
                    code: ModelicaErrorCode.FUNCTION_ARG_TYPE_MISMATCH.code,
                    message: ModelicaErrorCode.FUNCTION_ARG_TYPE_MISMATCH.message(
                      `${fnQual}(${param.name}=${argQual})`,
                      String(i + 1),
                      actualSigStr,
                      expectedSigStr,
                    ),
                    range: diagRange,
                  });
                  return -1;
                }
              }
            }

            const isParamExtObj =
              paramTarget &&
              db.childrenOf(paramTarget.id)?.some((c) => c.kind === "Extends" && c.name === "ExternalObject");
            if (isParamExtObj) {
              const argNode = argNodes[i];
              const argText = argNode?.text?.trim() ?? "";
              const argSym = flattener.currentClassId
                ? (db.query<any>("resolveName", flattener.currentClassId)?.(argText) ??
                  db.byName(argText).find((e: any) => e.kind === "Component"))
                : null;
              if (argSym) {
                const argCi = db.query<ComponentInstanceData>("componentInstance", argSym.id);
                const argTypeName = argCi?.typeSpecifier;
                const argTarget = argTypeName
                  ? (db.query<any>("resolveName", flattener.currentClassId!)?.(argTypeName) ??
                    db.byName(argTypeName.split(".").pop()!).find((e: any) => e.kind === "Class"))
                  : null;
                if (argTarget && argTarget.id !== paramTarget.id) {
                  let cur: any = node;
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
                  const fnQual = getSymbolQualifiedName(db, calledFnSym.id);
                  const argQual = getSymbolQualifiedName(db, argTarget.id);
                  const paramQual = getSymbolQualifiedName(db, paramTarget.id);
                  dae.diagnostics.push({
                    severity: "error",
                    code: ModelicaErrorCode.FUNCTION_ARG_TYPE_MISMATCH.code,
                    message: `Type mismatch for positional argument ${i + 1} in ${fnQual}(${param.name}=${argText}). The argument has type:\n  ExternalObject ${argQual}\nexpected type:\n  ExternalObject ${paramQual}`,
                    range: diagRange,
                  });
                  return -1;
                }
              }
            }
          }
        }
      }
    }

    if (cleanFnName === "identity") {
      let cur: any = node;
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
              }
            }
          }
        } else {
          const dims = getExprDims(aid, dae, db);
          if (dims && dims.length > 0) isArray = true;
        }

        if (!isArray) {
          let cur: any = node;
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
          const isOldFrontend = Boolean(dae.extensionMetadata?.isOldFrontend);
          const argText = argNodes[0]?.text?.trim() ?? "0";
          const vt = inferArenaExprVarType(dae, aid);
          const typeStr = varTypeName(vt);
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
              if (v !== Variability.Parameter && v !== Variability.Constant) {
                let isAlgorithm = false;
                let cur: any = node;
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
            let cur: any = node;
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
        let cur: any = node;
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
        const elemType = varTypeName(vt);
        const argText = argNodes[0]?.text?.trim()?.replace(/\s+/g, " ") ?? "";
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
        let cur: any = node;
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
        const elemType = varTypeName(vt);
        const argText = argNodes[0]?.text?.trim()?.replace(/\s+/g, " ") ?? "";
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
        let cur: any = node;
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
      let cur: any = node;
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
        const rawArgs = argNodes.map((a: any) => a?.text?.trim() ?? "").join(", ");
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
        let cur: any = node;
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
      const rec = argExprIds.length >= 1 ? resolveOperatorRecord(argExprIds[0], argNodes[0], dae, db, flattener) : null;
      let hasRecOverload = false;
      if (rec) {
        const ops = db?.query<Map<string, any[]> | null>("operatorFunctions", rec.symId);
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
              const sym = db?.byName(vName)[0];
              const meta = sym?.metadata as any;
              if (meta?.typeSpecifier && !["Real", "Integer", "Boolean", "String"].includes(meta.typeSpecifier)) {
                isInvalidStringCall = true;
              }
            }
          }
        }
      }
      if (isInvalidStringCall) {
        let cur: any = node;
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
            const tSpec = (sym?.metadata as any)?.typeSpecifier;
            if (tSpec) return `/*${tSpec}*/ ${rawText}`;
          }
          const vt = inferArenaExprVarType(dae, aid);
          return `/*${varTypeName(vt)}*/ ${rawText}`;
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
        let cur: any = node;
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
      let cur: any = node;
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
            const isOldFrontend = Boolean(dae.extensionMetadata?.isOldFrontend);
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
            const isOldFrontend = Boolean(dae.extensionMetadata?.isOldFrontend);
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
    }

    if (cleanFnName === "sample" && argExprIds.length >= 1) {
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
          let cur: any = node;
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

    if (cleanFnName === "cardinality") {
      let cur: any = node;
      let inAllowedContext = false;
      while (cur) {
        if (
          (cur.type === "if_equation" || cur.type === "if_statement" || cur.type === "elseif_clause") &&
          cur.child(1) &&
          (cur.child(1) === node || cur.child(1).text?.includes("cardinality"))
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
      let clause: any = node;
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

      if (!inAllowedContext) {
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
        const rootIdent = argText.split(".")[0].split("[")[0];
        const scopeId = flattener?.currentClassId ?? flattener?.currentRootClassId;
        const resolver = db?.query<any>("resolveSimpleName", scopeId);
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
            const partName = rawPart.split("[")[0];
            const hasExplicitSub = rawPart.includes("[");
            const partResolver = db.query<any>("resolveSimpleName", currScopeId);
            const comp = partResolver ? partResolver(partName) : db.byName(partName)[0];
            if (!comp) break;

            currentType = db.query<string | null>("typeSpecifier", comp.id) ?? comp.name;
            const compCst = db.cstNode(comp.id) as any;
            if (!hasExplicitSub && compCst) {
              const subNode = (compCst.children || []).find((c: any) => c.type === "array_subscripts");
              if (subNode) {
                const numMatch = subNode.text?.match(/\d+/g);
                if (numMatch) {
                  for (const n of numMatch) {
                    totalDims.push(parseInt(n, 10));
                  }
                }
              }
            }

            if (currentType) {
              const typeClass = db.byName(currentType).find((c: any) => c.kind === "Class");
              if (typeClass) {
                currScopeId = typeClass.id;
                const kind = (typeClass.metadata as any)?.classKind ?? (typeClass.metadata as any)?.classPrefixes;
                if (kind === "connector") {
                  isConnector = true;
                }
              }
            }
          }

          if (totalDims.length > 0 || !isConnector) {
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
      const fnSym = fnArgName
        ? db?.byName(fnArgName).find((e: any) => e.kind === "Function" || e.kind === "Class")
        : null;
      if (
        fnSym &&
        (fnSym.kind === "Function" ||
          (fnSym.metadata as any)?.classKind === "function" ||
          flattener?.isFunctionSym?.(fnSym))
      ) {
        let cur: any = node;
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

        let cur: any = node;
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
        const startB = diagNode?.startIndex ?? diagNode?.startByte;
        const endB = diagNode?.endIndex ?? diagNode?.endByte;
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
                  startByte: startB,
                  endByte: endB,
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
          namedArgs.get("reset") ??
          (argExprIds.length > 4 ? argExprIds[4]! : dae.addExpression(ExprKind.BoolLiteral, 1));
        const syncExpr =
          namedArgs.get("synchronize") ??
          (argExprIds.length > 5 ? argExprIds[5]! : dae.addExpression(ExprKind.BoolLiteral, 0));
        const priorityExpr =
          namedArgs.get("priority") ?? (argExprIds.length > 6 ? argExprIds[6]! : dae.addIntLiteral(1));

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
        for (let i = 0; i < 2; i++) {
          if (!isRealExpr(argExprIds[i]!, dae)) {
            argExprIds[i] = castToRealExpr(argExprIds[i]!, dae);
          }
        }
      }
    } else if (
      fnName === "Clock" &&
      argExprIds.length === 1 &&
      dae.getExprKind(argExprIds[0]!) === ExprKind.IntLiteral
    ) {
      argExprIds.push(dae.addIntLiteral(1));
    }

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

    const vectorizedCall = vectorizeFunctionCall(cleanFnName || fnName, argExprIds, dae, flattener, db);
    if (vectorizedCall !== null) {
      return vectorizedCall;
    }
    if (fnName === "array" || cleanFnName === "array") {
      if (argExprIds.length > 1) {
        const firstDims = getExprDims(argExprIds[0]!, dae, flattener.db);
        for (let i = 1; i < argExprIds.length; i++) {
          const dims = getExprDims(argExprIds[i]!, dae, flattener.db);
          if (firstDims && dims && (firstDims.length !== dims.length || firstDims.some((d, idx) => d !== dims[idx]))) {
            let clauseNode = node;
            while (clauseNode && clauseNode.type !== "component_clause") {
              clauseNode = clauseNode.parent;
            }
            const diagNode = clauseNode ?? node;
            const startB = diagNode.startIndex ?? diagNode.startByte;
            const endB = diagNode.endIndex ?? diagNode.endByte;
            dae.diagnostics.push({
              severity: "error",
              message: `Different dimension sizes in arguments to array in component <NO COMPONENT>.`,
              range: {
                startByte: startB,
                endByte: endB,
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
            // z1 = x2 * y3 - x3 * y2
            const term1 = dae.addBinaryExpr(BinOp.Mul, x2!, y3!);
            const term2 = dae.addBinaryExpr(BinOp.Mul, x3!, y2!);
            const z1 = dae.addBinaryExpr(BinOp.Sub, term1, term2);

            // z2 = x3 * y1 - x1 * y3
            const term3 = dae.addBinaryExpr(BinOp.Mul, x3!, y1!);
            const term4 = dae.addBinaryExpr(BinOp.Mul, x1!, y3!);
            const z2 = dae.addBinaryExpr(BinOp.Sub, term3, term4);

            // z3 = x1 * y2 - x2 * y1
            const term5 = dae.addBinaryExpr(BinOp.Mul, x1!, y2!);
            const term6 = dae.addBinaryExpr(BinOp.Mul, x2!, y1!);
            const z3 = dae.addBinaryExpr(BinOp.Sub, term5, term6);

            return dae.addArrayCtorExpr([z1, z2, z3]);
          }
        }
      }
    }

    if (fnName === "zeros" || cleanFnName === "zeros" || fnName === "ones" || cleanFnName === "ones") {
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
        if (!(dae as any).exprArrayShapes) (dae as any).exprArrayShapes = new Map<number, number[]>();
        (dae as any).exprArrayShapes.set(resId, [...dimVals]);
        return resId;
      }
      if (!allStatic && argExprIds.length > 0) {
        const valLit = fnName === "ones" || cleanFnName === "ones" ? dae.addRealLiteral(1.0) : dae.addRealLiteral(0.0);
        return dae.addCallExpr("fill", [valLit, ...argExprIds]);
      }
    }

    if ((fnName === "identity" || cleanFnName === "identity") && argExprIds.length === 1) {
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

    if ((fnName === "diagonal" || cleanFnName === "diagonal") && argExprIds.length === 1) {
      let vArg = argExprIds[0]!;
      if (dae.getExprKind(vArg) === ExprKind.Name) {
        const vName = dae.interner.resolve(dae.getExprData1(vArg));
        if (vName && dae.hasArrayElements(vName)) {
          const ctor = expandVarToArrayCtor(vName, dae);
          if (ctor !== null) vArg = ctor;
        }
      }
      if (dae.getExprKind(vArg) === ExprKind.ArrayCtor) {
        const elems = getArrayCtorElements(vArg, dae);
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

    if ((fnName === "linspace" || cleanFnName === "linspace") && argExprIds.length === 3) {
      const [startId, stopId, numId] = argExprIds;
      const numVal = evalDaeExpr(numId!, dae);
      const startVal = evalDaeExpr(startId!, dae);
      const stopVal = evalDaeExpr(stopId!, dae);
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
          const nMinus1 = dae.addRealLiteral(numVal - 1);
          const diff = dae.addBinaryExpr(BinOp.Sub, stopId!, startId!);
          const step = dae.addBinaryExpr(BinOp.Div, diff, nMinus1);
          for (let i = 0; i < numVal; i++) {
            if (i === 0) {
              elems.push(startId!);
            } else if (i === numVal - 1) {
              elems.push(stopId!);
            } else {
              const iLit = dae.addRealLiteral(i);
              const scaled = dae.addBinaryExpr(BinOp.Mul, iLit, step);
              elems.push(dae.addBinaryExpr(BinOp.Add, startId!, scaled));
            }
          }
        }
        return dae.addArrayCtorExpr(elems);
      } else {
        const state = getFlatteningState(dae);
        state.linspaceCounter = (state.linspaceCounter ?? 0) + 1;
        const iterVar = dae.extensionMetadata?.isOldFrontend ? "i" : `$i_linspace_${state.linspaceCounter}`;
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

    if ((fnName === "fill" || cleanFnName === "fill") && argExprIds.length >= 2) {
      const dimVals: number[] = [];
      let allStatic = true;
      for (let i = 1; i < argExprIds.length; i++) {
        const dv = evalDaeExpr(argExprIds[i]!, dae);
        if (typeof dv === "number" && dv >= 0 && Number.isInteger(dv)) {
          dimVals.push(dv);
        } else {
          allStatic = false;
          break;
        }
      }
      if (allStatic && dimVals.length > 0) {
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

    if (fnName === "sum" || cleanFnName === "sum" || fnName === "product" || cleanFnName === "product") {
      if (argExprIds.length === 1) {
        let arrArg = argExprIds[0]!;
        if (dae.getExprKind(arrArg) === ExprKind.Name) {
          const vName = dae.interner.resolve(dae.getExprData1(arrArg));
          if (vName && dae.hasArrayElements(vName)) {
            const ctor = expandVarToArrayCtor(vName, dae);
            if (ctor !== null) arrArg = ctor;
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
          const elems = rawElems.flatMap(flattenElements);
          const isSum = fnName === "sum" || cleanFnName === "sum";
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
        return curr;
      }
    }

    if (fnName === "ndims" || cleanFnName === "ndims") {
      if (argExprIds.length >= 1) {
        const arrId = argExprIds[0]!;
        const dims = getExprDims(arrId, dae, db);
        if (dims && dims.length > 0) {
          return dae.addIntLiteral(dims.length);
        }
      }
    }

    if (fnName === "size" || cleanFnName === "size") {
      let eqNode: any = node;
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
      const startB = diagNode?.startIndex ?? diagNode?.startByte;
      const endB = diagNode?.endIndex ?? diagNode?.endByte;
      const range =
        startB != null && endB != null
          ? {
              startByte: startB,
              endByte: endB,
              startPosition: diagNode?.startPosition,
              endPosition: diagNode?.endPosition,
            }
          : undefined;

      // 1. Check named arguments (size has no named parameters, e.g. dim)
      if (namedArgs && namedArgs.size > 0) {
        const firstParam = namedArgs.keys().next().value;
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
          let cur: any = node;
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
            let cl: any = node;
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
              (dae as any).getNamedArrayShape?.(name) ??
              (dae as any).namedArrayShapes?.get(name) ??
              (dae as any).getNamedArrayShape?.(resolveScopedName(name, prefix, dae)) ??
              (dae as any).namedArrayShapes?.get(resolveScopedName(name, prefix, dae));
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

      if (dims && dims.length > 0) {
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
        const dVal = evalDaeExpr(argExprIds[1]!, dae);
        if (typeof dVal === "number") dim = Math.trunc(dVal);
      }

      const arrKind = dae.getExprKind(arrId);
      if (arrKind === ExprKind.ArrayCtor) {
        if (dim === 1 && argExprIds.length >= 2) {
          return dae.addIntLiteral(dae.getExprData1(arrId));
        }
      } else if (arrKind === ExprKind.Name) {
        const name = dae.interner.resolve(dae.getExprData1(arrId));
        if (name) {
          const namedShape =
            (dae as any).getNamedArrayShape?.(name) ??
            (dae as any).namedArrayShapes?.get(name) ??
            (dae as any).getNamedArrayShape?.(resolveScopedName(name, prefix, dae)) ??
            (dae as any).namedArrayShapes?.get(resolveScopedName(name, prefix, dae));
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
            if (cType && cType.isArray && cType.arrayDim > 0 && dim === 1) {
              return dae.addIntLiteral(cType.arrayDim);
            }
          }
        }
      }
    }

    if (fnName === "cat" || cleanFnName === "cat") {
      if (argExprIds.length >= 2) {
        const catDim = evalDaeExpr(argExprIds[0]!, dae);
        const arrs = argExprIds.slice(1).map((a) => {
          if (dae.getExprKind(a) === ExprKind.Name) {
            const vName = dae.interner.resolve(dae.getExprData1(a));
            if (vName && dae.hasArrayElements(vName)) {
              const ctor = expandVarToArrayCtor(vName, dae);
              if (ctor !== null) return ctor;
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
                if (d + 1 !== catDim && firstDims[d] > 0 && curDims[d] > 0 && firstDims[d] !== curDims[d]) {
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
          return catRecursive(catDim, arrs);
        }
      }
    }

    // 1. Inlined '0' operator call: Complex.'0'()
    if (fnName.endsWith(".'0'") || fnName.endsWith(".0") || cleanFnName.endsWith(".'0'")) {
      const recName = cleanFnName.split(".")[0]!;
      const recSym = db?.byName(recName).find((e: any) => e.kind === "Class" && flattener?.isOperatorRecordSym?.(e));
      if (recSym) {
        const ops = db?.query<Map<string, any[]> | null>("operatorFunctions", recSym.id);
        const zeroOps = ops?.get("'0'") ?? ops?.get("0");
        if (zeroOps && zeroOps.length > 0 && zeroOps[0].isInline) {
          const comps = db.childrenOf(recSym.id).filter((c: any) => c.kind === "Component");
          let args: number[];
          if (comps && comps.length > 0) {
            args = comps.map((comp: any) => {
              const compInst = db.query<any>("componentInstance", comp.id);
              const typeSpec =
                compInst?.typeSpecifier ??
                (comp.metadata as any)?.typeSpecifier ??
                db.query<string | null>("typeSpecifier", comp.id);
              if (typeSpec === "Integer" || isIntegerTypeSpec(typeSpec, db)) {
                return dae.addIntLiteral(0);
              } else if (typeSpec === "Boolean") {
                return dae.addBoolLiteral(false);
              } else if (typeSpec === "String") {
                return dae.addStringLiteral("");
              } else {
                return dae.addRealLiteral(0.0);
              }
            });
          } else {
            args = [dae.addRealLiteral(0.0), dae.addRealLiteral(0.0)];
          }
          return dae.addCallExpr(recName, args);
        }
      }
    }

    // 1.5. Unary operator function calls: not(c), -(c), +(c), abs(c)
    if ((cleanFnName === "not" || cleanFnName === "'not'") && argExprIds.length === 1) {
      if (db && flattener) {
        const dispatched = dispatchUnaryOperator("'not'", argExprIds[0]!, argNodes[0], dae, db, flattener);
        if (dispatched !== null) return dispatched;
      }
      return dae.addExpression(ExprKind.Unary, UnaryOp.Not, argExprIds[0]!);
    }
    if ((cleanFnName === "-" || cleanFnName === "'-'") && argExprIds.length === 1) {
      if (db && flattener) {
        const dispatched = dispatchUnaryOperator("'-'", argExprIds[0]!, argNodes[0], dae, db, flattener);
        if (dispatched !== null) return dispatched;
      }
    }
    if ((cleanFnName === "+" || cleanFnName === "'+'") && argExprIds.length === 1) {
      if (db && flattener) {
        const dispatched = dispatchUnaryOperator("'+'", argExprIds[0]!, argNodes[0], dae, db, flattener);
        if (dispatched !== null) return dispatched;
      }
    }

    // 2. String(c, ...) operator
    if (cleanFnName === "String" && argExprIds.length >= 1) {
      const rec = resolveOperatorRecord(argExprIds[0], argNodes[0], dae, db, flattener);
      if (rec) {
        const ops = db?.query<Map<string, any[]> | null>("operatorFunctions", rec.symId);
        const strOps = ops?.get("'String'") ?? ops?.get("String");
        if (strOps && strOps.length > 0) {
          const strOverload = strOps[0];
          flattener.usedOperatorFunctions?.set(strOverload.qualifiedName, strOverload.funcSymId);
          return dae.addCallExpr(strOverload.qualifiedName, argExprIds);
        }
      }
      if (argExprIds.length === 1 && isRealExpr(argExprIds[0]!, dae)) {
        argExprIds.push(dae.addIntLiteral(6));
        argExprIds.push(dae.addIntLiteral(0));
        argExprIds.push(dae.addBoolLiteral(true));
      }
      return dae.addCallExpr("String", argExprIds);
    }

    // 2b. Enumeration constructor: E(intVal) or AE(intVal)
    if (argExprIds.length === 1 && db && flattener && cleanFnName) {
      let targetTypeName = cleanFnName;
      const currentParentMods = flattener?.currentParentMods;
      const redeclArg = currentParentMods?.args?.find(
        (a: any) =>
          !a.isBreak &&
          (a.name === cleanFnName || a.name === cleanFnName.split(".").pop()) &&
          (a.isRedeclaration || a.redeclaredTypeSpecifier),
      );
      if (redeclArg?.redeclaredTypeSpecifier) {
        targetTypeName = redeclArg.redeclaredTypeSpecifier;
      }

      const ownerScopeId = currentParentMods?.ownerClassId ?? flattener?.currentClassId;
      let enumSym = ownerScopeId
        ? db.query<(n: string) => SymbolEntry | null>("resolveName", ownerScopeId)?.(targetTypeName)
        : null;
      if (!enumSym && flattener?.currentClassId) {
        enumSym = db.query<(n: string) => SymbolEntry | null>(
          "resolveName",
          flattener.currentClassId,
        )?.(targetTypeName);
      }
      if (!enumSym) {
        const byN = db.byName(targetTypeName.split(".").pop()!);
        if (byN.length > 0) enumSym = byN[0];
      }
      if (enumSym) {
        const targetMeta = enumSym.metadata as any;
        const isEnum =
          targetMeta?.classPrefixes === "enumeration" ||
          targetMeta?.isEnumeration ||
          Boolean((db.cstNode(enumSym.id) as any)?.text?.includes("enumeration("));
        if (isEnum) {
          let val: number | null = null;
          if (dae.getExprKind(argExprIds[0]!) === ExprKind.IntLiteral) {
            val = dae.getExprData1(argExprIds[0]!);
          } else {
            const evalRes = evaluateArenaExpression(dae, argExprIds[0]!);
            if (typeof evalRes === "number" && Number.isInteger(evalRes)) {
              val = evalRes;
            }
          }
          if (val !== null) {
            const enumLits = extractEnumLiteralsFromCst(db.cstNode(enumSym.id) as any, targetMeta);
            if (enumLits && val >= 1 && val <= enumLits.length) {
              const litName = enumLits[val - 1]!;
              const parts: string[] = [enumSym.name];
              let curr = enumSym.parentId ? db.symbol(enumSym.parentId) : null;
              while (curr && curr.id !== flattener?.currentRootClassId && curr.parentId !== null) {
                parts.unshift(curr.name);
                curr = db.symbol(curr.parentId);
              }
              const enumPrefix = parts.join(".");
              const fullLit = enumPrefix ? `${enumPrefix}.${litName}` : litName;
              return dae.addEnumLiteral(val, fullLit);
            }
          }
        }
      }
    }

    // 3. Overloaded constructor: Complex(...)
    if (db && flattener && cleanFnName) {
      const recSym = db.byName(cleanFnName).find((e: any) => e.kind === "Class" && flattener.isOperatorRecordSym?.(e));
      if (recSym) {
        const ctors = db.query<any[]>("operatorConstructors", recSym.id);
        if (ctors && ctors.length > 0) {
          for (const ctor of ctors) {
            const inParams = ctor.inputParams || [];
            let canMatch = true;
            const finalArgs: number[] = [];
            if (namedArgs.size > 0) {
              for (const param of inParams) {
                if (namedArgs.has(param.name)) {
                  finalArgs.push(namedArgs.get(param.name)!);
                } else if (param.hasDefault && param.defaultValue !== undefined) {
                  const num = Number(param.defaultValue);
                  finalArgs.push(isNaN(num) ? dae.addRealLiteral(0.0) : dae.addRealLiteral(num));
                } else {
                  canMatch = false;
                  break;
                }
              }
            } else if (argExprIds.length <= inParams.length) {
              for (let p = 0; p < inParams.length; p++) {
                if (p < argExprIds.length) {
                  const aid = argExprIds[p]!;
                  const akind = dae.getExprKind(aid);
                  const pType = inParams[p].typeSpec?.replace(/^\./, "");
                  if (
                    (akind === ExprKind.RealLiteral || akind === ExprKind.IntLiteral) &&
                    pType !== "Real" &&
                    pType !== "Integer"
                  ) {
                    canMatch = false;
                    break;
                  }
                  finalArgs.push(aid);
                } else {
                  const param = inParams[p];
                  if (param.hasDefault && param.defaultValue !== undefined) {
                    const num = Number(param.defaultValue);
                    finalArgs.push(isNaN(num) ? dae.addRealLiteral(0.0) : dae.addRealLiteral(num));
                  } else {
                    canMatch = false;
                    break;
                  }
                }
              }
            } else {
              canMatch = false;
            }

            if (canMatch) {
              flattener.usedOperatorFunctions?.set(ctor.qualifiedName, ctor.funcSymId);
              return dae.addCallExpr(ctor.qualifiedName, finalArgs);
            }
          }

          // MLS §14.2.1: Default constructor is hidden when overloaded constructor is defined.
          const candidateLines = ctors
            .map((c) => {
              const paramsStr = (c.inputParams || []).map((p: any) => `${p.typeSpec} ${p.name}`).join(", ");
              return `  ${c.qualifiedName}(${paramsStr}) => ${cleanFnName}`;
            })
            .join("\n");

          const formatArg = (aid: number): string => {
            const k = dae.getExprKind(aid);
            if (k === ExprKind.RealLiteral) {
              const val = dae.getExprRealValue(aid);
              return `/*Real*/ ${Number.isInteger(val) ? val.toFixed(1) : val}`;
            }
            if (k === ExprKind.IntLiteral) {
              return String(dae.getExprData1(aid));
            }
            return dae.interner.resolve(dae.getExprData1(aid)) || "";
          };
          const formattedArgs = argExprIds.map(formatArg).join(", ");
          const callStr = `${cleanFnName}(${formattedArgs})`;

          let eqNode: any = node;
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
          const startB = diagNode?.startIndex ?? diagNode?.startByte;
          const endB = diagNode?.endIndex ?? diagNode?.endByte;

          dae.diagnostics.push({
            severity: "error",
            code: ModelicaErrorCode.NO_MATCHING_OPERATOR_FUNCTION.code,
            message: `No matching function found for ${callStr}.\nCandidates are:\n${candidateLines}`,
            range: startB != null && endB != null ? { startByte: startB, endByte: endB } : undefined,
          });
          return -1;
        }
      }
    }

    const hasParentRedecl = Boolean(
      flattener?.currentParentMods?.args?.some(
        (a: any) =>
          !a.isBreak &&
          (a.name === cleanFnName || (!cleanFnName.includes(".") && a.name === cleanFnName)) &&
          (a.isRedeclaration || a.redeclaredTypeSpecifier),
      ),
    );

    let matchingFnSym: any = null;
    let fnDae =
      hasParentRedecl || (fnName.startsWith(".") && !cleanFnName.includes("."))
        ? undefined
        : (dae.getFunction(fnName) ?? (cleanFnName ? dae.getFunction(cleanFnName) : undefined));
    if (!fnDae && !hasParentRedecl && cleanFnName && !cleanFnName.includes(".") && !fnName.startsWith(".")) {
      fnDae = dae.getFunction(cleanFnName);
    }
    if (dae.classKind === "function" && (dae as any).functionParameterNames?.has(cleanFnName)) {
      return dae.addCallExpr(cleanFnName, argExprIds);
    }
    if (fnName.startsWith(".")) {
      fnName = cleanFnName;
    }
    if (fnDae && (fnDae as any).aliasTo) {
      fnName = (fnDae as any).aliasTo;
      fnDae = undefined;
    }
    if (
      !fnDae &&
      flattener &&
      db &&
      cleanFnName &&
      cleanFnName !== "String" &&
      cleanFnName !== "Real" &&
      cleanFnName !== "Integer" &&
      cleanFnName !== "Boolean" &&
      cleanFnName !== "print"
    ) {
      const parts = cleanFnName.split(".");
      const fnBase = parts[parts.length - 1];
      let specializedQualifiedName: string | null = null;
      let enclosingScopeId: SymbolId | undefined = undefined;

      // 1. Check if parentMods redeclared this function (e.g. RedeclareFunction1.mo)
      const currentParentMods = flattener?.currentParentMods;
      const redeclArg = currentParentMods?.args?.find(
        (a: any) =>
          !a.isBreak &&
          (a.name === cleanFnName || (parts.length === 1 && a.name === parts[0])) &&
          (a.isRedeclaration || a.redeclaredTypeSpecifier),
      );
      if (redeclArg?.redeclaredTypeSpecifier) {
        const ownerScopeId = currentParentMods?.ownerClassId ?? flattener?.currentClassId;
        const redeclTarget =
          (ownerScopeId
            ? db.query<(n: string) => SymbolEntry | null>(
                "resolveName",
                ownerScopeId,
              )?.(redeclArg.redeclaredTypeSpecifier)
            : null) ??
          (flattener?.currentClassId
            ? db.query<(n: string) => SymbolEntry | null>(
                "resolveName",
                flattener.currentClassId,
              )?.(redeclArg.redeclaredTypeSpecifier)
            : null) ??
          db
            .byName(redeclArg.redeclaredTypeSpecifier)
            .find((e: any) => (e.kind === "Class" || e.kind === "Function") && flattener.isFunctionSym?.(e));
        if (redeclTarget) {
          matchingFnSym = redeclTarget;
          const ownerClassSym = ownerScopeId ? db.symbol(ownerScopeId) : null;
          const ownerName = ownerClassSym?.name ?? "";
          if (ownerName) {
            specializedQualifiedName = `${ownerName}.${redeclArg.name}`;
            enclosingScopeId = ownerScopeId;
          }
        }
      }

      // 2. Check if cleanFnName is a qualified call on a package/class (e.g. B.usePart, ClassExtends4.mo / ClassExtends6.mo)
      if (!matchingFnSym && parts.length > 1) {
        const prefixStr = parts.slice(0, -1).join(".");
        const fnBaseName = parts[parts.length - 1]!;
        const currentScope = flattener?.currentClassId ?? flattener?.currentRootClassId;
        let prefixSym = currentScope
          ? db.query<(n: string) => SymbolEntry | null>("resolveName", currentScope)?.(prefixStr)
          : null;
        if (!prefixSym) {
          prefixSym = db.byName(parts[0]!).find((e: any) => e.kind === "Class" || e.kind === "Package") ?? null;
          for (let pIdx = 1; pIdx < parts.length - 1 && prefixSym; pIdx++) {
            prefixSym =
              db.query<(n: string) => SymbolEntry | null>("resolveName", prefixSym.id)?.(parts[pIdx]!) ?? null;
          }
        }
        if (prefixSym) {
          const memberFn = db.query<(n: string) => SymbolEntry | null>("resolveName", prefixSym.id)?.(fnBaseName);
          if (
            memberFn &&
            (memberFn.kind === "Class" || memberFn.kind === "Function") &&
            flattener.isFunctionSym?.(memberFn)
          ) {
            matchingFnSym = memberFn;
            const prefixQual = getSymbolQualifiedName(db, prefixSym.id);
            specializedQualifiedName = `${prefixQual}.${fnBaseName}`;
            enclosingScopeId = prefixSym.id;
          }
        }
      }

      // 3. Check if cleanFnName is an unqualified call in the current enclosing scope (e.g. part(a) inside B.usePart)
      if (!matchingFnSym && parts.length === 1) {
        // 3a. First check the enclosing scope for inherited functions (redeclare function extends).
        // When flattening an inherited function (e.g., usePart from A in B's scope),
        // the enclosing scope (B) may have redeclared sibling functions that should
        // take priority over the ones inherited from the original parent (A).
        const fnEncScope = (flattener as any)?.currentFunctionEnclosingScope as SymbolId | null;
        if (fnEncScope) {
          const encScopeFn = db.query<(n: string) => SymbolEntry | null>("resolveName", fnEncScope)?.(cleanFnName);
          if (
            encScopeFn &&
            (encScopeFn.kind === "Class" || encScopeFn.kind === "Function") &&
            flattener.isFunctionSym?.(encScopeFn)
          ) {
            matchingFnSym = encScopeFn;
            const encScopeSym = db.symbol(fnEncScope);
            if (encScopeSym && (encScopeSym.kind === "Class" || encScopeSym.kind === "Package")) {
              const encScopeQual = getSymbolQualifiedName(db, fnEncScope);
              specializedQualifiedName = `${encScopeQual}.${cleanFnName}`;
              enclosingScopeId = fnEncScope;
            }
          }
        }

        // 3b. Fallback: check the current scope (function or class being flattened)
        if (!matchingFnSym) {
          const currentScope = flattener?.currentClassId ?? flattener?.currentFlatteningFunctionId;
          if (currentScope) {
            const inScopeFn = db.query<(n: string) => SymbolEntry | null>("resolveName", currentScope)?.(cleanFnName);
            if (inScopeFn && inScopeFn.kind === "Component") {
              const compCi = db.query<ComponentInstanceData>("componentInstance", inScopeFn.id);
              const tSpec = compCi?.typeSpecifier;
              const targetSym = tSpec
                ? (db.query<any>("resolveName", currentScope)?.(tSpec) ??
                  db
                    .byName(tSpec.split(".").pop()!)
                    .find((e: any) => (e.kind === "Class" || e.kind === "Function") && flattener.isFunctionSym?.(e)))
                : null;
              if (targetSym && flattener.isFunctionSym?.(targetSym)) {
                return dae.addCallExpr(cleanFnName, argExprIds);
              }
            }
            if (
              inScopeFn &&
              (inScopeFn.kind === "Class" || inScopeFn.kind === "Function") &&
              flattener.isFunctionSym?.(inScopeFn)
            ) {
              matchingFnSym = inScopeFn;
              let qualScopeId = flattener?.currentClassId;
              if (qualScopeId) {
                const scopeSym = db.symbol(qualScopeId);
                if (scopeSym && flattener.isFunctionSym?.(scopeSym)) {
                  qualScopeId = scopeSym.parentId ?? qualScopeId;
                }
              }
              if (qualScopeId) {
                const scopeSym = db.symbol(qualScopeId);
                if (scopeSym && (scopeSym.kind === "Class" || scopeSym.kind === "Package")) {
                  const isClassAncestor = (
                    ancestorId: SymbolId,
                    descendantId: SymbolId,
                    visited = new Set<SymbolId>(),
                  ): boolean => {
                    if (ancestorId === descendantId) return true;
                    if (visited.has(descendantId)) return false;
                    visited.add(descendantId);
                    const extendsChildren = db.childrenOf(descendantId).filter((c) => c.kind === "Extends");
                    for (const ext of extendsChildren) {
                      const baseClass = db.query<SymbolEntry | null>("resolvedBaseClass", ext.id);
                      const baseTargets = baseClass ? [baseClass] : db.byName(ext.name);
                      for (const target of baseTargets) {
                        if (target.id === ancestorId || isClassAncestor(ancestorId, target.id, visited)) {
                          return true;
                        }
                      }
                    }
                    return false;
                  };

                  const isDirectChild = inScopeFn.parentId === qualScopeId;
                  const isInherited = inScopeFn.parentId != null && isClassAncestor(inScopeFn.parentId, qualScopeId);
                  if (isDirectChild || isInherited) {
                    const scopeQual = getSymbolQualifiedName(db, qualScopeId);
                    specializedQualifiedName = `${scopeQual}.${cleanFnName}`;
                    enclosingScopeId = qualScopeId;
                  }
                }
              }
            }
          }
        }
      }

      // 4. Fallback to existing search
      const isEncapsulatedScope = flattener?.currentClassId ? isScopeEncapsulated(db, flattener.currentClassId) : false;
      if (!matchingFnSym && !isEncapsulatedScope) {
        matchingFnSym = db.byName(fnBase).find((e: any) => {
          if (e.kind !== "Class") return false;
          if (parts.length > 1) {
            const qual = getSymbolQualifiedName(db, e.id);
            return qual === cleanFnName || qual.endsWith("." + cleanFnName);
          }
          return parts.length === 1;
        });
      }

      if (matchingFnSym && flattener.isExternalObject?.(matchingFnSym.id)) {
        const qualifiedName = getSymbolQualifiedName(db, matchingFnSym.id);
        const ctorName = `${qualifiedName}.constructor`;
        flattener.usedExternalObjects?.add(matchingFnSym.id);
        return dae.addCallExpr(ctorName, argExprIds);
      }
      if (matchingFnSym && (flattener.isRecordSym(matchingFnSym) || flattener.isOperatorRecordSym(matchingFnSym))) {
        let ctorFn = dae.getFunction(cleanFnName) ?? dae.getFunction(fnName);
        if (!ctorFn && flattener.generateRecordConstructorFor) {
          ctorFn = flattener.generateRecordConstructorFor(matchingFnSym, dae, flattener.currentRootClassId);
        }
        if (ctorFn) {
          fnDae = ctorFn;
          fnName = cleanFnName;
        }
      } else if (matchingFnSym && flattener.isFunctionSym(matchingFnSym)) {
        const isOuterFn = isOuterFunctionSymbol(db, matchingFnSym);
        const hasInnerMatch = isOuterFn && hasMatchingInnerFunction(db, flattener, matchingFnSym.name ?? fnName);
        if (flattener.isClassPartial?.(matchingFnSym.id) && !(isOuterFn && hasInnerMatch)) {
          let callRange: any = undefined;
          if (node) {
            let n: any = node;
            while (n && n.type !== "component_clause" && n.parent) {
              if (n.type === "statement" || n.type === "function_call") break;
              n = n.parent;
            }
            if (n && n.type === "component_clause") {
              callRange = {
                startPosition: n.startPosition,
                endPosition: n.endPosition,
                startByte: n.startIndex ?? n.startByte,
                endByte: n.endIndex ?? n.endByte,
              };
            } else {
              callRange = {
                startPosition: node.startPosition,
                endPosition: node.endPosition,
                startByte: node.startIndex ?? node.startByte,
                endByte: node.endIndex ?? node.endByte,
              };
            }
          }
          console.error("DIAG AT 8822", { matchingFnSym, isOuterFn, hasInnerMatch });
          dae.diagnostics.push({
            severity: "error",
            code: ModelicaErrorCode.CALLED_FUNCTION_PARTIAL.code,
            message: ModelicaErrorCode.CALLED_FUNCTION_PARTIAL.message(matchingFnSym.name || fnName),
            range: callRange,
          });
          return -1;
        }
        if (flattener.invalidInterfaceFunctionIds?.has(matchingFnSym.id)) {
          const scopeName = (flattener.currentRootClassId ? db.symbol(flattener.currentRootClassId)?.name : "") ?? "";
          let callRange: any = undefined;
          if (node) {
            let n: any = node;
            while (n && n.type !== "component_clause" && n.parent) {
              if (n.type === "statement" || n.type === "function_call") break;
              n = n.parent;
            }
            if (n && n.type === "component_clause") {
              callRange = {
                startPosition: n.startPosition,
                endPosition: n.endPosition,
              };
            } else {
              callRange = {
                startPosition: node.startPosition,
                endPosition: node.endPosition,
              };
            }
          }
          if (dae.extensionMetadata?.isOldFrontend) {
            dae.diagnostics.push({
              severity: "error",
              code: ModelicaErrorCode.CLASS_NOT_FOUND.code,
              message: ModelicaErrorCode.CLASS_NOT_FOUND.message(cleanFnName, scopeName),
              range: callRange,
            });
          }
          return dae.addCallExpr(fnName, argExprIds);
        }
        const qualifiedFnName = specializedQualifiedName ?? getSymbolQualifiedName(db, matchingFnSym.id);
        flattener.calledFunctionSymIds?.add(matchingFnSym.id);
        const isRecursiveCall = Boolean(flattener.activeFlatteningFunctionIds?.has(matchingFnSym.id));
        const fn = isRecursiveCall
          ? (dae.getFunction(qualifiedFnName) ?? dae.getFunction(cleanFnName) ?? dae.getFunction(fnName) ?? dae)
          : flattener.flattenFunction(matchingFnSym.id, qualifiedFnName, undefined, dae, enclosingScopeId);
        if (isRecursiveCall) {
          (fn as any).isRecursive = true;
        }
        (fn as any).symId = matchingFnSym.id;
        if (fn.diagnostics.some((d: any) => d.severity === "error")) {
          for (const d of fn.diagnostics) {
            if (!dae.diagnostics.some((existing: any) => existing.message === d.message)) {
              dae.diagnostics.push(d);
            }
          }
          flattener.failedFunctionIds?.add(matchingFnSym.id);
          const hasInterfaceError = fn.diagnostics.some(
            (d: any) =>
              d.severity === "error" &&
              d.code !== ModelicaErrorCode.EXTERNAL_WITH_ALGORITHM.code &&
              d.code !== ModelicaErrorCode.CYCLIC_FUNCTION_COMPONENTS.code &&
              !d.message.includes("looking for a function or record"),
          );
          if (hasInterfaceError) {
            flattener.invalidInterfaceFunctionIds?.add(matchingFnSym.id);
            const scopeName = (flattener.currentRootClassId ? db.symbol(flattener.currentRootClassId)?.name : "") ?? "";
            let callRange: any = undefined;
            if (node) {
              let n: any = node;
              while (n && n.type !== "component_clause" && n.parent) {
                if (n.type === "statement" || n.type === "function_call") break;
                n = n.parent;
              }
              if (n && n.type === "component_clause") {
                callRange = {
                  startPosition: n.startPosition,
                  endPosition: n.endPosition,
                };
              } else {
                callRange = {
                  startPosition: node.startPosition,
                  endPosition: node.endPosition,
                };
              }
            }
            if (dae.extensionMetadata?.isOldFrontend) {
              dae.diagnostics.push({
                severity: "error",
                code: ModelicaErrorCode.CLASS_NOT_FOUND.code,
                message: ModelicaErrorCode.CLASS_NOT_FOUND.message(cleanFnName, scopeName),
                range: callRange,
              });
            }
          }
          return dae.addCallExpr(fnName, argExprIds);
        }
        if ((fn as any).aliasTo) {
          fnName = (fn as any).aliasTo;
          fnDae = undefined;
        } else {
          dae.addFunction(qualifiedFnName, fn);
          if (!specializedQualifiedName) {
            dae.addFunction(cleanFnName, fn);
            dae.addFunction(fnName, fn);
            if (parts.length === 1 && fnBase) dae.addFunction(fnBase, fn);
          }

          const isBuiltinExt = Boolean(fn.externalDecl && fn.externalDecl.includes('"builtin"'));
          if (!isBuiltinExt) {
            let rootDae: any = (flattener as any)?.currentRootDae ?? dae;
            while (rootDae.parentDae) rootDae = rootDae.parentDae;
            rootDae.addFunction(qualifiedFnName, fn);
            if (fn.functions && fn.functions.size > 0) {
              for (const [nestedName, nestedFn] of fn.functions.entries()) {
                rootDae.addFunction(nestedName, nestedFn);
              }
            }
            fnDae = fn;
            fnName = qualifiedFnName;
          } else {
            const match = fn.externalDecl!.match(/=\s*([a-zA-Z0-9_]+)\s*\(/);
            fnName = match ? match[1] : fnBase || fn.name.split(".").pop()!;
            fnDae = undefined;
          }
        }
        if (qualifiedFnName.startsWith("Modelica.Math.")) {
          const mathBase = qualifiedFnName.slice("Modelica.Math.".length);
          if (
            mathBase === "sin" ||
            mathBase === "cos" ||
            mathBase === "tan" ||
            mathBase === "asin" ||
            mathBase === "acos" ||
            mathBase === "atan" ||
            mathBase === "atan2" ||
            mathBase === "sinh" ||
            mathBase === "cosh" ||
            mathBase === "tanh" ||
            mathBase === "exp" ||
            mathBase === "log" ||
            mathBase === "log10" ||
            mathBase === "sqrt"
          ) {
            fnName = mathBase;
            fnDae = undefined;
          }
        }
      } else if (!matchingFnSym) {
        const isBuiltin =
          SCALAR_VECTORIZABLE_FUNCTIONS.has(cleanFnName) ||
          (!cleanFnName.includes(".") && SCALAR_VECTORIZABLE_FUNCTIONS.has(fnBase)) ||
          BUILTIN_FUNCTIONS.has(cleanFnName) ||
          (!cleanFnName.includes(".") && BUILTIN_FUNCTIONS.has(fnBase)) ||
          cleanFnName === "size" ||
          cleanFnName === "ndims" ||
          cleanFnName === "min" ||
          cleanFnName === "max" ||
          cleanFnName === "sum" ||
          cleanFnName === "product" ||
          cleanFnName === "cross" ||
          cleanFnName === "skew" ||
          cleanFnName === "array" ||
          cleanFnName === "zeros" ||
          cleanFnName === "ones" ||
          cleanFnName === "fill" ||
          cleanFnName === "identity" ||
          cleanFnName === "diagonal" ||
          cleanFnName === "linspace" ||
          cleanFnName === "transpose" ||
          cleanFnName === "symmetric" ||
          cleanFnName === "cat" ||
          cleanFnName === "inStream" ||
          cleanFnName === "actualStream" ||
          cleanFnName === "spatialDistribution" ||
          cleanFnName === "cardinality" ||
          cleanFnName === "homotopy" ||
          cleanFnName === "semiLinear" ||
          cleanFnName === "delay" ||
          cleanFnName === "smooth" ||
          cleanFnName === "sample" ||
          cleanFnName === "reinit" ||
          cleanFnName === "assert" ||
          cleanFnName === "terminate" ||
          cleanFnName === "initial" ||
          cleanFnName === "terminal" ||
          cleanFnName === "div" ||
          cleanFnName === "mod" ||
          cleanFnName === "rem" ||
          cleanFnName === "String" ||
          cleanFnName === "Real" ||
          cleanFnName === "Integer" ||
          cleanFnName === "Boolean";
        if (!isBuiltin) {
          const scopeId = (flattener as any).currentFlatteningFunctionId ?? flattener.currentRootClassId;
          const scopeName = (scopeId ? db.symbol(scopeId)?.name : "") ?? "";
          let callRange: any = undefined;
          if (node) {
            let n: any = node;
            while (n && n.type !== "component_clause" && n.parent) {
              if (n.type === "statement" || n.type === "function_call") break;
              n = n.parent;
            }
            if (n && n.type === "component_clause") {
              callRange = {
                startPosition: n.startPosition,
                endPosition: n.endPosition,
              };
            } else {
              callRange = {
                startPosition: node.startPosition,
                endPosition: node.endPosition,
              };
            }
          }
          dae.diagnostics.push({
            severity: "error",
            code: ModelicaErrorCode.CLASS_NOT_FOUND.code,
            message: ModelicaErrorCode.CLASS_NOT_FOUND.message(cleanFnName, scopeName),
            range: callRange,
          });
          return -1;
        }
      }
    }

    if (fnDae) {
      if (flattener.options.omcCompatibility) {
        // Check for cyclic dependencies in default arguments
        const unfilledDefaults = new Map<string, Set<string>>();
        const positionalCount = argExprIds.length;
        let inCount = 0;
        for (let i = 0; i < fnDae.varCount; i++) {
          if (fnDae.getVarCausality(i) === Causality.Input) {
            const inputName = fnDae.getVarName(i);
            const isProvided = namedArgs.has(inputName) || inCount < positionalCount;
            inCount++;
            if (!isProvided) {
              const defExprId = fnDae.getVarExpression(i);
              if (typeof defExprId === "number" && defExprId >= 0) {
                const names = fnDae.collectExprVarNames(defExprId);
                unfilledDefaults.set(inputName, names);
              }
            }
          }
        }
        if (unfilledDefaults.size > 1) {
          const visited = new Set<string>();
          const inStack = new Set<string>();
          let cycleArg: string | null = null;
          const hasCycle = (curr: string): boolean => {
            visited.add(curr);
            inStack.add(curr);
            const neighbors = unfilledDefaults.get(curr);
            if (neighbors) {
              for (const next of neighbors) {
                const callPrefix = cleanFnName.includes(".") ? cleanFnName.slice(0, cleanFnName.lastIndexOf(".")) : "";
                const isOuterVar =
                  (callPrefix &&
                    (dae.getVarIdxByName(`${callPrefix}.${next}`) >= 0 ||
                      dae.getVarIdxByName(`${callPrefix}.${next}[1]`) >= 0)) ||
                  dae.getVarIdxByName(next) >= 0 ||
                  dae.getVarIdxByName(`${next}[1]`) >= 0;
                if (isOuterVar) {
                  continue;
                }
                if (unfilledDefaults.has(next)) {
                  if (inStack.has(next)) {
                    cycleArg = next;
                    return true;
                  }
                  if (!visited.has(next) && hasCycle(next)) {
                    return true;
                  }
                }
              }
            }
            inStack.delete(curr);
            return false;
          };
          for (const name of unfilledDefaults.keys()) {
            if (!visited.has(name) && hasCycle(name)) break;
          }
          if (cycleArg) {
            let callRange: any = undefined;
            if (node) {
              let n: any = node;
              while (n && n.type !== "component_clause" && n.parent) {
                if (n.type === "statement" || n.type === "function_call") break;
                n = n.parent;
              }
              if (n && n.type === "component_clause") {
                callRange = {
                  startPosition: n.startPosition,
                  endPosition: n.endPosition,
                };
              } else {
                callRange = {
                  startPosition: node.startPosition,
                  endPosition: node.endPosition,
                };
              }
            }
            dae.diagnostics.push({
              severity: "error",
              code: ModelicaErrorCode.FUNCTION_DEFAULT_ARG_CYCLE.code,
              message: ModelicaErrorCode.FUNCTION_DEFAULT_ARG_CYCLE.message(cycleArg),
              range: callRange,
            });
            return -1;
          }
        }
      }

      const positionalArgs = [...argExprIds];
      const newArgExprIds: number[] = [];
      const inputSubstitutions = new Map<string, number>();
      let posIdx = 0;
      for (let i = 0; i < fnDae.varCount; i++) {
        if (fnDae.getVarCausality(i) === Causality.Input) {
          const inputName = fnDae.getVarName(i);
          let aid: number | undefined = undefined;
          let argNode: any = undefined;
          if (namedArgs.has(inputName)) {
            aid = namedArgs.get(inputName)!;
          } else if (posIdx < positionalArgs.length) {
            aid = positionalArgs[posIdx];
            argNode = argNodes[posIdx];
            posIdx++;
          } else if (flattener.options.omcCompatibility) {
            const defExprId = fnDae.getVarExpression(i);
            if (typeof defExprId === "number" && defExprId >= 0) {
              const callPrefix = cleanFnName.includes(".") ? cleanFnName.slice(0, cleanFnName.lastIndexOf(".")) : "";
              const defId = copyExprBetweenDaes(fnDae, defExprId, dae, inputSubstitutions, callPrefix);
              if (defId >= 0) {
                aid = defId;
              }
            }
          }
          if (aid !== undefined && aid >= 0) {
            let substVal = aid;
            const expectedShape = fnDae.getVarShape(i) ?? [];
            const cVal = evalDaeExpr(aid, dae);
            if (cVal !== null) {
              if (expectedShape.length === 0 && typeof cVal === "number") {
                const foldedId = addArenaValueAsExpr(dae, cVal);
                if (foldedId >= 0) substVal = foldedId;
              } else if (expectedShape.length > 0 && Array.isArray(cVal)) {
                const foldedId = addArenaValueAsExpr(dae, cVal);
                if (foldedId >= 0) substVal = foldedId;
              }
            }
            inputSubstitutions.set(inputName, substVal);
            const actualDims = getExprDims(aid, dae, flattener.db) ?? [];
            const isColonDim = (d: number) => d === -1;
            const shapeMatches =
              expectedShape.length === actualDims.length &&
              expectedShape.every(
                (ed, idx) => isColonDim(ed) || isColonDim(actualDims[idx]!) || ed === actualDims[idx]!,
              );
            if (!shapeMatches) {
              const printer = new ArenaDAEPrinter({ write: () => {} }, dae, true);
              const callArgsStr = positionalArgs.map((paId) => printer.printExprToString(paId)).join(", ");
              const callExpr = `${cleanFnName || fnName}(${callArgsStr})`;

              let retTypeStr = "Real";
              for (let vi = 0; vi < fnDae.varCount; vi++) {
                if (fnDae.getVarCausality(vi) === Causality.Output) {
                  const vt = fnDae.getVarType(vi);
                  retTypeStr =
                    vt === VarType.Integer
                      ? "Integer"
                      : vt === VarType.Boolean
                        ? "Boolean"
                        : vt === VarType.String
                          ? "String"
                          : "Real";
                  break;
                }
              }

              const callArgSigParts: string[] = [];
              const candArgSigParts: string[] = [];
              let inP = 0;
              for (let vi = 0; vi < fnDae.varCount; vi++) {
                if (fnDae.getVarCausality(vi) === Causality.Input) {
                  const pName = fnDae.getVarName(vi);
                  const expType = fnDae.getVarType(vi);
                  const expShape = fnDae.getVarShape(vi) ?? [];
                  const expTypeName =
                    expType === VarType.Integer
                      ? "Integer"
                      : expType === VarType.Boolean
                        ? "Boolean"
                        : expType === VarType.String
                          ? "String"
                          : "Real";
                  const expShapeStr = expShape.length > 0 ? `[${expShape.join(", ")}]` : "";
                  candArgSigParts.push(`${expTypeName}${expShapeStr} ${pName}`);

                  const provId = positionalArgs[inP];
                  if (provId !== undefined) {
                    const provType = inferArenaExprVarType(dae, provId);
                    const provDims = getExprDims(provId, dae, flattener.db) ?? [];
                    const provTypeName =
                      provType === VarType.Integer
                        ? "Integer"
                        : provType === VarType.Boolean
                          ? "Boolean"
                          : provType === VarType.String
                            ? "String"
                            : "Real";
                    const provDimsStr = provDims.length > 0 ? `[${provDims.join(", ")}]` : "";
                    callArgSigParts.push(`${provTypeName}${provDimsStr} ${pName}`);
                  }
                  inP++;
                }
              }

              const callSig = `.${cleanFnName || fnName}<function>(${callArgSigParts.join(", ")}) => ${retTypeStr} in component <NO COMPONENT>`;
              const candidateSig = `.${cleanFnName || fnName}<function>(${candArgSigParts.join(", ")}) => ${retTypeStr}`;

              const startB = node.startIndex ?? node.startByte;
              const endB = node.endIndex ?? node.endByte;
              dae.diagnostics.push({
                severity: "error",
                code: ModelicaErrorCode.NO_MATCHING_FUNCTION.code,
                message: ModelicaErrorCode.NO_MATCHING_FUNCTION.message(callExpr, callSig, candidateSig),
                range:
                  startB != null && endB != null
                    ? {
                        startByte: startB,
                        endByte: endB,
                        startPosition: node.startPosition,
                        endPosition: node.endPosition,
                      }
                    : undefined,
              });
              return -1;
            }

            const expectedType = fnDae.getVarType(i);
            const expectedCustomType = fnDae.getVarCustomType(i);
            const providedType = inferArenaExprVarType(dae, aid);
            let finalType = providedType;
            if (
              expectedType === VarType.Real &&
              !expectedCustomType &&
              (providedType === VarType.Integer || providedType === null)
            ) {
              aid = castToRealExpr(aid, dae);
              finalType = VarType.Real;
            }
            if (
              finalType !== null &&
              !isAssignableType(finalType, expectedType, { intEnumConversion: flattener?.options?.intEnumConversion })
            ) {
              let eqNode: any = node;
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
              const startB = diagNode?.startIndex ?? diagNode?.startByte;
              const endB = diagNode?.endIndex ?? diagNode?.endByte;
              const argText = argNode?.text?.trim() ?? "...";
              const callText = `${cleanFnName || fnName}(${inputName}=${argText})`;
              dae.diagnostics.push({
                severity: "error",
                code: ModelicaErrorCode.FUNCTION_ARG_TYPE_MISMATCH.code,
                message: ModelicaErrorCode.FUNCTION_ARG_TYPE_MISMATCH.message(
                  callText,
                  String(newArgExprIds.length + 1),
                  varTypeName(finalType),
                  varTypeName(expectedType),
                ),
                range: {
                  startByte: startB,
                  endByte: endB,
                  startPosition: diagNode?.startPosition,
                  endPosition: diagNode?.endPosition,
                },
              });
              return -1;
            }
            newArgExprIds.push(aid);
          }
        }
      }
      argExprIds = newArgExprIds;
    }

    if (fnDae && !(fnDae as any).isOperatorRecord && !fnDae.description?.includes("record constructor")) {
      let inputParamIdx = 0;
      for (let i = 0; i < fnDae.varCount; i++) {
        if (fnDae.getVarCausality(i) === Causality.Input) {
          const reqVariability = fnDae.getVarVariability(i);
          if (reqVariability === Variability.Constant) {
            const actualArgId = argExprIds[inputParamIdx];
            if (actualArgId !== undefined && exprContainsNonConstantRef(actualArgId, dae)) {
              const paramName = fnDae.getVarName(i);
              const argNode = argNodes[inputParamIdx];
              const argText = argNode?.text?.trim() ?? dae.interner.resolve(dae.getExprData1(actualArgId)) ?? "";
              const funcName = cleanFnName || fnDae.name;

              let compClause: any = node;
              while (
                compClause &&
                compClause.type !== "component_clause" &&
                compClause.type !== "simple_equation" &&
                !compClause.type?.endsWith("_equation") &&
                compClause.type !== "statement"
              ) {
                compClause = compClause.parent;
              }
              const diagNode = compClause ?? node;
              const startB = diagNode?.startIndex ?? diagNode?.startByte;
              const endB = diagNode?.endIndex ?? diagNode?.endByte;
              dae.diagnostics.push({
                severity: "error",
                code: ModelicaErrorCode.FUNCTION_ARG_VARIABILITY.code,
                message: ModelicaErrorCode.FUNCTION_ARG_VARIABILITY.message(paramName, argText, funcName, "constant"),
                range: {
                  startByte: startB,
                  endByte: endB,
                  startPosition: diagNode?.startPosition,
                  endPosition: diagNode?.endPosition,
                },
              });
              return -1;
            }
          }
          inputParamIdx++;
        }
      }
    }

    if (
      flattener.options.omcCompatibility &&
      fnDae &&
      fnDae.name.endsWith("Vectors.interpolate") &&
      argExprIds.length > 0
    ) {
      const firstArg = argExprIds[0];
      if (firstArg !== undefined && firstArg >= 0 && dae.getExprKind(firstArg) === ExprKind.ArrayCtor) {
        const elems = getArrayCtorElements(firstArg, dae);
        const literalElems: number[] = [];
        let allLiterals = true;
        for (const e of elems) {
          const val = evalDaeExpr(e, dae);
          if (typeof val === "number") {
            literalElems.push(dae.addRealLiteral(val));
          } else {
            allLiterals = false;
            break;
          }
        }
        if (allLiterals && literalElems.length === elems.length) {
          argExprIds[0] = dae.addArrayCtorExpr(literalElems);
        }
      }
    }

    if (fnDae && !(fnDae as any).isOperatorRecord && !fnDae.description?.includes("record constructor")) {
      let hasOutputExpr = false;
      for (let i = 0; i < fnDae.varCount; i++) {
        if (fnDae.getVarCausality(i) === Causality.Output) {
          const expr = fnDae.getVarExpression(i);
          if (typeof expr === "number" && expr >= 0) {
            hasOutputExpr = true;
            break;
          }
        }
      }

      if (
        flattener?.options?.omcCompatibility &&
        !(fnDae as any).isBeingFlattened &&
        !(fnDae as any).isRecursive &&
        (!(fnDae as any).symId || !flattener.activeFlatteningFunctionIds?.has((fnDae as any).symId)) &&
        fnDae.eqCount === 0 &&
        fnDae.algorithmSections.length === 0 &&
        !fnDae.externalDecl &&
        !hasOutputExpr
      ) {
        let firstOutputType: VarType | null = null;
        let outputCount = 0;
        for (let i = 0; i < fnDae.varCount; i++) {
          if (fnDae.getVarCausality(i) === Causality.Output) {
            if (outputCount === 0) firstOutputType = fnDae.getVarType(i);
            outputCount++;
          }
        }
        if (outputCount === 1 && firstOutputType !== null) {
          (fnDae as any).wasCalled = true;
          if (firstOutputType === VarType.Integer) return dae.addIntLiteral(0);
          if (firstOutputType === VarType.Boolean) return dae.addBoolLiteral(false);
          if (firstOutputType === VarType.String) return dae.addStringLiteral("");
          return dae.addRealLiteral(0.0);
        }
      }

      let allConstant = true;
      const constArgs: any[] = [];
      for (const aid of argExprIds) {
        if (exprContainsNonConstantRef(aid, dae)) {
          allConstant = false;
          break;
        }
        const cVal = evalDaeExpr(aid, dae);
        if (cVal === null) {
          allConstant = false;
          break;
        }
        constArgs.push(cVal);
      }
      if (
        allConstant &&
        !fnDae.isImpure &&
        !(fnDae as any).isBeingFlattened &&
        !(fnDae as any).isRecursive &&
        (!(fnDae as any).symId || !flattener.activeFlatteningFunctionIds?.has((fnDae as any).symId))
      ) {
        try {
          const fnInternId = typeof fnName === "string" ? dae.interner.intern(fnName) : fnName;
          const outVal = evaluateArenaFunctionCall(
            dae,
            fnInternId,
            constArgs,
            db,
            flattener?.currentRootClassId ?? undefined,
          );
          if (outVal !== null && outVal !== undefined) {
            (fnDae as any).wasCalled = true;
            let outputCount = 0;
            let firstOutputType: VarType | null = null;
            const outputTypes: VarType[] = [];
            for (let i = 0; i < fnDae.varCount; i++) {
              if (fnDae.getVarCausality(i) === Causality.Output) {
                if (outputCount === 0) {
                  firstOutputType = fnDae.getVarType(i);
                }
                outputTypes.push(fnDae.getVarType(i));
                outputCount++;
              }
            }
            if (tupleContext && Array.isArray(outVal) && outputCount > 1) {
              const tupleElemExprIds: number[] = [];
              for (let i = 0; i < outVal.length; i++) {
                const elemId = addArenaValueAsExpr(dae, outVal[i], outputTypes[i] ?? undefined);
                if (elemId >= 0) tupleElemExprIds.push(elemId);
              }
              if (tupleElemExprIds.length === outVal.length) {
                return dae.addTupleExpr(tupleElemExprIds);
              }
            }
            const firstVal = Array.isArray(outVal) && outputCount > 1 ? outVal[0] : outVal;
            const inlinedId = addArenaValueAsExpr(dae, firstVal, firstOutputType ?? undefined);
            if (inlinedId >= 0) return inlinedId;
          }
        } catch (err: any) {
          if (
            err?.code === 4009 ||
            err?.message?.includes("causes a cyclic dependency") ||
            err?.message?.includes("assert triggered:")
          ) {
            let compClause: any = node;
            while (compClause && compClause.type !== "component_clause") {
              compClause = compClause.parent;
            }
            const diagNode = compClause ?? node;
            const startB = err.range?.startByte ?? diagNode?.startIndex ?? diagNode?.startByte;
            const endB = err.range?.endByte ?? diagNode?.endIndex ?? diagNode?.endByte;
            dae.diagnostics.push({
              severity: "error",
              code: err?.code ?? 0,
              message: err.message,
              range: {
                startByte: startB,
                endByte: endB,
                startPosition: err.range?.startPosition ?? diagNode?.startPosition,
                endPosition: err.range?.endPosition ?? diagNode?.endPosition,
              },
            });
            return -1;
          }
          // ignore evaluation error and fall back to call expression
        }
      }

      if (
        !fnDae.isImpure &&
        !(fnDae as any).isBeingFlattened &&
        !(fnDae as any).isRecursive &&
        (!(fnDae as any).symId || !flattener.activeFlatteningFunctionIds?.has((fnDae as any).symId)) &&
        (fnDae as any).isEarlyInline &&
        fnDae.stmtCount === 1 &&
        fnDae.getStmtKind(0) === StmtKind.Assignment
      ) {
        const subs = new Map<string, number>();
        let inputIdx = 0;
        for (let i = 0; i < fnDae.varCount; i++) {
          if (fnDae.getVarCausality(i) === Causality.Input) {
            const inName = fnDae.getVarName(i);
            if (inputIdx < argExprIds.length) {
              subs.set(inName, argExprIds[inputIdx]);
            }
            inputIdx++;
          }
        }
        const rhsExprId = fnDae.getStmtLeft(0);
        if (rhsExprId >= 0) {
          const inlinedId = copyExprBetweenDaes(fnDae, rhsExprId, dae, subs);
          if (inlinedId >= 0) {
            (fnDae as any).wasInlined = true;
            return inlinedId;
          }
        }
      }
      let outCount = 0;
      for (let i = 0; i < fnDae.varCount; i++) {
        if (fnDae.getVarCausality(i) === Causality.Output) outCount++;
      }
      const targetFnCallName =
        fnDae.externalDecl && fnDae.externalDecl.includes('"builtin"')
          ? typeof fnName === "string"
            ? fnName
            : fnDae.name.split(".").pop()!
          : fnDae.name;
      let inIdx = 0;
      for (let vi = 0; vi < fnDae.varCount; vi++) {
        if (fnDae.getVarCausality(vi) === Causality.Input) {
          if (inIdx < argExprIds.length) {
            const expectedType = fnDae.getVarType(vi);
            if (expectedType === VarType.Real && !fnDae.getVarCustomType(vi) && !isRealExpr(argExprIds[inIdx]!, dae)) {
              argExprIds[inIdx] = castToRealExpr(argExprIds[inIdx]!, dae);
            }
          }
          inIdx++;
        }
      }
      let callExprId = dae.addCallExpr(targetFnCallName, argExprIds);
      if (outCount > 1 && !tupleContext) {
        callExprId = dae.addSubscriptExpr(callExprId, [dae.addIntLiteral(1)]);
      }
      return callExprId;
    }

    if (cleanFnName === "assert") {
      let eqNode: any = node;
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
      const startB = diagNode?.startIndex ?? diagNode?.startByte;
      const endB = diagNode?.endIndex ?? diagNode?.endByte;
      const range =
        startB != null && endB != null
          ? {
              startByte: startB,
              endByte: endB,
              startPosition: diagNode?.startPosition,
              endPosition: diagNode?.endPosition,
            }
          : undefined;

      // Arg 1: condition: Boolean
      if (argExprIds.length >= 1) {
        const aid0 = argExprIds[0]!;
        const t0 = inferArenaExprVarType(dae, aid0);
        if (t0 !== null && t0 !== VarType.Boolean) {
          const actualType = varTypeName(t0);
          const argText = argNodes[0]?.text?.trim() ?? "...";
          const callText = `assert(condition=${argText})`;
          dae.diagnostics.push({
            severity: "error",
            code: ModelicaErrorCode.FUNCTION_ARG_TYPE_MISMATCH.code,
            message: ModelicaErrorCode.FUNCTION_ARG_TYPE_MISMATCH.message(callText, "1", actualType, "Boolean"),
            range,
          });
          return -1;
        }
      }

      // Arg 2: message: String
      if (argExprIds.length >= 2) {
        const aid1 = argExprIds[1]!;
        const t1 = inferArenaExprVarType(dae, aid1);
        if (t1 !== null && t1 !== VarType.String) {
          const actualType = varTypeName(t1);
          const argText = argNodes[1]?.text?.trim() ?? "...";
          const callText = `assert(message=${argText})`;
          dae.diagnostics.push({
            severity: "error",
            code: ModelicaErrorCode.FUNCTION_ARG_TYPE_MISMATCH.code,
            message: ModelicaErrorCode.FUNCTION_ARG_TYPE_MISMATCH.message(callText, "2", actualType, "String"),
            range,
          });
          return -1;
        }
      }

      // Arg 3: level: enumeration AssertionLevel(warning, error)
      if (argExprIds.length >= 3) {
        const aid2 = argExprIds[2]!;
        const t2 = inferArenaExprVarType(dae, aid2);
        if (t2 !== null && t2 !== VarType.Enumeration) {
          const actualType = varTypeName(t2);
          const argText = argNodes[2]?.text?.trim() ?? "...";
          const callText = `assert(level=${argText})`;
          dae.diagnostics.push({
            severity: "error",
            code: ModelicaErrorCode.FUNCTION_ARG_TYPE_MISMATCH.code,
            message: ModelicaErrorCode.FUNCTION_ARG_TYPE_MISMATCH.message(
              callText,
              "3",
              actualType,
              "enumeration AssertionLevel(warning, error)",
            ),
            range,
          });
          return -1;
        }

        // Check variability: must be parameter or constant
        const argText = argNodes[2]?.text?.trim() ?? "";
        let vIdx = -1;
        if (dae.getExprKind(aid2) === ExprKind.Name) {
          const vName = dae.interner.resolve(dae.getExprData1(aid2));
          vIdx = dae.getVarIdxByName(vName);
          if (vIdx < 0 && prefix) vIdx = dae.getVarIdxByName(`${prefix}.${vName}`);
        }
        if (vIdx < 0 && argText) {
          vIdx = dae.getVarIdxByName(argText);
          if (vIdx < 0 && prefix) vIdx = dae.getVarIdxByName(`${prefix}.${argText}`);
        }
        if (vIdx >= 0) {
          const v = dae.getVarVariability(vIdx);
          if (v !== Variability.Parameter && v !== Variability.Constant) {
            const varbStr =
              v === Variability.Continuous && dae.getVarType(vIdx) === VarType.Real ? "continuous" : "discrete";
            dae.diagnostics.push({
              severity: "error",
              code: ModelicaErrorCode.FUNCTION_ARG_VARIABILITY.code,
              message: ModelicaErrorCode.FUNCTION_ARG_VARIABILITY.message(
                "level",
                argText,
                "assert",
                "parameter",
                varbStr,
              ),
              range,
            });
            return -1;
          }
        }
      }
    }

    if (cleanFnName === "terminate") {
      let eqNode: any = node;
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
      const startB = diagNode?.startIndex ?? diagNode?.startByte;
      const endB = diagNode?.endIndex ?? diagNode?.endByte;
      const range =
        startB != null && endB != null
          ? {
              startByte: startB,
              endByte: endB,
              startPosition: diagNode?.startPosition,
              endPosition: diagNode?.endPosition,
            }
          : undefined;

      if (argExprIds.length >= 1) {
        const aid0 = argExprIds[0]!;
        const t0 = inferArenaExprVarType(dae, aid0);
        if (t0 !== null && t0 !== VarType.String) {
          const actualType = varTypeName(t0);
          const argText = argNodes[0]?.text?.trim() ?? "...";
          const callText = `terminate(message=${argText})`;
          dae.diagnostics.push({
            severity: "error",
            code: ModelicaErrorCode.FUNCTION_ARG_TYPE_MISMATCH.code,
            message: ModelicaErrorCode.FUNCTION_ARG_TYPE_MISMATCH.message(callText, "1", actualType, "String"),
            range,
          });
          return -1;
        }
      }
    }

    const cleanFn = cleanFnName || (typeof fnName === "string" ? fnName.split(".").pop() : fnName);
    if (cleanFn === "div" || cleanFn === "rem" || cleanFn === "mod" || SCALAR_VECTORIZABLE_FUNCTIONS.has(cleanFn)) {
      let allConstant = true;
      const constArgs: number[] = [];
      for (const aid of argExprIds) {
        if (exprContainsNonConstantRef(aid, dae)) {
          allConstant = false;
          break;
        }
        const cVal = evalDaeExpr(aid, dae);
        if (typeof cVal !== "number") {
          allConstant = false;
          break;
        }
        constArgs.push(cVal);
      }
      if (allConstant && constArgs.length === argExprIds.length) {
        if (cleanFn === "div" && constArgs.length === 2) {
          const res = constArgs[1] !== 0 ? Math.trunc(constArgs[0] / constArgs[1]) : 0;
          const isInt =
            inferArenaExprVarType(dae, argExprIds[0]!) === VarType.Integer &&
            inferArenaExprVarType(dae, argExprIds[1]!) === VarType.Integer;
          return isInt ? dae.addIntLiteral(res) : dae.addRealLiteral(res);
        }
        if (cleanFn === "rem" && constArgs.length === 2) {
          const res = constArgs[1] !== 0 ? constArgs[0] - Math.trunc(constArgs[0] / constArgs[1]) * constArgs[1] : 0;
          const isInt =
            inferArenaExprVarType(dae, argExprIds[0]!) === VarType.Integer &&
            inferArenaExprVarType(dae, argExprIds[1]!) === VarType.Integer;
          return isInt ? dae.addIntLiteral(res) : dae.addRealLiteral(res);
        }
        if (cleanFn === "mod" && constArgs.length === 2) {
          const res = constArgs[1] !== 0 ? constArgs[0] - Math.floor(constArgs[0] / constArgs[1]) * constArgs[1] : 0;
          const isInt =
            inferArenaExprVarType(dae, argExprIds[0]!) === VarType.Integer &&
            inferArenaExprVarType(dae, argExprIds[1]!) === VarType.Integer;
          return isInt ? dae.addIntLiteral(res) : dae.addRealLiteral(res);
        }
        const scalarBuiltin = SCALAR_VECTORIZABLE_FUNCTIONS.get(cleanFn);
        if (scalarBuiltin?.fold && constArgs.length === scalarBuiltin.arity) {
          if ((cleanFn === "acos" || cleanFn === "asin") && (constArgs[0]! < -1 || constArgs[0]! > 1)) {
            let cur: any = node;
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
              message: `Argument ${constArgs[0]} of ${cleanFn} is out of range (-1 <= x <= 1)`,
              range: diagRange,
            });
            return -1;
          }
          const val = scalarBuiltin.fold(...constArgs);
          const isInt =
            cleanFn === "sign" || (cleanFn === "abs" && inferArenaExprVarType(dae, argExprIds[0]!) === VarType.Integer);
          return isInt ? dae.addIntLiteral(Math.round(val)) : dae.addRealLiteral(val);
        }
      }
    }

    if (db && fnName) {
      let fnSym: any = null;
      if (flattener?.currentRootClassId) {
        const resolver =
          db.query<any>("resolveName", flattener.currentRootClassId) ??
          db.query<any>("resolveSimpleName", flattener.currentRootClassId);
        if (resolver) fnSym = resolver(fnName);
      }
      if (!fnSym) {
        fnSym = db.byName(fnName).find((s: any) => s.kind === "Function" || s.kind === "Class");
      }
      const isOuterFn = isOuterFunctionSymbol(db, fnSym);
      const hasInnerMatch = isOuterFn && hasMatchingInnerFunction(db, flattener, fnSym?.name ?? fnName);
      if (fnSym && flattener?.isClassPartial(fnSym.id) && !(isOuterFn && hasInnerMatch)) {
        let cur: any = node;
        while (
          cur &&
          cur.type !== "simple_equation" &&
          cur.type !== "component_clause" &&
          cur.type !== "statement" &&
          cur.type !== "assignment_statement" &&
          cur.parent
        ) {
          cur = cur.parent;
        }
        const diagNode = cur ?? node;
        const startB = diagNode?.startIndex ?? diagNode?.startByte;
        const endB = diagNode?.endIndex ?? diagNode?.endByte;
        dae.diagnostics.push({
          severity: "error",
          code: ModelicaErrorCode.CALLED_FUNCTION_PARTIAL.code,
          message: ModelicaErrorCode.CALLED_FUNCTION_PARTIAL.message(fnName),
          range:
            startB != null && endB != null
              ? {
                  startByte: startB,
                  endByte: endB,
                  startPosition: diagNode?.startPosition,
                  endPosition: diagNode?.endPosition,
                }
              : undefined,
        });
        return -1;
      }
    }

    return dae.addCallExpr(fnName, argExprIds);
  }

  // Subscript expression: arr[i] (for non-component_reference nodes; component_reference handles its own subscripts)
  if (
    type !== "component_reference" &&
    node.childCount >= 2 &&
    node.child(node.childCount - 1)?.type === "array_subscripts"
  ) {
    const hasTupleChild = (node.children || []).some((c: any) => c.type === "output_expression_list");
    if (hasTupleChild) {
      dae.diagnostics.push({
        severity: "error",
        code: ModelicaErrorCode.TUPLE_SUBSCRIPT_NOT_ALLOWED?.code ?? 5016,
        message: "Tuple expression can not be subscripted.",
        range: {
          startByte: node.startIndex ?? node.startByte,
          endByte: node.endIndex ?? node.endByte,
          startPosition: node.startPosition,
          endPosition: node.endPosition,
        },
      });
      return -1;
    }
    const baseNode = node.child(0);
    const subsNode = node.child(node.childCount - 1);
    const baseName = baseNode.text?.trim() ?? "";

    // Evaluate subscripts
    const subVals: (number | string)[] = [];
    let allNumeric = true;
    for (let i = 0; i < subsNode.childCount; i++) {
      const c = subsNode.child(i);
      if (c.type === "subscript" || c.type === "expression") {
        const expr = c.children?.find((k: any) => k.type === "expression") ?? c;
        const exprText = expr.text?.trim() ?? "";
        const evaluatedNum = evaluateCSTNumber(expr, substitutions as any, undefined, undefined, dae);
        if (evaluatedNum !== null) {
          subVals.push(evaluatedNum);
        } else {
          const subId = lowerCSTExpression(expr, dae, prefix, substitutions, imports, db, flattener);
          if (subId >= 0 && dae.getExprKind(subId) === ExprKind.IntLiteral) {
            subVals.push(dae.getExprData1(subId));
          } else {
            allNumeric = false;
            subVals.push(exprText);
          }
        }
      }
    }

    if (allNumeric && subVals.length > 0) {
      let candidate = `${baseName}[${subVals.join(",")}]`;
      if (prefix && !candidate.startsWith(prefix) && !candidate.includes(".")) {
        candidate = `${prefix}.${candidate}`;
      }
      return dae.addExpression(ExprKind.Name, dae.interner.intern(candidate));
    }

    const baseId = lowerCSTExpression(baseNode, dae, prefix, substitutions, imports, db, flattener, false, true);
    const subIds: number[] = [];
    for (let i = 0; i < subsNode.childCount; i++) {
      const c = subsNode.child(i);
      if (c.type === "subscript" || c.type === "expression") {
        const expr = c.children?.find((k: any) => k.type === "expression") ?? c;
        const sid = lowerCSTExpression(expr, dae, prefix, substitutions, imports, db, flattener);
        const skind = dae.getExprKind(sid);
        const stype = inferArenaExprVarType(dae, sid);
        if (skind === ExprKind.StringLiteral || stype === VarType.String) {
          let cur: any = node;
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
          const subText = expr.text?.trim() ?? "";
          dae.diagnostics.push({
            severity: "error",
            code: ModelicaErrorCode.FUNCTION_ARG_TYPE_MISMATCH.code,
            message: `Subscript '${subText}' has type String, expected type Integer.`,
            range: diagRange,
          });
          return -1;
        }
        subIds.push(sid);
      }
    }
    return dae.addSubscriptExpr(baseId, subIds);
  }

  // Parenthesized expression: "(" expr ")" or tuple "( expr1, expr2, ... )"
  if (
    (type === "primary" ||
      type === "lhs_primary" ||
      type === "expression" ||
      type === "lhs_expression" ||
      type === "output_expression_list" ||
      type === "expression_list") &&
    (((node.child(0)?.type === "(" || node.child(0)?.text === "(" || node.child(0)?.type === '"("') &&
      (node.child(node.childCount - 1)?.type === ")" ||
        node.child(node.childCount - 1)?.text === ")" ||
        node.child(node.childCount - 1)?.type === '")"')) ||
      type === "output_expression_list" ||
      type === "expression_list")
  ) {
    const isParen =
      (node.child(0)?.type === "(" || node.child(0)?.text === "(" || node.child(0)?.type === '"("') &&
      (node.child(node.childCount - 1)?.type === ")" ||
        node.child(node.childCount - 1)?.text === ")" ||
        node.child(node.childCount - 1)?.type === '")"');
    const startIdx = isParen ? 1 : 0;
    const endIdx = isParen ? node.childCount - 1 : node.childCount;
    const exprNodes: any[] = [];
    for (let i = startIdx; i < endIdx; i++) {
      const c = node.child(i);
      if (!c) continue;
      const cText = c.text?.trim() ?? "";
      const cType = c.type ?? "";
      if (cText === "," || cType === "," || cType === '","') continue;
      if (cType === "output_expression_list" || cType === "expression_list") {
        for (let j = 0; j < c.childCount; j++) {
          const sub = c.child(j);
          if (sub && sub.text?.trim() !== "," && sub.type !== "," && sub.type !== '","') {
            exprNodes.push(sub);
          }
        }
      } else {
        exprNodes.push(c);
      }
    }
    if (exprNodes.length === 1) {
      return lowerCSTExpression(exprNodes[0], dae, prefix, substitutions, imports, db, flattener);
    } else if (exprNodes.length > 1) {
      const tupleElemIds = exprNodes.map((e) =>
        lowerCSTExpression(e, dae, prefix, substitutions, imports, db, flattener, true),
      );
      return dae.addTupleExpr(tupleElemIds);
    }
  }

  // Array constructor: { e1, e2, ... }
  if (
    (type === "primary" || type === "lhs_primary") &&
    (node.child(0)?.type === "{" || node.child(0)?.text === "{" || node.child(0)?.type === '"{"') &&
    (node.child(node.childCount - 1)?.type === "}" ||
      node.child(node.childCount - 1)?.text === "}" ||
      node.child(node.childCount - 1)?.type === '"}"')
  ) {
    const elementIds: number[] = [];
    for (let i = 1; i < node.childCount - 1; i++) {
      const c = node.child(i);
      if (c.type === "expression" || c.type === "lhs_expression" || c.type === "array_arguments") {
        if (c.type === "array_arguments") {
          const hasFor = (c.children || []).some((k: any) => k.type === "for" || k.text?.trim() === "for");
          if (hasFor) {
            const exprChild = c.child(0);
            const indicesNode = (c.children || []).find((k: any) => k.type === "for_indices");
            const forIndices = (indicesNode?.children || []).filter((k: any) => k.type === "for_index");
            if (exprChild && forIndices.length > 0) {
              const iters: { name: string; values: (number | string)[] }[] = [];
              for (const fi of forIndices) {
                const varName = Cst.ForIndex.variable(fi)?.text?.trim() || fi.child(0)?.text?.trim();
                if (!varName) continue;
                const rangeNode = Cst.ForIndex.range(fi) || fi.children?.find?.((k: any) => k.type === "expression");
                let values: (number | string)[] = [];
                const isImplicit = !rangeNode;
                if (rangeNode) {
                  const rangeText = rangeNode.text?.trim() ?? "";
                  if (rangeText.startsWith("{") && rangeText.endsWith("}")) {
                    const items = getArrayLiteralItems(rangeNode);
                    for (const item of items) {
                      const v = evaluateCSTNumber(item, substitutions as any, undefined, db, dae, prefix);
                      if (v !== null) values.push(v);
                    }
                  } else if (rangeText.includes(":")) {
                    const colonNodes = flattenColonNodes(rangeNode);
                    if (colonNodes.length >= 2) {
                      const s = evaluateCSTNumber(colonNodes[0], substitutions as any, undefined, db, dae, prefix);
                      let e: number | null = null;
                      let step = 1;
                      if (colonNodes.length === 2) {
                        e = evaluateCSTNumber(colonNodes[1], substitutions as any, undefined, db, dae, prefix);
                      } else if (colonNodes.length >= 3) {
                        step = evaluateCSTNumber(colonNodes[1], substitutions as any, undefined, db, dae, prefix) ?? 1;
                        e = evaluateCSTNumber(colonNodes[2], substitutions as any, undefined, db, dae, prefix);
                      }
                      if (s !== null && e !== null) {
                        if (step === 0 || Math.abs(step) < 1e-12) {
                          dae.diagnostics.push({
                            severity: "error",
                            code: ModelicaErrorCode.RANGE_STEP_TOO_SMALL.code,
                            message: ModelicaErrorCode.RANGE_STEP_TOO_SMALL.message(String(step)),
                            range: { startByte: 0, endByte: 0 },
                          });
                        } else {
                          for (let val = s; step > 0 ? val <= e : val >= e; val += step) values.push(val);
                        }
                      }
                    } else {
                      const parts = rangeText.split(":");
                      const s = parseInt(parts[0]!.trim(), 10);
                      const e = parseInt(parts[parts.length - 1]!.trim(), 10);
                      if (!isNaN(s) && !isNaN(e)) {
                        for (let val = s; val <= e; val++) values.push(val);
                      }
                    }
                  }
                }
                if (values.length === 0 && rangeNode) {
                  const rangeText = rangeNode.text?.trim() ?? "";
                  const dimSize =
                    getDaeDimSize(prefix, rangeText, 0, dae, db) || getDaeDimSize("", rangeText, 0, dae, db);
                  if (dimSize > 0) {
                    values = Array.from({ length: dimSize }, (_, idx) => `${rangeText}[${idx + 1}]`);
                  }
                }
                if (values.length === 0) {
                  values = findArraySubscriptsForIter(exprChild, varName, dae, db, prefix, isImplicit, fi);
                }
                if (values.length > 0) {
                  iters.push({ name: varName, values });
                }
              }

              if (iters.length === 1) {
                const iter = iters[0]!;
                pushLoopVar(flattener, iter.name);
                const elemIds: number[] = [];
                try {
                  for (const val of iter.values) {
                    const newSubs = new Map(substitutions);
                    newSubs.set(iter.name, val);
                    elemIds.push(lowerCSTExpression(exprChild, dae, prefix, newSubs, imports, db, flattener));
                  }
                } finally {
                  popLoopVar(flattener, iter.name);
                }
                elementIds.push(...elemIds);
                continue;
              } else if (iters.length === 2) {
                const iter1 = iters[0]!;
                const iter2 = iters[1]!;
                pushLoopVar(flattener, iter1.name);
                pushLoopVar(flattener, iter2.name);
                const rowIds: number[] = [];
                try {
                  for (const val2 of iter2.values) {
                    const colIds: number[] = [];
                    for (const val1 of iter1.values) {
                      const newSubs = new Map(substitutions);
                      newSubs.set(iter1.name, val1);
                      newSubs.set(iter2.name, val2);
                      colIds.push(lowerCSTExpression(exprChild, dae, prefix, newSubs, imports, db, flattener));
                    }
                    rowIds.push(dae.addArrayCtorExpr(colIds));
                  }
                } finally {
                  popLoopVar(flattener, iter1.name);
                  popLoopVar(flattener, iter2.name);
                }
                elementIds.push(...rowIds);
                continue;
              }
              continue;
            }
            continue;
          }
        }
        const collect = (n: any) => {
          if (!n) return;
          if (n.type === "expression") {
            elementIds.push(lowerCSTExpression(n, dae, prefix, substitutions, imports, db, flattener));
            return;
          }
          for (let j = 0; j < n.childCount; j++) collect(n.child(j));
        };
        collect(c);
      }
    }
    if (elementIds.some((e) => isRealExpr(e, dae))) {
      for (let k = 0; k < elementIds.length; k++) {
        if (!isRealExpr(elementIds[k]!, dae)) {
          elementIds[k] = castToRealExpr(elementIds[k]!, dae);
        }
      }
    }
    return dae.addArrayCtorExpr(elementIds);
  }

  // Matrix / vector bracket constructor: [ e1; e2; ... ] or [ e1, e2, ... ]
  if (
    (type === "primary" || type === "lhs_primary") &&
    (node.child(0)?.type === "[" || node.child(0)?.text === "[" || node.child(0)?.type === '"["') &&
    (node.child(node.childCount - 1)?.type === "]" ||
      node.child(node.childCount - 1)?.text === "]" ||
      node.child(node.childCount - 1)?.type === '"]"')
  ) {
    const blocks: number[][] = [];
    let currentBlock: number[] = [];

    for (let i = 1; i < node.childCount - 1; i++) {
      const c = node.child(i);
      const text = c.text?.trim() ?? c.type;
      if (text === ";" || c.type === ";" || c.type === '";"') {
        if (currentBlock.length > 0) {
          blocks.push(currentBlock);
          currentBlock = [];
        }
        continue;
      }
      if (c.type === "expression_list" || c.type === "expression") {
        const collect = (n: any) => {
          if (!n) return;
          if (n.type === "expression") {
            const exprId = lowerCSTExpression(n, dae, prefix, substitutions, imports, db, flattener);
            if (exprId >= 0) currentBlock.push(exprId);
            return;
          }
          for (let j = 0; j < n.childCount; j++) collect(n.child(j));
        };
        collect(c);
      }
    }
    if (currentBlock.length > 0) {
      blocks.push(currentBlock);
    }

    if (blocks.length === 1 && blocks[0]!.length > 1) {
      const block = blocks[0]!;
      const rowCounts = block.map((item) => {
        const dims = getExprDims(item, dae, db);
        if (dims && dims.length >= 2) return dims[0]!;
        if (dims && dims.length === 1) return dims[0]!;
        const rank = getArrayCtorRank(item, dae);
        if (rank === 2) return getArrayCtorElements(item, dae).length;
        if (rank === 1) return getArrayCtorElements(item, dae).length;
        return 1;
      });
      const firstRowCount = rowCounts[0]!;
      const mismatchIdx = rowCounts.findIndex((r) => r !== firstRowCount);
      if (mismatchIdx !== -1) {
        let parentEq = node;
        while (parentEq && parentEq.type !== "simple_equation" && !parentEq.type?.endsWith("_equation")) {
          parentEq = parentEq.parent;
        }
        const diagNode = parentEq ?? node;
        const printer = new ArenaDAEPrinter({ write: () => {} }, dae, true);
        const item1Str = printer.printExprToString(block[0]!);
        const twoLit = dae.addIntLiteral(2);
        const promoted2 = dae.addCallExpr("promote", [block[mismatchIdx]!, twoLit]);
        const item2Str = printer.printExprToString(promoted2);
        dae.diagnostics.push({
          severity: "error",
          code: ModelicaErrorCode.ARRAY_DIMENSION_MISMATCH.code,
          message: `Arguments of concatenation comma operator have different sizes for the first dimension: ${item1Str} has dimension ${firstRowCount} and ${item2Str} has dimension ${rowCounts[mismatchIdx]}.`,
          range: {
            startByte: diagNode?.startIndex ?? diagNode?.startByte,
            endByte: diagNode?.endIndex ?? diagNode?.endByte,
            startPosition: diagNode?.startPosition,
            endPosition: diagNode?.endPosition,
          },
        });
        return -1;
      }
      const hasVectorOrDynamic = block.some((item) => {
        const dims = getExprDims(item, dae, db);
        if (dims && dims.length === 1) return true;
        const rank = getArrayCtorRank(item, dae);
        return (
          rank === 1 ||
          (rank === 0 && (dae.getExprKind(item) === ExprKind.Call || dae.getExprKind(item) === ExprKind.Name))
        );
      });
      if (hasVectorOrDynamic) {
        const twoLit = dae.addIntLiteral(2);
        const promoted = block.map((item) => {
          const dims = getExprDims(item, dae, db);
          if (dims && dims.length >= 2) return item;
          return dae.addCallExpr("promote", [item, twoLit]);
        });
        return dae.addCallExpr("cat", [twoLit, ...promoted]);
      }
    }

    const to2DRows = (item: number): number[][] => {
      if (item < 0) return [];
      if (dae.getExprKind(item) === ExprKind.Name) {
        const vName = dae.interner.resolve(dae.getExprData1(item));
        if (vName && dae.hasArrayElements(vName)) {
          const ctor = expandVarToArrayCtor(vName, dae);
          if (ctor !== null) item = ctor;
        }
      }
      const rank = getArrayCtorRank(item, dae);
      if (rank === 2) {
        const rows = getArrayCtorElements(item, dae);
        return rows.map((r) => getArrayCtorElements(r, dae));
      }
      if (rank === 1) {
        const elems = getArrayCtorElements(item, dae);
        if (blocks.length === 1 && blocks[0]?.length === 1) {
          return elems.map((e) => [e]);
        }
        return [elems];
      }
      return [[item]];
    };

    const allMatrixRows: number[] = [];
    for (const block of blocks) {
      if (block.length === 0) continue;
      const itemMatrices = block.map(to2DRows);
      const maxRows = Math.max(...itemMatrices.map((m) => m.length));
      for (let r = 0; r < maxRows; r++) {
        const rowCols: number[] = [];
        for (const mat of itemMatrices) {
          if (r < mat.length) {
            rowCols.push(...mat[r]!);
          } else if (mat.length === 1) {
            rowCols.push(...mat[0]!);
          }
        }
        allMatrixRows.push(dae.addArrayCtorExpr(rowCols));
      }
    }

    return dae.addArrayCtorExpr(allMatrixRows);
  }

  // Range expression: start : stop or start : step : stop
  if (
    node.childCount === 3 &&
    (node.child(1)?.type === ":" || node.child(1)?.text === ":" || node.child(1)?.type === '":"')
  ) {
    let leftChild = node.child(0);
    while (leftChild && leftChild.childCount === 1) leftChild = leftChild.child(0);
    const isLeftColon =
      leftChild &&
      leftChild.childCount === 3 &&
      (leftChild.child(1)?.type === ":" || leftChild.child(1)?.text === ":" || leftChild.child(1)?.type === '":"');

    const isForIndex = isInsideForIndex(node);

    if (isLeftColon) {
      const startId = lowerCSTExpression(leftChild.child(0), dae, prefix, substitutions, imports, db, flattener);
      const stepId = lowerCSTExpression(leftChild.child(2), dae, prefix, substitutions, imports, db, flattener);
      const stopId = lowerCSTExpression(node.child(2), dae, prefix, substitutions, imports, db, flattener);
      if (dae.getExprKind(stepId) === ExprKind.EnumLiteral && dae.getExprKind(startId) !== ExprKind.EnumLiteral) {
        let cur: any = node;
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
        const startText = leftChild.child(0)?.text?.trim() ?? "1";
        const stepText = leftChild.child(2)?.text?.trim() ?? "E.one";
        const startType = varTypeName(inferArenaExprVarType(dae, startId));
        let enumTypeStr = "enumeration E(one, two, three)";
        const dotIdx = stepText.lastIndexOf(".");
        const enumPfx = dotIdx > 0 ? stepText.slice(0, dotIdx).trim() : stepText;
        const scopeId = flattener?.currentClassId ?? flattener?.currentRootClassId ?? (dae as any).currentClassId;
        const enumInfo = resolveEnumType(enumPfx, scopeId, db);
        if (enumInfo) {
          const simpleName = enumInfo.qual.includes(".") ? enumInfo.qual.split(".").pop()! : enumInfo.qual;
          enumTypeStr = `enumeration ${simpleName}(${enumInfo.literals.join(", ")})`;
        }
        dae.diagnostics.push({
          severity: "error",
          code: ModelicaErrorCode.FUNCTION_ARG_TYPE_MISMATCH.code,
          message: `Type mismatch in range: '${startText}' of type\n  ${startType}\nis not type compatible with '${stepText}' of type\n  ${enumTypeStr}`,
          range: diagRange,
        });
        return -1;
      }
      if (dae.getExprKind(startId) === ExprKind.EnumLiteral || dae.getExprKind(stopId) === ExprKind.EnumLiteral) {
        let eqNode: any = node;
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
        const startB = diagNode?.startIndex ?? diagNode?.startByte;
        const endB = diagNode?.endIndex ?? diagNode?.endByte;
        const range =
          startB != null && endB != null
            ? {
                startByte: startB,
                endByte: endB,
                startPosition: diagNode?.startPosition,
                endPosition: diagNode?.endPosition,
              }
            : undefined;

        let enumTypeStr = "E";
        const startText = leftChild.child(0)?.text?.trim() ?? "";
        const dotIdx = startText.lastIndexOf(".");
        const enumPfx = dotIdx > 0 ? startText.slice(0, dotIdx).trim() : startText;
        const scopeId = flattener?.currentClassId ?? flattener?.currentRootClassId ?? (dae as any).currentClassId;
        const enumInfo = resolveEnumType(enumPfx, scopeId, db);
        if (enumInfo) {
          const simpleName = enumInfo.qual.includes(".") ? enumInfo.qual.split(".").pop()! : enumInfo.qual;
          enumTypeStr = `${simpleName}(${enumInfo.literals.join(", ")})`;
        }
        dae.diagnostics.push({
          severity: "error",
          code: ModelicaErrorCode.ENUM_RANGE_WITH_STEP.code,
          message: ModelicaErrorCode.ENUM_RANGE_WITH_STEP.message(enumTypeStr),
          range,
        });
        return -1;
      }
      const rangeId = dae.addExpression(ExprKind.Range, startId, stepId, stopId);
      const expanded = !isForIndex ? expandColonToArrayCtor(rangeId, dae) : null;
      return expanded !== null ? expanded : rangeId;
    } else {
      const startId = lowerCSTExpression(node.child(0), dae, prefix, substitutions, imports, db, flattener);
      const stopId = lowerCSTExpression(node.child(2), dae, prefix, substitutions, imports, db, flattener);
      const rangeId = dae.addExpression(ExprKind.Range, startId, -1, stopId);
      const expanded = !isForIndex ? expandColonToArrayCtor(rangeId, dae) : null;
      return expanded !== null ? expanded : rangeId;
    }
  }
  if (
    node.childCount === 5 &&
    (node.child(1)?.type === ":" || node.child(1)?.text === ":" || node.child(1)?.type === '":"') &&
    (node.child(3)?.type === ":" || node.child(3)?.text === ":" || node.child(3)?.type === '":"')
  ) {
    const isForIndex = isInsideForIndex(node);
    const startId = lowerCSTExpression(node.child(0), dae, prefix, substitutions, imports, db, flattener);
    const stepId = lowerCSTExpression(node.child(2), dae, prefix, substitutions, imports, db, flattener);
    if (dae.getExprKind(stepId) === ExprKind.EnumLiteral && dae.getExprKind(startId) !== ExprKind.EnumLiteral) {
      let cur: any = node;
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
      const startText = node.child(0)?.text?.trim() ?? "1";
      const stepText = node.child(2)?.text?.trim() ?? "E.one";
      const startType = varTypeName(inferArenaExprVarType(dae, startId));
      let enumTypeStr = "enumeration E(one, two, three)";
      const dotIdx = stepText.lastIndexOf(".");
      const enumPfx = dotIdx > 0 ? stepText.slice(0, dotIdx).trim() : stepText;
      const scopeId = flattener?.currentClassId ?? flattener?.currentRootClassId ?? (dae as any).currentClassId;
      const enumInfo = resolveEnumType(enumPfx, scopeId, db);
      if (enumInfo) {
        const simpleName = enumInfo.qual.includes(".") ? enumInfo.qual.split(".").pop()! : enumInfo.qual;
        enumTypeStr = `enumeration ${simpleName}(${enumInfo.literals.join(", ")})`;
      }
      dae.diagnostics.push({
        severity: "error",
        code: ModelicaErrorCode.FUNCTION_ARG_TYPE_MISMATCH.code,
        message: `Type mismatch in range: '${startText}' of type\n  ${startType}\nis not type compatible with '${stepText}' of type\n  ${enumTypeStr}`,
        range: diagRange,
      });
      return -1;
    }
    const stopId = lowerCSTExpression(node.child(4), dae, prefix, substitutions, imports, db, flattener);
    if (dae.getExprKind(startId) === ExprKind.EnumLiteral || dae.getExprKind(stopId) === ExprKind.EnumLiteral) {
      let eqNode: any = node;
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
      const startB = diagNode?.startIndex ?? diagNode?.startByte;
      const endB = diagNode?.endIndex ?? diagNode?.endByte;
      const range =
        startB != null && endB != null
          ? {
              startByte: startB,
              endByte: endB,
              startPosition: diagNode?.startPosition,
              endPosition: diagNode?.endPosition,
            }
          : undefined;

      let enumTypeStr = "E";
      const startText = node.child(0)?.text?.trim() ?? "";
      const dotIdx = startText.lastIndexOf(".");
      const enumPfx = dotIdx > 0 ? startText.slice(0, dotIdx).trim() : startText;
      const scopeId = flattener?.currentClassId ?? flattener?.currentRootClassId ?? (dae as any).currentClassId;
      const enumInfo = resolveEnumType(enumPfx, scopeId, db);
      if (enumInfo) {
        const simpleName = enumInfo.qual.includes(".") ? enumInfo.qual.split(".").pop()! : enumInfo.qual;
        enumTypeStr = `${simpleName}(${enumInfo.literals.join(", ")})`;
      }
      dae.diagnostics.push({
        severity: "error",
        code: ModelicaErrorCode.ENUM_RANGE_WITH_STEP.code,
        message: ModelicaErrorCode.ENUM_RANGE_WITH_STEP.message(enumTypeStr),
        range,
      });
      return -1;
    }
    const rangeId = dae.addExpression(ExprKind.Range, startId, stepId, stopId);
    const expanded = !isForIndex ? expandColonToArrayCtor(rangeId, dae) : null;
    return expanded !== null ? expanded : rangeId;
  }

  // If-Else expression: if cond then e1 [elseif cond2 then e2 ...] else e_last
  if (firstChildToken === "if" && node.childCount >= 6) {
    const branches: { condNode: any; thenNode: any }[] = [{ condNode: node.child(1), thenNode: node.child(3) }];
    let i = 4;
    while (i < node.childCount) {
      const tok = node.child(i)?.text?.trim() ?? node.child(i)?.type ?? "";
      const tokClean = tok.replace(/^"|"$/g, "");
      if (tokClean === "elseif" && i + 3 < node.childCount) {
        branches.push({ condNode: node.child(i + 1), thenNode: node.child(i + 3) });
        i += 4;
      } else if (tokClean === "else" && i + 1 < node.childCount) {
        break;
      } else {
        i++;
      }
    }
    const elseNode = node.child(node.childCount - 1);

    // If static condition evaluates to true, only lower that branch
    const loweredConds: { condId: number; condVal: any }[] = [];
    let takenBranchIdx = -1;
    let allFalseSoFar = true;
    const isOldFrontend = Boolean(dae.extensionMetadata?.isOldFrontend);
    for (let b = 0; b < branches.length; b++) {
      const condId = lowerCSTExpression(branches[b]!.condNode, dae, prefix, substitutions, imports, db, flattener);
      const isRuntimeParam = isOldFrontend
        ? exprReferencesEnumParameter(condId, dae)
        : exprReferencesRuntimeParameter(condId, dae);
      if (isRuntimeParam) {
        loweredConds.push({ condId, condVal: null });
        allFalseSoFar = false;
        break;
      }
      const condVal = evalDaeExpr(condId, dae);
      if (condVal === true || condVal === 1) {
        takenBranchIdx = b;
        allFalseSoFar = false;
        break;
      } else if (condVal === false || condVal === 0) {
        loweredConds.push({ condId, condVal });
        // condition is false, continue to next branch
      } else {
        loweredConds.push({ condId, condVal: null });
        allFalseSoFar = false;
        break;
      }
    }

    if (takenBranchIdx >= 0) {
      return lowerCSTExpression(branches[takenBranchIdx]!.thenNode, dae, prefix, substitutions, imports, db, flattener);
    }
    if (allFalseSoFar && loweredConds.length === branches.length) {
      return lowerCSTExpression(elseNode, dae, prefix, substitutions, imports, db, flattener);
    }

    let currElseId = lowerCSTExpression(elseNode, dae, prefix, substitutions, imports, db, flattener);

    for (let b = branches.length - 1; b >= 0; b--) {
      if (b < loweredConds.length && (loweredConds[b]!.condVal === false || loweredConds[b]!.condVal === 0)) {
        continue;
      }
      const branch = branches[b]!;
      const condId =
        b < loweredConds.length
          ? loweredConds[b]!.condId
          : lowerCSTExpression(branch.condNode, dae, prefix, substitutions, imports, db, flattener);
      let thenId = lowerCSTExpression(branch.thenNode, dae, prefix, substitutions, imports, db, flattener);
      if (isRealExpr(thenId, dae) && !isRealExpr(currElseId, dae)) {
        currElseId = castToRealExpr(currElseId, dae);
      } else if (!isRealExpr(thenId, dae) && isRealExpr(currElseId, dae)) {
        thenId = castToRealExpr(thenId, dae);
      }
      currElseId = dae.addExpression(ExprKind.IfElse, condId, thenId, currElseId);
    }
    return currElseId;
  }

  // Binary expression: left op right
  if (node.childCount === 3) {
    const rawOp = node.child(1)?.text?.trim() ?? node.child(1)?.type ?? "";
    const opToken = rawOp.replace(/^"|"$/g, "");
    let binOp: BinOp | null = null;
    switch (opToken) {
      case "+":
        binOp = BinOp.Add;
        break;
      case "-":
        binOp = BinOp.Sub;
        break;
      case "*":
        binOp = BinOp.Mul;
        break;
      case "/":
        binOp = BinOp.Div;
        break;
      case "^":
        binOp = BinOp.Pow;
        break;
      case ".+":
        binOp = BinOp.ElemAdd;
        break;
      case ".-":
        binOp = BinOp.ElemSub;
        break;
      case ".*":
        binOp = BinOp.ElemMul;
        break;
      case "./":
        binOp = BinOp.ElemDiv;
        break;
      case ".^":
        binOp = BinOp.ElemPow;
        break;
      case "<":
        binOp = BinOp.Lt;
        break;
      case "<=":
        binOp = BinOp.Lte;
        break;
      case ">":
        binOp = BinOp.Gt;
        break;
      case ">=":
        binOp = BinOp.Gte;
        break;
      case "==":
        binOp = BinOp.Eq;
        break;
      case "<>":
        binOp = BinOp.Neq;
        break;
      case "and":
        binOp = BinOp.And;
        break;
      case "or":
        binOp = BinOp.Or;
        break;
      case ":":
        binOp = BinOp.Colon;
        break;
    }
    if (binOp !== null) {
      const leftNode = node.childForFieldName?.("left") ?? node.child(0);
      const rightNode = node.childForFieldName?.("right") ?? node.child(2);
      let leftId = lowerCSTExpression(leftNode, dae, prefix, substitutions, imports, db, flattener);
      let rightId = lowerCSTExpression(rightNode, dae, prefix, substitutions, imports, db, flattener);
      if (db && flattener) {
        const opName = getOperatorNameForBinOp(binOp);
        if (opName) {
          const dispatched = dispatchBinaryOperator(opName, leftId, rightId, leftNode, rightNode, dae, db, flattener);
          if (dispatched !== null) return dispatched;
        }
      }
      if (
        binOp === BinOp.ElemAdd ||
        binOp === BinOp.ElemSub ||
        binOp === BinOp.ElemMul ||
        binOp === BinOp.ElemDiv ||
        binOp === BinOp.ElemPow
      ) {
        if (dae.getExprKind(leftId) === ExprKind.Name) {
          const lName = dae.interner.resolve(dae.getExprData1(leftId));
          if (lName && dae.hasArrayElements(lName)) {
            const lCtor = expandVarToArrayCtor(lName, dae);
            if (lCtor !== null) leftId = lCtor;
          }
        }
        if (dae.getExprKind(rightId) === ExprKind.Name) {
          const rName = dae.interner.resolve(dae.getExprData1(rightId));
          if (rName && dae.hasArrayElements(rName)) {
            const rCtor = expandVarToArrayCtor(rName, dae);
            if (rCtor !== null) rightId = rCtor;
          }
        }
        let baseOp = BinOp.Add;
        if (binOp === BinOp.ElemSub) baseOp = BinOp.Sub;
        else if (binOp === BinOp.ElemMul) baseOp = BinOp.Mul;
        else if (binOp === BinOp.ElemDiv) baseOp = BinOp.Div;
        else if (binOp === BinOp.ElemPow) baseOp = BinOp.Pow;
        return broadcastElemBinOp(binOp, baseOp, leftId, rightId, dae, flattener, true);
      }
      if (binOp === BinOp.Eq || binOp === BinOp.Neq) {
        const leftType = inferArenaExprVarType(dae, leftId);
        const rightType = inferArenaExprVarType(dae, rightId);
        if (leftType === VarType.Enumeration && rightType === VarType.Integer) {
          const val = dae.getExprKind(rightId) === ExprKind.IntLiteral ? dae.getExprData1(rightId) : null;
          if (val !== null && dae.getExprKind(leftId) === ExprKind.Name) {
            const nameId = dae.getExprData1(leftId);
            let vIdx = dae.lookupVariable(nameId);
            if (vIdx < 0) {
              const nameStr = dae.interner.resolve(nameId);
              if (nameStr) vIdx = dae.getVarIdxByName(nameStr);
            }
            if (vIdx >= 0) {
              const lits = dae.getVarEnumerationLiterals(vIdx);
              const cType = dae.getVarCustomType(vIdx);
              if (lits && val >= 1 && val <= lits.length) {
                const lit = lits[val - 1];
                const litName =
                  typeof lit === "string" ? lit : ((lit as any).stringValue ?? (lit as any).name ?? String(lit));
                const varName = dae.getVarName(vIdx);
                const enumPrefix =
                  flattener.options.omcCompatibility && varName ? `${cType ?? ""}$${varName}` : (cType ?? "");
                const fullLit = enumPrefix ? `${enumPrefix}.${litName}` : litName;
                rightId = dae.addEnumLiteral(val, fullLit);
              }
            }
          }
        } else if (leftType === VarType.Integer && rightType === VarType.Enumeration) {
          const val = dae.getExprKind(leftId) === ExprKind.IntLiteral ? dae.getExprData1(leftId) : null;
          if (val !== null && dae.getExprKind(rightId) === ExprKind.Name) {
            const nameId = dae.getExprData1(rightId);
            let vIdx = dae.lookupVariable(nameId);
            if (vIdx < 0) {
              const nameStr = dae.interner.resolve(nameId);
              if (nameStr) vIdx = dae.getVarIdxByName(nameStr);
            }
            if (vIdx >= 0) {
              const lits = dae.getVarEnumerationLiterals(vIdx);
              const cType = dae.getVarCustomType(vIdx);
              if (lits && val >= 1 && val <= lits.length) {
                const lit = lits[val - 1];
                const litName =
                  typeof lit === "string" ? lit : ((lit as any).stringValue ?? (lit as any).name ?? String(lit));
                const varName = dae.getVarName(vIdx);
                const enumPrefix =
                  flattener.options.omcCompatibility && varName ? `${cType ?? ""}$${varName}` : (cType ?? "");
                const fullLit = enumPrefix ? `${enumPrefix}.${litName}` : litName;
                leftId = dae.addEnumLiteral(val, fullLit);
              }
            }
          }
        }
      }
      if (binOp === BinOp.Mul || binOp === BinOp.Add || binOp === BinOp.Sub) {
        if (dae.getExprKind(leftId) === ExprKind.Name) {
          const lName = dae.interner.resolve(dae.getExprData1(leftId));
          if (
            lName &&
            dae.hasArrayElements(lName) &&
            !(dae.classKind === "function" && flattener?.currentBindingCompName === lName)
          ) {
            const lCtor = expandVarToArrayCtor(lName, dae);
            if (lCtor !== null) leftId = lCtor;
          }
        }
        if (dae.getExprKind(rightId) === ExprKind.Name) {
          const rName = dae.interner.resolve(dae.getExprData1(rightId));
          if (
            rName &&
            dae.hasArrayElements(rName) &&
            !(dae.classKind === "function" && flattener?.currentBindingCompName === rName)
          ) {
            const rCtor = expandVarToArrayCtor(rName, dae);
            if (rCtor !== null) rightId = rCtor;
          }
        }
      }
      const isArithmeticOp =
        binOp === BinOp.Add || binOp === BinOp.Sub || binOp === BinOp.Mul || binOp === BinOp.Div || binOp === BinOp.Pow;

      if (isArithmeticOp) {
        const lType = inferArenaExprVarType(dae, leftId);
        const rType = inferArenaExprVarType(dae, rightId);
        const isLNonNumeric =
          lType === VarType.Boolean ||
          lType === VarType.String ||
          dae.getExprKind(leftId) === ExprKind.BoolLiteral ||
          dae.getExprKind(leftId) === ExprKind.StringLiteral;
        const isRNonNumeric =
          rType === VarType.Boolean ||
          rType === VarType.String ||
          dae.getExprKind(rightId) === ExprKind.BoolLiteral ||
          dae.getExprKind(rightId) === ExprKind.StringLiteral;
        if (
          binOp === BinOp.Add &&
          (lType === VarType.String || dae.getExprKind(leftId) === ExprKind.StringLiteral) &&
          (rType === VarType.String || dae.getExprKind(rightId) === ExprKind.StringLiteral)
        ) {
          if (
            dae.getExprKind(leftId) === ExprKind.StringLiteral &&
            dae.getExprKind(rightId) === ExprKind.StringLiteral
          ) {
            const s1 = dae.interner.resolve(dae.getExprData1(leftId)) ?? "";
            const s2 = dae.interner.resolve(dae.getExprData1(rightId)) ?? "";
            return dae.addStringLiteral(s1 + s2);
          }
          return dae.addBinaryExpr(BinOp.Add, leftId, rightId);
        }

        if (isLNonNumeric || isRNonNumeric) {
          const getOperandFullTypeStr = (id: number): string => {
            const t = inferArenaExprVarType(dae, id);
            if (t === VarType.Integer || dae.getExprKind(id) === ExprKind.IntLiteral) return "Integer";
            if (t === VarType.Boolean || dae.getExprKind(id) === ExprKind.BoolLiteral) return "Boolean";
            if (t === VarType.String || dae.getExprKind(id) === ExprKind.StringLiteral) return "String";
            return "Real";
          };
          const leftTypeStr = getOperandFullTypeStr(leftId);
          const rightTypeStr = getOperandFullTypeStr(rightId);
          const rawExpr = `${node.child(0)?.text?.trim() ?? ""}${opToken}${node.child(2)?.text?.trim() ?? ""}`;
          const startB = node.startIndex ?? node.startByte;
          const endB = node.endIndex ?? node.endByte;
          dae.diagnostics.push({
            severity: "error",
            message: `Cannot resolve type of expression ${rawExpr}. The operands have types ${leftTypeStr}, ${rightTypeStr} in component <NO COMPONENT>.`,
            range: {
              startByte: startB,
              endByte: endB,
              startPosition: node.startPosition,
              endPosition: node.endPosition,
            },
          });
          return -1;
        }
      }

      if (binOp === BinOp.Add || binOp === BinOp.Sub) {
        const leftDims = getExprDims(leftId, dae, flattener?.db);
        const rightDims = getExprDims(rightId, dae, flattener?.db);
        const hasLeftDims = leftDims !== null && leftDims.length > 0;
        const hasRightDims = rightDims !== null && rightDims.length > 0;
        const isKnownScalar = (id: number): boolean => {
          const k = dae.getExprKind(id);
          if (
            k === ExprKind.RealLiteral ||
            k === ExprKind.IntLiteral ||
            k === ExprKind.BoolLiteral ||
            k === ExprKind.StringLiteral
          ) {
            return true;
          }
          if (k === ExprKind.Name) {
            const nameId = dae.getExprData1(id);
            const name = dae.interner.resolve(nameId);
            if (name && !dae.hasArrayElements(name)) {
              const vIdx = dae.getVarIdxByName(name);
              if (vIdx >= 0) {
                const shape = dae.getVarShape(vIdx);
                return !shape || shape.length === 0;
              }
            }
          }
          return false;
        };

        const leftKnownScalar = isKnownScalar(leftId);
        const rightKnownScalar = isKnownScalar(rightId);

        const dimensionMismatch =
          (hasLeftDims &&
            hasRightDims &&
            (leftDims!.length !== rightDims!.length ||
              leftDims!.some((d, i) => d > 0 && rightDims![i] > 0 && d !== rightDims![i]))) ||
          (hasLeftDims && rightKnownScalar) ||
          (hasRightDims && leftKnownScalar);

        if (dimensionMismatch) {
          const getOperandFullTypeStr = (id: number, dims: number[] | null): string => {
            const t = inferArenaExprVarType(dae, id);
            let baseType = "Real";
            if (t === VarType.Integer || dae.getExprKind(id) === ExprKind.IntLiteral) baseType = "Integer";
            else if (t === VarType.Boolean || dae.getExprKind(id) === ExprKind.BoolLiteral) baseType = "Boolean";
            else if (t === VarType.String || dae.getExprKind(id) === ExprKind.StringLiteral) baseType = "String";
            if (dims && dims.length > 0) {
              return `${baseType}[${dims.join(", ")}]`;
            }
            return baseType;
          };
          const leftTypeStr = getOperandFullTypeStr(leftId, leftDims);
          const rightTypeStr = getOperandFullTypeStr(rightId, rightDims);
          const exprText = `${node.child(0)?.text?.trim() ?? ""} ${opToken} ${node.child(2)?.text?.trim() ?? ""}`;
          const startB = node.startIndex ?? node.startByte;
          const endB = node.endIndex ?? node.endByte;
          dae.diagnostics.push({
            severity: "error",
            message: `Cannot resolve type of expression ${exprText}. The operands have types ${leftTypeStr}, ${rightTypeStr} in component <NO COMPONENT>.`,
            range: {
              startByte: startB,
              endByte: endB,
              startPosition: node.startPosition,
              endPosition: node.endPosition,
            },
          });
          return -1;
        }
      }
      if (binOp === BinOp.Add) {
        const leftKind = dae.getExprKind(leftId);
        const rightKind = dae.getExprKind(rightId);
        if (leftKind === ExprKind.IntLiteral && rightKind === ExprKind.IntLiteral) {
          return dae.addIntLiteral(dae.getExprData1(leftId) + dae.getExprData1(rightId));
        }
        if (leftKind === ExprKind.RealLiteral && rightKind === ExprKind.RealLiteral) {
          return dae.addRealLiteral(dae.getExprRealValue(leftId) + dae.getExprRealValue(rightId));
        }
        if (leftKind === ExprKind.IntLiteral && rightKind === ExprKind.RealLiteral) {
          return dae.addRealLiteral(dae.getExprData1(leftId) + dae.getExprRealValue(rightId));
        }
        if (leftKind === ExprKind.RealLiteral && rightKind === ExprKind.IntLiteral) {
          return dae.addRealLiteral(dae.getExprRealValue(leftId) + dae.getExprData1(rightId));
        }
        if (leftKind === ExprKind.ArrayCtor && rightKind === ExprKind.ArrayCtor) {
          const leftElems = getArrayCtorElements(leftId, dae);
          const rightElems = getArrayCtorElements(rightId, dae);
          if (leftElems.length === rightElems.length) {
            if (leftElems.length === 0) return dae.addArrayCtorExpr([]);
            const newElems = leftElems.map((e, i) => addArrayBinaryExpr(BinOp.Add, e, rightElems[i]!, dae));
            return dae.addArrayCtorExpr(newElems);
          }
        }
        const leftDims = getExprDims(leftId, dae, flattener.db);
        const rightDims = getExprDims(rightId, dae, flattener.db);
        if (leftDims && rightDims && leftDims.length === 2 && rightDims.length === 2) {
          const [M1, N1] = leftDims;
          const [M2, N2] = rightDims;
          if (M1 === M2 && N1 === N2 && (M1 === 0 || N1 === 0)) {
            const resRows: number[] = [];
            for (let i = 0; i < M1!; i++) {
              resRows.push(dae.addArrayCtorExpr([]));
            }
            return dae.addArrayCtorExpr(resRows);
          }
        }
      }
      if (binOp === BinOp.Sub) {
        const leftKind = dae.getExprKind(leftId);
        const rightKind = dae.getExprKind(rightId);
        if (leftKind === ExprKind.IntLiteral && rightKind === ExprKind.IntLiteral) {
          return dae.addIntLiteral(dae.getExprData1(leftId) - dae.getExprData1(rightId));
        }
        if (leftKind === ExprKind.RealLiteral && rightKind === ExprKind.RealLiteral) {
          return dae.addRealLiteral(dae.getExprRealValue(leftId) - dae.getExprRealValue(rightId));
        }
        if (leftKind === ExprKind.IntLiteral && rightKind === ExprKind.RealLiteral) {
          return dae.addRealLiteral(dae.getExprData1(leftId) - dae.getExprRealValue(rightId));
        }
        if (leftKind === ExprKind.RealLiteral && rightKind === ExprKind.IntLiteral) {
          return dae.addRealLiteral(dae.getExprRealValue(leftId) - dae.getExprData1(rightId));
        }
        if (leftKind === ExprKind.ArrayCtor && rightKind === ExprKind.ArrayCtor) {
          const leftElems = getArrayCtorElements(leftId, dae);
          const rightElems = getArrayCtorElements(rightId, dae);
          if (leftElems.length === rightElems.length) {
            if (leftElems.length === 0) return dae.addArrayCtorExpr([]);
            const newElems = leftElems.map((e, i) => addArrayBinaryExpr(BinOp.Sub, e, rightElems[i]!, dae));
            return dae.addArrayCtorExpr(newElems);
          }
        }
      }
      if (binOp === BinOp.Mul) {
        const leftKind = dae.getExprKind(leftId);
        const rightKind = dae.getExprKind(rightId);
        if (leftKind === ExprKind.IntLiteral && rightKind === ExprKind.IntLiteral) {
          return dae.addIntLiteral(dae.getExprData1(leftId) * dae.getExprData1(rightId));
        }
        if (leftKind === ExprKind.RealLiteral && rightKind === ExprKind.RealLiteral) {
          return dae.addRealLiteral(dae.getExprRealValue(leftId) * dae.getExprRealValue(rightId));
        }
        if (leftKind === ExprKind.IntLiteral && rightKind === ExprKind.RealLiteral) {
          return dae.addRealLiteral(dae.getExprData1(leftId) * dae.getExprRealValue(rightId));
        }
        if (leftKind === ExprKind.RealLiteral && rightKind === ExprKind.IntLiteral) {
          return dae.addRealLiteral(dae.getExprRealValue(leftId) * dae.getExprData1(rightId));
        }
        const leftDims = getExprDims(leftId, dae, flattener?.db, flattener);
        const rightDims = getExprDims(rightId, dae, flattener?.db, flattener);
        if (leftDims && rightDims) {
          // Matrix * Matrix: [M, K1] * [K2, N]
          if (leftDims.length === 2 && rightDims.length === 2 && leftDims[1] === rightDims[0]) {
            const [M, K] = leftDims;
            const [, N] = rightDims;
            if (K === 0 || M === 0 || N === 0) {
              if (M === 0) {
                const res = dae.addArrayCtorExpr([]);
                if (!(dae as any).exprArrayShapes) (dae as any).exprArrayShapes = new Map<number, number[]>();
                (dae as any).exprArrayShapes.set(res, [0, N!]);
                return res;
              }
              const zeroLit = dae.addRealLiteral(0.0);
              const resRows: number[] = [];
              for (let i = 0; i < M!; i++) {
                const rowElems: number[] = [];
                for (let j = 0; j < N!; j++) {
                  rowElems.push(zeroLit);
                }
                resRows.push(dae.addArrayCtorExpr(rowElems));
              }
              const res = dae.addArrayCtorExpr(resRows);
              if (!(dae as any).exprArrayShapes) (dae as any).exprArrayShapes = new Map<number, number[]>();
              (dae as any).exprArrayShapes.set(res, [M!, N!]);
              return res;
            }
          }
          // Matrix * Vector: [M, K1] * [K2]
          if (leftDims.length === 2 && rightDims.length === 1 && leftDims[1] === rightDims[0]) {
            const [M, K] = leftDims;
            if (M === 0) {
              const res = dae.addArrayCtorExpr([]);
              if (!(dae as any).exprArrayShapes) (dae as any).exprArrayShapes = new Map<number, number[]>();
              (dae as any).exprArrayShapes.set(res, [0]);
              return res;
            }
            if (K === 0) {
              const zeroLit = dae.addRealLiteral(0.0);
              const resElems: number[] = [];
              for (let i = 0; i < M!; i++) resElems.push(zeroLit);
              const res = dae.addArrayCtorExpr(resElems);
              if (!(dae as any).exprArrayShapes) (dae as any).exprArrayShapes = new Map<number, number[]>();
              (dae as any).exprArrayShapes.set(res, [M!]);
              return res;
            }
          }
          // Vector * Matrix: [K1] * [K2, N]
          if (leftDims.length === 1 && rightDims.length === 2 && leftDims[0] === rightDims[0]) {
            const [, N] = rightDims;
            const K = leftDims[0]!;
            if (N === 0) {
              const res = dae.addArrayCtorExpr([]);
              if (!(dae as any).exprArrayShapes) (dae as any).exprArrayShapes = new Map<number, number[]>();
              (dae as any).exprArrayShapes.set(res, [0]);
              return res;
            }
            if (K === 0) {
              const zeroLit = dae.addRealLiteral(0.0);
              const resElems: number[] = [];
              for (let i = 0; i < N!; i++) resElems.push(zeroLit);
              const res = dae.addArrayCtorExpr(resElems);
              if (!(dae as any).exprArrayShapes) (dae as any).exprArrayShapes = new Map<number, number[]>();
              (dae as any).exprArrayShapes.set(res, [N!]);
              return res;
            }
          }
          // Vector * Vector: [K1] * [K2]
          if (leftDims.length === 1 && rightDims.length === 1 && leftDims[0] === rightDims[0]) {
            if (leftDims[0] === 0) return dae.addRealLiteral(0.0);
          }
        }
        const makeMul = (l: number, r: number) => {
          return mulWithSimplification(l, r, dae);
        };
        let effectiveLeftId = leftId;
        let effectiveLeftKind = leftKind;
        if (effectiveLeftKind !== ExprKind.ArrayCtor && leftDims && leftDims.length > 0) {
          const lName =
            dae.getExprKind(effectiveLeftId) === ExprKind.Name
              ? dae.interner.resolve(dae.getExprData1(effectiveLeftId))
              : null;
          if (lName && !(dae.classKind === "function" && flattener?.currentBindingCompName === lName)) {
            const exp = expandVarToArrayCtor(lName, dae);
            if (exp !== null) {
              effectiveLeftId = exp;
              effectiveLeftKind = dae.getExprKind(effectiveLeftId);
            }
          }
        }
        let effectiveRightId = rightId;
        let effectiveRightKind = rightKind;
        if (effectiveRightKind !== ExprKind.ArrayCtor && rightDims && rightDims.length > 0) {
          const rName =
            dae.getExprKind(effectiveRightId) === ExprKind.Name
              ? dae.interner.resolve(dae.getExprData1(effectiveRightId))
              : null;
          if (rName && !(dae.classKind === "function" && flattener?.currentBindingCompName === rName)) {
            const exp = expandVarToArrayCtor(rName, dae);
            if (exp !== null) {
              effectiveRightId = exp;
              effectiveRightKind = dae.getExprKind(effectiveRightId);
            }
          }
        }
        if (effectiveLeftKind === ExprKind.ArrayCtor && effectiveRightKind === ExprKind.ArrayCtor) {
          return matrixOrVectorMul(effectiveLeftId, effectiveRightId, dae);
        } else if (effectiveLeftKind === ExprKind.ArrayCtor && (!rightDims || rightDims.length === 0)) {
          // Vector/Matrix * Scalar
          const leftElems = getArrayCtorElements(effectiveLeftId, dae);
          const isMatrix = leftElems.length > 0 && dae.getExprKind(leftElems[0]!) === ExprKind.ArrayCtor;
          if (isMatrix) {
            const rows = leftElems.map((r) => {
              const rElems = getArrayCtorElements(r, dae);
              return dae.addArrayCtorExpr(rElems.map((e) => makeMul(e, effectiveRightId)));
            });
            return dae.addArrayCtorExpr(rows);
          } else {
            return dae.addArrayCtorExpr(leftElems.map((e) => makeMul(e, effectiveRightId)));
          }
        } else if (effectiveRightKind === ExprKind.ArrayCtor && (!leftDims || leftDims.length === 0)) {
          // Scalar * Vector/Matrix
          const rightElems = getArrayCtorElements(effectiveRightId, dae);
          const isMatrix = rightElems.length > 0 && dae.getExprKind(rightElems[0]!) === ExprKind.ArrayCtor;
          if (isMatrix) {
            const rows = rightElems.map((r) => {
              const rElems = getArrayCtorElements(r, dae);
              return dae.addArrayCtorExpr(rElems.map((e) => makeMul(effectiveLeftId, e)));
            });
            return dae.addArrayCtorExpr(rows);
          } else {
            return dae.addArrayCtorExpr(rightElems.map((e) => makeMul(effectiveLeftId, e)));
          }
        }
      }
      if (binOp === BinOp.Pow) {
        const getConstVal = (id: number): number | null => {
          const k = dae.getExprKind(id);
          if (k === ExprKind.RealLiteral) return dae.getExprRealValue(id);
          if (k === ExprKind.IntLiteral) return dae.getExprData1(id);
          if (k === ExprKind.Negate) {
            const inner = getConstVal(dae.getExprLeft(id));
            return inner !== null ? -inner : null;
          }
          if (k === ExprKind.Unary && (dae.getExprData1(id) as UnaryOp) === UnaryOp.Negate) {
            const inner = getConstVal(dae.getExprLeft(id));
            return inner !== null ? -inner : null;
          }
          return null;
        };
        const lVal = getConstVal(leftId);
        const rVal = getConstVal(rightId);
        if (lVal !== null && rVal !== null && lVal < 0 && !Number.isInteger(rVal)) {
          const startB = node.startIndex ?? node.startByte;
          const endB = node.endIndex ?? node.endByte;
          const lStr = Number.isInteger(lVal) ? lVal.toFixed(1) : String(lVal);
          const rStr = Number.isInteger(rVal) ? rVal.toFixed(1) : String(rVal);
          dae.diagnostics.push({
            severity: "error",
            message: `Invalid operation ${lStr} ^ ${rStr}, exponent must be an Integer when the base is negative.`,
            range:
              startB != null && endB != null
                ? {
                    startByte: startB,
                    endByte: endB,
                    startPosition: node.startPosition,
                    endPosition: node.endPosition,
                  }
                : undefined,
          });
          return -1;
        }
      }
      if (binOp === BinOp.Pow) {
        if (dae.getExprKind(leftId) === ExprKind.Name) {
          const lName = dae.interner.resolve(dae.getExprData1(leftId));
          if (lName && dae.hasArrayElements(lName)) {
            const lCtor = expandVarToArrayCtor(lName, dae);
            if (lCtor !== null) leftId = lCtor;
          }
        }
        if (dae.getExprKind(leftId) === ExprKind.ArrayCtor) {
          let powVal: number | null = null;
          if (dae.getExprKind(rightId) === ExprKind.IntLiteral) {
            powVal = dae.getExprData1(rightId);
          } else if (dae.getExprKind(rightId) === ExprKind.RealLiteral) {
            powVal = dae.getExprRealValue(rightId);
          }
          if (powVal !== null && Number.isInteger(powVal) && powVal >= 0) {
            return matrixPower(leftId, powVal, dae);
          }
        }
        const leftKind = dae.getExprKind(leftId);
        const rightKind = dae.getExprKind(rightId);
        if (
          (leftKind === ExprKind.IntLiteral || leftKind === ExprKind.RealLiteral) &&
          (rightKind === ExprKind.IntLiteral || rightKind === ExprKind.RealLiteral)
        ) {
          const lVal = leftKind === ExprKind.IntLiteral ? dae.getExprData1(leftId) : dae.getExprRealValue(leftId);
          const rVal = rightKind === ExprKind.IntLiteral ? dae.getExprData1(rightId) : dae.getExprRealValue(rightId);
          return dae.addRealLiteral(Math.pow(lVal, rVal));
        }

        const isOne = (id: number): boolean => {
          const k = dae.getExprKind(id);
          if (k === ExprKind.IntLiteral && dae.getExprData1(id) === 1) return true;
          if (k === ExprKind.RealLiteral && dae.getExprRealValue(id) === 1.0) return true;
          return false;
        };
        if (isOne(rightId)) return leftId;

        // Power of power simplification: (x ^ a) ^ b
        if (leftKind === ExprKind.Binary && dae.getExprData1(leftId) === BinOp.Pow) {
          const innerBase = dae.getExprLeft(leftId);
          const innerExp = dae.getExprRight(leftId);
          const outerExp = rightId;

          const getNum = (id: number): number | null => {
            const k = dae.getExprKind(id);
            if (k === ExprKind.IntLiteral) return dae.getExprData1(id);
            if (k === ExprKind.RealLiteral) return dae.getExprRealValue(id);
            return null;
          };

          const isHalf = dae.getExprKind(outerExp) === ExprKind.RealLiteral && dae.getExprRealValue(outerExp) === 0.5;
          const inNum = getNum(innerExp);
          if (isHalf && inNum !== null && inNum % 2 === 0) {
            const absBase = dae.addCallExpr("abs", [innerBase]);
            const newExp = dae.addRealLiteral(inNum * 0.5);
            return dae.addBinaryExpr(BinOp.Pow, absBase, newExp);
          }

          const isDiv = dae.getExprKind(outerExp) === ExprKind.Binary && dae.getExprData1(outerExp) === BinOp.Div;
          if (isDiv) {
            const dL = dae.getExprLeft(outerExp);
            const dR = dae.getExprRight(outerExp);
            if (isOne(dL)) {
              const innerExpName = dae.getExprKind(innerExp) === ExprKind.Name ? dae.getExprData1(innerExp) : null;
              const dRName = dae.getExprKind(dR) === ExprKind.Name ? dae.getExprData1(dR) : null;
              if (innerExpName !== null && innerExpName === dRName) {
                return innerBase;
              }
            }
          }

          const outNum = getNum(outerExp);
          if (inNum !== null && outNum !== null) {
            const newExp = dae.addRealLiteral(inNum * outNum);
            return dae.addBinaryExpr(BinOp.Pow, innerBase, newExp);
          }
        }
      }
      if (binOp === BinOp.Sub) {
        const leftKind = dae.getExprKind(leftId);
        const rightKind = dae.getExprKind(rightId);
        if (leftKind === ExprKind.IntLiteral && rightKind === ExprKind.IntLiteral) {
          return dae.addIntLiteral(dae.getExprData1(leftId) - dae.getExprData1(rightId));
        }
        if (leftKind === ExprKind.RealLiteral && rightKind === ExprKind.RealLiteral) {
          return dae.addRealLiteral(dae.getExprRealValue(leftId) - dae.getExprRealValue(rightId));
        }
        if (leftKind === ExprKind.ArrayCtor && rightKind === ExprKind.ArrayCtor) {
          const leftElems = getArrayCtorElements(leftId, dae);
          const rightElems = getArrayCtorElements(rightId, dae);
          if (leftElems.length === rightElems.length && leftElems.length > 0) {
            const newElems = leftElems.map((e, i) => addArrayBinaryExpr(BinOp.Sub, e, rightElems[i]!, dae));
            return dae.addArrayCtorExpr(newElems);
          }
        }
        const leftDimsSub = getExprDims(leftId, dae, flattener.db);
        const rightDimsSub = getExprDims(rightId, dae, flattener.db);
        if (leftDimsSub && rightDimsSub && leftDimsSub.length === 2 && rightDimsSub.length === 2) {
          const [M1, N1] = leftDimsSub;
          const [M2, N2] = rightDimsSub;
          if (M1 === M2 && N1 === N2 && (M1 === 0 || N1 === 0)) {
            const resRows: number[] = [];
            for (let i = 0; i < M1!; i++) {
              resRows.push(dae.addArrayCtorExpr([]));
            }
            return dae.addArrayCtorExpr(resRows);
          }
        }
        if (
          flattener.options.omcCompatibility &&
          (rightKind === ExprKind.IntLiteral || rightKind === ExprKind.RealLiteral)
        ) {
          const isReal = isRealExpr(leftId, dae) || rightKind === ExprKind.RealLiteral;
          const rVal = rightKind === ExprKind.RealLiteral ? dae.getExprRealValue(rightId) : dae.getExprData1(rightId);
          const negLitId = isReal ? dae.addRealLiteral(-rVal) : dae.addIntLiteral(-Math.round(rVal));
          let realLeftId = isReal && !isRealExpr(leftId, dae) ? castToRealExpr(leftId, dae) : leftId;
          return dae.addBinaryExpr(BinOp.Add, negLitId, realLeftId);
        }
        if (rightKind === ExprKind.Binary && dae.getExprData1(rightId) === BinOp.Mul) {
          const mulL = dae.getExprLeft(rightId);
          const mulR = dae.getExprRight(rightId);
          const mulLKind = dae.getExprKind(mulL);
          const mulRKind = dae.getExprKind(mulR);
          if (mulLKind === ExprKind.RealLiteral) {
            const negLit = dae.addRealLiteral(-dae.getExprRealValue(mulL));
            const negMul = dae.addBinaryExpr(BinOp.Mul, negLit, mulR);
            return dae.addBinaryExpr(BinOp.Add, leftId, negMul);
          }
          if (mulLKind === ExprKind.IntLiteral) {
            const negLit = dae.addIntLiteral(-dae.getExprData1(mulL));
            const negMul = dae.addBinaryExpr(BinOp.Mul, negLit, mulR);
            return dae.addBinaryExpr(BinOp.Add, leftId, negMul);
          }
          if (mulRKind === ExprKind.RealLiteral) {
            const negLit = dae.addRealLiteral(-dae.getExprRealValue(mulR));
            const negMul = dae.addBinaryExpr(BinOp.Mul, negLit, mulL);
            return dae.addBinaryExpr(BinOp.Add, leftId, negMul);
          }
          if (mulRKind === ExprKind.IntLiteral) {
            const negLit = dae.addIntLiteral(-dae.getExprData1(mulR));
            const negMul = dae.addBinaryExpr(BinOp.Mul, negLit, mulL);
            return dae.addBinaryExpr(BinOp.Add, leftId, negMul);
          }
        }
      }
      if (flattener.options.omcCompatibility && (binOp === BinOp.Add || binOp === BinOp.Sub)) {
        const decomposeLinearTerm = (id: number): { coeff: number; isReal: boolean; baseId: number } => {
          const k = dae.getExprKind(id);
          if (k === ExprKind.Negate) {
            const inner = decomposeLinearTerm(dae.getExprLeft(id));
            return { coeff: -inner.coeff, isReal: inner.isReal, baseId: inner.baseId };
          }
          if (k === ExprKind.Unary && (dae.getExprData1(id) as UnaryOp) === UnaryOp.Negate) {
            const inner = decomposeLinearTerm(dae.getExprLeft(id));
            return { coeff: -inner.coeff, isReal: inner.isReal, baseId: inner.baseId };
          }
          if (k === ExprKind.Binary && (dae.getExprData1(id) === BinOp.Mul || dae.getExprData1(id) === BinOp.ElemMul)) {
            const l = dae.getExprLeft(id);
            const r = dae.getExprRight(id);
            const lKind = dae.getExprKind(l);
            const rKind = dae.getExprKind(r);
            if (lKind === ExprKind.RealLiteral || lKind === ExprKind.IntLiteral) {
              const isReal = lKind === ExprKind.RealLiteral;
              const v = isReal ? dae.getExprRealValue(l) : dae.getExprData1(l);
              const inner = decomposeLinearTerm(r);
              return { coeff: v * inner.coeff, isReal: isReal || inner.isReal, baseId: inner.baseId };
            }
            if (rKind === ExprKind.RealLiteral || rKind === ExprKind.IntLiteral) {
              const isReal = rKind === ExprKind.RealLiteral;
              const v = isReal ? dae.getExprRealValue(r) : dae.getExprData1(r);
              const inner = decomposeLinearTerm(l);
              return { coeff: v * inner.coeff, isReal: isReal || inner.isReal, baseId: inner.baseId };
            }
          }
          if (k === ExprKind.Binary && (dae.getExprData1(id) === BinOp.Div || dae.getExprData1(id) === BinOp.ElemDiv)) {
            const l = dae.getExprLeft(id);
            const r = dae.getExprRight(id);
            const rKind = dae.getExprKind(r);
            if (rKind === ExprKind.RealLiteral || rKind === ExprKind.IntLiteral) {
              const isReal = rKind === ExprKind.RealLiteral;
              const v = isReal ? dae.getExprRealValue(r) : dae.getExprData1(r);
              if (v !== 0) {
                const inner = decomposeLinearTerm(l);
                return { coeff: inner.coeff / v, isReal: isReal || inner.isReal, baseId: inner.baseId };
              }
            }
          }
          return { coeff: 1, isReal: false, baseId: id };
        };

        const isLiteralKind = (id: number): boolean => {
          const k = dae.getExprKind(id);
          return (
            k === ExprKind.RealLiteral ||
            k === ExprKind.IntLiteral ||
            k === ExprKind.BoolLiteral ||
            k === ExprKind.StringLiteral
          );
        };

        const term1 = decomposeLinearTerm(leftId);
        const term2 = decomposeLinearTerm(rightId);
        if (!isLiteralKind(term1.baseId) && areExpressionsEqual(dae, term1.baseId, term2.baseId)) {
          const totalCoeff = binOp === BinOp.Add ? term1.coeff + term2.coeff : term1.coeff - term2.coeff;
          const isReal = term1.isReal || term2.isReal || isRealExpr(term1.baseId, dae) || !Number.isInteger(totalCoeff);
          if (Math.abs(totalCoeff) < 1e-12) {
            const dims = getExprDims(term1.baseId, dae, flattener?.db);
            if (dims && dims.length > 0) {
              if (dims.every((d) => d > 0)) {
                const buildZeros = (dimIdx: number): number => {
                  if (dimIdx === dims.length) {
                    return isReal ? dae.addRealLiteral(0.0) : dae.addIntLiteral(0);
                  }
                  const children: number[] = [];
                  for (let j = 0; j < dims[dimIdx]!; j++) {
                    children.push(buildZeros(dimIdx + 1));
                  }
                  return dae.addArrayCtorExpr(children);
                };
                return buildZeros(0);
              }
              return dae.addBinaryExpr(binOp, leftId, rightId);
            }
            return isReal ? dae.addRealLiteral(0.0) : dae.addIntLiteral(0);
          }
          if (totalCoeff === 1) {
            return term1.baseId;
          }
          if (totalCoeff === -1) {
            return dae.addUnaryExpr(UnaryOp.Negate, term1.baseId);
          }
          const coeffLit = isReal ? dae.addRealLiteral(totalCoeff) : dae.addIntLiteral(totalCoeff);
          return dae.addBinaryExpr(BinOp.Mul, coeffLit, term1.baseId);
        }
        const getMulFactors = (exprId: number): number[] => {
          if (dae.getExprKind(exprId) === ExprKind.Binary && dae.getExprData1(exprId) === BinOp.Mul) {
            return [...getMulFactors(dae.getExprLeft(exprId)), ...getMulFactors(dae.getExprRight(exprId))];
          }
          return [exprId];
        };
        const leftFactors = getMulFactors(leftId);
        const rightFactors = getMulFactors(rightId);
        if (leftFactors.length > 1 || rightFactors.length > 1) {
          const areFactorsEqual = (f1: number, f2: number): boolean => {
            const k1 = dae.getExprKind(f1);
            const k2 = dae.getExprKind(f2);
            if (k1 !== k2) {
              if (
                (k1 === ExprKind.RealLiteral || k1 === ExprKind.IntLiteral) &&
                (k2 === ExprKind.RealLiteral || k2 === ExprKind.IntLiteral)
              ) {
                const v1 = k1 === ExprKind.RealLiteral ? dae.getExprRealValue(f1) : dae.getExprData1(f1);
                const v2 = k2 === ExprKind.RealLiteral ? dae.getExprRealValue(f2) : dae.getExprData1(f2);
                return v1 === v2;
              }
              return false;
            }
            if (k1 === ExprKind.Name) {
              return dae.interner.resolve(dae.getExprData1(f1)) === dae.interner.resolve(dae.getExprData1(f2));
            }
            if (k1 === ExprKind.RealLiteral) {
              return dae.getExprRealValue(f1) === dae.getExprRealValue(f2);
            }
            if (k1 === ExprKind.IntLiteral) {
              return dae.getExprData1(f1) === dae.getExprData1(f2);
            }
            return false;
          };

          let matchLeftIdx = -1;
          let matchRightIdx = -1;
          for (let li = 0; li < leftFactors.length; li++) {
            const factorId = leftFactors[li]!;
            const kind = dae.getExprKind(factorId);
            if (kind === ExprKind.Name) {
              const nameStr = dae.interner.resolve(dae.getExprData1(factorId));
              let vIdx = dae.getVarIdxByName(nameStr);
              if (vIdx < 0 && prefix) {
                vIdx = dae.getVarIdxByName(`${prefix}.${nameStr}`);
              }
              if (vIdx >= 0) {
                const variability = dae.getVarVariability(vIdx);
                if (variability === Variability.Continuous || variability === Variability.Discrete) {
                  continue;
                }
              }
            } else if (kind !== ExprKind.IntLiteral && kind !== ExprKind.RealLiteral) {
              continue;
            }
            for (let ri = 0; ri < rightFactors.length; ri++) {
              if (areFactorsEqual(leftFactors[li]!, rightFactors[ri]!)) {
                matchLeftIdx = li;
                matchRightIdx = ri;
                break;
              }
            }
            if (matchLeftIdx >= 0) break;
          }

          if (matchLeftIdx >= 0 && matchRightIdx >= 0) {
            let commonFactorId = leftFactors[matchLeftIdx]!;
            const remLeft = leftFactors.filter((_, idx) => idx !== matchLeftIdx);
            const remRight = rightFactors.filter((_, idx) => idx !== matchRightIdx);
            const rebuildMul = (factors: number[]): number => {
              if (factors.length === 0) return dae.addRealLiteral(1.0);
              let res = factors[0]!;
              for (let i = 1; i < factors.length; i++) {
                res = dae.addBinaryExpr(BinOp.Mul, res, factors[i]!);
              }
              return res;
            };
            let innerLeft = rebuildMul(remLeft);
            let innerRight = rebuildMul(remRight);
            if (isRealExpr(innerLeft, dae) && !isRealExpr(innerRight, dae)) {
              innerRight = castToRealExpr(innerRight, dae);
            } else if (!isRealExpr(innerLeft, dae) && isRealExpr(innerRight, dae)) {
              innerLeft = castToRealExpr(innerLeft, dae);
            }
            const innerAddSub = dae.addBinaryExpr(binOp, innerLeft, innerRight);
            if (isRealExpr(innerAddSub, dae) && !isRealExpr(commonFactorId, dae)) {
              commonFactorId = castToRealExpr(commonFactorId, dae);
            }
            return dae.addBinaryExpr(BinOp.Mul, commonFactorId, innerAddSub);
          }
        }
      }
      if (binOp === BinOp.Div) {
        const leftKind = dae.getExprKind(leftId);
        const rightKind = dae.getExprKind(rightId);
        if (
          (leftKind === ExprKind.IntLiteral || leftKind === ExprKind.RealLiteral) &&
          (rightKind === ExprKind.IntLiteral || rightKind === ExprKind.RealLiteral)
        ) {
          const lVal = leftKind === ExprKind.IntLiteral ? dae.getExprData1(leftId) : dae.getExprRealValue(leftId);
          const rVal = rightKind === ExprKind.IntLiteral ? dae.getExprData1(rightId) : dae.getExprRealValue(rightId);
          if (rVal !== 0) {
            return dae.addRealLiteral(lVal / rVal);
          }
        }
        if (
          flattener.options.omcCompatibility &&
          (rightKind === ExprKind.IntLiteral || rightKind === ExprKind.RealLiteral) &&
          leftKind !== ExprKind.IntLiteral &&
          leftKind !== ExprKind.RealLiteral
        ) {
          const rVal = rightKind === ExprKind.IntLiteral ? dae.getExprData1(rightId) : dae.getExprRealValue(rightId);
          if (rVal !== 0) {
            const reciprocal = 1 / rVal;
            let realLeftId = isRealExpr(leftId, dae) ? leftId : castToRealExpr(leftId, dae);
            if (leftKind === ExprKind.Negate) {
              return dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(-reciprocal), dae.getExprLeft(realLeftId));
            }
            if (leftKind === ExprKind.Unary && (dae.getExprData1(leftId) as UnaryOp) === UnaryOp.Negate) {
              return dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(-reciprocal), dae.getExprLeft(realLeftId));
            }
            return dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(reciprocal), realLeftId);
          }
        }
        if (leftKind === ExprKind.Call && rightKind === ExprKind.Call) {
          const leftFn = dae.interner.resolve(dae.getExprData1(leftId));
          const rightFn = dae.interner.resolve(dae.getExprData1(rightId));
          if (leftFn === "sin" && rightFn === "cos") {
            const leftArg = dae.getExprLeft(leftId);
            const rightArg = dae.getExprLeft(rightId);
            const leftArgCount = dae.getExprRight(leftId);
            const rightArgCount = dae.getExprRight(rightId);
            const sameArg = leftArg === rightArg || areExpressionsEqual(dae, leftArg, rightArg);
            if (leftArgCount === 1 && rightArgCount === 1 && sameArg) {
              return dae.addCallExpr("tan", [leftArg]);
            }
          }
        }
      }
      if (binOp === BinOp.Mul) {
        const isOne = (id: number): boolean => {
          const k = dae.getExprKind(id);
          if (k === ExprKind.IntLiteral && dae.getExprData1(id) === 1) return true;
          if (k === ExprKind.RealLiteral && dae.getExprRealValue(id) === 1.0) return true;
          return false;
        };
        if (isOne(leftId)) return rightId;
        if (isOne(rightId)) return leftId;
        const isOldFrontend = Boolean(dae.extensionMetadata?.isOldFrontend);
        if (isOldFrontend && exprsEqual(leftId, rightId, dae) && dae.classKind !== "function") {
          const isReal = isRealExpr(leftId, dae);
          return dae.addBinaryExpr(BinOp.Pow, leftId, isReal ? dae.addRealLiteral(2.0) : dae.addIntLiteral(2));
        }
        const leftText =
          dae.getExprKind(leftId) === ExprKind.Name ? dae.interner.resolve(dae.getExprData1(leftId)) : null;
        const rightText =
          dae.getExprKind(rightId) === ExprKind.Name ? dae.interner.resolve(dae.getExprData1(rightId)) : null;
        const isOmc = flattener?.options?.omcCompatibility ?? (dae as any).flattener?.options?.omcCompatibility ?? true;
        if (
          !isOmc &&
          leftText &&
          leftText === rightText &&
          dae.classKind !== "function" &&
          !dae.hasArrayElements(leftText)
        ) {
          const twoExpr = dae.addRealLiteral(2.0);
          return dae.addBinaryExpr(BinOp.Pow, leftId, twoExpr);
        }
      }
      if (binOp === BinOp.Div || binOp === BinOp.Pow) {
        if (!isRealExpr(leftId, dae)) {
          leftId = castToRealExpr(leftId, dae);
        }
        if (!isRealExpr(rightId, dae)) {
          rightId = castToRealExpr(rightId, dae);
        }
      } else if (isRealExpr(leftId, dae) && !isRealExpr(rightId, dae)) {
        rightId = castToRealExpr(rightId, dae);
      } else if (!isRealExpr(leftId, dae) && isRealExpr(rightId, dae)) {
        leftId = castToRealExpr(leftId, dae);
      }
      if (flattener.options.omcCompatibility && binOp === BinOp.Add) {
        const isNegatedExpr = (id: number): { isNeg: boolean; posId: number } => {
          const k = dae.getExprKind(id);
          if (k === ExprKind.Negate) {
            return { isNeg: true, posId: dae.getExprLeft(id) };
          }
          if (k === ExprKind.Unary && (dae.getExprData1(id) as UnaryOp) === UnaryOp.Negate) {
            return { isNeg: true, posId: dae.getExprLeft(id) };
          }
          if (k === ExprKind.Binary && dae.getExprData1(id) === BinOp.Mul) {
            const mL = dae.getExprLeft(id);
            const mR = dae.getExprRight(id);
            const nL = isNegatedExpr(mL);
            if (nL.isNeg) {
              return { isNeg: true, posId: dae.addBinaryExpr(BinOp.Mul, nL.posId, mR) };
            }
          }
          return { isNeg: false, posId: id };
        };
        const negL = isNegatedExpr(leftId);
        if (negL.isNeg) {
          return dae.addBinaryExpr(BinOp.Sub, rightId, negL.posId);
        }
        if (dae.classKind !== "function" && !tupleContext && !isAssignmentLhs) {
          const leftKind = dae.getExprKind(leftId);
          const rightKind = dae.getExprKind(rightId);
          const isLeftLit = leftKind === ExprKind.IntLiteral || leftKind === ExprKind.RealLiteral;
          const isRightLit = rightKind === ExprKind.IntLiteral || rightKind === ExprKind.RealLiteral;
          if (!isLeftLit && isRightLit) {
            [leftId, rightId] = [rightId, leftId];
          }
        }
      }
      if (flattener.options.omcCompatibility && binOp === BinOp.Mul) {
        const leftKind = dae.getExprKind(leftId);
        const rightKind = dae.getExprKind(rightId);
        const isLeftLit = leftKind === ExprKind.IntLiteral || leftKind === ExprKind.RealLiteral;
        const isRightLit = rightKind === ExprKind.IntLiteral || rightKind === ExprKind.RealLiteral;
        if (!isLeftLit && isRightLit) {
          [leftId, rightId] = [rightId, leftId];
        }
      }
      if (
        (binOp === BinOp.Eq ||
          binOp === BinOp.Neq ||
          binOp === BinOp.Lt ||
          binOp === BinOp.Lte ||
          binOp === BinOp.Gt ||
          binOp === BinOp.Gte) &&
        dae.getExprKind(leftId) === ExprKind.StringLiteral &&
        dae.getExprKind(rightId) === ExprKind.StringLiteral
      ) {
        const s1 = dae.interner.resolve(dae.getExprData1(leftId)) ?? "";
        const s2 = dae.interner.resolve(dae.getExprData1(rightId)) ?? "";
        let res: boolean;
        switch (binOp) {
          case BinOp.Eq:
            res = s1 === s2;
            break;
          case BinOp.Neq:
            res = s1 !== s2;
            break;
          case BinOp.Lt:
            res = s1 < s2;
            break;
          case BinOp.Lte:
            res = s1 <= s2;
            break;
          case BinOp.Gt:
            res = s1 > s2;
            break;
          case BinOp.Gte:
            res = s1 >= s2;
            break;
          default:
            res = false;
        }
        return dae.addBoolLiteral(res);
      }
      return dae.addBinaryExpr(binOp, leftId, rightId);
    }
  }

  // Unary expression: -expr or +expr or not expr
  if (node.childCount === 2) {
    const rawOp = node.child(0)?.text?.trim() ?? node.child(0)?.type ?? "";
    const op = rawOp.replace(/^"|"$/g, "");
    if (op === "-") {
      const operandId = lowerCSTExpression(node.child(1), dae, prefix, substitutions, imports, db, flattener);
      if (db && flattener) {
        const dispatched = dispatchUnaryOperator("'-'", operandId, node.child(1), dae, db, flattener);
        if (dispatched !== null) return dispatched;
      }
      return negateExpr(operandId, dae);
    }

    if (op === "+") {
      const operandId = lowerCSTExpression(node.child(1), dae, prefix, substitutions, imports, db, flattener);
      if (db && flattener) {
        const dispatched = dispatchUnaryOperator("'+'", operandId, node.child(1), dae, db, flattener);
        if (dispatched !== null) return dispatched;
      }
      return operandId;
    }
    if (op === "not") {
      const operandId = lowerCSTExpression(node.child(1), dae, prefix, substitutions, imports, db, flattener);
      if (db && flattener) {
        const dispatched = dispatchUnaryOperator("'not'", operandId, node.child(1), dae, db, flattener);
        if (dispatched !== null) return dispatched;
      }
      return dae.addExpression(ExprKind.Unary, UnaryOp.Not, operandId);
    }
  }

  function tryLowerSlicedCref(
    rawParts: { ident: string; hasSubscripts: boolean; subscripts: any[] }[],
    dae: DAEBuilder,
    prefix: string,
    db?: any,
    flattener?: any,
  ): { exprId: number; shape: number[] } | null {
    if (rawParts.length < 2 || !db) return null;

    interface PartInfo {
      ident: string;
      existingSubStrs: string[];
      slicedDims: number[];
    }
    const partInfos: PartInfo[] = [];
    let currentClassId: any = null;

    for (let i = 0; i < rawParts.length; i++) {
      const part = rawParts[i]!;
      const existingSubStrs = part.subscripts.map(
        (s) => s.scalarText ?? (s.values?.[0] !== undefined ? String(s.values[0]) : s.text),
      );

      if (i === 0) {
        let compSym: any = null;
        let compInst: any = null;
        let dims: number[] = [];

        if (flattener?.currentFlatteningFunctionId) {
          const children = (db.childrenOf(flattener.currentFlatteningFunctionId) || [])
            .map((id: any) => (typeof id === "number" ? db.symbol(id) : id))
            .filter(Boolean);
          compSym = children.find((c: any) => c.name === part.ident && c.kind === "Component");
        }
        if (!compSym && flattener?.currentClassId) {
          const children = (db.childrenOf(flattener.currentClassId) || [])
            .map((id: any) => (typeof id === "number" ? db.symbol(id) : id))
            .filter(Boolean);
          compSym = children.find((c: any) => c.name === part.ident && c.kind === "Component");
        }
        if (!compSym && flattener?.currentRootClassId) {
          const children = (db.childrenOf(flattener.currentRootClassId) || [])
            .map((id: any) => (typeof id === "number" ? db.symbol(id) : id))
            .filter(Boolean);
          compSym = children.find((c: any) => c.name === part.ident && c.kind === "Component");
        }
        if (!compSym) {
          const syms = db.byName(part.ident);
          compSym = syms?.find((c: any) => c.kind === "Component");
        }

        if (compSym) {
          compInst = db.query("componentInstance", compSym.id);
          if (compInst?.arrayDimensions && compInst.arrayDimensions.length > 0) {
            dims = compInst.arrayDimensions;
          }
        }

        if (dims.length === 0) {
          const vIdx =
            dae.getVarIdxByName(part.ident) >= 0 ? dae.getVarIdxByName(part.ident) : dae.lookupVariable(part.ident);
          if (vIdx >= 0) {
            const s = dae.getVarShape(vIdx);
            if (s && s.length > 0 && s.every((d: number) => d > 0)) {
              dims = s;
            }
          }
          if (dims.length === 0 && dae.hasArrayElements(part.ident)) {
            const dimSize = getDaeDimSize(prefix, part.ident, 0, dae, db);
            if (dimSize > 0) dims = [dimSize];
          }
        }

        const providedCount = part.subscripts.length;
        const sliced = providedCount < dims.length ? dims.slice(providedCount) : [];
        partInfos.push({ ident: part.ident, existingSubStrs, slicedDims: sliced });

        currentClassId = compInst?.classInstance;
        if (!currentClassId) {
          const vIdx =
            dae.getVarIdxByName(part.ident) >= 0 ? dae.getVarIdxByName(part.ident) : dae.lookupVariable(part.ident);
          const typeName = compInst?.typeSpecifier ?? (vIdx >= 0 ? dae.getVarCustomType(vIdx) : null);
          if (typeName) {
            const syms = db.byName(typeName);
            const found = syms?.find((s: any) => s.kind === "Class" || s.kind === "Record" || s.kind === "Package");
            if (found) currentClassId = found.id;
          }
        }
      } else {
        if (!currentClassId) return null;
        const children = (db.childrenOf(currentClassId) || [])
          .map((id: any) => (typeof id === "number" ? db.symbol(id) : id))
          .filter(Boolean);
        const childSym = children.find((c: any) => c.name === part.ident && c.kind === "Component");
        if (!childSym) return null;

        const childInst = db.query("componentInstance", childSym.id);
        const dims: number[] = childInst?.arrayDimensions ?? [];
        const providedCount = part.subscripts.length;
        const sliced = providedCount < dims.length ? dims.slice(providedCount) : [];
        partInfos.push({ ident: part.ident, existingSubStrs, slicedDims: sliced });

        currentClassId = childInst?.classInstance;
        if (!currentClassId && childInst?.typeSpecifier) {
          const syms = db.byName(childInst.typeSpecifier);
          const found = syms?.find((s: any) => s.kind === "Class" || s.kind === "Record" || s.kind === "Package");
          if (found) currentClassId = found.id;
        }
      }
    }

    const allSlicedDims: number[] = [];
    for (const p of partInfos) allSlicedDims.push(...p.slicedDims);
    if (allSlicedDims.length === 0) return null;

    const N = allSlicedDims.length;
    let dimIdx = 0;
    const partStrs: string[] = [];
    for (const p of partInfos) {
      if (p.slicedDims.length > 0) {
        const iters: string[] = [];
        for (let d = 0; d < p.slicedDims.length; d++) {
          iters.push(`$i${N - 1 - dimIdx}`);
          dimIdx++;
        }
        const combined = [...p.existingSubStrs, ...iters];
        partStrs.push(`${p.ident}[${combined.join(",")}]`);
      } else if (p.existingSubStrs.length > 0) {
        partStrs.push(`${p.ident}[${p.existingSubStrs.join(",")}]`);
      } else {
        partStrs.push(p.ident);
      }
    }

    const targetExprStr = partStrs.join(".");
    let currExprId = dae.addNameExpr(targetExprStr);
    for (let k = N - 1; k >= 0; k--) {
      const iterName = `$i${N - 1 - k}`;
      const dimSize = allSlicedDims[k]!;
      const rangeId = dae.addRange(dae.addIntLiteral(1), dae.addIntLiteral(dimSize));
      currExprId = dae.addComprehensionExpr("array", currExprId, [{ name: iterName, rangeId }]);
    }

    return { exprId: currExprId, shape: allSlicedDims };
  }

  // Identifier / Name / Component Reference
  if (
    type === "identifier" ||
    type === "name" ||
    type === "component_reference" ||
    (node.childCount === 0 && /^[a-zA-Z_]\w*$/.test(node.text?.trim() ?? ""))
  ) {
    let rawName = node.text.trim();
    if (substitutions && substitutions.has(rawName)) {
      const sVal = substitutions.get(rawName)!;
      if (typeof sVal === "number") {
        return dae.addIntLiteral(sVal);
      }
      if (sVal === "true" || sVal === "false") {
        return dae.addExpression(ExprKind.BoolLiteral, sVal === "true" ? 1 : 0);
      }
      return dae.addExpression(ExprKind.Name, dae.interner.intern(sVal));
    }
    if (flattener?.activeLoopVars?.has(rawName)) {
      return dae.addExpression(ExprKind.Name, dae.interner.intern(rawName));
    }

    if (type === "component_reference") {
      interface RawPartSubscript {
        node: any;
        text: string;
        isSlice: boolean;
        values: number[];
        scalarText?: string;
        isRealSub?: boolean;
      }
      interface RawPart {
        ident: string;
        hasSubscripts: boolean;
        subscripts: RawPartSubscript[];
      }
      const rawParts: RawPart[] = [];
      let currentIdent = "";
      for (const child of node.children || []) {
        const cType = child.type;
        const cText = child.text?.trim() ?? "";
        if (cType === "identifier" || cType === "property" || cType === "name") {
          currentIdent = cText;
          rawParts.push({ ident: currentIdent, hasSubscripts: false, subscripts: [] });
        } else if (cType === "array_subscripts" && rawParts.length > 0) {
          const lastPart = rawParts[rawParts.length - 1]!;
          lastPart.hasSubscripts = true;
          for (const sub of child.children || []) {
            if (sub.type === "subscript") {
              const expr = sub.children?.find((k: any) => k.type === "expression") ?? sub;
              const subText = expr.text?.trim() ?? "";

              let isConnRef = false;
              let currP = node.parent;
              while (currP) {
                const pType = currP.type;
                if (pType === "connect_equation" || pType === "connect_clause" || pType === "ConnectEquation") {
                  isConnRef = true;
                  break;
                }
                if (
                  (pType === "primary" || pType === "function_call" || pType === "FunctionCall") &&
                  (currP.child(0)?.text?.trim() === "inStream" || currP.child(0)?.text?.trim() === "actualStream")
                ) {
                  isConnRef = true;
                  break;
                }
                if (pType === "function_call_args" || pType === "FunctionCallArgs") {
                  const c0 = currP.parent?.child(0)?.text?.trim();
                  if (c0 === "inStream" || c0 === "actualStream") {
                    isConnRef = true;
                    break;
                  }
                }
                if (pType === "simple_equation" || pType?.endsWith("_equation") || pType === "component_clause") {
                  break;
                }
                currP = currP.parent;
              }

              if (isConnRef) {
                const idMatches = subText.match(/\b[a-zA-Z_]\w*\b/g);
                if (idMatches) {
                  for (const idm of idMatches) {
                    if (
                      idm === "true" ||
                      idm === "false" ||
                      idm === "end" ||
                      idm === "if" ||
                      idm === "then" ||
                      idm === "else" ||
                      idm === "elseif" ||
                      substitutions?.has(idm) ||
                      flattener?.activeLoopVars?.has(idm)
                    )
                      continue;
                    let isLoop = false;
                    let p = node?.parent;
                    while (p) {
                      if (p.type === "for_equation" || p.type === "for_statement") {
                        const indicesNode = (p.children || []).find((c: any) => c.type === "for_indices");
                        const forIndices = (indicesNode?.children || []).filter((c: any) => c.type === "for_index");
                        for (const fi of forIndices) {
                          const vName = Cst.ForIndex.variable(fi)?.text?.trim() || fi.child(0)?.text?.trim();
                          if (vName === idm) {
                            isLoop = true;
                            break;
                          }
                        }
                        if (isLoop) break;
                      }
                      p = p.parent;
                    }
                    if (isLoop) continue;
                    const candidates = [
                      prefix ? `${prefix}.${idm}` : idm,
                      prefix.includes(".") ? `${prefix.split(".").slice(0, -1).join(".")}.${idm}` : idm,
                      idm,
                    ];
                    let foundVarIdx = -1;
                    for (const c of candidates) {
                      const vi = dae.lookupVariable(c);
                      if (vi >= 0) {
                        foundVarIdx = vi;
                        break;
                      }
                    }
                    let isParam = false;
                    if (foundVarIdx >= 0) {
                      const vari = dae.getVarVariability(foundVarIdx);
                      if (vari === Variability.Parameter || vari === Variability.Constant) {
                        isParam = true;
                        if (
                          !dae.extensionMetadata?.isOldFrontend &&
                          vari === Variability.Parameter &&
                          dae.getVarType(foundVarIdx) === VarType.Integer
                        ) {
                          dae.setVarFinal(foundVarIdx, true);
                        }
                      }
                    } else if (db) {
                      const classId = flattener?.currentRootClassId;
                      if (classId) {
                        const resolver = db.query<(n: string) => SymbolEntry | null>("resolveSimpleName", classId);
                        const sym = resolver ? resolver(idm) : null;
                        if (sym) {
                          const symVari = db.query<string | null>("variability", sym.id);
                          if (symVari === "parameter" || symVari === "constant") {
                            isParam = true;
                          }
                        }
                      }
                    }
                    if (!isParam) {
                      const r = {
                        startByte: node.startIndex ?? node.startByte ?? 0,
                        endByte: node.endIndex ?? node.endByte ?? 0,
                        startPosition: node.startPosition,
                        endPosition: node.endPosition,
                      };
                      dae.diagnostics.push({
                        severity: "error",
                        code: ModelicaErrorCode.CONNECTOR_NON_PARAMETER_SUBSCRIPT.code,
                        message: `Connector '${node.text?.trim() ?? ""}' has non-parameter subscript '${subText}'.`,
                        range: r,
                      });
                      return -1;
                    }
                  }
                }
              }
              const dimIdx = lastPart.subscripts.length;
              const fullIdent = rawParts.map((p) => p.ident).join(".");
              const dimSize =
                getDaeDimSize(prefix, fullIdent, dimIdx, dae, db) ||
                getDaeDimSize(prefix, lastPart.ident, dimIdx, dae, db);
              const subsWithEnd = new Map<string, number>(substitutions ? (substitutions as any) : []);
              if (dimSize > 0) {
                subsWithEnd.set("end", dimSize);
              }

              // 1. Colon slice: [:]
              if (subText === ":") {
                const vals = dimSize > 0 ? Array.from({ length: dimSize }, (_, i) => i + 1) : [];
                lastPart.subscripts.push({
                  node: sub,
                  text: subText,
                  isSlice: true,
                  values: vals,
                });
                continue;
              }

              // 2. Array constructor slice: e.g. {1, 3} or {2}
              if (subText.startsWith("{") && subText.endsWith("}")) {
                const inner = subText.slice(1, -1).trim();
                const items = inner.length > 0 ? inner.split(",") : [];
                const vals: number[] = [];
                for (const item of items) {
                  const it = item.trim();
                  let iv = parseInt(it, 10);
                  if (isNaN(iv) && subsWithEnd && subsWithEnd.has(it)) {
                    const s = subsWithEnd.get(it);
                    if (typeof s === "number") iv = s;
                  }
                  if (!isNaN(iv)) {
                    vals.push(iv);
                  }
                }
                lastPart.subscripts.push({
                  node: sub,
                  text: subText,
                  isSlice: true,
                  values: vals,
                });
                continue;
              }

              // 3. Range with colon: e.g. 2:n+1 or 1:2:4
              if (subText.includes(":")) {
                let startNode: any = null;
                let stepNode: any = null;
                let stopNode: any = null;
                const colonNodes = expr ? flattenColonNodes(expr) : [];
                if (colonNodes.length === 2) {
                  startNode = colonNodes[0];
                  stopNode = colonNodes[1];
                } else if (colonNodes.length === 3) {
                  startNode = colonNodes[0];
                  stepNode = colonNodes[1];
                  stopNode = colonNodes[2];
                } else if (expr.childCount === 3 && (expr.child(1)?.text?.trim() ?? "") === ":") {
                  const c0 = expr.child(0);
                  if (c0.childCount === 3 && (c0.child(1)?.text?.trim() ?? "") === ":") {
                    startNode = c0.child(0);
                    stepNode = c0.child(2);
                    stopNode = expr.child(2);
                  } else {
                    startNode = c0;
                    stopNode = expr.child(2);
                  }
                }
                const evalBound = (bNode: any): number | null => {
                  if (!bNode) return null;
                  const t = (typeof bNode === "string" ? bNode : bNode.text)?.trim() ?? "";
                  if (t === "end") return dimSize > 0 ? dimSize : null;
                  if (t === "false") return 1;
                  if (t === "true") return 2;
                  if (subsWithEnd && subsWithEnd.has(t)) {
                    const s = subsWithEnd.get(t);
                    if (typeof s === "number") return s;
                  }
                  const numVal = evaluateCSTNumber(bNode, subsWithEnd as any, undefined, db, dae, prefix);
                  if (numVal !== null) return numVal;
                  const arithVal = evalArithmeticText(t, subsWithEnd);
                  if (arithVal !== null) return arithVal;
                  if (db) {
                    const enumIdx = getEnumLiteralIndex(t, db);
                    if (enumIdx !== null) return enumIdx;
                  }
                  return null;
                };
                let startVal = startNode ? evalBound(startNode) : null;
                let stopVal = stopNode ? evalBound(stopNode) : null;
                let stepVal = stepNode ? (evalBound(stepNode) ?? 1) : 1;
                if (startVal === null || stopVal === null) {
                  const colonParts = subText.split(":");
                  if (colonParts.length === 2) {
                    startVal = evalBound(colonParts[0]);
                    stopVal = evalBound(colonParts[1]);
                  } else if (colonParts.length === 3) {
                    startVal = evalBound(colonParts[0]);
                    stepVal = evalBound(colonParts[1]) ?? 1;
                    stopVal = evalBound(colonParts[2]);
                  }
                }
                if (startVal !== null && stopVal !== null) {
                  const vals: number[] = [];
                  if (stepVal > 0) {
                    for (let idx = startVal; idx <= stopVal; idx += stepVal) vals.push(idx);
                  } else if (stepVal < 0) {
                    for (let idx = startVal; idx >= stopVal; idx += stepVal) vals.push(idx);
                  }
                  lastPart.subscripts.push({
                    node: sub,
                    text: subText,
                    isSlice: true,
                    values: vals,
                  });
                  continue;
                }
              }

              // 4. Scalar subscript
              let isLoopVar = false;
              if (flattener?.activeLoopVars && flattener.activeLoopVars.size > 0) {
                if (flattener.activeLoopVars.has(subText)) {
                  isLoopVar = true;
                } else {
                  const idRegex = /\b[a-zA-Z_]\w*\b/g;
                  let m: RegExpExecArray | null;
                  while ((m = idRegex.exec(subText)) !== null) {
                    if (flattener.activeLoopVars.has(m[0])) {
                      isLoopVar = true;
                      break;
                    }
                  }
                }
              }
              if (subsWithEnd && subsWithEnd.has(subText)) {
                const sVal = subsWithEnd.get(subText)!;
                lastPart.subscripts.push({
                  node: sub,
                  text: subText,
                  isSlice: false,
                  values: typeof sVal === "number" ? [sVal] : [],
                  scalarText: String(sVal),
                });
                continue;
              }

              let isRealSub = false;
              if (!isLoopVar && (/\b\d+\.\d+\b/.test(subText) || /[a-zA-Z0-9_)]\s*\/\s*[a-zA-Z0-9_(]/.test(subText))) {
                isRealSub = true;
              }
              const evaluatedNum =
                isLoopVar || isRealSub
                  ? null
                  : (evaluateCSTNumber(expr, subsWithEnd as any, undefined, undefined, dae, prefix) ??
                    evalArithmeticText(subText, subsWithEnd));
              if (evaluatedNum !== null) {
                if (db && !isLoopVar) {
                  const classId = flattener?.currentClassId ?? flattener?.currentRootClassId;
                  const resolver = classId
                    ? db.query<(n: string) => SymbolEntry | null>("resolveSimpleName", classId)
                    : null;
                  const compSym = resolver ? resolver(lastPart.ident) : null;
                  if (compSym) {
                    const cst = db.cstNode(compSym.id);
                    if (cst) {
                      const findArraySubscripts = (n: any): any => {
                        if (!n) return null;
                        if (n.type === "array_subscripts") return n;
                        for (const ch of n.children || []) {
                          const res = findArraySubscripts(ch);
                          if (res) return res;
                        }
                        return null;
                      };
                      const arrSubsNode = findArraySubscripts(cst);
                      const declSubs = arrSubsNode?.children?.filter((c: any) => c.type === "subscript") ?? [];
                      if (dimIdx < declSubs.length) {
                        const dimSubText = declSubs[dimIdx].text?.trim() ?? "";
                        const enumInfo = resolveEnumType(dimSubText, classId, db);
                        if (enumInfo) {
                          let cur: any = node;
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
                          const simpleName = enumInfo.qual.includes(".")
                            ? enumInfo.qual.split(".").pop()!
                            : enumInfo.qual;
                          const enumTypeStr = `enumeration ${simpleName}(${enumInfo.literals.join(", ")})`;
                          dae.diagnostics.push({
                            severity: "error",
                            code: ModelicaErrorCode.FUNCTION_ARG_TYPE_MISMATCH.code,
                            message: `Subscript '${subText}' has type Integer, expected type ${enumTypeStr}.`,
                            range: diagRange,
                          });
                          return -1;
                        }
                      }
                    }
                  }
                }
                lastPart.subscripts.push({
                  node: sub,
                  text: subText,
                  isSlice: false,
                  values: [evaluatedNum],
                  scalarText: String(evaluatedNum),
                });
              } else {
                const subId = lowerCSTExpression(expr, dae, prefix, subsWithEnd as any, imports, db, flattener);
                if (subId >= 0) {
                  const subType = inferArenaExprVarType(dae, subId);
                  const subKind = dae.getExprKind(subId);
                  if (subKind === ExprKind.StringLiteral || subType === VarType.String) {
                    let cur: any = node;
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
                      message: `Subscript '${subText}' has type String, expected type Integer.`,
                      range: diagRange,
                    });
                    return -1;
                  }
                  if (db && !isLoopVar && (subKind === ExprKind.IntLiteral || subType === VarType.Integer)) {
                    const classId = flattener?.currentClassId ?? flattener?.currentRootClassId;
                    const resolver = classId
                      ? db.query<(n: string) => SymbolEntry | null>("resolveSimpleName", classId)
                      : null;
                    const compSym = resolver ? resolver(lastPart.ident) : null;
                    if (compSym) {
                      const cst = db.cstNode(compSym.id);
                      if (cst) {
                        const findArraySubscripts = (n: any): any => {
                          if (!n) return null;
                          if (n.type === "array_subscripts") return n;
                          for (const ch of n.children || []) {
                            const res = findArraySubscripts(ch);
                            if (res) return res;
                          }
                          return null;
                        };
                        const arrSubsNode = findArraySubscripts(cst);
                        const declSubs = arrSubsNode?.children?.filter((c: any) => c.type === "subscript") ?? [];
                        if (dimIdx < declSubs.length) {
                          const dimSubText = declSubs[dimIdx].text?.trim() ?? "";
                          const enumInfo = resolveEnumType(dimSubText, classId, db);
                          if (enumInfo) {
                            let cur: any = node;
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
                            const simpleName = enumInfo.qual.includes(".")
                              ? enumInfo.qual.split(".").pop()!
                              : enumInfo.qual;
                            const enumTypeStr = `enumeration ${simpleName}(${enumInfo.literals.join(", ")})`;
                            dae.diagnostics.push({
                              severity: "error",
                              code: ModelicaErrorCode.FUNCTION_ARG_TYPE_MISMATCH.code,
                              message: `Subscript '${subText}' has type Integer, expected type ${enumTypeStr}.`,
                              range: diagRange,
                            });
                            return -1;
                          }
                        }
                      }
                    }
                  }
                  if (subType === VarType.Real && !isLoopVar) {
                    isRealSub = true;
                  }
                  let numVal: number | null = null;
                  let enumLiteralText: string | null = null;
                  if (dae.getExprKind(subId) === ExprKind.EnumLiteral && !isLoopVar) {
                    numVal = dae.getExprData1(subId);
                    enumLiteralText = dae.interner.resolve(dae.getExprLeft(subId));
                  } else if (dae.getExprKind(subId) === ExprKind.IntLiteral && !isRealSub && !isLoopVar) {
                    numVal = dae.getExprData1(subId);
                  } else if (!isRealSub && !isLoopVar) {
                    const ev = evalDaeExpr(subId, dae);
                    if (typeof ev === "number" && Number.isInteger(ev)) {
                      numVal = ev;
                    }
                  }
                  if (numVal !== null) {
                    lastPart.subscripts.push({
                      node: sub,
                      text: subText,
                      isSlice: false,
                      values: [numVal],
                      scalarText: enumLiteralText ?? String(numVal),
                      isRealSub,
                    });
                  } else {
                    const printer = new ArenaDAEPrinter({ write: () => {} }, dae, true);
                    const printed = printer.printExprToString(subId);
                    lastPart.subscripts.push({
                      node: sub,
                      text: subText,
                      isSlice: false,
                      values: [],
                      scalarText: printed,
                      isRealSub,
                    });
                  }
                } else {
                  lastPart.subscripts.push({
                    node: sub,
                    text: subText,
                    isSlice: false,
                    values: [],
                    scalarText: subText,
                    isRealSub,
                  });
                }
              }

              if (isRealSub) {
                const scopeName =
                  (flattener?.currentRootClassId ? db?.symbol(flattener.currentRootClassId)?.name : "") ??
                  flattener?.currentRootClassName ??
                  (dae as any).modelName ??
                  "";
                let stmtNode: any = node;
                let curr = node.parent;
                while (curr) {
                  if (
                    curr.type === "component_clause" ||
                    curr.type === "simple_equation" ||
                    curr.type?.endsWith("_equation")
                  ) {
                    stmtNode = curr;
                    break;
                  }
                  curr = curr.parent;
                }
                const r = {
                  startByte: stmtNode.startIndex ?? stmtNode.startByte,
                  endByte: stmtNode.endIndex ?? stmtNode.endByte,
                  startPosition: stmtNode.startPosition,
                  endPosition: stmtNode.endPosition,
                };
                dae.diagnostics.push({
                  severity: "error",
                  code: ModelicaErrorCode.ARRAY_INDEX_TYPE_MISMATCH.code,
                  message: `Subscript ${subText} of type Real is not a subtype of Integer, Boolean or enumeration.`,
                  range: r,
                });
                dae.diagnostics.push({
                  severity: "error",
                  code: ModelicaErrorCode.VARIABLE_NOT_FOUND.code,
                  message: `Variable ${lastPart.ident}[${subText}] not found in scope ${scopeName}.`,
                  range: r,
                });
                return -1;
              }
            }
          }
        }
      }

      for (let pi = 0; pi < rawParts.length; pi++) {
        const p = rawParts[pi]!;
        if (p.hasSubscripts) {
          const fullIdent = rawParts
            .slice(0, pi + 1)
            .map((x) => x.ident)
            .join(".");
          let expectedDimCount =
            getDaeArrayDimCount(prefix, fullIdent, dae, db) ?? getDaeArrayDimCount(prefix, p.ident, dae, db);

          let isKnownTypeOrClass =
            p.ident === "Boolean" ||
            p.ident === "Real" ||
            p.ident === "Integer" ||
            p.ident === "String" ||
            p.ident === "StateSelect" ||
            p.ident === "AssertionLevel" ||
            p.ident === "ExternalObject" ||
            Boolean(db && db.byName(p.ident).some((s: any) => s.kind === "Class" || s.kind === "Type"));
          if (expectedDimCount === null) {
            if (isKnownTypeOrClass) {
              expectedDimCount = 0;
            } else if (fullIdent === "time" || p.ident === "time") {
              expectedDimCount = 0;
            } else if (flattener?.activeLoopVars?.has(p.ident) || (substitutions && substitutions.has(p.ident))) {
              expectedDimCount = 0;
            } else if (db && fullIdent.includes(".")) {
              const dotIdx = fullIdent.lastIndexOf(".");
              const enumTypeName = fullIdent.slice(0, dotIdx);
              const litName = fullIdent.slice(dotIdx + 1);
              const leafTypeName = enumTypeName.includes(".") ? enumTypeName.split(".").pop()! : enumTypeName;
              const typeTargets = db.byName(leafTypeName);
              for (const candidate of typeTargets) {
                const cstText = (db.cstNode(candidate.id) as any)?.text ?? "";
                const enumMatch = /enumeration\s*\(([^)]+)\)/.exec(cstText);
                const literals: string[] | null = enumMatch
                  ? enumMatch[1].split(",").map((s: string) => s.trim().split(/\s+/)[0])
                  : Array.isArray(candidate.metadata?.literals)
                    ? candidate.metadata.literals
                    : null;
                if (literals && literals.includes(litName)) {
                  expectedDimCount = 0;
                  break;
                }
              }
            }
          }
          if (expectedDimCount !== null && p.subscripts.length < expectedDimCount) {
            for (let d = p.subscripts.length; d < expectedDimCount; d++) {
              const dimSize =
                getDaeDimSize(prefix, fullIdent, d, dae, db) ?? getDaeDimSize(prefix, p.ident, d, dae, db);
              const vals = dimSize > 0 ? Array.from({ length: dimSize }, (_, i) => i + 1) : [];
              p.subscripts.push({
                node: null,
                text: ":",
                isSlice: true,
                values: vals,
              });
            }
          }

          for (let d = 0; d < p.subscripts.length; d++) {
            const s = p.subscripts[d]!;
            const dimSize = getDaeDimSize(prefix, fullIdent, d, dae, db) ?? getDaeDimSize(prefix, p.ident, d, dae, db);
            if (dimSize !== null && dimSize > 0 && s.values.length > 0) {
              for (const v of s.values) {
                if (v < 1 || v > dimSize) {
                  let stmtNode: any = node;
                  let curr = node.parent;
                  let inIfBranch = false;
                  while (curr) {
                    if (curr.type === "if_equation" || curr.type === "if_statement") {
                      inIfBranch = true;
                    }
                    if (
                      curr.type === "connect_equation" ||
                      curr.type === "simple_equation" ||
                      curr.type === "component_clause" ||
                      curr.type === "for_equation" ||
                      curr.type === "for_statement" ||
                      curr.type === "element_modification" ||
                      curr.type === "element_modification_or_replaceable" ||
                      curr.type?.endsWith("_equation")
                    ) {
                      stmtNode = curr;
                      break;
                    }
                    curr = curr.parent;
                  }
                  if (inIfBranch) {
                    continue;
                  }
                  const r = {
                    startByte: stmtNode.startIndex ?? stmtNode.startByte,
                    endByte: stmtNode.endIndex ?? stmtNode.endByte,
                    startPosition: stmtNode.startPosition,
                    endPosition: stmtNode.endPosition,
                  };
                  const subDisplay =
                    s.isSlice && s.values.length > 1
                      ? `{${s.values.join(", ")}}`
                      : (s.scalarText ?? (s.values[0] !== undefined ? String(s.values[0]) : s.text));
                  const subStrs = p.subscripts.map((subItem, sIdx) =>
                    sIdx === d
                      ? subDisplay
                      : subItem.isSlice && subItem.values.length > 1
                        ? `{${subItem.values.join(", ")}}`
                        : (subItem.scalarText ??
                          (subItem.values[0] !== undefined ? String(subItem.values[0]) : subItem.text)),
                  );
                  const refStr = rawParts
                    .map((x, idx) =>
                      idx === pi
                        ? `${x.ident}[${subStrs.join(",")}]`
                        : x.hasSubscripts
                          ? `${x.ident}[${x.subscripts.map((subItem) => (subItem.isSlice && subItem.values.length > 1 ? `{${subItem.values.join(", ")}}` : (subItem.scalarText ?? (subItem.values[0] !== undefined ? String(subItem.values[0]) : subItem.text)))).join(",")}]`
                          : x.ident,
                    )
                    .join(".");
                  const isConnect = stmtNode.type === "connect_equation";
                  const targetRefStr = isConnect ? refStr : rawParts[pi].ident;
                  dae.diagnostics.push({
                    severity: "error",
                    code: ModelicaErrorCode.ARRAY_INDEX_OUT_OF_BOUNDS.code,
                    message: `Subscript '${v}' for dimension ${d + 1} (size = ${dimSize}) of ${targetRefStr} is out of bounds.`,
                    range: r,
                  });
                  return -1;
                }
              }
            }
          }

          if (expectedDimCount !== null && p.subscripts.length > expectedDimCount) {
            let stmtNode: any = node;
            let curr = node.parent;
            while (curr) {
              if (
                curr.type === "component_clause" ||
                curr.type === "simple_equation" ||
                curr.type === "for_equation" ||
                curr.type === "for_statement" ||
                curr.type === "element_modification" ||
                curr.type === "element_modification_or_replaceable" ||
                curr.type?.endsWith("_equation")
              ) {
                stmtNode = curr;
                break;
              }
              curr = curr.parent;
            }
            const r = {
              startByte: stmtNode.startIndex ?? stmtNode.startByte,
              endByte: stmtNode.endIndex ?? stmtNode.endByte,
              startPosition: stmtNode.startPosition,
              endPosition: stmtNode.endPosition,
            };
            const joinSep = ", ";
            const subStrs = p.subscripts.map(
              (s) => s.scalarText ?? (s.values[0] !== undefined ? String(s.values[0]) : s.text),
            );
            const refStr = rawParts
              .map((x, idx) =>
                idx === pi
                  ? `${x.ident}[${subStrs.join(joinSep)}]`
                  : x.hasSubscripts
                    ? `${x.ident}[${x.subscripts.map((s) => s.scalarText ?? (s.values[0] !== undefined ? String(s.values[0]) : s.text)).join(joinSep)}]`
                    : x.ident,
              )
              .join(".");
            const actualCount =
              pi < rawParts.length - 1 ? rawParts[rawParts.length - 1].subscripts.length : p.subscripts.length;
            dae.diagnostics.push({
              severity: "error",
              code: ModelicaErrorCode.ARRAY_SUBSCRIPT_COUNT_MISMATCH.code,
              message: ModelicaErrorCode.ARRAY_SUBSCRIPT_COUNT_MISMATCH.message(refStr, actualCount, expectedDimCount),
              range: r,
            });
            return -1;
          }
        }
      }

      if (!isAssignmentLhs && rawParts.length > 0 && rawParts[0]!.hasSubscripts) {
        const baseName = resolveScopedName(rawParts[0]!.ident, prefix, dae, (dae as any).innerOuterComponents);
        const baseShape = (dae as any).getNamedArrayShape?.(baseName) ?? (dae as any).namedArrayShapes?.get(baseName);
        if (baseShape && baseShape.length > 0 && baseShape.every((d: number) => d >= 0) && baseShape.includes(0)) {
          const baseId = dae.addArrayCtorExpr([]);
          const subExprs = rawParts[0]!.subscripts.map((s) => {
            if (s.node) {
              const exprNode = s.node.children?.find((k: any) => k.type === "expression") ?? s.node;
              if (exprNode && exprNode.text?.trim() !== ":") {
                const eId = lowerCSTExpression(exprNode, dae, prefix, substitutions, imports, db, flattener);
                if (eId >= 0) return eId;
              }
            }
            return dae.addExpression(ExprKind.Name, dae.interner.intern(s.text));
          });
          return dae.addSubscriptExpr(baseId, subExprs);
        }
      }

      if (
        !isAssignmentLhs &&
        rawParts.length >= 2 &&
        ((dae as any).inAlgorithmSection || dae.classKind === "function")
      ) {
        const slicedRes = tryLowerSlicedCref(rawParts, dae, prefix, db, flattener);
        if (slicedRes) {
          (dae as any).lastLoweredShape = slicedRes.shape;
          return slicedRes.exprId;
        }
      }

      const hasSlice = rawParts.some((p) => p.subscripts.some((s) => s.isSlice));
      if (hasSlice) {
        if (isAssignmentLhs && rawParts.length === 1) {
          const p = rawParts[0]!;
          const baseName = resolveScopedName(p.ident, prefix, dae, (dae as any).innerOuterComponents);
          const baseId = dae.addExpression(ExprKind.Name, dae.interner.intern(baseName));
          const subExprs = p.subscripts.map((s) => {
            if (s.text === ":") {
              return dae.addExpression(ExprKind.Name, dae.interner.intern(":"));
            }
            if (s.isSlice && s.values.length > 0) {
              return dae.addArrayCtorExpr(s.values.map((v) => dae.addIntLiteral(v)));
            }
            if (s.node) {
              const exprNode = s.node.children?.find((k: any) => k.type === "expression") ?? s.node;
              if (exprNode && exprNode.text?.trim() !== ":") {
                const eId = lowerCSTExpression(exprNode, dae, prefix, substitutions, imports, db, flattener);
                if (eId >= 0) return eId;
              }
            }
            return dae.addIntLiteral(s.values[0] ?? 1);
          });
          return dae.addSubscriptExpr(baseId, subExprs);
        }

        const sliceLists: number[][] = [];
        for (const p of rawParts) {
          for (const s of p.subscripts) {
            if (s.isSlice) sliceLists.push(s.values);
          }
        }

        const makeScalarExpr = (chosenSliceIndices: number[]): number => {
          let sIdx = 0;
          const concreteParts: string[] = [];
          for (const p of rawParts) {
            let pIdent = p.ident;
            if (substitutions && substitutions.has(p.ident)) {
              const s = substitutions.get(p.ident);
              if (typeof s === "string") pIdent = s;
            }
            if (!p.hasSubscripts) {
              concreteParts.push(pIdent);
            } else {
              const subStrs: (string | number)[] = [];
              for (const s of p.subscripts) {
                if (s.isSlice) {
                  subStrs.push(chosenSliceIndices[sIdx++]!);
                } else {
                  subStrs.push(s.scalarText ?? (s.values[0] !== undefined ? s.values[0] : ""));
                }
              }
              concreteParts.push(`${pIdent}[${subStrs.join(",")}]`);
            }
          }
          let concreteName = concreteParts.join(".");
          if (imports && imports.has(rawParts[0]!.ident)) {
            concreteName = [imports.get(rawParts[0]!.ident)!, ...concreteParts.slice(1)].join(".");
          }
          const candidate = resolveScopedName(concreteName, prefix, dae, (dae as any).innerOuterComponents);
          let vIdx = dae.getVarIdxByName(candidate);
          if (vIdx < 0 && rawParts.length === 1 && rawParts[0]!.subscripts.length === 1) {
            const pIdent = rawParts[0]!.ident;
            const fullTarget = prefix ? `${prefix}.${pIdent}[` : `${pIdent}[`;
            const matchingVars: string[] = [];
            for (let i = 0; i < dae.varCount; i++) {
              if (!dae.isVarRemoved(i)) {
                const vn = dae.getVarName(i);
                if (vn.startsWith(fullTarget) && vn.endsWith("]")) {
                  matchingVars.push(vn);
                }
              }
            }
            const chosen = chosenSliceIndices[0]!;
            if (matchingVars.length > 0 && chosen >= 1 && chosen <= matchingVars.length) {
              return dae.addExpression(ExprKind.Name, dae.interner.intern(matchingVars[chosen - 1]!));
            }
          }
          if (vIdx >= 0 && dae.getVarVariability(vIdx) === Variability.Constant) {
            const exprId = dae.getVarExpression(vIdx);
            if (exprId >= 0) {
              const k = dae.getExprKind(exprId);
              if (k === ExprKind.RealLiteral) return dae.addRealLiteral(dae.getExprRealValue(exprId));
              if (k === ExprKind.IntLiteral) return dae.addIntLiteral(dae.getExprData1(exprId));
              if (k === ExprKind.BoolLiteral) return dae.addBoolLiteral(dae.getExprData1(exprId) !== 0);
            }
          }
          if (vIdx < 0 && db && candidate.includes("[")) {
            let baseName = candidate.slice(0, candidate.indexOf("["));
            if (baseName.startsWith(".")) baseName = baseName.slice(1);
            const subStr = candidate.slice(candidate.indexOf("[") + 1, candidate.indexOf("]"));
            const subIndices = subStr.split(",").map((s) => parseInt(s.trim(), 10));
            const scopeId = flattener?.currentClassId ?? flattener?.currentRootClassId;
            const constRes = lookupDbConstant(baseName, db, scopeId);
            if (constRes && Array.isArray(constRes.value)) {
              let val: any = constRes.value;
              for (const idx of subIndices) {
                if (Array.isArray(val) && idx >= 1 && idx <= val.length) {
                  val = val[idx - 1];
                } else {
                  val = null;
                  break;
                }
              }
              if (typeof val === "number") {
                return constRes.isInteger ? dae.addIntLiteral(val) : dae.addRealLiteral(val);
              }
            }
          }
          if (vIdx < 0) {
            const elemIndices = dae.getArrayElementIndices(candidate);
            if (elemIndices.length > 0) {
              const entries: { idxs: number[]; name: string }[] = [];
              for (const eIdx of elemIndices) {
                const eName = dae.getVarName(eIdx);
                const idxs = matchVarPath(eName, candidate);
                if (idxs && idxs.length > 0) {
                  entries.push({ idxs, name: eName });
                }
              }
              if (entries.length > 0) {
                const subDimCount = entries[0]!.idxs.length;
                const shape: number[] = [];
                for (let d = 0; d < subDimCount; d++) {
                  let maxVal = 0;
                  for (const ent of entries) {
                    if (ent.idxs[d]! > maxVal) maxVal = ent.idxs[d]!;
                  }
                  shape.push(maxVal);
                }
                const buildSubArray = (dim: number, prefixIdxs: number[]): number => {
                  if (dim === shape.length) {
                    const entry = entries.find((e) => e.idxs.every((v, k) => v === prefixIdxs[k]));
                    return dae.addExpression(ExprKind.Name, dae.interner.intern(entry ? entry.name : ""));
                  }
                  const childExprs: number[] = [];
                  for (let i = 1; i <= shape[dim]!; i++) {
                    childExprs.push(buildSubArray(dim + 1, [...prefixIdxs, i]));
                  }
                  return dae.addArrayCtorExpr(childExprs);
                };
                return buildSubArray(0, []);
              }
            }
          }
          return dae.addExpression(ExprKind.Name, dae.interner.intern(candidate));
        };

        const buildSliceArray = (dim: number, currentIndices: number[]): number => {
          if (dim === sliceLists.length) {
            return makeScalarExpr(currentIndices);
          }
          const elems = sliceLists[dim]!.map((idx) => buildSliceArray(dim + 1, [...currentIndices, idx]));
          return dae.addArrayCtorExpr(elems);
        };

        return buildSliceArray(0, []);
      }

      const parts: string[] = [];
      for (const p of rawParts) {
        let pIdent = p.ident;
        if (substitutions && substitutions.has(p.ident)) {
          const s = substitutions.get(p.ident);
          if (typeof s === "string") pIdent = s;
        }
        if (!p.hasSubscripts) {
          parts.push(pIdent);
        } else {
          const subStrs = p.subscripts.map(
            (s) => s.scalarText ?? (s.values[0] !== undefined ? String(s.values[0]) : ""),
          );
          parts.push(`${pIdent}[${subStrs.join(",")}]`);
        }
      }
      if (parts.length > 0) {
        let joined = parts.join(".");
        if (imports && imports.has(parts[0])) {
          joined = [imports.get(parts[0])!, ...parts.slice(1)].join(".");
        }
        let candidate = resolveScopedName(joined, prefix, dae, (dae as any).innerOuterComponents, true);
        let vIdx = -1;
        if (!flattener?.activeLoopVars?.has(joined) && !flattener?.activeLoopVars?.has(parts[0])) {
          vIdx = dae.getVarIdxByName(candidate);
          if (vIdx >= 0) {
            if (dae.getVarVariability(vIdx) === Variability.Constant) {
              const exprId = dae.getVarExpression(vIdx);
              if (exprId >= 0) {
                const k = dae.getExprKind(exprId);
                if (k === ExprKind.RealLiteral) return dae.addRealLiteral(dae.getExprRealValue(exprId));
                if (k === ExprKind.IntLiteral) return dae.addIntLiteral(dae.getExprData1(exprId));
                if (k === ExprKind.BoolLiteral) return dae.addBoolLiteral(dae.getExprData1(exprId) !== 0);
              }
            }
            if (
              !isAssignmentLhs &&
              !noArrayExpand &&
              flattener?.options?.arrayMode !== "preserve" &&
              !candidate.includes("[") &&
              (dae.hasArrayElements(candidate) || (dae.getVarShape(vIdx)?.length ?? 0) > 0) &&
              !(dae.classKind === "function" && flattener?.currentBindingCompName === candidate)
            ) {
              const ctor = expandVarToArrayCtor(candidate, dae);
              if (ctor !== null) return ctor;
            }
            return dae.addExpression(ExprKind.Name, dae.interner.intern(candidate));
          }
        } else {
          return dae.addExpression(ExprKind.Name, dae.interner.intern(candidate));
        }
        if (db) {
          const scopeId = flattener?.currentClassId ?? flattener?.currentRootClassId;
          const constRes = lookupDbConstant(candidate, db, scopeId) ?? lookupDbConstant(joined, db, scopeId);
          if (constRes !== null) {
            if (Array.isArray(constRes.value)) {
              const elemIds = constRes.value.map((v) =>
                constRes.isInteger ? dae.addIntLiteral(v) : dae.addRealLiteral(v),
              );
              return dae.addArrayCtorExpr(elemIds);
            }
            return constRes.isInteger
              ? dae.addIntLiteral(Math.round(constRes.value))
              : dae.addRealLiteral(constRes.value);
          }
        }
        if (vIdx < 0 && parts.length >= 2 && db) {
          const firstPart = imports && imports.has(parts[0]) ? imports.get(parts[0])! : parts[0];
          const pkgOrClass = db.byName(firstPart).find((e) => e.kind === "Class" || e.kind === "Package");
          if (pkgOrClass) {
            const pkgEntry = db.symbol(pkgOrClass.id);
            const hasPkgRestrictionError = dae.diagnostics.some(
              (d) =>
                d.code === 4017 &&
                ((pkgEntry?.startByte != null &&
                  pkgEntry?.endByte != null &&
                  d.range?.startByte != null &&
                  d.range.startByte >= pkgEntry.startByte &&
                  d.range.startByte <= pkgEntry.endByte) ||
                  d.message.includes(`in ${pkgOrClass.name}`)),
            );
            if (hasPkgRestrictionError) {
              const scopeName =
                (flattener?.currentRootClassId ? db.symbol(flattener.currentRootClassId)?.name : "") ?? "";
              const rangeObj =
                node.startIndex != null && node.endIndex != null
                  ? { startByte: node.startIndex, endByte: node.endIndex }
                  : undefined;
              dae.diagnostics.push({
                severity: "error",
                code: ModelicaErrorCode.VARIABLE_NOT_FOUND.code,
                message: `Variable ${joined} not found in scope ${scopeName}.`,
                range: rangeObj,
              });
              return -1;
            }
            let currSym: SymbolEntry | null = pkgOrClass;
            for (let pi = 1; pi < parts.length; pi++) {
              if (!currSym) break;
              let child = db.childrenOf(currSym.id).find((c) => c.name === parts[pi]);
              if (!child) {
                const instComps = db.query<SymbolId[]>("instantiate", currSym.id);
                if (instComps) {
                  for (const cid of instComps) {
                    const cEntry = db.symbol(cid);
                    if (cEntry && cEntry.name === parts[pi]) {
                      child = cEntry;
                      break;
                    }
                  }
                }
              }
              if (child) {
                if (child.kind === "Component") {
                  const variability = db.query<string | null>("variability", child.id);
                  if (variability !== "constant") {
                    const basePkgName = parts.slice(0, pi).join(".");
                    let pkgName = basePkgName;
                    if (flattener?.currentRootClassId) {
                      const rootSym = db.symbol(flattener.currentRootClassId);
                      if (
                        rootSym &&
                        pkgOrClass.parentId != null &&
                        db.symbol(pkgOrClass.parentId)?.kind !== "Package"
                      ) {
                        pkgName = `${rootSym.name}.${basePkgName}`;
                      }
                    }
                    const hasPkgDiag = dae.diagnostics.some(
                      (d) =>
                        (d.code === 4036 || d.code === 4073 || d.message.includes("is not constant")) &&
                        d.message.includes(`in package ${pkgName}`),
                    );
                    if (!hasPkgDiag) {
                      for (let pass = 0; pass < 2; pass++) {
                        dae.diagnostics.push({
                          severity: "error",
                          code: ModelicaErrorCode.PACKAGE_VARIABLE_NOT_CONSTANT.code,
                          message: `Variable ${parts.slice(0, pi + 1).join(".")} in package ${pkgName} is not constant.`,
                        });
                        for (let rem = pi + 1; rem < parts.length; rem++) {
                          dae.diagnostics.push({
                            severity: "error",
                            code: ModelicaErrorCode.PACKAGE_VARIABLE_NOT_CONSTANT.code,
                            message: `Variable ${parts.slice(0, rem + 1).join(".")} in package ${pkgName} is not constant.`,
                          });
                        }
                      }
                    }
                    const scopeName =
                      (flattener?.currentRootClassId ? db.symbol(flattener.currentRootClassId)?.name : "") ?? "";
                    const rangeObj =
                      node.startIndex != null && node.endIndex != null
                        ? { startByte: node.startIndex, endByte: node.endIndex }
                        : undefined;
                    dae.diagnostics.push({
                      severity: "error",
                      code: ModelicaErrorCode.VARIABLE_NOT_FOUND.code,
                      message: `Variable ${joined} not found in scope ${scopeName}.`,
                      range: rangeObj,
                    });
                    return -1;
                  }
                  if (pi === parts.length - 1) {
                    const typeSpec = db.query<string | null>("typeSpecifier", child.id);
                    if (typeSpec) {
                      const recSym = db
                        .byName(typeSpec)
                        .find(
                          (e) =>
                            e.kind === "Class" && (flattener?.isRecordSym?.(e) || flattener?.isOperatorRecordSym?.(e)),
                        );
                      if (recSym) {
                        const compInst = db.query<ComponentInstanceData>("componentInstance", child.id);
                        const bExpr = compInst?.modification?.bindingExpression;
                        let bText = bExpr?.text?.trim();
                        if (!bText) {
                          const childCst = db.cstNode(child.id) as any;
                          const eqM = (childCst?.text ?? "").match(/=\s*([^\n;]+)/);
                          if (eqM) bText = eqM[1].trim();
                        }
                        if (bText && bText.startsWith(recSym.name) && bText.includes("(") && bText.endsWith(")")) {
                          const inside = bText.slice(bText.indexOf("(") + 1, -1).trim();
                          const rawArgs = inside.length > 0 ? inside.split(",").map((s) => s.trim()) : [];
                          const callArgs: number[] = [];
                          for (const a of rawArgs) {
                            const num = Number(a);
                            if (!isNaN(num)) {
                              callArgs.push(dae.addRealLiteral(num));
                            } else if (a === "true" || a === "false") {
                              callArgs.push(dae.addBoolLiteral(a === "true"));
                            }
                          }
                          return dae.addCallExpr(recSym.name, callArgs);
                        }
                      }
                    }
                    const childCst = db.cstNode(child.id) as any;
                    const findBindingExpr = (n: any): any => {
                      if (!n) return null;
                      if (n.type === "expression") return n;
                      for (const c of n.children || []) {
                        const res = findBindingExpr(c);
                        if (res) return res;
                      }
                      return null;
                    };
                    const pkgMod = db.query<any>("effectiveModification", pkgOrClass.id);
                    const modArg = pkgMod?.args?.find((a: any) => a.name === child.name);
                    const exprNode =
                      (modArg?.value ? (findBindingExpr(modArg.value) ?? modArg.value) : null) ??
                      findBindingExpr(childCst);
                    if (exprNode && flattener) {
                      const prevClassId = flattener.currentClassId;
                      flattener.currentClassId =
                        modArg?.evaluationScopeId ?? child.parentId ?? flattener.currentClassId;
                      const lowered = flattener.lowerExpr(exprNode, dae, prefix, substitutions);
                      flattener.currentClassId = prevClassId;
                      if (lowered >= 0) return lowered;
                    }
                  }
                }
                currSym = child;
              } else {
                break;
              }
            }
          }
        }
        rawName = candidate;
      }
    }

    if (imports && rawName.includes(".")) {
      const p = rawName.split(".");
      if (imports.has(p[0])) {
        const mapped = [imports.get(p[0])!, ...p.slice(1)].join(".");
        if (db) {
          const scopeId = flattener?.currentClassId ?? flattener?.currentRootClassId;
          const constRes = lookupDbConstant(mapped, db, scopeId);
          if (constRes !== null) {
            if (Array.isArray(constRes.value)) {
              const elemIds = constRes.value.map((v) =>
                constRes.isInteger ? dae.addIntLiteral(v) : dae.addRealLiteral(v),
              );
              return dae.addArrayCtorExpr(elemIds);
            }
            return constRes.isInteger
              ? dae.addIntLiteral(Math.round(constRes.value))
              : dae.addRealLiteral(constRes.value);
          }
        }
        rawName = mapped;
      }
    } else if (db && rawName.includes(".")) {
      const scopeId = flattener?.currentClassId ?? flattener?.currentRootClassId;
      const constRes = lookupDbConstant(rawName, db, scopeId);
      if (constRes !== null) {
        if (Array.isArray(constRes.value)) {
          const elemIds = constRes.value.map((v) =>
            constRes.isInteger ? dae.addIntLiteral(v) : dae.addRealLiteral(v),
          );
          return dae.addArrayCtorExpr(elemIds);
        }
        return constRes.isInteger ? dae.addIntLiteral(Math.round(constRes.value)) : dae.addRealLiteral(constRes.value);
      }
    }

    if (db && rawName.includes(".")) {
      const dotIdx = rawName.lastIndexOf(".");
      const enumTypeName = rawName.slice(0, dotIdx);
      const litName = rawName.slice(dotIdx + 1);
      const leafTypeName = enumTypeName.includes(".") ? enumTypeName.split(".").pop()! : enumTypeName;
      const typeTargets = db.byName(leafTypeName);
      for (const candidate of typeTargets) {
        const cstText = (db.cstNode(candidate.id) as any)?.text ?? "";
        const enumMatch = /enumeration\s*\(([^)]+)\)/.exec(cstText);
        const literals: string[] | null = enumMatch
          ? enumMatch[1].split(",").map((s) => s.trim().split(/\s+/)[0])
          : Array.isArray(candidate.metadata?.literals)
            ? candidate.metadata.literals
            : null;
        if (literals) {
          const idx = literals.indexOf(litName);
          if (idx >= 0) {
            const pathParts: string[] = [candidate.name, litName];
            let curr: SymbolEntry | null | undefined = candidate.parentId ? db.symbol(candidate.parentId) : null;
            while (curr && curr.parentId !== null && curr.parentId !== 0) {
              pathParts.unshift(curr.name);
              curr = db.symbol(curr.parentId);
            }
            if (curr && curr.name) pathParts.unshift(curr.name);
            const enumPath = pathParts.join(".");
            return dae.addEnumLiteral(idx + 1, enumPath);
          }
        }
      }
    }

    const state = getFlatteningState(dae, flattener);
    rawName = resolveScopedName(rawName, prefix, dae, state.innerOuterComponents);

    // Check if rawName is an array variable like e, which has elements e[1] .. e[N] or multi-dim e[1,1] ..
    // Only expand if rawName is NOT already subscripted (does not contain '['), noArrayExpand is false, and not assignment LHS
    if (
      !isAssignmentLhs &&
      !noArrayExpand &&
      !rawName.includes("[") &&
      (dae.hasArrayElements(rawName) ||
        (dae.getVarIdxByName(rawName) >= 0 && (dae.getVarShape(dae.getVarIdxByName(rawName))?.length ?? 0) > 0)) &&
      !(dae.classKind === "function" && flattener?.currentBindingCompName === rawName)
    ) {
      const ctor = expandVarToArrayCtor(rawName, dae);
      if (ctor !== null) return ctor;
    }

    const outerErr = state.outerNonConstantAccess?.find(
      (e: any) =>
        e.compName === prefix &&
        (e.varName === rawName || `${prefix}.${e.varName}` === rawName || e.target === rawName),
    );
    if (outerErr) {
      let clauseNode: any = node;
      while (clauseNode && clauseNode.type !== "component_clause") {
        clauseNode = clauseNode.parent;
      }
      const rangeObj = clauseNode
        ? {
            startByte: clauseNode.startIndex ?? clauseNode.startByte,
            endByte: clauseNode.endIndex ?? clauseNode.endByte,
            startPosition: clauseNode.startPosition,
            endPosition: clauseNode.endPosition,
          }
        : node.startIndex != null && node.endIndex != null
          ? {
              startByte: node.startIndex,
              endByte: node.endIndex,
              startPosition: node.startPosition,
              endPosition: node.endPosition,
            }
          : undefined;

      let clsNode: any = clauseNode;
      while (clsNode && clsNode.type !== "class_definition") {
        clsNode = clsNode.parent;
      }

      const getQualifiedClassName = (cNode: any): string => {
        if (!cNode) return "";
        const names: string[] = [];
        let curr = cNode;
        while (curr) {
          if (curr.type === "class_definition") {
            let idName = "";
            for (const ch of curr.children || []) {
              if (ch.type === "class_specifier" || ch.type === "long_class_specifier") {
                const id = ch.children?.find((c: any) => c.type === "identifier");
                if (id) {
                  idName = id.text?.trim();
                  break;
                }
              }
            }
            if (!idName) {
              const id = curr.children?.find((c: any) => c.type === "identifier");
              if (id) idName = id.text?.trim();
            }
            if (idName) names.unshift(idName);
          }
          curr = curr.parent;
        }
        return names.join(".");
      };

      const currClassSym = flattener?.currentClassId && db ? db.symbol(flattener.currentClassId) : null;
      const rootClassSym = flattener?.currentRootClassId && db ? db.symbol(flattener.currentRootClassId) : null;
      const rootClassName = rootClassSym?.name ?? "";
      const scopeName =
        currClassSym && db ? getSymbolQualifiedName(db, currClassSym.id) : getQualifiedClassName(clsNode) || "A";

      const isOldFrontend = Boolean(dae.extensionMetadata?.isOldFrontend);
      if (!isOldFrontend) {
        const targetSym = db?.byName(outerErr.varName).find((s: any) => s.kind === "Component");
        const notifRange = targetSym ? getElementDiagRange(db.cstNode(targetSym.id)) : undefined;
        if (notifRange) {
          dae.diagnostics.push({
            severity: "notification" as any,
            code: ModelicaErrorCode.NOTIFICATION_FROM_HERE.code,
            message: "From here:",
            range: notifRange,
          });
        }
        dae.diagnostics.push({
          severity: "error",
          code: ModelicaErrorCode.PACKAGE_VARIABLE_NOT_CONSTANT.code,
          message: `Component '${outerErr.varName}' was found in an enclosing scope but is not a constant.`,
          range: getElementDiagRange(clauseNode ?? node),
        });
        return -1;
      }

      if (currClassSym && currClassSym.parentId != null) {
        const compRange = state.currentCompClauseRange;
        dae.diagnostics.push({
          severity: "error",
          code: ModelicaErrorCode.PACKAGE_VARIABLE_NOT_CONSTANT.code,
          message: `Variable ${outerErr.compName}: Variable ${outerErr.varName} in package ${rootClassName} is not constant.`,
          range: compRange,
        });
      }

      dae.diagnostics.push({
        severity: "error",
        code: ModelicaErrorCode.VARIABLE_NOT_FOUND.code,
        message: `Variable ${outerErr.varName} not found in scope ${scopeName}.`,
        range: rangeObj,
      });
      return -1;
    }
    return dae.addExpression(ExprKind.Name, dae.interner.intern(rawName));
  }

  // Fallback: treat raw text as Name
  let fallback = node.text ? node.text.trim() : "";
  if (substitutions && substitutions.has(fallback)) {
    const sVal = substitutions.get(fallback)!;
    if (typeof sVal === "number") return dae.addIntLiteral(sVal);
    if (sVal === "true" || sVal === "false") return dae.addExpression(ExprKind.BoolLiteral, sVal === "true" ? 1 : 0);
    return dae.addExpression(ExprKind.Name, dae.interner.intern(sVal));
  }
  if (flattener?.activeLoopVars?.has(fallback)) {
    return dae.addExpression(ExprKind.Name, dae.interner.intern(fallback));
  }
  if (fallback.startsWith('"') && fallback.endsWith('"')) {
    return dae.addExpression(ExprKind.StringLiteral, dae.interner.intern(fallback.slice(1, -1)));
  }
  fallback = resolveScopedName(fallback, prefix, dae, getFlatteningState(dae, flattener).innerOuterComponents);
  return dae.addExpression(ExprKind.Name, dae.interner.intern(fallback));
}
