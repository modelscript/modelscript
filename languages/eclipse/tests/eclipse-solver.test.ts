// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test, { describe } from "node:test";
import { parseEclipse } from "../src/parser/eclipse-parser.js";
import { solveReservoirDepletion } from "../src/solvers/reservoir-solver.js";

describe("@modelscript/eclipse Reservoir Depletion & TPFA Solvers Suite", () => {
  const TEST_DECK = `RUNSPEC
TITLE
  Small Waterflood Reservoir Test
/
DIMENS
  4 4 2 /
FIELD
OIL
WATER
GRID
DX
  32*100.0 /
DY
  32*100.0 /
DZ
  32*20.0 /
PORO
  32*0.20 /
PERMX
  32*200.0 /
PERMY
  32*200.0 /
PERMZ
  32*40.0 /
PROPS
PVTW
  3500.0 1.0 3.0e-6 0.35 0.0 /
ROCK
  3500.0 4.0e-6 /
PVTO
  500.0  1.10 1.5 /
  3500.0 1.25 0.9 /
/
SOLUTION
PRESSURE
  32*3500.0 /
SWAT
  32*0.25 /
SOIL
  32*0.75 /
SCHEDULE
WELSPECS
  'P1' 'G1' 2 2 7000.0 'OIL' /
  'I1' 'G1' 1 1 7000.0 'WATER' /
/
COMPDAT
  'P1' 2 2 1 2 'OPEN' 2* 0.25 /
  'I1' 1 1 1 2 'OPEN' 2* 0.25 /
/
WCONPROD
  'P1' 'OPEN' 'BHP' 5* 2000.0 /
/
WCONINJE
  'I1' 'WATER' 'OPEN' 'RATE' 800.0 1* 4000.0 /
/
TSTEP
  30 30 30 /
END
`;

  test("computes volumetric STOIIP and fluid depletion steps", () => {
    const deck = parseEclipse(TEST_DECK);
    const res = solveReservoirDepletion(deck, { totalDays: 90.0, stepDays: 30.0 });

    assert.ok(res.poreVolume > 0);
    assert.ok(res.stoiip > 0);
    assert.equal(res.stepsCount, 3);
    assert.ok(res.cumulativeOilProduced > 0);
  });
});
