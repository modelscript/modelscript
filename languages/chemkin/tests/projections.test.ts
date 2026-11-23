// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { chemkinToCanteraYaml, chemkinToModelica, parseChemkin } from "../src/index.js";

const PROJECTION_DECK = `
ELEMENTS H O N END
SPECIES H2 O2 H2O OH H O HO2 N2 END
REACTIONS KCAL/MOLE MOLES
  H + O2 <=> O + OH             1.915E+14   0.00   16.44
  H + OH + M <=> H2O + M        2.200E+22  -2.00    0.00
    H2/2.5/ H2O/12.0/
  H + O2 (+M) <=> HO2 (+M)      1.475E+12   0.60    0.00
    LOW / 6.366E+20 -1.72 0.525 /
    TROE / 0.5 1.0E-30 1.0E+30 1.0E+100 /
    H2/2.0/ H2O/11.0/
  HO2 + HO2 <=> H2O + O2        1.300E+11   0.00   -1.63
    DUPLICATE
END
`;

describe("@modelscript/chemkin — Projections to Cantera YAML & Modelica", () => {
  it("projects CHEMKIN deck to Cantera YAML with NASA7 thermo, three-body, Troe falloff, and duplicate flags", () => {
    const doc = parseChemkin(PROJECTION_DECK, "h2_mech.inp");
    const yaml = chemkinToCanteraYaml(doc);

    assert.ok(yaml.includes("activation-energy: kcal/mol"), "Should map KCAL/MOLE unit");
    assert.ok(yaml.includes("phases:"), "Should emit phases block");
    assert.ok(yaml.includes("thermo: ideal-gas"), "Should emit ideal-gas thermo");
    assert.ok(yaml.includes("model: NASA7"), "Should emit NASA7 thermo blocks");
    assert.ok(yaml.includes("type: three-body"), "Should emit three-body reaction type");
    assert.ok(yaml.includes("type: falloff"), "Should emit falloff reaction type");
    assert.ok(yaml.includes("high-P-rate-constant:"), "Should emit high-P-rate-constant");
    assert.ok(yaml.includes("low-P-rate-constant:"), "Should emit low-P-rate-constant");
    assert.ok(yaml.includes("Troe:"), "Should emit Troe parameters");
    assert.ok(yaml.includes("efficiencies:"), "Should emit third-body efficiencies");
    assert.ok(yaml.includes("duplicate: true"), "Should emit duplicate flag");
  });

  it("projects CHEMKIN deck to a standalone Modelica 0D reactor model", () => {
    const doc = parseChemkin(PROJECTION_DECK, "h2_mech.inp");
    const mo = chemkinToModelica(doc, {
      modelName: "H2CombustionReactor",
      mode: "constant-pressure",
      temperature: 1200,
    });

    assert.ok(mo.includes("model H2CombustionReactor"), "Should declare Modelica model");
    assert.ok(mo.includes("constant Real R_gas ="), "Should declare R_gas");
    assert.ok(mo.includes("Real Y_H2("), "Should declare species mass fraction Y_H2");
    assert.ok(mo.includes("der(Y_H2) = omega_H2 * W_H2 / rho;"), "Should emit mass fraction ODE");
    assert.ok(mo.includes("der(T) ="), "Should emit adiabatic energy ODE");
    assert.ok(mo.includes("end H2CombustionReactor;"), "Should close Modelica model");
  });
});
