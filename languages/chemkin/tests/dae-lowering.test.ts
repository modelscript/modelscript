// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lowerChemkinToDae, parseChemkin } from "../src/index.js";

const H2_FALLOFF_DECK = `
ELEMENTS H O N END
SPECIES H2 O2 H2O OH H O HO2 N2 END
REACTIONS CAL/MOLE MOLES
  H + O2 <=> O + OH             1.915E+14  0.00  16440.0
  H + OH + M <=> H2O + M        2.200E+22 -2.00      0.0
    H2/2.5/ H2O/12.0/
  H + O2 (+M) <=> HO2 (+M)      1.475E+12  0.60      0.0
    LOW / 6.366E+20 -1.72 525.0 /
    TROE / 0.5 1.0E-30 1.0E+30 1.0E+100 /
    H2/2.0/ H2O/11.0/
END
`;

describe("@modelscript/chemkin — Direct Linear-Memory DAE Lowering", () => {
  it("lowers elementary, three-body, and Troe falloff kinetics into DAEBuilder (constant-pressure)", () => {
    const doc = parseChemkin(H2_FALLOFF_DECK, "h2_falloff.inp");
    const dae = lowerChemkinToDae(doc, {
      mode: "constant-pressure",
      temperature: 1200.0,
      pressure: 101325.0,
      massFractions: { H2: 0.0285, O2: 0.2264, N2: 0.7451 },
    });

    assert.ok(dae.getVarCount() > 35, `Expected >35 DAE variables, got ${dae.getVarCount()}`);
    assert.ok(dae.getEqCount() > 30, `Expected >30 DAE equations, got ${dae.getEqCount()}`);

    const varNames = new Set<string>();
    for (let i = 0; i < dae.getVarCount(); i++) {
      varNames.add(dae.getVarName(i));
    }

    // Core thermo states & parameters
    for (const req of ["R_gas", "T", "P", "rho"]) {
      assert.ok(varNames.has(req), `Missing core variable '${req}'`);
    }

    // Species variables: W_k, Y_k, C_k, omega_k
    for (const sp of ["H2", "O2", "H2O", "OH", "H", "O", "HO2", "N2"]) {
      assert.ok(varNames.has(`W_${sp}`), `Missing W_${sp}`);
      assert.ok(varNames.has(`Y_${sp}`), `Missing Y_${sp}`);
      assert.ok(varNames.has(`C_${sp}`), `Missing C_${sp}`);
      assert.ok(varNames.has(`omega_${sp}`), `Missing omega_${sp}`);
    }

    // Reaction rates, reverse rates, falloff Pr & Fcent
    for (const r of ["R1", "R2", "R3"]) {
      assert.ok(varNames.has(`kf_${r}`), `Missing kf_${r}`);
      assert.ok(varNames.has(`kr_${r}`), `Missing kr_${r}`);
      assert.ok(varNames.has(`q_${r}`), `Missing q_${r}`);
    }
    assert.ok(varNames.has("Pr_R3"), "Missing reduced pressure Pr_R3 for falloff reaction");
    assert.ok(varNames.has("Fcent_R3"), "Missing Troe Fcent_R3 for falloff reaction");
  });

  it("lowers constant-volume mode with continuous pressure P and parameter density rho", () => {
    const doc = parseChemkin(H2_FALLOFF_DECK, "h2_const_v.inp");
    const dae = lowerChemkinToDae(doc, {
      mode: "constant-volume",
      temperature: 1100.0,
      pressure: 202650.0,
    });

    assert.ok(dae.getVarCount() > 35);
    assert.ok(dae.getEqCount() > 30);
  });
});
