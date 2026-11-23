// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseDxf, tokenizeDxfPairs } from "../src/index.js";

const FULL_DXF = [
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
  "9",
  "$MEASUREMENT",
  "70",
  "1",
  "9",
  "$CLAYER",
  "8",
  "OUTLINE",
  "9",
  "$EXTMIN",
  "10",
  "0.0",
  "20",
  "0.0",
  "30",
  "0.0",
  "9",
  "$EXTMAX",
  "10",
  "100.0",
  "20",
  "60.0",
  "30",
  "10.0",
  "0",
  "ENDSEC",
  "0",
  "SECTION",
  "2",
  "TABLES",
  "0",
  "TABLE",
  "2",
  "LAYER",
  "70",
  "2",
  "0",
  "LAYER",
  "2",
  "OUTLINE",
  "70",
  "0",
  "62",
  "7",
  "6",
  "CONTINUOUS",
  "0",
  "LAYER",
  "2",
  "HOLES",
  "70",
  "5",
  "62",
  "1",
  "6",
  "DASHED",
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
  "8",
  "0",
  "2",
  "BOLT_HOLE",
  "70",
  "0",
  "10",
  "0.0",
  "20",
  "0.0",
  "30",
  "0.0",
  "0",
  "CIRCLE",
  "8",
  "HOLES",
  "10",
  "0.0",
  "20",
  "0.0",
  "30",
  "0.0",
  "40",
  "4.0",
  "0",
  "ENDBLK",
  "0",
  "ENDSEC",
  "0",
  "SECTION",
  "2",
  "ENTITIES",
  "0",
  "LINE",
  "5",
  "1A",
  "8",
  "OUTLINE",
  "10",
  "0.0",
  "20",
  "0.0",
  "30",
  "0.0",
  "11",
  "100.0",
  "21",
  "0.0",
  "31",
  "0.0",
  "0",
  "ARC",
  "8",
  "OUTLINE",
  "10",
  "10.0",
  "20",
  "10.0",
  "30",
  "0.0",
  "40",
  "5.0",
  "50",
  "0.0",
  "51",
  "90.0",
  "0",
  "CIRCLE",
  "8",
  "HOLES",
  "10",
  "50.0",
  "20",
  "30.0",
  "30",
  "0.0",
  "40",
  "12.5",
  "0",
  "LWPOLYLINE",
  "8",
  "OUTLINE",
  "90",
  "4",
  "70",
  "1",
  "38",
  "2.0",
  "10",
  "0.0",
  "20",
  "0.0",
  "42",
  "0.0",
  "10",
  "20.0",
  "20",
  "0.0",
  "42",
  "1.0",
  "10",
  "20.0",
  "20",
  "10.0",
  "10",
  "0.0",
  "20",
  "10.0",
  "0",
  "POLYLINE",
  "8",
  "OUTLINE",
  "70",
  "9",
  "0",
  "VERTEX",
  "10",
  "0.0",
  "20",
  "0.0",
  "30",
  "0.0",
  "0",
  "VERTEX",
  "10",
  "10.0",
  "20",
  "0.0",
  "30",
  "5.0",
  "0",
  "VERTEX",
  "10",
  "10.0",
  "20",
  "10.0",
  "30",
  "5.0",
  "0",
  "SEQEND",
  "0",
  "SPLINE",
  "8",
  "OUTLINE",
  "70",
  "0",
  "71",
  "2",
  "40",
  "0",
  "40",
  "0",
  "40",
  "0",
  "40",
  "1",
  "40",
  "1",
  "40",
  "1",
  "10",
  "0.0",
  "20",
  "0.0",
  "30",
  "0.0",
  "10",
  "5.0",
  "20",
  "10.0",
  "30",
  "0.0",
  "10",
  "10.0",
  "20",
  "0.0",
  "30",
  "0.0",
  "0",
  "ELLIPSE",
  "8",
  "OUTLINE",
  "10",
  "20.0",
  "20",
  "20.0",
  "30",
  "0.0",
  "11",
  "10.0",
  "21",
  "0.0",
  "31",
  "0.0",
  "40",
  "0.5",
  "41",
  "0.0",
  "42",
  "6.283185307179586",
  "0",
  "3DFACE",
  "8",
  "OUTLINE",
  "10",
  "0.0",
  "20",
  "0.0",
  "30",
  "0.0",
  "11",
  "10.0",
  "21",
  "0.0",
  "31",
  "0.0",
  "12",
  "10.0",
  "22",
  "10.0",
  "32",
  "0.0",
  "13",
  "0.0",
  "23",
  "10.0",
  "33",
  "0.0",
  "70",
  "0",
  "0",
  "POINT",
  "8",
  "OUTLINE",
  "10",
  "1.0",
  "20",
  "2.0",
  "30",
  "3.0",
  "0",
  "TEXT",
  "8",
  "OUTLINE",
  "10",
  "5.0",
  "20",
  "5.0",
  "30",
  "0.0",
  "40",
  "2.5",
  "50",
  "15.0",
  "1",
  "BRACKET_A",
  "0",
  "INSERT",
  "8",
  "HOLES",
  "2",
  "BOLT_HOLE",
  "10",
  "15.0",
  "20",
  "15.0",
  "30",
  "0.0",
  "41",
  "1.5",
  "42",
  "1.5",
  "43",
  "1.0",
  "50",
  "45.0",
  "70",
  "2",
  "71",
  "1",
  "44",
  "20.0",
  "45",
  "0.0",
  "0",
  "ENDSEC",
  "0",
  "SECTION",
  "2",
  "OBJECTS",
  "0",
  "DICTIONARY",
  "5",
  "C",
  "0",
  "ENDSEC",
  "0",
  "EOF",
].join("\n");

