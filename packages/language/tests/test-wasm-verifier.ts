// SPDX-License-Identifier: AGPL-3.0-or-later

import type { QueryDB, SymbolEntry } from "../src/compiler/runtime.js";
import { VerificationRunner, verifyTrajectoryDirect, type SimulationResult } from "../src/runtime/wasm_verifier.js";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function assertApprox(actual: number, expected: number, tol = 1e-4, message = ""): void {
  if (Math.abs(actual - expected) > tol) {
    throw new Error(`Assertion failed: ${message} - expected ${expected}, got ${actual}`);
  }
}

console.log("=== Testing WASM Trajectory & Requirement Verifier Suite ===");

// ── Test 1: Direct Vectorized Trajectory Verification ──
console.log("Test 1: Direct Vectorized Trajectory Verification across operators...");
{
  const t = [0.0, 0.1, 0.2, 0.3, 0.4, 0.5];
  // State 0: Ramp 0 -> 5. State 1: Sine 0 -> 1 -> 0
  const y = [
    [0.0, 0.0],
    [1.0, 0.5],
    [2.0, 0.8],
    [3.0, 1.0],
    [4.0, 0.8],
    [5.0, 0.5],
  ];

  // Check state 0 <= 6.0 (satisfied throughout)
  const res1 = verifyTrajectoryDirect(t, y, 2, 0, "<=", 6.0);
  assert(res1.isSatisfied, "state 0 <= 6.0 should be satisfied");
  assertApprox(res1.peakValue, 5.0, 1e-6, "peak value of state 0 should be 5.0");
  assert(res1.violationTime === undefined, "no violation time when satisfied");

  // Check state 0 <= 2.5 (violated at t = 0.3)
  const res2 = verifyTrajectoryDirect(t, y, 2, 0, "<=", 2.5);
  assert(!res2.isSatisfied, "state 0 <= 2.5 should be violated");
  assertApprox(res2.violationTime ?? -1, 0.3, 1e-6, "violation time should be 0.3");
  assert(res2.violationIndex === 3, "violation step index should be 3");
  assertApprox(res2.peakValue, 5.0, 1e-6, "peak value should still be 5.0");

  // Check state 1 > -0.1 (satisfied throughout)
  const res3 = verifyTrajectoryDirect(t, y, 2, 1, ">", -0.1);
  assert(res3.isSatisfied, "state 1 > -0.1 should be satisfied");
  assertApprox(res3.peakValue, 1.0, 1e-6, "peak value of state 1 should be 1.0");

  // Check state 1 == 0.0 (violated at t = 0.1)
  const res4 = verifyTrajectoryDirect(t, y, 2, 1, "==", 0.0);
  assert(!res4.isSatisfied, "state 1 == 0.0 should be violated");
  assertApprox(res4.violationTime ?? -1, 0.1, 1e-6, "violation time should be 0.1");

  console.log("  ✓ Direct trajectory verification passed for <=, >, ==, and peak tracking");
}

// ── Test 2: Dynamic System Trajectory Verification (RC Step Response) ──
console.log("Test 2: Dynamic Exponential Response Step Verification...");
{
  // Simulation: v(t) = 10 * (1 - exp(-t / 0.5)) -> asymptotically reaches 10V
  const numSteps = 50;
  const t: number[] = [];
  const y: number[][] = [];
  const dt = 0.05;

  for (let i = 0; i < numSteps; i++) {
    const time = i * dt;
    const v = 10.0 * (1.0 - Math.exp(-time / 0.5));
    t.push(time);
    y.push([v]);
  }

  // Requirement 1: Voltage must stay below 12.0V (Satisfied)
  const req1 = verifyTrajectoryDirect(t, y, 1, 0, "<=", 12.0);
  assert(req1.isSatisfied, "Voltage overshoot check <= 12.0V satisfied");
  const lastYRow = y[numSteps - 1];
  const lastY = lastYRow ? (lastYRow[0] ?? 0) : 0;
  assertApprox(req1.peakValue, lastY, 1e-4, "Peak voltage tracks final trajectory value");

  // Requirement 2: Max allowed voltage is 8.0V (Violated)
  const req2 = verifyTrajectoryDirect(t, y, 1, 0, "<=", 8.0);
  assert(!req2.isSatisfied, "Voltage limit 8.0V violated");
  // 10 * (1 - exp(-t/0.5)) = 8 => exp(-t/0.5) = 0.2 => t = -0.5 * ln(0.2) ≈ 0.8047s
  const vTime = req2.violationTime ?? 0;
  assert(vTime >= 0.8 && vTime <= 0.86, "Violation time correctly detected near ~0.8s");

  console.log("  ✓ Dynamic step response correctly verified with asymptotic bounds");
}

