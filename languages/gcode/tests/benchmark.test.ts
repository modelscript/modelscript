// SPDX-License-Identifier: AGPL-3.0-or-later

import { DAEBuilder } from "@modelscript/runtime";
import assert from "node:assert/strict";
import test from "node:test";
import { instantiateGCodeWasmModel, lowerGCodeToDae, simulateToolpath } from "../src/index.js";

function relErr(actual: number, expected: number): number {
  const denom = Math.max(1e-12, Math.abs(expected));
  return Math.abs(actual - expected) / denom;
}

test("G-code Benchmark 1: 3-axis pocket milling + circular arcs (G02/G03) analytical path-length & cycle-time parity", () => {
  const tolerance = 1e-6;
  const rapidRate = 10000;

  const pocketProgram = [
    "O9001 (ROUNDED RECTANGLE POCKET + FULL-CIRCLE CW BOSS)",
    "G21 G90 G17 G54",
    "S10000 M03",
    "G00 X10 Y0 Z5",
    "G01 Z-3 F300",
    "G01 X70 Y0 F600",
    "G03 X80 Y10 I0 J10",
    "G01 X80 Y50",
    "G03 X70 Y60 I-10 J0",
    "G01 X10 Y60",
    "G03 X0 Y50 I0 J-10",
    "G01 X0 Y10",
    "G03 X10 Y0 I10 J0",
    "G01 X40 Y10 F600",
    "G02 X40 Y10 I0 J20",
    "G00 Z5",
    "M05",
    "M30",
  ].join("\n");

  const summary = simulateToolpath(pocketProgram, { rapidRateMmPerMin: rapidRate });

  const expectedRapidLength = Math.hypot(10, 0, 5) + 8;
  const expectedLinearCut = 8 + 60 + 40 + 60 + 40 + Math.hypot(30, 10);
  const expectedArcCut = 4 * (0.5 * Math.PI * 10) + 2 * Math.PI * 20; // 20*pi + 40*pi = 60*pi
  const expectedCutLength = expectedLinearCut + expectedArcCut;
  const expectedRapidTime = (expectedRapidLength / rapidRate) * 60;
  const expectedCutTime = (8 / 300) * 60 + ((expectedCutLength - 8) / 600) * 60;
  const expectedTotalTime = expectedRapidTime + expectedCutTime;

  assert.ok(
    relErr(summary.rapidLengthMm, expectedRapidLength) < tolerance,
    `rapidLengthMm relErr=${relErr(summary.rapidLengthMm, expectedRapidLength)}`,
  );
  assert.ok(
    relErr(summary.cuttingLengthMm, expectedCutLength) < tolerance,
    `cuttingLengthMm relErr=${relErr(summary.cuttingLengthMm, expectedCutLength)}`,
  );
  assert.ok(
    relErr(summary.rapidTimeSec, expectedRapidTime) < tolerance,
    `rapidTimeSec relErr=${relErr(summary.rapidTimeSec, expectedRapidTime)}`,
  );
  assert.ok(
    relErr(summary.cuttingTimeSec, expectedCutTime) < tolerance,
    `cuttingTimeSec relErr=${relErr(summary.cuttingTimeSec, expectedCutTime)}`,
  );
  assert.ok(
    relErr(summary.totalCycleTimeSec, expectedTotalTime) < tolerance,
    `totalCycleTimeSec relErr=${relErr(summary.totalCycleTimeSec, expectedTotalTime)}`,
  );

  // Bounding box includes arc cardinal extrema
  assert.ok(Math.abs(summary.boundingBox.minX - 0) < 1e-6);
  assert.ok(Math.abs(summary.boundingBox.maxX - 80) < 1e-6);
  assert.ok(Math.abs(summary.boundingBox.minY - 0) < 1e-6);
  assert.ok(Math.abs(summary.boundingBox.maxY - 60) < 1e-6);
  assert.ok(Math.abs(summary.boundingBox.minZ - -3) < 1e-6);
  assert.ok(Math.abs(summary.boundingBox.maxZ - 5) < 1e-6);
});

