// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Variable coupling graph for co-simulation.
 *
 * Defines which output variables from one participant feed into
 * which input variables of another participant.
 */

/**
 * Value type for co-simulation variable exchange.
 * Supports FMI 2.0/3.0 scalar types: Real, Integer, Boolean, String, and Binary (Uint8Array).
 */
export type CosimValue = number | string | boolean | Uint8Array;

export type CouplingInterpolationMode = "ZERO_ORDER_HOLD" | "LINEAR" | "HERMITE";

export interface ConjugatePowerPair {
  effortVariable: string;
  flowVariable: string;
}

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
  /** Multi-rate interpolation / extrapolation method across communication steps. */
  interpolation?: CouplingInterpolationMode | undefined;
  /** Optional conjugate power pair (e.g. effort * flow) for interface energy tracking. */
  conjugatePair?: ConjugatePowerPair | undefined;
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

/** Point in continuous time history for Hermite polynomial interpolation. */
export interface HistoryPoint {
  time: number;
  value: number;
  derivative?: number | undefined;
}

/**
 * Cubic Hermite polynomial interpolator / extrapolator for multi-rate co-simulation.
 * Eliminates discontinuous stair-step shocks of Zero-Order Hold (ZOH) across communication intervals.
 */
export class HermiteInterpolator {
  private readonly history: HistoryPoint[] = [];

  get lastTime(): number | undefined {
    return this.history.length > 0 ? this.history[this.history.length - 1]!.time : undefined;
  }

  addPoint(time: number, value: number, derivative?: number): void {
    if (this.history.length > 0) {
      const last = this.history[this.history.length - 1]!;
      if (Math.abs(last.time - time) < 1e-12) {
        last.value = value;
        if (derivative !== undefined) last.derivative = derivative;
        return;
      }
    }
    this.history.push({ time, value, derivative });
    if (this.history.length > 16) {
      this.history.shift();
    }
  }

  evaluate(t: number): number {
    const n = this.history.length;
    if (n === 0) return 0.0;
    if (n === 1) return this.history[0]!.value;

    const pLast = this.history[n - 1]!;
    const pPrev = this.history[n - 2]!;

    if (t >= pLast.time) {
      const dt = t - pLast.time;
      const d = pLast.derivative ?? (pLast.value - pPrev.value) / Math.max(1e-9, pLast.time - pPrev.time);
      return pLast.value + d * dt;
    }

    if (t <= this.history[0]!.time) {
      return this.history[0]!.value;
    }

    let idx = 0;
    for (let i = 0; i < n - 1; i++) {
      if (t >= this.history[i]!.time && t <= this.history[i + 1]!.time) {
        idx = i;
        break;
      }
    }

    const p0 = this.history[idx]!;
    const p1 = this.history[idx + 1]!;
    const h = p1.time - p0.time;
    if (h < 1e-12) return p0.value;

    const s = (t - p0.time) / h;
    const s2 = s * s;
    const s3 = s2 * s;

    const d0 = p0.derivative ?? (p1.value - p0.value) / h;
    const d1 = p1.derivative ?? (p1.value - p0.value) / h;

    const h00 = 2 * s3 - 3 * s2 + 1;
    const h10 = s3 - 2 * s2 + s;
    const h01 = -2 * s3 + 3 * s2;
    const h11 = s3 - s2;

    return h00 * p0.value + h10 * h * d0 + h01 * p1.value + h11 * h * d1;
  }

  clear(): void {
    this.history.length = 0;
  }
}

/** Metrics evaluating energy flow and passivity across a coupled interface. */
export interface PassivityMetrics {
  effort: number;
  flow: number;
  instantaneousPowerWatts: number;
  accumulatedEnergyJoules: number;
  energyInjectedJoules: number;
  isPassive: boolean;
  passivityIndex: number;
}

/**
 * Energy-preserving Passivity Observer (PO) for cyber-physical co-simulation.
 * Monitors effort-flow conjugate pairs to detect non-physical active energy generation.
 */
export class PassivityObserver {
  private totalEnergyJoules = 0.0;
  private energyInjectedJoules = 0.0;
  private peakPowerWatts = 0.0;
  private prevTime = 0.0;
  private prevPower = 0.0;
  private initialized = false;

