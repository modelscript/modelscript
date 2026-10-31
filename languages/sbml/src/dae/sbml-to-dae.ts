// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/sbml — Direct Linear-Memory DAE Arena Lowering for Biochemical Networks.
 *
 * Compiles SBML species, compartments, parameters, reactions, and stoichiometry into
 * ModelScript's zero-GC DAEBuilder:
 *   1. Species concentration state variables: S_i
 *   2. Compartment volumes & reaction fluxes: V_k, v_r
 *   3. Mass-action / kinetic stoichiometric balance ODEs: der(S_i)
 */

import { BinOp, Causality, DAEBuilder, EqKind, Variability, VarType } from "@modelscript/runtime";
import type { SbmlDocument } from "../types.js";

export interface SbmlDaeOptions {
  builder?: DAEBuilder | undefined;
  modelName?: string | undefined;
}

export function lowerSbmlToDae(doc: SbmlDocument, options?: SbmlDaeOptions): DAEBuilder {
  const model = doc.model;
  const modelName = (options?.modelName ?? (model.id || "SbmlBiochemicalNetwork")).replace(/[^a-zA-Z0-9_]/g, "_");
  const dae = options?.builder ?? new DAEBuilder(undefined, modelName);

  const addAdd = (a: number, b: number): number => dae.addBinaryExpr(BinOp.Add, a, b);
  const addSub = (a: number, b: number): number => dae.addBinaryExpr(BinOp.Sub, a, b);
  const addMul = (a: number, b: number): number => dae.addBinaryExpr(BinOp.Mul, a, b);
  const addDiv = (a: number, b: number): number => dae.addBinaryExpr(BinOp.Div, a, b);
  const addPow = (a: number, b: number): number => dae.addBinaryExpr(BinOp.Pow, a, b);
  const addCall = (fn: string, args: number[]): number => dae.addCallExpr(fn, args);

  // 1. Declare Compartments
  const compVarMap = new Map<string, number>();
  for (const [id, c] of model.compartments) {
    const sizeVal = c.size > 0 ? c.size : 1.0;
    const vId = dae.addVariable(
      `V_${id}`,
      VarType.Real,
      c.constant ? Variability.Parameter : Variability.Continuous,
      Causality.Local,
      sizeVal,
    );
    compVarMap.set(id, vId);
    if (c.constant) {
      dae.addEquation(EqKind.Simple, dae.addName(vId), dae.addRealLiteral(sizeVal));
    } else {
      dae.addEquation(EqKind.Simple, dae.addDer(vId), dae.addRealLiteral(0.0));
    }
  }

  // 2. Declare Global Parameters
  const paramVarMap = new Map<string, number>();
  for (const [id, p] of model.parameters) {
    const pVar = dae.addVariable(
      `param_${id}`,
      VarType.Real,
      p.constant ? Variability.Parameter : Variability.Continuous,
      Causality.Local,
      p.value,
    );
    paramVarMap.set(id, pVar);
    if (p.constant) {
      dae.addEquation(EqKind.Simple, dae.addName(pVar), dae.addRealLiteral(p.value));
    } else {
      dae.addEquation(EqKind.Simple, dae.addDer(pVar), dae.addRealLiteral(0.0));
    }
  }

  // 3. Declare Species Variables
  const speciesVarMap = new Map<string, number>();
  for (const [id, s] of model.species) {
    const cSize = model.compartments.get(s.compartment)?.size ?? 1.0;
    let initialConc = s.initialConcentration;
    if (initialConc === undefined && s.initialAmount !== undefined) {
      initialConc = s.initialAmount / Math.max(1e-9, cSize);
    }
    const val = initialConc ?? 0.0;

    const sVar = dae.addVariable(
      `S_${id}`,
      VarType.Real,
      s.constant ? Variability.Parameter : Variability.Continuous,
      Causality.Local,
      val,
    );
    speciesVarMap.set(id, sVar);
  }

  // Helper to lower kinetic law infix expression into DAEBuilder expression ID
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
        consume(); // '('
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

      if (ident === "time") return dae.addNameExpr("time");
      if (ident === "pi") return dae.addRealLiteral(Math.PI);
      if (ident === "e") return dae.addRealLiteral(Math.E);

      const localVar = localVarMap.get(ident);
      if (localVar !== undefined) return dae.addName(localVar);

      const sVar = speciesVarMap.get(ident);
      if (sVar !== undefined) return dae.addName(sVar);

      const pVar = paramVarMap.get(ident);
      if (pVar !== undefined) return dae.addName(pVar);

      const cVar = compVarMap.get(ident);
      if (cVar !== undefined) return dae.addName(cVar);

      return dae.addRealLiteral(0.0);
    };

    return parseExpr();
  };

  // 4. Declare Reaction Flux Variables
  const rxnFluxMap = new Map<string, number>();
  for (const [id, r] of model.reactions) {
    const localVarMap = new Map<string, number>();
    if (r.kineticLaw) {
      for (const [lpId, lp] of r.kineticLaw.parameters) {
        const lpVar = dae.addVariable(
          `param_${id}_${lpId}`,
          VarType.Real,
          lp.constant ? Variability.Parameter : Variability.Continuous,
          Causality.Local,
          lp.value,
        );
        localVarMap.set(lpId, lpVar);
        dae.addEquation(EqKind.Simple, dae.addName(lpVar), dae.addRealLiteral(lp.value));
      }
    }

    const fluxVar = dae.addVariable(`v_${id}`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
    rxnFluxMap.set(id, fluxVar);

    let fluxExpr: number;
    if (r.kineticLaw && r.kineticLaw.formula.trim().length > 0) {
      fluxExpr = lowerFormulaExpr(r.kineticLaw.formula, localVarMap);
    } else {
      // Fallback mass action velocity equation: v = 1.0 * [R1] * [R2] ...
      fluxExpr = dae.addRealLiteral(1.0);
      for (const ref of r.reactants) {
        const sVar = speciesVarMap.get(ref.species);
        if (sVar !== undefined) {
          fluxExpr = addMul(fluxExpr, dae.addName(sVar));
        }
      }
    }

    dae.addEquation(EqKind.Simple, dae.addName(fluxVar), fluxExpr);
  }

  // 5. Formulate Species Differential Balance Equations: der(S_i) = sum(stoich * v_r) / V_comp
  for (const [id, s] of model.species) {
    const sVar = speciesVarMap.get(id);
    if (sVar === undefined) continue;

    if (s.constant || s.boundaryCondition) {
      dae.addEquation(EqKind.Simple, dae.addDer(sVar), dae.addRealLiteral(0.0));
      continue;
    }

    let netFluxExpr: number | null = null;

    for (const [rId, r] of model.reactions) {
      const fluxVar = rxnFluxMap.get(rId);
      if (fluxVar === undefined) continue;

      // Check Reactants
      for (const ref of r.reactants) {
        if (ref.species === id) {
          const stoichLit = dae.addRealLiteral(ref.stoichiometry);
          const term = addMul(stoichLit, dae.addName(fluxVar));
          netFluxExpr = netFluxExpr === null ? addSub(dae.addRealLiteral(0.0), term) : addSub(netFluxExpr, term);
        }
      }

      // Check Products
      for (const ref of r.products) {
        if (ref.species === id) {
          const stoichLit = dae.addRealLiteral(ref.stoichiometry);
          const term = addMul(stoichLit, dae.addName(fluxVar));
          netFluxExpr = netFluxExpr === null ? term : addAdd(netFluxExpr, term);
        }
      }
    }

    const cVar = compVarMap.get(s.compartment);
    let rhs: number;
    if (netFluxExpr !== null) {
      if (cVar !== undefined) {
        rhs = addDiv(netFluxExpr, dae.addName(cVar));
      } else {
        const cSize = model.compartments.get(s.compartment)?.size ?? 1.0;
        const invVol = dae.addRealLiteral(1.0 / Math.max(1e-9, cSize));
        rhs = addMul(invVol, netFluxExpr);
      }
    } else {
      rhs = dae.addRealLiteral(0.0);
    }

    dae.addEquation(EqKind.Simple, dae.addDer(sVar), rhs);
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
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if ("+-*/^(),".includes(ch)) {
      tokens.push(ch);
      i++;
      continue;
    }
    if (/[0-9.]/.test(ch)) {
      let numStr = "";
      while (i < n) {
        const curr = expr[i];
        if (!curr || !/[0-9.eE+-]/.test(curr)) break;
        if ((curr === "+" || curr === "-") && !/[eE]/.test(expr[i - 1] ?? "")) {
          break;
        }
        numStr += curr;
        i++;
      }
      tokens.push(numStr);
      continue;
    }
    if (/[a-zA-Z_]/.test(ch)) {
      let idStr = "";
      while (i < n) {
        const curr = expr[i];
        if (!curr || !/[a-zA-Z0-9_]/.test(curr)) break;
        idStr += curr;
        i++;
      }
      tokens.push(idStr);
      continue;
    }
    i++;
  }
  return tokens;
}
