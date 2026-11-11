// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/ampl — External Solver Runner.
 *
 * Dispatches instantiated optimization problems to external binary solvers
 * (CPLEX, HiGHS, CBC, SCIP, IPOPT, Couenne) via standard ASL (.nl / .sol)
 * or MPS (.mps) file pipes.
 */

import childProcess from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { writeMpsProblem } from "../mps/index.js";
import { readSolResult } from "../nl/nl-reader.js";
import { writeNlProblem } from "../nl/nl-writer.js";
import type { AmplSolverResult, InstantiatedProblem } from "../types.js";

export type SupportedExternalSolver = "cplex" | "highs" | "cbc" | "scip" | "ipopt" | "couenne";

const SOLVER_BINARIES: Record<SupportedExternalSolver, string[]> = {
  cplex: ["cplexamp", "cplex"],
  highs: ["highs"],
  cbc: ["cbc"],
  scip: ["scip"],
  ipopt: ["ipopt"],
  couenne: ["couenne"],
};

/**
 * Finds the binary path for an external solver if installed on the host system.
 */
export function findExternalSolverBinary(solver: SupportedExternalSolver): string | undefined {
  if (!Object.prototype.hasOwnProperty.call(SOLVER_BINARIES, solver)) {
    return undefined;
  }
  const candidates = SOLVER_BINARIES[solver];
  if (!candidates) return undefined;

  for (const bin of candidates) {
    if (!/^[a-zA-Z0-9_-]+$/.test(bin)) {
      continue;
    }
    try {
      const checkTool = process.platform === "win32" ? "where" : "which";
      const out = childProcess.spawnSync(checkTool, [bin], {
        stdio: ["ignore", "pipe", "ignore"],
        encoding: "utf-8",
        shell: false,
      });
      const found = out.stdout?.split(/\r?\n/)[0]?.trim();
      if (found && fs.existsSync(found)) {
        return found;
      }
    } catch {
      // not found
    }
  }
  return undefined;
}

/**
 * Checks whether an external solver is installed and executable on the host system.
 */
export function isExternalSolverAvailable(solver: SupportedExternalSolver): boolean {
  return findExternalSolverBinary(solver) !== undefined;
}

export interface ExternalSolverOptions {
  tolerance?: number | undefined;
  maxIterations?: number | undefined;
  timeLimitSec?: number | undefined;
}

/**
 * Solves an instantiated optimization problem using an external solver via ASL .nl/.sol pipe.
 */
export async function solveWithExternalSolver(
  problem: InstantiatedProblem,
  solver: SupportedExternalSolver,
  options?: ExternalSolverOptions,
): Promise<AmplSolverResult> {
  const bin = findExternalSolverBinary(solver);
  if (!bin) {
    throw new Error(
      `External solver '${solver}' was not found on PATH (searched: ${SOLVER_BINARIES[solver]?.join(", ")}). ` +
        `Please ensure '${solver}' is installed and accessible in your shell environment, ` +
        `or use ModelScript's built-in in-WASM solvers ('clp', 'cbc', 'ipopt', 'couenne').`,
    );
  }

  const startTime = Date.now();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "modelscript-ampl-"));
  const nlFile = path.join(tmpDir, "problem.nl");
  const solFile = path.join(tmpDir, "problem.sol");
  const mpsFile = path.join(tmpDir, "problem.mps");

  try {
    // 1. Emit standard .nl problem file
    const nlContent = writeNlProblem(problem);
    fs.writeFileSync(nlFile, nlContent, "utf-8");

    // Also write .mps for solvers that prefer MPS input
    const mpsContent = writeMpsProblem(problem);
    fs.writeFileSync(mpsFile, mpsContent, "utf-8");

    // 2. Build invocation arguments depending on the solver
    let args: string[] = [];
    if (solver === "highs") {
      args = [nlFile, "-AMPL"];
    } else if (solver === "cplex") {
      if (path.basename(bin).startsWith("cplexamp")) {
        args = [nlFile, "-AMPL"];
      } else {
        // Standard cplex interactive CLI
        args = ["-c", `read ${mpsFile}`, "optimize", `write ${solFile}`];
      }
    } else if (solver === "cbc" || solver === "ipopt" || solver === "couenne") {
      args = [nlFile, "-AMPL"];
    } else if (solver === "scip") {
      args = ["-f", mpsFile];
    }

    const execRes = childProcess.spawnSync(bin, args, {
      cwd: tmpDir,
      encoding: "utf-8",
      timeout: (options?.timeLimitSec ?? 60) * 1000,
    });

    const elapsed = Date.now() - startTime;
    const stdout = execRes.stdout ?? "";
    const stderr = execRes.stderr ?? "";

    // 3. Read back solution file if produced
    let solResult: Record<string, number> = {};
    let objVal = 0;
    let status: AmplSolverResult["status"] = "OPTIMAL";
    let message = `Solved with external solver '${solver}'.`;

    if (fs.existsSync(solFile)) {
      const solText = fs.readFileSync(solFile, "utf-8");
      const parsedSol = readSolResult(solText);
      message = parsedSol.message || message;

      for (let i = 0; i < problem.variables.length; i++) {
        const v = problem.variables[i]!;
        const val = parsedSol.primalValues[i] ?? 0;
        solResult[v.name] = val;
      }

      // Calculate objective from primal values
      let calcObj = problem.objective.expr.constant;
      for (const t of problem.objective.expr.linearTerms) {
        const v = problem.variables[t.varId]!;
        calcObj += t.coeff * (solResult[v.name] ?? 0);
      }
      objVal = calcObj;
    } else {
      // Fallback: parse objective and status from stdout
      const objMatch = stdout.match(/objective[:\s=]+([+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/i);
      if (objMatch && objMatch[1]) {
        objVal = Number.parseFloat(objMatch[1]);
      }
      if (/infeasible/i.test(stdout)) {
        status = "INFEASIBLE";
      } else if (/unbounded/i.test(stdout)) {
        status = "UNBOUNDED";
      }
      message = (stdout.trim() || stderr.trim()).split(/\r?\n/).slice(0, 3).join(" ").trim() || message;
    }

    return {
      problemName: problem.name,
      problemClass: problem.problemClass,
      status,
      statusCode: execRes.status ?? 0,
      message,
      objectiveValue: objVal,
      variables: solResult,
      solveTimeMs: elapsed,
    };
  } finally {
    // Clean up temporary directory
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  }
}
