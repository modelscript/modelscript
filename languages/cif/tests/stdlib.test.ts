// SPDX-License-Identifier: AGPL-3.0-or-later

import { globalLibraryRegistry } from "@modelscript/runtime";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CifArchetypeId,
  MOSIS_SCMOS_LAYERS,
  buildCifCleanroomSchemas,
  ensureBuiltInCifLibraryRegistered,
  getCifSchemasFromLibraries,
  getCifStdLibWasmBytes,
  lookupCifLayerSchema,
  lookupMosisLayerRule,
} from "../src/catalog/index.js";

describe("CIF Cleanroom Standard Library (MOSIS SCMOS & Mead-Conway)", () => {
  it("defines all required MOSIS SCMOS layers (CAA, CPG, CCA, CMF, CVA, CMS, CWN) with lambda rules", () => {
    const required = ["CAA", "CPG", "CCA", "CMF", "CVA", "CMS", "CWN"];
    for (const layer of required) {
      const rule = lookupMosisLayerRule(layer);
      assert.ok(rule, `Expected MOSIS SCMOS layer ${layer} to exist`);
      assert.ok(rule.minWidthLambda >= 2);
      assert.ok(rule.minSpacingLambda >= 2);
      assert.ok(rule.gdsLayer > 0);
      assert.ok(rule.areaCapAfPerUm2 > 0);
    }
    assert.strictEqual(MOSIS_SCMOS_LAYERS["CWN"]?.minWidthLambda, 10);
    assert.strictEqual(MOSIS_SCMOS_LAYERS["CMF"]?.minWidthLambda, 3);
    assert.strictEqual(MOSIS_SCMOS_LAYERS["CPG"]?.minWidthLambda, 2);
  });

  it("registers @modelscript/cif-std-lib in globalLibraryRegistry and exposes schemas", () => {
    ensureBuiltInCifLibraryRegistered();
    const pkgs = globalLibraryRegistry.getPackagesForLanguage("cif");
    assert.ok(pkgs.length >= 1);

    const schemas = getCifSchemasFromLibraries();
    const expectedCount = buildCifCleanroomSchemas().length;
    assert.strictEqual(schemas.length, expectedCount);

    const cmfSchema = lookupCifLayerSchema("cmf");
    assert.ok(cmfSchema);
    assert.strictEqual(cmfSchema.name, "CMF");
    assert.ok(cmfSchema.svg?.includes("<svg"));
  });

  it("instantiates the compiled AssemblyScript cleanroom WASM kernel and evaluates DRC & RC physics", async () => {
    const wasmBytes = getCifStdLibWasmBytes();
    assert.ok(wasmBytes.byteLength > 100, "WASM bytes should be non-empty");

    const { instance } = await WebAssembly.instantiate(wasmBytes);
    const exports = instance.exports as {
      cifMinWidthLambda: (arch: number) => number;
      cifCheckMinWidth: (arch: number, widthCif: number, lambdaCif: number) => number;
      cifEvalLayerParasitics: (area: number, perim: number, ca: number, cf: number) => number;
      cifEvalElmoreDelayPs: (rs: number, nsq: number, capFf: number) => number;
    };

    assert.strictEqual(exports.cifMinWidthLambda(CifArchetypeId.CWN), 10);
    assert.strictEqual(exports.cifMinWidthLambda(CifArchetypeId.CMF), 3);
    assert.strictEqual(exports.cifCheckMinWidth(CifArchetypeId.CMF, 300, 100), 1);
    assert.strictEqual(exports.cifCheckMinWidth(CifArchetypeId.CMF, 250, 100), 0);

    const capFf = exports.cifEvalLayerParasitics(48, 52, 95, 45);
    assert.ok(Math.abs(capFf - 6.9) < 1e-9);

    const delayPs = exports.cifEvalElmoreDelayPs(25, 12, capFf);
    assert.ok(Math.abs(delayPs - 25 * 12 * 6.9 * 1e-3) < 1e-9);
  });
});