  step(time: number, effort: number, flow: number): PassivityMetrics {
    const power = effort * flow;
    if (Math.abs(power) > this.peakPowerWatts) {
      this.peakPowerWatts = Math.abs(power);
    }

    if (!this.initialized) {
      this.prevTime = time;
      this.prevPower = power;
      this.initialized = true;
    } else {
      const dt = Math.max(0.0, time - this.prevTime);
      const dE = 0.5 * (power + this.prevPower) * dt;
      this.totalEnergyJoules += dE;

      if (this.totalEnergyJoules < 0) {
        this.energyInjectedJoules = Math.abs(this.totalEnergyJoules);
      }

      this.prevTime = time;
      this.prevPower = power;
    }

    const isPassive = this.totalEnergyJoules >= -1e-6;
    const passivityIndex =
      this.peakPowerWatts > 0
        ? Math.max(0.0, this.totalEnergyJoules / (this.peakPowerWatts * Math.max(1e-3, time)))
        : 1.0;

    return {
      effort,
      flow,
      instantaneousPowerWatts: power,
      accumulatedEnergyJoules: this.totalEnergyJoules,
      energyInjectedJoules: this.energyInjectedJoules,
      isPassive,
      passivityIndex,
    };
  }

  reset(): void {
    this.totalEnergyJoules = 0.0;
    this.energyInjectedJoules = 0.0;
    this.peakPowerWatts = 0.0;
    this.prevTime = 0.0;
    this.prevPower = 0.0;
    this.initialized = false;
  }
}

/**
 * Coupling graph that manages variable interconnections between participants.
 */
export class CouplingGraph {
  private readonly couplings: VariableCoupling[] = [];
  private readonly interpolators = new Map<string, HermiteInterpolator>();
  private readonly passivityObservers = new Map<string, PassivityObserver>();

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

  /** Gets an interpolator for a source variable if one exists. */
  getInterpolator(participantId: string, variableName: string): HermiteInterpolator | undefined {
    return this.interpolators.get(`${participantId}.${variableName}`);
  }

