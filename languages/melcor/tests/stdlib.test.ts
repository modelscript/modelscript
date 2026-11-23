// SPDX-License-Identifier: AGPL-3.0-or-later

import { globalLibraryRegistry } from "@modelscript/runtime";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MelcorArchetypeId,
  ensureBuiltInMelcorLibraryRegistered,
  getMelcorSchemasFromLibraries,
  getMelcorStdLibWasmBytes,
  lookupMelcorModelSchema,
} from "../src/catalog/index.js";

describe("@modelscript/melcor — Cleanroom Standard Library & WASM Runtime", () => {
  it("registers @modelscript/melcor-std-lib with all 9 MELCOR packages and 6 severe-accident materials", () => {
    ensureBuiltInMelcorLibraryRegistered();
    const pkgs = globalLibraryRegistry.getPackagesForLanguage("melcor");
    assert.ok(pkgs.length >= 1);

    const schemas = getMelcorSchemasFromLibraries();
    assert.ok(schemas.length >= 17, `Expected >= 17 schemas, got ${schemas.length}`);

    // Verify all 9 MELCOR packages
    const requiredPackages = ["CVH", "FL", "HS", "COR", "RN1", "CF", "TF", "MP", "NCG"];
    const presentPackages = new Set(schemas.map((s) => s.extra?.["melcorPackage"]));
    for (const p of requiredPackages) {
      assert.ok(presentPackages.has(p), `Missing MELCOR package schema: ${p}`);
    }

    // Verify all 6 severe-accident materials
    for (const mat of ["UO2", "Zircaloy-4", "SS304", "H2", "N2", "H2O"]) {
      const schema = lookupMelcorModelSchema(mat);
      assert.ok(schema, `Material '${mat}' should resolve via lookupMelcorModelSchema`);
      assert.ok(schema.svg?.includes("<svg"), `Schema '${schema.name}' should include cleanroom SVG icon`);
    }
  });

  it("executes AssemblyScript WASM runtime for COR_CELL heatup and COR_OX_UH oxidation", async () => {
    const wasmBytes = getMelcorStdLibWasmBytes();
    assert.ok(wasmBytes.byteLength > 1000);

    const mod = await WebAssembly.compile(wasmBytes as BufferSource);
    const instance = await WebAssembly.instantiate(mod, {});
    const exports = instance.exports as {
      memory: WebAssembly.Memory;
      melGetArenaBase: () => number;
      melModelInit: (arch: number, slotPtr: number, conCount: number) => number;
      melModelStep: (arch: number, t: number, dt: number, slotPtr: number, conCount: number) => void;
    };

    const slotPtr = exports.melGetArenaBase();
    const view = new Float64Array(exports.memory.buffer);
    const conBase = (slotPtr + 0x080) >> 3;
    const ioBase = (slotPtr + 0x780) >> 3;

    // 1. Test COR_CELL adiabatic heatup: m=80000, cp=350, qDecay=2.8e7 (dT/dt = 1 K/s), t0=600 K, htc=0
    view[conBase + 0] = 80000.0;
    view[conBase + 1] = 350.0;
    view[conBase + 2] = 2.8e7;
    view[conBase + 3] = 600.0;
    view[conBase + 4] = 0.0;
    view[conBase + 5] = 1000.0;
    view[ioBase + 5] = 0.0;

    const nStates = exports.melModelInit(MelcorArchetypeId.COR_CELL, slotPtr, 6);
    assert.equal(nStates, 1);

    for (let i = 0; i < 100; i++) {
      exports.melModelStep(MelcorArchetypeId.COR_CELL, i * 0.5, 0.5, slotPtr, 6);
    }
    const finalTemp = view[ioBase + 2] ?? 0;
    assert.ok(Math.abs(finalTemp - 650.0) < 1e-6, `Expected 650.0 K, got ${finalTemp}`);

    // 2. Test COR_OX_UH parabolic oxidation at 1600 K for 100 s
    const slot2 = slotPtr + 2048;
    const con2 = (slot2 + 0x080) >> 3;
    const io2 = (slot2 + 0x780) >> 3;
    view[con2 + 0] = 29.6;
    view[con2 + 1] = 16820.0;
    view[con2 + 2] = 87.9;
    view[con2 + 3] = 16610.0;
    view[con2 + 4] = 4500.0;
    view[con2 + 5] = 6.45e6;
    view[io2 + 2] = 1600.0;

    exports.melModelInit(MelcorArchetypeId.COR_OX_UH, slot2, 6);
    exports.melModelStep(MelcorArchetypeId.COR_OX_UH, 0.0, 100.0, slot2, 6);
    const h2Mass = view[io2 + 4] ?? 0;
    const expectedH2 = 4500.0 * Math.sqrt(29.6 * Math.exp(-16820.0 / 1600.0) * 100.0) * (4.03176 / 91.224);
    const relErr = Math.abs(h2Mass - expectedH2) / expectedH2;
    assert.ok(relErr < 1e-9, `WASM COR_OX_UH H2 relErr=${relErr}`);
  });
});
