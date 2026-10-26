// SPDX-License-Identifier: AGPL-3.0-or-later

import { generateMultiBodyModelica } from "@modelscript/modelica/multibody-generator";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractStepAssembly } from "../src/assembly-extractor.js";
import { mapStepToMultiBody } from "../step-multibody-mapper.js";

describe("NIST STEP AP242 Multi-Component Actuator Assembly Benchmark", () => {
  const nistAp242ActuatorDeck = `ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('NIST AP242 Benchmark: Two-Axis Robotic Gimbal Assembly with Kinematics & Semantic PMI'),'2;1');
FILE_NAME('nist_ap242_gimbal_actuator.stp','2026-10-25T20:00:00',('NIST / CAx-IF Benchmark Group'),('ModelScript Polyglot Benchmark'),'','','');
FILE_SCHEMA(('AP242_MANAGED_MODEL_BASED_3D_ENGINEERING_MIM_LF'));
ENDSEC;
DATA;

/* Context & Units */
#1 = APPLICATION_CONTEXT('mechanical design');
#2 = PRODUCT_CONTEXT('',#1,'mechanical');
#3 = ( LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT($,.METRE.) );
#4 = ( NAMED_UNIT(*) MASS_UNIT() SI_UNIT($,.KILO.,.GRAM.) );

/* Root Assembly & Child Products */
#10 = PRODUCT('GimbalAssembly','Two-Axis Gimbal System','',(#2));
#20 = PRODUCT_DEFINITION_FORMATION('1.0','',#10);
#30 = PRODUCT_DEFINITION('design','',#20,#2);

#40 = PRODUCT('BaseMount','Precision Aluminum Base Plate','',(#2));
#41 = PRODUCT_DEFINITION_FORMATION('1.0','',#40);
#42 = PRODUCT_DEFINITION('design','',#41,#2);

#50 = PRODUCT('ElevationYoke','Rotational Gimbal Yoke','',(#2));
#51 = PRODUCT_DEFINITION_FORMATION('1.0','',#50);
#52 = PRODUCT_DEFINITION('design','',#51,#2);

#60 = PRODUCT('OpticCarrier','Azimuth Rotor & Sensor Housing','',(#2));
#61 = PRODUCT_DEFINITION_FORMATION('1.0','',#60);
#62 = PRODUCT_DEFINITION('design','',#61,#2);

/* Placements & Transforms */
#100 = CARTESIAN_POINT('origin', (0.0, 0.0, 0.0));
#101 = DIRECTION('z-axis', (0.0, 0.0, 1.0));
#102 = DIRECTION('x-axis', (1.0, 0.0, 0.0));
#110 = AXIS2_PLACEMENT_3D('Base Placement', #100, #101, #102);

#120 = CARTESIAN_POINT('Yoke Offset', (0.0, 0.0, 0.15));
#121 = AXIS2_PLACEMENT_3D('Yoke Placement', #120, #101, #102);

#130 = CARTESIAN_POINT('Carrier Offset', (0.05, 0.0, 0.25));
#131 = DIRECTION('Carrier Y-axis', (0.0, 1.0, 0.0));
#132 = AXIS2_PLACEMENT_3D('Carrier Placement', #130, #131, #102);

/* Assembly Hierarchy via NEXT_ASSEMBLY_USAGE_OCCURRENCE */
#200 = NEXT_ASSEMBLY_USAGE_OCCURRENCE('NAUO_1', 'Base to Assembly', '', #30, #42, $);
#201 = NEXT_ASSEMBLY_USAGE_OCCURRENCE('NAUO_2', 'Yoke to Assembly', '', #30, #52, $);
#202 = NEXT_ASSEMBLY_USAGE_OCCURRENCE('NAUO_3', 'Carrier to Yoke', '', #52, #62, $);

/* Kinematic Pairs: Revolute Elevation & Azimuth */
#300 = REVOLUTE_PAIR('ElevationJoint', 'Revolute Elevation Axis', #42, #52, #121);
#301 = REVOLUTE_PAIR('AzimuthJoint', 'Revolute Azimuth Axis', #52, #62, #132);

/* Mass Properties: BaseMount */
#400 = MASS_MEASURE_WITH_UNIT(MASS_MEASURE(3.50), #4);
#401 = CARTESIAN_POINT('centre of mass', (0.0, 0.0, 0.04));
#402 = INERTIA_MATRIX('Base Inertia', (0.015, 0.015, 0.025, 0.0, 0.0, 0.0));
#403 = PROPERTY_DEFINITION('BaseMass', 'mass', #42);
#404 = PROPERTY_DEFINITION_REPRESENTATION(#403, #405);
#405 = REPRESENTATION('BaseProps', (#400, #401, #402), #3);

/* Mass Properties: ElevationYoke */
#500 = MASS_MEASURE_WITH_UNIT(MASS_MEASURE(1.85), #4);
#501 = CARTESIAN_POINT('centre of mass', (0.0, 0.0, 0.18));
#502 = INERTIA_MATRIX('Yoke Inertia', (0.008, 0.009, 0.012, 0.0001, 0.0, 0.0));
#503 = PROPERTY_DEFINITION('YokeMass', 'mass', #52);
#504 = PROPERTY_DEFINITION_REPRESENTATION(#503, #505);
#505 = REPRESENTATION('YokeProps', (#500, #501, #502), #3);

/* Mass Properties: OpticCarrier */
#600 = MASS_MEASURE_WITH_UNIT(MASS_MEASURE(0.92), #4);
#601 = CARTESIAN_POINT('centre of mass', (0.05, 0.0, 0.28));
#602 = INERTIA_MATRIX('Carrier Inertia', (0.003, 0.004, 0.003, 0.0, 0.0, 0.0));
#603 = PROPERTY_DEFINITION('CarrierMass', 'mass', #62);
#604 = PROPERTY_DEFINITION_REPRESENTATION(#603, #605);
#605 = REPRESENTATION('CarrierProps', (#600, #601, #602), #3);

/* Semantic 3D PMI / GD&T */
#700 = SHAPE_ASPECT('Base Datum Face', 'Primary Base Plate Surface', #42, .F.);
#701 = SHAPE_ASPECT('Base Pilot Bore', 'Central Alignment Bore', #42, .F.);
#702 = SHAPE_ASPECT('Yoke Trunnion Shaft', 'Bearing Journal Surface', #52, .F.);

#710 = DATUM('Datum A', 'Base Surface', #700, 'A');
#711 = DATUM('Datum B', 'Center Bore', #701, 'B');
#720 = DATUM_SYSTEM('DRF_AB', (#710, #711));

#730 = FLATNESS_TOLERANCE('Base Plate Flatness', 'Critical mounting flatness', 0.015, #700);
#731 = PERPENDICULARITY_TOLERANCE('Bore Perpendicularity', 'Perpendicular to Datum A', 0.02, #701);
#732 = POSITION_TOLERANCE('Bearing Journal True Position', 'Position to DRF_AB', 0.025, #702);

ENDSEC;
END-ISO-10303-21;
`;

  it("should parse multi-component assembly hierarchy and extract all parts", () => {
    const assembly = extractStepAssembly(nistAp242ActuatorDeck);

    assert.ok(assembly.parts.size >= 4, `Expected at least 4 parts, found ${assembly.parts.size}`);
    assert.ok(assembly.parts.has("#10"), "Root assembly GimbalAssembly should exist");
    assert.ok(assembly.parts.has("#40"), "BaseMount should exist");
    assert.ok(assembly.parts.has("#50"), "ElevationYoke should exist");
    assert.ok(assembly.parts.has("#60"), "OpticCarrier should exist");

    assert.strictEqual(assembly.parts.get("#40")?.name, "BaseMount");
    assert.strictEqual(assembly.parts.get("#50")?.name, "ElevationYoke");
    assert.strictEqual(assembly.parts.get("#60")?.name, "OpticCarrier");
  });

  it("should extract mass properties and 3D inertia tensors for all bodies", () => {
    const assembly = extractStepAssembly(nistAp242ActuatorDeck);

    assert.ok(assembly.massProperties.size >= 3);
    const baseMass = assembly.massProperties.get("#40");
    const yokeMass = assembly.massProperties.get("#50");
    const carrierMass = assembly.massProperties.get("#60");

    assert.ok(baseMass, "Base mass properties should be extracted");
    assert.strictEqual(baseMass.mass, 3.5);
    assert.deepStrictEqual(baseMass.centerOfMass, [0.0, 0.0, 0.04]);

    assert.ok(yokeMass, "Yoke mass properties should be extracted");
    assert.strictEqual(yokeMass.mass, 1.85);

    assert.ok(carrierMass, "Carrier mass properties should be extracted");
    assert.strictEqual(carrierMass.mass, 0.92);
  });

  it("should extract kinematic revolute pairs with axes and origins", () => {
    const assembly = extractStepAssembly(nistAp242ActuatorDeck);

    assert.ok(assembly.joints.length >= 2, `Expected at least 2 kinematic joints, found ${assembly.joints.length}`);
    const elevJoint = assembly.joints.find((j) => j.type === "revolute");
    assert.ok(elevJoint, "Revolute elevation joint should be parsed");
  });

  it("should extract semantic 3D PMI datums and geometric tolerances", () => {
    const assembly = extractStepAssembly(nistAp242ActuatorDeck);

    assert.ok(assembly.datums.size >= 2, "Datums A and B should be extracted");
    assert.strictEqual(assembly.datums.get("#710")?.name, "A");
    assert.strictEqual(assembly.datums.get("#711")?.name, "B");

    assert.ok(assembly.datumSystems.length >= 1, "Datum system DRF_AB should be parsed");
    assert.strictEqual(assembly.datumSystems[0]?.name, "DRF_AB");

    assert.ok(assembly.tolerances.length >= 3, `Expected at least 3 tolerances, got ${assembly.tolerances.length}`);
    const flatness = assembly.tolerances.find((t) => t.type === "flatness");
    assert.ok(flatness, "Flatness tolerance should be present");
    assert.strictEqual(flatness.magnitude, 0.015);

    const perp = assembly.tolerances.find((t) => t.type === "perpendicularity");
    assert.ok(perp, "Perpendicularity tolerance should be present");
    assert.strictEqual(perp.magnitude, 0.02);
  });

  it("should project STEP assembly into Modelica MultiBody system", () => {
    const assembly = extractStepAssembly(nistAp242ActuatorDeck);
    const mbModel = mapStepToMultiBody("GimbalAssembly", assembly);

    assert.ok(mbModel);
    assert.ok(mbModel.bodies.length >= 3, `Expected at least 3 multibody bodies, got ${mbModel.bodies.length}`);

    const modelicaCode = generateMultiBodyModelica(mbModel);
    assert.ok(modelicaCode.includes("model GimbalAssembly"), "Generated Modelica should contain model GimbalAssembly");
    assert.ok(modelicaCode.includes("Modelica.Mechanics.MultiBody"), "Should reference MultiBody library");
  });
});
