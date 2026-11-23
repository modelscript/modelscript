// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lowerDoe2ToDae } from "../src/dae/index.js";
import { parseDoe2 } from "../src/parser/index.js";

describe("@modelscript/doe2 — Direct Linear-Memory DAE Lowering", () => {
  it("lowers multi-layer envelope, 3R2C wall mass, glazing solar gain, infiltration, and HVAC to DAEBuilder", () => {
    const deck = `
INPUT LOADS UNITS = SI ..
TITLE LINE-1 = "TwoZoneOffice" ..

"CONCRETE" = MATERIAL TYPE = PROPERTIES THICKNESS = 0.20 CONDUCTIVITY = 1.4 DENSITY = 2200 SPECIFIC-HEAT = 840 ..
"INSUL" = MATERIAL TYPE = RESISTANCE RESISTANCE = 2.5 ..
"GYPSUM" = MATERIAL TYPE = PROPERTIES THICKNESS = 0.0127 CONDUCTIVITY = 0.16 DENSITY = 800 SPECIFIC-HEAT = 1090 ..

"EXT-LAYERS" = LAYERS MATERIAL = ("CONCRETE", "INSUL", "GYPSUM") ..
"EXT-WALL" = CONSTRUCTION TYPE = LAYERS LAYERS = "EXT-LAYERS" ..
"LOWE" = GLASS-TYPE GLASS-CONDUCTANCE = 1.65 SHGC = 0.42 ..

"SOUTH-ZONE" = SPACE
  AREA = 100
  HEIGHT = 3.0
  NUMBER-OF-PEOPLE = 4
  LIGHTING-W/AREA = 10
  AIR-CHANGES/HR = 0.5 ..

"S-WALL" = EXTERIOR-WALL CONSTRUCTION = "EXT-WALL" AREA = 30 ..
"S-WIN" = WINDOW GLASS-TYPE = "LOWE" AREA = 10 ..
"S-ROOF" = ROOF CONSTRUCTION = "EXT-WALL" AREA = 100 ..
"S-SLAB" = UNDERGROUND-WALL CONSTRUCTION = "EXT-WALL" AREA = 100 ..

INPUT SYSTEMS ..
"PSZ-1" = SYSTEM TYPE = PSZ ..
"Z-SOUTH" = ZONE SPACE = "SOUTH-ZONE" DESIGN-HEAT-T = 20 DESIGN-COOL-T = 24 ..
STOP ..
`;
    const doc = parseDoe2(deck);
    const arena = lowerDoe2ToDae(doc);

    assert.ok(arena.getVarCount() >= 7, `Expected >= 7 variables, got ${arena.getVarCount()}`);
    assert.ok(arena.getEqCount() >= 6, `Expected >= 6 equations, got ${arena.getEqCount()}`);

    const varNames = Array.from({ length: arena.getVarCount() }, (_, i) => arena.getVarName(i));
    assert.ok(varNames.includes("T_amb"), "Expected T_amb parameter");
    assert.ok(varNames.includes("T_ground"), "Expected T_ground parameter");
    assert.ok(varNames.includes("I_solar"), "Expected I_solar parameter");
    assert.ok(varNames.includes("U_con_EXT_WALL"), "Expected composite U-value parameter");
    assert.ok(varNames.includes("zone_SOUTH_ZONE_T"), "Expected zone temperature state");
    assert.ok(varNames.includes("wall_SOUTH_ZONE_T"), "Expected 3R2C wall thermal mass state");
    assert.ok(varNames.includes("zone_SOUTH_ZONE_Q_hvac"), "Expected zone HVAC load variable");
  });

  it("lowers purely resistive 1R1C envelope when wall layers have zero thermal mass", () => {
    const deck = `
INPUT LOADS UNITS = SI ..
"R-WALL" = CONSTRUCTION TYPE = U-VALUE U-VALUE = 0.5 ..
"ROOM-1" = SPACE AREA = 50 HEIGHT = 3.0 AIR-CHANGES/HR = 0.4 ..
"W1" = EXTERIOR-WALL CONSTRUCTION = "R-WALL" AREA = 40 ..
STOP ..
`;
    const arena = lowerDoe2ToDae(parseDoe2(deck));
    const varNames = Array.from({ length: arena.getVarCount() }, (_, i) => arena.getVarName(i));
    assert.ok(varNames.includes("zone_ROOM_1_T"));
    assert.ok(!varNames.includes("wall_ROOM_1_T"), "Zero-mass wall should lower as 1R1C without wall mass node");
  });
});
