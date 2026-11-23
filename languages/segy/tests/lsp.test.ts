// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getSegyCompletions, getSegyDocumentSymbols, getSegyHover, segyIndexing, validateSegy } from "../src/index.js";

const SAMPLE_HEADER = [
  "C 1 CLIENT: MODELSCRIPT GEOPHYSICS",
  "C 2 LINE: NORTH-SEA-01",
  "C 3 AREA: VIKING GRABEN",
  "C 4 SAMPLE INTERVAL: 2000 US",
  "C 5 TRACE LENGTH: 4000 MS",
  "C 6 FORMAT: 1 (IBM FLOAT32)",
  "C 7 SEG Y REV 1.0",
  "C 8 WAVELET: Ricker",
  "C40 END TEXTUAL HEADER",
].join("\n");

describe("@modelscript/segy — Unified Indexing & LSP Services", () => {
  it("validates textual reel headers and returns structured LSP diagnostics", () => {
    const clean = validateSegy(SAMPLE_HEADER);
    assert.equal(clean.length, 0);

    const invalid = validateSegy("BAD LINE\nC 2 SEG Y REV 1.0");
    assert.ok(invalid.some((d) => d.code === "SEGY1001" && d.source === "modelscript-segy"));
    assert.ok(invalid.some((d) => d.code === "SEGY5006"));
  });

  it("extracts hierarchical document symbols from SEG-Y textual headers", () => {
    const syms = getSegyDocumentSymbols(SAMPLE_HEADER);
    assert.equal(syms.length, 1);
    assert.equal(syms[0]!.name, "NORTH-SEA-01");
    assert.ok((syms[0]!.children?.length ?? 0) >= 7);
    assert.ok(syms[0]!.children?.some((c) => c.name === "CLIENT"));
    assert.ok(syms[0]!.children?.some((c) => c.name === "END TEXTUAL HEADER"));
  });

  it("provides hover documentation for SEG-Y keywords and stdlib schemas", () => {
    const hoverKeyword = getSegyHover(SAMPLE_HEADER, { line: 3, character: 8 });
    assert.ok(hoverKeyword);
    assert.ok(hoverKeyword.contents.value.includes("SAMPLE INTERVAL"));

    const hoverWavelet = getSegyHover(SAMPLE_HEADER, { line: 7, character: 15 });
    assert.ok(hoverWavelet);
    assert.ok(hoverWavelet.contents.value.includes("Ricker"));
  });

  it("returns completions for SEG-Y header keywords and standard schemas", () => {
    const items = getSegyCompletions();
    assert.ok(items.some((i) => i.label === "CLIENT"));
    assert.ok(items.some((i) => i.label === "END TEXTUAL HEADER"));
    assert.ok(items.some((i) => i.label === "Inline3D"));
    assert.ok(items.some((i) => i.label === "Ricker"));
  });

  it("supports UnifiedWorkspace indexing via segyIndexing", () => {
    assert.equal(segyIndexing.canIndex("survey.sgy", ""), true);
    assert.equal(segyIndexing.canIndex("survey.segy", ""), true);
    assert.equal(segyIndexing.canIndex("header.txt", SAMPLE_HEADER), true);
    assert.equal(segyIndexing.canIndex("other.txt", "hello world"), false);

    const symbols: Array<{ name: string; kind: string }> = [];
    let parsedModel: unknown = null;
    segyIndexing.indexFile({
      uri: "file:///survey.sgyhdr",
      text: SAMPLE_HEADER,
      setParsedModel: (m) => {
        parsedModel = m;
      },
      addSymbol: (name, kind) => {
        symbols.push({ name, kind });
        return symbols.length;
      },
    } as Parameters<typeof segyIndexing.indexFile>[0]);

    assert.ok(parsedModel !== null);
    assert.ok(symbols.some((s) => s.kind === "Package" && s.name === "NORTH-SEA-01"));
    assert.ok(symbols.some((s) => s.kind === "Field" && s.name.includes("CLIENT")));
  });
});
