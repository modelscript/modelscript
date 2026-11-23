// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sindaToDae } from "../src/index.js";

describe("@modelscript/sinda — Linear-Memory DAE Lowering", () => {
  it("lowers diffusion, arithmetic, boundary nodes, linear & radiation conductors directly to DAEBuilder", () => {
    const deck = `
HEADER OPTIONS DATA
  TITLE = "Spacecraft Thermal RC+Rad Network"
HEADER NODE DATA
  1, 320.0, 450.0
  2, 300.0, 0.0
  -3, 4.0, 0.0
HEADER CONDUCTOR DATA
  10, 1, 2, 4.0
  -20, 2, 3, 0.75
HEADER SOURCE DATA
  1, 80.0
END OF DATA
`;

    const { dae, lowering } = sindaToDae(deck);

    // 1 diffusion state node, 1 arithmetic algebraic node, 1 boundary parameter node
    assert.equal(lowering.stateVarIndices.length, 1);
    assert.equal(lowering.algebraicVarIndices.length, 1);
    assert.equal(lowering.boundaryVarIndices.length, 1);

    // 1 ODE for node 1 + 1 algebraic equation for node 2 = 2 equations (square system)
    assert.equal(lowering.equationCount, 2);
    assert.equal(dae.getEquations().length, 2);
    assert.equal(dae.getVariables().length, 3);

    assert.ok(dae.lookupVariable("T_1") >= 0);
    assert.ok(dae.lookupVariable("T_2") >= 0);
    assert.ok(dae.lookupVariable("T_3") >= 0);
  });
});
