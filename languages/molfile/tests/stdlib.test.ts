// SPDX-License-Identifier: AGPL-3.0-or-later

import { globalLibraryRegistry } from "@modelscript/runtime";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildMolfileCleanroomSchemas,
  CANONICAL_MOLFILES,
  ensureBuiltInMolfileLibraryRegistered,
  getMolfileSchemasFromLibraries,
  getMolfileStdLibWasmBytes,
  lookupMolfileModelSchema,
} from "../src/catalog/index.js";

describe("Molfile Cleanroom Standard Library & WASM Runtime", () => {
  it("registers @modelscript/molfile-std-lib into globalLibraryRegistry with zero I/O", () => {
    ensureBuiltInMolfileLibraryRegistered();
    const pkgs = globalLibraryRegistry.getPackagesForLanguage("molfile");
    assert.ok(pkgs.length >= 1, "Expected at least one registered molfile stdlib package");

    const schemas = getMolfileSchemasFromLibraries();
    const directSchemas = buildMolfileCleanroomSchemas();
    assert.strictEqual(schemas.length, directSchemas.length);
    assert.ok(schemas.length >= 47, "Expected >= 42 elements + 5 canonical molecules");
  });

  it("looks up periodic table elements and canonical molecules by name, path, or alias", () => {
    const carbon = lookupMolfileModelSchema("C");
    assert.ok(carbon);
    assert.strictEqual(carbon.category, "Elements");
    assert.ok(
      carbon.parameters.some((p) => p.key === "atomicWeight" && Math.abs((p.defaultValue as number) - 12.0107) < 1e-4),
    );

    const aspirin = lookupMolfileModelSchema("Aspirin");
    assert.ok(aspirin);
    assert.strictEqual(aspirin.category, "Canonical Molecules");

    const byFormula = lookupMolfileModelSchema("C8H10N4O2");
    assert.ok(byFormula);
    assert.strictEqual(byFormula.name, "Caffeine");

    assert.strictEqual(Object.keys(CANONICAL_MOLFILES).length, 5);
  });

  it("instantiates cleanroom stdlib runtime.wasm and evaluates harmonic bond-stretch kernels", async () => {
    const wasmBytes = getMolfileStdLibWasmBytes();
    assert.ok(wasmBytes.byteLength > 100, "Expected non-empty WASM binary");

    const wasmBuffer = new Uint8Array(wasmBytes).buffer;
    const { instance } = await WebAssembly.instantiate(wasmBuffer, {});
    const exports = instance.exports as {
      bondLength3D: (x1: number, y1: number, z1: number, x2: number, y2: number, z2: number) => number;
      uffEquilibriumLength: (r1: number, r2: number, bo: number) => number;
      uffForceConstant: (z1: number, z2: number, r0: number) => number;
      harmonicBondEnergy: (r: number, r0: number, kb: number) => number;
      getCanonicalMoleculeCount: () => number;
    };

    assert.strictEqual(exports.getCanonicalMoleculeCount(), 5);

    const dist = exports.bondLength3D(0, 0, 0, 1.395, 0, 0);
    assert.ok(Math.abs(dist - 1.395) < 1e-9);

    const r0 = exports.uffEquilibriumLength(0.76, 0.76, 1.0);
    assert.ok(Math.abs(r0 - 1.52) < 1e-9);

    const kb = exports.uffForceConstant(1.912, 1.912, r0);
    assert.ok(kb > 500 && kb < 1000);

    const energy = exports.harmonicBondEnergy(1.62, 1.52, kb);
    const expected = 0.5 * kb * 0.1 * 0.1;
    assert.ok(Math.abs(energy - expected) < 1e-9);
  });
});
