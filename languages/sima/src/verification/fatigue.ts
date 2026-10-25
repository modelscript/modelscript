// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * ASTM E1049-85 Rainflow Cycle Counting & Palmgren-Miner Cumulative Fatigue Damage Engine.
 *
 * Implements standard offshore mooring line and dynamic riser fatigue evaluation:
 *   1. Rainflow cycle extraction (ASTM E1049 4-point/3-point reversal algorithm).
 *   2. Palmgren-Miner cumulative fatigue damage: D = DFF * sum(n_i / N_i).
 *   3. S-N curve database matching DNV-OS-E301 / DNV-RP-F205 / API RP 2SK.
 */

export interface RainflowCycle {
  range: number; // stress or tension range (peak - valley)
  mean: number; // mean value
  count: number; // 0.5 for half cycle, 1.0 for full cycle
}

export interface SnCurveParameters {
  name: string;
  m: number; // S-N curve negative inverse slope
  log10K: number; // intercept parameter log10(K) where N * S^m = K
}

export const DNV_SN_CURVES: Record<string, SnCurveParameters> = {
  studless_chain: {
    name: "DNV Studless Mooring Chain",
    m: 3.0,
    log10K: 11.6, // K = 3.98e11 (MPa units)
  },
  studlink_chain: {
    name: "DNV Stud Link Mooring Chain",
    m: 3.0,
    log10K: 11.5, // K = 3.16e11 (MPa units)
  },
  spiral_strand_wire: {
    name: "DNV Spiral Strand Steel Wire Rope",
    m: 4.09,
    log10K: 13.9,
  },
  six_strand_wire: {
    name: "DNV Six-Strand Steel Wire Rope",
    m: 3.2,
    log10K: 11.8,
  },
  polyester: {
    name: "DNV Synthetic Polyester Rope (Tension-Tension)",
    m: 6.7,
    log10K: 16.5,
  },
};

/**
 * Extracts turning points (local extrema: alternating peaks and valleys) from a continuous time series.
 */
export function extractTurningPoints(series: number[]): number[] {
  if (series.length < 3) return [...series];
  const s0 = series[0];
  const s1 = series[1];
  if (s0 === undefined || s1 === undefined) return [];

  const extrema: number[] = [s0];
  let lastDiff = s1 - s0;

  for (let i = 1; i < series.length - 1; i++) {
    const cur = series[i];
    const next = series[i + 1];
    if (cur === undefined || next === undefined) continue;

    const currentDiff = next - cur;
    if ((lastDiff > 0 && currentDiff < 0) || (lastDiff < 0 && currentDiff > 0)) {
      extrema.push(cur);
      lastDiff = currentDiff;
    } else if (lastDiff === 0 && currentDiff !== 0) {
      lastDiff = currentDiff;
    }
  }

  const lastPt = series[series.length - 1];
  if (lastPt !== undefined) {
    extrema.push(lastPt);
  }
  return extrema;
}

/**
 * Standard ASTM E1049-85 Rainflow Cycle Counting on discrete time history.
 */
export function rainflowCount(series: number[]): RainflowCycle[] {
  const points = extractTurningPoints(series);
  if (points.length < 2) return [];

  const cycles: RainflowCycle[] = [];
  const stack: number[] = [];

  for (const pt of points) {
    stack.push(pt);

    while (stack.length >= 3) {
      const n = stack.length;
      const s0 = stack[n - 3];
      const s1 = stack[n - 2];
      const s2 = stack[n - 1];

      if (s0 === undefined || s1 === undefined || s2 === undefined) break;

      const r1 = Math.abs(s1 - s0);
      const r2 = Math.abs(s2 - s1);

      if (r2 >= r1) {
        // Form a full cycle between s0 and s1
        const range = r1;
        const mean = 0.5 * (s0 + s1);
        cycles.push({ range, mean, count: 1.0 });

        // Remove s0 and s1, keeping s2
        stack.splice(n - 3, 2);
      } else {
        break;
      }
    }
  }

  // Count remaining residues on stack as half-cycles
  for (let i = 0; i < stack.length - 1; i++) {
    const p1 = stack[i];
    const p2 = stack[i + 1];
    if (p1 === undefined || p2 === undefined) continue;

    const range = Math.abs(p2 - p1);
    const mean = 0.5 * (p1 + p2);
    if (range > 1e-6) {
      cycles.push({ range, mean, count: 0.5 });
    }
  }

  return cycles;
}

