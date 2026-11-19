// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Physical dimensions calculus and QUDV static typing for SysML v2 / KerML.
 * Adheres to the 7 SI base quantities:
 * [L: Length, M: Mass, T: Time, I: Current, Theta: Temperature, N: Amount, J: Intensity]
 */

import type { QueryDB, SymbolEntry } from "@modelscript/runtime";
import {
  collectCstLeaves,
  isSysmlIdentLeaf,
  parseSignedNumberFromLeaves,
  parseSysmlSource,
  readDottedChainFromLeaves,
  stripLeadingChars,
  stripSurroundingQuotes,
} from "./cst-utils.js";
import { findCstDescendants, findFirstDescendant, type SysmlCstNode } from "./flattener/cst-lowerer.js";

export type DimensionVector = readonly [
  L: number, // Length [m]
  M: number, // Mass [kg]
  T: number, // Time [s]
  I: number, // Electric Current [A]
  Theta: number, // Thermodynamic Temperature [K]
  N: number, // Amount of Substance [mol]
  J: number, // Luminous Intensity [cd]
];

export const DIMENSIONLESS: DimensionVector = [0, 0, 0, 0, 0, 0, 0] as const;

// --- SI Base Quantities ---
export const LENGTH: DimensionVector = [1, 0, 0, 0, 0, 0, 0] as const;
export const MASS: DimensionVector = [0, 1, 0, 0, 0, 0, 0] as const;
export const TIME: DimensionVector = [0, 0, 1, 0, 0, 0, 0] as const;
export const CURRENT: DimensionVector = [0, 0, 0, 1, 0, 0, 0] as const;
export const TEMPERATURE: DimensionVector = [0, 0, 0, 0, 1, 0, 0] as const;
export const AMOUNT: DimensionVector = [0, 0, 0, 0, 0, 1, 0] as const;
export const LUMINOUS_INTENSITY: DimensionVector = [0, 0, 0, 0, 0, 0, 1] as const;

// --- SI Derived Quantities ---
export const AREA: DimensionVector = [2, 0, 0, 0, 0, 0, 0] as const;
export const VOLUME: DimensionVector = [3, 0, 0, 0, 0, 0, 0] as const;
export const VELOCITY: DimensionVector = [1, 0, -1, 0, 0, 0, 0] as const;
export const ACCELERATION: DimensionVector = [1, 0, -2, 0, 0, 0, 0] as const;
export const FORCE: DimensionVector = [1, 1, -2, 0, 0, 0, 0] as const;
export const PRESSURE: DimensionVector = [-1, 1, -2, 0, 0, 0, 0] as const;
export const ENERGY: DimensionVector = [2, 1, -2, 0, 0, 0, 0] as const;
export const POWER: DimensionVector = [2, 1, -3, 0, 0, 0, 0] as const;
export const VOLTAGE: DimensionVector = [2, 1, -3, -1, 0, 0, 0] as const;
export const ELECTRIC_RESISTANCE: DimensionVector = [2, 1, -3, -2, 0, 0, 0] as const;
export const FREQUENCY: DimensionVector = [0, 0, -1, 0, 0, 0, 0] as const;
export const ELECTRIC_CHARGE: DimensionVector = [0, 0, 1, 1, 0, 0, 0] as const;
export const CAPACITANCE: DimensionVector = [-2, -1, 4, 2, 0, 0, 0] as const;
export const ELECTRIC_CONDUCTANCE: DimensionVector = [-2, -1, 3, 2, 0, 0, 0] as const;
export const MAGNETIC_FLUX: DimensionVector = [2, 1, -2, -1, 0, 0, 0] as const;
export const MAGNETIC_FLUX_DENSITY: DimensionVector = [0, 1, -2, -1, 0, 0, 0] as const;
export const INDUCTANCE: DimensionVector = [2, 1, -2, -2, 0, 0, 0] as const;
export const ILLUMINANCE: DimensionVector = [-2, 0, 0, 0, 0, 0, 1] as const;
export const ABSORBED_DOSE: DimensionVector = [2, 0, -2, 0, 0, 0, 0] as const;
export const CATALYTIC_ACTIVITY: DimensionVector = [0, 0, -1, 0, 0, 1, 0] as const;

