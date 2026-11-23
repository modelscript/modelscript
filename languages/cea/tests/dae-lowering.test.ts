// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lowerCeaToDae, parseCeaDeck, solveCeaDeck } from "../src/index.js";

describe("@modelscript/cea — Direct Linear-Memory DAE Arena Lowering", () => {
  it("lowers an SSME LOX/LH2 rocket deck into DAEBuilder with equilibrium & nozzle equations", () => {
    const src = `
problem case=SSME_DAE rocket equilibrium p,bar=200 o/f=6.0 supar=77.5
reactants
  fuel=H2(L) wt%=100 t(k)=20.27
  oxid=O2(L) wt%=100 t(k)=90.17
end
`;
    const deck = parseCeaDeck(src);
    const res = solveCeaDeck(deck);
    const dae = lowerCeaToDae(deck, { solveResult: res });

    const vars = dae.variables();
    const eqs = dae.equations();
    assert.ok(vars.length > 15, `Expected >15 variables, got ${vars.length}`);
    assert.ok(eqs.length > 15, `Expected >15 equations, got ${eqs.length}`);

    // Core equilibrium & rocket nozzle variables
    for (const expected of [
      "P_c",
      "T_c",
      "M_w",
      "rho_c",
      "gamma",
      "n_total",
      "b_H",
      "b_O",
      "c_star",
      "C_F",
      "C_F_vac",
      "I_sp_vac",
      "I_sp_sl",
      "X_H2O",
      "n_H2O",
    ]) {
      assert.notEqual(dae.lookupVariable(expected), -1, `Expected DAE variable '${expected}'`);
    }
  });

  it("lowers an HP combustion deck without rocket nozzle variables", () => {
    const src = `
problem case=CH4_Flame hp p,bar=1.0
reactants
  fuel=CH4 wt%=100 t(k)=298.15
  oxid=O2 wt%=100 t(k)=298.15
end
`;
    const deck = parseCeaDeck(src);
    const dae = lowerCeaToDae(deck);

    assert.ok(dae.variables().length > 10, `Expected >10 variables, got ${dae.variables().length}`);
    assert.ok(dae.equations().length > 10, `Expected >10 equations, got ${dae.equations().length}`);
    assert.notEqual(dae.lookupVariable("b_C"), -1, "Expected carbon element balance parameter b_C");
    assert.notEqual(dae.lookupVariable("b_H"), -1, "Expected hydrogen element balance parameter b_H");
    assert.notEqual(dae.lookupVariable("b_O"), -1, "Expected oxygen element balance parameter b_O");
    assert.equal(dae.lookupVariable("I_sp_vac"), -1, "HP problem should not emit rocket I_sp_vac");
  });
});
