// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * SI unit checking for Modelica variables and expressions.
 *
 * Represents units as 7-tuples of exponents for the SI base dimensions:
 *   [m, kg, s, A, K, mol, cd]
 *
 * Provides unit arithmetic (multiplication adds exponents, division subtracts),
 * unit parsing from Modelica unit strings, and mismatch detection.
 *
 * Reference: Modelica §6.6, International System of Units (SI)
 */

// ── SI unit representation ──

/** SI base dimension names, in order. */
export const SI_DIMENSIONS = ["m", "kg", "s", "A", "K", "mol", "cd"] as const;

/** An SI unit represented as exponents of the 7 base dimensions. */
export type SIUnit = [number, number, number, number, number, number, number];

/** The dimensionless unit (e.g., for pure numbers, angles in radians). */
export const DIMENSIONLESS: SIUnit = [0, 0, 0, 0, 0, 0, 0];

// ── Common SI derived units ──

/** Pre-defined SI units for common Modelica types. */
export const SI_UNITS: Record<string, SIUnit> = {
  // Base units
  m: [1, 0, 0, 0, 0, 0, 0],
  kg: [0, 1, 0, 0, 0, 0, 0],
  s: [0, 0, 1, 0, 0, 0, 0],
  A: [0, 0, 0, 1, 0, 0, 0],
  K: [0, 0, 0, 0, 1, 0, 0],
  mol: [0, 0, 0, 0, 0, 1, 0],
  cd: [0, 0, 0, 0, 0, 0, 1],

  // Derived units
  Hz: [0, 0, -1, 0, 0, 0, 0], // 1/s
  N: [1, 1, -2, 0, 0, 0, 0], // kg·m/s²
  Pa: [-1, 1, -2, 0, 0, 0, 0], // N/m² = kg/(m·s²)
  J: [2, 1, -2, 0, 0, 0, 0], // N·m = kg·m²/s²
  W: [2, 1, -3, 0, 0, 0, 0], // J/s = kg·m²/s³
  C: [0, 0, 1, 1, 0, 0, 0], // A·s
  V: [2, 1, -3, -1, 0, 0, 0], // W/A = kg·m²/(s³·A)
  F: [-2, -1, 4, 2, 0, 0, 0], // C/V = s⁴·A²/(kg·m²)
  Ohm: [2, 1, -3, -2, 0, 0, 0], // V/A = kg·m²/(s³·A²)
  S: [-2, -1, 3, 2, 0, 0, 0], // 1/Ohm = s³·A²/(kg·m²)
  Wb: [2, 1, -2, -1, 0, 0, 0], // V·s = kg·m²/(s²·A)
  T: [0, 1, -2, -1, 0, 0, 0], // Wb/m² = kg/(s²·A)
  H: [2, 1, -2, -2, 0, 0, 0], // Wb/A = kg·m²/(s²·A²)
  lm: [0, 0, 0, 0, 0, 0, 1], // cd·sr (sr = 1)
  lx: [-2, 0, 0, 0, 0, 0, 1], // lm/m²

  // Common compound units
  "m/s": [1, 0, -1, 0, 0, 0, 0], // velocity
  "m/s2": [1, 0, -2, 0, 0, 0, 0], // acceleration
  "kg/m3": [-3, 1, 0, 0, 0, 0, 0], // density
  "J/(kg.K)": [2, 0, -2, 0, -1, 0, 0], // specific heat capacity
  "W/(m.K)": [1, 1, -3, 0, -1, 0, 0], // thermal conductivity
  "W/(m2.K)": [0, 1, -3, 0, -1, 0, 0], // heat transfer coefficient
  rad: [0, 0, 0, 0, 0, 0, 0], // radian (dimensionless)
  "rad/s": [0, 0, -1, 0, 0, 0, 0], // angular velocity
  "1": [0, 0, 0, 0, 0, 0, 0], // dimensionless
};

// ── Unit arithmetic ──

/** Multiply two units (add exponents). */
export function unitMultiply(a: SIUnit, b: SIUnit): SIUnit {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2], a[3] + b[3], a[4] + b[4], a[5] + b[5], a[6] + b[6]];
}

/** Divide two units (subtract exponents). */
export function unitDivide(a: SIUnit, b: SIUnit): SIUnit {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2], a[3] - b[3], a[4] - b[4], a[5] - b[5], a[6] - b[6]];
}

/** Raise a unit to a power (multiply all exponents). */
export function unitPower(u: SIUnit, p: number): SIUnit {
  return [u[0] * p, u[1] * p, u[2] * p, u[3] * p, u[4] * p, u[5] * p, u[6] * p];
}

