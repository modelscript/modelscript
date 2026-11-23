// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseDoe2 } from "../src/parser/index.js";

const SAMPLE_BDL = `
$ Sample DOE-2.1E BDL Building Deck
INPUT LOADS ..
TITLE LINE-1 = "LBNL Office Prototype" ..
RUN-PERIOD 1 1 2024 THRU 12 31 2024 ..
BUILDING-LOCATION LATITUDE = 37.87 LONGITUDE = 122.25 ALTITUDE = 200 TIME-ZONE = 8 ..

"MAT-BRICK" = MATERIAL
  TYPE = PROPERTIES
  THICKNESS = 0.3333
  CONDUCTIVITY = 0.757
  DENSITY = 130
  SPECIFIC-HEAT = 0.22 ..

"MAT-R19" = MATERIAL
  TYPE = RESISTANCE
  RESISTANCE = 19.0 ..

"MAT-GYP" = MATERIAL
  TYPE = PROPERTIES
  THICKNESS = 0.0417
  CONDUCTIVITY = 0.0926
  DENSITY = 50
  SPECIFIC-HEAT = 0.26 ..

"WALL-LAYERS" = LAYERS
  MATERIAL = ("MAT-BRICK", "MAT-R19", "MAT-GYP") ..

"EXT-WALL-CON" = CONSTRUCTION
  TYPE = LAYERS
  LAYERS = "WALL-LAYERS"
  ABSORPTANCE = 0.75 ..

"GLZ-LOWE" = GLASS-TYPE
  TYPE = SHADING-COEFF
  SHADING-COEFF = 0.48
  GLASS-CONDUCTANCE = 0.29
  VIS-TRANS = 0.68 ..

"OCC-DAY" = DAY-SCHEDULE
  TYPE = FRACTION
  (1, 8) (0.0)
  (9, 17) (1.0)
  (18, 24) (0.1) ..

"OCC-WEEK" = WEEK-SCHEDULE
  TYPE = FRACTION
  DAY-SCHEDULES = ("OCC-DAY") ..

"OCC-SCHED" = SCHEDULE
  TYPE = FRACTION
  THRU DEC 31 "OCC-WEEK" ..

"OFFICE-1" = SPACE
  AREA = 1000
  HEIGHT = 10
  TEMPERATURE = 70
  NUMBER-OF-PEOPLE = 5
  LIGHTING-W/SQFT = 1.0
  EQUIPMENT-W/SQFT = 0.5
  AIR-CHANGES/HR = 0.5 ..

"SOUTH-WALL" = EXTERIOR-WALL
  CONSTRUCTION = "EXT-WALL-CON"
  WIDTH = 40
  HEIGHT = 10
  AZIMUTH = 180 ..

"SOUTH-WIN" = WINDOW
  GLASS-TYPE = "GLZ-LOWE"
  WIDTH = 20
  HEIGHT = 5 ..

"MAIN-DOOR" = DOOR
  CONSTRUCTION = "EXT-WALL-CON"
  WIDTH = 3
  HEIGHT = 7 ..

"MAIN-ROOF" = ROOF
  CONSTRUCTION = "EXT-WALL-CON"
  AREA = 1000 ..

"SLAB-EDGE" = UNDERGROUND-WALL
  CONSTRUCTION = "EXT-WALL-CON"
  AREA = 200 ..

COMPUTE LOADS ..

INPUT SYSTEMS ..
"VAV-1" = SYSTEM
  TYPE = VAVS
  COOLING-EIR = 0.28
  FURNACE-HIR = 1.18 ..

"ZONE-1" = ZONE
  TYPE = CONDITIONED
  SPACE = "OFFICE-1"
  DESIGN-HEAT-T = 70
  DESIGN-COOL-T = 75 ..

COMPUTE SYSTEMS ..

INPUT PLANT ..
"CHILLER-1" = PLANT-EQUIPMENT
  TYPE = HERM-CENT-CHLR
  SIZE = 50
  EFFICIENCY = 5.2 ..
COMPUTE PLANT ..

INPUT ECONOMICS ..
COMPUTE ECONOMICS ..
STOP ..
`;

