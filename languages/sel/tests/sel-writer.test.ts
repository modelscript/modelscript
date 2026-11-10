// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseSELAscii, parseSELJson } from "../src/parser/sel-parser.js";
import { writeSELAscii, writeSELJson } from "../src/parser/sel-writer.js";
import type { SELRelaySettings } from "../src/types.js";

describe("SEL Relay Settings Serializer & Roundtrip", () => {
  it("serializes SELRelaySettings to ASCII format and roundtrips without data loss", () => {
    const original: SELRelaySettings = {
      relayType: "SEL-411L",
      relayId: "LINE_WEST_411",
      terminalId: "BREAKER_411",
      activeGroup: 1,
      frequencyHz: 60.0,
      phaseRotation: "ABC",
      ratios: {
        ctRatioPhase: 240,
        ctRatioGround: 240,
        ptRatioPhase: 1200,
        ptRatioNeutral: 1200,
      },
      groups: new Map([
        [
          1,
          {
            groupId: 1,
            phaseOvercurrent: {
              inst50P1P: 18.0,
              time51P1P: 4.5,
              curve51P1C: "U3",
              timeDial51P1TD: 3.0,
            },
            distance: {
              zone1Reach: 3.2,
              zone2Reach: 14.5,
            },
            equations: {
              TRIP: "50P1P OR Z1P",
              CLOSE: "!50P1P AND IN101",
            },
          },
        ],
      ]),
      globalEquations: {},
    };

    const asciiText = writeSELAscii(original);
    const roundtripped = parseSELAscii(asciiText);

    assert.equal(roundtripped.relayType, original.relayType);
    assert.equal(roundtripped.relayId, original.relayId);
    assert.equal(roundtripped.terminalId, original.terminalId);

    const g1 = roundtripped.groups.get(1);
    assert.ok(g1);
    assert.equal(g1.phaseOvercurrent?.inst50P1P, 18.0);
    assert.equal(g1.phaseOvercurrent?.time51P1P, 4.5);
    assert.equal(g1.distance?.zone1Reach, 3.2);
    assert.equal(g1.equations["TRIP"], "50P1P OR Z1P");
  });

  it("serializes SELRelaySettings to JSON and roundtrips cleanly", () => {
    const original: SELRelaySettings = {
      relayType: "SEL-751A",
      relayId: "DIST_751",
      terminalId: "SUB_EAST",
      activeGroup: 1,
      frequencyHz: 60.0,
      phaseRotation: "ABC",
      ratios: {
        ctRatioPhase: 120,
        ctRatioGround: 120,
        ptRatioPhase: 60,
        ptRatioNeutral: 60,
      },
      groups: new Map([
        [
          1,
          {
            groupId: 1,
            phaseOvercurrent: {
              inst50P1P: 12.0,
              time51P1P: 3.0,
            },
            equations: {
              OUT101: "TRIP",
            },
          },
        ],
      ]),
      globalEquations: {},
    };

    const jsonStr = writeSELJson(original);
    const parsed = parseSELJson(jsonStr);

    assert.equal(parsed.relayId, "DIST_751");
    assert.equal(parsed.groups.get(1)?.phaseOvercurrent?.inst50P1P, 12.0);
  });
});
