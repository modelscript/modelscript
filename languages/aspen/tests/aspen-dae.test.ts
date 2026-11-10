// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test, { describe } from "node:test";
import { parseAspen } from "../src/parser/aspen-parser.js";
import { lowerAspenToDae } from "../src/dae/aspen-to-dae.js";

describe("@modelscript/aspen DAE Lowering Suite", () => {
  const SAMPLE_DECK = `TITLE 'AMMONIA SYNTHESIS SEPARATOR'
IN-UNITS MET
DEF-STREAMS CONV ALL

COMPONENTS
    NITROGEN  N2
    HYDROGEN  H2
    AMMONIA   NH3

PROPERTIES PENG-ROB

FLOWSHEET
    BLOCK COOLER1  IN=HOTGAS OUT=COOLEDGAS
    BLOCK CHILLER  IN=COOLEDGAS OUT=UNREACTED LIQAMMONIA
    BLOCK PUMP_NH3 IN=LIQAMMONIA OUT=STORED_NH3

STREAM HOTGAS
    SUBSTREAM MIXED TEMP=450.0 PRES=150.0 MOLE-FLOW=500.0
    MOLE-FRAC NITROGEN 0.25 / HYDROGEN 0.70 / AMMONIA 0.05

BLOCK COOLER1 HEATER
    PARAM TEMP=35.0 PRES=148.0

BLOCK CHILLER FLASH2
    PARAM TEMP=-20.0 PRES=145.0

BLOCK PUMP_NH3 PUMP
    PARAM PRES=160.0
`;

  test("compiles flowsheet into structurally square DAE arena", () => {
    const deck = parseAspen(SAMPLE_DECK);
    const dae = lowerAspenToDae(deck);

    const numVars = dae.variables().length;
    const numEqs = dae.equations().length;

    assert.ok(numVars >= 20, `Expected >= 20 variables, got ${numVars}`);
    assert.ok(numEqs >= 20, `Expected >= 20 equations, got ${numEqs}`);
    assert.equal(numVars, numEqs, "Flowsheet DAE must be structurally square");

    // Check species variables
    assert.ok(dae.lookupVariable("F_HOTGAS_AMMONIA") !== -1);
    assert.ok(dae.lookupVariable("F_HOTGAS_NITROGEN") !== -1);
    assert.ok(dae.lookupVariable("F_HOTGAS_HYDROGEN") !== -1);

    // Check equipment variables
    assert.ok(dae.lookupVariable("W_pump_PUMP_NH3") !== -1);
  });
});
