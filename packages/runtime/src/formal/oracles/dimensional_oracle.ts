// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/runtime — ISO 80000 Dimensional Theory Oracle.
 *
 * Enforces dimensional homogeneity across physical quantities using 7-element
 * rational exponent vectors: [L, M, T, I, Θ, N, J]
 *   L: Length (m)
 *   M: Mass (kg)
 *   T: Time (s)
 *   I: Electric Current (A)
 *   Θ: Thermodynamic Temperature (K)
 *   N: Amount of Substance (mol)
 *   J: Luminous Intensity (cd)
 */

import type { ConflictClause, SharedEquality, TheoryLiteral, TheoryOracle } from "../theory_coordinator.js";

export type DimensionVector = [number, number, number, number, number, number, number];

export const DIMENSION_DIMENSIONLESS: DimensionVector = [0, 0, 0, 0, 0, 0, 0];
export const DIMENSION_LENGTH: DimensionVector = [1, 0, 0, 0, 0, 0, 0];
export const DIMENSION_MASS: DimensionVector = [0, 1, 0, 0, 0, 0, 0];
export const DIMENSION_TIME: DimensionVector = [0, 0, 1, 0, 0, 0, 0];
export const DIMENSION_CURRENT: DimensionVector = [0, 0, 0, 1, 0, 0, 0];
export const DIMENSION_TEMPERATURE: DimensionVector = [0, 0, 0, 0, 1, 0, 0];
export const DIMENSION_AMOUNT: DimensionVector = [0, 0, 0, 0, 0, 1, 0];
export const DIMENSION_LUMINOUS: DimensionVector = [0, 0, 0, 0, 0, 0, 1];

// Derived SI dimensions
export const DIMENSION_FORCE: DimensionVector = [1, 1, -2, 0, 0, 0, 0]; // N = kg*m/s^2
export const DIMENSION_PRESSURE: DimensionVector = [-1, 1, -2, 0, 0, 0, 0]; // Pa = N/m^2
export const DIMENSION_ENERGY: DimensionVector = [2, 1, -2, 0, 0, 0, 0]; // J = N*m
export const DIMENSION_POWER: DimensionVector = [2, 1, -3, 0, 0, 0, 0]; // W = J/s
export const DIMENSION_VOLTAGE: DimensionVector = [2, 1, -3, -1, 0, 0, 0]; // V = W/A
export const DIMENSION_VELOCITY: DimensionVector = [1, 0, -1, 0, 0, 0, 0]; // m/s
export const DIMENSION_ACCELERATION: DimensionVector = [1, 0, -2, 0, 0, 0, 0]; // m/s^2

export const STANDARD_UNITS: Record<string, DimensionVector> = {
  m: DIMENSION_LENGTH,
  meter: DIMENSION_LENGTH,
  kg: DIMENSION_MASS,
  kilogram: DIMENSION_MASS,
  s: DIMENSION_TIME,
  second: DIMENSION_TIME,
  A: DIMENSION_CURRENT,
  ampere: DIMENSION_CURRENT,
  K: DIMENSION_TEMPERATURE,
  kelvin: DIMENSION_TEMPERATURE,
  mol: DIMENSION_AMOUNT,
  mole: DIMENSION_AMOUNT,
  cd: DIMENSION_LUMINOUS,
  candela: DIMENSION_LUMINOUS,
  N: DIMENSION_FORCE,
  newton: DIMENSION_FORCE,
  Pa: DIMENSION_PRESSURE,
  pascal: DIMENSION_PRESSURE,
  J: DIMENSION_ENERGY,
  joule: DIMENSION_ENERGY,
  W: DIMENSION_POWER,
  watt: DIMENSION_POWER,
  V: DIMENSION_VOLTAGE,
  volt: DIMENSION_VOLTAGE,
  "m/s": DIMENSION_VELOCITY,
  "m/s2": DIMENSION_ACCELERATION,
  "m/s^2": DIMENSION_ACCELERATION,
  rad: DIMENSION_DIMENSIONLESS,
  deg: DIMENSION_DIMENSIONLESS,
  unitless: DIMENSION_DIMENSIONLESS,
};

export function areDimensionsEqual(a: DimensionVector, b: DimensionVector): boolean {
  for (let i = 0; i < 7; i++) {
    if (Math.abs(a[i]! - b[i]!) > 1e-6) return false;
  }
  return true;
}

export function formatDimension(d: DimensionVector): string {
  const symbols = ["L", "M", "T", "I", "Θ", "N", "J"];
  const parts: string[] = [];
  for (let i = 0; i < 7; i++) {
    const p = d[i]!;
    if (p !== 0) {
      parts.push(p === 1 ? symbols[i]! : `${symbols[i]}^${p}`);
    }
  }
  return parts.length === 0 ? "1 (Dimensionless)" : `[${parts.join(" · ")}]`;
}

export class DimensionalTheoryOracle implements TheoryOracle {
  public readonly name = "DimensionalTheoryOracle";
  public readonly domain = "constraint" as const;

  private varDimensions = new Map<string, DimensionVector>();
  private assertedLiterals = new Map<number, TheoryLiteral>();
  private aliases = new Map<string, string>();
  private sharedEqualities: SharedEquality[] = [];
  private levelStack: {
    varDimensions: Map<string, DimensionVector>;
    aliases: Map<string, string>;
    assertedLitIds: number[];
  }[] = [];

  constructor() {
    this.reset();
  }

  public reset(): void {
    this.varDimensions.clear();
    this.assertedLiterals.clear();
    this.aliases.clear();
    this.sharedEqualities = [];
    this.levelStack = [];
  }

