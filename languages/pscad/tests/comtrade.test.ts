// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import {
  emtResultToComtrade,
  extractEmtNetlist,
  parsePscx,
  readComtrade,
  verifyIeee2800Compliance,
  writeComtrade,
} from "../src/index.js";

console.log("=== Testing IEEE C37.111 COMTRADE Reader, Writer & Verification ===");

// 1. Create a simulated waveform dataset
const nSamples = 500;
const dt = 20e-6; // 20 us
const timeSec = new Float64Array(nSamples);
const vBus1 = new Float64Array(nSamples);
const vBus2 = new Float64Array(nSamples);
const iBranch = new Float64Array(nSamples);

for (let i = 0; i < nSamples; i++) {
  const t = i * dt;
  timeSec[i] = t;
  vBus1[i] = 230e3 * Math.sin(2 * Math.PI * 60 * t);
  vBus2[i] = 16.5e3 * Math.sin(2 * Math.PI * 60 * t - 0.2);
  iBranch[i] = 1200 * Math.sin(2 * Math.PI * 60 * t + 0.1);
}

const simResult = {
  time: timeSec,
  busVoltages: new Map([
    ["Bus1", vBus1],
    ["Bus2", vBus2],
  ]),
  branchCurrents: new Map([["Branch1", iBranch]]),
};

// 2. Test COMTRADE Serialization (Writer)
console.log("Test 1: writeComtrade");
const comtradeRecord = emtResultToComtrade(simResult, "Substation_Alpha", "REC01");
const { cfg, dat } = writeComtrade(comtradeRecord);

assert.ok(cfg.includes("Substation_Alpha,REC01,1999"), "CFG must contain header");
assert.ok(cfg.includes("3,3A,0D"), "CFG must specify 3 analog channels");
assert.ok(cfg.includes("V_Bus1"), "CFG must list V_Bus1");
assert.ok(cfg.includes("V_Bus2"), "CFG must list V_Bus2");
assert.ok(cfg.includes("I_Branch1"), "CFG must list I_Branch1");

const datLines = dat.trim().split("\n");
assert.strictEqual(datLines.length, nSamples, `DAT must have exactly ${nSamples} rows`);
console.log(`   Generated CFG (${cfg.length} bytes) and DAT (${dat.length} bytes, ${nSamples} samples)`);

// 3. Test COMTRADE Deserialization (Reader)
console.log("Test 2: readComtrade");
const parsed = readComtrade(cfg, dat);
assert.strictEqual(parsed.config.stationName, "Substation_Alpha");
assert.strictEqual(parsed.config.analogChannels.length, 3);
assert.strictEqual(parsed.timeSec.length, nSamples);

const parsedV1 = parsed.analogData.get("V_Bus1")!;
assert.ok(parsedV1, "Parsed record must contain V_Bus1");
assert.strictEqual(parsedV1.length, nSamples);

// Verify numerical round-trip accuracy
let maxDiff = 0;
for (let i = 0; i < nSamples; i++) {
  const diff = Math.abs(parsedV1[i]! - vBus1[i]!);
  if (diff > maxDiff) maxDiff = diff;
}
console.log(`   Maximum Round-trip Discretization Error: ${maxDiff.toFixed(4)} V`);
assert.ok(maxDiff <= 1.0, "Round-trip quantization error must be <= 1 V");

// 4. Test Automated IEEE 2800 Verification from COMTRADE Waveforms
console.log("Test 3: verifyIeee2800Compliance directly from parsed COMTRADE");
const samplePscx = `<?xml version="1.0" encoding="UTF-8"?>
<project name="SolarSubstation" version="5.0.0">
  <Bus name="Bus1" id="B1" vbase="230.0" />
  <User classid="UserCmp" defn="inverter_fmu" id="INV1">
    <param name="Name" value="SolarInverter"/>
    <param name="fmu_path" value="Solar.fmu"/>
    <param name="MVA" value="100.0"/>
    <param name="V" value="230.0"/>
    <port name="p1" pos="[0,0]"/>
  </User>
</project>`;
const project = parsePscx(samplePscx);
const netlist = extractEmtNetlist(project);

const ieeeReport = verifyIeee2800Compliance(
  parsed.config.stationName,
  netlist,
  {
    time: parsed.timeSec,
    vPoi: parsed.analogData.get("V_Bus1")!,
    iIbr: parsed.analogData.get("I_Branch1")!,
  },
  {
    faultStartSec: 0.002,
    faultDurationSec: 0.005,
    vPreFaultKv: 230,
    vFaultKv: 11.5,
  },
);

console.log(`   COMTRADE IEEE 2800 Verification: [${ieeeReport.overallStatus}]`);
assert.strictEqual(ieeeReport.checks.length, 3, "Must evaluate all 3 clauses");

console.log("ALL COMTRADE & RECORDING VERIFICATION TESTS PASSED SUCCESSFULLY!");
