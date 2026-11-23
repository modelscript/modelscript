// SPDX-License-Identifier: AGPL-3.0-or-later

import { globalLibraryRegistry } from "@modelscript/runtime";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  GAMS_MODEL_SPECS,
  getGamsSchemasFromLibraries,
  getGamsStdLibWasmBytes,
  lookupGamsModelSchema,
  registerBuiltInGamsLibrarySync,
} from "../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STD_LIB_DIR = path.resolve(__dirname, "../assets/gams-std-lib");

describe("@modelscript/gams — Cleanroom Standard Library (@modelscript/gams-std-lib)", () => {
  it("loads @modelscript/gams-std-lib via modelscript.yaml with symbols, SVG icons, and runtime.wasm", async () => {
    const manifestPath = path.join(STD_LIB_DIR, "modelscript.yaml");
    assert.ok(fs.existsSync(manifestPath), "Expected gams-std-lib/modelscript.yaml");

    const pkg = await globalLibraryRegistry.loadLibraryFromDir(STD_LIB_DIR);
    assert.ok(pkg, "Expected loadLibraryFromDir to return loaded package");
    assert.equal(pkg.packageName, "@modelscript/gams-std-lib");
    assert.equal(pkg.manifest.language, "gams");
    assert.equal(pkg.symbols.length, GAMS_MODEL_SPECS.length);
    assert.equal(pkg.diagrams.length, GAMS_MODEL_SPECS.length);
    assert.ok(pkg.wasmBytes && pkg.wasmBytes.byteLength > 0, "Expected compiled runtime.wasm bytes");

    for (const diag of pkg.diagrams) {
      assert.ok(diag.svg && diag.svg.startsWith("<svg"), `Expected cleanroom SVG icon for ${diag.namePath}`);
      assert.ok(diag.ports.length > 0, `Expected diagram ports for ${diag.namePath}`);
    }
  });

  it("supports zero-I/O sync registration and case-insensitive schema lookup for operators and archetypes", () => {
    registerBuiltInGamsLibrarySync();
    const schemas = getGamsSchemasFromLibraries();
    assert.ok(schemas.length >= GAMS_MODEL_SPECS.length);

    for (const op of ["sum", "prod", "smin", "smax", "ord", "card", "sameas", "trnsport", "diet", "blend"]) {
      const schema = lookupGamsModelSchema(op);
      assert.ok(schema, `Expected schema for '${op}'`);
      assert.equal(schema.name, op);
    }
    assert.equal(lookupGamsModelSchema("TRNSPORT")?.name, "trnsport");
    assert.equal(lookupGamsModelSchema("GAMS.sum")?.name, "sum");
  });

  it("executes GAMS intrinsic operators and trnsport/diet/blend kernels in runtime.wasm", async () => {
    const wasmBytes = getGamsStdLibWasmBytes();
    const { instance } = await WebAssembly.instantiate(wasmBytes);
    const exports = instance.exports as {
      memory: WebAssembly.Memory;
      gams_sum: (ptr: number, len: number) => number;
      gams_prod: (ptr: number, len: number) => number;
      gams_smin: (ptr: number, len: number) => number;
      gams_smax: (ptr: number, len: number) => number;
      gams_ord: (idx: number) => number;
      gams_card: (count: number) => number;
      gams_sameas: (a: number, b: number) => number;
      gams_trnsport_cost: (f: number, a: number, b: number, c: number, d: number, e: number, g: number) => number;
    };

    const ptr = 1024;
    const f64 = new Float64Array(exports.memory.buffer, ptr, 4);
    f64.set([2.0, 3.0, 5.0, 10.0]);

    assert.equal(exports.gams_sum(ptr, 4), 20.0);
    assert.equal(exports.gams_prod(ptr, 4), 300.0);
    assert.equal(exports.gams_smin(ptr, 4), 2.0);
    assert.equal(exports.gams_smax(ptr, 4), 10.0);
    assert.equal(exports.gams_ord(0), 1);
    assert.equal(exports.gams_card(3), 3);
    assert.equal(exports.gams_sameas(7, 7), 1);
    assert.equal(exports.gams_sameas(7, 8), 0);

    // Classic Dantzig optimal shipment vector: x('seattle','new-york')=50, x('seattle','chicago')=300,
    // x('san-diego','new-york')=275, x('san-diego','topeka')=275 -> cost = 153.675
    const cost = exports.gams_trnsport_cost(90.0, 50.0, 300.0, 0.0, 275.0, 0.0, 275.0);
    assert.ok(Math.abs(cost - 153.675) < 1e-9, `Expected 153.675, got ${cost}`);
  });
});
