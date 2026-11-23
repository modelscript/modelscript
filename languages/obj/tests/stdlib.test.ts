// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildObjCleanroomSchemas,
  generateStandardEngineeringMtl,
  getObjSchemasFromLibraries,
  lookupObjSchema,
  registerBuiltInObjLibrarySync,
} from "../src/catalog/index.js";
import { getObjStdLibWasmBytes } from "../src/catalog/obj-std-lib-data.js";
import { lintMtl } from "../src/lints/index.js";
import { parseMtl } from "../src/parser/index.js";

describe("Cleanroom Standard Library (@modelscript/obj-std-lib)", () => {
  it("registers and exposes OBJ primitives and 5 engineering MTL materials", () => {
    registerBuiltInObjLibrarySync();
    const schemas = getObjSchemasFromLibraries();
    const declared = buildObjCleanroomSchemas();

    assert.equal(schemas.length, declared.length);
    assert.ok(schemas.length >= 13);

    for (const matName of ["Aluminum", "Steel", "Copper", "Glass", "MatteWhite"]) {
      const found = lookupObjSchema(matName);
      assert.ok(found, `Expected standard material '${matName}' in obj-std-lib`);
      assert.ok(found.svg?.includes("<svg"), `Expected cleanroom SVG icon for '${matName}'`);
    }

    assert.ok(lookupObjSchema("UnitCube"));
    assert.ok(lookupObjSchema("Tetrahedron"));
  });

  it("generates a valid standard engineering MTL library with zero lint diagnostics", () => {
    const mtlSrc = generateStandardEngineeringMtl();
    const mtl = parseMtl(mtlSrc);
    assert.equal(mtl.materials.size, 5);
    assert.equal(lintMtl(mtl).length, 0);
  });

  it("executes the compiled AssemblyScript WASM geometry & shading kernel", async () => {
    const wasmBytes = getObjStdLibWasmBytes();
    assert.ok(wasmBytes.byteLength > 0, "Expected non-empty obj-std-lib WASM bytes");

    const { instance } = await WebAssembly.instantiate(wasmBytes, {});
    const exports = instance.exports as {
      objTriangleArea: (
        x0: number,
        y0: number,
        z0: number,
        x1: number,
        y1: number,
        z1: number,
        x2: number,
        y2: number,
        z2: number,
      ) => number;
      objSignedTetVolume: (
        x0: number,
        y0: number,
        z0: number,
        x1: number,
        y1: number,
        z1: number,
        x2: number,
        y2: number,
        z2: number,
      ) => number;
      objFresnelSchlick: (ni: number, cosTheta: number) => number;
      objEvalKernel: (archetypeId: number, a: number, b: number, c: number, d: number) => number;
    };

    const triArea = exports.objTriangleArea(0, 0, 0, 1, 0, 0, 0, 1, 0);
    assert.ok(Math.abs(triArea - 0.5) < 1e-12);

    const tetVol = exports.objSignedTetVolume(1, 0, 0, 0, 1, 0, 0, 0, 1);
    assert.ok(Math.abs(tetVol - 1 / 6) < 1e-12);

    // Normal incidence Fresnel for glass (Ni = 1.5): ((1 - 1.5)/(1 + 1.5))^2 = 0.04
    const fresnel = exports.objFresnelSchlick(1.5, 1.0);
    assert.ok(Math.abs(fresnel - 0.04) < 1e-12);

    const cubeVol = exports.objEvalKernel(1, 2.0, 3.0, 4.0, 0.0);
    assert.ok(Math.abs(cubeVol - 24.0) < 1e-12);
  });
});
