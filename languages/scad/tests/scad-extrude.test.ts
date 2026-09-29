// SPDX-License-Identifier: AGPL-3.0-or-later

import { compileToStep, ManifoldWorker, SolidKind, type ExtrusionSolid } from "@modelscript/cad";
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

  console.log("All 2D Sketch and linear_extrude() tests passed successfully!");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
