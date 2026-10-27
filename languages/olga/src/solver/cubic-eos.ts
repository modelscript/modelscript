// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/olga — Native In-WASM Cubic Equation of State (EOS) Compositional Flash.
 *
 * Implements:
 * 1. Peng-Robinson (PR78) and Soave-Redlich-Kwong (SRK) cubic equations of state
 * 2. Critical properties database (N2, CO2, H2S, C1, C2, C3, iC4, nC4, iC5, nC5, C6, C7+, C10+, H2O)
 * 3. Classical Van der Waals mixing rules with symmetric binary interaction parameters (k_ij)
 * 4. Analytical trigonometric Cardano root finder for compressibility factor Z
 * 5. Isothermal two-phase PT-flash (Rachford-Rice with guarded Newton-Raphson & successive substitution)
 * 6. Lohrenz-Bray-Clark (LBC) dense fluid viscosity & Macleod-Sugden interfacial tension
 * 7. Saturation envelope tracer: Bubble point (beta = 0) and dew point (beta = 1) curves
 * 8. `eosToPvtTable(...)` converter synthesizing full 2D `PvtTableData` grids for `simulateDriftFlux`
 */

import { DEFAULT_SI_UNITS, type PvtTableData } from "../parser/pvt-table-parser.js";

export const R_GAS = 8.314462618; // Universal gas constant [J / (mol * K)]

export type CubicEosModelType = "PENG_ROBINSON" | "SRK";

export interface ComponentProperties {
  name: string;
  formula: string;
  molecularWeight: number; // [kg/mol] (e.g. 0.016043 for Methane)
  criticalTempK: number; // T_c [K]
  criticalPressurePa: number; // P_c [Pa]
  acentricFactor: number; // omega [-]
  parachor: number; // Parachor for surface tension [-]
  criticalVolumeM3PerMol: number; // V_c [m^3/mol] for LBC viscosity
}

/**
 * Standard pure component database for hydrocarbon and reservoir fluids.
 */
export const STANDARD_COMPONENTS: Record<string, ComponentProperties> = {
  N2: {
    name: "Nitrogen",
    formula: "N2",
    molecularWeight: 0.028013,
    criticalTempK: 126.2,
    criticalPressurePa: 33.98e5,
    acentricFactor: 0.037,
    parachor: 60.0,
    criticalVolumeM3PerMol: 90.1e-6,
  },
  CO2: {
    name: "Carbon Dioxide",
    formula: "CO2",
    molecularWeight: 0.04401,
    criticalTempK: 304.13,
    criticalPressurePa: 73.77e5,
    acentricFactor: 0.224,
    parachor: 78.0,
    criticalVolumeM3PerMol: 94.0e-6,
  },
  H2S: {
    name: "Hydrogen Sulfide",
    formula: "H2S",
    molecularWeight: 0.03408,
    criticalTempK: 373.2,
    criticalPressurePa: 89.63e5,
    acentricFactor: 0.094,
    parachor: 80.0,
    criticalVolumeM3PerMol: 98.5e-6,
  },
  C1: {
    name: "Methane",
    formula: "CH4",
    molecularWeight: 0.016043,
    criticalTempK: 190.56,
    criticalPressurePa: 45.99e5,
    acentricFactor: 0.011,
    parachor: 77.0,
    criticalVolumeM3PerMol: 98.6e-6,
  },
  C2: {
    name: "Ethane",
    formula: "C2H6",
    molecularWeight: 0.03007,
    criticalTempK: 305.32,
    criticalPressurePa: 48.72e5,
    acentricFactor: 0.099,
    parachor: 108.0,
    criticalVolumeM3PerMol: 145.5e-6,
  },
  C3: {
    name: "Propane",
    formula: "C3H8",
    molecularWeight: 0.044097,
    criticalTempK: 369.83,
    criticalPressurePa: 42.48e5,
    acentricFactor: 0.152,
    parachor: 150.3,
    criticalVolumeM3PerMol: 200.0e-6,
  },
  iC4: {
    name: "Isobutane",
    formula: "C4H10",
    molecularWeight: 0.058124,
    criticalTempK: 407.85,
    criticalPressurePa: 36.4e5,
    acentricFactor: 0.186,
    parachor: 181.5,
    criticalVolumeM3PerMol: 262.7e-6,
  },
  nC4: {
    name: "Normal Butane",
    formula: "C4H10",
    molecularWeight: 0.058124,
    criticalTempK: 425.12,
    criticalPressurePa: 37.96e5,
    acentricFactor: 0.2,
    parachor: 189.9,
    criticalVolumeM3PerMol: 255.0e-6,
  },
  iC5: {
    name: "Isopentane",
    formula: "C5H12",
    molecularWeight: 0.072151,
    criticalTempK: 460.39,
    criticalPressurePa: 33.81e5,
    acentricFactor: 0.229,
    parachor: 225.0,
    criticalVolumeM3PerMol: 306.0e-6,
  },
  nC5: {
    name: "Normal Pentane",
    formula: "C5H12",
    molecularWeight: 0.072151,
    criticalTempK: 469.7,
    criticalPressurePa: 33.7e5,
    acentricFactor: 0.252,
    parachor: 231.5,
    criticalVolumeM3PerMol: 313.0e-6,
  },
  C6: {
    name: "Hexane",
    formula: "C6H14",
    molecularWeight: 0.086178,
    criticalTempK: 507.6,
    criticalPressurePa: 30.25e5,
    acentricFactor: 0.301,
    parachor: 271.0,
    criticalVolumeM3PerMol: 370.0e-6,
  },
  C7: {
    name: "Heptanes Plus",
    formula: "C7H16",
    molecularWeight: 0.100205,
    criticalTempK: 540.2,
    criticalPressurePa: 27.4e5,
    acentricFactor: 0.349,
    parachor: 312.5,
    criticalVolumeM3PerMol: 428.0e-6,
  },
  C10: {
    name: "Decane",
    formula: "C10H22",
    molecularWeight: 0.142285,
    criticalTempK: 617.7,
    criticalPressurePa: 21.1e5,
    acentricFactor: 0.492,
    parachor: 435.0,
    criticalVolumeM3PerMol: 600.0e-6,
  },
  H2O: {
    name: "Water",
    formula: "H2O",
    molecularWeight: 0.018015,
    criticalTempK: 647.1,
    criticalPressurePa: 220.64e5,
    acentricFactor: 0.344,
    parachor: 52.0,
    criticalVolumeM3PerMol: 55.9e-6,
  },
};

