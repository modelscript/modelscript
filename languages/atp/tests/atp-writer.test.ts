// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseAtp } from "../src/parser/atp-parser.js";
import { writeAtp } from "../src/parser/atp-writer.js";
import type { AtpCase } from "../src/types.js";

describe("ATP-EMTP Deck Serializer", () => {
  it("serializes AtpCase into standard card-deck text and roundtrips", () => {
    const atpCase: AtpCase = {
      title: "Roundtrip 230kV Feeder Test",
      control: {
        deltaTSec: 2.0e-5,
        tMaxSec: 0.08,
      },
      branches: [
        {
          node1: "B1",
          node2: "B2",
          rOhms: 1.25,
          lMh: 18.4,
          cUf: 0.12,
        },
      ],
      switches: [
        {
          node1: "B2",
          node2: "B3",
          tCloseSec: 0.02,
          tOpenSec: 0.06,
        },
      ],
      sources: [
        {
          node: "B1",
          typeCode: 14,
          amplitude: 187793.0,
          frequencyHz: 60.0,
          phaseDeg: 30.0,
        },
      ],
      outputNodes: ["B1", "B2", "B3"],
    };

    const text = writeAtp(atpCase);
    assert.ok(text.includes("BEGIN NEW DATA CASE"));
    assert.ok(text.includes("Roundtrip 230kV Feeder Test"));
    assert.ok(text.includes("/BRANCH"));
    assert.ok(text.includes("/SWITCH"));
    assert.ok(text.includes("/SOURCE"));
    assert.ok(text.includes("/OUTPUT"));

    // Roundtrip parse check
    const parsed = parseAtp(text);
    assert.equal(parsed.title, "Roundtrip 230kV Feeder Test");
    assert.equal(parsed.branches.length, 1);
    assert.equal(parsed.branches[0]!.node1, "B1");
    assert.equal(parsed.branches[0]!.node2, "B2");
    assert.equal(parsed.branches[0]!.rOhms, 1.25);
    assert.equal(parsed.switches.length, 1);
    assert.equal(parsed.sources.length, 1);
    assert.equal(parsed.outputNodes.length, 3);
  });
});
