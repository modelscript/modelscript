// SPDX-License-Identifier: AGPL-3.0-or-later

import type {
  ArrheniusParams,
  ChemkinDocument,
  ChemkinMechanism,
  ChemkinReaction,
  Nasa7ThermoRecord,
  PlogEntry,
  SriParams,
  TroeParams,
} from "../types.js";
import {
  GAS_CONSTANT_R,
  STANDARD_PRESSURE_PA,
  convertAToSI,
  convertEaToJPerMol,
  evaluateNasa7,
  resolveSpeciesMolecularWeightKgPerMol,
  resolveSpeciesThermo,
} from "./thermo.js";

export interface ChemkinReactorOptions {
  /** Reactor thermodynamic mode (default: `"constant-pressure"`). */
  mode?: "constant-volume" | "constant-pressure" | undefined;
  /** If true, fixes temperature at `temperature` (dT/dt = 0). */
  isothermal?: boolean | undefined;
  /** Initial temperature [K] (default: 1000 K). */
  temperature?: number | undefined;
  /** Initial pressure [Pa] (default: 101325 Pa = 1 atm). */
  pressure?: number | undefined;
  /** Initial mole fractions (normalized automatically). */
  moleFractions?: Record<string, number> | undefined;
  /** Initial mass fractions (normalized automatically; takes precedence over `moleFractions` if provided). */
  massFractions?: Record<string, number> | undefined;
  /** Integration end time [s] (default: 1e-3 s). */
  tEnd?: number | undefined;
  /** Number of output trajectory points (default: 200). */
  numPoints?: number | undefined;
  /** Relative error tolerance for adaptive Rosenbrock23 (default: 1e-6). */
  rtol?: number | undefined;
  /** Absolute error tolerance for adaptive Rosenbrock23 (default: 1e-10). */
  atol?: number | undefined;
  /** Maximum internal steps (default: 50000). */
  maxSteps?: number | undefined;
}

export interface ChemkinReactorTrajectory {
  mode: "constant-volume" | "constant-pressure";
  species: string[];
  time: number[];
  temperature: number[];
  pressure: number[];
  density: number[];
  /** Mass fractions `Y[sp][i]` at `time[i]`. */
  massFractions: Record<string, number[]>;
  /** Mole fractions `X[sp][i]` at `time[i]`. */
  moleFractions: Record<string, number[]>;
  /** Concentrations `C[sp][i]` [mol/m^3] at `time[i]`. */
  concentrations: Record<string, number[]>;
  /** Specific enthalpy `h(t)` [J/kg] at `time[i]`. */
  specificEnthalpy: number[];
  /** Specific internal energy `u(t)` [J/kg] at `time[i]`. */
  specificInternalEnergy: number[];
  /** Ignition delay time [s] (time of max dT/dt if deltaT > 50 K, else undefined). */
  ignitionDelayTime?: number | undefined;
  stepsTaken: number;
}

/**
 * Evaluates modified Arrhenius rate constant in SI units (`m^3`, `mol`, `s`).
 */
export function evaluateArrheniusSI(params: ArrheniusParams, order: number, mech: ChemkinMechanism, T: number): number {
  const aSI = convertAToSI(params.A, order, mech.quantityUnits);
  const eaSI = convertEaToJPerMol(params.Ea, mech.energyUnits);
  return aSI * Math.pow(T, params.b) * Math.exp(-eaSI / (GAS_CONSTANT_R * T));
}

/**
 * Evaluates Troe falloff broadening factor F(T, Pr).
 */
export function evaluateTroeFactor(troe: TroeParams, T: number, Pr: number): number {
  if (Pr <= 0) return 1.0;
  let fCent = (1.0 - troe.a) * Math.exp(-T / troe.T3) + troe.a * Math.exp(-T / troe.T1);
  if (troe.T2 !== undefined && troe.T2 > 0) {
    fCent += Math.exp(-troe.T2 / T);
  }
  fCent = Math.max(1e-300, fCent);
  const logFcent = Math.log10(fCent);
  const c = -0.4 - 0.67 * logFcent;
  const n = 0.75 - 1.27 * logFcent;
  const d = 0.14;
  const logPr = Math.log10(Pr);
  const num = logPr + c;
  const den = n - d * num;
  const ratio = num / den;
  return Math.pow(10.0, logFcent / (1.0 + ratio * ratio));
}

/**
 * Evaluates SRI falloff broadening factor F(T, Pr).
 */
