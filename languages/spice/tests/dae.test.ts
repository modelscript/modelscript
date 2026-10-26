// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import { lowerSpiceToDae, parseSpice } from "../src/index.js";

describe("SPICE DAE Arena Lowering (@modelscript/spice)", () => {
  it("should lower circuit variables, constitutive equations, and KCL into linear DAEBuilder", () => {
    const netlist = `* RLC Tank Circuit
V1 in 0 DC 10
R1 in n1 1k
C1 n1 0 100n
L1 n1 0 10u
.END`;
    const circuit = parseSpice(netlist);
    const arena = lowerSpiceToDae(circuit, "RlcTank");

    assert.ok(arena, "DAEBuilder should be created");
    assert.strictEqual(arena.interner.resolve(arena.nameId), "RlcTank");

    // Check variables: v_0, v_in, v_n1, i_V1, i_R1, i_C1, i_L1
    assert.ok(arena.varCount >= 7, `Expected at least 7 variables, got ${arena.varCount}`);

    // Check equations:
    // 1 for ground (v_0 = 0)
    // 4 constitutive equations (V1, R1, C1, L1)
    // 2 KCL equations (for node in, node n1)
    assert.ok(arena.eqCount >= 6, `Expected at least 6 equations, got ${arena.eqCount}`);
  });
});
