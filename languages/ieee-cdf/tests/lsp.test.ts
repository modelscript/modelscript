// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BPA_3_BUS_IPF, IEEE_14_BUS_CDF } from "../src/catalog/ieee-cdf-std-schemas.js";
import { ieeeCdfIndexing } from "../src/indexing.js";
import {
  LspSymbolKind,
  getIeeeCdfCompletions,
  getIeeeCdfDocumentSymbols,
  getIeeeCdfHover,
  validateIeeeCdf,
} from "../src/lsp.js";

describe("@modelscript/ieee-cdf LSP & UnifiedWorkspace Indexing Suite", () => {
  it("validates IEEE CDF documents and produces LSP diagnostics", () => {
    assert.strictEqual(validateIeeeCdf(IEEE_14_BUS_CDF).length, 0);

    const invalid = `01/01/73 TEST 100.0 1973 S INVALID
BUS DATA FOLLOWS
1 "Bus1" 1 1 0 1.0 0.0 10 5 0 0 138 0 0 0 0 0 0
-999
BRANCH DATA FOLLOWS
1 99 1 1 1 0 0.0 0.0 0.0
-999
END OF DATA
`;
    const diags = validateIeeeCdf(invalid);
    assert.ok(diags.length >= 3);
    assert.ok(diags.every((d) => d.source === "modelscript-ieee-cdf"));
    assert.ok(diags.some((d) => d.code === "CDF4001"));
    assert.ok(diags.some((d) => d.code === "CDF2002"));
    assert.ok(diags.some((d) => d.code === "CDF3002"));
  });

  it("provides hierarchical document symbols for IEEE 14-bus and BPA 3-bus decks", () => {
    const syms = getIeeeCdfDocumentSymbols(IEEE_14_BUS_CDF);
    assert.strictEqual(syms.length, 1);
    assert.strictEqual(syms[0]!.kind, LspSymbolKind.Package);
    assert.strictEqual(syms[0]!.children?.length, 14 + 20);
  });

  it("provides Markdown hover information on section headers, buses, and branches", () => {
    const headerHover = getIeeeCdfHover(IEEE_14_BUS_CDF, { line: 1, character: 0 });
    assert.ok(headerHover?.contents.value.includes("BUS DATA FOLLOWS"));

    const bus1Hover = getIeeeCdfHover(IEEE_14_BUS_CDF, { line: 2, character: 4 });
    assert.ok(bus1Hover?.contents.value.includes("Bus 1"));
    assert.ok(bus1Hover?.contents.value.includes("Slack"));

    const branchHover = getIeeeCdfHover(IEEE_14_BUS_CDF, { line: 18, character: 4 });
    assert.ok(branchHover?.contents.value.includes("Branch 1 → 2"));
  });

  it("provides completions for IEEE CDF and BPA IPF keywords", () => {
    const items = getIeeeCdfCompletions();
    const labels = new Set(items.map((i) => i.label));
    assert.ok(labels.has("BUS DATA FOLLOWS"));
    assert.ok(labels.has("BRANCH DATA FOLLOWS"));
    assert.ok(labels.has("END OF DATA"));
    assert.ok(labels.has("BS"));
    assert.ok(labels.has("BQ"));
  });

  it("implements UnifiedWorkspace indexing via ieeeCdfIndexing", () => {
    assert.strictEqual(ieeeCdfIndexing.canIndex("case14.cdf", ""), true);
    assert.strictEqual(ieeeCdfIndexing.canIndex("grid.ipf", ""), true);
    assert.strictEqual(ieeeCdfIndexing.canIndex("unknown.txt", IEEE_14_BUS_CDF), true);
    assert.strictEqual(ieeeCdfIndexing.canIndex("unknown.txt", BPA_3_BUS_IPF), true);
    assert.strictEqual(ieeeCdfIndexing.canIndex("other.mo", "model Foo end Foo;"), false);

    const added: Array<{ name: string; kind: string }> = [];
    let parsedModel: unknown = null;
    ieeeCdfIndexing.indexFile({
      uri: "case14.cdf",
      text: IEEE_14_BUS_CDF,
      setParsedModel: (m: unknown) => {
        parsedModel = m;
      },
      addSymbol: (name: string, kind: string) => {
        added.push({ name, kind });
        return added.length;
      },
    } as never);

    assert.ok(parsedModel);
    assert.strictEqual(added.length, 1 + 14 + 20);
    assert.strictEqual(added[0]!.kind, "Package");
  });
});
