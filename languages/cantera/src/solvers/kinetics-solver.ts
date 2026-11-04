// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/cantera — NASA-7 Thermochemistry, Modified Arrhenius / Troe Falloff Kinetics,
 * and Gas-Phase Batch Reactor ODE Solver.
 */

import type { ArrheniusRate, CanteraDocument, Nasa7Polynomial, TroeFalloff } from "../types.js";

/** Universal gas constant R [J/(mol*K)] */
export const GAS_CONSTANT_R = 8.31446261815324;

/** Standard reference pressure P^0 [Pa] */
export const STANDARD_PRESSURE_PA = 101325.0;

export interface Nasa7ThermoResult {
  cpOverR: number;
  hOverRT: number;
  sOverR: number;
  cp_J_molK: number;
  h_J_mol: number;
  s_J_molK: number;
  g_J_mol: number;
}

/**
 * Evaluates a 7-coefficient NASA polynomial at temperature T [K] using either
 * a specific 7-coefficient array or selecting low/high range at Tmid.
 */
export function evaluateNasa7Coeffs(coeffs: number[], T: number): Nasa7ThermoResult {
  const safeT = Math.max(1.0, T);
  const a0 = coeffs[0] ?? 0;
  const a1 = coeffs[1] ?? 0;
  const a2 = coeffs[2] ?? 0;
  const a3 = coeffs[3] ?? 0;
  const a4 = coeffs[4] ?? 0;
  const a5 = coeffs[5] ?? 0;
  const a6 = coeffs[6] ?? 0;

  const T2 = safeT * safeT;
  const T3 = T2 * safeT;
  const T4 = T3 * safeT;

  const cpOverR = a0 + a1 * safeT + a2 * T2 + a3 * T3 + a4 * T4;
  const hOverRT = a0 + (a1 / 2.0) * safeT + (a2 / 3.0) * T2 + (a3 / 4.0) * T3 + (a4 / 5.0) * T4 + a5 / safeT;
  const sOverR = a0 * Math.log(safeT) + a1 * safeT + (a2 / 2.0) * T2 + (a3 / 3.0) * T3 + (a4 / 4.0) * T4 + a6;

  const cp_J_molK = cpOverR * GAS_CONSTANT_R;
  const h_J_mol = hOverRT * GAS_CONSTANT_R * safeT;
  const s_J_molK = sOverR * GAS_CONSTANT_R;
  const g_J_mol = h_J_mol - safeT * s_J_molK;

  return {
    cpOverR,
    hOverRT,
    sOverR,
    cp_J_molK,
    h_J_mol,
    s_J_molK,
    g_J_mol,
  };
}

/**
 * Evaluates NASA-7 thermodynamic properties at temperature T [K].
 */
export function evaluateNasa7Thermo(poly: Nasa7Polynomial, T: number): Nasa7ThermoResult {
  const coeffs = T <= poly.Tmid ? poly.lowCoeffs : poly.highCoeffs;
  return evaluateNasa7Coeffs(coeffs, T);
}

/**
 * Evaluates modified Arrhenius rate constant k(T) = A * T^b * exp(-Ea / (R * T)).
 * Expects Ea in J/mol and T in K.
 */
export function evaluateArrheniusRate(rate: ArrheniusRate, T: number): number {
  const safeT = Math.max(1.0, T);
  const expArg = -rate.Ea / (GAS_CONSTANT_R * safeT);
  const clampedExp = Math.max(-700.0, Math.min(700.0, expArg));
  return rate.A * Math.pow(safeT, rate.b) * Math.exp(clampedExp);
}

/**
 * Evaluates Troe falloff broadening factor F(T, Pr).
 */
