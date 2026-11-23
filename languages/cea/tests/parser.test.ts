// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseCeaDeck } from "../src/index.js";

describe("@modelscript/cea — Structured NASA CEA Deck Parser", () => {
  it("parses an SSME-class LOX/LH2 rocket problem deck with comments and units", () => {
    const src = `
# SSME-class LOX/LH2 rocket deck
! NASA RP-1311 reference example
problem case=SSME_LOX_LH2 rocket equilibrium
  p,bar=200 o/f=6.0 supar=77.5
reactants
  fuel=H2(L) wt%=100 t(k)=20.27
  oxid=O2(L) wt%=100 t(k)=90.17
output siunits short trace=1e-5
end
`;
    const deck = parseCeaDeck(src);
    assert.equal(deck.name, "SSME_LOX_LH2");
    assert.equal(deck.hasProblem, true);
    assert.equal(deck.hasReactants, true);
    assert.equal(deck.hasEnd, true);
    assert.equal(deck.parseErrors.length, 0);
    assert.equal(deck.problem.problemType, "rocket");
    assert.equal(deck.problem.equilibrium, true);
    assert.deepEqual(deck.problem.pressuresBar, [200]);
    assert.deepEqual(deck.problem.ofRatios, [6.0]);
    assert.deepEqual(deck.problem.supar, [77.5]);
    assert.equal(deck.reactants.length, 2);
    assert.equal(deck.reactants[0]!.role, "fuel");
    assert.equal(deck.reactants[0]!.name, "H2(L)");
    assert.equal(deck.reactants[0]!.wtPercent, 100);
    assert.equal(deck.reactants[0]!.temperatureK, 20.27);
    assert.equal(deck.reactants[1]!.role, "oxid");
    assert.equal(deck.reactants[1]!.name, "O2(L)");
    assert.equal(deck.output.siunits, true);
    assert.equal(deck.output.short, true);
    assert.equal(deck.output.trace, 1e-5);
    assert.equal(deck.comments.length, 2);
  });

  it("converts pressure units (atm, psia) and parses only/omit/insert and multiple values", () => {
    const src = `
problem tp frozen p,atm=1,10 t,k=3000 phi=1.0 pi/pe=10,50 subar=2.0
reactants
  fuel=CH4 moles=1 t(k)=298.15
  oxid=O2 moles=2 t(k)=298.15
only H2O CO2 CO H2 O2 OH H O
omit NO
insert N2
output calories
end
`;
    const deck = parseCeaDeck(src);
    assert.equal(deck.problem.problemType, "tp");
    assert.equal(deck.problem.frozen, true);
    assert.equal(deck.problem.pressuresBar.length, 2);
    assert.ok(Math.abs(deck.problem.pressuresBar[0]! - 1.01325) < 1e-6);
    assert.ok(Math.abs(deck.problem.pressuresBar[1]! - 10.1325) < 1e-5);
    assert.deepEqual(deck.problem.temperaturesK, [3000]);
    assert.deepEqual(deck.problem.phiRatios, [1.0]);
    assert.deepEqual(deck.problem.piPeRatios, [10, 50]);
    assert.deepEqual(deck.problem.subar, [2.0]);
    assert.equal(deck.only.length, 8);
    assert.deepEqual(deck.omit, ["NO"]);
    assert.deepEqual(deck.insert, ["N2"]);
    assert.equal(deck.output.calories, true);
  });

  it("parses psia pressure, explicit enthalpy h,kj/mol, and inline chemical formula", () => {
    const src = `
problem hp p,psia=1000 o/f=2.56
reactants
  fuel=RP-1 wt%=100 t(k)=298.15 h,kj/mol=-24.718 C 1 H 1.9423
  oxid=O2(L) wt%=100 t(k)=90.17
end
`;
    const deck = parseCeaDeck(src);
    assert.equal(deck.parseErrors.length, 0);
    assert.ok(Math.abs(deck.problem.pressuresBar[0]! - 68.94757) < 1e-3);
    assert.equal(deck.reactants[0]!.enthalpyKjMol, -24.718);
    assert.deepEqual(deck.reactants[0]!.formula, { C: 1, H: 1.9423 });
  });
});
