// SPDX-License-Identifier: AGPL-3.0-or-later

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

function parseBaseAtomicSymbol(sym: string): SIUnit | null {
  if (sym === "1" || sym === "%" || sym === "ppm" || sym === "rad" || sym === "sr" || sym === "deg" || sym === "rev") {
    return createDimensionless();
  }
  if (sym === "m") return new SIUnit(1, 0, 0, 0, 0, 0, 0);
  if (sym === "g" || sym === "kg") return new SIUnit(0, 1, 0, 0, 0, 0, 0);
  if (sym === "s" || sym === "min" || sym === "h" || sym === "d") return new SIUnit(0, 0, 1, 0, 0, 0, 0);
  if (sym === "A") return new SIUnit(0, 0, 0, 1, 0, 0, 0);
  if (sym === "K" || sym === "degC") return new SIUnit(0, 0, 0, 0, 1, 0, 0);
  if (sym === "mol") return new SIUnit(0, 0, 0, 0, 0, 1, 0);
  if (sym === "cd" || sym === "lm") return new SIUnit(0, 0, 0, 0, 0, 0, 1);
  if (sym === "Hz" || sym === "Bq") return new SIUnit(0, 0, -1, 0, 0, 0, 0);
  if (sym === "N") return new SIUnit(1, 1, -2, 0, 0, 0, 0);
  if (sym === "Pa" || sym === "bar") return new SIUnit(-1, 1, -2, 0, 0, 0, 0);
  if (sym === "J" || sym === "Wh" || sym === "eV") return new SIUnit(2, 1, -2, 0, 0, 0, 0);
  if (sym === "W" || sym === "VA" || sym === "var") return new SIUnit(2, 1, -3, 0, 0, 0, 0);
  if (sym === "C" || sym === "Ah") return new SIUnit(0, 0, 1, 1, 0, 0, 0);
  if (sym === "V") return new SIUnit(2, 1, -3, -1, 0, 0, 0);
  if (sym === "F") return new SIUnit(-2, -1, 4, 2, 0, 0, 0);
  if (sym === "Ohm") return new SIUnit(2, 1, -3, -2, 0, 0, 0);
  if (sym === "S") return new SIUnit(-2, -1, 3, 2, 0, 0, 0);
  if (sym === "Wb") return new SIUnit(2, 1, -2, -1, 0, 0, 0);
  if (sym === "T") return new SIUnit(0, 1, -2, -1, 0, 0, 0);
  if (sym === "H") return new SIUnit(2, 1, -2, -2, 0, 0, 0);
  if (sym === "lx") return new SIUnit(-2, 0, 0, 0, 0, 0, 1);
  if (sym === "Gy" || sym === "Sv") return new SIUnit(2, 0, -2, 0, 0, 0, 0);
  if (sym === "kat") return new SIUnit(0, 0, -1, 0, 0, 1, 0);
  if (sym === "l" || sym === "L") return new SIUnit(3, 0, 0, 0, 0, 0, 0);
  return null;
}

function parseAtomicUnitSymbol(sym: string): SIUnit | null {
  const direct = parseBaseAtomicSymbol(sym);
  if (direct != null) return direct;
  if (sym.length > 2 && sym.startsWith("da")) {
    return parseBaseAtomicSymbol(sym.substring(2));
  }
  if (sym.length > 1) {
    const p = sym.charAt(0);
    if (
      p === "Y" ||
      p === "Z" ||
      p === "E" ||
      p === "P" ||
      p === "T" ||
      p === "G" ||
      p === "M" ||
      p === "k" ||
      p === "h" ||
      p === "d" ||
      p === "c" ||
      p === "m" ||
      p === "u" ||
      p === "µ" ||
      p === "n" ||
      p === "p" ||
      p === "f" ||
      p === "a" ||
      p === "z" ||
      p === "y"
    ) {
      return parseBaseAtomicSymbol(sym.substring(1));
    }
  }
  return null;
}

