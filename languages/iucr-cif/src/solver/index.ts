// SPDX-License-Identifier: AGPL-3.0-or-later

import { extractCrystalStructure } from "../parser/cif-parser.js";
import type { CifDataBlock, CifDocument, CrystalSolution, CrystalStructure } from "../types.js";
import {
  computeMetricTensor,
  computeTheoreticalDensity,
  expandSymmetrySites,
  findNearestNeighborDistance,
  findPeriodicBonds,
} from "./crystallography.js";
import { simulatePowderXrd, type XrdSimulationOptions } from "./xrd.js";

export {
  applySymmetryOp,
  cartesianToFractional,
  classifyCrystalSystem,
  computeMetricTensor,
  computeTheoreticalDensity,
  expandSymmetrySites,
  findNearestNeighborDistance,
  findPeriodicBonds,
  fractionalToCartesian,
  mat3MulVec,
  parseSymmetryOp,
  periodicDistance,
  type AffineSymOp,
} from "./crystallography.js";
export { atomicScatteringFactor, ELEMENT_TABLE, isKnownElement, lookupElement, type ElementInfo } from "./elements.js";
export {
  computeBraggTwoTheta,
  computeDSpacing,
  CU_K_ALPHA_WAVELENGTH,
  simulatePowderXrd,
  type XrdSimulationOptions,
} from "./xrd.js";

/**
 * Solves a crystal structure end-to-end: metric tensor, volume, Wyckoff expansion,
 * periodic-boundary bonds, nearest-neighbor distance, theoretical density, and Cu-Kα powder XRD.
 */
export function solveCrystalStructure(
  input: string | CifDocument | CifDataBlock | CrystalStructure,
  xrdOptions?: XrdSimulationOptions,
): CrystalSolution {
  let structure: CrystalStructure | null;
  if (typeof input === "object" && "asymmetricAtoms" in input && "cell" in input) {
    structure = input;
  } else {
    structure = extractCrystalStructure(input);
  }

  if (!structure) {
    throw new Error("Unable to extract crystal structure from CIF input.");
  }

  const metric = computeMetricTensor(structure.cell);
  const expandedAtoms = expandSymmetrySites(structure, metric);
  const bonds = findPeriodicBonds(metric, expandedAtoms);
  const nearestNeighborDistance = findNearestNeighborDistance(metric, expandedAtoms);
  const { densityGCm3, unitCellMassGPerMol } = computeTheoreticalDensity(expandedAtoms, metric.volume);
  const xrd = simulatePowderXrd(structure, xrdOptions, metric, expandedAtoms);

  return {
    structure,
    metric,
    expandedAtoms,
    bonds,
    nearestNeighborDistance,
    densityGCm3,
    unitCellMassGPerMol,
    xrd,
  };
}
