// SPDX-License-Identifier: AGPL-3.0-or-later

import { createWasmParser } from "@modelscript/dsl";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { objLanguage } from "../src/language.js";

describe("WASM GLR Grammar & Language Registration (@modelscript/obj)", () => {
  it("exports objLanguage with beta maturity, .obj/.mtl extensions, and ObjPanel UI metadata", () => {
    assert.equal(objLanguage.name, "obj");
    assert.equal(objLanguage.maturity, "beta");
    assert.deepEqual(objLanguage.fileExtensions, [".obj", ".mtl"]);
    assert.ok(objLanguage.ui?.panels && objLanguage.ui.panels.length >= 1);
    assert.equal(objLanguage.ui.panels[0]?.entry, "./src/ui/ObjPanel.tsx");
  });

  it("parses Wavefront OBJ and MTL inputs cleanly using compiled dist/parser.wasm", async () => {
    const wasmPath = path.resolve(new URL("../dist/parser.wasm", import.meta.url).pathname);
    assert.ok(fs.existsSync(wasmPath), "dist/parser.wasm must exist after build");

    const { parser } = await createWasmParser(wasmPath);

    const objSample = [
      "# Unit triangle",
      "mtllib std.mtl",
      "o TriObj",
      "g MainGroup",
      "usemtl Aluminum",
      "s 1",
      "v 0.0 0.0 0.0",
      "v 1.0 0.0 0.0",
      "v 0.0 1.0 0.0",
      "vt 0.0 0.0",
      "vt 1.0 0.0",
      "vt 0.0 1.0",
      "vn 0.0 0.0 1.0",
      "f 1/1/1 2/2/1 3/3/1",
      "f -3//-1 -2//-1 -1//-1",
    ].join("\n");

    const objTree = parser.parse(objSample);
    assert.ok(objTree.rootNode, "OBJ parse tree must have rootNode");
    assert.equal(
      objTree.rootNode.hasError,
      false,
      `OBJ sample should parse without WASM GLR errors: ${objTree.rootNode.toString()}`,
    );

    const mtlSample = [
      "# Standard material",
      "newmtl Aluminum",
      "Ka 0.2 0.2 0.2",
      "Kd 0.77 0.79 0.82",
      "Ks 0.91 0.92 0.92",
      "Ns 250.0",
      "d 1.0",
      "Ni 1.44",
      "illum 2",
    ].join("\n");

    const mtlTree = parser.parse(mtlSample);
    assert.ok(mtlTree.rootNode, "MTL parse tree must have rootNode");
    assert.equal(mtlTree.rootNode.hasError, false, "MTL sample should parse without WASM GLR errors");
  });
});
