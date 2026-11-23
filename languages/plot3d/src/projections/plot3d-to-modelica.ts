// SPDX-License-Identifier: AGPL-3.0-or-later

import { conservativeToPrimitive } from "../solver/flow.js";
import { computeGridMetrics } from "../solver/metrics.js";
import { plot3dIndex, type Plot3dGrid, type Plot3dSolution } from "../types.js";

export interface Plot3dModelicaOptions {
  modelName?: string | undefined;
  gamma?: number | undefined;
  maxCellsPerBlock?: number | undefined;
}

/**
 * Projects a PLOT3D structured grid and optional conservative solution into a
 * clean, self-contained Modelica finite-volume Euler conservation model.
 */
export function plot3dToModelica(grid: Plot3dGrid, solution?: Plot3dSolution, options?: Plot3dModelicaOptions): string {
  const modelName = (options?.modelName ?? "Plot3dEulerModel").replace(/[^a-zA-Z0-9_]/g, "_");
  const gamma = options?.gamma ?? 1.4;
  const maxCells = options?.maxCellsPerBlock ?? 6;
  const metrics = computeGridMetrics(grid);

  const firstCond = solution?.blocks[0]?.conditions ?? { fsmach: 0.3, alpha: 0.0, re: 1.0e6, time: 0.0 };

  const lines: string[] = [
    `model ${modelName} "Projected from NASA PLOT3D (${grid.blocks.length} block(s), ${grid.dimension.toUpperCase()})"`,
    `  parameter Real gamma = ${gamma} "Ratio of specific heats";`,
    `  parameter Real fsmach = ${firstCond.fsmach} "Freestream Mach number";`,
    `  parameter Real alpha = ${firstCond.alpha} "Angle of attack [deg]";`,
    `  parameter Real reynolds = ${firstCond.re} "Freestream Reynolds number";`,
    `  parameter Real totalVolume = ${metrics.totalVolume} "Total structured grid volume [m3]";`,
    `  parameter Integer numBlocks = ${grid.blocks.length};`,
  ];

  const eqs: string[] = [];

  for (let bIdx = 0; bIdx < grid.blocks.length; bIdx++) {
    const gb = grid.blocks[bIdx]!;
    const sb = solution?.blocks[bIdx];
    const nCells = Math.max(1, Math.min(maxCells, Math.max(1, gb.ni - 1)));
    const xStart = gb.x[plot3dIndex(0, 0, 0, gb.ni, gb.nj)] ?? 0.0;
    const xEnd = gb.x[plot3dIndex(gb.ni - 1, 0, 0, gb.ni, gb.nj)] ?? 1.0;
    const dx = Math.max(1e-6, Math.abs(xEnd - xStart)) / nCells;

    lines.push(`  parameter Real b${bIdx}_dx = ${dx};`);

    let rhoIn = 1.225;
    let rhouIn = 122.5;
    let eIn = 101325.0 / (gamma - 1.0) + 0.5 * 1.225 * 10000.0;
    let uIn = 100.0;
    let pIn = 101325.0;

    if (sb && sb.rho.length > 0) {
      rhoIn = sb.rho[0]!;
      rhouIn = sb.rhou[0]!;
      eIn = sb.energy[0]!;
      const prim = conservativeToPrimitive(
        { rho: rhoIn, rhou: rhouIn, rhov: sb.rhov[0]!, rhow: sb.rhow[0]!, energy: eIn },
        { gamma },
      );
      uIn = prim.u;
      pIn = Math.max(1.0, prim.pressure);
    }

    let prevRhouExpr = `${rhouIn}`;
    let prevMomExpr = `${rhouIn * uIn + pIn}`;
    let prevEngExpr = `${(eIn + pIn) * uIn}`;

    for (let c = 0; c < nCells; c++) {
      const pfx = `b${bIdx}_c${c}`;
      lines.push(`  Real ${pfx}_rho(start = ${rhoIn});`);
      lines.push(`  Real ${pfx}_rhou(start = ${rhouIn});`);
      lines.push(`  Real ${pfx}_E(start = ${eIn});`);
      lines.push(`  Real ${pfx}_u(start = ${uIn});`);
      lines.push(`  Real ${pfx}_p(start = ${pIn});`);

      eqs.push(`  ${pfx}_rho * ${pfx}_u = ${pfx}_rhou;`);
      eqs.push(`  ${pfx}_p = (gamma - 1.0) * (${pfx}_E - 0.5 * ${pfx}_rhou * ${pfx}_u);`);
      eqs.push(`  der(${pfx}_rho) = (${prevRhouExpr} - ${pfx}_rhou) / b${bIdx}_dx;`);
      eqs.push(`  der(${pfx}_rhou) = (${prevMomExpr} - (${pfx}_rhou * ${pfx}_u + ${pfx}_p)) / b${bIdx}_dx;`);
      eqs.push(`  der(${pfx}_E) = (${prevEngExpr} - ((${pfx}_E + ${pfx}_p) * ${pfx}_u)) / b${bIdx}_dx;`);

      prevRhouExpr = `${pfx}_rhou`;
      prevMomExpr = `(${pfx}_rhou * ${pfx}_u + ${pfx}_p)`;
      prevEngExpr = `((${pfx}_E + ${pfx}_p) * ${pfx}_u)`;
    }
  }

  lines.push("equation");
  lines.push(...eqs);
  lines.push(`end ${modelName};`);

  return lines.join("\n") + "\n";
}
