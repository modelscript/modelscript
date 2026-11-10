// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseTough } from "../src/parser/tough-parser.js";

const SAMPLE_DECK = `
Geothermal Reservoir 2-Element Benchmark
ROCKS
BASLT    2700.0      0.10 5.0E-14 5.0E-14 1.0E-14       2.8    1050.0
ELEME
A1  1BASLT 1.0E+05
A1  2BASLT 1.0E+05
CONNE
A1  1A1  2 50.0 50.0 1.0E+03       0.0
GENER
A1  1WELL1MASS      -20.0    1.5E+06
INCON
A1  1        1.2E+07       260.0
A1  2        1.2E+07       260.0
ENDCY
`;

describe("TOUGH Parser", () => {
  it("parses rocks, elements, connections, generators, and inconds from TOUGH deck", () => {
    const deck = parseTough(SAMPLE_DECK);
    assert.strictEqual(deck.title, "Geothermal Reservoir 2-Element Benchmark");

    assert.strictEqual(deck.rocks.length, 1);
    const r = deck.rocks[0]!;
    assert.strictEqual(r.name, "BASLT");
    assert.strictEqual(r.density, 2700.0);
    assert.strictEqual(r.porosity, 0.10);
    assert.strictEqual(r.permeabilityX, 5.0e-14);
    assert.strictEqual(r.permeabilityZ, 1.0e-14);

    assert.strictEqual(deck.elements.length, 2);
    assert.strictEqual(deck.elements[0]?.name, "A1  1");
    assert.strictEqual(deck.elements[0]?.rockName, "BASLT");
    assert.strictEqual(deck.elements[0]?.volume, 1.0e5);

    assert.strictEqual(deck.connections.length, 1);
    const c = deck.connections[0]!;
    assert.strictEqual(c.elem1, "A1  1");
    assert.strictEqual(c.elem2, "A1  2");
    assert.strictEqual(c.dist1, 50.0);
    assert.strictEqual(c.dist2, 50.0);
    assert.strictEqual(c.area, 1000.0);

    assert.strictEqual(deck.generators.length, 1);
    const g = deck.generators[0]!;
    assert.strictEqual(g.elem, "A1  1");
    assert.strictEqual(g.name, "WELL1");
    assert.strictEqual(g.type, "MASS");
    assert.strictEqual(g.rate, -20.0);
    assert.strictEqual(g.enthalpy, 1.5e6);

    assert.strictEqual(deck.inconds.length, 2);
    assert.strictEqual(deck.inconds[0]?.pressure, 1.2e7);
    assert.strictEqual(deck.inconds[0]?.temperature, 260.0);
  });
});
