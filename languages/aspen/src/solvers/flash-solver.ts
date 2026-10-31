// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/aspen — Rachford-Rice Vapor-Liquid Equilibrium (VLE) Flash Solver.
 *
 * Implements rigorous numerical solution of the Rachford-Rice equation for isothermal
 * and isobaric flash separation:
 *   f(psi) = sum_i [ z_i * (K_i - 1) / (1 + psi * (K_i - 1)) ] = 0
 */

export interface ComponentPhysicalConstants {
  name: string;
  formula: string;
  Tc: number; // Critical temperature [K]
  Pc: number; // Critical pressure [bar]
  omega: number; // Acentric factor
  // Antoine constants for log10(P_sat [mmHg]) = A - B / (T[C] + C)
  antoine?: { A: number; B: number; C: number } | undefined;
}

export const KNOWN_COMPONENTS: Record<string, ComponentPhysicalConstants> = {
  METHANOL: {
    name: "Methanol",
    formula: "CH4O",
    Tc: 512.6,
    Pc: 80.9,
    omega: 0.556,
    antoine: { A: 7.87863, B: 1473.11, C: 230.0 },
  },
  WATER: {
    name: "Water",
    formula: "H2O",
    Tc: 647.1,
    Pc: 220.6,
    omega: 0.344,
    antoine: { A: 8.07131, B: 1730.63, C: 233.426 },
  },
  ETHANOL: {
    name: "Ethanol",
    formula: "C2H6O",
    Tc: 514.0,
    Pc: 61.4,
    omega: 0.644,
    antoine: { A: 8.20417, B: 1642.89, C: 230.3 },
  },
  BENZENE: {
    name: "Benzene",
    formula: "C6H6",
    Tc: 562.2,
    Pc: 48.9,
    omega: 0.211,
    antoine: { A: 6.90565, B: 1211.033, C: 220.79 },
  },
  TOLUENE: {
    name: "Toluene",
    formula: "C7H8",
    Tc: 591.8,
    Pc: 41.0,
    omega: 0.264,
    antoine: { A: 6.95464, B: 1344.8, C: 219.48 },
  },
  ACETONE: {
    name: "Acetone",
    formula: "C3H6O",
    Tc: 508.2,
    Pc: 47.0,
    omega: 0.307,
    antoine: { A: 7.02447, B: 1161.0, C: 224.0 },
  },
  METHANE: {
    name: "Methane",
    formula: "CH4",
    Tc: 190.6,
    Pc: 46.0,
    omega: 0.012,
    antoine: { A: 6.69561, B: 405.42, C: 267.78 },
  },
  ETHANE: {
    name: "Ethane",
    formula: "C2H6",
    Tc: 305.3,
    Pc: 48.7,
    omega: 0.099,
    antoine: { A: 6.82973, B: 663.72, C: 256.68 },
  },
  PROPANE: {
    name: "Propane",
    formula: "C3H8",
    Tc: 369.8,
    Pc: 42.5,
    omega: 0.152,
    antoine: { A: 6.82973, B: 813.2, C: 248.0 },
  },
  BUTANE: {
    name: "n-Butane",
    formula: "C4H10",
    Tc: 425.1,
    Pc: 37.8,
    omega: 0.2,
    antoine: { A: 6.83029, B: 945.9, C: 240.0 },
  },
  "N-BUTANE": {
    name: "n-Butane",
    formula: "C4H10",
    Tc: 425.1,
    Pc: 37.8,
    omega: 0.2,
    antoine: { A: 6.83029, B: 945.9, C: 240.0 },
  },
  ISOBUTANE: {
    name: "Isobutane",
    formula: "C4H10",
    Tc: 407.8,
    Pc: 36.4,
    omega: 0.181,
    antoine: { A: 6.78879, B: 899.6, C: 242.0 },
  },
  PENTANE: {
    name: "n-Pentane",
    formula: "C5H12",
    Tc: 469.7,
    Pc: 33.7,
    omega: 0.252,
    antoine: { A: 6.85221, B: 1064.63, C: 233.0 },
  },
  "N-PENTANE": {
    name: "n-Pentane",
    formula: "C5H12",
    Tc: 469.7,
    Pc: 33.7,
    omega: 0.252,
    antoine: { A: 6.85221, B: 1064.63, C: 233.0 },
  },
  HEXANE: {
    name: "n-Hexane",
    formula: "C6H14",
    Tc: 507.6,
    Pc: 30.2,
    omega: 0.301,
    antoine: { A: 6.87776, B: 1171.53, C: 224.37 },
  },
  "N-HEXANE": {
    name: "n-Hexane",
    formula: "C6H14",
    Tc: 507.6,
    Pc: 30.2,
    omega: 0.301,
    antoine: { A: 6.87776, B: 1171.53, C: 224.37 },
  },
  NITROGEN: {
    name: "Nitrogen",
    formula: "N2",
    Tc: 126.2,
    Pc: 33.9,
    omega: 0.037,
  },
  OXYGEN: {
    name: "Oxygen",
    formula: "O2",
    Tc: 154.6,
    Pc: 50.4,
    omega: 0.022,
  },
  CO2: {
    name: "Carbon Dioxide",
    formula: "CO2",
    Tc: 304.1,
    Pc: 73.8,
    omega: 0.224,
  },
  AMMONIA: {
    name: "Ammonia",
    formula: "NH3",
    Tc: 405.4,
    Pc: 113.5,
    omega: 0.256,
    antoine: { A: 7.55466, B: 1002.711, C: 247.885 },
  },
  HYDROGEN: {
    name: "Hydrogen",
    formula: "H2",
    Tc: 33.2,
    Pc: 13.0,
    omega: -0.216,
  },
  ARGON: {
    name: "Argon",
    formula: "Ar",
    Tc: 150.8,
    Pc: 48.7,
    omega: -0.004,
  },
  ETHYLENE: {
    name: "Ethylene",
    formula: "C2H4",
    Tc: 282.4,
    Pc: 50.4,
    omega: 0.085,
  },
  PROPYLENE: {
    name: "Propylene",
    formula: "C3H6",
    Tc: 364.9,
    Pc: 46.0,
    omega: 0.142,
  },
  CYCLOHEXANE: {
    name: "Cyclohexane",
    formula: "C6H12",
    Tc: 553.5,
    Pc: 40.7,
    omega: 0.21,
  },
};

