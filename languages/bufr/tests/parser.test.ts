// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { expandBufrDescriptors, parseBufr, parseBufrDescriptor, parseBufrText } from "../src/index.js";

const SAMPLE_SYNOP = `
# WMO BUFR Edition 4 SYNOP Surface Report
BUFR EDITION 4 NAME OAKLAND_SYNOP
SECTION 0
  LENGTH = 0
SECTION 1
  MASTER_TABLE = 0
  CENTRE = 7
  SUBCENTRE = 0
  CATEGORY = 0
  VERSION = 38
  YEAR = 2026
  MONTH = 6
  DAY = 15
  HOUR = 12
  MINUTE = 0
  SECOND = 0
SECTION 3
  SUBSETS = 1
  OBSERVED = true
  COMPRESSED = false
  DESCRIPTORS:
    3-07-080
SECTION 4
  SUBSET 1:
    0-01-001 = 72
    0-01-002 = 493
    0-04-001 = 2026
    0-04-002 = 6
    0-04-003 = 15
    0-04-004 = 12
    0-04-005 = 0
    0-05-001 = 37.75000
    0-06-001 = -122.22000
    0-07-001 = 3
    0-10-004 = 101320
    0-10-051 = 101350
    0-12-101 = 291.15
    0-12-103 = 285.15
    0-13-003 = 68
    0-11-001 = 270
    0-11-002 = 6.5
    0-13-011 = 0.0
SECTION 5
7777
`;

describe("@modelscript/bufr Text Parser", () => {
  it("parses BUFR Edition 4 sections, descriptors, and subsets", () => {
    const msg = parseBufrText(SAMPLE_SYNOP);
    assert.equal(msg.name, "OAKLAND_SYNOP");
    assert.equal(msg.section0.edition, 4);
    assert.equal(msg.hasMagicHeader, true);
    assert.equal(msg.hasEndMarker, true);
    assert.equal(msg.syntaxErrors.length, 0);
    assert.equal(msg.section1.originatingCentre, 7);
    assert.equal(msg.section1.year, 2026);
    assert.equal(msg.section3.descriptors.length, 1);
    assert.equal(msg.section3.descriptors[0]?.code, "3-07-080");
    assert.equal(msg.subsets.length, 1);
    assert.equal(msg.subsets[0]?.values.length, 18);
  });

  it("parses custom TABLE_B and TABLE_D definitions and expands them", () => {
    const src = `
BUFR EDITION 4
TABLE_B
  0-12-200 name="Custom Soil Temp" unit="K" scale=2 ref=0 width=16
TABLE_D
  3-20-001 = [0-01-001, 0-12-200] "Soil station sequence"
SECTION 3
  SUBSETS = 1
  3-20-001
SECTION 4
  SUBSET 1:
    0-01-001 = 72
    0-12-200 = 289.45
7777
`;
    const msg = parseBufr(src);
    assert.equal(msg.customTableB.has("0-12-200"), true);
    assert.equal(msg.customTableD.has("3-20-001"), true);

    const expanded = expandBufrDescriptors(msg.section3.descriptors, {
      customTableB: msg.customTableB,
      customTableD: msg.customTableD,
    });
    assert.equal(expanded.unknownDescriptors.length, 0);
    assert.equal(expanded.elements.length, 2);
    assert.equal(expanded.elements[1]?.descriptor.code, "0-12-200");
    assert.equal(expanded.elements[1]?.tableB?.name, "Custom Soil Temp");
  });

  it("parses both hyphenated F-X-Y and 6-digit FXXYYY descriptors", () => {
    const d1 = parseBufrDescriptor("0-12-101");
    const d2 = parseBufrDescriptor("012101");
    assert.ok(d1);
    assert.ok(d2);
    assert.equal(d1.code, "0-12-101");
    assert.equal(d2.code, "0-12-101");
    assert.equal(d1.f, 0);
    assert.equal(d1.x, 12);
    assert.equal(d1.y, 101);
  });
});
