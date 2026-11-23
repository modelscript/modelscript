// SPDX-License-Identifier: AGPL-3.0-or-later

import { DAEBuilder } from "@modelscript/runtime";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { irig106ToDae, lowerIrig106ToDae } from "../src/dae/index.js";
import { parseIrig106 } from "../src/parser/index.js";

const TELEMETRY_DECK = `
G\\PN:DAE_TEST;
P-1\\DLN:PCM_1;
P-1\\D1:256000;
P-1\\F1:16;
P-1\\MF\\N:4;
P-1\\MF1:14;
P-1\\MF2:256;
P-1\\MF4:FE6B2840;
D-1\\DLN:PCM_1;
D-1\\MN-1-1:ACCEL_Z;
D-1\\WP-1-1:1;
D-1\\WI-1-1:7;
D-1\\MN-1-2:TEMP_NOSE;
D-1\\WP-1-2:3;
D-1\\FP-1-2:2;
D-1\\FI-1-2:4;
C-1\\DCN:ACCEL_Z;
C-1\\MN3:G;
C-1\\DCT:COE;
C-1\\CO-0:-20.0;
C-1\\CO-1:0.01;
C-1\\CO-2:1.5e-7;
C-2\\DCN:TEMP_NOSE;
C-2\\MN3:DEG C;
C-2\\DCT:COE;
C-2\\CO-0:-50.0;
C-2\\CO-1:0.05;
`;

describe("@modelscript/irig106 DAE Arena Lowering", () => {
  it("lowers PCM frame timing, sampling rates, and polynomial EU calibrations into DAEBuilder", () => {
    const model = parseIrig106(TELEMETRY_DECK);
    const builder = new DAEBuilder(undefined, "Irig106Test");
    const result = lowerIrig106ToDae(builder, model);

    assert.strictEqual(result.channelCount, 2);
    // 2 frame rate equations + 2 channels * 3 equations (fs, bw, eu) = 8 equations
    assert.strictEqual(result.equationCount, 8);
    assert.ok(result.variableMap.has("pcm_bit_rate"));
    assert.ok(result.variableMap.has("pcm_minor_frame_rate"));
    assert.ok(result.variableMap.has("pcm_major_frame_rate"));
    assert.ok(result.variableMap.has("raw_ACCEL_Z"));
    assert.ok(result.variableMap.has("eu_ACCEL_Z"));
    assert.ok(result.variableMap.has("fs_ACCEL_Z"));
    assert.ok(result.variableMap.has("bw_ACCEL_Z"));
    assert.ok(result.variableMap.has("eu_TEMP_NOSE"));
  });

  it("supports high-level irig106ToDae(source) wrapper", () => {
    const builder = irig106ToDae(TELEMETRY_DECK);
    assert.ok(builder.lookupVariable("pcm_minor_frame_rate") !== -1);
    assert.ok(builder.lookupVariable("eu_ACCEL_Z") !== -1);
    assert.ok(builder.lookupVariable("bw_TEMP_NOSE") !== -1);
  });
});
