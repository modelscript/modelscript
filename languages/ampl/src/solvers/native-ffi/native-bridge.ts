// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/ampl — In-Memory Native C / FFI Solver Bridge.
 *
 * Discovers and links native C solver shared libraries (`libhighs`, `libgurobi`, `libmosek`)
 * on the host operating system, packaging zero-copy CSC sparse matrix buffers for in-memory solving.
 */

import fs from "node:fs";
import path from "node:path";
import type { InstantiatedProblem } from "../../types.js";
import type {
  NativeCscMatrix,
  NativeLibraryProbe,
  NativeSolverType,
} from "./types.js";

/**
 * Common library filename patterns across operating systems.
 */
function getPlatformLibNames(baseName: string): string[] {
  const isWin = process.platform === "win32";
  const isMac = process.platform === "darwin";

  if (isWin) {
    return [`${baseName}.dll`, `lib${baseName}.dll`];
  }
  if (isMac) {
    return [`lib${baseName}.dylib`, `lib${baseName}.so`];
  }
  return [`lib${baseName}.so`, `lib${baseName}.so.1`, `lib${baseName}.so.2`];
}

/**
 * Standard search directories for native libraries across Linux, macOS, and Windows.
 */
function getStandardLibrarySearchPaths(): string[] {
  const dirs: string[] = [];
  const envPath = (name: string) => process.env[name]?.split(path.delimiter) ?? [];

  if (process.platform === "win32") {
    dirs.push(...envPath("PATH"));
    dirs.push("C:\\Windows\\System32");
    if (process.env["ProgramFiles"]) dirs.push(process.env["ProgramFiles"]);
  } else {
    dirs.push(...envPath("LD_LIBRARY_PATH"));
    dirs.push(...envPath("DYLD_LIBRARY_PATH"));
    dirs.push(
      "/usr/lib",
      "/usr/local/lib",
      "/usr/lib/x86_64-linux-gnu",
      "/usr/lib/aarch64-linux-gnu",
      "/opt/homebrew/lib",
      "/usr/local/opt",
    );
  }

  // Deduplicate and filter existing directories
  return Array.from(new Set(dirs.map((d) => path.resolve(d)).filter((d) => fs.existsSync(d))));
}

/**
 * Finds a native shared library by name on the host system.
 */
export function findNativeLibrary(
  solver: NativeSolverType,
  customPath?: string,
): { found: boolean; libraryPath?: string; details?: string } {
  if (customPath) {
    const abs = path.resolve(customPath);
    if (fs.existsSync(abs)) {
      return { found: true, libraryPath: abs };
    }
  }

  // Solver-specific custom environment variables
  if (solver === "highs") {
    const hDir = process.env["HIGHS_PATH"] ?? process.env["HIGHS_DIR"];
    if (hDir && fs.existsSync(hDir)) {
      for (const name of getPlatformLibNames("highs")) {
        const candidate = path.join(hDir, name);
        if (fs.existsSync(candidate)) return { found: true, libraryPath: candidate };
        const libSub = path.join(hDir, "lib", name);
        if (fs.existsSync(libSub)) return { found: true, libraryPath: libSub };
      }
    }
  } else if (solver === "gurobi") {
    const gHome = process.env["GUROBI_HOME"];
    if (gHome && fs.existsSync(gHome)) {
      const gLibDir = path.join(gHome, process.platform === "win32" ? "bin" : "lib");
      if (fs.existsSync(gLibDir)) {
        for (const ver of ["120", "110", "100", "95", "90", ""]) {
          for (const name of getPlatformLibNames(`gurobi${ver}`)) {
            const candidate = path.join(gLibDir, name);
            if (fs.existsSync(candidate)) return { found: true, libraryPath: candidate };
          }
        }
      }
    }
  } else if (solver === "mosek") {
    const mHome = process.env["MOSEK_HOME"];
    if (mHome && fs.existsSync(mHome)) {
      const candidates = [
        path.join(mHome, "tools/platform/linux64x86/bin", "libmosek64.so"),
        path.join(mHome, "tools/platform/osx64x86/bin", "libmosek64.dylib"),
        path.join(mHome, "tools/platform/win64x86/bin", "mosek64.dll"),
        path.join(mHome, "bin", "libmosek64.so"),
      ];
      for (const c of candidates) {
        if (fs.existsSync(c)) return { found: true, libraryPath: c };
      }
    }
  } else if (solver === "cplex") {
    const cHome = process.env["CPLEX_STUDIO_DIR"] ?? process.env["CPLEX_HOME"] ?? process.env["CPLEX_DIR"];
    if (cHome && fs.existsSync(cHome)) {
      const subdirs = [
        "cplex/bin/x86-64_linux",
        "cplex/bin/x64_win64",
        "cplex/bin/x86-64_osx",
        "cplex/lib",
        "bin",
        "lib",
      ];
      for (const sub of subdirs) {
        const fullSub = path.join(cHome, sub);
        if (fs.existsSync(fullSub)) {
          for (const ver of ["2211", "2210", "2010", "1210", "129", ""]) {
            for (const name of getPlatformLibNames(`cplex${ver}`)) {
              const candidate = path.join(fullSub, name);
              if (fs.existsSync(candidate)) return { found: true, libraryPath: candidate };
            }
          }
        }
      }
    }
  } else if (solver === "knitro") {
    const kHome = process.env["KNITRODIR"] ?? process.env["KNITRO_HOME"] ?? process.env["KNITRO_DIR"];
    if (kHome && fs.existsSync(kHome)) {
      const kLibDir = path.join(kHome, "lib");
      if (fs.existsSync(kLibDir)) {
        for (const ver of ["140", "132", "130", "124", ""]) {
          for (const name of getPlatformLibNames(`knitro${ver}`)) {
            const candidate = path.join(kLibDir, name);
            if (fs.existsSync(candidate)) return { found: true, libraryPath: candidate };
          }
        }
      }
    }
  }

  // Global search paths
  const baseNames =
    solver === "highs"
      ? ["highs"]
      : solver === "gurobi"
        ? ["gurobi120", "gurobi110", "gurobi100", "gurobi"]
        : solver === "mosek"
          ? ["mosek64", "mosek"]
          : solver === "cplex"
            ? ["cplex2211", "cplex2210", "cplex2010", "cplex1210", "cplex129", "cplex"]
            : ["knitro140", "knitro132", "knitro130", "knitro124", "knitro"];

  const searchDirs = getStandardLibrarySearchPaths();
  for (const dir of searchDirs) {
    for (const bName of baseNames) {
      for (const libName of getPlatformLibNames(bName)) {
        const fullPath = path.join(dir, libName);
        if (fs.existsSync(fullPath)) {
          return { found: true, libraryPath: fullPath };
        }
      }
    }
  }

  return {
    found: false,
    details: `Shared library for solver '${solver}' was not found in LD_LIBRARY_PATH or vendor directories.`,
  };
}