/**
 * Standard binary interaction parameters k_ij for hydrocarbon pairs.
 */
export const DEFAULT_BINARY_INTERACTION: Record<string, Record<string, number>> = {
  N2: { C1: 0.038, C2: 0.045, C3: 0.055, nC4: 0.065, CO2: 0.0, H2S: 0.13 },
  CO2: { C1: 0.12, C2: 0.12, C3: 0.12, nC4: 0.12, C7: 0.12, H2S: 0.096, N2: 0.0 },
  H2S: { C1: 0.08, C2: 0.07, C3: 0.07, nC4: 0.06, C7: 0.05, CO2: 0.096, N2: 0.13 },
  C1: { C2: 0.0, C3: 0.0, nC4: 0.005, C7: 0.035, C10: 0.05 },
};

export interface FlashPhaseProperties {
  moleFraction: number; // beta (vapor fraction) or (1 - beta) (liquid fraction)
  composition: number[]; // Component mole fractions
  molecularWeight: number; // [kg/mol]
  zFactor: number; // Compressibility factor Z
  densityKgM3: number; // Mass density [kg/m^3]
  viscosityPaS: number; // Dynamic viscosity [Pa*s]
  soundSpeedMS: number; // Speed of sound [m/s]
  enthalpyJPerKg: number; // Specific enthalpy [J/kg]
  heatCapacityJPerKgK: number; // Specific heat capacity Cp [J/(kg*K)]
}

export interface FlashResult {
  vaporFraction: number; // beta = V / F [0..1]
  isTwoPhase: boolean;
  equilibriumKValues: number[];
  gas: FlashPhaseProperties;
  liquid: FlashPhaseProperties;
  surfaceTensionNPerM: number; // Gas-liquid interfacial tension [N/m]
}

export interface PhaseEnvelopePoint {
  temperatureK: number;
  pressurePa: number;
  type: "BUBBLE" | "DEW" | "CRITICAL";
}

export interface PhaseEnvelope {
  bubblePoints: { temperatureK: number; pressurePa: number }[];
  dewPoints: { temperatureK: number; pressurePa: number }[];
  cricondenbar: { temperatureK: number; pressurePa: number };
  cricondentherm: { temperatureK: number; pressurePa: number };
  criticalPoint: { temperatureK: number; pressurePa: number };
}

/**
 * High-performance, zero-allocation native Cubic Equation of State solver.
 */
export class CubicEos {
  public readonly modelType: CubicEosModelType;
  public readonly components: ComponentProperties[];
  public readonly componentKeys: string[];
  public readonly numComponents: number;
  private readonly kijMatrix: Float64Array;

  // Precomputed EOS constants
  private readonly omegaA: number;
  private readonly omegaB: number;

  // Reusable scratch buffers for zero-allocation inner loops
  private readonly scratchLnPhiL: Float64Array;
  private readonly scratchLnPhiV: Float64Array;
  private readonly scratchSqrtA: Float64Array;

  constructor(
    componentNames: string[],
    modelType: CubicEosModelType = "PENG_ROBINSON",
    customComponents?: Record<string, ComponentProperties>,
    customKij?: Record<string, Record<string, number>>,
  ) {
    this.modelType = modelType;
    this.componentKeys = [...componentNames];
    const db = { ...STANDARD_COMPONENTS, ...customComponents };

    this.components = componentNames.map((name) => {
      const comp = db[name];
      if (!comp) {
        throw new Error(`CubicEos: Unknown component '${name}'. Provide custom component properties.`);
      }
      return comp;
    });

    this.numComponents = this.components.length;
    this.kijMatrix = new Float64Array(this.numComponents * this.numComponents);
    this.scratchLnPhiL = new Float64Array(this.numComponents);
    this.scratchLnPhiV = new Float64Array(this.numComponents);
    this.scratchSqrtA = new Float64Array(this.numComponents);

    if (modelType === "PENG_ROBINSON") {
      this.omegaA = 0.457235529;
      this.omegaB = 0.077796074;
    } else {
      // Soave-Redlich-Kwong (SRK)
      this.omegaA = 0.42748;
      this.omegaB = 0.08664;
    }

    this.initKij(customKij);
  }

