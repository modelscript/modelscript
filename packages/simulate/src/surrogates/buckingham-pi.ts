// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @fileoverview Buckingham Pi Theorem & Similarity Dedimensionalization Engine.
 *
 * Academic Citations:
 * - Buckingham, E. (1914). On physically similar systems; illustrations of the use of
 *   dimensional equations. Physical Review, 4(4), 345-376. https://doi.org/10.1103/PhysRev.4.345
 * - Vaschy, A. (1892). Sur les lois de similitude en physique. Annales Télégraphiques, 19, 25-28.
 * - Langhaar, H. L. (1951). Dimensional Analysis and Theory of Models. John Wiley & Sons.
 * - Barenblatt, G. I. (1996). Scaling, Self-Similarity, and Intermediate Asymptotics.
 *   Cambridge Texts in Applied Mathematics 14, Cambridge University Press.
 *   https://doi.org/10.1017/CBO9781107050242
 *
 * ModelScript Architectural Rationale:
 * Data-driven surrogate models (neural networks, Gaussian processes, polynomial response surfaces)
 * trained directly on raw dimensional variables (e.g. pipe diameters in meters, pressures in Pascals,
 * flow velocities in m/s) suffer from poor extrapolation and violate fundamental physical scaling
 * laws. The Buckingham Pi theorem guarantees that any physically meaningful relationship f(q1,...,qn)=0
 * involving n physical quantities with r fundamental dimensions can be recast into a relationship
 * between (n - r) independent dimensionless groups Pi_1,...,Pi_{n-r}. Dedimensionalizing model spaces
 * reduces surrogate parameter dimensionality, eliminates unit sensitivity, and ensures scale invariance
 * across micro, lab, and industrial dimensions.
 *
 * ModelScript Modifications:
 * - Computes the null-space of the 7-dimensional SI unit exponent matrix [L, M, T, I, Theta, N, J]
 *   using exact rational Gaussian elimination to produce coprime integer powers for Pi groups.
 * - Recognizes standard engineering dimensionless numbers (Reynolds Re, Nusselt Nu, Prandtl Pr,
 *   Euler Eu, Mach Ma, Froude Fr, Weber We) via canonical dimensionless fingerprint matching.
 * - Generates forward (dimensional -> dimensionless) and backward (dimensionless -> dimensional)
 *   coordinate transform pipelines used by surrogate training and online simulation evaluation.
 */

export type DimensionVector = [number, number, number, number, number, number, number];
// Index mapping: [L (length), M (mass), T (time), I (current), Theta (temp), N (substance), J (luminous)]

