// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildUnitCubeStl, formatAsciiStl, parseAsciiStl, parseStl } from "../src/index.js";

describe("@modelscript/stl — ASCII STL Parser & Formatter", () => {
  it("parses a valid ASCII STL solid with scientific notation and negative coordinates", () => {
    const src = [
      "solid triangle_patch",
      "  facet normal 0.0e0 0.0 1.000000e+00",
      "    outer loop",
      "      vertex -1.5e0 0.0 0.0",
      "      vertex 1.5e0 0.0 0.0",
      "      vertex 0.0 2.5e0 0.0",
      "    endloop",
      "  endfacet",
      "endsolid triangle_patch",
    ].join("\n");

    const doc = parseAsciiStl(src);
    assert.equal(doc.format, "ascii");
    assert.equal(doc.errors.length, 0);
    assert.equal(doc.solids.length, 1);
    assert.equal(doc.solids[0]?.name, "triangle_patch");
    assert.equal(doc.solids[0]?.endName, "triangle_patch");
    assert.equal(doc.solids[0]?.closed, true);
    assert.equal(doc.facets.length, 1);
    assert.deepEqual(doc.facets[0]?.normal, [0, 0, 1]);
    assert.deepEqual(doc.facets[0]?.vertices, [
      [-1.5, 0, 0],
      [1.5, 0, 0],
      [0, 2.5, 0],
    ]);
  });

  it("supports multi-solid ASCII STL files", () => {
    const src = [
      "solid part_a",
      "  facet normal 0 0 1",
      "    outer loop",
      "      vertex 0 0 0",
      "      vertex 1 0 0",
      "      vertex 0 1 0",
      "    endloop",
      "  endfacet",
      "endsolid part_a",
      "solid part_b",
      "  facet normal 0 0 -1",
      "    outer loop",
      "      vertex 0 0 0",
      "      vertex 0 1 0",
      "      vertex 1 0 0",
      "    endloop",
      "  endfacet",
      "endsolid part_b",
    ].join("\n");

    const doc = parseStl(src);
    assert.equal(doc.errors.length, 0);
    assert.equal(doc.solids.length, 2);
    assert.equal(doc.facets.length, 2);
    assert.equal(doc.solids[1]?.name, "part_b");
  });

  it("round-trips a unit cube through formatAsciiStl and parseAsciiStl", () => {
    const cube = buildUnitCubeStl(1.0, "unit_cube");
    const ascii = formatAsciiStl(cube);
    const reparsed = parseAsciiStl(ascii);
    assert.equal(reparsed.errors.length, 0);
    assert.equal(reparsed.facets.length, 12);
    assert.equal(reparsed.solids[0]?.name, "unit_cube");
  });

  it("reports syntax errors on malformed facets", () => {
    const bad = [
      "solid broken",
      "  facet normal 0 0 1",
      "    outer loop",
      "      vertex 0 0 0",
      "      vertex 1 0 0",
      "    endloop",
      "  endfacet",
      "endsolid broken",
    ].join("\n");

    const doc = parseAsciiStl(bad);
    assert.ok(doc.errors.length > 0);
    assert.match(doc.errors[0]!.message, /expected 3 vertices/i);
  });
});