export interface NrtlBinaryPair {
  aij?: number | undefined;
  aji?: number | undefined;
  bij?: number | undefined; // K
  bji?: number | undefined; // K
  alpha?: number | undefined;
}

export const KNOWN_NRTL_PAIRS: Record<string, NrtlBinaryPair> = {
  "METHANOL:WATER": { aij: -0.693, aji: 0.845, bij: 172.99, bji: 83.29, alpha: 0.3 },
  "ETHANOL:WATER": { aij: -0.8009, aji: 3.4578, bij: 246.18, bji: -586.08, alpha: 0.3 },
  "ACETONE:WATER": { aij: 0.6504, aji: 2.7322, bij: 335.8, bji: -214.9, alpha: 0.3 },
  "ACETONE:METHANOL": { aij: 0.0, aji: 0.0, bij: 101.88, bji: 114.13, alpha: 0.3 },
  "BENZENE:TOLUENE": { aij: 0.0, aji: 0.0, bij: -2.88, bji: 4.35, alpha: 0.3 },
};

/**
 * Computes liquid-phase activity coefficients gamma_i using the Non-Random Two-Liquid (NRTL) model:
 *   tau_ij = a_ij + b_ij / T,  G_ij = exp(-alpha_ij * tau_ij)
 *   ln(gamma_i) = (sum_j x_j tau_ji G_ji) / (sum_k x_k G_ki)
 *               + sum_j [ (x_j G_ij / sum_k x_k G_kj) * (tau_ij - (sum_m x_m tau_mj G_mj) / (sum_k x_k G_kj)) ]
 */
