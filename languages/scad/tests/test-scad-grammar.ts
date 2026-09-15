import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createWasmParser } from "../src-gen/bindings.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const wasmPath = path.join(__dirname, "../dist/parser.wasm");

async function main() {
  const wasmBytes = fs.readFileSync(wasmPath);
  const { parser } = await createWasmParser(wasmBytes);

  const sampleScad = `
arm_length = 300;
$fn = 32;

tag_port("fixed_hub", "fixed_support") {
  translate([0, 0, 0])
    cube([40, 40, 20], center = true);
}

cube([arm_length, 25, 10])
  .fillet(2.0)
  .translate([20, 0, 0]);

module motor_mount(dia = 28) {
  difference() {
    cylinder(r = dia / 2 + 4, h = 12);
    cylinder(r = dia / 2, h = 14);
  }
}

tag_port("motor_flange", "mechanical_flange")
  motor_mount(28);
`;

  const tree = parser.parse(sampleScad);
  const root = tree.rootNode;
  console.log("Root node type:", root.type);
  console.log("Root hasError:", root.hasError ? root.hasError() : false);
  console.log("Statements parsed:", root.childCount);

  for (let i = 0; i < root.childCount; i++) {
    const c = root.child(i);
    console.log(`  Statement [${i}]: hasError=${c.hasError()}, text=${JSON.stringify(c.text.trim().split("\n")[0])}`);
  }

  if (root.hasError && root.hasError()) {
    throw new Error("Grammar test failed: AST contains syntax errors");
  }

  console.log("✔ SCAD Grammar fully validated with zero parse errors!");
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
