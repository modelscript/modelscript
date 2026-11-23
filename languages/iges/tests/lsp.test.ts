// SPDX-License-Identifier: AGPL-3.0-or-later

import type { DslIndexFileContext } from "@modelscript/dsl";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildIgesFile,
  getIgesCompletions,
  getIgesDocumentSymbols,
  getIgesHover,
  igesIndexing,
  LspSymbolKind,
  validateIges,
} from "../src/index.js";

describe("@modelscript/iges — LSP Providers & UnifiedWorkspace Indexing", () => {
  const sampleIges = buildIgesFile({
    startComment: "Valve Body CAD Model",
    productId: "VALVE_BODY",
    fileName: "valve.igs",
    unitFlag: 2,
    entities: [
      { entityType: 110, label: "AXISLINE", params: [0, 0, 0, 0, 0, 50] },
      { entityType: 100, label: "PORT_ARC", params: [0, 0, 0, 15, 0, 15, 0] },
    ],
  });

  it("validates IGES documents into LSP diagnostics", () => {
    const clean = validateIges(sampleIges, "valve.igs");
    assert.equal(clean.length, 0);

    const invalid = buildIgesFile({
      unitFlag: 99,
      entities: [{ entityType: 110, params: [5, 5, 5, 5, 5, 5] }],
    });
    const diags = validateIges(invalid, "bad.igs");
    assert.ok(diags.length >= 2);
    assert.ok(diags.every((d) => d.source === "modelscript-iges"));
    assert.ok(diags.some((d) => d.code === "IGES4001"));
    assert.ok(diags.some((d) => d.code === "IGES5001"));
  });

  it("extracts hierarchical LSP document symbols", () => {
    const symbols = getIgesDocumentSymbols(sampleIges);
    assert.equal(symbols.length, 1);
    const root = symbols[0]!;
    assert.equal(root.name, "VALVE_BODY");
    assert.equal(root.kind, LspSymbolKind.Package);
    assert.ok(root.detail?.includes("2 entities"));
    assert.ok(root.detail?.includes("MM"));
    assert.equal(root.children?.length, 2);
    assert.equal(root.children?.[0]?.name, "AXISLINE (D1)");
    assert.ok(root.children?.[0]?.detail?.includes("Type 110"));
    assert.equal(root.children?.[1]?.name, "PORT_ARC (D3)");
    assert.ok(root.children?.[1]?.detail?.includes("Type 100"));
  });

  it("provides contextual Markdown hover documentation for S, G, D, P, and T sections", () => {
    const lines = sampleIges.split("\n");
    const findLine = (sec: string): number => lines.findIndex((l) => l.length === 80 && l[72] === sec);

    const sHover = getIgesHover(sampleIges, { line: findLine("S"), character: 5 });
    assert.ok(sHover && sHover.contents.value.includes("Start Section"));

    const gHover = getIgesHover(sampleIges, { line: findLine("G"), character: 5 });
    assert.ok(gHover && gHover.contents.value.includes("VALVE_BODY"));
    assert.ok(gHover.contents.value.includes("MM"));

    const dHover = getIgesHover(sampleIges, { line: findLine("D"), character: 5 });
    assert.ok(dHover && dHover.contents.value.includes("Directory Entry `D1`"));
    assert.ok(dHover.contents.value.includes("Type `110`"));

    const pHover = getIgesHover(sampleIges, { line: findLine("P"), character: 5 });
    assert.ok(pHover && pHover.contents.value.includes("Parameter Data for `D1`"));

    const tHover = getIgesHover(sampleIges, { line: findLine("T"), character: 5 });
    assert.ok(tHover && tHover.contents.value.includes("Terminate Section"));

    const outOfRange = getIgesHover(sampleIges, { line: 9999, character: 0 });
    assert.equal(outOfRange, null);
  });

  it("provides IGES 5.3 entity and unit preset completion items", () => {
    const completions = getIgesCompletions();
    assert.ok(completions.length >= 21);
    assert.ok(completions.some((c) => c.label === "TYPE_126"));
    assert.ok(completions.some((c) => c.label === "TYPE_186"));
    assert.ok(completions.some((c) => c.label === "UNIT_MM"));
  });

  it("supports UnifiedWorkspace file detection and symbol indexing via igesIndexing", () => {
    assert.equal(igesIndexing.canIndex("model.igs", ""), true);
    assert.equal(igesIndexing.canIndex("model.IGES", ""), true);
    assert.equal(igesIndexing.canIndex("unknown.txt", sampleIges), true);
    assert.equal(igesIndexing.canIndex("other.mo", "model Foo end Foo;"), false);

    const added: Array<{ name: string; kind: string; parentId: number | null }> = [];
    let parsedModel: unknown = null;
    let nextId = 1;

    const mockCtx: DslIndexFileContext = {
      uri: "file:///valve.igs",
      text: sampleIges,
      setParsedModel(model: unknown) {
        parsedModel = model;
      },
      addSymbol(name: string, kind: string, parentId: number | null) {
        const id = nextId++;
        added.push({ name, kind, parentId });
        return id;
      },
    } as unknown as DslIndexFileContext;

    igesIndexing.indexFile(mockCtx);
    assert.ok(parsedModel !== null);
    assert.equal(added.length, 3);
    assert.equal(added[0]?.name, "VALVE_BODY");
    assert.equal(added[0]?.kind, "Package");
    assert.equal(added[0]?.parentId, null);
    assert.equal(added[1]?.parentId, 1);
    assert.ok(added[1]?.name.includes("AXISLINE"));
    assert.equal(added[2]?.parentId, 1);
    assert.ok(added[2]?.name.includes("PORT_ARC"));
  });
});
