// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseTrnsysDeck, trnsysToEnergyPlus, trnsysToModelica } from "../src/index.js";

const DECK = `
VERSION 18
CONSTANTS 1
  AREA = 4.0
SIMULATION 0 24 0.25

UNIT 1 TYPE 15 Weather
PARAMETERS 5
  20.0 5.0 2880.0 6.0 18.0

UNIT 2 TYPE 3 Pump
PARAMETERS 4
  200.0 4.19 180.0 0.05
INPUTS 3
  4,1 0,0 0,0
  20.0 200.0 1.0

UNIT 3 TYPE 1 Collector
PARAMETERS 5
  AREA 4.19 0.75 15.0 0.0
INPUTS 4
  2,1 2,2 1,1 1,2
  20.0 200.0 20.0 0.0

UNIT 4 TYPE 4 Tank
PARAMETERS 6
  0.3 4.19 1000.0 1.5 1.5 2
INPUTS 5
  3,1 3,2 0,0 0,0 1,1
  20.0 0.0 15.0 0.0 20.0
DERIVATIVES 2
  25.0 20.0

UNIT 5 TYPE 56 LivingZone
PARAMETERS 4
  5000.0 250.0 6.0 21.0
INPUTS 4
  1,1 1,2 0,0 0,0
  20.0 0.0 400.0 0.0

END
`;

describe("@modelscript/trnsys — Modelica & EnergyPlus Projections", () => {
  it("projects TRNSYS deck to valid Modelica model code", () => {
    const deck = parseTrnsysDeck(DECK, "SolarBuilding");
    const mo = trnsysToModelica(deck);

    assert.ok(mo.includes("model SolarBuilding"));
    assert.ok(mo.includes("parameter Real AREA = 4;"));
    assert.ok(mo.includes("der(u4_T1)"));
    assert.ok(mo.includes("der(u5_Tzone)"));
    assert.ok(mo.includes("u3_in1 = u2_out1;"));
    assert.ok(mo.includes("end SolarBuilding;"));
  });

  it("projects TRNSYS deck to EnergyPlus IDF objects", () => {
    const deck = parseTrnsysDeck(DECK, "SolarBuilding");
    const idf = trnsysToEnergyPlus(deck);

    assert.ok(idf.includes("Version,"));
    assert.ok(idf.includes("Timestep,"));
    assert.ok(idf.includes("SolarCollector:FlatPlate:Water,"));
    assert.ok(idf.includes("Pump:ConstantSpeed,"));
    assert.ok(idf.includes("WaterHeater:Stratified,"));
    assert.ok(idf.includes("Zone,"));
  });
});
