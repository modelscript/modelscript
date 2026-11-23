// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CANONICAL_CIF_TEMPLATES } from "../src/catalog/iucr-cif-std-schemas.js";
import { renderIucrCifSvg } from "../src/diagram/index.js";
import { iucrCifIndexing } from "../src/indexing.js";
import { getIucrCifCompletions, getIucrCifDocumentSymbols, getIucrCifHover, validateIucrCif } from "../src/lsp.js";
import { IucrCifPanel } from "../src/ui/IucrCifPanel.js";

describe("IUCr CIF Indexing, LSP, SVG Visualization & React UI Panel", () => {
  it("indexes CIF documents via iucrCifIndexing", () => {
    assert.equal(iucrCifIndexing.canIndex("silicon.cif", ""), true);
    assert.equal(iucrCifIndexing.canIndex("model.star", ""), true);
    assert.equal(iucrCifIndexing.canIndex("unknown.txt", CANONICAL_CIF_TEMPLATES.silicon), true);

    const added: Array<{ name: string; kind: string }> = [];
    iucrCifIndexing.indexFile({
      uri: "silicon.cif",
      text: CANONICAL_CIF_TEMPLATES.silicon,
      setParsedModel: () => {},
      addSymbol: (name: string, kind: string) => {
        added.push({ name, kind });
        return added.length;
      },
    } as never);

    assert.ok(added.some((s) => s.name === "data_silicon_fd3m" && s.kind === "Package"));
    assert.ok(added.some((s) => s.name.includes("Si1") && s.kind === "Class"));
  });

  it("provides LSP diagnostics, document symbols, hover, and completions", () => {
    const src = CANONICAL_CIF_TEMPLATES.silicon;
    assert.equal(validateIucrCif(src).length, 0);

    const symbols = getIucrCifDocumentSymbols(src);
    assert.equal(symbols.length, 1);
    assert.equal(symbols[0]!.name, "data_silicon_fd3m");
    assert.ok((symbols[0]!.children?.length ?? 0) > 5);

    // Hover on _cell_length_a
    const lines = src.split("\n");
    const cellLine = lines.findIndex((l) => l.startsWith("_cell_length_a"));
    const hover = getIucrCifHover(src, { line: cellLine, character: 4 });
    assert.ok(hover);
    assert.ok(hover.contents.value.includes("_cell_length_a"));

    // Hover on data_silicon_fd3m
    const dataLine = lines.findIndex((l) => l.startsWith("data_"));
    const blockHover = getIucrCifHover(src, { line: dataLine, character: 6 });
    assert.ok(blockHover);
    assert.ok(blockHover.contents.value.includes("Unit Cell Volume"));

    // Completions
    const comps = getIucrCifCompletions("_cell_", { line: 0, character: 6 });
    assert.ok(comps.some((c) => c.label === "_cell_length_a"));
    assert.ok(comps.some((c) => c.label === "_cell_angle_alpha"));
  });

  it("renders pure SVG crystal lattice + powder XRD views and exports IucrCifPanel", () => {
    const combinedSvg = renderIucrCifSvg(CANONICAL_CIF_TEMPLATES.silicon, { view: "combined" });
    assert.ok(combinedSvg.startsWith("<svg"));
    assert.ok(combinedSvg.includes("Unit Cell Lattice"));
    assert.ok(combinedSvg.includes("Simulated Powder XRD Pattern"));
    assert.ok(combinedSvg.includes("(111)"));

    const latticeSvg = renderIucrCifSvg(CANONICAL_CIF_TEMPLATES.quartz, {
      view: "lattice",
      azimuthDeg: 45,
      elevationDeg: 30,
      colorMode: "light",
    });
    assert.ok(latticeSvg.startsWith("<svg"));
    assert.ok(latticeSvg.includes("alpha_quartz"));

    const xrdSvg = renderIucrCifSvg(CANONICAL_CIF_TEMPLATES.nacl, { view: "xrd" });
    assert.ok(xrdSvg.startsWith("<svg"));
    assert.ok(xrdSvg.includes("<polyline"));

    assert.equal(typeof IucrCifPanel, "function");
  });
});
