// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/atopile — Worst-Case Corner & Monte Carlo Tolerance UQ Engine.
 *
 * Propagates atopile physical tolerances (`10kohm +/- 1%`, `3.3V to 3.6V`)
 * across component parameters using deterministic PRNG Monte Carlo sampling
 * and worst-case interval arithmetic.
 */

import type { AtoFile, AtoPhysicalValue } from "./types.js";

export interface ParameterUncertainty {
  target: string;
  nominal: number;
  min: number;
  max: number;
  unit: string;
}

export interface AtopileUQMetric {
  name: string;
  unit: string;
  nominal: number;
  worstCaseMin: number;
  worstCaseMax: number;
  mcMean: number;
  mcStdDev: number;
  samples: number;
}

export interface AtopileUQReport {
  moduleName: string;
  parameters: ParameterUncertainty[];
  metrics: AtopileUQMetric[];
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function summarize(
  name: string,
  unit: string,
  nominal: number,
  wcMin: number,
  wcMax: number,
  vals: number[],
): AtopileUQMetric {
  const n = vals.length || 1;
  const mean = vals.reduce((a, b) => a + b, 0) / n;
  const variance = vals.reduce((a, b) => a + (b - mean) * (b - mean), 0) / n;
  return {
    name,
    unit,
    nominal,
    worstCaseMin: wcMin,
    worstCaseMax: wcMax,
    mcMean: mean,
    mcStdDev: Math.sqrt(variance),
    samples: vals.length,
  };
}

/**
 * Runs worst-case corner and Monte Carlo tolerance UQ over all physical
 * parameters in an `.ato` module (automatically computing RC cutoff frequency
 * $f_c = 1/(2\pi R C)$ and resistive divider ratio when R/C pairs exist).
 */
export function runAtopileToleranceUQ(
  file: AtoFile,
  options?: { entryModule?: string; samples?: number; seed?: number },
): AtopileUQReport {
  const mod =
    (options?.entryModule ? file.blocks.find((b) => b.name === options.entryModule) : undefined) ??
    file.blocks.find((b) => b.kind === "module") ??
    file.blocks[0];

  if (!mod) return { moduleName: "", parameters: [], metrics: [] };

  const samples = options?.samples ?? 500;
  const rng = mulberry32(options?.seed ?? 42);

  const parameters: ParameterUncertainty[] = [];
  const resistors: AtoPhysicalValue[] = [];
  const capacitors: AtoPhysicalValue[] = [];

  for (const a of mod.assignments) {
    if (!a.physicalValue) continue;
    const pv = a.physicalValue;
    parameters.push({ target: a.target, nominal: pv.nominal, min: pv.min, max: pv.max, unit: pv.unit });
    if (pv.unit === "ohm" || a.target.endsWith(".resistance")) resistors.push(pv);
    if (pv.unit === "F" || a.target.endsWith(".capacitance")) capacitors.push(pv);
  }

  const metrics: AtopileUQMetric[] = [];

  // RC cutoff frequency f_c = 1 / (2 * pi * R * C)
  if (resistors.length >= 1 && capacitors.length >= 1) {
    const r = resistors[0]!;
    const c = capacitors[0]!;
    const nomFc = 1 / (2 * Math.PI * r.nominal * c.nominal);
    const wcMin = 1 / (2 * Math.PI * r.max * c.max);
    const wcMax = 1 / (2 * Math.PI * r.min * c.min);
    const mcVals: number[] = [];
    for (let i = 0; i < samples; i++) {
      const rv = r.min + rng() * (r.max - r.min);
      const cv = c.min + rng() * (c.max - c.min);
      mcVals.push(1 / (2 * Math.PI * rv * cv));
    }
    metrics.push(summarize("rc_cutoff_freq", "Hz", nomFc, wcMin, wcMax, mcVals));
  }

  // Voltage divider gain G = R2 / (R1 + R2)
  if (resistors.length >= 2) {
    const r1 = resistors[0]!;
    const r2 = resistors[1]!;
    const nomG = r2.nominal / (r1.nominal + r2.nominal);
    const wcMin = r2.min / (r1.max + r2.min);
    const wcMax = r2.max / (r1.min + r2.max);
    const mcVals: number[] = [];
    for (let i = 0; i < samples; i++) {
      const rv1 = r1.min + rng() * (r1.max - r1.min);
      const rv2 = r2.min + rng() * (r2.max - r2.min);
      mcVals.push(rv2 / (rv1 + rv2));
    }
    metrics.push(summarize("divider_ratio", "", nomG, wcMin, wcMax, mcVals));
  }

  return { moduleName: mod.name, parameters, metrics };
}
