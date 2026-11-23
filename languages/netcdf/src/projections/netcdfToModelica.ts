// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Projection from Unidata NetCDF Classic datasets to Modelica 3.x models.
 */

import { computeFieldStats, unpackVariableValues } from "../solver/field-ops.js";
import type { NetcdfDataset } from "../types.js";

function sanitizeMoId(raw: string): string {
  const cleaned = raw.replace(/[^A-Za-z0-9_]/g, "_");
  return /^[0-9]/.test(cleaned) ? `nc_${cleaned}` : cleaned || "NetcdfModel";
}

/**
 * Projects a `NetcdfDataset` into a valid Modelica 3.x `model` with dimension parameters,
 * field statistics parameters, and domain-averaged conservation equations.
 */
export function netcdfToModelica(dataset: NetcdfDataset): string {
  const modelName = sanitizeMoId(dataset.name);
  const dimNames = new Set(dataset.dimensions.map((d) => d.name));
  const lines: string[] = [];

  lines.push(`model ${modelName} "Generated from NetCDF Classic dataset '${dataset.name}'"`);

  // Dimensions
  for (const dim of dataset.dimensions) {
    lines.push(`  parameter Integer dim_${sanitizeMoId(dim.name)} = ${Math.max(0, dim.size)};`);
  }

  const eqLines: string[] = [];

  for (const v of dataset.variables) {
    if (v.type === "char") continue;
    const base = sanitizeMoId(v.name);
    const unitsAttr = v.attributes.find((a) => a.name === "units");
    const unitStr = unitsAttr && typeof unitsAttr.value === "string" ? unitsAttr.value : "";
    const unitMod = unitStr ? `(unit="${unitStr.replace(/"/g, '\\"')}")` : "";

    const unpacked = unpackVariableValues(v);
    const stats = computeFieldStats(unpacked);
    const meanVal = Number.isFinite(stats.mean) ? stats.mean : 0.0;
    const minVal = Number.isFinite(stats.min) ? stats.min : 0.0;
    const maxVal = Number.isFinite(stats.max) ? stats.max : 0.0;

    const isCoord = v.dimensions.length === 1 && v.dimensions[0] === v.name && dimNames.has(v.name);
    if (isCoord) {
      lines.push(`  parameter Real ${base}_min${unitMod} = ${minVal};`);
      lines.push(`  parameter Real ${base}_max${unitMod} = ${maxVal};`);
      lines.push(`  Real ${base}_span${unitMod};`);
      eqLines.push(`  ${base}_span = ${base}_max - ${base}_min;`);
    } else {
      lines.push(`  parameter Real ${base}_ref${unitMod} = ${meanVal};`);
      lines.push(`  parameter Real ${base}_tau(unit="s") = 3600.0;`);
      lines.push(`  parameter Real ${base}_flux = 0.0;`);
      lines.push(`  Real ${base}_mean${unitMod}(start=${meanVal});`);
      eqLines.push(`  der(${base}_mean) = (${base}_ref - ${base}_mean) / ${base}_tau + ${base}_flux;`);
    }
  }

  if (eqLines.length > 0) {
    lines.push("equation");
    for (const eq of eqLines) {
      lines.push(eq);
    }
  }

  lines.push(`end ${modelName};`);
  return lines.join("\n") + "\n";
}