/**
 * Builds zero-copy typed arrays representing the model in Compressed Sparse Column (CSC) format.
 */
export function buildNativeCscMatrix(problem: InstantiatedProblem): NativeCscMatrix {
  const nVars = problem.variables.length;
  const nConstraints = problem.constraints.length;
  const isMaximize = problem.objective.direction === "maximize";

  const colCost = new Float64Array(nVars);
  for (const term of problem.objective.expr.linearTerms) {
    if (term.varId >= 0 && term.varId < nVars) {
      colCost[term.varId] = isMaximize ? -term.coeff : term.coeff;
    }
  }

  const colLower = new Float64Array(nVars);
  const colUpper = new Float64Array(nVars);
  const integrality = new Int32Array(nVars);

  for (let j = 0; j < nVars; j++) {
    const v = problem.variables[j]!;
    colLower[j] = Number.isFinite(v.lb) ? v.lb : -1e20;
    colUpper[j] = Number.isFinite(v.ub) ? v.ub : 1e20;
    if (v.type === "binary" || v.type === "integer") {
      integrality[j] = 1;
    } else if (v.type === "semicont") {
      integrality[j] = 2;
    } else if (v.type === "semiint") {
      integrality[j] = 3;
    } else {
      integrality[j] = 0;
    }
  }

  const rowLower = new Float64Array(nConstraints);
  const rowUpper = new Float64Array(nConstraints);
  for (let i = 0; i < nConstraints; i++) {
    const c = problem.constraints[i]!;
    rowLower[i] = Number.isFinite(c.lb) ? c.lb : -1e20;
    rowUpper[i] = Number.isFinite(c.ub) ? c.ub : 1e20;
  }

  // Count nonzeros per column
  const colCounts = new Int32Array(nVars);
  for (let i = 0; i < nConstraints; i++) {
    const con = problem.constraints[i]!;
    for (const term of con.expr.linearTerms) {
      if (term.varId >= 0 && term.varId < nVars && Math.abs(term.coeff) > 1e-15) {
        colCounts[term.varId]!++;
      }
    }
  }

  const colPointers = new Int32Array(nVars + 1);
  let totalNz = 0;
  for (let j = 0; j < nVars; j++) {
    colPointers[j] = totalNz;
    totalNz += colCounts[j]!;
  }
  colPointers[nVars] = totalNz;

  const rowIndices = new Int32Array(totalNz);
  const values = new Float64Array(totalNz);
  const currentOffsets = new Int32Array(colPointers);

  for (let i = 0; i < nConstraints; i++) {
    const con = problem.constraints[i]!;
    for (const term of con.expr.linearTerms) {
      if (term.varId >= 0 && term.varId < nVars && Math.abs(term.coeff) > 1e-15) {
        const dest = currentOffsets[term.varId]!++;
        rowIndices[dest] = i;
        values[dest] = term.coeff;
      }
    }
  }

  return {
    numCols: nVars,
    numRows: nConstraints,
    numNonzeros: totalNz,
    colPointers,
    rowIndices,
    values,
    colCost,
    colLower,
    colUpper,
    rowLower,
    rowUpper,
    integrality,
    isMaximize,
    objectiveConstant: problem.objective.expr.constant,
  };
}

/**
 * Checks native solver library availability.
 */
export function probeNativeSolver(solver: NativeSolverType): NativeLibraryProbe {
  const { found, libraryPath, details } = findNativeLibrary(solver);
  return {
    solver,
    available: found,
    libraryPath,
    error: details,
  };
}
