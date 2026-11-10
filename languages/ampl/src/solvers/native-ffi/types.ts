// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/ampl — In-Memory Native C / FFI Solver Types.
 */

import type { AmplSolverOptions, AmplSolverResult, InstantiatedProblem } from "../../types.js";

export type NativeSolverType = "highs" | "gurobi" | "mosek" | "cplex" | "knitro";

export interface NativeLibraryProbe {
  solver: NativeSolverType;
  available: boolean;
  libraryPath?: string | undefined;
  version?: string | undefined;
  error?: string | undefined;
}

export interface NativeSolverConfig {
  customLibraryPath?: string | undefined;
  timeoutSec?: number | undefined;
  threads?: number | undefined;
  solverOptions?: Record<string, string | number> | undefined;
}

export interface NativeCscMatrix {
  numCols: number;
  numRows: number;
  numNonzeros: number;
  colPointers: Int32Array;
  rowIndices: Int32Array;
  values: Float64Array;
  colCost: Float64Array;
  colLower: Float64Array;
  colUpper: Float64Array;
  rowLower: Float64Array;
  rowUpper: Float64Array;
  integrality?: Int32Array | undefined; // 0 = continuous, 1 = integer, 2 = semi-continuous, 3 = semi-integer
  isMaximize: boolean;
  objectiveConstant: number;
}

export interface NativeSolverAdapter {
  solver: NativeSolverType;
  probe(): NativeLibraryProbe;
  solve(
    problem: InstantiatedProblem,
    options?: AmplSolverOptions,
  ): Promise<AmplSolverResult>;
}
