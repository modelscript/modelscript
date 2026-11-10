// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import {
  lintLandgem,
  lowerLandgemToDae,
  parseLandgem,
  solveBiogas,
  LandgemWorkspaceIndex,
  validateLandgem,
  getLandgemDocumentSymbols,
} from "../src/index.js";

const SAMPLE_LANDGEM_DECK = `
# Regional Solid Waste & Biogas Facility
SITE "PineCreekLandfill"
  OPEN 2010
  CLOSE 2035
  L0 100.0  # m^3/Mg
  K 0.04    # 1/yr conventional
  NMOC 600  # ppmv
  METHANE_PERCENT 50.0

WASTE_ACCEPTANCE
  2010 150000
  2011 160000
  2012 175000
  2013 180000

DIGESTER "CoDigestionFacility"
  VOLUME 4000.0
  TEMPERATURE 37.0
  HRT 20.0
  FEED_COD 45.0
  PH 7.3
`;

test("LandGEM Parser — parses SITE, WASTE_ACCEPTANCE, and DIGESTER", () => {
  const model = parseLandgem(SAMPLE_LANDGEM_DECK);
  assert.strictEqual(model.sites.length, 1);
  assert.strictEqual(model.sites[0]?.name, "PineCreekLandfill");
  assert.strictEqual(model.sites[0]?.openYear, 2010);
  assert.strictEqual(model.sites[0]?.closeYear, 2035);
  assert.strictEqual(model.sites[0]?.params.l0, 100.0);
  assert.strictEqual(model.sites[0]?.params.k, 0.04);
  assert.strictEqual(model.sites[0]?.cohorts.length, 4);

  assert.strictEqual(model.digesters.length, 1);
  assert.strictEqual(model.digesters[0]?.name, "CoDigestionFacility");
  assert.strictEqual(model.digesters[0]?.volumeM3, 4000.0);
  assert.strictEqual(model.digesters[0]?.ph, 7.3);
});

test("LandGEM Linter — passes clean deck without errors", () => {
  const model = parseLandgem(SAMPLE_LANDGEM_DECK);
  const diags = lintLandgem(model);
  assert.strictEqual(diags.length, 0);
});

test("LandGEM Linter — detects kinetic rate, pH inhibition, and year inversion errors", () => {
  const badDeck = `
SITE "InvertedLandfill"
  OPEN 2025
  CLOSE 2010
  K -0.05
  L0 0.0

DIGESTER "AcidicDigester"
  VOLUME 1000.0
  TEMPERATURE 37.0
  HRT 10.0
  FEED_COD 20.0
  PH 5.2
`;
  const model = parseLandgem(badDeck);
  const diags = lintLandgem(model);
  assert.ok(diags.length >= 4);

  const rules = diags.map((d) => d.rule);
  assert.ok(rules.includes("landgem-invalid-year-range"));
  assert.ok(rules.includes("landgem-invalid-kinetic-parameter"));
  assert.ok(rules.includes("landgem-missing-waste-data"));
  assert.ok(rules.includes("landgem-digester-ph-inhibition"));
});

test("LandGEM Biogas Solver — evaluates annual LFG curves and digester CHP rating", () => {
  const model = parseLandgem(SAMPLE_LANDGEM_DECK);
  const summary = solveBiogas(model);

  assert.ok(summary.annualLfg.length > 0);
  assert.ok(summary.peakMethaneM3PerYear > 0);
  assert.ok(summary.cumulativeMethaneM3 > 0);

  assert.strictEqual(summary.digesters.length, 1);
  const dig = summary.digesters[0]!;
  assert.strictEqual(dig.name, "CoDigestionFacility");
  assert.ok(dig.dailyBiogasM3 > 0);
  assert.ok(dig.electricalPowerKW > 0);
  assert.ok(dig.thermalPowerKW > 0);
  assert.strictEqual(dig.vfaRisk, "low");
});

test("LandGEM DAE Lowering — lowers methane and digester equations to DAE arena", () => {
  const model = parseLandgem(SAMPLE_LANDGEM_DECK);
  const arena = lowerLandgemToDae(model);

  const vars = arena.variables();
  assert.ok(vars.length >= 5);
  const eqs = arena.equations();
  assert.ok(eqs.length >= 4);
});

test("LandGEM Workspace Index — indexes site, cohorts, and digester symbols", () => {
  const indexer = new LandgemWorkspaceIndex();
  const idx = indexer.indexFile("file:///site.landgem", SAMPLE_LANDGEM_DECK);

  assert.ok(idx.symbols.size > 0);
  assert.ok(idx.byName.has("PineCreekLandfill"));
  assert.ok(idx.byName.has("CoDigestionFacility"));
});

test("LandGEM LSP — produces diagnostics and symbols", () => {
  const diags = validateLandgem(SAMPLE_LANDGEM_DECK);
  assert.strictEqual(diags.length, 0);

  const symbols = getLandgemDocumentSymbols(SAMPLE_LANDGEM_DECK);
  assert.strictEqual(symbols.length, 2);
});
