// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Modelica Flattener - Built-in Modelica mathematical constants and pure constant expression evaluation.
 */

import type { QueryDB, SymbolEntry, SymbolId } from "@modelscript/runtime";
import type { SyntaxNode } from "../../../../src-gen/bindings.js";
import { BARE_SINGLE_LETTER_MODELICA_CONSTANTS, MODELICA_CONSTANTS } from "../../../constants.js";
import { getSymbolQualifiedName } from "../functions.js";
import { evalBinaryNumericOp } from "./arithmetic-eval.js";
import {
  extractFunctionCallArgExprNodesCst,
  parseStandaloneExpressionCst,
  unwrapParenExprCst,
} from "./cst-traversal.js";
import {
  isSignedAsciiNumberText,
  stripLeadingDot,
  stripMathPackagePrefix,
  stripOuterDoubleQuotes,
} from "./text-scanning.js";
import type { CstNodeLike, SimpleNameResolver } from "./types.js";

const KNOWN_MODELICA_CONSTANTS: Record<string, number> = MODELICA_CONSTANTS;

function canSubstituteBareSingleLetterConstant(
  ident: string,
  exprText: string,
  db?: QueryDB,
  scopeId?: SymbolId,
): boolean {
  if (!Object.prototype.hasOwnProperty.call(BARE_SINGLE_LETTER_MODELICA_CONSTANTS, ident)) {
    return false;
  }
  if (exprText.includes("Modelica.Constants.")) {
    return true;
  }
  if (!db || scopeId === undefined) {
    return false;
  }
  const scopeSym = db.symbol(scopeId);
  if (scopeSym?.name === "Constants" || getSymbolQualifiedName(db, scopeId).endsWith("Constants")) {
    return true;
  }
  let hasConstantsImport = false;
  let curId: SymbolId | null | undefined = scopeId;
  const visited = new Set<SymbolId>();
  while (curId !== undefined && curId !== null && !visited.has(curId)) {
    visited.add(curId);
    const children = db.childrenOf(curId) || [];
    for (const ch of children) {
      if (ch.kind === "Component" && ch.name === ident) {
        return false;
      }
      if (ch.kind === "Import") {
        const impNode = db.cstNode(ch.id) as CstNodeLike | null;
        const impMetaPath = (ch.metadata as Record<string, unknown> | undefined)?.["path"];
        const rawImpName =
          impNode?.childForFieldName?.("name")?.text?.trim() ??
          (typeof impMetaPath === "string" ? impMetaPath : ch.name) ??
          "";
        const impSegs = stripLeadingDot(rawImpName)
          .split(".")
          .map((seg: string) => seg.trim());
        if (impSegs.includes("Constants")) {
          hasConstantsImport = true;
        }
      }
    }
    const baseSym = db.query<SymbolEntry | null>("resolvedBaseClass", curId);
    if (baseSym && !visited.has(baseSym.id)) {
      const baseChildren = db.childrenOf(baseSym.id) || [];
      if (baseChildren.some((ch) => ch.kind === "Component" && ch.name === ident)) {
        return false;
      }
    }
    curId = db.symbol(curId)?.parentId;
  }
  if (!hasConstantsImport) {
    return false;
  }
  const resolved =
    db.query<SimpleNameResolver | null>("resolveSimpleName", scopeId)?.(ident) ??
    db.query<SimpleNameResolver | null>("resolveName", scopeId)?.(ident);
  if (resolved && resolved.kind === "Component") {
    const parentSym = resolved.parentId != null ? db.symbol(resolved.parentId) : null;
    if (parentSym?.name !== "Constants") {
      return false;
    }
  }
  return true;
}

const KNOWN_MATH_UNARY_FUNCS: Record<string, (x: number) => number> = {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  sinh: Math.sinh,
  cosh: Math.cosh,
  tanh: Math.tanh,
  exp: Math.exp,
  log: Math.log,
  log10: Math.log10,
  sqrt: Math.sqrt,
  abs: Math.abs,
  from_degC: (x: number) => x + 273.15,
  to_degC: (x: number) => x - 273.15,
  from_bar: (x: number) => x * 1e5,
  to_bar: (x: number) => x * 1e-5,
};

