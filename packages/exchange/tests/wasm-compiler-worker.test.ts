// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import {
  compileCToWasmInBrowser,
  createWasmFmuRunner,
  CWasmCompilerClient,
  CWasmStageMessage,
  parseCSourceModel,
  synthesizeWasmBinary,
} from "../src/fmu/wasm-compiler-worker.js";

console.log("=== Running @modelscript/exchange In-Browser C-to-Wasm Compiler Tests ===");

async function main() {
  // ── Test 1: C Source Parsing & Specification Extraction ──
  console.log("1. Testing parseCSourceModel with Spring-Mass-Damper C source...");

  const cSource = `
    #include <math.h>
    #include "fmi2Functions.h"

    double v_x = 1.0;
    double v_v = 0.0;
    double der_x = 0.0;
    double der_v = 0.0;
    double in_force = 0.0;
    double out_pos = 0.0;
    double p_k = 10.0;
    double p_c = 1.0;

    void wasm_init(double t0) {
      v_x = 1.0;
      v_v = 0.0;
    }

    void wasm_do_step(double dt) {
      der_x = 1.0 * v_v;
      der_v = -10.0 * v_x + -1.0 * v_v + 1.0 * in_force;
      out_pos = 1.0 * v_x;
    }
  `;

  const spec = parseCSourceModel(cSource, "SpringMassDamper");
  assert.strictEqual(spec.modelName, "SpringMassDamper");
  assert.ok(spec.numStates >= 2, `Expected at least 2 states, got ${spec.numStates}`);
  assert.ok(spec.derivativeNames.length >= 2, "Expected derivative names to be populated");
  assert.ok(spec.inputNames.length >= 1, "Expected inputNames to contain in_force");
  assert.ok(spec.outputNames.length >= 1, "Expected outputNames to contain out_pos");

  // ── Test 2: WebAssembly 1.0 Binary Synthesis & Validation ──
  console.log("2. Testing synthesizeWasmBinary produces valid WebAssembly 1.0 bytecode...");

  const wasmBinary = synthesizeWasmBinary(spec);
  assert.ok(wasmBinary instanceof Uint8Array, "wasmBinary must be a Uint8Array");
  assert.ok(wasmBinary.byteLength > 64, `WASM binary too small: ${wasmBinary.byteLength} bytes`);

  // Magic bytes: \0asm
  assert.strictEqual(wasmBinary[0], 0x00);
  assert.strictEqual(wasmBinary[1], 0x61);
  assert.strictEqual(wasmBinary[2], 0x73);
  assert.strictEqual(wasmBinary[3], 0x6d);

  // Version: 1
  assert.strictEqual(wasmBinary[4], 0x01);
  assert.strictEqual(wasmBinary[5], 0x00);
  assert.strictEqual(wasmBinary[6], 0x00);
  assert.strictEqual(wasmBinary[7], 0x00);

  // Validate with WebAssembly engine
  const isValid = WebAssembly.validate(wasmBinary);
  assert.strictEqual(isValid, true, "WebAssembly.validate must succeed for synthesized binary");

  // ── Test 3: Module Instantiation & FMI Stepping Simulation ──
  console.log("3. Testing createWasmFmuRunner and numerical simulation stepping...");

  const runner = await createWasmFmuRunner(wasmBinary, spec);
  assert.ok(runner.instance, "Runner must have an instantiated WebAssembly.Instance");

  runner.init(0.0);
  assert.strictEqual(runner.getTime(), 0.0, "Time at init must be 0.0");

  // Run 50 steps of 0.01s with constant input force = 2.0
  const dt = 0.01;
  let t = 0.0;
  for (let step = 0; step < 50; step++) {
    const outs = runner.step(t, dt, { in_force: 2.0 });
    t += dt;
    assert.ok(typeof outs === "object", "Step outputs must be an object");
  }

  const finalTime = runner.getTime();
  assert.ok(Math.abs(finalTime - 0.5) < 1e-4, `Expected final time near 0.5s, got ${finalTime}`);

  // Test setVar & getVar
  runner.setVar(0, 42.0);
  const v0 = runner.getVar(0);
  assert.strictEqual(v0, 42.0, "getVar(0) must return the set value 42.0");

  // ── Test 4: CWasmCompilerClient & Stage Progress Protocol ──
  console.log("4. Testing CWasmCompilerClient with stage updates and caching...");

  const client = new CWasmCompilerClient();
  const stages: CWasmStageMessage[] = [];

  const res1 = await client.compile(
    {
      modelIdentifier: "TestModel",
      sources: cSource,
      optimizationLevel: "O2",
    },
    (st) => stages.push(st),
  );

  assert.strictEqual(res1.type, "SUCCESS");
  assert.strictEqual(res1.fromCache, false, "First compilation must not be from cache");
  assert.ok(res1.wasmByteLength > 0);
  assert.ok(stages.length >= 2, "Expected multiple stage progress notifications");
  assert.strictEqual(stages[stages.length - 1]!.stage, "ready");

  // Test 5: In-Memory SHA-256 Cache Hit
  console.log("5. Testing cache hit on subsequent identical compilation...");
  const cacheStages: CWasmStageMessage[] = [];
  const res2 = await client.compile(
    {
      modelIdentifier: "TestModel",
      sources: cSource,
      optimizationLevel: "O2",
    },
    (st) => cacheStages.push(st),
  );

  assert.strictEqual(res2.type, "SUCCESS");
  assert.strictEqual(res2.fromCache, true, "Second compilation must hit SHA-256 cache");
  assert.strictEqual(res2.sourceSha256, res1.sourceSha256, "SHA-256 hashes must match");

  // Test 6: Multi-File Source Map
  console.log("6. Testing multi-file bundle compilation via compileCToWasmInBrowser...");
  const bundle = {
    "model.h": "double v_x = 0.0; double der_x = 0.0; double in_u = 0.0; double out_y = 0.0;",
    "model.c": "void wasm_do_step(double dt) { der_x = -2.0 * v_x + 1.0 * in_u; out_y = v_x; }",
  };

  const resBundle = await compileCToWasmInBrowser(bundle, "MultiFileModel");
  assert.strictEqual(resBundle.type, "SUCCESS");
  assert.ok(resBundle.wasmBinary.byteLength > 64);
  assert.ok(WebAssembly.validate(resBundle.wasmBinary), "Multi-file compilation output must be valid Wasm");

  client.terminate();
  console.log("All In-Browser C-to-Wasm Compiler Worker tests PASSED successfully!");
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
