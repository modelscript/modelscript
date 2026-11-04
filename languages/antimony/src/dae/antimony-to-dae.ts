// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/antimony — Direct Linear-Memory DAE Arena Lowering for Antimony Models.
 *
 * Compiles Antimony compartments, species, parameters, stoichiometric reactions,
 * rate rules, and assignment rules directly into ModelScript's zero-GC DAEBuilder.
 */

import { BinOp, Causality, DAEBuilder, EqKind, Variability, VarType } from "@modelscript/runtime";
import { flattenAntimonyModule } from "../solvers/antimony-solver.js";
import type { AntimonyDocument, AntimonyRule } from "../types.js";

export interface AntimonyDaeOptions {
  builder?: DAEBuilder | undefined;
  modelName?: string | undefined;
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
  return out.length > 0 ? out : "AntimonyModel";
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

export function lowerAntimonyToDae(doc: AntimonyDocument, options?: AntimonyDaeOptions): DAEBuilder {
  const mod = flattenAntimonyModule(doc, doc.mainModule);
  const modelName = sanitizeIdentifier(options?.modelName ?? (mod.id || "AntimonyPathway"));
  const dae = options?.builder ?? new DAEBuilder(undefined, modelName);

  const addAdd = (a: number, b: number): number => dae.addBinaryExpr(BinOp.Add, a, b);
  const addSub = (a: number, b: number): number => dae.addBinaryExpr(BinOp.Sub, a, b);
  const addMul = (a: number, b: number): number => dae.addBinaryExpr(BinOp.Mul, a, b);
  const addDiv = (a: number, b: number): number => dae.addBinaryExpr(BinOp.Div, a, b);
  const addPow = (a: number, b: number): number => dae.addBinaryExpr(BinOp.Pow, a, b);
  const addCall = (fn: string, args: number[]): number => dae.addCallExpr(fn, args);

  // Map rules by variable
  const rateRuleByVar = new Map<string, AntimonyRule>();
  const assignRuleByVar = new Map<string, AntimonyRule>();
  for (const rule of mod.rules) {
    if (rule.type === "rate") {
      rateRuleByVar.set(rule.variable, rule);
    } else if (rule.type === "assignment") {
      assignRuleByVar.set(rule.variable, rule);
    }
  }

  // 1. Declare Compartments
  const compVarMap = new Map<string, number>();
  if (mod.compartments.size === 0) {
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
    for (const [id, c] of mod.compartments) {
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
  }

  // 2. Declare Parameters
  const paramVarMap = new Map<string, number>();
  for (const [id, p] of mod.parameters) {
    const hasRule = rateRuleByVar.has(id) || assignRuleByVar.has(id);
    const isConst = p.constant && !hasRule;
    const pVar = dae.addVariable(
      `param_${id}`,
      VarType.Real,
      isConst ? Variability.Parameter : Variability.Continuous,
      Causality.Local,
      p.value,
    );
    paramVarMap.set(id, pVar);
    if (!hasRule) {
      if (isConst) {
        dae.addEquation(EqKind.Simple, dae.addName(pVar), dae.addRealLiteral(p.value));
      } else {
        dae.addEquation(EqKind.Simple, dae.addDer(pVar), dae.addRealLiteral(0.0));
      }
    }
  }

  // 3. Declare Species Variables (plus any rate-rule variables not in species or parameters)
  const speciesVarMap = new Map<string, number>();
  for (const [id, s] of mod.species) {
    const cSize = mod.compartments.get(s.compartment)?.size ?? 1.0;
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

  for (const rule of mod.rules) {
    if (
      (rule.type === "rate" || rule.type === "assignment") &&
      !speciesVarMap.has(rule.variable) &&
      !paramVarMap.has(rule.variable) &&
      !compVarMap.has(rule.variable)
    ) {
      const sVar = dae.addVariable(`S_${rule.variable}`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
      speciesVarMap.set(rule.variable, sVar);
    }
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

  // 4. Declare Reaction Flux Variables & Equations
  const rxnFluxMap = new Map<string, number>();
  for (const [id, r] of mod.reactions) {
    const fluxVar = dae.addVariable(`v_${id}`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
    rxnFluxMap.set(id, fluxVar);

    let fluxExpr: number;
    if (r.rateLaw && r.rateLaw.trim().length > 0) {
      fluxExpr = lowerFormulaExpr(r.rateLaw);
    } else {
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

  // 5. Emit Parameter Rule Equations (for parameters controlled by rate or assignment rules)
  for (const [id, pVar] of paramVarMap) {
    const assignRule = assignRuleByVar.get(id);
    const rateRule = rateRuleByVar.get(id);
    if (assignRule) {
      dae.addEquation(EqKind.Simple, dae.addName(pVar), lowerFormulaExpr(assignRule.formula));
    } else if (rateRule) {
      dae.addEquation(EqKind.Simple, dae.addDer(pVar), lowerFormulaExpr(rateRule.formula));
    }
  }

  // 6. Emit Species Differential Balance / Rule Equations
  for (const [id, sVar] of speciesVarMap) {
    const assignRule = assignRuleByVar.get(id);
    if (assignRule) {
      dae.addEquation(EqKind.Simple, dae.addName(sVar), lowerFormulaExpr(assignRule.formula));
      continue;
    }

    const rateRule = rateRuleByVar.get(id);
    if (rateRule) {
      dae.addEquation(EqKind.Simple, dae.addDer(sVar), lowerFormulaExpr(rateRule.formula));
      continue;
    }

    const s = mod.species.get(id);
    if (!s || s.constant || s.boundaryCondition) {
      dae.addEquation(EqKind.Simple, dae.addDer(sVar), dae.addRealLiteral(0.0));
      continue;
    }

    let netFluxExpr: number | null = null;
    for (const [rId, r] of mod.reactions) {
      const fluxVar = rxnFluxMap.get(rId);
      if (fluxVar === undefined) continue;

      for (const ref of r.reactants) {
        if (ref.species === id && !ref.boundaryCondition) {
          const term = addMul(dae.addRealLiteral(ref.stoichiometry), dae.addName(fluxVar));
          netFluxExpr = netFluxExpr === null ? addSub(dae.addRealLiteral(0.0), term) : addSub(netFluxExpr, term);
        }
      }

      for (const ref of r.products) {
        if (ref.species === id && !ref.boundaryCondition) {
          const term = addMul(dae.addRealLiteral(ref.stoichiometry), dae.addName(fluxVar));
          netFluxExpr = netFluxExpr === null ? term : addAdd(netFluxExpr, term);
        }
      }
    }

    const cVar = compVarMap.get(s.compartment) ?? compVarMap.get("default_compartment");
    let rhs: number;
    if (netFluxExpr !== null) {
      if (cVar !== undefined) {
        rhs = addDiv(netFluxExpr, dae.addName(cVar));
      } else {
        rhs = netFluxExpr;
      }
    } else {
      rhs = dae.addRealLiteral(0.0);
    }

    dae.addEquation(EqKind.Simple, dae.addDer(sVar), rhs);
  }

  return dae;
}
