// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decodeCdfBinary, encodeCdfBinary, parseCdfSkeleton } from "../src/parser/index.js";
import {
  CDF_EPOCH_J2000_UTC_MS,
  cdfEpochToIso,
  cdfEpochToJ2000Seconds,
  cdfEpochToTt2000,
  computeMagneticFieldMagnitude,
  computeVectorNormSeries,
  isoToCdfEpoch,
  j2000SecondsToCdfEpoch,
  tt2000ToCdfEpoch,
} from "../src/solver/index.js";

describe("NASA CDF Numerical Precision Benchmarks", () => {
  it("binary CDF v3 record round-trip achieves relErr < 1e-9 on float64 vector telemetry", () => {
    const vectors: Array<[number, number, number]> = [
      [12.345678901234, -45.678901234567, 89.012345678901],
      [-0.000123456789, 1024.55555555555, -333.14159265359],
      [7.777777777777, 8.888888888888, 9.999999999999],
    ];

    const skt = `#header
  CDF NAME: benchmark_vec.cdf
  DATA ENCODING: NETWORK
  MAJORITY: ROW_MAJOR
  FORMAT: SINGLE
  VERSION: 3.8.0
#variables
  "EPOCH" CDF_EPOCH 1 0:[] T
    [0] = ${CDF_EPOCH_J2000_UTC_MS}
    [1] = ${CDF_EPOCH_J2000_UTC_MS + 1000}
    [2] = ${CDF_EPOCH_J2000_UTC_MS + 2000}
  .
  "B_GSE" CDF_REAL8 1 1:[3] T T
    [0] = { ${vectors[0]!.join(", ")} }
    [1] = { ${vectors[1]!.join(", ")} }
    [2] = { ${vectors[2]!.join(", ")} }
  .
#end
`;
    const doc = parseCdfSkeleton(skt);
    const encoded = encodeCdfBinary(doc, { version: "v3" });
    const decoded = decodeCdfBinary(encoded);

    const decodedVecs = decoded.variables[1]!.values as number[][];
    let maxRelErr = 0;
    for (let i = 0; i < vectors.length; i++) {
      for (let c = 0; c < 3; c++) {
        const expected = vectors[i]![c]!;
        const actual = decodedVecs[i]![c]!;
        const relErr = Math.abs(actual - expected) / Math.max(1e-15, Math.abs(expected));
        if (relErr > maxRelErr) maxRelErr = relErr;
      }
    }
    assert.ok(maxRelErr < 1e-9, `Expected relErr < 1e-9, got ${maxRelErr}`);
  });

  it("CDF_EPOCH J2000 conversion, TT2000 round-trip, and vector field norm achieve rmse < 1e-10", () => {
    // Exact J2000.0 UTC check
    const j2000Epoch = isoToCdfEpoch("2000-01-01T12:00:00.000Z");
    assert.equal(j2000Epoch, CDF_EPOCH_J2000_UTC_MS);
    assert.equal(cdfEpochToJ2000Seconds(j2000Epoch), 0.0);
    assert.equal(cdfEpochToIso(j2000SecondsToCdfEpoch(86400.0)), "2000-01-02T12:00:00.000Z");

    // J2000.0 TT epoch = 2000-01-01T11:58:55.816Z -> TT2000 = 0n
    const j2000TtEpoch = isoToCdfEpoch("2000-01-01T11:58:55.816Z");
    assert.equal(cdfEpochToTt2000(j2000TtEpoch), 0n);

    // Multi-epoch J2000 & TT2000 round-trip RMSE
    const testIsos = [
      "2000-01-01T12:00:00.000Z",
      "2010-06-15T06:30:00.000Z",
      "2018-01-01T00:00:00.000Z",
      "2025-03-15T12:34:56.789Z",
    ];
    let epochSqErr = 0;
    for (const iso of testIsos) {
      const ep = isoToCdfEpoch(iso);
      const jSec = cdfEpochToJ2000Seconds(ep);
      const backEp = j2000SecondsToCdfEpoch(jSec);
      const tt = cdfEpochToTt2000(ep);
      const backFromTt = tt2000ToCdfEpoch(tt);
      epochSqErr += (backEp - ep) ** 2 + (backFromTt - ep) ** 2;
    }
    const epochRmse = Math.sqrt(epochSqErr / (testIsos.length * 2));
    assert.ok(epochRmse < 1e-10, `Expected epoch RMSE < 1e-10, got ${epochRmse}`);

    // Magnetic field vector norm RMSE against exact analytical Pythagorean norms
    const testVecs: Array<[number, number, number]> = [
      [3.0, 4.0, 0.0],
      [5.0, 12.0, 0.0],
      [2.0, 3.0, 6.0],
      [1.0, 4.0, 8.0],
    ];
    const analytical = [5.0, 13.0, 7.0, 9.0];
    const computed = computeVectorNormSeries(testVecs);
    let sqErr = 0;
    for (let i = 0; i < analytical.length; i++) {
      const d = computed[i]! - analytical[i]!;
      sqErr += d * d;
    }
    const normRmse = Math.sqrt(sqErr / analytical.length);
    assert.ok(normRmse < 1e-10, `Expected vector norm RMSE < 1e-10, got ${normRmse}`);
    assert.equal(computeMagneticFieldMagnitude(3, 4, 12), 13);
  });
});
