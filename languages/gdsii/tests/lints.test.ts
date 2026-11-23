// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lintGdsii } from "../src/lints/index.js";
import { parseGdsiiAscii } from "../src/parser/gdt-parser.js";

describe("GDSII Lints & DRC Diagnostics (GDS1001–GDS5006)", () => {
  it("flags GDS2001 unclosed BOUNDARY and GDS3002 zero-area polygon", () => {
    const lib = parseGdsiiAscii(`
HEADER 600
BGNLIB
LIBNAME LINT_TEST
UNITS 1e-3 1e-9
BGNSTR
STRNAME BAD_POLY
  BOUNDARY
  LAYER 5
  DATATYPE 0
  XY 0: 0  100: 0  100: 100  0: 100
  ENDEL
  BOUNDARY
  LAYER 5
  DATATYPE 0
  XY 0: 0  100: 0  200: 0  0: 0
  ENDEL
ENDSTR
ENDLIB
`);
    const diags = lintGdsii(lib);
    assert.ok(
      diags.some((d) => d.id === "GDS2001"),
      "Expected GDS2001 unclosed polygon",
    );
    assert.ok(
      diags.some((d) => d.id === "GDS3002"),
      "Expected GDS3002 zero-area polygon",
    );
  });

  it("flags GDS2002 unresolved SREF/AREF and GDS2003 cyclic hierarchy", () => {
    const lib = parseGdsiiAscii(`
HEADER 600
BGNLIB
LIBNAME CYCLE_TEST
UNITS 1e-3 1e-9
BGNSTR
STRNAME CELL_A
  SREF
  SNAME CELL_B
  XY 0: 0
  ENDEL
  SREF
  SNAME MISSING_CELL
  XY 100: 0
  ENDEL
ENDSTR
BGNSTR
STRNAME CELL_B
  SREF
  SNAME CELL_A
  XY 0: 0
  ENDEL
ENDSTR
ENDLIB
`);
    const diags = lintGdsii(lib);
    assert.ok(
      diags.some((d) => d.id === "GDS2002"),
      "Expected GDS2002 unresolved reference",
    );
    assert.ok(
      diags.some((d) => d.id === "GDS2003"),
      "Expected GDS2003 cyclic hierarchy",
    );
  });

  it("flags GDS3001 invalid layer/datatype > 65535 and GDS5006 duplicate structure name", () => {
    const lib = parseGdsiiAscii(`
HEADER 600
BGNLIB
LIBNAME LAYER_TEST
UNITS 1e-3 1e-9
BGNSTR
STRNAME DUP
  BOUNDARY
  LAYER 70000
  DATATYPE 65536
  XY 0: 0  100: 0  100: 100  0: 100  0: 0
  ENDEL
ENDSTR
BGNSTR
STRNAME DUP
ENDSTR
ENDLIB
`);
    const diags = lintGdsii(lib);
    assert.equal(diags.filter((d) => d.id === "GDS3001").length, 2);
    assert.ok(diags.some((d) => d.id === "GDS5006"));
  });

  it("flags GDS5001 DRC min-width and GDS5002 DRC min-spacing violations", () => {
    const lib = parseGdsiiAscii(`
HEADER 600
BGNLIB
LIBNAME DRC_TEST
UNITS 1e-3 1e-9
BGNSTR
STRNAME METAL_DRC
  # Width = 150 (< 240 minWidth)
  BOUNDARY
  LAYER 5
  DATATYPE 0
  XY 0: 0  1000: 0  1000: 150  0: 150  0: 0
  ENDEL
  # Spacing = 100 (< 240 minSpacing)
  BOUNDARY
  LAYER 5
  DATATYPE 0
  XY 0: 250  1000: 250  1000: 600  0: 600  0: 250
  ENDEL
ENDSTR
ENDLIB
`);
    const diags = lintGdsii(lib, {
      drcRules: [{ layer: 5, name: "METAL1", minWidth: 240, minSpacing: 240 }],
    });
    assert.ok(
      diags.some((d) => d.id === "GDS5001"),
      "Expected GDS5001 min-width violation",
    );
    assert.ok(
      diags.some((d) => d.id === "GDS5002"),
      "Expected GDS5002 min-spacing violation",
    );
  });
});