export function evaluateTroeBroadeningFactor(troe: TroeFalloff, T: number, Pr: number): number {
  if (Pr <= 0) return 1.0;
  const safeT = Math.max(1.0, T);
  const term1 = troe.T3 !== 0 ? (1.0 - troe.A) * Math.exp(-safeT / troe.T3) : 1.0 - troe.A;
  const term2 = troe.T1 !== 0 ? troe.A * Math.exp(-safeT / troe.T1) : troe.A;
  const term3 = troe.T2 !== undefined && troe.T2 !== 0 ? Math.exp(-troe.T2 / safeT) : 0.0;

  const Fcent = Math.max(1e-30, term1 + term2 + term3);
  const logFcent = Math.log10(Fcent);
  const logPr = Math.log10(Math.max(1e-30, Pr));

  const c = -0.4 - 0.67 * logFcent;
  const n = 0.75 - 1.27 * logFcent;
  const d = 0.14;

  const num = logPr + c;
  const den = n - d * num;
  if (Math.abs(den) < 1e-12) return Fcent;

  const ratio = num / den;
  const logF = logFcent / (1.0 + ratio * ratio);
  return Math.pow(10.0, logF);
}

export interface CanteraReactorOptions {
  temperature?: number | undefined; // K (default from phase state or 1000 K)
  pressure?: number | undefined; // Pa (default from phase state or 101325 Pa)
  duration?: number | undefined; // s (default 1.0e-3)
  timeStep?: number | undefined; // s (default duration / 100)
  initialMoleFractions?: Record<string, number> | undefined;
  initialConcentrations?: Record<string, number> | undefined; // mol/m^3
  energy?: "off" | "isothermal" | "adiabatic" | undefined;
  reactorType?: "constant-volume" | "constant-pressure" | undefined;
  useEquilibriumReverse?: boolean | undefined; // default true
}

export interface CanteraReactorResult {
  mechanismName: string;
  timePoints: number[];
  temperatureTrajectory: number[];
  pressureTrajectory: number[];
  speciesNames: string[];
  trajectories: Record<string, number[]>; // concentrations [mol/m^3]
  moleFractionTrajectories: Record<string, number[]>;
  initialConcentrations: Record<string, number>;
  finalConcentrations: Record<string, number>;
  finalMoleFractions: Record<string, number>;
  finalTemperature: number;
  finalPressure: number;
  elementTotalsInitial: Record<string, number>;
  elementTotalsFinal: Record<string, number>;
  stepsCount: number;
}

