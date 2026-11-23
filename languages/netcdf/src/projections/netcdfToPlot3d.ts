// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Projection from Unidata NetCDF Classic gridded datasets to NASA PLOT3D ASCII grid/solution format.
 */

import { computeVariableShape, unpackVariableValues } from "../solver/field-ops.js";
import type { NetcdfDataset, NetcdfVariable } from "../types.js";

export interface Plot3dProjectionResult {
  gridXyz: string;
  solutionQ: string;
  ni: number;
  nj: number;
  nk: number;
}

/**
 * Projects a 2D or 3D gridded NetCDF dataset into NASA PLOT3D single-block formatted ASCII
 * grid (`.xyz`) and 5-component solution (`.q`) files.
 */
export function netcdfToPlot3d(dataset: NetcdfDataset, variableName?: string): Plot3dProjectionResult {
  const dimNames = new Set(dataset.dimensions.map((d) => d.name));
  const fieldVar: NetcdfVariable | undefined = variableName
    ? dataset.variables.find((v) => v.name === variableName)
    : (dataset.variables.find(
        (v) => v.type !== "char" && v.dimensions.length >= 2 && !(v.dimensions.length === 1 && dimNames.has(v.name)),
      ) ?? dataset.variables.find((v) => v.type !== "char"));

  const shape = fieldVar ? computeVariableShape(dataset, fieldVar) : [1, 1, 1];
  const nk = shape.length >= 3 ? Math.max(1, shape[0]!) : 1;
  const nj = shape.length >= 2 ? Math.max(1, shape[shape.length - 2]!) : 1;
  const ni = shape.length >= 1 ? Math.max(1, shape[shape.length - 1]!) : 1;

  const getCoord = (dimIdxFromEnd: number, len: number): number[] => {
    if (!fieldVar || fieldVar.dimensions.length < dimIdxFromEnd) {
      return Array.from({ length: len }, (_, i) => i);
    }
    const dName = fieldVar.dimensions[fieldVar.dimensions.length - dimIdxFromEnd]!;
    const cVar = dataset.variables.find((v) => v.name === dName);
    if (cVar && cVar.data && cVar.data.length >= len) {
      return unpackVariableValues(cVar).slice(0, len);
    }
    return Array.from({ length: len }, (_, i) => i);
  };

  const xCoords = getCoord(1, ni);
  const yCoords = getCoord(2, nj);
  const zCoords = getCoord(3, nk);

  const xs: string[] = [];
  const ys: string[] = [];
  const zs: string[] = [];
  for (let k = 0; k < nk; k++) {
    for (let j = 0; j < nj; j++) {
      for (let i = 0; i < ni; i++) {
        xs.push((xCoords[i] ?? i).toFixed(6));
        ys.push((yCoords[j] ?? j).toFixed(6));
        zs.push((zCoords[k] ?? k).toFixed(6));
      }
    }
  }

  const gridLines = ["1", `${ni} ${nj} ${nk}`, xs.join(" "), ys.join(" "), zs.join(" ")];

  const vals = fieldVar ? unpackVariableValues(fieldVar) : [1.0];
  const total = ni * nj * nk;
  const q1: string[] = [];
  const q2: string[] = [];
  const q3: string[] = [];
  const q4: string[] = [];
  const q5: string[] = [];
  for (let idx = 0; idx < total; idx++) {
    const v = vals[idx];
    const safe = v !== undefined && Number.isFinite(v) ? v : 0.0;
    q1.push("1.000000"); // density placeholder
    q2.push("0.000000"); // x-momentum
    q3.push("0.000000"); // y-momentum
    q4.push("0.000000"); // z-momentum
    q5.push(safe.toFixed(6)); // scalar field mapped to energy channel
  }

  const solLines = [
    "1",
    `${ni} ${nj} ${nk}`,
    "0.000000 0.000000 0.000000 0.000000",
    q1.join(" "),
    q2.join(" "),
    q3.join(" "),
    q4.join(" "),
    q5.join(" "),
  ];

  return {
    gridXyz: gridLines.join("\n") + "\n",
    solutionQ: solLines.join("\n") + "\n",
    ni,
    nj,
    nk,
  };
}
