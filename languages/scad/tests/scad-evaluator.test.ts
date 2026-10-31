// SPDX-License-Identifier: AGPL-3.0-or-later

import { compileToStep, SolidKind, type TaggedPatchSolid } from "@modelscript/cad";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createWasmParser } from "../src-gen/bindings.js";
import { evaluateScad, ScadEvaluator } from "../src/evaluator.js";

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

  // Verify module/function hoisting, axis-angle rotate, named v= transforms, and composite 2D linear_extrude
  const hoistedScad = `
hoisted_box(double_val(10));
rotate(a = 45, v = [0, 1, 0])
  translate(v = [5, 0, 0])
    scale(v = [1, 2, 1])
      mirror(v = [1, 0, 0])
        linear_extrude(height = 15, twist = 30, scale = 0.8) {
          difference() {
            square([20, 20], center = true);
            circle(r = 4);
          }
        }
module hoisted_box(s = default_size) {
  cube([s, s, s]);
}
function double_val(x) = x * 2;
default_size = 12;
`;
  const hoistedTree = parser.parse(hoistedScad);
  const hoistedSolid = evaluator.evaluate(hoistedTree.rootNode);
  if (!hoistedSolid) {
    throw new Error("Expected hoisted SCAD program to evaluate to a valid Solid");
  }

  // Verify degenerate polygon (< 3 points) returns null instead of fabricating a triangle
  const degenTree = parser.parse(`polygon([[0, 0], [1, 1]]);`);
  const degenSolid = new ScadEvaluator().evaluate(degenTree.rootNode);
  if (degenSolid !== null) {
    throw new Error("Expected degenerate 2-point polygon to return null");
  }

  // Verify synchronous evaluateScad with user-defined modules + children(), functions, for loops, conditionals & booleans
  const parametricFlangeScad = `
bolt_count = 4;
pitch_radius = 18;
use_chamfer_boss = true;
boss_h = use_chamfer_boss ? 16 : 10;
vec_list = [for (k = [0 : 1 : 3]) k * 90];

function deg_x(r, ang) = r * cos(ang);
function deg_y(r, ang) = r * sin(ang);

module polar_copy(n = 4, r = 18) {
  for (i = [0 : 1 : n - 1]) {
    ang = i * (360 / n);
    translate([deg_x(r, ang), deg_y(r, ang), 0])
      children();
  }
}

difference() {
  union() {
    cylinder(h = 6, r = 25, center = true);
    if (use_chamfer_boss) {
      cylinder(h = boss_h, r = 12, center = true);
    } else {
      cube([20, 20, 10], center = true);
    }
  }
  // Center bore + bolt holes via polar_copy and children()
  cylinder(h = 24, r = 6, center = true);
  polar_copy(bolt_count, pitch_radius) {
    cylinder(h = 20, r = 2.5, center = true);
  }
}
`;

  const evalRes = evaluateScad(parametricFlangeScad);
  if (!evalRes.solid || evalRes.kind !== SolidKind.Subtract) {
    throw new Error(`Expected Subtract root solid from evaluateScad, got ${evalRes.kind}`);
  }
  if (evalRes.variables.boss_h !== 16) {
    throw new Error(`Expected boss_h = 16, got ${evalRes.variables.boss_h}`);
  }
  if (!Array.isArray(evalRes.variables.vec_list) || evalRes.variables.vec_list.length !== 4) {
    throw new Error("Expected list comprehension vec_list of length 4");
  }
  if (evalRes.primitives.length < 7) {
    throw new Error(
      `Expected at least 7 leaf primitives (flange + boss + bore + 4 bolt holes), got ${evalRes.primitives.length}`,
    );
  }
  if (evalRes.triangleCount <= 0 || evalRes.vertices.length === 0) {
    throw new Error("Expected non-empty tessellated mesh from evaluateScad");
  }
  const bbox = evalRes.boundingBox;
  if (bbox.max[0] - bbox.min[0] < 45) {
    throw new Error(`Expected bounding box X span >= 45, got ${bbox.max[0] - bbox.min[0]}`);
  }

  console.log("✔ ScadEvaluator successfully lowered Hybrid SCAD into watertight Solid tree and STEP geometry!");
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
