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
import { isScopeEncapsulated, resolveQualified } from "../../queries.js";
import { getElementDiagRange } from "../support/range-utils.js";
import {
  getFlatteningState,
  getNamedArrayShape,
  popLoopVar,
  pushLoopVar,
  setExprArrayShape,
} from "../support/state.js";
import type { ComponentInstanceData, LoweringContext } from "../types.js";
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
  getBaseEnumSymbol,
  getCompDeclSubEnumInfo,
  getDaeArrayDimCount,
  getDaeDimSize,
  getEnumLiteralIndex,
  getSymbolEnumLiterals,
  isInsideForIndex,
  isIntegerTypeSpec,
  lookupDbConstant,
  resolveEnumType,
  resolveScopedName,
  stripArraySubscripts,
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

/**
 * Lowers a Modelica linear-memory CST expression node directly into a `DAEBuilder` arena expression ID.
 *
 * Implements the arena-native expression lowering pipeline without allocating intermediate AST wrapper
 * objects. Handles literals, symbolic differentiation (`der`), discrete pre-value operators (`pre`),
 * array comprehensions and reductions (`sum`, `product`, `min`, `max`, `array`), built-in mathematical
 * and array constructors (`fill`, `zeros`, `ones`, `identity`, `diagonal`, `linspace`, `transpose`, `cat`),
 * stream and homotopy operators, overloaded operator record dispatch, user-defined function resolution
 * and compile-time evaluation/inlining, binary/unary operators with Real/Integer coercion and broadcasting,
 * and multi-dimensional component reference slicing (`a[1:3, :]`).
 *
 * @param node - The linear-memory CST syntax node to lower.
 * @param dae - The target `DAEBuilder` arena receiving lowered expression nodes.
 * @param ctx - Structured lowering context containing scope prefix, loop substitutions, imports, and database handle.
 * @returns The integer `ExprId` allocated in `dae`, or `-1` if `node` is null/invalid or a semantic error occurred.
 */
export function lowerCSTExpression(node: SyntaxNode | null | undefined, dae: DAEBuilder, ctx: LoweringContext): number;
/**
 * Positional overload for lowering a Modelica CST expression node into a `DAEBuilder` arena expression ID.
 *
 * @param node - The linear-memory CST syntax node to lower.
 * @param dae - The target `DAEBuilder` arena receiving lowered expression nodes.
 * @param prefix - Optional hierarchical component prefix (e.g., `"c1.r2"`) for scoping local variable names.
 * @param substitutions - Optional active loop-iterator or parameter substitution map (`varName -> value | "expr:id"`).
 * @param imports - Optional map of local import aliases to fully qualified package/class names.
 * @param db - Optional Salsa `QueryDB` for resolving types, constants, enumerations, and functions.
 * @param flattener - Optional `ModelicaFlattener` instance providing flattening state and options.
 * @param tupleContext - Whether the expression is evaluated in a multi-output tuple LHS/RHS context.
 * @param noArrayExpand - When true, suppresses automatic scalarization of whole-array variable references into `ArrayCtor`.
 * @param isAssignmentLhs - Whether the expression appears on the left-hand side of an algorithm assignment statement.
 * @returns The integer `ExprId` allocated in `dae`, or `-1` if `node` is null/invalid or a semantic error occurred.
 */
