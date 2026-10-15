// SPDX-License-Identifier: AGPL-3.0-or-later

import { buildPscadDiagram, renderPscadSvg } from "@modelscript/diagram/pscad-diagram-builder";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { pscadLanguage } from "../src/language.js";
import { lintPscx } from "../src/lints/index.js";
import { parsePscx } from "../src/parser/pscx-parser.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pslxFixturePath = path.resolve(__dirname, "fixtures/Component_Lib.pslx");

describe("PSCAD Library Project (.pslx) Suite", () => {
  it("registers .pslx in pscadLanguage file extensions", () => {
    assert.ok(pscadLanguage.fileExtensions.includes(".pslx"), "pscadLanguage should support .pslx");
    assert.ok(pscadLanguage.lsp?.fileExtensions?.includes(".pslx"), "pscad LSP should support .pslx");
  });

  it("parses PSCAD .pslx library projects correctly", () => {
    const text = fs.readFileSync(pslxFixturePath, "utf-8");
    const project = parsePscx(text);

    assert.equal(project.name, "Component_Lib");
    assert.equal(project.version, "5.1.0");
    assert.equal(project.projectType, "library");

    // Components (library catalog items)
    assert.equal(project.rootModule.components.length, 3, "Should parse the 3 library catalog components");
    const compNames = project.rootModule.components.map((c) => c.instanceName);
    assert.ok(
      compNames.some((n) => n?.includes("Rational_Operator")),
      "Should contain Rational_Operator",
    );
    assert.ok(
      compNames.some((n) => n?.includes("PF_Meter")),
      "Should contain PF_Meter",
    );
    assert.ok(
      compNames.some((n) => n?.includes("Flag")),
      "Should contain Flag",
    );

    // Definition ports attached to instances
    const ratOp = project.rootModule.components.find((c) => c.instanceName?.includes("Rational_Operator"));
    assert.ok(ratOp && ratOp.ports.length >= 3, "Rational_Operator should inherit In1, In2, Out ports");
    assert.ok(ratOp.ports.some((p) => p.name === "In1"));
    assert.ok(ratOp.ports.some((p) => p.name === "Out"));

    // Stickies (library canvas notes & banners)
    assert.ok(project.rootModule.stickies && project.rootModule.stickies.length >= 5, "Should parse stickies");
    const banner = project.rootModule.stickies?.find((s) => s.text.includes("EMT-Tools PSCAD Library"));
    assert.ok(banner, "Should find header banner sticky");
    assert.ok(banner.width > 500, "Banner should have expected width");
  });

  it("indexes .pslx components into PscadWorkspaceIndex for the Library panel", async () => {
    const text = fs.readFileSync(pslxFixturePath, "utf-8");
    const { PscadWorkspaceIndex } = await import("../src/workspace-index.js");
    const wsIndex = new PscadWorkspaceIndex();
    const index = wsIndex.indexFile("file:///Component_Lib.pslx", text);

    assert.ok(index.symbols.size >= 4, "Should index package and at least 3 components");
    const rootSymbol = Array.from(index.symbols.values()).find((s) => s.parentId === null);
    assert.ok(rootSymbol, "Should have root library package symbol");
    assert.equal(rootSymbol.name, "Component_Lib");
    assert.equal(rootSymbol.metadata?.classPrefixes, "package");

    const children = index.childrenOf.get(rootSymbol.id) || [];
    assert.equal(children.length, 4, "Library package should have 4 child components including Main");

    const childSymbols = children.map((id) => index.symbols.get(id)!);
    const childNames = childSymbols.map((s) => s.name);
    assert.ok(childNames.includes("Rational_Operator"));
    assert.ok(childNames.includes("PF_Meter"));
    assert.ok(childNames.includes("Flag"));
    assert.ok(childNames.includes("Main"));

    for (const child of childSymbols) {
      assert.ok(child.metadata?.iconSvg, `${child.name} should have an SVG icon`);
      assert.ok(child.metadata.iconSvg.startsWith("<svg"), `${child.name} iconSvg should be valid SVG`);
    }
  });

  it("lints .pslx library projects without unexpected errors", () => {
    const text = fs.readFileSync(pslxFixturePath, "utf-8");
    const project = parsePscx(text);
    const diags = lintPscx(project);
    assert.equal(diags.length, 0, "Clean library project should have 0 lint errors");
  });

  it("builds AntV X6 diagram graph and renders SVG for .pslx library", () => {
    const text = fs.readFileSync(pslxFixturePath, "utf-8");
    const project = parsePscx(text);
    const diagram = buildPscadDiagram(project);

    assert.ok(diagram.cells.length > 0, "Should have diagram cells");
    assert.ok(diagram.metadata.nodeCount >= 8, "Should have node count including components and stickies");

    const compCells = diagram.cells.filter((c) => c.data?.kind === "component");
    assert.equal(compCells.length, 3, "Should have 3 component nodes");
    assert.equal(
      compCells.find((c) => c.data?.name?.includes("Rational_Operator"))?.attrs?.label?.text,
      "Rational_Operator",
    );

    const stickyCells = diagram.cells.filter((c) => c.data?.kind === "sticky");
    assert.ok(stickyCells.length >= 5, "Should have sticky note card nodes");
    assert.ok(
      stickyCells.every((s) => s.shape === "rect"),
      "Sticky notes should use SVG rect nodes",
    );

    const svg = renderPscadSvg(project);
    assert.ok(svg.includes("Rational_Operator"), "SVG should render Rational_Operator");
    assert.ok(svg.includes("EMT-Tools PSCAD Library"), "SVG should render library banner");
  });
});