export function evalKnownConstantExprText(exprText: string, db?: QueryDB, scopeId?: SymbolId): number | null {
  const s = exprText.trim();
  if (!s) return null;
  if (Object.prototype.hasOwnProperty.call(KNOWN_MODELICA_CONSTANTS, s)) {
    return KNOWN_MODELICA_CONSTANTS[s]!;
  }
  if (canSubstituteBareSingleLetterConstant(s, s, db, scopeId)) {
    return BARE_SINGLE_LETTER_MODELICA_CONSTANTS[s]!;
  }
  const rootCst = parseStandaloneExpressionCst(s);
  if (!rootCst) {
    if (isSignedAsciiNumberText(s)) {
      const n = Number(s);
      return Number.isFinite(n) ? n : null;
    }
    if (Object.prototype.hasOwnProperty.call(KNOWN_MODELICA_CONSTANTS, s)) {
      return KNOWN_MODELICA_CONSTANTS[s]!;
    }
    return null;
  }

  const evalCstNode = (rawNode: SyntaxNode): number | null => {
    const cur = unwrapParenExprCst(rawNode);
    if (!cur) return null;
    if (cur.type === "unsigned_number" || cur.type === "unsigned_integer" || cur.type === "unsigned_real") {
      const n = Number(cur.text);
      return Number.isFinite(n) ? n : null;
    }
    if (cur.type === "expression" && cur.childCount === 2) {
      const op = stripOuterDoubleQuotes(cur.child(0)?.text?.trim() ?? cur.child(0)?.type ?? "");
      const val = evalCstNode(cur.child(1)!);
      if (val === null) return null;
      if (op === "+") return val;
      if (op === "-") return -val;
      return null;
    }
    if (cur.type === "expression" && cur.childCount === 3) {
      const op = stripOuterDoubleQuotes(cur.child(1)?.text?.trim() ?? cur.child(1)?.type ?? "");
      if (op !== "+" && op !== "-" && op !== "*" && op !== "/" && op !== "^") return null;
      const left = evalCstNode(cur.child(0)!);
      const right = evalCstNode(cur.child(2)!);
      if (left === null || right === null) return null;
      return evalBinaryNumericOp(op, left, right, false);
    }
    if (cur.type === "primary") {
      const calleeText = cur.childForFieldName("callee")?.text?.trim();
      if (calleeText) {
        const shortFn = stripMathPackagePrefix(stripLeadingDot(calleeText));
        const args = extractFunctionCallArgExprNodesCst(cur);
        if (shortFn === "atan2" && args.length === 2) {
          const arg1 = evalCstNode(args[0]!);
          const arg2 = evalCstNode(args[1]!);
          return arg1 !== null && arg2 !== null ? Math.atan2(arg1, arg2) : null;
        }
        if (args.length === 1) {
          const fn = KNOWN_MATH_UNARY_FUNCS[shortFn];
          if (!fn) return null;
          const arg1 = evalCstNode(args[0]!);
          return arg1 !== null ? fn(arg1) : null;
        }
        return null;
      }
    }
    if (cur.type === "component_reference" || cur.type === "identifier") {
      const ident = stripLeadingDot(cur.text.trim());
      if (Object.prototype.hasOwnProperty.call(KNOWN_MODELICA_CONSTANTS, ident)) {
        return KNOWN_MODELICA_CONSTANTS[ident]!;
      }
      if (canSubstituteBareSingleLetterConstant(ident, s, db, scopeId)) {
        return BARE_SINGLE_LETTER_MODELICA_CONSTANTS[ident]!;
      }
      return null;
    }
    return null;
  };

  const result = evalCstNode(rootCst);
  return result !== null && Number.isFinite(result) ? result : null;
}
