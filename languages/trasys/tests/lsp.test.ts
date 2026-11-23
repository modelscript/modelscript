// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { trasysIndexing } from "../src/indexing.js";
import { executeTrasysAction, getTrasysDocumentSymbols, getTrasysHover, validateTrasys } from "../src/lsp.js";

const SAMPLE_TRASYS = `HEADER OPTIONS DATA
  MODEL = SmallSatRad
HEADER SURFACE DATA
  S RAD1 DISK R=0.5 NODE=10 PROP=OPTICAL_SOLAR_REFLECTOR ACTIVE=TOP
  S BUS1 SPHERE R=0.4 NODE=20 PROP=GOLD_KAPTON ACTIVE=TOP TZ=1.2
HEADER ORBIT DATA
  PLANET = EARTH
  ALTITUDE = 450
  BETA = 20
  SOLAR = 1361
  ALBEDO = 0.30
  PLANETIR = 237
HEADER OPERATIONS DATA
  FFCAL
  RKCAL
  QCAL
END OF DATA
`;

describe("TRASYS Indexing & LSP Services", () => {
  it("identifies TRASYS files via trasysIndexing.canIndex and indexes symbols", () => {
    assert.strictEqual(trasysIndexing.canIndex("spacecraft.tra", ""), true);
    assert.strictEqual(trasysIndexing.canIndex("deck.inp", SAMPLE_TRASYS), true);
    assert.strictEqual(trasysIndexing.canIndex("other.txt", "hello world"), false);

    const added: Array<{ name: string; kind: string }> = [];
    let parsedModel: unknown;
    trasysIndexing.indexFile({
      uri: "spacecraft.tra",
      text: SAMPLE_TRASYS,
      setParsedModel: (m: unknown) => {
        parsedModel = m;
      },
      addSymbol: (name: string, kind: string) => {
        added.push({ name, kind });
        return added.length;
      },
    } as unknown as Parameters<typeof trasysIndexing.indexFile>[0]);

    assert.ok(parsedModel);
    assert.strictEqual(added[0]?.name, "SmallSatRad");
    assert.ok(added.some((s) => s.name === "RAD1 [DISK]"));
    assert.ok(added.some((s) => s.name === "BUS1 [SPHERE]"));
    assert.ok(added.some((s) => s.name.startsWith("ORBIT")));
  });

  it("validates TRASYS decks via validateTrasys and reports errors cleanly", () => {
    const cleanDiags = validateTrasys(SAMPLE_TRASYS);
    assert.strictEqual(cleanDiags.length, 0);

    const badDiags = validateTrasys(`
HEADER SURFACE DATA
  S BAD SPHERE R=-1.0 NODE=1 PROP=1.5, 0.8
`);
    assert.ok(badDiags.some((d) => d.code === "TRA3001"));
    assert.ok(badDiags.some((d) => d.code === "TRA4001"));
    assert.ok(badDiags.some((d) => d.code === "TRA1002"));
  });

  it("provides document symbols, contextual hover, and domain actions", async () => {
    const symbols = getTrasysDocumentSymbols(SAMPLE_TRASYS);
    assert.strictEqual(symbols.length, 1);
    assert.strictEqual(symbols[0]!.name, "SmallSatRad");
    assert.ok((symbols[0]!.children?.length ?? 0) >= 6); // 2 surfaces + 1 orbit + 3 ops

    const hoverSurf = getTrasysHover(SAMPLE_TRASYS, { line: 3, character: 5 });
    assert.ok(hoverSurf && hoverSurf.contents.value.includes("RAD1"));

    const hoverOrbit = getTrasysHover(SAMPLE_TRASYS, { line: 7, character: 5 });
    assert.ok(hoverOrbit && hoverOrbit.contents.value.includes("EARTH"));

    const hoverOp = getTrasysHover(SAMPLE_TRASYS, { line: 13, character: 3 });
    assert.ok(hoverOp && hoverOp.contents.value.includes("FFCAL"));

    // Domain actions
    const daeRes = (await executeTrasysAction("to_dae", { content: SAMPLE_TRASYS })) as {
      varCount: number;
      eqCount: number;
    };
    assert.strictEqual(daeRes.eqCount, 2);
    assert.ok(daeRes.varCount >= 18);

    const cadRes = (await executeTrasysAction("to_cad", { content: SAMPLE_TRASYS })) as {
      name: string;
      partCount: number;
    };
    assert.strictEqual(cadRes.partCount, 2);

    const sindaRes = (await executeTrasysAction("to_sinda", { content: SAMPLE_TRASYS })) as string;
    assert.ok(sindaRes.includes("HEADER CONDUCTOR DATA"));

    const moRes = (await executeTrasysAction("to_modelica", { content: SAMPLE_TRASYS })) as string;
    assert.ok(moRes.includes("model SmallSatRad"));
  });
});
