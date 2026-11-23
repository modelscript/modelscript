// SPDX-License-Identifier: AGPL-3.0-or-later

import { DAEBuilder } from "@modelscript/runtime";
import assert from "node:assert/strict";
import test from "node:test";
import { getAptStdLibWasmBytes, lowerAptToDae, parseAptProgram, solveAptToClData } from "../src/index.js";

function relErr(actual: number, expected: number): number {
  const denom = Math.max(1e-12, Math.abs(expected));
  return Math.abs(actual - expected) / denom;
}

test("APT Benchmark 1: MIT APT III rectangular external contour analytical cutter-offset & cycle-time parity", () => {
  const tolerance = 1e-6;
  const rapidRate = 200.0;

  // 4.0 x 3.0 in rectangle with 0.5 in diameter cutter (R = 0.25 in)
  // Tool starts at (-1, -1), GO / TO, L1, TO, PL1, TO, L4 places tool at (-0.25, -0.25)
  // Then GORGT / L1, PAST, L2 -> (4.25, -0.25) [dx = 4.5]
  // GOLFT / L2, PAST, L3 -> (4.25, 3.25)       [dy = 3.5]
  // GOLFT / L3, PAST, L4 -> (-0.25, 3.25)      [dx = 4.5]
  // GOLFT / L4, PAST, L1 -> (-0.25, -0.25)     [dy = 3.5]
  const source = [
    "PARTNO MIT APT III RECTANGULAR CONTOUR",
    "UNITS / INCHES",
    "CUTTER / 0.5",
    "SPINDL / 1800, CLW",
    "FEDRAT / 10.0",
    "SETPT = POINT / -1.0, -1.0, 0.0",
    "P1 = POINT / 0.0, 0.0, 0.0",
    "P2 = POINT / 4.0, 0.0, 0.0",
    "P3 = POINT / 4.0, 3.0, 0.0",
    "P4 = POINT / 0.0, 3.0, 0.0",
    "L1 = LINE / P1, P2",
    "L2 = LINE / P2, P3",
    "L3 = LINE / P3, P4",
    "L4 = LINE / P4, P1",
    "PL1 = PLANE / 0, 0, 1, 0",
    "FROM / SETPT",
    "RAPID",
    "GO / TO, L1, TO, PL1, TO, L4",
    "GORGT / L1, PAST, L2",
    "GOLFT / L2, PAST, L3",
    "GOLFT / L3, PAST, L4",
    "GOLFT / L4, PAST, L1",
    "FINI",
  ].join("\n");

  const clData = solveAptToClData(parseAptProgram(source), { rapidRate });
  assert.equal(clData.errors.length, 0);

  const expectedRapidLen = Math.hypot(-0.25 - -1.0, -0.25 - -1.0); // sqrt(0.75^2 + 0.75^2)
  const expectedCutLen = 4.5 + 3.5 + 4.5 + 3.5; // 16.0 in
  const expectedRapidTimeSec = (expectedRapidLen / rapidRate) * 60.0;
  const expectedCutTimeSec = (expectedCutLen / 10.0) * 60.0;
  const expectedTotalTimeSec = expectedRapidTimeSec + expectedCutTimeSec;

  assert.ok(
    relErr(clData.totalRapidLength, expectedRapidLen) < tolerance,
    `totalRapidLength relErr=${relErr(clData.totalRapidLength, expectedRapidLen)}`,
  );
  assert.ok(
    relErr(clData.totalCuttingLength, expectedCutLen) < tolerance,
    `totalCuttingLength relErr=${relErr(clData.totalCuttingLength, expectedCutLen)}`,
  );
  assert.ok(
    relErr(clData.totalCycleTimeSec, expectedTotalTimeSec) < tolerance,
    `totalCycleTimeSec relErr=${relErr(clData.totalCycleTimeSec, expectedTotalTimeSec)}`,
  );

  // Verify exact corner cutter-center coordinates
  const linearMoves = clData.records.filter((r) => r.kind === "LINEAR");
  assert.equal(linearMoves.length, 4);
  assert.ok(Math.abs((linearMoves[0]?.x ?? 0) - 4.25) < tolerance);
  assert.ok(Math.abs((linearMoves[0]?.y ?? 0) - -0.25) < tolerance);
  assert.ok(Math.abs((linearMoves[1]?.x ?? 0) - 4.25) < tolerance);
  assert.ok(Math.abs((linearMoves[1]?.y ?? 0) - 3.25) < tolerance);
  assert.ok(Math.abs((linearMoves[2]?.x ?? 0) - -0.25) < tolerance);
  assert.ok(Math.abs((linearMoves[2]?.y ?? 0) - 3.25) < tolerance);
  assert.ok(Math.abs((linearMoves[3]?.x ?? 0) - -0.25) < tolerance);
  assert.ok(Math.abs((linearMoves[3]?.y ?? 0) - -0.25) < tolerance);
});

