// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseObj } from "../src/parser/index.js";
import { objToAsciiStl, objToBinaryStl, objToStep, objToUsd } from "../src/projections/index.js";

const UNIT_CUBE_OBJ = [
  "o UnitCube",
  "v 0 0 0",
  "v 1 0 0",
  "v 1 1 0",
  "v 0 1 0",
  "v 0 0 1",
  "v 1 0 1",
  "v 1 1 1",
  "v 0 1 1",
  "f 1 4 3 2",
  "f 5 6 7 8",
  "f 1 2 6 5",
  "f 3 4 8 7",
  "f 1 5 8 4",
  "f 2 3 7 6",
].join("\n");

describe("Polyglot Projections (ASCII STL, Binary STL, STEP, OpenUSD)", () => {
  it("exports to ASCII STL with 12 facets", () => {
    const doc = parseObj(UNIT_CUBE_OBJ);
    const stl = objToAsciiStl(doc);
    assert.ok(stl.startsWith("solid UnitCube"));
    assert.ok(stl.trim().endsWith("endsolid UnitCube"));
    const facetCount = (stl.match(/facet normal/g) ?? []).length;
    assert.equal(facetCount, 12);
  });

  it("exports to IEEE 754 Binary STL with exact 84 + 50*12 byte length", () => {
    const doc = parseObj(UNIT_CUBE_OBJ);
    const bin = objToBinaryStl(doc);
    assert.equal(bin.byteLength, 84 + 50 * 12);
    const view = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
    assert.equal(view.getUint32(80, true), 12);
  });

  it("projects to ISO 10303-21 STEP", () => {
    const doc = parseObj(UNIT_CUBE_OBJ);
    const step = objToStep(doc);
    assert.ok(step.includes("ISO-10303-21;"));
    assert.ok(step.includes("END-ISO-10303-21;"));
    assert.ok(step.includes("CARTESIAN_POINT"));
  });

  it("projects to OpenUSD USDA", () => {
    const doc = parseObj(UNIT_CUBE_OBJ);
    const usda = objToUsd(doc);
    assert.ok(usda.includes("#usda 1.0"));
    assert.ok(usda.includes("Mesh"));
  });
});
