// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test, { describe } from "node:test";
import { fileURLToPath } from "node:url";
import { createWasmParser } from "../src-gen/bindings.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const wasmPath = path.join(__dirname, "../dist/parser.wasm");

describe("@modelscript/c WASM GLR Parser Suite", () => {
  test("WASM parser parses C99 functions, structs, loops, and expressions", async () => {
    assert.ok(fs.existsSync(wasmPath), "parser.wasm should exist");
    const wasmBytes = fs.readFileSync(wasmPath);
    const { parser } = await createWasmParser(wasmBytes);

    const cSample = `
typedef struct {
  double kp;
  double ki;
  double kd;
} PidParams;

double compute_pid(double error, double dt, PidParams* p) {
  double output = 0.0;
  output = error * p->kp;
  if (output > 100.0) {
    output = 100.0;
  } else if (output < -100.0) {
    output = -100.0;
  }
  for (int i = 0; i < 5; i++) {
    output += 0.1;
  }
  return output;
}
`;

    const tree = parser.parse(cSample);
    assert.ok(tree, "Parser should return syntax tree");
    const root = tree.rootNode;
    assert.equal(root.type, "SourceFile");
    assert.ok(root.childCount > 0);

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
    assert.deepEqual(errors, [], `Parser found errors:\n${errors.join("\n")}`);
  });
});
