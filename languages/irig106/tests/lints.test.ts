// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lintIrig106 } from "../src/lints/index.js";

const VALID_TMATS = `
G\\PN:CLEAN_FLIGHT;
P-1\\DLN:PCM_1;
P-1\\D1:128000;
P-1\\F1:16;
P-1\\MF\\N:2;
P-1\\MF1:6;
P-1\\MF2:128;
P-1\\MF4:FE6B2840;
D-1\\DLN:PCM_1;
D-1\\MN-1-1:ALTITUDE;
D-1\\WP-1-1:1;
D-1\\MN-1-2:AIRSPEED;
D-1\\WP-1-2:2;
C-1\\DCN:ALTITUDE;
C-1\\DCT:COE;
C-1\\CO-0:0.0;
C-1\\CO-1:1.5;
C-2\\DCN:AIRSPEED;
C-2\\DCT:COE;
C-2\\CO-0:0.0;
C-2\\CO-1:0.25;
`;

describe("@modelscript/irig106 Lints (IRIG1001-IRIG5006)", () => {
  it("reports zero diagnostics on a valid TMATS file", () => {
    const diags = lintIrig106(VALID_TMATS);
    assert.deepStrictEqual(diags, []);
  });

  it("emits IRIG1001 on missing ';' terminator", () => {
    const diags = lintIrig106(`G\\PN:BAD_TERM\n`);
    assert.ok(diags.some((d) => d.code === "IRIG1001"));
  });

  it("emits IRIG2001 on duplicate TMATS attribute code", () => {
    const diags = lintIrig106(`G\\PN:FIRST;\nG\\PN:SECOND;\n`);
    assert.ok(diags.some((d) => d.code === "IRIG2001"));
  });

  it("emits IRIG3001 when word position WP exceeds MF1", () => {
    const src = `
P-1\\DLN:PCM_1;
P-1\\D1:64000;
P-1\\F1:16;
P-1\\MF1:4;
P-1\\MF2:80;
P-1\\MF4:EB90;
D-1\\DLN:PCM_1;
D-1\\MN-1-1:OOB_CHAN;
D-1\\WP-1-1:6;
C-1\\DCN:OOB_CHAN;
C-1\\DCT:NON;
`;
    const diags = lintIrig106(src);
    assert.ok(diags.some((d) => d.code === "IRIG3001"));
  });

  it("emits IRIG3002 on overlapping PCM word/bit allocations", () => {
    const src = `
P-1\\DLN:PCM_1;
P-1\\D1:64000;
P-1\\F1:16;
P-1\\MF1:4;
P-1\\MF2:80;
P-1\\MF4:EB90;
D-1\\DLN:PCM_1;
D-1\\MN-1-1:CHAN_A;
D-1\\WP-1-1:2;
D-1\\MN-1-2:CHAN_B;
D-1\\WP-1-2:2;
C-1\\DCN:CHAN_A;
C-1\\DCT:NON;
C-2\\DCN:CHAN_B;
C-2\\DCT:NON;
`;
    const diags = lintIrig106(src);
    assert.ok(diags.some((d) => d.code === "IRIG3002"));
  });

  it("allows non-overlapping bit-packed fields in the same PCM word", () => {
    const src = `
P-1\\DLN:PCM_1;
P-1\\D1:64000;
P-1\\F1:16;
P-1\\MF1:4;
P-1\\MF2:80;
P-1\\MF4:EB90;
D-1\\DLN:PCM_1;
D-1\\MN-1-1:HIGH_BYTE;
D-1\\WP-1-1:2;
D-1\\WFM-1-1:1111111100000000;
D-1\\MN-1-2:LOW_BYTE;
D-1\\WP-1-2:2;
D-1\\WFM-1-2:0000000011111111;
C-1\\DCN:HIGH_BYTE;
C-1\\DCT:NON;
C-2\\DCN:LOW_BYTE;
C-2\\DCT:NON;
`;
    const diags = lintIrig106(src);
    assert.strictEqual(diags.filter((d) => d.code === "IRIG3002").length, 0);
  });

  it("emits IRIG4001 when D-x measurement references undefined C-x conversion", () => {
    const src = `
P-1\\DLN:PCM_1;
P-1\\D1:64000;
P-1\\F1:16;
P-1\\MF1:4;
P-1\\MF2:80;
P-1\\MF4:EB90;
D-1\\DLN:PCM_1;
D-1\\MN-1-1:MISSING_CONV;
D-1\\WP-1-1:1;
`;
    const diags = lintIrig106(src);
    assert.ok(diags.some((d) => d.code === "IRIG4001"));
  });

  it("emits IRIG5001, IRIG5002, IRIG5003 on PCM format violations", () => {
    const src = `
P-1\\DLN:BAD_PCM;
P-1\\D1:100000;
P-1\\D4:500;
P-1\\F1:2;
P-1\\MF1:10;
P-1\\MF2:100;
`;
    const diags = lintIrig106(src);
    assert.ok(
      diags.some((d) => d.code === "IRIG5001"),
      "Expected IRIG5001 bit-rate mismatch",
    );
    assert.ok(
      diags.some((d) => d.code === "IRIG5002"),
      "Expected IRIG5002 missing sync pattern",
    );
    assert.ok(
      diags.some((d) => d.code === "IRIG5003"),
      "Expected IRIG5003 invalid word length",
    );
  });
});