/** Canonical mapping from KerML standard library quantity and unit names to dimensions. */
export const KNOWN_DIMENSIONS: Record<string, DimensionVector> = {
  // ScalarValues
  Real: DIMENSIONLESS,
  Integer: DIMENSIONLESS,
  Natural: DIMENSIONLESS,
  Positive: DIMENSIONLESS,
  Boolean: DIMENSIONLESS,
  String: DIMENSIONLESS,

  // ISQ Base
  Length: LENGTH,
  Mass: MASS,
  Time: TIME,
  Duration: TIME,
  ElectricCurrent: CURRENT,
  ThermodynamicTemperature: TEMPERATURE,
  Temperature: TEMPERATURE,
  AmountOfSubstance: AMOUNT,
  LuminousIntensity: LUMINOUS_INTENSITY,

  // ISQ Derived
  Area: AREA,
  Volume: VOLUME,
  Velocity: VELOCITY,
  Speed: VELOCITY,
  Acceleration: ACCELERATION,
  Force: FORCE,
  Pressure: PRESSURE,
  Energy: ENERGY,
  Power: POWER,
  Voltage: VOLTAGE,
  ElectricPotential: VOLTAGE,
  ElectricPotentialDifference: VOLTAGE,
  ElectricResistance: ELECTRIC_RESISTANCE,
  Resistance: ELECTRIC_RESISTANCE,
  Frequency: FREQUENCY,
  ElectricCharge: ELECTRIC_CHARGE,
  Capacitance: CAPACITANCE,
  ElectricConductance: ELECTRIC_CONDUCTANCE,
  Conductance: ELECTRIC_CONDUCTANCE,
  MagneticFlux: MAGNETIC_FLUX,
  MagneticFluxDensity: MAGNETIC_FLUX_DENSITY,
  Inductance: INDUCTANCE,
  LuminousFlux: LUMINOUS_INTENSITY,
  Illuminance: ILLUMINANCE,
  AbsorbedDose: ABSORBED_DOSE,
  DoseEquivalent: ABSORBED_DOSE,
  CatalyticActivity: CATALYTIC_ACTIVITY,

  // SIBaseUnits & SIDerivedUnits full names
  Metre: LENGTH,
  Meter: LENGTH,
  Kilogram: MASS,
  Second: TIME,
  Ampere: CURRENT,
  Kelvin: TEMPERATURE,
  Mole: AMOUNT,
  Candela: LUMINOUS_INTENSITY,

  Newton: FORCE,
  Pascal: PRESSURE,
  Joule: ENERGY,
  Watt: POWER,
  Volt: VOLTAGE,
  Ohm: ELECTRIC_RESISTANCE,
  Hertz: FREQUENCY,
  Coulomb: ELECTRIC_CHARGE,
  Farad: CAPACITANCE,
  Siemens: ELECTRIC_CONDUCTANCE,
  Weber: MAGNETIC_FLUX,
  Tesla: MAGNETIC_FLUX_DENSITY,
  Henry: INDUCTANCE,
  Lumen: LUMINOUS_INTENSITY,
  Lux: ILLUMINANCE,
  Becquerel: FREQUENCY,
  Gray: ABSORBED_DOSE,
  Sievert: ABSORBED_DOSE,
  Katal: CATALYTIC_ACTIVITY,

  // SIBaseUnits symbols
  m: LENGTH,
  kg: MASS,
  s: TIME,
  A: CURRENT,
  K: TEMPERATURE,
  mol: AMOUNT,
  cd: LUMINOUS_INTENSITY,
  g: MASS,

  // SIDerivedUnits symbols
  N: FORCE,
  Pa: PRESSURE,
  J: ENERGY,
  W: POWER,
  V: VOLTAGE,
  Ω: ELECTRIC_RESISTANCE,
  Hz: FREQUENCY,
  C: ELECTRIC_CHARGE,
  F: CAPACITANCE,
  S: ELECTRIC_CONDUCTANCE,
  Wb: MAGNETIC_FLUX,
  T: MAGNETIC_FLUX_DENSITY,
  H: INDUCTANCE,
  lm: LUMINOUS_INTENSITY,
  lx: ILLUMINANCE,
  Bq: FREQUENCY,
  Gy: ABSORBED_DOSE,
  Sv: ABSORBED_DOSE,
  kat: CATALYTIC_ACTIVITY,

  // Common unit powers, SI prefixed units, and US customary units
  "m²": AREA,
  m2: AREA,
  "m³": VOLUME,
  m3: VOLUME,
  km: LENGTH,
  cm: LENGTH,
  mm: LENGTH,
  um: LENGTH,
  nm: LENGTH,
  ft: LENGTH,
  in: LENGTH,
  mg: MASS,
  t: MASS,
  lb: MASS,
  ms: TIME,
  us: TIME,
  ns: TIME,
  min: TIME,
  h: TIME,
  mA: CURRENT,
  kA: CURRENT,
  mV: VOLTAGE,
  kV: VOLTAGE,
  mW: POWER,
  kW: POWER,
  MW: POWER,
  GW: POWER,
  kJ: ENERGY,
  MJ: ENERGY,
  kN: FORCE,
  MN: FORCE,
  lbf: FORCE,
  kPa: PRESSURE,
  MPa: PRESSURE,
  GPa: PRESSURE,
  bar: PRESSURE,
  psi: PRESSURE,
  kHz: FREQUENCY,
  MHz: FREQUENCY,
  GHz: FREQUENCY,
};

/**
 * Short SI / customary unit symbols that often collide with single-letter or short user type/port/state names.
 * Treated as unit dimensions inside `[...]` unit brackets OR when explicitly qualified by a unit package (`SI::*`, etc.).
 */
const SHORT_UNIT_SYMBOLS = new Set<string>([
  "A",
  "K",
  "N",
  "V",
  "W",
  "J",
  "m",
  "s",
  "g",
  "t",
  "h",
  "min",
  "bar",
  "Pa",
  "Hz",
  "C",
  "F",
  "S",
  "T",
  "H",
  "Wb",
  "lm",
  "lx",
  "Bq",
  "Gy",
  "Sv",
  "kat",
  "kg",
  "mol",
  "cd",
  "Ω",
  "m²",
  "m2",
  "m³",
  "m3",
  "km",
  "cm",
  "mm",
  "um",
  "nm",
  "ft",
  "in",
  "mg",
  "lb",
  "ms",
  "us",
  "ns",
  "mA",
  "kA",
  "mV",
  "kV",
  "mW",
  "kW",
  "MW",
  "GW",
  "kJ",
  "MJ",
  "kN",
  "MN",
  "lbf",
  "kPa",
  "MPa",
  "GPa",
  "psi",
  "kHz",
  "MHz",
  "GHz",
]);

const UNIT_PACKAGE_NAMES = new Set<string>(["SI", "SIBaseUnits", "SIDerivedUnits", "USCustomaryUnits"]);

function isEntryInUnitPackage(db: QueryDB, entry: SymbolEntry): boolean {
  let pid = entry.parentId;
  let guard = 0;
  while (pid !== null && guard++ < 32) {
    const anc = db.symbol(pid);
    if (!anc) break;
    if (anc.name && UNIT_PACKAGE_NAMES.has(anc.name)) return true;
    pid = anc.parentId;
  }
  return false;
}

function isStdlibShortUnitEntry(db: QueryDB, entry: SymbolEntry): boolean {
  if (!SHORT_UNIT_SYMBOLS.has(entry.name)) return false;
  if (entry.resourceId?.startsWith("sysml2://stdlib/")) return true;
  return isEntryInUnitPackage(db, entry);
}

function lookupDirectTypeDimension(rawName: string, allowShortUnitSymbols: boolean): DimensionVector | null {
  if (!rawName) return null;
  if (rawName === "Duration" || rawName === "DurationValue") return TIME;
  if (!allowShortUnitSymbols && SHORT_UNIT_SYMBOLS.has(rawName)) {
    return null;
  }
  if (KNOWN_DIMENSIONS[rawName]) {
    return KNOWN_DIMENSIONS[rawName]!;
  }
  if (rawName.endsWith("Value")) {
    const stem = rawName.slice(0, -5);
    if (stem && (allowShortUnitSymbols || !SHORT_UNIT_SYMBOLS.has(stem)) && KNOWN_DIMENSIONS[stem]) {
      return KNOWN_DIMENSIONS[stem]!;
    }
  }
  return null;
}

/** Checks whether two dimension vectors have identical exponents. */
export function areDimensionsEqual(a: DimensionVector, b: DimensionVector): boolean {
  return (
    a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3] && a[4] === b[4] && a[5] === b[5] && a[6] === b[6]
  );
}

/** Checks whether a dimension vector is dimensionless [0,0,0,0,0,0,0]. */
export function isDimensionless(dim: DimensionVector): boolean {
  return areDimensionsEqual(dim, DIMENSIONLESS);
}

/** Adds exponents (multiplication of physical quantities). */
export function addDimensions(a: DimensionVector, b: DimensionVector): DimensionVector {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2], a[3] + b[3], a[4] + b[4], a[5] + b[5], a[6] + b[6]];
}

/** Subtracts exponents (division of physical quantities). */
export function subtractDimensions(a: DimensionVector, b: DimensionVector): DimensionVector {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2], a[3] - b[3], a[4] - b[4], a[5] - b[5], a[6] - b[6]];
}

