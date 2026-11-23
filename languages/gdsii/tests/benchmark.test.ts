// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lowerGdsiiToGeometry } from "../src/cad/index.js";
import { lintGdsii } from "../src/lints/index.js";
import { decodeGdsiiBinary, encodeGdsiiBinary } from "../src/parser/binary-stream.js";
import { parseGdsiiAscii } from "../src/parser/gdt-parser.js";

function relErr(actual: number, expected: number): number {
  if (expected === 0) return Math.abs(actual);
  return Math.abs(actual - expected) / Math.abs(expected);
}

/**
 * Cleanroom CMOS Inverter Standard Cell (INV_X1) + 4x2 AREF macro benchmark.
 * Units: 1 DB unit = 1 nm (1e-3 um, 1e-9 m).
 */
const CMOS_INV_BENCHMARK_GDT = `
HEADER 600
BGNLIB
LIBNAME CMOS_STDCELL_BENCH
UNITS 1e-3 1e-9

BGNSTR
STRNAME INV_X1
  # NWELL (Layer 1): 2400 x 2400 nm -> 5.76 um^2
  BOUNDARY
  LAYER 1
  DATATYPE 0
  XY 0: 2400  2400: 2400  2400: 4800  0: 4800  0: 2400
  ENDEL

  # PMOS ACTIVE (Layer 2): 1600 x 1200 nm -> 1.92 um^2
  BOUNDARY
  LAYER 2
  DATATYPE 0
  XY 400: 3000  2000: 3000  2000: 4200  400: 4200  400: 3000
  ENDEL

  # NMOS ACTIVE (Layer 2): 1600 x 600 nm -> 0.96 um^2
  BOUNDARY
  LAYER 2
  DATATYPE 0
  XY 400: 600  2000: 600  2000: 1200  400: 1200  400: 600
  ENDEL

  # POLY GATE (Layer 3): 180 x 4000 nm -> 0.72 um^2
  BOUNDARY
  LAYER 3
  DATATYPE 0
  XY 1110: 400  1290: 400  1290: 4400  1110: 4400  1110: 400
  ENDEL

  # METAL1 VDD RAIL (Layer 5): 2400 x 400 nm -> 0.96 um^2
  BOUNDARY
  LAYER 5
  DATATYPE 0
  XY 0: 4400  2400: 4400  2400: 4800  0: 4800  0: 4400
  ENDEL

  # METAL1 VSS RAIL (Layer 5): 2400 x 400 nm -> 0.96 um^2
  BOUNDARY
  LAYER 5
  DATATYPE 0
  XY 0: 0  2400: 0  2400: 400  0: 400  0: 0
  ENDEL
ENDSTR

BGNSTR
STRNAME INV_ARRAY_4X2
  AREF
  SNAME INV_X1
  COLROW 4 2
  XY 0: 0  9600: 0  0: 9600
  ENDEL
ENDSTR
ENDLIB
`;

describe("GDSII Benchmark Suite (CMOS INV Binary Round-Trip, AREF Parity & DRC)", () => {
  it("preserves CMOS inverter cell geometry with < 1e-12 relative error across binary round-trip", () => {
    const tolerance = 1e-12;
    const asciiLib = parseGdsiiAscii(CMOS_INV_BENCHMARK_GDT);
    assert.equal(asciiLib.parseErrors, undefined);

    const binaryBytes = encodeGdsiiBinary(asciiLib);
    const decodedLib = decodeGdsiiBinary(binaryBytes);
    assert.equal(decodedLib.parseErrors, undefined);

    const asciiInv = lowerGdsiiToGeometry(asciiLib, { topStructure: "INV_X1" });
    const binInv = lowerGdsiiToGeometry(decodedLib, { topStructure: "INV_X1" });

    // Analytical expected area for single INV_X1: 5.76 + 1.92 + 0.96 + 0.72 + 0.96 + 0.96 = 11.28 um^2
    const expectedSingleAreaUm2 = 11.28;
    assert.ok(
      relErr(asciiInv.totalAreaUm2, expectedSingleAreaUm2) < tolerance,
      `ASCII INV area mismatch: ${asciiInv.totalAreaUm2} vs ${expectedSingleAreaUm2}`,
    );
    assert.ok(
      relErr(binInv.totalAreaUm2, expectedSingleAreaUm2) < tolerance,
      `Binary INV area mismatch: ${binInv.totalAreaUm2} vs ${expectedSingleAreaUm2}`,
    );
    assert.ok(relErr(binInv.totalAreaUm2, asciiInv.totalAreaUm2) < tolerance, `Binary vs ASCII parity failed`);
  });

  it("verifies hierarchical 4x2 AREF polygon area and bounding-box parity", () => {
    const tolerance = 1e-12;
    const lib = parseGdsiiAscii(CMOS_INV_BENCHMARK_GDT);
    const flatArray = lowerGdsiiToGeometry(lib, { topStructure: "INV_ARRAY_4X2" });

    // 4 cols * 2 rows = 8 instances, 6 polygons per INV_X1 => 48 polygons
    assert.equal(flatArray.polygons.length, 48);

    const expectedTotalAreaUm2 = 8 * 11.28; // 90.24 um^2
    assert.ok(
      relErr(flatArray.totalAreaUm2, expectedTotalAreaUm2) < tolerance,
      `AREF total area mismatch: ${flatArray.totalAreaUm2} vs ${expectedTotalAreaUm2}`,
    );

    // Expected bounding box: 4 * 2.4 um = 9.6 um wide, 2 * 4.8 um = 9.6 um tall
    assert.ok(flatArray.bboxUm);
    assert.ok(relErr(flatArray.bboxUm.width, 9.6) < tolerance);
    assert.ok(relErr(flatArray.bboxUm.height, 9.6) < tolerance);
    assert.equal(flatArray.bboxUm.minX, 0);
    assert.equal(flatArray.bboxUm.minY, 0);
  });

  it("passes cleanroom 180nm CMOS DRC min-width & min-spacing rules on INV_X1 and detects violations when tightened", () => {
    const lib = parseGdsiiAscii(CMOS_INV_BENCHMARK_GDT);

    // Cleanroom 180nm DRC rules (in nm = DB units)
    const cleanRules = [
      { layer: 1, name: "NWELL", minWidth: 1200, minSpacing: 1200 },
      { layer: 2, name: "ACTIVE", minWidth: 240, minSpacing: 280 },
      { layer: 3, name: "POLY", minWidth: 180, minSpacing: 250 },
      { layer: 5, name: "METAL1", minWidth: 240, minSpacing: 240 },
    ];
    const cleanDiags = lintGdsii(lib, { drcRules: cleanRules });
    assert.equal(cleanDiags.length, 0, `Expected 0 DRC violations, got: ${JSON.stringify(cleanDiags)}`);

    // Tighten POLY minWidth to 200 nm (actual is 180 nm) and ACTIVE minSpacing to 2000 nm (actual is 1800 nm)
    const strictRules = [
      { layer: 2, name: "ACTIVE", minWidth: 240, minSpacing: 2000 },
      { layer: 3, name: "POLY", minWidth: 200, minSpacing: 250 },
    ];
    const strictDiags = lintGdsii(lib, { drcRules: strictRules });
    assert.ok(strictDiags.some((d) => d.id === "GDS5001" && d.layer === 3));
    assert.ok(strictDiags.some((d) => d.id === "GDS5002" && d.layer === 2));
  });
});
