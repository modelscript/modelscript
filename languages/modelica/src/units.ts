// SPDX-License-Identifier: AGPL-3.0-or-later
/* eslint-disable @typescript-eslint/no-inferrable-types */

/**
 * SI unit checking for Modelica variables and expressions.
 *
 * Represents units as 7-dimensional exponent class for SI base dimensions:
 *   (m, kg, s, A, K, mol, cd)
 *
 * Provides unit arithmetic (multiplication adds exponents, division subtracts),
 * unit parsing from Modelica unit strings, and mismatch detection.
 *
 * Reference: Modelica §6.6, International System of Units (SI)
 */

// ── SI unit representation ──

/** An SI unit represented as exponents of the 7 base dimensions. */
export class SIUnit {
  m: number;
  kg: number;
  s: number;
  A: number;
  K: number;
  mol: number;
  cd: number;

  constructor(
    m: number = 0,
    kg: number = 0,
    s: number = 0,
    A: number = 0,
    K: number = 0,
    mol: number = 0,
    cd: number = 0,
  ) {
    this.m = m;
    this.kg = kg;
    this.s = s;
    this.A = A;
    this.K = K;
    this.mol = mol;
    this.cd = cd;
  }
}

/** The dimensionless unit (e.g., for pure numbers, angles in radians). */
export function createDimensionless(): SIUnit {
  return new SIUnit(0, 0, 0, 0, 0, 0, 0);
}

export const DIMENSIONLESS: SIUnit = new SIUnit(0, 0, 0, 0, 0, 0, 0);

// ── Common SI derived units ──

/** Pre-defined SI units for common Modelica types. */
export const SI_UNITS: Record<string, SIUnit> = {
  // Base units
  m: new SIUnit(1, 0, 0, 0, 0, 0, 0),
  kg: new SIUnit(0, 1, 0, 0, 0, 0, 0),
  s: new SIUnit(0, 0, 1, 0, 0, 0, 0),
  A: new SIUnit(0, 0, 0, 1, 0, 0, 0),
  K: new SIUnit(0, 0, 0, 0, 1, 0, 0),
  mol: new SIUnit(0, 0, 0, 0, 0, 1, 0),
  cd: new SIUnit(0, 0, 0, 0, 0, 0, 1),

  // Derived units
  Hz: new SIUnit(0, 0, -1, 0, 0, 0, 0), // 1/s
  N: new SIUnit(1, 1, -2, 0, 0, 0, 0), // kg·m/s²
  Pa: new SIUnit(-1, 1, -2, 0, 0, 0, 0), // N/m² = kg/(m·s²)
  J: new SIUnit(2, 1, -2, 0, 0, 0, 0), // N·m = kg·m²/s²
  W: new SIUnit(2, 1, -3, 0, 0, 0, 0), // J/s = kg·m²/s³
  C: new SIUnit(0, 0, 1, 1, 0, 0, 0), // A·s
  V: new SIUnit(2, 1, -3, -1, 0, 0, 0), // W/A = kg·m²/(s³·A)
  F: new SIUnit(-2, -1, 4, 2, 0, 0, 0), // C/V = s⁴·A²/(kg·m²)
  Ohm: new SIUnit(2, 1, -3, -2, 0, 0, 0), // V/A = kg·m²/(s³·A²)
  S: new SIUnit(-2, -1, 3, 2, 0, 0, 0), // 1/Ohm = s³·A²/(kg·m²)
  Wb: new SIUnit(2, 1, -2, -1, 0, 0, 0), // V·s = kg·m²/(s²·A)
  T: new SIUnit(0, 1, -2, -1, 0, 0, 0), // Wb/m² = kg/(s²·A)
  H: new SIUnit(2, 1, -2, -2, 0, 0, 0), // Wb/A = kg·m²/(s²·A²)
  lm: new SIUnit(0, 0, 0, 0, 0, 0, 1), // cd·sr (sr = 1)
  lx: new SIUnit(-2, 0, 0, 0, 0, 0, 1), // lm/m²

  // Common compound units
  "m/s": new SIUnit(1, 0, -1, 0, 0, 0, 0), // velocity
  "m/s2": new SIUnit(1, 0, -2, 0, 0, 0, 0), // acceleration
  "kg/m3": new SIUnit(-3, 1, 0, 0, 0, 0, 0), // density
  "J/(kg.K)": new SIUnit(2, 0, -2, 0, -1, 0, 0), // specific heat capacity
  "W/(m.K)": new SIUnit(1, 1, -3, 0, -1, 0, 0), // thermal conductivity
  "W/(m2.K)": new SIUnit(0, 1, -3, 0, -1, 0, 0), // heat transfer coefficient
  rad: new SIUnit(0, 0, 0, 0, 0, 0, 0), // radian (dimensionless)
  "rad/s": new SIUnit(0, 0, -1, 0, 0, 0, 0), // angular velocity
  "1": new SIUnit(0, 0, 0, 0, 0, 0, 0), // dimensionless
};

