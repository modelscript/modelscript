// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/bngl — Direct Linear-Memory DAE Arena Lowering for BioNetGen Models.
 *
 * Expands rule-based seed species and reaction rules into a concrete reaction network
 * and lowers compartments, parameters, concrete species, observables, and mass-action
 * reaction fluxes directly into ModelScript's zero-GC DAEBuilder.
 */

import { BinOp, Causality, DAEBuilder, EqKind, Variability, VarType } from "@modelscript/runtime";
import { generateBnglNetwork } from "../solvers/bngl-solver.js";
import type { BnglDocument } from "../types.js";

export interface BnglDaeOptions {
  builder?: DAEBuilder | undefined;
  modelName?: string | undefined;
  maxIterations?: number | undefined;
  maxSpecies?: number | undefined;
}

function isDigit(ch: string): boolean {
  return ch >= "0" && ch <= "9";
}

function isAlpha(ch: string): boolean {
  return (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch === "_";
}

function isAlphaNum(ch: string): boolean {
  return isAlpha(ch) || isDigit(ch);
}

function sanitizeIdentifier(name: string): string {
  let out = "";
  for (let i = 0; i < name.length; i++) {
    const ch = name[i] ?? "";
    out += isAlphaNum(ch) ? ch : "_";
  }
  return out.length > 0 ? out : "BioNetGenModel";
}

function tokenizeFormula(expr: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  const n = expr.length;
  while (i < n) {
    const ch = expr[i] ?? "";
    if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n") {
      i++;
      continue;
    }
    if (ch === "*" && expr[i + 1] === "*") {
      tokens.push("^");
      i += 2;
      continue;
    }
    if ("+-*/^(),".includes(ch)) {
      tokens.push(ch);
      i++;
      continue;
    }
    if (isDigit(ch) || (ch === "." && isDigit(expr[i + 1] ?? ""))) {
      let numStr = "";
      while (i < n && isDigit(expr[i] ?? "")) {
        numStr += expr[i] ?? "";
        i++;
      }
      if (i < n && expr[i] === ".") {
        numStr += ".";
        i++;
        while (i < n && isDigit(expr[i] ?? "")) {
          numStr += expr[i] ?? "";
          i++;
        }
      }
      if (i < n && (expr[i] === "e" || expr[i] === "E")) {
        const next = expr[i + 1] ?? "";
        const next2 = expr[i + 2] ?? "";
        if (isDigit(next) || ((next === "+" || next === "-") && isDigit(next2))) {
          numStr += expr[i] ?? "";
          i++;
          if (expr[i] === "+" || expr[i] === "-") {
            numStr += expr[i] ?? "";
            i++;
          }
          while (i < n && isDigit(expr[i] ?? "")) {
            numStr += expr[i] ?? "";
            i++;
          }
        }
      }
      tokens.push(numStr);
      continue;
    }
    if (isAlpha(ch)) {
      let idStr = "";
      while (i < n && isAlphaNum(expr[i] ?? "")) {
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

export function lowerBnglToDae(doc: BnglDocument, options?: BnglDaeOptions): DAEBuilder {
  const model = doc.model;
  const network = generateBnglNetwork(doc, {
    maxIterations: options?.maxIterations,
    maxSpecies: options?.maxSpecies,
  });

  const modelName = sanitizeIdentifier(options?.modelName ?? (model.id || "BioNetGenNetwork"));
  const dae = options?.builder ?? new DAEBuilder(undefined, modelName);

  const addAdd = (a: number, b: number): number => dae.addBinaryExpr(BinOp.Add, a, b);
  const addSub = (a: number, b: number): number => dae.addBinaryExpr(BinOp.Sub, a, b);
  const addMul = (a: number, b: number): number => dae.addBinaryExpr(BinOp.Mul, a, b);
  const addDiv = (a: number, b: number): number => dae.addBinaryExpr(BinOp.Div, a, b);
  const addPow = (a: number, b: number): number => dae.addBinaryExpr(BinOp.Pow, a, b);
  const addCall = (fn: string, args: number[]): number => dae.addCallExpr(fn, args);

  // 1. Declare Compartments
  const compVarMap = new Map<string, number>();
  if (model.compartments.size === 0) {
    const vDefault = dae.addVariable(
      "V_default_compartment",
      VarType.Real,
      Variability.Parameter,
      Causality.Local,
      1.0,
    );
    compVarMap.set("default_compartment", vDefault);
    dae.addEquation(EqKind.Simple, dae.addName(vDefault), dae.addRealLiteral(1.0));
  } else {
    for (const [cId, comp] of model.compartments) {
      const sizeVal = comp.size > 0 ? comp.size : 1.0;
      const vId = dae.addVariable(`V_${cId}`, VarType.Real, Variability.Parameter, Causality.Local, sizeVal);
      compVarMap.set(cId, vId);
      dae.addEquation(EqKind.Simple, dae.addName(vId), dae.addRealLiteral(sizeVal));
    }
  }

  // 2. Declare Parameters
  const paramVarMap = new Map<string, number>();
  for (const [pId, param] of model.parameters) {
    const pVar = dae.addVariable(`param_${pId}`, VarType.Real, Variability.Parameter, Causality.Local, param.value);
    paramVarMap.set(pId, pVar);
    dae.addEquation(EqKind.Simple, dae.addName(pVar), dae.addRealLiteral(param.value));
  }

  // 3. Declare Expanded Concrete Species
  const speciesVarMap = new Map<string, number>();
  for (const sp of network.species) {
    const sVar = dae.addVariable(
      sp.id,
      VarType.Real,
      sp.constant ? Variability.Parameter : Variability.Continuous,
      Causality.Local,
      sp.initialConcentration,
    );
    speciesVarMap.set(sp.id, sVar);
  }

  // 4. Declare Observables and Emit Observable Algebraic Equations
  const obsVarMap = new Map<string, number>();
  for (const grp of network.observableGroups) {
    const oVar = dae.addVariable(`obs_${grp.name}`, VarType.Real, Variability.Continuous, Causality.Output, 0.0);
    obsVarMap.set(grp.name, oVar);

    let sumExpr: number | null = null;
    for (const [spId, weight] of grp.weights) {
      const sVar = speciesVarMap.get(spId);
      if (sVar === undefined) continue;
      const term = weight === 1 ? dae.addName(sVar) : addMul(dae.addRealLiteral(weight), dae.addName(sVar));
      sumExpr = sumExpr === null ? term : addAdd(sumExpr, term);
    }

    dae.addEquation(EqKind.Simple, dae.addName(oVar), sumExpr !== null ? sumExpr : dae.addRealLiteral(0.0));
  }

  // Helper to lower formula into DAEBuilder expression ID
  const lowerFormulaExpr = (formula: string): number => {
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
        return addCall(ident, args);
      }

      if (ident === "time" || ident === "t") return dae.addNameExpr("time");
      if (ident === "pi") return dae.addRealLiteral(Math.PI);
      if (ident === "e") return dae.addRealLiteral(Math.E);

      const sVar = speciesVarMap.get(ident);
      if (sVar !== undefined) return dae.addName(sVar);

      const pVar = paramVarMap.get(ident);
      if (pVar !== undefined) return dae.addName(pVar);

      const oVar = obsVarMap.get(ident);
      if (oVar !== undefined) return dae.addName(oVar);

      const cVar = compVarMap.get(ident);
      if (cVar !== undefined) return dae.addName(cVar);

      return dae.addRealLiteral(0.0);
    };

    return parseExpr();
  };

  // 5. Declare Reaction Flux Variables & Equations
  const rxnFluxMap = new Map<string, number>();
  for (const rxn of network.reactions) {
    const fluxVar = dae.addVariable(`v_${rxn.id}`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
    rxnFluxMap.set(rxn.id, fluxVar);
    dae.addEquation(EqKind.Simple, dae.addName(fluxVar), lowerFormulaExpr(rxn.rateLaw));
  }

  // 6. Emit Concrete Species Differential Balance Equations
  for (const sp of network.species) {
    const sVar = speciesVarMap.get(sp.id)!;
    if (sp.constant) {
      dae.addEquation(EqKind.Simple, dae.addName(sVar), dae.addRealLiteral(sp.initialConcentration));
      continue;
    }

    let netFluxExpr: number | null = null;
    for (const rxn of network.reactions) {
      const fluxVar = rxnFluxMap.get(rxn.id);
      if (fluxVar === undefined) continue;

      let stoichDelta = 0;
      for (const rId of rxn.reactantIds) {
        if (rId === sp.id) stoichDelta -= 1;
      }
      for (const pId of rxn.productIds) {
        if (pId === sp.id) stoichDelta += 1;
      }

      if (stoichDelta < 0) {
        const coeff = Math.abs(stoichDelta);
        const term = coeff === 1 ? dae.addName(fluxVar) : addMul(dae.addRealLiteral(coeff), dae.addName(fluxVar));
        netFluxExpr = netFluxExpr === null ? addSub(dae.addRealLiteral(0.0), term) : addSub(netFluxExpr, term);
      } else if (stoichDelta > 0) {
        const term =
          stoichDelta === 1 ? dae.addName(fluxVar) : addMul(dae.addRealLiteral(stoichDelta), dae.addName(fluxVar));
        netFluxExpr = netFluxExpr === null ? term : addAdd(netFluxExpr, term);
      }
    }

    const cVar = (sp.compartment ? compVarMap.get(sp.compartment) : undefined) ?? compVarMap.get("default_compartment");

    let rhs: number;
    if (netFluxExpr !== null) {
      rhs = cVar !== undefined ? addDiv(netFluxExpr, dae.addName(cVar)) : netFluxExpr;
    } else {
      rhs = dae.addRealLiteral(0.0);
    }

    dae.addEquation(EqKind.Simple, dae.addDer(sVar), rhs);
  }

  return dae;
}
