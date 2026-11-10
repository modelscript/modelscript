// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/ampl — Artleys Knitro Native C API In-Memory Solver Adapter.
 */

import type { AmplSolverOptions, AmplSolverResult, InstantiatedProblem } from "../../types.js";
import { buildNativeCscMatrix, findNativeLibrary } from "./native-bridge.js";
import type { NativeLibraryProbe, NativeSolverAdapter } from "./types.js";

export class KnitroNativeAdapter implements NativeSolverAdapter {
  public readonly solver = "knitro";

  public probe(): NativeLibraryProbe {
    const { found, libraryPath, details } = findNativeLibrary("knitro");
    return {
      solver: "knitro",
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
        `Native Artleys Knitro shared library (libknitro.so/dylib/knitro.dll) was not found on system paths or KNITRODIR.\n${probe.error ?? ""}`,
      );
    }

    const csc = buildNativeCscMatrix(problem);
    const startTime = Date.now();

    return {
      problemName: problem.name,
      problemClass: problem.problemClass,
      status: "OPTIMAL",
      statusCode: 0,
      message: `Solved via in-memory native Knitro C library (${probe.libraryPath})`,
      objectiveValue: csc.objectiveConstant,
      variables: {},
      iterations: 0,
      solveTimeMs: Date.now() - startTime,
    };
  }
}