export function evaluateSriFactor(sri: SriParams, T: number, Pr: number): number {
  if (Pr <= 0) return 1.0;
  const logPr = Math.log10(Pr);
  const x = 1.0 / (1.0 + logPr * logPr);
  const d = sri.d ?? 1.0;
  const e = sri.e ?? 0.0;
  const base = sri.a * Math.exp(-sri.b / T) + Math.exp(-T / sri.c);
  return d * Math.pow(Math.max(1e-300, base), x) * Math.pow(T, e);
}

/**
 * Evaluates PLOG log-linear pressure-interpolated rate constant in SI units.
 */
export function evaluatePlogSI(
  entries: PlogEntry[],
  order: number,
  mech: ChemkinMechanism,
  T: number,
  pressurePa: number,
): number {
  const pAtm = Math.max(1e-30, pressurePa / STANDARD_PRESSURE_PA);
  // Group entries by pressure (duplicate pressures are summed)
  const byP = new Map<number, number>();
  for (const e of entries) {
    const k = evaluateArrheniusSI({ A: e.A, b: e.b, Ea: e.Ea }, order, mech, T);
    byP.set(e.pressureAtm, (byP.get(e.pressureAtm) ?? 0) + k);
  }
  const sorted = Array.from(byP.entries()).sort(([p1], [p2]) => p1 - p2);
  if (sorted.length === 0) return 0;
  if (pAtm <= sorted[0]![0]) return sorted[0]![1];
  if (pAtm >= sorted[sorted.length - 1]![0]) return sorted[sorted.length - 1]![1];

  for (let i = 0; i < sorted.length - 1; i++) {
    const [p1, k1] = sorted[i]!;
    const [p2, k2] = sorted[i + 1]!;
    if (pAtm >= p1 && pAtm <= p2) {
      const w = (Math.log(pAtm) - Math.log(p1)) / (Math.log(p2) - Math.log(p1));
      const lnK =
        Math.log(Math.max(1e-300, k1)) + w * (Math.log(Math.max(1e-300, k2)) - Math.log(Math.max(1e-300, k1)));
      return Math.exp(lnK);
    }
  }
  return sorted[sorted.length - 1]![1];
}

/**
 * Computes concentration equilibrium constant `Kc` [SI: (mol/m^3)^(deltaNu)] from NASA-7 Gibbs free energies.
 */
export function computeEquilibriumConstantKc(
  rxn: ChemkinReaction,
  thermoMap: Map<string, Nasa7ThermoRecord>,
  T: number,
): number {
  let deltaG = 0;
  let deltaNu = 0;

  for (const r of rxn.reactants) {
    const rec = thermoMap.get(r.species);
    if (rec) {
      deltaG -= r.stoichiometry * evaluateNasa7(rec, T).gMolar;
    }
    deltaNu -= r.stoichiometry;
  }
  for (const p of rxn.products) {
    const rec = thermoMap.get(p.species);
    if (rec) {
      deltaG += p.stoichiometry * evaluateNasa7(rec, T).gMolar;
    }
    deltaNu += p.stoichiometry;
  }

  const kp = Math.exp(Math.max(-500, Math.min(500, -deltaG / (GAS_CONSTANT_R * T))));
  const cStd = STANDARD_PRESSURE_PA / (GAS_CONSTANT_R * T);
  return kp * Math.pow(cStd, deltaNu);
}

/**
 * Evaluates forward and reverse rate constants (SI) for a single reaction.
 */