function parseSignedExponent(expStr: string): number {
  let s = expStr;
  if (s.startsWith("^")) s = s.substring(1);
  if (s.length === 0) return 999999;
  let sign = 1;
  let idx = 0;
  if (s.charAt(0) === "-") {
    sign = -1;
    idx = 1;
  } else if (s.charAt(0) === "+") {
    idx = 1;
  }
  if (idx >= s.length) return 999999;
  let val = 0;
  while (idx < s.length) {
    const code = s.charCodeAt(idx);
    if (code < 48 || code > 57) return 999999;
    val = val * 10 + (code - 48);
    idx++;
  }
  return sign * val;
}

/**
 * Parse a Modelica unit string (Modelica 3.6 §18.8.3.1) into an SIUnit.
 */
export function parseUnit(unitStr: string): SIUnit | null {
  if (!unitStr) return createDimensionless();
  const trimmed = unitStr.trim();
  if (trimmed === "" || trimmed === "1" || trimmed === "%" || trimmed === "ppm") return createDimensionless();

  // Strip balanced outer parentheses
  if (trimmed.startsWith("(") && trimmed.endsWith(")")) {
    let depth = 0;
    let balanced = true;
    for (let i = 0; i < trimmed.length - 1; i++) {
      const ch = trimmed.charAt(i);
      if (ch === "(") depth++;
      else if (ch === ")") depth--;
      if (depth === 0) {
        balanced = false;
        break;
      }
    }
    if (balanced) {
      const inner = parseUnit(trimmed.substring(1, trimmed.length - 1));
      if (inner != null) return inner;
    }
  }

  // Split top-level '/' left-to-right: a / b / c = (a / b) / c
  let depth = 0;
  let lastSlash = -1;
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed.charAt(i);
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (depth === 0 && ch === "/") lastSlash = i;
  }
  if (lastSlash > 0) {
    const num = parseUnit(trimmed.substring(0, lastSlash));
    const den = parseUnit(trimmed.substring(lastSlash + 1));
    if (num != null && den != null) return unitDivide(num, den);
    return null;
  }

  // Split top-level product operators ('.', '·', '*', whitespace)
  depth = 0;
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed.charAt(i);
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (depth === 0 && (ch === "." || ch === "·" || ch === "*" || ch === " ")) {
      const left = trimmed.substring(0, i).trim();
      const right = trimmed.substring(i + 1).trim();
      if (left.length > 0 && right.length > 0) {
        const p1 = parseUnit(left);
        const p2 = parseUnit(right);
        if (p1 != null && p2 != null) return unitMultiply(p1, p2);
      }
    }
  }

  // Parenthesized base with trailing exponent: (kg.m)^2 or (m.s)-1
  if (trimmed.startsWith("(")) {
    const closeIdx = trimmed.lastIndexOf(")");
    if (closeIdx > 0 && closeIdx < trimmed.length - 1) {
      const basePart = trimmed.substring(1, closeIdx);
      const expVal = parseSignedExponent(trimmed.substring(closeIdx + 1));
      if (expVal !== 999999) {
        const baseUnit = parseUnit(basePart);
        if (baseUnit != null) return unitPower(baseUnit, expVal);
      }
    }
  }

  // Atomic symbol with optional exponent (e.g. m2, s-1, s-2, m^3, s^-2, kW, MPa)
  let splitIdx = trimmed.length;
  for (let i = 0; i < trimmed.length; i++) {
    const code = trimmed.charCodeAt(i);
    if (code === 94 || code === 43 || code === 45 || (code >= 48 && code <= 57)) {
      splitIdx = i;
      break;
    }
  }
  if (splitIdx > 0) {
    const sym = trimmed.substring(0, splitIdx);
    const baseUnit = parseAtomicUnitSymbol(sym);
    if (baseUnit != null) {
      if (splitIdx === trimmed.length) return baseUnit;
      const expVal = parseSignedExponent(trimmed.substring(splitIdx));
      if (expVal !== 999999) {
        return expVal === 1 ? baseUnit : unitPower(baseUnit, expVal);
      }
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
