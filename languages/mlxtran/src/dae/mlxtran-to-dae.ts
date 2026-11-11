// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/mlxtran — Direct Linear-Memory DAE Arena Lowering for Monolix MLXTRAN.
 *
 * Compiles parameters, differential states (ddt_X), algebraic concentrations,
 * and PK macros directly into ModelScript's zero-GC DAEBuilder arena.
 */

import { BinOp, Causality, DAEBuilder, EqKind, Variability, VarType } from "@modelscript/runtime";
import type { MlxtranDocument } from "../types.js";

export interface MlxtranDaeOptions {
  builder?: DAEBuilder | undefined;
  modelName?: string | undefined;
  defaultDose?: number | undefined;
}

export function tokenizeMlxtranExpr(expr: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  const n = expr.length;

  while (i < n) {
    const ch = expr[i]!;
    if (/\s/.test(ch)) {
      i++;
      continue;
    }

    if (
      (ch === "*" && expr[i + 1] === "*") ||
      (ch === ">" && expr[i + 1] === "=") ||
      (ch === "<" && expr[i + 1] === "=") ||
      (ch === "=" && expr[i + 1] === "=")
    ) {
      tokens.push(expr.slice(i, i + 2));
      i += 2;
      continue;
    }

    if ("+-*/^(),=<>".includes(ch)) {
      tokens.push(ch);
      i++;
      continue;
    }

    if (/[0-9.]/.test(ch)) {
      let numStr = "";
      while (i < n && /[0-9.eE+-]/.test(expr[i]!)) {
        if ((expr[i] === "+" || expr[i] === "-") && !/[eE]/.test(expr[i - 1] ?? "")) {
          break;
        }
        numStr += expr[i]!;
        i++;
      }
      tokens.push(numStr);
      continue;
    }

    if (/[a-zA-Z_]/.test(ch)) {
      let idStr = "";
      while (i < n && /[a-zA-Z0-9_]/.test(expr[i]!)) {
        idStr += expr[i]!;
        i++;
      }
      tokens.push(idStr);
      continue;
    }

    tokens.push(ch);
    i++;
  }

  return tokens;
}

