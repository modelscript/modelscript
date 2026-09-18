// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Physical dimensions calculus and QUDV static typing for SysML v2 / KerML.
 * Adheres to the 7 SI base quantities:
 * [L: Length, M: Mass, T: Time, I: Current, Theta: Temperature, N: Amount, J: Intensity]
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import type { QueryDB, SymbolEntry } from "@modelscript/runtime";

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
  ElectricCurrent: CURRENT,
  ThermodynamicTemperature: TEMPERATURE,
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
  ElectricResistance: ELECTRIC_RESISTANCE,
  Frequency: FREQUENCY,

  // SIBaseUnits
  Metre: LENGTH,
  Meter: LENGTH,
  Kilogram: MASS,
  Second: TIME,
  Ampere: CURRENT,
  Kelvin: TEMPERATURE,
  Mole: AMOUNT,
  Candela: LUMINOUS_INTENSITY,

  // SIDerivedUnits
  Newton: FORCE,
  Pascal: PRESSURE,
  Joule: ENERGY,
  Watt: POWER,
  Volt: VOLTAGE,
  Ohm: ELECTRIC_RESISTANCE,
  Hertz: FREQUENCY,
};

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
    dim[0] * factor,
    dim[1] * factor,
    dim[2] * factor,
    dim[3] * factor,
    dim[4] * factor,
    dim[5] * factor,
    dim[6] * factor,
  ];
}

