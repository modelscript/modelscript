// SPDX-License-Identifier: AGPL-3.0-or-later

import { globalLibraryRegistry } from "@modelscript/runtime";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  SINDA_MODEL_SPECS,
  SindaArchetypeId,
  getSindaSchemasFromLibraries,
  getSindaStdLibWasmBytes,
  lookupSindaModelSchema,
  registerBuiltInSindaLibrarySync,
} from "../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STD_LIB_DIR = path.resolve(__dirname, "../assets/sinda-std-lib");

describe("@modelscript/sinda — Cleanroom Standard Library (@modelscript/sinda-std-lib)", () => {
  it("loads @modelscript/sinda-std-lib via modelscript.yaml with symbols, SVG icons, and runtime.wasm", async () => {
    const manifestPath = path.join(STD_LIB_DIR, "modelscript.yaml");
    assert.ok(fs.existsSync(manifestPath), "Expected sinda-std-lib/modelscript.yaml");

    const pkg = await globalLibraryRegistry.loadLibraryFromDir(STD_LIB_DIR);
    assert.ok(pkg, "Expected loadLibraryFromDir to return loaded package");
    assert.equal(pkg.packageName, "@modelscript/sinda-std-lib");
    assert.equal(pkg.manifest.language, "sinda");
    assert.equal(pkg.symbols.length, SINDA_MODEL_SPECS.length);
    assert.equal(pkg.diagrams.length, SINDA_MODEL_SPECS.length);
    assert.ok(pkg.wasmBytes && pkg.wasmBytes.byteLength > 0, "Expected compiled runtime.wasm bytes");

    for (const diag of pkg.diagrams) {
      assert.ok(diag.svg && diag.svg.startsWith("<svg"), `Expected cleanroom SVG icon for ${diag.namePath}`);
      assert.ok(diag.ports.length > 0, `Expected diagram ports for ${diag.namePath}`);
    }
  });

  it("registers solver routines (STDSTL, FWDBCK, CRANKN, SNFR) and spacecraft thermal materials synchronously", () => {
    registerBuiltInSindaLibrarySync();
    const schemas = getSindaSchemasFromLibraries();
    assert.ok(schemas.length >= SINDA_MODEL_SPECS.length);

    for (const key of [
      "STDSTL",
      "FWDBCK",
      "CRANKN",
      "SNFR",
      "AL_6061",
      "TI_6AL_4V",
      "MLI",
      "KAPTON",
      "BLACK_ANODIZE",
      "OSR",
    ]) {
      const schema = lookupSindaModelSchema(key);
      assert.ok(schema, `Expected schema for ${key}`);
      assert.equal(schema.name, key);
    }

    // Alias lookup
    assert.equal(lookupSindaModelSchema("ALUMINUM_6061")?.name, "AL_6061");
    assert.equal(lookupSindaModelSchema("OPTICAL_SOLAR_REFLECTOR")?.name, "OSR");
  });

  it("instantiates and executes cleanroom thermal material & radiation kernels in runtime.wasm", async () => {
    const wasmBytes = getSindaStdLibWasmBytes();
    const { instance } = await WebAssembly.instantiate(wasmBytes, {});
    const exports = instance.exports as {
      getMaterialConductivity(id: number): number;
      getMaterialEmittance(id: number): number;
      getMaterialAbsorptance(id: number): number;
      computeRadiationFlux(gRad: number, tiK: number, tjK: number): number;
      computeRadiativeEquilibriumTemp(qW: number, eps: number, areaM2: number): number;
    };

    assert.equal(exports.getMaterialConductivity(SindaArchetypeId.AL_6061), 167.0);
    assert.equal(exports.getMaterialConductivity(SindaArchetypeId.TI_6AL_4V), 6.7);
    assert.equal(exports.getMaterialEmittance(SindaArchetypeId.OSR), 0.8);
    assert.equal(exports.getMaterialAbsorptance(SindaArchetypeId.OSR), 0.08);

    const tEq = exports.computeRadiativeEquilibriumTemp(250.0, 0.85, 1.2);
    const tExpected = Math.pow(250.0 / (5.670374419e-8 * 0.85 * 1.2), 0.25);
    assert.ok(Math.abs(tEq - tExpected) / tExpected < 1e-12);
  });
});
