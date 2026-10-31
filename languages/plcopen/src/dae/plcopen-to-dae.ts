// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/plcopen — Direct Linear-Memory DAE Lowering.
 *
 * Lowers IEC 61131-3 PLCopen POUs and Structured Text statements directly
 * into ModelScript's zero-intermediate DAEBuilder linear memory arena.
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
import type { PlcBinaryOp, PlcExpr, PlcPou, PlcProject, PlcStatement, PlcUnaryOp, PlcVariable } from "../types.js";

const FB_TYPES = new Set(["TON", "TOF", "TP", "CTU", "CTD", "CTUD", "R_TRIG", "F_TRIG", "SR", "RS"]);

export function lowerPlcopenToDae(target: PlcPou | PlcProject, arenaTitle?: string): DAEBuilder {
  const title = arenaTitle ?? ("pous" in target ? (target.contentHeader?.name ?? "PLC_Project") : target.name);
  const interner = new StringInterner();
  const arena = new DAEBuilder(interner, title);

  const pous: PlcPou[] = "pous" in target ? target.pous : [target];

  const varMap = new Map<string, number>();
  const varExprMap = new Map<string, number>();
  const defaultExprMap = new Map<string, number>();

  for (const pou of pous) {
    // 1. Declare POU Variables (skip raw FB struct containers; their fields are declared on use)
    for (const v of pou.variables) {
      if (FB_TYPES.has(v.dataType.toUpperCase())) {
        continue;
      }
      declarePlcVariable(arena, interner, pou.name, v, varMap, varExprMap, defaultExprMap);
    }

    // 2. Lower Body Statements to Equations
    const assignedVars = new Map<string, number>();
    if (pou.body.kind === "ST" && pou.body.st) {
      lowerStatements(arena, interner, pou, pou.body.st.statements, varExprMap, defaultExprMap, assignedVars);
    }

    // 3. Emit single defining equation per assigned variable
    const emittedTargets = new Set<number>();
    for (const [fullName, rhsExprId] of assignedVars.entries()) {
      const targetExprId = varExprMap.get(fullName);
      if (targetExprId !== undefined && !emittedTargets.has(targetExprId)) {
        arena.addEquation(EqKind.Simple, targetExprId, rhsExprId);
        emittedTargets.add(targetExprId);
      }
    }

    // 4. For any declared scalar variable not assigned in the body, emit its initial/default binding
    for (const v of pou.variables) {
      if (FB_TYPES.has(v.dataType.toUpperCase())) continue;
      const fullName = `${pou.name}.${v.name}`;
      const targetExprId = varExprMap.get(fullName);
      if (targetExprId !== undefined && !emittedTargets.has(targetExprId)) {
        const initExprId = defaultExprMap.get(fullName) ?? arena.addRealLiteral(0.0);
        arena.addEquation(EqKind.InitialSimple, targetExprId, initExprId);
        emittedTargets.add(targetExprId);
      }
    }
  }

  return arena;
}

function declarePlcVariable(
  arena: DAEBuilder,
  interner: StringInterner,
  pouName: string,
  v: PlcVariable,
  varMap: Map<string, number>,
  varExprMap: Map<string, number>,
  defaultExprMap: Map<string, number>,
): void {
  const dtUpper = v.dataType.toUpperCase();
  let varType = VarType.Real;
  if (dtUpper === "BOOL") {
    varType = VarType.Boolean;
  } else if (dtUpper === "INT" || dtUpper === "DINT" || dtUpper === "LINT") {
    varType = VarType.Integer;
  }

  let causality = Causality.Local;
  if (v.scope === "input") causality = Causality.Input;
  else if (v.scope === "output") causality = Causality.Output;

  const variability = v.isConstant
    ? Variability.Constant
    : v.scope === "input"
      ? Variability.Continuous
      : Variability.Discrete;

  const fullName = `${pouName}.${v.name}`;
  const nameId = interner.intern(fullName);
  const varIdx = arena.addVariable(fullName, varType, variability, causality);
  const exprId = arena.addExpression(ExprKind.Name, nameId);

  varMap.set(fullName, varIdx);
  varMap.set(v.name, varIdx);
  varExprMap.set(fullName, exprId);
  varExprMap.set(v.name, exprId);

  let defaultExprId: number;
  if (typeof v.initialValue === "number") {
    defaultExprId = arena.addRealLiteral(v.initialValue);
  } else if (typeof v.initialValue === "boolean") {
    defaultExprId = arena.addBoolLiteral(v.initialValue);
  } else if (varType === VarType.Boolean) {
    defaultExprId = arena.addBoolLiteral(false);
  } else {
    defaultExprId = arena.addRealLiteral(0.0);
  }
  defaultExprMap.set(fullName, defaultExprId);
}

