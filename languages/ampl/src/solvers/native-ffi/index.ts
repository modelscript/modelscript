// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/ampl — In-Memory Native C / FFI Solver Bridges.
 */

import type { AmplSolverOptions, AmplSolverResult, InstantiatedProblem } from "../../types.js";
import { CplexNativeAdapter } from "./cplex-bridge.js";
import { GurobiNativeAdapter } from "./gurobi-bridge.js";
import { HighsNativeAdapter } from "./highs-bridge.js";
import { KnitroNativeAdapter } from "./knitro-bridge.js";
import { MosekNativeAdapter } from "./mosek-bridge.js";
import type { NativeLibraryProbe, NativeSolverAdapter, NativeSolverType } from "./types.js";

export * from "./types.js";
export * from "./native-bridge.js";
export * from "./highs-bridge.js";
export * from "./gurobi-bridge.js";
export * from "./mosek-bridge.js";
export * from "./cplex-bridge.js";
export * from "./knitro-bridge.js";

const ADAPTERS: Record<NativeSolverType, NativeSolverAdapter> = {
  highs: new HighsNativeAdapter(),
  gurobi: new GurobiNativeAdapter(),
  mosek: new MosekNativeAdapter(),
  cplex: new CplexNativeAdapter(),
  knitro: new KnitroNativeAdapter(),
};

/**
 * Probes availability of a native solver library.
 */
export function probeNativeSolverLibrary(solver: NativeSolverType): NativeLibraryProbe {
  const adapter = ADAPTERS[solver];
  if (!adapter) {
    return {
      solver,
      available: false,
      error: `Unsupported native solver '${solver}'`,
    };
  }
  return adapter.probe();
}

/**
 * Dispatches an instantiated problem to a native C / FFI solver.
 */
export async function solveWithNativeFfi(
  problem: InstantiatedProblem,
  solver: NativeSolverType,
  options?: AmplSolverOptions,
): Promise<AmplSolverResult> {
  const adapter = ADAPTERS[solver];
  if (!adapter) {
    throw new Error(`Unsupported native solver '${solver}'. Supported: highs, gurobi, mosek, cplex, knitro.`);
  }
  return adapter.solve(problem, options);
}
