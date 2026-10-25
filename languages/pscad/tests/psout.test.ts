// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readPscadPsout, runPscadSimulationPipeline, writePscadPsout } from "../src/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log("=== Testing PSCAD *.psout AssemblyScript Kernel, Reader & Writer ===");

// =============================================================================
// 1. Test Reading Real PSCAD V5 `Cigre.psout` Fixture
// =============================================================================
console.log("\nTest 1: Read Cigre.psout benchmark fixture");
const cigrePath = path.join(__dirname, "fixtures/Cigre.psout");
assert.ok(fs.existsSync(cigrePath), "Cigre.psout fixture must exist");

const cigreBytes = fs.readFileSync(cigrePath);
const doc = readPscadPsout(cigreBytes);

assert.strictEqual(doc.header.version, 1, "Header version must be 1");
assert.strictEqual(doc.header.pageSize, 1024, "Page size must be 1024 bytes");
assert.strictEqual(doc.header.pageCount, 552, "Page count must be 552");
assert.strictEqual(doc.header.guid, "a24e10833dca85f307c9090ea1d6f6aa", "Magic GUID must match PSCAD V5");
assert.strictEqual(doc.numRuns, 1, "Number of runs must be 1");

console.log(`   Decoded header: V${doc.header.version}, ${doc.header.pageCount} pages, GUID ${doc.header.guid}`);
console.log(`   Created on: ${doc.header.createdOn.toISOString()}`);

const run = doc.run(0);
assert.ok(run, "Run 0 must exist");

const simConverted = doc.toSimulationResult();
assert.ok(simConverted.time.length > 0, "Converted time vector must not be empty");
console.log(
  `   Channels extracted: ${simConverted.busVoltages.size} voltages, ${simConverted.branchCurrents?.size ?? 0} currents`,
);
console.log(`   Sample count: ${simConverted.time.length}`);

// =============================================================================
// 2. Test Writing .psout from SimulationResultLike via AssemblyScript WASM Kernel
// =============================================================================
console.log("\nTest 2: Write .psout via AssemblyScript kernel");

const nSamples = 400;
const dt = 50e-6; // 50 us
const time = new Float64Array(nSamples);
const vBus1 = new Float64Array(nSamples);
const vBus2 = new Float64Array(nSamples);
const iLine = new Float64Array(nSamples);
const ctrl = new Float64Array(nSamples);

for (let k = 0; k < nSamples; k++) {
  const t = k * dt;
  time[k] = t;
  vBus1[k] = 230e3 * Math.sin(2 * Math.PI * 60 * t);
  vBus2[k] = 16.5e3 * Math.sin(2 * Math.PI * 60 * t - (2 * Math.PI) / 3);
  iLine[k] = 850 * Math.cos(2 * Math.PI * 60 * t);
  ctrl[k] = 1.0;
}

const inputResult = {
  time,
  busVoltages: new Map([
    ["Bus1", vBus1],
    ["Bus2", vBus2],
  ]),
  branchCurrents: new Map([["Line1", iLine]]),
  controlSignals: new Map([["Enable", ctrl]]),
};

const psoutBinary = writePscadPsout(inputResult, {
  projectName: "RenewablePark",
  pageSize: 1024,
});

assert.ok(psoutBinary instanceof Uint8Array, "Output must be a Uint8Array");
assert.ok(psoutBinary.length > 160, "Binary size must exceed 160 bytes");
assert.strictEqual(psoutBinary.length % 1024, 0, "Total size must be an exact multiple of 1024-byte pages");

console.log(`   Generated valid .psout binary: ${psoutBinary.length} bytes`);

// Verify header fields in generated binary
const view = new DataView(psoutBinary.buffer, psoutBinary.byteOffset, psoutBinary.byteLength);
const genGuid = Array.from(psoutBinary.subarray(0, 16))
  .map((b) => b.toString(16).padStart(2, "0"))
  .join("");
assert.strictEqual(genGuid, "a24e10833dca85f307c9090ea1d6f6aa", "Generated GUID must match PSCAD V5 specification");

