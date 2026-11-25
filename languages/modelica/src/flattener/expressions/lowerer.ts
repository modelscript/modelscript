// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Modelica Flattener - Central Expression Router (lowerCSTExpression).
 *
 * Lowers linear memory parser CST expression nodes directly into DAEBuilder
 * arena expression IDs, performing constant evaluation, type coercion,
 * vectorization, operator records dispatching, and comprehension unfolding.
 */

import { BinOp, DAEBuilder, type QueryDB } from "@modelscript/runtime";
import { Cst, type SyntaxNode } from "../../../src-gen/bindings.js";
import { getFlatteningState } from "../support/state.js";
import type { FlattenerHostLike, LoweringContext } from "../types.js";
import { stripOuterDoubleQuotes } from "./cst-utils.js";
import { finishBinaryCSTExpression, lowerUnaryCSTExpression } from "./lowering/binary-and-unary.js";
import { lowerSpecialBuiltinCSTExpression } from "./lowering/builtin-calls.js";
import { lowerComponentRefCSTExpression } from "./lowering/component-refs.js";
import { lowerFunctionCallCSTExpression } from "./lowering/function-calls.js";
import { lowerIfElseCSTExpression, lowerRangeCSTExpression } from "./lowering/if-and-range.js";
import {
  lowerFallbackCSTExpression,
  lowerLiteralCSTExpression,
  lowerParenOrArrayCSTExpression,
} from "./lowering/literals-and-arrays.js";
import { lowerNonCrefSubscriptExpression } from "./lowering/subscripts-and-slices.js";

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
  flattener?: FlattenerHostLike,
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
  posFlattener?: FlattenerHostLike,
  posTupleContext?: boolean,
  posNoArrayExpand?: boolean,
  posIsAssignmentLhs?: boolean,
): number {
  if (!node) return -1;
  let prefix = "";
  let substitutions: Map<string, number | string> | undefined;
  let imports: Map<string, string> | undefined;
  let db: QueryDB | undefined;
  let flattener: FlattenerHostLike | undefined;
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

  // Single-child unwrap for wrappers and parenthesized expressions "( expr )"
  while (node) {
    const t = node.type;
    if (
      (t === "expression" ||
        t === "lhs_expression" ||
        t === "lhs_primary" ||
        t === "simple_expression" ||
        t === "logical_expression" ||
        t === "primary" ||
        t === "expression_list" ||
        t === "Expression" ||
        t === "SimpleExpression" ||
        t === "LogicalExpression" ||
        t === "Primary" ||
        t === "ExpressionList") &&
      node.childCount === 1
    ) {
      node = node.child(0);
      continue;
    }
    if (node.childCount === 3 && Cst.kind(node.child(0)) === "(" && Cst.kind(node.child(2)) === ")") {
      node = node.child(1);
      continue;
    }
    break;
  }
  if (!node) return -1;

  const state = getFlatteningState(dae, flattener);

  const litRes = lowerLiteralCSTExpression(node, dae);
  if (litRes !== null) return litRes;

  const firstChildToken = stripOuterDoubleQuotes(node.child(0)?.text?.trim() ?? node.child(0)?.type ?? "");

  const specialRes = lowerSpecialBuiltinCSTExpression(node, firstChildToken, dae, ctx, lowerCSTExpression);
  if (specialRes !== null) return specialRes;

  const callRes = lowerFunctionCallCSTExpression(node, dae, ctx, state, lowerCSTExpression);
  if (callRes !== null) return callRes;

  const subRes = lowerNonCrefSubscriptExpression(node, dae, ctx, lowerCSTExpression);
  if (subRes !== null) return subRes;

  const parenArrRes = lowerParenOrArrayCSTExpression(node, dae, ctx, lowerCSTExpression);
  if (parenArrRes !== null) return parenArrRes;

  const rangeRes = lowerRangeCSTExpression(node, dae, ctx, lowerCSTExpression);
  if (rangeRes !== null) return rangeRes;

  const ifRes = lowerIfElseCSTExpression(node, firstChildToken, dae, ctx, lowerCSTExpression);
  if (ifRes !== null) return ifRes;

  // Binary expression: left op right
  if (node.childCount === 3) {
    const rawOp = node.child(1)?.text?.trim() ?? node.child(1)?.type ?? "";
    const opToken = stripOuterDoubleQuotes(rawOp);
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
      const leftId = lowerCSTExpression(leftNode, dae, ctx);
      const rightId = lowerCSTExpression(rightNode, dae, ctx);
      return finishBinaryCSTExpression(node, binOp, opToken, leftNode, rightNode, leftId, rightId, dae, ctx);
    }
  }

  const unaryRes = lowerUnaryCSTExpression(node, dae, ctx, lowerCSTExpression);
  if (unaryRes !== null) return unaryRes;

  const crefRes = lowerComponentRefCSTExpression(node, dae, ctx, state, lowerCSTExpression);
  if (crefRes !== null) return crefRes;

  return lowerFallbackCSTExpression(node, dae, ctx, lowerCSTExpression);
}
