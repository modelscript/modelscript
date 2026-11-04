// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/gproms — Direct Linear-Memory DAE Arena Lowering for gPROMS Models.
 *
 * Discretizes DISTRIBUTION_DOMAIN spatial PARTIAL derivatives via finite differences (BFDM/CFDM)
 * and lowers parameters, lumped states, distributed nodal states, ASSIGNed inputs, and equations
 * directly into a structurally square ModelScript DAEBuilder.
 */

import { BinOp, Causality, DAEBuilder, EqKind, Variability, VarType } from "@modelscript/runtime";
import { normalizeGpromsExprForEval } from "../solvers/gproms-solver.js";
import type { GpromsDocument, GpromsModel, GpromsProcess } from "../types.js";

export interface GpromsDaeOptions {
  builder?: DAEBuilder | undefined;
  modelName?: string | undefined;
  processName?: string | undefined;
}

export function lowerGpromsToDae(doc: GpromsDocument, options?: GpromsDaeOptions): DAEBuilder {
  let proc: GpromsProcess | undefined;
  if (options?.processName) {
    proc = doc.processes.get(options.processName);
  } else if (doc.processes.size > 0) {
    proc = doc.processes.values().next().value;
  }

  let model: GpromsModel | undefined;
  if (options?.modelName) {
    model = doc.models.get(options.modelName);
  } else if (proc && proc.units.size > 0) {
    const firstModelName = proc.units.values().next().value;
    if (firstModelName) model = doc.models.get(firstModelName);
  }
  if (!model) {
    model = doc.models.values().next().value;
  }
  if (!model) {
    throw new Error("No gPROMS MODEL found to lower to DAEBuilder.");
  }

  const safeName = (options?.modelName ?? (model.name || "GpromsModel")).replace(/[^a-zA-Z0-9_]/g, "_");
  const dae = options?.builder ?? new DAEBuilder(undefined, safeName);

  const addAdd = (a: number, b: number): number => dae.addBinaryExpr(BinOp.Add, a, b);
  const addSub = (a: number, b: number): number => dae.addBinaryExpr(BinOp.Sub, a, b);
  const addMul = (a: number, b: number): number => dae.addBinaryExpr(BinOp.Mul, a, b);
  const addDiv = (a: number, b: number): number => dae.addBinaryExpr(BinOp.Div, a, b);
  const addPow = (a: number, b: number): number => dae.addBinaryExpr(BinOp.Pow, a, b);

  // 1. Declare Parameters
  const paramVarMap = new Map<string, number>();
  for (const [pName, pDef] of model.parameters) {
    const val = proc?.sets.get(pName) ?? pDef.defaultValue ?? 0.0;
    const pId = dae.addVariable(pName, VarType.Real, Variability.Parameter, Causality.Local, val);
    paramVarMap.set(pName, pId);
    dae.addEquation(EqKind.Simple, dae.addName(pId), dae.addRealLiteral(val));
  }

  // 2. Compute spatial domain grid metrics
  const domainGridPoints = new Map<string, number>();
  const domainDelta = new Map<string, number>();
  const domainNames = new Set<string>(model.domains.keys());

  for (const [dName, dom] of model.domains) {
    const nPts = Math.max(2, dom.gridPoints);
    const dz = (dom.upperBound - dom.lowerBound) / (nPts - 1);
    domainGridPoints.set(dName, nPts);
    domainDelta.set(dName, dz);
  }

  // 3. Declare Lumped & Distributed Variables
  const lumpedVarMap = new Map<string, number>();
  const distNodeVarMap = new Map<string, number[]>();
  const distributedVars = new Set<string>();

  for (const [vName, vDef] of model.variables) {
    const initVal =
      proc?.initials.get(vName) ??
      proc?.assigns.get(vName) ??
      doc.variableTypes.get(vDef.typeName)?.defaultValue ??
      0.0;

    if (vDef.domains.length > 0) {
      distributedVars.add(vName);
      const dName = vDef.domains[0]!;
      const nPts = domainGridPoints.get(dName) ?? 10;
      const nodeIds: number[] = [];
      for (let i = 0; i < nPts; i++) {
        const nodeVarId = dae.addVariable(
          `${vName}_${i}`,
          VarType.Real,
          Variability.Continuous,
          Causality.Local,
          initVal,
        );
        nodeIds.push(nodeVarId);
      }
      distNodeVarMap.set(vName, nodeIds);

      // Also declare summary outlet variable vName = vName_{nPts-1}
      const summaryId = dae.addVariable(vName, VarType.Real, Variability.Continuous, Causality.Local, initVal);
      lumpedVarMap.set(vName, summaryId);
      const lastNodeId = nodeIds[nodeIds.length - 1]!;
      dae.addEquation(EqKind.Simple, dae.addName(summaryId), dae.addName(lastNodeId));
    } else {
      const vId = dae.addVariable(vName, VarType.Real, Variability.Continuous, Causality.Local, initVal);
      lumpedVarMap.set(vName, vId);
    }
  }

  // Helper to lower normalized infix expression into DAEBuilder expression ID
  const lowerExprToArena = (rawFormula: string, nodeIndex?: number, activeDomain?: string): number => {
    const norm = normalizeGpromsExprForEval(rawFormula, distributedVars, domainNames);
    const tokens = tokenizeFormula(norm);
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
        return dae.addCallExpr(ident.toLowerCase(), args);
      }

      // Check finite-difference spatial derivative placeholders __d1_var_dom and __d2_var_dom
      if (ident.startsWith("__d1_") && nodeIndex !== undefined) {
        const rest = ident.slice(5);
        for (const dv of distributedVars) {
          if (rest.startsWith(`${dv}_`)) {
            const domName = rest.slice(dv.length + 1);
            const nodes = distNodeVarMap.get(dv);
            const dz = domainDelta.get(domName) ?? 0.1;
            if (nodes && nodeIndex >= 1) {
              const uCurr = dae.addName(nodes[nodeIndex]!);
              const uPrev = dae.addName(nodes[nodeIndex - 1]!);
              return addDiv(addSub(uCurr, uPrev), dae.addRealLiteral(dz));
            }
            return dae.addRealLiteral(0.0);
          }
        }
      }

      if (ident.startsWith("__d2_") && nodeIndex !== undefined) {
        const rest = ident.slice(5);
        for (const dv of distributedVars) {
          if (rest.startsWith(`${dv}_`)) {
            const domName = rest.slice(dv.length + 1);
            const nodes = distNodeVarMap.get(dv);
            const dz = domainDelta.get(domName) ?? 0.1;
            if (nodes && nodeIndex >= 1) {
              const uPrev = dae.addName(nodes[nodeIndex - 1]!);
              const uCurr = dae.addName(nodes[nodeIndex]!);
              const uNext =
                nodeIndex < nodes.length - 1 ? dae.addName(nodes[nodeIndex + 1]!) : dae.addName(nodes[nodeIndex]!);
              const twoCurr = addMul(dae.addRealLiteral(2.0), uCurr);
              const numExpr = addAdd(addSub(uNext, twoCurr), uPrev);
              return addDiv(numExpr, dae.addRealLiteral(dz * dz));
            }
            return dae.addRealLiteral(0.0);
          }
        }
      }

      // Check distributed variable at active nodeIndex
      if (nodeIndex !== undefined && distNodeVarMap.has(ident)) {
        const nodes = distNodeVarMap.get(ident)!;
        const clamped = Math.min(Math.max(0, nodeIndex), nodes.length - 1);
        return dae.addName(nodes[clamped]!);
      }

      // Check domain coordinate z
      if (nodeIndex !== undefined && activeDomain && ident === activeDomain) {
        const dom = model.domains.get(activeDomain);
        const dz = domainDelta.get(activeDomain) ?? 0.1;
        const zVal = (dom?.lowerBound ?? 0.0) + nodeIndex * dz;
        return dae.addRealLiteral(zVal);
      }

      const lVar = lumpedVarMap.get(ident);
      if (lVar !== undefined) return dae.addName(lVar);

      const pVar = paramVarMap.get(ident);
      if (pVar !== undefined) return dae.addName(pVar);

      if (ident.toUpperCase() === "TIME") return dae.addNameExpr("time");
      if (ident.toUpperCase() === "PI") return dae.addRealLiteral(Math.PI);

      return dae.addRealLiteral(0.0);
    };

    return parseExpr();
  };

  // 4. Lower Equations
  const definedLumpedVars = new Set<string>();
  const definedDistVars = new Set<string>();

  // Map boundary equations by distributed variable name
  const boundaryMap = new Map<string, string>();
  for (const beq of model.boundaryEquations) {
    const parenIdx = beq.lhs.indexOf("(");
    const varName = (parenIdx > 0 ? beq.lhs.slice(0, parenIdx) : beq.lhs).replace("$", "").trim();
    boundaryMap.set(varName, beq.rhs);
  }

  for (const eq of model.equations) {
    const cleanLhs = eq.lhs.trim();
    const isTimeDeriv = cleanLhs.startsWith("$");
    const rawVar = isTimeDeriv ? cleanLhs.slice(1).trim() : cleanLhs;
    const parenIdx = rawVar.indexOf("(");
    const targetVar = (parenIdx > 0 ? rawVar.slice(0, parenIdx) : rawVar).trim();

    if (distNodeVarMap.has(targetVar)) {
      definedDistVars.add(targetVar);
      const nodes = distNodeVarMap.get(targetVar)!;
      const vDef = model.variables.get(targetVar)!;
      const domName = vDef.domains[0]!;

      // Node 0: inlet boundary condition
      const node0Id = nodes[0]!;
      const bRhs = boundaryMap.get(targetVar);
      if (bRhs !== undefined) {
        const rhsExpr = lowerExprToArena(bRhs, 0, domName);
        dae.addEquation(EqKind.Simple, dae.addName(node0Id), rhsExpr);
      } else {
        dae.addEquation(EqKind.Simple, dae.addDer(node0Id), dae.addRealLiteral(0.0));
      }

      // Interior & outlet nodes i = 1 .. N - 1
      for (let i = 1; i < nodes.length; i++) {
        const nodeId = nodes[i]!;
        const lhsExpr = isTimeDeriv ? dae.addDer(nodeId) : dae.addName(nodeId);
        const rhsExpr = lowerExprToArena(eq.rhs, i, domName);
        dae.addEquation(EqKind.Simple, lhsExpr, rhsExpr);
      }
    } else {
      definedLumpedVars.add(targetVar);
      const vId = lumpedVarMap.get(targetVar);
      const lhsExpr = vId !== undefined ? (isTimeDeriv ? dae.addDer(vId) : dae.addName(vId)) : lowerExprToArena(eq.lhs);
      const rhsExpr = lowerExprToArena(eq.rhs);
      dae.addEquation(EqKind.Simple, lhsExpr, rhsExpr);
    }
  }

  // 5. Add equations for remaining ASSIGNed or unassigned variables so DAE is structurally square
  for (const [vName, vDef] of model.variables) {
    if (vDef.domains.length > 0) {
      if (!definedDistVars.has(vName)) {
        const nodes = distNodeVarMap.get(vName) ?? [];
        const val =
          proc?.assigns.get(vName) ??
          proc?.initials.get(vName) ??
          doc.variableTypes.get(vDef.typeName)?.defaultValue ??
          0.0;
        for (const nodeId of nodes) {
          dae.addEquation(EqKind.Simple, dae.addName(nodeId), dae.addRealLiteral(val));
        }
      }
    } else {
      if (!definedLumpedVars.has(vName)) {
        const vId = lumpedVarMap.get(vName);
        if (vId !== undefined) {
          const val =
            proc?.assigns.get(vName) ??
            proc?.initials.get(vName) ??
            doc.variableTypes.get(vDef.typeName)?.defaultValue ??
            0.0;
          dae.addEquation(EqKind.Simple, dae.addName(vId), dae.addRealLiteral(val));
        }
      }
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
