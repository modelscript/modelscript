// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import {
  computeFmuShmLayout,
  FMU_IPC_MAGIC,
  FMU_IPC_VERSION,
  FmuIpcCommand,
  FmuIpcStatus,
  FmuShmCodec,
} from "../src/cosim/ipc/fmu-shm-protocol.js";
import { generateFmuShmHarnessC } from "../src/fmu/fmu-shm-codegen.js";

console.log("=== Running @modelscript/exchange FMU Zero-Copy SHM Protocol Tests ===");

// 1. Test Memory Layout Computation & Alignment
console.log("1. Testing computeFmuShmLayout alignment...");
const layout = computeFmuShmLayout(100, 100);
assert.strictEqual(layout.headerBytes, 64);
assert.strictEqual(layout.inputVrsOffset, 64);
assert.strictEqual(layout.inputValuesOffset % 8, 0, "Input values must be 8-byte aligned for Float64");
assert.strictEqual(layout.outputValuesOffset % 8, 0, "Output values must be 8-byte aligned for Float64");
assert.ok(layout.totalBytes > layout.outputValuesOffset, "Total size must encompass all sections");

// 2. Test Header Encode & Decode Roundtrip
console.log("2. Testing FmuShmCodec header encode/decode...");
const buffer = new ArrayBuffer(layout.totalBytes);
const view = new DataView(buffer);

FmuShmCodec.encodeHeader(view, FmuIpcCommand.DoStep, FmuIpcStatus.Busy, 42, 10, 20, 1.5, 0.001, 10.0, 0);

const decoded = FmuShmCodec.decodeHeader(view);
assert.strictEqual(decoded.magic, FMU_IPC_MAGIC);
assert.strictEqual(decoded.version, FMU_IPC_VERSION);
assert.strictEqual(decoded.command, FmuIpcCommand.DoStep);
assert.strictEqual(decoded.status, FmuIpcStatus.Busy);
assert.strictEqual(decoded.sequenceId, 42);
assert.strictEqual(decoded.numInputs, 10);
assert.strictEqual(decoded.numOutputs, 20);
assert.strictEqual(decoded.currentTime, 1.5);
assert.strictEqual(decoded.stepSize, 0.001);
assert.strictEqual(decoded.stopTime, 10.0);
assert.strictEqual(decoded.errorCode, 0);

// 3. Test Input / Output Binary Vectors Roundtrip
console.log("3. Testing input and output vectors roundtrip in SHM buffer...");
const inVrs = [101, 102, 103];
const inVals = [3.14159, -42.0, 1.414];
FmuShmCodec.writeInputs(buffer, layout, inVrs, inVals);

// Verify raw data in buffer at offset
const readInVrs = new Uint32Array(buffer, layout.inputVrsOffset, inVrs.length);
const readInVals = new Float64Array(buffer, layout.inputValuesOffset, inVals.length);
assert.deepStrictEqual(Array.from(readInVrs), inVrs);
assert.deepStrictEqual(Array.from(readInVals), inVals);

// Emulate output writing
const outVrs = [201, 202];
const outVals = [99.9, 0.005];
const outVrArray = new Uint32Array(buffer, layout.outputVrsOffset, outVrs.length);
const outValArray = new Float64Array(buffer, layout.outputValuesOffset, outVals.length);
for (let i = 0; i < outVrs.length; i++) {
  outVrArray[i] = outVrs[i]!;
  outValArray[i] = outVals[i]!;
}

const outputs = FmuShmCodec.readOutputs(buffer, layout, 2);
assert.deepStrictEqual(outputs.vrs, outVrs);
assert.deepStrictEqual(outputs.values, outVals);

// 4. Test C SHM Harness Codegen
console.log("4. Testing generateFmuShmHarnessC source generation...");
const cSource = generateFmuShmHarnessC();
assert.ok(cSource.includes("fmu-shm-harness"), "Must declare binary header comment");
assert.ok(cSource.includes("fmi2DoStep"), "Must link fmi2DoStep");
assert.ok(cSource.includes("FmuShmHeader"), "Must define FmuShmHeader");
assert.ok(cSource.includes("CMD_DO_STEP"), "Must handle CMD_DO_STEP");
assert.ok(cSource.includes("STATUS_STEP_DONE"), "Must signal STATUS_STEP_DONE");

console.log("All @modelscript/exchange Zero-Copy SHM Protocol tests PASSED!");