function resolveCanonicalVarName(pou: PlcPou, rawName: string, varExprMap: Map<string, number>): string {
  const scoped = `${pou.name}.${rawName}`;
  if (varExprMap.has(scoped)) return scoped;
  return scoped;
}

function lowerStatements(
  arena: DAEBuilder,
  interner: StringInterner,
  pou: PlcPou,
  statements: PlcStatement[],
  varExprMap: Map<string, number>,
  defaultExprMap: Map<string, number>,
  assignedVars: Map<string, number>,
): void {
  for (const stmt of statements) {
    if (stmt.kind === "assignment") {
      if (stmt.target.kind === "identifier") {
        const targetName = stmt.target.name;
        const fullName = resolveCanonicalVarName(pou, targetName, varExprMap);
        let targetExprId = varExprMap.get(fullName) ?? varExprMap.get(targetName);
        if (targetExprId === undefined) {
          const nameId = interner.intern(fullName);
          arena.addVariable(fullName, VarType.Real, Variability.Discrete, Causality.Local);
          targetExprId = arena.addExpression(ExprKind.Name, nameId);
          varExprMap.set(fullName, targetExprId);
          varExprMap.set(targetName, targetExprId);
          defaultExprMap.set(fullName, arena.addRealLiteral(0.0));
        }

        const valExprId = lowerExpr(arena, interner, pou, stmt.value, varExprMap, defaultExprMap, assignedVars);
        assignedVars.set(fullName, valExprId);
      }
    } else if (stmt.kind === "if") {
      const condExprId = lowerExpr(arena, interner, pou, stmt.condition, varExprMap, defaultExprMap, assignedVars);

      const thenAssigned = new Map<string, number>(assignedVars);
      lowerStatements(arena, interner, pou, stmt.thenStatements, varExprMap, defaultExprMap, thenAssigned);

      const elsifBranches: { condId: number; assigned: Map<string, number> }[] = [];
      for (const elif of stmt.elsifs) {
        const elifCondId = lowerExpr(arena, interner, pou, elif.condition, varExprMap, defaultExprMap, assignedVars);
        const elifAssigned = new Map<string, number>(assignedVars);
        lowerStatements(arena, interner, pou, elif.statements, varExprMap, defaultExprMap, elifAssigned);
        elsifBranches.push({ condId: elifCondId, assigned: elifAssigned });
      }

      const elseAssigned = new Map<string, number>(assignedVars);
      lowerStatements(arena, interner, pou, stmt.elseStatements, varExprMap, defaultExprMap, elseAssigned);

      // Collect all variables modified across any branch
      const modifiedKeys = new Set<string>();
      for (const k of thenAssigned.keys()) {
        if (thenAssigned.get(k) !== assignedVars.get(k)) modifiedKeys.add(k);
      }
      for (const eb of elsifBranches) {
        for (const k of eb.assigned.keys()) {
          if (eb.assigned.get(k) !== assignedVars.get(k)) modifiedKeys.add(k);
        }
      }
      for (const k of elseAssigned.keys()) {
        if (elseAssigned.get(k) !== assignedVars.get(k)) modifiedKeys.add(k);
      }

      for (const key of modifiedKeys) {
        const fallback = assignedVars.get(key) ?? defaultExprMap.get(key) ?? arena.addRealLiteral(0.0);
        let merged = elseAssigned.get(key) ?? fallback;
        for (let i = elsifBranches.length - 1; i >= 0; i--) {
          const eb = elsifBranches[i];
          if (!eb) continue;
          const brVal = eb.assigned.get(key) ?? fallback;
          merged = arena.addIfElse(eb.condId, brVal, merged);
        }
        const thenVal = thenAssigned.get(key) ?? fallback;
        merged = arena.addIfElse(condExprId, thenVal, merged);
        assignedVars.set(key, merged);
      }
    } else if (stmt.kind === "case") {
      const selExprId = lowerExpr(arena, interner, pou, stmt.selector, varExprMap, defaultExprMap, assignedVars);
      const caseBranches: { condId: number; assigned: Map<string, number> }[] = [];

      for (const c of stmt.cases) {
        let condId: number | null = null;
        for (const v of c.values) {
          const valLit = typeof v === "number" ? arena.addRealLiteral(v) : arena.addRealLiteral(Number(v) || 0);
          const eqId = arena.addBinaryExpr(BinOp.Eq, selExprId, valLit);
          condId = condId === null ? eqId : arena.addBinaryExpr(BinOp.Or, condId, eqId);
        }
        if (condId !== null) {
          const armAssigned = new Map<string, number>(assignedVars);
          lowerStatements(arena, interner, pou, c.statements, varExprMap, defaultExprMap, armAssigned);
          caseBranches.push({ condId, assigned: armAssigned });
        }
      }

      const elseAssigned = new Map<string, number>(assignedVars);
      lowerStatements(arena, interner, pou, stmt.elseStatements, varExprMap, defaultExprMap, elseAssigned);

      const modifiedKeys = new Set<string>();
      for (const cb of caseBranches) {
        for (const k of cb.assigned.keys()) {
          if (cb.assigned.get(k) !== assignedVars.get(k)) modifiedKeys.add(k);
        }
      }
      for (const k of elseAssigned.keys()) {
        if (elseAssigned.get(k) !== assignedVars.get(k)) modifiedKeys.add(k);
      }

      for (const key of modifiedKeys) {
        const fallback = assignedVars.get(key) ?? defaultExprMap.get(key) ?? arena.addRealLiteral(0.0);
        let merged = elseAssigned.get(key) ?? fallback;
        for (let i = caseBranches.length - 1; i >= 0; i--) {
          const cb = caseBranches[i];
          if (!cb) continue;
          const brVal = cb.assigned.get(key) ?? fallback;
          merged = arena.addIfElse(cb.condId, brVal, merged);
        }
        assignedVars.set(key, merged);
      }
    } else if (stmt.kind === "call") {
      const calleeUpper = stmt.callee.toUpperCase();
      const calleeVar = pou.variables.find((v) => v.name.toLowerCase() === stmt.callee.toLowerCase());
      const resolvedType = (calleeVar?.dataType ?? stmt.callee).toUpperCase();
      if (
        resolvedType.startsWith("TON") ||
        resolvedType.startsWith("TOF") ||
        resolvedType.startsWith("TP") ||
        calleeUpper.startsWith("TON") ||
        calleeUpper.startsWith("TOF") ||
        calleeUpper.startsWith("TP")
      ) {
        const isTof = resolvedType.startsWith("TOF") || calleeUpper.startsWith("TOF");
        const isTp = resolvedType.startsWith("TP") || calleeUpper.startsWith("TP");

        const etName = `${pou.name}.${stmt.callee}.ET`;
        const qName = `${pou.name}.${stmt.callee}.Q`;

        const inArg = stmt.args.find((a) => a.name?.toUpperCase() === "IN");
        const ptArg = stmt.args.find((a) => a.name?.toUpperCase() === "PT");
        const inExprId = inArg
          ? lowerExpr(arena, interner, pou, inArg.expr, varExprMap, defaultExprMap, assignedVars)
          : arena.addBoolLiteral(false);
        const ptExprId = ptArg
          ? lowerExpr(arena, interner, pou, ptArg.expr, varExprMap, defaultExprMap, assignedVars)
          : arena.addRealLiteral(1.0);

        let etExpr = varExprMap.get(etName);
        if (etExpr === undefined) {
          const etNameId = interner.intern(etName);
          arena.addVariable(etName, VarType.Real, Variability.Continuous, Causality.Local);
          etExpr = arena.addExpression(ExprKind.Name, etNameId);
          varExprMap.set(etName, etExpr);

          // der(ET) = if IN then 1.0 else 0.0 (or inverted for TOF)
          const derEt = arena.addExpression(ExprKind.Der, etExpr);
          const oneLit = arena.addRealLiteral(1.0);
          const zeroLit = arena.addRealLiteral(0.0);
          const rateExpr = isTof
            ? arena.addIfElse(inExprId, zeroLit, oneLit)
            : arena.addIfElse(inExprId, oneLit, zeroLit);
          arena.addEquation(EqKind.Simple, derEt, rateExpr);
        }

        let qExpr = varExprMap.get(qName);
        if (qExpr === undefined) {
          const qNameId = interner.intern(qName);
          arena.addVariable(qName, VarType.Boolean, Variability.Discrete, Causality.Local);
          qExpr = arena.addExpression(ExprKind.Name, qNameId);
          varExprMap.set(qName, qExpr);

          const trueLit = arena.addBoolLiteral(true);
          const falseLit = arena.addBoolLiteral(false);
          let qRhs: number;
          if (isTof) {
            const ltPt = arena.addBinaryExpr(BinOp.Lt, etExpr, ptExprId);
            qRhs = arena.addIfElse(inExprId, trueLit, arena.addIfElse(ltPt, trueLit, falseLit));
          } else if (isTp) {
            const ltPt = arena.addBinaryExpr(BinOp.Lt, etExpr, ptExprId);
            qRhs = arena.addIfElse(ltPt, inExprId, falseLit);
          } else {
            const gtePt = arena.addBinaryExpr(BinOp.Gte, etExpr, ptExprId);
            qRhs = arena.addIfElse(gtePt, trueLit, falseLit);
          }
          arena.addEquation(EqKind.Simple, qExpr, qRhs);
        }

        // Bind any output arguments (Q => outVar, ET => outVar)
        for (const arg of stmt.args) {
          if (arg.direction === "out" && arg.expr.kind === "identifier") {
            const outFull = resolveCanonicalVarName(pou, arg.expr.name, varExprMap);
            if (arg.name?.toUpperCase() === "Q") {
              assignedVars.set(outFull, qExpr);
            } else if (arg.name?.toUpperCase() === "ET") {
              assignedVars.set(outFull, etExpr);
            }
          }
        }
      }
    }
  }
}