// ── Unit arithmetic ──

/** Multiply two units (add exponents). */
export function unitMultiply(a: SIUnit, b: SIUnit): SIUnit {
  return new SIUnit(a.m + b.m, a.kg + b.kg, a.s + b.s, a.A + b.A, a.K + b.K, a.mol + b.mol, a.cd + b.cd);
}

/** Divide two units (subtract exponents). */
export function unitDivide(a: SIUnit, b: SIUnit): SIUnit {
  return new SIUnit(a.m - b.m, a.kg - b.kg, a.s - b.s, a.A - b.A, a.K - b.K, a.mol - b.mol, a.cd - b.cd);
}

/** Raise a unit to a power (multiply all exponents). */
export function unitPower(u: SIUnit, p: number): SIUnit {
  return new SIUnit(u.m * p, u.kg * p, u.s * p, u.A * p, u.K * p, u.mol * p, u.cd * p);
}

/** Negate a unit (for reciprocal). */
export function unitReciprocal(u: SIUnit): SIUnit {
  return unitPower(u, -1);
}

/** Check if two units are compatible (same exponents). */
export function unitsCompatible(a: SIUnit, b: SIUnit): boolean {
  return a.m === b.m && a.kg === b.kg && a.s === b.s && a.A === b.A && a.K === b.K && a.mol === b.mol && a.cd === b.cd;
}

/** Check if a unit is dimensionless. */
export function isDimensionless(u: SIUnit): boolean {
  return u.m === 0 && u.kg === 0 && u.s === 0 && u.A === 0 && u.K === 0 && u.mol === 0 && u.cd === 0;
}

// ── Unit parsing ──

/**
 * Parse a Modelica unit string into an SIUnit.
 */
export function parseUnit(unitStr: string): SIUnit | null {
  if (!unitStr || unitStr === "1" || unitStr === "") return createDimensionless();

  // Base units
  if (unitStr === "m") return new SIUnit(1, 0, 0, 0, 0, 0, 0);
  if (unitStr === "kg") return new SIUnit(0, 1, 0, 0, 0, 0, 0);
  if (unitStr === "s") return new SIUnit(0, 0, 1, 0, 0, 0, 0);
  if (unitStr === "A") return new SIUnit(0, 0, 0, 1, 0, 0, 0);
  if (unitStr === "K") return new SIUnit(0, 0, 0, 0, 1, 0, 0);
  if (unitStr === "mol") return new SIUnit(0, 0, 0, 0, 0, 1, 0);
  if (unitStr === "cd") return new SIUnit(0, 0, 0, 0, 0, 0, 1);

  // Derived units
  if (unitStr === "Hz") return new SIUnit(0, 0, -1, 0, 0, 0, 0);
  if (unitStr === "N") return new SIUnit(1, 1, -2, 0, 0, 0, 0);
  if (unitStr === "Pa") return new SIUnit(-1, 1, -2, 0, 0, 0, 0);
  if (unitStr === "J") return new SIUnit(2, 1, -2, 0, 0, 0, 0);
  if (unitStr === "W") return new SIUnit(2, 1, -3, 0, 0, 0, 0);
  if (unitStr === "C") return new SIUnit(0, 0, 1, 1, 0, 0, 0);
  if (unitStr === "V") return new SIUnit(2, 1, -3, -1, 0, 0, 0);
  if (unitStr === "F") return new SIUnit(-2, -1, 4, 2, 0, 0, 0);
  if (unitStr === "Ohm") return new SIUnit(2, 1, -3, -2, 0, 0, 0);
  if (unitStr === "S") return new SIUnit(-2, -1, 3, 2, 0, 0, 0);
  if (unitStr === "Wb") return new SIUnit(2, 1, -2, -1, 0, 0, 0);
  if (unitStr === "T") return new SIUnit(0, 1, -2, -1, 0, 0, 0);
  if (unitStr === "H") return new SIUnit(2, 1, -2, -2, 0, 0, 0);
  if (unitStr === "rad") return new SIUnit(0, 0, 0, 0, 0, 0, 0);
  if (unitStr === "rad/s") return new SIUnit(0, 0, -1, 0, 0, 0, 0);
  if (unitStr === "m/s") return new SIUnit(1, 0, -1, 0, 0, 0, 0);
  if (unitStr === "m/s2" || unitStr === "m/s^2") return new SIUnit(1, 0, -2, 0, 0, 0, 0);
  if (unitStr === "m2" || unitStr === "m^2") return new SIUnit(2, 0, 0, 0, 0, 0, 0);
  if (unitStr === "m3" || unitStr === "m^3") return new SIUnit(3, 0, 0, 0, 0, 0, 0);
  if (unitStr === "kg/m3") return new SIUnit(-3, 1, 0, 0, 0, 0, 0);
  if (unitStr === "J/(kg.K)" || unitStr === "J/(kg·K)") return new SIUnit(2, 0, -2, 0, -1, 0, 0);
  if (unitStr === "W/(m.K)" || unitStr === "W/(m·K)") return new SIUnit(1, 1, -3, 0, -1, 0, 0);
  if (unitStr === "W/(m2.K)" || unitStr === "W/(m2·K)") return new SIUnit(0, 1, -3, 0, -1, 0, 0);

  // Exponent on base unit (e.g. s2, s-1)
  if (unitStr.startsWith("m") && unitStr.length === 2 && unitStr.charCodeAt(1) >= 48 && unitStr.charCodeAt(1) <= 57) {
    return new SIUnit(unitStr.charCodeAt(1) - 48, 0, 0, 0, 0, 0, 0);
  }
  if (unitStr.startsWith("s") && unitStr.length === 2 && unitStr.charCodeAt(1) >= 48 && unitStr.charCodeAt(1) <= 57) {
    return new SIUnit(0, 0, unitStr.charCodeAt(1) - 48, 0, 0, 0, 0);
  }

  // Fraction unit: num/den
  const slashIdx = unitStr.indexOf("/");
  if (slashIdx > 0) {
    const numStr = unitStr.substring(0, slashIdx);
    let denStr = unitStr.substring(slashIdx + 1);
    if (denStr.startsWith("(") && denStr.endsWith(")")) {
      denStr = denStr.substring(1, denStr.length - 1);
    }
    const num = parseUnit(numStr);
    const den = parseUnit(denStr);
    if (num != null && den != null) {
      return unitDivide(num, den);
    }
  }

  // Dot product unit: a.b
  const dotIdx = unitStr.indexOf(".");
  if (dotIdx > 0) {
    const p1 = parseUnit(unitStr.substring(0, dotIdx));
    const p2 = parseUnit(unitStr.substring(dotIdx + 1));
    if (p1 != null && p2 != null) {
      return unitMultiply(p1, p2);
    }
  }

  return null;
}