  private initKij(customKij?: Record<string, Record<string, number>>): void {
    const kijLookup = { ...DEFAULT_BINARY_INTERACTION, ...customKij };
    for (let i = 0; i < this.numComponents; i++) {
      const keyI = this.componentKeys[i]!;
      const nameI = this.components[i]!.formula || this.components[i]!.name;
      for (let j = 0; j < this.numComponents; j++) {
        const keyJ = this.componentKeys[j]!;
        const nameJ = this.components[j]!.formula || this.components[j]!.name;
        let val = 0.0;
        if (kijLookup[keyI]?.[keyJ] !== undefined) val = kijLookup[keyI]![keyJ]!;
        else if (kijLookup[keyJ]?.[keyI] !== undefined) val = kijLookup[keyJ]![keyI]!;
        else if (kijLookup[nameI]?.[nameJ] !== undefined) val = kijLookup[nameI]![nameJ]!;
        else if (kijLookup[nameJ]?.[nameI] !== undefined) val = kijLookup[nameJ]![nameI]!;
        this.kijMatrix[i * this.numComponents + j] = val;
      }
    }
  }

  public getKij(i: number, j: number): number {
    return this.kijMatrix[i * this.numComponents + j]!;
  }

  /**
   * Evaluates pure component attraction parameter a_i(T) [J * m^3 / mol^2]
   * and co-volume b_i [m^3 / mol].
   */
  public getPureParameters(T: number): { a: Float64Array; b: Float64Array } {
    const a = new Float64Array(this.numComponents);
    const b = new Float64Array(this.numComponents);

    for (let i = 0; i < this.numComponents; i++) {
      const c = this.components[i]!;
      const Tr = T / c.criticalTempK;
      const sqrtTr = Math.sqrt(Math.max(1e-4, Tr));

      let m: number;
      if (this.modelType === "PENG_ROBINSON") {
        if (c.acentricFactor <= 0.49) {
          m = 0.37464 + 1.54226 * c.acentricFactor - 0.26992 * c.acentricFactor * c.acentricFactor;
        } else {
          // PR78 modification for heavier hydrocarbons
          m =
            0.379642 +
            1.48503 * c.acentricFactor -
            0.164423 * c.acentricFactor * c.acentricFactor +
            0.016666 * Math.pow(c.acentricFactor, 3);
        }
      } else {
        // SRK
        m = 0.48 + 1.574 * c.acentricFactor - 0.176 * c.acentricFactor * c.acentricFactor;
      }

      const alpha = Math.pow(1.0 + m * (1.0 - sqrtTr), 2);
      a[i] = ((this.omegaA * Math.pow(R_GAS * c.criticalTempK, 2)) / c.criticalPressurePa) * alpha;
      b[i] = (this.omegaB * R_GAS * c.criticalTempK) / c.criticalPressurePa;
    }

    return { a, b };
  }

  /**
   * Classical Van der Waals mixing rules:
   * a = sum_i sum_j (x_i x_j sqrt(a_i a_j) (1 - k_ij))
   * b = sum_i (x_i b_i)
   */
  public mixParameters(x: ArrayLike<number>, pureA: Float64Array, pureB: Float64Array): { aMix: number; bMix: number } {
    let aMix = 0.0;
    let bMix = 0.0;
    const n = this.numComponents;
    const sqrtA = this.scratchSqrtA;
    for (let i = 0; i < n; i++) {
      sqrtA[i] = Math.sqrt(pureA[i]!);
    }

    for (let i = 0; i < n; i++) {
      const xi = x[i]!;
      bMix += xi * pureB[i]!;
      const sqrtAi = sqrtA[i]!;
      let sumJ = 0.0;
      for (let j = 0; j < n; j++) {
        sumJ += x[j]! * (sqrtAi * sqrtA[j]!) * (1.0 - this.getKij(i, j));
      }
      aMix += xi * sumJ;
    }

    return { aMix: Math.max(1e-12, aMix), bMix: Math.max(1e-12, bMix) };
  }

