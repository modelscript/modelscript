// SPDX-License-Identifier: AGPL-3.0-or-later

import { createWasmParser } from "@modelscript/modelica/parser";
import { initBltWasm } from "@modelscript/runtime";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { Context } from "../src/context.js";
import { NodeFileSystem } from "./node-filesystem.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const modelicaWasm = path.resolve(__dirname, "../dist/parser.wasm");

describe("Modelica Array Preservation in WASM Flattener", async () => {
  it("preserves multidimensional array declarations without premature scalarization", async () => {
    const { parser } = await createWasmParser(modelicaWasm);
    Context.registerParser(".mo", parser as any);
    await initBltWasm();

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mo-arr-test-"));
    const tempMoPath = path.join(tempDir, "VectorODE.mo");
    const modelContent = `model VectorODE
  parameter Integer N = 10;
  Real x[N](start = ones(N));
equation
  der(x) = -x;
end VectorODE;
`;
    fs.writeFileSync(tempMoPath, modelContent, "utf8");

    try {
      const contextPreserve = Context.createBatch(new NodeFileSystem());
      await contextPreserve.addLibrary(tempMoPath);
      const daePreserve = contextPreserve.flattenArena("VectorODE", undefined, undefined, { arrayMode: "preserve" });
      assert.ok(daePreserve);

      assert.strictEqual(daePreserve.varCount, 2);
      assert.strictEqual(daePreserve.eqCount, 1);
      assert.strictEqual(daePreserve.getVarTotalScalarElements(), 11);

      const xVarIdx = daePreserve.getVarIdxByName("x");
      assert.ok(xVarIdx >= 0);
      const shape = daePreserve.getVarShape(xVarIdx);
      assert.deepStrictEqual(shape, [10]);
      assert.strictEqual(daePreserve.getVarShapeElementCount(xVarIdx), 10);
      assert.strictEqual(daePreserve.getVarIdxByName("x[1]"), -1);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
