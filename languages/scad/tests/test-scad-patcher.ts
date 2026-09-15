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

  console.log("✔ ScadPatcher successfully updated source text while preserving comments and CST formatting!");
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
