// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { parseBngl, serializeBngl } from "../src/index.js";

const MODEL_BNGL = `
begin model SimpleSignaling
begin parameters
  k_on 0.05
  k_off 0.01
  R_tot 50.0
  L_tot 25.0
end parameters

begin compartments
  cell 3 1.0
end compartments

begin molecule types
  Ligand(r)
  Receptor(l,s~U~P)
end molecule types

begin seed species
  Ligand(r) L_tot
  Receptor(l,s~U) R_tot
end seed species

begin observables
  Molecules FreeReceptor Receptor(l)
  Molecules BoundComplex Receptor(l!1).Ligand(r!1)
  Species ActiveP Receptor(s~P)
end observables

begin reaction rules
  Binding: Ligand(r) + Receptor(l) <-> Ligand(r!1).Receptor(l!1) k_on, k_off
end reaction rules
end model

simulate({method=>"ode",t_end=>50,n_steps=>100})
`;

test("BNGL Parser: extracts model blocks, declarations, and simulation commands", () => {
  const doc = parseBngl(MODEL_BNGL, "simple_signaling.bngl");
  const m = doc.model;

  assert.equal(m.id, "SimpleSignaling");
  assert.equal(m.parameters.size, 4);
  assert.equal(m.parameters.get("k_on")?.value, 0.05);
  assert.equal(m.compartments.size, 1);
  assert.equal(m.moleculeTypes.size, 2);

  const rec = m.moleculeTypes.get("Receptor")!;
  assert.equal(rec.sites.length, 2);
  assert.equal(rec.sites[1]?.name, "s");
  assert.deepEqual(rec.sites[1]?.allowedStates, ["U", "P"]);

  assert.equal(m.seedSpecies.length, 2);
  assert.equal(m.observables.size, 3);
  assert.equal(m.reactionRules.size, 1);

  const rule = m.reactionRules.get("Binding")!;
  assert.equal(rule.reversible, true);
  assert.equal(rule.forwardRate, "k_on");
  assert.equal(rule.reverseRate, "k_off");

  assert.equal(doc.actions.length, 1);
  assert.equal(doc.actions[0]?.command, "simulate");
});

test("BNGL Parser: roundtrips AST with serializeBngl", () => {
  const doc = parseBngl(MODEL_BNGL);
  const text = serializeBngl(doc);

  assert.ok(text.includes("begin model"));
  assert.ok(text.includes("begin parameters"));
  assert.ok(text.includes("Binding:"));
  assert.ok(text.includes("simulate({"));

  const reparsed = parseBngl(text);
  assert.equal(reparsed.model.moleculeTypes.size, 2);
  assert.equal(reparsed.model.seedSpecies.length, 2);
  assert.equal(reparsed.model.reactionRules.size, 1);
});
