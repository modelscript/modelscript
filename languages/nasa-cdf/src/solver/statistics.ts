// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/nasa-cdf — ISTP Space-Physics Time-Series Statistics & Vector Field Solver.
 *
 * Computes:
 * - Per-channel telemetry statistics (count, validCount, fillCount, min, max, mean, stdDev, rms, p50, p95)
 * - Magnetic-field vector magnitude `|B| = sqrt(Bx^2 + By^2 + Bz^2)`
 * - Plasma beta `beta = (n * kB * T) / (B^2 / (2 * mu0))`
 * - Alfven speed `vA = |B| / sqrt(mu0 * n * m_p)`
 */

import type { CdfDocument, CdfVariable } from "../types.js";
import { cdfEpochToIso, parseTimeValueToCdfEpoch } from "./epoch.js";

/** Vacuum permeability mu_0 (T*m/A). */
export const MU_0 = 4.0 * Math.PI * 1e-7;
/** Boltzmann constant k_B (J/K). */
export const K_BOLTZMANN = 1.380649e-23;
/** Proton mass m_p (kg). */
export const PROTON_MASS_KG = 1.67262192369e-27;

export interface ChannelStatistics {
  name: string;
  units: string;
  count: number;
  validCount: number;
  fillCount: number;
  min: number;
  max: number;
  mean: number;
  stdDev: number;
  rms: number;
  p50: number;
  p95: number;
}

export interface VectorFieldSummary {
  sourceVariable: string;
  magnitudes: number[];
  stats: ChannelStatistics;
}

export interface NasaCdfTelemetrySummary {
  fileName: string;
  epochVariable?: string | undefined;
  recordCount: number;
  startIso?: string | undefined;
  stopIso?: string | undefined;
  cadenceSeconds?: number | undefined;
  channels: ChannelStatistics[];
  magneticField?: VectorFieldSummary | undefined;
}

/**
 * Computes magnetic-field vector magnitude `|B| = sqrt(Bx^2 + By^2 + Bz^2)`.
 */
export function computeMagneticFieldMagnitude(bx: number, by: number, bz: number): number {
  return Math.hypot(bx, by, bz);
}

/**
 * Computes `|B|` magnitude series for an array of 3-component magnetic-field vectors.
 */
export function computeVectorNormSeries(vectors: ReadonlyArray<readonly [number, number, number]>): number[] {
  return vectors.map(([bx, by, bz]) => Math.hypot(bx, by, bz));
}

/**
 * Computes plasma beta `beta = (n * kB * T) / (B^2 / (2 * mu0))`.
 *
 * @param densityM3 Proton number density in m^-3
 * @param temperatureK Proton temperature in Kelvin
 * @param bMagnitudeTesla Magnetic field magnitude in Tesla
 */
export function computePlasmaBeta(densityM3: number, temperatureK: number, bMagnitudeTesla: number): number {
  const bSq = bMagnitudeTesla * bMagnitudeTesla;
  if (bSq <= 0) return Number.POSITIVE_INFINITY;
  const pThermal = densityM3 * K_BOLTZMANN * temperatureK;
  const pMagnetic = bSq / (2.0 * MU_0);
  return pThermal / pMagnetic;
}

/**
 * Computes Alfven speed `vA = |B| / sqrt(mu0 * n * m_p)` in m/s.
 */
export function computeAlfvenSpeed(bMagnitudeTesla: number, densityM3: number): number {
  const denom = Math.sqrt(MU_0 * densityM3 * PROTON_MASS_KG);
  if (denom <= 0) return 0;
  return bMagnitudeTesla / denom;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return Number.NaN;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((p / 100) * (sorted.length - 1))));
  return sorted[idx]!;
}

/**
 * Computes ISTP time-series statistics on a numeric sample array, excluding `fillVal` and non-finite values.
 */
export function computeChannelStats(
  name: string,
  samples: ReadonlyArray<number>,
  options: { units?: string | undefined; fillVal?: number | undefined } = {},
): ChannelStatistics {
  const units = options.units ?? "";
  const fillVal = options.fillVal;

  const valid: number[] = [];
  let fillCount = 0;

  for (const v of samples) {
    if (!Number.isFinite(v)) {
      fillCount++;
      continue;
    }
    if (fillVal !== undefined && Math.abs(v - fillVal) <= Math.max(1e-6 * Math.abs(fillVal), 1e-12)) {
      fillCount++;
      continue;
    }
    valid.push(v);
  }

  if (valid.length === 0) {
    return {
      name,
      units,
      count: samples.length,
      validCount: 0,
      fillCount,
      min: Number.NaN,
      max: Number.NaN,
      mean: Number.NaN,
      stdDev: Number.NaN,
      rms: Number.NaN,
      p50: Number.NaN,
      p95: Number.NaN,
    };
  }

  let sum = 0;
  let sumSq = 0;
  let min = valid[0]!;
  let max = valid[0]!;

  for (const v of valid) {
    sum += v;
    sumSq += v * v;
    if (v < min) min = v;
    if (v > max) max = v;
  }

  const mean = sum / valid.length;
  let varSum = 0;
  for (const v of valid) {
    const d = v - mean;
    varSum += d * d;
  }
  const stdDev = Math.sqrt(varSum / valid.length);
  const rms = Math.sqrt(sumSq / valid.length);
  const sorted = [...valid].sort((a, b) => a - b);

  return {
    name,
    units,
    count: samples.length,
    validCount: valid.length,
    fillCount,
    min,
    max,
    mean,
    stdDev,
    rms,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
  };
}

