// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { flattenCifLayout } from "../src/cad/index.js";
import { cifToDae } from "../src/dae/index.js";
import { lintCif } from "../src/lints/index.js";
import { parseCif } from "../src/parser/index.js";

function relErr(actual: number, expected: number): number {
  const denom = Math.max(Math.abs(expected), 1e-12);
  return Math.abs(actual - expected) / denom;
}

describe("CIF 2.0 Mead-Conway & MOSIS SCMOS Benchmark Suite", () => {
  const tolerance = 1e-9;

  it("verifies Mead-Conway NMOS inverter layout transform and per-layer area parity", () => {
    // Classic Mead-Conway 4:1 depletion-load NMOS inverter (1 unit = 1λ = 100 CIF units)
    const nmosInverterCif = `
      ( Mead-Conway 4:1 NMOS Inverter, lambda = 1.0 um = 100 CIF units );
      DS 1 100/1;
        9 NMOS_INVERTER;
        L ND;
        ( Pull-down diffusion 4x6 and pull-up diffusion 2x8 );
        B 4 6 6 3;
        B 2 8 6 12;
        L NP;
        ( Input gate 8x2 and pull-up gate 4x6 );
        B 8 2 6 3;
        B 4 6 6 12;
        L NI;
        ( Depletion implant 6x10 over pull-up );
        B 6 10 6 12;
        L NC;
        ( VDD, GND, and OUT contacts 2x2 );
        B 2 2 6 17;
        B 2 2 6 0;
        L NM;
        ( VDD and GND rails 12x4 );
        B 12 4 6 18;
        B 12 4 6 -1;
      DF;
      ( Place two mirrored inverters side by side );
      C 1;
      C 1 MX T 2400 0;
      E
    `;

    const doc = parseCif(nmosInverterCif);
    assert.strictEqual(doc.parseErrors.length, 0);
    assert.strictEqual(lintCif(doc).length, 0, "Mead-Conway NMOS inverter should be DRC-clean");

    const layout = flattenCifLayout(doc);
    assert.strictEqual(layout.drcViolations.length, 0);

    // Exact analytical areas for 2 mirrored instances (in µm²):
    // ND: 2 * (4*6 + 2*8) = 2 * 40 = 80 µm²
    // NP: 2 * (8*2 + 4*6) = 2 * 40 = 80 µm²
    // NI: 2 * (6*10) = 120 µm²
    // NC: 2 * (2*2 + 2*2) = 16 µm²
    // NM: 2 * (12*4 + 12*4) = 192 µm²
    assert.ok(relErr(layout.layerAreasUm2["ND"] ?? 0, 80) <= tolerance);
    assert.ok(relErr(layout.layerAreasUm2["NP"] ?? 0, 80) <= tolerance);
    assert.ok(relErr(layout.layerAreasUm2["NI"] ?? 0, 120) <= tolerance);
    assert.ok(relErr(layout.layerAreasUm2["NC"] ?? 0, 16) <= tolerance);
    assert.ok(relErr(layout.layerAreasUm2["NM"] ?? 0, 192) <= tolerance);

    // Verify mirrored bounding box span:
    // First instance X in [0, 1200]; MX maps to [-1200, 0]; T 2400 0 maps to [1200, 2400].
    assert.ok(relErr(layout.bbox.minX, 0) <= tolerance);
    assert.ok(relErr(layout.bbox.maxX, 2400) <= tolerance);
  });

  it("verifies MOSIS SCMOS CMOS inverter layout and parasitic capacitance parity", () => {
    const cmosInverterCif = `
      ( MOSIS SCMOS Static CMOS Inverter );
      DS 2 100/1;
        9 CMOS_INVERTER;
        L CWN;
        B 16 14 8 22;
        L CAA;
        ( PMOS active 10x6 in N-well, NMOS active 10x4 in P-sub );
        B 10 6 8 22;
        B 10 4 8 6;
        L CPG;
        ( Shared polysilicon gate 2x24 );
        B 2 24 8 14;
        L CCA;
        ( 4 contacts 2x2 );
        B 2 2 5 22;
        B 2 2 11 22;
        B 2 2 5 6;
        B 2 2 11 6;
        L CMF;
        ( VDD, GND, and Output Metal-1 straps, min width >= 3 lambda );
        B 16 4 8 28;
        B 16 4 8 0;
        B 3 18 11 14;
      DF;
      C 2;
      E
    `;

    const doc = parseCif(cmosInverterCif);
    assert.strictEqual(lintCif(doc).length, 0, "MOSIS SCMOS inverter should be DRC-clean");

    const layout = flattenCifLayout(doc);
    assert.strictEqual(layout.drcViolations.length, 0);

    // Exact layer areas (µm²):
    // CWN: 16*14 = 224
    // CAA: 10*6 + 10*4 = 100
    // CPG: 2*24 = 48
    // CCA: 4 * (2*2) = 16
    // CMF: 16*4 + 16*4 + 3*18 = 64 + 64 + 54 = 182
    assert.ok(relErr(layout.layerAreasUm2["CWN"] ?? 0, 224) <= tolerance);
    assert.ok(relErr(layout.layerAreasUm2["CAA"] ?? 0, 100) <= tolerance);
    assert.ok(relErr(layout.layerAreasUm2["CPG"] ?? 0, 48) <= tolerance);
    assert.ok(relErr(layout.layerAreasUm2["CCA"] ?? 0, 16) <= tolerance);
    assert.ok(relErr(layout.layerAreasUm2["CMF"] ?? 0, 182) <= tolerance);

    // Verify DAE parasitic capacitance calculation for CPG:
    // Area = 48 µm², Perimeter = 2*(2 + 24) = 52 µm
    // CPG rule: areaCap = 95 aF/µm², fringeCap = 45 aF/µm
    // Expected C_CPG = (95 * 48 + 45 * 52) * 1e-3 fF = (4560 + 2340) * 1e-3 = 6.900 fF
    const dae = cifToDae(doc);
    const cpgCapFf = dae.parasitics["CPG"]?.capacitanceFf ?? 0;
    assert.ok(relErr(cpgCapFf, 6.9) <= 1e-9, `Expected CPG cap 6.9 fF, got ${cpgCapFf}`);
  });

  it("verifies rational scale factor a/b exact coordinate transform and 90-degree rotation", () => {
    // Scale factor 250 / 4 = 62.5 CIF units per symbol unit
    const cif = `
      DS 10 250/4;
        L CMF;
        B 8 6 4 3;
      DF;
      ( Rotate 90 degrees CCW (0, 1) then translate by (1000, 500) );
      C 10 R 0 1 T 1000 500;
      E
    `;
    const doc = parseCif(cif);
    const layout = flattenCifLayout(doc);
    assert.strictEqual(layout.polygons.length, 1);

    // Unrotated box in local coords: X in [0, 8], Y in [0, 6]
    // Scaled by 62.5: X in [0, 500], Y in [0, 375]
    // Rotated 90° CCW (x, y) -> (-y, x): X in [-375, 0], Y in [0, 500]
    // Translated by (1000, 500): X in [625, 1000], Y in [500, 1000]
    const b = layout.bbox;
    assert.ok(relErr(b.minX, 625) <= tolerance);
    assert.ok(relErr(b.maxX, 1000) <= tolerance);
    assert.ok(relErr(b.minY, 500) <= tolerance);
    assert.ok(relErr(b.maxY, 1000) <= tolerance);

    // Exact area: 500 * 375 = 187,500 CIF units² = 18.75 µm²
    assert.ok(relErr(layout.layerAreasUm2["CMF"] ?? 0, 18.75) <= tolerance);
  });

  it("detects sub-lambda DRC width violation with exact margin verification", () => {
    // Scale factor 50/1 (0.5 µm per unit): width 5 units = 250 CIF units = 2.5λ < 3.0λ (CMF min width)
    const cif = `
      DS 1 50/1;
        L CMF;
        B 20 5 10 2;
      DF;
      C 1;
      E
    `;
    const doc = parseCif(cif);
    const layout = flattenCifLayout(doc, { lambdaCifUnits: 100 });
    assert.strictEqual(layout.drcViolations.length, 1);
    const v = layout.drcViolations[0]!;
    assert.strictEqual(v.layer, "CMF");
    assert.ok(relErr(v.actualWidthCif, 250) <= tolerance);
    assert.ok(relErr(v.requiredWidthCif, 300) <= tolerance);
  });
});
