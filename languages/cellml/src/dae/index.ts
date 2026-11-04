// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/cellml — Direct Linear-Memory DAEBuilder Lowering.
 *
 * Lowers CellML component variables, cross-component connection alias equations,
 * algebraic equations, and state ODEs directly into ModelScript's WebAssembly DAEBuilder arena.
 */

import { BinOp, Causality, DAEBuilder, EqKind, Variability, VarType } from "@modelscript/runtime";
import { resolveCellmlConnections } from "../solvers/index.js";
import type { CellmlComponent, CellmlDocument } from "../types.js";

export interface CellmlDaeOptions {
  builder?: DAEBuilder | undefined;
  modelName?: string | undefined;
}

function sanitizeDaeIdent(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_]/g, "_");
}

function tokenizeMathInfix(expr: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  const n = expr.length;
  while (i < n) {
    const ch = expr[i] ?? "";
    const next = expr[i + 1] ?? "";
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (
      (ch === ">" && next === "=") ||
      (ch === "<" && next === "=") ||
      (ch === "=" && next === "=") ||
      (ch === "!" && next === "=") ||
      (ch === "&" && next === "&") ||
      (ch === "|" && next === "|")
    ) {
      tokens.push(ch + next);
      i += 2;
      continue;
    }
    if ("+-*/^%(),><=!".includes(ch)) {
      tokens.push(ch);
      i++;
      continue;
    }
    if (/[0-9.]/.test(ch)) {
      let numStr = "";
      while (i < n && /[0-9.eE+-]/.test(expr[i] ?? "")) {
        if ((expr[i] === "+" || expr[i] === "-") && !/[eE]/.test(expr[i - 1] ?? "")) {
          break;
        }
        numStr += expr[i] ?? "";
        i++;
      }
      tokens.push(numStr);
      continue;
    }
    if (/[a-zA-Z_]/.test(ch)) {
      let idStr = "";
      while (i < n && /[a-zA-Z0-9_]/.test(expr[i] ?? "")) {
        idStr += expr[i] ?? "";
        i++;
      }
      tokens.push(idStr);
      continue;
    }
    i++;
  }
  return tokens;
}

/**
 * Lowers a parsed CellML document into ModelScript's linear-memory DAEBuilder arena.
 */
