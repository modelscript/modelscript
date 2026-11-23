// SPDX-License-Identifier: AGPL-3.0-or-later

import { globalLibraryRegistry } from "@modelscript/runtime";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  GAUSSIAN_MODEL_SPECS,
  GaussianArchetypeId,
  getGaussianSchemasFromLibraries,
  lookupGaussianModelSchema,
  registerBuiltInGaussianLibrarySync,
} from "../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STD_LIB_DIR = path.resolve(__dirname, "../assets/gaussian-std-lib");

describe("@modelscript/gaussian — Cleanroom Standard Library (Methods & Basis Sets)", () => {
  it("loads @modelscript/gaussian-std-lib via modelscript.yaml with SVG icons and runtime.wasm", async () => {
    const manifestPath = path.join(STD_LIB_DIR, "modelscript.yaml");
    assert.ok(fs.existsSync(manifestPath), "Expected gaussian-std-lib/modelscript.yaml");

    const pkg = await globalLibraryRegistry.loadLibraryFromDir(STD_LIB_DIR);
    assert.ok(pkg, "Expected loadLibraryFromDir to return loaded package");
    assert.equal(pkg.packageName, "@modelscript/gaussian-std-lib");
    assert.equal(pkg.manifest.language, "gaussian");
    assert.equal(pkg.symbols.length, GAUSSIAN_MODEL_SPECS.length);
    assert.equal(pkg.diagrams.length, GAUSSIAN_MODEL_SPECS.length);
    assert.ok(pkg.wasmBytes && pkg.wasmBytes.byteLength > 0, "Expected compiled runtime.wasm bytes");

    for (const diag of pkg.diagrams) {
      assert.ok(diag.svg && diag.svg.startsWith("<svg"), `Expected cleanroom SVG icon for ${diag.namePath}`);
      assert.ok(diag.ports.length > 0, `Expected diagram ports for ${diag.namePath}`);
    }
    for (const sym of pkg.symbols) {
      const prov = (sym.metadata as Record<string, unknown> | undefined)?.["provenance"];
      assert.ok(typeof prov === "string" && prov.length > 5, `Expected provenance citation for ${sym.namePath}`);
    }
  });

  it("supports zero-I/O registration and lookup for all standard methods and basis sets", () => {
    registerBuiltInGaussianLibrarySync();
    const schemas = getGaussianSchemasFromLibraries();
    assert.ok(schemas.length >= 12);

    const requiredMethods = ["HF", "MP2", "CCSD(T)", "B3LYP", "PBE0", "M06-2X"];
    const requiredBasisSets = ["STO-3G", "3-21G", "6-31G(d)", "6-311++G(d,p)", "cc-pVDZ", "cc-pVTZ"];

    for (const m of requiredMethods) {
      assert.equal(lookupGaussianModelSchema(m)?.name, m, `Expected method schema for ${m}`);
    }
    for (const b of requiredBasisSets) {
      assert.equal(lookupGaussianModelSchema(b)?.name, b, `Expected basis schema for ${b}`);
    }

    // Alias lookup
    assert.equal(lookupGaussianModelSchema("6-31G*")?.name, "6-31G(d)");
    assert.equal(lookupGaussianModelSchema("PBE1PBE")?.name, "PBE0");
    assert.equal(lookupGaussianModelSchema("M062X")?.name, "M06-2X");
  });

  it("executes cleanroom AssemblyScript runtime.wasm kernels for methods and basis sets", async () => {
    const wasmBytes = fs.readFileSync(path.join(STD_LIB_DIR, "dist", "runtime.wasm"));
    const mod = await WebAssembly.instantiate(wasmBytes, {});
    const exports = mod.instance.exports as {
      gaussianMethodZpeScale: (id: number) => number;
      gaussianMethodScalingOrder: (id: number) => number;
      gaussianBasisFunctionCount: (id: number, nH: number, nHeavy: number) => number;
    };

    assert.ok(Math.abs(exports.gaussianMethodZpeScale(GaussianArchetypeId.B3LYP) - 0.9614) < 1e-6);
    assert.equal(exports.gaussianMethodScalingOrder(GaussianArchetypeId.CCSD_T), 7.0);
    assert.equal(exports.gaussianMethodScalingOrder(GaussianArchetypeId.MP2), 5.0);
    // Water (2 H, 1 O): STO-3G = 2*1 + 1*5 = 7 basis functions; 6-31G(d) = 2*2 + 1*15 = 19; cc-pVDZ = 2*5 + 1*14 = 24
    assert.equal(exports.gaussianBasisFunctionCount(GaussianArchetypeId.STO_3G, 2, 1), 7);
    assert.equal(exports.gaussianBasisFunctionCount(GaussianArchetypeId.BASIS_6_31G_D, 2, 1), 19);
    assert.equal(exports.gaussianBasisFunctionCount(GaussianArchetypeId.CC_PVDZ, 2, 1), 24);
  });
});
