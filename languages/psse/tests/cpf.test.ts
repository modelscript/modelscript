// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { parseRaw, solveContinuationPowerFlow } from "../src/index.js";

const IEEE14_PATH = path.resolve(import.meta.dirname, "../testsuite/ieee14.raw");

test("Continuation Power Flow (CPF): Traces P-V curve and identifies bifurcation limit", () => {
  const content = fs.readFileSync(IEEE14_PATH, "utf-8");
  const pCase = parseRaw(content);

  const cpf = solveContinuationPowerFlow(pCase, {
    maxSteps: 30,
    stepSize: 0.1,
  });

  assert.ok(cpf.converged, "CPF should converge and locate bifurcation point");
  assert.ok(cpf.lambdaMax > 0.2, `lambda_max should be > 0.2, got ${cpf.lambdaMax}`);
  assert.ok(cpf.maxLoadabilityMw > 0);
  assert.ok(cpf.marginMw > 0);
  assert.ok(cpf.steps.length > 2);
  assert.ok(cpf.weakestBus > 0);

  // Check report text
  assert.ok(cpf.reportText.includes("CONTINUATION POWER FLOW (CPF) / P-V CURVE ANALYSIS"));
  assert.ok(cpf.reportText.includes("Max Loadability Param"));
  assert.ok(cpf.reportText.includes(`Bus ${cpf.weakestBus}`));
});
