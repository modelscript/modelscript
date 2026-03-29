// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Variable coupling graph for co-simulation.
 *
 * Defines which output variables from one participant feed into
 * which input variables of another participant.
 */

/**
 * Value type for co-simulation variable exchange.
 * Supports all FMI 2.0 scalar types: Real, Integer, Boolean, String.
 */
export type CosimValue = number | string | boolean;

/** A single variable coupling: one output feeds one input. */
export interface VariableCoupling {
  from: {
    participantId: string;
    variableName: string;
    /** SI unit string from the source variable (optional). */
    unit?: string | undefined;
  };
  to: {
    participantId: string;
    variableName: string;
    /** SI unit string from the target variable (optional). */
    unit?: string | undefined;
  };
}

/** Result from unit compatibility validation. */
export interface UnitWarning {
  /** Severity: 'error' for incompatible, 'warning' for differing but potentially compatible. */
  severity: "error" | "warning";
  /** Source participant and variable. */
  from: string;
  /** Target participant and variable. */
  to: string;
  /** Source unit. */
  fromUnit: string;
  /** Target unit. */
  toUnit: string;
  /** Human-readable message. */
  message: string;
}

/**
 * Coupling graph that manages variable interconnections between participants.
 */
export class CouplingGraph {
  private readonly couplings: VariableCoupling[] = [];

  /** Add a coupling from an output variable to an input variable. */
  addCoupling(coupling: VariableCoupling): void {
    // Validate: no duplicate targets (one input can only receive from one source)
    const existing = this.couplings.find(
      (c) => c.to.participantId === coupling.to.participantId && c.to.variableName === coupling.to.variableName,
    );
    if (existing) {
      throw new Error(
        `Input ${coupling.to.participantId}.${coupling.to.variableName} is already coupled to ${existing.from.participantId}.${existing.from.variableName}`,
      );
    }
    this.couplings.push(coupling);
  }

  /** Remove a coupling. */
  removeCoupling(from: { participantId: string; variableName: string }): void {
    const idx = this.couplings.findIndex(
      (c) => c.from.participantId === from.participantId && c.from.variableName === from.variableName,
    );
    if (idx >= 0) this.couplings.splice(idx, 1);
  }

  /** Get all couplings. */
  getAll(): readonly VariableCoupling[] {
    return this.couplings;
  }

  /** Get all couplings where the given participant is the source (output). */
  getOutputCouplings(participantId: string): VariableCoupling[] {
    return this.couplings.filter((c) => c.from.participantId === participantId);
  }

  /** Get all couplings where the given participant is the target (input). */
  getInputCouplings(participantId: string): VariableCoupling[] {
    return this.couplings.filter((c) => c.to.participantId === participantId);
  }

  /**
   * Validate unit compatibility across all couplings.
   * Returns a list of warnings/errors for mismatched units.
   */
  validateUnits(): UnitWarning[] {
    const warnings: UnitWarning[] = [];

    for (const coupling of this.couplings) {
      const fromUnit = coupling.from.unit;
      const toUnit = coupling.to.unit;

      // Skip if either side has no unit metadata
      if (!fromUnit || !toUnit) continue;

      // Exact match — no issue
      if (fromUnit === toUnit) continue;

      const fromLabel = `${coupling.from.participantId}.${coupling.from.variableName}`;
      const toLabel = `${coupling.to.participantId}.${coupling.to.variableName}`;

      // Check if units are in the same dimension family (potentially convertible)
      if (areUnitsConvertible(fromUnit, toUnit)) {
        warnings.push({
          severity: "warning",
          from: fromLabel,
          to: toLabel,
          fromUnit,
          toUnit,
          message: `Unit mismatch: '${fromUnit}' → '${toUnit}' (auto-conversion may be needed)`,
        });
      } else {
        warnings.push({
          severity: "error",
          from: fromLabel,
          to: toLabel,
          fromUnit,
          toUnit,
          message: `Incompatible units: '${fromUnit}' cannot be connected to '${toUnit}'`,
        });
      }
    }

    return warnings;
  }

  /**
   * Apply coupling values: given a map of all participant outputs,
   * produce a map of participant ID → input values to inject.
   */
  applyCouplings(allOutputs: Map<string, Map<string, CosimValue>>): Map<string, Map<string, CosimValue>> {
    const inputs = new Map<string, Map<string, CosimValue>>();

    for (const coupling of this.couplings) {
      const sourceOutputs = allOutputs.get(coupling.from.participantId);
      if (!sourceOutputs) continue;

      const value = sourceOutputs.get(coupling.from.variableName);
      if (value === undefined) continue;

      let targetInputs = inputs.get(coupling.to.participantId);
      if (!targetInputs) {
        targetInputs = new Map<string, CosimValue>();
        inputs.set(coupling.to.participantId, targetInputs);
      }
      targetInputs.set(coupling.to.variableName, value);
    }

    return inputs;
  }

  /** Clear all couplings. */
  clear(): void {
    this.couplings.length = 0;
  }
}

// ── Unit compatibility checking ──

/**
 * Groups of units that share the same physical dimension and can be converted.
 * Each sub-array contains unit strings that are dimensionally compatible.
 */
const UNIT_DIMENSION_FAMILIES: readonly string[][] = [
  // Length
  ["m", "km", "cm", "mm", "um", "nm", "in", "ft", "yd", "mi"],
  // Time
  ["s", "ms", "us", "min", "h", "d"],
  // Mass
  ["kg", "g", "mg", "lb", "oz", "t"],
  // Temperature
  ["K", "degC", "degF", "degR"],
  // Angle
  ["rad", "deg", "rev", "grad"],
  // Force
  ["N", "kN", "MN", "lbf", "dyn"],
  // Pressure
  ["Pa", "kPa", "MPa", "bar", "atm", "psi", "mmHg", "torr"],
  // Energy
  ["J", "kJ", "MJ", "cal", "kcal", "Wh", "kWh", "eV", "Btu"],
  // Power
  ["W", "kW", "MW", "hp"],
  // Velocity
  ["m/s", "km/h", "mph", "kn", "ft/s"],
  // Voltage
  ["V", "mV", "kV"],
  // Current
  ["A", "mA", "uA", "kA"],
  // Resistance
  ["Ohm", "kOhm", "MOhm"],
  // Capacitance
  ["F", "uF", "nF", "pF", "mF"],
  // Inductance
  ["H", "mH", "uH"],
  // Frequency
  ["Hz", "kHz", "MHz", "GHz", "1/s"],
  // Torque
  ["N.m", "N*m"],
  // Angular velocity
  ["rad/s", "rpm", "deg/s"],
  // Volume
  ["m3", "L", "mL", "cm3", "gal", "ft3"],
  // Flow rate
  ["m3/s", "L/s", "L/min", "gal/min"],
  // Amount of substance
  ["mol", "mmol", "kmol"],
];

/**
 * Check if two unit strings are potentially convertible (same dimension family).
 */
function areUnitsConvertible(unit1: string, unit2: string): boolean {
  const norm1 = unit1.trim();
  const norm2 = unit2.trim();

  for (const family of UNIT_DIMENSION_FAMILIES) {
    const has1 = family.includes(norm1);
    const has2 = family.includes(norm2);
    if (has1 && has2) return true;
    // If only one is in a family, they're incompatible
    if (has1 || has2) return false;
  }

  // Both units unknown — we can't determine compatibility, assume convertible
  // to avoid false positives on custom/derived units
  return true;
}
