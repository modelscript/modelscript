// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lowerAsmToDae } from "../src/dae/asm-to-dae.js";
import { parseAsmPlant } from "../src/parser/asm-parser.js";

describe("IWA ASM Domain Lowering to Linear-Memory DAE Arena", () => {
  const bsm1PlantText = `plant BSM1_Plant {
  model: ASM1;
  influent {
    flow: 18446.0 m3/day;
    S_S: 69.5;
    S_NH: 31.56;
    X_BH: 28.17;
  }
  recycle {
    internal_ratio: 3.0;
    sludge_ratio: 1.0;
    waste_flow: 385.0 m3/day;
  }
  bioreactor TANK1 {
    type: Anoxic;
    volume: 1000.0 m3;
  }
  bioreactor TANK2 {
    type: Aerobic;
    volume: 1333.0 m3;
    kla: 240.0;
  }
  clarifier CLARIFIER1 {
    area: 1500.0 m2;
    depth: 4.0 m;
    layers: 10;
    feed_layer: 5;
  }
}`;

  it("should compile plant CSTRs and clarifiers into DAE arena variables and equations", () => {
    const plant = parseAsmPlant(bsm1PlantText);
    const dae = lowerAsmToDae(plant);

    // Variables breakdown:
    // 1 time var ('time')
    // 4 plant flow vars ('Q_in', 'Q_was', 'Q_ras', 'Q_intr')
    // 2 reactor volume vars ('TANK1_Volume', 'TANK2_Volume')
    // For 2 reactors: 2 * 13 components * 2 (state + der) = 52 variables
    // For 1 clarifier: 13 components * 2 (eff + ras) = 26 variables
    // Total = 1 + 4 + 2 + 52 + 26 = 85 variables
    assert.equal(dae.varCount, 85, "Expected 85 DAE variables for flows, reactors, and clarifier");

    // Equations breakdown:
    // 2 reactors * 13 components = 26 differential equations
    // 1 clarifier * 26 components (eff + ras) = 26 algebraic equations
    // Total = 26 + 26 = 52 equations
    assert.equal(dae.eqCount, 52, "Expected 52 DAE equations for mass balances and clarifier outputs");
  });

  it("should handle single tank plant without crashing", () => {
    const singleTankText = `plant Single_CSTR {
  model: ASM1;
  influent { flow: 1000.0 m3/day; }
  bioreactor AERATION {
    type: Aerobic;
    volume: 500.0 m3;
    kla: 100.0;
  }
}`;
    const plant = parseAsmPlant(singleTankText);
    const dae = lowerAsmToDae(plant);

    // 1 time + 4 flows + 1 volume + 26 (13 state + 13 der) = 32 vars
    assert.equal(dae.varCount, 32);
    // 13 equations
    assert.equal(dae.eqCount, 13);
  });
});