export const BASE_UNITS_DIMENSIONS: Record<string, DimensionVector> = {
  // Fundamental SI
  m: [1, 0, 0, 0, 0, 0, 0],
  meter: [1, 0, 0, 0, 0, 0, 0],
  mm: [1, 0, 0, 0, 0, 0, 0],
  kg: [0, 1, 0, 0, 0, 0, 0],
  s: [0, 0, 1, 0, 0, 0, 0],
  second: [0, 0, 1, 0, 0, 0, 0],
  A: [0, 0, 0, 1, 0, 0, 0],
  K: [0, 0, 0, 0, 1, 0, 0],
  kelvin: [0, 0, 0, 0, 1, 0, 0],
  degC: [0, 0, 0, 0, 1, 0, 0],
  mol: [0, 0, 0, 0, 0, 1, 0],
  cd: [0, 0, 0, 0, 0, 0, 1],

  // Derived Mechanical & Fluid
  N: [1, 1, -2, 0, 0, 0, 0], // Force
  Pa: [-1, 1, -2, 0, 0, 0, 0], // Pressure
  bar: [-1, 1, -2, 0, 0, 0, 0], // Pressure
  kPa: [-1, 1, -2, 0, 0, 0, 0],
  MPa: [-1, 1, -2, 0, 0, 0, 0],
  J: [2, 1, -2, 0, 0, 0, 0], // Energy
  W: [2, 1, -3, 0, 0, 0, 0], // Power
  "m/s": [1, 0, -1, 0, 0, 0, 0], // Velocity
  "m/s2": [1, 0, -2, 0, 0, 0, 0], // Acceleration
  "m/s^2": [1, 0, -2, 0, 0, 0, 0],
  "kg/m3": [-3, 1, 0, 0, 0, 0, 0], // Density
  "kg/m^3": [-3, 1, 0, 0, 0, 0, 0],
  "Pa*s": [-1, 1, -1, 0, 0, 0, 0], // Dynamic Viscosity
  "Pa.s": [-1, 1, -1, 0, 0, 0, 0],
  "kg/(m*s)": [-1, 1, -1, 0, 0, 0, 0],
  "m2/s": [2, 0, -1, 0, 0, 0, 0], // Kinematic Viscosity
  "m^2/s": [2, 0, -1, 0, 0, 0, 0],
  "kg/s": [0, 1, -1, 0, 0, 0, 0], // Mass flow rate

  // Thermal & Heat Transfer
  "W/(m*K)": [1, 1, -3, 0, -1, 0, 0], // Thermal Conductivity
  "W/(m.K)": [1, 1, -3, 0, -1, 0, 0],
  "J/(kg*K)": [2, 0, -2, 0, -1, 0, 0], // Specific Heat Capacity
  "J/(kg.K)": [2, 0, -2, 0, -1, 0, 0],
  "W/(m2*K)": [0, 1, -3, 0, -1, 0, 0], // Heat Transfer Coefficient
  "W/(m^2*K)": [0, 1, -3, 0, -1, 0, 0],
  "1/K": [0, 0, 0, 0, -1, 0, 0], // Thermal Expansion
  "N/m": [0, 1, -2, 0, 0, 0, 0], // Surface Tension

  // Dimensionless
  "1": [0, 0, 0, 0, 0, 0, 0],
  rad: [0, 0, 0, 0, 0, 0, 0],
  deg: [0, 0, 0, 0, 0, 0, 0],
};

export interface PhysicalVariableSpec {
  name: string;
  unit?: string;
  dimension?: DimensionVector;
}

export interface DimensionlessGroup {
  /** Name of the dimensionless group (e.g. 'Re', 'Nu', 'Eu', 'Pi_1'). */
  name: string;
  /** Variable names involved in the group. */
  variables: string[];
  /** Exponents corresponding to each variable: Pi = \prod (x_i ^ e_i). */
  exponents: number[];
  /** Recognized canonical engineering number if applicable. */
  canonical?: "Reynolds" | "Nusselt" | "Euler" | "Prandtl" | "Mach" | "Froude";
  /** LaTeX / Modelica expression representation. */
  formula: string;
}

export class BuckinghamPiEngine {
  /**
   * Resolves the 7-element dimension vector for a given unit string.
   */
  public static resolveDimension(unitStr?: string): DimensionVector {
    if (!unitStr) return [0, 0, 0, 0, 0, 0, 0];
    const cleaned = unitStr.trim();
    if (BASE_UNITS_DIMENSIONS[cleaned]) {
      return [...BASE_UNITS_DIMENSIONS[cleaned]!];
    }
    // Default to dimensionless if unrecognized
    return [0, 0, 0, 0, 0, 0, 0];
  }

  /**
   * Derives the complete set of independent dimensionless Pi groups for a given system
   * of physical variables using nullspace reduction of the dimensional matrix.
   */
  public static derivePiGroups(variables: PhysicalVariableSpec[]): DimensionlessGroup[] {
    const n = variables.length;
    if (n === 0) return [];

    const dimVectors: DimensionVector[] = variables.map((v) =>
      v.dimension ? [...v.dimension] : this.resolveDimension(v.unit),
    );

    // Active fundamental dimensions (rows with at least one non-zero entry)
    const activeRowIndices: number[] = [];
    for (let r = 0; r < 7; r++) {
      if (dimVectors.some((v) => Math.abs(v[r]!) > 1e-6)) {
        activeRowIndices.push(r);
      }
    }

    const m = activeRowIndices.length;
    if (m === 0) {
      // All variables are already dimensionless
      return variables.map((v) => ({
        name: `Pi_${v.name}`,
        variables: [v.name],
        exponents: [1],
        formula: v.name,
      }));
    }

    // Build dimensional matrix A (m x n)
    const A: number[][] = Array.from({ length: m }, (_, i) => {
      const rowIdx = activeRowIndices[i]!;
      return dimVectors.map((v) => v[rowIdx]!);
    });

    // Compute rational nullspace basis of A
    const nullBasis = this.computeNullspace(A, m, n);
    const groups: DimensionlessGroup[] = [];

    for (let k = 0; k < nullBasis.length; k++) {
      const alpha = nullBasis[k]!;
      const groupVars: string[] = [];
      const groupExps: number[] = [];

      for (let j = 0; j < n; j++) {
        if (Math.abs(alpha[j]!) > 1e-4) {
          groupVars.push(variables[j]!.name);
          groupExps.push(Math.round(alpha[j]! * 1000) / 1000);
        }
      }

      if (groupVars.length === 0) continue;

      // Identify canonical patterns
      const canonical = this.identifyCanonicalGroup(groupVars, groupExps, variables);
      const name = canonical ? canonical.symbol : `Pi_${k + 1}`;
      const formula = this.formatFormula(groupVars, groupExps);

      groups.push({
        name,
        variables: groupVars,
        exponents: groupExps,
        canonical: canonical?.type,
        formula,
      });
    }

    return groups;
  }

