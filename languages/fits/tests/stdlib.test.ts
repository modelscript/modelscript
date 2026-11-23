// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildFitsCleanroomSchemas,
  getFitsSchemasFromLibraries,
  getFitsStdLibWasmBytes,
  lookupFitsKeywordSchema,
  registerBuiltInFitsLibrarySync,
} from "../src/catalog/index.js";

describe("FITS 4.0 Cleanroom Standard Library & WASM Runtime", () => {
  it("registers and resolves FITS 4.0 mandatory & WCS keyword schemas with SVG icons", () => {
    registerBuiltInFitsLibrarySync();
    const schemas = getFitsSchemasFromLibraries();
    const rawSchemas = buildFitsCleanroomSchemas();

    assert.strictEqual(schemas.length, rawSchemas.length);
    assert.ok(schemas.length >= 9);

    const required = ["SIMPLE", "BITPIX", "NAXIS", "BSCALE", "BZERO", "RA---TAN", "DEC--TAN", "RA---SIN", "RA---ARC"];

    for (const key of required) {
      const found = lookupFitsKeywordSchema(key);
      assert.ok(found, `Expected cleanroom schema for '${key}'`);
      assert.ok(found.svg?.startsWith("<svg "), `Expected SVG icon for '${key}'`);
      assert.ok(found.description.length > 10);
    }

    // Alias lookup
    assert.strictEqual(lookupFitsKeywordSchema("GNOMONIC")?.name, "RA---TAN");
    assert.strictEqual(lookupFitsKeywordSchema("ORTHOGRAPHIC")?.name, "RA---SIN");
  });

  it("instantiates and executes the cleanroom AssemblyScript runtime.wasm kernel", async () => {
    const wasmBytes = getFitsStdLibWasmBytes();
    assert.ok(wasmBytes.byteLength > 100, "WASM runtime bytes should be non-empty");

    const mod = await WebAssembly.compile(new Uint8Array(wasmBytes));
    const instance = await WebAssembly.instantiate(mod);
    const exports = instance.exports as {
      fitsPhysicalScale: (raw: number, bscale: number, bzero: number) => number;
      fitsPhysicalUnscale: (phys: number, bscale: number, bzero: number) => number;
      fitsWcsNativeTheta: (projCode: number, rDeg: number) => number;
      fitsFluxToMag: (flux: number, zp: number) => number;
      fitsEval: (arch: number, x: number, p0: number, p1: number) => number;
    };

    const phys = exports.fitsPhysicalScale(1000, 0.5, 32768);
    assert.strictEqual(phys, 33268);
    assert.strictEqual(exports.fitsPhysicalUnscale(phys, 0.5, 32768), 1000);

    // TAN native theta at r = 0 deg is pi/2
    assert.ok(Math.abs(exports.fitsWcsNativeTheta(0, 0.0) - Math.PI / 2) < 1e-12);
    // ARC native theta at r = 10 deg is (90 - 10) deg in rad
    assert.ok(Math.abs(exports.fitsWcsNativeTheta(2, 10.0) - (80.0 * Math.PI) / 180.0) < 1e-12);

    // Flux to magnitude: flux = 100, zp = 25 -> 25 - 2.5*2 = 20
    assert.ok(Math.abs(exports.fitsFluxToMag(100.0, 25.0) - 20.0) < 1e-12);
    assert.strictEqual(exports.fitsEval(4, 1000, 0.5, 32768), 33268);
  });
});
