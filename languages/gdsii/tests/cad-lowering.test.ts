// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extrudeGdsiiTo3dStack, lowerGdsiiToGeometry } from "../src/cad/index.js";
import { extractGdsiiParasitics, gdsiiToDae } from "../src/dae/index.js";
import { parseGdsiiAscii } from "../src/parser/gdt-parser.js";
import { gdsiiToCif, gdsiiToSvg } from "../src/projections/index.js";

const HIER_LAYOUT = `
HEADER 600
BGNLIB
LIBNAME CAD_TEST
UNITS 1e-3 1e-9

BGNSTR
STRNAME UNIT_RECT
  BOUNDARY
  LAYER 5
  DATATYPE 0
  XY 0: 0  500: 0  500: 250  0: 250  0: 0
  ENDEL
ENDSTR

BGNSTR
STRNAME TOP
  # SREF rotated 90 degrees and translated to (1000, 0)
  SREF
  SNAME UNIT_RECT
  ANGLE 90
  XY 1000: 0
  ENDEL
  # PATH on POLY (layer 3)
  PATH
  LAYER 3
  DATATYPE 0
  WIDTH 200
  XY 0: 0  1000: 0
  ENDEL
ENDSTR
ENDLIB
`;

describe("GDSII CAD Lowering, 3D Extrusion, Parasitic RC DAE & Projections", () => {
  it("flattens SREF transforms and PATH ribbons into 2D polygons with exact area & bbox", () => {
    const lib = parseGdsiiAscii(HIER_LAYOUT);
    const flat = lowerGdsiiToGeometry(lib);

    assert.equal(flat.topStructure, "TOP");
    assert.equal(flat.polygons.length, 2);

    // Layer 5: 500x250 = 125000 db^2 = 0.125 um^2
    assert.ok(Math.abs((flat.areaByLayerUm2[5] ?? 0) - 0.125) < 1e-9);
    // Layer 3: 1000x200 = 200000 db^2 = 0.200 um^2
    assert.ok(Math.abs((flat.areaByLayerUm2[3] ?? 0) - 0.2) < 1e-9);
    assert.ok(Math.abs(flat.totalAreaUm2 - 0.325) < 1e-9);
    assert.ok(flat.bboxUm);
  });

  it("extrudes flattened CMOS layout into a @modelscript/cad 3D Assembly", () => {
    const lib = parseGdsiiAscii(HIER_LAYOUT);
    const asm = extrudeGdsiiTo3dStack(lib);

    assert.equal(asm.name, "TOP");
    assert.equal(asm.parts.length, 2);
    const materials = new Set(asm.parts.map((p) => p.material));
    assert.ok(materials.has("METAL1"));
    assert.ok(materials.has("POLY"));
  });

  it("lowers parasitic RC extraction equations into DAEBuilder", () => {
    const lib = parseGdsiiAscii(HIER_LAYOUT);
    const parasitics = extractGdsiiParasitics(lib);
    assert.equal(parasitics.length, 2);

    for (const p of parasitics) {
      assert.ok(p.resistanceOhm > 0);
      assert.ok(p.capacitanceF > 0);
      assert.ok(p.elmoreDelaySec > 0);
    }

    const dae = gdsiiToDae(lib);
    assert.ok(dae.varCount >= 9);
    assert.ok(dae.eqCount >= 4);
  });

  it("projects GDSII library to CIF and layered SVG", () => {
    const lib = parseGdsiiAscii(HIER_LAYOUT);
    const cif = gdsiiToCif(lib);
    assert.ok(cif.includes("DS 1"));
    assert.ok(cif.includes("L L5;"));
    assert.ok(cif.includes("E"));

    const svg = gdsiiToSvg(lib);
    assert.ok(svg.includes("<svg "));
    assert.ok(svg.includes('data-layer="5"'));
    assert.ok(svg.includes("<polygon "));
  });
});
