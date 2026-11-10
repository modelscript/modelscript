// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lintComtradeCfg, lintComtradeRecord } from "../src/lints/index.js";
import { parseComtradeCfg } from "../src/parser/comtrade-reader.js";
import type { ComtradeRecord } from "../src/types.js";

describe("COMTRADE Diagnostic Linter", () => {
  it("should flag CT1001 when CFG header contains invalid total channel count", () => {
    const invalidCfgText = `TEST_SUB,DEV1,1999
10,2A,2D
1,VA,A,,V,1.0,0.0,0,-32768,32767,1,1,S
2,VB,B,,V,1.0,0.0,0,-32768,32767,1,1,S
1,D1,0,0
2,D2,0,0
60
1
1000,1
01/01/2026,00:00:00.000000
01/01/2026,00:00:00.001000
ASCII
1.0`;

    const cfg = parseComtradeCfg(invalidCfgText);
    const diagnostics = lintComtradeCfg(cfg);
    const ct1001 = diagnostics.find((d) => d.code === "CT1001");
    assert.ok(ct1001, "Expected CT1001 for mismatch between total count (10) and sum of 2A+2D=4");
  });

  it("should flag CT2001 when timestamps are not strictly monotonic", () => {
    const nonMonotonicRecord: ComtradeRecord = {
      cfg: {
        stationName: "SUB",
        recDevId: "DEV",
        revYear: 1999,
        totalChannels: 1,
        analogCount: 1,
        digitalCount: 0,
        analogs: [
          {
            index: 1,
            chId: "V",
            phase: "",
            ccbm: "",
            uu: "V",
            a: 1,
            b: 0,
            skew: 0,
            minVal: -100,
            maxVal: 100,
            primary: 1,
            secondary: 1,
            scaling: "P",
          },
        ],
        digitals: [],
        nominalFrequency: 60,
        sampleRateCount: 1,
        sampleRates: [{ rate: 1000, lastSampleNumber: 3 }],
        startTime: "01/01/2026,00:00:00.000000",
        triggerTime: "01/01/2026,00:00:00.000000",
        fileType: "ASCII",
        timeMult: 1.0,
      },
      analogData: [[1, 2, 3]],
      digitalData: [],
      timestamps: [0, 0.002, 0.001], // non-monotonic timestamp at index 2
    };

    const diagnostics = lintComtradeRecord(nonMonotonicRecord);
    const ct2001 = diagnostics.find((d) => d.code === "CT2001");
    assert.ok(ct2001, "Expected CT2001 for non-monotonic timestamp");
  });

  it("should flag CT3001 when data channel count does not match CFG definition", () => {
    const mismatchRecord: ComtradeRecord = {
      cfg: {
        stationName: "SUB",
        recDevId: "DEV",
        revYear: 1999,
        totalChannels: 2,
        analogCount: 2,
        digitalCount: 0,
        analogs: [
          {
            index: 1,
            chId: "V1",
            phase: "",
            ccbm: "",
            uu: "V",
            a: 1,
            b: 0,
            skew: 0,
            minVal: -100,
            maxVal: 100,
            primary: 1,
            secondary: 1,
            scaling: "P",
          },
          {
            index: 2,
            chId: "V2",
            phase: "",
            ccbm: "",
            uu: "V",
            a: 1,
            b: 0,
            skew: 0,
            minVal: -100,
            maxVal: 100,
            primary: 1,
            secondary: 1,
            scaling: "P",
          },
        ],
        digitals: [],
        nominalFrequency: 60,
        sampleRateCount: 1,
        sampleRates: [{ rate: 1000, lastSampleNumber: 2 }],
        startTime: "01/01/2026,00:00:00.000000",
        triggerTime: "01/01/2026,00:00:00.000000",
        fileType: "ASCII",
        timeMult: 1.0,
      },
      analogData: [[1, 2]], // Only 1 series provided while 2 expected
      digitalData: [],
      timestamps: [0, 0.001],
    };

    const diagnostics = lintComtradeRecord(mismatchRecord);
    const ct3001 = diagnostics.find((d) => d.code === "CT3001");
    assert.ok(ct3001, "Expected CT3001 for analog data channel count mismatch");
  });

  it("should flag CT4001 when sample rate is missing or non-positive", () => {
    const zeroRateCfgText = `TEST_SUB,DEV1,1999
1,1A,0D
1,VA,A,,V,1.0,0.0,0,-32768,32767,1,1,S
60
1
0,0
01/01/2026,00:00:00.000000
01/01/2026,00:00:00.001000
ASCII
1.0`;

    const cfg = parseComtradeCfg(zeroRateCfgText);
    const diagnostics = lintComtradeCfg(cfg);
    const ct4001 = diagnostics.find((d) => d.code === "CT4001");
    assert.ok(ct4001, "Expected CT4001 for non-positive sample rate");
  });
});
