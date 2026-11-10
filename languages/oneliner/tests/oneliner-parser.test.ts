// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseOneLiner, parseOneLinerDxt, parseOneLinerJson } from "../src/parser/oneliner-parser.js";

const SAMPLE_DXT = `[CASE DATA]
BASE_MVA=100.0, FREQ=60.0, TITLE="230kV Regional Interconnection"

[BUS DATA]
// BUS_ID, BUS_NAME, BASE_KV, AREA, ZONE
101, "SUB_NORTH", 230.0, 1, 1
102, "SUB_SOUTH", 230.0, 1, 1
103, "GEN_PLANT", 13.8, 1, 1

[LINE DATA]
// LINE_ID, BUS1, BUS2, CKT, R1, X1, R0, X0, B1, B0, RATING, LENGTH
"LN101-102", 101, 102, "1", 0.008, 0.065, 0.024, 0.195, 0.05, 0.03, 400.0, 32.5
"XF102-103", 102, 103, "T1", 0.001, 0.080, 0.001, 0.080, 0.00, 0.00, 500.0, 0.0

[MUTUAL DATA]
// LINE1, LINE2, R0M, X0M
"LN101-102", "LN101-102B", 0.012, 0.098

[GENERATOR DATA]
// GEN_ID, BUS_ID, MVA, R1_SUB, X1_SUB, R0, X0
"G1", 103, 450.0, 0.002, 0.145, 0.001, 0.065

[RELAY OVERCURRENT]
// RELAY_ID, NAME, BRANCH, BUS, PICKUP, CT_RATIO, TD, CURVE, INST
"OC1", "SEL_51_NORTH", "LN101-102", 101, 800.0, 240.0, 3.0, "IEEE_Very_Inverse", 4800.0

[RELAY DISTANCE]
// RELAY_ID, NAME, BRANCH, BUS, Z1_REACH, Z2_REACH, Z2_DELAY, Z3_REACH, Z3_DELAY
"DIST1", "SEL_21_NORTH", "LN101-102", 101, 5.2, 7.8, 0.35, 12.0, 1.0
`;

const SAMPLE_JSON = JSON.stringify({
  title: "JSON Substation Case",
  baseMva: 100.0,
  frequencyHz: 60.0,
  busses: [{ id: "B1", name: "Bus 1", baseKv: 115.0 }],
  branches: [
    {
      id: "L1",
      bus1: "B1",
      bus2: "B2",
      z1: { r: 0.01, x: 0.1 },
      z0: { r: 0.03, x: 0.3 },
    },
  ],
  mutuals: [],
  generators: [],
  overcurrentRelays: [],
  distanceRelays: [],
});

describe("ASPEN OneLiner Parser", () => {
  it("parses DXT case header, busses, and transmission lines", () => {
    const c = parseOneLinerDxt(SAMPLE_DXT);
    assert.equal(c.title, "230kV Regional Interconnection");
    assert.equal(c.baseMva, 100.0);
    assert.equal(c.frequencyHz, 60.0);

    assert.equal(c.busses.length, 3);
    assert.equal(c.busses[0]!.id, "101");
    assert.equal(c.busses[0]!.name, "SUB_NORTH");
    assert.equal(c.busses[0]!.baseKv, 230.0);

    assert.equal(c.branches.length, 2);
    const ln = c.branches[0]!;
    assert.equal(ln.id, "LN101-102");
    assert.equal(ln.bus1, "101");
    assert.equal(ln.bus2, "102");
    assert.equal(ln.z1.r, 0.008);
    assert.equal(ln.z1.x, 0.065);
    assert.equal(ln.z0.r, 0.024);
    assert.equal(ln.z0.x, 0.195);
    assert.equal(ln.ratingMva, 400.0);
  });

  it("parses zero-sequence mutuals, generators, and protective relays", () => {
    const c = parseOneLinerDxt(SAMPLE_DXT);

    assert.equal(c.mutuals.length, 1);
    assert.equal(c.mutuals[0]!.branch1Id, "LN101-102");
    assert.equal(c.mutuals[0]!.z0m.x, 0.098);

    assert.equal(c.generators.length, 1);
    assert.equal(c.generators[0]!.id, "G1");
    assert.equal(c.generators[0]!.mvaRating, 450.0);
    assert.equal(c.generators[0]!.z1Subtransient.x, 0.145);

    assert.equal(c.overcurrentRelays.length, 1);
    const oc = c.overcurrentRelays[0]!;
    assert.equal(oc.id, "OC1");
    assert.equal(oc.pickupA, 800.0);
    assert.equal(oc.timeDial, 3.0);
    assert.equal(oc.curve, "IEEE_Very_Inverse");
    assert.equal(oc.instantaneousPickupA, 4800.0);

    assert.equal(c.distanceRelays.length, 1);
    const dist = c.distanceRelays[0]!;
    assert.equal(dist.id, "DIST1");
    assert.equal(dist.zone1ReachOhms, 5.2);
    assert.equal(dist.zone2ReachOhms, 7.8);
    assert.equal(dist.zone2DelaySec, 0.35);
  });

  it("parses OneLiner JSON format", () => {
    const c = parseOneLinerJson(SAMPLE_JSON);
    assert.equal(c.title, "JSON Substation Case");
    assert.equal(c.busses.length, 1);
    assert.equal(c.branches.length, 1);
  });

  it("auto-detects format in unified parseOneLiner function", () => {
    const dxt = parseOneLiner(SAMPLE_DXT);
    const json = parseOneLiner(SAMPLE_JSON);
    assert.equal(dxt.busses.length, 3);
    assert.equal(json.busses.length, 1);
  });
});
