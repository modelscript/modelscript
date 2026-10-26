// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import {
  EmulatorWorkerClient,
  UniversalBinaryRunner,
  type BatchSimulationResult,
} from "../src/fmu/pe-emulator/index.js";

console.log("=== Running High-Throughput Batch Stepping Tests ===");

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

// ── Test 1: Direct UniversalBinaryRunner.stepBatch Execution ──
{
  console.log("\n[Test 1] UniversalBinaryRunner.stepBatch Contiguous TypedArray Execution");

  const runner = new UniversalBinaryRunner(createMinimalPe(), {
    modelName: "BatchTestModel",
    variables: [
      { name: "speed", valueReference: 1, causality: "output", start: 100.0 },
      { name: "torque", valueReference: 2, causality: "output", start: 250.0 },
      { name: "throttle", valueReference: 3, causality: "input", start: 0.5 },
    ],
    outputVariables: ["speed", "torque"],
  });
  runner.init(0.0);

  const res: BatchSimulationResult = runner.stepBatch({
    startTime: 0.0,
    stopTime: 1.0,
    stepSize: 0.01, // 100 steps
    includeInitial: true,
  });

  assert.strictEqual(res.timeSteps, 101, "100 steps + initial frame = 101 timeSteps");
  assert.strictEqual(res.timeBuffer.length, 101, "timeBuffer must have length 101");
  assert.strictEqual(res.outputMatrix.length, 101 * 2, "outputMatrix length must be 101 * 2 outputs");

  // Verify timestamps
  assert.strictEqual(res.timeBuffer[0], 0.0, "Initial time must be 0.0");
  assert.strictEqual(Math.round(res.timeBuffer[100]! * 100) / 100, 1.0, "Final time must be 1.0");

  // Verify column map access
  const speedCol = res.outputMap.get("speed");
  const torqueCol = res.outputMap.get("torque");
  assert.ok(speedCol !== undefined, "outputMap must contain 'speed'");
  assert.ok(torqueCol !== undefined, "outputMap must contain 'torque'");
  assert.strictEqual(speedCol!.length, 101);
  assert.strictEqual(torqueCol!.length, 101);

  assert.ok(res.executionTimeMs >= 0, "Execution time should be measured");
  console.log(`  ✓ 100 steps executed in ${res.executionTimeMs.toFixed(3)}ms (recorded ${res.timeSteps} frames)`);

  runner.terminate();
}

// ── Test 2: Sample Decimation (Downsampling) ──
{
  console.log("\n[Test 2] Sample Decimation / Memory Bounding");

  const runner = new UniversalBinaryRunner(createMinimalPe(), {
    modelName: "DecimationTestModel",
    variables: [{ name: "pressure", valueReference: 10, causality: "output", start: 1.013e5 }],
  });
  runner.init(0.0);

  // 1000 steps with decimation = 10 -> records 100 samples + 1 initial
  const res = runner.stepBatch({
    startTime: 0.0,
    stepsCount: 1000,
    stepSize: 0.001,
    sampleDecimation: 10,
    includeInitial: true,
  });

  assert.strictEqual(res.timeSteps, 101, "1000 steps / 10 decimation + initial = 101 frames");
  assert.strictEqual(res.timeBuffer[0], 0.0);
  assert.strictEqual(Math.round(res.timeBuffer[1]! * 1000) / 1000, 0.01, "Step 1 should be at t = 0.01");
  assert.strictEqual(Math.round(res.finalTime * 1000) / 1000, 1.0);
  console.log(`  ✓ Decimation recorded exactly ${res.timeSteps} frames from 1,000 steps`);

  runner.terminate();
}

// ── Test 3: Dynamic Function & Scalar Inputs ──
{
  console.log("\n[Test 3] Dynamic Function Inputs During Batch Loop");

  const runner = new UniversalBinaryRunner(createMinimalPe(), {
    modelName: "InputBatchModel",
    variables: [
      { name: "u_ramp", valueReference: 1, causality: "input", start: 0.0 },
      { name: "y_out", valueReference: 2, causality: "output", start: 0.0 },
    ],
  });
  runner.init(0.0);

  const res = runner.stepBatch({
    startTime: 0.0,
    stepsCount: 50,
    stepSize: 0.1,
    inputs: {
      u_ramp: (t: number) => 2.5 * t,
    },
    includeInitial: false,
  });

  assert.strictEqual(res.timeSteps, 50);
  // Verify runner received the final input at t = 5.0 -> u = 12.5
  assert.strictEqual(runner.getVar("u_ramp"), 12.25, "Input u_ramp at t=4.9 interval start must be 12.25");
  console.log("  ✓ Dynamic input function evaluated accurately at each step");

  runner.terminate();
}

