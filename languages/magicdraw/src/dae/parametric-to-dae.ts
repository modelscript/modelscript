// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/magicdraw — Arena-Native SysML 1.x Parametric Diagram → DAEBuilder Lowering.
 *
 * Lowers `«block»` value properties, `«constraintBlock»` algebraic equations,
 * and `«binding»` connectors directly into ModelScript's linear-memory `DAEBuilder`
 * integer IDs (`ExprId`, `EqId`) with zero intermediate AST wrapper allocations.
 */

import {
  BinOp,
  Causality,
  DAEBuilder,
  EqKind,
  ExprKind,
  StringInterner,
  UnaryOp,
  Variability,
  VarType,
} from "@modelscript/runtime";
import {
  ensureBuiltInMagicDrawLibraryRegistered,
  lookupMagicDrawModelSchema,
} from "../catalog/library-package-adapter.js";
import { parseMagicDraw } from "../parser/index.js";
import type { MagicDrawDocument } from "../types.js";

/**
 * Resolves parameter defaults for a MagicDraw model from `@modelscript/magicdraw-std-lib`,
 * merging any user-specified named overrides over the cleanroom schema defaults.
 */
export function resolveMagicDrawSchemaParamDefaults(
  modelName: string,
  overrides: Record<string, number> = {},
): Record<string, number> {
  ensureBuiltInMagicDrawLibraryRegistered();
  const resolved: Record<string, number> = {};
  const schema = lookupMagicDrawModelSchema(modelName);
  if (schema) {
    for (const p of schema.parameters) {
      if (typeof p.defaultValue === "number" && Number.isFinite(p.defaultValue)) {
        resolved[p.key] = p.defaultValue;
      }
    }
  }
  for (const [k, v] of Object.entries(overrides)) {
    if (Number.isFinite(v)) {
      resolved[k] = v;
    }
  }
  return resolved;
}

function sanitizeIdent(name: string): string {
  const cleaned = name.trim().replace(/[^A-Za-z0-9_]/g, "_");
  if (!cleaned) return "v";
  return /^[0-9]/.test(cleaned) ? `_${cleaned}` : cleaned;
}

/**
 * Lightweight recursive-descent expression compiler that lowers a parametric
 * constraint expression string (e.g. `F = m * a` or `P = V * I + loss`) directly
 * into `DAEBuilder` linear-memory expression IDs.
 */
function lowerSimpleExprToArena(exprText: string, prefix: string, arena: DAEBuilder, interner: StringInterner): number {
  const s = exprText.trim();
  if (!s) return arena.addRealLiteral(0.0);

  // Strip outer matching parens
  if (s.startsWith("(") && s.endsWith(")")) {
    let depth = 0;
    let wrapsAll = true;
    for (let i = 0; i < s.length - 1; i++) {
      if (s[i] === "(") depth++;
      else if (s[i] === ")") depth--;
      if (depth === 0) {
        wrapsAll = false;
        break;
      }
    }
    if (wrapsAll) return lowerSimpleExprToArena(s.slice(1, -1), prefix, arena, interner);
  }

  // Find lowest-precedence binary op (+, -) outside parens (right-to-left)
  let depth = 0;
  for (let i = s.length - 1; i >= 0; i--) {
    const ch = s[i]!;
    if (ch === ")") depth++;
    else if (ch === "(") depth--;
    else if (depth === 0 && (ch === "+" || ch === "-") && i > 0) {
      const prev = s.slice(0, i).trimEnd();
      if (prev.length > 0 && !/[+\-*/^(,]$/.test(prev)) {
        const lhs = lowerSimpleExprToArena(prev, prefix, arena, interner);
        const rhs = lowerSimpleExprToArena(s.slice(i + 1), prefix, arena, interner);
        return arena.addBinaryExpr(ch === "+" ? BinOp.Add : BinOp.Sub, lhs, rhs);
      }
    }
  }

  // Next precedence: *, /
  depth = 0;
  for (let i = s.length - 1; i >= 0; i--) {
    const ch = s[i]!;
    if (ch === ")") depth++;
    else if (ch === "(") depth--;
    else if (depth === 0 && (ch === "*" || ch === "/")) {
      const lhs = lowerSimpleExprToArena(s.slice(0, i), prefix, arena, interner);
      const rhs = lowerSimpleExprToArena(s.slice(i + 1), prefix, arena, interner);
      return arena.addBinaryExpr(ch === "*" ? BinOp.Mul : BinOp.Div, lhs, rhs);
    }
  }

  // Next precedence: ^ (power)
  depth = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (depth === 0 && ch === "^") {
      const lhs = lowerSimpleExprToArena(s.slice(0, i), prefix, arena, interner);
      const rhs = lowerSimpleExprToArena(s.slice(i + 1), prefix, arena, interner);
      return arena.addBinaryExpr(BinOp.Pow, lhs, rhs);
    }
  }

  // Unary negation
  if (s.startsWith("-")) {
    const inner = lowerSimpleExprToArena(s.slice(1), prefix, arena, interner);
    return arena.addUnaryExpr(UnaryOp.Negate, inner);
  }

  // Differential operators: der(x) or diff(x, t)
  const derMatch = s.match(/^(?:der|diff)\s*\(\s*([^,)]+)(?:,\s*[^)]+)?\s*\)$/i);
  if (derMatch?.[1]) {
    const argExpr = lowerSimpleExprToArena(derMatch[1], prefix, arena, interner);
    const derSymId = interner.intern("der");
    return arena.addExpression(ExprKind.Call, derSymId, argExpr, 0);
  }

  // Numeric literal
  if (/^[0-9]+(\.[0-9]+)?([eE][+-]?[0-9]+)?$/.test(s)) {
    return arena.addRealLiteral(Number(s));
  }

  // Identifier (variable reference)
  const varName = prefix ? `${prefix}_${sanitizeIdent(s)}` : sanitizeIdent(s);
  const symId = interner.intern(varName);
  return arena.addExpression(ExprKind.Name, symId);
}

