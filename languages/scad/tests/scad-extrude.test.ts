// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  compileToStep,
  computeMeshVolumeAndArea,
  ManifoldWorker,
  SolidKind,
  type ExtrusionSolid,
} from "@modelscript/cad";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createWasmParser } from "../src-gen/bindings.js";
import { ScadEvaluator } from "../src/evaluator.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const wasmPath = path.join(__dirname, "../dist/parser.wasm");

console.log("=== Testing Hybrid SCAD 2D Sketch Profiles & linear_extrude() ===");

async function main() {
  const wasmBytes = fs.readFileSync(wasmPath);
  const { parser } = await createWasmParser(wasmBytes);

  // 1. Polygon linear extrusion
  const polygonScad = `
  linear_extrude(height = 25) {
    polygon(points = [[0, 0], [40, 0], [35, 15], [0, 15]]);
  }
  `;

  const tree1 = parser.parse(polygonScad);
  const evaluator1 = new ScadEvaluator();
  const solid1 = evaluator1.evaluate(tree1.rootNode);

  assert(solid1, "Solid1 must not be null");
  assert.strictEqual(solid1.kind, SolidKind.Extrusion);
  const ext1 = solid1 as ExtrusionSolid;
  assert.strictEqual(ext1.height, 25);
  assert.strictEqual(ext1.polygon.length, 4);
  console.log(`  ✓ Evaluated polygon extrusion: height = ${ext1.height}, vertices = ${ext1.polygon.length}`);

  // Watertight surface evaluation
  const mesh1 = ManifoldWorker.evaluateSolid(ext1);
  assert(mesh1.vertices.length > 0, "Mesh1 vertices must not be empty");
  assert(mesh1.indices.length > 0, "Mesh1 indices must not be empty");
  const triCount1 = mesh1.indices.length / 3;
  console.log(`  ✓ Generated watertight mesh: ${mesh1.vertices.length / 3} vertices, ${triCount1} triangles`);

  // STEP export check
  const step1 = compileToStep(ext1);
  assert(step1.includes("ISO-10303-21;"), "STEP output must contain ISO-10303-21 header");
  assert(step1.includes("ADVANCED_BREP_SHAPE_REPRESENTATION"), "STEP output must contain BREP representation");
  console.log("  ✓ Compiled polygon extrusion to STEP Part 21");

  // 2. Circle linear extrusion
  const circleScad = `
  $fn = 16;
  linear_extrude(height = 30) {
    circle(r = 12);
  }
  `;

  const tree2 = parser.parse(circleScad);
  const evaluator2 = new ScadEvaluator();
  const solid2 = evaluator2.evaluate(tree2.rootNode);

  assert(solid2, "Solid2 must not be null");
  assert.strictEqual(solid2.kind, SolidKind.Extrusion);
  const ext2 = solid2 as ExtrusionSolid;
  assert.strictEqual(ext2.height, 30);
  assert.strictEqual(ext2.polygon.length, 16);
  console.log(`  ✓ Evaluated circle extrusion: height = ${ext2.height}, faceted segments = ${ext2.polygon.length}`);

  const mesh2 = ManifoldWorker.evaluateSolid(ext2);
  assert(mesh2.indices.length > 0);
  console.log(`  ✓ Generated circle extrusion mesh: ${mesh2.indices.length / 3} triangles`);

  // 3. Square linear extrusion with twist and scale
  const twistedScad = `
  linear_extrude(height = 40, twist = 45, scale = 0.5) {
    square([20, 20], center = true);
  }
  `;

  const tree3 = parser.parse(twistedScad);
  const evaluator3 = new ScadEvaluator();
  const solid3 = evaluator3.evaluate(tree3.rootNode);

  assert(solid3, "Solid3 must not be null");
  assert.strictEqual(solid3.kind, SolidKind.Extrusion);
  const ext3 = solid3 as ExtrusionSolid;
  assert.strictEqual(ext3.height, 40);
  assert.strictEqual(ext3.twist, 45);
  assert.strictEqual(ext3.scale, 0.5);
  console.log(
    `  ✓ Evaluated twisted square extrusion: height = ${ext3.height}, twist = ${ext3.twist}°, scale = ${ext3.scale}`,
  );

  const mesh3 = ManifoldWorker.evaluateSolid(ext3);
  assert(mesh3.indices.length > 0);
  console.log(`  ✓ Generated twisted extrusion mesh: ${mesh3.indices.length / 3} triangles`);

  // 4. Hollow curved nacelle profile rotate_extrude (must revolve exact profile, NOT coerce to torus)
  const revolveRingScad = `
  rotate_extrude(angle = 360, $fn = 24) {
    polygon(points = [[10, 0], [14, 2], [15, 10], [11, 14], [10, 8]]);
  }
  `;
  const tree4 = parser.parse(revolveRingScad);
  const solid4 = new ScadEvaluator().evaluate(tree4.rootNode);
  assert(solid4, "Solid4 must not be null");
  assert.strictEqual(
    solid4.kind,
    SolidKind.Revolve,
    `Hollow closed polygon rotate_extrude should produce Revolve solid, got kind=${solid4.kind}`,
  );
  const mesh4 = ManifoldWorker.evaluateSolid(solid4);
  assert(mesh4.vertices.length > 0 && mesh4.indices.length > 0, "Revolved ring mesh must be non-empty");
  const stats4 = computeMeshVolumeAndArea(mesh4);
  assert(stats4.volume > 0, `Expected positive outward volume for CCW revolved ring, got ${stats4.volume}`);
  const step4 = compileToStep(solid4, "RevolvedNacelleRing");
  assert(step4.includes("CLOSED_SHELL") && step4.includes("MANIFOLD_SOLID_BREP"));
  console.log(
    `  ✓ Evaluated curved hollow rotate_extrude profile: ${mesh4.indices.length / 3} triangles, vol=${stats4.volume.toFixed(1)}`,
  );

  // CW vertex order must also produce positive outward normals (watertight lathe winding)
  const cwScad = `
  rotate_extrude(angle = 360, $fn = 24) {
    polygon(points = [[10, 8], [11, 14], [15, 10], [14, 2], [10, 0]]);
  }
  `;
  const solidCw = new ScadEvaluator().evaluate(parser.parse(cwScad).rootNode);
  assert(solidCw && solidCw.kind === SolidKind.Revolve);
  const statsCw = computeMeshVolumeAndArea(ManifoldWorker.evaluateSolid(solidCw));
  assert(statsCw.volume > 0, `Expected positive outward volume for CW revolved ring, got ${statsCw.volume}`);

  // 5. Axis-touching r = 0 nose cone rotate_extrude
  const coneProfileScad = `
  rotate_extrude(angle = 360, $fn = 20) {
    polygon(points = [[0, 0], [8, 0], [5, 12], [0, 18]]);
  }
  `;
  const tree5 = parser.parse(coneProfileScad);
  const solid5 = new ScadEvaluator().evaluate(tree5.rootNode);
  assert(solid5, "Solid5 must not be null");
  assert.strictEqual(solid5.kind, SolidKind.Revolve);
  const mesh5 = ManifoldWorker.evaluateSolid(solid5);
  assert(mesh5.vertices.length > 0 && mesh5.indices.length > 0, "Axis-touching nose cone mesh must be non-empty");
  const stats5 = computeMeshVolumeAndArea(mesh5);
  assert(stats5.volume > 0, `Expected positive outward volume for r=0 nose cone, got ${stats5.volume}`);
  console.log(
    `  ✓ Evaluated r=0 apex rotate_extrude profile: ${mesh5.indices.length / 3} triangles, vol=${stats5.volume.toFixed(1)}`,
  );

  console.log("All 2D Sketch and linear/rotate_extrude() tests passed successfully!");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
