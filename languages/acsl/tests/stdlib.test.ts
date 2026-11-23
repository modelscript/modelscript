// SPDX-License-Identifier: AGPL-3.0-or-later

import { globalLibraryRegistry } from "@modelscript/runtime";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getAcslStdLibWasmBytes } from "../src/catalog/acsl-std-lib-data.js";
import {
  ACSL_OPERATOR_SPECS,
  AcslArchetypeId,
  ensureBuiltInAcslLibraryRegistered,
  getAcslSchemasFromLibraries,
  lookupAcslOperatorSchema,
} from "../src/catalog/index.js";

const REQUIRED_OPERATORS = [
  "INTEG",
  "REALPL",
  "CMPXPL",
  "LEDLAG",
  "DELAY",
  "PULSE",
  "RAMP",
  "STEP",
  "BOUND",
  "DEAD",
  "QUANT",
  "SW",
  "ZHOLD",
  "LIMINT",
];

describe("ACSL Cleanroom Standard Library & WASM Runtime", () => {
  it("registers @modelscript/acsl-std-lib in globalLibraryRegistry with all 14 operators and SVG icons", () => {
    ensureBuiltInAcslLibraryRegistered();
    const pkgs = globalLibraryRegistry.getPackagesForLanguage("acsl");
    assert.ok(pkgs.length >= 1, "Expected @modelscript/acsl-std-lib registered");

    const schemas = getAcslSchemasFromLibraries();
    assert.strictEqual(schemas.length, 14);
    assert.strictEqual(ACSL_OPERATOR_SPECS.length, 14);

    for (const op of REQUIRED_OPERATORS) {
      const schema = lookupAcslOperatorSchema(op);
      assert.ok(schema, `Missing schema for ACSL operator ${op}`);
      assert.ok(schema.svg && schema.svg.startsWith("<svg"), `Expected SVG icon for ${op}`);
      assert.ok(schema.ports.length >= 1, `Expected ports for ${op}`);
    }
  });

  it("executes compiled AssemblyScript runtime.wasm kernel for REALPL, STEP, BOUND, and QUANT", async () => {
    const wasmBytes = getAcslStdLibWasmBytes();
    assert.ok(wasmBytes.byteLength > 100, "Expected non-empty compiled runtime.wasm");

    const { instance } = await WebAssembly.instantiate(wasmBytes, {});
    const exports = instance.exports as unknown as {
      memory: WebAssembly.Memory;
      acslModelInit: (arch: number, slot: number, conCount: number) => void;
      acslModelStep: (arch: number, t: number, dt: number, slot: number, conCount: number) => void;
    };

    // Ensure at least 1 page (64 KiB) of WASM linear memory and use a 2048-byte aligned slot
    if (exports.memory.buffer.byteLength < 8192) {
      exports.memory.grow(1);
    }
    const slot = 4096;
    const f64 = new Float64Array(exports.memory.buffer);
    const conOff = (slot + 0x080) >> 3;
    const ioOff = (slot + 0x780) >> 3;

    // 1. REALPL(tau=1.0, u=1.0, ic=0.0) over t=0..1 -> y(1) = 1 - exp(-1) ≈ 0.63212
    f64[conOff + 0] = 1.0; // tau
    f64[conOff + 1] = 0.0; // ic
    exports.acslModelInit(AcslArchetypeId.REALPL, slot, 2);
    f64[ioOff + 0] = 1.0; // u = 1.0
    const dt = 0.01;
    for (let step = 0; step < 100; step++) {
      exports.acslModelStep(AcslArchetypeId.REALPL, step * dt, dt, slot, 2);
    }
    const yRealpl = f64[ioOff + 3]!;
    const expected = 1.0 - Math.exp(-1.0);
    assert.ok(Math.abs(yRealpl - expected) < 1e-4, `REALPL expected ${expected}, got ${yRealpl}`);

    // 2. BOUND(lo=-2, hi=2, u=5) -> 2
    f64[conOff + 0] = -2.0;
    f64[conOff + 1] = 2.0;
    f64[ioOff + 0] = 5.0;
    exports.acslModelStep(AcslArchetypeId.BOUND, 0.0, 0.01, slot, 2);
    assert.strictEqual(f64[ioOff + 3], 2.0);

    // 3. QUANT(q=0.25, u=0.63) -> 0.75
    f64[conOff + 0] = 0.25;
    f64[ioOff + 0] = 0.63;
    exports.acslModelStep(AcslArchetypeId.QUANT, 0.0, 0.01, slot, 1);
    assert.ok(Math.abs(f64[ioOff + 3]! - 0.75) < 1e-12);
  });
});
