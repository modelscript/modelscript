// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lowerMcnpToDae } from "../src/dae/index.js";
import { parseMcnpDeck } from "../src/parser/index.js";

describe("MCNP Linear-Memory DAEBuilder Lowering", () => {
  it("lowers 6-group point-kinetics ODEs and cell flux-balance equations into DAEBuilder", () => {
    const deck = parseMcnpDeck(`Godiva Reactor DAE Lowering
1 1 -18.74 -1 IMP:N=1
2 2 -1.0 1 -2 IMP:N=1
3 0 2 IMP:N=0

1 SO 8.741
2 SO 15.0

MODE N
M1 92235.80c 1.0
M2 1001.80c 2.0 8016.80c 1.0
KCODE 1000 1.0 10 50
KSRC 0 0 0
`);

    const dae = lowerMcnpToDae(deck, { promptGenerationTime: 1e-5, initialReactivity: 0.001 });

    // 8 point-kinetics vars (reactor_power, reactivity, C_1..C_6) + 2 non-graveyard cell flux vars = 10
    assert.strictEqual(dae.varCount, 10);
    // 8 point-kinetics equations + 2 cell flux-balance equations = 10
    assert.strictEqual(dae.eqCount, 10);
  });
});
