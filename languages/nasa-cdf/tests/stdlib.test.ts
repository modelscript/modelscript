// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildNasaCdfCleanroomSchemas,
  ensureBuiltInNasaCdfLibraryRegistered,
  getNasaCdfSchemasFromLibraries,
  lookupNasaCdfSchema,
} from "../src/catalog/index.js";
import { getNasaCdfStdLibWasmBytes } from "../src/catalog/nasa-cdf-std-lib-data.js";

describe("NASA CDF Cleanroom Standard Library", () => {
  it("registers @modelscript/nasa-cdf-std-lib with ISTP & magnetometer/plasma schemas", () => {
    ensureBuiltInNasaCdfLibraryRegistered();
    const declared = buildNasaCdfCleanroomSchemas();
    const registered = getNasaCdfSchemasFromLibraries();

    assert.ok(declared.length >= 18);
    assert.equal(registered.length, declared.length);

    const depend0 = lookupNasaCdfSchema("DEPEND_0");
    assert.ok(depend0);
    assert.equal(depend0.category, "ISTP Variable");

    const bGse = lookupNasaCdfSchema("BGSE");
    assert.ok(bGse);
    assert.equal(bGse.name, "B_GSE");
    assert.ok(bGse.svg?.startsWith("<svg"));
  });

  it("compiles and executes the zero-GC AssemblyScript WASM runtime kernel", async () => {
    const wasmBytes = getNasaCdfStdLibWasmBytes();
    assert.ok(wasmBytes.byteLength > 64, "WASM runtime bytes should be non-empty");

    const mod = await WebAssembly.instantiate(wasmBytes, {});
    const exports = mod.instance.exports as {
      cdfMagneticFieldNorm: (bx: number, by: number, bz: number) => number;
      cdfEpochToJ2000Sec: (ms: number) => number;
      cdfEval: (id: number, x: number, p0: number, p1: number) => number;
    };

    assert.ok(Math.abs(exports.cdfMagneticFieldNorm(3, 4, 12) - 13.0) < 1e-12);
    assert.equal(exports.cdfEpochToJ2000Sec(63113947200000.0), 0.0);
    assert.ok(Math.abs(exports.cdfEval(21, 3, 4, 0) - 5.0) < 1e-12);
  });
});
