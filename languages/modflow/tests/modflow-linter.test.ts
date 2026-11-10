// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { lintModflow, parseModflow } from "../src/index.js";

test("MODFLOW Linter — validates clean model without errors", () => {
  const cleanDeck = `
BEGIN DIS6
  NLAY 1
  NROW 2
  NCOL 2
  TOP 20.0
  BOTM 0.0
END DIS6
BEGIN NPF6
  K 10.0
END NPF6
`;
  const model = parseModflow(cleanDeck);
  const diags = lintModflow(model);
  assert.strictEqual(diags.length, 0);
});

test("MODFLOW Linter — detects out-of-bounds well and inverted layer", () => {
  const badDeck = `
BEGIN DIS6
  NLAY 1
  NROW 2
  NCOL 2
  TOP 10.0
  BOTM 20.0
END DIS6
BEGIN NPF6
  K -5.0
  K33 1.0
  SS -0.01
  SY 1.5
END NPF6
BEGIN WEL6
  1 5 5 -100.0
END WEL6
BEGIN RIV6
  1 1 1 30.0 100.0 35.0
END RIV6
`;
  const model = parseModflow(badDeck);
  const diags = lintModflow(model);
  assert.ok(diags.length >= 4);

  const rules = diags.map((d) => d.rule);
  assert.ok(rules.includes("modflow-invalid-conductivity"));
  assert.ok(rules.includes("modflow-layer-elevation-inversion"));
  assert.ok(rules.includes("modflow-cell-out-of-bounds"));
  assert.ok(rules.includes("modflow-river-stage-below-bottom"));
});
