// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/grib — WMO GRIB Edition 1 Packing, Unpacking & Field Statistics.
 *
 * Implements the WMO FM 92-VIII Ext. GRIB Edition 1 simple packing relation:
 *   Y = (R + X * 2^E) * 10^(-D)
 * where:
 *   R = IEEE/IBM 32-bit floating-point reference value
 *   X = non-negative packed integer of width `bitsPerValue` (0..32)
 *   E = binary scale factor (signed integer)
 *   D = decimal scale factor (signed integer)
 */

import type { GribFieldStats, GribGridDefinitionSection } from "../types.js";

export interface GribPackResult {
  referenceValue: number;
  binaryScaleFactor: number;
  decimalScaleFactor: number;
  bitsPerValue: number;
  packedValues: number[];
}

/**
 * Unpacks GRIB1 integer values `X` into physical values `Y = (R + X * 2^E) * 10^(-D)`.
 */
export function unpackGrib1Values(
  referenceValue: number,
  packedValues: readonly number[],
  binaryScaleFactor: number,
  decimalScaleFactor: number,
): number[] {
  const twoPowE = Math.pow(2, binaryScaleFactor);
  const tenNegD = Math.pow(10, -decimalScaleFactor);
  const out = new Array<number>(packedValues.length);
  for (let i = 0; i < packedValues.length; i++) {
    out[i] = (referenceValue + packedValues[i]! * twoPowE) * tenNegD;
  }
  return out;
}

/**
 * Packs physical values `Y` into GRIB1 integer values `X` of width `bitsPerValue`
 * using decimal scale factor `D`, computing reference value `R = min(Y * 10^D)`
 * and optimal binary scale factor `E` so that `0 <= X <= (2^bitsPerValue - 1)`.
 */
export function packGrib1Values(values: readonly number[], bitsPerValue = 16, decimalScaleFactor = 0): GribPackResult {
  const bpv = Math.max(0, Math.min(32, Math.trunc(bitsPerValue)));
  if (values.length === 0) {
    return {
      referenceValue: 0,
      binaryScaleFactor: 0,
      decimalScaleFactor,
      bitsPerValue: bpv,
      packedValues: [],
    };
  }

  const tenPowD = Math.pow(10, decimalScaleFactor);
  let minVal = Infinity;
  let maxVal = -Infinity;
  for (let i = 0; i < values.length; i++) {
    const v = values[i]! * tenPowD;
    if (Number.isFinite(v)) {
      if (v < minVal) minVal = v;
      if (v > maxVal) maxVal = v;
    }
  }
  if (!Number.isFinite(minVal)) {
    minVal = 0;
    maxVal = 0;
  }

  const range = maxVal - minVal;
  if (bpv === 0 || range === 0) {
    return {
      referenceValue: minVal,
      binaryScaleFactor: 0,
      decimalScaleFactor,
      bitsPerValue: bpv === 0 ? 0 : bpv,
      packedValues: new Array<number>(values.length).fill(0),
    };
  }

  // Max unsigned integer representable in `bpv` bits (use 2^bpv - 1 safely up to 32 bits)
  const maxInt = bpv === 32 ? 0xffffffff : Math.pow(2, bpv) - 1;
  // Choose E such that range / 2^E <= maxInt => E = ceil(log2(range / maxInt))
  const binaryScaleFactor = Math.ceil(Math.log2(range / maxInt));
  const invTwoPowE = Math.pow(2, -binaryScaleFactor);

  const packedValues = new Array<number>(values.length);
  for (let i = 0; i < values.length; i++) {
    const scaled = values[i]! * tenPowD;
    if (!Number.isFinite(scaled)) {
      packedValues[i] = 0;
    } else {
      const raw = Math.round((scaled - minVal) * invTwoPowE);
      packedValues[i] = Math.max(0, Math.min(maxInt, raw));
    }
  }

  return {
    referenceValue: minVal,
    binaryScaleFactor,
    decimalScaleFactor,
    bitsPerValue: bpv,
    packedValues,
  };
}

/**
 * Computes latitude array (degrees) for each row `j = 0..nj-1` of a regular Lat/Lon GDS.
 */
export function getGdsLatitudes(gds: GribGridDefinitionSection): number[] {
  const lats = new Array<number>(gds.nj);
  if (gds.nj <= 1) {
    if (gds.nj === 1) lats[0] = gds.la1;
    return lats;
  }
  const step = (gds.la2 - gds.la1) / (gds.nj - 1);
  for (let j = 0; j < gds.nj; j++) {
    lats[j] = gds.la1 + j * step;
  }
  return lats;
}

/**
 * Computes longitude array (degrees) for each column `i = 0..ni-1` of a regular Lat/Lon GDS.
 */
export function getGdsLongitudes(gds: GribGridDefinitionSection): number[] {
  const lons = new Array<number>(gds.ni);
  if (gds.ni <= 1) {
    if (gds.ni === 1) lons[0] = gds.lo1;
    return lons;
  }
  const step = (gds.lo2 - gds.lo1) / (gds.ni - 1);
  for (let i = 0; i < gds.ni; i++) {
    lons[i] = gds.lo1 + i * step;
  }
  return lons;
}

/**
 * Computes cosine-latitude area-weighted global/regional mean:
 *   Y_bar = sum(Y_{j,i} * cos(phi_j)) / sum(cos(phi_j))
 */
export function computeAreaWeightedGlobalMean(
  values: readonly number[],
  gds?: GribGridDefinitionSection | undefined,
): number {
  if (values.length === 0) return 0;
  if (!gds || gds.ni <= 0 || gds.nj <= 0 || values.length !== gds.ni * gds.nj) {
    let sum = 0;
    let count = 0;
    for (let k = 0; k < values.length; k++) {
      const v = values[k]!;
      if (Number.isFinite(v)) {
        sum += v;
        count++;
      }
    }
    return count > 0 ? sum / count : 0;
  }

  const lats = getGdsLatitudes(gds);
  const deg2rad = Math.PI / 180;
  let weightedSum = 0;
  let weightTotal = 0;

  for (let j = 0; j < gds.nj; j++) {
    const w = Math.max(0, Math.cos(lats[j]! * deg2rad));
    const rowOffset = j * gds.ni;
    for (let i = 0; i < gds.ni; i++) {
      const v = values[rowOffset + i]!;
      if (Number.isFinite(v)) {
        weightedSum += v * w;
        weightTotal += w;
      }
    }
  }
  return weightTotal > 0 ? weightedSum / weightTotal : 0;
}

/**
 * Computes summary statistics (min, max, mean, stdDev, areaWeightedMean) for a GRIB1 field.
 */
export function computeGribFieldStats(
  values: readonly number[],
  gds?: GribGridDefinitionSection | undefined,
): GribFieldStats {
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  let validCount = 0;

  for (let i = 0; i < values.length; i++) {
    const v = values[i]!;
    if (Number.isFinite(v)) {
      if (v < min) min = v;
      if (v > max) max = v;
      sum += v;
      validCount++;
    }
  }

  if (validCount === 0) {
    return {
      count: values.length,
      validCount: 0,
      min: 0,
      max: 0,
      mean: 0,
      stdDev: 0,
      areaWeightedMean: 0,
    };
  }

  const mean = sum / validCount;
  let sqDiff = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i]!;
    if (Number.isFinite(v)) {
      const d = v - mean;
      sqDiff += d * d;
    }
  }

  return {
    count: values.length,
    validCount,
    min,
    max,
    mean,
    stdDev: Math.sqrt(sqDiff / validCount),
    areaWeightedMean: computeAreaWeightedGlobalMean(values, gds),
  };
}
