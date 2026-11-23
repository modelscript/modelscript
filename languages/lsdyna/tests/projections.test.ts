// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseLsDynaDeck } from "../src/parser/index.js";
import { lsdynaToAbaqus, lsdynaToModelica } from "../src/projections/index.js";

const SAMPLE_DECK = `*KEYWORD
*TITLE
ImpactBar
*NODE
1, 0.0, 0.0, 0.0
2, 0.5, 0.0, 0.0
3, 1.0, 0.0, 0.0
*ELEMENT_BEAM
1, 1, 1, 2
2, 1, 2, 3
*PART
SteelBar
1, 1, 1
*SECTION_BEAM
1, 3, 1.0
0.002
*MAT_PLASTIC_KINEMATIC
1, 7850.0, 2.1e11, 0.3, 2.5e8, 2.1e9, 1.0
*BOUNDARY_SPC_NODE
1, 0, 1, 1, 1, 1, 1, 1
*DEFINE_CURVE
1, 0, 1.0, 1.0
0.0, 1.0
0.01, 1.0
*LOAD_NODE_POINT
3, 1, 1, 5000.0
*CONTROL_TERMINATION
0.01
*END
`;

describe("@modelscript/lsdyna — Projections (Abaqus .inp & Modelica .mo)", () => {
  it("projects an LS-DYNA deck to an Abaqus .inp explicit dynamics deck", () => {
    const deck = parseLsDynaDeck(SAMPLE_DECK);
    const inp = lsdynaToAbaqus(deck);

    assert.ok(inp.includes("*HEADING"));
    assert.ok(inp.includes("ImpactBar"));
    assert.ok(inp.includes("*NODE"));
    assert.ok(inp.includes("*ELEMENT, TYPE=T3D2, ELSET=PART_1"));
    assert.ok(inp.includes("*MATERIAL, NAME=MAT_1"));
    assert.ok(inp.includes("*DENSITY"));
    assert.ok(inp.includes("*ELASTIC"));
    assert.ok(inp.includes("*PLASTIC"));
    assert.ok(inp.includes("*AMPLITUDE, NAME=CURVE_1"));
    assert.ok(inp.includes("*DYNAMIC, EXPLICIT"));
    assert.ok(inp.includes("*BOUNDARY"));
    assert.ok(inp.includes("*CLOAD, AMPLITUDE=CURVE_1"));
    assert.ok(inp.includes("*END STEP"));
  });

  it("projects an LS-DYNA deck to a Modelica .mo structural dynamics model", () => {
    const deck = parseLsDynaDeck(SAMPLE_DECK);
    const mo = lsdynaToModelica(deck);

    assert.ok(mo.includes("model ImpactBar"));
    assert.ok(mo.includes("parameter Real cflTimestep ="));
    assert.ok(mo.includes("parameter Real maxWaveSpeed ="));
    assert.ok(mo.includes("Real u_2(start = 0.0);"));
    assert.ok(mo.includes("der(u_2) = v_2;"));
    assert.ok(mo.includes("m_2 * der(v_2) ="));
    assert.ok(mo.includes("KineticEnergy ="));
    assert.ok(mo.includes("InternalEnergy ="));
    assert.ok(mo.includes("TotalEnergy = KineticEnergy + InternalEnergy;"));
    assert.ok(mo.includes("end ImpactBar;"));
  });
});
