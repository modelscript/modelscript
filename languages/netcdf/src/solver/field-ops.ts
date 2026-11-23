// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/netcdf — Multidimensional Array Slicing, Field Statistics & 2D Bilinear Interpolation.
 */

import type { NetcdfDataset, NetcdfVariable } from "../types.js";

export interface FieldStatistics {
  count: number;
  validCount: number;
  missingCount: number;
  min: number;
  max: number;
  mean: number;
  variance: number;
  std: number;
  rms: number;
}

export interface FieldErrorMetrics {
  count: number;
  rmse: number;
  maxAbsErr: number;
  relErr: number;
}

export interface ArraySliceResult {
  variableName: string;
  dimensions: string[];
  shape: number[];
  data: number[];
}

/**
 * Resolves the declared integer shape of a variable in a `NetcdfDataset`.
 */
export function computeVariableShape(dataset: NetcdfDataset, variable: NetcdfVariable): number[] {
  const dimByName = new Map(dataset.dimensions.map((d) => [d.name, d]));
  return variable.dimensions.map((dName) => {
    const dim = dimByName.get(dName);
    return dim ? dim.size : 0;
  });
}

/**
 * Extracts a variable's numeric fill value from `_FillValue` or `missing_value` attributes if present.
 */
export function getVariableFillValue(variable: NetcdfVariable): number | undefined {
  const attr =
    variable.attributes.find((a) => a.name === "_FillValue") ??
    variable.attributes.find((a) => a.name === "missing_value");
  if (attr && typeof attr.value === "number") {
    return attr.value;
  }
  return undefined;
}

/**
 * Unpacks variable numeric values using CF-1.x `scale_factor` and `add_offset`:
 * `unpacked = raw * scale_factor + add_offset`.
 */
export function unpackVariableValues(variable: NetcdfVariable): number[] {
  const raw = variable.data ?? [];
  const scaleAttr = variable.attributes.find((a) => a.name === "scale_factor");
  const offsetAttr = variable.attributes.find((a) => a.name === "add_offset");
  const fillVal = getVariableFillValue(variable);

  const scale = scaleAttr && typeof scaleAttr.value === "number" ? scaleAttr.value : 1;
  const offset = offsetAttr && typeof offsetAttr.value === "number" ? offsetAttr.value : 0;

  return raw.map((v) => {
    const num = typeof v === "number" ? v : Number(v);
    if (!Number.isFinite(num)) return num;
    if (fillVal !== undefined && num === fillVal) return Number.NaN;
    return num * scale + offset;
  });
}

/**
 * Slices a multidimensional variable along specified axes.
 *
 * Each entry in `sliceIndices` corresponds to a dimension of the variable:
 * - `number`: fixes that axis at the given 0-based index (reduces dimensionality by 1)
 * - `":"` or `null`: keeps the entire axis in the output slice
 */
export function sliceVariable(
  dataset: NetcdfDataset,
  variableName: string,
  sliceIndices: Array<number | ":" | null>,
): ArraySliceResult {
  const variable = dataset.variables.find((v) => v.name === variableName);
  if (!variable) {
    throw new Error(`Variable '${variableName}' not found in dataset '${dataset.name}'`);
  }

  const shape = computeVariableShape(dataset, variable);
  if (sliceIndices.length !== shape.length) {
    throw new Error(
      `Slice rank (${sliceIndices.length}) does not match variable '${variableName}' rank (${shape.length})`,
    );
  }

  // Validate fixed indices
  for (let axis = 0; axis < shape.length; axis++) {
    const spec = sliceIndices[axis];
    if (typeof spec === "number") {
      if (!Number.isInteger(spec) || spec < 0 || spec >= shape[axis]!) {
        throw new Error(
          `Slice index ${spec} out of bounds for axis ${axis} ('${variable.dimensions[axis]}') of size ${shape[axis]}`,
        );
      }
    }
  }

  const values = unpackVariableValues(variable);

  // Row-major strides
  const strides = new Array<number>(shape.length).fill(1);
  for (let axis = shape.length - 2; axis >= 0; axis--) {
    strides[axis] = strides[axis + 1]! * shape[axis + 1]!;
  }

  const outDims: string[] = [];
  const outShape: number[] = [];
  const freeAxes: number[] = [];
  let baseOffset = 0;

  for (let axis = 0; axis < shape.length; axis++) {
    const spec = sliceIndices[axis];
    if (typeof spec === "number") {
      baseOffset += spec * strides[axis]!;
    } else {
      outDims.push(variable.dimensions[axis]!);
      outShape.push(shape[axis]!);
      freeAxes.push(axis);
    }
  }

  const outData: number[] = [];
  const recurse = (freeIdx: number, currentOffset: number): void => {
    if (freeIdx === freeAxes.length) {
      outData.push(values[currentOffset] ?? Number.NaN);
      return;
    }
    const axis = freeAxes[freeIdx]!;
    const dimLen = shape[axis]!;
    const stride = strides[axis]!;
    for (let i = 0; i < dimLen; i++) {
      recurse(freeIdx + 1, currentOffset + i * stride);
    }
  };

  recurse(0, baseOffset);

  return {
    variableName,
    dimensions: outDims,
    shape: outShape,
    data: outData,
  };
}

