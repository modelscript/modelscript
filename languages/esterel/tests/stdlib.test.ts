// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ESTEREL_PATTERN_SPECS,
  EsterelArchetypeId,
  buildEsterelCleanroomSchemas,
  getEsterelSchemasFromLibraries,
  getEsterelStdLibWasmBytes,
  lookupEsterelPatternSchema,
  registerBuiltInEsterelLibrarySync,
} from "../src/catalog/index.js";
import { lintEsterel } from "../src/lints/index.js";

describe("Esterel Cleanroom Standard Library", () => {
  it("registers and exposes all 6 canonical Esterel reactive patterns with SVG icons", () => {
    registerBuiltInEsterelLibrarySync();
    const schemas = getEsterelSchemasFromLibraries();
    assert.strictEqual(schemas.length, 6);

    const names = schemas.map((s) => s.name);
    for (const expected of ["ABRO", "Watchdog", "Debouncer", "Arbiter", "Timeout", "Stopwatch"]) {
      assert.ok(names.includes(expected), `Expected pattern ${expected}`);
      const found = lookupEsterelPatternSchema(expected);
      assert.ok(found, `lookupEsterelPatternSchema(${expected}) should resolve`);
      assert.ok(found.svg?.startsWith("<svg"), `${expected} should have cleanroom SVG block icon`);
      assert.ok(found.ports && found.ports.length >= 2, `${expected} should have signal ports`);
    }

    // Alias lookup
    assert.strictEqual(lookupEsterelPatternSchema("WDT")?.name, "Watchdog");
    assert.strictEqual(lookupEsterelPatternSchema("BerryABRO")?.name, "ABRO");
  });

  it("ensures every built-in Esterel pattern source parses and lints with zero errors", () => {
    for (const spec of ESTEREL_PATTERN_SPECS) {
      const diags = lintEsterel(spec.esterelSource).filter((d) => d.severity === "error");
      assert.strictEqual(diags.length, 0, `Pattern ${spec.patternType} had lint errors: ${JSON.stringify(diags)}`);
    }
    assert.strictEqual(buildEsterelCleanroomSchemas().length, ESTEREL_PATTERN_SPECS.length);
  });

  it("instantiates and executes the compiled AssemblyScript WASM stdlib kernel for ABRO", async () => {
    const wasmBytes = getEsterelStdLibWasmBytes();
    assert.ok(wasmBytes.byteLength > 100, "WASM stdlib runtime should be non-empty");

    const { instance } = await WebAssembly.instantiate(wasmBytes);
    const exports = instance.exports as {
      memory: WebAssembly.Memory;
      initSlot: (slot: number, arch: number) => void;
      stepSlot: (slot: number) => number;
    };

    const mem = new Int32Array(exports.memory.buffer);
    const slot = 2048; // byte offset
    const inOff = (slot + 0x60) >> 2;
    const outOff = (slot + 0xa0) >> 2;

    exports.initSlot(slot, EsterelArchetypeId.ABRO);

    const stepAbro = (a: number, b: number, r: number): number => {
      mem[inOff + 0] = a;
      mem[inOff + 1] = b;
      mem[inOff + 2] = r;
      exports.stepSlot(slot);
      return mem[outOff + 0]!;
    };

    assert.strictEqual(stepAbro(0, 0, 0), 0); // tick 0: entry
    assert.strictEqual(stepAbro(1, 0, 0), 0); // tick 1: A
    assert.strictEqual(stepAbro(0, 1, 0), 1); // tick 2: B -> O=1
    assert.strictEqual(stepAbro(1, 1, 0), 0); // tick 3: already emitted
    assert.strictEqual(stepAbro(0, 0, 1), 0); // tick 4: R resets
    assert.strictEqual(stepAbro(1, 1, 0), 1); // tick 5: A & B -> O=1
  });
});
