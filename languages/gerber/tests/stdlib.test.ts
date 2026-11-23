// SPDX-License-Identifier: AGPL-3.0-or-later

import { globalLibraryRegistry } from "@modelscript/runtime";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  GERBER_MODEL_SPECS,
  GerberArchetypeId,
  getGerberSchemasFromLibraries,
  getGerberStdLibWasmBytes,
  lookupGerberModelSchema,
  registerBuiltInGerberLibrarySync,
} from "../src/catalog/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STD_LIB_DIR = path.resolve(__dirname, "../assets/gerber-std-lib");

describe("@modelscript/gerber — Cleanroom Standard Library (Aperture Primitives & IPC-2221 DFM Presets)", () => {
  it("loads @modelscript/gerber-std-lib via modelscript.yaml with symbols, SVG icons, and runtime.wasm", async () => {
    const manifestPath = path.join(STD_LIB_DIR, "modelscript.yaml");
    assert.ok(fs.existsSync(manifestPath), "Expected gerber-std-lib/modelscript.yaml");

    const pkg = await globalLibraryRegistry.loadLibraryFromDir(STD_LIB_DIR);
    assert.ok(pkg, "Expected loadLibraryFromDir to return loaded package");
    assert.equal(pkg.packageName, "@modelscript/gerber-std-lib");
    assert.equal(pkg.manifest.language, "gerber");
    assert.equal(pkg.symbols.length, GERBER_MODEL_SPECS.length);
    assert.equal(pkg.diagrams.length, GERBER_MODEL_SPECS.length);
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

  it("supports zero-I/O sync registration and case-insensitive alias lookup", () => {
    registerBuiltInGerberLibrarySync();
    const schemas = getGerberSchemasFromLibraries();
    assert.ok(schemas.length >= GERBER_MODEL_SPECS.length);

    assert.equal(lookupGerberModelSchema("C")?.name, "APERTURE_CIRCLE");
    assert.equal(lookupGerberModelSchema("R")?.name, "APERTURE_RECTANGLE");
    assert.equal(lookupGerberModelSchema("O")?.name, "APERTURE_OBROUND");
    assert.equal(lookupGerberModelSchema("P")?.name, "APERTURE_POLYGON");
    assert.equal(lookupGerberModelSchema("IPC_CLASS2")?.name, "IPC2221_CLASS2_TRACE");
    assert.equal(lookupGerberModelSchema("CU_1OZ")?.name, "IPC2221_COPPER_1OZ");
    assert.equal(lookupGerberModelSchema("FR4")?.name, "IPC2221_FR4_SUBSTRATE");
  });

  it("executes cleanroom AssemblyScript runtime.wasm aperture & IPC-2221 kernels accurately", async () => {
    const wasmBytes = getGerberStdLibWasmBytes();
    assert.ok(wasmBytes.byteLength > 0);
    const { instance } = await WebAssembly.instantiate(wasmBytes, {});
    const exports = instance.exports as {
      gerberApertureAreaMm2: (arch: number, p0: number, p1: number, p2: number) => number;
      gerberTraceResistanceOhm: (l: number, w: number, tUm: number, tempC: number) => number;
      gerberIpc2221AmpacityA: (w: number, tUm: number, dT: number, ext: number) => number;
      gerberAnnularRingMm: (pad: number, drill: number) => number;
    };

    // Circle Ø2.0 mm with Ø1.0 mm hole -> pi*(1^2 - 0.5^2)
    const circleArea = exports.gerberApertureAreaMm2(GerberArchetypeId.APERTURE_CIRCLE, 2.0, 1.0, 0);
    assert.ok(Math.abs(circleArea - Math.PI * 0.75) < 1e-9);

    // Rectangle 3.0 x 2.0 mm -> 6.0 mm^2
    const rectArea = exports.gerberApertureAreaMm2(GerberArchetypeId.APERTURE_RECTANGLE, 3.0, 2.0, 0);
    assert.ok(Math.abs(rectArea - 6.0) < 1e-9);

    // Obround 3.0 x 1.0 mm -> (3-1)*1 + pi*0.5^2
    const obroundArea = exports.gerberApertureAreaMm2(GerberArchetypeId.APERTURE_OBROUND, 3.0, 1.0, 0);
    assert.ok(Math.abs(obroundArea - (2.0 + Math.PI * 0.25)) < 1e-9);

    // Hexagon Ø2.0 mm (R=1.0) -> 3*sqrt(3)/2
    const hexArea = exports.gerberApertureAreaMm2(GerberArchetypeId.APERTURE_POLYGON, 2.0, 6, 0);
    assert.ok(Math.abs(hexArea - (3 * Math.sqrt(3)) / 2) < 1e-9);

    // IPC-2221 trace resistance & ampacity & annular ring
    const r = exports.gerberTraceResistanceOhm(100.0, 0.5, 34.8, 20.0);
    const expectedR = (1.7241e-8 * 0.1) / (0.0005 * 34.8e-6);
    assert.ok(Math.abs(r - expectedR) < 1e-9);

    const amp = exports.gerberIpc2221AmpacityA(0.5, 34.8, 10.0, 1);
    assert.ok(amp > 1.0 && amp < 3.0, `Expected 0.5 mm 1 oz external trace ampacity ~1.5 A, got ${amp}`);

    const ring = exports.gerberAnnularRingMm(0.6, 0.3);
    assert.ok(Math.abs(ring - 0.15) < 1e-12);
  });
});
