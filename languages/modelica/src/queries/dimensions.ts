// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Modelica Array Dimension Expression Evaluator (for `resolvedArrayDimensions` Salsa queries).
 */

import type { QueryDB, SymbolEntry, SymbolId } from "@modelscript/runtime";
import { Cst } from "../../src-gen/bindings.js";
import type { CstNodeLike } from "../flattener/expressions/cst-utils.js";
import {
  getShortClassSpecifierNode,
  hasEnumTypeText,
  isAsciiIdentStr,
  parseEnumLiteralsFromText,
  stripOuterChar,
} from "./cst-helpers.js";
import {
  asSyntaxNode,
  getSymbolMeta,
  type ArrayDimensionDescriptor,
  type DimEvalResult,
  type QueryCstNode,
} from "./types.js";

/**
 * Evaluate a dimension expression to a concrete integer value.
 *
 * Walks the CST node for the expression and evaluates it in the Salsa
 * query context. Supports:
 *   - Integer literals
 *   - Name references to parameters/constants (reads their binding value via `resolvedDimParamValue`)
 *   - size(x, d) calls → recursively queries `resolvedArrayDimensionAt` (cycle-safe)
 *   - Basic arithmetic (+, -, *, integer(), ndims())
 *   - Enumeration type references (returns literal count)
 */
export function evaluateDimExpr(
  db: QueryDB,
  self: SymbolEntry,
  dim: { kind: "expression"; cstBytes: readonly [number, number]; text?: string | undefined },
): DimEvalResult {
  const cst = db.cstNodeRange(dim.cstBytes[0], dim.cstBytes[1], self) as QueryCstNode | null;
  if (!cst) {
    if (dim.text) {
      const parsed = parseInt(dim.text, 10);
      if (!isNaN(parsed) && String(parsed) === dim.text.trim()) return { value: parsed };
    }
    return { value: null };
  }
  return evaluateDimCSTNode(db, self, cst);
}

/**
 * Extract argument CST nodes from a function call or primary node.
 */
export function extractFunctionCallArgNodes(node: QueryCstNode): QueryCstNode[] {
  const nodeSyntax = asSyntaxNode(node);
  const fca =
    node.type === "primary"
      ? node.child?.(1)
      : ((nodeSyntax ? Cst.FunctionCall.args(nodeSyntax) : null) ?? node.child?.(1));
  if (!fca) return [];
  const results: QueryCstNode[] = [];
  function collectExprs(n: QueryCstNode | null | undefined) {
    if (!n) return;
    if (n.type === "expression_list") {
      const count = n.childCount ?? 0;
      for (let i = 0; i < count; i++) {
        const c = n.child?.(i);
        if (c && c.type !== "," && c.text !== "," && c.type !== "(" && c.type !== ")") {
          results.push(c);
        }
      }
      return;
    }
    if (n.type === "expression" || n.type === "named_argument") {
      results.push(n);
      return;
    }
    const count = n.childCount ?? 0;
    for (let i = 0; i < count; i++) {
      const c = n.child?.(i);
      if (c && c.type !== "(" && c.type !== ")" && c.type !== "," && c.text !== ",") {
        collectExprs(c);
      }
    }
  }
  collectExprs(fca);
  return results.filter((a) => a && a.type !== "," && a.text !== ",");
}

/**
 * Recursively evaluate a CST node to an integer value in a Salsa context.
 */
