// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { createRequire } from "node:module";
import { describe, it } from "node:test";
import {
  box,
  compileAssemblyToAp242Step,
  compileAssemblyToStep,
  compileToStep,
  cylinder,
  extractStepGdtOverlay,
  part,
  sphere,
  subtract,
  tagPatch,
  torus,
  translate,
  type Assembly,
} from "../src/index.js";

describe("Exact Analytical STEP ISO 10303 B-Rep Exporter", () => {
  it("compiles exact analytical CYLINDRICAL_SURFACE with circular bounding loops", () => {
    const cyl = cylinder({ radius: 15, height: 40 });
    const step = compileToStep(cyl, "TestCylinder");

    assert.ok(step.includes("ISO-10303-21"), "Should be valid STEP header");
    assert.ok(step.includes("CYLINDRICAL_SURFACE"), "Must emit true CYLINDRICAL_SURFACE entity");
    assert.ok(step.includes("CIRCLE"), "Must emit bounding CIRCLE curves");
    assert.ok(step.includes("ADVANCED_FACE"), "Must emit ADVANCED_FACE entities");
    assert.ok(step.includes("CLOSED_SHELL"), "Must emit CLOSED_SHELL");
    assert.ok(step.includes("MANIFOLD_SOLID_BREP"), "Must emit MANIFOLD_SOLID_BREP");
    assert.ok(step.includes("15.0"), "Must include cylinder radius 15.0");
  });

  it("compiles exact analytical SPHERICAL_SURFACE with meridian loops", () => {
    const sph = sphere({ radius: 25 });
    const step = compileToStep(sph, "TestSphere");

    assert.ok(step.includes("SPHERICAL_SURFACE"), "Must emit true SPHERICAL_SURFACE entity");
    assert.ok(step.includes("CIRCLE"), "Must emit meridian CIRCLE curves");
    assert.ok(step.includes("ADVANCED_FACE"), "Must emit ADVANCED_FACE entities");
    assert.ok(step.includes("CLOSED_SHELL"), "Must emit CLOSED_SHELL");
    assert.ok(step.includes("MANIFOLD_SOLID_BREP"), "Must emit MANIFOLD_SOLID_BREP");
    assert.ok(step.includes("25.0"), "Must include sphere radius 25.0");
  });

  it("compiles exact analytical TOROIDAL_SURFACE", () => {
    const tor = torus({ major: 50, minor: 10 });
    const step = compileToStep(tor, "TestTorus");

    assert.ok(step.includes("TOROIDAL_SURFACE"), "Must emit true TOROIDAL_SURFACE entity");
    assert.ok(step.includes("50.0"), "Must include major radius");
    assert.ok(step.includes("10.0"), "Must include minor radius");
    assert.ok(step.includes("ADVANCED_FACE"), "Must emit ADVANCED_FACE entities");
    assert.ok(step.includes("CLOSED_SHELL"), "Must emit CLOSED_SHELL");
    assert.ok(step.includes("MANIFOLD_SOLID_BREP"), "Must emit MANIFOLD_SOLID_BREP");
  });

  it("transforms analytical surfaces and placements in 3D world space", () => {
    const shiftedCyl = translate(cylinder({ radius: 10, height: 30 }), [100, 200, 300]);
    const step = compileToStep(shiftedCyl, "ShiftedCylinder");

    assert.ok(step.includes("CYLINDRICAL_SURFACE"), "Must emit CYLINDRICAL_SURFACE");
    // Verify transformed placement coordinates exist
    assert.ok(
      step.includes("100.0,200.0,285.0") || step.includes("100.0,200.0,315.0"),
      "Placement origin must reflect translation [100, 200, 300] with z +/- hh offset",
    );
  });

  it("compiles a heterogeneous assembly with boxes, cylinders, and spheres into ADVANCED_BREP_SHAPE_REPRESENTATION", () => {
    const b = box({ width: 20, height: 20, depth: 20, name: "base_box" });
    const c = translate(cylinder({ radius: 5, height: 40, name: "piston_cyl" }), [0, 0, 20]);
    const s = translate(sphere({ radius: 8, name: "ball_joint" }), [0, 0, 45]);

    const assembly: Assembly = {
      name: "RobotActuator",
      parts: [
        { name: "base_box", solid: b },
        { name: "piston_cyl", solid: c },
        { name: "ball_joint", solid: s },
      ],
    };

    const step = compileAssemblyToStep(assembly);

    assert.ok(step.includes("ADVANCED_BREP_SHAPE_REPRESENTATION"));
    assert.ok(step.includes("PLANE"));
    assert.ok(step.includes("CYLINDRICAL_SURFACE"));
    assert.ok(step.includes("SPHERICAL_SURFACE"));
    assert.ok(step.includes("PRODUCT('RobotActuator_base_box_0'"));
  });

  it("compiles coaxial hollow cylinder annulus (FACE_BOUND), world-space TaggedPatch anchors, and symbolic AP242 PMI verified by OCCT", async () => {
    const outer = cylinder({ radius: 1.6, height: 1.4, name: "nacelle_outer" });
    const inner = cylinder({ radius: 1.5, height: 1.44, name: "nacelle_inner" });
    const shroudTag = tagPatch(cylinder({ radius: 1.48, height: 0.25 }), {
      portName: "FanTipAcousticLiner",
      portType: "optical_aperture",
      normal: [0, 1, 0],
    });
    const inletRing = { ...translate(subtract(outer, inner), [0, 0, -1.9]), name: "intake_nacelle" };
    const fanTag = { ...translate(shroudTag, [-1.92, 0, 0]), name: "fan_tag" };

    const asm: Assembly = {
      name: "TurbofanTest",
      parts: [part(inletRing), part(fanTag)],
    };

    const { stepText, featureAnchors } = compileAssemblyToAp242Step(asm, {
      schema: "AP242",
      lengthUnit: "m",
      preservePartNames: true,
      timeStamp: "2026-11-15T12:00:00Z",
      pmi: {
        datums: [
          {
            label: "A",
            featureName: "FanTipAcousticLiner",
          },
        ],
        tolerances: [
          {
            id: "C_FAN_RUNOUT",
            name: "C_FAN_RUNOUT",
            description: "Fan Tip Shroud Runout",
            characteristic: "TOTAL_RUNOUT_TOLERANCE",
            zoneValue: 0.035,
            datumRefs: ["A"],
            featureName: "FanTipAcousticLiner",
          },
        ],
      },
    });

    assert.ok(stepText.includes("FACE_OUTER_BOUND"), "Expected outer annulus boundary");
    assert.ok(stepText.includes("FACE_BOUND"), "Expected inner bore FACE_BOUND for hollow cylinder");
    assert.ok(stepText.includes("DATUM_FEATURE"), "Expected AP242 DATUM_FEATURE entity");
    assert.ok(stepText.includes("TOTAL_RUNOUT_TOLERANCE"), "Expected AP242 TOTAL_RUNOUT_TOLERANCE entity");
    assert.ok(stepText.includes("PRODUCT('intake_nacelle'"), "Expected preserved part name intake_nacelle");

    const linerAnchor = featureAnchors.find((a) => a.name === "FanTipAcousticLiner");
    assert.ok(linerAnchor, "Expected world-space featureAnchor for TaggedPatch FanTipAcousticLiner");
    assert.ok(
      Math.abs(linerAnchor.anchor[0] - -1.92) < 1e-4,
      `Expected translated X=-1.92, got ${linerAnchor.anchor[0]}`,
    );

    const qifSample = `
QIF 3.0.0 qpId="test-qif"
FEATURE F_SHROUD Cylinder "FanTipAcousticLiner"
CHARACTERISTIC C_FAN_RUNOUT TotalRunout "Fan Tip Shroud Runout" zone=0.035 datums=[A] features=[F_SHROUD]
ACTUAL ACT1 characteristic=C_FAN_RUNOUT serial="SN-1" value=0.042 status=FAIL
`;
    const overlay = extractStepGdtOverlay(stepText, qifSample);
    assert.strictEqual(overlay.datums.length, 1);
    assert.strictEqual(overlay.datums[0]?.label, "A");
    assert.strictEqual(overlay.callouts.length, 1);
    assert.strictEqual(overlay.callouts[0]?.id, "C_FAN_RUNOUT");
    assert.strictEqual(overlay.callouts[0]?.measured, 0.042);
    assert.strictEqual(overlay.callouts[0]?.status, "FAIL");

    // Verify OCCT parses & tessellates the generated hollow cylinder STEP without error
    const req = createRequire(import.meta.url);
    const occtMod = (await import("occt-import-js")) as { default?: any };
    const initOcct = occtMod.default ?? occtMod;
    const occt = await initOcct({
      locateFile: (p: string) => (p.endsWith(".wasm") ? req.resolve(`occt-import-js/dist/${p}`) : p),
    });
    const res = occt.ReadStepFile(new TextEncoder().encode(stepText), null);
    assert.ok(res?.success !== false, "Expected OCCT ReadStepFile to succeed");
    assert.ok(Array.isArray(res?.meshes) && res.meshes.length >= 1, "Expected >=1 tessellated OCCT mesh");
  });
});
