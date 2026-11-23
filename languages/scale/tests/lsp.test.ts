// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { scaleIndexing } from "../src/indexing.js";
import { executeScaleAction, getScaleDocumentSymbols, getScaleHover, validateScale } from "../src/lsp.js";

const SAMPLE_DECK = `' PWR Pin Cell
=csas6
PWR Pin Cell
v7.1-252
read comp
  uo2 1 den=10.41 1.0 900.0 92235 4.0 92238 96.0 end
  h2o 2 den=0.72 1.0 580.0 end
end comp
read geom
  global unit 1
  cylinder 1 0.4096 10.0 -10.0
  cuboid 2 0.63 -0.63 0.63 -0.63 10.0 -10.0
  media 1 1 1
  media 2 1 2 -1
  boundary 2
end geom
read bounds
  all=mirror
end bounds
end
`;

describe("SCALE LSP Services & Workspace Indexing", () => {
  it("validates valid decks with zero errors and flags semantic errors with SCL codes", () => {
    const okDiags = validateScale(SAMPLE_DECK);
    assert.equal(okDiags.length, 0);

    const badDeck = `=csas6
Bad
read comp
  uo2 1 den=-5.0 1.0 900.0 end
end comp
read geom
  unit 1
  sphere 1 2.0
  media 99 1 1
end geom
end
`;
    const badCodes = validateScale(badDeck).map((d) => d.code);
    assert.ok(badCodes.includes("SCL4001"));
    assert.ok(badCodes.includes("SCL3001"));
    assert.ok(badCodes.includes("SCL3003"));
  });

  it("extracts hierarchical document symbols for compositions and KENO units", () => {
    const syms = getScaleDocumentSymbols(SAMPLE_DECK);
    assert.equal(syms.length, 1);
    const root = syms[0]!;
    assert.equal(root.name, "PWR Pin Cell");
    assert.ok((root.children?.length ?? 0) >= 3);
  });

  it("provides hover documentation for sequences, standard compositions, and KENO units", () => {
    const seqHover = getScaleHover(SAMPLE_DECK, { line: 1, character: 2 });
    assert.ok(seqHover?.contents.value.includes("=csas6"));

    const uo2Hover = getScaleHover(SAMPLE_DECK, { line: 5, character: 3 });
    assert.ok(uo2Hover?.contents.value.includes("UO2"));

    const unitHover = getScaleHover(SAMPLE_DECK, { line: 9, character: 4 });
    assert.ok(unitHover?.contents.value.includes("Global Unit"));
  });

  it("executes SCALE language actions (lint, dae, bateman, cad, modelica, mcnp)", async () => {
    const lintRes = (await executeScaleAction("lint_scale", SAMPLE_DECK)) as unknown[];
    assert.equal(lintRes.length, 0);

    const daeRes = (await executeScaleAction("scale_to_dae", SAMPLE_DECK)) as {
      variableCount: number;
      equationCount: number;
    };
    assert.ok(daeRes.variableCount > 0);
    assert.ok(daeRes.equationCount > 0);

    const mo = (await executeScaleAction("scale_to_modelica", SAMPLE_DECK)) as string;
    assert.ok(mo.includes("model "));

    const mcnp = (await executeScaleAction("scale_to_mcnp", SAMPLE_DECK)) as string;
    assert.ok(mcnp.includes("kcode "));
  });

  it("detects SCALE files in scaleIndexing.canIndex", () => {
    assert.equal(scaleIndexing.canIndex?.("fuel.scale", ""), true);
    assert.equal(scaleIndexing.canIndex?.("core.keno", ""), true);
    assert.equal(scaleIndexing.canIndex?.("deck.inp", "=csas6\nTest\n"), true);
    assert.equal(scaleIndexing.canIndex?.("readme.txt", "hello world"), false);
  });
});
