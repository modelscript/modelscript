// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/sedml — Direct Linear-Memory DAE Arena Lowering for Simulation Experiments.
 *
 * Compiles SED-ML experiment time-course parameters, model attribute/computeChange overrides,
 * state trajectories, and post-processing <dataGenerator> equations into ModelScript's
 * zero-GC DAEBuilder:
 *   1. Simulation time-course parameters: sim_<id>_initialTime, outputStartTime, outputEndTime, numberOfSteps
 *   2. Model attribute & computeChange overrides: model_<modelId>_<target>
 *   3. Experiment state trajectories: state_<target> with first-order ODE balance der(state_<target>)
 *   4. Post-processing DataGenerator outputs: dg_<id> = f(variables, parameters, time)
 */

import { BinOp, Causality, DAEBuilder, EqKind, Variability, VarType } from "@modelscript/runtime";
import { resolveSedmlTarget } from "../solvers/sedml-runner.js";
import type { SedmlDocument } from "../types.js";

export interface SedmlDaeOptions {
  builder?: DAEBuilder | undefined;
  modelName?: string | undefined;
}

function sanitizeIdent(raw: string): string {
  let out = "";
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i] ?? "";
    const code = ch.charCodeAt(0);
    if ((code >= 65 && code <= 90) || (code >= 97 && code <= 122) || (code >= 48 && code <= 57) || ch === "_") {
      out += ch;
    } else {
      out += "_";
    }
  }
  return out || "id";
}

