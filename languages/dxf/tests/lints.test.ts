// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lintDxf, parseDxf } from "../src/index.js";

function wrapEntities(entityLines: string[], extra = ""): string {
  return [
    "0",
    "SECTION",
    "2",
    "HEADER",
    "9",
    "$ACADVER",
    "1",
    "AC1027",
    "9",
    "$INSUNITS",
    "70",
    "4",
    "0",
    "ENDSEC",
    extra,
    "0",
    "SECTION",
    "2",
    "ENTITIES",
    ...entityLines,
    "0",
    "ENDSEC",
    "0",
    "EOF",
  ]
    .filter(Boolean)
    .join("\n");
}

describe("DXF static linter (DXF1001–DXF5006)", () => {
  it("produces zero diagnostics for a valid DXF drawing", () => {
    const src = wrapEntities(
      [
        "0",
        "LINE",
        "8",
        "0",
        "10",
        "0",
        "20",
        "0",
        "11",
        "10",
        "21",
        "0",
        "0",
        "CIRCLE",
        "8",
        "OUTLINE",
        "10",
        "5",
        "20",
        "5",
        "40",
        "2",
      ],
      [
        "0",
        "SECTION",
        "2",
        "TABLES",
        "0",
        "TABLE",
        "2",
        "LAYER",
        "0",
        "LAYER",
        "2",
        "OUTLINE",
        "62",
        "7",
        "0",
        "ENDTAB",
        "0",
        "ENDSEC",
      ].join("\n"),
    );
    const diags = lintDxf(parseDxf(src));
    assert.equal(diags.length, 0);
  });

  it("reports DXF1001 syntax error, DXF1002 unclosed section, DXF1003 missing EOF, DXF1004 unexpected ENDSEC", () => {
    const syntaxDiags = lintDxf(parseDxf("BADCODE\nVALUE\n0\nEOF"));
    assert.ok(syntaxDiags.some((d) => d.id === "DXF1001"));

    const unclosedDiags = lintDxf(parseDxf("0\nSECTION\n2\nENTITIES\n0\nLINE\n10\n0\n20\n0\n11\n5\n21\n0\n0\nEOF"));
    assert.ok(unclosedDiags.some((d) => d.id === "DXF1002"));

    const noEofDiags = lintDxf(parseDxf("0\nSECTION\n2\nENTITIES\n0\nENDSEC"));
    assert.ok(noEofDiags.some((d) => d.id === "DXF1003"));

    const unexpectedEndsec = lintDxf(parseDxf("0\nENDSEC\n0\nEOF"));
    assert.ok(unexpectedEndsec.some((d) => d.id === "DXF1004"));
  });

  it("reports DXF2001 undefined layer, DXF2002 undefined block, and DXF2003 cyclic block reference", () => {
    const undefLayer = wrapEntities(
      ["0", "LINE", "8", "GHOST_LAYER", "10", "0", "20", "0", "11", "5", "21", "0"],
      "0\nSECTION\n2\nTABLES\n0\nTABLE\n2\nLAYER\n0\nLAYER\n2\nREAL_LAYER\n0\nENDTAB\n0\nENDSEC",
    );
    assert.ok(lintDxf(parseDxf(undefLayer)).some((d) => d.id === "DXF2001"));

    const undefBlock = wrapEntities(["0", "INSERT", "2", "MISSING_BLK", "10", "0", "20", "0"]);
    assert.ok(lintDxf(parseDxf(undefBlock)).some((d) => d.id === "DXF2002"));

    const cyclicBlocks = wrapEntities(
      ["0", "INSERT", "2", "BLK_A", "10", "0", "20", "0"],
      [
        "0",
        "SECTION",
        "2",
        "BLOCKS",
        "0",
        "BLOCK",
        "2",
        "BLK_A",
        "10",
        "0",
        "20",
        "0",
        "0",
        "INSERT",
        "2",
        "BLK_B",
        "10",
        "0",
        "20",
        "0",
        "0",
        "ENDBLK",
        "0",
        "BLOCK",
        "2",
        "BLK_B",
        "10",
        "0",
        "20",
        "0",
        "0",
        "INSERT",
        "2",
        "BLK_A",
        "10",
        "0",
        "20",
        "0",
        "0",
        "ENDBLK",
        "0",
        "ENDSEC",
      ].join("\n"),
    );
    assert.ok(lintDxf(parseDxf(cyclicBlocks)).some((d) => d.id === "DXF2003"));
  });

  it("reports DXF3001–DXF3005 geometric degeneracy diagnostics", () => {
    const src = wrapEntities([
      "0",
      "CIRCLE",
      "10",
      "0",
      "20",
      "0",
      "40",
      "0",
      "0",
      "ARC",
      "10",
      "0",
      "20",
      "0",
      "40",
      "-2",
      "50",
      "0",
      "51",
      "90",
      "0",
      "LWPOLYLINE",
      "70",
      "0",
      "10",
      "0",
      "20",
      "0",
      "0",
      "3DFACE",
      "10",
      "0",
      "20",
      "0",
      "30",
      "0",
      "11",
      "5",
      "21",
      "0",
      "31",
      "0",
      "12",
      "10",
      "22",
      "0",
      "32",
      "0",
      "13",
      "10",
      "23",
      "0",
      "33",
      "0",
      "0",
      "ELLIPSE",
      "10",
      "0",
      "20",
      "0",
      "11",
      "0",
      "21",
      "0",
      "40",
      "0.5",
      "41",
      "0",
      "42",
      "6.28",
    ]);
    const ids = new Set(lintDxf(parseDxf(src)).map((d) => d.id));
    assert.ok(ids.has("DXF3001"));
    assert.ok(ids.has("DXF3002"));
    assert.ok(ids.has("DXF3003"));
    assert.ok(ids.has("DXF3004"));
    assert.ok(ids.has("DXF3005"));
  });

  it("reports DXF4001 invalid $INSUNITS and DXF4002 unclosed BLOCK", () => {
    const src = [
      "0",
      "SECTION",
      "2",
      "HEADER",
      "9",
      "$INSUNITS",
      "70",
      "99",
      "0",
      "ENDSEC",
      "0",
      "SECTION",
      "2",
      "BLOCKS",
      "0",
      "BLOCK",
      "2",
      "OPEN_BLK",
      "10",
      "0",
      "20",
      "0",
      "0",
      "LINE",
      "10",
      "0",
      "20",
      "0",
      "11",
      "1",
      "21",
      "0",
      "0",
      "ENDSEC",
      "0",
      "EOF",
    ].join("\n");
    const ids = new Set(lintDxf(parseDxf(src)).map((d) => d.id));
    assert.ok(ids.has("DXF4001"));
    assert.ok(ids.has("DXF4002"));
  });

  it("reports DXF5001–DXF5006 warnings and structural errors", () => {
    const src = wrapEntities(
      [
        "0",
        "LINE",
        "10",
        "3",
        "20",
        "4",
        "11",
        "3",
        "21",
        "4",
        "0",
        "INSERT",
        "2",
        "DUP_BLK",
        "10",
        "0",
        "20",
        "0",
        "41",
        "0",
        "42",
        "1",
        "43",
        "1",
        "0",
        "SPLINE",
        "71",
        "3",
        "10",
        "0",
        "20",
        "0",
        "10",
        "1",
        "20",
        "1",
        "0",
        "POLYLINE",
        "70",
        "0",
        "0",
        "VERTEX",
        "10",
        "0",
        "20",
        "0",
      ],
      [
        "0",
        "SECTION",
        "2",
        "TABLES",
        "0",
        "TABLE",
        "2",
        "LAYER",
        "0",
        "LAYER",
        "2",
        "L1",
        "62",
        "7",
        "0",
        "LAYER",
        "2",
        "L1",
        "62",
        "1",
        "0",
        "ENDTAB",
        "0",
        "ENDSEC",
        "0",
        "SECTION",
        "2",
        "BLOCKS",
        "0",
        "BLOCK",
        "2",
        "DUP_BLK",
        "10",
        "0",
        "20",
        "0",
        "0",
        "ENDBLK",
        "0",
        "BLOCK",
        "2",
        "DUP_BLK",
        "10",
        "0",
        "20",
        "0",
        "0",
        "ENDBLK",
        "0",
        "ENDSEC",
      ].join("\n"),
    );
    const ids = new Set(lintDxf(parseDxf(src)).map((d) => d.id));
    assert.ok(ids.has("DXF5001"));
    assert.ok(ids.has("DXF5002"));
    assert.ok(ids.has("DXF5003"));
    assert.ok(ids.has("DXF5004"));
    assert.ok(ids.has("DXF5005"));
    assert.ok(ids.has("DXF5006"));
  });
});
