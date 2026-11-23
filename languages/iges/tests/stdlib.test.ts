// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildIgesCleanroomSchemas,
  ensureBuiltInIgesLibraryRegistered,
  generateIgesBlockSvg,
  getIgesSchemasFromLibraries,
  getIgesStdLibWasmBytes,
  IGES_STD_LIB_DIAGRAMS,
  IGES_STD_LIB_PKG_JSON,
  IGES_STD_LIB_SYMBOLS,
  IGES_STD_SPECS,
  IgesArchetypeId,
  lookupIgesEntitySchema,
  registerBuiltInIgesLibrarySync,
} from "../src/index.js";

interface IgesStdLibWasmExports {
  igesUnitToMeters(unitFlag: number): number;
  igesLineLength(x1: number, y1: number, z1: number, x2: number, y2: number, z2: number): number;
  igesArcLength(cx: number, cy: number, sx: number, sy: number, ex: number, ey: number): number;
  igesQuadNurbsCoord(p0: number, p1: number, p2: number, w0: number, w1: number, w2: number, t: number): number;
  igesEvalKernel(archetypeId: number, a: number, b: number, c: number, d: number): number;
}

describe("@modelscript/iges — Standard Library Catalog & WASM Runtime (@modelscript/iges-std-lib)", () => {
  it("builds 21 cleanroom entity & unit preset schemas with deterministic SVG block icons", () => {
    const schemas = buildIgesCleanroomSchemas();
    assert.equal(schemas.length, IGES_STD_SPECS.length);
    assert.equal(schemas.length, 21);

    for (const s of schemas) {
      assert.ok(s.namePath.startsWith("iges.std."));
      assert.equal(s.domain, "cad");
      assert.ok(s.svg && s.svg.startsWith("<svg ") && s.svg.endsWith("</svg>"));
      assert.ok(s.ports && s.ports.length === 2);
      assert.equal(s.wasmKernel, "igesEvalKernel");
    }

    const svg = generateIgesBlockSvg("TYPE_126", "Curves & Points");
    assert.ok(svg.includes("CURV"));
    assert.ok(svg.includes("TYPE_126"));
  });

  it("registers the built-in stdlib bundle synchronously and supports case-insensitive lookups", () => {
    registerBuiltInIgesLibrarySync();
    ensureBuiltInIgesLibraryRegistered();

    assert.equal(IGES_STD_LIB_PKG_JSON.name, "@modelscript/iges-std-lib");
    assert.equal(IGES_STD_LIB_SYMBOLS.length, 21);
    assert.equal(IGES_STD_LIB_DIAGRAMS.length, 21);

    const schemas = getIgesSchemasFromLibraries();
    assert.ok(schemas.length >= 21);

    const nurbsCurve = lookupIgesEntitySchema(126);
    assert.ok(nurbsCurve);
    assert.equal(nurbsCurve.name, "TYPE_126");
    assert.equal(nurbsCurve.extra?.["archetypeId"], IgesArchetypeId.RATIONAL_BSPLINE_CURVE);

    const byAlias = lookupIgesEntitySchema("ManifoldSolidBRep");
    assert.ok(byAlias);
    assert.equal(byAlias.name, "TYPE_186");

    const byUnit = lookupIgesEntitySchema("mm");
    assert.ok(byUnit);
    assert.equal(byUnit.name, "UNIT_MM");

    assert.equal(lookupIgesEntitySchema("NON_EXISTENT_TYPE"), undefined);
  });

  it("instantiates embedded runtime.wasm and executes cleanroom geometry & unit kernels", async () => {
    const wasmBytes = getIgesStdLibWasmBytes();
    assert.ok(wasmBytes instanceof Uint8Array);
    assert.ok(wasmBytes.byteLength > 100, "Expected non-empty stdlib runtime.wasm bytes");

    const { instance } = await WebAssembly.instantiate(wasmBytes);
    const exports = instance.exports as unknown as IgesStdLibWasmExports;

    assert.ok(Math.abs(exports.igesUnitToMeters(1) - 0.0254) < 1e-12);
    assert.ok(Math.abs(exports.igesUnitToMeters(2) - 0.001) < 1e-12);
    assert.ok(Math.abs(exports.igesUnitToMeters(6) - 1.0) < 1e-12);

    assert.ok(Math.abs(exports.igesLineLength(0, 0, 0, 3, 4, 12) - 13.0) < 1e-12);
    assert.ok(Math.abs(exports.igesArcLength(0, 0, 5, 0, 0, 5) - 2.5 * Math.PI) < 1e-12);
    assert.ok(Math.abs(exports.igesArcLength(0, 0, 5, 0, 5, 0) - 10.0 * Math.PI) < 1e-12);

    // Quadratic rational quarter-circle midpoint X coordinate at t=0.5: R * cos(45°)
    const midX = exports.igesQuadNurbsCoord(10, 10, 0, 1, Math.SQRT1_2, 1, 0.5);
    assert.ok(Math.abs(midX - 10 * Math.SQRT1_2) < 1e-12);

    // Unified kernel dispatch
    assert.ok(Math.abs(exports.igesEvalKernel(110, 0, 0, 3, 4) - 5.0) < 1e-12);
    assert.ok(Math.abs(exports.igesEvalKernel(100, 10, 0, 0, 10) - 5.0 * Math.PI) < 1e-12);
    assert.ok(Math.abs(exports.igesEvalKernel(1002, 0, 0, 0, 0) - 0.001) < 1e-12);
  });
});
