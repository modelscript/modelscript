// SPDX-License-Identifier: AGPL-3.0-or-later

import { globalLibraryRegistry } from "@modelscript/runtime";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  HEC1_MODEL_SPECS,
  TR55_CURVE_NUMBER_TABLE,
  computeScsExcessRunoff,
  getHec1SchemasFromLibraries,
  getHec1StdLibWasmRuntime,
  lookupHec1ModelSchema,
  lookupTr55CurveNumber,
  registerBuiltInHec1LibrarySync,
} from "../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STD_LIB_DIR = path.resolve(__dirname, "../assets/hec1-std-lib");

describe("@modelscript/hec1 — Cleanroom Standard Library (TR-55, UH/Routing & WASM Runtime)", () => {
  it("loads @modelscript/hec1-std-lib via modelscript.yaml with symbols, SVG icons, and runtime.wasm", async () => {
    const manifestPath = path.join(STD_LIB_DIR, "modelscript.yaml");
    assert.ok(fs.existsSync(manifestPath), "Expected hec1-std-lib/modelscript.yaml");

    const pkg = await globalLibraryRegistry.loadLibraryFromDir(STD_LIB_DIR);
    assert.ok(pkg, "Expected loadLibraryFromDir to return loaded package");
    assert.equal(pkg.packageName, "@modelscript/hec1-std-lib");
    assert.equal(pkg.manifest.language, "hec1");
    assert.equal(pkg.symbols.length, HEC1_MODEL_SPECS.length);
    assert.equal(pkg.diagrams.length, HEC1_MODEL_SPECS.length);
    assert.ok(pkg.wasmBytes && pkg.wasmBytes.byteLength > 0, "Expected compiled runtime.wasm bytes");

    for (const diag of pkg.diagrams) {
      assert.ok(diag.svg && diag.svg.startsWith("<svg"), `Expected SVG icon for ${diag.namePath}`);
      assert.ok(diag.ports.length > 0, `Expected diagram ports for ${diag.namePath}`);
    }
    for (const sym of pkg.symbols) {
      const prov = (sym.metadata as Record<string, unknown> | undefined)?.["provenance"];
      assert.ok(typeof prov === "string" && prov.length > 5, `Expected provenance citation for ${sym.namePath}`);
    }
  });

  it("supports zero-I/O sync registration, alias lookup, and TR-55 Hydrologic Soil Group A-D CN tables", () => {
    registerBuiltInHec1LibrarySync();
    const schemas = getHec1SchemasFromLibraries();
    assert.ok(schemas.length >= HEC1_MODEL_SPECS.length);

    assert.equal(lookupHec1ModelSchema("CLARK_UH")?.name, "CLARK_UH");
    assert.equal(lookupHec1ModelSchema("UC")?.name, "CLARK_UH");
    assert.equal(lookupHec1ModelSchema("RM")?.name, "MUSKINGUM_ROUTE");
    assert.equal(lookupHec1ModelSchema("HEC1.SNYDER_UH")?.name, "SNYDER_UH");

    assert.ok(TR55_CURVE_NUMBER_TABLE.length >= 9);
    assert.equal(lookupTr55CurveNumber("SCS_CN_URBAN_COMMERCIAL", "A"), 89);
    assert.equal(lookupTr55CurveNumber("SCS_CN_URBAN_COMMERCIAL", "D"), 95);
    assert.equal(lookupTr55CurveNumber("SCS_CN_WOODS_GOOD", "B"), 55);
    assert.equal(lookupTr55CurveNumber("SCS_CN_RESIDENTIAL_QUARTER_ACRE", "C"), 83);
  });

  it("executes scsExcessRunoff, muskingumStep, clarkReservoirStep, and snyderPeakDischarge in runtime.wasm", () => {
    const wasm = getHec1StdLibWasmRuntime();

    // 1. SCS-CN WASM parity against TS solver
    const qWasm = wasm.scsExcessRunoff(4.5, 78.0, -1.0, 0);
    const qTs = computeScsExcessRunoff(4.5, 78.0, undefined, "English", 0);
    assert.ok(Math.abs(qWasm - qTs) < 1e-12, `Expected WASM/TS SCS parity: ${qWasm} vs ${qTs}`);

    // 2. Muskingum step in WASM (steady state: I_curr = I_prev = O_prev = 500 -> O_curr = 500)
    const oSteady = wasm.muskingumStep(500.0, 500.0, 500.0, 1.0, 0.2, 0.5);
    assert.ok(Math.abs(oSteady - 500.0) < 1e-12);

    // 3. Clark linear reservoir step in WASM
    const cOut = wasm.clarkReservoirStep(100.0, 0.0, 1.5, 0.25);
    const cExpected = (0.25 / (1.5 + 0.125)) * 100.0;
    assert.ok(Math.abs(cOut - cExpected) < 1e-12);

    // 4. Snyder peak discharge in WASM
    const qp = wasm.snyderPeakDischarge(10.0, 2.0, 0.65, 0);
    assert.ok(Math.abs(qp - (640.0 * 0.65 * 10.0) / 2.0) < 1e-12);
  });
});