export function evaluateDimCSTNode(
  db: QueryDB,
  self: SymbolEntry,
  node: QueryCstNode | null | undefined,
): DimEvalResult {
  if (!node) return { value: null };
  const type = node.type;

  if (
    (type === "expression" ||
      type === "simple_expression" ||
      type === "logical_expression" ||
      type === "primary" ||
      type === "expression_list" ||
      type === "Expression" ||
      type === "Primary" ||
      type === "subscript") &&
    node.childCount === 1
  ) {
    return evaluateDimCSTNode(db, self, node.child?.(0));
  }

  // Integer literal
  if (type === "UNSIGNED_INTEGER" || type === "unsigned_integer") {
    return { value: parseInt(node.text ?? "", 10) };
  }

  // Parenthesized expression — unwrap
  if (type === "ParenthesizedExpression" || (type === "primary" && node.child?.(0)?.text === "(")) {
    const inner =
      node.namedChildren?.find((c) => c.type !== "(" && c.type !== ")") ??
      node.children?.find((c) => c.type !== "(" && c.type !== ")");
    return evaluateDimCSTNode(db, self, inner);
  }

  // Binary expression (+, -, *, /)
  if (type === "BinaryExpression" || (node.childCount === 3 && node.type === "expression")) {
    const rawOp = (node.child?.(1)?.text ?? "").trim();
    const op = stripOuterChar(rawOp, '"');
    const leftRes = evaluateDimCSTNode(db, self, node.child?.(0));
    if (leftRes.cycleOrigin) return { value: null, cycleOrigin: leftRes.cycleOrigin };
    const rightRes = evaluateDimCSTNode(db, self, node.child?.(2));
    if (rightRes.cycleOrigin) return { value: null, cycleOrigin: rightRes.cycleOrigin };
    const left = leftRes.value;
    const right = rightRes.value;
    if (left === null || right === null) return { value: null };

    switch (op) {
      case "+":
        return { value: left + right };
      case "-":
        return { value: left - right };
      case "*":
        return { value: left * right };
      case "/":
        return { value: right !== 0 ? Math.floor(left / right) : null };
      default:
        return { value: null };
    }
  }

  // Unary expression (-a, +a)
  if (type === "UnaryExpression" || (node.childCount === 2 && node.type === "expression")) {
    const rawOp = node.child?.(0)?.text?.trim() ?? "";
    const op = stripOuterChar(rawOp, '"');
    const res = evaluateDimCSTNode(db, self, node.child?.(1));
    if (res.cycleOrigin) return { value: null, cycleOrigin: res.cycleOrigin };
    if (res.value === null) return { value: null };
    return { value: op === "-" ? -res.value : res.value };
  }

  // Function call — handle size(), integer(), ndims()
  if (type === "FunctionCall" || (type === "primary" && node.child?.(1)?.type === "function_call_args")) {
    const nodeSyntax = asSyntaxNode(node);
    const funcRef = (nodeSyntax ? Cst.FunctionCall.name(nodeSyntax) : null) ?? node.child?.(0);
    const funcName = funcRef?.text?.trim();

    if (funcName === "size") {
      return evaluateDimSizeCall(db, self, node);
    }
    if (funcName === "integer") {
      const argNodes = extractFunctionCallArgNodes(node);
      return argNodes.length > 0 ? evaluateDimCSTNode(db, self, argNodes[0]) : { value: null };
    }
    if (funcName === "ndims") {
      return { value: evaluateDimNdimsCall(db, self, node) };
    }
    return { value: null };
  }

  // Component reference / Name / Identifier
  if (
    type === "ComponentReference" ||
    type === "ComponentReferencePart" ||
    type === "component_reference" ||
    type === "Name" ||
    type === "IDENT" ||
    type === "name" ||
    type === "identifier" ||
    isAsciiIdentStr(node.text?.trim() ?? "")
  ) {
    const refText = node.text?.trim();
    if (!refText) return { value: null };
    return evaluateDimNameRef(db, self, refText);
  }

  // If the node is a simple text that looks like an integer
  if (node.text) {
    const parsed = parseInt(node.text.trim(), 10);
    if (!isNaN(parsed) && String(parsed) === node.text.trim()) return { value: parsed };
  }

  return { value: null };
}

/**
 * Helper to get the number of dimensions (ndims) of a component.
 */
function getOrEvaluateNdims(db: QueryDB, resolved: SymbolEntry): number | null {
  const rawDims = db.query<ArrayDimensionDescriptor[] | null>("arrayDimensions", resolved.id);
  return rawDims?.length ?? null;
}

/**
 * Evaluate a `size(x, d)` call in a dimension context.
 */
function evaluateDimSizeCall(db: QueryDB, self: SymbolEntry, node: QueryCstNode): DimEvalResult {
  const argNodes = extractFunctionCallArgNodes(node);
  if (argNodes.length < 2) return { value: null };

  const arrayRefNode = argNodes[0];
  const dimArgNode = argNodes[1];
  const dimIdxRes = evaluateDimCSTNode(db, self, dimArgNode);
  if (dimIdxRes.cycleOrigin) return { value: null, cycleOrigin: dimIdxRes.cycleOrigin };
  if (dimIdxRes.value === null) return { value: null };
  const dimIndex = dimIdxRes.value;

  const refName = arrayRefNode?.text?.trim();
  if (!refName) return { value: null };

  const parentId = self.parentId;
  if (parentId === null) return { value: null };

  const resolver = db.query<((name: string) => SymbolEntry | null) | null>("resolveSimpleName", parentId);
  if (!resolver) return { value: null };

  const parts = refName.split(".");
  let resolved = resolver(parts[0]!);
  for (let i = 1; i < parts.length && resolved; i++) {
    const subResolver = db.query<((name: string) => SymbolEntry | null) | null>("resolveSimpleName", resolved.id);
    if (!subResolver) {
      resolved = null;
      break;
    }
    resolved = subResolver(parts[i]!);
  }

  if (!resolved) {
    return { value: null };
  }

  const targetDimIdx = dimIndex - 1;
  const dimRes = db.queryWith<DimEvalResult>(
    "resolvedArrayDimensionAt",
    resolved.id,
    { dimIndex: targetDimIdx },
    String(targetDimIdx),
  );
  if (dimRes?.cycleOrigin) {
    return { value: null, cycleOrigin: dimRes.cycleOrigin };
  }
  const val = dimRes?.value ?? null;
  return { value: val !== null && val > 0 ? val : null };
}

