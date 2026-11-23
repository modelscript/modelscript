// SPDX-License-Identifier: AGPL-3.0-or-later

import { globalLibraryRegistry } from "@modelscript/runtime";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  SEGY_STD_SPECS,
  getSegySchemasFromLibraries,
  lookupSegySchema,
  registerBuiltInSegyLibrarySync,
} from "../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STD_LIB_DIR = path.resolve(__dirname, "../assets/segy-std-lib");

describe("@modelscript/segy — Cleanroom Standard Library (@modelscript/segy-std-lib)", () => {
  it("loads @modelscript/segy-std-lib via modelscript.yaml with symbols, SVG icons, and runtime.wasm", async () => {
    const manifestPath = path.join(STD_LIB_DIR, "modelscript.yaml");
    assert.ok(fs.existsSync(manifestPath), "Expected segy-std-lib/modelscript.yaml");

    const pkg = await globalLibraryRegistry.loadLibraryFromDir(STD_LIB_DIR);
    assert.ok(pkg, "Expected loadLibraryFromDir to return loaded package");
    assert.equal(pkg.packageName, "@modelscript/segy-std-lib");
    assert.equal(pkg.manifest.language, "segy");
    assert.equal(pkg.symbols.length, SEGY_STD_SPECS.length);
    assert.equal(pkg.diagrams.length, SEGY_STD_SPECS.length);
    assert.ok(pkg.wasmBytes && pkg.wasmBytes.byteLength > 0, "Expected compiled runtime.wasm bytes");

    for (const diag of pkg.diagrams) {
      assert.ok(diag.svg && diag.svg.startsWith("<svg"), `Expected SVG icon for ${diag.namePath}`);
      assert.ok(diag.ports.length > 0, `Expected diagram ports for ${diag.namePath}`);
    }

    // Instantiate runtime.wasm and verify cleanroom wavelet & NMO kernels
    const mod = await WebAssembly.instantiate(pkg.wasmBytes);
    const exports = mod.instance.exports as {
      evalRicker: (tau: number, f0: number) => number;
      nmoTime: (t0: number, x: number, v: number) => number;
    };
    assert.ok(Math.abs(exports.evalRicker(0, 30) - 1.0) < 1e-12);
    assert.ok(Math.abs(exports.nmoTime(0.3, 400, 1000) - 0.5) < 1e-12);
  });

  it("supports zero-I/O sync registration and lookup of required header fields and wavelets", () => {
    registerBuiltInSegyLibrarySync();
    const schemas = getSegySchemasFromLibraries();
    assert.ok(schemas.length >= SEGY_STD_SPECS.length);

    const requiredNames = [
      "JobID",
      "SampleIntervalUs",
      "SampleFormatCode",
      "Inline3D",
      "Crossline3D",
      "CDP",
      "OffsetM",
      "Ricker",
      "Ormsby",
      "Klauder",
    ];
    for (const name of requiredNames) {
      const schema = lookupSegySchema(name);
      assert.ok(schema, `Expected schema '${name}' to be registered`);
      assert.equal(schema.name, name);
    }

    // Alias lookups
    assert.equal(lookupSegySchema("INLINE")?.name, "Inline3D");
    assert.equal(lookupSegySchema("XLINE")?.name, "Crossline3D");
    assert.equal(lookupSegySchema("SEGY.Ricker")?.name, "Ricker");
  });
});
