// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { DbtCompiler, EmulatorWorkerClient, type JitInstruction } from "../src/fmu/pe-emulator/index.js";

console.log("=== Running DBT Wasm JIT & Emulator Worker Tests ===");

// ── Test 1: Dynamic Binary Translation (Wasm JIT) Compilation ──
{
  console.log("\n[Test 1] Dynamic Binary Translation: Bytecode Synthesis & JIT Execution");
  const wasmMemory = new WebAssembly.Memory({ initial: 1, maximum: 10 });
  const dbt = new DbtCompiler(wasmMemory, 5);

  const startPc = 0x10001040n;

  // Verify hot block threshold tracking
  for (let i = 0; i < 4; i++) {
    assert.strictEqual(dbt.recordBlockExecution(startPc), false, "Block should not be hot yet");
  }
  // 5th execution triggers JIT compilation
  assert.strictEqual(dbt.recordBlockExecution(startPc), true, "5th execution must trigger JIT");
  console.log("  ✓ Hot basic block detection triggered at threshold = 5");

  // Define a synthetic basic block representing ODE state derivative stepping:
  // state (d0) = (d0 + d1) * 2.0
  // d0 is in local 3 (curTime), d1 is in local 4 (dt)
  const block: JitInstruction[] = [
    // d0 = d0 + d1
    { op: "fadd", dstReg: 0, srcReg: 1 },
    // d2 = d0 * d0
    { op: "fmul", dstReg: 0, srcReg: 0 },
    { op: "ret", dstReg: 0 },
  ];

  const fn = dbt.compileBlock(startPc, block);
  assert.ok(typeof fn === "function", "Compiled block must produce a runnable JS/Wasm function");

  // Execute the compiled WebAssembly function directly:
  // curTime = 3.0, dt = 2.0
  // d0 = 3.0 + 2.0 = 5.0
  // d0 = 5.0 * 5.0 = 25.0
  const result = fn(0, 3.0, 2.0);
  assert.strictEqual(result, 25.0, "JIT block must compute (3.0 + 2.0)^2 = 25.0");
  console.log(`  ✓ Dynamic Binary Translation produced native Wasm result: ${result}`);

  // Check cache hit
  const cachedFn = dbt.getCompiledBlock(startPc);
  assert.strictEqual(cachedFn, fn, "Compiled block must be retrieved from cache");
  console.log("  ✓ Block cache lookup verified");
}

// ── Test 2: EmulatorWorkerClient In-Process & Batch Trajectory Streaming ──
{
  console.log("\n[Test 2] EmulatorWorkerClient Simulation & Batch Trajectory Streaming");

  // Minimal synthetic valid PE DLL buffer
  function createMinimalPe(): Uint8Array {
    const b = new Uint8Array(1024);
    const v = new DataView(b.buffer);
    b[0] = 0x4d;
    b[1] = 0x5a; // MZ
    v.setUint32(0x3c, 0x40, true); // PE offset
    b[0x40] = 0x50;
    b[0x41] = 0x45; // PE\0\0
    v.setUint16(0x44, 0x8664, true); // x86_64
    v.setUint16(0x46, 1, true); // 1 section
    v.setUint16(0x54, 0xf0, true); // opt header size
    v.setUint16(0x58, 0x20b, true); // PE32+
    v.setBigUint64(0x70, 0x10000000n, true); // ImageBase
    v.setUint32(0x78, 0x1000, true); // SectionAlignment
    v.setUint32(0x7c, 0x200, true); // FileAlignment
    v.setUint32(0x80, 0x3000, true); // SizeOfImage
    v.setUint32(0x84, 0x200, true); // SizeOfHeaders

    // Section header: .text at 0x138
    const s = 0x138;
    b[s] = 0x2e;
    b[s + 1] = 0x74;
    b[s + 2] = 0x65;
    b[s + 3] = 0x78;
    b[s + 4] = 0x74; // .text
    v.setUint32(s + 8, 0x1000, true); // VirtualSize
    v.setUint32(s + 12, 0x1000, true); // VirtualAddress
    v.setUint32(s + 16, 0x200, true); // SizeOfRawData
    v.setUint32(s + 20, 0x200, true); // PointerToRawData
    v.setUint32(s + 36, 0x60000020, true); // Characteristics

    // RET instruction at offset 0x200
    b[0x200] = 0xc3;
    return b;
  }

  const peBuf = createMinimalPe();
  const client = new EmulatorWorkerClient(peBuf, {
    modelName: "TestPeClientModel",
    variables: [
      { name: "out1", valueReference: 1, causality: "output", start: 10.0 },
      { name: "out2", valueReference: 2, causality: "output", start: 20.0 },
    ],
  });

  assert.strictEqual(client.format, "pe");
  assert.strictEqual(client.architecture, "x86_64");
  assert.strictEqual(client.abi, "win64");
  console.log("  ✓ EmulatorWorkerClient detected Windows PE with Win64 ABI");

  client.init(0.0);
  assert.strictEqual(client.getTime(), 0.0);

  // Single step
  const out1 = client.step(0.0, 0.01);
  assert.ok(out1 !== undefined, "Single step returned output frame");

  // Batch step
  const batchRes = await client.stepBatch(0.01, 0.01, 100);
  assert.strictEqual(batchRes.times.length, 100, "Batch times must contain 100 frames");
  assert.ok(batchRes.series["out1"] !== undefined, "out1 series must be present in batch");
  assert.strictEqual(batchRes.series["out1"]!.length, 100, "out1 series length must be 100");
  console.log(`  ✓ Batch stepping completed 100 steps (final t = ${client.getTime().toFixed(2)}s)`);

  client.terminate();
  console.log("  ✓ EmulatorWorkerClient terminated cleanly");
}

console.log("\n✅ All DBT Wasm JIT & Emulator Worker tests passed successfully!");