function getAttrString(v: CdfVariable, key: string): string | undefined {
  const entry = v.attributes[key] ?? v.attributes[key.toUpperCase()];
  if (!entry || entry.values.length === 0) return undefined;
  return String(entry.values[0]);
}

function getAttrNumber(v: CdfVariable, key: string): number | undefined {
  const entry = v.attributes[key] ?? v.attributes[key.toUpperCase()];
  if (!entry || entry.values.length === 0) return undefined;
  const n = Number(entry.values[0]);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Extracts flattened scalar channels and magnetic-field magnitude summary from a `CdfDocument`.
 */
export function analyzeNasaCdfTelemetry(doc: CdfDocument): NasaCdfTelemetrySummary {
  const epochVar = doc.variables.find(
    (v) => v.dataType === "CDF_EPOCH" || v.dataType === "CDF_TIME_TT2000" || v.name.toUpperCase() === "EPOCH",
  );

  let startIso: string | undefined;
  let stopIso: string | undefined;
  let cadenceSeconds: number | undefined;
  const epochs: number[] = [];

  if (epochVar) {
    for (const raw of epochVar.values) {
      if (typeof raw === "number" || typeof raw === "string") {
        const ms = parseTimeValueToCdfEpoch(raw, epochVar.dataType);
        if (ms !== undefined) epochs.push(ms);
      }
    }
    if (epochs.length > 0) {
      startIso = cdfEpochToIso(epochs[0]!);
      stopIso = cdfEpochToIso(epochs[epochs.length - 1]!);
      if (epochs.length > 1) {
        cadenceSeconds = (epochs[epochs.length - 1]! - epochs[0]!) / ((epochs.length - 1) * 1000.0);
      }
    }
  }

  const channels: ChannelStatistics[] = [];
  let magneticField: VectorFieldSummary | undefined;

  // Check for 3-component vector magnetic field variable (e.g. B_GSE, B_GSM, BGSEc, B_VEC)
  for (const v of doc.variables) {
    if (v === epochVar) continue;
    if (v.dataType === "CDF_CHAR" || v.dataType === "CDF_UCHAR") continue;

    const units = getAttrString(v, "UNITS") ?? "";
    const fillVal = getAttrNumber(v, "FILLVAL");

    const is3Vec =
      (v.numDims === 1 && v.dimSizes[0] === 3) || v.values.some((rec) => Array.isArray(rec) && rec.length === 3);

    if (is3Vec) {
      const compNames = ["x", "y", "z"];
      const compSeries: [number[], number[], number[]] = [[], [], []];
      const vecs: Array<[number, number, number]> = [];

      for (const rec of v.values) {
        if (Array.isArray(rec) && rec.length >= 3) {
          const x = Number(rec[0]);
          const y = Number(rec[1]);
          const z = Number(rec[2]);
          compSeries[0].push(x);
          compSeries[1].push(y);
          compSeries[2].push(z);
          if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
            vecs.push([x, y, z]);
          }
        }
      }

      for (let c = 0; c < 3; c++) {
        channels.push(computeChannelStats(`${v.name}_${compNames[c]}`, compSeries[c]!, { units, fillVal }));
      }

      if (!magneticField && (v.name.toUpperCase().startsWith("B") || units.toLowerCase() === "nt")) {
        const mags = computeVectorNormSeries(vecs);
        magneticField = {
          sourceVariable: v.name,
          magnitudes: mags,
          stats: computeChannelStats(`|${v.name}|`, mags, { units }),
        };
      }
    } else {
      const nums: number[] = [];
      for (const rec of v.values) {
        if (typeof rec === "number") nums.push(rec);
        else if (typeof rec === "string") {
          const n = Number(rec);
          if (Number.isFinite(n)) nums.push(n);
        }
      }
      channels.push(computeChannelStats(v.name, nums, { units, fillVal }));
    }
  }

  // Fallback: separate scalar Bx, By, Bz variables
  if (!magneticField) {
    const bxVar = doc.variables.find((v) => /^B_?X$/i.test(v.name));
    const byVar = doc.variables.find((v) => /^B_?Y$/i.test(v.name));
    const bzVar = doc.variables.find((v) => /^B_?Z$/i.test(v.name));
    if (bxVar && byVar && bzVar) {
      const len = Math.min(bxVar.values.length, byVar.values.length, bzVar.values.length);
      const vecs: Array<[number, number, number]> = [];
      for (let i = 0; i < len; i++) {
        const x = Number(bxVar.values[i]);
        const y = Number(byVar.values[i]);
        const z = Number(bzVar.values[i]);
        if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
          vecs.push([x, y, z]);
        }
      }
      const mags = computeVectorNormSeries(vecs);
      const units = getAttrString(bxVar, "UNITS") ?? "nT";
      magneticField = {
        sourceVariable: `${bxVar.name},${byVar.name},${bzVar.name}`,
        magnitudes: mags,
        stats: computeChannelStats("|B|", mags, { units }),
      };
    }
  }

  const recordCount = Math.max(epochs.length, ...doc.variables.map((v) => v.values.length), 0);

  return {
    fileName: doc.header.fileName,
    epochVariable: epochVar?.name,
    recordCount,
    startIso,
    stopIso,
    cadenceSeconds,
    channels,
    magneticField,
  };
}
