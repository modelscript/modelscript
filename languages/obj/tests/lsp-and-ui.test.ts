// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { generateStandardEngineeringMtl } from "../src/catalog/index.js";
import { renderObjMeshSvg } from "../src/diagram/index.js";
import { objIndexing } from "../src/indexing.js";
import { getObjCompletions, getObjDocumentSymbols, getObjHover, validateObj } from "../src/lsp.js";
import { parseObjWithMtl } from "../src/parser/index.js";
import { ObjPanel } from "../src/ui/ObjPanel.js";

const SAMPLE_OBJ = [
  "mtllib std.mtl",
  "o Housing",
  "g Shell",
  "usemtl Copper",
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

describe("LSP Providers, UnifiedWorkspace Indexing, SVG 3D Renderer & ObjPanel UI", () => {
  it("validates OBJ/MTL documents and returns document symbols, hover, and completions", () => {
    assert.equal(validateObj(SAMPLE_OBJ, "housing.obj").length, 0);

    const invalidDiags = validateObj("v 0 0 0\nf 0 2 3\n", "bad.obj");
    assert.ok(invalidDiags.some((d) => d.code === "OBJ2001"));

    const symbols = getObjDocumentSymbols(SAMPLE_OBJ, "housing.obj");
    assert.equal(symbols.length, 1);
    assert.equal(symbols[0]?.name, "Housing");
    assert.ok((symbols[0]?.children?.length ?? 0) >= 3);

    const hoverV = getObjHover(SAMPLE_OBJ, { line: 4, character: 0 });
    assert.ok(hoverV?.contents.value.includes("Geometric Vertex"));

    const completionsObj = getObjCompletions(SAMPLE_OBJ, { line: 0, character: 0 }, "housing.obj");
    assert.ok(completionsObj.some((c) => c.label === "v"));
    assert.ok(completionsObj.some((c) => c.label === "usemtl"));

    const matCompletions = getObjCompletions("usemtl ", { line: 0, character: 7 }, "housing.obj");
    assert.ok(matCompletions.some((c) => c.label === "Aluminum"));
    assert.ok(matCompletions.some((c) => c.label === "Copper"));
  });

  it("recognizes .obj and .mtl files in objIndexing", () => {
    assert.equal(objIndexing.canIndex("file:///cube.obj", ""), true);
    assert.equal(objIndexing.canIndex("file:///materials.mtl", ""), true);
    assert.equal(objIndexing.canIndex("file:///notes.txt", "hello world"), false);
  });

  it("renders shaded isometric & orthographic SVG 3D views with MTL material swatch legend", () => {
    const { obj } = parseObjWithMtl(SAMPLE_OBJ, generateStandardEngineeringMtl());

    const svgIso = renderObjMeshSvg(obj, { view: "isometric", wireframe: true });
    assert.ok(svgIso.startsWith("<svg"));
    assert.ok(svgIso.includes('class="obj-mesh"'));
    assert.ok(svgIso.includes('class="obj-mtl-legend"'));
    assert.ok(svgIso.includes("Copper"));
    assert.ok(svgIso.includes("T=12"));

    const svgTop = renderObjMeshSvg(obj, { view: "top", wireframe: false });
    assert.ok(svgTop.includes("View: TOP"));
  });

  it("exports ObjPanel React component", () => {
    assert.equal(typeof ObjPanel, "function");
  });
});