/** Multiplies exponents by a scalar factor (exponentiation of physical quantities). */
export function multiplyDimension(dim: DimensionVector, factor: number): DimensionVector {
  return [
    dim[0] * factor || 0,
    dim[1] * factor || 0,
    dim[2] * factor || 0,
    dim[3] * factor || 0,
    dim[4] * factor || 0,
    dim[5] * factor || 0,
    dim[6] * factor || 0,
  ];
}

/** Formats a dimension vector into a clean mathematical representation (e.g. L·M·T⁻²). */
export function formatDimension(dim: DimensionVector): string {
  if (isDimensionless(dim)) return "1 (dimensionless)";
  const symbols = ["L", "M", "T", "I", "Θ", "N", "J"];
  const parts: string[] = [];
  for (let i = 0; i < 7; i++) {
    const exp = dim[i];
    if (exp === 1) parts.push(symbols[i]!);
    else if (exp !== 0) parts.push(`${symbols[i]}^${exp}`);
  }
  return parts.length > 0 ? parts.join("·") : "1 (dimensionless)";
}

/** Formats a dimension vector into a human-readable quantity/unit label if known. */
export function getDimensionLabel(dim: DimensionVector): string {
  if (isDimensionless(dim)) return "dimensionless";
  for (const [name, vec] of Object.entries(KNOWN_DIMENSIONS)) {
    if (
      areDimensionsEqual(dim, vec) &&
      !SHORT_UNIT_SYMBOLS.has(name) &&
      !["Metre", "Meter", "Second", "Kilogram", "Ampere", "Kelvin", "Mole", "Candela"].includes(name)
    ) {
      return `${name} [${formatDimension(dim)}]`;
    }
  }
  return `[${formatDimension(dim)}]`;
}

/**
 * Resolves the physical dimension of a type (by name or SymbolEntry).
 * Follows inheritance links (:> or inherits) if not a direct base quantity.
 * Bare short unit symbols (`A`, `K`, `N`, `V`, `m`, `s`, etc.) are NOT treated as type dimensions
 * unless qualified with a unit package (`SI::*`, `SIBaseUnits::*`, `SIDerivedUnits::*`, `USCustomaryUnits::*`).
 */
export function resolveTypeDimension(
  db: QueryDB,
  typeNameOrEntry: string | SymbolEntry | null | undefined,
  visited = new Set<string | number>(),
): DimensionVector | null {
  if (!typeNameOrEntry) return null;

  let entry: SymbolEntry | null = null;
  let rawName = "";
  let allowUnitSymbols = false;

  if (typeof typeNameOrEntry === "string") {
    const cleaned = stripSurroundingQuotes(typeNameOrEntry.trim());
    const qParts = cleaned
      .split("::")
      .map((s) => stripSurroundingQuotes(s.trim()))
      .filter(Boolean);
    rawName = qParts[qParts.length - 1] ?? cleaned;
    allowUnitSymbols = qParts.length >= 2 && qParts.slice(0, -1).some((pkg) => UNIT_PACKAGE_NAMES.has(pkg));

    const directDim = lookupDirectTypeDimension(rawName, allowUnitSymbols);
    if (directDim) return directDim;

    const candidates = db.byName(rawName) || [];
    const filtered = allowUnitSymbols ? candidates : candidates.filter((c) => !isStdlibShortUnitEntry(db, c));
    entry = filtered.find((c) => c.kind === "Definition") ?? filtered[0] ?? null;
  } else {
    entry = typeNameOrEntry;
    rawName = stripSurroundingQuotes(entry.name);
    if (isStdlibShortUnitEntry(db, entry)) {
      return null;
    }
    const directDim = lookupDirectTypeDimension(rawName, false);
    if (directDim) return directDim;
  }

  if (!entry) return null;
  if (visited.has(entry.id)) return null;
  visited.add(entry.id);

  // Check direct name match (respecting short-unit symbol guard)
  const entryDirectDim = lookupDirectTypeDimension(stripSurroundingQuotes(entry.name), allowUnitSymbols);
  if (entryDirectDim) {
    return entryDirectDim;
  }

  // Check inherits list from SymbolEntry metadata or entry.inherits
  const inherits = entry.inherits || [];
  for (const sup of inherits) {
    const dim = resolveTypeDimension(db, sup, visited);
    if (dim) return dim;
  }

  // Check children for Subclassification / OwnedSubclassification
  for (const child of db.childrenOf(entry.id)) {
    if (
      child.ruleName === "Subclassification" ||
      child.ruleName === "OwnedSubclassification" ||
      child.kind === "Specialization"
    ) {
      if (child.name) {
        const dim = resolveTypeDimension(db, child.name, visited);
        if (dim) return dim;
      }
    }
  }

  // Check CST leaves for `:> SuperType`
  if (typeof entry.startOffset === "number" && typeof entry.endOffset === "number") {
    const text = db.cstText(entry.startOffset, entry.endOffset, entry);
    if (text) {
      const leaves = collectCstLeaves(parseSysmlSource(text));
      const specIdx = leaves.findIndex((l) => l.text === ":>");
      const chain = specIdx !== -1 ? readDottedChainFromLeaves(leaves, specIdx + 1) : null;
      if (chain) {
        const dim = resolveTypeDimension(db, chain.text, visited);
        if (dim) return dim;
      }
    }
  }

  return null;
}

export interface DimensionInferenceResult {
  dimension?: DimensionVector | undefined;
  isZeroLiteral?: boolean | undefined;
  error?:
    | {
        message: string;
        startOffset?: number | undefined;
        endOffset?: number | undefined;
      }
    | undefined;
}

function evalStaticNumericCst(node: SysmlCstNode | null | undefined): number | null {
  if (!node) return null;
  switch (node.type) {
    case "LiteralInteger":
    case "LiteralReal": {
      const n = Number(node.text?.trim() ?? "");
      return Number.isFinite(n) ? n : null;
    }
    case "UnaryExpression": {
      const opNode = node.childForFieldName ? node.childForFieldName("operator") : node.children?.[0];
      const operand = node.childForFieldName ? node.childForFieldName("operand") : node.children?.[1];
      const op = opNode?.text?.trim() || "";
      const val = evalStaticNumericCst(operand);
      if (val === null) return null;
      if (op === "-") return -val;
      if (op === "+") return val;
      return null;
    }
    case "MultiplicativeExpression":
    case "AdditiveExpression": {
      const operands = node.childrenForFieldName ? node.childrenForFieldName("operand") : [];
      const operators = node.childrenForFieldName
        ? node.childrenForFieldName("operator").map((c) => c.text?.trim() || "")
        : [];
      if (operands.length === 0) return null;
      let acc = evalStaticNumericCst(operands[0]);
      if (acc === null) return null;
      for (let i = 0; i < operators.length && i + 1 < operands.length; i++) {
        const rhs = evalStaticNumericCst(operands[i + 1]);
        if (rhs === null) return null;
        const op = operators[i];
        if (op === "+") acc += rhs;
        else if (op === "-") acc -= rhs;
        else if (op === "*") acc *= rhs;
        else if (op === "/") {
          if (rhs === 0) return null;
          acc /= rhs;
        } else return null;
      }
      return acc;
    }
    default: {
      // Unwrap parentheses or wrapper CST nodes via leaves if simple signed number
      const children = node.children || [];
      for (const ch of children) {
        if (ch.type === "(" || ch.type === ")") continue;
        const v = evalStaticNumericCst(ch);
        if (v !== null) return v;
      }
      const leaves = collectCstLeaves(node);
      let start = 0;
      let end = leaves.length;
      while (start < end && leaves[start]?.text === "(" && leaves[end - 1]?.text === ")") {
        start++;
        end--;
      }
      if (start < end) {
        const parsed = parseSignedNumberFromLeaves(leaves.slice(start, end), 0);
        if (parsed && parsed.nextIdx === end - start) {
          return parsed.value;
        }
      }
      return null;
    }
  }
}