test("G-code Benchmark 2: Inch/mm (G20/G21) unit scaling analytical parity", () => {
  const tolerance = 1e-6;
  const IN = 25.4;

  const inchProgram = [
    "O9002 (INCH PROGRAM)",
    "G20 G90 G17",
    "S8000 M03",
    "G00 X1.0 Y0.5 Z0.25",
    "G01 Z-0.125 F10.0",
    "G01 X3.0 Y0.5 F20.0",
    "G02 X3.0 Y2.5 I0 J1.0",
    "G00 Z0.25",
    "M30",
  ].join("\n");

  const mmProgram = [
    "O9003 (METRIC EQUIVALENT)",
    "G21 G90 G17",
    "S8000 M03",
    `G00 X${(1.0 * IN).toFixed(6)} Y${(0.5 * IN).toFixed(6)} Z${(0.25 * IN).toFixed(6)}`,
    `G01 Z${(-0.125 * IN).toFixed(6)} F${(10.0 * IN).toFixed(6)}`,
    `G01 X${(3.0 * IN).toFixed(6)} Y${(0.5 * IN).toFixed(6)} F${(20.0 * IN).toFixed(6)}`,
    `G02 X${(3.0 * IN).toFixed(6)} Y${(2.5 * IN).toFixed(6)} I0 J${(1.0 * IN).toFixed(6)}`,
    `G00 Z${(0.25 * IN).toFixed(6)}`,
    "M30",
  ].join("\n");

  const simIn = simulateToolpath(inchProgram, { rapidRateMmPerMin: 10000 });
  const simMm = simulateToolpath(mmProgram, { rapidRateMmPerMin: 10000 });

  assert.equal(simIn.unitMode, "G20");
  assert.equal(simMm.unitMode, "G21");
  assert.ok(relErr(simIn.cuttingLengthMm, simMm.cuttingLengthMm) < tolerance);
  assert.ok(relErr(simIn.rapidLengthMm, simMm.rapidLengthMm) < tolerance);
  assert.ok(relErr(simIn.cuttingTimeSec, simMm.cuttingTimeSec) < tolerance);
  assert.ok(relErr(simIn.totalCycleTimeSec, simMm.totalCycleTimeSec) < tolerance);
  assert.ok(relErr(simIn.finalPosition.x, simMm.finalPosition.x) < tolerance);
  assert.ok(relErr(simIn.finalPosition.y, simMm.finalPosition.y) < tolerance);
  assert.ok(relErr(simIn.finalPosition.z, simMm.finalPosition.z) < tolerance);
});

