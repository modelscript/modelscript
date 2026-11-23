// SPDX-License-Identifier: AGPL-3.0-or-later

import { globalLibraryRegistry } from "@modelscript/runtime";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getGpssStdLibWasmBytes } from "../src/catalog/gpss-std-lib-data.js";
import {
  GPSS_MODEL_SPECS,
  ensureBuiltInGpssLibraryRegistered,
  getGpssSchemasFromLibraries,
  lookupGpssModelSchema,
} from "../src/catalog/index.js";

describe("GPSS Cleanroom Standard Library (@modelscript/gpss-std-lib)", () => {
  it("registers @modelscript/gpss-std-lib into globalLibraryRegistry with zero I/O", () => {
    ensureBuiltInGpssLibraryRegistered();
    const pkgs = globalLibraryRegistry.getPackagesForLanguage("gpss");
    assert.ok(pkgs.length >= 1, "Should register at least one GPSS standard library package");
    assert.strictEqual(pkgs[0]!.packageName, "@modelscript/gpss-std-lib");
    assert.strictEqual(pkgs[0]!.manifest.language, "gpss");
  });

  it("exposes all GPSS block archetypes and Standard Numerical Attributes (Q$, F$, S$, R$, FR$, SR$)", () => {
    const schemas = getGpssSchemasFromLibraries();
    assert.strictEqual(schemas.length, GPSS_MODEL_SPECS.length);
    assert.ok(schemas.length >= 25);

    for (const key of [
      "GENERATE",
      "SEIZE",
      "RELEASE",
      "ADVANCE",
      "QUEUE",
      "DEPART",
      "ENTER",
      "LEAVE",
      "TRANSFER",
      "TERMINATE",
    ]) {
      const schema = lookupGpssModelSchema(key);
      assert.ok(schema, `Missing schema for block '${key}'`);
      assert.ok(schema.svg && schema.svg.includes("<svg"), `Missing SVG icon for '${key}'`);
    }

    for (const sna of ["Q$", "F$", "S$", "R$", "FR$", "SR$"]) {
      const schema = lookupGpssModelSchema(sna);
      assert.ok(schema, `Missing schema for SNA '${sna}'`);
      assert.strictEqual(schema.category, "Standard Numerical Attributes");
    }
  });

  it("instantiates cleanroom AssemblyScript WASM kernel and evaluates Erlang-C", async () => {
    const wasmBytes = getGpssStdLibWasmBytes();
    assert.ok(wasmBytes.byteLength > 200, "WASM runtime bytes should be non-empty");

    const { instance } = await WebAssembly.instantiate(wasmBytes);
    const exports = instance.exports as {
      gpssErlangC: (c: number, offeredLoad: number) => number;
      gpssGetArenaBase: () => number;
    };

    assert.ok(exports.gpssGetArenaBase() >= 64);
    // For M/M/1 with a = 0.7, Erlang-C C(1, 0.7) == 0.7 exactly
    const ec1 = exports.gpssErlangC(1, 0.7);
    assert.ok(Math.abs(ec1 - 0.7) < 1e-9, `Expected C(1, 0.7) = 0.7, got ${ec1}`);

    // For M/M/3 with a = 2.25, C(3, 2.25) ~= 0.5698
    const ec3 = exports.gpssErlangC(3, 2.25);
    assert.ok(ec3 > 0.55 && ec3 < 0.59, `Expected C(3, 2.25) ~= 0.57, got ${ec3}`);
  });
});
