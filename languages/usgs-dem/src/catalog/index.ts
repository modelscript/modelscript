// SPDX-License-Identifier: AGPL-3.0-or-later

import type { UsgsDemHeader, UsgsDemModel, UsgsDemProfile } from "../types.js";

export {
  ensureBuiltInUsgsDemLibraryRegistered,
  getUsgsDemSchemasFromLibraries,
  lookupUsgsDemModelSchema,
  registerBuiltInUsgsDemLibrarySync,
} from "./library-package-adapter.js";
export {
  buildUsgsDemCleanroomSchemas,
  generateUsgsDemBlockSvg,
  USGS_DEM_STD_SPECS,
  UsgsDemArchetypeId,
  type UsgsDemModelCategory,
  type UsgsDemModelSpec,
} from "./usgs-dem-std-schemas.js";

export interface SyntheticTerrainOptions {
  quadrangleName?: string | undefined;
  numCols?: number | undefined;
  numRows?: number | undefined;
  dx?: number | undefined;
  dy?: number | undefined;
  dz?: number | undefined;
  xOrigin?: number | undefined;
  yOrigin?: number | undefined;
  groundRefSystem?: number | undefined;
  groundRefZone?: number | undefined;
}

function buildSyntheticModel(
  opts: SyntheticTerrainOptions,
  defaultName: string,
  evalZ: (x: number, y: number) => number,
): UsgsDemModel {
  const numCols = Math.max(3, opts.numCols ?? 21);
  const numRows = Math.max(3, opts.numRows ?? 21);
  const dx = opts.dx ?? 30;
  const dy = opts.dy ?? 30;
  const dz = opts.dz ?? 0.01;
  const xOrigin = opts.xOrigin ?? 500000;
  const yOrigin = opts.yOrigin ?? 4400000;

  const z = new Float64Array(numCols * numRows);
  const profiles: UsgsDemProfile[] = [];
  let minZ = Number.POSITIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;

  for (let c = 0; c < numCols; c++) {
    const xLocal = c * dx;
    const elevations: number[] = [];
    const rawElevations: number[] = [];
    let pMin = Number.POSITIVE_INFINITY;
    let pMax = Number.NEGATIVE_INFINITY;

    for (let r = 0; r < numRows; r++) {
      const yLocal = r * dy;
      const val = evalZ(xLocal, yLocal);
      const raw = val / dz;
      z[r * numCols + c] = val;
      elevations.push(val);
      rawElevations.push(raw);
      if (val < pMin) pMin = val;
      if (val > pMax) pMax = val;
      if (val < minZ) minZ = val;
      if (val > maxZ) maxZ = val;
    }

    profiles.push({
      rowIndex: 1,
      colIndex: c + 1,
      numRows,
      numCols: 1,
      xOrigin: xOrigin + xLocal,
      yOrigin,
      localDatumElevation: 0,
      minElevation: pMin,
      maxElevation: pMax,
      rawElevations,
      elevations,
      line: c + 2,
      startOffset: 0,
      endOffset: 0,
    });
  }

  const width = (numCols - 1) * dx;
  const height = (numRows - 1) * dy;
  const header: UsgsDemHeader = {
    quadrangleName: opts.quadrangleName ?? defaultName,
    freeFormatText: "CLEANROOM SYNTHETIC BENCHMARK",
    processCode: "1",
    sectionalIndicator: "",
    originCode: "USGS",
    demLevelCode: 2,
    elevationPattern: 1,
    groundRefSystem: opts.groundRefSystem ?? 1,
    groundRefZone: opts.groundRefZone ?? 13,
    projectionParams: new Array<number>(15).fill(0),
    planimetricUnits: 2,
    elevationUnits: 2,
    polygonSides: 4,
    corners: [
      { x: xOrigin, y: yOrigin },
      { x: xOrigin, y: yOrigin + height },
      { x: xOrigin + width, y: yOrigin + height },
      { x: xOrigin + width, y: yOrigin },
    ],
    minElevation: minZ,
    maxElevation: maxZ,
    angleRad: 0,
    accuracyCode: 0,
    spatialResolution: { dx, dy, dz },
    rows: 1,
    cols: numCols,
    horizontalDatum: 4,
    verticalDatum: 3,
    line: 1,
    startOffset: 0,
    endOffset: 0,
  };

  return {
    header,
    profiles,
    format: "free-format",
    grid: {
      numCols,
      numRows,
      dx,
      dy,
      dz,
      xOrigin,
      yOrigin,
      minZ,
      maxZ,
      voidValue: -32767,
      z,
    },
    syntaxErrors: [],
  };
}

/**
 * Generate a canonical Gaussian hill synthetic USGS DEM.
 */
export function generateGaussianHillDem(
  options: SyntheticTerrainOptions & { baseElevation?: number; amplitude?: number; sigma?: number } = {},
): UsgsDemModel {
  const numCols = options.numCols ?? 41;
  const numRows = options.numRows ?? 41;
  const dx = options.dx ?? 20;
  const dy = options.dy ?? 20;
  const baseZ = options.baseElevation ?? 1000;
  const amp = options.amplitude ?? 500;
  const sigma = options.sigma ?? 100;
  const xc = ((numCols - 1) * dx) / 2;
  const yc = ((numRows - 1) * dy) / 2;

  return buildSyntheticModel({ ...options, numCols, numRows, dx, dy }, "GAUSSIAN_HILL_BENCHMARK", (x, y) => {
    const r2 = (x - xc) * (x - xc) + (y - yc) * (y - yc);
    return baseZ + amp * Math.exp(-r2 / (2 * sigma * sigma));
  });
}

/**
 * Generate a canonical inclined plane synthetic USGS DEM `z(x, y) = baseElevation + gradX * x + gradY * y`.
 */
export function generateInclinedPlaneDem(
  options: SyntheticTerrainOptions & { baseElevation?: number; gradX?: number; gradY?: number } = {},
): UsgsDemModel {
  const baseZ = options.baseElevation ?? 500;
  const gradX = options.gradX ?? -0.12;
  const gradY = options.gradY ?? -0.05;
  return buildSyntheticModel(options, "INCLINED_PLANE_BENCHMARK", (x, y) => baseZ + gradX * x + gradY * y);
}

/**
 * Generate a canonical V-shaped valley synthetic USGS DEM converging toward a central north-to-south thalweg.
 */
export function generateVValleyDem(
  options: SyntheticTerrainOptions & { baseElevation?: number; sideSlope?: number; channelSlope?: number } = {},
): UsgsDemModel {
  const numCols = options.numCols ?? 21;
  const numRows = options.numRows ?? 21;
  const dx = options.dx ?? 30;
  const dy = options.dy ?? 30;
  const baseZ = options.baseElevation ?? 200;
  const sideSlope = options.sideSlope ?? 0.2;
  const channelSlope = options.channelSlope ?? 0.04;
  const xc = ((numCols - 1) * dx) / 2;

  return buildSyntheticModel(
    { ...options, numCols, numRows, dx, dy },
    "V_VALLEY_BENCHMARK",
    (x, y) => baseZ + sideSlope * Math.abs(x - xc) + channelSlope * y,
  );
}
