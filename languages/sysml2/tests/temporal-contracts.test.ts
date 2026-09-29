// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { verifyTemporalContract, type TemporalContract } from "../src/contract-verifier.js";

console.log("=== Testing Temporal Hyper-Contracts & Compositional Verification ===");

// 1. Compatible contract test:
// Contract: when input voltage is in [11.5, 12.5], output voltage must be in [4.8, 5.2] (5V regulator)
const regulatorContract: TemporalContract = {
  name: "Contract_5VRegulator",
  assumption: "v_in >= 11.5 and v_in <= 12.5",
  guarantee: "v_out >= 4.8 and v_out <= 5.2",
  timeHorizon: [0.0, 5.0],
};

const times = [0.0, 1.0, 2.0, 3.0, 4.0, 5.0];
const compatibleSignals = {
  v_in: [12.0, 12.1, 11.9, 12.0, 12.2, 12.0], // All within [11.5, 12.5]
  v_out: [5.0, 5.05, 4.95, 5.0, 5.02, 5.01], // All within [4.8, 5.2]
};

const res1 = verifyTemporalContract(regulatorContract, times, compatibleSignals);
assert.strictEqual(res1.isSatisfied, true, "Compatible signals must satisfy temporal contract");
assert(res1.minRobustness > 0, "Robustness margin must be positive");
console.log(`  ✓ Compatible contract verified with robustness margin: ${res1.minRobustness.toFixed(4)}`);

// 2. Violated contract test:
// At t = 3.0s, regulator output sags to 4.5V (< 4.8V) despite valid input voltage 12.0V
const saggingSignals = {
  v_in: [12.0, 12.0, 12.0, 12.0, 12.0, 12.0],
  v_out: [5.0, 5.0, 4.9, 4.5, 4.9, 5.0], // Violation at index 3 (t = 3.0s)
};

const res2 = verifyTemporalContract(regulatorContract, times, saggingSignals);
assert.strictEqual(res2.isSatisfied, false, "Sagging voltage must violate contract guarantee");
assert.strictEqual(res2.violationTime, 3.0, "Violation timestamp must be identified at t = 3.0s");
assert.strictEqual(res2.counterexample, 4.5, "Counterexample output value must be 4.5V");
assert(res2.minRobustness < 0, "Robustness must be negative");
console.log(
  `  ✓ Contract violation caught at t = ${res2.violationTime}s with counterexample = ${res2.counterexample}V`,
);

// 3. Vacuously satisfied test:
// If input voltage is disconnected (v_in = 0 < 11.5), assumption does not hold,
// so guarantee violation does NOT constitute a contract breach by the component
const disconnectedSignals = {
  v_in: [0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
  v_out: [0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
};

const res3 = verifyTemporalContract(regulatorContract, times, disconnectedSignals);
assert.strictEqual(res3.isSatisfied, true, "Contract is vacuously satisfied when assumptions do not hold");
console.log("  ✓ Vacuous satisfaction under unfulfilled assumption: OK");

console.log("Temporal Hyper-Contracts & Compositional Verification verified successfully!");
