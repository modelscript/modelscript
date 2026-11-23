// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseIrig106 } from "../src/parser/index.js";
import {
  buildCommutatorGrid,
  decodeBinaryWord,
  evaluateConversion,
  evaluatePolynomialCalibration,
} from "../src/solver/index.js";

/**
 * Flight-test PCM telemetry benchmark deck:
 * - Bit rate D1 = 512,000 bps
 * - Common word length F1 = 16 bits
 * - Words per minor frame MF1 = 30 data words (480 bits)
 * - Sync pattern MF4 = FE6B2840 (32 bits)
 * - Bits per minor frame MF2 = 480 + 32 = 512 bits
 * - Exact Minor Frame Rate = 512,000 / 512 = 1000.0 Hz
 * - Minor frames per major frame MF\N = 8
 * - Exact Major Frame Rate = 1000.0 / 8 = 125.0 Hz
 *
 * Channels:
 * 1. ACCEL_X: supercommutated (WP=1, WI=10 -> words [1, 11, 21] in all 8 minor frames -> 24 slots/major -> 3000.0 Hz, BW=1500.0 Hz)
 * 2. GYRO_Y: normal (WP=2, all 8 minor frames -> 8 slots/major -> 1000.0 Hz, BW=500.0 Hz)
 * 3. PRESS_COMB: subcommutated (WP=3, FP=1, FI=2 -> frames [1, 3, 5, 7] -> 4 slots/major -> 500.0 Hz, BW=250.0 Hz)
 * 4. TEMP_ENG: subcommutated (WP=3, FP=2, FI=4 -> frames [2, 6] -> 2 slots/major -> 250.0 Hz, BW=125.0 Hz)
 * 5. BATT_V: subcommutated (WP=3, FP=4, FI=8 -> frame [4] -> 1 slot/major -> 125.0 Hz, BW=62.5 Hz)
 */
const BENCHMARK_TMATS = `
G\\PN:IRIG106_BENCHMARK_01;
P-1\\DLN:PCM_BENCH;
P-1\\D1:512000;
P-1\\F1:16;
P-1\\MF\\N:8;
P-1\\MF1:30;
P-1\\MF2:512;
P-1\\MF4:FE6B2840;
D-1\\DLN:PCM_BENCH;
D-1\\MN-1-1:ACCEL_X;
D-1\\WP-1-1:1;
D-1\\WI-1-1:10;
D-1\\MN-1-2:GYRO_Y;
D-1\\WP-1-2:2;
D-1\\MN-1-3:PRESS_COMB;
D-1\\WP-1-3:3;
D-1\\FP-1-3:1;
D-1\\FI-1-3:2;
D-1\\MN-1-4:TEMP_ENG;
D-1\\WP-1-4:3;
D-1\\FP-1-4:2;
D-1\\FI-1-4:4;
D-1\\MN-1-5:BATT_V;
D-1\\WP-1-5:3;
D-1\\FP-1-5:4;
D-1\\FI-1-5:8;
C-1\\DCN:ACCEL_X;
C-1\\MN3:G;
C-1\\BFM:TWO;
C-1\\DCT:COE;
C-1\\CO-0:-12.5;
C-1\\CO-1:0.0045;
C-1\\CO-2:-1.25e-7;
C-1\\CO-3:3.5e-12;
C-2\\DCN:GYRO_Y;
C-2\\MN3:DEG/S;
C-2\\DCT:COE;
C-2\\CO-0:-200.0;
C-2\\CO-1:0.006103515625;
C-3\\DCN:PRESS_COMB;
C-3\\MN3:PSI;
C-3\\DCT:COE;
C-3\\CO-0:14.696;
C-3\\CO-1:0.125;
C-4\\DCN:TEMP_ENG;
C-4\\MN3:DEG C;
C-4\\DCT:COE;
C-4\\CO-0:-40.0;
C-4\\CO-1:0.025;
C-5\\DCN:BATT_V;
C-5\\MN3:V;
C-5\\DCT:COE;
C-5\\CO-0:0.0;
C-5\\CO-1:0.008;
`;

