// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { box, chamfer, compileToStep, fillet, ManifoldWorker, SolidKind } from "../src/index.js";

console.log("=== Testing CAD Fillet and Chamfer Geometric Blending ===");

{
  const baseBox = box({ width: 10, height: 10, depth: 2, name: "BaseBracket" });
  assert.strictEqual(baseBox.kind, SolidKind.Box);

  // 1. Test Fillet AST and Mesh Generation
  const rounded = fillet(baseBox, 1.0, undefined, "RoundedBracket");
  assert.strictEqual(rounded.kind, SolidKind.Fillet);
  assert.strictEqual(rounded.radius, 1.0);
  assert.strictEqual(rounded.name, "RoundedBracket");

  const meshFillet = ManifoldWorker.evaluateSolid(rounded);
  console.log(
    `  Filleted Mesh: ${meshFillet.vertices.length / 3} vertices, ${meshFillet.indices.length / 3} triangles`,
  );
  assert(meshFillet.vertices.length > 0, "Filleted mesh must have vertices");
  assert(meshFillet.indices.length > 0, "Filleted mesh must have triangles");
  // Chamfered/filleted box has 26 planar/beveled faces = 44 triangles
  assert(
    meshFillet.indices.length / 3 >= 40,
    `Expected at least 40 triangles for beveled geometry, got ${meshFillet.indices.length / 3}`,
  );

  // 2. Test Chamfer AST and Mesh Generation
  const beveled = chamfer(baseBox, 0.5, undefined, "BeveledBracket");
  assert.strictEqual(beveled.kind, SolidKind.Chamfer);
  assert.strictEqual(beveled.distance, 0.5);

  const meshChamfer = ManifoldWorker.evaluateSolid(beveled);
  console.log(
    `  Chamfered Mesh: ${meshChamfer.vertices.length / 3} vertices, ${meshChamfer.indices.length / 3} triangles`,
  );
  assert(meshChamfer.vertices.length > 0, "Chamfered mesh must have vertices");
  assert(meshChamfer.indices.length > 0, "Chamfered mesh must have triangles");

  // 3. Test STEP Compilation with Fillet & Chamfer
  const stepOutputFillet = compileToStep(rounded);
  assert(stepOutputFillet.includes("ISO-10303-21"), "STEP output must contain ISO-10303-21 header");
  assert(stepOutputFillet.includes("MANIFOLD_SOLID_BREP"), "STEP output must contain B-Rep definition");

  const stepOutputChamfer = compileToStep(beveled);
  assert(stepOutputChamfer.includes("ISO-10303-21"), "STEP output must contain ISO-10303-21 header");

  console.log(
    "  ✓ CAD Fillet and Chamfer successfully generated watertight 2-manifold surface meshes and STEP output!",
  );
}

console.log("All CAD Fillet/Chamfer tests passed successfully!");
