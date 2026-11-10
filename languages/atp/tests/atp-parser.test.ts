// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseAtp } from "../src/parser/atp-parser.js";

const SAMPLE_ATP = `BEGIN NEW DATA CASE
C 500kV Substation Capacitor Switching Case
  1.0E-5  0.05
/BRANCH
BUS500  BUS230  2.5000  45.0000  0.0500
BUS230  GND     0.5000  0.0000   12.5000
BLANK RECORD
/SWITCH
BUS500  CAP_BUS 0.010000    0.040000
BLANK RECORD
/SOURCE
14 BUS500  408248.00   60.00    0.00
BLANK RECORD
/OUTPUT
BUS500 BUS230 CAP_BUS
BLANK RECORD
`;

describe("ATP-EMTP Deck Parser", () => {
  it("parses simulation control card and case title", () => {
    const atpCase = parseAtp(SAMPLE_ATP);
    assert.equal(atpCase.title, "500kV Substation Capacitor Switching Case");
    assert.equal(atpCase.control.deltaTSec, 1.0e-5);
    assert.equal(atpCase.control.tMaxSec, 0.05);
  });

  it("parses RLC branches", () => {
    const atpCase = parseAtp(SAMPLE_ATP);
    assert.equal(atpCase.branches.length, 2);

    const b1 = atpCase.branches[0]!;
    assert.equal(b1.node1, "BUS500");
    assert.equal(b1.node2, "BUS230");
    assert.equal(b1.rOhms, 2.5);
    assert.equal(b1.lMh, 45.0);
    assert.equal(b1.cUf, 0.05);

    const b2 = atpCase.branches[1]!;
    assert.equal(b2.node1, "BUS230");
    assert.equal(b2.node2, "GND");
    assert.equal(b2.cUf, 12.5);
  });

  it("parses time-controlled switches and AC sources", () => {
    const atpCase = parseAtp(SAMPLE_ATP);
    assert.equal(atpCase.switches.length, 1);
    const sw = atpCase.switches[0]!;
    assert.equal(sw.node1, "BUS500");
    assert.equal(sw.node2, "CAP_BUS");
    assert.equal(sw.tCloseSec, 0.01);
    assert.equal(sw.tOpenSec, 0.04);

    assert.equal(atpCase.sources.length, 1);
    const src = atpCase.sources[0]!;
    assert.equal(src.node, "BUS500");
    assert.equal(src.typeCode, 14);
    assert.equal(src.amplitude, 408248.0);
    assert.equal(src.frequencyHz, 60.0);
  });

  it("parses monitored output nodes", () => {
    const atpCase = parseAtp(SAMPLE_ATP);
    assert.equal(atpCase.outputNodes.length, 3);
    assert.ok(atpCase.outputNodes.includes("BUS500"));
    assert.ok(atpCase.outputNodes.includes("BUS230"));
    assert.ok(atpCase.outputNodes.includes("CAP_BUS"));
  });
});
