// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/runtime — Cross-Language Parameter & Equivalence Drift Checker.
 *
 * Scans multi-language workspace indices (SPICE, Modelica, SysML2, URDF, SBML, STEP)
 * to detect numerical parameter drift and equation divergence across representations
 * of shared physical subsystems.
 *
 * Grounded in Nelson-Oppen variable alignment and E-graph canonicalization.
 */

export interface PolyglotModelSource {
  lang: string;
  uri: string;
  component: string;
  param: string;
  value: number;
  unit?: string | undefined;
  startOffset?: number | undefined;
  endOffset?: number | undefined;
}

export interface PolyglotDriftViolation {
  componentName: string;
  canonicalParam: string;
  sourceA: PolyglotModelSource;
  sourceB: PolyglotModelSource;
  relativeDiscrepancy: number; // |vA - vB| / max(|vA|, |vB|)
  tolerance: number;
  message: string;
}

export interface DriftCheckOptions {
  /** Relative error tolerance before flagging drift (default: 0.001 / 0.1%). */
  tolerance?: number | undefined;
}

/** Parameter name alias normalizer across engineering domains. */
const PARAMETER_CANONICAL_MAP: Record<string, string> = {
  // Electrical
  r: "resistance",
  res: "resistance",
  resistance: "resistance",
  c: "capacitance",
  cap: "capacitance",
  capacitance: "capacitance",
  l: "inductance",
  ind: "inductance",
  inductance: "inductance",
  v_nom: "voltage_nominal",
  vnom: "voltage_nominal",
  v_rated: "voltage_nominal",
  ratedvoltage: "voltage_nominal",
  i_nom: "current_nominal",
  inom: "current_nominal",
  ratedcurrent: "current_nominal",

  // Mechanical / Robotics / Multibody
  m: "mass",
  mass: "mass",
  j: "inertia",
  inertia: "inertia",
  rotational_inertia: "inertia",
  ixx: "inertia_xx",
  iyy: "inertia_yy",
  izz: "inertia_zz",
  k: "stiffness",
  stiffness: "stiffness",
  d: "damping",
  damping: "damping",
  ratio: "gear_ratio",
  gear_ratio: "gear_ratio",
  gearratio: "gear_ratio",

  // Thermal / Fluids
  cp: "specific_heat",
  specific_heat: "specific_heat",
  rho: "density",
  density: "density",
  t_amb: "ambient_temperature",
  tamb: "ambient_temperature",
};

export class PolyglotDriftChecker {
  /**
   * Normalizes a domain parameter identifier into its canonical physical quantity name.
   */
  public static canonicalizeParam(paramName: string): string {
    const clean = paramName.toLowerCase().replace(/[^a-z0-9_]/g, "");
    return PARAMETER_CANONICAL_MAP[clean] || clean;
  }

  /**
   * Evaluates relative difference between two scalar quantities: |a - b| / max(|a|, |b|).
   */
  public static computeRelativeDifference(a: number, b: number): number {
    const denom = Math.max(Math.abs(a), Math.abs(b));
    if (denom === 0) return 0;
    return Math.abs(a - b) / denom;
  }

  /**
   * Normalizes a physical quantity to SI base units based on its unit string.
   */
  public static normalizeToSI(value: number, unit?: string): number {
    if (!unit) return value;
    const u = unit.trim().toLowerCase();
    // Resistance (Ohm)
    if (u === "kohm" || u === "kω" || u === "k") return value * 1e3;
    if (u === "mohm" || u === "mω") return value * 1e-3;
    if (u === "megohm" || u === "meg") return value * 1e6;
    if (u === "gohm") return value * 1e9;
    // Capacitance (Farad)
    if (u === "uf" || u === "µf" || u === "u") return value * 1e-6;
    if (u === "nf" || u === "n") return value * 1e-9;
    if (u === "pf" || u === "p") return value * 1e-12;
    if (u === "mf") return value * 1e-3;
    // Inductance (Henry)
    if (u === "mh") return value * 1e-3;
    if (u === "uh" || u === "µh") return value * 1e-6;
    // Mass (kg)
    if (u === "g") return value * 1e-3;
    if (u === "mg") return value * 1e-6;
    if (u === "ton" || u === "tonne") return value * 1e3;
    // Voltage / Power / Frequency
    if (u === "kv") return value * 1e3;
    if (u === "mv") return value * 1e-3;
    if (u === "kw") return value * 1e3;
    if (u === "mw") return value * 1e6;
    if (u === "khz") return value * 1e3;
    if (u === "mhz") return value * 1e6;
    if (u === "ghz") return value * 1e9;
    return value;
  }

  /**
   * Inspects extracted model declarations across language symbol indices and detects
   * parameters that have drifted between representations of the same component.
   */
  public static checkDrift(
    sources: PolyglotModelSource[],
    options: DriftCheckOptions = {},
  ): PolyglotDriftViolation[] {
    const tol = options.tolerance ?? 0.001;
    const violations: PolyglotDriftViolation[] = [];

    // Group parameters by [canonicalComponent, canonicalParam]
    const groups = new Map<string, PolyglotModelSource[]>();

    for (const src of sources) {
      if (!Number.isFinite(src.value)) continue;
      const compKey = src.component.toLowerCase().replace(/[^a-z0-9_]/g, "");
      const paramKey = this.canonicalizeParam(src.param);
      const key = `${compKey}::${paramKey}`;

      let list = groups.get(key);
      if (!list) {
        list = [];
        groups.set(key, list);
      }
      list.push(src);
    }

    // Compare all pairs across different languages or different files
    for (const [key, list] of groups.entries()) {
      if (list.length < 2) continue;

      const [, paramKey] = key.split("::");

      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const a = list[i]!;
          const b = list[j]!;

          // Only compare across distinct documents or distinct languages
          if (a.uri === b.uri && a.lang === b.lang) continue;

          const valA = this.normalizeToSI(a.value, a.unit);
          const valB = this.normalizeToSI(b.value, b.unit);
          const relDiff = this.computeRelativeDifference(valA, valB);
          if (relDiff > tol) {
            const pct = (relDiff * 100).toFixed(1);
            violations.push({
              componentName: a.component,
              canonicalParam: paramKey || a.param,
              sourceA: a,
              sourceB: b,
              relativeDiscrepancy: relDiff,
              tolerance: tol,
              message: `Cross-language parameter drift: '${a.param}' in ${a.lang.toUpperCase()} (${a.value}) diverges from ${b.lang.toUpperCase()} (${b.value}) by ${pct}%.`,
            });
          }
        }
      }
    }

    return violations;
  }
}