/**
 * Inspects a flexible (`:`) component's binding CST for `size(...)` or component references that
 * create a Salsa cycle back to `resolvedArrayDimensionAt`, returning the originating `cycleOrigin`
 * if a cycle is encountered.
 */
export function findFlexibleBindingDimCycle(
  db: QueryDB,
  self: SymbolEntry,
  dimIndex: number,
  node: QueryCstNode | null | undefined,
): string | undefined {
  if (!node) return undefined;
  const type = node.type;
  if (type === "function_call" || type === "FunctionCall" || (type === "primary" && (node.childCount ?? 0) >= 2)) {
    const callee = node.child?.(0);
    const calleeName = callee?.text?.trim();
    if (calleeName === "size") {
      const argNodes = extractFunctionCallArgNodes(node);
      if (argNodes.length >= 2) {
        const sizeRes = evaluateDimSizeCall(db, self, node);
        if (sizeRes.cycleOrigin) return sizeRes.cycleOrigin;
      } else if (argNodes.length === 1 && self.parentId !== null) {
        const refName = argNodes[0]?.text?.trim();
        if (refName) {
          const resolver = db.query<((name: string) => SymbolEntry | null) | null>("resolveSimpleName", self.parentId);
          let resolved = resolver ? resolver(refName.split(".")[0]!) : null;
          const parts = refName.split(".");
          for (let i = 1; i < parts.length && resolved; i++) {
            const subResolver = db.query<((name: string) => SymbolEntry | null) | null>(
              "resolveSimpleName",
              resolved.id,
            );
            resolved = subResolver ? subResolver(parts[i]!) : null;
          }
          if (resolved) {
            const dimRes = db.queryWith<DimEvalResult>(
              "resolvedArrayDimensionAt",
              resolved.id,
              { dimIndex },
              String(dimIndex),
            );
            if (dimRes?.cycleOrigin) return dimRes.cycleOrigin;
            if (dimRes?.cyclic) return `dim:${resolved.id}:${dimIndex}`;
          }
        }
      }
      for (let i = 1; i < argNodes.length; i++) {
        const nested = findFlexibleBindingDimCycle(db, self, dimIndex, argNodes[i]);
        if (nested) return nested;
      }
      return undefined;
    }
    if (calleeName === "ndims") {
      return undefined;
    }
    const argNodes = extractFunctionCallArgNodes(node);
    if (argNodes.length > 0) {
      for (const arg of argNodes) {
        const nested = findFlexibleBindingDimCycle(db, self, dimIndex, arg);
        if (nested) return nested;
      }
      return undefined;
    }
  }

  if (type === "component_reference" || type === "ComponentReference") {
    const refName = node.text?.trim();
    if (refName && self.parentId !== null) {
      const resolver = db.query<((name: string) => SymbolEntry | null) | null>("resolveSimpleName", self.parentId);
      const parts = refName.split(".");
      let resolved = resolver ? resolver(parts[0]!) : null;
      for (let i = 1; i < parts.length && resolved; i++) {
        const subResolver = db.query<((name: string) => SymbolEntry | null) | null>("resolveSimpleName", resolved.id);
        resolved = subResolver ? subResolver(parts[i]!) : null;
      }
      if (resolved && resolved.kind === "Component") {
        const rawDims = db.query<ArrayDimensionDescriptor[] | null>("arrayDimensions", resolved.id);
        if (rawDims && dimIndex < rawDims.length) {
          const dimRes = db.queryWith<DimEvalResult>(
            "resolvedArrayDimensionAt",
            resolved.id,
            { dimIndex },
            String(dimIndex),
          );
          if (dimRes?.cycleOrigin) return dimRes.cycleOrigin;
          if (dimRes?.cyclic) return `dim:${resolved.id}:${dimIndex}`;
        }
      }
    }
    return undefined;
  }

  for (let i = 0; i < (node.childCount ?? 0); i++) {
    const child = node.child?.(i);
    const res = findFlexibleBindingDimCycle(db, self, dimIndex, child);
    if (res) return res;
  }
  return undefined;
}

