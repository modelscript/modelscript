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
    assert.strictEqual(arena.varCount, 7, `Expected 7 variables, got ${arena.varCount}`);
    assert.strictEqual(arena.eqCount, 7, `Expected 7 equations, got ${arena.eqCount}`);
    assert.strictEqual(arena.varCount, arena.eqCount, "DAE system must be structurally square");
  });

  it("should lower non-linear semiconductor devices (D, Q, M) into a structurally square DAE system", () => {
    const netlist = `* Nonlinear Semiconductor Stage
VCC vcc 0 DC 5
VIN in 0 DC 2.5
D1 in n_base DMOD
Q1 n_col n_base 0 QMOD
R_COL vcc n_col 2k
M1 n_drain n_col 0 0 MMOD W=20u L=1u
R_DRAIN vcc n_drain 1k
.MODEL DMOD D (IS=1e-14 N=1.0)
.MODEL QMOD NPN (IS=1e-15 BF=100 BR=1)
.MODEL MMOD NMOS (VTO=0.7 KP=1e-4)
.END`;
    const circuit = parseSpice(netlist);
    const arena = lowerSpiceToDae(circuit, "NonlinearStage");

    assert.strictEqual(
      arena.varCount,
      arena.eqCount,
      `Expected structurally square DAE (varCount=${arena.varCount} === eqCount=${arena.eqCount})`,
    );
    assert.ok(arena.varCount >= 12);
  });
});
