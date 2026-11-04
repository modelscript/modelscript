// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import { lintTopasDocument, TopasErrorCode } from "../src/lints/index.js";
import { parseTopas } from "../src/parser/index.js";

describe("TOPAS / GATE Semantic Linter (M9601–M9610)", () => {
  it("passes a valid proton therapy water phantom configuration with zero diagnostics", () => {
    const validTopas = `
s:Ge/WaterPhantom/Type = "TsBox"
s:Ge/WaterPhantom/Parent = "World"
s:Ge/WaterPhantom/Material = "G4_WATER"
d:Ge/WaterPhantom/HLX = 150.0 mm
d:Ge/WaterPhantom/HLY = 150.0 mm
d:Ge/WaterPhantom/HLZ = 200.0 mm

s:Ge/TumorTarget/Type = "TsSphere"
s:Ge/TumorTarget/Parent = "WaterPhantom"
s:Ge/TumorTarget/Material = "G4_TISSUE_SOFT_ICRP"
d:Ge/TumorTarget/RMax = 25.0 mm
d:Ge/TumorTarget/TransZ = 50.0 mm

s:So/ProtonBeam/Type = "Beam"
s:So/ProtonBeam/BeamParticle = "proton"
d:So/ProtonBeam/BeamEnergy = 160.0 MeV
u:So/ProtonBeam/BeamEnergySpread = 0.6
i:So/ProtonBeam/NumberOfHistoriesInRun = 10000

s:Sc/DoseGrid/Quantity = "DoseToWater"
s:Sc/DoseGrid/Component = "WaterPhantom"
b:Sc/DoseGrid/OutputToConsole = "True"
`;
    const doc = parseTopas(validTopas, "file:///valid.topas");
    const diags = lintTopasDocument(doc);
    assert.strictEqual(diags.length, 0);
  });

  it("detects M9601 (topas-type-prefix-mismatch), M9609 (topas-vector-length-mismatch), and M9610 (topas-duplicate-parameter-assignment)", () => {
    const text = `
d:Ge/Box/HLX = 50.0
i:So/Beam/NumberOfHistoriesInRun = 10.5
b:Sc/Dose/OutputToConsole = "Maybe"
dv:Ge/Filter/ZPoints = 4 10.0 20.0 mm
s:Ge/Box/Material = "G4_WATER"
s:Ge/Box/Material = "G4_AIR"
`;
    const doc = parseTopas(text);
    const diags = lintTopasDocument(doc);
    const codes = new Set(diags.map((d) => d.code));
    assert(codes.has(TopasErrorCode.TYPE_PREFIX_MISMATCH.code));
    assert(codes.has(TopasErrorCode.VECTOR_LENGTH_MISMATCH.code));
    assert(codes.has(TopasErrorCode.DUPLICATE_PARAMETER_ASSIGNMENT.code));
  });

  it("detects M9602 (unresolved parent), M9603 (non-positive dimension), M9604 (child exceeds parent bounds), and M9605 (undefined material)", () => {
    const text = `
s:Ge/ParentBox/Type = "TsBox"
s:Ge/ParentBox/Parent = "World"
s:Ge/ParentBox/Material = "G4_WATER"
d:Ge/ParentBox/HLX = 50.0 mm
d:Ge/ParentBox/HLY = 50.0 mm
d:Ge/ParentBox/HLZ = 50.0 mm

s:Ge/ProtrudingChild/Type = "TsBox"
s:Ge/ProtrudingChild/Parent = "ParentBox"
s:Ge/ProtrudingChild/Material = "UnobtainiumAlloy"
d:Ge/ProtrudingChild/HLX = 30.0 mm
d:Ge/ProtrudingChild/HLY = 30.0 mm
d:Ge/ProtrudingChild/HLZ = 30.0 mm
d:Ge/ProtrudingChild/TransX = 35.0 mm

s:Ge/OrphanCyl/Type = "TsCylinder"
s:Ge/OrphanCyl/Parent = "MissingVolume"
s:Ge/OrphanCyl/Material = "G4_WATER"
d:Ge/OrphanCyl/RMin = 20.0 mm
d:Ge/OrphanCyl/RMax = 10.0 mm
d:Ge/OrphanCyl/HL = -5.0 mm
`;
    const doc = parseTopas(text);
    const diags = lintTopasDocument(doc);
    const codes = new Set(diags.map((d) => d.code));
    assert(codes.has(TopasErrorCode.UNRESOLVED_PARENT_COMPONENT.code));
    assert(codes.has(TopasErrorCode.NON_POSITIVE_GEOMETRY_DIMENSION.code));
    assert(codes.has(TopasErrorCode.CHILD_EXCEEDS_PARENT_BOUNDS.code));
    assert(codes.has(TopasErrorCode.UNDEFINED_MATERIAL.code));
  });

  it("detects M9606 (invalid beam energy), M9607 (circular include), and M9608 (scorer missing component)", () => {
    const text = `
includeFile = Main.topas -> SubNozzle.topas -> Main.topas

s:So/BadBeam/Type = "Beam"
s:So/BadBeam/BeamParticle = "proton"
d:So/BadBeam/BeamEnergy = -50.0 MeV
u:So/BadBeam/BeamEnergySpread = -0.2

s:Sc/BrokenScorer/Quantity = "DoseToWater"
s:Sc/BrokenScorer/Component = "GhostPhantom"
`;
    const doc = parseTopas(text, "file:///Main.topas");
    const diags = lintTopasDocument(doc);
    const codes = new Set(diags.map((d) => d.code));
    assert(codes.has(TopasErrorCode.INVALID_BEAM_ENERGY.code));
    assert(codes.has(TopasErrorCode.CIRCULAR_INCLUDE_FILE.code));
    assert(codes.has(TopasErrorCode.SCORER_MISSING_COMPONENT.code));
  });
});