function inferTransparentWrapper(db: QueryDB, node: SysmlCstNode, scopeId: number | null): DimensionInferenceResult {
  let sawZero = false;
  for (const child of node.children || []) {
    if (child.type === "(" || child.type === ")" || child.type === "{" || child.type === "}" || child.type === ";") {
      continue;
    }
    const res = inferExpressionDimension(db, child, scopeId);
    if (res.error) return res;
    if (res.isZeroLiteral) {
      sawZero = true;
      continue;
    }
    if (res.dimension && !isDimensionless(res.dimension)) {
      return res;
    }
  }
  if (sawZero) {
    return { dimension: undefined, isZeroLiteral: true };
  }
  return { dimension: DIMENSIONLESS };
}

/**
 * Infers the physical dimension of an expression CST node and checks for dimensional consistency.
 */
export function inferExpressionDimension(
  db: QueryDB,
  node: SysmlCstNode | null | undefined,
  scopeId: number | null,
): DimensionInferenceResult {
  if (!node) return { dimension: DIMENSIONLESS };

  switch (node.type) {
    case "LiteralInteger":
    case "LiteralReal": {
      const raw = node.text?.trim() ?? "";
      const val = Number(raw);
      if (raw.length > 0 && Number.isFinite(val) && val === 0) {
        return { dimension: undefined, isZeroLiteral: true };
      }
      return { dimension: DIMENSIONLESS };
    }

    case "LiteralBoolean":
    case "LiteralString":
    case "NullExpression":
    case "LiteralInfinity":
      return { dimension: DIMENSIONLESS };

    case "InvocationExpression": {
      const rawFnNode =
        node.childForFieldName?.("type") ||
        findFirstDescendant(node, "QualifiedName") ||
        findFirstDescendant(node, "ID") ||
        findFirstDescendant(node, "Name");
      const rawFnText = rawFnNode?.text?.trim() || "";
      const fnName = (rawFnText.includes("::") ? rawFnText.split("::").pop()! : rawFnText).trim();

      // der(x): d/dt of x -> dimension of x minus TIME
      if (fnName === "der") {
        const argNode =
          findFirstDescendant(node, "Argument") || findFirstDescendant(node, "FeatureReferenceExpression");
        if (argNode) {
          const argRes = inferExpressionDimension(db, argNode, scopeId);
          if (argRes.error) return argRes;
          const argDim = argRes.dimension || DIMENSIONLESS;
          return { dimension: subtractDimensions(argDim, TIME) };
        }
        return { dimension: DIMENSIONLESS };
      }

      // sqrt(x): square root of x -> each dimension exponent divided by 2
      if (fnName === "sqrt") {
        const argNode =
          findFirstDescendant(node, "Argument") || findFirstDescendant(node, "FeatureReferenceExpression");
        if (argNode) {
          const argRes = inferExpressionDimension(db, argNode, scopeId);
          if (argRes.error) return argRes;
          if (argRes.isZeroLiteral) return { dimension: undefined, isZeroLiteral: true };
          const argDim = argRes.dimension || DIMENSIONLESS;
          return { dimension: multiplyDimension(argDim, 0.5) };
        }
        return { dimension: DIMENSIONLESS };
      }

      // abs(x), sign(x)
      if (fnName === "abs" || fnName === "sign") {
        const argNode =
          findFirstDescendant(node, "Argument") || findFirstDescendant(node, "FeatureReferenceExpression");
        if (argNode) {
          return inferExpressionDimension(db, argNode, scopeId);
        }
        return { dimension: DIMENSIONLESS };
      }

      // min(a, b), max(a, b)
      if (fnName === "min" || fnName === "max") {
        const argNodes = findCstDescendants(node, "Argument");
        if (argNodes.length >= 2) {
          const leftRes = inferExpressionDimension(db, argNodes[0], scopeId);
          if (leftRes.error) return leftRes;
          const rightRes = inferExpressionDimension(db, argNodes[1], scopeId);
          if (rightRes.error) return rightRes;
          if (leftRes.isZeroLiteral && rightRes.isZeroLiteral) {
            return { dimension: undefined, isZeroLiteral: true };
          }
          if (leftRes.isZeroLiteral) return { dimension: rightRes.dimension || DIMENSIONLESS };
          if (rightRes.isZeroLiteral) return { dimension: leftRes.dimension || DIMENSIONLESS };
          const leftDim = leftRes.dimension || DIMENSIONLESS;
          const rightDim = rightRes.dimension || DIMENSIONLESS;
          if (!areDimensionsEqual(leftDim, rightDim)) {
            return {
              error: {
                message: `Dimensional mismatch: arguments to '${fnName}' must have identical physical dimensions, got '${getDimensionLabel(leftDim)}' and '${getDimensionLabel(rightDim)}'.`,
                startOffset: node.startIndex ?? node.startOffset,
                endOffset: node.endIndex ?? node.endOffset,
              },
            };
          }
          return { dimension: leftDim };
        }
      }

      // Transcendental functions: sin, cos, tan, asin, acos, atan, exp, log, ln
      if (["sin", "cos", "tan", "asin", "acos", "atan", "exp", "log", "ln"].includes(fnName)) {
        const argNode =
          findFirstDescendant(node, "Argument") || findFirstDescendant(node, "FeatureReferenceExpression");
        if (argNode) {
          const argRes = inferExpressionDimension(db, argNode, scopeId);
          if (argRes.error) return argRes;
          const argDim = argRes.dimension || DIMENSIONLESS;
          if (!argRes.isZeroLiteral && !isDimensionless(argDim)) {
            return {
              error: {
                message: `Dimensional mismatch: argument to transcendental function '${fnName}' must be dimensionless, got '${getDimensionLabel(argDim)}'.`,
                startOffset: argNode.startIndex ?? argNode.startOffset ?? node.startIndex ?? node.startOffset,
                endOffset: argNode.endIndex ?? argNode.endOffset ?? node.endIndex ?? node.endOffset,
              },
            };
          }
        }
        return { dimension: DIMENSIONLESS };
      }

      // Fallback for custom calculations or function calls: check arguments for internal errors
      for (const argNode of findCstDescendants(node, "Argument")) {
        const res = inferExpressionDimension(db, argNode, scopeId);
        if (res.error) return res;
      }
      if (fnName) {
        const fnEntry = resolveFeatureChainInScope(db, scopeId, rawFnText || fnName);
        if (fnEntry) {
          const fnDim = resolveSymbolResultDimension(db, fnEntry);
          if (fnDim) return { dimension: fnDim };
        }
      }
      return { dimension: DIMENSIONLESS };
    }

    case "ConditionalExpression": {
      const condNode = node.childForFieldName ? node.childForFieldName("operand") : undefined;
      if (condNode) {
        const condRes = inferExpressionDimension(db, condNode, scopeId);
        if (condRes.error) return condRes;
      }
      let thenNode = node.childForFieldName ? node.childForFieldName("thenOperand") : undefined;
      let elseNode = node.childForFieldName ? node.childForFieldName("elseOperand") : undefined;
      if (!thenNode || !elseNode) {
        const children = node.children || [];
        const qIdx = children.findIndex((c) => c.text?.trim() === "?");
        const elseIdx = children.findIndex((c) => c.text?.trim() === "else");
        if (!thenNode && qIdx !== -1 && qIdx + 1 < children.length) {
          thenNode = children[qIdx + 1];
        }
        if (!elseNode && elseIdx !== -1 && elseIdx + 1 < children.length) {
          elseNode = children[elseIdx + 1];
        }
      }

      const thenRes = inferExpressionDimension(db, thenNode, scopeId);
      if (thenRes.error) return thenRes;
      const elseRes = inferExpressionDimension(db, elseNode, scopeId);
      if (elseRes.error) return elseRes;

      if (thenRes.isZeroLiteral && elseRes.isZeroLiteral) {
        return { dimension: undefined, isZeroLiteral: true };
      }
      if (thenRes.isZeroLiteral) {
        return { dimension: elseRes.dimension || DIMENSIONLESS };
      }
      if (elseRes.isZeroLiteral) {
        return { dimension: thenRes.dimension || DIMENSIONLESS };
      }

      const thenDim = thenRes.dimension || DIMENSIONLESS;
      const elseDim = elseRes.dimension || DIMENSIONLESS;
      if (!areDimensionsEqual(thenDim, elseDim)) {
        return {
          error: {
            message: `Dimensional mismatch: conditional branches must have identical physical dimensions, got '${getDimensionLabel(thenDim)}' and '${getDimensionLabel(elseDim)}'.`,
            startOffset: node.startIndex ?? node.startOffset,
            endOffset: node.endIndex ?? node.endOffset,
          },
        };
      }
      return { dimension: thenDim };
    }

    case "AdditiveExpression": {
      const operands: SysmlCstNode[] = node.childrenForFieldName ? node.childrenForFieldName("operand") : [];
      const operators: string[] = node.childrenForFieldName
        ? node.childrenForFieldName("operator").map((c: SysmlCstNode) => c.text?.trim() || "+")
        : [];
      if (operands.length < 2) return { dimension: DIMENSIONLESS };

      const first = inferExpressionDimension(db, operands[0], scopeId);
      if (first.error) return first;
      let curIsZero = Boolean(first.isZeroLiteral);
      let curDim = first.dimension || DIMENSIONLESS;

      for (let i = 0; i < operators.length && i + 1 < operands.length; i++) {
        const next = inferExpressionDimension(db, operands[i + 1], scopeId);
        if (next.error) return next;
        const nextIsZero = Boolean(next.isZeroLiteral);
        const nextDim = next.dimension || DIMENSIONLESS;

        if (curIsZero && nextIsZero) {
          continue;
        }
        if (curIsZero) {
          curDim = nextDim;
          curIsZero = false;
          continue;
        }
        if (nextIsZero) {
          continue;
        }

        if (!areDimensionsEqual(curDim, nextDim)) {
          return {
            error: {
              message: `Dimensional mismatch: cannot perform '${operators[i]}' on incompatible physical dimensions '${getDimensionLabel(curDim)}' and '${getDimensionLabel(nextDim)}'.`,
              startOffset: node.startIndex ?? node.startOffset,
              endOffset: node.endIndex ?? node.endOffset,
            },
          };
        }
        curDim = nextDim;
      }
      if (curIsZero) {
        return { dimension: undefined, isZeroLiteral: true };
      }
      return { dimension: curDim };
    }

    case "MultiplicativeExpression": {
      const operands: SysmlCstNode[] = node.childrenForFieldName ? node.childrenForFieldName("operand") : [];
      const operators: string[] = node.childrenForFieldName
        ? node.childrenForFieldName("operator").map((c: SysmlCstNode) => c.text?.trim() || "*")
        : [];
      if (operands.length < 2) return { dimension: DIMENSIONLESS };

      const first = inferExpressionDimension(db, operands[0], scopeId);
      if (first.error) return first;
      let curIsZero = Boolean(first.isZeroLiteral);
      let curDim = first.dimension || DIMENSIONLESS;

      for (let i = 0; i < operators.length && i + 1 < operands.length; i++) {
        const next = inferExpressionDimension(db, operands[i + 1], scopeId);
        if (next.error) return next;
        const nextIsZero = Boolean(next.isZeroLiteral);
        const nextDim = next.dimension || DIMENSIONLESS;
        const op = operators[i];

        if (op === "*") {
          if (curIsZero || nextIsZero) {
            curIsZero = true;
            curDim = addDimensions(curDim, nextDim);
          } else {
            curDim = addDimensions(curDim, nextDim);
          }
        } else if (op === "/") {
          if (curIsZero) {
            curDim = subtractDimensions(curDim, nextDim);
          } else {
            curDim = subtractDimensions(curDim, nextDim);
          }
        } else if (op === "%") {
          if (!curIsZero && !nextIsZero && !areDimensionsEqual(curDim, nextDim)) {
            return {
              error: {
                message: `Dimensional mismatch: cannot perform '%' on incompatible physical dimensions '${getDimensionLabel(curDim)}' and '${getDimensionLabel(nextDim)}'.`,
                startOffset: node.startIndex ?? node.startOffset,
                endOffset: node.endIndex ?? node.endOffset,
              },
            };
          }
        }
      }
      if (curIsZero && isDimensionless(curDim)) {
        return { dimension: undefined, isZeroLiteral: true };
      }
      return { dimension: curDim };
    }

    case "ExponentiationExpression": {
      const baseNode = node.childForFieldName
        ? (node.childForFieldName("base") ?? node.childrenForFieldName?.("operand")?.[0])
        : node.children?.[0];
      const expNode = node.childForFieldName
        ? (node.childForFieldName("exponent") ?? node.childrenForFieldName?.("operand")?.[1])
        : node.children?.[2];
      if (!baseNode || !expNode) return { dimension: DIMENSIONLESS };

      const baseRes = inferExpressionDimension(db, baseNode, scopeId);
      if (baseRes.error) return baseRes;
      const expRes = inferExpressionDimension(db, expNode, scopeId);
      if (expRes.error) return expRes;

      const baseDim = baseRes.dimension || DIMENSIONLESS;
      const expDim = expRes.dimension || DIMENSIONLESS;
      if (!expRes.isZeroLiteral && !isDimensionless(expDim)) {
        return {
          error: {
            message: `Dimensional mismatch: exponent must be dimensionless, got '${getDimensionLabel(expDim)}'.`,
            startOffset: expNode.startIndex ?? expNode.startOffset ?? node.startIndex ?? node.startOffset,
            endOffset: expNode.endIndex ?? expNode.endOffset ?? node.endIndex ?? node.endOffset,
          },
        };
      }

      const expVal = evalStaticNumericCst(expNode);
      if (expVal !== null && Number.isFinite(expVal)) {
        return { dimension: multiplyDimension(baseDim, expVal) };
      }
      return { dimension: baseDim };
    }

    case "RelationalExpression": {
      const operands: SysmlCstNode[] = node.childrenForFieldName ? node.childrenForFieldName("operand") : [];
      if (operands.length < 2) return { dimension: DIMENSIONLESS };

      const left = inferExpressionDimension(db, operands[0], scopeId);
      if (left.error) return left;
      const right = inferExpressionDimension(db, operands[1], scopeId);
      if (right.error) return right;

      if (left.isZeroLiteral || right.isZeroLiteral) {
        return { dimension: DIMENSIONLESS };
      }

      const leftDim = left.dimension || DIMENSIONLESS;
      const rightDim = right.dimension || DIMENSIONLESS;

      if (!areDimensionsEqual(leftDim, rightDim)) {
        return {
          error: {
            message: `Dimensional mismatch: cannot compare incompatible physical dimensions '${getDimensionLabel(leftDim)}' and '${getDimensionLabel(rightDim)}'.`,
            startOffset: node.startIndex ?? node.startOffset,
            endOffset: node.endIndex ?? node.endOffset,
          },
        };
      }
      return { dimension: DIMENSIONLESS };
    }

    case "EqualityExpression": {
      const operands: SysmlCstNode[] = node.childrenForFieldName ? node.childrenForFieldName("operand") : [];
      if (operands.length < 2) {
        for (const child of node.children || []) {
          if (
            child.type !== "EqualityOperator" &&
            !["==", "!=", "===", "!==", "(", ")", " ", "", ";"].includes(child.type)
          ) {
            operands.push(child);
          }
        }
      }
      if (operands.length < 2) return { dimension: DIMENSIONLESS };

      const left = inferExpressionDimension(db, operands[0], scopeId);
      if (left.error) return left;
      const right = inferExpressionDimension(db, operands[1], scopeId);
      if (right.error) return right;

      if (
        left.isZeroLiteral ||
        right.isZeroLiteral ||
        operands[0]?.type === "NullExpression" ||
        operands[1]?.type === "NullExpression"
      ) {
        return { dimension: DIMENSIONLESS };
      }

      const leftDim = left.dimension || DIMENSIONLESS;
      const rightDim = right.dimension || DIMENSIONLESS;

      if (!isDimensionless(leftDim) && !isDimensionless(rightDim) && !areDimensionsEqual(leftDim, rightDim)) {
        return {
          error: {
            message: `Dimensional mismatch: cannot test equality between incompatible physical dimensions '${getDimensionLabel(leftDim)}' and '${getDimensionLabel(rightDim)}'.`,
            startOffset: node.startIndex ?? node.startOffset,
            endOffset: node.endIndex ?? node.endOffset,
          },
        };
      }
      return { dimension: DIMENSIONLESS };
    }

    case "UnaryExpression": {
      const opNode = node.childForFieldName ? node.childForFieldName("operator") : node.children?.[0];
      const operand = node.childForFieldName ? node.childForFieldName("operand") : node.children?.[1];
      if (!operand) return { dimension: DIMENSIONLESS };
      const res = inferExpressionDimension(db, operand, scopeId);
      if (res.error) return res;
      const opText = opNode?.text?.trim() || "";
      if (res.isZeroLiteral && (opText === "-" || opText === "+")) {
        return { dimension: undefined, isZeroLiteral: true };
      }
      return res;
    }

    case "FeatureReferenceExpression":
    case "PrimaryExpression": {
      const operand = node.childForFieldName ? node.childForFieldName("operand") : null;
      if (operand) return inferExpressionDimension(db, operand, scopeId);

      // Extract full dotted / qualified feature chain (`car.mass`, `sled.v`, `Pkg::attr`, `a.b.c`)
      const chainPath = extractReferencedChain(node);
      if (chainPath) {
        const feature = resolveFeatureChainInScope(db, scopeId, chainPath);
        if (feature) {
          const dim = resolveSymbolResultDimension(db, feature);
          return { dimension: dim || DIMENSIONLESS };
        }
        return { dimension: DIMENSIONLESS };
      }

      // If PrimaryExpression has `base` + `featureChain` where `base` is a complex expression
      const baseNode = node.childForFieldName ? node.childForFieldName("base") : null;
      const chainNode = node.childForFieldName ? node.childForFieldName("featureChain") : null;
      if (baseNode && !chainNode) {
        return inferExpressionDimension(db, baseNode, scopeId);
      }

      return inferTransparentWrapper(db, node, scopeId);
    }

    case "MeasurementExpression": {
      const unitNode = node.childForFieldName ? node.childForFieldName("unit") : null;
      if (unitNode) {
        return inferUnitDimension(db, unitNode, scopeId);
      }
      for (const child of node.children || []) {
        if (
          child.type === "UnitBinaryExpression" ||
          child.type === "UnitExponentExpression" ||
          child.type === "FeatureReferenceExpression"
        ) {
          return inferUnitDimension(db, child, scopeId);
        }
      }
      return { dimension: DIMENSIONLESS };
    }

    case "OwnedExpression":
    case "OwnedExpressionReference":
    case "OwnedExpressionMember":
    case "SequenceExpression":
    case "ExpressionBody":
    case "ResultExpressionMember":
      return inferTransparentWrapper(db, node, scopeId);

    default:
      return inferTransparentWrapper(db, node, scopeId);
  }
}

