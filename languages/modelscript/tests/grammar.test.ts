// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createWasmParser } from "../src-gen/bindings.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const wasmPath = path.join(__dirname, "../dist/parser.wasm");

test("ModelScript WASM Parser parses mini-AssemblyScript + JSONiq FLWOR", async () => {
  const wasmBytes = fs.readFileSync(wasmPath);
  const { parser } = await createWasmParser(wasmBytes);

  const sampleModelScript = `
import { Resistor, Pin } from "./models/Circuit.mo";

@unmanaged
struct Point {
  x: f64;
  y: f64;
}

function calculateMagnitude(p: Point): f64 {
  return p.x * p.x + p.y * p.y;
}

let count: i32 = 10;
while (count > 0) {
  count = count - 1;
}

let result = 
  for comp in circuit.components
  let r := comp.resistance
  where r > 50.0
  order by r descending
  return comp.name;
`;

  const tree = parser.parse(sampleModelScript);
  assert.ok(tree, "Parser should return a syntax tree");
  const root = tree.rootNode;
  assert.equal(root.type, "SourceFile", "Root node should be SourceFile");
  assert.ok(root.childCount >= 5, "Root node should contain top-level declarations");

  const errors: string[] = [];
  function checkErrors(node: any) {
    if (node.hasError && node.hasError()) {
      errors.push(`Error at [${node.startPosition.row}:${node.startPosition.column}]: ${node.text}`);
    }
    for (let i = 0; i < node.childCount; i++) {
      checkErrors(node.child(i));
    }
  }
  checkErrors(root);

  assert.deepEqual(errors, [], `Parser found syntax errors: \n${errors.join("\n")}`);
});