/**
 * Computes field statistics (min, max, mean, variance, population std, RMS) ignoring NaN/Inf and optional `fillValue`.
 */
export function computeFieldStats(values: ArrayLike<number>, fillValue?: number): FieldStatistics {
  const count = values.length;
  let validCount = 0;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  let sum = 0;
  let sumSq = 0;

  for (let i = 0; i < count; i++) {
    const v = values[i]!;
    if (!Number.isFinite(v)) continue;
    if (fillValue !== undefined && v === fillValue) continue;
    validCount++;
    if (v < min) min = v;
    if (v > max) max = v;
    sum += v;
    sumSq += v * v;
  }

  if (validCount === 0) {
    return {
      count,
      validCount: 0,
      missingCount: count,
      min: Number.NaN,
      max: Number.NaN,
      mean: Number.NaN,
      variance: Number.NaN,
      std: Number.NaN,
      rms: Number.NaN,
    };
  }

  const mean = sum / validCount;
  // Two-pass variance for numerical stability
  let varSum = 0;
  for (let i = 0; i < count; i++) {
    const v = values[i]!;
    if (!Number.isFinite(v)) continue;
    if (fillValue !== undefined && v === fillValue) continue;
    const diff = v - mean;
    varSum += diff * diff;
  }
  const variance = varSum / validCount;

  return {
    count,
    validCount,
    missingCount: count - validCount,
    min,
    max,
    mean,
    variance,
    std: Math.sqrt(variance),
    rms: Math.sqrt(sumSq / validCount),
  };
}

/**
 * Computes RMSE, max absolute error, and relative L2 error between two numeric fields.
 */
export function computeFieldRmse(
  actual: ArrayLike<number>,
  expected: ArrayLike<number>,
  fillValue?: number,
): FieldErrorMetrics {
  const n = Math.min(actual.length, expected.length);
  let valid = 0;
  let sqErr = 0;
  let sqRef = 0;
  let maxAbsErr = 0;

  for (let i = 0; i < n; i++) {
    const a = actual[i]!;
    const e = expected[i]!;
    if (!Number.isFinite(a) || !Number.isFinite(e)) continue;
    if (fillValue !== undefined && (a === fillValue || e === fillValue)) continue;
    const diff = Math.abs(a - e);
    sqErr += diff * diff;
    sqRef += e * e;
    if (diff > maxAbsErr) maxAbsErr = diff;
    valid++;
  }

  if (valid === 0) {
    return { count: 0, rmse: 0, maxAbsErr: 0, relErr: 0 };
  }

  const rmse = Math.sqrt(sqErr / valid);
  const relErr = sqRef > 0 ? Math.sqrt(sqErr / sqRef) : maxAbsErr;
  return { count: valid, rmse, maxAbsErr, relErr };
}

function findBracket(coords: ArrayLike<number>, target: number): [number, number, number] {
  const n = coords.length;
  if (n < 2) return [0, 0, 0];

  const ascending = coords[n - 1]! >= coords[0]!;
  if (ascending) {
    if (target <= coords[0]!) return [0, 1, 0];
    if (target >= coords[n - 1]!) return [n - 2, n - 1, 1];
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (coords[mid]! <= target) lo = mid;
      else hi = mid;
    }
    const span = coords[hi]! - coords[lo]!;
    const t = span !== 0 ? (target - coords[lo]!) / span : 0;
    return [lo, hi, t];
  } else {
    if (target >= coords[0]!) return [0, 1, 0];
    if (target <= coords[n - 1]!) return [n - 2, n - 1, 1];
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (coords[mid]! >= target) lo = mid;
      else hi = mid;
    }
    const span = coords[hi]! - coords[lo]!;
    const t = span !== 0 ? (target - coords[lo]!) / span : 0;
    return [lo, hi, t];
  }
}

/**
 * Performs 2D rectilinear bilinear interpolation on a row-major grid `grid[ny * nx]`
 * indexed as `grid[iy * nx + ix]` with monotonic coordinate axes `xCoords[nx]` and `yCoords[ny]`.
 */
export function bilinearInterpolate2D(
  grid: ArrayLike<number>,
  xCoords: ArrayLike<number>,
  yCoords: ArrayLike<number>,
  x: number,
  y: number,
  fillValue?: number,
): number {
  const nx = xCoords.length;
  const ny = yCoords.length;
  if (nx === 0 || ny === 0 || grid.length < nx * ny) {
    return Number.NaN;
  }

  const [ix0, ix1, tx] = findBracket(xCoords, x);
  const [iy0, iy1, ty] = findBracket(yCoords, y);

  const q00 = grid[iy0 * nx + ix0]!;
  const q10 = grid[iy0 * nx + ix1]!;
  const q01 = grid[iy1 * nx + ix0]!;
  const q11 = grid[iy1 * nx + ix1]!;

  const corners = [q00, q10, q01, q11];
  for (const c of corners) {
    if (!Number.isFinite(c) || (fillValue !== undefined && c === fillValue)) {
      return Number.NaN;
    }
  }

  const w00 = (1 - tx) * (1 - ty);
  const w10 = tx * (1 - ty);
  const w01 = (1 - tx) * ty;
  const w11 = tx * ty;
  return w00 * q00 + w10 * q10 + w01 * q01 + w11 * q11;
}
