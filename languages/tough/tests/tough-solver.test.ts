// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseTough } from "../src/parser/tough-parser.js";
import { solveGeothermalWells } from "../src/solver/geothermal-solver.js";

const FLASH_TEST_DECK = `
Geothermal Production Well Test
ROCKS
SAND1    2500.0      0.20 1.0E-12 1.0E-12 1.0E-12       2.0    1000.0
ELEME
PROD1SAND1 1.0E+05
GENER
PROD1GEO01MASS      -30.0    1.8E+06
`;

describe("TOUGH Geothermal Well Solver", () => {
  it("evaluates thermal power production and steam flashing fraction", () => {
    const deck = parseTough(FLASH_TEST_DECK);
    const wells = solveGeothermalWells(deck);

    assert.strictEqual(wells.length, 1);
    const w = wells[0]!;
    assert.strictEqual(w.wellName, "GEO01");
    assert.strictEqual(w.massRateKgS, 30.0);
    assert.strictEqual(w.enthalpyJPerKg, 1.8e6);

    // Thermal power: 30 kg/s * (1.8e6 - 167500) / 1e6 ~ 48.97 MWth
    assert.ok(w.thermalPowerMW > 45.0 && w.thermalPowerMW < 55.0);

    // Steam fraction at 1.8e6 J/kg: (1.8e6 - 4.19e5) / (2.676e6 - 4.19e5) ~ 0.61
    assert.ok(w.steamFraction > 0.5 && w.steamFraction < 0.7);
  });
});