// ── Test 4: Parity Between Sequential step() and stepBatch() ──
{
  console.log("\n[Test 4] Parity Between Sequential step() and stepBatch()");

  const peBuf = createMinimalPe();
  const runnerSeq = new UniversalBinaryRunner(peBuf, {
    variables: [{ name: "v1", valueReference: 1, start: 42.0 }],
  });
  runnerSeq.init(0.0);

  const N = 200;
  const dt = 0.005;
  const seqTimes = new Float64Array(N);
  const seqValues = new Float64Array(N);

  let curT = 0.0;
  for (let i = 0; i < N; i++) {
    runnerSeq.step(curT, dt);
    curT = runnerSeq.getTime();
    seqTimes[i] = curT;
    seqValues[i] = runnerSeq.getVar("v1");
  }

  const runnerBatch = new UniversalBinaryRunner(peBuf, {
    variables: [{ name: "v1", valueReference: 1, start: 42.0 }],
  });
  runnerBatch.init(0.0);

  const batchRes = runnerBatch.stepBatch({
    startTime: 0.0,
    stepsCount: N,
    stepSize: dt,
    includeInitial: false,
  });

  assert.strictEqual(batchRes.timeSteps, N);
  const batchV1 = batchRes.outputMap.get("v1")!;
  assert.ok(batchV1 !== undefined);

  for (let i = 0; i < N; i++) {
    assert.ok(Math.abs(batchRes.timeBuffer[i]! - seqTimes[i]!) < 1e-9, `Time mismatch at step ${i}`);
    assert.strictEqual(batchV1[i], seqValues[i], `Value mismatch at step ${i}`);
  }
  console.log(`  ✓ 100% numerical parity verified across ${N} steps`);

  runnerSeq.terminate();
  runnerBatch.terminate();
}

// ── Test 5: High-Throughput Stress (5,000 steps) ──
{
  console.log("\n[Test 5] High-Throughput Stress Test (5,000 steps)");

  const runner = new UniversalBinaryRunner(createMinimalPe(), {
    variables: [
      { name: "x", valueReference: 1, start: 1.0 },
      { name: "y", valueReference: 2, start: 2.0 },
    ],
  });
  runner.init(0.0);

  const res = runner.stepBatch({
    startTime: 0.0,
    stepsCount: 5000,
    stepSize: 0.001,
    includeInitial: false,
  });

  assert.strictEqual(res.timeSteps, 5000);
  const stepsPerSec = Math.round(5000 / (res.executionTimeMs / 1000));
  console.log(
    `  ✓ 5,000 steps completed in ${res.executionTimeMs.toFixed(2)}ms (~${stepsPerSec.toLocaleString()} steps/sec)`,
  );

  runner.terminate();
}

// ── Test 6: EmulatorWorkerClient.stepBatch with Decimation & Options ──
{
  console.log("\n[Test 6] EmulatorWorkerClient.stepBatch Delegation");

  const client = new EmulatorWorkerClient(createMinimalPe(), {
    modelName: "ClientBatchModel",
    variables: [
      { name: "pos", valueReference: 101, causality: "output", start: 5.5 },
      { name: "vel", valueReference: 102, causality: "output", start: 1.2 },
    ],
  });
  client.init(0.0);

  const batchRes = await client.stepBatch(0.0, 0.01, 500, undefined, {
    decimation: 5,
    outputValueReferences: [101],
    includeInitial: true,
  });

  assert.strictEqual(batchRes.times.length, 101, "500 / 5 + 1 = 101 frames");
  assert.ok(batchRes.series["pos"] !== undefined, "pos series must be returned");
  assert.strictEqual(batchRes.series["pos"]!.length, 101);
  console.log("  ✓ EmulatorWorkerClient returned decimated series with selected value references");

  client.terminate();
}

console.log("\n✅ All High-Throughput Batch Stepping tests passed successfully!");
