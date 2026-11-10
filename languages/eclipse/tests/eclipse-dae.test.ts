// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test, { describe } from "node:test";
import { parseEclipse } from "../src/parser/eclipse-parser.js";
import { lowerEclipseToDae } from "../src/dae/eclipse-to-dae.js";

describe("@modelscript/eclipse DAE Arena Lowering Suite", () => {
  const TEST_DECK = `RUNSPEC
TITLE
  DAE Reservoir Model
/
DIMENS
  5 5 2 /
FIELD
OIL
WATER
GRID
DX
  50*100.0 /
DY
  50*100.0 /
DZ
  50*20.0 /
PORO
  50*0.22 /
PERMX
  50*150.0 /
PERMY
  50*150.0 /
PERMZ
  50*30.0 /
PROPS
PVTW
  4000.0 1.025 3.0e-6 0.35 0.0 /
ROCK
  4000.0 3.5e-6 /
PVTO
  500.0  1.12 1.8 /
  4000.0 1.30 1.0 /
/
SOLUTION
PRESSURE
  50*4000.0 /
SWAT
  50*0.20 /
SOIL
  50*0.80 /
SCHEDULE
WELSPECS
  'PROD_1' 'G1' 3 3 8000.0 'OIL' /
/
COMPDAT
  'PROD_1' 3 3 1 2 'OPEN' 2* 0.25 /
/
WCONPROD
  'PROD_1' 'OPEN' 'BHP' 5* 2500.0 /
/
TSTEP
  30 /
END
`;

  test("compiles reservoir and well inflow equations into DAEBuilder", () => {
    const deck = parseEclipse(TEST_DECK);
    const dae = lowerEclipseToDae(deck);

    assert.ok(dae.variables().length >= 8, `Expected >= 8 variables, got ${dae.variables().length}`);
    assert.ok(dae.equations().length >= 8, `Expected >= 8 equations, got ${dae.equations().length}`);

    // Check key reservoir states
    assert.notEqual(dae.lookupVariable("P_avg"), -1);
    assert.notEqual(dae.lookupVariable("Np"), -1);
    assert.notEqual(dae.lookupVariable("Q_oil_total"), -1);
    assert.notEqual(dae.lookupVariable("q_oil_PROD_1"), -1);
  });
});
