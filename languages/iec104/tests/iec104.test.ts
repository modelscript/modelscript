// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lowerIec104ToDae } from "../src/dae/iec104-to-dae.js";
import { canIndexIec104 } from "../src/indexing.js";
import { lintIec104Profile } from "../src/lints/index.js";
import { getIec104DocumentSymbols } from "../src/lsp.js";
import { parseIec104 } from "../src/parser/iec104-parser.js";

const SAMPLE_IEC104 = `
station Substation_North_RTU ca=101 oa=1 port=2404 k=12 w=8 t1=15 t2=10
point 1001 M_SP_TB_1 Breaker_52A_Status init=1
point 2001 M_ME_TF_1 Bus_1_Voltage_kV units=kV scale=1.0 offset=0.0 deadband=0.2 init=138.0
point 2002 M_ME_NC_1 Feeder_1_MW units=MW scale=1.0 deadband=0.5 init=42.5
point 3001 C_SC_NA_1 Breaker_52A_Trip init=0
`;

describe("IEC 60870-5-104 Profile Compiler", () => {
  it("parses text and JSON profiles", () => {
    const profile = parseIec104(SAMPLE_IEC104);
    assert.equal(profile.stationName, "Substation_North_RTU");
    assert.equal(profile.commonAddress, 101);
    assert.equal(profile.apci.k, 12);
    assert.equal(profile.points.length, 4);
    assert.equal(profile.points[1]?.units, "kV");

    const jsonProfile = parseIec104(JSON.stringify(profile));
    assert.equal(jsonProfile.points.length, 4);
    assert.equal(jsonProfile.commonAddress, 101);
  });

  it("validates APCI parameters, common address, and IOA uniqueness", () => {
    const validDiags = lintIec104Profile(parseIec104(SAMPLE_IEC104));
    assert.equal(validDiags.length, 0);

    const bad = parseIec104(`
station BadRTU ca=70000 k=4 w=8 t1=5 t2=10
point 100 M_SP_NA_1 Pt1
point 100 M_ME_NC_1 Pt2 deadband=-1
`);
    const codes = new Set(lintIec104Profile(bad).map((d) => d.code));
    assert.ok(codes.has("IEC104_1001"));
    assert.ok(codes.has("IEC104_1002"));
    assert.ok(codes.has("IEC104_1003"));
    assert.ok(codes.has("IEC104_2002"));
    assert.ok(codes.has("IEC104_3002"));
  });

  it("lowers IOA points into DAEBuilder and provides LSP/indexing", () => {
    const profile = parseIec104(SAMPLE_IEC104);
    const dae = lowerIec104ToDae(profile);
    assert.notEqual(dae.lookupVariable("ioa_1001_Breaker_52A_Status"), -1);
    assert.notEqual(dae.lookupVariable("eng_ioa_2001_Bus_1_Voltage_kV"), -1);
    assert.ok(dae.variables().length >= 6);
    assert.ok(dae.equations().length >= 4);

    assert.equal(canIndexIec104("rtu.iec104"), true);
    assert.equal(getIec104DocumentSymbols(SAMPLE_IEC104).length, 4);
  });
});
