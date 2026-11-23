// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  dxfIndexing,
  getDxfCompletions,
  getDxfDocumentSymbols,
  getDxfHover,
  LspSymbolKind,
  validateDxf,
} from "../src/index.js";

const VALID_DXF = [
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
  "6",
  "CONTINUOUS",
  "0",
  "LAYER",
  "2",
  "HOLES",
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
  "BOLT_M6",
  "10",
  "0",
  "20",
  "0",
  "30",
  "0",
  "0",
  "CIRCLE",
  "8",
  "HOLES",
  "10",
  "0",
  "20",
  "0",
  "30",
  "0",
  "40",
  "3.2",
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
  "8",
  "OUTLINE",
  "10",
  "0",
  "20",
  "0",
  "30",
  "0",
  "11",
  "50",
  "21",
  "0",
  "31",
  "0",
  "0",
  "INSERT",
  "8",
  "HOLES",
  "2",
  "BOLT_M6",
  "10",
  "25",
  "20",
  "10",
  "30",
  "0",
  "0",
  "ENDSEC",
  "0",
  "EOF",
].join("\n");

const INVALID_DXF = [
  "0",
  "SECTION",
  "2",
  "ENTITIES",
  "0",
  "CIRCLE",
  "8",
  "0",
  "10",
  "0",
  "20",
  "0",
  "30",
  "0",
  "40",
  "-5",
  "0",
  "INSERT",
  "8",
  "0",
  "2",
  "UNDEFINED_BLOCK",
  "10",
  "10",
  "20",
  "10",
  "30",
  "0",
  "0",
  "ENDSEC",
].join("\n");

