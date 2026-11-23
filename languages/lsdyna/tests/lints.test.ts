// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lintLsDynaDeck } from "../src/lints/index.js";
import { parseLsDynaDeck } from "../src/parser/index.js";

const VALID_DECK = `*KEYWORD
*TITLE
Clean Valid Bar
*NODE
1, 0.0, 0.0, 0.0, 0, 0
2, 1.0, 0.0, 0.0, 0, 0
*ELEMENT_BEAM
1, 1, 1, 2, 0
*PART
Bar
1, 1, 1, 0, 0, 0, 0, 0
*SECTION_BEAM
1, 3, 1.0
0.001, 0.0, 0.0, 0.0
*MAT_ELASTIC
1, 7850.0, 2.1e11, 0.3
*BOUNDARY_SPC_NODE
1, 0, 1, 1, 1, 1, 1, 1
*CONTROL_TERMINATION
0.01, 0, 0.0, 0.0, 0.0
*CONTROL_TIMESTEP
0.0, 0.9, 0, 0.0, 0.0
*END
`;

describe("@modelscript/lsdyna — Lints & Diagnostics (LSD1001–LSD5006)", () => {
  it("produces zero diagnostics on a valid LS-DYNA deck", () => {
    const deck = parseLsDynaDeck(VALID_DECK);
    const diags = lintLsDynaDeck(deck);
    assert.equal(diags.length, 0, `Expected 0 diagnostics, got: ${JSON.stringify(diags)}`);
  });

  it("detects missing *KEYWORD, missing *END, and missing *CONTROL_TERMINATION", () => {
    const deck = parseLsDynaDeck(`*NODE
1, 0.0, 0.0, 0.0
2, 1.0, 0.0, 0.0
*ELEMENT_BEAM
1, 1, 1, 2
*PART
P1
1, 1, 1
*SECTION_BEAM
1, 3, 1.0
0.01
*MAT_ELASTIC
1, 7850.0, 2.1e11, 0.3
*BOUNDARY_SPC_NODE
1, 0, 1, 1, 1, 1, 1, 1
`);
    const ids = new Set(lintLsDynaDeck(deck).map((d) => d.id));
    assert.ok(ids.has("LSD1002"), "Expected LSD1002 missing *KEYWORD");
    assert.ok(ids.has("LSD1003"), "Expected LSD1003 missing *END");
    assert.ok(ids.has("LSD5001"), "Expected LSD5001 missing *CONTROL_TERMINATION");
  });

  it("detects duplicate node, element, part, material, and section IDs", () => {
    const deck = parseLsDynaDeck(`*KEYWORD
*NODE
1, 0.0, 0.0, 0.0
1, 1.0, 0.0, 0.0
2, 2.0, 0.0, 0.0
*ELEMENT_BEAM
10, 1, 1, 2
10, 1, 1, 2
*PART
P1
1, 1, 1
P1_dup
1, 1, 1
*SECTION_BEAM
1, 3, 1.0
0.01
*SECTION_BEAM
1, 3, 1.0
0.02
*MAT_ELASTIC
1, 7850.0, 2.1e11, 0.3
*MAT_ELASTIC
1, 7850.0, 2.1e11, 0.3
*BOUNDARY_SPC_NODE
1, 0, 1, 1, 1, 1, 1, 1
*CONTROL_TERMINATION
0.01
*END
`);
    const ids = new Set(lintLsDynaDeck(deck).map((d) => d.id));
    assert.ok(ids.has("LSD2001"), "Expected LSD2001 duplicate node ID");
    assert.ok(ids.has("LSD2002"), "Expected LSD2002 duplicate element ID");
    assert.ok(ids.has("LSD2003"), "Expected LSD2003 duplicate part ID");
    assert.ok(ids.has("LSD2004"), "Expected LSD2004 duplicate material ID");
    assert.ok(ids.has("LSD2005"), "Expected LSD2005 duplicate section ID");
  });

  it("detects undefined element nodes/parts, undefined part sections/materials, and undefined BC/load targets", () => {
    const deck = parseLsDynaDeck(`*KEYWORD
*NODE
1, 0.0, 0.0, 0.0
*ELEMENT_BEAM
1, 99, 1, 42
*PART
P1
1, 77, 88
*BOUNDARY_SPC_NODE
55, 0, 1, 1, 1, 1, 1, 1
*LOAD_NODE_POINT
66, 1, 999, 100.0
*CONTROL_TERMINATION
0.01
*END
`);
    const ids = new Set(lintLsDynaDeck(deck).map((d) => d.id));
    assert.ok(ids.has("LSD3001"), "Expected LSD3001 undefined node");
    assert.ok(ids.has("LSD3002"), "Expected LSD3002 undefined part");
    assert.ok(ids.has("LSD3003"), "Expected LSD3003 undefined section");
    assert.ok(ids.has("LSD3004"), "Expected LSD3004 undefined material");
    assert.ok(ids.has("LSD3005"), "Expected LSD3005 undefined BC/load target");
  });

  it("detects invalid material bounds (E <= 0, rho <= 0, nu >= 0.5, Et > E) and CFL timestep warnings", () => {
    const deck = parseLsDynaDeck(`*KEYWORD
*NODE
1, 0.0, 0.0, 0.0
2, 0.1, 0.0, 0.0
*ELEMENT_BEAM
1, 1, 1, 2
*PART
BadMat
1, 1, 1
*SECTION_BEAM
1, 3, 1.0
0.01
*MAT_PLASTIC_KINEMATIC
1, -10.0, 0.0, 0.52, -50.0, 1.0e12, 1.0
*MAT_ELASTIC
2, 7850.0, 2.1e11, 0.3
*ELEMENT_BEAM
2, 2, 1, 2
*PART
GoodMat
2, 1, 2
*BOUNDARY_SPC_NODE
1, 0, 1, 1, 1, 1, 1, 1
*CONTROL_TERMINATION
0.01
*CONTROL_TIMESTEP
0.05, 1.2
*END
`);
    const ids = new Set(lintLsDynaDeck(deck).map((d) => d.id));
    assert.ok(ids.has("LSD4001"), "Expected LSD4001 non-positive E");
    assert.ok(ids.has("LSD4002"), "Expected LSD4002 non-positive density");
    assert.ok(ids.has("LSD4003"), "Expected LSD4003 invalid Poisson's ratio");
    assert.ok(ids.has("LSD5003"), "Expected LSD5003 CFL timestep warning");
    assert.ok(ids.has("LSD5006"), "Expected LSD5006 invalid plasticity parameters");
  });
});
