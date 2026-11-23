// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildUnitCubeStl,
  formatAsciiStl,
  getStlCompletions,
  getStlDocumentSymbols,
  getStlHover,
  renderStlMeshSvg,
  stlIndexing,
  validateStl,
} from "../src/index.js";
import { StlPanel } from "../src/ui/StlPanel.js";

describe("@modelscript/stl — LSP, Indexing, SVG Viewport & React UI Panel", () => {
  const cubeAscii = formatAsciiStl(buildUnitCubeStl(1.0, "unit_cube"));

  it("validates clean STL with zero LSP diagnostics and extracts document symbols", () => {
    const diags = validateStl(cubeAscii, "cube.stl");
    assert.equal(diags.length, 0);

    const symbols = getStlDocumentSymbols(cubeAscii);
    assert.equal(symbols.length, 1);
    assert.equal(symbols[0]?.name, "unit_cube");
    assert.equal(symbols[0]?.children?.length, 12);
  });

  it("provides hover documentation and keyword completions", () => {
    const solidHover = getStlHover(cubeAscii, { line: 0, character: 2 });
    assert.ok(solidHover);
    assert.match(solidHover.contents.value, /STL Solid/);
    assert.match(solidHover.contents.value, /Watertight:\s*\*\*Yes\*\*/);

    const facetHover = getStlHover(cubeAscii, { line: 1, character: 4 });
    assert.ok(facetHover);
    assert.match(facetHover.contents.value, /facet normal/);

    const completions = getStlCompletions("fa", { line: 0, character: 2 });
    assert.ok(completions.some((c) => c.label === "facet normal"));
  });

  it("renders isometric and orthographic SVG views with shaded and wireframe modes", () => {
    const cube = buildUnitCubeStl(1.0, "cube");
    for (const view of ["iso", "xy", "xz", "yz"] as const) {
      const shaded = renderStlMeshSvg(cube, { view, wireframe: false });
      assert.ok(shaded.startsWith("<svg"));
      assert.ok(shaded.includes(`data-stl-view="${view}"`));
      assert.ok(shaded.includes("<polygon"));

      const wire = renderStlMeshSvg(cube, { view, wireframe: true });
      assert.ok(wire.includes('data-wireframe="true"'));
    }
  });

  it("exposes stlIndexing and React StlPanel component", () => {
    assert.equal(stlIndexing.canIndex("mesh.stl", ""), true);
    assert.equal(stlIndexing.canIndex("unknown.txt", cubeAscii), true);
    assert.equal(stlIndexing.canIndex("other.txt", "hello world"), false);
    assert.equal(typeof StlPanel, "function");
  });
});