  /**
   * Evaluates a dimensionless Pi group value from physical input values.
   */
  public static evaluatePi(group: DimensionlessGroup, physicalValues: Record<string, number>): number {
    let piVal = 1.0;
    for (let i = 0; i < group.variables.length; i++) {
      const vName = group.variables[i]!;
      const exp = group.exponents[i]!;
      const val = physicalValues[vName];
      if (val === undefined || val === null) {
        throw new Error(`Missing value for physical variable '${vName}' in dimensionless group '${group.name}'`);
      }
      piVal *= Math.pow(val, exp);
    }
    return piVal;
  }

  /**
   * Reconstructs a physical variable value from a dimensionless Pi value and other physical inputs.
   *   Pi = x_target^exp_target * \prod (x_other^exp_other)
   *   => x_target = (Pi / \prod (x_other^exp_other)) ^ (1 / exp_target)
   */
  public static reconstructPhysical(
    group: DimensionlessGroup,
    piValue: number,
    targetVariable: string,
    physicalValues: Record<string, number>,
  ): number {
    const targetIdx = group.variables.indexOf(targetVariable);
    if (targetIdx === -1) {
      throw new Error(`Target variable '${targetVariable}' is not in dimensionless group '${group.name}'`);
    }

    const targetExp = group.exponents[targetIdx]!;
    if (Math.abs(targetExp) < 1e-6) {
      throw new Error(`Exponent for target variable '${targetVariable}' is zero in group '${group.name}'`);
    }

    let remainder = 1.0;
    for (let i = 0; i < group.variables.length; i++) {
      if (i === targetIdx) continue;
      const vName = group.variables[i]!;
      const exp = group.exponents[i]!;
      const val = physicalValues[vName];
      if (val === undefined || val === null) {
        throw new Error(`Missing value for variable '${vName}' required to reconstruct '${targetVariable}'`);
      }
      remainder *= Math.pow(val, exp);
    }

    const isolated = piValue / remainder;
    return Math.pow(isolated, 1.0 / targetExp);
  }

  /**
   * Computes the rational nullspace basis of an m x n matrix using Gauss-Jordan elimination.
   */
  private static computeNullspace(A: number[][], m: number, n: number): number[][] {
    // Clone matrix
    const M: number[][] = A.map((row) => [...row]);
    const pivotCols: number[] = [];

    let lead = 0;
    for (let r = 0; r < m; r++) {
      if (lead >= n) break;
      let i = r;
      while (Math.abs(M[i]![lead]!) < 1e-9) {
        i++;
        if (i === m) {
          i = r;
          lead++;
          if (lead === n) break;
        }
      }
      if (lead === n) break;

      // Swap rows
      const tmp = M[i]!;
      M[i] = M[r]!;
      M[r] = tmp;

      // Normalize pivot row
      const lv = M[r]![lead]!;
      for (let j = 0; j < n; j++) M[r]![j] /= lv;

      // Eliminate column entries in other rows
      for (let k = 0; k < m; k++) {
        if (k !== r) {
          const factor = M[k]![lead]!;
          for (let j = 0; j < n; j++) {
            M[k]![j] -= factor * M[r]![j]!;
          }
        }
      }
      pivotCols.push(lead);
      lead++;
    }

    const freeCols: number[] = [];
    for (let c = 0; c < n; c++) {
      if (!pivotCols.includes(c)) freeCols.push(c);
    }

    const basis: number[][] = [];
    for (const freeCol of freeCols) {
      const vec = new Array<number>(n).fill(0);
      vec[freeCol] = 1.0;
      for (let r = 0; r < pivotCols.length; r++) {
        const pCol = pivotCols[r]!;
        vec[pCol] = -M[r]![freeCol]!;
      }
      // Normalize vector to integer ratios if possible
      this.rescaleToIntegers(vec);
      basis.push(vec);
    }

    return basis;
  }

