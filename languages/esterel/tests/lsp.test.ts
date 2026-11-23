// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { esterelIndexing } from "../src/indexing.js";
import {
  LspSymbolKind,
  getEsterelCompletions,
  getEsterelDocumentSymbols,
  getEsterelHover,
  validateEsterel,
} from "../src/lsp.js";

const SAMPLE = `module ABRO:
input A, B, R;
output O;
loop
  [ await A || await B ];
  emit O
each R
end module
`;

describe("Esterel Indexing & LSP", () => {
  it("validates clean and erroneous Esterel documents into LSP diagnostics", () => {
    assert.strictEqual(validateEsterel(SAMPLE).length, 0);

    const bad = `module Bad:
output S;
present S else emit S end
end module
`;
    const diags = validateEsterel(bad);
    assert.ok(diags.length > 0);
    assert.strictEqual(diags[0]!.source, "modelscript-esterel");
    assert.strictEqual(diags[0]!.code, "EST4002");
    assert.strictEqual(diags[0]!.severity, 1);
  });

  it("extracts hierarchical document symbols for modules and signals", () => {
    const syms = getEsterelDocumentSymbols(SAMPLE);
    assert.strictEqual(syms.length, 1);
    const modSym = syms[0]!;
    assert.strictEqual(modSym.name, "ABRO");
    assert.strictEqual(modSym.kind, LspSymbolKind.Module);
    assert.strictEqual(modSym.children?.length, 4);
    assert.ok(modSym.children?.some((c) => c.name === "A" && c.detail === "input"));
    assert.ok(modSym.children?.some((c) => c.name === "O" && c.detail === "output"));
  });

  it("provides hover documentation for keywords, signals, and modules", () => {
    const kwHover = getEsterelHover(SAMPLE, { line: 4, character: 5 }); // 'await'
    assert.ok(kwHover && kwHover.contents.value.includes("await"));

    const sigHover = getEsterelHover(SAMPLE, { line: 1, character: 6 }); // 'A'
    assert.ok(sigHover && sigHover.contents.value.includes("input A"));

    const modHover = getEsterelHover(SAMPLE, { line: 0, character: 8 }); // 'ABRO'
    assert.ok(modHover && modHover.contents.value.includes("ABRO"));
  });

  it("provides keyword, signal, and standard library completions", () => {
    const items = getEsterelCompletions(SAMPLE);
    assert.ok(items.some((i) => i.label === "await" && i.kind === "keyword"));
    assert.ok(items.some((i) => i.label === "R" && i.kind === "signal"));
    assert.ok(items.some((i) => i.label === "Watchdog" && i.kind === "snippet"));
  });

  it("recognizes .strl/.esterel files and indexes modules & signals via esterelIndexing", () => {
    assert.strictEqual(esterelIndexing.canIndex("file:///abro.strl", ""), true);
    assert.strictEqual(esterelIndexing.canIndex("file:///abro.esterel", ""), true);
    assert.strictEqual(esterelIndexing.canIndex("file:///abro.txt", SAMPLE), true);
    assert.strictEqual(esterelIndexing.canIndex("file:///other.txt", "hello world"), false);

    const added: Array<{ name: string; kind: string }> = [];
    let parsedModel: unknown = null;
    esterelIndexing.indexFile({
      uri: "file:///abro.strl",
      text: SAMPLE,
      setParsedModel(m) {
        parsedModel = m;
      },
      addSymbol(name, kind) {
        added.push({ name, kind });
        return added.length;
      },
    } as never);

    assert.ok(parsedModel);
    assert.ok(added.some((s) => s.name === "ABRO" && s.kind === "Package"));
    assert.ok(added.some((s) => s.name === "A" && s.kind === "Variable"));
    assert.ok(added.some((s) => s.name === "O" && s.kind === "Variable"));
  });
});
