// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DATCOM_AIRCRAFT_TEMPLATES } from "../src/catalog/datcom-std-schemas.js";
import { datcomIndexing } from "../src/indexing.js";
import { getDatcomCompletions, getDatcomDocumentSymbols, getDatcomHover, validateDatcom } from "../src/lsp.js";

describe("DATCOM Indexing & LSP Services", () => {
  it("detects DATCOM files by extension or NAMELIST signature", () => {
    assert.strictEqual(datcomIndexing.canIndex("c172.dcm", ""), true);
    assert.strictEqual(datcomIndexing.canIndex("aircraft.datcom", ""), true);
    assert.strictEqual(datcomIndexing.canIndex("deck.inp", " $FLTCON NMACH=1.0$"), true);
    assert.strictEqual(datcomIndexing.canIndex("readme.txt", "hello world"), false);
  });

  it("validates decks and reports diagnostics with ranges and codes", () => {
    const clean = validateDatcom(DATCOM_AIRCRAFT_TEMPLATES.CESSNA_172);
    assert.strictEqual(clean.filter((d) => d.severity === 1).length, 0);

    const broken = validateDatcom(" $UNKNOWN X=1.0$\n");
    assert.ok(broken.some((d) => d.code === "DAT2001" && d.source === "modelscript-datcom"));
    assert.ok(broken.some((d) => d.code === "DAT3001"));
    assert.ok(broken.some((d) => d.code === "DAT3002"));
  });

  it("extracts hierarchical document symbols for cases, NAMELISTs, and NACA cards", () => {
    const symbols = getDatcomDocumentSymbols(DATCOM_AIRCRAFT_TEMPLATES.CESSNA_172);
    assert.strictEqual(symbols.length, 1);
    const root = symbols[0]!;
    assert.strictEqual(root.name, "CESSNA 172 CLASS TRAINER");
    assert.ok(root.children && root.children.some((ch) => ch.name === "$FLTCON"));
    assert.ok(root.children && root.children.some((ch) => ch.name === "$WGPLNF"));
    assert.ok(root.children && root.children.some((ch) => ch.name === "NACA-W-4-2412"));
  });

  it("provides hover documentation and completions for NAMELISTs, parameters, and NACA cards", () => {
    const src = DATCOM_AIRCRAFT_TEMPLATES.CESSNA_172;
    const lines = src.split("\n");
    const fltLine = lines.findIndex((l) => l.includes("$FLTCON"));
    const fltCol = lines[fltLine]!.indexOf("$FLTCON") + 2;

    const hoverNl = getDatcomHover(src, { line: fltLine, character: fltCol });
    assert.ok(hoverNl && hoverNl.contents.value.includes("$FLTCON"));

    const nacaLine = lines.findIndex((l) => l.includes("NACA-W-4-2412"));
    const hoverNaca = getDatcomHover(src, { line: nacaLine, character: 4 });
    assert.ok(hoverNaca && hoverNaca.contents.value.includes("NACA 2412"));

    const completions = getDatcomCompletions("WG");
    assert.ok(completions.some((c) => c.label === "$WGPLNF"));
    assert.ok(completions.some((c) => c.label === "$WGSCHR"));
  });
});