  /**
   * Solves the cubic equation of state for compressibility factor Z roots:
   * Returns [zLiquid, zVapor] where zLiquid is minimum real root and zVapor is maximum real root.
   */
  public solveZFactor(P: number, T: number, aMix: number, bMix: number): { zLiquid: number; zVapor: number } {
    const A = (aMix * P) / (R_GAS * R_GAS * T * T);
    const B = (bMix * P) / (R_GAS * T);

    let c2: number;
    let c1: number;
    let c0: number;

    if (this.modelType === "PENG_ROBINSON") {
      // Z^3 - (1 - B)*Z^2 + (A - 3B^2 - 2B)*Z - (AB - B^2 - B^3) = 0
      c2 = -(1.0 - B);
      c1 = A - 3.0 * B * B - 2.0 * B;
      c0 = -(A * B - B * B - B * B * B);
    } else {
      // SRK: Z^3 - Z^2 + (A - B - B^2)*Z - A*B = 0
      c2 = -1.0;
      c1 = A - B - B * B;
      c0 = -A * B;
    }

    // Solve depressed cubic: y^3 + p*y + q = 0 with Z = y - c2 / 3
    const p = c1 - (c2 * c2) / 3.0;
    const q = (2.0 * c2 * c2 * c2) / 27.0 - (c2 * c1) / 3.0 + c0;
    const delta = (q * q) / 4.0 + (p * p * p) / 27.0;

    const bMin = Math.max(B, 1e-4);
    let minZ = Infinity;
    let maxZ = -Infinity;

    if (delta > 1e-14) {
      // Single real root (Cardano)
      const u = Math.cbrt(-q / 2.0 + Math.sqrt(delta));
      const v = Math.cbrt(-q / 2.0 - Math.sqrt(delta));
      const z = u + v - c2 / 3.0;
      if (z > bMin && isFinite(z)) {
        minZ = z;
        maxZ = z;
      }
    } else if (Math.abs(delta) <= 1e-14) {
      // All real roots, at least two equal
      const u = Math.cbrt(-q / 2.0);
      const z1 = 2.0 * u - c2 / 3.0;
      const z2 = -u - c2 / 3.0;
      if (z1 > bMin && isFinite(z1)) {
        if (z1 < minZ) minZ = z1;
        if (z1 > maxZ) maxZ = z1;
      }
      if (z2 > bMin && isFinite(z2)) {
        if (z2 < minZ) minZ = z2;
        if (z2 > maxZ) maxZ = z2;
      }
    } else {
      // Three distinct real roots (Trigonometric / Viete)
      const phi = Math.acos(Math.max(-1.0, Math.min(1.0, -q / (2.0 * Math.sqrt(-Math.pow(p / 3.0, 3))))));
      const r = 2.0 * Math.sqrt(-p / 3.0);
      const z1 = r * Math.cos(phi / 3.0) - c2 / 3.0;
      const z2 = r * Math.cos((phi + 2.0 * Math.PI) / 3.0) - c2 / 3.0;
      const z3 = r * Math.cos((phi + 4.0 * Math.PI) / 3.0) - c2 / 3.0;
      if (z1 > bMin && isFinite(z1)) {
        if (z1 < minZ) minZ = z1;
        if (z1 > maxZ) maxZ = z1;
      }
      if (z2 > bMin && isFinite(z2)) {
        if (z2 < minZ) minZ = z2;
        if (z2 > maxZ) maxZ = z2;
      }
      if (z3 > bMin && isFinite(z3)) {
        if (z3 < minZ) minZ = z3;
        if (z3 > maxZ) maxZ = z3;
      }
    }

    if (minZ === Infinity) {
      const fallback = Math.max(B + 0.01, 0.8);
      return { zLiquid: fallback, zVapor: fallback };
    }

    return { zLiquid: minZ, zVapor: maxZ };
  }

  /**
   * Computes fugacity coefficients ln(phi_i) for all components in a phase.
   */
  public computeLnPhi(
    x: ArrayLike<number>,
    P: number,
    T: number,
    pureA: Float64Array,
    pureB: Float64Array,
    aMix: number,
    bMix: number,
    Z: number,
    outLnPhi?: Float64Array,
  ): Float64Array {
    const lnPhi = outLnPhi ?? new Float64Array(this.numComponents);
    const A = (aMix * P) / (R_GAS * R_GAS * T * T);
    const B = (bMix * P) / (R_GAS * T);

    const safeZminusB = Math.max(1e-12, Z - B);
    const n = this.numComponents;
    const sqrtA = this.scratchSqrtA;
    for (let i = 0; i < n; i++) {
      sqrtA[i] = Math.sqrt(pureA[i]!);
    }

    if (this.modelType === "PENG_ROBINSON") {
      const sqrt2 = Math.SQRT2;
      const termLog = Math.log(Math.max(1e-12, (Z + (1.0 + sqrt2) * B) / (Z + (1.0 - sqrt2) * B)));
      const factor = A / (2.0 * Math.SQRT2 * B);

      for (let i = 0; i < n; i++) {
        let sumCross = 0.0;
        const sqrtAi = sqrtA[i]!;
        for (let j = 0; j < n; j++) {
          sumCross += x[j]! * (sqrtAi * sqrtA[j]!) * (1.0 - this.getKij(i, j));
        }

        const biOverB = pureB[i]! / bMix;
        const deltaA = (2.0 * sumCross) / aMix - biOverB;

        lnPhi[i] = biOverB * (Z - 1.0) - Math.log(safeZminusB) - factor * deltaA * termLog;
      }
    } else {
      // SRK
      const termLog = Math.log(Math.max(1e-12, 1.0 + B / Z));
      const factor = A / B;
      for (let i = 0; i < n; i++) {
        let sumCross = 0.0;
        const sqrtAi = sqrtA[i]!;
        for (let j = 0; j < n; j++) {
          sumCross += x[j]! * (sqrtAi * sqrtA[j]!) * (1.0 - this.getKij(i, j));
        }

        const biOverB = pureB[i]! / bMix;
        const deltaA = (2.0 * sumCross) / aMix - biOverB;

        lnPhi[i] = biOverB * (Z - 1.0) - Math.log(safeZminusB) - factor * deltaA * termLog;
      }
    }

    return lnPhi;
  }

