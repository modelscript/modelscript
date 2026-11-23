// SPDX-License-Identifier: AGPL-3.0-or-later

import { globalLibraryRegistry } from "@modelscript/runtime";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  DOE2_STD_MODEL_SPECS,
  evaluateDoe2StdWasmModel,
  getDoe2SchemasFromLibraries,
  lookupDoe2ModelSchema,
  registerBuiltInDoe2LibrarySync,
} from "../src/catalog/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STD_LIB_DIR = path.resolve(__dirname, "../assets/doe2-std-lib");

describe("@modelscript/doe2 — Cleanroom ASHRAE/DOE-2 Standard Library", () => {
  it("loads @modelscript/doe2-std-lib via modelscript.yaml with symbols, SVG icons, and runtime.wasm", async () => {
    const manifestPath = path.join(STD_LIB_DIR, "modelscript.yaml");
    assert.ok(fs.existsSync(manifestPath), "Expected doe2-std-lib/modelscript.yaml");

    const pkg = await globalLibraryRegistry.loadLibraryFromDir(STD_LIB_DIR);
    assert.ok(pkg, "Expected loadLibraryFromDir to return loaded package");
    assert.equal(pkg.packageName, "@modelscript/doe2-std-lib");
    assert.equal(pkg.manifest.language, "doe2");
    assert.equal(pkg.symbols.length, DOE2_STD_MODEL_SPECS.length);
    assert.equal(pkg.diagrams.length, DOE2_STD_MODEL_SPECS.length);
    assert.ok(pkg.wasmBytes && pkg.wasmBytes.byteLength > 0, "Expected compiled runtime.wasm");

    for (const diag of pkg.diagrams) {
      assert.ok(diag.svg && diag.svg.startsWith("<svg"), `Expected cleanroom SVG icon for ${diag.namePath}`);
      assert.ok(diag.ports.length >= 2, `Expected diagram ports for ${diag.namePath}`);
    }
  });

  it("registers required ASHRAE materials, glazing, and HVAC system archetypes with alias lookup", () => {
    registerBuiltInDoe2LibrarySync();
    const schemas = getDoe2SchemasFromLibraries();
    assert.ok(schemas.length >= DOE2_STD_MODEL_SPECS.length);

    const required = [
      "MAT-CONCRETE",
      "MAT-INSUL-R19",
      "MAT-GYPSUM",
      "MAT-BRICK",
      "GLZ-DOUBLE-LOWE",
      "PSZ",
      "VAVS",
      "PIU",
      "FC",
      "PTAC",
    ];
    for (const name of required) {
      const found = lookupDoe2ModelSchema(name);
      assert.ok(found, `Expected standard library schema '${name}'`);
      assert.equal(found.name, name);
    }

    // Alias lookup
    assert.equal(lookupDoe2ModelSchema("CC03")?.name, "MAT-CONCRETE");
    assert.equal(lookupDoe2ModelSchema("GP01")?.name, "MAT-GYPSUM");
    assert.equal(lookupDoe2ModelSchema("VAV-REHEAT")?.name, "VAVS");
  });

  it("executes material, glazing, and HVAC archetypes inside compiled runtime.wasm", () => {
    // 1. MAT-INSUL-R19 thermal resistance
    const insul = evaluateDoe2StdWasmModel("MAT-INSUL-R19", { areaM2: 10.0, deltaTK: 20.0 });
    assert.ok(insul);
    assert.ok(Math.abs(insul.rValueSi - 3.3461) < 1e-4, `Expected R-19 SI ~3.3461, got ${insul.rValueSi}`);
    assert.ok(Math.abs(insul.qConductiveW - (10.0 * 20.0) / 3.3461) < 1e-3);

    // 2. GLZ-DOUBLE-LOWE conduction + solar gain
    const glz = evaluateDoe2StdWasmModel("GLZ-DOUBLE-LOWE", { areaM2: 12.0, deltaTK: 10.0, solarWPerM2: 500.0 });
    assert.ok(glz);
    assert.ok(Math.abs(glz.qConductiveW - 1.65 * 12.0 * 10.0) < 1e-3);
    assert.ok(Math.abs(glz.qSolarW - 12.0 * 0.42 * 500.0) < 1e-3);

    // 3. VAVS vs PSZ part-load fan unloading at 50% cooling load
    const vavs = evaluateDoe2StdWasmModel("VAVS", { thermalLoadW: -5000.0, capacityW: 10000.0 });
    const psz = evaluateDoe2StdWasmModel("PSZ", { thermalLoadW: -5000.0, capacityW: 10000.0 });
    assert.ok(vavs && psz);
    assert.ok(vavs.electricPowerW > 0 && psz.electricPowerW > 0);
    assert.ok(vavs.fanPowerW < psz.fanPowerW, "VAVS cubic VFD fan should draw less power at 50% PLR than PSZ");
  });
});