/** Formats a dimension vector into a clean mathematical representation (e.g. L·M·T⁻²). */
export function formatDimension(dim: DimensionVector): string {
  if (isDimensionless(dim)) return "1 (dimensionless)";
  const symbols = ["L", "M", "T", "I", "Θ", "N", "J"];
  const parts: string[] = [];
  for (let i = 0; i < 7; i++) {
    const exp = dim[i];
    if (exp === 1) parts.push(symbols[i]);
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
 */
export function resolveTypeDimension(
  db: QueryDB,
  typeNameOrEntry: string | SymbolEntry | null | undefined,
  visited = new Set<string | number>(),
): DimensionVector | null {
  if (!typeNameOrEntry) return null;

  let entry: SymbolEntry | null = null;
  let rawName = "";

  if (typeof typeNameOrEntry === "string") {
    rawName = typeNameOrEntry.includes("::") ? typeNameOrEntry.split("::").pop()! : typeNameOrEntry;
    if (KNOWN_DIMENSIONS[rawName]) {
      return KNOWN_DIMENSIONS[rawName];
    }
    const candidates = db.byName(rawName);
    if (candidates && candidates.length > 0) {
      entry = candidates[0];
    }
  } else {
    entry = typeNameOrEntry;
    rawName = entry.name;
    if (KNOWN_DIMENSIONS[rawName]) {
      return KNOWN_DIMENSIONS[rawName];
    }
  }

  if (!entry) return null;
  if (visited.has(entry.id)) return null;
  visited.add(entry.id);

  // Check direct name match
  if (KNOWN_DIMENSIONS[entry.name]) {
    return KNOWN_DIMENSIONS[entry.name];
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

  // Check CST text for `:> SuperType`
  if (typeof entry.startByte === "number" && typeof entry.endByte === "number") {
    const text = db.cstText(entry.startByte, entry.endByte);
    if (text) {
      const match = text.match(/:>\s*([a-zA-Z0-9_:]+)/);
      if (match && match[1]) {
        const supName = match[1].split("::").pop()!;
        const dim = resolveTypeDimension(db, supName, visited);
        if (dim) return dim;
      }
    }
  }

  return null;
}

export interface DimensionInferenceResult {
  dimension?: DimensionVector;
  error?: {
    message: string;
    startByte?: number;
    endByte?: number;
  };
}

/**
 * Infers the physical dimension of an expression CST node and checks for dimensional consistency.
 */
export function inferExpressionDimension(db: QueryDB, node: any, scopeId: number | null): DimensionInferenceResult {
  if (!node) return { dimension: DIMENSIONLESS };

  switch (node.type) {
    case "LiteralInteger":
    case "LiteralReal":
    case "LiteralBoolean":
    case "LiteralString":
    case "NullExpression":
    case "LiteralInfinity":
      return { dimension: DIMENSIONLESS };

    case "AdditiveExpression": {
      const operands: any[] = [];
      const operators: string[] = [];
      for (const child of node.children || []) {
        if (child.type === "AdditiveOperator" || child.type === "+" || child.type === "-") {
          operators.push(child.text?.trim() || "+");
        } else if (!["(", ")", " ", "", ";"].includes(child.type)) {
          operands.push(child);
        }
      }
      if (operands.length < 2) return { dimension: DIMENSIONLESS };

      let current = inferExpressionDimension(db, operands[0], scopeId);
      if (current.error) return current;
      let curDim = current.dimension || DIMENSIONLESS;

      for (let i = 0; i < operators.length && i + 1 < operands.length; i++) {
        const next = inferExpressionDimension(db, operands[i + 1], scopeId);
        if (next.error) return next;
        const nextDim = next.dimension || DIMENSIONLESS;

        if (!areDimensionsEqual(curDim, nextDim)) {
          return {
            error: {
              message: `Dimensional mismatch: cannot perform '${operators[i]}' on incompatible physical dimensions '${getDimensionLabel(curDim)}' and '${getDimensionLabel(nextDim)}'.`,
              startByte: node.startByte,
              endByte: node.endByte,
            },
          };
        }
        curDim = nextDim;
      }
      return { dimension: curDim };
    }

    case "MultiplicativeExpression": {
      const operands: any[] = [];
      const operators: string[] = [];
      for (const child of node.children || []) {
        if (child.type === "MultiplicativeOperator" || child.type === "*" || child.type === "/" || child.type === "%") {
          operators.push(child.text?.trim() || "*");
        } else if (!["(", ")", " ", "", ";"].includes(child.type)) {
          operands.push(child);
        }
      }
      if (operands.length < 2) return { dimension: DIMENSIONLESS };

      let current = inferExpressionDimension(db, operands[0], scopeId);
      if (current.error) return current;
      let curDim = current.dimension || DIMENSIONLESS;

      for (let i = 0; i < operators.length && i + 1 < operands.length; i++) {
        const next = inferExpressionDimension(db, operands[i + 1], scopeId);
        if (next.error) return next;
        const nextDim = next.dimension || DIMENSIONLESS;
        const op = operators[i];

        if (op === "*") {
          curDim = addDimensions(curDim, nextDim);
        } else if (op === "/") {
          curDim = subtractDimensions(curDim, nextDim);
        } else if (op === "%") {
          if (!areDimensionsEqual(curDim, nextDim)) {
            return {
              error: {
                message: `Dimensional mismatch: cannot perform '%' on incompatible physical dimensions '${getDimensionLabel(curDim)}' and '${getDimensionLabel(nextDim)}'.`,
                startByte: node.startByte,
                endByte: node.endByte,
              },
            };
          }
        }
      }
      return { dimension: curDim };
    }

    case "ExponentiationExpression": {
      const baseNode = node.childForFieldName ? node.childForFieldName("base") : node.children?.[0];
      const expNode = node.childForFieldName ? node.childForFieldName("exponent") : node.children?.[2];
      if (!baseNode || !expNode) return { dimension: DIMENSIONLESS };

      const baseRes = inferExpressionDimension(db, baseNode, scopeId);
      if (baseRes.error) return baseRes;
      const baseDim = baseRes.dimension || DIMENSIONLESS;

      const expText = expNode.text?.trim() || "";
      const expVal = parseInt(expText, 10);
      if (!isNaN(expVal)) {
        return { dimension: multiplyDimension(baseDim, expVal) };
      }
      return { dimension: baseDim };
    }

    case "RelationalExpression": {
      const operands: any[] = [];
      const operators: string[] = [];
      for (const child of node.children || []) {
        if (child.type === "RelationalOperator" || ["<", ">", "<=", ">="].includes(child.type)) {
          operators.push(child.text?.trim() || ">");
        } else if (!["(", ")", " ", "", ";"].includes(child.type)) {
          operands.push(child);
        }
      }
      if (operands.length < 2) return { dimension: DIMENSIONLESS };

      const left = inferExpressionDimension(db, operands[0], scopeId);
      if (left.error) return left;
      const right = inferExpressionDimension(db, operands[1], scopeId);
      if (right.error) return right;

      const leftDim = left.dimension || DIMENSIONLESS;
      const rightDim = right.dimension || DIMENSIONLESS;

      if (!areDimensionsEqual(leftDim, rightDim)) {
        return {
          error: {
            message: `Dimensional mismatch: cannot compare incompatible physical dimensions '${getDimensionLabel(leftDim)}' and '${getDimensionLabel(rightDim)}'.`,
            startByte: node.startByte,
            endByte: node.endByte,
          },
        };
      }
      return { dimension: DIMENSIONLESS };
    }

    case "EqualityExpression": {
      const operands: any[] = [];
      for (const child of node.children || []) {
        if (
          child.type !== "EqualityOperator" &&
          !["==", "!=", "===", "!==", "(", ")", " ", "", ";"].includes(child.type)
        ) {
          operands.push(child);
        }
      }
      if (operands.length < 2) return { dimension: DIMENSIONLESS };

      const left = inferExpressionDimension(db, operands[0], scopeId);
      if (left.error) return left;
      const right = inferExpressionDimension(db, operands[1], scopeId);
      if (right.error) return right;

      const leftDim = left.dimension || DIMENSIONLESS;
      const rightDim = right.dimension || DIMENSIONLESS;

      if (!isDimensionless(leftDim) && !isDimensionless(rightDim) && !areDimensionsEqual(leftDim, rightDim)) {
        return {
          error: {
            message: `Dimensional mismatch: cannot test equality between incompatible physical dimensions '${getDimensionLabel(leftDim)}' and '${getDimensionLabel(rightDim)}'.`,
            startByte: node.startByte,
            endByte: node.endByte,
          },
        };
      }
      return { dimension: DIMENSIONLESS };
    }

    case "UnaryExpression": {
      const operand = node.childForFieldName ? node.childForFieldName("operand") : node.children?.[1];
      return operand ? inferExpressionDimension(db, operand, scopeId) : { dimension: DIMENSIONLESS };
    }

    case "FeatureReferenceExpression":
    case "PrimaryExpression": {
      const operand = node.childForFieldName ? node.childForFieldName("operand") : null;
      if (operand) return inferExpressionDimension(db, operand, scopeId);

      // Extract referenced feature name
      const name = extractReferencedName(node);
      if (name) {
        const feature = resolveFeatureEntryInScope(db, scopeId, name);
        if (feature) {
          // Look up feature's declared type
          const typeEntry = resolveFeatureTypeEntry(db, feature);
          if (typeEntry) {
            const dim = resolveTypeDimension(db, typeEntry);
            if (dim) return { dimension: dim };
          }
        }
      }

      // Check wrapped child
      for (const child of node.children || []) {
        const res = inferExpressionDimension(db, child, scopeId);
        if (res.error || (res.dimension && !isDimensionless(res.dimension))) return res;
      }
      return { dimension: DIMENSIONLESS };
    }

    case "OwnedExpression":
    case "ExpressionBody":
    case "ResultExpressionMember": {
      for (const child of node.children || []) {
        const res = inferExpressionDimension(db, child, scopeId);
        if (res.error || (res.dimension && !isDimensionless(res.dimension))) return res;
      }
      return { dimension: DIMENSIONLESS };
    }

    default: {
      for (const child of node.children || []) {
        const res = inferExpressionDimension(db, child, scopeId);
        if (res.error || (res.dimension && !isDimensionless(res.dimension))) return res;
      }
      return { dimension: DIMENSIONLESS };
    }
  }
}

function extractReferencedName(node: any): string | null {
  if (node.type === "FeatureReferenceExpression") {
    const text = node.text?.trim() || "";
    return text.replace(/^[:.]+/, "").split(".")[0];
  }
  const text = node.text?.trim() || "";
  if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(text)) {
    return text;
  }
  return null;
}

function resolveFeatureEntryInScope(db: QueryDB, scopeId: number | null, name: string): SymbolEntry | null {
  if (scopeId !== null && scopeId !== undefined) {
    for (const child of db.childrenOf(scopeId)) {
      if (child.name === name) return child;
    }
  }
  const candidates = db.byName(name);
  return candidates && candidates.length > 0 ? candidates[0] : null;
}

function resolveFeatureTypeEntry(db: QueryDB, entry: SymbolEntry): SymbolEntry | string | null {
  for (const child of db.childrenOf(entry.id)) {
    if (child.ruleName === "OwnedFeatureTyping" && child.name) {
      return child.name;
    }
  }
  // Check metadata typeSpecifier
  if (entry.metadata?.typeSpecifier) {
    return String(entry.metadata.typeSpecifier);
  }
  return null;
}
