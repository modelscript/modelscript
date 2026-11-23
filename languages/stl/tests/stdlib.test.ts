// SPDX-License-Identifier: AGPL-3.0-or-later

import { globalLibraryRegistry } from "@modelscript/runtime";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  STL_PRIMITIVE_SPECS,
  StlArchetypeId,
  getStlSchemasFromLibraries,
  lookupStlModelSchema,
  registerBuiltInStlLibrarySync,
} from "../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STD_LIB_DIR = path.resolve(__dirname, "../assets/stl-std-lib");

describe("@modelscript/stl — Cleanroom Standard Library (@modelscript/stl-std-lib)", () => {
  it("loads @modelscript/stl-std-lib via modelscript.yaml with symbols, SVG icons, and runtime.wasm", async () => {
    const manifestPath = path.join(STD_LIB_DIR, "modelscript.yaml");
    assert.ok(fs.existsSync(manifestPath), "Expected stl-std-lib/modelscript.yaml");

    const pkg = await globalLibraryRegistry.loadLibraryFromDir(STD_LIB_DIR);
    assert.ok(pkg, "Expected loadLibraryFromDir to return loaded package");
    assert.equal(pkg.packageName, "@modelscript/stl-std-lib");
    assert.equal(pkg.manifest.language, "stl");
    assert.equal(pkg.symbols.length, STL_PRIMITIVE_SPECS.length);
    assert.equal(pkg.diagrams.length, STL_PRIMITIVE_SPECS.length);
    assert.ok(pkg.wasmBytes && pkg.wasmBytes.byteLength > 0, "Expected compiled runtime.wasm bytes");

    for (const diag of pkg.diagrams) {
      assert.ok(diag.svg && diag.svg.startsWith("<svg"), `Expected SVG icon for ${diag.namePath}`);
    }
  });

  it("supports zero-I/O sync registration and alias lookup for canonical primitives", () => {
    registerBuiltInStlLibrarySync();
    const schemas = getStlSchemasFromLibraries();
    assert.ok(schemas.length >= STL_PRIMITIVE_SPECS.length);

    assert.equal(lookupStlModelSchema("UNIT_CUBE")?.name, "UNIT_CUBE");
    assert.equal(lookupStlModelSchema("cube")?.name, "UNIT_CUBE");
    assert.equal(lookupStlModelSchema("tetrahedron")?.name, "REGULAR_TETRAHEDRON");
    assert.equal(lookupStlModelSchema("oct")?.name, "OCTAHEDRON");
    assert.equal(lookupStlModelSchema("cyl")?.name, "CYLINDER");
    assert.equal(lookupStlModelSchema("icosphere")?.name, "SPHERE_ICOSAHEDRON");
  });

  it("executes runtime.wasm stlModelEval for UNIT_CUBE and TETRAHEDRON with exact analytical parity", async () => {
    const pkg = await globalLibraryRegistry.loadLibraryFromDir(STD_LIB_DIR);
    assert.ok(pkg?.wasmBytes, "Expected runtime.wasm bytes");

    const { instance } = await WebAssembly.instantiate(pkg.wasmBytes, {});
    const exports = instance.exports as {
      memory: WebAssembly.Memory;
      stlModelEval: (archetypeId: number, slotPtr: number, conCount: number) => void;
    };

    const slotPtr = 4096;
    if (exports.memory.buffer.byteLength < slotPtr + 2048) {
      exports.memory.grow(1);
    }
    const conView = new Float64Array(exports.memory.buffer, slotPtr + 0x080, 4);
    const ioView = new Float64Array(exports.memory.buffer, slotPtr + 0x780, 8);

    // Unit cube: side=1, density=1 -> V=1, A=6, Ixx=1/6, chi=2
    conView[0] = 1.0;
    conView[1] = 1.0;
    exports.stlModelEval(StlArchetypeId.UNIT_CUBE, slotPtr, 2);
    assert.ok(Math.abs(ioView[0]! - 1.0) < 1e-12);
    assert.ok(Math.abs(ioView[1]! - 6.0) < 1e-12);
    assert.ok(Math.abs(ioView[3]! - 1.0 / 6.0) < 1e-12);
    assert.equal(ioView[6], 2.0);

    // Tetrahedron: scale=1, density=1 -> V=1/6, chi=2
    conView[0] = 1.0;
    conView[1] = 1.0;
    exports.stlModelEval(StlArchetypeId.REGULAR_TETRAHEDRON, slotPtr, 2);
    assert.ok(Math.abs(ioView[0]! - 1.0 / 6.0) < 1e-12);
    assert.equal(ioView[6], 2.0);
  });
});