// ── Test 3: Language-Agnostic VerificationRunner with CST & QueryDB Mock ──
console.log("Test 3: Language-Agnostic VerificationRunner Case Verification...");
{
  const mockEntries: SymbolEntry[] = [
    {
      id: 1,
      name: "VoltageVerificationCase",
      kind: "Definition",
      ruleName: "VerificationCase",
      startByte: 0,
      endByte: 100,
      parentId: null,
    },
    {
      id: 2,
      name: "maxVoltageReq",
      kind: "Usage",
      ruleName: "RequirementUsage",
      startByte: 10,
      endByte: 50,
      parentId: 1,
    },
    {
      id: 3,
      name: "MaxVoltageConstraint",
      kind: "Usage",
      ruleName: "ConstraintUsage",
      startByte: 20,
      endByte: 45,
      parentId: 2,
    },
  ];

  const mockCst = {
    childForFieldName: (name: string) => {
      if (name === "left") return { text: "circuit.C.v" };
      if (name === "operator") return { text: "<=" };
      if (name === "right") return { text: "10.0" };
      return null;
    },
  };

  const mockDb: Partial<QueryDB> = {
    childrenOf: (parentId: number | null) => mockEntries.filter((e) => e.parentId === parentId),
    byName: (name: string) => mockEntries.filter((e) => e.name === name),
    allEntries: () => mockEntries,
    cstNode: (id: number) => (id === 3 ? mockCst : null),
    cstText: () => "= 10.0",
    evaluate: () => undefined,
  };

  const varMap = new Map<string, string>();
  varMap.set("circuit.C.v", "v_cap");

  const runner = new VerificationRunner(mockDb as QueryDB, varMap);

  const simResultPassing: SimulationResult = {
    t: [0.0, 1.0, 2.0],
    states: ["v_cap"],
    y: [[0.0], [5.0], [9.8]],
  };

  const resultsPass = runner.verifyCase(1, simResultPassing);
  assert(resultsPass.length > 0, "should produce verification results");
  const passFirst = resultsPass[0];
  assert(passFirst ? passFirst.isSatisfied : false, "requirement should be satisfied (9.8 <= 10.0)");
  assertApprox(passFirst?.peakValue ?? 0, 9.8, 1e-6, "peak value should be 9.8");

  const simResultFailing: SimulationResult = {
    t: [0.0, 1.0, 2.0, 3.0],
    states: ["v_cap"],
    y: [[0.0], [5.0], [9.8], [11.2]],
  };

  const resultsFail = runner.verifyCase(1, simResultFailing);
  assert(resultsFail.length > 0, "should produce verification results");
  const failFirst = resultsFail[0];
  assert(failFirst ? !failFirst.isSatisfied : false, "requirement should be violated (11.2 > 10.0)");
  assertApprox(failFirst?.violationTime ?? 0, 3.0, 1e-6, "violation time should be 3.0s");
  const failMsg = failFirst?.message ?? "";
  assert(failMsg.includes("Requirement violated"), "should format violation diagnostic message");

  console.log("  ✓ VerificationRunner passed case verification with symbol hierarchy and variableMap");
}

console.log("=== All WASM Trajectory & Requirement Verifier Tests Passed Cleanly ===");