/** Negate a unit (for reciprocal). */
export function unitReciprocal(u: SIUnit): SIUnit {
  return unitPower(u, -1);
}

/** Check if two units are compatible (same exponents). */
export function unitsCompatible(a: SIUnit, b: SIUnit): boolean {
  return (
    a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3] && a[4] === b[4] && a[5] === b[5] && a[6] === b[6]
  );
}

/** Check if a unit is dimensionless. */
export function isDimensionless(u: SIUnit): boolean {
  return unitsCompatible(u, DIMENSIONLESS);
}

// ── Unit parsing ──

/**
 * Parse a Modelica unit string into an SIUnit.
 *
 * Handles formats like:
 *   "V", "m/s", "kg.m/s2", "m2", "J/(kg.K)"
 *
 * @returns The parsed SI unit, or null if unparseable.
 */
export function parseUnit(unitStr: string): SIUnit | null {
  if (!unitStr || unitStr === "1") return [...DIMENSIONLESS];

  // Direct lookup
  const direct = SI_UNITS[unitStr];
  if (direct) return [...direct];

  // Try parsing compound units: numerator/denominator
  const slashIdx = unitStr.indexOf("/");
  if (slashIdx > 0) {
    const num = unitStr.substring(0, slashIdx);
    let den = unitStr.substring(slashIdx + 1);

    // Remove wrapping parentheses from denominator
    if (den.startsWith("(") && den.endsWith(")")) {
      den = den.substring(1, den.length - 1);
    }

    const numUnit = parseUnitProduct(num);
    const denUnit = parseUnitProduct(den);
    if (numUnit && denUnit) {
      return unitDivide(numUnit, denUnit);
    }
  }

  // Try parsing as a product (a.b.c or a·b·c)
  return parseUnitProduct(unitStr);
}

/**
 * Parse a unit product (e.g., "kg.m" or "m2").
 */
function parseUnitProduct(s: string): SIUnit | null {
  if (!s) return [...DIMENSIONLESS];

  const parts = s.split(".");
  let result: SIUnit = [...DIMENSIONLESS];

  for (const part of parts) {
    const parsed = parseUnitAtom(part.trim());
    if (!parsed) return null;
    result = unitMultiply(result, parsed);
  }

  return result;
}

/**
 * Parse a unit atom: base unit with optional exponent (e.g., "m2", "s", "kg").
 */
function parseUnitAtom(s: string): SIUnit | null {
  if (!s) return [...DIMENSIONLESS];

  // Check for exponent suffix (e.g., "m2", "s3", "m-1")
  const match = s.match(/^([a-zA-Z]+)(-?\d+)?$/);
  if (!match) return null;

  const baseName = match[1] ?? "";
  const exponent = match[2] ? parseInt(match[2], 10) : 1;

  const baseUnit = SI_UNITS[baseName];
  if (!baseUnit) return null;

  return unitPower([...baseUnit], exponent);
}

// ── Unit formatting ──

/**
 * Format an SIUnit back into a human-readable unit string.
 */
export function formatSIUnit(u: SIUnit): string {
  if (isDimensionless(u)) return "1";

  const parts: string[] = [];
  for (let i = 0; i < 7; i++) {
    const exp = u[i] ?? 0;
    if (exp !== 0) {
      const dim = SI_DIMENSIONS[i] ?? "";
      parts.push(exp === 1 ? dim : `${dim}${exp}`);
    }
  }

  return parts.join("·") || "1";
}

// ── Unit checking for equations ──

/** Result of a unit check on an equation. */
export interface UnitCheckResult {
  /** Whether the equation is unit-consistent. */
  consistent: boolean;
  /** Unit of the left-hand side. */
  lhsUnit: SIUnit | null;
  /** Unit of the right-hand side. */
  rhsUnit: SIUnit | null;
  /** Human-readable message if inconsistent. */
  message?: string;
}

/**
 * Check unit consistency between two sides of an equation.
 */
export function checkEquationUnits(lhsUnit: SIUnit | null, rhsUnit: SIUnit | null): UnitCheckResult {
  if (lhsUnit === null || rhsUnit === null) {
    // Cannot determine — assume consistent
    return { consistent: true, lhsUnit, rhsUnit };
  }

  if (unitsCompatible(lhsUnit, rhsUnit)) {
    return { consistent: true, lhsUnit, rhsUnit };
  }

  return {
    consistent: false,
    lhsUnit,
    rhsUnit,
    message: `Unit mismatch: LHS has unit [${formatSIUnit(lhsUnit)}] but RHS has unit [${formatSIUnit(rhsUnit)}]`,
  };
}
