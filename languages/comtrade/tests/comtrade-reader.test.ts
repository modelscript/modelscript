// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  parseComtradeCff,
  parseComtradeCfg,
  parseComtradeDatAscii,
  parseComtradeDatBinary,
} from "../src/parser/comtrade-reader.js";
import { writeComtradeDatBinary } from "../src/parser/comtrade-writer.js";
import type { ComtradeRecord } from "../src/types.js";

describe("COMTRADE Reader Parser", () => {
  const sampleCfg = `SUBSTATION_A,RELAY_01,1999
4,2A,2D
1,VA,A,,V,1.0,0.0,0,-32768,32767,100,1,S
2,IA,A,,A,0.1,0.0,0,-32768,32767,1,1,S
1,TRIP,0,0
2,CLOSE,0,0
60
1
10000,5
01/01/2026,00:00:00.000000
01/01/2026,00:00:00.000500
ASCII
1.0`;

  it("should parse IEEE C37.111-1999 CFG header correctly", () => {
    const cfg = parseComtradeCfg(sampleCfg);
    assert.equal(cfg.stationName, "SUBSTATION_A");
    assert.equal(cfg.recDevId, "RELAY_01");
    assert.equal(cfg.revYear, 1999);
    assert.equal(cfg.analogCount, 2);
    assert.equal(cfg.digitalCount, 2);
    assert.equal(cfg.totalChannels, 4);
    assert.equal(cfg.nominalFrequency, 60);
    assert.equal(cfg.fileType, "ASCII");

    assert.equal(cfg.analogs.length, 2);
    assert.equal(cfg.analogs[0]?.chId, "VA");
    assert.equal(cfg.analogs[0]?.uu, "V");
    assert.equal(cfg.analogs[1]?.chId, "IA");
    assert.equal(cfg.analogs[1]?.uu, "A");

    assert.equal(cfg.digitals.length, 2);
    assert.equal(cfg.digitals[0]?.chId, "TRIP");
    assert.equal(cfg.digitals[1]?.chId, "CLOSE");
  });

  it("should parse ASCII DAT disturbance data rows", () => {
    const cfg = parseComtradeCfg(sampleCfg);
    const sampleDat = `1,0,120.0,5.0,0,1
2,100,120.5,5.1,0,1
3,200,121.0,5.2,1,0
4,300,119.5,5.0,1,0
5,400,118.0,4.9,0,0`;

    const data = parseComtradeDatAscii(sampleDat, cfg);
    assert.equal(data.timestamps?.length, 5);
    assert.equal(data.timestamps?.[0], 0);
    assert.ok(Math.abs((data.timestamps?.[1] ?? 0) - 100e-6) < 1e-9); // microseconds to seconds
    assert.equal((data.analogData as any)[0]?.length, 5);
    assert.equal((data.analogData as any)[0]?.[0], 120.0);
    assert.equal((data.analogData as any)[1]?.[0], 0.5); // 5.0 * 0.1 = 0.5 A
    assert.equal((data.digitalData as any)[0]?.[2], 1);
    assert.equal((data.digitalData as any)[1]?.[2], 0);
  });

  it("should parse 16-bit BINARY DAT disturbance data buffer", () => {
    const binCfgText = sampleCfg.replace("ASCII", "BINARY");
    const cfg = parseComtradeCfg(binCfgText);

    // Create a mock record to serialize then read back
    const mockRecord: ComtradeRecord = {
      cfg,
      config: cfg,
      timeSec: new Float64Array([0, 0.0001, 0.0002]),
      analogData: [
        [100, 105, 110],
        [10, 11, 12],
      ],
      digitalData: [
        [0, 1, 0],
        [1, 0, 1],
      ],
      timestamps: [0, 0.0001, 0.0002],
    };

    const binBuffer = writeComtradeDatBinary(mockRecord);
    const parsed = parseComtradeDatBinary(binBuffer, cfg);

    assert.equal(parsed.timestamps?.length, 3);
    assert.equal(parsed.config.analogChannels.length, 2);
    assert.equal(parsed.config.digitalChannels.length, 2);
    assert.equal((parsed.digitalData as any)[0]?.[1], 1);
    assert.equal((parsed.digitalData as any)[1]?.[1], 0);
  });

  it("should parse single-file IEEE C37.111-2013 CFF disturbance record", () => {
    const cffContent = `--- file type: CFG ---
STATION_NORTH,LINE_220KV,2013
2,1A,1D
1,V_BUS,A,,kV,0.01,0.0,0,-32768,32767,1,1,S
1,CB_STATUS,0,0
50
1
5000,3
01/01/2026,12:00:00.000000
01/01/2026,12:00:00.000600
ASCII
1.0
--- file type: DAT ---
1,0,220.0,1
2,200,221.0,1
3,400,219.5,0
`;

    const record = parseComtradeCff(cffContent);
    assert.equal(record.cfg?.stationName, "STATION_NORTH");
    assert.equal(record.cfg?.recDevId, "LINE_220KV");
    assert.equal(record.cfg?.revYear, 2013);
    assert.equal((record.analogData as any)[0]?.length, 3);
    assert.equal((record.digitalData as any)[0]?.length, 3);
    assert.equal((record.analogData as any)[0]?.[0], 2.2); // 220.0 * 0.01 = 2.2 kV
    assert.equal((record.digitalData as any)[0]?.[2], 0);
  });
});