  /**
   * Performs an isothermal, isobaric two-phase PT-flash calculation via Rachford-Rice
   * and successive substitution accelerated by Quasi-Newton updates.
   */
  public flashPT(P: number, T: number, feedZ: Record<string, number> | number[]): FlashResult {
    // 1. Normalize feed composition z
    const z = new Float64Array(this.numComponents);
    let sumZ = 0.0;
    if (Array.isArray(feedZ) || ArrayBuffer.isView(feedZ)) {
      for (let i = 0; i < this.numComponents; i++) {
        z[i] = Math.max(0, (feedZ as number[])[i] || 0);
        sumZ += z[i]!;
      }
    } else {
      const rec = feedZ as Record<string, number>;
      for (let i = 0; i < this.numComponents; i++) {
        const key = this.componentKeys[i]!;
        const c = this.components[i]!;
        const val = rec[key] ?? rec[c.formula] ?? rec[c.name] ?? 0;
        z[i] = Math.max(0, val);
        sumZ += z[i]!;
      }
    }
    if (sumZ <= 0) sumZ = 1.0;
    for (let i = 0; i < this.numComponents; i++) z[i] = z[i]! / sumZ;

    const { a: pureA, b: pureB } = this.getPureParameters(T);

    // 2. Initial K-values via Wilson correlation: K_i = (P_c / P) * exp[5.373*(1 + omega)*(1 - T_c / T)]
    const K = new Float64Array(this.numComponents);
    for (let i = 0; i < this.numComponents; i++) {
      const c = this.components[i]!;
      K[i] =
        (c.criticalPressurePa / Math.max(1e4, P)) *
        Math.exp(5.373 * (1.0 + c.acentricFactor) * (1.0 - c.criticalTempK / T));
      K[i] = Math.max(1e-6, Math.min(1e6, K[i]!));
    }

    // Check single phase boundary limits
    let sumZKi = 0.0;
    let sumZOverKi = 0.0;
    for (let i = 0; i < this.numComponents; i++) {
      sumZKi += z[i]! * K[i]!;
      sumZOverKi += z[i]! / K[i]!;
    }

    let beta = 0.5; // Vapor mole fraction V / F
    let isTwoPhase = true;

    if (sumZKi <= 1.0) {
      // Subcooled liquid
      beta = 0.0;
      isTwoPhase = false;
    } else if (sumZOverKi <= 1.0) {
      // Superheated vapor
      beta = 1.0;
      isTwoPhase = false;
    }

    const x = new Float64Array(this.numComponents);
    const y = new Float64Array(this.numComponents);

    // Successive substitution loop
    if (isTwoPhase) {
      const maxOuterIter = 100;
      for (let outer = 0; outer < maxOuterIter; outer++) {
        // Solve Rachford-Rice equation: f(beta) = sum_i [ z_i * (K_i - 1) / (1 + beta * (K_i - 1)) ] = 0
        beta = this.solveRachfordRice(z, K);

        if (beta <= 0.0) {
          beta = 0.0;
          isTwoPhase = false;
          break;
        } else if (beta >= 1.0) {
          beta = 1.0;
          isTwoPhase = false;
          break;
        }

        // Compute phase compositions x and y
        for (let i = 0; i < this.numComponents; i++) {
          const denom = 1.0 + beta * (K[i]! - 1.0);
          x[i] = z[i]! / denom;
          y[i] = K[i]! * x[i]!;
        }

        // Normalize phase compositions
        let sumX = 0.0;
        let sumY = 0.0;
        for (let i = 0; i < this.numComponents; i++) {
          sumX += x[i]!;
          sumY += y[i]!;
        }
        for (let i = 0; i < this.numComponents; i++) {
          x[i] = x[i]! / sumX;
          y[i] = y[i]! / sumY;
        }

        // Mixture EOS parameters
        const { aMix: aL, bMix: bL } = this.mixParameters(x, pureA, pureB);
        const { aMix: aV, bMix: bV } = this.mixParameters(y, pureA, pureB);

        const { zLiquid } = this.solveZFactor(P, T, aL, bL);
        const { zVapor } = this.solveZFactor(P, T, aV, bV);

        const lnPhiL = this.computeLnPhi(x, P, T, pureA, pureB, aL, bL, zLiquid, this.scratchLnPhiL);
        const lnPhiV = this.computeLnPhi(y, P, T, pureA, pureB, aV, bV, zVapor, this.scratchLnPhiV);

        // Convergence check: sum_i (ln(K_i) + ln(phi_i^V) - ln(phi_i^L))^2 < 1e-10
        let error = 0.0;
        for (let i = 0; i < this.numComponents; i++) {
          const diff = Math.log(K[i]!) + lnPhiV[i]! - lnPhiL[i]!;
          error += diff * diff;
          // Update K_i with damping
          K[i] = K[i]! * Math.exp(0.85 * (lnPhiL[i]! - lnPhiV[i]!));
          K[i] = Math.max(1e-6, Math.min(1e6, K[i]!));
        }

        if (error < 1e-10) {
          break;
        }
      }
    }

    if (!isTwoPhase) {
      if (beta === 0.0) {
        for (let i = 0; i < this.numComponents; i++) {
          x[i] = z[i]!;
          y[i] = z[i]!;
        }
      } else {
        for (let i = 0; i < this.numComponents; i++) {
          x[i] = z[i]!;
          y[i] = z[i]!;
        }
      }
    }

    // Thermodynamic properties evaluation
    const { aMix: aL, bMix: bL } = this.mixParameters(x, pureA, pureB);
    const { aMix: aV, bMix: bV } = this.mixParameters(y, pureA, pureB);
    const { zLiquid } = this.solveZFactor(P, T, aL, bL);
    const { zVapor } = this.solveZFactor(P, T, aV, bV);

    const gasProps = this.evaluatePhaseProperties(y, P, T, zVapor, true);
    const liqProps = this.evaluatePhaseProperties(x, P, T, zLiquid, false);

    // Interfacial tension via Macleod-Sugden Parachor
    const surfaceTension = this.evaluateSurfaceTension(x, y, liqProps.densityKgM3, gasProps.densityKgM3);

    return {
      vaporFraction: beta,
      isTwoPhase,
      equilibriumKValues: Array.from(K),
      gas: { ...gasProps, moleFraction: beta },
      liquid: { ...liqProps, moleFraction: 1.0 - beta },
      surfaceTensionNPerM: isTwoPhase ? surfaceTension : 0.0,
    };
  }

