// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  LspSymbolKind,
  getLustreCompletions,
  getLustreDocumentSymbols,
  getLustreHover,
  lustreIndexing,
  validateLustre,
} from "../src/index.js";

describe("@modelscript/lustre — LSP & UnifiedWorkspace Indexing", () => {
  const sample = `const STEP: int = 1;

node Ramp(reset: bool) returns (y: int);
var
  prev_y: int;
let
  prev_y = 0 -> pre(y);
  y = if reset then 0 else prev_y + STEP;
tel
`;

  it("returns zero diagnostics for valid Lustre and reports LUST codes for invalid code", () => {
    assert.strictEqual(validateLustre(sample).length, 0);

    const invalid = `node Bad(x: int) returns (y: int); let y = y + 1; tel`;
    const diags = validateLustre(invalid);
    assert.ok(diags.some((d) => d.code === "LUST4001" && d.source === "modelscript-lustre"));
  });

  it("extracts hierarchical document symbols for constants, nodes, and variables", () => {
    const syms = getLustreDocumentSymbols(sample);
    assert.strictEqual(syms.length, 2);
    assert.strictEqual(syms[0]!.name, "STEP");
    assert.strictEqual(syms[0]!.kind, LspSymbolKind.Constant);
    assert.strictEqual(syms[1]!.name, "Ramp");
    assert.strictEqual(syms[1]!.kind, LspSymbolKind.Class);
    assert.strictEqual(syms[1]!.children?.length, 3);
  });

  it("provides hover docs for keywords, ->, stdlib operators, and local variables", () => {
    const preHover = getLustreHover(sample, { line: 6, character: 17 }); // `pre`
    assert.ok(preHover?.contents.value.includes("pre(e)"));

    const arrowHover = getLustreHover(sample, { line: 6, character: 13 }); // `->`
    assert.ok(arrowHover?.contents.value.includes("Followed-By"));

    const varHover = getLustreHover(sample, { line: 7, character: 2 }); // `y`
    assert.ok(varHover?.contents.value.includes("output `y`"));
  });

  it("provides completions including keywords, stdlib operators, and local symbols", () => {
    const items = getLustreCompletions(sample);
    assert.ok(items.some((i) => i.label === "pre"));
    assert.ok(items.some((i) => i.label === "RisingEdge"));
    assert.ok(items.some((i) => i.label === "Ramp"));
    assert.ok(items.some((i) => i.label === "STEP"));
  });

  it("detects .lus/.ec files and indexes symbols in lustreIndexing", () => {
    assert.strictEqual(lustreIndexing.canIndex("controller.lus", ""), true);
    assert.strictEqual(lustreIndexing.canIndex("spec.ec", ""), true);
    assert.strictEqual(lustreIndexing.canIndex("unknown.txt", sample), true);
    assert.strictEqual(lustreIndexing.canIndex("notes.txt", "hello world"), false);

    const indexed: string[] = [];
    lustreIndexing.indexFile({
      uri: "file:///ramp.lus",
      text: sample,
      setParsedModel: () => {},
      addSymbol: (name: string) => {
        indexed.push(name);
        return indexed.length;
      },
    } as any);
    assert.ok(indexed.includes("STEP"));
    assert.ok(indexed.includes("Ramp"));
    assert.ok(indexed.includes("reset"));
    assert.ok(indexed.includes("y"));
  });
});
