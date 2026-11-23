// SPDX-License-Identifier: AGPL-3.0-or-later

import { globalLibraryRegistry } from "@modelscript/runtime";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ACI_COLORS,
  DXF_ENTITY_SPECS,
  DXF_LAYER_PRESETS,
  DXF_STD_LIB_DIAGRAMS,
  DXF_STD_LIB_SYMBOLS,
  ensureBuiltInDxfLibraryRegistered,
  generateDxfEntitySvg,
  getDxfSchemasFromLibraries,
  getDxfStdLibWasmBytes,
  lookupDxfEntitySchema,
} from "../src/index.js";

interface DxfWasmKernelExports {
  dxfLineLength(x1: number, y1: number, z1: number, x2: number, y2: number, z2: number): number;
  dxfCircleCircumference(radius: number): number;
  dxfCircleArea(radius: number): number;
  dxfArcLength(radius: number, startDeg: number, endDeg: number): number;
  dxfBulgeArcLength(x1: number, y1: number, x2: number, y2: number, bulge: number): number;
  dxfBulgeSegmentArea(x1: number, y1: number, x2: number, y2: number, bulge: number): number;
  dxfEllipseArea(majorRadius: number, ratio: number): number;
  dxfTriangleArea3D(
    x0: number,
    y0: number,
    z0: number,
    x1: number,
    y1: number,
    z1: number,
    x2: number,
    y2: number,
    z2: number,
  ): number;
  dxfInsertTransformX(x: number, y: number, sx: number, sy: number, rotDeg: number, tx: number): number;
  dxfInsertTransformY(x: number, y: number, sx: number, sy: number, rotDeg: number, ty: number): number;
}

describe("DXF cleanroom standard library & WASM kernel", () => {
  it("registers @modelscript/dxf-std-lib in globalLibraryRegistry with symbols, diagrams, and WASM bytes", () => {
    ensureBuiltInDxfLibraryRegistered();
    const pkgs = globalLibraryRegistry.getPackagesForLanguage("dxf");
    assert.ok(pkgs.length >= 1);
    assert.equal(DXF_STD_LIB_SYMBOLS.length, DXF_ENTITY_SPECS.length);
    assert.equal(DXF_STD_LIB_DIAGRAMS.length, DXF_ENTITY_SPECS.length);

    for (const sym of DXF_STD_LIB_SYMBOLS) {
      assert.ok(sym.exports?.every((e) => typeof e === "string" && e.length > 0));
    }
  });

  it("resolves schemas by canonical name, qualified path, and aliases", () => {
    const schemas = getDxfSchemasFromLibraries();
    assert.equal(schemas.length, 8);

    const circle = lookupDxfEntitySchema("CIRCLE");
    assert.ok(circle);
    assert.equal(circle.namePath, "DXF.CIRCLE");
    assert.ok(circle.parameters.some((p) => p.key === "radius"));

    assert.equal(lookupDxfEntitySchema("DXF.LWPOLYLINE")?.name, "LWPOLYLINE");
    assert.equal(lookupDxfEntitySchema("BORE")?.name, "CIRCLE");
    assert.equal(lookupDxfEntitySchema("NURBS")?.name, "SPLINE");
    assert.equal(lookupDxfEntitySchema("BLOCK_REF")?.name, "INSERT");
    assert.equal(lookupDxfEntitySchema("NON_EXISTENT_ENTITY"), undefined);
  });

  it("provides ACI color presets, layer presets, and cleanroom SVG entity icons", () => {
    assert.ok(ACI_COLORS.length >= 8);
    assert.ok(DXF_LAYER_PRESETS.length >= 5);
    const svg = generateDxfEntitySvg("LWPOLYLINE", "Curves & Profiles");
    assert.ok(svg.includes("<svg"));
    assert.ok(svg.includes("LWPOLYLINE"));
  });

  it("instantiates runtime.wasm and evaluates analytical geometry kernel functions accurately", async () => {
    const wasmBytes = getDxfStdLibWasmBytes();
    assert.ok(wasmBytes.byteLength > 100);

    const { instance } = await WebAssembly.instantiate(wasmBytes, {});
    const k = instance.exports as unknown as DxfWasmKernelExports;

    assert.ok(Math.abs(k.dxfLineLength(0, 0, 0, 3, 4, 12) - 13) < 1e-12);
    assert.ok(Math.abs(k.dxfCircleCircumference(5) - 10 * Math.PI) < 1e-12);
    assert.ok(Math.abs(k.dxfCircleArea(5) - 25 * Math.PI) < 1e-12);
    assert.ok(Math.abs(k.dxfArcLength(10, 0, 90) - 5 * Math.PI) < 1e-12);
    assert.ok(Math.abs(k.dxfBulgeArcLength(0, 0, 10, 0, 1) - 5 * Math.PI) < 1e-12);
    assert.ok(Math.abs(k.dxfBulgeSegmentArea(0, 0, 10, 0, 1) - 0.5 * Math.PI * 25) < 1e-12);
    assert.ok(Math.abs(k.dxfEllipseArea(10, 0.5) - 50 * Math.PI) < 1e-12);
    assert.ok(Math.abs(k.dxfTriangleArea3D(0, 0, 0, 4, 0, 0, 0, 3, 0) - 6) < 1e-12);
    assert.ok(Math.abs(k.dxfInsertTransformX(2, 0, 3, 3, 90, 10) - 10) < 1e-12);
    assert.ok(Math.abs(k.dxfInsertTransformY(2, 0, 3, 3, 90, 5) - 11) < 1e-12);
  });
});
