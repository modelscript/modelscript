// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import { parseTopas } from "../src/parser/index.js";
import { topasToModelica, topasToScad } from "../src/projections/index.js";

describe("TOPAS Projections to OpenSCAD and Modelica", () => {
  const sampleDoc = parseTopas(`
s:Ge/WaterPhantom/Type = "TsBox"
s:Ge/WaterPhantom/Parent = "World"
s:Ge/WaterPhantom/Material = "G4_WATER"
d:Ge/WaterPhantom/HLX = 150.0 mm
d:Ge/WaterPhantom/HLY = 150.0 mm
d:Ge/WaterPhantom/HLZ = 200.0 mm
d:Ge/WaterPhantom/TransZ = 200.0 mm

s:Ge/BrassCollimator/Type = "TsCylinder"
s:Ge/BrassCollimator/Parent = "World"
s:Ge/BrassCollimator/Material = "Brass"
d:Ge/BrassCollimator/RMin = 15.0 mm
d:Ge/BrassCollimator/RMax = 60.0 mm
d:Ge/BrassCollimator/HL = 25.0 mm

s:So/ProtonBeam/Type = "Beam"
s:So/ProtonBeam/BeamParticle = "proton"
d:So/ProtonBeam/BeamEnergy = 150.0 MeV
u:So/ProtonBeam/BeamEnergySpread = 0.5
`);

  it("projects TOPAS geometry components to OpenSCAD (.scad) CSG code", () => {
    const scad = topasToScad(sampleDoc);
    assert(scad.includes("module Ge_WaterPhantom()"));
    assert(scad.includes("cube([300, 300, 400], center = true);"));
    assert(scad.includes("module Ge_BrassCollimator()"));
    assert(scad.includes("difference()"));
    assert(scad.includes("cylinder(h = 50, r = 60"));
  });

  it("projects TOPAS setup and Bragg peak equations to Modelica 3.x (.mo)", () => {
    const mo = topasToModelica(sampleDoc, "ProtonNozzleSim");
    assert(mo.includes("model ProtonNozzleSim"));
    assert(mo.includes('parameter Real WaterPhantom_HLZ(unit="mm") = 200;'));
    assert(mo.includes('parameter Real ProtonBeam_BeamEnergy(unit="MeV") = 150;'));
    assert(mo.includes("ProtonBeam_BraggRange = ProtonBeam_Alpha * (ProtonBeam_BeamEnergy ^ ProtonBeam_ExponentP);"));
    assert(mo.includes("end ProtonNozzleSim;"));
  });
});