function lowerExpr(
  arena: DAEBuilder,
  interner: StringInterner,
  pou: PlcPou,
  expr: PlcExpr,
  varExprMap: Map<string, number>,
  defaultExprMap: Map<string, number>,
  assignedVars: Map<string, number>,
): number {
  if (expr.kind === "literal") {
    if (expr.literalType === "bool") {
      return arena.addBoolLiteral(Boolean(expr.value));
    }
    if (expr.literalType === "number") {
      return arena.addRealLiteral(Number(expr.value));
    }
    if (expr.literalType === "time") {
      const ms = parseDurationSeconds(expr.value);
      return arena.addRealLiteral(ms);
    }
    return arena.addRealLiteral(0.0);
  }

  if (expr.kind === "identifier") {
    const fullName = `${pou.name}.${expr.name}`;
    const id = varExprMap.get(fullName) ?? varExprMap.get(expr.name);
    if (id !== undefined) return id;

    // Auto-declare missing identifier with default binding
    const nameId = interner.intern(fullName);
    arena.addVariable(fullName, VarType.Real, Variability.Continuous, Causality.Local);
    const exprId = arena.addExpression(ExprKind.Name, nameId);
    varExprMap.set(fullName, exprId);
    const zeroId = arena.addRealLiteral(0.0);
    defaultExprMap.set(fullName, zeroId);
    assignedVars.set(fullName, zeroId);
    return exprId;
  }

  if (expr.kind === "member") {
    const objName = (expr.object as { name?: string }).name ?? "";
    const memberFull = `${pou.name}.${objName}.${expr.property}`;
    const existing = varExprMap.get(memberFull);
    if (existing !== undefined) return existing;
    return arena.addRealLiteral(0.0);
  }

  if (expr.kind === "binary") {
    const leftId = lowerExpr(arena, interner, pou, expr.left, varExprMap, defaultExprMap, assignedVars);
    const rightId = lowerExpr(arena, interner, pou, expr.right, varExprMap, defaultExprMap, assignedVars);
    const binOp = mapBinaryOp(expr.op);
    return arena.addBinaryExpr(binOp, leftId, rightId);
  }

  if (expr.kind === "unary") {
    const argId = lowerExpr(arena, interner, pou, expr.argument, varExprMap, defaultExprMap, assignedVars);
    const unOp = mapUnaryOp(expr.op);
    return arena.addUnaryExpr(unOp, argId);
  }

  return arena.addRealLiteral(0.0);
}