export function lowerCSTExpression(
  node: SyntaxNode | null | undefined,
  dae: DAEBuilder,
  prefix?: string,
  substitutions?: Map<string, number | string>,
  imports?: Map<string, string>,
  db?: QueryDB,
  flattener?: any,
  tupleContext?: boolean,
  noArrayExpand?: boolean,
  isAssignmentLhs?: boolean,
): number;
export function lowerCSTExpression(
  node: SyntaxNode | null | undefined,
  dae: DAEBuilder,
  ctxOrPrefix?: LoweringContext | string,
  posSubstitutions?: Map<string, number | string>,
  posImports?: Map<string, string>,
  posDb?: QueryDB,
  posFlattener?: any,
  posTupleContext?: boolean,
  posNoArrayExpand?: boolean,
  posIsAssignmentLhs?: boolean,
): number {
  if (!node) return -1;
  let prefix = "";
  let substitutions: Map<string, number | string> | undefined;
  let imports: Map<string, string> | undefined;
  let db: QueryDB | undefined;
  let flattener: any;
  let tupleContext: boolean | undefined;
  let noArrayExpand: boolean | undefined;
  let isAssignmentLhs: boolean | undefined;

  if (typeof ctxOrPrefix === "object" && ctxOrPrefix !== null) {
    prefix = ctxOrPrefix.prefix ?? "";
    substitutions = ctxOrPrefix.substitutions;
    imports = ctxOrPrefix.imports;
    db = ctxOrPrefix.db;
    flattener = ctxOrPrefix.flattener;
    tupleContext = ctxOrPrefix.tupleContext;
    noArrayExpand = ctxOrPrefix.noArrayExpand;
    isAssignmentLhs = ctxOrPrefix.isAssignmentLhs;
  } else {
    prefix = typeof ctxOrPrefix === "string" ? ctxOrPrefix : "";
    substitutions = posSubstitutions;
    imports = posImports;
    db = posDb;
    flattener = posFlattener;
    tupleContext = posTupleContext;
    noArrayExpand = posNoArrayExpand;
    isAssignmentLhs = posIsAssignmentLhs;
  }

  const ctx: LoweringContext = {
    prefix,
    substitutions,
    imports,
    db,
    flattener,
    tupleContext,
    noArrayExpand,
    isAssignmentLhs,
  };

  const state = getFlatteningState(dae, flattener);
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
    return lowerCSTExpression(node.child(0), dae, ctx);
  }

  // Parenthesized expression: "(" expr ")"
  if (node.childCount === 3 && Cst.kind(node.child(0)) === "(" && Cst.kind(node.child(2)) === ")") {
    return lowerCSTExpression(node.child(1), dae, ctx);
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
    const argId = lowerCSTExpression(argNode, dae, prefix, substitutions, imports, db, flattener);
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
              !flattener?.isOldFrontend &&
              !dae.extensionMetadata?.["isOldFrontend"] &&
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
                let isAssignedInWhen = false;
                let root: any = node;
                while (root && root.parent) {
                  root = root.parent;
                }
                if (root) {
                  const leafName = vName.includes(".") ? vName.split(".").pop()! : vName;
                  const re = new RegExp(`\\b${leafName}\\b`);
                  const reinitRe = new RegExp(`\\breinit\\s*\\(\\s*${leafName}\\b`);
                  const stack = [root];
                  while (stack.length > 0) {
                    const n = stack.pop();
                    if (!n) continue;
                    if (n.type === "when_statement" || n.type === "when_equation") {
                      const text = n.text ?? "";
                      if (re.test(text)) {
                        if (reinitRe.test(text)) {
                          isAssignedInWhen = true;
                          break;
                        }
                        const innerStack = [...(n.children || [])];
                        while (innerStack.length > 0) {
                          const inNode = innerStack.pop();
                          if (!inNode) continue;
                          if (
                            inNode.type === "assignment_statement" ||
                            inNode.type === "statement" ||
                            inNode.type === "statement_or_procedure" ||
                            inNode.type === "simple_equation" ||
                            inNode.type === "some_equation"
                          ) {
                            const inText = inNode.text ?? "";
                            const assignIdx = inText.indexOf(":=");
                            const eqMatch = assignIdx < 0 ? inText.match(/(?<!:|=|<|>|!)=(?!=)/) : null;
                            const opIdx = assignIdx >= 0 ? assignIdx : (eqMatch?.index ?? -1);
                            if (opIdx >= 0) {
                              const lhs = inText.slice(0, opIdx);
                              if (re.test(lhs)) {
                                isAssignedInWhen = true;
                                break;
                              }
                            }
                          }
                          for (const c of inNode.children || []) {
                            innerStack.push(c);
                          }
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

  // ============================================================================
  // Function Calls, Reductions, and Comprehensions
  // Handles:
  //   1. Reduction comprehensions: sum/product/min/max/array(expr for i in range, ...)
  //      with static Cartesian product unrolling or symbolic ComprehensionExpr fallback.
  //   2. Partial function applications (function f(...)) and higher-order type checking.
  //   3. Built-in mathematical, array, stream, clock, and homotopy operators.
  //   4. User-defined function resolution, default argument cycle detection, and inlining.
  // ============================================================================
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
      if (imports.has(parts[0]!)) {
        fnName = [imports.get(parts[0]!)!, ...parts.slice(1)].join(".");
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
      // Comprehension reduction: unroll static iterator ranges over the body expression
      // or emit a symbolic ComprehensionExpr when iterator bounds depend on runtime variables.
      if (
        hasComprehensionFor &&
        (cleanFn === "sum" || cleanFn === "product" || cleanFn === "min" || cleanFn === "max" || cleanFn === "array")
      ) {
        const fChildren = fArgsNode?.children || [];
        const forIdx = fChildren.findIndex((c: any) => c.text === "for" || c.type === "for");
        const bodyNode = forIdx > 0 ? fChildren[forIdx - 1]! : fChildren[0]!;
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
        const iters: { name: string; values: (number | string)[]; sampleValue?: number | string | undefined }[] = [];
        for (const fi of forIndices) {
          const varName = (Cst.ForIndex.variable(fi)?.text?.trim() || fi.child(0)?.text?.trim() || "").trim();
          if (!varName) continue;
          const rangeNode = Cst.ForIndex.range(fi) || fi.children?.find?.((k: any) => k.type === "expression");
          let values: (number | string)[] = [];
          let rangeResolved = false;
          let sampleValue: number | string | undefined;
          const isImplicit = !rangeNode;
          if (rangeNode) {
            flattener?.lowerExpr(rangeNode, dae, prefix, substitutions);
            if (dae.diagnostics.some((d: any) => d.severity === "error")) {
              return -1;
            }
            const enumRange = evaluateEnumRange(
              rangeNode,
              substitutions,
              flattener?.currentClassId ?? flattener?.currentRootClassId ?? getFlatteningState(dae).currentClassId,
              db,
              dae,
              prefix,
            );
            if (enumRange !== null) {
              values = enumRange;
              rangeResolved = true;
              if (enumRange.length === 0) {
                const cNodes = flattenColonNodes(rangeNode);
                if (cNodes.length >= 1) {
                  sampleValue = (cNodes[0].text?.trim() ?? "").replace(/^\.+/, "");
                }
              }
            } else {
              const colonNodes = flattenColonNodes(rangeNode);
              if (colonNodes.length >= 2) {
                const c0Text = colonNodes[0].text?.trim() ?? "";
                const c1Text = colonNodes[colonNodes.length - 1].text?.trim() ?? "";
                if (
                  colonNodes.length === 2 &&
                  (c0Text === "true" || c0Text === "false") &&
                  (c1Text === "true" || c1Text === "false")
                ) {
                  rangeResolved = true;
                  sampleValue = c0Text;
                  const b0 = c0Text === "true" ? 1 : 0;
                  const b1 = c1Text === "true" ? 1 : 0;
                  for (let b = b0; b <= b1; b++) {
                    values.push(b === 1 ? "true" : "false");
                  }
                } else {
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
                    rangeResolved = true;
                    sampleValue = s;
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
                }
              } else {
                const rangeText = rangeNode.text?.trim() ?? "";
                if (rangeText.startsWith("{") && rangeText.endsWith("}")) {
                  const items = getArrayLiteralItems(rangeNode);
                  let allItemsResolved = true;
                  for (const item of items) {
                    const itemText = item.text?.trim() ?? "";
                    if (itemText === "true" || itemText === "false") {
                      values.push(itemText);
                      continue;
                    }
                    const v = evaluateCSTNumber(item, substitutions as any, undefined, db, dae, prefix);
                    if (v !== null) {
                      if (
                        itemText.includes(".") ||
                        itemText.includes("e") ||
                        itemText.includes("E") ||
                        !Number.isInteger(v)
                      ) {
                        values.push(`expr:${dae.addRealLiteral(v)}`);
                      } else {
                        values.push(v);
                      }
                    } else if (
                      (itemText.startsWith('"') && itemText.endsWith('"')) ||
                      (itemText.startsWith("{") && itemText.endsWith("}"))
                    ) {
                      const itemExprId = lowerCSTExpression(item, dae, prefix, substitutions, imports, db, flattener);
                      if (itemExprId >= 0) {
                        values.push(`expr:${itemExprId}`);
                      } else {
                        allItemsResolved = false;
                        break;
                      }
                    } else {
                      allItemsResolved = false;
                      break;
                    }
                  }
                  if (!allItemsResolved) {
                    values = [];
                  } else {
                    rangeResolved = true;
                  }
                }
              }
            }
          }
          if (values.length === 0 && !rangeResolved) {
            values = findArraySubscriptsForIter(bodyNode, varName, dae, db, prefix, isImplicit, fi);
          }
          if (values.length > 0 || rangeResolved) {
            iters.push({ name: varName, values, sampleValue });
          }
        }

        let sampleBodyId = -1;
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
              const sv = it.values.length > 0 ? it.values[0]! : it.sampleValue;
              if (sv !== undefined) testSubs.set(it.name, sv);
            }
          }
          sampleBodyId = lowerCSTExpression(bodyNode, dae, prefix, testSubs, imports, db, flattener);
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
              if ((isString && !dae.extensionMetadata?.["isOldFrontend"]) || isBoolean) {
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
          if (iters.length >= 1 && iters.length === forIndices.length) {
            for (const it of iters) pushLoopVar(flattener, it.name);
            try {
              // Modelica 3.6 §10.4.2: {expr for i1 in r1, i2 in r2} === {{expr for i1 in r1} for i2 in r2}
              const buildComprehensionDim = (dimIdx: number, currentSubs: Map<string, number | string>): number => {
                const iter = iters[dimIdx]!;
                const elemIds: number[] = [];
                for (const val of iter.values) {
                  const nextSubs = new Map(currentSubs);
                  nextSubs.set(iter.name, val);
                  if (dimIdx === 0) {
                    elemIds.push(lowerCSTExpression(bodyNode, dae, prefix, nextSubs, imports, db, flattener));
                  } else {
                    elemIds.push(buildComprehensionDim(dimIdx - 1, nextSubs));
                  }
                }
                return dae.addArrayCtorExpr(elemIds);
              };
              return buildComprehensionDim(iters.length - 1, new Map(substitutions));
            } finally {
              for (const it of iters) popLoopVar(flattener, it.name);
            }
          }
        } else if (cleanFn === "sum" || cleanFn === "product") {
          if (iters.length > 0 && iters.length === forIndices.length) {
            if (iters.some((it) => it.values.length === 0)) {
              const isReal = sampleBodyId >= 0 && isRealExpr(sampleBodyId, dae);
              if (cleanFn === "sum") {
                return isReal ? dae.addRealLiteral(0.0) : dae.addIntLiteral(0);
              }
              return isReal ? dae.addRealLiteral(1.0) : dae.addIntLiteral(1);
            }
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

            if (
              cleanFn === "sum" &&
              terms.length > 0 &&
              terms.every((t) => t >= 0 && dae.getExprKind(t) === ExprKind.StringLiteral)
            ) {
              const strVal = terms.map((t) => dae.interner.resolve(dae.getExprData1(t)) ?? "").join("");
              return dae.addStringLiteral(strVal);
            }

            if (terms.length > 0 && terms.every((t) => t >= 0 && dae.getExprKind(t) === ExprKind.ArrayCtor)) {
              const firstLen = dae.getExprData1(terms[0]!);
              if (firstLen > 0 && terms.every((t) => dae.getExprData1(t) === firstLen)) {
                const reducedElemIds: number[] = [];
                let allElemsConst = true;
                for (let elemIdx = 0; elemIdx < firstLen; elemIdx++) {
                  const elemTerms: number[] = [];
                  const elemVals: number[] = [];
                  for (const t of terms) {
                    const elId = elemIdx === 0 ? dae.getExprLeft(t) : dae.getExprLeft(t + elemIdx);
                    elemTerms.push(elId);
                    const ev = evalDaeExpr(elId, dae);
                    if (typeof ev === "number") {
                      elemVals.push(ev);
                    } else {
                      allElemsConst = false;
                      break;
                    }
                  }
                  if (!allElemsConst) break;
                  const resVal =
                    cleanFn === "sum" ? elemVals.reduce((a, b) => a + b, 0) : elemVals.reduce((a, b) => a * b, 1);
                  const isAllInt =
                    elemVals.every((v) => Number.isInteger(v)) && elemTerms.every((et) => !isRealExpr(et, dae));
                  reducedElemIds.push(isAllInt ? dae.addIntLiteral(Math.round(resVal)) : dae.addRealLiteral(resVal));
                }
                if (allElemsConst && reducedElemIds.length === firstLen) {
                  return dae.addArrayCtorExpr(reducedElemIds);
                }
              }
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
          if (iters.length > 0 && iters.length === forIndices.length) {
            if (iters.some((it) => it.values.length === 0)) {
              const bKind = sampleBodyId >= 0 ? dae.getExprKind(sampleBodyId) : -1;
              if (bKind === ExprKind.BoolLiteral || inferArenaExprVarType(dae, sampleBodyId) === VarType.Boolean) {
                return dae.addBoolLiteral(cleanFn === "min");
              }
              if (bKind === ExprKind.EnumLiteral) {
                const enumPath = dae.interner.resolve(dae.getExprLeft(sampleBodyId)) ?? "";
                const lastDot = enumPath.lastIndexOf(".");
                if (lastDot > 0) {
                  const pfx = enumPath.slice(0, lastDot);
                  const scopeId =
                    flattener?.currentClassId ??
                    flattener?.currentRootClassId ??
                    getFlatteningState(dae).currentClassId;
                  const enumInfo = resolveEnumType(pfx, scopeId, db);
                  if (enumInfo && enumInfo.literals.length > 0) {
                    const idx = cleanFn === "min" ? enumInfo.literals.length - 1 : 0;
                    let qual = enumInfo.qual;
                    const rootName =
                      (flattener?.currentRootClassId && db ? db.symbol(flattener.currentRootClassId)?.name : "") ||
                      (dae as any).className;
                    if (!dae.extensionMetadata?.["isOldFrontend"] && rootName && qual.startsWith(`${rootName}.`)) {
                      qual = qual.slice(rootName.length + 1);
                    }
                    return dae.addEnumLiteral(idx + 1, `${qual}.${enumInfo.literals[idx]}`);
                  }
                }
              }
              if (sampleBodyId >= 0 && isRealExpr(sampleBodyId, dae)) {
                return dae.addRealLiteral(cleanFn === "min" ? 8.777798510069901e304 : -8.777798510069901e304);
              }
              return dae.addExpression(
                ExprKind.Name,
                dae.interner.intern(cleanFn === "min" ? "4611686018427387903" : "-4611686018427387903"),
              );
            }

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

            if (terms.length > 0 && terms.every((t) => t >= 0 && dae.getExprKind(t) === ExprKind.EnumLiteral)) {
              let bestTerm = terms[0]!;
              let bestOrd = dae.getExprData1(bestTerm);
              for (let i = 1; i < terms.length; i++) {
                const ord = dae.getExprData1(terms[i]!);
                if (cleanFn === "min" ? ord < bestOrd : ord > bestOrd) {
                  bestOrd = ord;
                  bestTerm = terms[i]!;
                }
              }
              return bestTerm;
            }

            const evalVals = terms.map((t) => evalDaeExpr(t, dae));
            if (evalVals.length > 0 && evalVals.every((v) => typeof v === "boolean")) {
              const bools = evalVals as boolean[];
              return dae.addBoolLiteral(cleanFn === "min" ? bools.every(Boolean) : bools.some(Boolean));
            }
            if (evalVals.length > 0 && evalVals.every((v) => typeof v === "number")) {
              const nums = evalVals as number[];
              const resVal = cleanFn === "min" ? Math.min(...nums) : Math.max(...nums);
              const isAllInteger = nums.every((v) => Number.isInteger(v)) && terms.every((t) => !isRealExpr(t, dae));
              return isAllInteger ? dae.addIntLiteral(Math.round(resVal)) : dae.addRealLiteral(resVal);
            }
          }

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
                  : typeof v === "string" && v.startsWith("expr:")
                    ? Number(v.slice(5))
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
          for (const it of iterators) pushLoopVar(flattener, it.name);
          let bodyId: number;
          try {
            bodyId = lowerCSTExpression(bodyNode, dae, prefix, substitutions, imports, db, flattener);
          } finally {
            for (const it of iterators) popLoopVar(flattener, it.name);
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
        const compState = getFlatteningState(dae);
        const realIterVars: string[] = [];
        for (const it of iterators) {
          pushLoopVar(flattener, it.name);
          if (isRealExpr(it.rangeId, dae)) {
            if (!(compState as any).realLoopVars) (compState as any).realLoopVars = new Set<string>();
            (compState as any).realLoopVars.add(it.name);
            realIterVars.push(it.name);
          }
        }
        let bodyId: number;
        try {
          bodyId = lowerCSTExpression(bodyNode, dae, prefix, substitutions, imports, db, flattener);
        } finally {
          for (const it of iterators) popLoopVar(flattener, it.name);
          for (const rv of realIterVars) (compState as any).realLoopVars?.delete(rv);
        }

        if (iterators.length > 1 && (cleanFn === "sum" || cleanFn === "product")) {
          let currBodyId = bodyId;
          for (const it of iterators) {
            currBodyId = dae.addComprehensionExpr(cleanFn, currBodyId, [it]);
          }
          return currBodyId;
        }
        return dae.addComprehensionExpr(cleanFn, bodyId, iterators);
      }

      const noArrayExpandForArgs =
        typeof fnName === "string" &&
        (fnName.startsWith("Connections.") ||
          fnName === "equalityConstraint" ||
          fnName.endsWith(".equalityConstraint"));
      const lowerPartialFuncNode = (pfNode: any): number => {
        const typeSpecNode = pfNode.children?.find((c: any) => c.type === "type_specifier") ?? pfNode.child(1);
        const passedFnName = typeSpecNode?.text?.trim() ?? "";
        const callingScope = flattener?.currentClassId ?? flattener?.currentRootClassId;
        const argFnSym =
          db && passedFnName
            ? callingScope
              ? (db.query<any>("resolveName", callingScope)?.(passedFnName) ??
                db
                  .byName(passedFnName.split(".").pop()!)
                  .find((e: any) => (e.kind === "Class" || e.kind === "Function") && flattener?.isFunctionSym?.(e)))
              : db
                  .byName(passedFnName.split(".").pop()!)
                  .find((e: any) => (e.kind === "Class" || e.kind === "Function") && flattener?.isFunctionSym?.(e))
            : null;
        const qualFnName = argFnSym && db ? getSymbolQualifiedName(db, argFnSym.id) : passedFnName;
        if (argFnSym && flattener?.flattenFunction && !dae.getFunction(qualFnName)) {
          const fnDae = flattener.flattenFunction(argFnSym.id, qualFnName, undefined, dae);
          if (fnDae) (fnDae as any).wasCalled = true;
        } else if (dae.getFunction(qualFnName)) {
          (dae.getFunction(qualFnName) as any).wasCalled = true;
        }
        const boundArgIds: number[] = [];
        const walkNamed = (cn: any) => {
          if (!cn) return;
          if (cn.type === "named_argument") {
            let valChild = cn.child(2) ?? cn.child(1);
            if (valChild && valChild.type === "function_argument" && valChild.childCount === 1) {
              valChild = valChild.child(0);
            }
            if (valChild) {
              const bId = lowerCSTExpression(
                valChild,
                dae,
                prefix,
                substitutions,
                imports,
                db,
                flattener,
                false,
                noArrayExpandForArgs,
              );
              if (bId >= 0) boundArgIds.push(bId);
            }
            return;
          }
          for (let k = 0; k < (cn.childCount ?? 0); k++) {
            walkNamed(cn.child(k));
          }
        };
        walkNamed(pfNode);
        return dae.addPartialFuncExpr(qualFnName, boundArgIds);
      };
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
            if (exprChild.type === "function_partial_application") {
              exprId = lowerPartialFuncNode(exprChild);
            } else {
              exprId = lowerCSTExpression(
                exprChild,
                dae,
                prefix,
                substitutions,
                imports,
                db,
                flattener,
                false,
                noArrayExpandForArgs,
              );
            }
            namedArgs.set(propName, exprId);
            argNodes.push(exprChild);
            return;
          }
        }
        if (n.type === "function_partial_application") {
          argNodes.push(n);
          argExprIds.push(lowerPartialFuncNode(n));
          return;
        }
        if (n.type === "function_argument") {
          const firstChild = n.child(0);
          if (firstChild && firstChild.type === "function_partial_application") {
            argNodes.push(firstChild);
            argExprIds.push(lowerPartialFuncNode(firstChild));
            return;
          }
        }
        if (n.type === "expression") {
          argNodes.push(n);
          argExprIds.push(
            lowerCSTExpression(n, dae, prefix, substitutions, imports, db, flattener, false, noArrayExpandForArgs),
          );
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
      const a0 = argExprIds[0]!;
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

    if (db && (cleanFnName.endsWith(".constructor") || cleanFnName.endsWith(".destructor"))) {
      const parts = cleanFnName.split(".");
      parts.pop(); // remove constructor / destructor
      const parentName = parts.join(".");
      const parentSym = flattener?.currentClassId
        ? (db.query<any>("resolveName", flattener.currentClassId)?.(parentName) ??
          db.byName(parts[parts.length - 1]!).find((e: any) => e.kind === "Class"))
        : db.byName(parts[parts.length - 1]!).find((e: any) => e.kind === "Class");
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
      const fnEncScope = (flattener as any)?.currentFunctionEnclosingScope as SymbolId | null;
      if (fnEncScope && !cleanFnName.includes(".")) {
        const encScopeFn = db.query<(n: string) => SymbolEntry | null>("resolveName", fnEncScope)?.(cleanFnName);
        if (
          encScopeFn &&
          (encScopeFn.kind === "Class" || encScopeFn.kind === "Function") &&
          flattener.isFunctionSym?.(encScopeFn)
        ) {
          calledFnSym = encScopeFn;
        }
      }
      if (!calledFnSym && flattener.currentClassId) {
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
        const fnBase = parts[parts.length - 1]!;
        const candidates = db.byName(fnBase).filter((e: any) => {
          if (e.kind !== "Class" && e.kind !== "Function") return false;
          if (!flattener.isFunctionSym?.(e)) return false;
          if (parts.length > 1) {
            const qual = getSymbolQualifiedName(db, e.id);
            return qual === cleanFnName || qual.endsWith("." + cleanFnName);
          }
          return parts.length === 1;
        });
        if (candidates.length > 0) {
          if (parts.length === 1) {
            calledFnSym =
              candidates.find((e: any) => getSymbolQualifiedName(db, e.id) === `Modelica.Math.${fnBase}`) ??
              candidates.find((e: any) => !getSymbolQualifiedName(db, e.id).includes("ComplexMath")) ??
              (SCALAR_VECTORIZABLE_FUNCTIONS.has(fnBase) ? null : candidates[0]);
          } else {
            calledFnSym = candidates[0];
          }
        }
      }
      const isOuterFn = isOuterFunctionSymbol(db, calledFnSym);
      const hasInnerMatch = isOuterFn && hasMatchingInnerFunction(db, flattener, calledFnSym?.name ?? cleanFnName);
      if (calledFnSym) {
        const currentParentMods = flattener?.currentParentMods;
        const redeclArg = currentParentMods?.args?.findLast
          ? currentParentMods.args.findLast(
              (a: any) =>
                !a.isBreak &&
                (a.name === cleanFnName || a.name === cleanFnName.split(".").pop()) &&
                (a.isRedeclaration || a.redeclaredTypeSpecifier),
            )
          : currentParentMods?.args?.find(
              (a: any) =>
                !a.isBreak &&
                (a.name === cleanFnName || a.name === cleanFnName.split(".").pop()) &&
                (a.isRedeclaration || a.redeclaredTypeSpecifier),
            );
        if (redeclArg?.redeclaredTypeSpecifier) {
          const ownerScopeId = redeclArg.ownerClassId ?? currentParentMods?.ownerClassId ?? flattener?.currentClassId;
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
            calledFnSym = redeclTarget;
          }
        } else if (cleanFnName.includes(".")) {
          const pkgPrefix = cleanFnName.split(".")[0]!;
          const fnRest = cleanFnName.split(".").slice(1).join(".");
          const pkgRedecl = currentParentMods?.args?.findLast
            ? currentParentMods.args.findLast(
                (a: any) =>
                  !a.isBreak &&
                  a.name === pkgPrefix &&
                  (a.isRedeclaration || a.redeclaredTypeSpecifier) &&
                  a.redeclaredTypeSpecifier,
              )
            : currentParentMods?.args?.find(
                (a: any) =>
                  !a.isBreak &&
                  a.name === pkgPrefix &&
                  (a.isRedeclaration || a.redeclaredTypeSpecifier) &&
                  a.redeclaredTypeSpecifier,
              );
          if (pkgRedecl?.redeclaredTypeSpecifier) {
            const evalScopeId =
              pkgRedecl.evaluationScopeId ??
              pkgRedecl.ownerClassId ??
              currentParentMods?.ownerClassId ??
              flattener?.currentClassId ??
              flattener?.currentRootClassId;
            const pkgSpec = String(pkgRedecl.redeclaredTypeSpecifier).replace(/^\.+/, "");
            const pkgTarget =
              (evalScopeId
                ? db.query<(n: string) => SymbolEntry | null>("resolveName", evalScopeId)?.(pkgSpec)
                : null) ??
              (flattener?.currentRootClassId
                ? db.query<(n: string) => SymbolEntry | null>("resolveName", flattener.currentRootClassId)?.(pkgSpec)
                : null) ??
              db.byName(pkgSpec.split(".").pop()!).find((e: any) => e.kind === "Class" || e.kind === "Package");
            if (pkgTarget) {
              const fnInPkg = db.query<(n: string) => SymbolEntry | null>("resolveName", pkgTarget.id)?.(fnRest);
              if (fnInPkg) {
                calledFnSym = fnInPkg;
              }
            }
          }
        }
      }
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
        if (flattener.invalidInterfaceFunctionIds?.has(calledFnSym.id)) {
          const isOldFrontend = Boolean(dae.extensionMetadata?.["isOldFrontend"] || flattener?.options?.isOldFrontend);
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
              const boundParamNames = new Set<string>();
              if (argNode?.type === "function_partial_application") {
                const typeSpecNode =
                  argNode.children?.find((c: any) => c.type === "type_specifier") ?? argNode.child(1);
                passedFnName = typeSpecNode?.text?.trim() ?? "";
                const collectBoundNames = (cn: any) => {
                  if (!cn) return;
                  if (cn.type === "named_argument") {
                    const bName = cn.child(0)?.text?.trim();
                    if (bName) boundParamNames.add(bName);
                    return;
                  }
                  for (let k = 0; k < (cn.childCount ?? 0); k++) collectBoundNames(cn.child(k));
                };
                collectBoundNames(argNode);
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
                const getFnSig = (sym: any, excludeNames?: Set<string>) => {
                  const instIds = db.query<SymbolId[]>("instantiate", sym.id);
                  const chs =
                    instIds && instIds.length > 0
                      ? instIds.map((id) => db.symbol(id)).filter((s): s is SymbolEntry => Boolean(s))
                      : db.childrenOf(sym.id) || [];
                  const inParams: {
                    name: string;
                    type: string;
                    hasDefault: boolean;
                    defaultVal?: string | undefined;
                  }[] = [];
                  const outParams: { name: string; type: string }[] = [];
                  for (const ch of chs) {
                    if (ch.kind === "Component") {
                      if (excludeNames?.has(ch.name)) continue;
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
                const actualSig = getFnSig(argFnSym, boundParamNames);

                let isCompatible = true;
                if (actualSig.inParams.filter((p) => !p.hasDefault).length > expectedSig.inParams.length) {
                  isCompatible = false;
                } else {
                  for (let j = 0; j < expectedSig.inParams.length; j++) {
                    if (j >= actualSig.inParams.length) {
                      isCompatible = false;
                      break;
                    }
                    if (expectedSig.inParams[j]!.type !== actualSig.inParams[j]!.type) {
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
                    dae.extensionMetadata?.["isOldFrontend"] || flattener?.options?.isOldFrontend,
                  );

                  const formatInParam = (
                    p: { name: string; type: string; hasDefault: boolean; defaultVal?: string | undefined },
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
                const shapeExprs = dae.getVarShapeExprs ? dae.getVarShapeExprs(vIdx) : null;
                if (shapeExprs && shapeExprs.length > 0) isArray = true;
              }
              if (!isArray) {
                const dims = getExprDims(aid, dae, db);
                if (dims && dims.length > 0) isArray = true;
              }
              if (!isArray && db) {
                const simpleName = vName.includes(".") ? vName.split(".").pop()! : vName;
                const candidates = db.byName(simpleName);
                for (const cand of candidates) {
                  if (cand.kind === "Component") {
                    const rawDims = db.query<any[] | null>("arrayDimensions", cand.id);
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
        const elemType = varTypeName(vt ?? VarType.Real);
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
        const elemType = varTypeName(vt ?? VarType.Real);
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
      const rec =
        argExprIds.length >= 1 ? resolveOperatorRecord(argExprIds[0]!, argNodes[0], dae, db, flattener) : null;
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
                const meta = sym?.metadata as any;
                if (meta?.typeSpecifier && !["Real", "Integer", "Boolean", "String"].includes(meta.typeSpecifier)) {
                  const typeSym =
                    sym?.parentId !== undefined && sym?.parentId !== null
                      ? (db?.query<(n: string) => SymbolEntry | null>(
                          "resolveSimpleName",
                          sym.parentId,
                        )?.(meta.typeSpecifier) ??
                        db?.query<(n: string) => SymbolEntry | null>(
                          "resolveName",
                          sym.parentId,
                        )?.(meta.typeSpecifier) ??
                        (db ? resolveQualified(db, meta.typeSpecifier) : null) ??
                        db?.byName(meta.typeSpecifier.split(".").pop()!)[0])
                      : ((db ? resolveQualified(db, meta.typeSpecifier) : null) ??
                        db?.byName(meta.typeSpecifier.split(".").pop()!)[0]);
                  const isTypeAliasOrEnum =
                    typeSym &&
                    (typeSym.kind === "type" ||
                      (typeSym.metadata as any)?.restriction === "type" ||
                      (typeSym.metadata as any)?.isEnumeration);
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
            return dae.addBinaryExpr(
              BinOp.Add,
              negLit,
              dae.addCallExpr("delay", [lId, argExprIds[1]!, argExprIds[2]!]),
            );
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
      const isOldFrontend = Boolean(
        dae.extensionMetadata?.["isOldFrontend"] ||
        flattener?.options?.isOldFrontend ||
        (dae.extensionMetadata as any)?.hasOldInstOption,
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
              const typeResolver =
                db.query<any>("resolveName", currScopeId) ?? db.query<any>("resolveSimpleName", currScopeId);
              const simpleTypeName = currentType.includes(".") ? currentType.split(".").pop()! : currentType;
              const resolvedSym = typeResolver?.(currentType);
              const typeClass =
                (resolvedSym && resolvedSym.kind === "Class" ? resolvedSym : null) ??
                db.byName(currentType).find((c: any) => c.kind === "Class") ??
                db.byName(simpleTypeName).find((c: any) => c.kind === "Class");
              if (typeClass) {
                currScopeId = typeClass.id;
                const kind = String(
                  (typeClass.metadata as any)?.classKind ?? (typeClass.metadata as any)?.classPrefixes ?? "",
                )
                  .replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "")
                  .trim();
                if (
                  /\bconnector\b/.test(kind) ||
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
    } else if (fnName === "Clock" && argExprIds.length === 1) {
      if (dae.getExprKind(argExprIds[0]!) === ExprKind.IntLiteral) {
        argExprIds.push(dae.addIntLiteral(1));
      } else if (inferArenaExprVarType(dae, argExprIds[0]!) === VarType.Boolean) {
        argExprIds.push(dae.addRealLiteral(0.0));
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
        const firstDims = getExprDims(argExprIds[0]!, dae, flattener.db);
        for (let i = 1; i < argExprIds.length; i++) {
          const dims = getExprDims(argExprIds[i]!, dae, flattener.db);
          if (firstDims && dims && (firstDims.length !== dims.length || firstDims.some((d, idx) => d !== dims[idx]))) {
            let clauseNode: any = node;
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
            (flattener?.currentRootClassId && db ? db.symbol(flattener.currentRootClassId)?.name : "") ||
            dae.name ||
            "";
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
                    startByte: node.startIndex,
                    endByte: node.endIndex,
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
                const enumInfo = (fState as any).namedArrayEnumInfo?.get(vName);
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
          const graph = dae.extensionMetadata["overconstrainedGraph"];
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

    if (
      (fnName === "Connections.rooted" || fnName === "rooted" || cleanFnName === "rooted") &&
      argExprIds.length === 1
    ) {
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
          const graph = dae.extensionMetadata["overconstrainedGraph"];
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
        let curAnc: any = node;
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
              const curScopeId = (state as any).currentScopeId;
              const dSym =
                (curScopeId !== undefined
                  ? (db.query<(n: string) => SymbolEntry | null>("resolveName", curScopeId)?.(dName) ??
                    db.childrenOf(curScopeId).find((c) => c.name === dName))
                  : null) ?? db.byName(dName)?.find((c) => c.kind === "Component");
              if (dSym && dSym.kind === "Component") {
                const dVar = (dSym.metadata as any)?.variability ?? db.query<string | null>("variability", dSym.id);
                const dFinal = Boolean((dSym.metadata as any)?.isFinal || db.query<boolean>("isFinal", dSym.id));
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
        if (rawArg0 && /^[a-zA-Z_]\w*(?:\.[a-zA-Z_]\w*)*$/.test(rawArg0)) {
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

    // 1. Inlined '0' operator call: Complex.'0'()
    if (fnName.endsWith(".'0'") || fnName.endsWith(".0") || cleanFnName.endsWith(".'0'")) {
      const recName = cleanFnName.split(".")[0]!;
      const recSym = db?.byName(recName).find((e: any) => e.kind === "Class" && flattener?.isOperatorRecordSym?.(e));
      if (recSym && db) {
        const ops = db.query<Map<string, any[]> | null>("operatorFunctions", recSym.id);
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
      const rec = resolveOperatorRecord(argExprIds[0]!, argNodes[0], dae, db, flattener);
      if (rec) {
        const ops = db?.query<Map<string, any[]> | null>("operatorFunctions", rec.symId);
        const strOps = ops?.get("'String'") ?? ops?.get("String");
        if (strOps && strOps.length > 0) {
          const strOverload = strOps[0];
          flattener.usedOperatorFunctions?.set(strOverload.qualifiedName, strOverload.funcSymId);
          return dae.addCallExpr(strOverload.qualifiedName, argExprIds);
        }
      }
      if (argExprIds.length === 1 && dae.getExprKind(argExprIds[0]!) === ExprKind.EnumLiteral) {
        const enumPath = dae.interner.resolve(dae.getExprLeft(argExprIds[0]!));
        const litShort = enumPath.includes(".") ? enumPath.split(".").pop()! : enumPath;
        return dae.addStringLiteral(litShort);
      }
      if (argExprIds.length === 1 && namedArgs.size === 0 && dae.getExprKind(argExprIds[0]!) === ExprKind.IntLiteral) {
        return dae.addStringLiteral(String(dae.getExprData1(argExprIds[0]!)));
      }
      if (argExprIds.length === 1 && isRealExpr(argExprIds[0]!, dae)) {
        if (namedArgs.has("format")) {
          argExprIds.push(namedArgs.get("format")!);
        } else if (
          (dae.extensionMetadata?.["isOldFrontend"] || flattener?.currentRootDae?.extensionMetadata?.isOldFrontend) &&
          namedArgs.has("significantDigits") &&
          !namedArgs.has("minimumLength") &&
          !namedArgs.has("leftJustified")
        ) {
          argExprIds.push(namedArgs.get("significantDigits")!);
        } else {
          argExprIds.push(namedArgs.get("significantDigits") ?? dae.addIntLiteral(6));
          argExprIds.push(namedArgs.get("minimumLength") ?? dae.addIntLiteral(0));
          argExprIds.push(namedArgs.get("leftJustified") ?? dae.addBoolLiteral(true));
        }
      } else if (
        argExprIds.length === 1 &&
        dae.getExprKind(argExprIds[0]!) !== ExprKind.IntLiteral &&
        dae.getExprKind(argExprIds[0]!) !== ExprKind.BoolLiteral &&
        dae.getExprKind(argExprIds[0]!) !== ExprKind.StringLiteral
      ) {
        if (namedArgs.has("format")) {
          argExprIds.push(namedArgs.get("format")!);
        } else {
          argExprIds.push(namedArgs.get("minimumLength") ?? dae.addIntLiteral(0));
          argExprIds.push(namedArgs.get("leftJustified") ?? dae.addBoolLiteral(true));
        }
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
        if (byN.length > 0) enumSym = byN[0]!;
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

    const hadLeadingDot = typeof fnName === "string" && fnName.startsWith(".");

    // 3. Overloaded constructor: Complex(...)
    if (db && flattener && cleanFnName && !hadLeadingDot) {
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
                const pType = param.typeSpec?.replace(/^\./, "");
                if (namedArgs.has(param.name)) {
                  const aid = namedArgs.get(param.name)!;
                  finalArgs.push(pType === "Real" ? castToRealExpr(aid, dae) : aid);
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
                  finalArgs.push(pType === "Real" && akind !== ExprKind.ArrayCtor ? castToRealExpr(aid, dae) : aid);
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
      (dae as any)?.specializedPrefix ||
      flattener?.currentParentMods?.specializedPkgPrefix ||
      flattener?.currentParentMods?.args?.some(
        (a: any) =>
          !a.isBreak &&
          (a.isRedeclaration || a.redeclaredTypeSpecifier) &&
          (a.name === cleanFnName ||
            a.name === cleanFnName.split(".")[0] ||
            (!cleanFnName.includes(".") &&
              (a.name === cleanFnName || Boolean(prefix && dae.classKind !== "function")))),
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
    if (dae.classKind === "function" && getFlatteningState(dae).functionParameterNames?.has(cleanFnName)) {
      return dae.addCallExpr(cleanFnName, argExprIds);
    }
    if (fnName.startsWith(".")) {
      fnName = cleanFnName;
    }
    if (fnDae && (fnDae as any).aliasTo) {
      fnName = (fnDae as any).aliasTo;
      fnDae = undefined;
    }
    if (fnDae && fnDae.externalDecl && fnDae.externalDecl.includes('"builtin"')) {
      const match = fnDae.externalDecl.match(/=\s*([a-zA-Z0-9_]+)\s*\(/);
      fnName = match ? match[1]! : fnDae.name.split(".").pop()!;
      fnDae = undefined;
    }
    if (fnDae && flattener && db) {
      const currentScope = flattener.currentClassId ?? flattener.currentRootClassId;
      const resolved = currentScope
        ? db.query<(n: string) => SymbolEntry | null>("resolveName", currentScope)?.(cleanFnName)
        : null;
      if (resolved && (flattener.isExternalObject?.(resolved.id) || flattener.isRecordSym?.(resolved))) {
        fnDae = undefined;
      } else if (fnDae) {
        (fnDae as any).wasCalled = true;
        if ((fnDae as any).symId) flattener.calledFunctionSymIds?.add((fnDae as any).symId);
      }
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
      const fnBase = parts[parts.length - 1]!;
      let specializedQualifiedName: string | null = null;
      let aliasCloneFnName: string | null = null;
      let enclosingScopeId: SymbolId | undefined = undefined;
      let componentInstancePrefix: string | undefined = (dae as any)?.componentPrefix;
      let componentSpecializedPrefix: string | undefined = (dae as any)?.specializedPrefix;

      // 1. Check if parentMods redeclared this function (e.g. RedeclareFunction1.mo)
      const currentParentMods = flattener?.currentParentMods;
      const redeclArg = currentParentMods?.args?.findLast
        ? currentParentMods.args.findLast(
            (a: any) =>
              !a.isBreak &&
              (a.name === cleanFnName || (parts.length === 1 && a.name === parts[0])) &&
              (a.isRedeclaration || a.redeclaredTypeSpecifier),
          )
        : currentParentMods?.args?.find(
            (a: any) =>
              !a.isBreak &&
              (a.name === cleanFnName || (parts.length === 1 && a.name === parts[0])) &&
              (a.isRedeclaration || a.redeclaredTypeSpecifier),
          );
      if (redeclArg?.redeclaredTypeSpecifier) {
        const rawRedeclSpec = String(redeclArg.redeclaredTypeSpecifier).replace(/^\.+/, "");
        const ownerScopeId = redeclArg.ownerClassId ?? currentParentMods?.ownerClassId ?? flattener?.currentClassId;
        const evalScopeId = redeclArg.evaluationScopeId ?? ownerScopeId;
        const redeclTarget =
          (evalScopeId
            ? db.query<(n: string) => SymbolEntry | null>("resolveName", evalScopeId)?.(rawRedeclSpec)
            : null) ??
          (ownerScopeId && ownerScopeId !== evalScopeId
            ? db.query<(n: string) => SymbolEntry | null>("resolveName", ownerScopeId)?.(rawRedeclSpec)
            : null) ??
          (flattener?.currentClassId
            ? db.query<(n: string) => SymbolEntry | null>("resolveName", flattener.currentClassId)?.(rawRedeclSpec)
            : null) ??
          (flattener?.currentRootClassId
            ? db.query<(n: string) => SymbolEntry | null>("resolveName", flattener.currentRootClassId)?.(rawRedeclSpec)
            : null) ??
          db
            .byName(rawRedeclSpec.split(".").pop()!)
            .find((e: any) => (e.kind === "Class" || e.kind === "Function") && flattener.isFunctionSym?.(e));
        if (redeclTarget) {
          matchingFnSym = redeclTarget;
          const ownerClassSym = ownerScopeId ? db.symbol(ownerScopeId) : null;
          const ownerName = ownerClassSym?.name ?? "";
          if (dae.classKind === "function") {
            const daeRest =
              componentSpecializedPrefix && dae.name.startsWith(`${componentSpecializedPrefix}.`)
                ? dae.name.slice(componentSpecializedPrefix.length + 1)
                : "";
            if (componentSpecializedPrefix && daeRest.includes(".") && (dae as any).isShortFunc) {
              specializedQualifiedName = `${componentSpecializedPrefix}.${redeclArg.name}`;
              if (ownerName) {
                aliasCloneFnName = `${componentSpecializedPrefix}.${ownerName}.${redeclArg.name}`;
              }
            } else {
              specializedQualifiedName = `${dae.name}.${redeclArg.name}`;
              if (componentSpecializedPrefix && (dae as any).shortBaseFuncName) {
                aliasCloneFnName = `${componentSpecializedPrefix}.${(dae as any).shortBaseFuncName}.${redeclArg.name}`;
              }
            }
            enclosingScopeId = (dae as any).enclosingScopeId ?? ownerScopeId;
          } else if (ownerName) {
            specializedQualifiedName = `${ownerName}.${redeclArg.name}`;
            enclosingScopeId = ownerScopeId;
          }
        }
      }

      // 2. Check if cleanFnName is a qualified call on a package/class or component (e.g. B.usePart, n1.f)
      if (!matchingFnSym && parts.length > 1) {
        const prefixStr = parts.slice(0, -1).join(".");
        const fnBaseName = parts[parts.length - 1]!;
        const currentScope = flattener?.currentClassId ?? flattener?.currentRootClassId;
        const aliasPrefixSym =
          currentScope && parts.length === 2
            ? (db
                .childrenOf(currentScope)
                .find((c: any) => c.name === parts[0] && (c.kind === "Class" || c.kind === "Package")) ?? null)
            : null;
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
          if (prefixSym.kind === "Component") {
            const compClassId =
              db.query<SymbolId | null>("classInstance", prefixSym.id) ??
              (() => {
                const ci = db.query<ComponentInstanceData>("componentInstance", prefixSym.id);
                const tSpec = ci?.typeSpecifier;
                return tSpec
                  ? (db.query<any>("resolveName", currentScope ?? prefixSym.parentId)?.(tSpec)?.id ??
                      db.byName(tSpec.split(".").pop()!).find((e: any) => e.kind === "Class")?.id ??
                      null)
                  : null;
              })();
            if (compClassId) {
              const memberFn = db.query<(n: string) => SymbolEntry | null>("resolveName", compClassId)?.(fnBaseName);
              if (
                memberFn &&
                (memberFn.kind === "Class" || memberFn.kind === "Function") &&
                flattener.isFunctionSym?.(memberFn)
              ) {
                matchingFnSym = memberFn;
                const classQual = getSymbolQualifiedName(db, compClassId);
                const compPrefix = prefix ? `${prefix}.${prefixStr}` : prefixStr;
                const compMod = db.query<any>("effectiveModification", prefixSym.id);
                const hasCompMod = Boolean(compMod?.args && compMod.args.length > 0);
                const specPrefix = hasCompMod ? `${classQual}$${compPrefix.replace(/\./g, "$")}` : classQual;
                specializedQualifiedName = `${specPrefix}.${fnBaseName}`;
                enclosingScopeId = compClassId;
                componentInstancePrefix = compPrefix;
                componentSpecializedPrefix = hasCompMod ? specPrefix : undefined;
              }
            }
          } else {
            const effectivePrefixSym = aliasPrefixSym ?? prefixSym;
            const outerPkgRedeclCandidate = currentParentMods?.args?.findLast
              ? currentParentMods.args.findLast(
                  (a: any) =>
                    !a.isBreak &&
                    a.name === prefixStr &&
                    (a.isRedeclaration || a.redeclaredTypeSpecifier) &&
                    a.redeclaredTypeSpecifier,
                )
              : currentParentMods?.args?.find(
                  (a: any) =>
                    !a.isBreak &&
                    a.name === prefixStr &&
                    (a.isRedeclaration || a.redeclaredTypeSpecifier) &&
                    a.redeclaredTypeSpecifier,
                );
            let preResolvedRedeclPkgSym: SymbolEntry | null = null;
            if (outerPkgRedeclCandidate?.redeclaredTypeSpecifier) {
              const pkgSpec = String(outerPkgRedeclCandidate.redeclaredTypeSpecifier).replace(/^\.+/, "");
              let pkgScopeId =
                outerPkgRedeclCandidate.evaluationScopeId ??
                outerPkgRedeclCandidate.ownerClassId ??
                currentScope ??
                flattener?.currentRootClassId;
              if (pkgScopeId && db.symbol(pkgScopeId)?.kind === "Component") {
                pkgScopeId = db.symbol(pkgScopeId)?.parentId ?? flattener?.currentRootClassId;
              }
              preResolvedRedeclPkgSym =
                (pkgScopeId
                  ? pkgSpec.includes(".")
                    ? db.query<(n: string) => SymbolEntry | null>("resolveName", pkgScopeId)?.(pkgSpec)
                    : db.query<(n: string) => SymbolEntry | null>("resolveSimpleName", pkgScopeId)?.(pkgSpec)
                  : null) ??
                (flattener?.currentRootClassId
                  ? pkgSpec.includes(".")
                    ? db.query<(n: string) => SymbolEntry | null>(
                        "resolveName",
                        flattener.currentRootClassId,
                      )?.(pkgSpec)
                    : db.query<(n: string) => SymbolEntry | null>(
                        "resolveSimpleName",
                        flattener.currentRootClassId,
                      )?.(pkgSpec)
                  : null) ??
                db.byName(pkgSpec.split(".").pop()!).find((e: any) => e.kind === "Class" || e.kind === "Package") ??
                null;
            }
            const memberFn =
              db.query<(n: string) => SymbolEntry | null>("resolveName", prefixSym.id)?.(fnBaseName) ??
              (preResolvedRedeclPkgSym
                ? db.query<(n: string) => SymbolEntry | null>("resolveName", preResolvedRedeclPkgSym.id)?.(fnBaseName)
                : null);
            if (
              memberFn &&
              (memberFn.kind === "Class" || memberFn.kind === "Function") &&
              (flattener.isFunctionSym?.(memberFn) ||
                flattener.isExternalObject?.(memberFn.id) ||
                flattener.isRecordSym?.(memberFn))
            ) {
              const prefixMod =
                db.query<any>("effectiveModification", effectivePrefixSym.id) ??
                db.query<any>("effectiveModification", prefixSym.id);
              const prefixRedeclArg = prefixMod?.args?.find(
                (a: any) => !a.isBreak && a.name === fnBaseName && (a.isRedeclaration || a.redeclaredTypeSpecifier),
              );
              const intermediateFnName = prefixRedeclArg?.redeclaredTypeSpecifier ?? memberFn.name;
              const pkgRedeclArg = currentParentMods?.args?.findLast
                ? currentParentMods.args.findLast(
                    (a: any) =>
                      !a.isBreak &&
                      (a.name === intermediateFnName || a.name === memberFn.name) &&
                      (a.isRedeclaration || a.redeclaredTypeSpecifier),
                  )
                : currentParentMods?.args?.find(
                    (a: any) =>
                      !a.isBreak &&
                      (a.name === intermediateFnName || a.name === memberFn.name) &&
                      (a.isRedeclaration || a.redeclaredTypeSpecifier),
                  );
              const outerPkgRedeclArg = !pkgRedeclArg ? outerPkgRedeclCandidate : null;
              const redeclaredPkgSym: SymbolEntry | null = outerPkgRedeclArg ? preResolvedRedeclPkgSym : null;
              const targetSpec = pkgRedeclArg?.redeclaredTypeSpecifier ?? prefixRedeclArg?.redeclaredTypeSpecifier;
              let lookupScopeId =
                pkgRedeclArg?.evaluationScopeId ??
                effectivePrefixSym.parentId ??
                prefixSym.parentId ??
                flattener?.currentRootClassId;
              if (lookupScopeId && db.symbol(lookupScopeId)?.kind === "Component") {
                lookupScopeId = db.symbol(lookupScopeId)?.parentId ?? flattener?.currentRootClassId;
              }
              const pkgRedeclTarget = targetSpec
                ? ((lookupScopeId
                    ? targetSpec.includes(".")
                      ? db.query<(n: string) => SymbolEntry | null>("resolveName", lookupScopeId)?.(targetSpec)
                      : db.query<(n: string) => SymbolEntry | null>("resolveSimpleName", lookupScopeId)?.(targetSpec)
                    : null) ??
                  (flattener?.currentRootClassId
                    ? targetSpec.includes(".")
                      ? db.query<(n: string) => SymbolEntry | null>(
                          "resolveName",
                          flattener.currentRootClassId,
                        )?.(targetSpec)
                      : db.query<(n: string) => SymbolEntry | null>(
                          "resolveSimpleName",
                          flattener.currentRootClassId,
                        )?.(targetSpec)
                    : null) ??
                  db
                    .byName(targetSpec.split(".").pop()!)
                    .find((e: any) => (e.kind === "Class" || e.kind === "Function") && flattener.isFunctionSym?.(e)))
                : redeclaredPkgSym
                  ? db.query<(n: string) => SymbolEntry | null>("resolveName", redeclaredPkgSym.id)?.(fnBaseName)
                  : null;
              if (pkgRedeclTarget) {
                matchingFnSym = pkgRedeclTarget;
                const compConcreteClassId =
                  currentParentMods?.currentClassId ?? currentParentMods?.ownerClassId ?? currentScope;
                const ownerQual =
                  redeclaredPkgSym && compConcreteClassId && db.symbol(compConcreteClassId)?.kind === "Class"
                    ? getSymbolQualifiedName(db, compConcreteClassId)
                    : effectivePrefixSym.parentId
                      ? getSymbolQualifiedName(db, effectivePrefixSym.parentId)
                      : getSymbolQualifiedName(db, effectivePrefixSym.id);
                const specPkgPrefix =
                  prefix && (pkgRedeclArg || outerPkgRedeclArg)
                    ? `${ownerQual}$${prefix.replace(/\./g, "$")}.${prefixStr}`
                    : `${ownerQual}.${prefixStr}`;
                specializedQualifiedName = `${specPkgPrefix}.${fnBaseName}`;
                enclosingScopeId = redeclaredPkgSym?.id ?? pkgRedeclTarget.parentId ?? undefined;
                if (redeclaredPkgSym && prefix) {
                  componentSpecializedPrefix = specPkgPrefix;
                }
              } else {
                matchingFnSym = memberFn;
                const prefixQual = getSymbolQualifiedName(db, effectivePrefixSym.id);
                specializedQualifiedName = `${prefixQual}.${fnBaseName}`;
                enclosingScopeId = effectivePrefixSym.id;
                componentInstancePrefix = undefined;
                componentSpecializedPrefix = undefined;
              }
            }
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
            (flattener.isFunctionSym?.(encScopeFn) || flattener.isRecordSym?.(encScopeFn))
          ) {
            const encScopeQual = componentSpecializedPrefix ?? getSymbolQualifiedName(db, fnEncScope);
            if (!(SCALAR_VECTORIZABLE_FUNCTIONS.has(cleanFnName) && encScopeQual.includes("ComplexMath"))) {
              matchingFnSym = encScopeFn;
              const encScopeSym = db.symbol(fnEncScope);
              if (encScopeSym && (encScopeSym.kind === "Class" || encScopeSym.kind === "Package")) {
                specializedQualifiedName = `${encScopeQual}.${cleanFnName}`;
                enclosingScopeId = fnEncScope;
              }
            }
          }
        }

        if (!matchingFnSym && currentParentMods?.packageScopeId && currentParentMods?.specializedPkgPrefix) {
          const pkgFn =
            db.query<(n: string) => SymbolEntry | null>(
              "resolveSimpleName",
              currentParentMods.packageScopeId,
            )?.(cleanFnName) ??
            db.query<(n: string) => SymbolEntry | null>("resolveName", currentParentMods.packageScopeId)?.(cleanFnName);
          if (
            pkgFn &&
            (pkgFn.kind === "Class" || pkgFn.kind === "Function") &&
            (flattener.isFunctionSym?.(pkgFn) || flattener.isRecordSym?.(pkgFn))
          ) {
            matchingFnSym = pkgFn;
            componentSpecializedPrefix = currentParentMods.specializedPkgPrefix;
            componentInstancePrefix = currentParentMods.specializedPkgInstPrefix;
            specializedQualifiedName = `${currentParentMods.specializedPkgPrefix}.${cleanFnName}`;
            enclosingScopeId = currentParentMods.packageScopeId;
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
              (flattener.isFunctionSym?.(inScopeFn) || flattener.isRecordSym?.(inScopeFn))
            ) {
              const inScopeQual = getSymbolQualifiedName(db, inScopeFn.id);
              if (!(SCALAR_VECTORIZABLE_FUNCTIONS.has(cleanFnName) && inScopeQual.includes("ComplexMath"))) {
                matchingFnSym = inScopeFn;
              }
              const rawScopeId = flattener?.currentClassId;
              let qualScopeId = rawScopeId;
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

                  const isLocalToCurrentFn = Boolean(
                    rawScopeId && rawScopeId !== qualScopeId && inScopeFn.parentId === rawScopeId,
                  );
                  const isDirectChild = inScopeFn.parentId === qualScopeId || isLocalToCurrentFn;
                  const isInherited =
                    inScopeFn.parentId != null &&
                    (isClassAncestor(inScopeFn.parentId, qualScopeId) ||
                      Boolean(
                        rawScopeId && rawScopeId !== qualScopeId && isClassAncestor(inScopeFn.parentId, rawScopeId),
                      ));
                  if (isDirectChild || isInherited) {
                    if (
                      !componentSpecializedPrefix &&
                      prefix &&
                      dae.classKind !== "function" &&
                      currentParentMods?.args?.some(
                        (a: any) => !a.isBreak && (a.isRedeclaration || a.redeclaredTypeSpecifier),
                      )
                    ) {
                      const baseQual = getSymbolQualifiedName(db, qualScopeId);
                      componentSpecializedPrefix = `${baseQual}$${prefix.replace(/\./g, "$")}`;
                      componentInstancePrefix = prefix;
                    } else if (
                      dae.classKind === "function" &&
                      isLocalToCurrentFn &&
                      (dae as any)?.enclosingScopeId &&
                      qualScopeId !== (dae as any).enclosingScopeId
                    ) {
                      componentSpecializedPrefix = undefined;
                      componentInstancePrefix = undefined;
                    }
                    const scopeQual = componentSpecializedPrefix ?? getSymbolQualifiedName(db, qualScopeId);
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
      if (!matchingFnSym && (!isEncapsulatedScope || hadLeadingDot)) {
        const candidates = db.byName(fnBase).filter((e: any) => {
          if (e.kind !== "Class") return false;
          if (parts.length > 1) {
            const qual = getSymbolQualifiedName(db, e.id);
            return qual === cleanFnName || qual.endsWith("." + cleanFnName);
          }
          return parts.length === 1;
        });
        if (candidates.length > 0) {
          if (parts.length === 1) {
            matchingFnSym = SCALAR_VECTORIZABLE_FUNCTIONS.has(fnBase)
              ? null
              : (candidates.find((e: any) => getSymbolQualifiedName(db, e.id) === `Modelica.Math.${fnBase}`) ??
                candidates.find((e: any) => !getSymbolQualifiedName(db, e.id).includes("ComplexMath")) ??
                candidates[0]);
          } else {
            matchingFnSym = candidates[0];
          }
        }
      }

      if (matchingFnSym && flattener.isExternalObject?.(matchingFnSym.id)) {
        const qualifiedName = getSymbolQualifiedName(db, matchingFnSym.id);
        const ctorName = `${qualifiedName}.constructor`;
        flattener.usedExternalObjects?.add(matchingFnSym.id);
        return dae.addCallExpr(ctorName, argExprIds);
      }
      if (matchingFnSym && (flattener.isRecordSym(matchingFnSym) || flattener.isOperatorRecordSym(matchingFnSym))) {
        const targetCtorName =
          specializedQualifiedName && specializedQualifiedName.includes("$") ? specializedQualifiedName : undefined;
        if (!targetCtorName) {
          flattener.usedRecordSymIds?.add(matchingFnSym.id);
          if (matchingFnSym.name) flattener.usedRecordNames?.add(matchingFnSym.name);
        }
        let ctorFn = targetCtorName
          ? dae.getFunction(targetCtorName)
          : (dae.getFunction(cleanFnName) ?? dae.getFunction(fnName));
        if (!ctorFn && flattener.generateRecordConstructorFor) {
          ctorFn = flattener.generateRecordConstructorFor(
            matchingFnSym,
            dae,
            flattener.currentRootClassId,
            targetCtorName,
          );
        }
        if (ctorFn) {
          fnDae = ctorFn;
          fnName = targetCtorName ?? (ctorFn.name || cleanFnName);
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
          if (dae.extensionMetadata?.["isOldFrontend"]) {
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
        const prevCompPrefix = (flattener as any).currentFunctionComponentPrefix;
        const prevSpecPrefix = (flattener as any).currentFunctionSpecializedPrefix;
        (flattener as any).currentFunctionComponentPrefix = componentInstancePrefix;
        (flattener as any).currentFunctionSpecializedPrefix = componentSpecializedPrefix;
        let fn: DAEBuilder;
        try {
          fn = isRecursiveCall
            ? (dae.getFunction(qualifiedFnName) ?? dae.getFunction(cleanFnName) ?? dae.getFunction(fnName) ?? dae)
            : flattener.flattenFunction(matchingFnSym.id, qualifiedFnName, undefined, dae, enclosingScopeId);
        } finally {
          (flattener as any).currentFunctionComponentPrefix = prevCompPrefix;
          (flattener as any).currentFunctionSpecializedPrefix = prevSpecPrefix;
        }
        if (isRecursiveCall) {
          (fn as any).isRecursive = true;
        }
        (fn as any).symId = matchingFnSym.id;
        if (fn.diagnostics.some((d: any) => d.severity === "error")) {
          for (const d of fn.diagnostics) {
            (d as any).fromFunction = true;
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
            if (dae.extensionMetadata?.["isOldFrontend"]) {
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
          const isBuiltinExt = Boolean(fn.externalDecl && fn.externalDecl.includes('"builtin"'));
          if (!isBuiltinExt) {
            dae.addFunction(qualifiedFnName, fn);
            if (!specializedQualifiedName) {
              dae.addFunction(cleanFnName, fn);
              dae.addFunction(fnName, fn);
              if (parts.length === 1 && fnBase) dae.addFunction(fnBase, fn);
            }
            let rootDae: any = (flattener as any)?.currentRootDae ?? dae;
            while (rootDae.parentDae) rootDae = rootDae.parentDae;
            rootDae.addFunction(qualifiedFnName, fn);
            if (aliasCloneFnName && !rootDae.functions.has(aliasCloneFnName)) {
              const aliasFn = fn.clone();
              aliasFn.name = aliasCloneFnName;
              (aliasFn as any).wasCalled = true;
              dae.addFunction(aliasCloneFnName, aliasFn);
              rootDae.addFunction(aliasCloneFnName, aliasFn);
            }
            if (fn.functions && fn.functions.size > 0) {
              for (const [nestedName, nestedFn] of fn.functions.entries()) {
                rootDae.addFunction(nestedName, nestedFn);
              }
            }
            fnDae = fn;
            fnName = qualifiedFnName;
          } else {
            const match = fn.externalDecl!.match(/=\s*([a-zA-Z0-9_]+)\s*\(/);
            fnName = match ? match[1]! : fnBase || fn.name.split(".").pop()!;
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

    // ==========================================================================
    // User-Defined Function Parameter Binding, Default Argument Cycle Detection,
    // Compile-Time Constant Evaluation, and Single-Assignment Inlining
    // ==========================================================================
    if (fnDae) {
      if (flattener.options.omcCompatibility) {
        // Check for cyclic dependencies in default arguments by constructing a dependency graph
        // over omitted input parameters and running a DFS cycle detector (hasCycle).
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
                if (next === curr) continue;
                const rawCallPrefix = cleanFnName.includes(".")
                  ? cleanFnName.slice(0, cleanFnName.lastIndexOf("."))
                  : "";
                const callPrefix =
                  rawCallPrefix && prefix ? resolveScopedName(rawCallPrefix, prefix, dae) : rawCallPrefix;
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

      // Bind formal input parameters in declaration order from named arguments, positional arguments,
      // or default binding expressions cloned from fnDae into the caller DAE via copyExprBetweenDaes.
      const positionalArgs = [...argExprIds];
      const newArgExprIds: number[] = [];
      const inputSubstitutions = new Map<string, number>();
      const structuralInputNames = new Set<string>();
      for (let vi = 0; vi < fnDae.varCount; vi++) {
        const sExprs = fnDae.getVarShapeExprs ? fnDae.getVarShapeExprs(vi) : null;
        if (sExprs) {
          for (const seId of sExprs) {
            if (seId >= 0) {
              for (const nm of fnDae.collectExprVarNames(seId)) {
                structuralInputNames.add(nm);
              }
            }
          }
        }
      }
      let prePosIdx = 0;
      for (let i = 0; i < fnDae.varCount; i++) {
        if (fnDae.getVarCausality(i) === Causality.Input) {
          const inputName = fnDae.getVarName(i);
          let preAid: number | undefined = undefined;
          if (namedArgs.has(inputName)) {
            preAid = namedArgs.get(inputName)!;
          } else if (prePosIdx < positionalArgs.length) {
            preAid = positionalArgs[prePosIdx];
            prePosIdx++;
          }
          if (preAid !== undefined && preAid >= 0) {
            let substVal = preAid;
            const expectedShape = fnDae.getVarShape(i) ?? [];
            const cVal = evalDaeExpr(preAid, dae);
            if (cVal !== null) {
              if (expectedShape.length === 0 && typeof cVal === "number") {
                const foldedId = addArenaValueAsExpr(dae, cVal);
                if (foldedId >= 0) substVal = foldedId;
              } else if (expectedShape.length > 0 && Array.isArray(cVal)) {
                const foldedId = addArenaValueAsExpr(dae, cVal);
                if (foldedId >= 0) substVal = foldedId;
              }
            }
            const expectedType = fnDae.getVarType(i);
            const expectedCustomType = fnDae.getVarCustomType(i);
            const providedType = inferArenaExprVarType(dae, substVal);
            if (
              expectedType === VarType.Real &&
              !expectedCustomType &&
              (providedType === VarType.Integer || providedType === null)
            ) {
              substVal = castToRealExpr(substVal, dae);
            }
            inputSubstitutions.set(inputName, substVal);
          }
        }
      }
      let posIdx = 0;
      for (let i = 0; i < fnDae.varCount; i++) {
        if (fnDae.getVarCausality(i) === Causality.Input) {
          const inputName = fnDae.getVarName(i);
          let aid: number | undefined = undefined;
          let argNode: any = undefined;
          let isFromDefault = false;
          if (namedArgs.has(inputName)) {
            aid = namedArgs.get(inputName)!;
          } else if (posIdx < positionalArgs.length) {
            aid = positionalArgs[posIdx];
            argNode = argNodes[posIdx];
            posIdx++;
          } else if (flattener.options.omcCompatibility) {
            const defExprId = fnDae.getVarExpression(i);
            if (typeof defExprId === "number" && defExprId >= 0) {
              const rawCallPrefix = cleanFnName.includes(".") ? cleanFnName.slice(0, cleanFnName.lastIndexOf(".")) : "";
              const callPrefix =
                rawCallPrefix && prefix ? resolveScopedName(rawCallPrefix, prefix, dae) : rawCallPrefix;
              const defId = copyExprBetweenDaes(fnDae, defExprId, dae, inputSubstitutions, callPrefix);
              if (defId >= 0) {
                aid = defId;
                isFromDefault = true;
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
            if (structuralInputNames.has(inputName) && fnDae.getVarType(i) === VarType.Integer && substVal !== aid) {
              aid = substVal;
            } else if (
              isFromDefault &&
              substVal !== aid &&
              dae.getExprKind(aid) === ExprKind.Call &&
              dae.interner.resolve(dae.getExprData1(aid)) === "fill"
            ) {
              aid = substVal;
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

    // Verify that formal parameters declared with `constant` variability receive constant arguments
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

    // Attempt compile-time constant evaluation (evaluateArenaFunctionCall) when all arguments
    // are constant, or inline single-assignment pure functions (isEarlyInline).
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

      let allConstant = true;
      const constArgs: any[] = [];
      for (const aid of argExprIds) {
        let evalAid = aid;
        if (dae.getExprKind(aid) === ExprKind.Name) {
          const vName = dae.interner.resolve(dae.getExprData1(aid));
          const expanded = vName ? expandVarToArrayCtor(vName, dae) : null;
          if (expanded !== null) evalAid = expanded;
        }
        if (
          exprContainsNonConstantRef(evalAid, dae) &&
          !(fnDae.name.endsWith("Vectors.normalize") && dae.getExprKind(evalAid) === ExprKind.ArrayCtor)
        ) {
          allConstant = false;
          break;
        }
        const cVal = evalDaeExpr(evalAid, dae);
        if (cVal === null) {
          allConstant = false;
          break;
        }
        constArgs.push(cVal);
      }

      if (
        flattener?.options?.omcCompatibility &&
        Boolean((dae.extensionMetadata as any)?.hasOldInstOption) &&
        !(fnDae as any).isBeingFlattened &&
        !(fnDae as any).isRecursive &&
        (!(fnDae as any).symId || !flattener.activeFlatteningFunctionIds?.has((fnDae as any).symId)) &&
        fnDae.eqCount === 0 &&
        fnDae.algorithmSections.length === 0 &&
        !fnDae.externalDecl &&
        !hasOutputExpr &&
        argExprIds.every((aid) => evalDaeExpr(aid, dae) !== null)
      ) {
        let firstOutputType: VarType | null = null;
        let firstOutputHasArrayDims = false;
        let outputCount = 0;
        for (let i = 0; i < fnDae.varCount; i++) {
          if (fnDae.getVarCausality(i) === Causality.Output) {
            if (outputCount === 0) {
              firstOutputType = fnDae.getVarType(i);
              firstOutputHasArrayDims = (fnDae.getVarShape(i)?.length ?? 0) > 0;
            }
            outputCount++;
          }
        }
        if (
          outputCount === 1 &&
          firstOutputType !== null &&
          !firstOutputHasArrayDims &&
          cleanFnName !== "equalityConstraint"
        ) {
          (fnDae as any).wasCalled = true;
          if (firstOutputType === VarType.Integer) return dae.addIntLiteral(0);
          if (firstOutputType === VarType.Boolean) return dae.addBoolLiteral(false);
          if (firstOutputType === VarType.String) return dae.addStringLiteral("");
          return dae.addRealLiteral(0.0);
        }
      }

      if (
        allConstant &&
        !(fnDae as any).isExplicitImpure &&
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
          if (outVal !== null && outVal !== undefined && !(typeof outVal === "number" && Number.isNaN(outVal))) {
            (fnDae as any).wasCalled = true;
            let outputCount = 0;
            let firstOutputType: VarType | null = null;
            let firstOutputCustomType: string | null = null;
            let firstOutputIsScalar = true;
            const outputTypes: VarType[] = [];
            for (let i = 0; i < fnDae.varCount; i++) {
              if (fnDae.getVarCausality(i) === Causality.Output) {
                if (outputCount === 0) {
                  firstOutputType = fnDae.getVarType(i);
                  firstOutputCustomType = fnDae.getVarCustomType(i) ?? null;
                  firstOutputIsScalar = (fnDae.getVarShape(i)?.length ?? 0) === 0;
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
            if (firstOutputCustomType && firstOutputIsScalar && Array.isArray(firstVal)) {
              const ctorFn =
                dae.getFunction(firstOutputCustomType) ??
                (firstOutputCustomType.includes(".")
                  ? dae.getFunction(firstOutputCustomType.split(".").pop()!)
                  : undefined);
              const fieldTypes: VarType[] = [];
              if (ctorFn) {
                for (let vi = 0; vi < ctorFn.varCount; vi++) {
                  if (!ctorFn.isVarRemoved(vi) && ctorFn.getVarCausality(vi) === Causality.Input) {
                    fieldTypes.push(ctorFn.getVarType(vi));
                  }
                }
              }
              const ctorElemIds = firstVal.map((v, idx) => addArenaValueAsExpr(dae, v, fieldTypes[idx]));
              if (ctorElemIds.every((id) => id >= 0)) {
                return dae.addCallExpr(firstOutputCustomType, ctorElemIds);
              }
            }
            const inlinedId = addArenaValueAsExpr(dae, firstVal, firstOutputType ?? undefined);
            if (inlinedId >= 0) return inlinedId;
          }
        } catch (err: any) {
          if (
            err?.code === 4009 ||
            err?.message?.includes("causes a cyclic dependency") ||
            err?.message?.includes("assert triggered:") ||
            err?.message?.includes("limit (--eval")
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
        !(fnDae as any).isExplicitImpure &&
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
              subs.set(inName, argExprIds[inputIdx]!);
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
      let targetFnCallName =
        fnDae.externalDecl && fnDae.externalDecl.includes('"builtin"')
          ? typeof fnName === "string"
            ? fnName
            : fnDae.name.split(".").pop()!
          : fnDae.name;
      if (dae.extensionMetadata?.["isOldFrontend"] && fnDae.externalDecl) {
        const builtinMatch = fnDae.externalDecl.match(/=\s*(sin|cos)\s*\(\s*[^)\s]/);
        if (builtinMatch) {
          targetFnCallName = builtinMatch[1]!;
        }
      }
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
          vIdx = vName ? dae.getVarIdxByName(vName) : -1;
          if (vIdx < 0 && prefix && vName) vIdx = dae.getVarIdxByName(`${prefix}.${vName}`);
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

    const cleanFn = cleanFnName || (typeof fnName === "string" ? (fnName.split(".").pop() ?? "") : fnName);
    if (
      cleanFn === "div" ||
      cleanFn === "rem" ||
      cleanFn === "mod" ||
      cleanFn === "integer" ||
      SCALAR_VECTORIZABLE_FUNCTIONS.has(cleanFn)
    ) {
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
        if (cleanFn === "integer" && constArgs.length === 1) {
          return dae.addIntLiteral(Math.floor(constArgs[0]!));
        }
        if (cleanFn === "div" && constArgs.length === 2) {
          const res = constArgs[1] !== 0 ? Math.trunc(constArgs[0]! / constArgs[1]!) : 0;
          const isInt =
            inferArenaExprVarType(dae, argExprIds[0]!) === VarType.Integer &&
            inferArenaExprVarType(dae, argExprIds[1]!) === VarType.Integer;
          return isInt ? dae.addIntLiteral(res) : dae.addRealLiteral(res);
        }
        if (cleanFn === "rem" && constArgs.length === 2) {
          const res =
            constArgs[1] !== 0 ? constArgs[0]! - Math.trunc(constArgs[0]! / constArgs[1]!) * constArgs[1]! : 0;
          const isInt =
            inferArenaExprVarType(dae, argExprIds[0]!) === VarType.Integer &&
            inferArenaExprVarType(dae, argExprIds[1]!) === VarType.Integer;
          return isInt ? dae.addIntLiteral(res) : dae.addRealLiteral(res);
        }
        if (cleanFn === "mod" && constArgs.length === 2) {
          const res =
            constArgs[1] !== 0 ? constArgs[0]! - Math.floor(constArgs[0]! / constArgs[1]!) * constArgs[1]! : 0;
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
      } else if ((cleanFn === "div" || cleanFn === "rem" || cleanFn === "mod") && argExprIds.length === 2) {
        if (isRealExpr(argExprIds[0]!, dae) && !isRealExpr(argExprIds[1]!, dae)) {
          argExprIds[1] = castToRealExpr(argExprIds[1]!, dae);
        } else if (!isRealExpr(argExprIds[0]!, dae) && isRealExpr(argExprIds[1]!, dae)) {
          argExprIds[0] = castToRealExpr(argExprIds[0]!, dae);
        }
      } else if ((cleanFn === "integer" || cleanFn === "floor" || cleanFn === "ceil") && argExprIds.length === 1) {
        if (!isRealExpr(argExprIds[0]!, dae)) {
          argExprIds[0] = castToRealExpr(argExprIds[0]!, dae);
        }
      }
    }
    if (
      cleanFn === "sqrt" &&
      argExprIds.length === 1 &&
      Boolean(dae.extensionMetadata?.["isOldFrontend"]) &&
      argExprIds[0]! >= 0 &&
      dae.getExprKind(argExprIds[0]!) === ExprKind.Call &&
      dae.interner.resolve(dae.getExprData1(argExprIds[0]!)) === "sqrt" &&
      dae.getExprRight(argExprIds[0]!) === 1
    ) {
      const innerArg = dae.getExprLeft(argExprIds[0]!);
      return dae.addBinaryExpr(BinOp.Pow, innerArg, dae.addRealLiteral(0.25));
    }
    if (cleanFn === "noEvent" && argExprIds.length === 1 && flattener?.options?.omcCompatibility) {
      const innerId = argExprIds[0]!;
      if (innerId >= 0 && dae.getExprKind(innerId) === ExprKind.Binary) {
        const innerOp = dae.getExprData1(innerId);
        if (
          innerOp === BinOp.Add ||
          innerOp === BinOp.Sub ||
          innerOp === BinOp.Mul ||
          innerOp === BinOp.Div ||
          innerOp === BinOp.Pow
        ) {
          return innerId;
        }
      }
    }
    if ((cleanFn === "inStream" || cleanFn === "actualStream") && argExprIds.length === 1) {
      const innerId = argExprIds[0]!;
      if (innerId >= 0 && dae.getExprKind(innerId) === ExprKind.Name) {
        const vName = dae.interner.resolve(dae.getExprData1(innerId));
        const arrShape = vName ? getNamedArrayShape(dae, vName) : null;
        if (arrShape && arrShape.some((d) => d === 0)) {
          return dae.addArrayCtorExpr([]);
        }
      }
      if (innerId >= 0 && dae.getExprKind(innerId) === ExprKind.ArrayCtor) {
        const count = dae.getExprData1(innerId);
        if (count === 0) return innerId;
        const elems: number[] = [];
        for (let i = 0; i < count; i++) {
          const eId = i === 0 ? dae.getExprLeft(innerId) : dae.getExprLeft(innerId + i);
          elems.push(dae.addCallExpr(cleanFn, [eId]));
        }
        return dae.addArrayCtorExpr(elems);
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
        fnSym = db.byName(fnName).find((s: any) => {
          if (s.kind !== "Function" && s.kind !== "Class") return false;
          if (SCALAR_VECTORIZABLE_FUNCTIONS.has(fnName)) {
            const qual = getSymbolQualifiedName(db, s.id);
            if (qual.includes("ComplexMath")) return false;
          }
          return true;
        });
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
    const firstCh = node.child(0);
    const isParenSubscript =
      (firstCh?.type === "(" || firstCh?.text === "(" || firstCh?.type === '"("') && node.childCount >= 4;
    const baseNode = isParenSubscript ? node.child(1) : firstCh;
    const subsNode = node.child(node.childCount - 1)!;
    const baseName = isParenSubscript ? "" : (baseNode?.text?.trim() ?? "");

    // Evaluate subscripts
    const subVals: (number | string)[] = [];
    let allNumeric = true;
    for (let i = 0; i < subsNode.childCount; i++) {
      const c = subsNode.child(i);
      if (c && (c.type === "subscript" || c.type === "expression")) {
        const expr = c.children?.find((k: any) => k.type === "expression") ?? c;
        const exprText = expr?.text?.trim() ?? "";
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

    const isIdentifierBase = /^[a-zA-Z_]\w*(?:\.[a-zA-Z_]\w*)*$/.test(baseName);
    if (allNumeric && subVals.length > 0 && isIdentifierBase) {
      let candidate = `${baseName}[${subVals.join(",")}]`;
      if (prefix && !candidate.startsWith(prefix) && !candidate.includes(".")) {
        candidate = `${prefix}.${candidate}`;
      }
      return dae.addExpression(ExprKind.Name, dae.interner.intern(candidate));
    }

    const baseId = lowerCSTExpression(baseNode, dae, prefix, substitutions, imports, db, flattener, false, true);
    if (allNumeric && subVals.length > 0 && baseId >= 0 && dae.getExprKind(baseId) === ExprKind.ArrayCtor) {
      let currId = baseId;
      let resolvedAll = true;
      for (const sv of subVals) {
        const idx = typeof sv === "number" ? sv : Number(sv);
        if (!Number.isInteger(idx) || dae.getExprKind(currId) !== ExprKind.ArrayCtor) {
          resolvedAll = false;
          break;
        }
        const elems = getArrayCtorElements(currId, dae);
        if (idx >= 1 && idx <= elems.length) {
          currId = elems[idx - 1]!;
        } else {
          resolvedAll = false;
          break;
        }
      }
      if (resolvedAll && currId >= 0) {
        return currId;
      }
    }
    const subIds: number[] = [];
    for (let i = 0; i < subsNode.childCount; i++) {
      const c = subsNode.child(i);
      if (c && (c.type === "subscript" || c.type === "expression")) {
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
          const subText = expr?.text?.trim() ?? "";
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
      if (c && (c.type === "expression" || c.type === "lhs_expression" || c.type === "array_arguments")) {
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
                  const evalScopeId =
                    flattener?.currentClassId ??
                    flattener?.currentRootClassId ??
                    getFlatteningState(dae).currentClassId;
                  const rangeText = rangeNode.text?.trim() ?? "";
                  if (rangeText.startsWith("{") && rangeText.endsWith("}")) {
                    const items = getArrayLiteralItems(rangeNode);
                    for (const item of items) {
                      const v = evaluateCSTNumber(item, substitutions as any, evalScopeId, db, dae, prefix);
                      if (v !== null) values.push(v);
                    }
                  } else if (rangeText.includes(":")) {
                    const colonNodes = flattenColonNodes(rangeNode);
                    if (colonNodes.length >= 2) {
                      const s = evaluateCSTNumber(colonNodes[0], substitutions as any, evalScopeId, db, dae, prefix);
                      let e: number | null = null;
                      let step = 1;
                      if (colonNodes.length === 2) {
                        e = evaluateCSTNumber(colonNodes[1], substitutions as any, evalScopeId, db, dae, prefix);
                      } else if (colonNodes.length >= 3) {
                        step =
                          evaluateCSTNumber(colonNodes[1], substitutions as any, evalScopeId, db, dae, prefix) ?? 1;
                        e = evaluateCSTNumber(colonNodes[2], substitutions as any, evalScopeId, db, dae, prefix);
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

              if (iters.length === forIndices.length && iters.length >= 1) {
                for (const it of iters) pushLoopVar(flattener, it.name);
                try {
                  // Modelica 3.6 §10.4.2: {expr for i1 in r1, i2 in r2} === {{expr for i1 in r1} for i2 in r2}
                  const buildSubComprehension = (
                    dimIdx: number,
                    currentSubs: Map<string, number | string>,
                  ): number[] => {
                    const iter = iters[dimIdx]!;
                    const ids: number[] = [];
                    for (const val of iter.values) {
                      const nextSubs = new Map(currentSubs);
                      nextSubs.set(iter.name, val);
                      if (dimIdx === 0) {
                        ids.push(lowerCSTExpression(exprChild, dae, prefix, nextSubs, imports, db, flattener));
                      } else {
                        ids.push(dae.addArrayCtorExpr(buildSubComprehension(dimIdx - 1, nextSubs)));
                      }
                    }
                    return ids;
                  };
                  elementIds.push(...buildSubComprehension(iters.length - 1, new Map(substitutions)));
                } finally {
                  for (const it of iters) popLoopVar(flattener, it.name);
                }
                continue;
              }
              const iterators: { name: string; rangeId: number }[] = [];
              for (const fi of forIndices) {
                const varName = (Cst.ForIndex.variable(fi)?.text?.trim() || fi.child(0)?.text?.trim() || "").trim();
                const rangeNode = Cst.ForIndex.range(fi) || fi.children?.find?.((k: any) => k.type === "expression");
                let rangeId = -1;
                if (rangeNode) {
                  rangeId = lowerCSTExpression(rangeNode, dae, prefix, substitutions, imports, db, flattener);
                }
                if (varName) {
                  iterators.push({ name: varName, rangeId });
                }
              }
              if (iterators.length > 0) {
                for (const it of iterators) pushLoopVar(flattener, it.name);
                let bodyId: number;
                try {
                  bodyId = lowerCSTExpression(exprChild, dae, prefix, substitutions, imports, db, flattener);
                } finally {
                  for (const it of iterators) popLoopVar(flattener, it.name);
                }
                return dae.addComprehensionExpr("array", bodyId, iterators);
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
      if (!c) continue;
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
        if (dae.getExprKind(item) === ExprKind.Call || dae.getExprKind(item) === ExprKind.Name) return -1;
        return 1;
      });
      const firstRowCount = rowCounts[0]!;
      const mismatchIdx = firstRowCount > 0 ? rowCounts.findIndex((r) => r > 0 && r !== firstRowCount) : -1;
      if (mismatchIdx !== -1) {
        let parentEq: any = node;
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
        if (rank === 1) return true;
        if (rank === 0 && dae.getExprKind(item) === ExprKind.Name) {
          const vName = dae.interner.resolve(dae.getExprData1(item));
          if (vName === "time") return false;
          const vIdx = vName ? dae.getVarIdxByName(vName) : -1;
          if (vIdx >= 0) {
            const shape = dae.getVarShape(vIdx);
            const shapeExprs = dae.getVarShapeExprs ? dae.getVarShapeExprs(vIdx) : null;
            return Boolean((shape && shape.length > 0) || (shapeExprs && shapeExprs.length > 0));
          }
        }
        return false;
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

    const anySingleScalarBlock =
      blocks.length > 1 && blocks.some((b) => b.length === 1 && getArrayCtorRank(b[0]!, dae) === 0);
    const to2DRows = (item: number, blockLen: number): number[][] => {
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
        if (blockLen > 1 || (blocks.length === 1 && blocks[0]?.length === 1) || anySingleScalarBlock) {
          return elems.map((e) => [e]);
        }
        return [elems];
      }
      return [[item]];
    };

    const rawMatrixRows: number[][] = [];
    for (const block of blocks) {
      if (block.length === 0) continue;
      const itemMatrices = block.map((it) => to2DRows(it, block.length));
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
        rawMatrixRows.push(rowCols);
      }
    }
    const matrixHasReal = rawMatrixRows.some((row) => row.some((e) => isRealExpr(e, dae)));
    const allMatrixRows = rawMatrixRows.map((row) =>
      dae.addArrayCtorExpr(matrixHasReal ? row.map((e) => (isRealExpr(e, dae) ? e : castToRealExpr(e, dae))) : row),
    );

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

    if (isLeftColon && leftChild) {
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
        const startType = varTypeName(inferArenaExprVarType(dae, startId) ?? VarType.Real);
        let enumTypeStr = "enumeration E(one, two, three)";
        const dotIdx = stepText.lastIndexOf(".");
        const enumPfx = dotIdx > 0 ? stepText.slice(0, dotIdx).trim() : stepText;
        const scopeId =
          flattener?.currentClassId ?? flattener?.currentRootClassId ?? getFlatteningState(dae).currentClassId;
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
        const scopeId =
          flattener?.currentClassId ?? flattener?.currentRootClassId ?? getFlatteningState(dae).currentClassId;
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
      const isAnyReal = isRealExpr(startId, dae) || isRealExpr(stepId, dae) || isRealExpr(stopId, dae);
      const effStartId = isAnyReal ? castToRealExpr(startId, dae) : startId;
      const effStepId = isAnyReal ? castToRealExpr(stepId, dae) : stepId;
      const effStopId = isAnyReal ? castToRealExpr(stopId, dae) : stopId;
      const rangeId = dae.addExpression(ExprKind.Range, effStartId, effStepId, effStopId);
      const isMulOperand = (() => {
        if (dae.classKind !== "function" || (dae as any).isEarlyInline) return false;
        let cur: any = node.parent;
        while (cur && (cur.childCount === 1 || (cur.childCount === 3 && cur.child(0)?.text?.trim() === "("))) {
          cur = cur.parent;
        }
        return Boolean(cur && cur.childCount === 3 && cur.child(1)?.text?.trim() === "*");
      })();
      const expanded = !isForIndex && !isMulOperand ? expandColonToArrayCtor(rangeId, dae) : null;
      return expanded !== null ? expanded : rangeId;
    } else {
      const startId = lowerCSTExpression(node.child(0), dae, prefix, substitutions, imports, db, flattener);
      const stopId = lowerCSTExpression(node.child(2), dae, prefix, substitutions, imports, db, flattener);
      if (
        !isForIndex &&
        dae.getExprKind(startId) === ExprKind.EnumLiteral &&
        dae.getExprKind(stopId) === ExprKind.EnumLiteral
      ) {
        const startFull = dae.interner.resolve(dae.getExprLeft(startId)) ?? "";
        const lastDot = startFull.lastIndexOf(".");
        if (lastDot > 0) {
          const enumPfx = startFull.slice(0, lastDot);
          const scopeId =
            flattener?.currentClassId ?? flattener?.currentRootClassId ?? getFlatteningState(dae).currentClassId;
          const enumInfo = resolveEnumType(enumPfx, scopeId, db);
          if (enumInfo) {
            const sOrd = dae.getExprData1(startId);
            const eOrd = dae.getExprData1(stopId);
            const elemIds: number[] = [];
            for (let ord = sOrd; ord <= eOrd; ord++) {
              const litName = enumInfo.literals[ord - 1];
              if (litName) {
                elemIds.push(dae.addEnumLiteral(ord, `${enumPfx}.${litName}`));
              }
            }
            return dae.addArrayCtorExpr(elemIds);
          }
        }
      }
      const isAnyReal = isRealExpr(startId, dae) || isRealExpr(stopId, dae);
      const effStartId = isAnyReal ? castToRealExpr(startId, dae) : startId;
      const effStopId = isAnyReal ? castToRealExpr(stopId, dae) : stopId;
      const rangeId = dae.addExpression(ExprKind.Range, effStartId, -1, effStopId);
      const isMulOperand = (() => {
        if (dae.classKind !== "function" || (dae as any).isEarlyInline) return false;
        let cur: any = node.parent;
        while (cur && (cur.childCount === 1 || (cur.childCount === 3 && cur.child(0)?.text?.trim() === "("))) {
          cur = cur.parent;
        }
        return Boolean(cur && cur.childCount === 3 && cur.child(1)?.text?.trim() === "*");
      })();
      const expanded = !isForIndex && !isMulOperand ? expandColonToArrayCtor(rangeId, dae) : null;
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
      const startType = varTypeName(inferArenaExprVarType(dae, startId) ?? VarType.Real);
      let enumTypeStr = "enumeration E(one, two, three)";
      const dotIdx = stepText.lastIndexOf(".");
      const enumPfx = dotIdx > 0 ? stepText.slice(0, dotIdx).trim() : stepText;
      const scopeId =
        flattener?.currentClassId ?? flattener?.currentRootClassId ?? getFlatteningState(dae).currentClassId;
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
      const scopeId =
        flattener?.currentClassId ?? flattener?.currentRootClassId ?? getFlatteningState(dae).currentClassId;
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
    const isAnyReal = isRealExpr(startId, dae) || isRealExpr(stepId, dae) || isRealExpr(stopId, dae);
    const effStartId = isAnyReal ? castToRealExpr(startId, dae) : startId;
    const effStepId = isAnyReal ? castToRealExpr(stepId, dae) : stepId;
    const effStopId = isAnyReal ? castToRealExpr(stopId, dae) : stopId;
    const rangeId = dae.addExpression(ExprKind.Range, effStartId, effStepId, effStopId);
    const isMulOperand = (() => {
      if (dae.classKind !== "function" || (dae as any).isEarlyInline) return false;
      let cur: any = node.parent;
      while (cur && (cur.childCount === 1 || (cur.childCount === 3 && cur.child(0)?.text?.trim() === "("))) {
        cur = cur.parent;
      }
      return Boolean(cur && cur.childCount === 3 && cur.child(1)?.text?.trim() === "*");
    })();
    const expanded = !isForIndex && !isMulOperand ? expandColonToArrayCtor(rangeId, dae) : null;
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
    const isOldFrontend = Boolean(dae.extensionMetadata?.["isOldFrontend"]);
    const hasBranchDer =
      !isOldFrontend &&
      (branches.some((br) => /\bder\s*\(/.test(br.thenNode?.text ?? "")) || /\bder\s*\(/.test(elseNode?.text ?? ""));
    for (let b = 0; b < branches.length; b++) {
      const condId = lowerCSTExpression(branches[b]!.condNode, dae, prefix, substitutions, imports, db, flattener);
      const isRuntimeParam = hasBranchDer
        ? false
        : isOldFrontend && !prefix
          ? exprReferencesEnumParameter(condId, dae)
          : exprReferencesRuntimeParameter(condId, dae, new Set(), Boolean(isOldFrontend && prefix));
      if (isRuntimeParam) {
        loweredConds.push({ condId, condVal: null });
        allFalseSoFar = false;
        break;
      }
      const condVal = evalDaeExpr(condId, dae);
      if (hasBranchDer && (condVal === true || condVal === 1 || condVal === false || condVal === 0)) {
        const condVars = new Set<string>();
        dae.collectExprVarNames(condId, condVars);
        for (const vName of condVars) {
          const vIdx = dae.getVarIdxByName(vName);
          if (vIdx >= 0 && dae.getVarVariability(vIdx) === Variability.Parameter) {
            dae.setVarFinal(vIdx, true);
          }
        }
      }
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
      const thenDims = getExprDims(thenId, dae, db);
      const elseDims = getExprDims(currElseId, dae, db);
      if (
        thenDims &&
        elseDims &&
        (thenDims.length !== elseDims.length || thenDims.some((d, i) => d > 0 && elseDims[i]! > 0 && d !== elseDims[i]))
      ) {
        const cVal = evalDaeExpr(condId, dae);
        if (cVal === true || cVal === 1 || cVal === false || cVal === 0) {
          const markParamsFinal = (id: number): void => {
            if (id < 0) return;
            const k = dae.getExprKind(id);
            if (k === ExprKind.Name) {
              const nm = dae.interner.resolve(dae.getExprData1(id));
              if (nm) {
                const vIdx = dae.lookupVariable(nm);
                if (vIdx >= 0 && dae.getVarVariability(vIdx) === Variability.Parameter) {
                  dae.setVarFinal(vIdx, true);
                }
              }
            } else if (k === ExprKind.Binary || k === ExprKind.Subscript) {
              markParamsFinal(dae.getExprLeft(id));
              markParamsFinal(dae.getExprRight(id));
            } else if (k === ExprKind.Unary || k === ExprKind.Negate) {
              markParamsFinal(dae.getExprLeft(id));
            }
          };
          markParamsFinal(condId);
          currElseId = cVal === true || cVal === 1 ? thenId : currElseId;
          continue;
        }
      }
      if (
        thenId >= 0 &&
        currElseId >= 0 &&
        dae.getExprKind(thenId) === ExprKind.EnumLiteral &&
        dae.getExprKind(currElseId) === ExprKind.EnumLiteral &&
        dae.getExprData1(thenId) === dae.getExprData1(currElseId) &&
        dae.getExprLeft(thenId) === dae.getExprLeft(currElseId)
      ) {
        continue;
      }
      currElseId = dae.addExpression(ExprKind.IfElse, condId, thenId, currElseId);
    }
    return currElseId;
  }

  // ============================================================================
  // Binary Expression Lowering (Arithmetic, Relational, Logical, Element-Wise)
  // ============================================================================
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
      if (
        (binOp === BinOp.Eq ||
          binOp === BinOp.Neq ||
          binOp === BinOp.Lt ||
          binOp === BinOp.Lte ||
          binOp === BinOp.Gt ||
          binOp === BinOp.Gte) &&
        leftNode &&
        /^not\b/.test(leftNode.text?.trim() ?? "") &&
        dae.getExprKind(leftId) === ExprKind.Unary &&
        dae.getExprData1(leftId) === UnaryOp.Not
      ) {
        const innerLeft = dae.getExprLeft(leftId);
        return dae.addExpression(ExprKind.Unary, UnaryOp.Not, dae.addBinaryExpr(binOp, innerLeft, rightId));
      }
      // 1. Operator record overload resolution (`operator '+'`, `operator '*'`, etc.):
      //    If either operand is an `operator record`, dispatch to the matching overloaded operator function.
      if (db && flattener) {
        const opName = getOperatorNameForBinOp(binOp);
        if (opName) {
          const dispatched = dispatchBinaryOperator(opName, leftId, rightId, leftNode, rightNode, dae, db, flattener);
          if (dispatched !== null) return dispatched;
        }
      }
      // 2. Element-wise binary operators (`.+`, `.-`, `.*`, `./`, `.^`):
      //    Expand scalarized array variable references into `ArrayCtor` trees and broadcast element-wise.
      if (
        binOp === BinOp.ElemAdd ||
        binOp === BinOp.ElemSub ||
        binOp === BinOp.ElemMul ||
        binOp === BinOp.ElemDiv ||
        binOp === BinOp.ElemPow
      ) {
        if (db && flattener) {
          const hasOpRec = (id: number, n?: any): boolean => {
            if (id < 0) return false;
            if (resolveOperatorRecord(id, n ?? null, dae, db, flattener) !== null) return true;
            if (dae.getExprKind(id) === ExprKind.Binary) {
              return hasOpRec(dae.getExprLeft(id)) || hasOpRec(dae.getExprRight(id));
            }
            return false;
          };
          if (hasOpRec(leftId, leftNode) || hasOpRec(rightId, rightNode)) {
            return dae.addBinaryExpr(binOp, leftId, rightId);
          }
        }
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
        if (
          db &&
          ((dae.getExprKind(leftId) === ExprKind.Name && dae.getExprKind(rightId) === ExprKind.EnumLiteral) ||
            (dae.getExprKind(rightId) === ExprKind.Name && dae.getExprKind(leftId) === ExprKind.EnumLiteral))
        ) {
          const fnExprId = dae.getExprKind(leftId) === ExprKind.Name ? leftId : rightId;
          const enumExprId = dae.getExprKind(leftId) === ExprKind.EnumLiteral ? leftId : rightId;
          const fnNameStr = dae.interner.resolve(dae.getExprData1(fnExprId));
          if (fnNameStr && dae.getVarIdxByName(fnNameStr) < 0) {
            const fnShort = fnNameStr.split(".").pop()!;
            const fnSym = db
              .byName(fnShort)
              .find((s: any) => s.kind === "Function" || s.metadata?.classPrefixes?.includes("function"));
            if (fnSym) {
              const enumPath = dae.interner.resolve(dae.getExprLeft(enumExprId));
              const enumTypeName = enumPath.slice(0, enumPath.lastIndexOf("."));
              const scopeId = flattener?.currentClassId ?? flattener?.currentRootClassId ?? undefined;
              const enumInfo = resolveEnumType(enumTypeName, scopeId, db);
              const litsStr = enumInfo ? enumInfo.literals.join(", ") : "";
              const leftTypeStr =
                fnExprId === leftId ? `.${fnShort}<function>() => #enumeration(${litsStr})` : `enumeration(${litsStr})`;
              const rightTypeStr =
                fnExprId === rightId
                  ? `.${fnShort}<function>() => #enumeration(${litsStr})`
                  : `enumeration(${litsStr})`;
              let stmtNode: any = node;
              while (
                stmtNode?.parent &&
                stmtNode.type !== "if_statement" &&
                stmtNode.type !== "statement" &&
                stmtNode.type !== "simple_equation" &&
                stmtNode.type !== "equation"
              ) {
                stmtNode = stmtNode.parent;
              }
              dae.diagnostics.push({
                severity: "error",
                code: ModelicaErrorCode.BINARY_OP_TYPE_MISMATCH.code,
                message: `Cannot resolve type of expression ${leftNode?.text?.trim()} ${opToken} ${rightNode?.text?.trim()}. The operands have types ${leftTypeStr}, ${rightTypeStr} in component <NO COMPONENT>.`,
                range: {
                  startByte: stmtNode?.startIndex ?? stmtNode?.startByte ?? node.startIndex,
                  endByte: stmtNode?.endIndex ?? stmtNode?.endByte ?? node.endIndex,
                  startPosition: stmtNode?.startPosition ?? node.startPosition,
                  endPosition: stmtNode?.endPosition ?? node.endPosition,
                },
              });
              return -1;
            }
          }
        }
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
        const isStringAdd =
          binOp === BinOp.Add &&
          (lType === VarType.String || dae.getExprKind(leftId) === ExprKind.StringLiteral) &&
          (rType === VarType.String || dae.getExprKind(rightId) === ExprKind.StringLiteral);
        if (
          isStringAdd &&
          dae.getExprKind(leftId) === ExprKind.StringLiteral &&
          dae.getExprKind(rightId) === ExprKind.StringLiteral
        ) {
          const s1 = dae.interner.resolve(dae.getExprData1(leftId)) ?? "";
          const s2 = dae.interner.resolve(dae.getExprData1(rightId)) ?? "";
          return dae.addStringLiteral(s1 + s2);
        }

        if (!isStringAdd && (isLNonNumeric || isRNonNumeric)) {
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
              leftDims!.some((d, i) => d > 0 && rightDims![i]! > 0 && d !== rightDims![i]))) ||
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
        if (
          (inferArenaExprVarType(dae, leftId) === VarType.String || leftKind === ExprKind.StringLiteral) &&
          (inferArenaExprVarType(dae, rightId) === VarType.String || rightKind === ExprKind.StringLiteral)
        ) {
          return dae.addBinaryExpr(BinOp.Add, leftId, rightId);
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
          const realLeftId = isReal && !isRealExpr(leftId, dae) ? castToRealExpr(leftId, dae) : leftId;
          return dae.addBinaryExpr(BinOp.Add, negLitId, realLeftId);
        }
        if (
          flattener?.options?.omcCompatibility &&
          dae.classKind === "function" &&
          rightKind === ExprKind.Binary &&
          dae.getExprData1(rightId) === BinOp.Add
        ) {
          const addL = dae.getExprLeft(rightId);
          const addR = dae.getExprRight(rightId);
          if (
            dae.getExprKind(addL) === ExprKind.Name &&
            dae.getExprKind(addR) === ExprKind.Binary &&
            dae.getExprData1(addR) === BinOp.Mul
          ) {
            const negAddL = dae.addUnaryExpr(UnaryOp.Negate, addL);
            const firstAdd = dae.addBinaryExpr(BinOp.Add, leftId, negAddL);
            return dae.addBinaryExpr(BinOp.Sub, firstAdd, addR);
          }
        }
        const negateLeadingMulDivLiteral = (id: number): number | null => {
          if (id < 0 || dae.getExprKind(id) !== ExprKind.Binary) return null;
          const op = dae.getExprData1(id) as BinOp;
          if (op === BinOp.Mul) {
            const mulL = dae.getExprLeft(id);
            const mulR = dae.getExprRight(id);
            const mulLKind = dae.getExprKind(mulL);
            const mulRKind = dae.getExprKind(mulR);
            if (mulLKind === ExprKind.RealLiteral) {
              return dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(-dae.getExprRealValue(mulL)), mulR);
            }
            if (mulLKind === ExprKind.IntLiteral) {
              return dae.addBinaryExpr(BinOp.Mul, dae.addIntLiteral(-dae.getExprData1(mulL)), mulR);
            }
            if (mulRKind === ExprKind.RealLiteral) {
              return dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(-dae.getExprRealValue(mulR)), mulL);
            }
            if (mulRKind === ExprKind.IntLiteral) {
              return dae.addBinaryExpr(BinOp.Mul, dae.addIntLiteral(-dae.getExprData1(mulR)), mulL);
            }
            if (Boolean(dae.extensionMetadata?.["isOldFrontend"]) && dae.classKind === "function") {
              if (mulLKind === ExprKind.Binary && (dae.getExprData1(mulL) as BinOp) === BinOp.Sub) {
                const negSubL = negateLeadingMulDivLiteral(dae.getExprLeft(mulL));
                if (negSubL !== null) {
                  return dae.addBinaryExpr(
                    BinOp.Mul,
                    dae.addBinaryExpr(BinOp.Add, dae.getExprRight(mulL), negSubL),
                    mulR,
                  );
                }
              }
              const negL = negateLeadingMulDivLiteral(mulL);
              if (negL !== null) return dae.addBinaryExpr(BinOp.Mul, negL, mulR);
            }
          } else if (
            op === BinOp.Div &&
            Boolean(dae.extensionMetadata?.["isOldFrontend"]) &&
            dae.classKind === "function"
          ) {
            const negL = negateLeadingMulDivLiteral(dae.getExprLeft(id));
            if (negL !== null) return dae.addBinaryExpr(BinOp.Div, negL, dae.getExprRight(id));
          }
          return null;
        };
        const negRight = negateLeadingMulDivLiteral(rightId);
        if (negRight !== null) {
          binOp = BinOp.Add;
          rightId = negRight;
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
                setExprArrayShape(dae, res, [0, N!]);
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
              setExprArrayShape(dae, res, [M!, N!]);
              return res;
            }
          }
          // Matrix * Vector: [M, K1] * [K2]
          if (leftDims.length === 2 && rightDims.length === 1 && leftDims[1] === rightDims[0]) {
            const [M, K] = leftDims;
            if (M === 0) {
              const res = dae.addArrayCtorExpr([]);
              setExprArrayShape(dae, res, [0]);
              return res;
            }
            if (K === 0) {
              const zeroLit = dae.addRealLiteral(0.0);
              const resElems: number[] = [];
              for (let i = 0; i < M!; i++) resElems.push(zeroLit);
              const res = dae.addArrayCtorExpr(resElems);
              setExprArrayShape(dae, res, [M!]);
              return res;
            }
          }
          // Vector * Matrix: [K1] * [K2, N]
          if (leftDims.length === 1 && rightDims.length === 2 && leftDims[0] === rightDims[0]) {
            const [, N] = rightDims;
            const K = leftDims[0]!;
            if (N === 0) {
              const res = dae.addArrayCtorExpr([]);
              setExprArrayShape(dae, res, [0]);
              return res;
            }
            if (K === 0) {
              const zeroLit = dae.addRealLiteral(0.0);
              const resElems: number[] = [];
              for (let i = 0; i < N!; i++) resElems.push(zeroLit);
              const res = dae.addArrayCtorExpr(resElems);
              setExprArrayShape(dae, res, [N!]);
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
          } else if (effectiveRightKind === ExprKind.Call) {
            const rVal = evalDaeExpr(effectiveRightId, dae);
            if (Array.isArray(rVal) && rVal.length > 0 && rVal.every((x) => typeof x === "number")) {
              effectiveRightId = dae.addArrayCtorExpr(rVal.map((x) => dae.addRealLiteral(x as number)));
              effectiveRightKind = ExprKind.ArrayCtor;
            }
          }
        }
        if (effectiveLeftKind === ExprKind.ArrayCtor && effectiveRightKind === ExprKind.ArrayCtor) {
          return matrixOrVectorMul(effectiveLeftId, effectiveRightId, dae);
        } else if (
          effectiveLeftKind !== ExprKind.ArrayCtor &&
          effectiveLeftKind !== ExprKind.Range &&
          !(effectiveLeftKind === ExprKind.Binary && dae.getExprData1(effectiveLeftId) === BinOp.Colon) &&
          leftDims &&
          leftDims.length > 0 &&
          effectiveRightKind === ExprKind.ArrayCtor &&
          rightDims &&
          rightDims.length > 0
        ) {
          const rRaw = rightNode?.text?.trim() ?? "";
          if (rRaw && /^[a-zA-Z_]\w*(?:\.[a-zA-Z_]\w*)*$/.test(rRaw)) {
            rightId = dae.addNameExpr(resolveScopedName(rRaw, prefix, dae));
          }
        } else if (
          effectiveRightKind !== ExprKind.ArrayCtor &&
          effectiveRightKind !== ExprKind.Range &&
          !(effectiveRightKind === ExprKind.Binary && dae.getExprData1(effectiveRightId) === BinOp.Colon) &&
          rightDims &&
          rightDims.length > 0 &&
          effectiveLeftKind === ExprKind.ArrayCtor &&
          leftDims &&
          leftDims.length > 0
        ) {
          const lRaw = leftNode?.text?.trim() ?? "";
          if (lRaw && /^[a-zA-Z_]\w*(?:\.[a-zA-Z_]\w*)*$/.test(lRaw)) {
            leftId = dae.addNameExpr(resolveScopedName(lRaw, prefix, dae));
          }
        } else if (
          effectiveLeftKind === ExprKind.ArrayCtor &&
          (effectiveRightKind === ExprKind.Range ||
            (effectiveRightKind === ExprKind.Binary && dae.getExprData1(effectiveRightId) === BinOp.Colon))
        ) {
          leftId = effectiveLeftId;
        } else if (
          effectiveRightKind === ExprKind.ArrayCtor &&
          (effectiveLeftKind === ExprKind.Range ||
            (effectiveLeftKind === ExprKind.Binary && dae.getExprData1(effectiveLeftId) === BinOp.Colon))
        ) {
          rightId = effectiveRightId;
        } else if (effectiveLeftKind === ExprKind.ArrayCtor && (!rightDims || rightDims.length === 0)) {
          // Vector/Matrix/ND-Array * Scalar
          const mulArrayByScalar = (arrId: number): number => {
            const elems = getArrayCtorElements(arrId, dae);
            if (elems.length > 0 && dae.getExprKind(elems[0]!) === ExprKind.ArrayCtor) {
              return dae.addArrayCtorExpr(elems.map((e) => mulArrayByScalar(e)));
            }
            return dae.addArrayCtorExpr(elems.map((e) => makeMul(e, effectiveRightId)));
          };
          return mulArrayByScalar(effectiveLeftId);
        } else if (effectiveRightKind === ExprKind.ArrayCtor && (!leftDims || leftDims.length === 0)) {
          // Scalar * Vector/Matrix/ND-Array
          const mulScalarByArray = (arrId: number): number => {
            const elems = getArrayCtorElements(arrId, dae);
            if (elems.length > 0 && dae.getExprKind(elems[0]!) === ExprKind.ArrayCtor) {
              return dae.addArrayCtorExpr(elems.map((e) => mulScalarByArray(e)));
            }
            return dae.addArrayCtorExpr(elems.map((e) => makeMul(effectiveLeftId, e)));
          };
          return mulScalarByArray(effectiveRightId);
        } else if (
          Boolean(dae.extensionMetadata?.["isOldFrontend"]) &&
          (!leftDims || leftDims.length === 0) &&
          rightDims &&
          rightDims.length > 0 &&
          effectiveLeftKind === ExprKind.Name &&
          effectiveRightKind === ExprKind.Binary
        ) {
          [leftId, rightId] = [rightId, leftId];
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
          const lNum = leftKind === ExprKind.IntLiteral ? dae.getExprData1(leftId) : dae.getExprRealValue(leftId);
          const rNum = rightKind === ExprKind.IntLiteral ? dae.getExprData1(rightId) : dae.getExprRealValue(rightId);
          return dae.addRealLiteral(Math.pow(lNum, rNum));
        }

        const isOne = (id: number): boolean => {
          const k = dae.getExprKind(id);
          if (k === ExprKind.IntLiteral && dae.getExprData1(id) === 1) return true;
          if (k === ExprKind.RealLiteral && dae.getExprRealValue(id) === 1.0) return true;
          return false;
        };
        if (isOne(rightId)) return leftId;
        const isZero = (id: number): boolean => {
          const k = dae.getExprKind(id);
          if (k === ExprKind.IntLiteral && dae.getExprData1(id) === 0) return true;
          if (k === ExprKind.RealLiteral && dae.getExprRealValue(id) === 0.0) return true;
          return false;
        };
        if (isZero(rightId)) {
          return isRealExpr(leftId, dae) || rightKind === ExprKind.RealLiteral
            ? dae.addRealLiteral(1.0)
            : dae.addIntLiteral(1);
        }

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
      // Algebraic linear term combination (`c1 * x +/- c2 * x -> (c1 +/- c2) * x`):
      // Decomposes additive operands into `(coeff, baseId)` pairs and combines terms with identical symbolic bases.
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
              if (areExpressionsEqual(dae, leftFactors[li]!, rightFactors[ri]!)) {
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
      const hasNoCallExpr = (id: number): boolean => {
        if (id < 0) return false;
        const k = dae.getExprKind(id);
        if (k === ExprKind.Call) return false;
        if (k === ExprKind.Binary) {
          return hasNoCallExpr(dae.getExprLeft(id)) && hasNoCallExpr(dae.getExprRight(id));
        }
        if (k === ExprKind.Unary || k === ExprKind.Negate) {
          return hasNoCallExpr(dae.getExprLeft(id));
        }
        return true;
      };
      const extractLeadingMulLiteral = (id: number, reverseRest = false): { cVal: number; restId: number } | null => {
        if (id < 0 || dae.getExprKind(id) !== ExprKind.Binary || (dae.getExprData1(id) as BinOp) !== BinOp.Mul) {
          return null;
        }
        const l = dae.getExprLeft(id);
        const r = dae.getExprRight(id);
        const lK = dae.getExprKind(l);
        if (lK === ExprKind.RealLiteral || lK === ExprKind.IntLiteral) {
          const cVal = lK === ExprKind.RealLiteral ? dae.getExprRealValue(l) : dae.getExprData1(l);
          return cVal !== 0 ? { cVal, restId: r } : null;
        }
        const subL = extractLeadingMulLiteral(l, reverseRest);
        if (subL) {
          const reverseFactors =
            reverseRest &&
            Boolean(dae.extensionMetadata?.["isOldFrontend"]) &&
            hasNoCallExpr(subL.restId) &&
            hasNoCallExpr(r);
          return {
            cVal: subL.cVal,
            restId: reverseFactors
              ? dae.addBinaryExpr(BinOp.Mul, r, subL.restId)
              : dae.addBinaryExpr(BinOp.Mul, subL.restId, r),
          };
        }
        return null;
      };
      if (binOp === BinOp.Div) {
        const leftKind = dae.getExprKind(leftId);
        const rightKind = dae.getExprKind(rightId);
        if (
          Boolean(dae.extensionMetadata?.["isOldFrontend"]) &&
          ((leftKind === ExprKind.IntLiteral && dae.getExprData1(leftId) === 1) ||
            (leftKind === ExprKind.RealLiteral && dae.getExprRealValue(leftId) === 1.0)) &&
          rightKind === ExprKind.Binary &&
          (dae.getExprData1(rightId) as BinOp) === BinOp.Pow
        ) {
          const baseId = dae.getExprLeft(rightId);
          const expId = dae.getExprRight(rightId);
          const expK = dae.getExprKind(expId);
          if (
            dae.getExprKind(baseId) === ExprKind.Name &&
            (expK === ExprKind.IntLiteral || expK === ExprKind.RealLiteral)
          ) {
            const eVal = expK === ExprKind.RealLiteral ? dae.getExprRealValue(expId) : dae.getExprData1(expId);
            return dae.addBinaryExpr(
              BinOp.Pow,
              isRealExpr(baseId, dae) ? baseId : castToRealExpr(baseId, dae),
              dae.addRealLiteral(-eVal),
            );
          }
        }
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
            const realLeftId = isRealExpr(leftId, dae) ? leftId : castToRealExpr(leftId, dae);
            if (leftKind === ExprKind.Negate) {
              return dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(-reciprocal), dae.getExprLeft(realLeftId));
            }
            if (leftKind === ExprKind.Unary && (dae.getExprData1(leftId) as UnaryOp) === UnaryOp.Negate) {
              return dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(-reciprocal), dae.getExprLeft(realLeftId));
            }
            if (leftKind === ExprKind.ArrayCtor) {
              const recId = dae.addRealLiteral(reciprocal);
              const elems = getArrayCtorElements(leftId, dae);
              return dae.addArrayCtorExpr(elems.map((e) => mulWithSimplification(recId, e, dae)));
            }
            if (
              Boolean(dae.extensionMetadata?.["isOldFrontend"]) &&
              leftKind === ExprKind.Binary &&
              (dae.getExprData1(leftId) as BinOp) === BinOp.Add &&
              extractLeadingMulLiteral(dae.getExprRight(leftId)) !== null
            ) {
              const recId = dae.addRealLiteral(reciprocal);
              return dae.addBinaryExpr(
                BinOp.Add,
                mulWithSimplification(recId, dae.getExprLeft(realLeftId), dae),
                mulWithSimplification(recId, dae.getExprRight(realLeftId), dae),
              );
            }
            return dae.classKind === "function"
              ? mulWithSimplification(dae.addRealLiteral(reciprocal), realLeftId, dae)
              : dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(reciprocal), realLeftId);
          }
        }
        if (
          flattener?.options?.omcCompatibility &&
          Boolean(dae.extensionMetadata?.["isOldFrontend"]) &&
          rightKind === ExprKind.Binary &&
          (dae.getExprData1(rightId) as BinOp) === BinOp.Div
        ) {
          // Unwrap a / (b / c) -> (a * c) / b
          let numId = isRealExpr(leftId, dae) ? leftId : castToRealExpr(leftId, dae);
          let denId = rightId;
          while (dae.getExprKind(denId) === ExprKind.Binary && (dae.getExprData1(denId) as BinOp) === BinOp.Div) {
            const dL = dae.getExprLeft(denId);
            const dR = dae.getExprRight(denId);
            const dRReal = isRealExpr(dR, dae) ? dR : castToRealExpr(dR, dae);
            numId = mulWithSimplification(numId, dRReal, dae);
            denId = dL;
          }
          leftId = numId;
          rightId = denId;
        }
        if (
          flattener?.options?.omcCompatibility &&
          (dae.getExprKind(leftId) === ExprKind.IntLiteral || dae.getExprKind(leftId) === ExprKind.RealLiteral) &&
          dae.getExprKind(rightId) === ExprKind.Binary &&
          (dae.getExprData1(rightId) as BinOp) === BinOp.Mul
        ) {
          const lK = dae.getExprKind(leftId);
          const lVal = lK === ExprKind.RealLiteral ? dae.getExprRealValue(leftId) : dae.getExprData1(leftId);
          if (!dae.extensionMetadata?.["isOldFrontend"] || lVal === 1) {
            const extracted = extractLeadingMulLiteral(rightId, true);
            if (extracted) {
              const rRightReal = isRealExpr(extracted.restId, dae)
                ? extracted.restId
                : castToRealExpr(extracted.restId, dae);
              return dae.addBinaryExpr(BinOp.Div, dae.addRealLiteral(lVal / extracted.cVal), rRightReal);
            }
          }
        }
        if (
          flattener?.options?.omcCompatibility &&
          (dae.description?.includes("record constructor") || Boolean(dae.extensionMetadata?.["isOldFrontend"])) &&
          !(dae.getExprKind(leftId) === ExprKind.IntLiteral || dae.getExprKind(leftId) === ExprKind.RealLiteral) &&
          dae.getExprKind(rightId) === ExprKind.Binary &&
          (dae.getExprData1(rightId) as BinOp) === BinOp.Mul
        ) {
          const extracted = extractLeadingMulLiteral(rightId, true);
          if (extracted) {
            const reciprocal = 1 / extracted.cVal;
            const realLeftId = isRealExpr(leftId, dae) ? leftId : castToRealExpr(leftId, dae);
            const rRightReal = isRealExpr(extracted.restId, dae)
              ? extracted.restId
              : castToRealExpr(extracted.restId, dae);
            if (
              Boolean(dae.extensionMetadata?.["isOldFrontend"]) &&
              dae.getExprKind(realLeftId) === ExprKind.Binary &&
              (dae.getExprData1(realLeftId) as BinOp) === BinOp.Pow &&
              dae.getExprKind(rRightReal) === ExprKind.Binary &&
              (dae.getExprData1(rRightReal) as BinOp) === BinOp.Pow &&
              exprsEqual(dae.getExprRight(realLeftId), dae.getExprRight(rRightReal), dae)
            ) {
              const combinedBase = dae.addBinaryExpr(
                BinOp.Div,
                dae.getExprLeft(realLeftId),
                dae.getExprLeft(rRightReal),
              );
              const combinedPow = dae.addBinaryExpr(BinOp.Pow, combinedBase, dae.getExprRight(realLeftId));
              return dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(reciprocal), combinedPow);
            }
            const leftExtracted = extractLeadingMulLiteral(realLeftId);
            const scaledLeft = leftExtracted
              ? dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(reciprocal * leftExtracted.cVal), leftExtracted.restId)
              : mulWithSimplification(dae.addRealLiteral(reciprocal), realLeftId, dae);
            return dae.addBinaryExpr(BinOp.Div, scaledLeft, rRightReal);
          }
        }
        if (
          flattener?.options?.omcCompatibility &&
          Boolean(dae.extensionMetadata?.["isOldFrontend"]) &&
          dae.getExprKind(leftId) === ExprKind.Binary &&
          (dae.getExprData1(leftId) as BinOp) === BinOp.Div &&
          extractLeadingMulLiteral(dae.getExprLeft(leftId)) !== null
        ) {
          const aId = dae.getExprLeft(leftId);
          const bId = dae.getExprRight(leftId);
          const realRight = isRealExpr(rightId, dae) ? rightId : castToRealExpr(rightId, dae);
          return dae.addBinaryExpr(BinOp.Div, aId, dae.addBinaryExpr(BinOp.Mul, bId, realRight));
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
        const leftDims = getExprDims(leftId, dae, flattener?.db, flattener);
        const rightDims = getExprDims(rightId, dae, flattener?.db, flattener);
        let effectiveLeftId = leftId;
        let effectiveLeftKind = leftKind;
        if (
          flattener?.options?.arrayMode !== "preserve" &&
          effectiveLeftKind !== ExprKind.ArrayCtor &&
          leftDims &&
          leftDims.length > 0
        ) {
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
        if (effectiveLeftKind === ExprKind.ArrayCtor && (!rightDims || rightDims.length === 0)) {
          // Vector/Matrix / Scalar
          const leftElems = getArrayCtorElements(effectiveLeftId, dae);
          const isMatrix = leftElems.length > 0 && dae.getExprKind(leftElems[0]!) === ExprKind.ArrayCtor;
          let castRight = rightId;
          if (!isRealExpr(castRight, dae)) {
            castRight = castToRealExpr(castRight, dae);
          }
          if (isMatrix) {
            const rows = leftElems.map((r) => {
              const rElems = getArrayCtorElements(r, dae);
              return dae.addArrayCtorExpr(
                rElems.map((e) => {
                  const castE = !isRealExpr(e, dae) ? castToRealExpr(e, dae) : e;
                  return dae.addBinaryExpr(BinOp.Div, castE, castRight);
                }),
              );
            });
            return dae.addArrayCtorExpr(rows);
          } else {
            return dae.addArrayCtorExpr(
              leftElems.map((e) => {
                const castE = !isRealExpr(e, dae) ? castToRealExpr(e, dae) : e;
                return dae.addBinaryExpr(BinOp.Div, castE, castRight);
              }),
            );
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
        const isOldFrontend = Boolean(dae.extensionMetadata?.["isOldFrontend"]);
        const leftMulDims = getExprDims(leftId, dae, flattener?.db, flattener);
        const rightMulDims = getExprDims(rightId, dae, flattener?.db, flattener);
        const isScalarMul = (!leftMulDims || leftMulDims.length === 0) && (!rightMulDims || rightMulDims.length === 0);
        const leftMulText =
          dae.getExprKind(leftId) === ExprKind.Name ? dae.interner.resolve(dae.getExprData1(leftId)) : null;
        const rightMulText =
          dae.getExprKind(rightId) === ExprKind.Name ? dae.interner.resolve(dae.getExprData1(rightId)) : null;
        const isFnFieldAccess =
          dae.classKind === "function" && Boolean(leftMulText?.includes(".") || rightMulText?.includes("."));
        if (isOldFrontend && isScalarMul && !isFnFieldAccess && exprsEqual(leftId, rightId, dae)) {
          const isReal = isRealExpr(leftId, dae);
          return dae.addBinaryExpr(BinOp.Pow, leftId, isReal ? dae.addRealLiteral(2.0) : dae.addIntLiteral(2));
        }
        if (
          isOldFrontend &&
          isScalarMul &&
          !isFnFieldAccess &&
          dae.getExprKind(leftId) === ExprKind.Binary &&
          dae.getExprData1(leftId) === BinOp.Mul &&
          exprsEqual(dae.getExprRight(leftId), rightId, dae)
        ) {
          const mL = dae.getExprLeft(leftId);
          const mR = dae.getExprRight(leftId);
          const isReal = isRealExpr(mR, dae);
          const powExpr = dae.addBinaryExpr(BinOp.Pow, mR, isReal ? dae.addRealLiteral(2.0) : dae.addIntLiteral(2));
          return dae.addBinaryExpr(BinOp.Mul, mL, powExpr);
        }
        if (
          isOldFrontend &&
          isScalarMul &&
          dae.getExprKind(rightId) === ExprKind.Binary &&
          dae.getExprData1(rightId) === BinOp.Pow
        ) {
          const rBase = dae.getExprLeft(rightId);
          const rExp = dae.getExprRight(rightId);
          if (
            dae.getExprKind(leftId) === ExprKind.Binary &&
            dae.getExprData1(leftId) === BinOp.Pow &&
            exprsEqual(dae.getExprRight(leftId), rExp, dae)
          ) {
            return dae.addBinaryExpr(BinOp.Pow, mulWithSimplification(dae.getExprLeft(leftId), rBase, dae), rExp);
          }
          if (dae.getExprKind(leftId) === ExprKind.Binary && dae.getExprData1(leftId) === BinOp.Mul) {
            const mL = dae.getExprLeft(leftId);
            const mR = dae.getExprRight(leftId);
            if (
              dae.getExprKind(mR) === ExprKind.Binary &&
              dae.getExprData1(mR) === BinOp.Pow &&
              exprsEqual(dae.getExprRight(mR), rExp, dae)
            ) {
              const combinedPow = dae.addBinaryExpr(
                BinOp.Pow,
                mulWithSimplification(dae.getExprLeft(mR), rBase, dae),
                rExp,
              );
              return dae.addBinaryExpr(BinOp.Mul, mL, combinedPow);
            }
          }
        }
        const leftText =
          dae.getExprKind(leftId) === ExprKind.Name ? dae.interner.resolve(dae.getExprData1(leftId)) : null;
        const rightText =
          dae.getExprKind(rightId) === ExprKind.Name ? dae.interner.resolve(dae.getExprData1(rightId)) : null;
        const isOmc =
          flattener?.options?.omcCompatibility ?? getFlatteningState(dae).flattener?.options?.omcCompatibility ?? true;
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
      // Real coercion in binary expressions:
      // Division (`/`) and exponentiation (`^`) unconditionally promote both operands to Real;
      // other binary operators promote an Integer operand to Real if the paired operand is Real-typed.
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
        if (
          dae.getExprKind(leftId) === ExprKind.Binary &&
          dae.getExprData1(leftId) === BinOp.Pow &&
          dae.getExprKind(rightId) === ExprKind.Binary &&
          dae.getExprData1(rightId) === BinOp.Pow
        ) {
          const lBase = dae.getExprLeft(leftId);
          const lExp = dae.getExprRight(leftId);
          const rBase = dae.getExprLeft(rightId);
          const rExp = dae.getExprRight(rightId);
          const isExpTwo = (id: number) =>
            (dae.getExprKind(id) === ExprKind.RealLiteral && dae.getExprRealValue(id) === 2.0) ||
            (dae.getExprKind(id) === ExprKind.IntLiteral && dae.getExprData1(id) === 2);
          if (
            isExpTwo(lExp) &&
            isExpTwo(rExp) &&
            dae.getExprKind(lBase) === ExprKind.Call &&
            dae.getExprKind(rBase) === ExprKind.Call &&
            dae.getExprRight(lBase) === 1 &&
            dae.getExprRight(rBase) === 1
          ) {
            const lFn = dae.interner.resolve(dae.getExprData1(lBase));
            const rFn = dae.interner.resolve(dae.getExprData1(rBase));
            if (
              ((lFn === "sin" && rFn === "cos") || (lFn === "cos" && rFn === "sin")) &&
              areExpressionsEqual(dae, dae.getExprLeft(lBase), dae.getExprLeft(rBase))
            ) {
              return dae.addRealLiteral(1.0);
            }
          }
        }
        if (
          Boolean(dae.extensionMetadata?.["isOldFrontend"]) &&
          dae.getExprKind(leftId) === ExprKind.Binary &&
          dae.getExprData1(leftId) === BinOp.Mul &&
          dae.getExprKind(rightId) === ExprKind.Binary &&
          dae.getExprData1(rightId) === BinOp.Mul
        ) {
          const lA = dae.getExprLeft(leftId);
          const lB = dae.getExprRight(leftId);
          const rA = dae.getExprLeft(rightId);
          const rB = dae.getExprRight(rightId);
          if (exprsEqual(lA, rA, dae) && dae.getExprKind(lA) === ExprKind.Call) {
            return dae.addBinaryExpr(BinOp.Mul, lA, dae.addBinaryExpr(BinOp.Add, lB, rB));
          }
        }
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
        if (
          Boolean(dae.extensionMetadata?.["isOldFrontend"]) &&
          dae.getExprKind(leftId) === ExprKind.Binary &&
          (dae.getExprData1(leftId) as BinOp) === BinOp.Sub
        ) {
          const subL = dae.getExprLeft(leftId);
          const subR = dae.getExprRight(leftId);
          const newAdd =
            dae.getExprKind(subL) === ExprKind.IntLiteral && dae.getExprKind(rightId) === ExprKind.IntLiteral
              ? dae.addIntLiteral(dae.getExprData1(subL) + dae.getExprData1(rightId))
              : dae.getExprKind(subL) === ExprKind.RealLiteral && dae.getExprKind(rightId) === ExprKind.RealLiteral
                ? dae.addRealLiteral(dae.getExprRealValue(subL) + dae.getExprRealValue(rightId))
                : dae.addBinaryExpr(BinOp.Add, subL, rightId);
          return dae.addBinaryExpr(BinOp.Sub, newAdd, subR);
        }
        if (
          (dae.classKind !== "function" ||
            Boolean(dae.extensionMetadata?.["isOldFrontend"]) ||
            Boolean((flattener as any)?.options?.isOldFrontend)) &&
          !tupleContext &&
          !isAssignmentLhs
        ) {
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
        if (
          dae.getExprKind(leftId) === ExprKind.Binary &&
          dae.getExprData1(leftId) === BinOp.Mul &&
          dae.getExprKind(rightId) === ExprKind.Call &&
          dae.getExprRight(rightId) === 1
        ) {
          const mL = dae.getExprLeft(leftId);
          const mR = dae.getExprRight(leftId);
          const isTwo =
            (dae.getExprKind(mL) === ExprKind.RealLiteral && dae.getExprRealValue(mL) === 2.0) ||
            (dae.getExprKind(mL) === ExprKind.IntLiteral && dae.getExprData1(mL) === 2);
          if (isTwo && dae.getExprKind(mR) === ExprKind.Call && dae.getExprRight(mR) === 1) {
            const fn1 = dae.interner.resolve(dae.getExprData1(mR));
            const fn2 = dae.interner.resolve(dae.getExprData1(rightId));
            const arg1 = dae.getExprLeft(mR);
            const arg2 = dae.getExprLeft(rightId);
            if (
              ((fn1 === "sin" && fn2 === "cos") || (fn1 === "cos" && fn2 === "sin")) &&
              areExpressionsEqual(dae, arg1, arg2)
            ) {
              return dae.addCallExpr("sin", [dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(2.0), arg1)]);
            }
          }
        }
        const leftKind = dae.getExprKind(leftId);
        const rightKind = dae.getExprKind(rightId);
        const isLeftLit = leftKind === ExprKind.IntLiteral || leftKind === ExprKind.RealLiteral;
        const isRightLit = rightKind === ExprKind.IntLiteral || rightKind === ExprKind.RealLiteral;
        if (
          Boolean(dae.extensionMetadata?.["isOldFrontend"]) &&
          isLeftLit &&
          (rightKind === ExprKind.Negate ||
            (rightKind === ExprKind.Unary && (dae.getExprData1(rightId) as UnaryOp) === UnaryOp.Negate))
        ) {
          const lVal = leftKind === ExprKind.RealLiteral ? dae.getExprRealValue(leftId) : dae.getExprData1(leftId);
          leftId = leftKind === ExprKind.RealLiteral ? dae.addRealLiteral(-lVal) : dae.addIntLiteral(-lVal);
          rightId = dae.getExprLeft(rightId);
        } else if (
          Boolean(dae.extensionMetadata?.["isOldFrontend"]) &&
          isRightLit &&
          (leftKind === ExprKind.Negate ||
            (leftKind === ExprKind.Unary && (dae.getExprData1(leftId) as UnaryOp) === UnaryOp.Negate))
        ) {
          const rVal = rightKind === ExprKind.RealLiteral ? dae.getExprRealValue(rightId) : dae.getExprData1(rightId);
          const innerL = dae.getExprLeft(leftId);
          leftId = rightKind === ExprKind.RealLiteral ? dae.addRealLiteral(-rVal) : dae.addIntLiteral(-rVal);
          rightId = innerL;
        } else if (
          Boolean(dae.extensionMetadata?.["isOldFrontend"]) &&
          dae.classKind === "function" &&
          isLeftLit &&
          rightKind === ExprKind.Binary &&
          dae.getExprData1(rightId) === BinOp.Div
        ) {
          return mulWithSimplification(leftId, rightId, dae);
        } else if (
          Boolean(dae.extensionMetadata?.["isOldFrontend"]) &&
          dae.classKind === "function" &&
          leftKind === ExprKind.Binary &&
          dae.getExprData1(leftId) === BinOp.Div &&
          ((rightKind === ExprKind.Binary && dae.getExprData1(rightId) === BinOp.Div) ||
            extractLeadingMulLiteral(rightId) !== null ||
            (() => {
              let num = dae.getExprLeft(leftId);
              while (dae.getExprKind(num) === ExprKind.Binary && dae.getExprData1(num) === BinOp.Div) {
                num = dae.getExprLeft(num);
              }
              return (
                dae.getExprKind(num) === ExprKind.RealLiteral ||
                dae.getExprKind(num) === ExprKind.IntLiteral ||
                extractLeadingMulLiteral(num) !== null
              );
            })())
        ) {
          return mulWithSimplification(leftId, rightId, dae);
        } else if (
          (isLeftLit && extractLeadingMulLiteral(rightId) !== null) ||
          (isRightLit && extractLeadingMulLiteral(leftId) !== null)
        ) {
          return mulWithSimplification(leftId, rightId, dae);
        } else if (
          !isLeftLit &&
          isRightLit &&
          !(leftKind === ExprKind.Binary && dae.getExprData1(leftId) === BinOp.Div)
        ) {
          [leftId, rightId] = [rightId, leftId];
        }
      }
      if (
        binOp === BinOp.Eq ||
        binOp === BinOp.Neq ||
        binOp === BinOp.Lt ||
        binOp === BinOp.Lte ||
        binOp === BinOp.Gt ||
        binOp === BinOp.Gte
      ) {
        const lKind = dae.getExprKind(leftId);
        const rKind = dae.getExprKind(rightId);
        if (lKind === ExprKind.StringLiteral && rKind === ExprKind.StringLiteral) {
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
        if (
          dae.classKind !== "function" &&
          (lKind === ExprKind.IntLiteral || lKind === ExprKind.RealLiteral) &&
          (rKind === ExprKind.IntLiteral || rKind === ExprKind.RealLiteral)
        ) {
          const n1 = lKind === ExprKind.IntLiteral ? dae.getExprData1(leftId) : dae.getExprRealValue(leftId);
          const n2 = rKind === ExprKind.IntLiteral ? dae.getExprData1(rightId) : dae.getExprRealValue(rightId);
          let res: boolean;
          switch (binOp) {
            case BinOp.Eq:
              res = n1 === n2;
              break;
            case BinOp.Neq:
              res = n1 !== n2;
              break;
            case BinOp.Lt:
              res = n1 < n2;
              break;
            case BinOp.Lte:
              res = n1 <= n2;
              break;
            case BinOp.Gt:
              res = n1 > n2;
              break;
            case BinOp.Gte:
              res = n1 >= n2;
              break;
            default:
              res = false;
          }
          return dae.addBoolLiteral(res);
        }
      }
      if ((binOp === BinOp.And || binOp === BinOp.Or) && dae.classKind !== "function") {
        const lKind = dae.getExprKind(leftId);
        const rKind = dae.getExprKind(rightId);
        if (lKind === ExprKind.BoolLiteral && rKind === ExprKind.BoolLiteral) {
          const lBool = dae.getExprData1(leftId) === 1;
          const rBool = dae.getExprData1(rightId) === 1;
          return dae.addBoolLiteral(binOp === BinOp.And ? lBool && rBool : lBool || rBool);
        }
      }
      return dae.addBinaryExpr(binOp, leftId, rightId);
    }
  }

  // Unary expression: -expr or +expr or not expr
  if (node.childCount === 2) {
    const rawOp = node.child(0)?.text?.trim() ?? node.child(0)?.type ?? "";
    const op = rawOp.replace(/^"|"$/g, "");
    if (op === "-" || op === "-.") {
      const operandId = lowerCSTExpression(node.child(1), dae, prefix, substitutions, imports, db, flattener);
      if (db && flattener) {
        const dispatched = dispatchUnaryOperator("'-'", operandId, node.child(1), dae, db, flattener);
        if (dispatched !== null) return dispatched;
      }
      return negateExpr(operandId, dae);
    }

    if (op === "+" || op === "+.") {
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

  /**
   * Attempts to lower a partially subscripted hierarchical component reference (e.g., `arr.field`
   * or `arr[1].subArr`) into either an explicit nested `ArrayCtor` tree or a synthetic nested
   * `array(... for $i in 1:N)` comprehension across all unsubscripted (sliced) dimensions.
   */
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

        const fnSymId = flattener?.currentFlatteningFunctionId ?? (dae as any)?.symId;
        if (fnSymId) {
          const children = (db.childrenOf(fnSymId) || [])
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
        const vIdx =
          dae.getVarIdxByName(part.ident) >= 0 ? dae.getVarIdxByName(part.ident) : dae.lookupVariable(part.ident);
        if (!compSym && vIdx < 0) {
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
          const typeName = compInst?.typeSpecifier ?? (vIdx >= 0 ? dae.getVarCustomType(vIdx) : null);
          if (typeName) {
            const leafTypeName = typeName.includes(".") ? typeName.split(".").pop()! : typeName;
            const syms = db.byName(leafTypeName);
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
          const leafTypeName = childInst.typeSpecifier.includes(".")
            ? childInst.typeSpecifier.split(".").pop()!
            : childInst.typeSpecifier;
          const syms = db.byName(leafTypeName);
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

    if (
      allSlicedDims.length >= 1 &&
      partInfos.slice(0, -1).every((p) => p.slicedDims.length === 0) &&
      !rawParts.some((p) => p.hasSubscripts)
    ) {
      const basePrefixStr = partInfos
        .slice(0, -1)
        .map((p) => p.ident)
        .join(".");
      const leafIdent = partInfos[partInfos.length - 1]!.ident;
      const buildCtor = (depth: number, idxs: number[]): number => {
        const dimSize = allSlicedDims[depth]!;
        const elemIds: number[] = [];
        for (let idx = 1; idx <= dimSize; idx++) {
          const nextIdxs = [...idxs, idx];
          if (depth === allSlicedDims.length - 1) {
            elemIds.push(dae.addNameExpr(`${basePrefixStr}.${leafIdent}[${nextIdxs.join(",")}]`));
          } else {
            elemIds.push(buildCtor(depth + 1, nextIdxs));
          }
        }
        return dae.addArrayCtorExpr(elemIds);
      };
      return { exprId: buildCtor(0, []), shape: allSlicedDims };
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

  // ============================================================================
  // Identifier, Name & Multi-Dimensional Component Reference Lowering
  // ============================================================================
  // Identifier / Name / Component Reference
  if (
    type === "identifier" ||
    type === "name" ||
    type === "component_reference" ||
    (node.childCount === 0 && /^[a-zA-Z_]\w*$/.test(node.text?.trim() ?? ""))
  ) {
    let rawName = node.text.trim();
    // 1. Check active loop/comprehension/function-inlining substitution bindings first
    if (substitutions && substitutions.has(rawName)) {
      const sVal = substitutions.get(rawName)!;
      if (typeof sVal === "number") {
        return dae.addIntLiteral(sVal);
      }
      if (typeof sVal === "string" && sVal.startsWith("expr:")) {
        return Number(sVal.slice(5));
      }
      if (sVal === "true" || sVal === "false") {
        return dae.addExpression(ExprKind.BoolLiteral, sVal === "true" ? 1 : 0);
      }
      if (typeof sVal === "string" && sVal.includes(".")) {
        const lastDot = sVal.lastIndexOf(".");
        const pfx = sVal.slice(0, lastDot);
        const lit = sVal.slice(lastDot + 1);
        const scopeId =
          flattener?.currentClassId ?? flattener?.currentRootClassId ?? getFlatteningState(dae).currentClassId;
        const enumInfo = resolveEnumType(pfx, scopeId, db);
        if (enumInfo) {
          const idx = enumInfo.literals.indexOf(lit);
          if (idx >= 0) {
            let qual = enumInfo.qual;
            const rootName =
              (flattener?.currentRootClassId && db ? db.symbol(flattener.currentRootClassId)?.name : "") ||
              (dae as any).className;
            if (!dae.extensionMetadata?.["isOldFrontend"] && rootName && qual.startsWith(`${rootName}.`)) {
              qual = qual.slice(rootName.length + 1);
            }
            return dae.addEnumLiteral(idx + 1, `${qual}.${lit}`);
          }
        }
      }
      return dae.addExpression(ExprKind.Name, dae.interner.intern(sVal));
    }
    if (flattener?.activeLoopVars?.has(rawName)) {
      return dae.addExpression(ExprKind.Name, dae.interner.intern(rawName));
    }

    // 2. Decompose structured `component_reference` CST into dot-separated segments (`rawParts`),
    //    evaluating each subscript as a scalar index, `:` slice, `1:N` range, vector index, or boolean mask.
    if (type === "component_reference") {
      interface RawPartSubscript {
        node: any;
        text: string;
        isSlice: boolean;
        values: number[];
        scalarText?: string | undefined;
        isRealSub?: boolean | undefined;
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
                          !dae.extensionMetadata?.["isOldFrontend"] &&
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
              const needsDimSize = subText === ":" || /\bend\b/.test(subText);
              const fullIdent = needsDimSize ? rawParts.map((p) => p.ident).join(".") : "";
              const fullIdentWithSubs = needsDimSize
                ? rawParts
                    .map((p, pIdx) => {
                      if (pIdx < rawParts.length - 1 && p.subscripts.length > 0) {
                        const subIdx = p.subscripts
                          .map((s) => (s.values && s.values.length > 0 ? s.values[0] : 1))
                          .join(",");
                        return `${p.ident}[${subIdx}]`;
                      }
                      return p.ident;
                    })
                    .join(".")
                : "";
              const dimSize = needsDimSize
                ? (fullIdentWithSubs !== fullIdent ? getDaeDimSize(prefix, fullIdentWithSubs, dimIdx, dae, db) : 0) ||
                  getDaeDimSize(prefix, fullIdent, dimIdx, dae, db) ||
                  getDaeDimSize(prefix, lastPart.ident, dimIdx, dae, db)
                : 0;
              let subsWithEnd: Map<string, number | string> | undefined = substitutions;
              if (dimSize > 0) {
                subsWithEnd = new Map<string, number | string>(substitutions ? (substitutions as any) : []);
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
                  if (isNaN(iv)) {
                    const ev =
                      evaluateCSTNumber(it, subsWithEnd as any, undefined, db, dae, prefix) ??
                      evalArithmeticText(it, subsWithEnd as any);
                    if (ev !== null) iv = ev;
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
                  if (c0 && c0.childCount === 3 && (c0.child(1)?.text?.trim() ?? "") === ":") {
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
                  const arithVal = evalArithmeticText(t, subsWithEnd as any);
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
              const isBoolLiteralSub = subText === "false" || subText === "true";
              const evaluatedNum =
                isLoopVar || isRealSub || isBoolLiteralSub
                  ? null
                  : (evaluateCSTNumber(expr, subsWithEnd as any, undefined, undefined, dae, prefix) ??
                    evalArithmeticText(subText, subsWithEnd as any));
              if (evaluatedNum !== null) {
                if (db && !isLoopVar) {
                  const classId = flattener?.currentClassId ?? flattener?.currentRootClassId;
                  const resolver = classId
                    ? db.query<(n: string) => SymbolEntry | null>("resolveSimpleName", classId)
                    : null;
                  const compSym = resolver ? resolver(lastPart.ident) : null;
                  if (compSym && classId) {
                    const enumInfo = getCompDeclSubEnumInfo(compSym, dimIdx, classId, db);
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
                      const simpleName = enumInfo.qual.includes(".") ? enumInfo.qual.split(".").pop()! : enumInfo.qual;
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
                    if (compSym && classId) {
                      const enumInfo = getCompDeclSubEnumInfo(compSym, dimIdx, classId, db);
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
                  if (subType === VarType.Real && !isLoopVar) {
                    isRealSub = true;
                  }
                  let numVal: number | null = null;
                  let enumLiteralText: string | null = null;
                  if (dae.getExprKind(subId) === ExprKind.EnumLiteral && !isLoopVar) {
                    numVal = dae.getExprData1(subId);
                    enumLiteralText = dae.interner.resolve(dae.getExprLeft(subId));
                  } else if (dae.getExprKind(subId) === ExprKind.BoolLiteral && !isLoopVar) {
                    numVal = dae.getExprData1(subId) ? 2 : 1;
                    enumLiteralText = dae.getExprData1(subId) ? "true" : "false";
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
                  state.modelName ??
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
            getDaeArrayDimCount(prefix, fullIdent, dae, db) ??
            (pi === 0 ? getDaeArrayDimCount(prefix, p.ident, dae, db) : null);

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
                  ? enumMatch[1]!.split(",").map((s: string) => s.trim().split(/\s+/)[0])
                  : Array.isArray(candidate.metadata?.["literals"])
                    ? candidate.metadata["literals"]
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
                  const targetRefStr = isConnect ? refStr : rawParts[pi]!.ident;
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
            const subStrs = p.subscripts.map(
              (s) => s.scalarText ?? (s.values[0] !== undefined ? String(s.values[0]) : s.text),
            );
            const delim = (dae.extensionMetadata as any)?.isOldFrontend ? "," : ", ";
            const rawRefText = node?.text?.trim();
            const refStr = (dae.extensionMetadata as any)?.isOldFrontend
              ? rawParts
                  .map((x, idx) =>
                    idx === pi
                      ? `${x.ident}[${subStrs.join(delim)}]`
                      : x.hasSubscripts
                        ? `${x.ident}[${x.subscripts.map((s) => s.scalarText ?? (s.values[0] !== undefined ? String(s.values[0]) : s.text)).join(delim)}]`
                        : x.ident,
                  )
                  .join(".")
              : rawRefText && rawRefText.startsWith(rawParts[0]?.ident ?? "")
                ? rawRefText
                : rawParts
                    .map((x, idx) =>
                      idx === pi
                        ? `${x.ident}[${subStrs.join(delim)}]`
                        : x.hasSubscripts
                          ? `${x.ident}[${x.subscripts.map((s) => s.scalarText ?? (s.values[0] !== undefined ? String(s.values[0]) : s.text)).join(delim)}]`
                          : x.ident,
                    )
                    .join(".");
            const actualCount =
              pi < rawParts.length - 1 ? rawParts[rawParts.length - 1]!.subscripts.length : p.subscripts.length;
            dae.diagnostics.push({
              severity: "error",
              code: ModelicaErrorCode.ARRAY_SUBSCRIPT_COUNT_MISMATCH.code,
              message: ModelicaErrorCode.ARRAY_SUBSCRIPT_COUNT_MISMATCH.message(refStr, actualCount, expectedDimCount),
              range: r,
            });
            if (flattener?.options?.omcCompatibility && (dae.extensionMetadata as any)?.isOldFrontend) {
              const scopeName = flattener?.currentRootClassId
                ? (flattener.db.symbol(flattener.currentRootClassId)?.name ?? "")
                : "";
              dae.diagnostics.push({
                severity: "error",
                code: ModelicaErrorCode.VARIABLE_NOT_FOUND.code,
                message: ModelicaErrorCode.VARIABLE_NOT_FOUND.message(refStr, scopeName),
                range: r,
              });
            }
            return -1;
          }
        }
      }

      if (!isAssignmentLhs && rawParts.length > 0 && rawParts[0]!.hasSubscripts) {
        const baseName = resolveScopedName(rawParts[0]!.ident, prefix, dae, state.innerOuterComponents);
        const baseShape = getNamedArrayShape(dae, baseName);
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

      if (!isAssignmentLhs && rawParts.length >= 2 && (state.inAlgorithmSection || dae.classKind === "function")) {
        const slicedRes = tryLowerSlicedCref(rawParts, dae, prefix, db, flattener);
        if (slicedRes) {
          state.lastLoweredShape = slicedRes.shape;
          return slicedRes.exprId;
        }
      }

      const hasSlice = rawParts.some((p) => p.subscripts.some((s) => s.isSlice));
      if (hasSlice) {
        if (isAssignmentLhs && rawParts.length === 1) {
          const p = rawParts[0]!;
          const baseName = resolveScopedName(p.ident, prefix, dae, state.innerOuterComponents);
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
          const candidate = resolveScopedName(concreteName, prefix, dae, state.innerOuterComponents);
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
            if (exprId !== undefined && exprId >= 0) {
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
            const pkgScopeId = flattener?.currentParentMods?.packageScopeId;
            const scopeId = flattener?.currentClassId ?? flattener?.currentRootClassId;
            const constRes =
              (pkgScopeId ? lookupDbConstant(baseName, db, pkgScopeId) : null) ??
              lookupDbConstant(baseName, db, scopeId);
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
              if (typeof val === "string") {
                return dae.addStringLiteral(val);
              }
              if (typeof val === "number") {
                if (constRes.isBoolean) return dae.addBoolLiteral(val !== 0);
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
        if (imports && imports.has(parts[0]!)) {
          joined = [imports.get(parts[0]!)!, ...parts.slice(1)].join(".");
        }
        let candidate = resolveScopedName(joined, prefix, dae, state.innerOuterComponents, true);
        if (
          (rawParts.length >= 2 || (flattener?.activeLoopVars && flattener.activeLoopVars.size > 0)) &&
          rawParts.some((p) => p.hasSubscripts) &&
          dae.getVarIdxByName(candidate) < 0
        ) {
          const soaIdents = rawParts.map((p) => {
            let pIdent = p.ident;
            if (substitutions && substitutions.has(p.ident)) {
              const s = substitutions.get(p.ident);
              if (typeof s === "string") pIdent = s;
            }
            return pIdent;
          });
          let soaJoined = soaIdents.join(".");
          if (imports && imports.has(soaIdents[0]!)) {
            soaJoined = [imports.get(soaIdents[0]!)!, ...soaIdents.slice(1)].join(".");
          }
          const soaCandidate = resolveScopedName(soaJoined, prefix, dae, state.innerOuterComponents, true);
          const soaVarIdx = dae.getVarIdxByName(soaCandidate);
          if (soaVarIdx >= 0 && (dae.getVarShape(soaVarIdx)?.length ?? 0) > 0) {
            const combinedSubExprs: number[] = [];
            for (const p of rawParts) {
              if (p.hasSubscripts) {
                for (const s of p.subscripts) {
                  if (s.text === ":") {
                    combinedSubExprs.push(dae.addColonExpr());
                  } else if (s.node) {
                    const exprNode = s.node.children?.find((k: any) => k.type === "expression") ?? s.node;
                    const eId = lowerCSTExpression(exprNode, dae, prefix, substitutions, imports, db, flattener);
                    if (eId >= 0) {
                      combinedSubExprs.push(eId);
                    } else if (s.values.length === 1) {
                      combinedSubExprs.push(dae.addIntLiteral(s.values[0]!));
                    } else {
                      combinedSubExprs.push(
                        dae.addExpression(ExprKind.Name, dae.interner.intern(s.scalarText ?? s.text)),
                      );
                    }
                  } else if (s.values.length === 1) {
                    combinedSubExprs.push(dae.addIntLiteral(s.values[0]!));
                  } else {
                    combinedSubExprs.push(
                      dae.addExpression(ExprKind.Name, dae.interner.intern(s.scalarText ?? s.text)),
                    );
                  }
                }
              }
            }
            if (combinedSubExprs.length > 0) {
              const baseExprId = dae.addExpression(ExprKind.Name, dae.interner.intern(soaCandidate));
              return dae.addSubscriptExpr(baseExprId, combinedSubExprs);
            }
          }
        }
        let vIdx = -1;
        if (!flattener?.activeLoopVars?.has(joined) && !flattener?.activeLoopVars?.has(parts[0])) {
          vIdx = dae.getVarIdxByName(candidate);
          if (vIdx < 0 && dae.classKind === "function" && (dae as any).componentPrefix) {
            let rootDae: any = dae;
            while (rootDae.parentDae) rootDae = rootDae.parentDae;
            const compCand = `${(dae as any).componentPrefix}.${candidate}`;
            const compVIdx = rootDae.getVarIdxByName(compCand);
            if (compVIdx >= 0 && rootDae.getVarVariability(compVIdx) === Variability.Constant) {
              const exprId = rootDae.getVarExpression(compVIdx);
              if (exprId >= 0) {
                const k = rootDae.getExprKind(exprId);
                if (k === ExprKind.RealLiteral) return dae.addRealLiteral(rootDae.getExprRealValue(exprId));
                if (k === ExprKind.IntLiteral) return dae.addIntLiteral(rootDae.getExprData1(exprId));
                if (k === ExprKind.BoolLiteral) return dae.addBoolLiteral(rootDae.getExprData1(exprId) !== 0);
              }
            }
          }
          if (vIdx >= 0) {
            if (dae.getVarVariability(vIdx) === Variability.Constant) {
              const exprId = dae.getVarExpression(vIdx);
              if (exprId !== undefined && exprId >= 0) {
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
          if (candidate.includes("[")) {
            const baseIdx = dae.getVarIdxByName(stripArraySubscripts(candidate));
            if (baseIdx >= 0 && dae.getVarVariability(baseIdx) !== Variability.Constant) {
              return dae.addExpression(ExprKind.Name, dae.interner.intern(candidate));
            }
          } else if (
            !isAssignmentLhs &&
            !noArrayExpand &&
            flattener?.options?.arrayMode !== "preserve" &&
            !(dae.classKind === "function" && flattener?.currentBindingCompName === candidate)
          ) {
            const ctor = expandVarToArrayCtor(candidate, dae);
            if (ctor !== null) return ctor;
          }
        } else {
          return dae.addExpression(ExprKind.Name, dae.interner.intern(candidate));
        }
        if (db) {
          const pkgScopeId = flattener?.currentParentMods?.packageScopeId;
          const scopeId =
            (dae as any).enclosingScopeId ??
            flattener?.currentClassId ??
            flattener?.currentFlatteningFunctionId ??
            flattener?.currentRootClassId;
          const rootScopeId = flattener?.currentRootClassId;
          const pkgRedeclForConst =
            parts.length >= 2
              ? flattener?.currentParentMods?.args?.findLast
                ? flattener.currentParentMods.args.findLast(
                    (a: any) =>
                      !a.isBreak &&
                      a.name === parts[0] &&
                      (a.isRedeclaration || a.redeclaredTypeSpecifier) &&
                      a.redeclaredTypeSpecifier,
                  )
                : flattener?.currentParentMods?.args?.find(
                    (a: any) =>
                      !a.isBreak &&
                      a.name === parts[0] &&
                      (a.isRedeclaration || a.redeclaredTypeSpecifier) &&
                      a.redeclaredTypeSpecifier,
                  )
              : null;
          const redeclJoined = pkgRedeclForConst?.redeclaredTypeSpecifier
            ? [String(pkgRedeclForConst.redeclaredTypeSpecifier).replace(/^\.+/, ""), ...parts.slice(1)].join(".")
            : null;
          const redeclScopeId = pkgRedeclForConst?.evaluationScopeId ?? pkgRedeclForConst?.ownerClassId ?? scopeId;
          const constRes =
            (redeclJoined
              ? (lookupDbConstant(redeclJoined, db, redeclScopeId) ??
                (rootScopeId && rootScopeId !== redeclScopeId ? lookupDbConstant(redeclJoined, db, rootScopeId) : null))
              : null) ??
            (pkgScopeId && pkgScopeId !== scopeId
              ? (lookupDbConstant(candidate, db, pkgScopeId) ?? lookupDbConstant(joined, db, pkgScopeId))
              : null) ??
            lookupDbConstant(candidate, db, scopeId) ??
            lookupDbConstant(joined, db, scopeId) ??
            (rootScopeId && rootScopeId !== scopeId
              ? (lookupDbConstant(candidate, db, rootScopeId) ?? lookupDbConstant(joined, db, rootScopeId))
              : null);
          if (constRes !== null && !(Array.isArray(constRes.value) && constRes.value.length === 0)) {
            if (
              dae.extensionMetadata?.["isOldFrontend"] &&
              flattener &&
              (candidate.endsWith("Constants.pi") || joined.endsWith("Constants.pi")) &&
              !dae.functions.has("Modelica.Math.asin")
            ) {
              const asinSyms = db.byName("asin").filter((s) => s.kind === "Function" || flattener.isFunctionSym?.(s));
              for (const asinSym of asinSyms) {
                const cstText = (db.cstNode(asinSym.id) as any)?.text ?? "";
                if (cstText.includes('external "C"')) {
                  const fnDae = flattener.flattenFunction(asinSym.id, "Modelica.Math.asin", undefined, dae);
                  if (fnDae) {
                    (fnDae as any).wasCalled = true;
                    dae.addFunction("Modelica.Math.asin", fnDae);
                  }
                  break;
                }
              }
            }
            if (Array.isArray(constRes.value)) {
              const elemIds = constRes.value.map((v: any) =>
                typeof v === "string"
                  ? dae.addStringLiteral(v)
                  : constRes.isBoolean
                    ? dae.addBoolLiteral(v !== 0)
                    : constRes.isInteger
                      ? dae.addIntLiteral(v)
                      : dae.addRealLiteral(v),
              );
              return dae.addArrayCtorExpr(elemIds);
            }
            if (typeof constRes.value === "string") {
              return dae.addStringLiteral(constRes.value);
            }
            if (constRes.isBoolean) {
              return dae.addBoolLiteral(constRes.value !== 0);
            }
            return constRes.isInteger
              ? dae.addIntLiteral(Math.round(constRes.value))
              : dae.addRealLiteral(constRes.value);
          }
        }
        if (vIdx < 0 && parts.length >= 2 && db) {
          const curClsId =
            flattener?.currentClassId ?? flattener?.currentFlatteningFunctionId ?? flattener?.currentRootClassId;
          const isLocalComp = (() => {
            const pfx = `${candidate}.`;
            const pfx0 = prefix ? `${prefix}.${parts[0]}.` : `${parts[0]}.`;
            for (let vi = 0; vi < dae.varCount; vi++) {
              if (dae.isVarRemoved(vi)) continue;
              const vn = dae.getVarName(vi);
              if (vn.startsWith(pfx) || vn.startsWith(pfx0)) return true;
            }
            if (curClsId && db.childrenOf(curClsId).some((c) => c.kind === "Component" && c.name === parts[0])) {
              return true;
            }
            return false;
          })();
          const pkgRedeclForClass = !isLocalComp
            ? flattener?.currentParentMods?.args?.findLast
              ? flattener.currentParentMods.args.findLast(
                  (a: any) =>
                    !a.isBreak &&
                    a.name === parts[0] &&
                    (a.isRedeclaration || a.redeclaredTypeSpecifier) &&
                    a.redeclaredTypeSpecifier,
                )
              : flattener?.currentParentMods?.args?.find(
                  (a: any) =>
                    !a.isBreak &&
                    a.name === parts[0] &&
                    (a.isRedeclaration || a.redeclaredTypeSpecifier) &&
                    a.redeclaredTypeSpecifier,
                )
            : null;
          const firstPart = pkgRedeclForClass?.redeclaredTypeSpecifier
            ? String(pkgRedeclForClass.redeclaredTypeSpecifier).replace(/^\.+/, "")
            : imports && imports.has(parts[0]!)
              ? imports.get(parts[0]!)!
              : parts[0]!;
          const pkgLookupScopeId = pkgRedeclForClass?.evaluationScopeId ?? pkgRedeclForClass?.ownerClassId ?? curClsId;
          const pkgOrClass = isLocalComp
            ? undefined
            : ((pkgLookupScopeId
                ? (() => {
                    const res =
                      db.query<(n: string) => SymbolEntry | null>("resolveSimpleName", pkgLookupScopeId)?.(firstPart) ??
                      db.query<(n: string) => SymbolEntry | null>("resolveName", pkgLookupScopeId)?.(firstPart);
                    return res && (res.kind === "Class" || res.kind === "Package") ? res : undefined;
                  })()
                : undefined) ??
              (flattener?.currentRootClassId
                ? (() => {
                    const res = db.query<(n: string) => SymbolEntry | null>(
                      "resolveName",
                      flattener.currentRootClassId,
                    )?.(firstPart);
                    return res && (res.kind === "Class" || res.kind === "Package") ? res : undefined;
                  })()
                : undefined) ??
              db.byName(firstPart.split(".").pop()!).find((e) => e.kind === "Class" || e.kind === "Package"));
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
              let child: SymbolEntry | undefined = db.childrenOf(currSym.id).find((c) => c.name === parts[pi]);
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
                    if (
                      parts.length > pi + 1 &&
                      dae.diagnostics.some((d) => d.code === ModelicaErrorCode.PACKAGE_VARIABLE_NOT_CONSTANT.code)
                    ) {
                      return -1;
                    }
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
                      const repeatCount = parts.length > pi + 1 ? 2 : 1;
                      for (let rep = 0; rep < repeatCount; rep++) {
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
                        modArg?.evaluationScopeId ?? pkgOrClass.id ?? child.parentId ?? flattener.currentClassId;
                      const lowered = flattener.lowerExpr(exprNode, dae, "", substitutions);
                      flattener.currentClassId = prevClassId;
                      if (lowered >= 0) return lowered;
                    }
                  }
                }
                currSym = child;
              } else {
                const curScope = db.query<any>("scopeData", db.baseOf(currSym.id) ?? currSym.id);
                const part = parts[pi]!;
                const isImportedInCur =
                  Boolean(curScope?.qualifiedImports?.[part]) ||
                  Boolean(curScope?.compoundImports?.some((ci: any) => ci.names.includes(part))) ||
                  Boolean(
                    curScope?.unqualifiedImportPkgs?.some((pkg: string) => {
                      const pkgSym = db
                        .byName(pkg.split(".").pop()!)
                        ?.find((s) => s.kind === "Package" || s.kind === "Class");
                      return pkgSym ? db.childrenOf(pkgSym.id).some((c) => c.name === part) : false;
                    }),
                  );
                if (isImportedInCur && !flattener?.isOldFrontend && !dae.extensionMetadata?.["isOldFrontend"]) {
                  let stmtOrEqNode: any = node;
                  while (
                    stmtOrEqNode?.parent &&
                    stmtOrEqNode.type !== "component_clause" &&
                    stmtOrEqNode.type !== "some_equation" &&
                    stmtOrEqNode.type !== "simple_equation" &&
                    stmtOrEqNode.type !== "statement"
                  ) {
                    stmtOrEqNode = stmtOrEqNode.parent;
                  }
                  const errNode = stmtOrEqNode ?? node;
                  const rangeObj =
                    errNode.startIndex != null && errNode.endIndex != null
                      ? {
                          startByte: errNode.startIndex,
                          endByte: errNode.endIndex,
                          startPosition: errNode.startPosition,
                          endPosition: errNode.endPosition,
                        }
                      : undefined;
                  dae.diagnostics.push({
                    severity: "error",
                    code: ModelicaErrorCode.CLASS_NOT_FOUND_IN_SCOPE.code,
                    message: `Found imported name '${part}' while looking up composite name '${joined}'.`,
                    range: rangeObj,
                  });
                  return -1;
                }
                break;
              }
            }
          }
        }
        rawName = candidate;
      }
    }

    const ensureOldFrontendPiAsin = (constName: string) => {
      if (
        dae.extensionMetadata?.["isOldFrontend"] &&
        flattener &&
        db &&
        constName.endsWith("Constants.pi") &&
        !dae.functions.has("Modelica.Math.asin")
      ) {
        const asinSyms = db.byName("asin").filter((s) => s.kind === "Function" || flattener.isFunctionSym?.(s));
        for (const asinSym of asinSyms) {
          const cstText = (db.cstNode(asinSym.id) as any)?.text ?? "";
          if (cstText.includes('external "C"')) {
            const fnDae = flattener.flattenFunction(asinSym.id, "Modelica.Math.asin", undefined, dae);
            if (fnDae) {
              (fnDae as any).wasCalled = true;
              dae.addFunction("Modelica.Math.asin", fnDae);
            }
            break;
          }
        }
      }
    };

    if (imports && rawName.includes(".")) {
      const p = rawName.split(".");
      if (imports.has(p[0]!)) {
        const mapped = [imports.get(p[0]!)!, ...p.slice(1)].join(".");
        if (db) {
          const scopeId = flattener?.currentClassId ?? flattener?.currentRootClassId;
          const constRes = lookupDbConstant(mapped, db, scopeId);
          if (constRes !== null) {
            ensureOldFrontendPiAsin(mapped);
            if (Array.isArray(constRes.value)) {
              const elemIds = constRes.value.map((v: any) =>
                typeof v === "string"
                  ? dae.addStringLiteral(v)
                  : constRes.isBoolean
                    ? dae.addBoolLiteral(v !== 0)
                    : constRes.isInteger
                      ? dae.addIntLiteral(v)
                      : dae.addRealLiteral(v),
              );
              return dae.addArrayCtorExpr(elemIds);
            }
            if (typeof constRes.value === "string") {
              return dae.addStringLiteral(constRes.value);
            }
            if (constRes.isBoolean) {
              return dae.addBoolLiteral(constRes.value !== 0);
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
        ensureOldFrontendPiAsin(rawName);
        if (Array.isArray(constRes.value)) {
          const elemIds = constRes.value.map((v: any) =>
            typeof v === "string"
              ? dae.addStringLiteral(v)
              : constRes.isBoolean
                ? dae.addBoolLiteral(v !== 0)
                : constRes.isInteger
                  ? dae.addIntLiteral(v)
                  : dae.addRealLiteral(v),
          );
          return dae.addArrayCtorExpr(elemIds);
        }
        if (typeof constRes.value === "string") {
          return dae.addStringLiteral(constRes.value);
        }
        if (constRes.isBoolean) {
          return dae.addBoolLiteral(constRes.value !== 0);
        }
        return constRes.isInteger ? dae.addIntLiteral(Math.round(constRes.value)) : dae.addRealLiteral(constRes.value);
      }
    }

    if (db && rawName.includes(".")) {
      const dotIdx = rawName.lastIndexOf(".");
      const enumTypeName = rawName.slice(0, dotIdx);
      const litName = rawName.slice(dotIdx + 1);
      if (dae.extensionMetadata?.["isOldFrontend"] && flattener?.currentParentMods?.args) {
        const redeclArg = flattener.currentParentMods.args.find(
          (a: any) =>
            a.redeclare &&
            a.name === enumTypeName &&
            typeof a.redeclaredTypeSpecifier === "string" &&
            a.redeclaredTypeSpecifier.startsWith("enumeration("),
        );
        if (redeclArg) {
          const enumMatch = redeclArg.redeclaredTypeSpecifier.match(/enumeration\s*\(([^)]+)\)/);
          if (enumMatch?.[1]) {
            const redeclLits = enumMatch[1]
              .split(",")
              .map((p: string) => p.trim().split(/\s+/)[0]?.replace(/^'|'$/g, ""))
              .filter(Boolean);
            if (!redeclLits.includes(litName)) {
              const classFqn = flattener.currentClassId
                ? (getSymbolQualifiedName(db, flattener.currentClassId) ?? "")
                : "";
              const cleanPrefix = prefix.endsWith(".") ? prefix.slice(0, -1) : prefix;
              const scopeName = cleanPrefix ? `${classFqn}$${cleanPrefix}` : classFqn;
              let eqNode: any = node;
              while (
                eqNode?.parent &&
                eqNode.type !== "simple_equation" &&
                eqNode.type !== "equation" &&
                eqNode.type !== "statement"
              ) {
                eqNode = eqNode.parent;
              }
              const errRange = {
                startByte: eqNode?.startIndex ?? eqNode?.startByte ?? node.startIndex,
                endByte: eqNode?.endIndex ?? eqNode?.endByte ?? node.endIndex,
                startPosition: eqNode?.startPosition ?? node.startPosition,
                endPosition: eqNode?.endPosition ?? node.endPosition,
              };
              dae.diagnostics.push({
                severity: "error",
                code: ModelicaErrorCode.VARIABLE_NOT_FOUND.code,
                message: ModelicaErrorCode.VARIABLE_NOT_FOUND.message(rawName, scopeName),
                range: errRange,
              });
              let outerCompRef: any = node.parent;
              while (
                outerCompRef &&
                outerCompRef.type !== "component_reference" &&
                outerCompRef.type !== "primary" &&
                outerCompRef.type !== "simple_equation"
              ) {
                outerCompRef = outerCompRef.parent;
              }
              if (outerCompRef && (outerCompRef.type === "component_reference" || outerCompRef.type === "primary")) {
                const outerText = outerCompRef.text?.trim();
                if (outerText && outerText !== rawName) {
                  dae.diagnostics.push({
                    severity: "error",
                    code: ModelicaErrorCode.VARIABLE_NOT_FOUND.code,
                    message: ModelicaErrorCode.VARIABLE_NOT_FOUND.message(outerText, scopeName),
                    range: errRange,
                  });
                }
              }
              return -1;
            }
          }
        }
      }
      const scopeId = flattener?.currentClassId ?? flattener?.currentRootClassId ?? undefined;
      const resolvedEnum = resolveEnumType(enumTypeName, scopeId, db);
      if (resolvedEnum) {
        const idx = resolvedEnum.literals.indexOf(litName);
        if (idx >= 0) {
          return dae.addEnumLiteral(idx + 1, `${resolvedEnum.qual}.${litName}`);
        }
      }
      const leafTypeName = enumTypeName.includes(".") ? enumTypeName.split(".").pop()! : enumTypeName;
      const typeTargets = db.byName(leafTypeName);
      for (const candidate of typeTargets) {
        const baseCandidate = getBaseEnumSymbol(db, candidate) ?? candidate;
        const literals = getSymbolEnumLiterals(db, baseCandidate);
        if (literals) {
          const idx = literals.indexOf(litName);
          if (idx >= 0) {
            const pathParts: string[] = [baseCandidate.name, litName];
            let curr: SymbolEntry | null | undefined = baseCandidate.parentId
              ? db.symbol(baseCandidate.parentId)
              : null;
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

    rawName = resolveScopedName(rawName, prefix, dae, state.innerOuterComponents);

    // Check if rawName is an array variable like e, which has elements e[1] .. e[N] or multi-dim e[1,1] ..
    // Only expand if rawName is NOT already subscripted (does not contain '['), noArrayExpand is false, and not assignment LHS
    if (
      !isAssignmentLhs &&
      !noArrayExpand &&
      flattener?.options?.arrayMode !== "preserve" &&
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

      const isOldFrontend = Boolean(dae.extensionMetadata?.["isOldFrontend"]);
      if (!isOldFrontend) {
        const targetSym = db?.byName(outerErr.varName).find((s: any) => s.kind === "Component");
        const notifRange = targetSym && db ? getElementDiagRange(db.cstNode(targetSym.id)) : undefined;
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

  // Unwrap any remaining single-child CST wrapper node before raw-text fallback
  if (node.childCount === 1 && node.child(0) && (node.child(0)!.childCount > 0 || node.child(0)!.type !== node.type)) {
    return lowerCSTExpression(node.child(0), dae, ctx);
  }
  if (
    node.childCount === 3 &&
    (node.child(0)?.type === "(" || node.child(0)?.text?.trim() === "(") &&
    (node.child(2)?.type === ")" || node.child(2)?.text?.trim() === ")") &&
    node.child(1)
  ) {
    return lowerCSTExpression(node.child(1), dae, ctx);
  }

  // Fallback: treat raw text as Name (after checking structural array/range/unary/paren forms)
  let fallback = node.text ? node.text.trim() : "";
  if (fallback.startsWith("{") && fallback.endsWith("}")) {
    const items = getArrayLiteralItems(node);
    if (items.length > 0 || fallback.slice(1, -1).trim() === "") {
      const elemIds = items.map((it) => lowerCSTExpression(it, dae, ctx));
      if (elemIds.some((e) => isRealExpr(e, dae))) {
        for (let k = 0; k < elemIds.length; k++) {
          if (!isRealExpr(elemIds[k]!, dae)) {
            elemIds[k] = castToRealExpr(elemIds[k]!, dae);
          }
        }
      }
      return dae.addArrayCtorExpr(elemIds);
    }
  }
  if (fallback.includes(":") && !fallback.startsWith('"')) {
    const colonNodes = flattenColonNodes(node);
    if (colonNodes.length === 2 || colonNodes.length === 3) {
      const isForIndex = isInsideForIndex(node);
      const startId = lowerCSTExpression(colonNodes[0], dae, ctx);
      const stepId = colonNodes.length === 3 ? lowerCSTExpression(colonNodes[1], dae, ctx) : -1;
      const stopId = lowerCSTExpression(colonNodes[colonNodes.length - 1], dae, ctx);
      const isAnyReal = isRealExpr(startId, dae) || (stepId >= 0 && isRealExpr(stepId, dae)) || isRealExpr(stopId, dae);
      const effStartId = isAnyReal ? castToRealExpr(startId, dae) : startId;
      const effStepId = stepId >= 0 ? (isAnyReal ? castToRealExpr(stepId, dae) : stepId) : -1;
      const effStopId = isAnyReal ? castToRealExpr(stopId, dae) : stopId;
      const rangeId = dae.addExpression(ExprKind.Range, effStartId, effStepId, effStopId);
      const expanded = !isForIndex ? expandColonToArrayCtor(rangeId, dae) : null;
      return expanded !== null ? expanded : rangeId;
    }
  }
  if (fallback.startsWith("(") && fallback.endsWith(")")) {
    let depth = 0;
    let inQuotes = false;
    let quoteChar = "";
    let outerBalanced = true;
    for (let i = 0; i < fallback.length; i++) {
      const ch = fallback[i]!;
      if (inQuotes) {
        if (ch === "\\" && i + 1 < fallback.length) {
          i++;
          continue;
        }
        if (ch === quoteChar) inQuotes = false;
        continue;
      }
      if (ch === '"' || ch === "'") {
        inQuotes = true;
        quoteChar = ch;
        continue;
      }
      if (ch === "(" || ch === "[" || ch === "{") depth++;
      else if (ch === ")" || ch === "]" || ch === "}") {
        depth--;
        if (depth === 0 && i < fallback.length - 1) {
          outerBalanced = false;
          break;
        }
      }
    }
    if (outerBalanced && depth === 0) {
      const innerText = fallback.slice(1, -1).trim();
      if (flattener && typeof flattener.lowerStandaloneText === "function") {
        const lowered = flattener.lowerStandaloneText(innerText, dae, prefix, substitutions);
        if (typeof lowered === "number" && lowered >= 0) return lowered;
      }
      fallback = innerText;
    }
  }
  if ((fallback.startsWith("-") || fallback.startsWith("+")) && fallback.length > 1) {
    const isNeg = fallback.startsWith("-");
    if (node.childCount >= 2 && node.child(node.childCount - 1)) {
      const innerId = lowerCSTExpression(node.child(node.childCount - 1), dae, ctx);
      if (innerId >= 0) return isNeg ? negateExpr(innerId, dae) : innerId;
    }
    if (flattener && typeof flattener.lowerStandaloneText === "function") {
      const innerId = flattener.lowerStandaloneText(fallback.slice(1).trim(), dae, prefix, substitutions);
      if (typeof innerId === "number" && innerId >= 0) return isNeg ? negateExpr(innerId, dae) : innerId;
    }
  }
  if (substitutions && substitutions.has(fallback)) {
    const sVal = substitutions.get(fallback)!;
    if (typeof sVal === "number") return dae.addIntLiteral(sVal);
    if (typeof sVal === "string" && sVal.startsWith("expr:")) return Number(sVal.slice(5));
    if (sVal === "true" || sVal === "false") return dae.addExpression(ExprKind.BoolLiteral, sVal === "true" ? 1 : 0);
    if (typeof sVal === "string" && sVal.includes(".")) {
      const lastDot = sVal.lastIndexOf(".");
      const pfx = sVal.slice(0, lastDot);
      const lit = sVal.slice(lastDot + 1);
      const scopeId =
        flattener?.currentClassId ?? flattener?.currentRootClassId ?? getFlatteningState(dae).currentClassId;
      const enumInfo = resolveEnumType(pfx, scopeId, db);
      if (enumInfo) {
        const idx = enumInfo.literals.indexOf(lit);
        if (idx >= 0) {
          let qual = enumInfo.qual;
          const rootName =
            (flattener?.currentRootClassId && db ? db.symbol(flattener.currentRootClassId)?.name : "") ||
            (dae as any).className;
          if (!dae.extensionMetadata?.["isOldFrontend"] && rootName && qual.startsWith(`${rootName}.`)) {
            qual = qual.slice(rootName.length + 1);
          }
          return dae.addEnumLiteral(idx + 1, `${qual}.${lit}`);
        }
      }
    }
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
