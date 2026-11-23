// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatGdsiiAscii, parseGdsii, parseGdsiiAscii } from "../src/parser/index.js";

const SAMPLE_GDT = `
# Cleanroom CMOS sample layout
HEADER 600
BGNLIB
LIBNAME CMOS_TEST_LIB
UNITS 1e-3 1e-9

BGNSTR
STRNAME VIA_CELL
  BOUNDARY
  LAYER 4
  DATATYPE 0
  XY 0: 0  220: 0  220: 220  0: 220  0: 0
  ENDEL
ENDSTR

BGNSTR
STRNAME TOP_CELL
  BOUNDARY
  LAYER 1
  DATATYPE 0
  XY 0: 0  2000: 0  2000: 2000  0: 2000  0: 0
  ENDEL
  PATH
  LAYER 5
  DATATYPE 0
  PATHTYPE 2
  WIDTH 240
  XY 100: 500  1900: 500
  ENDEL
  SREF
  SNAME VIA_CELL
  STRANS 1000000000000000
  MAG 1.0
  ANGLE 90.0
  XY 500: 500
  ENDEL
  AREF
  SNAME VIA_CELL
  COLROW 2 3
  XY 0: 0  1000: 0  0: 1500
  ENDEL
  TEXT
  LAYER 5
  TEXTTYPE 0
  XY 100: 500
  STRING "VDD"
  ENDEL
ENDSTR
ENDLIB
`;

describe("GDSII GDT/ASCII Parser", () => {
  it("parses HEADER, LIBNAME, UNITS, structures, and all element types", () => {
    const lib = parseGdsiiAscii(SAMPLE_GDT);
    assert.equal(lib.parseErrors, undefined);
    assert.equal(lib.version, 600);
    assert.equal(lib.name, "CMOS_TEST_LIB");
    assert.equal(lib.units.dbUnitInUserUnits, 1e-3);
    assert.equal(lib.units.dbUnitInMeters, 1e-9);
    assert.equal(lib.structures.length, 2);

    const top = lib.structures[1]!;
    assert.equal(top.name, "TOP_CELL");
    assert.equal(top.elements.length, 5);

    const [boundary, path, sref, aref, text] = top.elements;
    assert.equal(boundary!.kind, "boundary");
    assert.equal(boundary!.layer, 1);
    assert.equal(boundary!.xy.length, 5);

    assert.equal(path!.kind, "path");
    assert.equal(path!.width, 240);
    assert.equal(path!.pathtype, 2);

    assert.equal(sref!.kind, "sref");
    assert.equal(sref!.sname, "VIA_CELL");
    assert.equal(sref!.strans?.reflectX, true);
    assert.equal(sref!.angle, 90);

    assert.equal(aref!.kind, "aref");
    assert.equal(aref!.columns, 2);
    assert.equal(aref!.rows, 3);

    assert.equal(text!.kind, "text");
    assert.equal(text!.string, "VDD");
  });

  it("round-trips through formatGdsiiAscii -> parseGdsii", () => {
    const lib1 = parseGdsii(SAMPLE_GDT);
    const formatted = formatGdsiiAscii(lib1);
    const lib2 = parseGdsii(formatted);

    assert.equal(lib2.parseErrors, undefined);
    assert.equal(lib2.name, lib1.name);
    assert.equal(lib2.structures.length, lib1.structures.length);
    assert.equal(lib2.structures[1]!.elements.length, lib1.structures[1]!.elements.length);
  });

  it("reports parse errors for unknown keywords and unterminated blocks", () => {
    const bad = `
HEADER 600
BGNLIB
LIBNAME BAD_LIB
BGNSTR
STRNAME OPEN_CELL
  FOOBAR 123
  BOUNDARY
  LAYER 1
`;
    const lib = parseGdsiiAscii(bad);
    assert.ok(lib.parseErrors && lib.parseErrors.length >= 2);
  });
});
