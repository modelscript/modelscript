// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  edifIndexing,
  getEdifCompletions,
  getEdifDefinition,
  getEdifDocumentSymbols,
  getEdifHover,
  validateEdif,
} from "../src/index.js";

const LSP_SAMPLE = `(edif lsp_demo
  (edifVersion 2 0 0)
  (edifLevel 0)
  (external GENERIC
    (cell XOR2 (cellType GENERIC)
      (view netlist (viewType NETLIST)
        (interface (port A (direction INPUT)) (port B (direction INPUT)) (port Y (direction OUTPUT))))))
  (library WORK
    (cell TOP (cellType GENERIC)
      (view netlist (viewType NETLIST)
        (interface (port IN_A (direction INPUT)) (port IN_B (direction INPUT)) (port OUT_Y (direction OUTPUT)))
        (contents
          (instance U1 (viewRef netlist (cellRef XOR2 (libraryRef GENERIC))))
          (net N_A (joined (portRef IN_A) (portRef A (instanceRef U1))))
          (net N_B (joined (portRef IN_B) (portRef B (instanceRef U1))))
          (net N_Y (joined (portRef OUT_Y) (portRef Y (instanceRef U1))))))))
  (design TopDesign (cellRef TOP (libraryRef WORK))))`;

describe("@modelscript/edif LSP & Workspace Indexing Suite", () => {
  it("validates documents and extracts hierarchical document symbols", () => {
    const diags = validateEdif(LSP_SAMPLE, "demo.edf");
    assert.strictEqual(diags.length, 0);

    const symbols = getEdifDocumentSymbols(LSP_SAMPLE);
    assert.strictEqual(symbols.length, 1);
    assert.strictEqual(symbols[0]!.name, "lsp_demo");
    assert.ok(symbols[0]!.children && symbols[0]!.children.length >= 3);
  });

  it("provides hover for standard cells, EDIF keywords, and user instances", () => {
    // Line 4 contains `(cell XOR2 ...)`
    const hoverStd = getEdifHover(LSP_SAMPLE, { line: 4, character: 12 });
    assert.ok(hoverStd && hoverStd.contents.value.includes("XOR2"));

    // Line 1 contains `(edifVersion 2 0 0)`
    const hoverKw = getEdifHover(LSP_SAMPLE, { line: 1, character: 6 });
    assert.ok(hoverKw && hoverKw.contents.value.includes("edifVersion"));
  });

  it("provides completions and go-to-definition", () => {
    const completions = getEdifCompletions(LSP_SAMPLE);
    assert.ok(completions.some((c) => c.label === "edifVersion"));
    assert.ok(completions.some((c) => c.label === "TOP"));

    const lines = LSP_SAMPLE.split("\n");
    const refLine = lines.findIndex((l) => l.includes("(cellRef XOR2"));
    const refChar = lines[refLine]!.indexOf("XOR2") + 1;
    const def = getEdifDefinition(LSP_SAMPLE, { line: refLine, character: refChar }, "demo.edf");
    assert.ok(def, "Expected go-to-definition for XOR2");
    assert.strictEqual(def.range.start.line, 4);
  });

  it("supports UnifiedWorkspace indexing via edifIndexing", () => {
    assert.strictEqual(edifIndexing.canIndex("board.edf", ""), true);
    assert.strictEqual(edifIndexing.canIndex("chip.edif", ""), true);
    assert.strictEqual(edifIndexing.canIndex("unknown.txt", "(edif demo (edifVersion 2 0 0))"), true);
    assert.strictEqual(edifIndexing.canIndex("other.mo", "model Foo end Foo;"), false);

    const added: string[] = [];
    let parsed: unknown;
    edifIndexing.indexFile({
      text: LSP_SAMPLE,
      uri: "demo.edf",
      setParsedModel: (m: unknown) => {
        parsed = m;
      },
      addSymbol: (name: string) => {
        added.push(name);
        return added.length;
      },
    } as never);

    assert.ok(parsed);
    assert.ok(added.includes("lsp_demo"));
    assert.ok(added.includes("TOP"));
    assert.ok(added.includes("U1"));
    assert.ok(added.includes("N_Y"));
  });
});
