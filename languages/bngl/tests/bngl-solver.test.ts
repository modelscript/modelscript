// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { generateBnglNetwork, parseBngl, solveBngl } from "../src/index.js";

const SIMPLE_ENZYMATIC_BNGL = `
begin model SimpleEnzyme
begin parameters
  E0 10.0
  S0 100.0
  k_f 0.1
  k_r 0.05
  k_cat 0.2
end parameters

begin compartments
  vol 3 1.0
end compartments

begin molecule types
  E(s)
  S(e)
  P()
end molecule types

begin seed species
  E(s) E0
  S(e) S0
end seed species

begin observables
  Molecules FreeEnzyme E(s)
  Molecules Substrate S(e)
  Molecules Complex E(s!1).S(e!1)
  Molecules Product P()
  Molecules TotalEnzyme E()
end observables

begin reaction rules
  Bind: E(s) + S(e) <-> E(s!1).S(e!1) k_f, k_r
  Cat: E(s!1).S(e!1) -> E(s) + P() k_cat
end reaction rules
end model

simulate({method=>"ode",t_end=>50.0,n_steps=>500})
`;

test("BNGL Network Generator: expands enzyme-substrate rules into elementary reactions", () => {
  const doc = parseBngl(SIMPLE_ENZYMATIC_BNGL);
  const net = generateBnglNetwork(doc);

  // E, S, ES complex, P -> 4 species
  assert.equal(net.species.length, 4);
  assert.ok(net.reactions.length >= 3);
});

test("BNGL Solver: simulates Michaelis-Menten enzyme kinetics with conservation", () => {
  const doc = parseBngl(SIMPLE_ENZYMATIC_BNGL);
  const sim = solveBngl(doc, { duration: 50.0, timeStep: 0.1 });

  assert.equal(sim.initialObservables["FreeEnzyme"], 10.0);
  assert.equal(sim.initialObservables["Substrate"], 100.0);
  assert.equal(sim.initialObservables["Product"], 0.0);

  const finalProduct = sim.finalObservables["Product"] ?? 0;
  const finalSubstrate = sim.finalObservables["Substrate"] ?? 0;
  const finalTotalE = sim.finalObservables["TotalEnzyme"] ?? 0;

  assert.ok(finalProduct > 50.0, `Expected substantial product generation, got ${finalProduct}`);
  assert.ok(finalSubstrate < 50.0, `Expected substrate depletion, got ${finalSubstrate}`);
  assert.ok(Math.abs(finalTotalE - 10.0) < 1e-6, "Total enzyme must be conserved");
});