  public pushLevel(): void {
    this.levelStack.push({
      varDimensions: new Map(this.varDimensions),
      aliases: new Map(this.aliases),
      assertedLitIds: [],
    });
  }

  public popLevel(): void {
    const top = this.levelStack.pop();
    if (!top) return;
    this.varDimensions = top.varDimensions;
    this.aliases = top.aliases;
    for (const id of top.assertedLitIds) {
      this.assertedLiterals.delete(id);
    }
  }

  private getCanonicalVar(v: string): string {
    const parent = this.aliases.get(v);
    if (!parent || parent === v) {
      this.aliases.set(v, v);
      return v;
    }
    const root = this.getCanonicalVar(parent);
    this.aliases.set(v, root);
    return root;
  }

  private resolveDimension(spec: DimensionVector | string): DimensionVector | null {
    if (Array.isArray(spec) && spec.length === 7) {
      return spec as DimensionVector;
    }
    if (typeof spec === "string" && STANDARD_UNITS[spec]) {
      return STANDARD_UNITS[spec]!;
    }
    return null;
  }

  public getDimension(varName: string): DimensionVector | undefined {
    const root = this.getCanonicalVar(varName);
    return this.varDimensions.get(root);
  }

  public assertLiteral(lit: TheoryLiteral): boolean {
    this.assertedLiterals.set(lit.id, lit);
    if (this.levelStack.length > 0) {
      this.levelStack[this.levelStack.length - 1]!.assertedLitIds.push(lit.id);
    }
    const { predicate, args } = lit;

    switch (predicate) {
      case "dimension": {
        const [varName, dimSpec] = args as [string, DimensionVector | string];
        const dim = this.resolveDimension(dimSpec);
        if (dim) {
          const canon = this.getCanonicalVar(varName);
          this.varDimensions.set(canon, dim);
        }
        break;
      }
      case "dimensionMult": {
        // varRes = varA * varB => dim(varRes) = dim(varA) + dim(varB)
        const [varRes, varA, varB] = args as [string, string, string];
        const dimA = this.getDimension(varA);
        const dimB = this.getDimension(varB);
        if (dimA && dimB) {
          const resDim: DimensionVector = [
            dimA[0] + dimB[0],
            dimA[1] + dimB[1],
            dimA[2] + dimB[2],
            dimA[3] + dimB[3],
            dimA[4] + dimB[4],
            dimA[5] + dimB[5],
            dimA[6] + dimB[6],
          ];
          this.varDimensions.set(this.getCanonicalVar(varRes), resDim);
        }
        break;
      }
      case "dimensionDiv": {
        // varRes = varA / varB => dim(varRes) = dim(varA) - dim(varB)
        const [varRes, varA, varB] = args as [string, string, string];
        const dimA = this.getDimension(varA);
        const dimB = this.getDimension(varB);
        if (dimA && dimB) {
          const resDim: DimensionVector = [
            dimA[0] - dimB[0],
            dimA[1] - dimB[1],
            dimA[2] - dimB[2],
            dimA[3] - dimB[3],
            dimA[4] - dimB[4],
            dimA[5] - dimB[5],
            dimA[6] - dimB[6],
          ];
          this.varDimensions.set(this.getCanonicalVar(varRes), resDim);
        }
        break;
      }
      case "equal": {
        const [varA, varB] = args as [string, string];
        const rootA = this.getCanonicalVar(varA);
        const rootB = this.getCanonicalVar(varB);
        if (rootA !== rootB) {
          this.aliases.set(rootA, rootB);
        }
        break;
      }
    }

    return true;
  }

  public retractLiteral(litId: number): void {
    if (!this.assertedLiterals.has(litId)) return;
    this.assertedLiterals.delete(litId);
    const remaining = Array.from(this.assertedLiterals.values());
    const savedShared = [...this.sharedEqualities];
    this.reset();
    for (const lit of remaining) {
      this.assertLiteral(lit);
    }
    for (const eq of savedShared) {
      this.onSharedEquality(eq);
    }
  }

  public checkSat(): { isSat: boolean; conflict?: ConflictClause } {
    // Check that all aliased variables share the identical dimension (O(V) using root map)
    const rootDims = new Map<string, { varName: string; dim: DimensionVector }>();
    for (const [varA, dimA] of this.varDimensions.entries()) {
      const rootA = this.getCanonicalVar(varA);
      const existing = rootDims.get(rootA);
      if (!existing) {
        rootDims.set(rootA, { varName: varA, dim: dimA });
      } else if (!areDimensionsEqual(dimA, existing.dim)) {
        const varB = existing.varName;
        const culprits = Array.from(this.assertedLiterals.values()).filter(
          (l) => l.args.includes(varA) || l.args.includes(varB),
        );

        return {
          isSat: false,
          conflict: {
            literals: culprits,
            explanation: `Dimensional Inconsistency (ISO 80000): Variable '${varA}' has dimension ${formatDimension(dimA)}, but is unified with '${varB}' of incompatible dimension ${formatDimension(existing.dim)}.`,
            culpritEntities: [varA, varB],
            theoryName: this.name,
          },
        };
      }
    }

    return { isSat: true };
  }

  public propagateEqualities(): SharedEquality[] {
    return [];
  }

  public onSharedEquality(eq: SharedEquality): void {
    this.sharedEqualities.push(eq);
    const rootA = this.getCanonicalVar(eq.varA);
    const rootB = this.getCanonicalVar(eq.varB);
    if (rootA !== rootB) {
      this.aliases.set(rootA, rootB);
    }
  }
}