/**
 * Lowers a MagicDraw SysML 1.x model's blocks, value properties, parametric constraint blocks,
 * and binding connectors (including `NestedConnectorEnd` deep property paths) directly into
 * ModelScript's linear-memory `DAEBuilder` arena.
 */
export function lowerMagicDrawParametricsToDae(docOrText: MagicDrawDocument | string, arenaTitle?: string): DAEBuilder {
  ensureBuiltInMagicDrawLibraryRegistered();
  const doc = typeof docOrText === "string" ? parseMagicDraw(docOrText) : docOrText;
  const title = arenaTitle ?? sanitizeIdent(doc.metadata.projectName ?? "MagicDraw_Parametric");
  const interner = new StringInterner();
  const arena = new DAEBuilder(interner, title);
  const declaredVars = new Set<string>();

  const ensureVar = (name: string, typeName: string | undefined, isParam: boolean) => {
    if (declaredVars.has(name)) return;
    declaredVars.add(name);
    const varType = typeName === "Integer" ? VarType.Integer : typeName === "Boolean" ? VarType.Boolean : VarType.Real;
    arena.addVariable(name, varType, isParam ? Variability.Parameter : Variability.Continuous, Causality.Local);
  };

  for (const cls of doc.classifiers.values()) {
    if (cls.kind === "Requirement" || cls.kind === "ValueType" || cls.kind === "DataType") continue;
    const clsPrefix = sanitizeIdent(cls.name);

    // 1. Emit value properties and default-value bindings
    for (const prop of cls.properties) {
      if (prop.compartment === "parts" || prop.compartment === "references" || prop.compartment === "constraints") {
        continue;
      }
      const varName = `${clsPrefix}_${sanitizeIdent(prop.name)}`;
      const isParam = prop.isReadOnly || (prop.defaultValue !== undefined && cls.kind !== "ConstraintBlock");
      ensureVar(varName, prop.typeRef?.resolvedName, isParam);

      if (
        prop.defaultValue !== undefined &&
        /^[+-]?[0-9]+(\.[0-9]+)?([eE][+-]?[0-9]+)?$/.test(prop.defaultValue.trim())
      ) {
        const symId = interner.intern(varName);
        const lhs = arena.addExpression(ExprKind.Name, symId);
        const rhs = arena.addRealLiteral(Number(prop.defaultValue.trim()));
        arena.addEquation(isParam ? EqKind.InitialSimple : EqKind.Simple, lhs, rhs);
      }
    }

    // 2. Emit constraint block equations
    for (const c of cls.constraints) {
      const body = c.body.trim().replace(/;+$/, "");
      const eqIdx = body.indexOf("=");
      if (
        eqIdx > 0 &&
        body[eqIdx - 1] !== "!" &&
        body[eqIdx - 1] !== "<" &&
        body[eqIdx - 1] !== ">" &&
        body[eqIdx + 1] !== "="
      ) {
        const lhsStr = body.slice(0, eqIdx).trim();
        const rhsStr = body.slice(eqIdx + 1).trim();
        const lhsExpr = lowerSimpleExprToArena(lhsStr, clsPrefix, arena, interner);
        const rhsExpr = lowerSimpleExprToArena(rhsStr, clsPrefix, arena, interner);
        arena.addEquation(EqKind.Simple, lhsExpr, rhsExpr);
      }
    }

    // 3. Emit parametric binding connectors as equality equations (including NestedConnectorEnd paths)
    for (const conn of cls.connectors) {
      if (conn.kind !== "binding" || conn.ends.length < 2) continue;
      const resolveEndVar = (end: (typeof conn.ends)[0]): string | undefined => {
        const roleName = end.roleId ? doc.elementsById.get(end.roleId)?.name : undefined;
        if (end.nestedPropertyPath && end.nestedPropertyPath.length > 0 && roleName) {
          const pathNames = end.nestedPropertyPath
            .map((pid) => doc.elementsById.get(pid)?.name ?? pid)
            .map(sanitizeIdent);
          return `${clsPrefix}_${pathNames.join("_")}_${sanitizeIdent(roleName)}`;
        }
        const partName = end.partWithPortId ? doc.elementsById.get(end.partWithPortId)?.name : undefined;
        if (partName && roleName) {
          const partProp = cls.properties.find((p) => p.id === end.partWithPortId);
          const partTypePrefix = partProp?.typeRef?.resolvedName
            ? sanitizeIdent(partProp.typeRef.resolvedName)
            : sanitizeIdent(partName);
          return `${partTypePrefix}_${sanitizeIdent(roleName)}`;
        }
        if (roleName) return `${clsPrefix}_${sanitizeIdent(roleName)}`;
        return undefined;
      };

      const v0 = resolveEndVar(conn.ends[0]!);
      const v1 = resolveEndVar(conn.ends[1]!);
      if (v0 && v1) {
        ensureVar(v0, "Real", false);
        ensureVar(v1, "Real", false);
        const lhs = arena.addExpression(ExprKind.Name, interner.intern(v0));
        const rhs = arena.addExpression(ExprKind.Name, interner.intern(v1));
        arena.addEquation(EqKind.Simple, lhs, rhs);
      }
    }
  }

  return arena;
}