function mapBinaryOp(op: PlcBinaryOp): BinOp {
  switch (op) {
    case "+":
      return BinOp.Add;
    case "-":
      return BinOp.Sub;
    case "*":
      return BinOp.Mul;
    case "/":
      return BinOp.Div;
    case "=":
      return BinOp.Eq;
    case "<>":
      return BinOp.Neq;
    case "<":
      return BinOp.Lt;
    case "<=":
      return BinOp.Lte;
    case ">":
      return BinOp.Gt;
    case ">=":
      return BinOp.Gte;
    case "AND":
      return BinOp.And;
    case "OR":
      return BinOp.Or;
    case "XOR":
      return BinOp.Neq;
    default:
      return BinOp.Add;
  }
}

function mapUnaryOp(op: PlcUnaryOp): UnaryOp {
  switch (op) {
    case "-":
      return UnaryOp.Negate;
    case "NOT":
      return UnaryOp.Not;
    default:
      return UnaryOp.Negate;
  }
}

function parseDurationSeconds(val: unknown): number {
  if (typeof val === "number") return val / 1000;
  if (typeof val === "string") {
    const m = /(?:T|TIME)#(\d+)(ms|s|m|h)?/i.exec(val);
    if (m) {
      const n = parseInt(m[1] ?? "0", 10);
      const u = (m[2] ?? "ms").toLowerCase();
      if (u === "ms") return n / 1000;
      if (u === "s") return n;
      if (u === "m") return n * 60;
      if (u === "h") return n * 3600;
    }
  }
  return 0.0;
}
