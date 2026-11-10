// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { lowerLandgemToDae, parseLandgem } from "../src/index.js";

const MULTI_UNIT_LANDGEM = `
SITE "NorthValleyFill"
  OPEN 2015
  CLOSE 2040
  L0 120.0
  K 0.05
  METHANE_PERCENT 55.0

WASTE_ACCEPTANCE
  2015 100000
  2016 110000
  2017 120000

DIGESTER "Digester_Alpha"
  VOLUME 3000.0
  TEMPERATURE 38.0
  HRT 18.0
  FEED_COD 40.0
  PH 7.2

DIGESTER "Digester_Beta"
  VOLUME 2500.0
  TEMPERATURE 36.0
  HRT 22.0
  FEED_COD 48.0
  PH 7.5
`;

test("LandGEM DAE Lowering — lowers multi-digester facility into DAE arena", () => {
  const model = parseLandgem(MULTI_UNIT_LANDGEM);
  const arena = lowerLandgemToDae(model, "NorthValley_Integrated_Facility");

  const vars = arena.variables();
  const eqs = arena.equations();

  // 2 site vars (Q_CH4, P_LFG) + 3 vars per digester * 2 = 8 vars
  assert.strictEqual(vars.length, 8);
  assert.strictEqual(eqs.length, 8);

  const varNames = vars.map((v) => v.name);
  assert.ok(varNames.includes("Q_CH4_NorthValleyFill"));
  assert.ok(varNames.includes("P_LFG_MW_NorthValleyFill"));
  assert.ok(varNames.includes("Q_biogas_Digester_Alpha"));
  assert.ok(varNames.includes("P_elec_kW_Digester_Alpha"));
  assert.ok(varNames.includes("P_thermal_kW_Digester_Alpha"));
  assert.ok(varNames.includes("Q_biogas_Digester_Beta"));
  assert.ok(varNames.includes("P_elec_kW_Digester_Beta"));
  assert.ok(varNames.includes("P_thermal_kW_Digester_Beta"));

  // Check initial values are positive
  for (const v of vars) {
    assert.ok(typeof v.start === "number");
    assert.ok((v.start as number) > 0, `Variable ${v.name} initial value must be positive`);
  }
});

test("LandGEM DAE Lowering — handles empty site or digester lists gracefully", () => {
  const emptyModel = parseLandgem("# empty comment\n");
  const arena = lowerLandgemToDae(emptyModel, "EmptyArena");

  assert.strictEqual(arena.variables().length, 0);
  assert.strictEqual(arena.equations().length, 0);
});
