// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  decodeArinc429Word,
  encodeArinc429Word,
  formatOctalLabel,
  hasValidOddParity,
  parseArinc429,
  reverseBits8,
} from "../src/parser/index.js";
import {
  ARINC429_BITS_PER_WORD_WITH_GAP,
  ARINC429_HIGH_SPEED_BPS,
  ARINC429_LOW_SPEED_BPS,
  analyzeBusUtilization,
} from "../src/solver/index.js";

describe("ARINC 429 Accuracy & Verification Benchmarks", () => {
  it("achieves relErr < 1e-5 across 32-bit BNR and BCD encode/decode round-trips", () => {
    const bnrCases: Array<{ label: string; value: number; range: number; resolution: number }> = [
      { label: "203", value: 41000.0, range: 131072, resolution: 0.5 },
      { label: "205", value: 0.842, range: 4.096, resolution: 0.000015625 },
      { label: "206", value: 312.5, range: 1024, resolution: 0.00390625 },
      { label: "310", value: 40.6413, range: 180, resolution: 180 / 262144 },
      { label: "311", value: -73.7781, range: 180, resolution: 180 / 262144 },
      { label: "314", value: 147.25, range: 180, resolution: 180 / 262144 },
      { label: "324", value: -7.85, range: 180, resolution: 180 / 262144 },
      { label: "325", value: 24.6, range: 180, resolution: 180 / 262144 },
      { label: "164", value: 2450.0, range: 8192, resolution: 0.03125 },
    ];

    for (const tc of bnrCases) {
      const word = encodeArinc429Word({
        label: tc.label,
        encoding: "BNR",
        value: tc.value,
        range: tc.range,
        resolution: tc.resolution,
      });
      assert.strictEqual(hasValidOddParity(word), true);
      const dec = decodeArinc429Word(word, { encoding: "BNR", range: tc.range, resolution: tc.resolution });
      // 18-bit BNR full-scale quantization bound is 0.5 / 2^18 = 1.907e-6 < 1e-5
      const relErr = Math.abs(dec.engineeringValue - tc.value) / tc.range;
      assert.ok(
        relErr < 1e-5,
        `Label ${tc.label} BNR round-trip relErr=${relErr} exceeded 1e-5 (got ${dec.engineeringValue}, expected ${tc.value})`,
      );
    }

    const bcdCases: Array<{ label: string; value: number; resolution: number }> = [
      { label: "034", value: 118.25, resolution: 0.01 },
      { label: "034", value: -456.78, resolution: 0.01 },
      { label: "035", value: 76543, resolution: 1 },
    ];
    for (const tc of bcdCases) {
      const word = encodeArinc429Word({
        label: tc.label,
        encoding: "BCD",
        value: tc.value,
        resolution: tc.resolution,
      });
      assert.strictEqual(hasValidOddParity(word), true);
      const dec = decodeArinc429Word(word, { encoding: "BCD", resolution: tc.resolution });
      assert.strictEqual(dec.bcdValid, true);
      const relErr = Math.abs(dec.engineeringValue - tc.value) / Math.max(Math.abs(tc.value), 1);
      assert.ok(relErr < 1e-5, `Label ${tc.label} BCD round-trip relErr=${relErr} exceeded 1e-5`);
    }
  });

  it("verifies bit-reversed octal labels and odd-parity bit 32 across all 255 labels (001–377)", () => {
    for (let labelVal = 1; labelVal <= 0o377; labelVal++) {
      const oct = formatOctalLabel(labelVal);
      const word = encodeArinc429Word({
        label: oct,
        sdi: labelVal & 3,
        encoding: "BNR",
        value: (labelVal - 128) * 1.5,
        resolution: 0.5,
      });
      assert.strictEqual(hasValidOddParity(word), true, `Parity failed for octal label ${oct}`);
      const dec = decodeArinc429Word(word, { encoding: "BNR", resolution: 0.5 });
      assert.strictEqual(dec.labelValue, labelVal);
      assert.strictEqual(dec.labelOctal, oct);
      assert.strictEqual(dec.wireLabelByte, reverseBits8(labelVal));
      assert.strictEqual(dec.sdi, labelVal & 3);
    }
  });

  it("matches analytical ARINC 429 bus bandwidth calculation with rmse < 1e-9", () => {
    const lowDoc = parseArinc429(`
BUS LOW_BENCH
RATE LOW
LABEL 203 ALTITUDE ENCODING BNR RATE 20
LABEL 205 MACH ENCODING BNR RATE 20
LABEL 206 AIRSPEED ENCODING BNR RATE 20
LABEL 314 HEADING ENCODING BNR RATE 25
LABEL 324 PITCH ENCODING BNR RATE 50
LABEL 325 ROLL ENCODING BNR RATE 50
`);
    const highDoc = parseArinc429(`
BUS HIGH_BENCH
RATE HIGH
LABEL 203 ALTITUDE ENCODING BNR RATE 100
LABEL 324 PITCH ENCODING BNR RATE 200
LABEL 325 ROLL ENCODING BNR RATE 200
`);

    const lowUtil = analyzeBusUtilization(lowDoc);
    const highUtil = analyzeBusUtilization(highDoc);

    const expectedLowWords = 20 + 20 + 20 + 25 + 50 + 50; // 185 w/s
    const expectedLowPct = ((expectedLowWords * ARINC429_BITS_PER_WORD_WITH_GAP) / ARINC429_LOW_SPEED_BPS) * 100;

    const expectedHighWords = 100 + 200 + 200; // 500 w/s
    const expectedHighPct = ((expectedHighWords * ARINC429_BITS_PER_WORD_WITH_GAP) / ARINC429_HIGH_SPEED_BPS) * 100;

    const sqErr =
      Math.pow(lowUtil.utilizationPct - expectedLowPct, 2) +
      Math.pow(highUtil.utilizationPct - expectedHighPct, 2) +
      Math.pow(lowUtil.timingMarginPct - (100 - expectedLowPct), 2) +
      Math.pow(highUtil.timingMarginPct - (100 - expectedHighPct), 2);
    const rmse = Math.sqrt(sqErr / 4);
    assert.ok(rmse < 1e-9, `Bus bandwidth RMSE ${rmse} exceeded 1e-9`);
  });
});
