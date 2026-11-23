// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Projections from USGS DEM terrain models to ASCII STL, Wavefront OBJ, and HEC-1 subbasin decks.
 */

import { buildTerrainMesh, type TerrainMeshOptions } from "../cad/index.js";
import { computeD8Flow, computeHypsometricIntegral, computeTerrainGridMetrics } from "../solver/index.js";
import type { UsgsDemModel } from "../types.js";

function computeFaceNormal(
  p0: readonly [number, number, number],
  p1: readonly [number, number, number],
  p2: readonly [number, number, number],
): [number, number, number] {
  const ux = p1[0] - p0[0];
  const uy = p1[1] - p0[1];
  const uz = p1[2] - p0[2];
  const vx = p2[0] - p0[0];
  const vy = p2[1] - p0[1];
  const vz = p2[2] - p0[2];
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const mag = Math.hypot(nx, ny, nz);
  if (mag === 0) return [0, 0, 1];
  return [nx / mag, ny / mag, nz / mag];
}

/**
 * Project a USGS DEM terrain model to ASCII STL format.
 */
export function usgsDemToStl(model: UsgsDemModel, options: TerrainMeshOptions = {}): string {
  const mesh = buildTerrainMesh(model, { watertight: true, ...options });
  const lines: string[] = [`solid ${mesh.name}`];

  for (const [i0, i1, i2] of mesh.faces) {
    const p0 = mesh.vertices[i0]!;
    const p1 = mesh.vertices[i1]!;
    const p2 = mesh.vertices[i2]!;
    const [nx, ny, nz] = computeFaceNormal(p0, p1, p2);
    lines.push(`  facet normal ${nx.toExponential(6)} ${ny.toExponential(6)} ${nz.toExponential(6)}`);
    lines.push("    outer loop");
    lines.push(`      vertex ${p0[0].toFixed(6)} ${p0[1].toFixed(6)} ${p0[2].toFixed(6)}`);
    lines.push(`      vertex ${p1[0].toFixed(6)} ${p1[1].toFixed(6)} ${p1[2].toFixed(6)}`);
    lines.push(`      vertex ${p2[0].toFixed(6)} ${p2[1].toFixed(6)} ${p2[2].toFixed(6)}`);
    lines.push("    endloop");
    lines.push("  endfacet");
  }

  lines.push(`endsolid ${mesh.name}`);
  return lines.join("\n") + "\n";
}

/**
 * Project a USGS DEM terrain model to Wavefront OBJ format.
 */
export function usgsDemToObj(model: UsgsDemModel, options: TerrainMeshOptions = {}): string {
  const mesh = buildTerrainMesh(model, options);
  const lines: string[] = [
    `# Wavefront OBJ exported from @modelscript/usgs-dem`,
    `# Quadrangle: ${model.header.quadrangleName}`,
    `o ${mesh.name}`,
  ];

  for (const v of mesh.vertices) {
    lines.push(`v ${v[0].toFixed(6)} ${v[1].toFixed(6)} ${v[2].toFixed(6)}`);
  }

  for (const [i0, i1, i2] of mesh.faces) {
    lines.push(`f ${i0 + 1} ${i1 + 1} ${i2 + 1}`);
  }

  return lines.join("\n") + "\n";
}

export interface Hec1ProjectionOptions {
  /** SCS Curve Number (default 75). */
  curveNumber?: number | undefined;
  /** Manning roughness for overland flow lag estimate (default 0.035). */
  manningN?: number | undefined;
}

/**
 * Project a USGS DEM watershed into a USACE HEC-1 Flood Hydrograph subbasin summary deck.
 */
export function usgsDemToHec1(model: UsgsDemModel, options: Hec1ProjectionOptions = {}): string {
  const { grid, header } = model;
  const metrics = computeTerrainGridMetrics(grid);
  const hypso = computeHypsometricIntegral(grid);
  const d8 = computeD8Flow(grid);

  const areaM2 = Math.max(1, grid.numCols * grid.numRows * grid.dx * grid.dy);
  const areaSqMi = areaM2 / 2_589_988.110336;
  const areaKm2 = areaM2 / 1_000_000;
  const meanSlopeFrac = Math.max(1e-4, Math.tan((metrics.meanSlopeDeg * Math.PI) / 180));
  const flowLengthM = Math.max(grid.dx, Math.sqrt(d8.maxAccumulation) * Math.hypot(grid.dx, grid.dy) * 0.5);
  const flowLengthFt = flowLengthM * 3.28084;
  const cn = Math.max(30, Math.min(98, options.curveNumber ?? 75));
  const manningN = options.manningN ?? 0.035;

  // SCS lag time (hours): t_lag = L^0.8 * (S + 1)^0.7 / (1900 * Y^0.5), Y in percent
  const sRetention = 1000 / cn - 10;
  const slopePct = Math.max(0.1, meanSlopeFrac * 100);
  const lagHours = (Math.pow(flowLengthFt, 0.8) * Math.pow(sRetention + 1, 0.7)) / (1900 * Math.sqrt(slopePct));

  const subbasinId =
    (header.quadrangleName || "SUB1")
      .replace(/[^A-Za-z0-9]/g, "")
      .slice(0, 6)
      .toUpperCase() || "SUB1";

  const lines: string[] = [
    `ID  USGS DEM WATERSHED SUMMARY: ${header.quadrangleName}`,
    `ID  AREA=${areaKm2.toFixed(4)} KM2 (${areaSqMi.toFixed(4)} SQ MI), RELIEF=${hypso.relief.toFixed(2)}, HI=${hypso.hypsometricIntegral.toFixed(4)}`,
    `IT    15   01JAN80     0000      100`,
    `KK${subbasinId.padStart(6)}  DEM-DERIVED SUBBASIN`,
    `KM  MEAN_SLOPE=${metrics.meanSlopeDeg.toFixed(2)} DEG, FLOW_LEN=${flowLengthM.toFixed(1)} M, N=${manningN.toFixed(3)}`,
    `BA${areaSqMi.toFixed(4).padStart(8)}`,
    `LS       0${cn.toFixed(1).padStart(8)}`,
    `UD${lagHours.toFixed(3).padStart(8)}`,
    `ZZ`,
  ];

  return lines.join("\n") + "\n";
}
