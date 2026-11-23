// SPDX-License-Identifier: AGPL-3.0-or-later

import { globalLibraryRegistry } from "@modelscript/runtime";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getDatcomStdLibWasmBytes } from "../src/catalog/datcom-std-lib-data.js";
import {
  DATCOM_AIRCRAFT_TEMPLATES,
  DatcomArchetypeId,
  ensureBuiltInDatcomLibraryRegistered,
  getDatcomSchemasFromLibraries,
  lookupDatcomModelSchema,
} from "../src/catalog/index.js";

describe("DATCOM Cleanroom Standard Library (@modelscript/datcom-std-lib)", () => {
  it("registers NACA airfoil catalog and aircraft configuration templates in globalLibraryRegistry", () => {
    ensureBuiltInDatcomLibraryRegistered();
    const pkgs = globalLibraryRegistry.getPackagesForLanguage("datcom");
    assert.ok(pkgs.length >= 1);

    const schemas = getDatcomSchemasFromLibraries();
    assert.strictEqual(schemas.length, 8);

    // Verify required NACA airfoils
    for (const airfoil of ["0012", "2412", "4412", "23012", "64A010"]) {
      const s = lookupDatcomModelSchema(airfoil);
      assert.ok(s, `Missing NACA airfoil '${airfoil}' in stdlib`);
      assert.strictEqual(s.category, "NACA Airfoils");
      assert.ok(s.svg && s.svg.includes("<svg"));
    }

    // Verify required aircraft templates
    for (const acft of ["CESSNA_172", "CITATION_JET", "SUPERSONIC_DELTA"]) {
      const s = lookupDatcomModelSchema(acft);
      assert.ok(s, `Missing aircraft template '${acft}' in stdlib`);
      assert.strictEqual(s.category, "Aircraft Configurations");
    }

    assert.ok(DATCOM_AIRCRAFT_TEMPLATES.CESSNA_172.includes("NACA-W-4-2412"));
    assert.ok(DATCOM_AIRCRAFT_TEMPLATES.CITATION_JET.includes("NACA-W-5-23012"));
    assert.ok(DATCOM_AIRCRAFT_TEMPLATES.SUPERSONIC_DELTA.includes("NACA-W-6-64A010"));
  });

  it("instantiates and executes the cleanroom AssemblyScript WASM aerodynamic runtime", async () => {
    const wasmBytes = getDatcomStdLibWasmBytes();
    assert.ok(wasmBytes.byteLength > 100);

    const { instance } = await WebAssembly.instantiate(wasmBytes, {});
    const exports = instance.exports as {
      memory: WebAssembly.Memory;
      datcomFiniteWingCLalpha: (ar: number, mach: number, sweepDeg: number) => number;
      datcomModelEval: (archetypeId: number, slotPtr: number, conCount: number) => void;
    };

    const clAlpha = exports.datcomFiniteWingCLalpha(12.0, 0.05, 0.0);
    assert.ok(clAlpha > 5.0 && clAlpha < 5.6, `Unexpected WASM CL_alpha=${clAlpha}`);

    // Evaluate NACA_0012 at alpha = 5 deg, M = 0.2
    const slotPtr = 1024;
    const f64 = new Float64Array(exports.memory.buffer, slotPtr, 32);
    f64[0] = 0.12; // TC
    f64[1] = 0.0; // CAMBER
    f64[2] = 0.0; // ALPHA_L0
    f64[3] = 2 * Math.PI; // CL_ALPHA
    f64[4] = 0.0056; // CD0
    f64[5] = 0.0; // CM_AC
    // IO bus starts at offset 0x80 -> index 16 in f64
    f64[16] = (5.0 * Math.PI) / 180.0; // alphaRad
    f64[17] = 0.2; // mach

    exports.datcomModelEval(DatcomArchetypeId.NACA_0012, slotPtr, 6);
    const clOut = f64[18]!;
    const cdOut = f64[19]!;
    assert.ok(clOut > 0.5 && clOut < 0.65, `Unexpected NACA 0012 CL=${clOut}`);
    assert.ok(cdOut > 0.0056);
  });
});
