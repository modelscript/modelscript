// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { runCfdVvSuite } from "../src/cfd/index.js";
import { probeExternalCfdSolvers, saveCfdVvScorecard } from "../src/cfd/vv-benchmarks.js";

console.log("=== Testing Workstream 5: Automated 3D CFD V&V Benchmark Suite ===");

const scorecard = runCfdVvSuite();
for (const c of scorecard.cases) {
  console.log(
    `  [${c.passed ? "PASS" : "FAIL"}] ${c.id}: ${c.name} | err=${c.measuredError} (<= ${c.threshold}) | ${c.durationMs}ms | ${JSON.stringify(c.metrics)}`,
  );
  assert.ok(c.passed, `V&V benchmark case ${c.id} failed: err=${c.measuredError} > ${c.threshold}`);
}

assert.strictEqual(scorecard.allPassed, true);
assert.strictEqual(scorecard.passedCount, 5);

const writtenPath = saveCfdVvScorecard(scorecard);
assert.strictEqual(writtenPath, path.resolve(".cache/benchmarks/cfd/vv-scorecard.json"));
assert.strictEqual(existsSync(writtenPath), true, `Expected scorecard JSON at ${writtenPath}`);
const parsed = JSON.parse(readFileSync(writtenPath, "utf8"));
assert.strictEqual(parsed.allPassed, true);
assert.strictEqual(parsed.passedCount, scorecard.passedCount);
assert.strictEqual(parsed.totalCount, scorecard.totalCount);
assert.strictEqual(Array.isArray(parsed.cases), true);
assert.strictEqual(parsed.cases.length, 5);
console.log(`Saved V&V scorecard JSON to ${writtenPath}`);

const solverProbe = probeExternalCfdSolvers();
assert.strictEqual(typeof solverProbe.su2Available, "boolean");
assert.strictEqual(typeof solverProbe.openFoamAvailable, "boolean");
if (solverProbe.su2Version !== undefined) {
  assert.strictEqual(typeof solverProbe.su2Version, "string");
}
if (solverProbe.openFoamVersion !== undefined) {
  assert.strictEqual(typeof solverProbe.openFoamVersion, "string");
}
console.log(
  `External solver probe: su2Available=${solverProbe.su2Available}, openFoamAvailable=${solverProbe.openFoamAvailable}`,
);

console.log(`All ${scorecard.passedCount}/${scorecard.totalCount} CFD Vision 2030 V&V benchmarks passed!`);
