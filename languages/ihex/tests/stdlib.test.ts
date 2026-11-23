// SPDX-License-Identifier: AGPL-3.0-or-later

import { globalLibraryRegistry } from "@modelscript/runtime";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  IhexArchetypeId,
  ensureBuiltInIhexLibraryRegistered,
  getIhexSchemasFromLibraries,
  getIhexStdLibWasmBytes,
  lookupIhexModelSchema,
} from "../src/index.js";

describe("@modelscript/ihex Cleanroom Stdlib Suite", () => {
  it("registers @modelscript/ihex-std-lib in globalLibraryRegistry with all 10 schemas", () => {
    ensureBuiltInIhexLibraryRegistered();
    const pkgs = globalLibraryRegistry.getPackagesForLanguage("ihex");
    assert.ok(pkgs.length >= 1, "ihex stdlib package should be registered");

    const schemas = getIhexSchemasFromLibraries();
    assert.equal(schemas.length, 10, "Expected 6 record type schemas + 4 MCU flash layout schemas");

    const rec04 = lookupIhexModelSchema("REC_04_EXT_LIN_ADDR");
    assert.ok(rec04, "Should find REC_04_EXT_LIN_ADDR");
    assert.ok(rec04.svg?.includes("<svg"), "Schema should include parametric SVG block icon");

    const avr = lookupIhexModelSchema("ATMEGA328P");
    assert.ok(avr, "Should resolve alias ATMEGA328P");
    assert.equal(avr.name, "AVR_ATMEGA328P");

    const m4 = lookupIhexModelSchema("ARM_CORTEX_M4");
    assert.ok(m4, "Should find ARM_CORTEX_M4");
    const flashSize = m4.parameters.find((p) => p.key === "FLASH_SIZE")?.defaultValue;
    assert.equal(flashSize, 524288);
  });

  it("instantiates cleanroom stdlib runtime.wasm and executes ihexHeaderChecksum & ihexModelEval", async () => {
    const wasmBytes = getIhexStdLibWasmBytes();
    assert.ok(wasmBytes.byteLength > 0, "WASM bytes must be non-empty");

    const { instance } = await WebAssembly.instantiate(wasmBytes, {});
    const exports = instance.exports as {
      memory: WebAssembly.Memory;
      ihexHeaderChecksum: (ll: number, addrHi: number, addrLo: number, tt: number) => number;
      ihexModelEval: (archetypeId: number, slotPtr: number, conCount: number) => void;
    };

    // EOF header: 00 00 00 01 -> 0xFF
    assert.equal(exports.ihexHeaderChecksum(0x00, 0x00, 0x00, 0x01), 0xff);

    // Evaluate ARM Cortex-M0 slot (64 KiB flash, 1 KiB pages, 4096 B used)
    if (exports.memory.buffer.byteLength < 0x2000) {
      exports.memory.grow(1);
    }
    const slotPtr = 0x1000;
    const view = new DataView(exports.memory.buffer);
    view.setFloat64(slotPtr + 0x080 + 0 * 8, 0x08000000, true); // FLASH_BASE
    view.setFloat64(slotPtr + 0x080 + 1 * 8, 65536, true); // FLASH_SIZE
    view.setFloat64(slotPtr + 0x080 + 2 * 8, 1024, true); // PAGE_SIZE
    view.setFloat64(slotPtr + 0x780 + 0 * 8, 4096, true); // IO[0] = usedBytes

    exports.ihexModelEval(IhexArchetypeId.MCU_ARM_CORTEX_M0, slotPtr, 3);

    const util = view.getFloat64(slotPtr + 0x780 + 2 * 8, true);
    const pagesUsed = view.getFloat64(slotPtr + 0x780 + 3 * 8, true);
    const freeBytes = view.getFloat64(slotPtr + 0x780 + 4 * 8, true);

    assert.equal(util, 4096 / 65536);
    assert.equal(pagesUsed, 4);
    assert.equal(freeBytes, 61440);
  });
});