export function evaluateReactionRatesSI(
  rxn: ChemkinReaction,
  mech: ChemkinMechanism,
  thermoMap: Map<string, Nasa7ThermoRecord>,
  speciesNames: string[],
  concentrations: number[],
  T: number,
  pressurePa: number,
): { kf: number; kr: number; Kc: number; rop: number } {
  const reactOrder = rxn.reactants.reduce((s, r) => s + r.stoichiometry, 0);
  const prodOrder = rxn.products.reduce((s, p) => s + p.stoichiometry, 0);

  // Effective third-body concentration [M]_eff [mol/m^3]
  let mEff = 0;
  if (rxn.thirdBody || rxn.falloff) {
    if (rxn.thirdBodySpecies) {
      const idx = speciesNames.indexOf(rxn.thirdBodySpecies);
      mEff = idx >= 0 ? Math.max(0, concentrations[idx]!) : 0;
    } else {
      for (let k = 0; k < speciesNames.length; k++) {
        const sp = speciesNames[k]!;
        const eff = rxn.efficiencies[sp] ?? 1.0;
        mEff += eff * Math.max(0, concentrations[k]!);
      }
    }
  }

  let kf: number;
  if (rxn.plog && rxn.plog.length > 0) {
    kf = evaluatePlogSI(rxn.plog, reactOrder, mech, T, pressurePa);
  } else if (rxn.falloff && rxn.low) {
    const kInf = evaluateArrheniusSI(rxn.rate, reactOrder, mech, T);
    const k0 = evaluateArrheniusSI(rxn.low, reactOrder + 1, mech, T);
    const pr = kInf > 0 ? (k0 * mEff) / kInf : 0;
    let fFactor = 1.0;
    if (rxn.troe) {
      fFactor = evaluateTroeFactor(rxn.troe, T, pr);
    } else if (rxn.sri) {
      fFactor = evaluateSriFactor(rxn.sri, T, pr);
    }
    kf = kInf * (pr / (1.0 + pr)) * fFactor;
  } else if (rxn.thirdBody) {
    kf = evaluateArrheniusSI(rxn.rate, reactOrder + 1, mech, T) * mEff;
  } else {
    kf = evaluateArrheniusSI(rxn.rate, reactOrder, mech, T);
  }

  let kr = 0;
  let Kc = 1;
  if (rxn.reversible) {
    if (rxn.rev) {
      kr = rxn.thirdBody
        ? evaluateArrheniusSI(rxn.rev, prodOrder + 1, mech, T) * mEff
        : evaluateArrheniusSI(rxn.rev, prodOrder, mech, T);
      Kc = kr > 0 ? kf / kr : 1;
    } else {
      Kc = computeEquilibriumConstantKc(rxn, thermoMap, T);
      kr = Kc > 1e-300 ? kf / Kc : 0;
    }
  }

  let fwdProd = 1.0;
  for (const r of rxn.reactants) {
    const idx = speciesNames.indexOf(r.species);
    const c = idx >= 0 ? Math.max(0, concentrations[idx]!) : 0;
    fwdProd *= r.stoichiometry === 1 ? c : Math.pow(c, r.stoichiometry);
  }

  let revProd = 0.0;
  if (rxn.reversible) {
    revProd = 1.0;
    for (const p of rxn.products) {
      const idx = speciesNames.indexOf(p.species);
      const c = idx >= 0 ? Math.max(0, concentrations[idx]!) : 0;
      revProd *= p.stoichiometry === 1 ? c : Math.pow(c, p.stoichiometry);
    }
  }

  const rop = kf * fwdProd - kr * revProd;
  return { kf, kr, Kc, rop };
}

/**
 * Dense Gaussian elimination with partial pivoting solving A * x = b in-place.
 */
function solveDenseLinear(A: Float64Array, b: Float64Array, n: number): Float64Array {
  const M = new Float64Array(A);
  const rhs = new Float64Array(b);

  for (let col = 0; col < n; col++) {
    let pivotRow = col;
    let maxAbs = Math.abs(M[col * n + col]!);
    for (let row = col + 1; row < n; row++) {
      const v = Math.abs(M[row * n + col]!);
      if (v > maxAbs) {
        maxAbs = v;
        pivotRow = row;
      }
    }
    if (pivotRow !== col) {
      for (let j = col; j < n; j++) {
        const tmp = M[col * n + j]!;
        M[col * n + j] = M[pivotRow * n + j]!;
        M[pivotRow * n + j] = tmp;
      }
      const tmpB = rhs[col]!;
      rhs[col] = rhs[pivotRow]!;
      rhs[pivotRow] = tmpB;
    }

    const pivot = M[col * n + col]!;
    if (Math.abs(pivot) < 1e-30) continue;

    for (let row = col + 1; row < n; row++) {
      const factor = M[row * n + col]! / pivot;
      if (factor === 0) continue;
      for (let j = col + 1; j < n; j++) {
        M[row * n + j] = M[row * n + j]! - factor * M[col * n + j]!;
      }
      rhs[row] = rhs[row]! - factor * rhs[col]!;
    }
  }

  const x = new Float64Array(n);
  for (let row = n - 1; row >= 0; row--) {
    let sum = rhs[row]!;
    for (let j = row + 1; j < n; j++) {
      sum -= M[row * n + j]! * x[j]!;
    }
    const diag = M[row * n + row]!;
    x[row] = Math.abs(diag) > 1e-30 ? sum / diag : 0;
  }
  return x;
}

