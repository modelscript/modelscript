// SPDX-License-Identifier: AGPL-3.0-or-later

import { computeBlockFlowField, type Plot3dGasProperties } from "../solver/flow.js";
import type { Plot3dGrid, Plot3dSolution } from "../types.js";

export interface Plot3dVtkOptions {
  title?: string | undefined;
  blockIndex?: number | undefined;
  gas?: Plot3dGasProperties | undefined;
}

/**
 * Projects a PLOT3D structured grid block (and optional conservative solution block)
 * to a VTK Legacy ASCII `DATASET STRUCTURED_GRID` file.
 */
export function plot3dToVtkStructuredGrid(
  grid: Plot3dGrid,
  solution?: Plot3dSolution,
  options?: Plot3dVtkOptions,
): string {
  const bIdx = options?.blockIndex ?? 0;
  const gb = grid.blocks[bIdx];
  if (!gb) {
    throw new Error(`Block index ${bIdx} out of range (grid has ${grid.blocks.length} block(s))`);
  }

  const title = options?.title ?? `PLOT3D Block ${bIdx} (${gb.ni}x${gb.nj}x${gb.nk})`;
  const nPts = gb.ni * gb.nj * gb.nk;
  const lines: string[] = [
    "# vtk DataFile Version 3.0",
    title,
    "ASCII",
    "DATASET STRUCTURED_GRID",
    `DIMENSIONS ${gb.ni} ${gb.nj} ${gb.nk}`,
    `POINTS ${nPts} double`,
  ];

  // VTK STRUCTURED_GRID uses i-fastest (Fortran) ordering, matching PLOT3D directly
  for (let i = 0; i < nPts; i++) {
    lines.push(`${gb.x[i]!} ${gb.y[i]!} ${gb.z[i]!}`);
  }

  const sb = solution?.blocks[bIdx];
  if (sb && sb.rho.length === nPts) {
    const flow = computeBlockFlowField(sb, options?.gas);
    lines.push(`POINT_DATA ${nPts}`);

    lines.push("SCALARS density double 1");
    lines.push("LOOKUP_TABLE default");
    for (let i = 0; i < nPts; i++) {
      lines.push(`${sb.rho[i]!}`);
    }

    lines.push("SCALARS pressure double 1");
    lines.push("LOOKUP_TABLE default");
    for (let i = 0; i < nPts; i++) {
      lines.push(`${flow.pressure[i]!}`);
    }

    lines.push("SCALARS mach double 1");
    lines.push("LOOKUP_TABLE default");
    for (let i = 0; i < nPts; i++) {
      lines.push(`${flow.mach[i]!}`);
    }

    lines.push("VECTORS velocity double");
    for (let i = 0; i < nPts; i++) {
      lines.push(`${flow.u[i]!} ${flow.v[i]!} ${flow.w[i]!}`);
    }
  }

  return lines.join("\n") + "\n";
}
