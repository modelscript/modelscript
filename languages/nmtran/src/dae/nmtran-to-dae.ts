// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/nmtran — Direct Linear-Memory DAE Arena Lowering for NMTRAN Control Streams.
 *
 * Compiles $THETA parameters, $OMEGA/$SIGMA random effect placeholders, $PK equations,
 * compartment state variables A_i, and der(A_i) ODEs directly into DAEBuilder.
 */

import { BinOp, Causality, DAEBuilder, EqKind, Variability, VarType } from "@modelscript/runtime";
import { inferMaxCompartments } from "../lints/nmtran-linter.js";
import { tokenizeNmtranExpr } from "../solvers/pkpd-solver.js";
import type { NmtranDocument } from "../types.js";

export interface NmtranDaeOptions {
  builder?: DAEBuilder | undefined;
  modelName?: string | undefined;
}

export function lowerNmtranToDae(doc: NmtranDocument, options?: NmtranDaeOptions): DAEBuilder {
  const cs = doc.controlStream;
  const rawName = options?.modelName ?? (cs.problem || "NmtranPkPdModel");
  const modelName = rawName.replace(/[^a-zA-Z0-9_]/g, "_");
  const dae = options?.builder ?? new DAEBuilder(undefined, modelName);

  const addAdd = (a: number, b: number): number => dae.addBinaryExpr(BinOp.Add, a, b);
  const addSub = (a: number, b: number): number => dae.addBinaryExpr(BinOp.Sub, a, b);
  const addMul = (a: number, b: number): number => dae.addBinaryExpr(BinOp.Mul, a, b);
  const addDiv = (a: number, b: number): number => dae.addBinaryExpr(BinOp.Div, a, b);
  const addPow = (a: number, b: number): number => dae.addBinaryExpr(BinOp.Pow, a, b);
  const addCall = (fn: string, args: number[]): number => dae.addCallExpr(fn, args);

  const varMap = new Map<string, number>();

  const ensureVariable = (name: string, variability: Variability, causality: Causality, startVal: number): number => {
    const key = name.toUpperCase();
    const existing = varMap.get(key);
    if (existing !== undefined) return existing;
    const vId = dae.addVariable(name, VarType.Real, variability, causality, startVal);
    varMap.set(key, vId);
    return vId;
  };

  // 1. Declare $THETA parameters
  for (const th of cs.thetas) {
    const vId = ensureVariable(`THETA_${th.index}`, Variability.Parameter, Causality.Local, th.init);
    dae.addEquation(EqKind.Simple, dae.addName(vId), dae.addRealLiteral(th.init));
  }

  // 2. Declare $OMEGA (ETA_i) and $SIGMA (EPS_i) parameters (typical value = 0.0)
  for (const om of cs.omegas) {
    const vId = ensureVariable(`ETA_${om.index}`, Variability.Parameter, Causality.Local, 0.0);
    dae.addEquation(EqKind.Simple, dae.addName(vId), dae.addRealLiteral(0.0));
  }

  for (const sg of cs.sigmas) {
    const vId = ensureVariable(`EPS_${sg.index}`, Variability.Parameter, Causality.Local, 0.0);
    dae.addEquation(EqKind.Simple, dae.addName(vId), dae.addRealLiteral(0.0));
  }

  // Determine compartment count and initial amounts at t = 0
  let maxDesCmt = 0;
  for (const eq of cs.desEquations) {
    if (eq.compartmentIndex > maxDesCmt) maxDesCmt = eq.compartmentIndex;
    for (const r of eq.compartmentRefs) {
      if (r > maxDesCmt) maxDesCmt = r;
    }
  }
  const compartmentCount = Math.max(1, inferMaxCompartments(cs) ?? 1, maxDesCmt);

  const initAmounts = new Array<number>(compartmentCount).fill(0.0);
  if (cs.dosingRecords.length > 0) {
    for (const d of cs.dosingRecords) {
      if (d.evid !== 0 && d.amt > 0 && d.rate === 0 && Math.abs(d.time) <= 1e-9) {
        const idx = Math.min(compartmentCount, Math.max(1, d.cmt)) - 1;
        initAmounts[idx] = (initAmounts[idx] ?? 0) + d.amt;
      }
    }
  } else {
    initAmounts[0] = 100.0;
  }

  // Pre-declare compartment state variables A_1 .. A_N so expressions can reference A(i)
  const cmtVarIds: number[] = [];
  for (let i = 1; i <= compartmentCount; i++) {
    const aId = ensureVariable(`A_${i}`, Variability.Continuous, Causality.Local, initAmounts[i - 1] ?? 0.0);
    cmtVarIds.push(aId);
  }

  // Helper to lower NMTRAN algebraic / rate expression into DAEBuilder ExprId
  const lowerExpr = (exprStr: string): number => {
    const tokens = tokenizeNmtranExpr(exprStr);
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
      const upIdent = ident.toUpperCase();

      if (peek() === "(") {
        consume(); // '('
        const rawArgTok = peek() ?? "1";
        const args: number[] = [];
        if (peek() !== ")") {
          args.push(parseExpr());
          while (peek() === ",") {
            consume();
            args.push(parseExpr());
          }
        }
        if (peek() === ")") consume();

        const idxVal = Number.parseInt(rawArgTok, 10);
        if (upIdent === "THETA" && !Number.isNaN(idxVal)) {
          const thVar = varMap.get(`THETA_${idxVal}`);
          return thVar !== undefined ? dae.addName(thVar) : dae.addRealLiteral(0.0);
        }
        if (upIdent === "ETA" && !Number.isNaN(idxVal)) {
          const etaVar = varMap.get(`ETA_${idxVal}`);
          return etaVar !== undefined ? dae.addName(etaVar) : dae.addRealLiteral(0.0);
        }
        if ((upIdent === "EPS" || upIdent === "ERR") && !Number.isNaN(idxVal)) {
          const epsVar = varMap.get(`EPS_${idxVal}`);
          return epsVar !== undefined ? dae.addName(epsVar) : dae.addRealLiteral(0.0);
        }
        if (upIdent === "A" && !Number.isNaN(idxVal)) {
          const aVar = varMap.get(`A_${idxVal}`);
          return aVar !== undefined ? dae.addName(aVar) : dae.addRealLiteral(0.0);
        }

        const fnName = upIdent === "LN" ? "log" : ident.toLowerCase();
        return addCall(fnName, args);
      }

      if (upIdent === "T" || upIdent === "TIME") {
        return dae.addNameExpr("time");
      }
      if (upIdent === "PI") return dae.addRealLiteral(Math.PI);
      if (upIdent === "E") return dae.addRealLiteral(Math.E);

      const mapped = varMap.get(upIdent);
      if (mapped !== undefined) {
        return dae.addName(mapped);
      }

      return dae.addRealLiteral(0.0);
    };

    return parseExpr();
  };

  // 3. Lower $PK statements
  const boundVars = new Set<string>();
  for (const stmt of cs.pkStatements) {
    const key = stmt.lhs.toUpperCase();
    if (boundVars.has(key)) continue;
    boundVars.add(key);
    const vId = ensureVariable(stmt.lhs, Variability.Continuous, Causality.Local, 1.0);
    const rhsExpr = lowerExpr(stmt.rhs);
    dae.addEquation(EqKind.Simple, dae.addName(vId), rhsExpr);
  }

  // 4. Lower $DES or built-in PREDPP compartment ODEs: der(A_i) = ...
  const hasCustomDes = cs.desEquations.some((e) => e.isDerivative);
  const assignedDerivCmts = new Set<number>();

  if (hasCustomDes) {
    for (const eq of cs.desEquations) {
      if (!eq.isDerivative) {
        const key = eq.lhs.toUpperCase();
        if (!boundVars.has(key)) {
          boundVars.add(key);
          const vId = ensureVariable(eq.lhs, Variability.Continuous, Causality.Local, 0.0);
          dae.addEquation(EqKind.Simple, dae.addName(vId), lowerExpr(eq.rhs));
        }
      } else {
        const cIdx = eq.compartmentIndex;
        const aVar = cmtVarIds[cIdx - 1];
        if (aVar !== undefined && !assignedDerivCmts.has(cIdx)) {
          assignedDerivCmts.add(cIdx);
          dae.addEquation(EqKind.Simple, dae.addDer(aVar), lowerExpr(eq.rhs));
        }
      }
    }
  } else {
    const advan = (cs.subroutines.advan || "ADVAN1").toUpperCase();
    const getVarOrLit = (names: string[], fallback: number): number => {
      for (const nm of names) {
        const id = varMap.get(nm.toUpperCase());
        if (id !== undefined) return dae.addName(id);
      }
      return dae.addRealLiteral(fallback);
    };

    const getRateK = (vNames: string[]): number => {
      const kId = varMap.get("K");
      if (kId !== undefined) return dae.addName(kId);
      const clExpr = getVarOrLit(["CL"], 1.0);
      const vExpr = getVarOrLit(vNames, 1.0);
      return addDiv(clExpr, vExpr);
    };

    const a1Expr = dae.addName(cmtVarIds[0]!);
    const a2Expr = cmtVarIds[1] !== undefined ? dae.addName(cmtVarIds[1]) : dae.addRealLiteral(0.0);
    const a3Expr = cmtVarIds[2] !== undefined ? dae.addName(cmtVarIds[2]) : dae.addRealLiteral(0.0);

    if (advan === "ADVAN1") {
      const kExpr = getRateK(["V", "V1", "S1"]);
      assignedDerivCmts.add(1);
      dae.addEquation(EqKind.Simple, dae.addDer(cmtVarIds[0]!), dae.addNegateExpr(addMul(kExpr, a1Expr)));
    } else if (advan === "ADVAN2" && compartmentCount >= 2) {
      const kaExpr = getVarOrLit(["KA"], 1.0);
      const kExpr = getRateK(["V", "V2", "V1", "S2"]);
      assignedDerivCmts.add(1);
      assignedDerivCmts.add(2);
      dae.addEquation(EqKind.Simple, dae.addDer(cmtVarIds[0]!), dae.addNegateExpr(addMul(kaExpr, a1Expr)));
      dae.addEquation(EqKind.Simple, dae.addDer(cmtVarIds[1]!), addSub(addMul(kaExpr, a1Expr), addMul(kExpr, a2Expr)));
    } else if (advan === "ADVAN3" && compartmentCount >= 2) {
      const kExpr = getRateK(["V1", "V", "S1"]);
      const qExpr = getVarOrLit(["Q"], 0.5);
      const v1Expr = getVarOrLit(["V1", "V", "S1"], 1.0);
      const v2Expr = getVarOrLit(["V2", "VSS"], 1.0);
      const k12Expr = varMap.has("K12") ? dae.addName(varMap.get("K12")!) : addDiv(qExpr, v1Expr);
      const k21Expr = varMap.has("K21") ? dae.addName(varMap.get("K21")!) : addDiv(qExpr, v2Expr);

      assignedDerivCmts.add(1);
      assignedDerivCmts.add(2);
      dae.addEquation(
        EqKind.Simple,
        dae.addDer(cmtVarIds[0]!),
        addSub(addMul(k21Expr, a2Expr), addMul(addAdd(kExpr, k12Expr), a1Expr)),
      );
      dae.addEquation(
        EqKind.Simple,
        dae.addDer(cmtVarIds[1]!),
        addSub(addMul(k12Expr, a1Expr), addMul(k21Expr, a2Expr)),
      );
    } else if (advan === "ADVAN4" && compartmentCount >= 3) {
      const kaExpr = getVarOrLit(["KA"], 1.0);
      const kExpr = getRateK(["V2", "V1", "V", "S2"]);
      const qExpr = getVarOrLit(["Q"], 0.5);
      const v2Expr = getVarOrLit(["V2", "V1", "V", "S2"], 1.0);
      const v3Expr = getVarOrLit(["V3", "V2", "VSS"], 1.0);
      const k23Expr = varMap.has("K23") ? dae.addName(varMap.get("K23")!) : addDiv(qExpr, v2Expr);
      const k32Expr = varMap.has("K32") ? dae.addName(varMap.get("K32")!) : addDiv(qExpr, v3Expr);

      assignedDerivCmts.add(1);
      assignedDerivCmts.add(2);
      assignedDerivCmts.add(3);
      dae.addEquation(EqKind.Simple, dae.addDer(cmtVarIds[0]!), dae.addNegateExpr(addMul(kaExpr, a1Expr)));
      dae.addEquation(
        EqKind.Simple,
        dae.addDer(cmtVarIds[1]!),
        addAdd(addSub(addMul(kaExpr, a1Expr), addMul(addAdd(kExpr, k23Expr), a2Expr)), addMul(k32Expr, a3Expr)),
      );
      dae.addEquation(
        EqKind.Simple,
        dae.addDer(cmtVarIds[2]!),
        addSub(addMul(k23Expr, a2Expr), addMul(k32Expr, a3Expr)),
      );
    }
  }

  for (let i = 1; i <= compartmentCount; i++) {
    if (!assignedDerivCmts.has(i)) {
      const aVar = cmtVarIds[i - 1]!;
      dae.addEquation(EqKind.Simple, dae.addDer(aVar), dae.addRealLiteral(0.0));
    }
  }

  // 5. Lower central prediction F and $ERROR equations
  const advan = (cs.subroutines.advan || "ADVAN1").toUpperCase();
  const centralIdx = (advan === "ADVAN2" || advan === "ADVAN4" || advan === "ADVAN12") && compartmentCount >= 2 ? 2 : 1;
  const centralAmtVar = cmtVarIds[centralIdx - 1] ?? cmtVarIds[0]!;
  const scaleVarId =
    varMap.get(`S${centralIdx}`) ??
    varMap.get(`V${centralIdx}`) ??
    varMap.get("V") ??
    varMap.get("V1") ??
    varMap.get("V2");

  if (!boundVars.has("F")) {
    boundVars.add("F");
    const fVar = ensureVariable("F", Variability.Continuous, Causality.Output, 0.0);
    const fRhs =
      scaleVarId !== undefined
        ? addDiv(dae.addName(centralAmtVar), dae.addName(scaleVarId))
        : dae.addName(centralAmtVar);
    dae.addEquation(EqKind.Simple, dae.addName(fVar), fRhs);
  }

  for (const errStmt of cs.errorStatements) {
    const key = errStmt.lhs.toUpperCase();
    if (boundVars.has(key)) continue;
    boundVars.add(key);
    const causality = key === "Y" || key === "IPRED" ? Causality.Output : Causality.Local;
    const vId = ensureVariable(errStmt.lhs, Variability.Continuous, causality, 0.0);
    dae.addEquation(EqKind.Simple, dae.addName(vId), lowerExpr(errStmt.rhs));
  }

  return dae;
}
