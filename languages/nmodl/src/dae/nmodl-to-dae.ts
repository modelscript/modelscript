// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/nmodl — Direct Linear-Memory DAE Arena Lowering for NEURON NMODL.
 *
 * Compiles Hodgkin-Huxley gating variables, reversal potentials, membrane voltage,
 * and ionic currents into ModelScript's zero-GC WebAssembly DAEBuilder arena.
 */

import { BinOp, Causality, DAEBuilder, EqKind, Variability, VarType } from "@modelscript/runtime";
import type { NmodlDocument } from "../types.js";

export interface NmodlDaeOptions {
  builder?: DAEBuilder | undefined;
  modelName?: string | undefined;
  cm?: number | undefined; // Membrane capacitance (uF/cm2, default 1.0)
  vRest?: number | undefined; // Resting membrane voltage (mV, default -65.0)
  iStim?: number | undefined; // Injected stimulation current (mA/cm2, default 0.0)
}

export function tokenizeNmodlExpr(expr: string): string[] {
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

export function lowerNmodlToDae(doc: NmodlDocument, options?: NmodlDaeOptions): DAEBuilder {
  const model = doc.model;
  const rawName = options?.modelName ?? model.suffix ?? "NmodlChannel";
  const modelName = `NMODL_${rawName.replace(/[^a-zA-Z0-9_]/g, "_")}`;
  const dae = options?.builder ?? new DAEBuilder(undefined, modelName);

  const addAdd = (a: number, b: number): number => dae.addBinaryExpr(BinOp.Add, a, b);
  const addSub = (a: number, b: number): number => dae.addBinaryExpr(BinOp.Sub, a, b);
  const addMul = (a: number, b: number): number => dae.addBinaryExpr(BinOp.Mul, a, b);
  const addDiv = (a: number, b: number): number => dae.addBinaryExpr(BinOp.Div, a, b);
  const addPow = (a: number, b: number): number => dae.addBinaryExpr(BinOp.Pow, a, b);

  const varMap = new Map<string, number>();
  const varsWithEquations = new Set<number>();

  const ensureVariable = (name: string, variability: Variability, causality: Causality, startVal: number): number => {
    const key = name.toLowerCase();
    const existing = varMap.get(key);
    if (existing !== undefined) return existing;
    const vId = dae.addVariable(name, VarType.Real, variability, causality, startVal);
    varMap.set(key, vId);
    return vId;
  };

  // 1. Declare PARAMETER entries
  for (const p of model.parameters) {
    const vId = ensureVariable(p.name, Variability.Parameter, Causality.Local, p.val);
    dae.addEquation(EqKind.Simple, dae.addName(vId), dae.addRealLiteral(p.val));
    varsWithEquations.add(vId);
  }

  // Ensure default reversal potentials if referenced but not declared
  for (const ion of model.ions) {
    for (const r of ion.read) {
      if (!varMap.has(r.toLowerCase())) {
        const defaultE = r.toLowerCase().includes("na") ? 50.0 : r.toLowerCase().includes("k") ? -77.0 : 0.0;
        const vId = ensureVariable(r, Variability.Parameter, Causality.Local, defaultE);
        dae.addEquation(EqKind.Simple, dae.addName(vId), dae.addRealLiteral(defaultE));
        varsWithEquations.add(vId);
      }
    }
  }

  // 2. Membrane Voltage v
  const vRest = options?.vRest ?? -65.0;
  const vId = ensureVariable("v", Variability.Continuous, Causality.Local, vRest);

  // Injected current parameter iStim
  const iStimVal = options?.iStim ?? 0.0;
  const iStimId = ensureVariable("iStim", Variability.Parameter, Causality.Local, iStimVal);
  dae.addEquation(EqKind.Simple, dae.addName(iStimId), dae.addRealLiteral(iStimVal));
  varsWithEquations.add(iStimId);

  // Membrane capacitance Cm
  const cmVal = options?.cm ?? 1.0;
  const cmId = ensureVariable("Cm", Variability.Parameter, Causality.Local, cmVal);
  dae.addEquation(EqKind.Simple, dae.addName(cmId), dae.addRealLiteral(cmVal));
  varsWithEquations.add(cmId);

  // 3. Declare STATE variables (m, h, n)
  for (const s of model.states) {
    ensureVariable(s.name, Variability.Continuous, Causality.Local, 0.1);
  }

  // 4. Expression lowerer
  const lowerExpr = (exprStr: string): number => {
    const tokens = tokenizeNmodlExpr(exprStr);
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
      if (["exp", "log", "sqrt", "sin", "cos", "abs"].includes(lowerIdent) && peek() === "(") {
        consume();
        const arg = parseExpr();
        if (peek() === ")") consume();
        return dae.addCallExpr(lowerIdent, [arg]);
      }

      let varIdx = varMap.get(lowerIdent);
      if (varIdx === undefined) {
        varIdx = ensureVariable(ident, Variability.Continuous, Causality.Local, 0.0);
      }
      return dae.addName(varIdx);
    };

    return parseExpr();
  };

  // 5. Lower DERIVATIVE equations (m' = ...)
  const handledDerivStates = new Set<string>();
  for (const eq of model.derivativeEquations) {
    if (eq.stateName) {
      const stName = eq.stateName;
      const sId = ensureVariable(stName, Variability.Continuous, Causality.Local, 0.1);
      const derivExprId = dae.addDer(sId);
      const rhsExprId = lowerExpr(eq.rhs);
      dae.addEquation(EqKind.Simple, derivExprId, rhsExprId);
      varsWithEquations.add(sId);
      handledDerivStates.add(stName.toLowerCase());
    }
  }

  // Fallback for states missing explicit derivative equation
  for (const s of model.states) {
    if (!handledDerivStates.has(s.name.toLowerCase())) {
      const sId = ensureVariable(s.name, Variability.Continuous, Causality.Local, 0.1);
      const derivExprId = dae.addDer(sId);
      dae.addEquation(EqKind.Simple, derivExprId, dae.addRealLiteral(0.0));
      varsWithEquations.add(sId);
    }
  }

  // 6. Lower BREAKPOINT equations (algebraic currents)
  const currentExprIds: number[] = [];

  for (const eq of model.breakpointEquations) {
    const vId = ensureVariable(eq.lhs, Variability.Continuous, Causality.Local, 0.0);
    const lhsExprId = dae.addName(vId);
    const rhsExprId = lowerExpr(eq.rhs);
    dae.addEquation(EqKind.Simple, lhsExprId, rhsExprId);
    varsWithEquations.add(vId);

    // Track write currents for membrane capacitor equation
    for (const ion of model.ions) {
      if (ion.write.some((w) => w.toLowerCase() === eq.lhs.toLowerCase())) {
        currentExprIds.push(lhsExprId);
      }
    }
  }

  // 7. Cell Membrane Capacitor ODE: C_m * der(v) = - sum(I_ion) + iStim
  let sumCurrentsExprId: number;
  if (currentExprIds.length === 0) {
    sumCurrentsExprId = dae.addRealLiteral(0.0);
  } else if (currentExprIds.length === 1) {
    sumCurrentsExprId = currentExprIds[0]!;
  } else {
    sumCurrentsExprId = currentExprIds[0]!;
    for (let i = 1; i < currentExprIds.length; i++) {
      sumCurrentsExprId = addAdd(sumCurrentsExprId, currentExprIds[i]!);
    }
  }

  // Net current = -sum(I_ion) + iStim
  const negSum = dae.addNegateExpr(sumCurrentsExprId);
  const netCurrentExpr = addAdd(negSum, dae.addName(iStimId));
  const dvdtRhs = addDiv(netCurrentExpr, dae.addName(cmId));

  dae.addEquation(EqKind.Simple, dae.addDer(vId), dvdtRhs);
  varsWithEquations.add(vId);

  // 8. Bind any remaining auxiliary variables to ensure structurally square system
  for (const [varName, curVId] of varMap.entries()) {
    if (!varsWithEquations.has(curVId)) {
      const defVal = varName.includes("inf") ? 0.5 : varName.includes("tau") ? 1.0 : 0.0;
      dae.addEquation(EqKind.Simple, dae.addName(curVId), dae.addRealLiteral(defVal));
      varsWithEquations.add(curVId);
    }
  }

  return dae;
}
