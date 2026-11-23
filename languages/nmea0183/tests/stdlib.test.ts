// SPDX-License-Identifier: AGPL-3.0-or-later

import { globalLibraryRegistry } from "@modelscript/runtime";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  Nmea0183ArchetypeId,
  buildNmea0183CleanroomSchemas,
  ensureBuiltInNmea0183LibraryRegistered,
  getNmea0183SchemasFromLibraries,
  getNmea0183StdLibWasmBytes,
  lookupNmea0183SentenceSchema,
} from "../src/index.js";

describe("@modelscript/nmea0183 Cleanroom Standard Library Suite", () => {
  it("registers @modelscript/nmea0183-std-lib with all 8 standard sentence schemas and SVG icons", () => {
    ensureBuiltInNmea0183LibraryRegistered();
    const pkgs = globalLibraryRegistry.getPackagesForLanguage("nmea0183");
    assert.ok(pkgs.length >= 1, "Expected nmea0183 library package to be registered");

    const schemas = getNmea0183SchemasFromLibraries();
    const expected = ["GGA", "RMC", "GSA", "GSV", "VTG", "HDG", "DBT", "MWV"];
    assert.strictEqual(buildNmea0183CleanroomSchemas().length, expected.length);

    for (const fmt of expected) {
      const schema = lookupNmea0183SentenceSchema(fmt);
      assert.ok(schema, `Expected schema for ${fmt}`);
      assert.ok(schema.svg && schema.svg.startsWith("<svg"), `Expected parametric SVG icon for ${fmt}`);
      assert.ok(schema.parameters.length >= 2, `Expected parameters for ${fmt}`);
    }

    // Lookup by full talker+formatter address
    const gpgga = lookupNmea0183SentenceSchema("$GPGGA");
    assert.strictEqual(gpgga?.name, "GGA");
    const sddbt = lookupNmea0183SentenceSchema("SDDBT");
    assert.strictEqual(sddbt?.name, "DBT");
  });

  it("instantiates and steps the compiled AssemblyScript cleanroom runtime.wasm", async () => {
    const wasmBytes = getNmea0183StdLibWasmBytes();
    assert.ok(wasmBytes.byteLength > 100, "Expected non-empty compiled runtime.wasm");

    const { instance } = await WebAssembly.instantiate(wasmBytes, {});
    const exports = instance.exports as {
      memory: WebAssembly.Memory;
      nmea0183ModelInit: (archetypeId: number, slotPtr: number, conCount: number) => void;
      nmea0183ModelStep: (archetypeId: number, t: number, dt: number, slotPtr: number, conCount: number) => void;
    };

    const slotPtr = 4096;
    const f64 = new Float64Array(exports.memory.buffer);
    // Write RMC CON[0]=10 knots, CON[1]=90 deg (due East)
    f64[(slotPtr + 0x080) >> 3] = 10.0;
    f64[(slotPtr + 0x088) >> 3] = 90.0;

    exports.nmea0183ModelInit(Nmea0183ArchetypeId.RMC, slotPtr, 2);
    exports.nmea0183ModelStep(Nmea0183ArchetypeId.RMC, 0.0, 2.0, slotPtr, 2);

    const posE = f64[(slotPtr + 0x580) >> 3]!;
    const posN = f64[(slotPtr + 0x588) >> 3]!;
    const sDist = f64[(slotPtr + 0x590) >> 3]!;

    const expectedMeters = 10.0 * 0.5144444444444445 * 2.0;
    assert.ok(Math.abs(posE - expectedMeters) < 1e-6, `Expected posE=${expectedMeters}, got ${posE}`);
    assert.ok(Math.abs(posN) < 1e-6, `Expected posN=0, got ${posN}`);
    assert.ok(Math.abs(sDist - expectedMeters) < 1e-6, `Expected sDist=${expectedMeters}, got ${sDist}`);
  });
});
