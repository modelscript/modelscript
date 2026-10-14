// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Conductance Matrix [G] Builder for Dommel's EMT Companion Circuit Algorithm.
 */

import { denseToCCS, sparseLuFactor, type CCSMatrix, type SparseLU } from "../sparse-solver-bridge.js";
import type { BergeronLineState, FmuIbrState, RlcBranchState } from "./types.js";

export interface CompanionSystem {
  nNodes: number;
  Gdense: Float64Array[];
  Gccs: CCSMatrix;
  lu: SparseLU;
  stampConductance(i: number, j: number, g: number): void;
}

/**
 * Stamps a two-terminal conductance g between node i and node j.
 * Node -1 represents ground (GND / reference).
 */
export function stampTwoTerminalConductance(dense: Float64Array[], n: number, i: number, j: number, g: number): void {
  if (i >= 0 && i < n) {
    dense[i]![i] += g;
  }
  if (j >= 0 && j < n) {
    dense[j]![j] += g;
  }
  if (i >= 0 && j >= 0 && i < n && j < n) {
    dense[i]![j] -= g;
    dense[j]![i] -= g;
  }
}

/**
 * Stamps a shunt conductance g from node i to ground.
 */
export function stampShuntConductance(dense: Float64Array[], n: number, i: number, g: number): void {
  if (i >= 0 && i < n) {
    dense[i]![i] += g;
  }
}

/**
 * Builds and factorizes the system conductance matrix [G].
 */
export function buildCompanionSystem(
  nNodes: number,
  rlcBranches: RlcBranchState[],
  lines: BergeronLineState[],
  fmus: FmuIbrState[],
  sources?: { node: number; gSource?: number }[],
): CompanionSystem {
  const dense: Float64Array[] = [];
  for (let i = 0; i < nNodes; i++) {
    dense.push(new Float64Array(nNodes));
  }

  // 1. Stamp RLC branches
  for (const b of rlcBranches) {
    stampTwoTerminalConductance(dense, nNodes, b.fromNode, b.toNode, b.gTotal);
  }

  // 2. Stamp transmission lines (Bergeron characteristic surge admittance Gc = 1 / Zc)
  for (const line of lines) {
    stampShuntConductance(dense, nNodes, line.fromNode, line.gc);
    stampShuntConductance(dense, nNodes, line.toNode, line.gc);
  }

  // 3. Stamp FMU Norton equivalent interface conductance (for co-simulation stability)
  for (const fmu of fmus) {
    stampShuntConductance(dense, nNodes, fmu.node, fmu.gEq);
  }

  // 4. Stamp AC / DC voltage sources (Norton internal source conductance)
  if (sources) {
    for (const src of sources) {
      stampShuntConductance(dense, nNodes, src.node, src.gSource ?? 1e3);
    }
  }

  // Add small numerical ground conductance to prevent isolated floating node singularities
  const gGroundRegularizer = 1e-7;
  for (let i = 0; i < nNodes; i++) {
    dense[i]![i] += gGroundRegularizer;
  }

  // Convert to CCS sparse matrix format and compute Sparse LU factorization
  const Gccs = denseToCCS(dense, nNodes);
  const lu = sparseLuFactor(Gccs);

  return {
    nNodes,
    Gdense: dense,
    Gccs,
    lu,
    stampConductance(i: number, j: number, g: number) {
      stampTwoTerminalConductance(dense, nNodes, i, j, g);
    },
  };
}
