// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DATCOM_AIRCRAFT_TEMPLATES } from "../src/catalog/datcom-std-schemas.js";
import { datcomToDae } from "../src/dae/datcom-to-dae.js";
import { parseDatcomDeck } from "../src/parser/deck-parser.js";

describe("DATCOM 6-DOF Linearized Flight Dynamics DAE Lowering", () => {
  it("lowers Cessna-172 case into DAEBuilder with 8 state variables and 12 equations", () => {
    const deck = parseDatcomDeck(DATCOM_AIRCRAFT_TEMPLATES.CESSNA_172);
    const c = deck.cases[0]!;
    const { builder, result } = datcomToDae(c);

    assert.strictEqual(result.stateVarIndices.length, 8);
    assert.strictEqual(result.equationCount, 12);

    // Check 4 longitudinal + 4 lateral state variables
    for (const stateName of ["u", "w", "q", "theta", "v", "p", "r", "phi"]) {
      assert.ok(result.variableMap.has(stateName), `Missing state variable '${stateName}'`);
      assert.notStrictEqual(builder.lookupVariable(stateName), -1);
    }

    // Check aerodynamic output variables
    for (const outName of ["alpha", "CL", "CD", "Cm"]) {
      assert.ok(result.variableMap.has(outName), `Missing output variable '${outName}'`);
    }

    // Verify stable longitudinal and lateral derivatives
    assert.ok(result.aeroResult.CLalphaPerRad > 4.0);
    assert.ok(result.aeroResult.CmalphaPerRad < 0);
    assert.ok(result.aeroResult.Cmq < 0);
    assert.ok(result.aeroResult.Clp < 0);
    assert.ok(result.aeroResult.Cnr < 0);
  });

  it("lowers Supersonic Delta case cleanly with supersonic Mach aerodynamics", () => {
    const deck = parseDatcomDeck(DATCOM_AIRCRAFT_TEMPLATES.SUPERSONIC_DELTA);
    const c = deck.cases[0]!;
    const { result } = datcomToDae(c);

    assert.strictEqual(result.stateVarIndices.length, 8);
    assert.strictEqual(result.equationCount, 12);
    assert.strictEqual(result.aeroResult.mach, 1.6);
    assert.ok(result.aeroResult.airspeedMS > 450);
    assert.ok(result.aeroResult.CLalphaPerRad > 1.5);
  });
});