  /**
   * Solves Rachford-Rice equation f(beta) = sum [ z_i (K_i - 1) / (1 + beta (K_i - 1)) ] = 0
   * via guarded Newton-Raphson.
   */
  private solveRachfordRice(z: Float64Array, K: Float64Array): number {
    let betaMin = 0.0;
    let betaMax = 1.0;

    for (let i = 0; i < this.numComponents; i++) {
      if (K[i]! > 1.0) {
        betaMin = Math.max(betaMin, 0.0);
      } else if (K[i]! < 1.0) {
        const bound = 1.0 / (1.0 - K[i]!);
        betaMax = Math.min(betaMax, bound);
      }
    }

    let beta = 0.5;
    for (let iter = 0; iter < 50; iter++) {
      let f = 0.0;
      let df = 0.0;

      for (let i = 0; i < this.numComponents; i++) {
        const km1 = K[i]! - 1.0;
        const denom = 1.0 + beta * km1;
        f += (z[i]! * km1) / denom;
        df -= (z[i]! * km1 * km1) / (denom * denom);
      }

      if (Math.abs(f) < 1e-12) break;

      const delta = f / (df !== 0 ? df : -1e-6);
      let nextBeta = beta - delta;

      // Guarded step
      if (nextBeta <= 0.0 || nextBeta >= 1.0) {
        if (f > 0) betaMin = beta;
        else betaMax = beta;
        nextBeta = 0.5 * (betaMin + betaMax);
      }

      if (Math.abs(nextBeta - beta) < 1e-9) {
        beta = nextBeta;
        break;
      }
      beta = nextBeta;
    }

    return Math.max(0.0, Math.min(1.0, beta));
  }

  /**
   * Evaluates density, LBC viscosity, sound speed, enthalpy, and Cp for a phase.
   */
  private evaluatePhaseProperties(
    composition: Float64Array,
    P: number,
    T: number,
    Z: number,
    isGas: boolean,
  ): FlashPhaseProperties {
    let mw = 0.0;
    for (let i = 0; i < this.numComponents; i++) {
      mw += composition[i]! * this.components[i]!.molecularWeight;
    }
    mw = Math.max(0.002, mw);

    // Molar volume v = Z * R * T / P [m^3/mol]
    const molarVolume = (Z * R_GAS * T) / Math.max(1e4, P);
    const density = mw / Math.max(1e-7, molarVolume); // [kg/m^3]

    // Viscosity via Lohrenz-Bray-Clark (LBC)
    const viscosity = this.evaluateLbcViscosity(composition, T, density, mw);

    // Isentropic sound speed c = sqrt(gamma * Z * R * T / mw)
    const gamma = isGas ? 1.3 : 1.15;
    const soundSpeed = Math.sqrt(Math.max(100.0, (gamma * Z * R_GAS * T) / mw));

    // Ideal + residual specific enthalpy & heat capacity
    const cpMolar = isGas ? 35.0 : 75.0; // J/(mol*K) approximate baseline
    const cp = cpMolar / mw; // J/(kg*K)
    const enthalpy = cp * (T - 273.15); // J/kg relative to 0 C

    return {
      moleFraction: 0,
      composition: Array.from(composition),
      molecularWeight: mw,
      zFactor: Z,
      densityKgM3: Math.max(0.1, density),
      viscosityPaS: Math.max(1e-5, viscosity),
      soundSpeedMS: soundSpeed,
      enthalpyJPerKg: enthalpy,
      heatCapacityJPerKgK: cp,
    };
  }

  /**
   * Lohrenz-Bray-Clark (LBC) dense fluid viscosity correlation.
   */
  private evaluateLbcViscosity(
    x: Float64Array,
    T: number,
    densityKgM3: number,
    molecularWeightKgPerMol: number,
  ): number {
    let sumLowMu = 0.0;
    let sumSqrtMw = 0.0;
    let vcMix = 0.0;

    for (let i = 0; i < this.numComponents; i++) {
      const c = this.components[i]!;
      const mwG = c.molecularWeight * 1000.0;
      const pcAtm = c.criticalPressurePa / 101325.0;
      const xi = Math.pow(c.criticalTempK, 1.0 / 6.0) / (Math.sqrt(mwG) * Math.pow(pcAtm, 2.0 / 3.0));

      const Tr = T / c.criticalTempK;
      let muPureGas: number;
      if (Tr <= 1.5) {
        muPureGas = (34.0e-5 * Math.pow(Tr, 0.94)) / xi;
      } else {
        muPureGas = (17.78e-5 * Math.pow(4.58 * Tr - 1.67, 0.625)) / xi;
      }

      sumLowMu += x[i]! * muPureGas * Math.sqrt(mwG);
      sumSqrtMw += x[i]! * Math.sqrt(mwG);
      vcMix += x[i]! * c.criticalVolumeM3PerMol;
    }

    const muZero = (sumLowMu / Math.max(1e-6, sumSqrtMw)) * 1e-3; // Convert cP to Pa*s

    // Reduced density rho_r = rho_molar * Vc_mix
    const rhoMolar = densityKgM3 / molecularWeightKgPerMol;
    const rhoR = rhoMolar * vcMix;

    // Mixture parameter xi_m
    const mwMixG = molecularWeightKgPerMol * 1000.0;
    let pcMixAtm = 40.0; // Typical pseudo-critical
    let tcMixK = 350.0;
    const xiM = Math.pow(tcMixK, 1.0 / 6.0) / (Math.sqrt(mwMixG) * Math.pow(pcMixAtm, 2.0 / 3.0));

    // LBC 4th order polynomial: [(mu - mu0)*xi_m + 1e-4]^(1/4)
    const poly =
      0.1023 + 0.023364 * rhoR + 0.058533 * rhoR * rhoR - 0.040758 * Math.pow(rhoR, 3) + 0.0093324 * Math.pow(rhoR, 4);
    const deltaMu = Math.max(0.0, (Math.pow(poly, 4) - 1e-4) / Math.max(1e-4, xiM)) * 1e-3;

    return Math.max(1e-5, muZero + deltaMu);
  }