export function lowerMlxtranToDae(doc: MlxtranDocument, options?: MlxtranDaeOptions): DAEBuilder {
  const model = doc.model;
  const rawName = options?.modelName ?? model.name ?? "MlxtranModel";
  const modelName = rawName.replace(/[^a-zA-Z0-9_]/g, "_") || "MlxtranModel";
  const dae = options?.builder ?? new DAEBuilder(undefined, modelName);

  const addAdd = (a: number, b: number): number => dae.addBinaryExpr(BinOp.Add, a, b);
  const addSub = (a: number, b: number): number => dae.addBinaryExpr(BinOp.Sub, a, b);
  const addMul = (a: number, b: number): number => dae.addBinaryExpr(BinOp.Mul, a, b);
  const addDiv = (a: number, b: number): number => dae.addBinaryExpr(BinOp.Div, a, b);
  const addPow = (a: number, b: number): number => dae.addBinaryExpr(BinOp.Pow, a, b);

  const varMap = new Map<string, number>();

  const ensureVariable = (name: string, variability: Variability, causality: Causality, startVal: number): number => {
    const key = name.toLowerCase();
    const existing = varMap.get(key);
    if (existing !== undefined) return existing;
    const vId = dae.addVariable(name, VarType.Real, variability, causality, startVal);
    varMap.set(key, vId);
    return vId;
  };

  // 1. Declare parameters from input = { ... }
  for (const inp of model.inputs) {
    const val = inp.init ?? (inp.min !== undefined && inp.min > 0 ? inp.min : 1.0);
    const vId = ensureVariable(inp.name, Variability.Parameter, Causality.Local, val);
    dae.addEquation(EqKind.Simple, dae.addName(vId), dae.addRealLiteral(val));
  }

  // 2. Discover all state variables from ddt_ equations and macros
  const stateNames = new Set<string>();
  for (const eq of model.equations) {
    if (eq.isDerivative && eq.stateName) {
      stateNames.add(eq.stateName);
    }
  }
  for (const mac of model.macros) {
    if (mac.params["amount"]) stateNames.add(mac.params["amount"]);
    if (mac.params["target"]) stateNames.add(mac.params["target"]);
  }

  const defaultDose = options?.defaultDose ?? 100.0;

  // Allocate state variables
  for (const st of stateNames) {
    const isDepot = st.toLowerCase().includes("depot") || st.toLowerCase().includes("ad") || st.toLowerCase() === "a1";
    const initAmt = isDepot ? defaultDose : 0.0;
    ensureVariable(st, Variability.Continuous, Causality.Local, initAmt);
  }

  // Helper to lower infix arithmetic expression into DAEBuilder ExprId
  const lowerExpr = (exprStr: string): number => {
    const tokens = tokenizeMlxtranExpr(exprStr);
    let pos = 0;

    const peek = (): string | undefined => tokens[pos];
    const consume = (): string => tokens[pos++] ?? "";

    const parseExpr = (): number => parseAddSub();

    const parseAddSub = (): number => {
      let left = parseMulDiv();
      while (peek() === "+" || peek() === "-") {
        const op = consume();
        const right = parseMulDiv();
        left = op === "+" ? addAdd(left, right) : addSub(left, right);
      }
      return left;
    };

    const parseMulDiv = (): number => {
      let left = parsePower();
      while (peek() === "*" || peek() === "/") {
        const op = consume();
        const right = parsePower();
        left = op === "*" ? addMul(left, right) : addDiv(left, right);
      }
      return left;
    };

    const parsePower = (): number => {
      const base = parseUnary();
      if (peek() === "^" || peek() === "**") {
        consume();
        const exp = parsePower();
        return addPow(base, exp);
      }
      return base;
    };

    const parseUnary = (): number => {
      if (peek() === "-") {
        consume();
        return dae.addNegateExpr(parseUnary());
      }
      if (peek() === "+") {
        consume();
        return parseUnary();
      }
      return parsePrimary();
    };

    const parsePrimary = (): number => {
      const tok = peek();
      if (!tok) return dae.addRealLiteral(0.0);

      if (tok === "(") {
        consume();
        const inner = parseExpr();
        if (peek() === ")") consume();
        return inner;
      }

      const num = Number(tok);
      if (!Number.isNaN(num)) {
        consume();
        return dae.addRealLiteral(num);
      }

      const ident = consume();
      const lowerIdent = ident.toLowerCase();

      // Math functions
      if (["exp", "log", "ln", "sqrt", "sin", "cos", "abs"].includes(lowerIdent) && peek() === "(") {
        consume(); // '('
        const arg = parseExpr();
        if (peek() === ")") consume();
        return dae.addCallExpr(lowerIdent === "ln" ? "log" : lowerIdent, [arg]);
      }

      // Check existing or ensure variable
      let vId = varMap.get(lowerIdent);
      if (vId === undefined) {
        vId = ensureVariable(ident, Variability.Continuous, Causality.Local, 0.0);
      }
      return dae.addName(vId);
    };

    return parseExpr();
  };

  // 3. Lower derivative equations (ddt_X = RHS)
  const handledDerivStates = new Set<string>();

  for (const eq of model.equations) {
    if (eq.isDerivative && eq.stateName) {
      const stName = eq.stateName;
      const vId = ensureVariable(stName, Variability.Continuous, Causality.Local, 0.0);
      const derivExprId = dae.addDer(vId);
      const rhsExprId = lowerExpr(eq.rhs);
      dae.addEquation(EqKind.Simple, derivExprId, rhsExprId);
      handledDerivStates.add(stName.toLowerCase());
    }
  }

  // 4. Lower algebraic equations (Y = RHS)
  for (const eq of model.equations) {
    if (!eq.isDerivative) {
      const vId = ensureVariable(eq.lhs, Variability.Continuous, Causality.Local, 0.0);
      const lhsExprId = dae.addName(vId);
      const rhsExprId = lowerExpr(eq.rhs);
      dae.addEquation(EqKind.Simple, lhsExprId, rhsExprId);
    }
  }

  // 5. Expand macros into differential equations if not defined explicitly
  for (const st of stateNames) {
    if (!handledDerivStates.has(st.toLowerCase())) {
      const vId = ensureVariable(st, Variability.Continuous, Causality.Local, 0.0);
      const derivExprId = dae.addDer(vId);
      dae.addEquation(EqKind.Simple, derivExprId, dae.addRealLiteral(0.0));
    }
  }

  return dae;
}
