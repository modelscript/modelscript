// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { StlErrorCode, buildUnitCubeStl, lintStl, parseAsciiStl, type StlMeshDocument } from "../src/index.js";

describe("@modelscript/stl — Lints & Manifold Diagnostics (STL1001–STL5006)", () => {
  it("produces zero diagnostics for a clean watertight unit cube", () => {
    const cube = buildUnitCubeStl(1.0);
    const diags = lintStl(cube);
    assert.equal(diags.length, 0);
  });

  it("flags mismatched solid/endsolid names (STL1002)", () => {
    const src = [
      "solid alpha",
      "  facet normal 0 0 1",
      "    outer loop",
      "      vertex 0 0 0",
      "      vertex 1 0 0",
      "      vertex 0 1 0",
      "    endloop",
      "  endfacet",
      "endsolid beta",
    ].join("\n");

    const diags = lintStl(parseAsciiStl(src));
    assert.ok(diags.some((d) => d.code === StlErrorCode.MISMATCHED_ENDSOLID.code));
  });

  it("flags NaN/Inf vertex coordinates (STL2001)", () => {
    const doc: StlMeshDocument = {
      format: "ascii",
      solids: [
        {
          name: "nan_mesh",
          closed: true,
          facets: [
            {
              normal: [0, 0, 1],
              vertices: [
                [Number.NaN, 0, 0],
                [1, 0, 0],
                [0, 1, 0],
              ],
            },
          ],
        },
      ],
      facets: [
        {
          normal: [0, 0, 1],
          vertices: [
            [Number.NaN, 0, 0],
            [1, 0, 0],
            [0, 1, 0],
          ],
        },
      ],
      errors: [],
    };
    const diags = lintStl(doc);
    assert.ok(diags.some((d) => d.code === StlErrorCode.NAN_OR_INF_COORDINATE.code));
  });

  it("flags degenerate zero-area triangles (STL3001)", () => {
    const src = [
      "solid degen",
      "  facet normal 0 0 1",
      "    outer loop",
      "      vertex 0 0 0",
      "      vertex 1 0 0",
      "      vertex 2 0 0",
      "    endloop",
      "  endfacet",
      "endsolid degen",
    ].join("\n");
    const diags = lintStl(parseAsciiStl(src));
    assert.ok(diags.some((d) => d.code === StlErrorCode.DEGENERATE_TRIANGLE.code));
  });

  it("flags facet normal inconsistent with right-hand-rule vertex winding (STL3002)", () => {
    const src = [
      "solid flipped_normal",
      "  facet normal 0 0 -1",
      "    outer loop",
      "      vertex 0 0 0",
      "      vertex 1 0 0",
      "      vertex 0 1 0",
      "    endloop",
      "  endfacet",
      "endsolid flipped_normal",
    ].join("\n");
    const diags = lintStl(parseAsciiStl(src));
    assert.ok(diags.some((d) => d.code === StlErrorCode.INCONSISTENT_NORMAL.code));
  });

  it("flags non-manifold edges shared by >2 faces (STL4001) and open boundary edges (STL4002)", () => {
    // 3 triangles sharing the edge (0,0,0)-(1,0,0)
    const src = [
      "solid non_manifold",
      "  facet normal 0 0 1",
      "    outer loop",
      "      vertex 0 0 0",
      "      vertex 1 0 0",
      "      vertex 0 1 0",
      "    endloop",
      "  endfacet",
      "  facet normal 0 -1 0",
      "    outer loop",
      "      vertex 0 0 0",
      "      vertex 1 0 0",
      "      vertex 0 0 1",
      "    endloop",
      "  endfacet",
      "  facet normal 0 1 0",
      "    outer loop",
      "      vertex 0 0 0",
      "      vertex 1 0 0",
      "      vertex 0 0 -1",
      "    endloop",
      "  endfacet",
      "endsolid non_manifold",
    ].join("\n");

    const diags = lintStl(parseAsciiStl(src));
    assert.ok(diags.some((d) => d.code === StlErrorCode.NON_MANIFOLD_EDGE.code));
    assert.ok(diags.some((d) => d.code === StlErrorCode.OPEN_BOUNDARY_EDGE.code));
  });

  it("flags negative signed volume on an inverted cube (STL5001)", () => {
    const cube = buildUnitCubeStl(1.0);
    // Invert vertex winding and normals
    const invertedFacets = cube.facets.map((f) => ({
      normal: [-f.normal[0], -f.normal[1], -f.normal[2]] as [number, number, number],
      vertices: [f.vertices[0], f.vertices[2], f.vertices[1]] as [
        [number, number, number],
        [number, number, number],
        [number, number, number],
      ],
    }));
    const invDoc: StlMeshDocument = {
      format: "ascii",
      solids: [{ name: "inverted_cube", closed: true, facets: invertedFacets }],
      facets: invertedFacets,
      errors: [],
    };
    const diags = lintStl(invDoc);
    assert.ok(diags.some((d) => d.code === StlErrorCode.NEGATIVE_SIGNED_VOLUME.code));
  });
});