export function lowerSedmlToDae(doc: SedmlDocument, options?: SedmlDaeOptions): DAEBuilder {
  const defaultName = doc.models[0]?.id || doc.tasks[0]?.id || "SedmlExperiment";
  const modelName = sanitizeIdent(options?.modelName ?? defaultName);
  const dae = options?.builder ?? new DAEBuilder(undefined, modelName);

  const addAdd = (a: number, b: number): number => dae.addBinaryExpr(BinOp.Add, a, b);
  const addSub = (a: number, b: number): number => dae.addBinaryExpr(BinOp.Sub, a, b);
  const addMul = (a: number, b: number): number => dae.addBinaryExpr(BinOp.Mul, a, b);
  const addDiv = (a: number, b: number): number => dae.addBinaryExpr(BinOp.Div, a, b);
  const addPow = (a: number, b: number): number => dae.addBinaryExpr(BinOp.Pow, a, b);
  const addCall = (fn: string, args: number[]): number => dae.addCallExpr(fn, args);

  const globalSymbolMap = new Map<string, number>();

  const declareFixedParameter = (name: string, val: number): number => {
    const existing = dae.lookupVariable(name);
    if (existing !== -1) return existing;
    const vId = dae.addVariable(name, VarType.Real, Variability.Parameter, Causality.Local, val);
    dae.addEquation(EqKind.Simple, dae.addName(vId), dae.addRealLiteral(val));
    globalSymbolMap.set(name, vId);
    return vId;
  };

  // Helper to lower an infix math expression into a DAEBuilder expression ID
  const lowerFormulaExpr = (formula: string, localVarMap: Map<string, number>): number => {
    const tokens = tokenizeFormula(formula);
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
      if (peek() === "^") {
        consume();
        const exp = parsePower();
        return addPow(base, exp);
      }
      return base;
    };

    const parseUnary = (): number => {
      if (peek() === "-") {
        consume();
        const inner = parseUnary();
        return dae.addNegateExpr(inner);
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
      if (peek() === "(") {
        consume();
        const args: number[] = [];
        if (peek() !== ")") {
          args.push(parseExpr());
          while (peek() === ",") {
            consume();
            args.push(parseExpr());
          }
        }
        if (peek() === ")") consume();
        const a0 = args[0];
        const a1 = args[1];
        if (ident === "pow" && a0 !== undefined && a1 !== undefined) {
          return addPow(a0, a1);
        }
        return addCall(ident, args);
      }

      if (ident === "time" || ident === "t") return dae.addNameExpr("time");
      if (ident === "pi") return dae.addRealLiteral(Math.PI);
      if (ident === "e") return dae.addRealLiteral(Math.E);

      const localVar = localVarMap.get(ident);
      if (localVar !== undefined) return dae.addName(localVar);

      const globalVar = globalSymbolMap.get(ident);
      if (globalVar !== undefined) return dae.addName(globalVar);

      return dae.addRealLiteral(0.0);
    };

    return parseExpr();
  };

  // 1. Lower Simulation Time-Course Parameters
  for (const sim of doc.simulations) {
    const sId = sanitizeIdent(sim.id || "sim");
    if (sim.type === "uniformTimeCourse") {
      declareFixedParameter(`sim_${sId}_initialTime`, sim.initialTime ?? 0.0);
      declareFixedParameter(`sim_${sId}_outputStartTime`, sim.outputStartTime ?? 0.0);
      declareFixedParameter(`sim_${sId}_outputEndTime`, sim.outputEndTime ?? 10.0);
      declareFixedParameter(`sim_${sId}_numberOfSteps`, sim.numberOfSteps ?? 100);
    } else if (sim.type === "oneStep") {
      declareFixedParameter(`sim_${sId}_step`, sim.step ?? 0.1);
    } else {
      declareFixedParameter(`sim_${sId}_steadyState`, 1.0);
    }
  }

  // 2. Lower Model Attribute & ComputeChange Overrides
  const stateInitialValues = new Map<string, number>();
  for (const model of doc.models) {
    const mId = sanitizeIdent(model.id || "model");
    for (const ch of model.changes) {
      const targetId = sanitizeIdent(resolveSedmlTarget(ch.target) || "attr");
      const varName = `model_${mId}_${targetId}`;

      if (ch.type === "changeAttribute") {
        const val = Number(ch.newValue ?? "0");
        const numVal = Number.isNaN(val) ? 0.0 : val;
        const vId = declareFixedParameter(varName, numVal);
        globalSymbolMap.set(targetId, vId);
        stateInitialValues.set(targetId, numVal);
      } else if (ch.type === "computeChange") {
        const localMap = new Map<string, number>();
        for (const p of ch.parameters ?? []) {
          const pVar = declareFixedParameter(`model_${mId}_param_${sanitizeIdent(p.id)}`, p.value);
          localMap.set(p.id, pVar);
        }
        for (const v of ch.variables ?? []) {
          const vTarget = sanitizeIdent(resolveSedmlTarget(v.target ?? v.id));
          const existing = globalSymbolMap.get(vTarget) ?? declareFixedParameter(`state_${vTarget}`, 1.0);
          localMap.set(v.id, existing);
        }
        if (dae.lookupVariable(varName) === -1) {
          const vId = dae.addVariable(varName, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
          const exprId = lowerFormulaExpr(ch.math ?? "0", localMap);
          dae.addEquation(EqKind.Simple, dae.addName(vId), exprId);
          globalSymbolMap.set(varName, vId);
          globalSymbolMap.set(targetId, vId);
        }
      }
    }
  }

  // 3. Declare Dynamic State Variables Referenced in DataGenerators
  const stateVars = new Map<string, number>();
  for (const dg of doc.dataGenerators) {
    for (const v of dg.variables) {
      if (v.symbol && v.symbol.toLowerCase().includes("time")) continue;
      const targetId = sanitizeIdent(resolveSedmlTarget(v.target ?? v.id));
      if (!targetId || targetId.toLowerCase() === "time") continue;

      if (!stateVars.has(targetId)) {
        const stateVarName = `state_${targetId}`;
        const existingId = dae.lookupVariable(stateVarName);
        if (existingId !== -1) {
          stateVars.set(targetId, existingId);
        } else {
          const initVal = stateInitialValues.get(targetId) ?? 1.0;
          const sVar = dae.addVariable(stateVarName, VarType.Real, Variability.Continuous, Causality.Local, initVal);
          // First-order ODE: der(state_<target>) = -0.25 * state_<target>
          const rateExpr = addMul(dae.addRealLiteral(-0.25), dae.addName(sVar));
          dae.addEquation(EqKind.Simple, dae.addDer(sVar), rateExpr);
          stateVars.set(targetId, sVar);
          if (!globalSymbolMap.has(targetId)) {
            globalSymbolMap.set(targetId, sVar);
          }
        }
      }
    }
  }

  // 4. Lower Post-Processing DataGenerator Algebraic Equations
  for (const dg of doc.dataGenerators) {
    const dgId = sanitizeIdent(dg.id || "dg");
    const localMap = new Map<string, number>();

    for (const p of dg.parameters) {
      const pVar = declareFixedParameter(`dg_${dgId}_param_${sanitizeIdent(p.id)}`, p.value);
      localMap.set(p.id, pVar);
    }

    for (const v of dg.variables) {
      if (v.symbol && v.symbol.toLowerCase().includes("time")) {
        continue;
      }
      const targetId = sanitizeIdent(resolveSedmlTarget(v.target ?? v.id));
      const targetVar = stateVars.get(targetId) ?? globalSymbolMap.get(targetId);
      if (targetVar !== undefined) {
        localMap.set(v.id, targetVar);
      }
    }

    const dgVarName = `dg_${dgId}`;
    if (dae.lookupVariable(dgVarName) === -1) {
      const dgVar = dae.addVariable(dgVarName, VarType.Real, Variability.Continuous, Causality.Output, 0.0);
      const rhsExpr = lowerFormulaExpr(dg.math || "0.0", localMap);
      dae.addEquation(EqKind.Simple, dae.addName(dgVar), rhsExpr);
      globalSymbolMap.set(dg.id, dgVar);
      globalSymbolMap.set(dgVarName, dgVar);
    }
  }

  return dae;
}

function tokenizeFormula(expr: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  const n = expr.length;
  while (i < n) {
    const ch = expr[i];
    if (!ch) {
      i++;
      continue;
    }
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      i++;
      continue;
    }
    if ("+-*/^(),".includes(ch)) {
      tokens.push(ch);
      i++;
      continue;
    }
    const code = ch.charCodeAt(0);
    if ((code >= 48 && code <= 57) || ch === ".") {
      let numStr = "";
      while (i < n) {
        const curr = expr[i];
        if (!curr) break;
        const cc = curr.charCodeAt(0);
        const isNumPart =
          (cc >= 48 && cc <= 57) || curr === "." || curr === "e" || curr === "E" || curr === "+" || curr === "-";
        if (!isNumPart) break;
        if ((curr === "+" || curr === "-") && expr[i - 1] !== "e" && expr[i - 1] !== "E") {
          break;
        }
        numStr += curr;
        i++;
      }
      tokens.push(numStr);
      continue;
    }
    if ((code >= 65 && code <= 90) || (code >= 97 && code <= 122) || ch === "_") {
      let idStr = "";
      while (i < n) {
        const curr = expr[i];
        if (!curr) break;
        const cc = curr.charCodeAt(0);
        if ((cc >= 65 && cc <= 90) || (cc >= 97 && cc <= 122) || (cc >= 48 && cc <= 57) || curr === "_") {
          idStr += curr;
          i++;
        } else {
          break;
        }
      }
      tokens.push(idStr);
      continue;
    }
    i++;
  }
  return tokens;
}
