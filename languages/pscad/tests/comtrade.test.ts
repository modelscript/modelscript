// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import {
  emtResultToComtrade,
  extractEmtNetlist,
  extractSequencePhasors,
  parsePscx,
  readComtrade,
  readComtradeCff,
  verifyIeee2800Compliance,
  writeComtrade,
  writeComtradeBinary,
  writeComtradeCff,
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

// 5. Test Small-Signal Auto-Scaling & Digital Channel Round-Trip
console.log("Test 4: Small-signal auto-scaling and digital channels");
const smallSignal = new Float64Array([0.0, 0.125, -0.25, 0.5, -0.75, 1.0]);
const smallTime = new Float64Array([0, 20e-6, 40e-6, 60e-6, 80e-6, 100e-6]);
const smallRec = emtResultToComtrade({
  time: smallTime,
  busVoltages: new Map([["PuSignal", smallSignal]]),
});
smallRec.config.digitalChannels.push({
  index: 1,
  name: "BreakerTrip",
  normalState: 0,
});
smallRec.digitalData.set("BreakerTrip", new Uint8Array([0, 0, 1, 1, 1, 0]));

const smallOut = writeComtrade(smallRec);
const smallParsed = readComtrade(smallOut.cfg, smallOut.dat);
const recoveredPu = smallParsed.analogData.get("V_PuSignal")!;
for (let i = 0; i < smallSignal.length; i++) {
  assert.ok(
    Math.abs(recoveredPu[i]! - smallSignal[i]!) < 1e-4,
    `Small signal sample ${i} should preserve fractional accuracy, got ${recoveredPu[i]} vs ${smallSignal[i]}`,
  );
}
const recoveredDig = smallParsed.digitalData.get("BreakerTrip")!;
assert.deepStrictEqual(Array.from(recoveredDig), [0, 0, 1, 1, 1, 0], "Digital channel must round-trip accurately");

// 6. Test IEEE C37.111-2013 Binary (BINARY, BINARY32, FLOAT32) & Single-File (.cff) Round-Trip
console.log("Test 5: IEEE C37.111-2013 Binary (BINARY, BINARY32, FLOAT32) & Single-File .cff");
comtradeRecord.config.standardVersionYear = 2013;
comtradeRecord.config.timeCode = "-05:00";
comtradeRecord.config.localCode = "-05:00";
comtradeRecord.config.timeQualityIndicatorCode = "0";
comtradeRecord.config.leapSecIndicator = 0;
comtradeRecord.config.digitalChannels.push({
  index: 1,
  name: "RelayTrip",
  normalState: 0,
});
const relayTripArr = new Uint8Array(nSamples);
for (let i = 250; i < nSamples; i++) relayTripArr[i] = 1;
comtradeRecord.digitalData.set("RelayTrip", relayTripArr);

const bin16 = writeComtradeBinary(comtradeRecord, "BINARY");
const bin32 = writeComtradeBinary(comtradeRecord, "BINARY32");
const flt32 = writeComtradeBinary(comtradeRecord, "FLOAT32");

// 500 samples * (8 header + 3*2 analog + 2 digital) = 500 * 16 = 8,000 bytes
assert.strictEqual(bin16.dat.byteLength, 500 * 16, "BINARY 16-bit payload must be 16 bytes/sample");
// 500 samples * (8 header + 3*4 analog + 2 digital) = 500 * 22 = 11,000 bytes
assert.strictEqual(bin32.dat.byteLength, 500 * 22, "BINARY32 payload must be 22 bytes/sample");
assert.strictEqual(flt32.dat.byteLength, 500 * 22, "FLOAT32 payload must be 22 bytes/sample");

const parsedBin16 = readComtrade(bin16.cfg, bin16.dat);
const parsedBin32 = readComtrade(bin32.cfg, bin32.dat);
const parsedFlt32 = readComtrade(flt32.cfg, flt32.dat);

assert.strictEqual(parsedFlt32.config.standardVersionYear, 2013);
assert.strictEqual(parsedFlt32.config.timeCode, "-05:00");
assert.strictEqual(parsedFlt32.config.dataFormat, "FLOAT32");

let maxFltErr = 0;
let maxBin16Err = 0;
const fltV1 = parsedFlt32.analogData.get("V_Bus1")!;
const bin16V1 = parsedBin16.analogData.get("V_Bus1")!;
for (let i = 0; i < nSamples; i++) {
  maxFltErr = Math.max(maxFltErr, Math.abs(fltV1[i]! - vBus1[i]!));
  maxBin16Err = Math.max(maxBin16Err, Math.abs(bin16V1[i]! - vBus1[i]!));
}
console.log(
  `   BINARY16 size: ${bin16.dat.byteLength} B (max err: ${maxBin16Err.toFixed(2)} V) | FLOAT32 size: ${flt32.dat.byteLength} B (max err: ${maxFltErr.toFixed(4)} V)`,
);
assert.ok(maxFltErr < 0.05, `FLOAT32 round-trip error must be < 0.05 V, got ${maxFltErr}`);
assert.ok(
  maxBin16Err < 5.0,
  `16-bit BINARY round-trip error on 230 kV must be < 5 V (no int16 clipping), got ${maxBin16Err}`,
);
assert.strictEqual(parsedBin32.digitalData.get("RelayTrip")![100], 0);
assert.strictEqual(parsedBin32.digitalData.get("RelayTrip")![300], 1);

