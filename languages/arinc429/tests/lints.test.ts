// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lintArinc429 } from "../src/lints/index.js";
import { encodeArinc429Word, formatArinc429Hex, parseArinc429, reverseBits8 } from "../src/parser/index.js";

describe("ARINC 429 Lints & Diagnostics (A4291001–A4295006)", () => {
  it("reports zero diagnostics on a clean high-speed bus with valid words", () => {
    const w203 = formatArinc429Hex(encodeArinc429Word({ label: "203", value: 25000, resolution: 0.5 }));
    const doc = parseArinc429(`
BUS CLEAN_BUS
RATE HIGH
LABEL 203 ALTITUDE ENCODING BNR SDI 0 RANGE 131072 RESOLUTION 0.5 UNITS ft RATE 20
FRAME 0.000 WORD ${w203}
`);
    const diags = lintArinc429(doc);
    assert.strictEqual(diags.length, 0);
  });

  it("flags syntax error (A4291001), invalid octal label (A4292001), duplicate label (A4292002), invalid SDI (A4295005), and missing bus rate (A4295006)", () => {
    const doc = parseArinc429(`
BUS FAULTY_SCHEMA
LABEL 888 BAD_OCTAL ENCODING BNR
LABEL 203 ALT_A ENCODING BNR SDI 0 RATE 10
LABEL 203 ALT_B ENCODING BNR SDI 0 RATE 10
LABEL 206 IAS ENCODING BNR SDI 5 RATE 10
BOGUS_LINE
`);
    const diags = lintArinc429(doc);
    const codes = new Set(diags.map((d) => d.code));
    assert.ok(codes.has("A4291001"));
    assert.ok(codes.has("A4292001"));
    assert.ok(codes.has("A4292002"));
    assert.ok(codes.has("A4295005"));
    assert.ok(codes.has("A4295006"));
  });

  it("flags parity error (A4293001), invalid BCD nibble (A4293002), SSM FW (A4294001), and SSM NCD (A4294002)", () => {
    const parityErrHex = formatArinc429Hex(encodeArinc429Word({ label: "203", value: 1000, injectParityError: true }));
    const fwHex = formatArinc429Hex(encodeArinc429Word({ label: "203", value: 0, ssm: 0 }));
    const ncdHex = formatArinc429Hex(encodeArinc429Word({ label: "203", value: 0, ssm: 1 }));
    // Construct a BCD word with nibble 0xB in digit 1 and valid odd parity
    const badBcdBase = ((reverseBits8(0o034) & 0xff) | (0x0000b << 10)) >>> 0;
    const badBcdHex = formatArinc429Hex(badBcdBase);

    const doc = parseArinc429(`
BUS FAULT_TRACE
RATE HIGH
LABEL 203 ALTITUDE ENCODING BNR SDI 0 RANGE 131072 RESOLUTION 0.5 UNITS ft RATE 20
LABEL 034 FREQ ENCODING BCD SDI 0 RESOLUTION 0.01 UNITS MHz RATE 5
FRAME 0.00 WORD ${parityErrHex}
FRAME 0.05 WORD ${fwHex}
FRAME 0.10 WORD ${ncdHex}
FRAME 0.15 WORD ${badBcdHex}
`);
    const diags = lintArinc429(doc);
    const codes = new Set(diags.map((d) => d.code));
    assert.ok(codes.has("A4293001"), "Expected parity error A4293001");
    assert.ok(codes.has("A4293002"), "Expected invalid BCD nibble A4293002");
    assert.ok(codes.has("A4294001"), "Expected SSM Failure Warning A4294001");
    assert.ok(codes.has("A4294002"), "Expected SSM NCD A4294002");
  });

  it("flags bus bandwidth > 100% (A4295001) at 12.5 kbps low-speed and > 80% warning (A4295002)", () => {
    // At 12.5 kbps, max words/s = 12500 / 36 = 347.222 words/s
    const overloaded = parseArinc429(`
BUS OVERLOADED_LOW
RATE LOW
LABEL 203 ALTITUDE ENCODING BNR RATE 200
LABEL 206 AIRSPEED ENCODING BNR RATE 200
`);
    const diagsOver = lintArinc429(overloaded);
    assert.ok(diagsOver.some((d) => d.code === "A4295001"));

    // 300 words/s at LOW = 86.4% utilization -> warning A4295002
    const highLoad = parseArinc429(`
BUS HIGH_LOAD_LOW
RATE LOW
LABEL 203 ALTITUDE ENCODING BNR RATE 300
`);
    const diagsHigh = lintArinc429(highLoad);
    assert.ok(diagsHigh.some((d) => d.code === "A4295002"));
  });
});
