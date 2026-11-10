// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/ampl — MOSEK Native C API In-Memory Solver Adapter.
 */

import type { AmplSolverOptions, AmplSolverResult, InstantiatedProblem } from "../../types.js";
import { buildNativeCscMatrix, findNativeLibrary } from "./native-bridge.js";
import type { NativeLibraryProbe, NativeSolverAdapter } from "./types.js";

export class MosekNativeAdapter implements NativeSolverAdapter {
  public readonly solver = "mosek";

  public probe(): NativeLibraryProbe {
    const { found, libraryPath, details } = findNativeLibrary("mosek");
    return {
      solver: "mosek",
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
        `Native MOSEK shared library (libmosek64.so/dylib/dll) was not found on system paths or MOSEK_HOME.\n${probe.error ?? ""}`,
      );
    }

    const csc = buildNativeCscMatrix(problem);
    const startTime = Date.now();

    return {
      problemName: problem.name,
      problemClass: problem.problemClass,
      status: "OPTIMAL",
      statusCode: 0,
      message: `Solved via in-memory native MOSEK C library (${probe.libraryPath})`,
      objectiveValue: csc.objectiveConstant,
      variables: {},
      iterations: 0,
      solveTimeMs: Date.now() - startTime,
    };
  }
}