export interface FatigueEvaluationParams {
  timeSeries: number[]; // tension (N) or stress (MPa)
  simDurationSeconds: number; // time span of signal
  curve?: SnCurveParameters | keyof typeof DNV_SN_CURVES;
  nominalAreaM2?: number; // cross-section area to convert tension N to MPa (default 1.0 if series already in MPa)
  designFatigueFactor?: number; // DFF (default 2.5 per DNV-OS-E301)
  designLifeYears?: number; // target service life (default 25 years)
}

export interface FatigueEvaluationResult {
  totalCycles: number;
  maxStressRange: number;
  cumulativeDamageSim: number; // damage during simulation period
  annualDamage: number; // extrapolated annual damage
  designLifeDamage: number; // damage over designLifeYears
  estimatedLifeYears: number; // 1 / annualDamage
  passed: boolean; // designLifeDamage <= 1.0
  cycles: RainflowCycle[];
  snCurve: SnCurveParameters;
}

/**
 * Calculates cumulative Palmgren-Miner fatigue damage D = DFF * sum(n_i / N_i).
 */
export function computeFatigueDamage(params: FatigueEvaluationParams): FatigueEvaluationResult {
  const dff = params.designFatigueFactor ?? 2.5;
  const designLifeYears = params.designLifeYears ?? 25.0;
  const area = params.nominalAreaM2 ?? 1.0;

  const defaultCurve = DNV_SN_CURVES["studless_chain"] ?? {
    name: "DNV Studless Mooring Chain",
    m: 3.0,
    log10K: 11.6,
  };

  const snCurve: SnCurveParameters =
    typeof params.curve === "string" ? (DNV_SN_CURVES[params.curve] ?? defaultCurve) : (params.curve ?? defaultCurve);

  // Convert tension time series to stress (MPa) if area is provided and series values are large (N)
  const stressSeries = params.timeSeries.map((val) => {
    if (params.nominalAreaM2) {
      return (val / area) * 1e-6; // N/m^2 -> MPa
    }
    return val;
  });

  const cycles = rainflowCount(stressSeries);
  const K = Math.pow(10, snCurve.log10K);
  const m = snCurve.m;

  let totalSimDamage = 0;
  let maxRange = 0;
  let totalCycles = 0;

  for (const c of cycles) {
    if (c.range <= 0) continue;
    totalCycles += c.count;
    if (c.range > maxRange) maxRange = c.range;

    // Number of cycles to failure: N_i = K / (range)^m
    const N_i = K / Math.pow(c.range, m);
    if (N_i > 0) {
      totalSimDamage += c.count / N_i;
    }
  }

  // Factor in Design Fatigue Factor (DFF)
  totalSimDamage *= dff;

  const secondsPerYear = 365.25 * 86400;
  const simFractionOfYear = Math.max(1, params.simDurationSeconds) / secondsPerYear;
  const annualDamage = totalSimDamage / simFractionOfYear;
  const designLifeDamage = annualDamage * designLifeYears;
  const estimatedLifeYears = annualDamage > 0 ? 1.0 / annualDamage : 9999;
  const passed = designLifeDamage <= 1.0;

  return {
    totalCycles,
    maxStressRange: maxRange,
    cumulativeDamageSim: totalSimDamage,
    annualDamage,
    designLifeDamage,
    estimatedLifeYears,
    passed,
    cycles,
    snCurve,
  };
}
