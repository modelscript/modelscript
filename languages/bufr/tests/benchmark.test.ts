// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  decodeBufrBinary,
  encodeBufrBinary,
  hypsometricThickness,
  isaAltitudeFromPressure,
  isaPressureAtAltitude,
  magnusDewpoint,
  magnusRelativeHumidity,
  parseBufrText,
} from "../src/index.js";

describe("@modelscript/bufr Numerical Verification Benchmarks", () => {
  it("achieves BUFR binary bit-stream round-trip relative error < 1e-5", () => {
    const src = `
BUFR EDITION 4 NAME BENCH_ROUNDTRIP
SECTION 1
  CENTRE = 7
  CATEGORY = 0
  VERSION = 38
  YEAR = 2026
  MONTH = 6
  DAY = 21
  HOUR = 12
  MINUTE = 0
  SECOND = 0
SECTION 3
  SUBSETS = 1
  0-05-001
  0-06-001
  0-10-004
  0-12-101
  0-12-103
SECTION 4
  SUBSET 1:
    0-05-001 = 47.37690
    0-06-001 = 8.54170
    0-10-004 = 101320
    0-12-101 = 293.45
    0-12-103 = 284.12
7777
`;
    const orig = parseBufrText(src);
    const encoded = encodeBufrBinary(orig);
    const decoded = decodeBufrBinary(encoded);

    const expected: Record<string, number> = {
      "0-05-001": 47.3769,
      "0-06-001": 8.5417,
      "0-10-004": 101320,
      "0-12-101": 293.45,
      "0-12-103": 284.12,
    };

    for (const [desc, expVal] of Object.entries(expected)) {
      const gotVal = decoded.subsets[0]?.values.find((v) => v.descriptor === desc)?.value as number;
      const relErr = Math.abs(gotVal - expVal) / Math.max(1e-12, Math.abs(expVal));
      assert.ok(relErr < 1e-5, `Expected relErr < 1e-5 for ${desc}, got ${relErr}`);
    }
  });

  it("achieves Magnus-Tetens dewpoint/RH inverse parity RMSE < 1e-4", () => {
    const cases: Array<[number, number]> = [
      [263.15, 40],
      [273.15, 80],
      [288.15, 55],
      [298.15, 72],
      [308.15, 35],
      [313.15, 90],
    ];

    let sqErrSum = 0;
    for (const [tK, rhPct] of cases) {
      const tdK = magnusDewpoint(tK, rhPct);
      const rhRecovered = magnusRelativeHumidity(tK, tdK);
      const diff = rhRecovered - rhPct;
      sqErrSum += diff * diff;
    }
    const rmse = Math.sqrt(sqErrSum / cases.length);
    assert.ok(rmse < 1e-4, `Expected Magnus-Tetens round-trip RMSE < 1e-4, got ${rmse}`);
  });

  it("achieves ISA pressure-altitude & hypsometric sounding parity RMSE < 1e-4", () => {
    const altitudes = [0, 500, 1500, 3000, 5500, 9000, 11000, 14000, 18000];
    let sqErrSum = 0;
    for (const z of altitudes) {
      const p = isaPressureAtAltitude(z);
      const zRecovered = isaAltitudeFromPressure(p);
      const err = zRecovered - z;
      sqErrSum += err * err;
    }
    const rmse = Math.sqrt(sqErrSum / altitudes.length);
    assert.ok(rmse < 1e-4, `Expected ISA pressure-altitude round-trip RMSE < 1e-4 m, got ${rmse}`);

    // Verify isothermal stratospheric layer hypsometric exactness (11 km -> 15 km at T = 216.65 K)
    const p11 = isaPressureAtAltitude(11000);
    const p15 = isaPressureAtAltitude(15000);
    const dz = hypsometricThickness(p11, p15, 216.65);
    assert.ok(Math.abs(dz - 4000.0) < 1e-4, `Expected hypsometric thickness 4000 m, got ${dz}`);
  });
});
