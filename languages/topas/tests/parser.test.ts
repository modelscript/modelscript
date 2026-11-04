// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import { parseTopas } from "../src/parser/index.js";

describe("TOPAS (.topas) and GATE (.mac) Parser", () => {
  it("parses TOPAS parameter syntax with typed prefixes, units, vectors, and change overrides", () => {
    const topasText = `# TOPAS Proton Therapy Water Phantom Setup
includeFile = NozzleBase.topas

s:Ge/WaterPhantom/Type = "TsBox"
s:Ge/WaterPhantom/Parent = "World"
s:Ge/WaterPhantom/Material = "G4_WATER"
d:Ge/WaterPhantom/HLX = 15.0 cm
d:Ge/WaterPhantom/HLY = 15.0 cm
d:Ge/WaterPhantom/HLZ = 20.0 cm
d:Ge/WaterPhantom/TransZ = 200.0 mm
change d:Ge/WaterPhantom/TransZ = 210.0 mm

s:Ge/TargetInsert/Type = "TsCylinder"
s:Ge/TargetInsert/Parent = "WaterPhantom"
s:Ge/TargetInsert/Material = "G4_BONE_COMPACT_ICRU"
d:Ge/TargetInsert/RMin = 0.0 mm
d:Ge/TargetInsert/RMax = 25.0 mm
d:Ge/TargetInsert/HL = 30.0 mm

s:So/ProtonBeam/Type = "Beam"
s:So/ProtonBeam/Component = "BeamPosition"
s:So/ProtonBeam/BeamParticle = "proton"
d:So/ProtonBeam/BeamEnergy = 150.0 MeV
u:So/ProtonBeam/BeamEnergySpread = 0.75
i:So/ProtonBeam/NumberOfHistoriesInRun = 25000

s:Sc/BraggScorer/Quantity = "DoseToWater"
s:Sc/BraggScorer/Component = "WaterPhantom"
b:Sc/BraggScorer/OutputToConsole = "True"
dv:Ge/RidgeFilter/ZPoints = 3 10.0 20.0 30.0 mm
sv:Ma/CustomBone/Components = 2 "Hydrogen" "Calcium"
uv:Ma/CustomBone/Fractions = 2 0.15 0.85
d:Ma/CustomBone/Density = 1.85 g/cm3
`;

    const doc = parseTopas(topasText, "file:///treatment.topas");
    assert.strictEqual(doc.dialect, "topas");
    assert.strictEqual(doc.includes.length, 1);
    assert.strictEqual(doc.includes[0]?.filePath, "NozzleBase.topas");

    assert.strictEqual(doc.components.length, 3);
    const phantom = doc.components[0]!;
    assert.strictEqual(phantom.name, "WaterPhantom");
    assert.strictEqual(phantom.type, "TsBox");
    assert.strictEqual(phantom.parent, "World");
    assert.strictEqual(phantom.material, "G4_WATER");
    assert.strictEqual(phantom.hlx, 150.0);
    assert.strictEqual(phantom.hlz, 200.0);
    assert.strictEqual(phantom.transZ, 210.0);

    const insert = doc.components[1]!;
    assert.strictEqual(insert.name, "TargetInsert");
    assert.strictEqual(insert.type, "TsCylinder");
    assert.strictEqual(insert.rMax, 25.0);
    assert.strictEqual(insert.hl, 30.0);

    assert.strictEqual(doc.sources.length, 1);
    assert.strictEqual(doc.sources[0]?.beamParticle, "proton");
    assert.strictEqual(doc.sources[0]?.beamEnergy, 150.0);
    assert.strictEqual(doc.sources[0]?.beamEnergySpread, 0.75);
    assert.strictEqual(doc.sources[0]?.numberOfHistoriesInRun, 25000);

    assert.strictEqual(doc.scorers.length, 1);
    assert.strictEqual(doc.scorers[0]?.quantity, "DoseToWater");
    assert.strictEqual(doc.scorers[0]?.component, "WaterPhantom");

    assert.strictEqual(doc.materials.length, 1);
    assert.strictEqual(doc.materials[0]?.name, "CustomBone");
    assert.strictEqual(doc.materials[0]?.density, 1.85);
    assert.deepStrictEqual(doc.materials[0]?.components, ["Hydrogen", "Calcium"]);

    // JSON round-trip
    const roundTrip = parseTopas(JSON.stringify(doc));
    assert.strictEqual(roundTrip.components.length, 3);
    assert.strictEqual(roundTrip.sources[0]?.beamEnergy, 150.0);
  });

  it("parses GATE (.mac) Geant4 macro script commands", () => {
    const gateMac = `# GATE Hadrontherapy Macro
/gate/world/daughters/name WaterBox
/gate/world/daughters/insert box
/gate/WaterBox/setMaterial G4_WATER
/gate/WaterBox/geometry/setXLength 30. cm
/gate/WaterBox/geometry/setYLength 30. cm
/gate/WaterBox/geometry/setZLength 40. cm
/gate/WaterBox/placement/setTranslation 0. 0. 200. mm

/gate/source/addSource CarbonBeam gps
/gate/source/CarbonBeam/gps/particle carbon
/gate/source/CarbonBeam/gps/ene/mono 250. MeV
/gate/source/CarbonBeam/gps/ene/sigma 0.5 MeV

/gate/actor/addActor DoseActor DepthDoseActor
/gate/actor/DepthDoseActor/attachTo WaterBox
`;

    const doc = parseTopas(gateMac, "file:///gate_sim.mac");
    assert.strictEqual(doc.dialect, "gate");
    assert.strictEqual(doc.components.length, 1);
    assert.strictEqual(doc.components[0]?.name, "WaterBox");
    assert.strictEqual(doc.components[0]?.hlx, 150.0);
    assert.strictEqual(doc.components[0]?.hlz, 200.0);
    assert.strictEqual(doc.sources[0]?.beamParticle, "carbon");
    assert.strictEqual(doc.sources[0]?.beamEnergy, 250.0);
    assert.strictEqual(doc.scorers[0]?.name, "DepthDoseActor");
    assert.strictEqual(doc.scorers[0]?.component, "WaterBox");
  });
});
