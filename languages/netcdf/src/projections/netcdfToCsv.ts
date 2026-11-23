// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Projection from Unidata NetCDF Classic datasets to tidy CSV tabular format.
 */

import { computeVariableShape, unpackVariableValues } from "../solver/field-ops.js";
import type { NetcdfDataset, NetcdfVariable } from "../types.js";

export interface NetcdfToCsvOptions {
  variableName?: string | undefined;
  delimiter?: string | undefined;
}

/**
 * Projects a NetCDF variable (or the first non-coordinate numeric variable) into a tidy CSV table
 * with one column per dimension coordinate (using coordinate variable values when available) plus the field value.
 */
export function netcdfToCsv(dataset: NetcdfDataset, options: NetcdfToCsvOptions = {}): string {
  const sep = options.delimiter ?? ",";
  const dimNames = new Set(dataset.dimensions.map((d) => d.name));

  let target: NetcdfVariable | undefined;
  if (options.variableName) {
    target = dataset.variables.find((v) => v.name === options.variableName);
  } else {
    target =
      dataset.variables.find(
        (v) => v.type !== "char" && !(v.dimensions.length === 1 && v.dimensions[0] === v.name && dimNames.has(v.name)),
      ) ?? dataset.variables.find((v) => v.type !== "char");
  }

  if (!target) {
    return "";
  }

  const shape = computeVariableShape(dataset, target);
  const values = unpackVariableValues(target);
  const coordArrays = target.dimensions.map((dName, idx) => {
    const coordVar = dataset.variables.find((v) => v.name === dName && v.dimensions.length === 1);
    const len = shape[idx] ?? 0;
    if (coordVar && coordVar.data && coordVar.data.length >= len) {
      return unpackVariableValues(coordVar);
    }
    return Array.from({ length: len }, (_, i) => i);
  });

  const headers = [...target.dimensions, target.name];
  const lines: string[] = [headers.join(sep)];

  if (shape.length === 0) {
    const v0 = values[0];
    lines.push(Number.isFinite(v0) ? String(v0) : "");
    return lines.join("\n") + "\n";
  }

  const total = shape.reduce((a, b) => a * b, 1);
  const strides = new Array<number>(shape.length).fill(1);
  for (let axis = shape.length - 2; axis >= 0; axis--) {
    strides[axis] = strides[axis + 1]! * shape[axis + 1]!;
  }

  for (let flat = 0; flat < total; flat++) {
    let rem = flat;
    const row: string[] = [];
    for (let axis = 0; axis < shape.length; axis++) {
      const idx = Math.floor(rem / strides[axis]!);
      rem %= strides[axis]!;
      const cVal = coordArrays[axis]?.[idx] ?? idx;
      row.push(String(cVal));
    }
    const val = values[flat];
    row.push(val !== undefined && Number.isFinite(val) ? String(val) : "");
    lines.push(row.join(sep));
  }

  return lines.join("\n") + "\n";
}
