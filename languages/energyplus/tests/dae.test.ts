// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import { lowerEnergyPlusToDae } from "../src/dae/index.js";
import { parseIdf } from "../src/parser/index.js";

const SAMPLE_BUILDING_IDF = `
Building, HouseModel, 0, Suburbs;
Zone, LivingArea, 0, 0, 0, 0, 1, 1, 3.0, 120.0;
Zone, SleepingArea, 0, 6, 0, 0, 1, 1, 3.0, 90.0;

Material, Brick, MediumRough, 0.15, 0.8, 1900, 840;
Construction, BrickWall, Brick;

BuildingSurface:Detailed, LivingWall, Wall, BrickWall, LivingArea, Outdoors, , SunExposed, WindExposed, 0.5, 4, 0,0,3, 0,0,0, 6,0,0, 6,0,3;
BuildingSurface:Detailed, SleepingWall, Wall, BrickWall, SleepingArea, Outdoors, , SunExposed, WindExposed, 0.5, 4, 6,0,3, 6,0,0, 11,0,0, 11,0,3;

People, LivingPeople, LivingArea, OccSched, People, 2;
Lights, LivingLights, LivingArea, LightSched, LightingLevel, 150.0;
ElectricEquipment, LivingTV, LivingArea, EquipSched, EquipmentLevel, 200.0;
ZoneInfiltration:DesignFlowRate, LivingInf, LivingArea, InfSched, Flow/Zone, 0.01;
ZoneHVAC:IdealLoadsAirSystem, LivingHVAC, LivingArea;
`;

describe("EnergyPlus Linear DAE Lowering", () => {
  it("lowers multi-zone building thermal models into DAEBuilder arena", () => {
    const doc = parseIdf(SAMPLE_BUILDING_IDF);
    const arena = lowerEnergyPlusToDae(doc);

    // Checks that variables and equations are created for both zones and ambient parameters
    assert(arena.getVarCount() >= 6, `Expected at least 6 variables, got ${arena.getVarCount()}`);
    assert(arena.getEqCount() >= 6, `Expected at least 6 equations, got ${arena.getEqCount()}`);

    const varNames = arena.variables().map((v) => v.name);
    assert(varNames.includes("T_amb"), "Must include ambient temperature T_amb");
    assert(varNames.includes("T_ground"), "Must include ground temperature T_ground");
    assert(varNames.includes("zone_LivingArea_T"), "Must include zone LivingArea temperature");
    assert(varNames.includes("zone_SleepingArea_T"), "Must include zone SleepingArea temperature");
    assert(varNames.includes("zone_LivingArea_Q_hvac"), "Must include HVAC output variable");
  });
});