test("G-code Benchmark 3: G81 and G83 peck-drilling cycle analytical & WASM stdlib parity", () => {
  const tolerance = 1e-6;
  const rapidRate = 10000;
  const clearance = 0.5;

  // --- G81 Simple Drilling ---
  const g81Prog = [
    "O9004 (G81 DRILL)",
    "G21 G90",
    "S3500 M03",
    "G00 X0 Y0 Z2",
    "G99 G81 X0 Y0 Z-18 R2 F180",
    "G80",
    "M30",
  ].join("\n");

  const sim81 = simulateToolpath(g81Prog, { rapidRateMmPerMin: rapidRate });
  const wasm81 = instantiateGCodeWasmModel("G81");
  assert.ok(wasm81);
  const out81 = wasm81.step([2.0, -18.0, 180.0, rapidRate]);

  // Analytical: initial rapid Z0->Z2 = 2 mm; plunge 20 mm; retract 20 mm
  const exp81CutLen = 20.0;
  const exp81DrillCycleLen = 40.0;
  const exp81DrillTime = (20.0 / 180.0) * 60 + (20.0 / rapidRate) * 60;

  assert.equal(sim81.holeCount, 1);
  assert.ok(relErr(sim81.cuttingLengthMm, exp81CutLen) < tolerance);
  assert.ok(relErr(out81.pathLengthMm, exp81DrillCycleLen) < tolerance);
  assert.ok(relErr(out81.cycleTimeSec, exp81DrillTime) < tolerance);
  assert.equal(out81.peckCount, 1);

  // --- G83 Deep-Hole Peck Drilling ---
  const rPlane = 2.0;
  const zDepth = -24.0;
  const qPeck = 4.0;
  const feed = 160.0;

  const g83Prog = [
    "O9005 (G83 PECK DRILL)",
    "G21 G90",
    "S2800 M03",
    `G00 X0 Y0 Z${rPlane}`,
    `G99 G83 X0 Y0 Z${zDepth} R${rPlane} Q${qPeck} F${feed}`,
    "G80",
    "M30",
  ].join("\n");

  const sim83 = simulateToolpath(g83Prog, { rapidRateMmPerMin: rapidRate, peckClearanceMm: clearance });
  const wasm83 = instantiateGCodeWasmModel("G83");
  assert.ok(wasm83);
  const out83 = wasm83.step([rPlane, zDepth, qPeck, feed, rapidRate, clearance]);

  // Closed-form peck summation
  const totalDepth = rPlane - zDepth; // 26 mm -> 7 pecks
  let depthCut = 0;
  let expCut = 0;
  let expRapid = 0;
  let expPecks = 0;
  while (depthCut < totalDepth - 1e-9) {
    const nextDepth = Math.min(totalDepth, depthCut + qPeck);
    const rapidEntry = expPecks > 0 ? Math.max(0, depthCut - clearance) : 0;
    expCut += nextDepth - rapidEntry;
    expRapid += rapidEntry + nextDepth;
    depthCut = nextDepth;
    expPecks++;
  }
  const exp83CycleTime = (expCut / feed) * 60 + (expRapid / rapidRate) * 60;
  // Note: sim83 also has initial rapid Z0 -> Z2 = 2 mm before G83 starts
  const sim83DrillRapidLen = sim83.rapidLengthMm - rPlane;

  assert.equal(sim83.holeCount, 1);
  assert.equal(out83.peckCount, 7);
  assert.equal(expPecks, 7);
  assert.ok(relErr(sim83.cuttingLengthMm, expCut) < tolerance);
  assert.ok(relErr(sim83DrillRapidLen, expRapid) < tolerance);
  assert.ok(relErr(out83.pathLengthMm, expCut + expRapid) < tolerance);
  assert.ok(relErr(out83.cycleTimeSec, exp83CycleTime) < tolerance);
  assert.ok(
    relErr(sim83.totalCycleTimeSec - (rPlane / rapidRate) * 60, out83.cycleTimeSec) < tolerance,
    "Toolpath simulator and WASM G83 archetype must agree on cycle time",
  );
});

test("G-code Benchmark 4: DAE machining physics analytical parity (MRR, cutting power, torque)", () => {
  const tolerance = 1e-6;
  const ap = 4.0;
  const ae = 6.0;
  const kc = 700.0;
  const eta = 0.85;
  const feed = 1200.0;
  const rpm = 9000.0;

  const prog = [
    "O9006 (SLOTTING PHYSICS)",
    "G21 G90",
    `S${rpm} M03`,
    "G00 X0 Y0 Z0",
    `G01 X200 Y0 F${feed}`,
    "M30",
  ].join("\n");

  const builder = new DAEBuilder(undefined, "O9006");
  const res = lowerGCodeToDae(builder, prog, {
    axialDepthMm: ap,
    radialWidthMm: ae,
    specificCuttingEnergyNmm2: kc,
    spindleEfficiency: eta,
  });

  const expMrr = (ap * ae * feed) / 60.0;
  const expPcut = kc * expMrr * 1e-3;
  const expPspindle = expPcut / eta;
  const expOmega = (2 * Math.PI * rpm) / 60.0;
  const expTorque = expPspindle / expOmega;
  const expCutTime = (200 / feed) * 60.0;
  const expVol = expMrr * expCutTime;
  const expEnergy = expPspindle * expCutTime;

  assert.ok(relErr(res.metrics.mrrMm3PerSec, expMrr) < tolerance);
  assert.ok(relErr(res.metrics.cuttingPowerW, expPcut) < tolerance);
  assert.ok(relErr(res.metrics.spindlePowerW, expPspindle) < tolerance);
  assert.ok(relErr(res.metrics.spindleTorqueNm, expTorque) < tolerance);
  assert.ok(relErr(res.metrics.totalRemovedVolumeMm3, expVol) < tolerance);
  assert.ok(relErr(res.metrics.totalCuttingEnergyJ, expEnergy) < tolerance);
});