export function computeNrtlActivityCoefficients(
  components: string[],
  x: number[],
  temperatureK: number,
  customPairs?: Record<string, NrtlBinaryPair>,
): number[] {
  const n = components.length;
  if (n <= 1) return x.map(() => 1.0);

  const T = Math.max(temperatureK, 100.0);
  const tau: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0.0));
  const G: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(1.0));

  for (let i = 0; i < n; i++) {
    const ci = components[i]!.toUpperCase();
    for (let j = 0; j < n; j++) {
      if (i === j) {
        tau[i]![j] = 0.0;
        G[i]![j] = 1.0;
        continue;
      }
      const cj = components[j]!.toUpperCase();
      const keyFwd = `${ci}:${cj}`;
      const keyRev = `${cj}:${ci}`;
      const pairFwd = customPairs?.[keyFwd] ?? KNOWN_NRTL_PAIRS[keyFwd];
      const pairRev = customPairs?.[keyRev] ?? KNOWN_NRTL_PAIRS[keyRev];

      let aij = 0.0;
      let bij = 0.0;
      let alpha = 0.3;

      if (pairFwd) {
        aij = pairFwd.aij ?? 0.0;
        bij = pairFwd.bij ?? 0.0;
        alpha = pairFwd.alpha ?? 0.3;
      } else if (pairRev) {
        aij = pairRev.aji ?? 0.0;
        bij = pairRev.bji ?? 0.0;
        alpha = pairRev.alpha ?? 0.3;
      }

      const tVal = aij + bij / T;
      tau[i]![j] = tVal;
      G[i]![j] = Math.exp(-alpha * tVal);
    }
  }

  const gamma: number[] = [];
  for (let i = 0; i < n; i++) {
    let num1 = 0.0;
    let den1 = 0.0;
    for (let j = 0; j < n; j++) {
      const xj = Math.max(0.0, x[j] ?? 0.0);
      num1 += xj * tau[j]![i]! * G[j]![i]!;
      den1 += xj * G[j]![i]!;
    }
    const term1 = den1 > 1e-12 ? num1 / den1 : 0.0;

    let term2 = 0.0;
    for (let j = 0; j < n; j++) {
      const xj = Math.max(0.0, x[j] ?? 0.0);
      let denJ = 0.0;
      let numJ = 0.0;
      for (let k = 0; k < n; k++) {
        const xk = Math.max(0.0, x[k] ?? 0.0);
        denJ += xk * G[k]![j]!;
        numJ += xk * tau[k]![j]! * G[k]![j]!;
      }
      if (denJ > 1e-12) {
        term2 += ((xj * G[i]![j]!) / denJ) * (tau[i]![j]! - numJ / denJ);
      }
    }

    const lnGamma = term1 + term2;
    gamma.push(Math.exp(Math.max(-10.0, Math.min(10.0, lnGamma))));
  }

  return gamma;
}

export interface FlashCalculationInput {
  temperature: number; // Celsius
  pressure: number; // bar
  components: string[];
  moleFractions: number[]; // z_i
  totalFlow?: number | undefined; // kmol/hr
  propertyMethod?: string | undefined; // e.g., 'IDEAL', 'NRTL', 'PENG-ROB'
  nrtlParams?: Record<string, NrtlBinaryPair> | undefined;
  customProperties?: Record<string, Partial<ComponentPhysicalConstants>> | undefined;
}

export interface FlashCalculationResult {
  vaporFraction: number; // psi in [0, 1]
  state: "SUBCOOLED_LIQUID" | "TWO_PHASE" | "SUPERHEATED_VAPOR";
  liquidFractions: number[]; // x_i
  vaporFractions: number[]; // y_i
  liquidFlow: number; // kmol/hr
  vaporFlow: number; // kmol/hr
  kValues: number[]; // K_i
  activityCoefficients: number[]; // gamma_i
  iterations: number;
}

