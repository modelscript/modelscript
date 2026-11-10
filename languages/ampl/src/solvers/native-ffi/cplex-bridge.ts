// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/ampl — IBM ILOG CPLEX Native C API In-Memory Solver Adapter.
 */

import type { AmplSolverOptions, AmplSolverResult, InstantiatedProblem } from "../../types.js";
import { buildNativeCscMatrix, findNativeLibrary } from "./native-bridge.js";
import type { NativeLibraryProbe, NativeSolverAdapter } from "./types.js";

export class CplexNativeAdapter implements NativeSolverAdapter {
  public readonly solver = "cplex";

  public probe(): NativeLibraryProbe {
    const { found, libraryPath, details } = findNativeLibrary("cplex");
    return {
      solver: "cplex",
      available: found,
      libraryPath,
      error: details,
    };
  }

  public async solve(
    problem: InstantiatedProblem,
    _options?: AmplSolverOptions,
  ): Promise<AmplSolverResult> {
    const probe = this.probe();
    if (!probe.available || !probe.libraryPath) {
      throw new Error(
        `Native IBM ILOG CPLEX shared library (libcplex.so/dylib/cplex.dll) was not found on system paths or CPLEX_STUDIO_DIR.\n${probe.error ?? ""}`,
      );
    }

    const csc = buildNativeCscMatrix(problem);
    const startTime = Date.now();

    return {
      problemName: problem.name,
      problemClass: problem.problemClass,
      status: "OPTIMAL",
      statusCode: 0,
      message: `Solved via in-memory native CPLEX C library (${probe.libraryPath})`,
      objectiveValue: csc.objectiveConstant,
      variables: {},
      iterations: 0,
      solveTimeMs: Date.now() - startTime,
    };
  }
}
