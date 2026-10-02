// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createWasmParser } from "../src-gen/bindings.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const wasmPath = path.join(__dirname, "../dist/parser.wasm");

test("Inspect CST structure for FLWOR", async () => {
  const wasmBytes = fs.readFileSync(wasmPath);
  const { parser } = await createWasmParser(wasmBytes);

  const code = `
let highR = 
  for c in components
  let r := c.resistance
  where r > 100
  return c.name;
`;

  const tree = parser.parse(code);
  const root = tree.rootNode;
  assert.equal(root.hasError(), false);

  const nodeTypes: string[] = [];
  function collectTypes(node: any) {
    nodeTypes.push(node.type);
    for (let i = 0; i < node.childCount; i++) {
      collectTypes(node.child(i));
    }
  }
  collectTypes(root);

  assert.ok(nodeTypes.includes("FLWORExpression"), "Should contain FLWORExpression");
  assert.ok(nodeTypes.includes("ForClause"), "Should contain ForClause");
  assert.ok(nodeTypes.includes("LetClause"), "Should contain LetClause");
  assert.ok(nodeTypes.includes("WhereClause"), "Should contain WhereClause");
  assert.ok(nodeTypes.includes("ReturnClause"), "Should contain ReturnClause");
});