/**
 * Evaluate an `ndims(x)` call in a dimension context.
 */
function evaluateDimNdimsCall(db: QueryDB, self: SymbolEntry, node: QueryCstNode): number | null {
  const argNodes = extractFunctionCallArgNodes(node);
  if (argNodes.length < 1) return null;

  const refName = argNodes[0]?.text?.trim();
  if (!refName) return null;

  const parentId = self.parentId;
  if (parentId === null) return null;

  const resolver = db.query<((name: string) => SymbolEntry | null) | null>("resolveSimpleName", parentId);
  if (!resolver) return null;
  const resolved = resolver(refName);
  if (!resolved) return null;

  return getOrEvaluateNdims(db, resolved);
}

/**
 * Resolve a name reference (e.g., `n`, `N`, `pkg.n`) to an integer value.
 *
 * Looks up the symbol and reads its binding value via the `resolvedDimParamValue` Salsa query.
 */
function evaluateDimNameRef(db: QueryDB, self: SymbolEntry, name: string): DimEvalResult {
  if (name === "Boolean") return { value: 2 };
  const parentId = self.parentId;
  if (parentId === null) return { value: null };

  const resolver = db.query<((name: string) => SymbolEntry | null) | null>("resolveSimpleName", parentId);
  if (!resolver) return { value: null };

  const parts = name.split(".");
  let resolved = resolver(parts[0]!);
  for (let i = 1; i < parts.length && resolved; i++) {
    const subResolver = db.query<((name: string) => SymbolEntry | null) | null>("resolveSimpleName", resolved.id);
    if (!subResolver) {
      resolved = null;
      break;
    }
    resolved = subResolver(parts[i]!);
  }
  if (!resolved) {
    const typeClassId = db.query<SymbolId | null>("classInstance", self.id);
    if (typeClassId) {
      const typeEntry = db.symbol(typeClassId);
      if (typeEntry && typeEntry.parentId != null) {
        const typeResolver = db.query<((name: string) => SymbolEntry | null) | null>(
          "resolveSimpleName",
          typeEntry.parentId,
        );
        if (typeResolver) {
          resolved = typeResolver(parts[0]!);
          for (let i = 1; i < parts.length && resolved; i++) {
            const subResolver = db.query<((name: string) => SymbolEntry | null) | null>(
              "resolveSimpleName",
              resolved.id,
            );
            if (!subResolver) {
              resolved = null;
              break;
            }
            resolved = subResolver(parts[i]!);
          }
        }
      }
    }
  }
  if (!resolved) return { value: null };

  // Check if it's an enumeration type (return literal count)
  if (resolved.kind === "Class") {
    let curCls: SymbolEntry | null = resolved;
    const visitedCls = new Set<SymbolId>();
    while (curCls && !visitedCls.has(curCls.id)) {
      visitedCls.add(curCls.id);
      const meta = getSymbolMeta(curCls);
      const classPrefixes = meta?.["classPrefixes"];
      const cstNode = db.cstNode(curCls.id) as CstNodeLike | null;
      const cstText = cstNode?.text ?? "";
      const shortSpec = getShortClassSpecifierNode(cstNode);
      const enumListNode =
        shortSpec?.children?.find((c) => c.type === "enum_list" || c.type === "EnumList") ??
        cstNode?.children?.find((c) => c.type === "enum_list" || c.type === "EnumList");
      const isEnum =
        (typeof classPrefixes === "string" && classPrefixes.includes("enumeration")) ||
        Boolean(enumListNode) ||
        Boolean(shortSpec?.children?.some((c) => c.text?.trim() === "enumeration" || c.type === '"enumeration"')) ||
        hasEnumTypeText(cstText);
      if (isEnum) {
        if (enumListNode && enumListNode.children) {
          const lits = enumListNode.children.filter(
            (c) => c.type === "enumeration_literal" || c.type === "EnumerationLiteral",
          );
          if (lits.length > 0) return { value: lits.length };
        }
        const parsedLits = parseEnumLiteralsFromText(cstText, 0, true);
        if (parsedLits.length > 0) return { value: parsedLits.length };
        const children = db.childrenOf(curCls.id);
        return { value: children.filter((c) => c.kind === "Component").length };
      }
      curCls = db.query<SymbolEntry | null>("resolvedBaseClass", curCls.id);
    }
  }

  // Must be a parameter or constant with an integer binding
  if (resolved.kind !== "Component") return { value: null };
  const res = db.query<DimEvalResult>("resolvedDimParamValue", resolved.id);
  return res ?? { value: null };
}
