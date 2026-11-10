// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lowerToughToDae } from "../src/dae/tough-to-dae.js";
import { parseTough } from "../src/parser/tough-parser.js";

const DAE_TEST_DECK = `
TOUGH DAE Lowering Test
ROCKS
SAND1    2500.0      0.20 1.0E-12 1.0E-12 1.0E-12       2.0    1000.0
ELEME
B1   SAND1 1.0E+04
B2   SAND1 1.0E+04
CONNE
B1   B2    50.0 50.0 1.0E+03       0.0
GENER
B1   WELL1 MASS      -10.0    1.0E+06
INCON
B1           1.0E+07       200.0
B2           0.9E+07       200.0
`;

describe("TOUGH DAE Lowering", () => {
  it("compiles reservoir grid blocks, connections and wells into DAEBuilder arena", () => {
    const deck = parseTough(DAE_TEST_DECK);
    const arena = lowerToughToDae(deck);

    // 2 elements * 2 variables (P, T) = 4 variables
    // 1 well generator = 1 variable
    // 1 connection flux = 1 variable
    // Total = 6 variables
    assert.strictEqual(arena.getVarCount(), 6);

    // 2 elements * 2 initial equations (P, T) = 4 equations
    // 1 generator rate = 1 equation
    // 1 connection Darcy flux = 1 equation
    // Total = 6 equations
    assert.strictEqual(arena.getEqCount(), 6);
  });
});
