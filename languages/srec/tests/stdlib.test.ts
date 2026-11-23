// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SREC_STD_MODEL_SPECS,
  buildSrecCleanroomSchemas,
  getSrecSchemasFromLibraries,
  lookupSrecModelSchema,
  registerBuiltInSrecLibrarySync,
} from "../src/catalog/index.js";
import { getSrecStdLibWasmBytes } from "../src/catalog/srec-std-lib-data.js";

describe("@modelscript/srec-std-lib Cleanroom Standard Library", () => {
  it("builds declarative schemas for S0-S9 record types and Motorola 6800/68000/ColdFire/PowerPC presets", () => {
    const schemas = buildSrecCleanroomSchemas();
    assert.strictEqual(schemas.length, SREC_STD_MODEL_SPECS.length);
    assert.ok(schemas.length >= 14, "Should include S0-S9 (10) + 4 classic Motorola presets");

    for (const s of schemas) {
      assert.ok(s.svg?.includes("<svg"), `Schema ${s.name} should have cleanroom SVG icon`);
      assert.ok(s.parameters.length >= 3, `Schema ${s.name} should declare parameters`);
    }
  });

  it("registers zero-I/O stdlib bundle and resolves S-record types & processor presets by name and alias", () => {
    registerBuiltInSrecLibrarySync();
    const loaded = getSrecSchemasFromLibraries();
    assert.strictEqual(loaded.length, SREC_STD_MODEL_SPECS.length);

    const s3 = lookupSrecModelSchema("S3");
    assert.ok(s3);
    assert.strictEqual(s3.name, "S3");
    assert.strictEqual(s3.parameters.find((p) => p.key === "addressBits")?.defaultValue, 32);

    const m68k = lookupSrecModelSchema("M68K");
    assert.ok(m68k);
    assert.strictEqual(m68k.name, "MC68000");

    const ppc = lookupSrecModelSchema("POWERPC");
    assert.ok(ppc);
    assert.strictEqual(ppc.parameters.find((p) => p.key === "bootFlashBase")?.defaultValue, 0xfff00000);
  });

  it("embeds compiled AssemblyScript WASM runtime binary with valid WASM magic header", () => {
    const wasm = getSrecStdLibWasmBytes();
    assert.ok(wasm.length > 32, "WASM binary should be non-empty");
    assert.strictEqual(wasm[0], 0x00);
    assert.strictEqual(wasm[1], 0x61);
    assert.strictEqual(wasm[2], 0x73);
    assert.strictEqual(wasm[3], 0x6d);
  });
});
