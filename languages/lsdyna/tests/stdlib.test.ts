// SPDX-License-Identifier: AGPL-3.0-or-later

import { globalLibraryRegistry } from "@modelscript/runtime";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  LSDYNA_MODEL_SPECS,
  LsDynaArchetypeId,
  getLsDynaSchemasFromLibraries,
  getLsDynaStdLibWasmBytes,
  lookupLsDynaSchema,
  registerBuiltInLsDynaLibrarySync,
} from "../src/catalog/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STD_LIB_DIR = path.resolve(__dirname, "../assets/lsdyna-std-lib");

interface LsDynaStdLibWasmExports {
  memory: WebAssembly.Memory;
  lsdynaBarWaveSpeed(e: number, rho: number): number;
  lsdynaSolidWaveSpeed(e: number, rho: number, nu: number): number;
  lsdynaCflTimestep(charLength: number, waveSpeed: number): number;
  lsdynaConstitutiveInit(archetypeId: number, slotPtr: number, conCount: number): void;
  lsdynaConstitutiveEval(archetypeId: number, slotPtr: number, conCount: number): void;
}

describe("@modelscript/lsdyna — Cleanroom Standard Library (modelscript.yaml & WASM Runtime)", () => {
  it("loads @modelscript/lsdyna-std-lib via modelscript.yaml with symbols, SVG icons, and runtime.wasm", async () => {
    const manifestPath = path.join(STD_LIB_DIR, "modelscript.yaml");
    assert.ok(fs.existsSync(manifestPath), "Expected lsdyna-std-lib/modelscript.yaml");

    const pkg = await globalLibraryRegistry.loadLibraryFromDir(STD_LIB_DIR);
    assert.ok(pkg, "Expected loadLibraryFromDir to return loaded package");
    assert.equal(pkg.packageName, "@modelscript/lsdyna-std-lib");
    assert.equal(pkg.manifest.language, "lsdyna");
    assert.equal(pkg.symbols.length, LSDYNA_MODEL_SPECS.length);
    assert.equal(pkg.diagrams.length, LSDYNA_MODEL_SPECS.length);
    assert.ok(pkg.wasmBytes && pkg.wasmBytes.byteLength > 0, "Expected compiled runtime.wasm bytes");

    for (const diag of pkg.diagrams) {
      assert.ok(diag.svg && diag.svg.startsWith("<svg"), `Expected SVG icon for ${diag.namePath}`);
      assert.ok(diag.ports.length > 0, `Expected ports for ${diag.namePath}`);
    }
    for (const sym of pkg.symbols) {
      const prov = (sym.metadata as Record<string, unknown> | undefined)?.["provenance"];
      assert.ok(typeof prov === "string" && prov.length > 5, `Expected provenance for ${sym.namePath}`);
    }
  });

  it("supports zero-I/O sync registration and alias lookup for all 7 LS-DYNA material/section schemas", () => {
    registerBuiltInLsDynaLibrarySync();
    const schemas = getLsDynaSchemasFromLibraries();
    assert.ok(schemas.length >= 7);

    assert.equal(lookupLsDynaSchema("MAT_001")?.name, "MAT_001");
    assert.equal(lookupLsDynaSchema("*MAT_ELASTIC")?.name, "MAT_001");
    assert.equal(lookupLsDynaSchema("MAT_PLASTIC_KINEMATIC")?.name, "MAT_003");
    assert.equal(lookupLsDynaSchema("MAT_RIGID")?.name, "MAT_020");
    assert.equal(lookupLsDynaSchema("MAT_PIECEWISE_LINEAR_PLASTICITY")?.name, "MAT_024");
    assert.equal(lookupLsDynaSchema("SECTION_SOLID")?.name, "SECTION_SOLID");
    assert.equal(lookupLsDynaSchema("SECTION_SHELL")?.name, "SECTION_SHELL");
    assert.equal(lookupLsDynaSchema("SECTION_BEAM")?.name, "SECTION_BEAM");
  });

  it("executes MAT_001 elastic, MAT_003 plastic-kinematic, and wave speed kernels in runtime.wasm", () => {
    const wasmBytes = getLsDynaStdLibWasmBytes();
    const mod = new WebAssembly.Module(wasmBytes);
    const inst = new WebAssembly.Instance(mod);
    const exp = inst.exports as unknown as LsDynaStdLibWasmExports;

    const cBar = exp.lsdynaBarWaveSpeed(2.1e11, 7850.0);
    assert.ok(Math.abs(cBar - Math.sqrt(2.1e11 / 7850.0)) < 1e-9);

    const cSolid = exp.lsdynaSolidWaveSpeed(2.1e11, 7850.0, 0.3);
    const cSolidExact = Math.sqrt((2.1e11 * 0.7) / (7850.0 * 1.3 * 0.4));
    assert.ok(Math.abs(cSolid - cSolidExact) < 1e-9);

    const dtCr = exp.lsdynaCflTimestep(0.05, cBar);
    assert.ok(Math.abs(dtCr - 0.05 / cBar) < 1e-12);

    // Evaluate MAT_003 in slot 0 at memory offset 4096
    const slotPtr = 4096;
    const f64 = new Float64Array(exp.memory.buffer);
    const conBase = (slotPtr + 0x080) >> 3;
    const ioBase = (slotPtr + 0x780) >> 3;

    f64[conBase + 0] = 7850.0; // ro
    f64[conBase + 1] = 2.1e11; // E
    f64[conBase + 2] = 0.3; // pr
    f64[conBase + 3] = 2.5e8; // sigy
    f64[conBase + 4] = 2.1e9; // etan
    f64[conBase + 5] = 1.0; // beta
    f64[conBase + 6] = 0.25; // fs

    exp.lsdynaConstitutiveInit(LsDynaArchetypeId.MAT_003, slotPtr, 7);

    // Elastic regime strain = 0.0005 -> stress = 1.05e8 < 2.5e8
    f64[ioBase + 0] = 0.0005;
    f64[ioBase + 4] = 0.05;
    exp.lsdynaConstitutiveEval(LsDynaArchetypeId.MAT_003, slotPtr, 7);
    assert.ok(Math.abs(f64[ioBase + 1]! - 1.05e8) < 1e-3);
    assert.equal(f64[ioBase + 6], 0.0);

    // Plastic regime strain = 0.01 -> trial stress = 2.1e9 > 2.5e8 => yielding occurs
    f64[ioBase + 0] = 0.01;
    exp.lsdynaConstitutiveEval(LsDynaArchetypeId.MAT_003, slotPtr, 7);
    assert.ok(f64[ioBase + 1]! > 2.5e8 && f64[ioBase + 1]! < 2.1e9, "Expected work-hardened stress");
    assert.ok(f64[ioBase + 6]! > 0.0, "Expected positive equivalent plastic strain");
  });
});