describe("DXF LSP services and UnifiedWorkspace indexing", () => {
  it("validates clean and erroneous DXF documents into LSP diagnostics", () => {
    const cleanDiags = validateDxf(VALID_DXF, "valid.dxf");
    assert.equal(cleanDiags.filter((d) => d.severity === 1).length, 0);

    const errDiags = validateDxf(INVALID_DXF, "invalid.dxf");
    assert.ok(errDiags.length >= 3);
    for (const d of errDiags) {
      assert.equal(d.source, "modelscript-dxf");
      assert.ok(d.range.start.line >= 0);
      assert.ok(d.range.end.character >= 1);
    }

    const codes = new Set(errDiags.map((d) => d.code));
    assert.ok(codes.has("DXF1003")); // missing EOF
    assert.ok(codes.has("DXF2002")); // undefined block
    assert.ok(codes.has("DXF3001")); // non-positive radius CIRCLE
  });

  it("builds hierarchical document symbols for sections, layers, blocks, and entities", () => {
    const symbols = getDxfDocumentSymbols(VALID_DXF);
    assert.equal(symbols.length, 4);
    assert.deepEqual(
      symbols.map((s) => s.name),
      ["SECTION HEADER", "SECTION TABLES", "SECTION BLOCKS", "SECTION ENTITIES"],
    );

    for (const sec of symbols) {
      assert.equal(sec.kind, LspSymbolKind.Namespace);
    }

    const tablesSec = symbols.find((s) => s.name === "SECTION TABLES");
    assert.ok(tablesSec?.children);
    assert.equal(tablesSec.children.length, 2);
    assert.equal(tablesSec.children[0]?.name, "OUTLINE");
    assert.equal(tablesSec.children[0]?.kind, LspSymbolKind.Variable);
    assert.ok(tablesSec.children[0]?.detail?.includes("CONTINUOUS"));

    const blocksSec = symbols.find((s) => s.name === "SECTION BLOCKS");
    assert.ok(blocksSec?.children);
    assert.equal(blocksSec.children.length, 1);
    assert.equal(blocksSec.children[0]?.name, "BOLT_M6");
    assert.equal(blocksSec.children[0]?.kind, LspSymbolKind.Class);

    const entitiesSec = symbols.find((s) => s.name === "SECTION ENTITIES");
    assert.ok(entitiesSec?.children);
    assert.equal(entitiesSec.children.length, 2);
    assert.equal(entitiesSec.children[0]?.name, "LINE #1");
    assert.equal(entitiesSec.children[0]?.kind, LspSymbolKind.Object);
    assert.equal(entitiesSec.children[1]?.name, "INSERT BOLT_M6");
  });

  it("provides Markdown hover for entity schemas, group codes, blocks, layers, and sections", () => {
    const lines = VALID_DXF.split("\n");
    const lineOf = (needle: string): number => {
      const idx = lines.findIndex((l) => l.trim() === needle);
      assert.ok(idx >= 0, `Line not found for token: ${needle}`);
      return idx;
    };

    // Entity schema hover
    const circleHover = getDxfHover(VALID_DXF, { line: lineOf("CIRCLE"), character: 0 });
    assert.ok(circleHover);
    assert.equal(circleHover.contents.kind, "markdown");
    assert.ok(circleHover.contents.value.includes("DXF Entity `CIRCLE`"));

    // Group code hover
    const code40Hover = getDxfHover(VALID_DXF, { line: lineOf("40"), character: 0 });
    assert.ok(code40Hover);
    assert.ok(code40Hover.contents.value.includes("DXF Group Code `40`"));

    // Block symbol hover
    const blockHover = getDxfHover(VALID_DXF, { line: lineOf("BOLT_M6"), character: 0 });
    assert.ok(blockHover);
    assert.ok(blockHover.contents.value.includes("DXF Block `BOLT_M6`"));

    // Layer symbol hover
    const layerHover = getDxfHover(VALID_DXF, { line: lineOf("OUTLINE"), character: 0 });
    assert.ok(layerHover);
    assert.ok(layerHover.contents.value.includes("DXF Layer `OUTLINE`"));

    // Section summary hover
    const sectionHover = getDxfHover(VALID_DXF, { line: lineOf("ENTITIES"), character: 0 });
    assert.ok(sectionHover);
    assert.ok(sectionHover.contents.value.includes("DXF Drawing Summary"));
    assert.ok(sectionHover.contents.value.includes("Flattened Entities"));

    // Out of bounds / unknown token returns null
    assert.equal(getDxfHover(VALID_DXF, { line: 9999, character: 0 }), null);
    assert.equal(getDxfHover("UNKNOWN_TOKEN_XYZ", { line: 0, character: 0 }), null);
  });

  it("provides context-sensitive completions based on preceding DXF group code", () => {
    // After group code 0 -> entity types and structural keywords
    const after0 = getDxfCompletions("0\n", { line: 1, character: 0 });
    const labels0 = new Set(after0.map((c) => c.label));
    assert.ok(labels0.has("LINE"));
    assert.ok(labels0.has("CIRCLE"));
    assert.ok(labels0.has("LWPOLYLINE"));
    assert.ok(labels0.has("SECTION"));
    assert.ok(labels0.has("EOF"));

    // After group code 2 -> section names + defined blocks
    const withBlock = `${VALID_DXF}\n2\n`;
    const after2 = getDxfCompletions(withBlock, { line: withBlock.split("\n").length - 1, character: 0 });
    const labels2 = new Set(after2.map((c) => c.label));
    assert.ok(labels2.has("HEADER"));
    assert.ok(labels2.has("ENTITIES"));
    assert.ok(labels2.has("BOLT_M6"));

    // After group code 9 -> HEADER variables
    const after9 = getDxfCompletions("9\n", { line: 1, character: 0 });
    const labels9 = new Set(after9.map((c) => c.label));
    assert.ok(labels9.has("$ACADVER"));
    assert.ok(labels9.has("$INSUNITS"));

    // After group code 8 -> default layer "0" + defined layers
    const withLayer = `${VALID_DXF}\n8\n`;
    const after8 = getDxfCompletions(withLayer, { line: withLayer.split("\n").length - 1, character: 0 });
    const labels8 = new Set(after8.map((c) => c.label));
    assert.ok(labels8.has("0"));
    assert.ok(labels8.has("OUTLINE"));
    assert.ok(labels8.has("HOLES"));

    // Default fallback
    const fallback = getDxfCompletions("40\n", { line: 1, character: 0 });
    assert.ok(fallback.some((c) => c.label === "CIRCLE"));
  });

  it("detects and indexes DXF files via dxfIndexing", () => {
    assert.equal(dxfIndexing.canIndex("bracket.dxf", ""), true);
    assert.equal(dxfIndexing.canIndex("BRACKET.DXF", ""), true);
    assert.equal(dxfIndexing.canIndex("untitled.txt", "0\nSECTION\n2\nENTITIES\n0\nENDSEC\n0\nEOF"), true);
    assert.equal(dxfIndexing.canIndex("notes.txt", "just plain text"), false);

    const added: Array<{ name: string; kind: string; parentId: number | null }> = [];
    let parsedModel: unknown;
    let nextId = 1;

    dxfIndexing.indexFile({
      uri: "file:///bracket.dxf",
      text: VALID_DXF,
      setParsedModel(model: unknown) {
        parsedModel = model;
      },
      addSymbol(name: string, kind: string, parentId: number | null) {
        const id = nextId++;
        added.push({ name, kind, parentId });
        return id;
      },
    } as Parameters<typeof dxfIndexing.indexFile>[0]);

    assert.ok(parsedModel);
    assert.equal(added[0]?.name, "DXF (AC1027)");
    assert.equal(added[0]?.kind, "Package");
    assert.ok(added.some((s) => s.name === "LAYER:OUTLINE" && s.kind === "Variable"));
    assert.ok(added.some((s) => s.name === "LAYER:HOLES" && s.kind === "Variable"));
    assert.ok(added.some((s) => s.name === "BOLT_M6" && s.kind === "Class"));
    assert.ok(added.some((s) => s.name === "LINE#1" && s.kind === "Component"));
    assert.ok(added.some((s) => s.name === "INSERT:BOLT_M6" && s.kind === "Component"));
  });
});
