// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildAsn1CleanroomSchemas,
  ensureBuiltInAsn1LibraryRegistered,
  getAsn1SchemasFromLibraries,
  getAsn1StdLibWasmBytes,
  lookupAsn1ModelSchema,
} from "../src/catalog/index.js";

describe("ASN.1 Cleanroom Standard Library (@modelscript/asn1-std-lib)", () => {
  it("contains X.680 universal tags (0x01 BOOLEAN .. 0x31 SET) and classic 1980s protocol schemas", () => {
    const schemas = buildAsn1CleanroomSchemas();
    assert.ok(schemas.length >= 17);

    const names = new Set(schemas.map((s) => s.name));
    assert.ok(names.has("BOOLEAN"));
    assert.ok(names.has("INTEGER"));
    assert.ok(names.has("OCTET_STRING"));
    assert.ok(names.has("OBJECT_IDENTIFIER"));
    assert.ok(names.has("SEQUENCE"));
    assert.ok(names.has("SET"));
    assert.ok(names.has("SNMPv1PDU"));
    assert.ok(names.has("X509AlgorithmIdentifier"));
    assert.ok(names.has("X509Validity"));
    assert.ok(names.has("IEC61850GoosePdu"));

    for (const s of schemas) {
      assert.ok(s.svg && s.svg.includes("<svg"), `${s.name} has cleanroom SVG icon`);
    }
  });

  it("registers into globalLibraryRegistry with zero I/O and provides compiled WASM bytes", async () => {
    ensureBuiltInAsn1LibraryRegistered();
    const fromRegistry = getAsn1SchemasFromLibraries();
    assert.ok(fromRegistry.length >= 17);

    const oidSchema = lookupAsn1ModelSchema("OID");
    assert.ok(oidSchema);
    assert.equal(oidSchema.name, "OBJECT_IDENTIFIER");

    const gooseSchema = lookupAsn1ModelSchema("GOOSE");
    assert.ok(gooseSchema);
    assert.equal(gooseSchema.name, "IEC61850GoosePdu");

    const wasmBytes = getAsn1StdLibWasmBytes();
    assert.ok(wasmBytes.length > 100);
    // Validate WebAssembly magic header (\0asm)
    assert.equal(wasmBytes[0], 0x00);
    assert.equal(wasmBytes[1], 0x61);
    assert.equal(wasmBytes[2], 0x73);
    assert.equal(wasmBytes[3], 0x6d);

    // Instantiate and step the AssemblyScript kernel
    const { instance } = await WebAssembly.instantiate(wasmBytes);
    const exports = instance.exports as {
      asn1ModelInit: (arch: number, ptr: number, conCount: number) => void;
      asn1ModelStep: (arch: number, t: number, dt: number, ptr: number, conCount: number) => void;
      memory: WebAssembly.Memory;
    };
    assert.equal(typeof exports.asn1ModelInit, "function");
    assert.equal(typeof exports.asn1ModelStep, "function");
  });
});
