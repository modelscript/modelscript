// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Direct DAE Arena Lowering for EASY5 Models.
 *
 * Translates standard GP components (GA, SJ, IN, TF, LA, LM, UG),
 * inter-component connections, and continuous state derivatives directly
 * into @modelscript/runtime's IDaeBuilder linear memory arena.
 */

import { BinOp, Causality, EqKind, type IDaeBuilder, VarType, Variability } from "@modelscript/runtime";
import { lowerUserComponentToDae } from "../script/user-code.js";
import type { Easy5Component, Easy5Model } from "../types.js";

export interface Easy5DaeLoweringResult {
  stateVarIndices: number[];
  equationCount: number;
  variableMap: Map<string, number>;
}

export function lowerEasy5ToDae(builder: IDaeBuilder, model: Easy5Model): Easy5DaeLoweringResult {
  const variableMap = new Map<string, number>();
  const stateVarIndices: number[] = [];
  let equationCount = 0;

  function getOrAddVar(
    name: string,
    variability: Variability = Variability.Continuous,
    startVal: number = 0.0,
  ): number {
    const key = name.toUpperCase();
    if (variableMap.has(key)) return variableMap.get(key)!;

    const existingIdx = builder.lookupVariable(name);
    if (existingIdx !== -1) {
      variableMap.set(key, existingIdx);
      return existingIdx;
    }

    const idx = builder.addVariable(name, VarType.Real, variability, Causality.Local, startVal);
    variableMap.set(key, idx);
    return idx;
  }

  // 1. Lower Components
  for (const [compId, comp] of model.components) {
    const typeUpper = comp.type.toUpperCase().replace(/^GP\//, "");

    // Register all declared ports as variables
    for (const portName of Object.keys(comp.ports)) {
      const varName = `${compId}_${portName}`;
      getOrAddVar(varName, Variability.Continuous, 0.0);
    }

    switch (typeUpper) {
      case "GA": {
        // Gain: OUT = K * IN
        const kVal = typeof comp.parameters["K"] === "number" ? comp.parameters["K"] : 1.0;
        const inVar = getOrAddVar(`${compId}_IN`);
        const outVar = getOrAddVar(`${compId}_OUT`);

        const lhs = builder.addName(outVar);
        const rhs = builder.addBinaryExpr(BinOp.Mul, builder.addRealLiteral(kVal), builder.addName(inVar));
        builder.addEquation(EqKind.Simple, lhs, rhs);
        equationCount++;
        break;
      }

      case "SJ": {
        // Summing Junction: OUT = SGN1*K1*IN1 + SGN2*K2*IN2 + ...
        const outVar = getOrAddVar(`${compId}_OUT`);
        const inVars = [
          getOrAddVar(`${compId}_IN1`),
          getOrAddVar(`${compId}_IN2`),
          getOrAddVar(`${compId}_IN3`),
          getOrAddVar(`${compId}_IN4`),
        ];

        let sumExpr: number | null = null;
        for (let i = 0; i < 4; i++) {
          const idxStr = String(i + 1);
          const sgn =
            typeof comp.parameters[`SGN${idxStr}`] === "number" ? (comp.parameters[`SGN${idxStr}`] as number) : 1.0;
          const k = typeof comp.parameters[`K${idxStr}`] === "number" ? (comp.parameters[`K${idxStr}`] as number) : 1.0;
          const factor = sgn * k;

          const term = builder.addBinaryExpr(BinOp.Mul, builder.addRealLiteral(factor), builder.addName(inVars[i]!));
          if (sumExpr === null) {
            sumExpr = term;
          } else {
            sumExpr = builder.addBinaryExpr(BinOp.Add, sumExpr, term);
          }
        }

        const lhs = builder.addName(outVar);
        builder.addEquation(EqKind.Simple, lhs, sumExpr!);
        equationCount++;
        break;
      }

      case "IN": {
        // Integrator: der(s) = GAIN * IN, OUT = s
        const gain = typeof comp.parameters["GAIN"] === "number" ? comp.parameters["GAIN"] : 1.0;
        const s0 =
          comp.initialStates["S1"] ?? (typeof comp.parameters["S0"] === "number" ? comp.parameters["S0"] : 0.0);

        const stateVar = getOrAddVar(`${compId}_s`, Variability.Continuous, s0);
        stateVarIndices.push(stateVar);

        const inVar = getOrAddVar(`${compId}_IN`);
        const outVar = getOrAddVar(`${compId}_OUT`);

        // der(s) = GAIN * IN
        const derS = builder.addDer(stateVar);
        const rhsDer = builder.addBinaryExpr(BinOp.Mul, builder.addRealLiteral(gain), builder.addName(inVar));
        builder.addEquation(EqKind.Simple, derS, rhsDer);
        equationCount++;

        // OUT = s
        const lhsOut = builder.addName(outVar);
        const rhsOut = builder.addName(stateVar);
        builder.addEquation(EqKind.Simple, lhsOut, rhsOut);
        equationCount++;
        break;
      }

      case "LA": {
        // Lead-Lag Filter: H(s) = GAIN * (1 + TAU1*s) / (1 + TAU2*s)
        const gain = typeof comp.parameters["GAIN"] === "number" ? comp.parameters["GAIN"] : 1.0;
        const tau1 = typeof comp.parameters["TAU1"] === "number" ? comp.parameters["TAU1"] : 0.0;
        const tau2 = typeof comp.parameters["TAU2"] === "number" ? Math.max(1e-9, comp.parameters["TAU2"]) : 1.0;
        const s0 =
          comp.initialStates["S1"] ?? (typeof comp.parameters["S0"] === "number" ? comp.parameters["S0"] : 0.0);

        const stateVar = getOrAddVar(`${compId}_s`, Variability.Continuous, s0);
        stateVarIndices.push(stateVar);

        const inVar = getOrAddVar(`${compId}_IN`);
        const outVar = getOrAddVar(`${compId}_OUT`);

        // der(s) = (IN - s) / TAU2
        const inMinusS = builder.addBinaryExpr(BinOp.Sub, builder.addName(inVar), builder.addName(stateVar));
        const derS = builder.addDer(stateVar);
        const rhsDer = builder.addBinaryExpr(BinOp.Div, inMinusS, builder.addRealLiteral(tau2));
        builder.addEquation(EqKind.Simple, derS, rhsDer);
        equationCount++;

        // OUT = GAIN * (s + (TAU1 / TAU2) * (IN - s))
        const leadRatio = tau1 / tau2;
        const leadTerm = builder.addBinaryExpr(BinOp.Mul, builder.addRealLiteral(leadRatio), inMinusS);
        const sumState = builder.addBinaryExpr(BinOp.Add, builder.addName(stateVar), leadTerm);
        const rhsOut = builder.addBinaryExpr(BinOp.Mul, builder.addRealLiteral(gain), sumState);
        builder.addEquation(EqKind.Simple, builder.addName(outVar), rhsOut);
        equationCount++;
        break;
      }

      case "TF": {
        // Transfer Function H(s) = NUM(s) / DEN(s)
        lowerTransferFunction(builder, comp, compId, getOrAddVar, stateVarIndices, () => equationCount++);
        break;
      }

      case "LM": {
        // Limiter: OUT = if IN > UL then UL else if IN < LL then LL else IN
        const ul = typeof comp.parameters["UL"] === "number" ? comp.parameters["UL"] : 1.0;
        const ll = typeof comp.parameters["LL"] === "number" ? comp.parameters["LL"] : -1.0;
        const inVar = getOrAddVar(`${compId}_IN`);
        const outVar = getOrAddVar(`${compId}_OUT`);

        // IN > UL
        const condUl = builder.addBinaryExpr(BinOp.Gt, builder.addName(inVar), builder.addRealLiteral(ul));
        // IN < LL
        const condLl = builder.addBinaryExpr(BinOp.Lt, builder.addName(inVar), builder.addRealLiteral(ll));
        const innerIf = builder.addIfElse(condLl, builder.addRealLiteral(ll), builder.addName(inVar));
        const clampExpr = builder.addIfElse(condUl, builder.addRealLiteral(ul), innerIf);

        builder.addEquation(EqKind.Simple, builder.addName(outVar), clampExpr);
        equationCount++;
        break;
      }

      case "UG": {
        // User General Component with embedded Fortran
        if (comp.userCode) {
          const res = lowerUserComponentToDae(builder, comp.userCode, compId);
          stateVarIndices.push(...res.stateVarIndices);
          equationCount += res.equationCount;
        }
        break;
      }

      default: {
        // For general or pass-through blocks, if IN and OUT exist, connect OUT = IN
        if (comp.ports["IN"] && comp.ports["OUT"]) {
          const inVar = getOrAddVar(`${compId}_IN`);
          const outVar = getOrAddVar(`${compId}_OUT`);
          builder.addEquation(EqKind.Simple, builder.addName(outVar), builder.addName(inVar));
          equationCount++;
        }
        break;
      }
    }
  }

  // 2. Lower Connections (to.port = from.port)
  for (const conn of model.connections) {
    const fromVarName = `${conn.fromComponent}_${conn.fromPort}`;
    const toVarName = `${conn.toComponent}_${conn.toPort}`;

    const fromVarIdx = getOrAddVar(fromVarName);
    const toVarIdx = getOrAddVar(toVarName);

    const lhs = builder.addName(toVarIdx);
    const rhs = builder.addName(fromVarIdx);
    builder.addEquation(EqKind.Simple, lhs, rhs);
    equationCount++;
  }

  return {
    stateVarIndices,
    equationCount,
    variableMap,
  };
}

/**
 * Lowers a rational transfer function H(s) = N(s) / D(s) into controllable canonical state-space form.
 */
function lowerTransferFunction(
  builder: IDaeBuilder,
  comp: Easy5Component,
  compId: string,
  getOrAddVar: (name: string, variability?: Variability, startVal?: number) => number,
  stateVarIndices: number[],
  incEq: () => void,
): void {
  const rawNum = Array.isArray(comp.parameters["NUM"]) ? (comp.parameters["NUM"] as number[]) : [1.0];
  const rawDen = Array.isArray(comp.parameters["DEN"]) ? (comp.parameters["DEN"] as number[]) : [1.0, 1.0];

  const inVar = getOrAddVar(`${compId}_IN`);
  const outVar = getOrAddVar(`${compId}_OUT`);

  // Ensure monic denominator: D(s) = s^n + a_{n-1} s^{n-1} + ... + a_0
  const n = rawDen.length - 1;
  if (n <= 0) {
    // Pure gain: OUT = (num[0] / den[0]) * IN
    const k = (rawNum[0] ?? 1.0) / (rawDen[0] ?? 1.0);
    const lhs = builder.addName(outVar);
    const rhs = builder.addBinaryExpr(BinOp.Mul, builder.addRealLiteral(k), builder.addName(inVar));
    builder.addEquation(EqKind.Simple, lhs, rhs);
    incEq();
    return;
  }

  const an = rawDen[0] !== 0 ? rawDen[0]! : 1.0;
  const a = rawDen.map((coef) => coef / an);
  const b = rawNum.map((coef) => coef / an);

  // Pad numerator with leading zeros to match denominator length
  while (b.length < a.length) {
    b.unshift(0.0);
  }

  // Allocate n state variables: x_1, x_2, ..., x_n
  const stateVars: number[] = [];
  for (let i = 1; i <= n; i++) {
    const sVar = getOrAddVar(`${compId}_x${i}`, Variability.Continuous, 0.0);
    stateVars.push(sVar);
    stateVarIndices.push(sVar);
  }

  // Controllable canonical form:
  // der(x_1) = x_2
  // der(x_2) = x_3
  // ...
  // der(x_n) = -a_0 x_1 - a_1 x_2 - ... - a_{n-1} x_n + IN
  for (let i = 0; i < n - 1; i++) {
    const derX = builder.addDer(stateVars[i]!);
    const nextX = builder.addName(stateVars[i + 1]!);
    builder.addEquation(EqKind.Simple, derX, nextX);
    incEq();
  }

  // Top derivative der(x_n)
  let sumExpr = builder.addName(inVar);
  for (let i = 0; i < n; i++) {
    const coef = a[a.length - 1 - i]!;
    if (coef !== 0) {
      const term = builder.addBinaryExpr(BinOp.Mul, builder.addRealLiteral(coef), builder.addName(stateVars[i]!));
      sumExpr = builder.addBinaryExpr(BinOp.Sub, sumExpr, term);
    }
  }
  const derLast = builder.addDer(stateVars[n - 1]!);
  builder.addEquation(EqKind.Simple, derLast, sumExpr);
  incEq();

  // Output equation: OUT = (b_n - a_n * d_0)*x + ... + d_0 * IN
  // For strictly proper (deg N < deg D), OUT = b_0 x_1 + b_1 x_2 + ... + b_{n-1} x_n
  const d0 = b[0]!;
  let outExpr: number | null = null;
  for (let i = 0; i < n; i++) {
    const bCoef = b[b.length - 1 - i]! - d0 * a[a.length - 1 - i]!;
    if (bCoef !== 0) {
      const term = builder.addBinaryExpr(BinOp.Mul, builder.addRealLiteral(bCoef), builder.addName(stateVars[i]!));
      outExpr = outExpr === null ? term : builder.addBinaryExpr(BinOp.Add, outExpr, term);
    }
  }

  if (d0 !== 0) {
    const feedthrough = builder.addBinaryExpr(BinOp.Mul, builder.addRealLiteral(d0), builder.addName(inVar));
    outExpr = outExpr === null ? feedthrough : builder.addBinaryExpr(BinOp.Add, outExpr, feedthrough);
  }

  if (outExpr === null) outExpr = builder.addRealLiteral(0.0);

  builder.addEquation(EqKind.Simple, builder.addName(outVar), outExpr);
  incEq();
}
