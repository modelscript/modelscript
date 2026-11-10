// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { parseLandgem, solveBiogas } from "../src/index.js";

test("LandGEM Biogas Solver — evaluates first-order decay kinetics across time", () => {
  const deck = `
SITE "SingleCohortTest"
  OPEN 2020
  CLOSE 2030
  L0 100.0
  K 0.05
  METHANE_PERCENT 50.0

WASTE_ACCEPTANCE
  2020 100000
`;
  const model = parseLandgem(deck);
  const summary = solveBiogas(model);

  assert.strictEqual(summary.peakMethaneYear, 2020);
  assert.ok(summary.annualLfg.length > 20);

  // Verification: Q(t) = 2 * k * L0 * M * e^(-k * t)
  // At t=0 (yr 2020): Q = 2 * 0.05 * 100 * 100000 * 1 = 1,000,000 m^3/yr
  const yr2020 = summary.annualLfg.find((r) => r.year === 2020);
  assert.ok(yr2020);
  assert.ok(Math.abs(yr2020.methaneMethaneM3 ?? yr2020.methaneM3PerYear - 1000000) < 1.0);

  // At t=10 (yr 2030): Q = 1,000,000 * e^(-0.5) ≈ 606,530.66 m^3/yr
  const yr2030 = summary.annualLfg.find((r) => r.year === 2030);
  assert.ok(yr2030);
  assert.ok(Math.abs(yr2030.methaneM3PerYear - 1000000 * Math.exp(-0.5)) < 10.0);
});

test("LandGEM Biogas Solver — classifies digester VFA inhibition risks", () => {
  const digesterDeck = `
DIGESTER "LowRisk"
  VOLUME 2000.0
  TEMPERATURE 37.0
  HRT 20.0
  FEED_COD 40.0
  PH 7.4

DIGESTER "ModerateRisk"
  VOLUME 2000.0
  TEMPERATURE 37.0
  HRT 20.0
  FEED_COD 40.0
  PH 6.6

DIGESTER "SevereRisk"
  VOLUME 2000.0
  TEMPERATURE 37.0
  HRT 20.0
  FEED_COD 40.0
  PH 5.8
`;
  const model = parseLandgem(digesterDeck);
  const summary = solveBiogas(model);

  assert.strictEqual(summary.digesters.length, 3);
  assert.strictEqual(summary.digesters[0]?.vfaRisk, "low");
  assert.strictEqual(summary.digesters[1]?.vfaRisk, "moderate");
  assert.strictEqual(summary.digesters[2]?.vfaRisk, "severe");
});

test("LandGEM Biogas Solver — scales energy yield with temperature", () => {
  const makeDeck = (temp: number) => `
DIGESTER "TempTest"
  VOLUME 3000.0
  TEMPERATURE ${temp}
  HRT 20.0
  FEED_COD 50.0
  PH 7.4
`;
  const sum35 = solveBiogas(parseLandgem(makeDeck(35.0)));
  const sum55 = solveBiogas(parseLandgem(makeDeck(55.0)));

  // Thermophilic (55C) gas volume expansion vs mesophilic (35C)
  const d35 = sum35.digesters[0]!;
  const d55 = sum55.digesters[0]!;
  assert.ok(d55.dailyBiogasM3 > d35.dailyBiogasM3);
  assert.ok(d55.electricalPowerKW > d35.electricalPowerKW);
});
