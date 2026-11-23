// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { cifIndexing } from "../src/indexing.js";
import { executeCifAction, getCifDocumentSymbols, getCifHover, validateCif } from "../src/lsp.js";

const SAMPLE_CIF = `DS 1 100/1;
9 INV_CELL;
L CPG;
B 8 2 4 1;
L CMF;
B 10 3 5 4;
DF;
C 1;
E`;

describe("CIF 2.0 LSP Services & UnifiedWorkspace Indexing", () => {
  it("validates clean and erroneous CIF documents via validateCif", () => {
    const cleanDiags = validateCif(SAMPLE_CIF, "inv.cif");
    assert.strictEqual(cleanDiags.length, 0);

    const errDiags = validateCif("DS 1;\nL CMF;\nB 10 100 0 0;\nDF;\nC 99;\n", "bad.cif");
    assert.ok(errDiags.some((d) => d.code === "CIF3001"));
    assert.ok(errDiags.some((d) => d.code === "CIF5006"));
    assert.ok(errDiags.some((d) => d.code === "CIF1002"));
  });

  it("extracts document symbols for DS symbol definitions", () => {
    const symbols = getCifDocumentSymbols(SAMPLE_CIF, "inv.cif");
    assert.strictEqual(symbols.length, 1);
    const root = symbols[0]!;
    assert.ok(root.children && root.children.length === 1);
    assert.ok(root.children[0]!.name.includes("DS 1"));
    assert.ok(root.children[0]!.name.includes("INV_CELL"));
  });

  it("provides markdown hover documentation for MOSIS SCMOS layers and symbol calls", () => {
    const layerHover = getCifHover(SAMPLE_CIF, { line: 2, character: 2 });
    assert.ok(layerHover);
    assert.ok(layerHover.contents.value.includes("CPG"));
    assert.ok(layerHover.contents.value.includes("2λ"));

    const callHover = getCifHover(SAMPLE_CIF, { line: 7, character: 1 });
    assert.ok(callHover);
    assert.ok(callHover.contents.value.includes("INV_CELL"));
  });

  it("executes domain actions (lint, flatten, to_dae, to_gdt, to_svg)", async () => {
    const lintRes = (await executeCifAction("lint", { content: SAMPLE_CIF })) as unknown[];
    assert.strictEqual(lintRes.length, 0);

    const daeRes = (await executeCifAction("to_dae", { content: SAMPLE_CIF })) as { eqCount: number };
    assert.strictEqual(daeRes.eqCount, 8);

    const gdt = (await executeCifAction("to_gdt", { content: SAMPLE_CIF })) as string;
    assert.ok(gdt.startsWith("gds2{600"));

    const svg = (await executeCifAction("to_svg", { content: SAMPLE_CIF })) as string;
    assert.ok(svg.startsWith("<svg "));
  });

  it("detects and indexes CIF files via cifIndexing", () => {
    assert.strictEqual(cifIndexing.canIndex("chip.cif", ""), true);
    assert.strictEqual(cifIndexing.canIndex("layout.txt", "DS 1 100/1;\nDF;\nE"), true);
    assert.strictEqual(cifIndexing.canIndex("other.txt", "hello world"), false);

    const added: Array<{ name: string; kind: string }> = [];
    cifIndexing.indexFile({
      uri: "file:///chip.cif",
      text: SAMPLE_CIF,
      setParsedModel: () => {},
      addSymbol: (name: string, kind: string) => {
        added.push({ name, kind });
        return added.length;
      },
    } as never);
    assert.strictEqual(added.length, 2);
    assert.strictEqual(added[0]!.kind, "Package");
    assert.strictEqual(added[1]!.kind, "Class");
  });
});
