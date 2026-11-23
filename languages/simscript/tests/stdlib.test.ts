// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SIMSCRIPT_STD_SPECS,
  SimscriptArchetypeId,
  buildSimscriptCleanroomSchemas,
  ensureBuiltInSimscriptLibraryRegistered,
  getSimscriptSchemasFromLibraries,
  getSimscriptStdLibWasmBytes,
  lookupSimscriptModelSchema,
} from "../src/catalog/index.js";

describe("SIMSCRIPT II.5 Cleanroom Standard Library (@modelscript/simscript-std-lib)", () => {
  it("registers built-in cleanroom library and exposes all SIMSCRIPT II.5 distributions, sets, resources, and stats", () => {
    ensureBuiltInSimscriptLibraryRegistered();
    const schemas = getSimscriptSchemasFromLibraries();
    assert.strictEqual(schemas.length, SIMSCRIPT_STD_SPECS.length);
    assert.ok(schemas.length >= 12);

    for (const expected of [
      "EXPONENTIAL.F",
      "NORMAL.F",
      "UNIFORM.F",
      "POISSON.F",
      "ERLANG.F",
      "FIFO.SET",
      "RESOURCE",
      "TALLY",
      "ACCUMULATE",
    ]) {
      const found = lookupSimscriptModelSchema(expected);
      assert.ok(found, `Expected schema '${expected}' in @modelscript/simscript-std-lib`);
      assert.ok(found.svg && found.svg.startsWith("<svg"), `Expected SVG icon for '${expected}'`);
      assert.ok(found.ports.length >= 2, `Expected diagram ports for '${expected}'`);
    }
  });

  it("embeds a valid WebAssembly runtime binary and evaluates Erlang-C M/M/c kernel in WASM", async () => {
    const wasmBytes = getSimscriptStdLibWasmBytes();
    assert.ok(wasmBytes.byteLength > 100, "Expected non-empty runtime.wasm bytes");

    const { instance } = await WebAssembly.instantiate(wasmBytes, {});
    const exports = instance.exports as {
      memory: WebAssembly.Memory;
      initSlot: (slotPtr: number, archetypeId: number, conCount: number) => number;
      evalSlot: (slotPtr: number, archetypeId: number, conCount: number, time: number) => number;
    };

    assert.strictEqual(typeof exports.initSlot, "function");
    assert.strictEqual(typeof exports.evalSlot, "function");

    // Test RESOURCE archetype (M/M/2: capacity=2, lambda=1.0, mu=1.0 => rho=0.5)
    const slotPtr = 4096;
    const f64 = new Float64Array(exports.memory.buffer);
    const conBase = (slotPtr + 0x080) >> 3;
    const ioBase = (slotPtr + 0x780) >> 3;

    f64[conBase + 0] = 2.0; // capacity
    f64[conBase + 1] = 1.0; // lambda
    f64[conBase + 2] = 1.0; // mu

    exports.initSlot(slotPtr, SimscriptArchetypeId.RESOURCE, 3);
    exports.evalSlot(slotPtr, SimscriptArchetypeId.RESOURCE, 3, 0.0);

    const rho = f64[ioBase + 1]!;
    const lq = f64[ioBase + 4]!;
    assert.ok(Math.abs(rho - 0.5) < 1e-9, `Expected rho=0.5, got ${rho}`);
    assert.ok(Math.abs(lq - 1 / 3) < 1e-6, `Expected M/M/2 Lq=1/3, got ${lq}`);

    const directSchemas = buildSimscriptCleanroomSchemas();
    assert.strictEqual(directSchemas.length, SIMSCRIPT_STD_SPECS.length);
  });
});