/**
 * Extracts a pure dotted/qualified feature reference path (e.g. `car.mass`, `sled.v`, `Pkg::attr`, `Pkg::car.mass`)
 * from a `FeatureReferenceExpression` or `PrimaryExpression` CST node, or `null` if it contains calls/operators.
 */
function extractReferencedChain(node: SysmlCstNode): string | null {
  const leaves = collectCstLeaves(node);
  if (leaves.length === 0) {
    const raw = stripLeadingChars(node.text?.trim(), ":.");
    return isSysmlIdentLeaf(raw) ? stripSurroundingQuotes(raw) : null;
  }
  let idx = 0;
  if (leaves[0]?.text === "." || leaves[0]?.text === "::") idx++;
  const chain = readDottedChainFromLeaves(leaves, idx);
  if (chain && chain.nextIdx === leaves.length) {
    return chain.text
      .split("::")
      .map((seg) =>
        seg
          .split(".")
          .map((p) => stripSurroundingQuotes(p))
          .join("."),
      )
      .join("::");
  }
  return null;
}

function getDirectSuperNames(db: QueryDB, entry: SymbolEntry): string[] {
  const out: string[] = [];
  if (entry.inherits) {
    for (const inh of entry.inherits) {
      if (inh) out.push(inh);
    }
  }
  for (const ch of db.childrenOf(entry.id)) {
    if (
      (ch.ruleName === "OwnedSubclassification" ||
        ch.ruleName === "Subclassification" ||
        ch.ruleName === "OwnedFeatureTyping" ||
        ch.ruleName === "OwnedSubsetting" ||
        ch.ruleName === "OwnedRedefinition" ||
        ch.kind === "Specialization") &&
      ch.name
    ) {
      out.push(ch.name);
    }
  }
  if (entry.metadata?.["typeSpecifier"]) {
    out.push(String(entry.metadata["typeSpecifier"]));
  }
  return out;
}