// Verify float constants
assert.strictEqual(view.getFloat64(16, true), 3.141592653589793, "Generated float 1 must be Pi");
assert.strictEqual(view.getFloat64(24, true), 9461000000000000.0, "Generated float 2 must be light dist");
assert.strictEqual(view.getFloat64(32, true), 6.62607004e-34, "Generated float 3 must be Planck");
assert.strictEqual(view.getFloat64(40, true), -1.23456789, "Generated float 4 must be calibration float");

console.log("   Verified floating point verification constants and GUID");

// =============================================================================
// 3. Test Roundtrip: Read back the generated .psout
// =============================================================================
console.log("\nTest 3: Roundtrip read-back of generated binary");

const readBackDoc = readPscadPsout(psoutBinary);
assert.strictEqual(readBackDoc.header.version, 1, "Roundtrip version must be 1");
assert.strictEqual(readBackDoc.header.pageSize, 1024, "Roundtrip page size must be 1024");

const readBackSim = readBackDoc.toSimulationResult();
assert.strictEqual(readBackSim.time.length, nSamples, `Time vector length must be ${nSamples}`);

// Verify numerical accuracy across all samples
let maxErr = 0;
for (let k = 0; k < nSamples; k++) {
  const err = Math.abs(readBackSim.time[k]! - time[k]!);
  if (err > maxErr) maxErr = err;
}
assert.ok(maxErr < 1e-12, `Max error in time domain (${maxErr}) must be < 1e-12`);

const readV1 = readBackSim.busVoltages.get("Bus1");
assert.ok(readV1, "Bus1 voltage trace must exist in read-back result");
let maxVErr = 0;
for (let k = 0; k < nSamples; k++) {
  const err = Math.abs(readV1[k]! - vBus1[k]!);
  if (err > maxVErr) maxVErr = err;
}
assert.ok(maxVErr < 1e-12, `Max error in Bus1 voltage (${maxVErr}) must be < 1e-12`);

console.log(`   Numerical roundtrip parity verified! Max error = ${Math.max(maxErr, maxVErr)}`);

// =============================================================================
// 4. Test Error Handling
// =============================================================================
console.log("\nTest 4: Error handling and corruption rejection");

assert.throws(
  () => {
    readPscadPsout(new Uint8Array(50));
  },
  /smaller than 160-byte header/,
  "Must reject buffers smaller than 160 bytes",
);

const corruptGuid = new Uint8Array(psoutBinary);
corruptGuid[0] = 0x00;
assert.throws(
  () => {
    readPscadPsout(corruptGuid);
  },
  /Magic GUID mismatch/,
  "Must reject corrupted magic GUID",
);

const corruptFloat = new Uint8Array(psoutBinary);
corruptFloat[16] = 0xff;
assert.throws(
  () => {
    readPscadPsout(corruptFloat);
  },
  /Verification float constant mismatch/,
  "Must reject corrupted verification floats",
);

console.log("   All corruption checks passed!");

// =============================================================================
// 5. Test Integration into PSCAD Simulation Pipeline
// =============================================================================
console.log("\nTest 5: Integration with runPscadSimulationPipeline");

const pscxPath = path.join(__dirname, "fixtures/IEEE9Bus_IBR.pscx");
const pscxText = fs.readFileSync(pscxPath, "utf-8");

const pipelineResult = runPscadSimulationPipeline({
  documentText: pscxText,
  durationSec: 0.1,
  exportPsout: true,
  exportOut: true,
  exportComtrade: true,
});

assert.ok(pipelineResult.pscadPsout, "Pipeline result must include pscadPsout binary");
assert.ok(pipelineResult.pscadPsout instanceof Uint8Array, "pscadPsout must be Uint8Array");
assert.ok(pipelineResult.pscadPsout.length > 1024, "pscadPsout must have multiple pages");

// Verify the pipeline .psout can be parsed directly
const pipeDoc = readPscadPsout(pipelineResult.pscadPsout);
assert.strictEqual(pipeDoc.header.version, 1);
assert.strictEqual(pipeDoc.header.guid, "a24e10833dca85f307c9090ea1d6f6aa");
console.log(`   Pipeline generated valid .psout (${pipelineResult.pscadPsout.length} bytes)`);

console.log("\nAll PSCAD .psout tests passed successfully!");
