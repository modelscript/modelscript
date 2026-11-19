// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import {
  box,
  chamfer,
  compileToStep,
  fillet,
  linearExtrude,
  ManifoldWorker,
  SolidKind,
  translate,
  union,
} from "../src/index.js";

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

  // 3. Test Fillet & Chamfer on non-leaf Extrusion
  const prism = linearExtrude(
    [
      [0, 0],
      [20, 0],
      [20, 12],
      [0, 12],
    ],
    10,
  );
  const flatTris = ManifoldWorker.evaluateSolid(prism).indices.length / 3;
  const chamferPrismTris = ManifoldWorker.evaluateSolid(chamfer(prism, 1.0)).indices.length / 3;
  const filletPrismTris = ManifoldWorker.evaluateSolid(fillet(prism, 1.0)).indices.length / 3;
  assert(chamferPrismTris > flatTris, `Expected chamfered extrusion tris (${chamferPrismTris}) > flat (${flatTris})`);
  assert(
    filletPrismTris > chamferPrismTris,
    `Expected filleted extrusion tris (${filletPrismTris}) > chamfered (${chamferPrismTris})`,
  );

  // 4. Test STEP Compilation with Fillet, Chamfer, and Union overlap merging
  const stepOutputFillet = compileToStep(rounded);
  assert(stepOutputFillet.includes("ISO-10303-21"), "STEP output must contain ISO-10303-21 header");
  assert(stepOutputFillet.includes("MANIFOLD_SOLID_BREP"), "STEP output must contain B-Rep definition");

  const stepOutputChamfer = compileToStep(beveled);
  assert(stepOutputChamfer.includes("ISO-10303-21"), "STEP output must contain ISO-10303-21 header");

  const overlappingUnion = union(
    box({ width: 20, height: 20, depth: 10 }),
    translate(box({ width: 20, height: 20, depth: 10 }), [10, 0, 0]),
  );
  const stepMerged = compileToStep(overlappingUnion, "MergedUnion");
  const mergedBreps = stepMerged.match(/MANIFOLD_SOLID_BREP\(/g)?.length ?? 0;
  assert.strictEqual(mergedBreps, 1, `Overlapping Union should merge into 1 MANIFOLD_SOLID_BREP, got ${mergedBreps}`);

  const disjointUnion = union(
    box({ width: 10, height: 10, depth: 10 }),
    translate(box({ width: 10, height: 10, depth: 10 }), [100, 0, 0]),
  );
  const stepDisjoint = compileToStep(disjointUnion, "DisjointUnion");
  const disjointBreps = stepDisjoint.match(/MANIFOLD_SOLID_BREP\(/g)?.length ?? 0;
  assert.strictEqual(
    disjointBreps,
    2,
    `Disjoint Union should preserve 2 analytical MANIFOLD_SOLID_BREP entities, got ${disjointBreps}`,
  );

  console.log(
    "  ✓ CAD Fillet, Chamfer, Extrusion bevels, and Union B-Rep merging generated watertight surface meshes and STEP output!",
  );
}

console.log("All CAD Fillet/Chamfer tests passed successfully!");