function findMemberInSymbolOrSupertypes(
  db: QueryDB,
  owner: SymbolEntry,
  memberName: string,
  visited = new Set<number>(),
): SymbolEntry | null {
  if (visited.has(owner.id)) return null;
  visited.add(owner.id);

  // 1. Direct non-import / non-specialization children
  for (const child of db.childrenOf(owner.id)) {
    if (
      child.kind !== "Import" &&
      child.kind !== "Specialization" &&
      child.kind !== "Reference" &&
      stripSurroundingQuotes(child.name) === memberName
    ) {
      return child;
    }
  }

  // 2. Supertypes / typed definitions
  for (const rawSup of getDirectSuperNames(db, owner)) {
    const cleanSup = rawSup.startsWith("~") ? rawSup.slice(1).trim() : rawSup.trim();
    if (!cleanSup) continue;
    const supEntry = resolveSimpleOrQualifiedType(db, owner.parentId, cleanSup);
    if (supEntry) {
      const found = findMemberInSymbolOrSupertypes(db, supEntry, memberName, visited);
      if (found) return found;
    }
  }

  return null;
}

function resolveSimpleOrQualifiedType(db: QueryDB, scopeId: number | null, typePath: string): SymbolEntry | null {
  const qSegs = typePath
    .split("::")
    .map((s) => stripSurroundingQuotes(s.trim()))
    .filter(Boolean);
  if (qSegs.length === 0) return null;

  if (qSegs.length > 1) {
    const roots = db.byName(qSegs[0]!) || [];
    for (const root of roots) {
      let cur: SymbolEntry | null = root;
      for (let i = 1; i < qSegs.length && cur; i++) {
        cur = findMemberInSymbolOrSupertypes(db, cur, qSegs[i]!);
      }
      if (cur) return cur;
    }
  }

  const leafName = qSegs[qSegs.length - 1]!;
  // Walk enclosing scopes for local/sibling definitions first
  let curScopeId = scopeId;
  let guard = 0;
  while (curScopeId !== null && guard++ < 64) {
    const scopeSym = db.symbol(curScopeId);
    if (!scopeSym) break;
    for (const ch of db.childrenOf(scopeSym.id)) {
      if (ch.kind === "Definition" && stripSurroundingQuotes(ch.name) === leafName) {
        return ch;
      }
    }
    curScopeId = scopeSym.parentId;
  }

  const all = (db.byName(leafName) || []).filter((c) => !isStdlibShortUnitEntry(db, c));
  return all.find((c) => c.kind === "Definition") ?? all[0] ?? null;
}

