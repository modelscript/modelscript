// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import { lowerEpanetToDae } from "../src/dae/index.js";
import { parseInp } from "../src/parser/index.js";

const SIMPLE_INP = `
[RESERVOIRS]
 R1  120.0

[TANKS]
 T1  100.0  5.0  2.0  10.0  20.0  0

[JUNCTIONS]
 J1  60.0  20.0

[PIPES]
 P1  R1  J1  500  200  100  0  OPEN
 P2  J1  T1  400  150  100  0  OPEN
`;

describe("EPANET Zero-GC Linear DAE Lowering", () => {
  it("lowers water distribution networks into DAEBuilder arena", () => {
    const net = parseInp(SIMPLE_INP);
    const arena = lowerEpanetToDae(net);

    assert(arena.getVarCount() >= 5, `Expected at least 5 variables, got ${arena.getVarCount()}`);
    assert.strictEqual(arena.getVarCount(), arena.getEqCount(), "Expected structurally square DAE (N_vars == N_eqs)");

    const varNames = arena.variables().map((v) => v.name);
    assert(varNames.includes("res_R1_H"), "Must include reservoir head");
    assert(varNames.includes("tank_T1_level"), "Must include tank level state");
    assert(varNames.includes("junc_J1_H"), "Must include junction head");
    assert(varNames.includes("junc_J1_P"), "Must include junction pressure");
    assert(varNames.includes("pipe_P1_Q"), "Must include pipe flow");
  });
});