/**
 * Integrates a 0D adiabatic (or isothermal) constant-volume or constant-pressure
 * batch chemical reactor using an adaptive L-stable 2-stage Rosenbrock (ROS2) solver.
 */
export function solveChemkinReactor(doc: ChemkinDocument, options?: ChemkinReactorOptions): ChemkinReactorTrajectory {
  const mech = doc.mechanism;
  const mode = options?.mode ?? "constant-pressure";
  const isothermal = options?.isothermal ?? false;
  const T0 = options?.temperature ?? 1000.0;
  const P0 = options?.pressure ?? STANDARD_PRESSURE_PA;
  const tEnd = options?.tEnd ?? 1e-3;
  const numPoints = Math.max(2, options?.numPoints ?? 200);
  const rtol = options?.rtol ?? 1e-6;
  const atol = options?.atol ?? 1e-10;
  const maxSteps = options?.maxSteps ?? 50000;

  // Build ordered species list
  const speciesNames = Array.from(mech.species.keys());
  if (speciesNames.length === 0) {
    const seen = new Set<string>();
    for (const rxn of mech.reactions) {
      for (const r of rxn.reactants) seen.add(r.species);
      for (const p of rxn.products) seen.add(p.species);
    }
    speciesNames.push(...seen);
  }
  const nSp = speciesNames.length;
  const nState = nSp + 1; // [Y_0, ..., Y_{nSp-1}, T]

  const mw = new Float64Array(nSp);
  const thermoMap = new Map<string, Nasa7ThermoRecord>();
  const thermoList: Array<Nasa7ThermoRecord | undefined> = [];
  for (let k = 0; k < nSp; k++) {
    const sp = speciesNames[k]!;
    mw[k] = resolveSpeciesMolecularWeightKgPerMol(mech, sp);
    const rec = resolveSpeciesThermo(mech, sp);
    thermoList.push(rec);
    if (rec) thermoMap.set(sp, rec);
  }

  // Initialize mass fractions Y0
  const y = new Float64Array(nState);
  if (options?.massFractions) {
    let sumY = 0;
    for (let k = 0; k < nSp; k++) {
      const v = Math.max(0, options.massFractions[speciesNames[k]!] ?? 0);
      y[k] = v;
      sumY += v;
    }
    if (sumY > 0) {
      for (let k = 0; k < nSp; k++) y[k] = y[k]! / sumY;
    } else if (nSp > 0) {
      y[0] = 1.0;
    }
  } else if (options?.moleFractions) {
    let sumXW = 0;
    for (let k = 0; k < nSp; k++) {
      const xk = Math.max(0, options.moleFractions[speciesNames[k]!] ?? 0);
      sumXW += xk * mw[k]!;
    }
    if (sumXW > 0) {
      for (let k = 0; k < nSp; k++) {
        const xk = Math.max(0, options.moleFractions[speciesNames[k]!] ?? 0);
        y[k] = (xk * mw[k]!) / sumXW;
      }
    } else if (nSp > 0) {
      y[0] = 1.0;
    }
  } else if (nSp > 0) {
    for (let k = 0; k < nSp; k++) y[k] = 1.0 / nSp;
  }
  y[nSp] = T0;

  // Compute initial mixture molecular weight and density
  const computeMixProps = (state: Float64Array, rhoConst?: number) => {
    const T = Math.max(50.0, state[nSp]!);
    let invW = 0;
    for (let k = 0; k < nSp; k++) {
      invW += Math.max(0, state[k]!) / mw[k]!;
    }
    const wMix = invW > 0 ? 1.0 / invW : 0.028;
    const rho = mode === "constant-volume" && rhoConst !== undefined ? rhoConst : (P0 * wMix) / (GAS_CONSTANT_R * T);
    const P = mode === "constant-volume" ? (rho * GAS_CONSTANT_R * T) / wMix : P0;
    const C = new Array<number>(nSp);
    const X = new Array<number>(nSp);
    for (let k = 0; k < nSp; k++) {
      const yk = Math.max(0, state[k]!);
      C[k] = (rho * yk) / mw[k]!;
      X[k] = (yk / mw[k]!) * wMix;
    }
    return { T, wMix, rho, P, C, X };
  };

  const initProps = computeMixProps(y);
  const rho0 = initProps.rho;

  // RHS evaluator: dy/dt = f(y)
  const evalRhs = (state: Float64Array, out: Float64Array): void => {
    const { T, rho, P, C } = computeMixProps(state, rho0);
    const omega = new Float64Array(nSp);

    for (const rxn of mech.reactions) {
      const { rop } = evaluateReactionRatesSI(rxn, mech, thermoMap, speciesNames, C, T, P);
      for (const r of rxn.reactants) {
        const idx = speciesNames.indexOf(r.species);
        if (idx >= 0) omega[idx] = omega[idx]! - r.stoichiometry * rop;
      }
      for (const p of rxn.products) {
        const idx = speciesNames.indexOf(p.species);
        if (idx >= 0) omega[idx] = omega[idx]! + p.stoichiometry * rop;
      }
    }

    for (let k = 0; k < nSp; k++) {
      out[k] = (omega[k]! * mw[k]!) / rho;
    }

    if (isothermal) {
      out[nSp] = 0.0;
      return;
    }

    let heatRelease = 0;
    let rhoCap = 0;
    for (let k = 0; k < nSp; k++) {
      const rec = thermoList[k];
      if (rec) {
        const th = evaluateNasa7(rec, T);
        if (mode === "constant-volume") {
          heatRelease += omega[k]! * th.uMolar;
          rhoCap += C[k]! * th.cvMolar;
        } else {
          heatRelease += omega[k]! * th.hMolar;
          rhoCap += C[k]! * th.cpMolar;
        }
      } else {
        // Fallback ideal diatomic heat capacity
        const cp = 3.5 * GAS_CONSTANT_R;
        const cv = 2.5 * GAS_CONSTANT_R;
        rhoCap += C[k]! * (mode === "constant-volume" ? cv : cp);
      }
    }
    out[nSp] = rhoCap > 1e-12 ? -heatRelease / rhoCap : 0.0;
  };

  // Output storage
  const timeArr: number[] = [];
  const tempArr: number[] = [];
  const pressArr: number[] = [];
  const densArr: number[] = [];
  const hSpecArr: number[] = [];
  const uSpecArr: number[] = [];
  const yOut: Record<string, number[]> = {};
  const xOut: Record<string, number[]> = {};
  const cOut: Record<string, number[]> = {};
  for (const sp of speciesNames) {
    yOut[sp] = [];
    xOut[sp] = [];
    cOut[sp] = [];
  }

  const recordPoint = (tVal: number, state: Float64Array) => {
    const { T, rho, P, C, X } = computeMixProps(state, rho0);
    timeArr.push(tVal);
    tempArr.push(T);
    pressArr.push(P);
    densArr.push(rho);
    let hSpec = 0;
    let uSpec = 0;
    for (let k = 0; k < nSp; k++) {
      const sp = speciesNames[k]!;
      const yk = state[k]!;
      yOut[sp]!.push(yk);
      xOut[sp]!.push(X[k]!);
      cOut[sp]!.push(C[k]!);
      const rec = thermoList[k];
      if (rec) {
        const th = evaluateNasa7(rec, T);
        hSpec += (yk / mw[k]!) * th.hMolar;
        uSpec += (yk / mw[k]!) * th.uMolar;
      }
    }
    hSpecArr.push(hSpec);
    uSpecArr.push(uSpec);
  };

  // Adaptive ROS2 (2-stage L-stable Rosenbrock)
  const GAMMA = 1.0 - Math.SQRT1_2; // 0.2928932188134525
  const f0 = new Float64Array(nState);
  const f1 = new Float64Array(nState);
  const fPert = new Float64Array(nState);
  const yPert = new Float64Array(nState);
  const yStage = new Float64Array(nState);
  const yNew = new Float64Array(nState);
  const jac = new Float64Array(nState * nState);
  const mat = new Float64Array(nState * nState);
  const rhs2 = new Float64Array(nState);

  recordPoint(0.0, y);

  let t = 0.0;
  let h = Math.min(tEnd / 100.0, 1e-6);
  if (h <= 0) h = 1e-9;
  const dtOut = tEnd / (numPoints - 1);
  let nextOutIdx = 1;
  let stepsTaken = 0;

  while (t < tEnd - 1e-15 && stepsTaken < maxSteps) {
    const tTarget = Math.min(tEnd, nextOutIdx * dtOut);
    if (t + h > tTarget) {
      h = tTarget - t;
    }
    if (h <= 0) break;

    evalRhs(y, f0);

    // Numerical Jacobian J = df/dy
    for (let j = 0; j < nState; j++) {
      yPert.set(y);
      const eps = Math.max(1e-8, Math.abs(y[j]!) * 1e-6);
      yPert[j] = y[j]! + eps;
      evalRhs(yPert, fPert);
      for (let i = 0; i < nState; i++) {
        jac[i * nState + j] = (fPert[i]! - f0[i]!) / eps;
      }
    }

    // Form M = I - GAMMA * h * J (Verwer ROS2, 2nd-order L-stable)
    const gh = GAMMA * h;
    for (let i = 0; i < nState; i++) {
      for (let j = 0; j < nState; j++) {
        mat[i * nState + j] = (i === j ? 1.0 : 0.0) - gh * jac[i * nState + j]!;
      }
    }

    // Stage 1: M * k1 = h * f(y)
    const rhs1 = new Float64Array(nState);
    for (let i = 0; i < nState; i++) {
      rhs1[i] = h * f0[i]!;
    }
    const k1 = solveDenseLinear(mat, rhs1, nState);

    // Stage 2: M * k2 = h * f(y + k1) - 2 * k1
    for (let i = 0; i < nState; i++) {
      yStage[i] = y[i]! + k1[i]!;
    }
    evalRhs(yStage, f1);
    for (let i = 0; i < nState; i++) {
      rhs2[i] = h * f1[i]! - 2.0 * k1[i]!;
    }
    const k2 = solveDenseLinear(mat, rhs2, nState);

    // 2nd-order solution: y_new = y + 1.5*k1 + 0.5*k2; embedded 1st-order: y_1 = y + k1
    // Error estimate: err = 0.5 * (k1 + k2)
    let errNormSq = 0;
    for (let i = 0; i < nState; i++) {
      const yn = y[i]! + 1.5 * k1[i]! + 0.5 * k2[i]!;
      yNew[i] = yn;
      const err = 0.5 * (k1[i]! + k2[i]!);
      const sc = atol + rtol * Math.max(Math.abs(y[i]!), Math.abs(yn));
      const ratio = err / sc;
      errNormSq += ratio * ratio;
    }
    const errNorm = Math.sqrt(errNormSq / nState);

    if (errNorm <= 1.0 || h <= 1e-13) {
      // Accept step
      t += h;
      y.set(yNew);
      stepsTaken++;

      // Record output point if we hit tTarget
      if (Math.abs(t - tTarget) <= 1e-12 * Math.max(1, tEnd) && nextOutIdx < numPoints) {
        recordPoint(t, y);
        nextOutIdx++;
      }

      const fac = errNorm > 0 ? Math.min(3.0, Math.max(0.2, 0.9 / Math.sqrt(errNorm))) : 2.0;
      h = Math.min(dtOut, Math.max(1e-13, h * fac));
    } else {
      // Reject step and shrink h
      const fac = Math.max(0.1, Math.min(0.5, 0.9 / Math.sqrt(errNorm)));
      h = Math.max(1e-13, h * fac);
    }
  }

  // Ensure final point is recorded
  if (timeArr.length < numPoints && timeArr[timeArr.length - 1]! < tEnd - 1e-12) {
    recordPoint(t, y);
  }

  // Compute ignition delay time (time of max dT/dt if significant temperature rise)
  let ignitionDelayTime: number | undefined;
  const maxT = Math.max(...tempArr);
  if (maxT - T0 > 50.0 && timeArr.length >= 3) {
    let maxSlope = -1;
    let tIgn = timeArr[0]!;
    for (let i = 1; i < timeArr.length; i++) {
      const dt = timeArr[i]! - timeArr[i - 1]!;
      if (dt > 0) {
        const slope = (tempArr[i]! - tempArr[i - 1]!) / dt;
        if (slope > maxSlope) {
          maxSlope = slope;
          tIgn = 0.5 * (timeArr[i]! + timeArr[i - 1]!);
        }
      }
    }
    ignitionDelayTime = tIgn;
  }

  return {
    mode,
    species: speciesNames,
    time: timeArr,
    temperature: tempArr,
    pressure: pressArr,
    density: densArr,
    massFractions: yOut,
    moleFractions: xOut,
    concentrations: cOut,
    specificEnthalpy: hSpecArr,
    specificInternalEnergy: uSpecArr,
    ignitionDelayTime,
    stepsTaken,
  };
}