describe("DXF parser", () => {
  it("tokenizes ASCII group-code/value pairs with line numbers and byte offsets", () => {
    const { pairs, errors } = tokenizeDxfPairs("0\nSECTION\n2\nENTITIES\n0\nENDSEC\n0\nEOF\n");
    assert.equal(errors.length, 0);
    assert.equal(pairs.length, 4);
    assert.equal(pairs[0]?.code, 0);
    assert.equal(pairs[0]?.value, "SECTION");
    assert.equal(pairs[0]?.line, 1);
    assert.equal(pairs[3]?.value, "EOF");
  });

  it("handles CRLF line endings cleanly", () => {
    const crlf = FULL_DXF.replace(/\n/g, "\r\n");
    const doc = parseDxf(crlf);
    assert.equal(doc.parseErrors.length, 0);
    assert.equal(doc.hasEof, true);
    assert.equal(doc.entities.length, 11);
  });

  it("parses HEADER variables, TABLES/LAYER records, BLOCKS, ENTITIES, and OBJECTS", () => {
    const doc = parseDxf(FULL_DXF);
    assert.equal(doc.parseErrors.length, 0);
    assert.equal(doc.hasEof, true);
    assert.equal(doc.sections.length, 5);
    assert.ok(doc.sections.every((s) => s.closed));

    // HEADER
    assert.equal(doc.header.acadVer, "AC1027");
    assert.equal(doc.header.insUnits, 4);
    assert.equal(doc.header.measurement, 1);
    assert.equal(doc.header.clayer, "OUTLINE");
    assert.deepEqual(doc.header.extMin, { x: 0, y: 0, z: 0 });
    assert.deepEqual(doc.header.extMax, { x: 100, y: 60, z: 10 });

    // TABLES / LAYER
    assert.equal(doc.layers.size, 2);
    const outline = doc.layers.get("OUTLINE");
    assert.ok(outline);
    assert.equal(outline.color, 7);
    assert.equal(outline.lineType, "CONTINUOUS");
    assert.equal(outline.frozen, false);
    assert.equal(outline.locked, false);

    const holes = doc.layers.get("HOLES");
    assert.ok(holes);
    assert.equal(holes.color, 1);
    assert.equal(holes.frozen, true);
    assert.equal(holes.locked, true);

    // BLOCKS
    assert.equal(doc.blocks.size, 1);
    const blk = doc.blocks.get("BOLT_HOLE");
    assert.ok(blk);
    assert.equal(blk.closed, true);
    assert.equal(blk.entities.length, 1);
    assert.equal(blk.entities[0]?.type, "CIRCLE");

    // ENTITIES
    const types = doc.entities.map((e) => e.type);
    assert.deepEqual(types, [
      "LINE",
      "ARC",
      "CIRCLE",
      "LWPOLYLINE",
      "POLYLINE",
      "SPLINE",
      "ELLIPSE",
      "3DFACE",
      "POINT",
      "TEXT",
      "INSERT",
    ]);

    const lw = doc.entities[3];
    assert.equal(lw?.type, "LWPOLYLINE");
    if (lw?.type === "LWPOLYLINE") {
      assert.equal(lw.closed, true);
      assert.equal(lw.elevation, 2);
      assert.equal(lw.vertices.length, 4);
      assert.equal(lw.vertices[1]?.bulge, 1);
    }

    const poly = doc.entities[4];
    assert.equal(poly?.type, "POLYLINE");
    if (poly?.type === "POLYLINE") {
      assert.equal(poly.closed, true);
      assert.equal(poly.is3D, true);
      assert.equal(poly.hasSeqEnd, true);
      assert.equal(poly.vertices.length, 3);
    }

    const ins = doc.entities[10];
    assert.equal(ins?.type, "INSERT");
    if (ins?.type === "INSERT") {
      assert.equal(ins.blockName, "BOLT_HOLE");
      assert.equal(ins.scaleX, 1.5);
      assert.equal(ins.rotation, 45);
      assert.equal(ins.columnCount, 2);
      assert.equal(ins.columnSpacing, 20);
    }

    // OBJECTS
    assert.equal(doc.objects.length, 1);
    assert.equal(doc.objects[0]?.type, "DICTIONARY");
  });

  it("reports parse errors for non-integer group codes and odd trailing lines", () => {
    const malformed = "ABC\nSECTION\n0\nEOF";
    const doc = parseDxf(malformed);
    assert.ok(doc.parseErrors.length > 0);
    assert.equal(doc.parseErrors[0]?.code, "DXF1001");
  });
});