test("APT Benchmark 2: Tangency fillet arc (TANTO) exact effective radius & arc-length parity", () => {
  const tolerance = 1e-6;

  // 60 x 40 mm plate with R=10 mm corner fillet at (50, 10), cutter D=10 mm (rCutter=5 mm)
  // Effective external arc radius: R_eff = 10 + 5 = 15 mm
  // Quarter-circle arc length: L_arc = 15 * pi / 2
  const source = [
    "PARTNO FILLET ARC BENCHMARK",
    "UNITS / MM",
    "CUTTER / 10.0",
    "SPINDL / 6000, CLW",
    "FEDRAT / 600.0",
    "SETPT = POINT / -10, -10, 0",
    "P1 = POINT / 0, 0, 0",
    "P2 = POINT / 60, 0, 0",
    "P3 = POINT / 60, 40, 0",
    "P4 = POINT / 0, 40, 0",
    "L1 = LINE / P1, P2",
    "L2 = LINE / P2, P3",
    "L3 = LINE / P3, P4",
    "L4 = LINE / P4, P1",
    "C1 = CIRCLE / 50, 10, 0, 10",
    "PL1 = PLANE / 0, 0, 1, 0",
    "FROM / SETPT",
    "RAPID",
    "GO / TO, L1, TO, PL1, TO, L4",
    "GORGT / L1, TANTO, C1",
    "GOFWD / C1, TANTO, L2",
    "GOLFT / L2, PAST, L3",
    "FINI",
  ].join("\n");

  const clData = solveAptToClData(parseAptProgram(source));
  assert.equal(clData.errors.length, 0);

  const arcRec = clData.records.find((r) => r.kind === "ARC_CCW");
  assert.ok(arcRec, "Expected CCW fillet arc record");

  const expectedEffRadius = 15.0;
  const expectedArcLen = expectedEffRadius * (Math.PI / 2);
  // Linear 1: (-5, -5) -> (50, -5) = 55 mm
  // Arc: (50, -5) -> (65, 10), R = 15, sweep = +pi/2 => 15*pi/2
  // Linear 2: (65, 10) -> (65, 45) = 35 mm
  const expectedCutLen = 55.0 + expectedArcLen + 35.0;

  assert.ok(
    relErr(arcRec.radius ?? 0, expectedEffRadius) < tolerance,
    `arc radius relErr=${relErr(arcRec.radius ?? 0, expectedEffRadius)}`,
  );
  assert.ok(
    relErr(arcRec.length ?? 0, expectedArcLen) < tolerance,
    `arc length relErr=${relErr(arcRec.length ?? 0, expectedArcLen)}`,
  );
  assert.ok(
    relErr(clData.totalCuttingLength, expectedCutLen) < tolerance,
    `totalCuttingLength relErr=${relErr(clData.totalCuttingLength, expectedCutLen)}`,
  );
});

test("APT Benchmark 3: DAE machining physics vs analytical formulas and WASM stdlib kernel parity", async () => {
  const tolerance = 1e-6;

  const source = [
    "PARTNO MILLING PHYSICS PARITY",
    "UNITS / MM",
    "CUTTER / 10.0",
    "SPINDL / 6000, CLW",
    "FEDRAT / 600.0",
    "FROM / 0, 0, 0",
    "GOTO / 120, 0, 0",
    "FINI",
  ].join("\n");

  const ap = 5.0;
  const ae = 8.0;
  const kc = 700.0;
  const eta = 0.85;
  const feed = 600.0;
  const rpm = 6000.0;
  const cutLen = 120.0;
  const cutTimeSec = (cutLen / feed) * 60.0; // 12.0 s

  const builder = new DAEBuilder(undefined, "AptPhysicsBenchmark");
  const daeRes = lowerAptToDae(builder, source, {
    axialDepthMm: ap,
    radialWidthMm: ae,
    specificCuttingEnergyNmm2: kc,
    spindleEfficiency: eta,
  });

  const expectedMrr = (ap * ae * feed) / 60.0; // 400 mm^3/s
  const expectedPcut = kc * expectedMrr * 1e-3; // 280 W
  const expectedPspindle = expectedPcut / eta;
  const expectedOmega = (2.0 * Math.PI * rpm) / 60.0;
  const expectedTorque = expectedPspindle / expectedOmega;
  const expectedVol = expectedMrr * cutTimeSec;
  const expectedEnergy = expectedPspindle * cutTimeSec;

  assert.ok(relErr(daeRes.metrics.mrrMm3PerSec, expectedMrr) < tolerance);
  assert.ok(relErr(daeRes.metrics.cuttingPowerW, expectedPcut) < tolerance);
  assert.ok(relErr(daeRes.metrics.spindlePowerW, expectedPspindle) < tolerance);
  assert.ok(relErr(daeRes.metrics.spindleTorqueNm, expectedTorque) < tolerance);
  assert.ok(relErr(daeRes.metrics.totalRemovedVolumeMm3, expectedVol) < tolerance);
  assert.ok(relErr(daeRes.metrics.totalCuttingEnergyJ, expectedEnergy) < tolerance);

  // Cross-check against @modelscript/apt-std-lib WebAssembly kernel
  const wasmBytes = getAptStdLibWasmBytes();
  const { instance } = await WebAssembly.instantiate(wasmBytes);
  const exports = instance.exports as {
    aptCuttingPowerWatts: (kc: number, ap: number, ae: number, vf: number) => number;
    aptSpindleTorqueNm: (p: number, rpm: number) => number;
  };
  const wasmPcut = exports.aptCuttingPowerWatts(kc, ap, ae, feed);
  const wasmTorque = exports.aptSpindleTorqueNm(expectedPspindle, rpm);

  assert.ok(relErr(wasmPcut, expectedPcut) < tolerance, `WASM cutting power relErr=${relErr(wasmPcut, expectedPcut)}`);
  assert.ok(relErr(wasmTorque, expectedTorque) < tolerance, `WASM torque relErr=${relErr(wasmTorque, expectedTorque)}`);
});