/**
 * Resolves a single identifier, qualified name (`Pkg::attr`), or dotted feature chain (`car.mass`, `a.b.c`)
 * starting from `scopeId`, walking enclosing parents, inherited supertypes, imports, and feature types.
 */
function resolveFeatureChainInScope(db: QueryDB, scopeId: number | null, chainPath: string): SymbolEntry | null {
  if (!chainPath) return null;

  // Split into `::` namespace prefix (if any) followed by `.` feature hops
  const dotParts = chainPath.split(".");
  const firstPart = dotParts[0]!;
  const restDots = dotParts
    .slice(1)
    .map((s) => stripSurroundingQuotes(s.trim()))
    .filter(Boolean);

  let current: SymbolEntry | null = null;

  if (firstPart.includes("::")) {
    const qSegs = firstPart
      .split("::")
      .map((s) => stripSurroundingQuotes(s.trim()))
      .filter(Boolean);
    if (qSegs.length > 0) {
      const rootCandidates: SymbolEntry[] = [];
      let curScope = scopeId;
      let guard = 0;
      while (curScope !== null && guard++ < 64) {
        const s = db.symbol(curScope);
        if (!s) break;
        if (stripSurroundingQuotes(s.name) === qSegs[0]) rootCandidates.push(s);
        for (const ch of db.childrenOf(s.id)) {
          if (stripSurroundingQuotes(ch.name) === qSegs[0]) rootCandidates.push(ch);
        }
        curScope = s.parentId;
      }
      for (const c of db.byName(qSegs[0]!) || []) {
        if (!rootCandidates.some((r) => r.id === c.id)) rootCandidates.push(c);
      }
      for (const root of rootCandidates) {
        let step: SymbolEntry | null = root;
        for (let i = 1; i < qSegs.length && step; i++) {
          step = findMemberInSymbolOrSupertypes(db, step, qSegs[i]!);
        }
        if (step) {
          current = step;
          break;
        }
      }
    }
  } else {
    const rootName = stripSurroundingQuotes(firstPart.trim());
    // 1. Walk enclosing scopes + inherited supertypes + imports
    let curScope = scopeId;
    let guard = 0;
    while (curScope !== null && guard++ < 64 && !current) {
      const scopeSym = db.symbol(curScope);
      if (!scopeSym) break;
      current = findMemberInSymbolOrSupertypes(db, scopeSym, rootName);
      if (current) break;

      // Check imports in this scope
      for (const ch of db.childrenOf(scopeSym.id)) {
        if (ch.kind === "Import" && ch.name) {
          const imp = ch.name.replace(/::\*+$/, "");
          const pkgName = imp.split("::").pop() || imp;
          for (const pkg of db.byName(pkgName) || []) {
            const member = findMemberInSymbolOrSupertypes(db, pkg, rootName);
            if (member && !isStdlibShortUnitEntry(db, member)) {
              current = member;
              break;
            }
          }
          if (current) break;
        }
      }
      curScope = scopeSym.parentId;
    }

    // 2. Fallback to workspace index (filtering out stdlib short unit symbols & preferring non-stdlib usages/defs)
    if (!current) {
      const candidates = (db.byName(rootName) || []).filter(
        (c) =>
          !isStdlibShortUnitEntry(db, c) &&
          c.kind !== "Import" &&
          c.kind !== "Specialization" &&
          c.kind !== "Reference",
      );
      current = candidates.find((c) => !c.resourceId?.startsWith("sysml2://stdlib/")) ?? candidates[0] ?? null;
    }
  }

  if (!current) return null;

  // Traverse remaining `.` feature chain hops (`car` -> `mass` -> ...)
  for (const seg of restDots) {
    const next = findMemberInSymbolOrSupertypes(db, current, seg);
    if (!next) return null;
    current = next;
  }

  return current;
}

