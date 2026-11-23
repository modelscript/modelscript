// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ceaToCanteraYaml, ceaToModelica, ceaToRocets, parseCeaDeck, solveCeaDeck } from "../src/index.js";

const SSME_DECK = `
problem case=SSME_Proj rocket equilibrium p,bar=200 o/f=6.0 supar=77.5
reactants
  fuel=H2(L) wt%=100 t(k)=20.27
  oxid=O2(L) wt%=100 t(k)=90.17
end
`;

describe("@modelscript/cea — Polyglot Projections (Cantera YAML, Modelica, ROCETS)", () => {
  it("projects a CEA deck to Cantera YAML with phases, state, and NASA7 species polynomials", () => {
    const deck = parseCeaDeck(SSME_DECK);
    const res = solveCeaDeck(deck);
    const yaml = ceaToCanteraYaml(deck, res);

    assert.ok(yaml.includes("phases:"), "Expected phases section");
    assert.ok(yaml.includes("name: SSME_Proj"), "Expected phase name");
    assert.ok(yaml.includes("elements: [H, O]"), "Expected elements list");
    assert.ok(yaml.includes("model: NASA7"), "Expected NASA7 thermo model");
    assert.ok(yaml.includes("name: H2O"), "Expected H2O species");
  });

  it("projects a CEA rocket solution to a valid Modelica model", () => {
    const deck = parseCeaDeck(SSME_DECK);
    const res = solveCeaDeck(deck);
    const mo = ceaToModelica(deck, res);

    assert.ok(mo.includes("model SSME_Proj"), "Expected Modelica model header");
    assert.ok(mo.includes("parameter Real P_c ="), "Expected P_c parameter");
    assert.ok(mo.includes("parameter Real c_star ="), "Expected c_star parameter");
    assert.ok(mo.includes("I_sp_vac = (C_F_vac * c_star) / g0;"), "Expected Isp_vac equation");
    assert.ok(mo.includes("end SSME_Proj;"), "Expected Modelica end statement");
  });

  it("projects a CEA rocket solution to a NASA ROCETS propulsion deck", () => {
    const deck = parseCeaDeck(SSME_DECK);
    const res = solveCeaDeck(deck);
    const roc = ceaToRocets(deck, res);

    assert.ok(roc.includes("ENGINE: SSME_PROJ"), "Expected ROCETS ENGINE header");
    assert.ok(roc.includes("MCC TYPE=CHAMBER"), "Expected CHAMBER component");
    assert.ok(roc.includes("NOZ TYPE=NOZZLE"), "Expected NOZZLE component");
    assert.ok(roc.includes("MCC.out -> NOZ.in FLUID=COMBUSTION_GAS"), "Expected combustion gas connection");
  });
});
