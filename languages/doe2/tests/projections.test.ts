// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseDoe2 } from "../src/parser/index.js";
import { doe2ToEnergyPlusIdf, doe2ToModelica } from "../src/projections/index.js";

const PROJ_DECK = `
INPUT LOADS ..
TITLE LINE-1 = "ProjectionOffice" ..
"MAT-BRICK" = MATERIAL TYPE = PROPERTIES THICKNESS = 0.3333 CONDUCTIVITY = 0.757 DENSITY = 130 SPECIFIC-HEAT = 0.22 ..
"MAT-R19" = MATERIAL TYPE = RESISTANCE RESISTANCE = 19.0 ..
"LAY-EXT" = LAYERS MATERIAL = ("MAT-BRICK", "MAT-R19") ..
"CON-EXT" = CONSTRUCTION TYPE = LAYERS LAYERS = "LAY-EXT" ..
"GLZ-LOWE" = GLASS-TYPE GLASS-CONDUCTANCE = 0.29 SHADING-COEFF = 0.48 ..
"OFFICE-1" = SPACE AREA = 1000 HEIGHT = 10 NUMBER-OF-PEOPLE = 5 LIGHTING-W/SQFT = 1.0 AIR-CHANGES/HR = 0.5 ..
"SOUTH-WALL" = EXTERIOR-WALL CONSTRUCTION = "CON-EXT" AREA = 400 ..
"SOUTH-WIN" = WINDOW GLASS-TYPE = "GLZ-LOWE" AREA = 100 ..
"SLAB" = UNDERGROUND-WALL CONSTRUCTION = "CON-EXT" AREA = 1000 ..
INPUT SYSTEMS ..
"PSZ-1" = SYSTEM TYPE = PSZ ..
"Z-1" = ZONE SPACE = "OFFICE-1" DESIGN-HEAT-T = 70 DESIGN-COOL-T = 75 ..
STOP ..
`;

describe("@modelscript/doe2 — Projections to EnergyPlus IDF & Modelica", () => {
  it("projects DOE-2 BDL to valid SI-unit EnergyPlus IDF objects", () => {
    const doc = parseDoe2(PROJ_DECK);
    const idf = doe2ToEnergyPlusIdf(doc);

    assert.ok(idf.includes("Building,"), "Expected EnergyPlus Building object");
    assert.ok(idf.includes("ProjectionOffice"), "Expected building title");
    assert.ok(idf.includes("Material,"), "Expected Material object");
    assert.ok(idf.includes("Material:NoMass,"), "Expected Material:NoMass for RESISTANCE material");
    assert.ok(idf.includes("WindowMaterial:SimpleGlazingSystem,"), "Expected SimpleGlazingSystem");
    assert.ok(idf.includes("Construction,"), "Expected Construction object");
    assert.ok(idf.includes("Zone,"), "Expected Zone object");
    assert.ok(idf.includes("BuildingSurface:Detailed,"), "Expected BuildingSurface:Detailed");
    assert.ok(idf.includes("FenestrationSurface:Detailed,"), "Expected FenestrationSurface:Detailed");
    assert.ok(idf.includes("ZoneInfiltration:DesignFlowRate,"), "Expected ZoneInfiltration:DesignFlowRate");
    assert.ok(idf.includes("ZoneHVAC:IdealLoadsAirSystem,"), "Expected IdealLoadsAirSystem");
  });

  it("projects DOE-2 BDL to Modelica 3.x Modelica.Thermal.HeatTransfer network", () => {
    const doc = parseDoe2(PROJ_DECK);
    const mo = doe2ToModelica(doc);

    assert.ok(mo.includes("model ProjectionOffice"), "Expected Modelica model header");
    assert.ok(mo.includes("import Modelica.Thermal.HeatTransfer.Components.*;"));
    assert.ok(mo.includes("HeatCapacitor zone_OFFICE_1"), "Expected zone HeatCapacitor");
    assert.ok(mo.includes("ThermalConductor cond_ext_OFFICE_1"), "Expected exterior ThermalConductor");
    assert.ok(mo.includes("ThermalConductor cond_gnd_OFFICE_1"), "Expected underground ThermalConductor");
    assert.ok(mo.includes("FixedHeatFlow q_int_OFFICE_1"), "Expected internal gain FixedHeatFlow");
    assert.ok(mo.includes("connect(ambSource.port, cond_ext_OFFICE_1.port_a);"));
    assert.ok(mo.includes("end ProjectionOffice;"));
  });
});
