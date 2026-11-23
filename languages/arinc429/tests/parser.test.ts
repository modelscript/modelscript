// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { encodeArinc429Word, formatArinc429Hex, parseArinc429 } from "../src/parser/index.js";

describe("ARINC 429 Schema & Trace Parser", () => {
  it("parses BUS, RATE, LABEL definitions, comments, and timestamped FRAME/WORD entries", () => {
    const altWord = formatArinc429Hex(encodeArinc429Word({ label: "203", value: 35000, resolution: 0.5 }));
    const iasWord = formatArinc429Hex(encodeArinc429Word({ label: "206", value: 280, resolution: 0.00390625 }));

    const source = `
# Commercial Air Data Computer bus
BUS ADC_BUS_1
RATE HIGH
LABEL 203 ALTITUDE ENCODING BNR SDI 0 RANGE 131072 RESOLUTION 0.5 UNITS ft RATE 20 EQUIPMENT ADC
LABEL 206 AIRSPEED ENCODING BNR SDI 0 RANGE 1024 RESOLUTION 0.00390625 UNITS kt RATE 20 EQUIPMENT ADC
FRAME 0.000 WORD ${altWord} # FL350
WORD ${iasWord}
`;
    const doc = parseArinc429(source);
    assert.strictEqual(doc.busName, "ADC_BUS_1");
    assert.strictEqual(doc.rate, "HIGH");
    assert.strictEqual(doc.rateExplicit, true);
    assert.strictEqual(doc.parseErrors.length, 0);
    assert.strictEqual(doc.labels.length, 2);
    assert.strictEqual(doc.labels[0]?.labelOctal, "203");
    assert.strictEqual(doc.labels[0]?.labelValue, 0o203);
    assert.strictEqual(doc.labels[0]?.units, "ft");
    assert.strictEqual(doc.labels[0]?.rateHz, 20);
    assert.strictEqual(doc.frames.length, 2);
    assert.strictEqual(doc.frames[0]?.rawHex, altWord);
    assert.strictEqual(doc.frames[0]?.timestampSec, 0);
    assert.strictEqual(doc.frames[0]?.comment, "FL350");
    assert.strictEqual(doc.frames[1]?.rawHex, iasWord);
  });

  it("records syntax errors for malformed directives and invalid hex words", () => {
    const source = `
BUS BAD_BUS
RATE TURBO
FRAME 0.1 WORD NOTHEX
UNKNOWN_DIRECTIVE 123
`;
    const doc = parseArinc429(source);
    assert.ok(doc.parseErrors.length >= 3);
    assert.ok(doc.parseErrors.some((e) => e.message.includes("Invalid bus RATE")));
    assert.ok(doc.parseErrors.some((e) => e.message.includes("Invalid 32-bit hex word")));
    assert.ok(doc.parseErrors.some((e) => e.message.includes("Unrecognized directive")));
  });
});