// ── Unit formatting ──

/**
 * Format an SIUnit back into a human-readable unit string.
 */
export function formatSIUnit(u: SIUnit): string {
  if (isDimensionless(u)) return "1";

  const parts: string[] = [];
  if (u.m !== 0) parts.push(u.m === 1 ? "m" : `m${u.m}`);
  if (u.kg !== 0) parts.push(u.kg === 1 ? "kg" : `kg${u.kg}`);
  if (u.s !== 0) parts.push(u.s === 1 ? "s" : `s${u.s}`);
  if (u.A !== 0) parts.push(u.A === 1 ? "A" : `A${u.A}`);
  if (u.K !== 0) parts.push(u.K === 1 ? "K" : `K${u.K}`);
  if (u.mol !== 0) parts.push(u.mol === 1 ? "mol" : `mol${u.mol}`);
  if (u.cd !== 0) parts.push(u.cd === 1 ? "cd" : `cd${u.cd}`);

  return parts.join("·") || "1";
}

// ── Unit checking for equations ──

/** Result of a unit check on an equation. */
export class UnitCheckResult {
  consistent: boolean = true;
  lhsUnit: SIUnit | null = null;
  rhsUnit: SIUnit | null = null;
  message: string = "";

  constructor(
    consistent: boolean = true,
    lhsUnit: SIUnit | null = null,
    rhsUnit: SIUnit | null = null,
    message: string = "",
  ) {
    this.consistent = consistent;
    this.lhsUnit = lhsUnit;
    this.rhsUnit = rhsUnit;
    this.message = message;
  }
}

/**
 * Check unit consistency between two sides of an equation.
 */
export function checkEquationUnits(lhsUnit: SIUnit | null, rhsUnit: SIUnit | null): UnitCheckResult {
  if (lhsUnit === null || rhsUnit === null) {
    return new UnitCheckResult(true, lhsUnit, rhsUnit);
  }

  if (unitsCompatible(lhsUnit, rhsUnit)) {
    return new UnitCheckResult(true, lhsUnit, rhsUnit);
  }

  return new UnitCheckResult(
    false,
    lhsUnit,
    rhsUnit,
    `Unit mismatch: LHS has unit [${formatSIUnit(lhsUnit)}] but RHS has unit [${formatSIUnit(rhsUnit)}]`,
  );
}
