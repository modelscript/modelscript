// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildIrig106CleanroomSchemas,
  ensureBuiltInIrig106LibraryRegistered,
  getIrig106SchemasFromLibraries,
  IRIG106_STANDARD_SYNC_WORDS,
  lookupIrig106Schema,
} from "../src/catalog/index.js";
import { getIrig106StdLibWasmBytes } from "../src/catalog/irig106-std-lib-data.js";

describe("@modelscript/irig106 Cleanroom Standard Library", () => {
  it("defines schemas for all core TMATS groups (G, T, M, P, D, C) and standard sync words", () => {
    const schemas = buildIrig106CleanroomSchemas();
    assert.ok(schemas.length >= 9);

    const names = new Set(schemas.map((s) => s.name));
    for (const req of [
      "TMATS_G",
      "TMATS_T",
      "TMATS_M",
      "TMATS_P",
      "TMATS_D",
      "TMATS_C",
      "SYNC_16_EB90",
      "SYNC_24_FAF320",
      "SYNC_32_FE6B2840",
    ]) {
      assert.ok(names.has(req), `Missing cleanroom schema ${req}`);
    }

    assert.strictEqual(IRIG106_STANDARD_SYNC_WORDS.length, 3);
    assert.strictEqual(IRIG106_STANDARD_SYNC_WORDS[0]!.hex, "EB90");
    assert.strictEqual(IRIG106_STANDARD_SYNC_WORDS[1]!.hex, "FAF320");
    assert.strictEqual(IRIG106_STANDARD_SYNC_WORDS[2]!.hex, "FE6B2840");
  });

  it("registers @modelscript/irig106-std-lib in globalLibraryRegistry and resolves lookups", () => {
    ensureBuiltInIrig106LibraryRegistered();
    const schemas = getIrig106SchemasFromLibraries();
    assert.ok(schemas.length >= 9);

    const sync24 = lookupIrig106Schema("FAF320");
    assert.ok(sync24);
    assert.strictEqual(sync24.name, "SYNC_24_FAF320");

    const pcmGroup = lookupIrig106Schema("PCM_FORMAT");
    assert.ok(pcmGroup);
    assert.strictEqual(pcmGroup.name, "TMATS_P");
  });

  it("instantiates the compiled AssemblyScript WASM runtime and executes polynomial & sync kernels", async () => {
    const wasmBytes = getIrig106StdLibWasmBytes();
    assert.ok(wasmBytes.byteLength > 0);

    const { instance } = await WebAssembly.instantiate(wasmBytes);
    const exports = instance.exports as {
      irig106MinorFrameRate: (d1: number, mf2: number) => number;
      irig106MajorFrameRate: (d1: number, mf2: number, mfn: number) => number;
      irig106StandardSyncWord: (bits: number) => number;
    };

    assert.strictEqual(exports.irig106MinorFrameRate(128000, 128), 1000);
    assert.strictEqual(exports.irig106MajorFrameRate(128000, 128, 4), 250);
    assert.strictEqual(exports.irig106StandardSyncWord(16) >>> 0, 0xeb90);
    assert.strictEqual(exports.irig106StandardSyncWord(24) >>> 0, 0xfaf320);
    assert.strictEqual(exports.irig106StandardSyncWord(32) >>> 0, 0xfe6b2840);
  });
});