// Single-file .cff container round-trip
const cffText = writeComtradeCff(comtradeRecord);
const parsedCff = readComtradeCff(cffText);
assert.strictEqual(parsedCff.timeSec.length, nSamples);
assert.strictEqual(parsedCff.digitalData.get("RelayTrip")![400], 1);

// 7. Test 3-Phase Sequence-Domain & DQ Decomposition + Full 7-Clause IEEE 2800 / NERC PRC-029 Suite
console.log("Test 6: 3-Phase Sequence-Domain (V1, V2, I1d, I1q) & Full 7-Clause IEEE 2800 / NERC PRC-029 Verification");
const n3 = 3000; // 60 ms at dt = 20 us
const t3 = new Float64Array(n3);
const va = new Float64Array(n3),
  vb = new Float64Array(n3),
  vc = new Float64Array(n3);
const ia = new Float64Array(n3),
  ib = new Float64Array(n3),
  ic = new Float64Array(n3);
const omega0 = 2 * Math.PI * 60;

for (let k = 0; k < n3; k++) {
  const t = k * dt;
  t3[k] = t;
  const inFault = t >= 0.02 && t <= 0.04;
  // Pre-fault: 230 kV balanced; During fault (20..40ms): 0.50 pu voltage sag
  const vMag = inFault ? 115e3 : 230e3;
  va[k] = vMag * Math.sin(omega0 * t);
  vb[k] = vMag * Math.sin(omega0 * t - (2 * Math.PI) / 3);
  vc[k] = vMag * Math.sin(omega0 * t + (2 * Math.PI) / 3);

  // Pre-fault: I_d = 1000 A, I_q = 0 A
  // During fault: LVRT boosts capacitive reactive current I_1q = 1200 A (k1 = (1200/1000) / 0.5 = 2.4 pu/pu)
  const id = inFault ? 800 : 1000;
  const iq = inFault ? 1200 : 0;
  ia[k] = id * Math.sin(omega0 * t) - iq * Math.cos(omega0 * t);
  ib[k] = id * Math.sin(omega0 * t - (2 * Math.PI) / 3) - iq * Math.cos(omega0 * t - (2 * Math.PI) / 3);
  ic[k] = id * Math.sin(omega0 * t + (2 * Math.PI) / 3) - iq * Math.cos(omega0 * t + (2 * Math.PI) / 3);
}

const seqPhasors = extractSequencePhasors(t3, { a: va, b: vb, c: vc }, { a: ia, b: ib, c: ic }, 60.0);
// Check mid-fault sample at t = 38 ms (index 1900, >1 cycle into fault)
const idxMidFault = 1900;
console.log(
  `   Mid-Fault Sequence Phasors (t=38ms) -> V1: ${(seqPhasors.v1[idxMidFault]! / 1e3).toFixed(1)} kV, I1d: ${seqPhasors.i1d[idxMidFault]!.toFixed(1)} A, I1q: ${seqPhasors.i1q[idxMidFault]!.toFixed(1)} A`,
);
assert.ok(Math.abs(seqPhasors.v1[idxMidFault]! - 115e3) < 1000, "Positive-sequence V1 during sag must be ~115 kV");
assert.ok(Math.abs(seqPhasors.i1d[idxMidFault]! - 800) < 25, "Positive-sequence active current I1d must be ~800 A");
assert.ok(Math.abs(seqPhasors.i1q[idxMidFault]! - 1200) < 25, "Positive-sequence reactive current I1q must be ~1200 A");

const fullReport = verifyIeee2800Compliance(
  "SolarPlant_3Phase_POI",
  netlist,
  {
    time: t3,
    vPoi: va,
    iIbr: ia,
    vPoiAbc: { a: va, b: vb, c: vc },
    iIbrAbc: { a: ia, b: ib, c: ic },
  },
  {
    faultStartSec: 0.02,
    faultDurationSec: 0.02,
    vPreFaultKv: 230.0,
    vFaultKv: 115.0,
    ratedCurrentAmp: 1000.0,
    minK1Gain: 2.0,
    evaluateExtendedClauses: true,
  },
);

console.log(
  `   Extended 7-Clause IEEE 2800 / NERC PRC-029 Status: [${fullReport.overallStatus}] (${fullReport.checks.length} clauses)`,
);
assert.strictEqual(fullReport.checks.length, 7, "Extended compliance verification must evaluate all 7 clauses");
assert.strictEqual(fullReport.overallStatus, "PASS", "Compliant 3-phase LVRT waveform must PASS all 7 clauses");

console.log("ALL COMTRADE & RECORDING VERIFICATION TESTS PASSED SUCCESSFULLY!");