export function solveCanteraReactor(doc: CanteraDocument, options?: CanteraReactorOptions): CanteraReactorResult {
  const mech = doc.mechanism;
  const firstPhase = mech.phases.values().next().value;

  const T0 = options?.temperature ?? firstPhase?.state?.T ?? 1000.0;
  const P0 = options?.pressure ?? firstPhase?.state?.P ?? STANDARD_PRESSURE_PA;
  const duration = options?.duration ?? 1.0e-3;
  const dt = options?.timeStep ?? duration / 100.0;
  const stepsCount = Math.max(1, Math.round(duration / dt));
  const energyMode = options?.energy ?? "isothermal";
  const reactorType = options?.reactorType ?? "constant-volume";
  const useEqRev = options?.useEquilibriumReverse ?? true;

  // Collect ordered species list
  const speciesNames: string[] =
    firstPhase && firstPhase.species.length > 0 ? [...firstPhase.species] : Array.from(mech.species.keys());
  for (const spName of mech.species.keys()) {
    if (!speciesNames.includes(spName)) {
      speciesNames.push(spName);
    }
  }

  const nSpecies = speciesNames.length;
  const spIndex = new Map<string, number>();
  speciesNames.forEach((name, idx) => spIndex.set(name, idx));

  // Initialize concentrations [mol/m^3]
  const conc = new Float64Array(nSpecies);
  const totalConcentration0 = P0 / (GAS_CONSTANT_R * T0); // mol/m^3

  if (options?.initialConcentrations) {
    for (let i = 0; i < nSpecies; i++) {
      const name = speciesNames[i]!;
      conc[i] = Math.max(0, options.initialConcentrations[name] ?? 0);
    }
  } else {
    const rawX = options?.initialMoleFractions ?? firstPhase?.state?.X;
    if (rawX && Object.keys(rawX).length > 0) {
      let sumX = 0;
      for (const v of Object.values(rawX)) {
        sumX += Math.max(0, v);
      }
      const norm = sumX > 0 ? sumX : 1.0;
      for (let i = 0; i < nSpecies; i++) {
        const name = speciesNames[i]!;
        const xVal = Math.max(0, rawX[name] ?? 0) / norm;
        conc[i] = xVal * totalConcentration0;
      }
    } else if (nSpecies > 0) {
      for (let i = 0; i < nSpecies; i++) {
        conc[i] = totalConcentration0 / nSpecies;
      }
    }
  }

  const computeElementTotals = (cVec: Float64Array): Record<string, number> => {
    const totals: Record<string, number> = {};
    for (let i = 0; i < nSpecies; i++) {
      const spName = speciesNames[i]!;
      const spDef = mech.species.get(spName);
      if (!spDef) continue;
      const c = cVec[i] ?? 0;
      for (const [el, count] of Object.entries(spDef.composition)) {
        totals[el] = (totals[el] ?? 0) + count * c;
      }
    }
    return totals;
  };

  const initialConcentrations: Record<string, number> = {};
  const trajectories: Record<string, number[]> = {};
  const moleFractionTrajectories: Record<string, number[]> = {};

  let initTotalC = 0;
  for (let i = 0; i < nSpecies; i++) initTotalC += conc[i] ?? 0;
  const safeInitTotalC = initTotalC > 0 ? initTotalC : 1.0;

  for (let i = 0; i < nSpecies; i++) {
    const name = speciesNames[i]!;
    const cVal = conc[i] ?? 0;
    initialConcentrations[name] = cVal;
    trajectories[name] = [cVal];
    moleFractionTrajectories[name] = [cVal / safeInitTotalC];
  }

  const elementTotalsInitial = computeElementTotals(conc);
  const timePoints: number[] = [0];
  const temperatureTrajectory: number[] = [T0];
  const pressureTrajectory: number[] = [P0];

  let currentT = T0;
  let currentP = P0;

  // Helper to evaluate reaction rates of progress q_r [mol/(m^3 * s)]
  const computeReactionRatesOfProgress = (cVec: Float64Array, T: number): Float64Array => {
    const nRxn = mech.reactions.length;
    const q = new Float64Array(nRxn);

    // Precompute species Gibbs free energy G^0(T) [J/mol] if needed
    const speciesG0 = new Float64Array(nSpecies);
    const hasThermo = new Uint8Array(nSpecies);
    for (let i = 0; i < nSpecies; i++) {
      const spDef = mech.species.get(speciesNames[i]!);
      if (spDef?.thermo) {
        const th = evaluateNasa7Thermo(spDef.thermo, T);
        speciesG0[i] = th.g_J_mol;
        hasThermo[i] = 1;
      }
    }

    for (let rIdx = 0; rIdx < nRxn; rIdx++) {
      const rxn = mech.reactions[rIdx]!;

      // Compute third-body effective concentration [M]_eff if needed
      let mEff = 1.0;
      if (rxn.type === "three-body" || rxn.type === "falloff") {
        mEff = 0.0;
        for (let i = 0; i < nSpecies; i++) {
          const spName = speciesNames[i]!;
          const eff = rxn.efficiencies?.[spName] ?? 1.0;
          mEff += eff * Math.max(0, cVec[i] ?? 0);
        }
      }

      // Forward rate constant k_f
      let kf = evaluateArrheniusRate(rxn.rateConstant, T);
      if (rxn.type === "three-body") {
        kf *= mEff;
      } else if (rxn.type === "falloff") {
        const kInf = kf;
        const k0 = rxn.lowRateConstant ? evaluateArrheniusRate(rxn.lowRateConstant, T) : kInf;
        const Pr = kInf > 0 ? (k0 * mEff) / kInf : 0.0;
        const fLindemann = Pr / (1.0 + Pr);
        const fBroad = rxn.troe ? evaluateTroeBroadeningFactor(rxn.troe, T, Pr) : 1.0;
        kf = kInf * fLindemann * fBroad;
      }

      // Forward rate of progress
      let ropForward = kf;
      for (const react of rxn.reactants) {
        const sIdx = spIndex.get(react.species);
        const cVal = sIdx !== undefined ? Math.max(0, cVec[sIdx] ?? 0) : 0;
        const order = rxn.orders?.[react.species] ?? react.stoichiometry;
        ropForward *= Math.pow(cVal, order);
      }

      // Reverse rate of progress
      let ropReverse = 0.0;
      if (rxn.reversible && useEqRev && rxn.products.length > 0) {
        let allHaveThermo = true;
        let deltaG0 = 0.0;
        let deltaNu = 0.0;

        for (const prod of rxn.products) {
          const sIdx = spIndex.get(prod.species);
          if (sIdx === undefined || !hasThermo[sIdx]) {
            allHaveThermo = false;
            break;
          }
          deltaG0 += prod.stoichiometry * (speciesG0[sIdx] ?? 0);
          deltaNu += prod.stoichiometry;
        }
        if (allHaveThermo) {
          for (const react of rxn.reactants) {
            const sIdx = spIndex.get(react.species);
            if (sIdx === undefined || !hasThermo[sIdx]) {
              allHaveThermo = false;
              break;
            }
            deltaG0 -= react.stoichiometry * (speciesG0[sIdx] ?? 0);
            deltaNu -= react.stoichiometry;
          }
        }

        if (allHaveThermo) {
          const expArg = Math.max(-700.0, Math.min(700.0, -deltaG0 / (GAS_CONSTANT_R * T)));
          const Kp = Math.exp(expArg);
          const stdConc = STANDARD_PRESSURE_PA / (GAS_CONSTANT_R * T); // mol/m^3
          const Kc = Math.max(1e-300, Kp * Math.pow(stdConc, deltaNu));
          const kr = kf / Kc;

          ropReverse = kr;
          for (const prod of rxn.products) {
            const sIdx = spIndex.get(prod.species);
            const cVal = sIdx !== undefined ? Math.max(0, cVec[sIdx] ?? 0) : 0;
            ropReverse *= Math.pow(cVal, prod.stoichiometry);
          }
        }
      }

      q[rIdx] = ropForward - ropReverse;
    }

    return q;
  };

  // Advance step-by-step using positivity-preserving stoichiometric extent integration
  const nSubsteps = 10;
  const subDt = dt / nSubsteps;

  for (let step = 1; step <= stepsCount; step++) {
    for (let sub = 0; sub < nSubsteps; sub++) {
      const q = computeReactionRatesOfProgress(conc, currentT);
      const nRxn = mech.reactions.length;
      const dXi = new Float64Array(nRxn);
      for (let r = 0; r < nRxn; r++) {
        dXi[r] = (q[r] ?? 0) * subDt;
      }

      // Compute proposed species change dC_i = sum_r nu_{i,r} * dXi_r
      const dC = new Float64Array(nSpecies);
      for (let r = 0; r < nRxn; r++) {
        const rxn = mech.reactions[r]!;
        const xi = dXi[r] ?? 0;
        for (const react of rxn.reactants) {
          const idx = spIndex.get(react.species);
          if (idx !== undefined) dC[idx] = (dC[idx] ?? 0) - react.stoichiometry * xi;
        }
        for (const prod of rxn.products) {
          const idx = spIndex.get(prod.species);
          if (idx !== undefined) dC[idx] = (dC[idx] ?? 0) + prod.stoichiometry * xi;
        }
      }

      // Positivity limiter: scale uniform step factor alpha in (0, 1] so conc + alpha * dC >= 0
      // Because alpha scales the entire vector dC = N * dXi uniformly, element conservation is exact!
      let alpha = 1.0;
      for (let i = 0; i < nSpecies; i++) {
        const delta = dC[i] ?? 0;
        const curr = conc[i] ?? 0;
        if (delta < 0 && curr + delta < 0) {
          const maxFrac = (0.99 * curr) / -delta;
          if (maxFrac < alpha) {
            alpha = maxFrac;
          }
        }
      }

      for (let i = 0; i < nSpecies; i++) {
        conc[i] = Math.max(0, (conc[i] ?? 0) + alpha * (dC[i] ?? 0));
      }

      // Adiabatic temperature evolution if enabled
      if (energyMode === "adiabatic") {
        let heatReleaseRate = 0.0; // J/m^3
        let totalHeatCapacity = 0.0; // J/(m^3 * K)
        for (let i = 0; i < nSpecies; i++) {
          const spDef = mech.species.get(speciesNames[i]!);
          if (!spDef?.thermo) continue;
          const th = evaluateNasa7Thermo(spDef.thermo, currentT);
          const dCi = alpha * (dC[i] ?? 0);
          const cp = th.cp_J_molK;
          const cv = Math.max(1.0, cp - GAS_CONSTANT_R);
          const molarEnergy = reactorType === "constant-pressure" ? th.h_J_mol : th.h_J_mol - GAS_CONSTANT_R * currentT;
          heatReleaseRate -= molarEnergy * dCi;
          totalHeatCapacity += (conc[i] ?? 0) * (reactorType === "constant-pressure" ? cp : cv);
        }
        if (totalHeatCapacity > 1e-12) {
          const dT = Math.max(-200.0, Math.min(200.0, heatReleaseRate / totalHeatCapacity));
          currentT = Math.max(200.0, Math.min(5000.0, currentT + dT));
        }
      }

      // Update pressure for constant-volume ideal gas: P = sum(C_i) * R * T
      let sumC = 0;
      for (let i = 0; i < nSpecies; i++) sumC += conc[i] ?? 0;
      if (reactorType === "constant-volume") {
        currentP = sumC * GAS_CONSTANT_R * currentT;
      } else {
        currentP = P0;
      }
    }

    const tNow = Number((step * dt).toPrecision(12));
    timePoints.push(tNow);
    temperatureTrajectory.push(currentT);
    pressureTrajectory.push(currentP);

    let totalC = 0;
    for (let i = 0; i < nSpecies; i++) totalC += conc[i] ?? 0;
    const safeTotalC = totalC > 0 ? totalC : 1.0;

    for (let i = 0; i < nSpecies; i++) {
      const name = speciesNames[i]!;
      const cVal = conc[i] ?? 0;
      trajectories[name]?.push(cVal);
      moleFractionTrajectories[name]?.push(cVal / safeTotalC);
    }
  }

  const finalConcentrations: Record<string, number> = {};
  const finalMoleFractions: Record<string, number> = {};
  let finalTotalC = 0;
  for (let i = 0; i < nSpecies; i++) finalTotalC += conc[i] ?? 0;
  const safeFinalTotalC = finalTotalC > 0 ? finalTotalC : 1.0;

  for (let i = 0; i < nSpecies; i++) {
    const name = speciesNames[i]!;
    const cVal = conc[i] ?? 0;
    finalConcentrations[name] = cVal;
    finalMoleFractions[name] = cVal / safeFinalTotalC;
  }

  const elementTotalsFinal = computeElementTotals(conc);

  return {
    mechanismName: mech.name,
    timePoints,
    temperatureTrajectory,
    pressureTrajectory,
    speciesNames,
    trajectories,
    moleFractionTrajectories,
    initialConcentrations,
    finalConcentrations,
    finalMoleFractions,
    finalTemperature: currentT,
    finalPressure: currentP,
    elementTotalsInitial,
    elementTotalsFinal,
    stepsCount,
  };
}
