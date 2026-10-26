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
};

export interface FlashCalculationInput {
  temperature: number; // Celsius
  pressure: number; // bar
  components: string[];
  moleFractions: number[]; // z_i
  totalFlow?: number | undefined; // kmol/hr
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
  iterations: number;
}

/**
 * Computes vapor-liquid equilibrium (VLE) flash for a multicomponent mixture.
 */
export function solveFlashRachfordRice(input: FlashCalculationInput): FlashCalculationResult {
  const { temperature, pressure, components, moleFractions, customProperties } = input;
  const F = input.totalFlow ?? 100.0;
  const n = components.length;

  // 1. Calculate K-values
  const kValues: number[] = [];
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
      // Assume typical organic volatile with estimated Tc = 450K, Pc = 40 bar, omega = 0.25
      const estTc = 450.0;
      const estPc = 40.0;
      const estOmega = 0.25;
      Ki = (estPc / safeP) * Math.exp(5.373 * (1 + estOmega) * (1 - estTc / tKelvin));
    }
    kValues.push(Math.max(1e-6, Ki));
  }

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
      iterations: 0,
    };
  }

  // Pure vapor check
  if (f1 >= 0.0) {
    return {
      vaporFraction: 1.0,
      state: "SUPERHEATED_VAPOR",
      liquidFractions: moleFractions.map((z, i) => z / Math.max(kValues[i]!, 1e-6)),
      vaporFractions: [...moleFractions],
      liquidFlow: 0.0,
      vaporFlow: F,
      kValues,
      iterations: 0,
    };
  }

  // 3. Two-phase: Solve Rachford-Rice via Newton-Raphson
  let psi = 0.5;
  const maxIter = 50;
  const tol = 1e-7;
  let iter = 0;

  for (iter = 0; iter < maxIter; iter++) {
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

  // 4. Compute phase compositions
  const liquidFractions: number[] = [];
  const vaporFractions: number[] = [];

  for (let i = 0; i < n; i++) {
    const z = moleFractions[i]!;
    const K = kValues[i]!;
    const xi = z / (1.0 + psi * (K - 1.0));
    const yi = K * xi;
    liquidFractions.push(xi);
    vaporFractions.push(yi);
  }

  return {
    vaporFraction: psi,
    state: "TWO_PHASE",
    liquidFractions,
    vaporFractions,
    liquidFlow: F * (1.0 - psi),
    vaporFlow: F * psi,
    kValues,
    iterations: iter + 1,
  };
}
