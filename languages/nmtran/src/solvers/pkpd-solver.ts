// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/nmtran — Clinical PK/PD Compartmental & General $DES ODE Solver.
 *
 * Simulates 1-, 2-, and 3-compartment models (ADVAN1-ADVAN4, ADVAN10-ADVAN12) and
 * custom $DES differential equations across bolus, infusion, and multi-dose (II/ADDL)
 * regimens, computing Cmax, Tmax, t1/2, and AUC(0->t) via trapezoidal integration.
 */

import { inferMaxCompartments } from "../lints/nmtran-linter.js";
import type { DosingRecord, NmtranDocument } from "../types.js";

export interface PkPdSolverOptions {
  duration?: number | undefined; // simulation duration (default 24.0 h)
  timeStep?: number | undefined; // RK4 integration step (default 0.05 h)
  dosingRecords?: DosingRecord[] | undefined;
  etas?: number[] | undefined; // individual random effects (default 0.0)
}

export interface PkPdTimePoint {
  time: number;
  amounts: Record<string, number>;
  concentrations: Record<string, number>;
  centralConcentration: number;
  predictionY: number;
}

export interface PkPdMetrics {
  cMax: number;
  tMax: number;
  auc0ToT: number;
  auc0ToInf: number;
  halfLife: number;
  clearance: number;
  centralVolume: number;
}

export interface PkPdSimulationResult {
  problem: string;
  advan: string;
  trans: string;
  compartmentCount: number;
  evaluatedPkParams: Record<string, number>;
  timePoints: number[];
  trajectory: PkPdTimePoint[];
  finalAmounts: Record<string, number>;
  metrics: PkPdMetrics;
}

interface ExpandedDoseEvent {
  time: number;
  amt: number;
  rate: number;
  cmt: number;
}

