// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evaluateTrnsysExpression, parseTrnsysDeck } from "../src/index.js";

const SAMPLE_SOLAR_DECK = `
* TRNSYS Solar Domestic Hot Water System
VERSION 18
CONSTANTS 3
  START = 0
  STOP = 24
  STEP = 0.25

SIMULATION START STOP STEP ! 24-hour transient run
TOLERANCES 0.001 0.001
LIMITS 30 30 30
DFQ 1
WIDTH 80
NOLIST
MAP

EQUATIONS 2
  AREA_COL = 4.0
  FLOW_COL = AREA_COL * 50.0

UNIT 1 TYPE 15 Weather
PARAMETERS 5
  20.0 5.0 2880.0 6.0 18.0

UNIT 2 TYPE 1 Collector
PARAMETERS 5
  AREA_COL 4.19 0.75 15.0 0.0
INPUTS 4
  3,1  0,0  1,1  1,2
  20.0 FLOW_COL 20.0 0.0

UNIT 3 TYPE 4 StorageTank
PARAMETERS 6
  0.30 4.19 1000.0 1.5 1.5 3
INPUTS 5
  2,1  2,2  0,0  0,0  1,1
  20.0 0.0 15.0 0.0 20.0
DERIVATIVES 3
  20.0 20.0 20.0

UNIT 4 TYPE 25 Printer
PARAMETERS 4
  1.0 0.0 24.0 30
INPUTS 2
  2,1  3,6
  0.0 0.0

ASSIGN "solar_dhw.out" 30
END
`;

describe("@modelscript/trnsys — Deck Parser", () => {
  it("parses all TRNSYS control cards, CONSTANTS, EQUATIONS, UNITS, and ASSIGN", () => {
    const deck = parseTrnsysDeck(SAMPLE_SOLAR_DECK, "SolarDHW");

    assert.equal(deck.parseErrors.length, 0);
    assert.equal(deck.version, 18);
    assert.deepEqual(deck.simulation, { tStart: 0, tStop: 24, dt: 0.25, line: 9 });
    assert.deepEqual(deck.tolerances, { integration: 0.001, convergence: 0.001, line: 10 });
    assert.deepEqual(deck.limits, { maxIterations: 30, maxWarnings: 30, traceLimit: 30, line: 11 });
    assert.equal(deck.dfq, 1);
    assert.equal(deck.width, 80);
    assert.equal(deck.listMode, "NOLIST");
    assert.equal(deck.map, true);
    assert.equal(deck.hasEnd, true);

    assert.equal(deck.constants.length, 3);
    assert.equal(deck.equationBlocks.length, 1);
    assert.equal(deck.equationBlocks[0]?.equations.length, 2);
    assert.equal(deck.equationBlocks[0]?.equations[1]?.value, 200.0);

    assert.equal(deck.units.length, 4);
    const col = deck.units[1]!;
    assert.equal(col.unitNumber, 2);
    assert.equal(col.typeNumber, 1);
    assert.equal(col.label, "Collector");
    assert.equal(col.parameters.length, 5);
    assert.deepEqual(col.parameters[0], { kind: "number", value: 4.0, raw: "AREA_COL" });
    assert.equal(col.inputs.length, 4);
    assert.equal(col.inputs[0]?.kind, "connection");
    if (col.inputs[0]?.kind === "connection") {
      assert.equal(col.inputs[0].unitNumber, 3);
      assert.equal(col.inputs[0].outputIndex, 1);
    }
    assert.equal(col.initialInputs.length, 4);

    const tank = deck.units[2]!;
    assert.equal(tank.derivatives.length, 3);
    assert.equal(deck.assigns.length, 1);
    assert.equal(deck.assigns[0]?.filename, "solar_dhw.out");
    assert.equal(deck.assigns[0]?.logicalUnit, 30);
  });

  it("evaluates arithmetic and built-in TRNSYS expressions", () => {
    const env = new Map<string, number>([
      ["A", 10],
      ["B", 4],
    ]);
    assert.equal(evaluateTrnsysExpression("A + B * 2", env), 18);
    assert.equal(evaluateTrnsysExpression("MAX(A, B * 3)", env), 12);
    assert.equal(evaluateTrnsysExpression("GT(A, B)", env), 1);
    assert.equal(evaluateTrnsysExpression("2 ^ 3 + 1", env), 9);
  });

  it("reports parse errors for malformed control cards", () => {
    const deck = parseTrnsysDeck(`
SIMULATION 0 24
UNIT BAD HEADER
END
`);
    assert.ok(deck.parseErrors.length >= 2);
  });
});