/**
 * Computes vapor-liquid equilibrium (VLE) flash for a multicomponent mixture.
 */
export function solveFlashRachfordRice(input: FlashCalculationInput): FlashCalculationResult {
  const { temperature, pressure, components, moleFractions, customProperties, propertyMethod, nrtlParams } = input;
  const F = input.totalFlow ?? 100.0;
  const n = components.length;

  // 1. Calculate ideal K-values (Raoult / Wilson)
  const baseKValues: number[] = [];
  const tKelvin = temperature + 273.15;
  const safeP = Math.max(pressure, 0.01);

  for (let i = 0; i < n; i++) {
    const compName = components[i]!.toUpperCase();
    const custom = customProperties?.[compName] ?? customProperties?.[components[i]!];
    const base = KNOWN_COMPONENTS[compName];
    const props = custom ? { ...base, ...custom } : base;

    let Ki = 1.0;
    if (props?.antoine) {
      // Saturation pressure in mmHg -> bar (1 bar = 750.062 mmHg)
      const log10Psat = props.antoine.A - props.antoine.B / (temperature + props.antoine.C);
      const Psat_bar = Math.pow(10, log10Psat) / 750.062;
      Ki = Psat_bar / safeP;
    } else if (props?.Tc && props?.Pc) {
      // Wilson correlation: Ki = (Pc/P) * exp(5.373 * (1 + omega) * (1 - Tc/T))
      const omega = props.omega ?? 0.2;
      Ki = (props.Pc / safeP) * Math.exp(5.373 * (1 + omega) * (1 - props.Tc / tKelvin));
    } else {
      // Generalized Lee-Kesler / Edmister estimation for unknown components
      const estTc = 450.0;
      const estPc = 40.0;
      const estOmega = 0.25;
      Ki = (estPc / safeP) * Math.exp(5.373 * (1 + estOmega) * (1 - estTc / tKelvin));
    }
    baseKValues.push(Math.max(1e-6, Ki));
  }

  const useNrtl = propertyMethod?.toUpperCase() === "NRTL" || nrtlParams !== undefined;
  let activityCoefficients = useNrtl
    ? computeNrtlActivityCoefficients(components, moleFractions, tKelvin, nrtlParams)
    : moleFractions.map(() => 1.0);
  let kValues = baseKValues.map((k, i) => k * activityCoefficients[i]!);

  // 2. Evaluate boundaries at psi = 0 and psi = 1
  let f0 = 0.0;
  let f1 = 0.0;
  for (let i = 0; i < n; i++) {
    const z = moleFractions[i]!;
    const K = kValues[i]!;
    f0 += z * (K - 1.0);
    f1 += (z * (K - 1.0)) / K;
  }

  // Pure liquid check
  if (f0 <= 0.0) {
    return {
      vaporFraction: 0.0,
      state: "SUBCOOLED_LIQUID",
      liquidFractions: [...moleFractions],
      vaporFractions: moleFractions.map((z, i) => z * kValues[i]!),
      liquidFlow: F,
      vaporFlow: 0.0,
      kValues,
      activityCoefficients,
      iterations: 0,
    };
  }

  // Pure vapor check
  if (f1 >= 0.0) {
    const xDew = moleFractions.map((z, i) => z / Math.max(kValues[i]!, 1e-6));
    if (useNrtl) {
      const sumXDew = xDew.reduce((a, b) => a + b, 0) || 1.0;
      const xDewNorm = xDew.map((v) => v / sumXDew);
      activityCoefficients = computeNrtlActivityCoefficients(components, xDewNorm, tKelvin, nrtlParams);
      kValues = baseKValues.map((k, i) => k * activityCoefficients[i]!);
    }
    return {
      vaporFraction: 1.0,
      state: "SUPERHEATED_VAPOR",
      liquidFractions: moleFractions.map((z, i) => z / Math.max(kValues[i]!, 1e-6)),
      vaporFractions: [...moleFractions],
      liquidFlow: 0.0,
      vaporFlow: F,
      kValues,
      activityCoefficients,
      iterations: 0,
    };
  }

  // 3. Two-phase: Solve Rachford-Rice via Newton-Raphson (with outer activity coefficient loop when NRTL enabled)
  let psi = 0.5;
  const maxOuterIter = useNrtl ? 20 : 1;
  const maxInnerIter = 50;
  const tol = 1e-7;
  let totalIter = 0;
  let liquidFractions = [...moleFractions];

  for (let outer = 0; outer < maxOuterIter; outer++) {
    let inner = 0;
    for (inner = 0; inner < maxInnerIter; inner++) {
      let fVal = 0.0;
      let fPrime = 0.0;

      for (let i = 0; i < n; i++) {
        const z = moleFractions[i]!;
        const K = kValues[i]!;
        const denom = 1.0 + psi * (K - 1.0);
        fVal += (z * (K - 1.0)) / denom;
        fPrime -= (z * Math.pow(K - 1.0, 2)) / (denom * denom);
      }

      if (Math.abs(fVal) < tol) break;

      const delta = fVal / fPrime;
      psi -= delta;

      // Dampen and keep in bounds [0, 1]
      if (psi <= 0.0) psi = 1e-4;
      if (psi >= 1.0) psi = 1.0 - 1e-4;

      if (Math.abs(delta) < tol) break;
    }
    totalIter += inner + 1;

    // Update liquid mole fractions
    const newX: number[] = [];
    let sumX = 0.0;
    for (let i = 0; i < n; i++) {
      const z = moleFractions[i]!;
      const K = kValues[i]!;
      const xi = z / (1.0 + psi * (K - 1.0));
      newX.push(xi);
      sumX += xi;
    }
    const normX = sumX > 0 ? newX.map((v) => v / sumX) : newX;

    if (!useNrtl) {
      liquidFractions = newX;
      break;
    }

    const newGamma = computeNrtlActivityCoefficients(components, normX, tKelvin, nrtlParams);
    let maxGammaDiff = 0.0;
    for (let i = 0; i < n; i++) {
      maxGammaDiff = Math.max(maxGammaDiff, Math.abs(newGamma[i]! - activityCoefficients[i]!));
    }
    activityCoefficients = newGamma;
    kValues = baseKValues.map((k, i) => k * activityCoefficients[i]!);
    liquidFractions = normX;

    if (maxGammaDiff < 1e-6) break;
  }

  // 4. Compute final phase compositions
  const finalLiquid: number[] = [];
  const finalVapor: number[] = [];
  let sumL = 0.0;
  let sumV = 0.0;

  for (let i = 0; i < n; i++) {
    const z = moleFractions[i]!;
    const K = kValues[i]!;
    const xi = z / (1.0 + psi * (K - 1.0));
    const yi = K * xi;
    finalLiquid.push(xi);
    finalVapor.push(yi);
    sumL += xi;
    sumV += yi;
  }

  if (useNrtl && sumL > 0 && sumV > 0) {
    for (let i = 0; i < n; i++) {
      finalLiquid[i] = finalLiquid[i]! / sumL;
      finalVapor[i] = finalVapor[i]! / sumV;
    }
  } else {
    void liquidFractions;
  }

  return {
    vaporFraction: psi,
    state: "TWO_PHASE",
    liquidFractions: finalLiquid,
    vaporFractions: finalVapor,
    liquidFlow: F * (1.0 - psi),
    vaporFlow: F * psi,
    kValues,
    activityCoefficients,
    iterations: totalIter,
  };
}