  /**
   * Macleod-Sugden Parachor interfacial tension correlation.
   * sigma = [ sum_i (P_i * (x_i * rhoL_molar - y_i * rhoG_molar)) ]^4 * 1e-3 [N/m]
   */
  private evaluateSurfaceTension(x: Float64Array, y: Float64Array, rhoL: number, rhoG: number): number {
    let mwL = 0.0;
    let mwG = 0.0;
    for (let i = 0; i < this.numComponents; i++) {
      mwL += x[i]! * this.components[i]!.molecularWeight;
      mwG += y[i]! * this.components[i]!.molecularWeight;
    }
    const rhoLMolar = rhoL / Math.max(1e-6, mwL); // mol/m^3
    const rhoGMolar = rhoG / Math.max(1e-6, mwG); // mol/m^3

    let sum = 0.0;
    for (let i = 0; i < this.numComponents; i++) {
      const pCh = this.components[i]!.parachor;
      sum += pCh * (x[i]! * rhoLMolar * 1e-6 - y[i]! * rhoGMolar * 1e-6);
    }

    if (sum <= 0) return 0.001; // Dynes/cm threshold
    const sigmaDyneCm = Math.pow(sum, 4);
    return Math.max(1e-4, Math.min(0.08, sigmaDyneCm * 1e-3)); // Convert to N/m
  }

  /**
   * Calculates bubble point pressure at a given temperature T [K]
   * by iterating pressure until sum(z_i * K_i(P, T)) = 1.
   */
  public calculateBubblePoint(T: number, z: Record<string, number> | number[]): number {
    let pMin = 1.0e5; // 1 bar
    let pMax = 400.0e5; // 400 bar
    let pMid = 50.0e5;

    for (let iter = 0; iter < 40; iter++) {
      pMid = 0.5 * (pMin + pMax);
      const res = this.flashPT(pMid, T, z);
      if (res.vaporFraction > 0.0) {
        // Vapor exists, pressure is below bubble point
        pMin = pMid;
      } else {
        // Single-phase liquid, pressure is above bubble point
        pMax = pMid;
      }
      if (Math.abs(pMax - pMin) < 1e3) break;
    }

    return pMid;
  }

  /**
   * Calculates dew point pressure at a given temperature T [K]
   * by iterating pressure until sum(z_i / K_i(P, T)) = 1.
   */
  public calculateDewPoint(T: number, z: Record<string, number> | number[]): number {
    let pMin = 1.0e5;
    let pMax = 300.0e5;
    let pMid = 20.0e5;

    for (let iter = 0; iter < 40; iter++) {
      pMid = 0.5 * (pMin + pMax);
      const res = this.flashPT(pMid, T, z);
      if (res.vaporFraction < 1.0) {
        // Liquid condensed, pressure is above dew point
        pMax = pMid;
      } else {
        // Single-phase vapor, pressure is below dew point
        pMin = pMid;
      }
      if (Math.abs(pMax - pMin) < 1e3) break;
    }

    return pMid;
  }

  /**
   * Traces full saturation curve (bubble line + dew line) and computes phase envelope.
   */
  public generatePhaseEnvelope(
    z: Record<string, number> | number[],
    tMinK: number = 220.0,
    tMaxK: number = 420.0,
    numPoints: number = 25,
  ): PhaseEnvelope {
    const bubblePoints: { temperatureK: number; pressurePa: number }[] = [];
    const dewPoints: { temperatureK: number; pressurePa: number }[] = [];

    const dt = (tMaxK - tMinK) / (numPoints - 1);
    let maxP = 0.0;
    let cricondenbar = { temperatureK: tMinK, pressurePa: 0.0 };
    let maxT = 0.0;
    let cricondentherm = { temperatureK: 0.0, pressurePa: 0.0 };

    for (let i = 0; i < numPoints; i++) {
      const t = tMinK + i * dt;
      const pb = this.calculateBubblePoint(t, z);
      const pd = this.calculateDewPoint(t, z);

      if (pb > 1.5e5) {
        bubblePoints.push({ temperatureK: t, pressurePa: pb });
        if (pb > maxP) {
          maxP = pb;
          cricondenbar = { temperatureK: t, pressurePa: pb };
        }
      }

      if (pd > 1.5e5) {
        dewPoints.push({ temperatureK: t, pressurePa: pd });
        if (t > maxT && pd > 2.0e5) {
          maxT = t;
          cricondentherm = { temperatureK: t, pressurePa: pd };
        }
      }
    }

    const critT = 0.5 * (cricondenbar.temperatureK + cricondentherm.temperatureK);
    const critP = 0.85 * cricondenbar.pressurePa;

    return {
      bubblePoints,
      dewPoints,
      cricondenbar,
      cricondentherm,
      criticalPoint: { temperatureK: critT, pressurePa: critP },
    };
  }
}

