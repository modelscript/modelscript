// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { STEFAN_BOLTZMANN, parseSindaDeck, parseSindaNumber } from "../src/index.js";

describe("@modelscript/sinda — Deck Parser", () => {
  it("parses all SINDA HEADER blocks, signed node/conductor types, and C/$ comments", () => {
    const deck = `
C  Spacecraft Thermal Panel Model
$  Generated for SINDA parser verification
HEADER OPTIONS DATA
  TITLE = "Spacecraft Radiator Panel"
  ABSZRO = 0.0
  SIGMA = 5.670374419D-8
HEADER NODE DATA, PANEL
  1, 300.0, 500.0   $ diffusion node
  2, 295.0, 0.0     $ arithmetic node
  0, 290.0, 0.0     $ explicit zero arithmetic node
  -100, 4.0, 0.0    $ deep space boundary node
HEADER CONDUCTOR DATA, PANEL
  10, 1, 2, 2.5     $ linear conduction W/K
  -20, 2, 100, 0.85 $ radiation conductor (eps*A*F)
HEADER SOURCE DATA, PANEL
  1, 120.0          $ internal avionics dissipation (W)
HEADER CONSTANTS DATA
  TIMEO = 0.0, TIMEND = 1000.0, DTIMEI = 1.0
  DRLXCA = 1.0E-6, NLOOP = 100
HEADER ARRAY DATA
  101, 0.0, 100.0, 200.0
       300.0, 400.0
HEADER EXECUTION
  CALL STDSTL
  CALL CRANKN
HEADER VARIABLES 1
  Q1 = 120.0
HEADER VARIABLES 2
  TAVG = 300.0
HEADER OUTPUT CALLS
  CALL TPRINT
END OF DATA
`;

    const model = parseSindaDeck(deck);

    assert.equal(model.parseErrors.length, 0, `Unexpected parse errors: ${JSON.stringify(model.parseErrors)}`);
    assert.equal(model.title, "Spacecraft Radiator Panel");
    assert.equal(model.hasEndOfData, true);
    assert.ok(Math.abs(model.options.sigma - STEFAN_BOLTZMANN) < 1e-16);
    assert.equal(model.nodes.size, 4);

    assert.equal(model.nodes.get(1)?.kind, "diffusion");
    assert.equal(model.nodes.get(1)?.capacitance, 500.0);
    assert.equal(model.nodes.get(1)?.submodel, "PANEL");

    assert.equal(model.nodes.get(2)?.kind, "arithmetic");
    assert.equal(model.nodes.get(2)?.capacitance, 0.0);

    assert.equal(model.nodes.get(0)?.kind, "arithmetic");

    assert.equal(model.nodes.get(100)?.kind, "boundary");
    assert.equal(model.nodes.get(100)?.rawId, -100);
    assert.equal(model.nodes.get(100)?.initialTemp, 4.0);

    assert.equal(model.conductors.size, 2);
    assert.equal(model.conductors.get(10)?.kind, "linear");
    assert.equal(model.conductors.get(10)?.conductance, 2.5);
    assert.equal(model.conductors.get(20)?.kind, "radiation");
    assert.equal(model.conductors.get(20)?.rawId, -20);
    assert.equal(model.conductors.get(20)?.conductance, 0.85);

    assert.equal(model.sources.length, 1);
    assert.equal(model.sources[0]?.nodeId, 1);
    assert.equal(model.sources[0]?.heatLoad, 120.0);

    assert.equal(model.constants["TIMEO"], 0.0);
    assert.equal(model.constants["TIMEND"], 1000.0);
    assert.equal(model.constants["DTIMEI"], 1.0);
    assert.equal(model.constants["NLOOP"], 100);

    assert.deepEqual(model.arrays.get(101)?.values, [0.0, 100.0, 200.0, 300.0, 400.0]);
    assert.deepEqual(
      model.execution.map((e) => e.routine),
      ["STDSTL", "CRANKN"],
    );
    assert.equal(model.variables1.length, 1);
    assert.equal(model.variables2.length, 1);
    assert.equal(model.outputCalls.length, 1);
  });

  it("parses Fortran D-exponent scientific notation and records malformed lines as parseErrors", () => {
    assert.equal(parseSindaNumber("1.25D-3"), 1.25e-3);
    assert.equal(parseSindaNumber("-4.5d+2"), -450);
    assert.ok(Number.isNaN(parseSindaNumber("NOT_A_NUM")));

    const bad = `
HEADER NODE DATA
  1, BADTEMP, 10.0
END OF DATA
`;
    const model = parseSindaDeck(bad);
    assert.equal(model.parseErrors.length, 1);
  });
});
