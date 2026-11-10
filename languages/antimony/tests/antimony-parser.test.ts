// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { parseAntimony, serializeAntimony } from "../src/index.js";

const MODEL_TEXT = `
model GlycolysisToy()
  compartment cytoplasm = 1.0;
  species Glc in cytoplasm = 5.0, G6P in cytoplasm = 0.1, Pyr in cytoplasm = 0.0;
  const k_hex = 0.8, k_pkm = 0.5;

  v1: Glc => G6P; k_hex * Glc;
  v2: G6P => 2 Pyr; k_pkm * G6P;

  TotalCarbon := Glc * 6.0 + G6P * 6.0 + Pyr * 3.0;
end
`;

test("Antimony Parser: parses compartments, species, stoichiometries, and assignment rules", () => {
  const doc = parseAntimony(MODEL_TEXT, "glycolysis.ant");
  const mod = doc.mainModule;

  assert.equal(mod.id, "GlycolysisToy");
  assert.equal(mod.compartments.size, 1);
  assert.equal(mod.species.size, 3);
  assert.equal(mod.reactions.size, 2);

  const v2 = mod.reactions.get("v2");
  assert.ok(v2);
  assert.equal(v2.products[0]?.species, "Pyr");
  assert.equal(v2.products[0]?.stoichiometry, 2);

  assert.equal(mod.rules.length, 1);
  assert.equal(mod.rules[0]?.variable, "TotalCarbon");
});

test("Antimony Serializer: roundtrips AST to canonical Antimony format", () => {
  const doc = parseAntimony(MODEL_TEXT);
  const text = serializeAntimony(doc);

  assert.ok(text.includes("model GlycolysisToy()"));
  assert.ok(text.includes("compartment cytoplasm;"));
  assert.ok(text.includes("v1: Glc => G6P; k_hex * Glc;"));
  assert.ok(text.includes("v2: G6P => 2 Pyr; k_pkm * G6P;"));

  const reparsed = parseAntimony(text);
  assert.equal(reparsed.mainModule.species.size, 3);
});