export function tokenizeNmtranExpr(expr: string): string[] {
  const tokens: string[] = [];
  const n = expr.length;
  let i = 0;

  while (i < n) {
    const ch = expr[i] ?? "";
    if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n") {
      i++;
      continue;
    }
    if (ch === "*" && expr[i + 1] === "*") {
      tokens.push("**");
      i += 2;
      continue;
    }
    if (ch === "+" || ch === "-" || ch === "*" || ch === "/" || ch === "^" || ch === "(" || ch === ")" || ch === ",") {
      tokens.push(ch);
      i++;
      continue;
    }
    if ((ch >= "0" && ch <= "9") || ch === ".") {
      let numStr = "";
      while (i < n) {
        const c = expr[i] ?? "";
        const isNumChar = (c >= "0" && c <= "9") || c === "." || c === "e" || c === "E" || c === "+" || c === "-";
        if (!isNumChar) break;
        if ((c === "+" || c === "-") && expr[i - 1] !== "e" && expr[i - 1] !== "E") {
          break;
        }
        numStr += c;
        i++;
      }
      tokens.push(numStr);
      continue;
    }
    if ((ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch === "_") {
      let idStr = "";
      while (i < n) {
        const c = expr[i] ?? "";
        if ((c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || (c >= "0" && c <= "9") || c === "_") {
          idStr += c;
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

export function evaluateNmtranExpression(
  expr: string,
  env: Record<string, number>,
  thetas: number[],
  etas: number[],
  eps: number[],
  amounts: number[],
): number {
  const tokens = tokenizeNmtranExpr(expr);
  let pos = 0;

  const peek = (): string | undefined => tokens[pos];
  const consume = (): string => tokens[pos++] ?? "";

  const parseExpr = (): number => parseAddSub();

  const parseAddSub = (): number => {
    let left = parseMulDiv();
    while (peek() === "+" || peek() === "-") {
      const op = consume();
      const right = parseMulDiv();
      left = op === "+" ? left + right : left - right;
    }
    return left;
  };

  const parseMulDiv = (): number => {
    let left = parsePower();
    while (peek() === "*" || peek() === "/") {
      const op = consume();
      const right = parsePower();
      left = op === "*" ? left * right : right !== 0 ? left / right : 0;
    }
    return left;
  };

  const parsePower = (): number => {
    const base = parseUnary();
    if (peek() === "^" || peek() === "**") {
      consume();
      const exp = parsePower();
      return Math.pow(base, exp);
    }
    return base;
  };

  const parseUnary = (): number => {
    if (peek() === "-") {
      consume();
      return -parseUnary();
    }
    if (peek() === "+") {
      consume();
      return parseUnary();
    }
    return parsePrimary();
  };

  const parsePrimary = (): number => {
    const tok = peek();
    if (!tok) return 0;

    if (tok === "(") {
      consume();
      const val = parseExpr();
      if (peek() === ")") consume();
      return val;
    }

    const numVal = Number(tok);
    if (!Number.isNaN(numVal)) {
      consume();
      return numVal;
    }

    const ident = consume().toUpperCase();
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

      const a0 = args[0] ?? 0;
      const a1 = args[1] ?? 0;
      const idx = Math.round(a0) - 1;

      if (ident === "THETA") return thetas[idx] ?? 0;
      if (ident === "ETA") return etas[idx] ?? 0;
      if (ident === "EPS" || ident === "ERR") return eps[idx] ?? 0;
      if (ident === "A") return amounts[idx] ?? 0;

      if (ident === "EXP" || ident === "DEXP") return Math.exp(a0);
      if (ident === "LOG" || ident === "LN" || ident === "DLOG") return a0 > 0 ? Math.log(a0) : 0;
      if (ident === "LOG10" || ident === "DLOG10") return a0 > 0 ? Math.log10(a0) : 0;
      if (ident === "SQRT" || ident === "DSQRT") return a0 >= 0 ? Math.sqrt(a0) : 0;
      if (ident === "ABS" || ident === "DABS") return Math.abs(a0);
      if (ident === "SIN" || ident === "DSIN") return Math.sin(a0);
      if (ident === "COS" || ident === "DCOS") return Math.cos(a0);
      if (ident === "TAN" || ident === "DTAN") return Math.tan(a0);
      if (ident === "ASIN") return Math.asin(a0);
      if (ident === "ACOS") return Math.acos(a0);
      if (ident === "ATAN") return Math.atan(a0);
      if (ident === "MIN") return Math.min(a0, a1);
      if (ident === "MAX") return Math.max(a0, a1);
      if (ident === "POW") return Math.pow(a0, a1);
      return 0;
    }

    if (ident === "PI") return Math.PI;
    if (ident === "E") return Math.E;
    return env[ident] ?? 0;
  };

  return parseExpr();
}

export function solveNmtranPkPd(doc: NmtranDocument, options?: PkPdSolverOptions): PkPdSimulationResult {
  const cs = doc.controlStream;
  const duration = Math.max(0.1, options?.duration ?? 24.0);
  const timeStep = Math.max(1e-4, options?.timeStep ?? 0.05);

  const thetas = cs.thetas.map((t) => t.init);
  const etas = options?.etas ?? cs.omegas.map(() => 0.0);
  const eps = cs.sigmas.map(() => 0.0);

  // 1. Evaluate $PK block
  const env: Record<string, number> = {
    T: 0,
    TIME: 0,
  };
  for (let i = 0; i < thetas.length; i++) {
    env[`THETA_${i + 1}`] = thetas[i] ?? 0;
  }
  for (const stmt of cs.pkStatements) {
    const val = evaluateNmtranExpression(stmt.rhs, env, thetas, etas, eps, []);
    env[stmt.lhs.toUpperCase()] = val;
  }

  const advan = (cs.subroutines.advan || "ADVAN1").toUpperCase();
  const trans = (cs.subroutines.trans || "TRANS1").toUpperCase();

  // 2. Determine compartment count and central observation compartment
  let maxDesCmt = 0;
  for (const eq of cs.desEquations) {
    if (eq.compartmentIndex > maxDesCmt) maxDesCmt = eq.compartmentIndex;
    for (const r of eq.compartmentRefs) {
      if (r > maxDesCmt) maxDesCmt = r;
    }
  }
  const inferredCmt = inferMaxCompartments(cs) ?? 1;
  const compartmentCount = Math.max(1, inferredCmt, maxDesCmt);

  // Determine default dosing compartment and default observation (central) compartment
  let defDoseCmt = 1;
  let centralCmt = advan === "ADVAN2" || advan === "ADVAN4" || advan === "ADVAN12" ? 2 : 1;
  if (centralCmt > compartmentCount) centralCmt = 1;

  for (const c of cs.compartments) {
    if (c.defDose) defDoseCmt = c.index;
    if (c.defObs) centralCmt = c.index;
  }

  // Determine central volume and clearance
  const centralVolume =
    env[`S${centralCmt}`] ?? env[`V${centralCmt}`] ?? env["V"] ?? env["V1"] ?? env["V2"] ?? env["VC"] ?? 1.0;
  const safeCentralVol = Math.max(1e-9, centralVolume);

  const clearance = env["CL"] ?? (env["K"] !== undefined ? env["K"] * safeCentralVol : 1.0);

  // 3. Expand dosing schedule (including II / ADDL multi-dose regimens, F_i bioavailability, ALAG_i)
  const rawDoses =
    options?.dosingRecords && options.dosingRecords.length > 0
      ? options.dosingRecords
      : cs.dosingRecords.length > 0
        ? cs.dosingRecords
        : [
            {
              time: 0,
              amt: 100,
              rate: 0,
              cmt: defDoseCmt,
              evid: 1,
              ii: 0,
              addl: 0,
            },
          ];

  const expandedDoses: ExpandedDoseEvent[] = [];
  for (const d of rawDoses) {
    if (d.evid === 0 || d.amt <= 0) continue;
    const targetCmt = Math.min(compartmentCount, Math.max(1, d.cmt || defDoseCmt));
    const bioF = env[`F${targetCmt}`] ?? 1.0;
    const alag = env[`ALAG${targetCmt}`] ?? 0.0;
    const nAdditional = d.ii > 0 && d.addl > 0 ? d.addl : 0;

    for (let k = 0; k <= nAdditional; k++) {
      const tDose = d.time + k * d.ii + alag;
      expandedDoses.push({
        time: tDose,
        amt: d.amt * bioF,
        rate: d.rate > 0 ? d.rate : 0,
        cmt: targetCmt,
      });
    }
  }

  // 4. Define derivative evaluation function dA/dt = f(t, A)
  const hasCustomDes = cs.desEquations.some((e) => e.isDerivative);

  const computeDerivatives = (t: number, amounts: number[]): number[] => {
    const dA = new Array<number>(compartmentCount).fill(0.0);

    // Add active zero-order infusions at time t
    for (const dose of expandedDoses) {
      if (dose.rate > 0) {
        const infDuration = dose.amt / dose.rate;
        if (t >= dose.time && t < dose.time + infDuration) {
          const idx = dose.cmt - 1;
          dA[idx] = (dA[idx] ?? 0) + dose.rate;
        }
      }
    }

    if (hasCustomDes) {
      const desEnv: Record<string, number> = { ...env, T: t, TIME: t };
      for (const eq of cs.desEquations) {
        const val = evaluateNmtranExpression(eq.rhs, desEnv, thetas, etas, eps, amounts);
        if (eq.isDerivative) {
          const idx = eq.compartmentIndex - 1;
          if (idx >= 0 && idx < compartmentCount) {
            dA[idx] = (dA[idx] ?? 0) + val;
          }
        } else {
          desEnv[eq.lhs.toUpperCase()] = val;
        }
      }
      return dA;
    }

    // Built-in PREDPP analytical / ODE compartment models
    const a0 = amounts[0] ?? 0;
    const a1 = amounts[1] ?? 0;
    const a2 = amounts[2] ?? 0;
    const a3 = amounts[3] ?? 0;

    if (advan === "ADVAN1") {
      const v1 = Math.max(1e-9, env["V"] ?? env["V1"] ?? env["S1"] ?? safeCentralVol);
      const k = env["K"] ?? (env["CL"] !== undefined ? env["CL"] / v1 : 0.1);
      dA[0] = (dA[0] ?? 0) - k * a0;
    } else if (advan === "ADVAN2") {
      const v2 = Math.max(1e-9, env["V"] ?? env["V2"] ?? env["V1"] ?? env["S2"] ?? safeCentralVol);
      const k = env["K"] ?? (env["CL"] !== undefined ? env["CL"] / v2 : 0.1);
      const ka = env["KA"] ?? 1.0;
      dA[0] = (dA[0] ?? 0) - ka * a0;
      if (compartmentCount >= 2) {
        dA[1] = (dA[1] ?? 0) + ka * a0 - k * a1;
      }
    } else if (advan === "ADVAN3") {
      const v1 = Math.max(1e-9, env["V1"] ?? env["V"] ?? env["S1"] ?? safeCentralVol);
      const v2 = Math.max(1e-9, env["V2"] ?? (env["VSS"] !== undefined ? Math.max(1e-6, env["VSS"] - v1) : v1));
      const cl = env["CL"] ?? clearance;
      const q = env["Q"] ?? 0.5;
      const k = env["K"] ?? cl / v1;
      const k12 = env["K12"] ?? q / v1;
      const k21 = env["K21"] ?? q / v2;
      dA[0] = (dA[0] ?? 0) - (k + k12) * a0 + k21 * a1;
      if (compartmentCount >= 2) {
        dA[1] = (dA[1] ?? 0) + k12 * a0 - k21 * a1;
      }
    } else if (advan === "ADVAN4") {
      const v2 = Math.max(1e-9, env["V2"] ?? env["V1"] ?? env["V"] ?? env["S2"] ?? safeCentralVol);
      const v3 = Math.max(
        1e-9,
        env["V3"] ??
          (env["VSS"] !== undefined
            ? Math.max(1e-6, env["VSS"] - v2)
            : env["V2"] !== undefined && env["V1"] !== undefined
              ? env["V2"]
              : v2),
      );
      const cl = env["CL"] ?? clearance;
      const q = env["Q"] ?? 0.5;
      const ka = env["KA"] ?? 1.0;
      const k = env["K"] ?? cl / v2;
      const k23 = env["K23"] ?? q / v2;
      const k32 = env["K32"] ?? q / v3;
      dA[0] = (dA[0] ?? 0) - ka * a0;
      if (compartmentCount >= 2) {
        dA[1] = (dA[1] ?? 0) + ka * a0 - (k + k23) * a1 + k32 * a2;
      }
      if (compartmentCount >= 3) {
        dA[2] = (dA[2] ?? 0) + k23 * a1 - k32 * a2;
      }
    } else if (advan === "ADVAN10") {
      const v1 = Math.max(1e-9, env["V"] ?? env["V1"] ?? env["S1"] ?? safeCentralVol);
      const vm = env["VM"] ?? 1.0;
      const km = Math.max(1e-9, env["KM"] ?? 1.0);
      const c1 = a0 / v1;
      dA[0] = (dA[0] ?? 0) - (vm * c1) / (km + c1);
    } else if (advan === "ADVAN11") {
      const v1 = Math.max(1e-9, env["V1"] ?? env["V"] ?? env["S1"] ?? safeCentralVol);
      const v2 = Math.max(1e-9, env["V2"] ?? v1);
      const v3 = Math.max(1e-9, env["V3"] ?? v1);
      const cl = env["CL"] ?? clearance;
      const q2 = env["Q2"] ?? env["Q"] ?? 0.5;
      const q3 = env["Q3"] ?? 0.2;
      const k = env["K"] ?? cl / v1;
      const k12 = env["K12"] ?? q2 / v1;
      const k21 = env["K21"] ?? q2 / v2;
      const k13 = env["K13"] ?? q3 / v1;
      const k31 = env["K31"] ?? q3 / v3;
      dA[0] = (dA[0] ?? 0) - (k + k12 + k13) * a0 + k21 * a1 + k31 * a2;
      if (compartmentCount >= 2) dA[1] = (dA[1] ?? 0) + k12 * a0 - k21 * a1;
      if (compartmentCount >= 3) dA[2] = (dA[2] ?? 0) + k13 * a0 - k31 * a2;
    } else if (advan === "ADVAN12") {
      const v2 = Math.max(1e-9, env["V2"] ?? env["V1"] ?? env["V"] ?? env["S2"] ?? safeCentralVol);
      const v3 = Math.max(1e-9, env["V3"] ?? v2);
      const v4 = Math.max(1e-9, env["V4"] ?? v2);
      const cl = env["CL"] ?? clearance;
      const q3 = env["Q3"] ?? env["Q2"] ?? env["Q"] ?? 0.5;
      const q4 = env["Q4"] ?? 0.2;
      const ka = env["KA"] ?? 1.0;
      const k = env["K"] ?? cl / v2;
      const k23 = env["K23"] ?? q3 / v2;
      const k32 = env["K32"] ?? q3 / v3;
      const k24 = env["K24"] ?? q4 / v2;
      const k42 = env["K42"] ?? q4 / v4;
      dA[0] = (dA[0] ?? 0) - ka * a0;
      if (compartmentCount >= 2) {
        dA[1] = (dA[1] ?? 0) + ka * a0 - (k + k23 + k24) * a1 + k32 * a2 + k42 * a3;
      }
      if (compartmentCount >= 3) dA[2] = (dA[2] ?? 0) + k23 * a1 - k32 * a2;
      if (compartmentCount >= 4) dA[3] = (dA[3] ?? 0) + k24 * a1 - k42 * a3;
    }

    return dA;
  };

  // 5. Integrate via 4th-Order Runge-Kutta (RK4)
  const state = new Array<number>(compartmentCount).fill(0.0);

  // Apply instantaneous bolus doses at t == 0
  for (const dose of expandedDoses) {
    if (dose.rate === 0 && Math.abs(dose.time) <= 1e-9) {
      const idx = dose.cmt - 1;
      state[idx] = (state[idx] ?? 0) + dose.amt;
    }
  }

  const numSteps = Math.round(duration / timeStep);
  const timePoints: number[] = [];
  const trajectory: PkPdTimePoint[] = [];

  const recordPoint = (t: number): void => {
    const amountsMap: Record<string, number> = {};
    const concMap: Record<string, number> = {};

    for (let i = 0; i < compartmentCount; i++) {
      const amtVal = state[i] ?? 0;
      const cmtNum = i + 1;
      amountsMap[`A${cmtNum}`] = amtVal;
      const cmtDef = cs.compartments[i];
      if (cmtDef) {
        amountsMap[cmtDef.name] = amtVal;
      }
      const volI = env[`S${cmtNum}`] ?? env[`V${cmtNum}`] ?? (cmtNum === centralCmt ? safeCentralVol : 1.0);
      concMap[`C${cmtNum}`] = amtVal / Math.max(1e-9, volI);
    }

    const centralAmt = state[centralCmt - 1] ?? 0;
    const fConc = centralAmt / safeCentralVol;

    const errEnv: Record<string, number> = {
      ...env,
      T: t,
      TIME: t,
      F: fConc,
      IPRED: fConc,
      Y: fConc,
    };
    for (const errStmt of cs.errorStatements) {
      const val = evaluateNmtranExpression(errStmt.rhs, errEnv, thetas, etas, eps, state);
      errEnv[errStmt.lhs.toUpperCase()] = val;
    }

    const finalCentralConc = errEnv["IPRED"] ?? fConc;
    const predY = errEnv["Y"] ?? finalCentralConc;

    timePoints.push(t);
    trajectory.push({
      time: t,
      amounts: amountsMap,
      concentrations: concMap,
      centralConcentration: finalCentralConc,
      predictionY: predY,
    });
  };

  recordPoint(0.0);

  for (let step = 0; step < numSteps; step++) {
    const t0 = step * timeStep;
    const t1 = (step + 1) * timeStep;
    const dt = timeStep;

    const k1 = computeDerivatives(t0, state);
    const s2 = state.map((v, idx) => v + 0.5 * dt * (k1[idx] ?? 0));
    const k2 = computeDerivatives(t0 + 0.5 * dt, s2);
    const s3 = state.map((v, idx) => v + 0.5 * dt * (k2[idx] ?? 0));
    const k3 = computeDerivatives(t0 + 0.5 * dt, s3);
    const s4 = state.map((v, idx) => v + dt * (k3[idx] ?? 0));
    const k4 = computeDerivatives(t1, s4);

    for (let i = 0; i < compartmentCount; i++) {
      const delta = (dt / 6.0) * ((k1[i] ?? 0) + 2.0 * (k2[i] ?? 0) + 2.0 * (k3[i] ?? 0) + (k4[i] ?? 0));
      state[i] = Math.max(0.0, (state[i] ?? 0) + delta);
    }

    // Apply instantaneous bolus doses occurring within (t0, t1]
    for (const dose of expandedDoses) {
      if (dose.rate === 0 && dose.time > t0 + 1e-9 && dose.time <= t1 + 1e-9) {
        const idx = dose.cmt - 1;
        state[idx] = (state[idx] ?? 0) + dose.amt;
      }
    }

    recordPoint(Number(t1.toFixed(6)));
  }

  // 6. Compute Non-Compartmental Analysis (NCA) & PK Metrics
  let cMax = 0.0;
  let tMax = 0.0;
  let auc0ToT = 0.0;

  for (let i = 0; i < trajectory.length; i++) {
    const pt = trajectory[i];
    if (!pt) continue;
    if (pt.centralConcentration > cMax) {
      cMax = pt.centralConcentration;
      tMax = pt.time;
    }
    if (i > 0) {
      const prev = trajectory[i - 1];
      if (prev) {
        const dt = pt.time - prev.time;
        auc0ToT += 0.5 * (prev.centralConcentration + pt.centralConcentration) * dt;
      }
    }
  }

  // Terminal elimination rate constant lambda_z and half-life t_{1/2}
  const ke = Math.max(1e-6, env["K"] ?? clearance / safeCentralVol);
  const halfLife = Math.LN2 / ke;
  const lastConc = trajectory[trajectory.length - 1]?.centralConcentration ?? 0;
  const auc0ToInf = auc0ToT + lastConc / ke;

  const finalAmounts = trajectory[trajectory.length - 1]?.amounts ?? {};

  return {
    problem: cs.problem || "NMTRAN PK/PD Simulation",
    advan,
    trans,
    compartmentCount,
    evaluatedPkParams: env,
    timePoints,
    trajectory,
    finalAmounts,
    metrics: {
      cMax,
      tMax,
      auc0ToT,
      auc0ToInf,
      halfLife,
      clearance,
      centralVolume: safeCentralVol,
    },
  };
}
