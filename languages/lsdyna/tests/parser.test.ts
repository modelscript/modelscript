// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseLsDynaDeck, parseLsDynaNumber, splitLsDynaCard } from "../src/parser/index.js";

const FREE_FORMAT_DECK = `*KEYWORD
$ Comment line before title
*TITLE
1D Steel Bar Explicit Dynamics
*NODE
$# nid, x, y, z, tc, rc
1, 0.0, 0.0, 0.0, 7, 7
2, 0.5, 0.0, 0.0, 0, 0
3, 1.0, 0.0, 0.0, 0, 0
*ELEMENT_BEAM
1, 1, 1, 2, 0
2, 1, 2, 3, 0
*PART
Steel Bar
1, 1, 1, 0, 0, 0, 0, 0
*SECTION_BEAM
1, 3, 1.0
0.001, 0.0, 0.0, 0.0
*MAT_ELASTIC
1, 7850.0, 2.1e11, 0.3
*SET_NODE_LIST
10
1
*BOUNDARY_SPC_SET
10, 0, 1, 1, 1, 1, 1, 1
*BOUNDARY_SPC_NODE
2, 0, 0, 1, 1, 0, 0, 0
*INITIAL_VELOCITY
0, 0, 0
5.0, 0.0, 0.0, 0.0, 0.0, 0.0
*DEFINE_CURVE
1, 0, 1.0, 1.0, 0.0, 0.0
0.0, 1.0
0.01, 0.0
*LOAD_NODE_POINT
3, 1, 1, 1000.0
*CONTROL_TERMINATION
0.005, 0, 0.0, 0.0, 0.0
*CONTROL_TIMESTEP
0.0, 0.9, 0, 0.0, 0.0
*DATABASE_GLSTAT
1.0e-5, 0, 0, 1
*END
`;

const FIXED_COLUMN_DECK = `*KEYWORD
*TITLE
Fixed Column Shell & Solid Deck
*NODE
       1             0.0             0.0             0.0       0       0
       2             1.0             0.0             0.0       0       0
       3             1.0             1.0             0.0       0       0
       4             0.0             1.0             0.0       0       0
       5             0.0             0.0             1.0       0       0
       6             1.0             0.0             1.0       0       0
       7             1.0             1.0             1.0       0       0
       8             0.0             1.0             1.0       0       0
*ELEMENT_SOLID
       1       1       1       2       3       4       5       6       7       8
*ELEMENT_SHELL
       2       2       1       2       3       4
*PART
Solid Cube
         1         1         1         0         0         0         0         0
Shell Face
         2         2         2         0         0         0         0         0
*SECTION_SOLID
         1         1
*SECTION_SHELL
         2         2    0.8333         2
     0.005     0.005     0.005     0.005
*MAT_PLASTIC_KINEMATIC
         1    7850.0    2.1+11       0.3     2.5D8     2.1e9       1.0
       0.0       0.0      0.25
*MAT_RIGID
         2    2700.0    7.0e10      0.33
       1.0         7         7
*CONTROL_TERMINATION
    0.0020         0       0.0       0.0       0.0
*END
`;

describe("@modelscript/lsdyna — Keyword Deck Parser", () => {
  it("parses comma-delimited free-format cards with all major LS-DYNA keywords", () => {
    const deck = parseLsDynaDeck(FREE_FORMAT_DECK);

    assert.equal(deck.hasKeywordHeader, true);
    assert.equal(deck.hasEndCard, true);
    assert.equal(deck.title, "1D Steel Bar Explicit Dynamics");
    assert.equal(deck.parseErrors.length, 0);
    assert.equal(deck.nodes.size, 3);
    assert.equal(deck.elements.size, 2);
    assert.equal(deck.parts.size, 1);
    assert.equal(deck.sections.size, 1);
    assert.equal(deck.materials.size, 1);
    assert.equal(deck.nodeSets.size, 1);
    assert.equal(deck.boundaries.length, 2);
    assert.equal(deck.initialVelocities.length, 1);
    assert.equal(deck.curves.size, 1);
    assert.equal(deck.loads.length, 1);

    assert.equal(deck.nodes.get(1)?.tc, 7);
    assert.equal(deck.nodes.get(3)?.x, 1.0);
    assert.equal(deck.elements.get(1)?.kind, "BEAM");
    assert.deepEqual(deck.elements.get(1)?.nodes, [1, 2]);
    assert.equal(deck.sections.get(1)?.area, 0.001);
    assert.equal(deck.materials.get(1)?.e, 2.1e11);
    assert.equal(deck.initialVelocities[0]?.vx, 5.0);
    assert.equal(deck.curves.get(1)?.points.length, 2);
    assert.equal(deck.controlTermination?.endtim, 0.005);
    assert.equal(deck.controlTimestep?.tssfac, 0.9);
    assert.equal(deck.databaseGlstat?.dt, 1.0e-5);
  });

  it("parses 10-char fixed-column and 8/16/16/16 *NODE cards with Fortran exponents", () => {
    const deck = parseLsDynaDeck(FIXED_COLUMN_DECK);

    assert.equal(deck.hasKeywordHeader, true);
    assert.equal(deck.hasEndCard, true);
    assert.equal(deck.parseErrors.length, 0);
    assert.equal(deck.nodes.size, 8);
    assert.equal(deck.elements.size, 2);
    assert.equal(deck.elements.get(1)?.kind, "SOLID");
    assert.deepEqual(deck.elements.get(1)?.nodes, [1, 2, 3, 4, 5, 6, 7, 8]);
    assert.equal(deck.elements.get(2)?.kind, "SHELL");
    assert.deepEqual(deck.elements.get(2)?.nodes, [1, 2, 3, 4]);
    assert.equal(deck.parts.size, 2);
    assert.equal(deck.sections.get(2)?.thickness, 0.005);

    const mat1 = deck.materials.get(1)!;
    assert.equal(mat1.type, "MAT_PLASTIC_KINEMATIC");
    assert.equal(mat1.ro, 7850.0);
    assert.equal(mat1.e, 2.1e11);
    assert.equal(mat1.sigy, 2.5e8);
    assert.equal(mat1.etan, 2.1e9);
    assert.equal(mat1.fs, 0.25);

    const mat2 = deck.materials.get(2)!;
    assert.equal(mat2.type, "MAT_RIGID");
    assert.equal(mat2.cmo, 1.0);
    assert.equal(mat2.con1, 7);
    assert.equal(mat2.con2, 7);
  });

  it("parses shorthand Fortran exponent numbers and fixed-width slices accurately", () => {
    assert.equal(parseLsDynaNumber("1.5-4"), 1.5e-4);
    assert.equal(parseLsDynaNumber("2.1+11"), 2.1e11);
    assert.equal(parseLsDynaNumber("3.5D6"), 3.5e6);
    assert.equal(parseLsDynaNumber("", 42), 42);

    const fields = splitLsDynaCard("         1    7850.0    2.1e11       0.3");
    assert.equal(fields[0], "1");
    assert.equal(fields[1], "7850.0");
    assert.equal(fields[2], "2.1e11");
    assert.equal(fields[3], "0.3");
  });
});
