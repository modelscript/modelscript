// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseOneLiner } from "../src/parser/oneliner-parser.js";
import { writeOneLinerDxt } from "../src/parser/oneliner-writer.js";
import type { OneLinerCase } from "../src/types.js";

describe("ASPEN OneLiner Serializer & Roundtrip", () => {
  it("serializes OneLinerCase into DXT text and roundtrips without data loss", () => {
    const c: OneLinerCase = {
      title: "Roundtrip Transmission System",
      baseMva: 100.0,
      frequencyHz: 60.0,
      busses: [
        { id: "B1", name: "Bus One", baseKv: 138.0, area: 1, zone: 2 },
        { id: "B2", name: "Bus Two", baseKv: 138.0, area: 1, zone: 2 },
      ],
      branches: [
        {
          id: "LN1-2",
          bus1: "B1",
          bus2: "B2",
          circuitId: "1",
          z1: { r: 0.015, x: 0.095 },
          z0: { r: 0.045, x: 0.285 },
          b1: 0.02,
          b0: 0.01,
          ratingMva: 250.0,
          lengthMiles: 15.2,
        },
      ],
      mutuals: [
        {
          branch1Id: "LN1-2",
          branch2Id: "LN1-2B",
          z0m: { r: 0.02, x: 0.12 },
        },
      ],
      generators: [
        {
          id: "GEN1",
          busId: "B1",
          mvaRating: 200.0,
          z1Subtransient: { r: 0.005, x: 0.12 },
          z0: { r: 0.002, x: 0.05 },
        },
      ],
      overcurrentRelays: [
        {
          id: "OC1",
          name: "Line Overcurrent",
          branchId: "LN1-2",
          busId: "B1",
          pickupA: 500.0,
          ctRatio: 120.0,
          timeDial: 2.5,
          curve: "IEEE_Very_Inverse",
          instantaneousPickupA: 3500.0,
        },
      ],
      distanceRelays: [
        {
          id: "DIST1",
          name: "Line Distance",
          branchId: "LN1-2",
          busId: "B1",
          zone1ReachOhms: 3.5,
          zone2ReachOhms: 5.2,
          zone2DelaySec: 0.35,
          zone3ReachOhms: 8.0,
          zone3DelaySec: 1.0,
        },
      ],
    };

    const text = writeOneLinerDxt(c);
    assert.ok(text.includes("[CASE DATA]"));
    assert.ok(text.includes("Roundtrip Transmission System"));
    assert.ok(text.includes("[BUS DATA]"));
    assert.ok(text.includes("[LINE DATA]"));
    assert.ok(text.includes("[MUTUAL DATA]"));
    assert.ok(text.includes("[GENERATOR DATA]"));
    assert.ok(text.includes("[RELAY OVERCURRENT]"));
    assert.ok(text.includes("[RELAY DISTANCE]"));

    // Roundtrip verification
    const parsed = parseOneLiner(text);
    assert.equal(parsed.title, "Roundtrip Transmission System");
    assert.equal(parsed.busses.length, 2);
    assert.equal(parsed.busses[0]!.id, "B1");
    assert.equal(parsed.branches.length, 1);
    assert.equal(parsed.branches[0]!.id, "LN1-2");
    assert.equal(parsed.branches[0]!.z1.r, 0.015);
    assert.equal(parsed.mutuals.length, 1);
    assert.equal(parsed.generators.length, 1);
    assert.equal(parsed.overcurrentRelays.length, 1);
    assert.equal(parsed.overcurrentRelays[0]!.pickupA, 500.0);
    assert.equal(parsed.distanceRelays.length, 1);
    assert.equal(parsed.distanceRelays[0]!.zone1ReachOhms, 3.5);
  });
});