describe("@modelscript/doe2 — BDL Parser", () => {
  it("parses complete DOE-2.1E/2.2 BDL deck across LOADS, SYSTEMS, PLANT, and ECONOMICS", () => {
    const doc = parseDoe2(SAMPLE_BDL, "office.inp");

    assert.equal(doc.parseErrors.length, 0, `Unexpected parse errors: ${JSON.stringify(doc.parseErrors)}`);
    assert.equal(doc.title, "LBNL Office Prototype");
    assert.deepEqual(doc.sections, ["LOADS", "SYSTEMS", "PLANT", "ECONOMICS"]);
    assert.equal(doc.hasCompute, true);
    assert.equal(doc.hasStop, true);

    assert.ok(doc.runPeriod);
    assert.equal(doc.runPeriod.beginMonth, 1);
    assert.equal(doc.runPeriod.endMonth, 12);
    assert.equal(doc.runPeriod.endDay, 31);

    assert.ok(doc.buildingLocation);
    assert.equal(doc.buildingLocation.latitude, 37.87);
    assert.equal(doc.buildingLocation.timeZone, 8);

    assert.equal(doc.materials.length, 3);
    assert.equal(doc.materials[1]?.type, "RESISTANCE");
    assert.equal(doc.materials[1]?.resistance, 19.0);

    assert.equal(doc.layers.length, 1);
    assert.deepEqual(doc.layers[0]?.materials, ["MAT-BRICK", "MAT-R19", "MAT-GYP"]);

    assert.equal(doc.constructions.length, 1);
    assert.equal(doc.constructions[0]?.layersName, "WALL-LAYERS");

    assert.equal(doc.glassTypes.length, 1);
    assert.equal(doc.glassTypes[0]?.glassConductance, 0.29);
    assert.ok(Math.abs((doc.glassTypes[0]?.shgc ?? 0) - 0.48 * 0.87) < 1e-6);

    assert.equal(doc.daySchedules.length, 1);
    assert.equal(doc.daySchedules[0]?.values.length, 24);
    assert.equal(doc.daySchedules[0]?.values[0], 0.0);
    assert.equal(doc.daySchedules[0]?.values[12], 1.0);
    assert.equal(doc.daySchedules[0]?.values[20], 0.1);

    assert.equal(doc.spaces.length, 1);
    assert.equal(doc.spaces[0]?.volume, 10000);
    assert.equal(doc.surfaces.length, 3);
    assert.equal(doc.windows.length, 1);
    assert.equal(doc.windows[0]?.parentSurfaceName, "SOUTH-WALL");
    assert.equal(doc.windows[0]?.area, 100);
    assert.equal(doc.doors.length, 1);
    assert.equal(doc.doors[0]?.area, 21);

    assert.equal(doc.systems.length, 1);
    assert.equal(doc.systems[0]?.type, "VAVS");
    assert.equal(doc.zones.length, 1);
    assert.equal(doc.zones[0]?.spaceName, "OFFICE-1");
    assert.equal(doc.zones[0]?.systemName, "VAV-1");
    assert.equal(doc.plantEquipment.length, 1);
  });

  it("detects missing '..' command terminators and syntax errors", () => {
    const broken = `
INPUT LOADS ..
"MAT-1" = MATERIAL
  TYPE = PROPERTIES
  THICKNESS = 0.5
"MAT-2" = MATERIAL
  TYPE = RESISTANCE
  RESISTANCE = 10 ..
STOP ..
`;
    const doc = parseDoe2(broken);
    assert.ok(
      doc.parseErrors.some((e) => e.code === "DOE1002"),
      "Expected DOE1002 missing '..' terminator",
    );
    assert.equal(doc.materials.length, 2);
  });

  it("supports SI unit override via UNITS = SI or parser option", () => {
    const deck = `
INPUT LOADS UNITS = SI ..
"M1" = MATERIAL TYPE = PROPERTIES THICKNESS = 0.2 CONDUCTIVITY = 1.4 ..
STOP ..
`;
    const doc = parseDoe2(deck);
    assert.equal(doc.units, "SI");

    const doc2 = parseDoe2(`INPUT LOADS .. STOP ..`, undefined, { units: "SI" });
    assert.equal(doc2.units, "SI");
  });
});
