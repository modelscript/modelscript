// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { inferSyncPatternBits, parseIrig106, parseWordFragmentMask, serializeIrig106 } from "../src/parser/index.js";

const SAMPLE_TMATS = `
COMMENT:Flight Test Telemetry Configuration;
G\\PN:X_15_FLIGHT_042;
G\\TA:X15_SHIP_3;
G\\106:04;
G\\DSI-1:PCM_SOURCE_1;
G\\DST-1:RF;
T-1\\ID:TX_SBAND;
T-1\\RF1:2250.5;
T-1\\RF2:1000;
T-1\\RF4:PCM/FM;
M-1\\ID:MUX_1;
M-1\\BB1:PCM;
M-1\\BB2:FM;
M-1\\BB\\DLN:PCM_LINK_1;
P-1\\DLN:PCM_LINK_1;
P-1\\D1:128000;
P-1\\D2:NRZ-L;
P-1\\F1:16;
P-1\\F2:M;
P-1\\F3:NO;
P-1\\MF\\N:4;
P-1\\MF1:6;
P-1\\MF2:128;
P-1\\MF3:FPT;
P-1\\MF4:FE6B2840;
D-1\\DLN:PCM_LINK_1;
D-1\\MLN-1:PRIMARY_LIST;
D-1\\MN-1-1:PITCH_RATE;
D-1\\WP-1-1:1;
D-1\\WI-1-1:2;
D-1\\MN-1-2:CHAMBER_P;
D-1\\WP-1-2:2;
D-1\\FP-1-2:1;
D-1\\FI-1-2:2;
C-1\\DCN:PITCH_RATE;
C-1\\MN1:Pitch Angular Rate;
C-1\\MN3:DEG/S;
C-1\\BFM:UNS;
C-1\\DCT:COE;
C-1\\CO-0:-100.0;
C-1\\CO-1:0.0030517578125;
C-2\\DCN:CHAMBER_P;
C-2\\MN3:PSI;
C-2\\DCT:PRS;
C-2\\PS1-1:0;
C-2\\PS2-1:0;
C-2\\PS1-2:4095;
C-2\\PS2-2:1000;
`;

describe("@modelscript/irig106 TMATS Chapter 9 Parser", () => {
  it("parses all core TMATS groups (G, T, M, P, D, C, COMMENT)", () => {
    const model = parseIrig106(SAMPLE_TMATS);

    assert.strictEqual(model.parseErrors.length, 0);
    assert.strictEqual(model.name, "X_15_FLIGHT_042");
    assert.strictEqual(model.general.testItem, "X15_SHIP_3");
    assert.strictEqual(model.general.irigVersion, "04");
    assert.strictEqual(model.general.dataSources.length, 1);
    assert.strictEqual(model.general.dataSources[0]!.id, "PCM_SOURCE_1");

    const tx = model.transmissions.get(1);
    assert.ok(tx);
    assert.strictEqual(tx.rfCarrierFreqMHz, 2250.5);
    assert.strictEqual(tx.modulationType, "PCM/FM");

    const mux = model.multiplexes.get(1);
    assert.ok(mux);
    assert.strictEqual(mux.pcmDataLinkName, "PCM_LINK_1");

    const pcm = model.pcmFormats.get(1);
    assert.ok(pcm);
    assert.strictEqual(pcm.bitRateBps, 128000);
    assert.strictEqual(pcm.commonWordLengthBits, 16);
    assert.strictEqual(pcm.wordsPerMinorFrame, 6);
    assert.strictEqual(pcm.bitsPerMinorFrame, 128);
    assert.strictEqual(pcm.minorFramesPerMajorFrame, 4);
    assert.strictEqual(pcm.syncPattern, "FE6B2840");
    assert.strictEqual(pcm.syncPatternBits, 32);

    const dg = model.measurementGroups.get(1);
    assert.ok(dg);
    assert.strictEqual(dg.measurements.length, 2);
    assert.strictEqual(dg.measurements[0]!.name, "PITCH_RATE");
    assert.strictEqual(dg.measurements[0]!.wordPosition, 1);
    assert.strictEqual(dg.measurements[0]!.wordInterval, 2);
    assert.strictEqual(dg.measurements[1]!.framePosition, 1);
    assert.strictEqual(dg.measurements[1]!.frameInterval, 2);

    const conv1 = model.conversionsByName.get("PITCH_RATE");
    assert.ok(conv1);
    assert.strictEqual(conv1.conversionType, "COE");
    assert.deepStrictEqual(conv1.coefficients, [-100.0, 0.0030517578125]);

    const conv2 = model.conversionsByName.get("CHAMBER_P");
    assert.ok(conv2);
    assert.strictEqual(conv2.conversionType, "PRS");
    assert.strictEqual(conv2.pairSets.length, 2);
    assert.strictEqual(model.comments.length, 1);
  });

  it("detects missing ';' terminators as parse errors", () => {
    const broken = `G\\PN:TEST_PROG\nP-1\\D1:64000;\n`;
    const model = parseIrig106(broken);
    assert.strictEqual(model.parseErrors.length, 1);
    assert.ok(model.parseErrors[0]!.message.includes("Missing ';'"));
  });

  it("round-trips TMATS attributes via serializeIrig106", () => {
    const model = parseIrig106(SAMPLE_TMATS);
    const text = serializeIrig106(model);
    const reparsed = parseIrig106(text);
    assert.strictEqual(reparsed.parseErrors.length, 0);
    assert.strictEqual(reparsed.attributes.length, model.attributes.length);
    assert.strictEqual(reparsed.pcmFormats.get(1)?.bitRateBps, 128000);
  });

  it("infers sync pattern bit lengths and word fragment masks", () => {
    assert.strictEqual(inferSyncPatternBits("EB90"), 16);
    assert.strictEqual(inferSyncPatternBits("FAF320"), 24);
    assert.strictEqual(inferSyncPatternBits("FE6B2840"), 32);
    assert.strictEqual(inferSyncPatternBits("1110101110010000"), 16);

    assert.deepStrictEqual(parseWordFragmentMask("FW", 16), { bitStart: 0, bitLength: 16 });
    assert.deepStrictEqual(parseWordFragmentMask("0000111100000000", 16), { bitStart: 4, bitLength: 4 });
  });
});
