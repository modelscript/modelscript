// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildRinexCleanroomSchemas,
  getRinexSchemasFromLibraries,
  lookupRinexSchema,
  registerBuiltInRinexLibrarySync,
} from "../src/catalog/index.js";
import { getRinexStdLibWasmBytes } from "../src/catalog/rinex-std-lib-data.js";

describe("RINEX Cleanroom Standard Library (@modelscript/rinex-std-lib)", () => {
  it("registers observation types (C1, P1, P2, L1, L2, D1, S1) and WGS-84 constants", () => {
    registerBuiltInRinexLibrarySync();
    const schemas = getRinexSchemasFromLibraries();
    assert.ok(schemas.length >= 11);

    const requiredNames = [
      "C1",
      "P1",
      "P2",
      "L1",
      "L2",
      "D1",
      "S1",
      "WGS84_MU",
      "WGS84_OMEGA_E_DOT",
      "SPEED_OF_LIGHT",
      "GPS_F_REL",
    ];
    for (const name of requiredNames) {
      const found = lookupRinexSchema(name);
      assert.ok(found, `Expected schema '${name}' in rinex-std-lib`);
      assert.ok(found.svg && found.svg.includes("<svg"), `Expected cleanroom SVG icon for '${name}'`);
    }
  });

  it("embeds a valid AssemblyScript runtime.wasm binary and executes GNSS kernels", async () => {
    const wasmBytes = getRinexStdLibWasmBytes();
    assert.ok(wasmBytes.byteLength > 0, "Expected non-empty WASM stdlib bytes");

    const { instance } = await WebAssembly.instantiate(wasmBytes);
    const exports = instance.exports as {
      solveKepler: (m: number, e: number) => number;
      relativisticClockCorrection: (e: number, sqrtA: number, E: number) => number;
      geometricRange: (sx: number, sy: number, sz: number, rx: number, ry: number, rz: number) => number;
      rinexModelEval: (id: number) => number;
    };

    const E = exports.solveKepler(1.0, 0.01);
    assert.ok(Math.abs(E - 0.01 * Math.sin(E) - 1.0) < 1e-13);

    const relClk = exports.relativisticClockCorrection(0.01, 5153.65, E);
    assert.ok(relClk < 0 && Math.abs(relClk) < 1e-7);

    const rng = exports.geometricRange(3, 4, 0, 0, 0, 0);
    assert.ok(Math.abs(rng - 5.0) < 1e-12);

    assert.strictEqual(exports.rinexModelEval(20), 3.986005e14);
    assert.strictEqual(exports.rinexModelEval(22), 299792458.0);
    assert.strictEqual(buildRinexCleanroomSchemas().length, 11);
  });
});
