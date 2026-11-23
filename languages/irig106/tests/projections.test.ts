// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { irig106ToCsv, irig106ToXtce } from "../src/projections/index.js";

const PROJ_TMATS = `
G\\PN:APOLLO_PCM;
P-1\\DLN:S_BAND_PCM;
P-1\\D1:51200;
P-1\\F1:8;
P-1\\MF\\N:2;
P-1\\MF1:62;
P-1\\MF2:512;
P-1\\MF4:EB90;
D-1\\DLN:S_BAND_PCM;
D-1\\MN-1-1:CABIN_PRESS;
D-1\\WP-1-1:1;
D-1\\MN-1-2:O2_TEMP;
D-1\\WP-1-2:2;
D-1\\FP-1-2:1;
D-1\\FI-1-2:2;
C-1\\DCN:CABIN_PRESS;
C-1\\MN1:Cabin Pressure;
C-1\\MN3:PSI;
C-1\\BFM:UNS;
C-1\\DCT:COE;
C-1\\CO-0:0.0;
C-1\\CO-1:0.0588235;
C-2\\DCN:O2_TEMP;
C-2\\MN3:DEG F;
C-2\\DCT:NON;
`;

describe("@modelscript/irig106 Projections (CCSDS XTCE XML & CSV)", () => {
  it("projects TMATS telemetry definitions to CCSDS XTCE XML", () => {
    const xml = irig106ToXtce(PROJ_TMATS);
    assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
    assert.ok(xml.includes('<SpaceSystem xmlns="http://www.omg.org/spec/XTCE/20180204" name="APOLLO_PCM">'));
    assert.ok(xml.includes("<PolynomialCalibrator>"));
    assert.ok(xml.includes('<Term coefficient="0.0588235" exponent="1"/>'));
    assert.ok(xml.includes('<Parameter name="CABIN_PRESS" parameterTypeRef="CABIN_PRESS_Type"'));
    assert.ok(xml.includes('<SequenceContainer name="S_BAND_PCM_MinorFrame"'));
  });

  it("projects TMATS commutator schedule & calibration table to CSV", () => {
    const csv = irig106ToCsv(PROJ_TMATS);
    const lines = csv.trim().split("\n");
    assert.strictEqual(lines.length, 3); // header + 2 channels
    assert.ok(lines[0]!.startsWith("Measurement,DataLink,WordPositions"));
    assert.ok(lines[1]!.includes("CABIN_PRESS,S_BAND_PCM,1,1|2,2,normal,100.000000,50.000000,8,COE,PSI,0;0.0588235"));
    assert.ok(lines[2]!.includes("O2_TEMP,S_BAND_PCM,2,1,1,subcommutated,50.000000,25.000000,8,NON,DEG F,"));
  });
});
