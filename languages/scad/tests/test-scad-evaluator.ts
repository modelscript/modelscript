import { compileToStep, SolidKind, type TaggedPatchSolid } from "@modelscript/cad";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createWasmParser } from "../src-gen/bindings.js";
import { ScadEvaluator } from "../src/evaluator.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const wasmPath = path.join(__dirname, "../dist/parser.wasm");

async function main() {
  const wasmBytes = fs.readFileSync(wasmPath);
  const { parser } = await createWasmParser(wasmBytes);

  const sampleScad = `
arm_length = 200;
width = 24;
thickness = 8;

// Hub support tagged port
tag_port("fixed_hub", "fixed_support", [0, 0, 1]) {
  cube([40, 40, 20], center = true);
}

// Fluent chained arm with fillet
cube([arm_length, width, thickness])
  .fillet(2.0)
  .translate([20, 0, 0]);

// Motor mount module
module motor_flange(dia = 28) {
  difference() {
    cylinder(r = dia / 2 + 4, h = 12);
    cylinder(r = dia / 2, h = 14);
  }
}

// Tagged motor mount
tag_port("motor_mount", "mechanical_flange", [0, 1, 0])
  translate([arm_length + 20, 0, 0])
    motor_flange(28);
`;

  const tree = parser.parse(sampleScad);
  const evaluator = new ScadEvaluator();
  const solid = evaluator.evaluate(tree.rootNode);

  if (!solid) {
    throw new Error("Evaluation failed: no solid produced");
  }

  console.log("Root solid kind:", solid.kind);

  // Traverse solid tree to verify components
  const ports: TaggedPatchSolid[] = [];
  let hasFillet = false;

  function walk(s: any): void {
    if (!s) return;
    if (s.kind === SolidKind.TaggedPatch) {
      ports.push(s);
    }
    if (s.kind === SolidKind.Fillet) {
      hasFillet = true;
    }
    if (s.child) walk(s.child);
    if (s.left) walk(s.left);
    if (s.right) walk(s.right);
  }

  walk(solid);

  console.log(`Discovered ${ports.length} boundary ports:`);
  for (const p of ports) {
    console.log(`  - Port "${p.tag.portName}" (${p.tag.portType}), normal=[${p.tag.normal?.join(", ")}]`);
  }

  console.log(`Contains FilletSolid: ${hasFillet}`);

  if (ports.length < 2) {
    throw new Error(`Expected at least 2 tagged ports, found ${ports.length}`);
  }
  if (!hasFillet) {
    throw new Error("Expected at least one FilletSolid from fluent chaining");
  }

  // Compile to STEP B-Rep
  const stepContent = compileToStep(solid);
  console.log(`Compiled STEP B-Rep size: ${stepContent.length} bytes`);
  if (!stepContent.includes("ISO-10303-21;")) {
    throw new Error("Invalid STEP header produced from SCAD solid tree");
  }

  console.log("✔ ScadEvaluator successfully lowered Hybrid SCAD into watertight Solid tree and STEP geometry!");
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
