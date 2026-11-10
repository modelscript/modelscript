// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import test from "node:test";
import {
  findExternalSolverBinary,
  instantiateAmpl,
  isExternalSolverAvailable,
  parseAmplModel,
  solveAmpl,
  solveWithExternalSolver,
} from "../src/index.js";

test("AMPL External Solver — detects absence of uninstalled commercial solvers gracefully", async () => {
  const isCplexInstalled = isExternalSolverAvailable("cplex");
  const bin = findExternalSolverBinary("cplex");

  if (!isCplexInstalled) {
    assert.strictEqual(bin, undefined);

    const model = parseAmplModel(`
var x >= 0;
minimize Cost: 2 * x;
subject to Limit: x >= 10;
`);
    const problem = instantiateAmpl(model);

    await assert.rejects(
      async () => {
        await solveWithExternalSolver(problem, "cplex");
      },
      (err: Error) => {
        assert.ok(
          err.message.includes("External solver 'cplex' was not found on PATH"),
          `Expected PATH error, got: ${err.message}`,
        );
        assert.ok(
          err.message.includes("cplexamp, cplex"),
          `Expected binary search list, got: ${err.message}`,
        );
        return true;
      },
    );

    // Also verify solveAmpl dispatches to external solver when requested
    await assert.rejects(
      async () => {
        await solveAmpl(problem, { solver: "cplex" });
      },
      /External solver 'cplex' was not found on PATH/,
    );
  }
});