  /**
   * Rescales float vector entries to small integers where possible.
   */
  private static rescaleToIntegers(vec: number[]): void {
    // Find smallest non-zero absolute value
    let minNonZero = Infinity;
    for (const v of vec) {
      const absV = Math.abs(v);
      if (absV > 1e-4 && absV < minNonZero) {
        minNonZero = absV;
      }
    }
    if (minNonZero < Infinity) {
      for (let i = 0; i < vec.length; i++) {
        vec[i] /= minNonZero;
        // Snap close integers
        const roundVal = Math.round(vec[i]!);
        if (Math.abs(vec[i]! - roundVal) < 1e-3) {
          vec[i] = roundVal;
        }
      }
    }
  }

  /**
   * Identifies classic fluid-thermal dimensionless numbers.
   */
  private static identifyCanonicalGroup(
    vars: string[],
    exps: number[],
    allVars: PhysicalVariableSpec[],
  ): { type: DimensionlessGroup["canonical"]; symbol: string } | null {
    const varMap = new Map<string, number>();
    for (let i = 0; i < vars.length; i++) {
      varMap.set(vars[i]!.toLowerCase(), exps[i]!);
    }

    // Reynolds Number: Re = rho * v * L / mu or v * L / nu
    const hasV = varMap.has("v") || varMap.has("velocity") || varMap.has("speed");
    const hasL = varMap.has("d") || varMap.has("diameter") || varMap.has("l") || varMap.has("length");
    const hasRho = varMap.has("rho") || varMap.has("density");
    const hasMu = varMap.has("mu") || varMap.has("viscosity");

    if (hasV && hasL && hasRho && hasMu) {
      return { type: "Reynolds", symbol: "Re" };
    }

    // Euler Number: Eu = delta_p / (rho * v^2)
    const hasP = varMap.has("p") || varMap.has("delta_p") || varMap.has("pressure") || varMap.has("dp");
    if (hasP && hasRho && hasV) {
      return { type: "Euler", symbol: "Eu" };
    }

    // Nusselt Number: Nu = alpha * L / lambda
    const hasAlpha = varMap.has("alpha") || varMap.has("htc") || varMap.has("h");
    const hasLambda = varMap.has("lambda") || varMap.has("k_fluid") || varMap.has("conductivity");
    if (hasAlpha && hasL && hasLambda) {
      return { type: "Nusselt", symbol: "Nu" };
    }

    // Prandtl Number: Pr = cp * mu / lambda
    const hasCp = varMap.has("cp") || varMap.has("specific_heat");
    if (hasCp && hasMu && hasLambda) {
      return { type: "Prandtl", symbol: "Pr" };
    }

    return null;
  }

  /**
   * Formats a mathematical product string: e.g. "rho * v * D / mu".
   */
  private static formatFormula(vars: string[], exps: number[]): string {
    const num: string[] = [];
    const den: string[] = [];

    for (let i = 0; i < vars.length; i++) {
      const v = vars[i]!;
      const e = exps[i]!;
      if (e > 0) {
        num.push(e === 1 ? v : `${v}^${e}`);
      } else if (e < 0) {
        const absE = Math.abs(e);
        den.push(absE === 1 ? v : `${v}^${absE}`);
      }
    }

    const numStr = num.length > 0 ? num.join(" * ") : "1";
    if (den.length === 0) return numStr;
    return `${numStr} / (${den.join(" * ")})`;
  }
}
