// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseSELAscii, parseSELJson, parseSELSettings } from "../src/parser/sel-parser.js";

const SAMPLE_SEL_ASCII = `
// ModelScript SEL Test Case
=>>SHOW SET
"FID=SEL-411L-R100-V0-Z001001-D20240101"
RID="SUB_WEST_LINE1"
TID="SEL-411L FEEDER 1"
ACTIVE_GROUP=1
NFREQ=60.0
PHROT=ABC
CTRH=240
CTRL=240
PTR=1200
PTRN=1200

GROUP 1
50P1P=15.00
50P2P=30.00
51P1P=5.00
51P1C=U3
51P1TD=2.50
50G1P=3.00
51G1P=1.00
51G1C=U3
51G1TD=1.50
Z1P=2.50
Z2P=10.00
Z3P=25.00
Z1D=0
Z2D=20
Z3D=60
27P=55.0
59P=130.0
81U=58.5
81O=61.5
TRIP=50P1P OR 51P1 OR Z1P OR SV01
CLOSE=!51P1 AND 27P AND IN101
SV01=50G1P AND IN102
OUT101=TRIP
OUT102=CLOSE
`;

describe("SEL Relay Settings Parser", () => {
  it("parses ASCII relay metadata, ratios, and identification", () => {
    const settings = parseSELAscii(SAMPLE_SEL_ASCII);
    assert.equal(settings.relayType, "SEL-411L");
    assert.equal(settings.relayId, "SUB_WEST_LINE1");
    assert.equal(settings.terminalId, "SEL-411L FEEDER 1");
    assert.equal(settings.activeGroup, 1);
    assert.equal(settings.frequencyHz, 60.0);
    assert.equal(settings.phaseRotation, "ABC");
    assert.equal(settings.ratios.ctRatioPhase, 240);
    assert.equal(settings.ratios.ptRatioPhase, 1200);
  });

  it("parses protection elements and SELogic equations for Group 1", () => {
    const settings = parseSELAscii(SAMPLE_SEL_ASCII);
    const grp = settings.groups.get(1);
    assert.ok(grp);

    assert.equal(grp.phaseOvercurrent?.inst50P1P, 15.0);
    assert.equal(grp.phaseOvercurrent?.time51P1P, 5.0);
    assert.equal(grp.phaseOvercurrent?.curve51P1C, "U3");
    assert.equal(grp.phaseOvercurrent?.timeDial51P1TD, 2.5);

    assert.equal(grp.distance?.zone1Reach, 2.5);
    assert.equal(grp.distance?.zone2Reach, 10.0);
    assert.equal(grp.distance?.zone3Reach, 25.0);

    assert.equal(grp.voltage?.underVoltage27P, 55.0);
    assert.equal(grp.frequency?.underFreq81U, 58.5);

    assert.equal(grp.equations["TRIP"], "50P1P OR 51P1 OR Z1P OR SV01");
    assert.equal(grp.equations["CLOSE"], "!51P1 AND 27P AND IN101");
    assert.equal(grp.equations["SV01"], "50G1P AND IN102");
    assert.equal(grp.equations["OUT101"], "TRIP");
  });

  it("parses JSON formatted SEL settings (.rdb, .json)", () => {
    const jsonStr = JSON.stringify({
      relayType: "SEL-751A",
      relayId: "FEEDER_751",
      terminalId: "BREAKER_52",
      activeGroup: 1,
      frequencyHz: 50.0,
      phaseRotation: "ABC",
      ratios: {
        ctRatioPhase: 100,
        ctRatioGround: 100,
        ptRatioPhase: 600,
        ptRatioNeutral: 600,
      },
      groups: {
        "1": {
          groupId: 1,
          phaseOvercurrent: {
            inst50P1P: 10.0,
            time51P1P: 2.0,
          },
          equations: {
            TRIP: "50P1P OR 51P1P",
          },
        },
      },
      globalEquations: {},
    });

    const settings = parseSELJson(jsonStr);
    assert.equal(settings.relayType, "SEL-751A");
    assert.equal(settings.relayId, "FEEDER_751");
    assert.equal(settings.frequencyHz, 50.0);
    assert.equal(settings.groups.get(1)?.phaseOvercurrent?.inst50P1P, 10.0);
  });

  it("auto-detects format in unified parseSELSettings", () => {
    const asciiRes = parseSELSettings(SAMPLE_SEL_ASCII);
    assert.equal(asciiRes.relayId, "SUB_WEST_LINE1");

    const jsonRes = parseSELSettings(JSON.stringify({ relayId: "JSON_RELAY" }));
    assert.equal(jsonRes.relayId, "JSON_RELAY");
  });
});
