// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildJcampDxCleanroomSchemas,
  ensureBuiltInJcampDxLibraryRegistered,
  getJcampDxSchemasFromLibraries,
  IR_FUNCTIONAL_GROUP_BANDS,
  lookupJcampDxModelSchema,
  matchIrFunctionalGroup,
} from "../src/catalog/index.js";
import { getJcampDxStdLibWasmBytes } from "../src/catalog/jcamp-dx-std-lib-data.js";

describe("@modelscript/jcamp-dx Cleanroom Standard Library", () => {
  it("registers @modelscript/jcamp-dx-std-lib with spectroscopy types and IR functional groups", () => {
    ensureBuiltInJcampDxLibraryRegistered();
    const schemas = getJcampDxSchemasFromLibraries();
    const built = buildJcampDxCleanroomSchemas();
    assert.strictEqual(schemas.length, built.length);
    assert.ok(schemas.length >= 10, "Expected at least 5 spectroscopy types + 5 IR functional groups");

    assert.ok(lookupJcampDxModelSchema("INFRARED SPECTRUM"));
    assert.ok(lookupJcampDxModelSchema("NMR SPECTRUM"));
    assert.ok(lookupJcampDxModelSchema("MASS SPECTRUM"));
    assert.ok(lookupJcampDxModelSchema("UV/VIS SPECTRUM"));
    assert.ok(lookupJcampDxModelSchema("RAMAN SPECTRUM"));
    assert.ok(lookupJcampDxModelSchema("C=O"));
    assert.ok(lookupJcampDxModelSchema("O-H"));
  });

  it("matches characteristic IR functional-group absorption bands (O-H, C=O, C-H, C=C, C-O)", () => {
    assert.strictEqual(IR_FUNCTIONAL_GROUP_BANDS.length, 5);
    assert.strictEqual(matchIrFunctionalGroup(3380)?.bond, "O-H");
    assert.strictEqual(matchIrFunctionalGroup(2920)?.bond, "C-H");
    assert.strictEqual(matchIrFunctionalGroup(1715)?.bond, "C=O");
    assert.strictEqual(matchIrFunctionalGroup(1645)?.bond, "C=C");
    assert.strictEqual(matchIrFunctionalGroup(1150)?.bond, "C-O");
    assert.strictEqual(matchIrFunctionalGroup(500), undefined);
  });

  it("executes compiled AssemblyScript WASM runtime kernel for Beer-Lambert & Lorentzian/Gaussian bands", async () => {
    const wasmBytes = getJcampDxStdLibWasmBytes();
    assert.ok(wasmBytes.byteLength > 0, "Expected non-empty stdlib runtime.wasm");
    const { instance } = await WebAssembly.instantiate(wasmBytes);
    const exports = instance.exports as {
      beerLambertAbsorbance: (t: number) => number;
      beerLambertTransmittance: (a: number) => number;
      evalLorentzian: (x: number, center: number, amp: number, gamma: number) => number;
      evalGaussian: (x: number, center: number, amp: number, sigma: number) => number;
    };

    assert.ok(Math.abs(exports.beerLambertAbsorbance(0.1) - 1.0) < 1e-12);
    assert.ok(Math.abs(exports.beerLambertTransmittance(2.0) - 0.01) < 1e-12);
    assert.ok(Math.abs(exports.evalLorentzian(1715, 1715, 1.2, 15) - 1.2) < 1e-12);
    assert.ok(Math.abs(exports.evalGaussian(3380, 3380, 0.85, 80) - 0.85) < 1e-12);
  });
});
