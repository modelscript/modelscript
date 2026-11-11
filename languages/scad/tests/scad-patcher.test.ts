// SPDX-License-Identifier: AGPL-3.0-or-later

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createWasmParser } from "../src-gen/bindings.js";
import { ScadEvaluator } from "../src/evaluator.js";
import { ScadPatcher } from "../src/patcher.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const wasmPath = path.join(__dirname, "../dist/parser.wasm");

async function main() {
  const wasmBytes = fs.readFileSync(wasmPath);
  const { parser } = await createWasmParser(wasmBytes);

  const originalSource = `// Drone Arm Parameter Definition
arm_length = 200; // Primary structural span
width = 24;

// Central Hub Port
tag_port("hub", "fixed_support") {
  cube([40, 40, 20], center = true);
}

// Chained Arm Beam
cube([arm_length, width, 10])
  .fillet(2.0)
  .translate([20, 0, 0]);
`;

  const tree1 = parser.parse(originalSource);
  const evaluator = new ScadEvaluator();
  const solid1 = evaluator.evaluate(tree1.rootNode);
  console.log("Original arm evaluated successfully.");

  // 1. Simulate dragging length gizmo: change arm_length from 200 to 275
  const patch1 = ScadPatcher.patchVariable(originalSource, tree1.rootNode, "arm_length", 275);
  if (!patch1) {
    throw new Error("Failed to patch arm_length");
  }

  console.log(`Patched arm_length: replaced '${patch1.oldValue}' with '${patch1.newValue}'`);
  console.log("Updated Source Preview:\n" + patch1.updatedSource);

  if (!patch1.updatedSource.includes("arm_length = 275; // Primary structural span")) {
    throw new Error("Inline comment was corrupted during AST patching");
  }

  // 2. Re-parse updated source and verify 0 errors
  const tree2 = parser.parse(patch1.updatedSource);
  if (tree2.rootNode.hasError && tree2.rootNode.hasError()) {
    throw new Error("Patched source failed to re-parse");
  }

  // 3. Patch translation method call: change [20, 0, 0] to [40, 5, 0]
  const patch2 = ScadPatcher.patchTransformArgument(patch1.updatedSource, tree2.rootNode, "translate", 0, [40, 5, 0]);
  if (!patch2) {
    throw new Error("Failed to patch translate argument");
  }

  console.log(`Patched translate: replaced '${patch2.oldValue}' with '${patch2.newValue}'`);
  if (!patch2.updatedSource.includes(".translate([40, 5, 0]);")) {
    throw new Error("Failed to properly patch translate vector in fluent chain");
  }

  const tree3 = parser.parse(patch2.updatedSource);
  const solid2 = evaluator.evaluate(tree3.rootNode);
  if (!solid2) {
    throw new Error("Failed to evaluate solid after second patch");
  }

  // 4. Test patchPrimitiveDimension on literal cube([40, 40, 20])
  const hubCubeNode = ScadPatcher.findChildByType(tree3.rootNode, "CubePrimitive");
  const cubeSource = `cube([100, 50, 10]);\ncylinder(h = 30, r = 15);\nsphere(r = 12);`;
  const treePrimitives = parser.parse(cubeSource);

  // Patch cube Y dimension (index 1) from 50 to 65
  const patchDimCube = ScadPatcher.patchPrimitiveDimension(
    cubeSource,
    treePrimitives.rootNode,
    1,
    65,
    undefined,
    undefined,
    "cube",
  );
  if (!patchDimCube || !patchDimCube.updatedSource.includes("cube([100, 65, 10]);")) {
    throw new Error(`Failed to patch cube dimension: ${patchDimCube?.updatedSource}`);
  }
  console.log("✔ Successfully patched literal cube dimension (50 -> 65)");

  // Re-parse and patch cylinder height (index 1) from 30 to 45
  const treeCyl = parser.parse(patchDimCube.updatedSource);
  const patchDimCylH = ScadPatcher.patchPrimitiveDimension(
    patchDimCube.updatedSource,
    treeCyl.rootNode,
    1,
    45,
    undefined,
    undefined,
    "cylinder",
  );
  if (!patchDimCylH || !patchDimCylH.updatedSource.includes("cylinder(h = 45, r = 15);")) {
    throw new Error(`Failed to patch cylinder height: ${patchDimCylH?.updatedSource}`);
  }
  console.log("✔ Successfully patched cylinder height (30 -> 45)");

  // Re-parse and patch cylinder radius (index 0) from 15 to 22.5
  const treeCylR = parser.parse(patchDimCylH.updatedSource);
  const patchDimCylR = ScadPatcher.patchPrimitiveDimension(
    patchDimCylH.updatedSource,
    treeCylR.rootNode,
    0,
    22.5,
    undefined,
    undefined,
    "cylinder",
  );
  if (!patchDimCylR || !patchDimCylR.updatedSource.includes("cylinder(h = 45, r = 22.5);")) {
    throw new Error(`Failed to patch cylinder radius: ${patchDimCylR?.updatedSource}`);
  }
  console.log("✔ Successfully patched cylinder radius (15 -> 22.5)");

  // Re-parse and patch sphere radius from 12 to 18
  const treeSph = parser.parse(patchDimCylR.updatedSource);
  const patchDimSph = ScadPatcher.patchPrimitiveDimension(
    patchDimCylR.updatedSource,
    treeSph.rootNode,
    0,
    18,
    undefined,
    undefined,
    "sphere",
  );
  if (!patchDimSph || !patchDimSph.updatedSource.includes("sphere(r = 18);")) {
    throw new Error(`Failed to patch sphere radius: ${patchDimSph?.updatedSource}`);
  }
  console.log("✔ Successfully patched sphere radius (12 -> 18)");

  console.log("✔ ScadPatcher successfully updated source text while preserving comments and CST formatting!");
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
