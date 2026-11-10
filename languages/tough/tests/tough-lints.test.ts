// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lintTough } from "../src/lints/rules.js";
import { parseTough } from "../src/parser/tough-parser.js";

const VALID_DECK = `
Valid Deck
ROCKS
ROCK1    2600.0      0.15 1.0E-13 1.0E-13 1.0E-13       2.5    1000.0
ELEME
E1   ROCK1 1.0E+04
E2   ROCK1 1.0E+04
CONNE
E1   E2    50.0 50.0 1.0E+03       0.0
INCON
E1           1.0E+07       200.0
`;

const BAD_ROCK_REF_DECK = `
Bad Rock Ref
ROCKS
ROCK1    2600.0      0.15 1.0E-13 1.0E-13 1.0E-13       2.5    1000.0
ELEME
E1   UNKNOWN_ROCK 1.0E+04
`;

const BAD_POROSITY_DECK = `
Bad Porosity
ROCKS
ROCK1    2600.0      1.50 1.0E-13 1.0E-13 1.0E-13       2.5    1000.0
`;

const DANGLING_CONN_DECK = `
Dangling Conn
ROCKS
ROCK1    2600.0      0.15 1.0E-13 1.0E-13 1.0E-13       2.5    1000.0
ELEME
E1   ROCK1 1.0E+04
CONNE
E1   E99   50.0 50.0 1.0E+03       0.0
`;

describe("TOUGH Linter", () => {
  it("passes valid TOUGH deck without diagnostics", () => {
    const deck = parseTough(VALID_DECK);
    const diags = lintTough(deck);
    assert.strictEqual(diags.length, 0);
  });

  it("detects reference to undefined rock material", () => {
    const deck = parseTough(BAD_ROCK_REF_DECK);
    const diags = lintTough(deck);
    const err = diags.find((d) => d.code === 2001);
    assert.ok(err, "Should report M2001 rock not found");
  });

  it("detects invalid rock porosity (> 1.0)", () => {
    const deck = parseTough(BAD_POROSITY_DECK);
    const diags = lintTough(deck);
    const err = diags.find((d) => d.code === 3001);
    assert.ok(err, "Should report M3001 invalid porosity");
  });

  it("detects dangling connection to undefined grid block", () => {
    const deck = parseTough(DANGLING_CONN_DECK);
    const diags = lintTough(deck);
    const err = diags.find((d) => d.code === 4001);
    assert.ok(err, "Should report M4001 dangling connection");
  });
});
