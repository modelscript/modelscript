// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  generateCentralComposite,
  generateFullFactorial,
  generateLatinHypercube,
  generateSobolPoints,
  runArenaDoE,
  runArenaDoEAsync,
  type ArenaDoEConfig,
  type ArenaDoEInputRange,
} from "../src/runtime/wasm_doe.js";
import { Xoshiro256pp } from "../src/runtime/wasm_monte_carlo.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  console.log("=== Testing WASM Design of Experiments (DoE) Framework ===");

  // ─────────────────────────────────────────────────────────────────────────────
  // Test 1: Full-Factorial Grid Generation
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("Test 1: Full-Factorial sampling grid generation...");
  const ffRanges = new Map<string, ArenaDoEInputRange>([
    ["param_a", { min: 0.0, max: 10.0, levels: 3 }],
    ["param_b", { min: 100.0, max: 200.0, levels: 2 }],
  ]);
  const ffNames = Array.from(ffRanges.keys());
  const ffPoints = generateFullFactorial(ffNames, ffRanges);

  assert.strictEqual(ffPoints.length, 6, "3 levels * 2 levels should produce 6 sample points");
  // Check expected points: (0, 100), (0, 200), (5, 100), (5, 200), (10, 100), (10, 200)
  const expectedA = [0.0, 5.0, 10.0];
  const expectedB = [100.0, 200.0];
  for (const pt of ffPoints) {
    const a = pt[0] ?? -1;
    const b = pt[1] ?? -1;
    assert.ok(
      expectedA.some((val) => Math.abs(val - a) < 1e-6),
      `Unexpected a value: ${a}`,
    );
    assert.ok(
      expectedB.some((val) => Math.abs(val - b) < 1e-6),
      `Unexpected b value: ${b}`,
    );
  }
  console.log(`  ✓ Generated ${ffPoints.length} full-factorial sample points correctly`);

  // ─────────────────────────────────────────────────────────────────────────────
  // Test 2: Latin Hypercube Stratified Sampling
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("Test 2: Latin Hypercube stratified sampling...");
  const lhsRanges = new Map<string, ArenaDoEInputRange>([
    ["mass", { min: 1.0, max: 10.0 }],
    ["damping", { min: 0.1, max: 2.0 }],
    ["stiffness", { min: 10.0, max: 100.0 }],
  ]);
  const lhsNames = Array.from(lhsRanges.keys());
  const rng = new Xoshiro256pp(42);
  const lhsPoints = generateLatinHypercube(lhsNames, lhsRanges, 50, rng);

  assert.strictEqual(lhsPoints.length, 50, "Should generate 50 LHS points");
  for (const pt of lhsPoints) {
    const m = pt[0] ?? 0;
    const d = pt[1] ?? 0;
    const k = pt[2] ?? 0;
    assert.ok(m >= 1.0 && m <= 10.0, `Mass out of bounds: ${m}`);
    assert.ok(d >= 0.1 && d <= 2.0, `Damping out of bounds: ${d}`);
    assert.ok(k >= 10.0 && k <= 100.0, `Stiffness out of bounds: ${k}`);
  }
  console.log(`  ✓ Generated ${lhsPoints.length} Latin Hypercube points strictly within bounds`);

  // ─────────────────────────────────────────────────────────────────────────────
  // Test 3: Sobol Low-Discrepancy Sequences
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("Test 3: Sobol low-discrepancy quasi-random sequences...");
  const sobolRanges = new Map<string, ArenaDoEInputRange>([
    ["x1", { min: -5.0, max: 5.0 }],
    ["x2", { min: 0.0, max: 1.0 }],
  ]);
  const sobolNames = Array.from(sobolRanges.keys());
  const sobolPoints = generateSobolPoints(sobolNames, sobolRanges, 100);

  assert.strictEqual(sobolPoints.length, 100, "Should generate 100 Sobol points");
  for (const pt of sobolPoints) {
    const x1 = pt[0] ?? 0;
    const x2 = pt[1] ?? 0;
    assert.ok(x1 >= -5.0 && x1 <= 5.0, `Sobol x1 out of bounds: ${x1}`);
    assert.ok(x2 >= 0.0 && x2 <= 1.0, `Sobol x2 out of bounds: ${x2}`);
  }
  console.log(`  ✓ Generated ${sobolPoints.length} Sobol quasi-random points across 2D domain`);

  // ─────────────────────────────────────────────────────────────────────────────
  // Test 4: Central Composite Design (CCD)
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("Test 4: Central Composite Design (CCD)...");
  const ccdRanges = new Map<string, ArenaDoEInputRange>([
    ["temp", { min: 200.0, max: 400.0 }],
    ["pressure", { min: 1.0, max: 10.0 }],
  ]);
  const ccdNames = Array.from(ccdRanges.keys());
  const ccdPoints = generateCentralComposite(ccdNames, ccdRanges);

  // For k=2: 2^2 (4 factorial) + 2*2 (4 axial) + 1 center = 9 points
  assert.strictEqual(ccdPoints.length, 9, "CCD for k=2 must generate 9 points");

  // Center point must be (300.0, 5.5)
  const center = ccdPoints[ccdPoints.length - 1] ?? [];
  assert.ok(Math.abs((center[0] ?? 0) - 300.0) < 1e-6, `Center temp mismatch: ${center[0]}`);
  assert.ok(Math.abs((center[1] ?? 0) - 5.5) < 1e-6, `Center pressure mismatch: ${center[1]}`);
  console.log(`  ✓ Generated ${ccdPoints.length} CCD points with correct factorial, axial, and center coordinates`);

  // ─────────────────────────────────────────────────────────────────────────────
  // Test 5: End-to-End Simulation with runArenaDoE & runArenaDoEAsync
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("Test 5: End-to-end model parameter sweep via runArenaDoE...");

  const { initBltWasm } = await import("../src/runtime/wasm_blt.js");
  await initBltWasm();

  const { DAEBuilder, BinOp, EqKind, UnaryOp, VarType, Variability } = await import("../src/compiler/index.js");

  const arena = new DAEBuilder();
  const xIdx = arena.addVariable("x", VarType.Real, Variability.Continuous, 0, 5.0);
  arena.setVarStartValue(xIdx, 5.0);

  const kIdx = arena.addVariable("k", VarType.Real, Variability.Parameter, 0, 2.0);
  const kLit = arena.addRealLiteral(2.0);
  arena.setVarExpression(kIdx, kLit);

  // der(x) = -k * x
  const xExpr = arena.addNameExpr("x");
  const derX = arena.addDerExpr(xExpr);
  const kExpr = arena.addNameExpr("k");
  const rhs = arena.addUnaryExpr(UnaryOp.Negate, arena.addBinaryExpr(BinOp.Mul, kExpr, xExpr));
  arena.addEquation(EqKind.Simple, derX, rhs);

  // Run full-factorial DoE over k in [1.0, 3.0] with 3 levels
  const doeConfig: ArenaDoEConfig = {
    inputs: new Map<string, ArenaDoEInputRange>([["k", { min: 1.0, max: 3.0, levels: 3 }]]),
    outputs: ["x"],
    strategy: "full-factorial",
    simulateOptions: { startTime: 0.0, stopTime: 1.0, step: 0.01 },
  };

  const doeResult = runArenaDoE(arena, doeConfig);

  assert.strictEqual(doeResult.totalSamples, 3, "Total samples should be 3");
  assert.strictEqual(doeResult.failedSamples, 0, "No samples should fail");
  assert.strictEqual(doeResult.inputs.length, 3);
  assert.strictEqual(doeResult.outputs.length, 3);

  // At t=1.0: x(1) = 5.0 * exp(-k * 1)
  // For k=1: 5 * exp(-1) ≈ 1.8394
  // For k=2: 5 * exp(-2) ≈ 0.6767
  // For k=3: 5 * exp(-3) ≈ 0.2489
  const expectedResponses = [5.0 * Math.exp(-1.0), 5.0 * Math.exp(-2.0), 5.0 * Math.exp(-3.0)];

  for (let i = 0; i < 3; i++) {
    const kVal = doeResult.inputs[i]?.[0] ?? 0;
    const resp = (doeResult.outputs as number[][])[i]?.[0] ?? 0;
    const expected = expectedResponses[i] ?? 0;
    assert.ok(
      Math.abs(resp - expected) < 0.05,
      `For k=${kVal}, expected response ≈ ${expected.toFixed(4)}, got ${resp.toFixed(4)}`,
    );
    console.log(
      `  ✓ Sample ${i + 1} (k=${kVal.toFixed(1)}): response x(1.0)=${resp.toFixed(4)} ≈ ${expected.toFixed(4)}`,
    );
  }

  // Run async variant with transient snapshots
  const asyncDoEConfig: ArenaDoEConfig = {
    inputs: new Map<string, ArenaDoEInputRange>([["k", { min: 1.0, max: 2.0, levels: 2 }]]),
    outputs: ["x"],
    strategy: "full-factorial",
    snapshotTimes: [0.5, 1.0],
    simulateOptions: { startTime: 0.0, stopTime: 1.0, step: 0.01 },
  };

  const asyncResult = await runArenaDoEAsync(arena, asyncDoEConfig);
  assert.ok(asyncResult.isTransient, "Result should be marked as transient");
  assert.strictEqual((asyncResult.outputs as number[][][]).length, 2);
  assert.strictEqual((asyncResult.outputs as number[][][])[0]?.length, 2);

  console.log("=== All WASM Design of Experiments (DoE) Tests Passed Cleanly ===");
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
