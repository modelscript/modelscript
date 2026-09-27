// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import {
  box,
  compileAssemblyToStep,
  compileToStep,
  cylinder,
  sphere,
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
});