  /** Gets a passivity observer by connection key. */
  getPassivityObserver(key: string): PassivityObserver | undefined {
    return this.passivityObservers.get(key);
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
  applyCouplings(
    allOutputs: Map<string, Map<string, CosimValue>>,
    currentTime?: number,
  ): Map<string, Map<string, CosimValue>> {
    const inputs = new Map<string, Map<string, CosimValue>>();

    for (const coupling of this.couplings) {
      const sourceOutputs = allOutputs.get(coupling.from.participantId);
      if (!sourceOutputs) continue;

      let value = sourceOutputs.get(coupling.from.variableName);
      if (value === undefined) continue;

      const key = `${coupling.from.participantId}.${coupling.from.variableName}`;

      // If numeric and time is provided, update multi-rate Hermite interpolator
      if (typeof value === "number" && currentTime !== undefined) {
        let interp = this.interpolators.get(key);
        if (!interp) {
          interp = new HermiteInterpolator();
          this.interpolators.set(key, interp);
        }
        if (interp.lastTime === undefined || currentTime >= interp.lastTime) {
          interp.addPoint(currentTime, value);
        }

        if (coupling.interpolation === "HERMITE") {
          value = interp.evaluate(currentTime);
        }

        // Energy-preserving passivity observation
        if (coupling.conjugatePair) {
          const effortVal = sourceOutputs.get(coupling.conjugatePair.effortVariable);
          const flowVal = sourceOutputs.get(coupling.conjugatePair.flowVariable);
          if (typeof effortVal === "number" && typeof flowVal === "number") {
            const passKey = `${coupling.from.participantId}->${coupling.to.participantId}`;
            let passObs = this.passivityObservers.get(passKey);
            if (!passObs) {
              passObs = new PassivityObserver();
              this.passivityObservers.set(passKey, passObs);
            }
            passObs.step(currentTime, effortVal, flowVal);
          }
        }
      }

      // Auto-convert units if both sides have unit metadata and they differ
      const fromUnit = coupling.from.unit;
      const toUnit = coupling.to.unit;
      if (fromUnit && toUnit && fromUnit !== toUnit && typeof value === "number") {
        value = convertUnit(value, fromUnit, toUnit);
      }

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
    this.interpolators.clear();
    this.passivityObservers.clear();
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

// ── Unit conversion ──

/**
 * Conversion factors from each unit to the SI base unit of its dimension.
 * To convert from unit A to unit B: value * (toSI[A] / toSI[B]).
 */
const UNIT_TO_SI: Record<string, number> = {
  // Angle: base = rad
  rad: 1,
  deg: Math.PI / 180,
  rev: 2 * Math.PI,
  grad: Math.PI / 200,
  // Temperature: base = K (only offset-free scaling; degC/degF need affine)
  K: 1,
  // Length: base = m
  m: 1,
  km: 1000,
  cm: 0.01,
  mm: 0.001,
  um: 1e-6,
  nm: 1e-9,
  in: 0.0254,
  ft: 0.3048,
  yd: 0.9144,
  mi: 1609.344,
  // Time: base = s
  s: 1,
  ms: 0.001,
  us: 1e-6,
  min: 60,
  h: 3600,
  d: 86400,
  // Mass: base = kg
  kg: 1,
  g: 0.001,
  mg: 1e-6,
  lb: 0.453592,
  oz: 0.0283495,
  t: 1000,
  // Force: base = N
  N: 1,
  kN: 1000,
  MN: 1e6,
  lbf: 4.44822,
  dyn: 1e-5,
  // Pressure: base = Pa
  Pa: 1,
  kPa: 1000,
  MPa: 1e6,
  bar: 1e5,
  atm: 101325,
  psi: 6894.76,
  mmHg: 133.322,
  torr: 133.322,
  // Energy: base = J
  J: 1,
  kJ: 1000,
  MJ: 1e6,
  cal: 4.184,
  kcal: 4184,
  Wh: 3600,
  kWh: 3.6e6,
  eV: 1.602e-19,
  Btu: 1055.06,
  // Power: base = W
  W: 1,
  kW: 1000,
  MW: 1e6,
  hp: 745.7,
  // Velocity: base = m/s
  "m/s": 1,
  "km/h": 1 / 3.6,
  mph: 0.44704,
  kn: 0.514444,
  "ft/s": 0.3048,
  // Voltage: base = V
  V: 1,
  mV: 0.001,
  kV: 1000,
  // Current: base = A
  A: 1,
  mA: 0.001,
  uA: 1e-6,
  kA: 1000,
  // Resistance: base = Ohm
  Ohm: 1,
  kOhm: 1000,
  MOhm: 1e6,
  // Capacitance: base = F
  F: 1,
  mF: 0.001,
  uF: 1e-6,
  nF: 1e-9,
  pF: 1e-12,
  // Inductance: base = H
  H: 1,
  mH: 0.001,
  uH: 1e-6,
  // Frequency: base = Hz
  Hz: 1,
  kHz: 1000,
  MHz: 1e6,
  GHz: 1e9,
  "1/s": 1,
  // Angular velocity: base = rad/s
  "rad/s": 1,
  rpm: (2 * Math.PI) / 60,
  "deg/s": Math.PI / 180,
  // Volume: base = m3
  m3: 1,
  L: 0.001,
  mL: 1e-6,
  cm3: 1e-6,
  gal: 0.00378541,
  ft3: 0.0283168,
  // Flow rate: base = m3/s
  "m3/s": 1,
  "L/s": 0.001,
  "L/min": 0.001 / 60,
  "gal/min": 0.00378541 / 60,
  // Amount of substance: base = mol
  mol: 1,
  mmol: 0.001,
  kmol: 1000,
};

/**
 * Convert a numeric value between two compatible units.
 * Returns the original value if conversion is not possible.
 */
export function convertUnit(value: number, fromUnit: string, toUnit: string): number {
  if (fromUnit === toUnit) return value;
  const fromFactor = UNIT_TO_SI[fromUnit.trim()];
  const toFactor = UNIT_TO_SI[toUnit.trim()];
  if (fromFactor !== undefined && toFactor !== undefined) {
    return value * (fromFactor / toFactor);
  }
  // Unknown units — pass through unchanged
  return value;
}