describe("@modelscript/irig106 Verification Benchmark Suite", () => {
  it("achieves exact PCM minor/major frame bit-rate & sample-rate parity (relErr < 1e-10)", () => {
    const model = parseIrig106(BENCHMARK_TMATS);
    const grid = buildCommutatorGrid(model);

    const expectedMinorRate = 512000 / 512; // 1000.0 Hz
    const expectedMajorRate = expectedMinorRate / 8; // 125.0 Hz
    const expectedWordRate = 30 * expectedMinorRate; // 30000.0 words/s

    const minorRelErr = Math.abs(grid.minorFrameRateHz - expectedMinorRate) / expectedMinorRate;
    const majorRelErr = Math.abs(grid.majorFrameRateHz - expectedMajorRate) / expectedMajorRate;
    const wordRelErr = Math.abs(grid.wordRateHz - expectedWordRate) / expectedWordRate;

    assert.ok(minorRelErr < 1e-10, `minorFrameRate relErr ${minorRelErr} >= 1e-10`);
    assert.ok(majorRelErr < 1e-10, `majorFrameRate relErr ${majorRelErr} >= 1e-10`);
    assert.ok(wordRelErr < 1e-10, `wordRate relErr ${wordRelErr} >= 1e-10`);
    assert.strictEqual(
      grid.conflicts.length,
      0,
      "Subcommutated channels sharing W3 on disjoint frames must not conflict",
    );
  });

  it("verifies supercommutated and subcommutated slot schedules and Nyquist bandwidths", () => {
    const model = parseIrig106(BENCHMARK_TMATS);
    const grid = buildCommutatorGrid(model);
    const byName = new Map(grid.schedules.map((s) => [s.name, s]));

    const accel = byName.get("ACCEL_X")!;
    assert.deepStrictEqual(accel.wordPositions, [1, 11, 21]);
    assert.strictEqual(accel.commutationType, "supercommutated");
    assert.strictEqual(accel.slotsPerMajorFrame, 24);
    assert.ok(Math.abs(accel.sampleRateHz - 3000.0) / 3000.0 < 1e-10);
    assert.ok(Math.abs(accel.nyquistBandwidthHz - 1500.0) / 1500.0 < 1e-10);

    const gyro = byName.get("GYRO_Y")!;
    assert.strictEqual(gyro.commutationType, "normal");
    assert.ok(Math.abs(gyro.sampleRateHz - 1000.0) / 1000.0 < 1e-10);

    const press = byName.get("PRESS_COMB")!;
    assert.deepStrictEqual(press.framePositions, [1, 3, 5, 7]);
    assert.strictEqual(press.commutationType, "subcommutated");
    assert.ok(Math.abs(press.sampleRateHz - 500.0) / 500.0 < 1e-10);

    const temp = byName.get("TEMP_ENG")!;
    assert.deepStrictEqual(temp.framePositions, [2, 6]);
    assert.strictEqual(temp.commutationType, "subcommutated");
    assert.ok(Math.abs(temp.sampleRateHz - 250.0) / 250.0 < 1e-10);

    const batt = byName.get("BATT_V")!;
    assert.deepStrictEqual(batt.framePositions, [4]);
    assert.strictEqual(batt.commutationType, "subcommutated");
    assert.ok(Math.abs(batt.sampleRateHz - 125.0) / 125.0 < 1e-10);
  });

  it("evaluates degree-3 polynomial EU calibration with RMSE < 1e-12 vs exact analytical formula", () => {
    const model = parseIrig106(BENCHMARK_TMATS);
    const conv = model.conversionsByName.get("ACCEL_X")!;
    const [c0, c1, c2, c3] = conv.coefficients as [number, number, number, number];

    const samples = [-32768, -10000, -1024, 0, 512, 4096, 16384, 32767];
    let sumSqErr = 0;
    for (const x of samples) {
      const exact = c0 + c1 * x + c2 * x * x + c3 * x * x * x;
      const computed = evaluatePolynomialCalibration(conv.coefficients, x);
      const viaConv = evaluateConversion(conv, x);
      assert.strictEqual(computed, viaConv);
      const err = computed - exact;
      sumSqErr += err * err;
    }
    const rmse = Math.sqrt(sumSqErr / samples.length);
    assert.ok(rmse < 1e-12, `Polynomial calibration RMSE ${rmse} >= 1e-12`);
  });

  it("decodes UNS, TWO, OFF, and SIG binary telemetry words accurately", () => {
    assert.strictEqual(decodeBinaryWord(0xffff, 16, "UNS"), 65535);
    assert.strictEqual(decodeBinaryWord(0xffff, 16, "TWO"), -1);
    assert.strictEqual(decodeBinaryWord(0x8000, 16, "TWO"), -32768);
    assert.strictEqual(decodeBinaryWord(0x8000, 16, "OFF"), 0);
    assert.strictEqual(decodeBinaryWord(0x8005, 16, "SIG"), -5);
  });
});
