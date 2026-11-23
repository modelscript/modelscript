// SPDX-License-Identifier: AGPL-3.0-or-later

import { globalLibraryRegistry } from "@modelscript/runtime";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  EslArchetypeId,
  ensureBuiltInEslLibraryRegistered,
  getEslSchemasFromLibraries,
  getEslStdLibWasmBytes,
  lookupEslModelSchema,
} from "../src/index.js";

describe("@modelscript/esl Cleanroom Standard Library Suite", () => {
  it("registers @modelscript/esl-std-lib in globalLibraryRegistry with all 8 ESA blocks", () => {
    ensureBuiltInEslLibraryRegistered();
    const pkgs = globalLibraryRegistry.getPackagesForLanguage("esl");
    assert.ok(pkgs.length >= 1, "Expected at least one registered esl library package");

    const schemas = getEslSchemasFromLibraries();
    const requiredBlocks = ["TRANSFER", "DELAY", "LIMIT", "DEADZONE", "QUATERNION", "ORBIT_J2", "TAB1", "TAB2"];
    for (const block of requiredBlocks) {
      const schema = lookupEslModelSchema(block);
      assert.ok(schema, `Expected cleanroom schema for '${block}'`);
      assert.ok(schema.svg && schema.svg.includes("<svg"), `Expected SVG icon for '${block}'`);
      assert.ok(schema.parameters.length >= 2, `Expected parameters for '${block}'`);
      assert.ok(schema.ports.length >= 2, `Expected diagram ports for '${block}'`);
    }
    assert.ok(schemas.length >= 8);
  });

  it("instantiates and executes the compiled AssemblyScript WASM runtime for LIMIT, DEADZONE, ORBIT_J2, and QUATERNION", async () => {
    const wasmBytes = getEslStdLibWasmBytes();
    assert.ok(wasmBytes.byteLength > 500, "Expected non-empty compiled runtime.wasm");

    const { instance } = await WebAssembly.instantiate(wasmBytes, {});
    const exports = instance.exports as {
      memory: WebAssembly.Memory;
      eslModelInit: (arch: number, slotPtr: number, conCount: number) => void;
      eslModelEvalDerivatives: (arch: number, t: number, dt: number, slotPtr: number, conCount: number) => void;
      eslModelStep: (arch: number, t: number, dt: number, slotPtr: number, conCount: number) => void;
    };

    const mem = new Float64Array(exports.memory.buffer);
    const slotPtr = 4096;
    const conBase = (slotPtr + 0x080) >> 3;
    const ioBase = (slotPtr + 0x780) >> 3;

    // 1. LIMIT([-1, 1], 2.5) -> 1.0
    mem[conBase + 0] = -1.0;
    mem[conBase + 1] = 1.0;
    mem[ioBase + 0] = 2.5;
    exports.eslModelEvalDerivatives(EslArchetypeId.LIMIT, 0, 0.01, slotPtr, 2);
    assert.strictEqual(mem[ioBase + 3], 1.0);

    // 2. DEADZONE([-0.5, 0.5, slope=2.0], 0.8) -> 0.6
    mem[conBase + 0] = -0.5;
    mem[conBase + 1] = 0.5;
    mem[conBase + 2] = 2.0;
    mem[ioBase + 0] = 0.8;
    exports.eslModelEvalDerivatives(EslArchetypeId.DEADZONE, 0, 0.01, slotPtr, 3);
    assert.ok(Math.abs(mem[ioBase + 3]! - 0.6) < 1e-12);

    // 3. ORBIT_J2 at equatorial LEO r = 7000 km -> radial acceleration < 0
    mem[conBase + 0] = 3.986004418e14;
    mem[conBase + 1] = 6378137.0;
    mem[conBase + 2] = 1.08262668e-3;
    mem[ioBase + 0] = 7000e3;
    mem[ioBase + 1] = 0.0;
    mem[ioBase + 2] = 0.0;
    exports.eslModelEvalDerivatives(EslArchetypeId.ORBIT_J2, 0, 0.01, slotPtr, 3);
    const ax = mem[ioBase + 3]!;
    const aKepler = -3.986004418e14 / (7000e3 * 7000e3);
    assert.ok(ax < aKepler, "J2 oblateness at equator should strengthen inward gravity slightly");

    // 4. QUATERNION unit norm preservation under constant angular rate
    mem[conBase + 0] = 1.0;
    mem[conBase + 1] = 0.0;
    mem[conBase + 2] = 0.0;
    mem[conBase + 3] = 0.0;
    mem[conBase + 4] = 1.0;
    exports.eslModelInit(EslArchetypeId.QUATERNION, slotPtr, 5);
    mem[ioBase + 0] = 0.1;
    mem[ioBase + 1] = 0.2;
    mem[ioBase + 2] = -0.05;
    for (let k = 0; k < 50; k++) {
      exports.eslModelStep(EslArchetypeId.QUATERNION, k * 0.01, 0.01, slotPtr, 5);
    }
    const qNorm = Math.hypot(mem[ioBase + 3]!, mem[ioBase + 4]!, mem[ioBase + 5]!, mem[ioBase + 6]!);
    assert.ok(Math.abs(qNorm - 1.0) < 1e-6, `Expected unit quaternion norm, got ${qNorm}`);
  });
});
