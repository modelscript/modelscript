// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { BlinkWasmRunner, createBlinkWasmRunner, type BatchSimulationResult } from "../src/fmu/pe-emulator/index.js";

console.log("=== Running Blink Wasm VM Runner Tests ===");

function createMinimalElf(): Uint8Array {
  const b = new Uint8Array(512);
  b[0] = 0x7f;
  b[1] = 0x45;
  b[2] = 0x4c;
  b[3] = 0x46; // \x7FELF
  b[4] = 2; // 64-bit
  b[5] = 1; // little-endian
  b[6] = 1; // ELF version
  b[7] = 0; // System V ABI
  const v = new DataView(b.buffer);
  v.setUint16(16, 3, true); // ET_DYN
  v.setUint16(18, 0x3e, true); // x86_64
  v.setUint32(20, 1, true); // EV_CURRENT
  v.setBigUint64(24, 0x1000n, true); // entry
  v.setBigUint64(32, 64n, true); // phOff
  v.setUint16(54, 56, true); // phentsize
  v.setUint16(56, 1, true); // phNum
  return b;
}

// ── Test 1: WebAssembly Environment Detection & Initialization ──
{
  console.log("\n[Test 1] Wasm Environment Detection & Runner Instantiation");
  assert.strictEqual(BlinkWasmRunner.isSupported(), true, "WebAssembly must be supported in Node.js");
  console.log("  ✓ WebAssembly engine support verified");

  const elfBuf = createMinimalElf();
  const runner = createBlinkWasmRunner(elfBuf, {
    modelName: "BlinkElfModel",
    variables: [
      { name: "state_x", valueReference: 1, causality: "output", start: 3.14159 },
      { name: "control_u", valueReference: 2, causality: "input", start: 1.0 },
    ],
  });

  assert.strictEqual(runner.engineName, "BlinkWasmRunner");
  assert.strictEqual(runner.isWasmEngine, true);
  assert.strictEqual(runner.getTime(), 0.0);
  assert.strictEqual(runner.getVar("state_x"), 3.14159);
  console.log("  ✓ BlinkWasmRunner initialized with state variables");

  runner.terminate();
}

// ── Test 2: Stepping and State Mutability ──
{
  console.log("\n[Test 2] State Mutability & Stepping");

  const elfBuf = createMinimalElf();
  const runner = new BlinkWasmRunner(elfBuf, {
    variables: [
      { name: "pos", valueReference: 10, start: 0.0 },
      { name: "force", valueReference: 20, start: 50.0 },
    ],
  });
  runner.init(0.0);

  runner.setVar("pos", 42.0);
  assert.strictEqual(runner.getVar("pos"), 42.0);

  const out = runner.step(0.0, 0.02, { force: 75.0 });
  assert.strictEqual(runner.getTime(), 0.02);
  assert.strictEqual(runner.getVar("force"), 75.0);
  assert.strictEqual(out["pos"], 42.0);
  assert.strictEqual(out["force"], 75.0);
  console.log("  ✓ Single step advanced time and updated input/output states");

  runner.terminate();
}

// ── Test 3: High-Throughput Batch Stepping (10,000 steps) ──
{
  console.log("\n[Test 3] High-Throughput Batch Stepping (10,000 steps)");

  const elfBuf = createMinimalElf();
  const runner = new BlinkWasmRunner(elfBuf, {
    variables: [
      { name: "v_out", valueReference: 1, start: 100.0 },
      { name: "i_in", valueReference: 2, start: 5.0 },
    ],
  });
  runner.init(0.0);

  const res: BatchSimulationResult = runner.stepBatch({
    startTime: 0.0,
    stepsCount: 10000,
    stepSize: 0.0001,
    sampleDecimation: 10, // record 1000 samples
    includeInitial: true,
  });

  assert.strictEqual(res.timeSteps, 1001, "10000 / 10 + 1 = 1001 frames");
  assert.strictEqual(res.timeBuffer.length, 1001);
  assert.strictEqual(res.outputMatrix.length, 1001 * 2);

  const vOutSeries = res.outputMap.get("v_out");
  assert.ok(vOutSeries !== undefined);
  assert.strictEqual(vOutSeries!.length, 1001);
  assert.strictEqual(vOutSeries![0], 100.0);

  const stepsPerSec = Math.round(10000 / (res.executionTimeMs / 1000));
  console.log(
    `  ✓ 10,000 steps executed in ${res.executionTimeMs.toFixed(2)}ms (~${stepsPerSec.toLocaleString()} steps/sec)`,
  );

  runner.terminate();
}

console.log("\n✅ All Blink Wasm VM Runner tests passed successfully!");
