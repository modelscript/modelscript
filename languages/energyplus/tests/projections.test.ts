// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import { parseIdf } from "../src/parser/index.js";
import { energyPlusToModelica } from "../src/projections/index.js";

const SAMPLE_IDF = `
Building, Office1, 0, Suburbs;
Zone, RoomA, 0, 0, 0, 0, 1, 1, 3.0, 100.0;
Material, Plaster, Smooth, 0.1, 0.5, 1600, 1000;
Construction, PlasterConst, Plaster;
BuildingSurface:Detailed, ExtWallA, Wall, PlasterConst, RoomA, Outdoors, , SunExposed, WindExposed, 0.5, 4, 0,0,3, 0,0,0, 5,0,0, 5,0,3;
Lights, RoomALights, RoomA, , LightingLevel, 100.0;
`;

describe("EnergyPlus Projections to Modelica", () => {
  it("generates Modelica.Thermal multi-zone network model", () => {
    const doc = parseIdf(SAMPLE_IDF);
    const mo = energyPlusToModelica(doc);

    assert(mo.includes("model Office1"));
    assert(mo.includes("HeatCapacitor zone_RoomA"));
    assert(mo.includes("FixedHeatFlow q_int_RoomA"));
    assert(mo.includes("ThermalConductor wall_ExtWallA"));
    assert(mo.includes("connect(wall_ExtWallA.port_a, zone_RoomA.port);"));
    assert(mo.includes("connect(wall_ExtWallA.port_b, ambSource.port);"));
    assert(mo.includes("end Office1;"));
  });
});
