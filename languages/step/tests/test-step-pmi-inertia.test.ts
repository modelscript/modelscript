// SPDX-License-Identifier: LGPL-3.0-or-later
import { generateMultiBodyModelica } from "@modelscript/modelica/multibody-generator";
import assert from "node:assert";
import { describe, it } from "node:test";
import { extractStepAssembly } from "../src/assembly-extractor.js";
import { mapStepToMultiBody } from "../step-multibody-mapper.js";

describe("STEP AP242 Semantic 3D PMI & Inertia Extraction", () => {
  const sampleStepText = `
ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('STEP AP242 Model with Semantic PMI & Inertia'),'2;1');
FILE_NAME('drone_chassis_ap242.stp','2026-09-14T05:00:00',('Antigravity'),('ModelScript PLM'),'','','');
FILE_SCHEMA(('AP242_MANAGED_MODEL_BASED_3D_ENGINEERING_MIM_LF'));
ENDSEC;
DATA;
#10 = PRODUCT('DroneChassis','Drone Chassis Main Body','',(#11));
#11 = PRODUCT_CONTEXT('',#12,'mechanical');
#12 = APPLICATION_CONTEXT('mechanical design');
#20 = PRODUCT_DEFINITION_FORMATION('1.0','',#10);
#30 = PRODUCT_DEFINITION('design','',#20,#11);

/* Mass Properties & 3D Inertia Tensor */
#40 = MASS_MEASURE_WITH_UNIT(MASS_MEASURE(4.25),#41);
#41 = ( NAMED_UNIT(*) MASS_UNIT() SI_UNIT($,.GRAM.) );
#50 = CARTESIAN_POINT('centre of mass', (0.12, 0.05, 0.08));
#60 = INERTIA_MATRIX('inertia matrix', (0.045, 0.082, 0.115, 0.0012, 0.0025, 0.0018));
#70 = PROPERTY_DEFINITION('volume', 'total solid volume', #30);
#71 = ( MEASURE_REPRESENTATION_ITEM() REPRESENTATION_ITEM('volume') VOLUME_MEASURE(0.00155) );

/* Semantic 3D PMI / GD&T */
#100 = DATUM('Datum A', 'Primary Mounting Face', #200, 'A');
#101 = DATUM('Datum B', 'Side Reference Face', #201, 'B');
#110 = DATUM_SYSTEM('DRF_ABC', (#100, #101));

#120 = FLATNESS_TOLERANCE('Mounting Face Flatness', 'Tolerance on Datum A', 0.02, #200);
#130 = POSITION_TOLERANCE('Motor Mounting Hole True Position', 'Position w.r.t Datum A and B', 0.05, #100);
#140 = PERPENDICULARITY_TOLERANCE('Side Wall Perpendicularity', 'Perpendicular to Datum A', 0.03, #100);

#200 = SHAPE_ASPECT('MountingFace', 'Face for drone arm connection', #30, .F.);
#201 = SHAPE_ASPECT('SideFace', 'Reference side face', #30, .F.);
ENDSEC;
END-ISO-10303-21;
`;

  it("should extract mass, center of mass, and 3D inertia tensor from STEP AP242", () => {
    const assembly = extractStepAssembly(sampleStepText);

    assert.ok(assembly.parts.size >= 1);
    const part = assembly.parts.get("#10");
    assert.ok(part);
    assert.strictEqual(part?.name, "DroneChassis");

    // Verify mass properties
    assert.ok(assembly.massProperties.size >= 1);
    const massProps = assembly.massProperties.get("#10");
    assert.ok(massProps);

    assert.strictEqual(massProps?.mass, 4.25);
    assert.deepStrictEqual(massProps?.centerOfMass, [0.12, 0.05, 0.08]);

    assert.ok(massProps?.inertiaTensor);
    assert.strictEqual(massProps?.inertiaTensor?.I_11, 0.045);
    assert.strictEqual(massProps?.inertiaTensor?.I_22, 0.082);
    assert.strictEqual(massProps?.inertiaTensor?.I_33, 0.115);
    assert.strictEqual(massProps?.inertiaTensor?.I_21, 0.0012);
    assert.strictEqual(massProps?.inertiaTensor?.I_31, 0.0025);
    assert.strictEqual(massProps?.inertiaTensor?.I_32, 0.0018);
  });

  it("should extract semantic 3D PMI datums and geometric tolerances", () => {
    const assembly = extractStepAssembly(sampleStepText);

    // Verify Datums
    assert.ok(assembly.datums);
    assert.strictEqual(assembly.datums.size, 2);
    assert.strictEqual(assembly.datums.get("#100")?.name, "A");
    assert.strictEqual(assembly.datums.get("#101")?.name, "B");

    // Verify Datum Systems
    assert.ok(assembly.datumSystems);
    assert.strictEqual(assembly.datumSystems.length, 1);
    assert.strictEqual(assembly.datumSystems[0].primaryDatum, "A");
    assert.strictEqual(assembly.datumSystems[0].secondaryDatum, "B");

    // Verify Geometric Tolerances
    assert.ok(assembly.tolerances);
    assert.strictEqual(assembly.tolerances.length, 3);

    const flatness = assembly.tolerances.find((t) => t.type === "flatness");
    assert.ok(flatness);
    assert.strictEqual(flatness?.magnitude, 0.02);

    const position = assembly.tolerances.find((t) => t.type === "position");
    assert.ok(position);
    assert.strictEqual(position?.magnitude, 0.05);
    assert.deepStrictEqual(position?.datumReferences, ["A"]);

    const perp = assembly.tolerances.find((t) => t.type === "perpendicularity");
    assert.ok(perp);
    assert.strictEqual(perp?.magnitude, 0.03);
    assert.deepStrictEqual(perp?.datumReferences, ["A"]);
  });

  it("should parameterize Modelica MultiBody models with extracted CAD inertia and mass", () => {
    const model = extractStepAssembly(sampleStepText);
    const mbAssembly = mapStepToMultiBody("DroneChassisAssembly", model);

    assert.strictEqual(mbAssembly.bodies.length, 1);
    const body = mbAssembly.bodies[0];
    assert.strictEqual(body.name, "DroneChassis");
    assert.strictEqual(body.mass, 4.25);
    assert.deepStrictEqual(body.r_CM, [0.12, 0.05, 0.08]);
    assert.strictEqual(body.inertia.I_11, 0.045);
    assert.strictEqual(body.inertia.I_22, 0.082);
    assert.strictEqual(body.inertia.I_33, 0.115);

    // Generate Modelica code
    const modelicaCode = generateMultiBodyModelica(mbAssembly as any, "drone_chassis_ap242.stp");

    assert.ok(modelicaCode.includes("model DroneChassisAssembly"));
    assert.ok(modelicaCode.includes("Parts.Body DroneChassis("));
    assert.ok(modelicaCode.includes("m = 4.25"));
    assert.ok(modelicaCode.includes("I_11 = 0.045, I_22 = 0.082, I_33 = 0.115"));
    assert.ok(modelicaCode.includes("r_CM = {0.12, 0.05, 0.08}"));
  });
});
