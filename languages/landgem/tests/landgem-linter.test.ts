// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { lintLandgem, parseLandgem } from "../src/index.js";

test("LandGEM Linter — validates clean decks with zero diagnostics", () => {
  const cleanDeck = `
SITE "ValidSite"
  OPEN 2010
  CLOSE 2030
  L0 100.0
  K 0.04
  NMOC 500

WASTE_ACCEPTANCE
  2010 50000
  2011 55000

DIGESTER "ValidDigester"
  VOLUME 2000.0
  TEMPERATURE 37.0
  HRT 20.0
  FEED_COD 40.0
  PH 7.2
`;
  const diags = lintLandgem(parseLandgem(cleanDeck));
  assert.strictEqual(diags.length, 0);
});

test("LandGEM Linter — catches invalid kinetic rates and negative waste", () => {
  const invalidDeck = `
SITE "BadKinetics"
  OPEN 2010
  CLOSE 2030
  L0 -10.0
  K 0.0

WASTE_ACCEPTANCE
  2010 -5000
`;
  const diags = lintLandgem(parseLandgem(invalidDeck));
  assert.ok(diags.length >= 3);

  const rules = diags.map((d) => d.rule);
  assert.ok(rules.includes("landgem-invalid-kinetic-parameter"));
  assert.ok(rules.includes("landgem-negative-waste-mass"));
});

test("LandGEM Linter — catches missing waste acceptance cohorts", () => {
  const noWaste = `
SITE "NoWasteSite"
  OPEN 2010
  CLOSE 2030
  L0 100.0
  K 0.04
`;
  const diags = lintLandgem(parseLandgem(noWaste));
  assert.ok(diags.length >= 1);
  assert.ok(diags.some((d) => d.rule === "landgem-missing-waste-data"));
});

test("LandGEM Linter — catches digester pH inhibition", () => {
  const badPh = `
DIGESTER "Acidic"
  VOLUME 1000.0
  TEMPERATURE 37.0
  HRT 15.0
  FEED_COD 30.0
  PH 4.8
`;
  const diags = lintLandgem(parseLandgem(badPh));
  assert.ok(diags.length >= 1);
  assert.ok(diags.some((d) => d.rule === "landgem-digester-ph-inhibition"));
});