function resolveSymbolResultDimension(
  db: QueryDB,
  entry: SymbolEntry,
  visited = new Set<number>(),
): DimensionVector | null {
  if (visited.has(entry.id)) return null;
  visited.add(entry.id);

  // 1. Direct OwnedFeatureTyping or metadata.typeSpecifier
  for (const child of db.childrenOf(entry.id)) {
    if (child.ruleName === "OwnedFeatureTyping" && child.name) {
      const dim = resolveTypeDimension(db, child.name);
      if (dim) return dim;
      const typeSym = resolveSimpleOrQualifiedType(db, entry.parentId, child.name);
      if (typeSym) {
        const symDim = resolveTypeDimension(db, typeSym);
        if (symDim) return symDim;
      }
    }
  }
  if (entry.metadata?.["typeSpecifier"]) {
    const spec = String(entry.metadata["typeSpecifier"]);
    const dim = resolveTypeDimension(db, spec);
    if (dim) return dim;
  }

  // 2. If CalculationDefinition / CalculationUsage, check return parameter (`out` / `return`)
  for (const child of db.childrenOf(entry.id)) {
    if (child.name === "return" || child.metadata?.["direction"] === "out") {
      const retDim = resolveSymbolResultDimension(db, child, visited);
      if (retDim) return retDim;
    }
  }

  // 3. Follow redefinition / subsetting (`attribute :>> mass = ...`) to inherit the base feature's dimension
  for (const child of db.childrenOf(entry.id)) {
    if ((child.ruleName === "OwnedRedefinition" || child.ruleName === "OwnedSubsetting") && child.name) {
      const target = resolveFeatureChainInScope(db, entry.parentId, child.name);
      if (target) {
        const inheritedDim = resolveSymbolResultDimension(db, target, visited);
        if (inheritedDim) return inheritedDim;
      }
    }
  }

  // 4. If entry itself is a Definition (e.g., AttributeDefinition), resolve directly
  if (entry.kind === "Definition") {
    return resolveTypeDimension(db, entry);
  }

  return null;
}

/**
 * Infers the dimension of a unit expression (e.g. `kg`, `m/s`, `m²`, `m^2`).
 */
export function inferUnitDimension(
  db: QueryDB,
  node: SysmlCstNode | null | undefined,
  scopeId?: number | null,
): DimensionInferenceResult {
  if (!node) return { dimension: DIMENSIONLESS };

  switch (node.type) {
    case "UnitBinaryExpression": {
      const left = node.childForFieldName ? node.childForFieldName("left") : node.children?.[0];
      const opNode = node.childForFieldName ? node.childForFieldName("operator") : node.children?.[1];
      const right = node.childForFieldName ? node.childForFieldName("right") : node.children?.[2];

      const leftRes = inferUnitDimension(db, left, scopeId);
      if (leftRes.error) return leftRes;
      const rightRes = inferUnitDimension(db, right, scopeId);
      if (rightRes.error) return rightRes;

      const op = opNode?.text?.trim() || "*";
      const leftDim = leftRes.dimension || DIMENSIONLESS;
      const rightDim = rightRes.dimension || DIMENSIONLESS;

      if (op === "/") {
        return { dimension: subtractDimensions(leftDim, rightDim) };
      } else {
        return { dimension: addDimensions(leftDim, rightDim) };
      }
    }

    case "UnitExponentExpression": {
      const base = node.childForFieldName ? node.childForFieldName("base") : node.children?.[0];
      const expNodes = node.childrenForFieldName ? node.childrenForFieldName("exponent") : [];
      const expNode = node.childForFieldName ? node.childForFieldName("exponent") : node.children?.[2];

      const baseRes = inferUnitDimension(db, base, scopeId);
      if (baseRes.error) return baseRes;
      const baseDim = baseRes.dimension || DIMENSIONLESS;

      let expText =
        expNodes.length > 0 ? expNodes.map((c) => c.text?.trim() || "").join("") : expNode?.text?.trim() || "";
      if (!expText || expText === "-") {
        const fullText = node.text?.trim() || "";
        const caretIdx = fullText.indexOf("^");
        const starStarIdx = fullText.indexOf("**");
        if (caretIdx !== -1) expText = fullText.slice(caretIdx + 1).trim();
        else if (starStarIdx !== -1) expText = fullText.slice(starStarIdx + 2).trim();
      }
      const expVal = parseInt(expText || "1", 10);
      if (!isNaN(expVal)) {
        return { dimension: multiplyDimension(baseDim, expVal) };
      }
      return { dimension: baseDim };
    }

    case "FeatureReferenceExpression":
    default: {
      const cleanedRaw = stripLeadingChars(node.text?.trim(), ":.");
      const rawText =
        (cleanedRaw.includes("::") ? cleanedRaw.split("::").pop()! : cleanedRaw).split(".")[0]?.trim() ?? "";
      // Handle superscripts directly (e.g. m², m³)
      if (rawText.endsWith("²") || rawText.endsWith("\u00B2")) {
        const baseName = rawText.slice(0, -1);
        const baseDim = KNOWN_DIMENSIONS[baseName] || (scopeId ? resolveTypeDimension(db, baseName) : null);
        if (baseDim) return { dimension: multiplyDimension(baseDim, 2) };
      } else if (rawText.endsWith("³") || rawText.endsWith("\u00B3")) {
        const baseName = rawText.slice(0, -1);
        const baseDim = KNOWN_DIMENSIONS[baseName] || (scopeId ? resolveTypeDimension(db, baseName) : null);
        if (baseDim) return { dimension: multiplyDimension(baseDim, 3) };
      }

      if (KNOWN_DIMENSIONS[rawText]) {
        return { dimension: KNOWN_DIMENSIONS[rawText] };
      }

      const typeDim = resolveTypeDimension(db, cleanedRaw || rawText);
      if (typeDim) {
        return { dimension: typeDim };
      }

      for (const child of node.children || []) {
        if (child.type === "(" || child.type === ")") continue;
        const res = inferUnitDimension(db, child, scopeId);
        if (res.error || (res.dimension && !isDimensionless(res.dimension))) return res;
      }
      return { dimension: DIMENSIONLESS };
    }
  }
}
