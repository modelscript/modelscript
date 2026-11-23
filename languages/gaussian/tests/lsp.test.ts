// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  gaussianIndexing,
  getGaussianCompletions,
  getGaussianDocumentSymbols,
  getGaussianHover,
  validateGaussian,
} from "../src/index.js";

describe("@modelscript/gaussian — Indexing & LSP Services", () => {
  const sampleGjf = `%chk=water.chk
%mem=2GB
#p B3LYP/6-31G(d) opt freq

Water Opt Freq

0 1
O
H 1 rOH
H 1 rOH 2 aHOH
Variables:
rOH = 0.9572
aHOH = 104.52
`;

  it("validates documents and maps lints to LSP diagnostics", () => {
    const clean = validateGaussian(sampleGjf);
    assert.equal(clean.filter((d) => d.severity === 1).length, 0);

    const invalid = sampleGjf.replace("0 1", "0 2");
    const diags = validateGaussian(invalid);
    assert.ok(diags.some((d) => d.code === "GAU3001" && d.severity === 1));
    assert.ok(diags.every((d) => d.source === "modelscript-gaussian"));
  });

  it("produces hierarchical LSP document symbols for jobs, Link0, route, atoms, and variables", () => {
    const symbols = getGaussianDocumentSymbols(sampleGjf);
    assert.equal(symbols.length, 1);
    assert.equal(symbols[0]?.name, "Water Opt Freq");
    const childNames = (symbols[0]?.children ?? []).map((c) => c.name);
    assert.ok(childNames.includes("%chk"));
    assert.ok(childNames.includes("%mem"));
    assert.ok(childNames.some((n) => n.includes("B3LYP/6-31G(d)")));
    assert.ok(childNames.includes("O1"));
    assert.ok(childNames.includes("rOH"));
    assert.ok(childNames.includes("aHOH"));
  });

  it("provides contextual hover docs for Link0, method/basis, route keywords, elements, and Z-matrix variables", () => {
    // Line 0: %chk=water.chk -> hover on %chk
    const link0Hover = getGaussianHover(sampleGjf, { line: 0, character: 2 });
    assert.ok(link0Hover && link0Hover.contents.value.includes("checkpoint"));

    // Line 2: #p B3LYP/6-31G(d) opt freq -> hover on B3LYP/6-31G(d)
    const methodHover = getGaussianHover(sampleGjf, { line: 2, character: 5 });
    assert.ok(
      methodHover && methodHover.contents.value.includes("Becke") && methodHover.contents.value.includes("Pople"),
    );

    // Line 2: hover on freq
    const freqIdx = sampleGjf.split("\n")[2]!.indexOf("freq");
    const kwHover = getGaussianHover(sampleGjf, { line: 2, character: freqIdx + 1 });
    assert.ok(kwHover && kwHover.contents.value.includes("Hessian"));

    // Line 8: H 1 rOH -> hover on rOH
    const varHover = getGaussianHover(sampleGjf, { line: 8, character: 5 });
    assert.ok(varHover && varHover.contents.value.includes("0.9572"));

    // Line 7: O -> hover on O
    const elHover = getGaussianHover(sampleGjf, { line: 7, character: 0 });
    assert.ok(elHover && elHover.contents.value.includes("Oxygen"));
  });

  it("provides contextual completions for Link0 and route lines", () => {
    const link0Items = getGaussianCompletions("%", { line: 0, character: 1 });
    assert.ok(link0Items.some((i) => i.label === "%chk="));
    assert.ok(link0Items.some((i) => i.label === "%mem="));

    const routeItems = getGaussianCompletions("#p ", { line: 0, character: 3 });
    assert.ok(routeItems.some((i) => i.label === "B3LYP"));
    assert.ok(routeItems.some((i) => i.label === "cc-pVTZ"));
    assert.ok(routeItems.some((i) => i.label === "opt"));
  });

  it("indexes Gaussian files via gaussianIndexing.canIndex and indexFile", () => {
    assert.equal(gaussianIndexing.canIndex("water.gjf", ""), true);
    assert.equal(gaussianIndexing.canIndex("water.com", ""), true);
    assert.equal(gaussianIndexing.canIndex("unknown.txt", "%chk=a.chk\n# HF/STO-3G\n"), true);
    assert.equal(gaussianIndexing.canIndex("notes.md", "hello world"), false);

    const added: Array<{ name: string; kind: string }> = [];
    let parsedModel: unknown;
    gaussianIndexing.indexFile({
      uri: "file:///water.gjf",
      text: sampleGjf,
      setParsedModel: (m: unknown) => {
        parsedModel = m;
      },
      addSymbol: (name: string, kind: string) => {
        added.push({ name, kind });
        return added.length;
      },
    } as Parameters<typeof gaussianIndexing.indexFile>[0]);

    assert.ok(parsedModel);
    assert.ok(added.some((s) => s.name === "Water Opt Freq" && s.kind === "Package"));
    assert.ok(added.some((s) => s.name === "O1" && s.kind === "Component"));
    assert.ok(added.some((s) => s.name === "rOH" && s.kind === "Variable"));
  });
});