export function lowerCellmlToDae(doc: CellmlDocument, options?: CellmlDaeOptions): DAEBuilder {
  const modelName = sanitizeDaeIdent(options?.modelName ?? (doc.name || "CellmlModel"));
  const dae = options?.builder ?? new DAEBuilder(undefined, modelName);

  const { targetToSource, canonicalSource } = resolveCellmlConnections(doc);

  const odeTargetQuals = new Set<string>();
  const algTargetQuals = new Set<string>();
  const independentQuals = new Set<string>();

  for (const comp of doc.components.values()) {
    for (const eq of comp.equations) {
      if (!eq.targetVariable) continue;
      const qual = `${comp.name}.${eq.targetVariable}`;
      if (eq.isOde) {
        odeTargetQuals.add(qual);
        if (eq.independentVariable) {
          const indepQual = `${comp.name}.${eq.independentVariable}`;
          independentQuals.add(indepQual);
          const canIndep = canonicalSource.get(indepQual);
          if (canIndep) independentQuals.add(canIndep);
        }
      } else {
        algTargetQuals.add(qual);
      }
    }
  }

  // 1. Declare all component variables in DAEBuilder
  const qualToVarId = new Map<string, number>();

  for (const comp of doc.components.values()) {
    for (const v of comp.variables.values()) {
      const qual = `${comp.name}.${v.name}`;
      const daeVarName = sanitizeDaeIdent(`${comp.name}_${v.name}`);

      const isConnectedInput = targetToSource.has(qual);
      const isOde = odeTargetQuals.has(qual);
      const isAlg = algTargetQuals.has(qual);
      const isIndep =
        independentQuals.has(qual) ||
        ((v.name === "time" || v.name === "t") &&
          v.initialValue === undefined &&
          !isConnectedInput &&
          !isOde &&
          !isAlg);
      if (isIndep) independentQuals.add(qual);

      const isParameter = !isConnectedInput && !isOde && !isAlg && !isIndep;

      const variability = isParameter ? Variability.Parameter : Variability.Continuous;
      let causality = Causality.Local;
      if (v.publicInterface === "out" || v.privateInterface === "out") {
        causality = Causality.Output;
      } else if (v.publicInterface === "in" || v.privateInterface === "in") {
        causality = Causality.Input;
      }

      const varId = dae.addVariable(daeVarName, VarType.Real, variability, causality, v.initialValue ?? 0.0);
      qualToVarId.set(qual, varId);
    }
  }

  // 2. Emit parameter bindings and root independent variable bindings
  for (const comp of doc.components.values()) {
    for (const v of comp.variables.values()) {
      const qual = `${comp.name}.${v.name}`;
      const varId = qualToVarId.get(qual);
      if (varId === undefined) continue;

      const isConnectedInput = targetToSource.has(qual);
      const isOde = odeTargetQuals.has(qual);
      const isAlg = algTargetQuals.has(qual);
      const isIndep = independentQuals.has(qual);

      if (isConnectedInput || isOde || isAlg) continue;

      if (isIndep) {
        dae.addEquation(EqKind.Simple, dae.addName(varId), dae.addNameExpr("time"));
      } else {
        dae.addEquation(EqKind.Simple, dae.addName(varId), dae.addRealLiteral(v.initialValue ?? 0.0));
      }
    }
  }

  // 3. Emit cross-component connection alias equations: target = source
  for (const [targetQual, sourceQual] of targetToSource.entries()) {
    // Avoid emitting duplicate equation if targetQual is already assigned by an equation in its component
    if (odeTargetQuals.has(targetQual) || algTargetQuals.has(targetQual)) continue;
    const targetId = qualToVarId.get(targetQual);
    const sourceId = qualToVarId.get(sourceQual);
    if (targetId !== undefined && sourceId !== undefined) {
      dae.addEquation(EqKind.Simple, dae.addName(targetId), dae.addName(sourceId));
    }
  }

  // Helper to lower an infix expression within a component scope to DAEBuilder expression ID
  const lowerExprInComponent = (expr: string, comp: CellmlComponent): number => {
    const tokens = tokenizeMathInfix(expr);
    let pos = 0;

    const peek = (): string | undefined => tokens[pos];
    const consume = (): string => tokens[pos++] ?? "";

    const parseExpr = (): number => parseAddSub();

    const parseAddSub = (): number => {
      let left = parseMulDiv();
      while (
        peek() === "+" ||
        peek() === "-" ||
        peek() === ">" ||
        peek() === "<" ||
        peek() === ">=" ||
        peek() === "<=" ||
        peek() === "==" ||
        peek() === "!=" ||
        peek() === "&&" ||
        peek() === "||"
      ) {
        const op = consume();
        const right = parseMulDiv();
        if (op === "-") {
          left = dae.addBinaryExpr(BinOp.Sub, left, right);
        } else {
          left = dae.addBinaryExpr(BinOp.Add, left, right);
        }
      }
      return left;
    };

    const parseMulDiv = (): number => {
      let left = parsePower();
      while (peek() === "*" || peek() === "/" || peek() === "%") {
        const op = consume();
        const right = parsePower();
        left = op === "*" ? dae.addBinaryExpr(BinOp.Mul, left, right) : dae.addBinaryExpr(BinOp.Div, left, right);
      }
      return left;
    };

    const parsePower = (): number => {
      const base = parseUnary();
      if (peek() === "^") {
        consume();
        const exp = parsePower();
        return dae.addBinaryExpr(BinOp.Pow, base, exp);
      }
      return base;
    };

    const parseUnary = (): number => {
      if (peek() === "-") {
        consume();
        return dae.addNegateExpr(parseUnary());
      }
      if (peek() === "+" || peek() === "!") {
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
      if (peek() === "(") {
        consume();
        const args: number[] = [];
        if (peek() && peek() !== ")") {
          args.push(parseExpr());
          while (peek() === ",") {
            consume();
            args.push(parseExpr());
          }
        }
        if (peek() === ")") consume();
        if (ident === "pow" && args[0] !== undefined && args[1] !== undefined) {
          return dae.addBinaryExpr(BinOp.Pow, args[0], args[1]);
        }
        const mappedFn = ident === "ln" ? "log" : ident;
        return dae.addCallExpr(mappedFn, args);
      }

      if (ident === "pi") return dae.addRealLiteral(Math.PI);
      if (ident === "e") return dae.addRealLiteral(Math.E);

      const qual = `${comp.name}.${ident}`;
      if (independentQuals.has(qual)) {
        return dae.addNameExpr("time");
      }
      const varId = qualToVarId.get(qual);
      if (varId !== undefined) {
        return dae.addName(varId);
      }
      if (ident === "time" || ident === "t") {
        return dae.addNameExpr("time");
      }
      return dae.addRealLiteral(0.0);
    };

    return parseExpr();
  };

  // 4. Emit component algebraic and ODE equations
  for (const comp of doc.components.values()) {
    for (const eq of comp.equations) {
      if (!eq.targetVariable) continue;
      const qual = `${comp.name}.${eq.targetVariable}`;
      const targetVarId = qualToVarId.get(qual);
      if (targetVarId === undefined) continue;

      const rhsExprId = lowerExprInComponent(eq.rhsExpression, comp);
      if (eq.isOde) {
        dae.addEquation(EqKind.Simple, dae.addDer(targetVarId), rhsExprId);
      } else {
        dae.addEquation(EqKind.Simple, dae.addName(targetVarId), rhsExprId);
      }
    }
  }

  return dae;
}
