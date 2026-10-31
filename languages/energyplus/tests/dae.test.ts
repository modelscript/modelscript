// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import { lowerEnergyPlusToDae } from "../src/dae/index.js";
import { parseIdf } from "../src/parser/index.js";
import { simulateEnergyPlusDesignDay } from "../src/solver/index.js";

const SAMPLE_BUILDING_IDF = `
Building, HouseModel, 0, Suburbs;
Zone, LivingArea, 0, 0, 0, 0, 1, 1, 3.0, 120.0;
Zone, SleepingArea, 0, 6, 0, 0, 1, 1, 3.0, 90.0;

Material, Brick, MediumRough, 0.15, 0.8, 1900, 840;
Construction, BrickWall, Brick;
Construction, DoublePaneWin, Brick;

BuildingSurface:Detailed, LivingWall, Wall, BrickWall, LivingArea, Outdoors, , SunExposed, WindExposed, 0.5, 4, 0,0,3, 0,0,0, 6,0,0, 6,0,3;
BuildingSurface:Detailed, SleepingWall, Wall, BrickWall, SleepingArea, Outdoors, , SunExposed, WindExposed, 0.5, 4, 6,0,3, 6,0,0, 11,0,0, 11,0,3;
FenestrationSurface:Detailed, SouthWindow, Window, DoublePaneWin, LivingWall, , 0.5, , , 4, 1,0,2.5, 1,0,0.5, 4,0,0.5, 4,0,2.5;

People, LivingPeople, LivingArea, OccSched, People, 2;
Lights, LivingLights, LivingArea, LightSched, LightingLevel, 150.0;
ElectricEquipment, LivingTV, LivingArea, EquipSched, EquipmentLevel, 200.0;
ZoneInfiltration:DesignFlowRate, LivingInf, LivingArea, InfSched, Flow/Zone, 0.01;
ZoneHVAC:IdealLoadsAirSystem, LivingHVAC, LivingArea;
`;

describe("EnergyPlus Linear DAE Lowering", () => {
  it("lowers multi-zone building thermal models with 3R2C wall thermal mass into DAEBuilder arena", () => {
    const doc = parseIdf(SAMPLE_BUILDING_IDF);
    const arena = lowerEnergyPlusToDae(doc);

    // Checks that variables and equations are created for both zones, 3R2C wall nodes, and ambient parameters
    assert(arena.getVarCount() >= 8, `Expected at least 8 variables, got ${arena.getVarCount()}`);
    assert(arena.getEqCount() >= 8, `Expected at least 8 equations, got ${arena.getEqCount()}`);

    const varNames = arena.variables().map((v) => v.name);
    assert(varNames.includes("T_amb"), "Must include ambient temperature T_amb");
    assert(varNames.includes("T_ground"), "Must include ground temperature T_ground");
    assert(varNames.includes("zone_LivingArea_T"), "Must include zone LivingArea temperature");
    assert(varNames.includes("zone_SleepingArea_T"), "Must include zone SleepingArea temperature");
    assert(varNames.includes("T_wall_LivingArea"), "Must include 3R2C wall thermal mass node T_wall_LivingArea");
    assert(varNames.includes("T_wall_SleepingArea"), "Must include 3R2C wall thermal mass node T_wall_SleepingArea");
    assert(varNames.includes("zone_LivingArea_Q_hvac"), "Must include HVAC output variable");
  });

  it("handles Material:NoMass thermalResistance, Adiabatic surfaces, and Interzone Surface coupling", () => {
    const idf = `
Building, TwoZoneNoMass, 0, Suburbs;
Zone, ZoneA, 0, 0, 0, 0, 1, 1, 3.0, 100.0;
Zone, ZoneB, 0, 5, 0, 0, 1, 1, 3.0, 100.0;
Material:NoMass, InsulationR2, Rough, 2.5, 0.9, 0.7, 0.7;
Construction, R2Const, InsulationR2;
BuildingSurface:Detailed, AdiabaticWallA, Wall, R2Const, ZoneA, Adiabatic, , NoSun, NoWind, 0.0, 4, 0,0,3, 0,0,0, 5,0,0, 5,5,3;
BuildingSurface:Detailed, PartAB, Wall, R2Const, ZoneA, Surface, PartBA, NoSun, NoWind, 0.0, 4, 0,5,3, 0,5,0, 5,5,0, 5,5,3;
BuildingSurface:Detailed, PartBA, Wall, R2Const, ZoneB, Surface, PartAB, NoSun, NoWind, 0.0, 4, 5,5,3, 5,5,0, 0,5,0, 0,5,3;
`;
    const doc = parseIdf(idf);
    const arena = lowerEnergyPlusToDae(doc);
    assert.strictEqual(arena.getVarCount(), 6);
    assert.strictEqual(arena.getEqCount(), 8); // 4 initial + 4 continuous equations
  });

  it("simulates a 24-hour diurnal design day with window solar SHGC gains and IdealLoadsAirSystem deadband", () => {
    const doc = parseIdf(SAMPLE_BUILDING_IDF);
    const sim = simulateEnergyPlusDesignDay(doc, {
      durationHours: 24,
      timeStepSeconds: 300,
      outdoorMeanTempC: 22.0,
      outdoorSwingTempC: 16.0,
      peakSolarIrradianceWPerM2: 800.0,
      initialZoneTempC: 21.0,
    });

    assert.strictEqual(sim.buildingName, "HouseModel");
    assert.strictEqual(sim.zoneNames.length, 2);
    assert(sim.trajectory.length > 24);

    // Midday step (12:00) must have positive solar irradiance and transmitted window solar gain in LivingArea
    const noonStep = sim.trajectory.find((s) => Math.abs(s.timeHours - 12.0) < 0.05);
    assert(noonStep, "Expected 12:00 step in trajectory");
    assert(noonStep.solarIrradianceWPerM2 > 700, "Expected high solar irradiance at solar noon");
    assert(
      (noonStep.solarWindowGainsW["LivingArea"] ?? 0) > 2000,
      "Expected positive window SHGC solar heat gain in LivingArea at noon",
    );

    // LivingArea has IdealLoadsAirSystem so its temperature stays near the [20, 24] C thermostat deadband
    // and exercises cooling during peak afternoon solar + internal gains
    assert(
      (sim.peakCoolingLoadW["LivingArea"] ?? 0) > 0,
      "Expected active HVAC cooling load in LivingArea during sunny afternoon",
    );
    assert(
      (sim.maxZoneTempsC["LivingArea"] ?? 100) < 26.5,
      `Expected LivingArea temperature controlled by HVAC, got max ${sim.maxZoneTempsC["LivingArea"]}`,
    );
  });
});
