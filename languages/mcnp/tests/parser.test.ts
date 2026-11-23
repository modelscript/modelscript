// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractCsgCellRefs, extractCsgSurfaceRefs, parseCsgExpression, parseMcnpDeck } from "../src/parser/index.js";

describe("MCNP 3-Block Deck & CSG Parser", () => {
  it("parses a full 3-block MCNP criticality deck with comments and continuations", () => {
    const deckText = `Godiva Bare U-235 Criticality Sphere
C Block 1: Cell Cards
1 1 -18.74 -1 IMP:N=1 VOL=2797.5 $ U-235 core
2 0         1 IMP:N=0            $ Graveyard

C Block 2: Surface Cards
1 SO 8.741 $ Outer sphere radius (cm)

C Block 3: Data Cards
MODE N
M1 92235.80c 0.9473 &
     92238.80c 0.0527
MT1 lwtr.01t
KCODE 2000 1.0 10 50
KSRC 0.0 0.0 0.0
F4:N 1
E4 0.1 1.0 14.0
PHYS:N 20.0 0.0
`;
    const deck = parseMcnpDeck(deckText);
    assert.strictEqual(deck.title, "Godiva Bare U-235 Criticality Sphere");
    assert.strictEqual(deck.parseErrors.length, 0);
    assert.strictEqual(deck.cells.size, 2);
    assert.strictEqual(deck.surfaces.size, 1);
    assert.strictEqual(deck.materials.size, 1);
    assert.strictEqual(deck.tallies.size, 1);

    const cell1 = deck.cells.get(1)!;
    assert.strictEqual(cell1.materialId, 1);
    assert.strictEqual(cell1.density, -18.74);
    assert.strictEqual(cell1.imp["N"], 1);
    assert.strictEqual(cell1.vol, 2797.5);

    const cell2 = deck.cells.get(2)!;
    assert.strictEqual(cell2.materialId, 0);
    assert.strictEqual(cell2.imp["N"], 0);

    const surf1 = deck.surfaces.get(1)!;
    assert.strictEqual(surf1.type, "SO");
    assert.deepStrictEqual(surf1.params, [8.741]);

    const mat1 = deck.materials.get(1)!;
    assert.strictEqual(mat1.isotopes.length, 2);
    assert.strictEqual(mat1.isotopes[0]!.zaid, "92235.80c");
    assert.strictEqual(mat1.isotopes[0]!.zaidNum, 92235);
    assert.strictEqual(mat1.thermalLaw, "lwtr.01t");

    assert.deepStrictEqual(deck.mode, ["N"]);
    assert.strictEqual(deck.source.kcode?.nsrck, 2000);
    assert.strictEqual(deck.source.kcode?.kct, 50);
    assert.deepStrictEqual(deck.source.ksrc, [[0, 0, 0]]);

    const f4 = deck.tallies.get(4)!;
    assert.strictEqual(f4.type, 4);
    assert.deepStrictEqual(f4.targets, [1]);
    assert.deepStrictEqual(f4.energyBins, [0.1, 1.0, 14.0]);
    assert.strictEqual(deck.phys.length, 1);
  });

  it("parses CSG Boolean precedence (: union, space intersection, # complement, parentheses)", () => {
    const expr = parseCsgExpression("-1 2 : (-3 #4) : #(5 -6)");
    assert.strictEqual(expr.kind, "union");
    assert.strictEqual(expr.operands.length, 3);
    assert.strictEqual(expr.operands[0]!.kind, "intersection");
    assert.strictEqual(expr.operands[1]!.kind, "intersection");
    assert.strictEqual(expr.operands[2]!.kind, "complement");

    const surfRefs = extractCsgSurfaceRefs(expr).sort((a, b) => a - b);
    assert.deepStrictEqual(surfRefs, [1, 2, 3, 5, 6]);
    assert.deepStrictEqual(extractCsgCellRefs(expr), [4]);
  });

  it("parses all MCNP surface mnemonics and fixed-source SDEF/NPS/F1/F2/F5/F6/F8 cards", () => {
    const deckText = `Multi-Surface Shielding Deck
1 1 -7.87 -1 2 -3 IMP:N=1 U=1 FILL=2
2 0 1:-2:3 IMP:N=0

*1 PX 10.0
2 PX 0.0
3 RPP -5 5 -5 5 0 10
4 RCC 0 0 0 0 0 10 3.0
5 SPH 1 2 3 4.5
6 C/Z 0 0 2.5
7 K/Z 0 0 0 0.25
8 GQ 1 1 1 0 0 0 0 0 0 -9

MODE N P
M1 26056.80c 1.0
SDEF POS=0 0 0 VEC=1 0 0 DIR=1 ERG=2.0 PAR=N
F1:N 1
F2:N 1
F5:N 15 0 0 0.5
F6:N 1
F8:P 1
NPS 5000
`;
    const deck = parseMcnpDeck(deckText);
    assert.strictEqual(deck.parseErrors.length, 0);
    assert.strictEqual(deck.surfaces.get(1)?.boundary, "*");
    assert.strictEqual(deck.surfaces.get(3)?.type, "RPP");
    assert.strictEqual(deck.surfaces.get(4)?.type, "RCC");
    assert.strictEqual(deck.surfaces.get(5)?.type, "SPH");
    assert.strictEqual(deck.surfaces.get(6)?.type, "C/Z");
    assert.strictEqual(deck.surfaces.get(7)?.type, "K/Z");
    assert.strictEqual(deck.surfaces.get(8)?.type, "GQ");

    const cell1 = deck.cells.get(1)!;
    assert.strictEqual(cell1.u, 1);
    assert.strictEqual(cell1.fill, 2);

    assert.deepStrictEqual(deck.source.sdef?.pos, [0, 0, 0]);
    assert.deepStrictEqual(deck.source.sdef?.vec, [1, 0, 0]);
    assert.strictEqual(deck.source.sdef?.dir, 1);
    assert.strictEqual(deck.source.sdef?.erg, 2.0);
    assert.strictEqual(deck.nps, 5000);
    assert.strictEqual(deck.tallies.get(5)?.point?.[0], 15);
  });
});
