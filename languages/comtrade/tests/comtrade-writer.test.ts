// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseComtradeCff } from "../src/parser/comtrade-reader.js";
import {
  emtResultToComtrade,
  writeComtradeCff,
  writeComtradeCfg,
  writeComtradeDatAscii,
} from "../src/parser/comtrade-writer.js";
import type { ComtradeRecord } from "../src/types.js";

describe("COMTRADE Writer & Serializer", () => {
  const sampleRecord: ComtradeRecord = {
    cfg: {
      stationName: "SUBSTATION_EAST",
      recDevId: "SEL_421",
      revYear: 1999,
      totalChannels: 2,
      analogCount: 1,
      digitalCount: 1,
      analogs: [
        {
          index: 1,
          chId: "IA",
          phase: "A",
          ccbm: "",
          uu: "A",
          a: 0.1,
          b: 0.0,
          skew: 0,
          minVal: -32768,
          maxVal: 32767,
          primary: 1000,
          secondary: 5,
          scaling: "P",
        },
      ],
      digitals: [
        {
          index: 1,
          chId: "TRIP",
          phase: "",
          ccbm: "",
          normalState: 0,
        },
      ],
      nominalFrequency: 60,
      sampleRateCount: 1,
      sampleRates: [{ rate: 10000, lastSampleNumber: 4 }],
      startTime: "01/01/2026,00:00:00.000000",
      triggerTime: "01/01/2026,00:00:00.000100",
      fileType: "ASCII",
      timeMult: 1.0,
    },
    analogData: [[10.0, 10.5, 11.0, 10.8]],
    digitalData: [[0, 0, 1, 1]],
    timestamps: [0, 0.0001, 0.0002, 0.0003],
  };

  it("should write CFG text matching IEEE C37.111 specification", () => {
    const cfgText = writeComtradeCfg(sampleRecord.cfg);
    assert.ok(cfgText.includes("SUBSTATION_EAST,SEL_421,1999"));
    assert.ok(cfgText.includes("2,1A,1D"));
    assert.ok(cfgText.includes("1,IA,A,,A,0.1,0,0,-32768,32767,1000,5,P"));
    assert.ok(cfgText.includes("1,TRIP,,,0"));
    assert.ok(cfgText.includes("60"));
  });

  it("should write ASCII DAT file with correct timestamps and values", () => {
    const datText = writeComtradeDatAscii(sampleRecord);
    const lines = datText.trim().split(/\r?\n/);
    assert.equal(lines.length, 4);
    assert.equal(lines[0], "1,0,100,0");
    assert.equal(lines[2], "3,200,110,1");
  });

  it("should write and serialize CFF single file container roundtrip", () => {
    const cffString = writeComtradeCff(sampleRecord);
    assert.ok(cffString.includes("--- file type: CFG ---"));
    assert.ok(cffString.includes("--- file type: DAT ---"));

    const parsed = parseComtradeCff(cffString);
    assert.equal(parsed.cfg.stationName, "SUBSTATION_EAST");
    assert.equal(parsed.cfg.recDevId, "SEL_421");
    assert.equal(parsed.analogData[0]?.length, 4);
    assert.equal(parsed.digitalData[0]?.length, 4);
  });

  it("should convert EMT simulation result into COMTRADE disturbance record", () => {
    const emtResult = {
      time: [0.0, 0.001, 0.002, 0.003],
      variables: {
        "Substation.Bus1.Va": [120.0, 120.5, 121.0, 120.8],
        "Substation.Line1.Ia": [5.0, 5.2, 5.1, 5.0],
        "Substation.Breaker.Status": [1, 1, 0, 0],
      },
    };

    const record = emtResultToComtrade(emtResult, {
      stationName: "EMT_SIM_SUB",
      recDevId: "SOLVER_BDF",
      nominalFrequency: 50,
    });

    assert.equal(record.cfg.stationName, "EMT_SIM_SUB");
    assert.equal(record.cfg.recDevId, "SOLVER_BDF");
    assert.equal(record.cfg.nominalFrequency, 50);
    assert.equal(record.cfg.analogCount, 2);
    assert.equal(record.cfg.digitalCount, 1);
    assert.equal(record.timestamps.length, 4);
  });
});