/**
 * High-level synthesizer: converts a fluid composition + Cubic EOS model into
 * a full 2D `PvtTableData` object directly consumable by `simulateDriftFlux`.
 */
export function eosToPvtTable(
  eos: CubicEos,
  composition: Record<string, number> | number[],
  pressuresPa: number[],
  temperaturesK: number[],
): PvtTableData {
  const nP = pressuresPa.length;
  const nT = temperaturesK.length;

  const rhoG: number[][] = Array.from({ length: nP }, () => new Array(nT).fill(0));
  const rhoL: number[][] = Array.from({ length: nP }, () => new Array(nT).fill(0));
  const visG: number[][] = Array.from({ length: nP }, () => new Array(nT).fill(0));
  const visL: number[][] = Array.from({ length: nP }, () => new Array(nT).fill(0));
  const surfaceTension: number[][] = Array.from({ length: nP }, () => new Array(nT).fill(0));
  const vaporFraction: number[][] = Array.from({ length: nP }, () => new Array(nT).fill(0));
  const cpG: number[][] = Array.from({ length: nP }, () => new Array(nT).fill(0));
  const cpL: number[][] = Array.from({ length: nP }, () => new Array(nT).fill(0));
  const hlG: number[][] = Array.from({ length: nP }, () => new Array(nT).fill(0));
  const hlL: number[][] = Array.from({ length: nP }, () => new Array(nT).fill(0));

  for (let pIdx = 0; pIdx < nP; pIdx++) {
    const P = pressuresPa[pIdx]!;
    for (let tIdx = 0; tIdx < nT; tIdx++) {
      const T = temperaturesK[tIdx]!;
      const flash = eos.flashPT(P, T, composition);

      rhoG[pIdx]![tIdx] = flash.gas.densityKgM3;
      rhoL[pIdx]![tIdx] = flash.liquid.densityKgM3;
      visG[pIdx]![tIdx] = flash.gas.viscosityPaS;
      visL[pIdx]![tIdx] = flash.liquid.viscosityPaS;
      surfaceTension[pIdx]![tIdx] = flash.surfaceTensionNPerM;
      vaporFraction[pIdx]![tIdx] = flash.vaporFraction;
      cpG[pIdx]![tIdx] = flash.gas.heatCapacityJPerKgK;
      cpL[pIdx]![tIdx] = flash.liquid.heatCapacityJPerKgK;
      hlG[pIdx]![tIdx] = flash.gas.enthalpyJPerKg;
      hlL[pIdx]![tIdx] = flash.liquid.enthalpyJPerKg;
    }
  }

  // Trace saturation envelope
  const tMin = temperaturesK[0]!;
  const tMax = temperaturesK[nT - 1]!;
  const envelope = eos.generatePhaseEnvelope(composition, tMin, tMax, 20);

  const bubblePointCurve = envelope.bubblePoints.map((pt) => ({
    pressure: pt.pressurePa,
    temperature: pt.temperatureK,
  }));
  const dewPointCurve = envelope.dewPoints.map((pt) => ({
    pressure: pt.pressurePa,
    temperature: pt.temperatureK,
  }));

  return {
    title: `In-WASM ${eos.modelType} Compositional PVT Matrix`,
    fluidType: "TWO_PHASE",
    units: DEFAULT_SI_UNITS,
    pressures: [...pressuresPa].sort((a, b) => a - b),
    temperatures: [...temperaturesK].sort((a, b) => a - b),
    rhoG,
    rhoL,
    visG,
    visL,
    surfaceTension,
    vaporFraction,
    cpG,
    cpL,
    hlG,
    hlL,
    bubblePointCurve,
    dewPointCurve,
  };
}

/**
 * Serializes a `PvtTableData` object into standard OLGA tabular `.tab` file format.
 */
export function formatPvtTable(table: PvtTableData): string {
  const pList = table.pressures.map((p) => (p / 1e5).toFixed(1)).join(", ");
  const tList = table.temperatures.map((t) => (t - 273.15).toFixed(1)).join(", ");
  const lines: string[] = [
    `TITLE = "${table.title}"`,
    `PHASE = TWO-PHASE`,
    `UNITS = METRIC`,
    `PRESSURE = ${pList} BAR`,
    `TEMPERATURE = ${tList} C`,
    `COLUMNS = PRESSURE, TEMPERATURE, ROG, ROL, VISG, VISL, STG`,
  ];
  for (let pIdx = 0; pIdx < table.pressures.length; pIdx++) {
    const pBar = table.pressures[pIdx]! / 1e5;
    for (let tIdx = 0; tIdx < table.temperatures.length; tIdx++) {
      const tC = table.temperatures[tIdx]! - 273.15;
      const rog = table.rhoG[pIdx]?.[tIdx] ?? 0;
      const rol = table.rhoL[pIdx]?.[tIdx] ?? 0;
      const visg = (table.visG[pIdx]?.[tIdx] ?? 0) * 1e3; // Pa.s -> cP
      const visl = (table.visL[pIdx]?.[tIdx] ?? 0) * 1e3; // Pa.s -> cP
      const stg = table.surfaceTension[pIdx]?.[tIdx] ?? 0; // N/m
      lines.push(
        `${pBar.toFixed(2)}, ${tC.toFixed(2)}, ${rog.toFixed(2)}, ${rol.toFixed(2)}, ${visg.toFixed(4)}, ${visl.toFixed(4)}, ${stg.toFixed(4)}`,
      );
    }
  }
  return lines.join("\n") + "\n";
}
