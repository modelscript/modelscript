// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { bufrToCsv, bufrToDae, bufrToEpw, parseBufrText } from "../src/index.js";

const RADIOSONDE_SAMPLE = `
BUFR EDITION 4 NAME SONDE_KOAK
SECTION 1
  CENTRE = 7
  CATEGORY = 2
  VERSION = 38
  YEAR = 2026
  MONTH = 7
  DAY = 1
  HOUR = 12
  MINUTE = 0
SECTION 3
  SUBSETS = 1
  3-09-052
SECTION 4
  SUBSET 1:
    0-01-001 = 72
    0-01-002 = 493
    0-04-001 = 2026
    0-04-002 = 7
    0-04-003 = 1
    0-04-004 = 12
    0-04-005 = 0
    0-05-001 = 37.75000
    0-06-001 = -122.22000
    0-07-001 = 3
    0-31-002 = 3
    0-07-004 = 100000
    0-10-009 = 111
    0-12-101 = 288.15
    0-12-103 = 282.15
    0-11-001 = 270
    0-11-002 = 6.0
    0-07-004 = 70000
    0-10-009 = 3012
    0-12-101 = 268.65
    0-12-103 = 260.15
    0-11-001 = 280
    0-11-002 = 15.0
    0-07-004 = 50000
    0-10-009 = 5574
    0-12-101 = 252.15
    0-12-103 = 238.15
    0-11-001 = 290
    0-11-002 = 25.0
7777
`;

describe("@modelscript/bufr DAE Lowering & Projections", () => {
  it("lowers upper-air sounding atmospheric state equations directly into DAEBuilder", () => {
    const msg = parseBufrText(RADIOSONDE_SAMPLE);
    const { builder, result } = bufrToDae(msg);

    assert.equal(result.stateVarIndices.length, 6); // 3 levels * (P, z)
    assert.ok(result.equationCount >= 18); // 3 levels * (ideal gas + theta + der(z) + der(P) + u + v)
    assert.ok(result.variableMap.has("level_0_P"));
    assert.ok(result.variableMap.has("level_0_rho"));
    assert.ok(result.variableMap.has("level_0_theta"));
    assert.ok(builder.getEqCount() >= 18);
    assert.ok(builder.getVarCount() >= 20);
  });

  it("projects BUFR sounding to RFC-4180 CSV and EnergyPlus EPW weather snippet", () => {
    const msg = parseBufrText(RADIOSONDE_SAMPLE);
    const csv = bufrToCsv(msg);
    const csvLines = csv.trim().split("\n");
    assert.equal(csvLines.length, 4); // header + 3 levels
    assert.ok(csvLines[0]?.includes("pressure_pa"));
    assert.ok(csvLines[1]?.startsWith("100000.0"));

    const epw = bufrToEpw(msg);
    assert.ok(epw.startsWith("LOCATION,72493,"));
    assert.ok(epw.includes("DATA PERIODS,1,1,Data,Sunday,7/1,7/1"));
    assert.ok(epw.includes("2026,7,1,"));
  });
});
