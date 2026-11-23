// SPDX-License-Identifier: AGPL-3.0-or-later

import { globalLibraryRegistry } from "@modelscript/runtime";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ensureBuiltInUsgsDemLibraryRegistered,
  getUsgsDemSchemasFromLibraries,
  lookupUsgsDemModelSchema,
} from "../src/catalog/index.js";
import { getUsgsDemStdLibWasmBytes } from "../src/catalog/usgs-dem-std-lib-data.js";

describe("@modelscript/usgs-dem cleanroom stdlib", () => {
  it("registers @modelscript/usgs-dem-std-lib in globalLibraryRegistry with zero I/O", () => {
    ensureBuiltInUsgsDemLibraryRegistered();
    const pkgs = globalLibraryRegistry.getPackagesForLanguage("usgs-dem");
    assert.ok(pkgs.length >= 1, "Expected at least one registered usgs-dem stdlib package");

    const schemas = getUsgsDemSchemasFromLibraries();
    assert.ok(schemas.length >= 10, `Expected >= 10 schemas, got ${schemas.length}`);
    for (const s of schemas) {
      assert.ok(s.svg && s.svg.includes("<svg"), `Schema ${s.name} should have cleanroom SVG icon`);
    }
  });

  it("looks up datum/projection codes and synthetic terrain schemas by name or alias", () => {
    const utm27 = lookupUsgsDemModelSchema("UTM_NAD27");
    assert.ok(utm27);
    assert.equal(utm27.name, "UTM_NAD27");

    const utm83 = lookupUsgsDemModelSchema("UTM83");
    assert.ok(utm83);
    assert.equal(utm83.name, "UTM_NAD83");

    const geo = lookupUsgsDemModelSchema("GEOGRAPHIC_ARCSEC");
    assert.ok(geo);

    const gauss = lookupUsgsDemModelSchema("GAUSSIAN_HILL");
    assert.ok(gauss);
    assert.ok(lookupUsgsDemModelSchema("INCLINED_PLANE"));
    assert.ok(lookupUsgsDemModelSchema("V_VALLEY"));
  });

  it("instantiates the compiled AssemblyScript stdlib WASM kernel", async () => {
    const wasmBytes = getUsgsDemStdLibWasmBytes();
    assert.ok(wasmBytes.byteLength > 0, "WASM stdlib bytes must be non-empty");
    const { instance } = await WebAssembly.instantiate(wasmBytes, {});
    const exports = instance.exports as {
      usgsDemEval: (arch: number, x: number, y: number, p0: number, p1: number, p2: number, p3: number) => number;
      usgsDemSlopeDeg: (dzdx: number, dzdy: number) => number;
    };

    // Gaussian hill peak at (0, 0): 1000 + 500 = 1500
    assert.equal(exports.usgsDemEval(10, 0, 0, 1000, 500, 100, 0), 1500);
    // Inclined plane at (10, 20): 100 + 2*10 + 3*20 = 180
    assert.equal(exports.usgsDemEval(11, 10, 20, 100, 2, 3, 0), 180);
    // Slope of 1.0 along x => 45 degrees
    assert.ok(Math.abs(exports.usgsDemSlopeDeg(1, 0) - 45) < 1e-12);
  });
});
