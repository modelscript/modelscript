// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lsdynaToDae } from "../src/dae/index.js";
import { parseLsDynaDeck } from "../src/parser/index.js";

const BAR_DECK = `*KEYWORD
*TITLE
TwoElementBar
*NODE
1, 0.0, 0.0, 0.0
2, 0.5, 0.0, 0.0
3, 1.0, 0.0, 0.0
*ELEMENT_BEAM
1, 1, 1, 2
2, 1, 2, 3
*PART
SteelBar
1, 1, 1
*SECTION_BEAM
1, 3, 1.0
0.001
*MAT_ELASTIC
1, 7850.0, 2.1e11, 0.3
*BOUNDARY_SPC_NODE
1, 0, 1, 1, 1, 1, 1, 1
*INITIAL_VELOCITY
0, 0, 0
2.0, 0.0, 0.0
*CONTROL_TERMINATION
0.005
*END
`;

describe("@modelscript/lsdyna — Structural Dynamics DAE Lowering", () => {
  it("lowers M*u'' + K*u = F into linear-memory DAEBuilder with parameters, states, and energy outputs", () => {
    const deck = parseLsDynaDeck(BAR_DECK);
    const dae = lsdynaToDae(deck);

    assert.equal(dae.name, "TwoElementBar");

    const varNames = new Set<string>();
    for (let i = 0; i < dae.varCount; i++) {
      varNames.add(dae.getVarName(i));
    }

    assert.ok(varNames.has("cflTimestep"), "Expected cflTimestep parameter");
    assert.ok(varNames.has("maxWaveSpeed"), "Expected maxWaveSpeed parameter");
    assert.ok(varNames.has("endTime"), "Expected endTime parameter");
    assert.ok(varNames.has("u_1_x") && varNames.has("v_1_x"), "Expected node 1 state variables");
    assert.ok(varNames.has("u_2_x") && varNames.has("v_2_x"), "Expected node 2 state variables");
    assert.ok(varNames.has("u_3_x") && varNames.has("v_3_x"), "Expected node 3 state variables");
    assert.ok(varNames.has("KineticEnergy"), "Expected KineticEnergy output");
    assert.ok(varNames.has("InternalEnergy"), "Expected InternalEnergy output");
    assert.ok(varNames.has("TotalEnergy"), "Expected TotalEnergy output");

    // 3 nodes * 2 equations (u, v) + 3 energy equations = 9 equations
    assert.equal(dae.eqCount, 9, `Expected 9 equations, got ${dae.eqCount}`);
  });
});
