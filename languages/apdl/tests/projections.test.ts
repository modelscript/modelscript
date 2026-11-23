// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { apdlToModelica, apdlToNastranBdf } from "../src/projections/index.js";

const CANTILEVER_APDL = `
/TITLE, CantileverBeamProjection
/PREP7
ET, 1, BEAM188
MP, EX, 1, 210e9
MP, PRXY, 1, 0.3
MP, DENS, 1, 7850
SECTYPE, 1, BEAM, RECT
SECDATA, 0.05, 0.10
K, 1, 0, 0, 0
K, 2, 2.0, 0, 0
L, 1, 2
ESIZE, , 2
LMESH, ALL
FINISH
/SOLU
ANTYPE, STATIC
D, 1, ALL, 0
F, 3, FY, -1000
SOLVE
FINISH
`;

describe("APDL Projections (NASTRAN .bdf & Modelica)", () => {
  it("projects an APDL BEAM188 model to NASTRAN Bulk Data Format (.bdf)", () => {
    const bdf = apdlToNastranBdf(CANTILEVER_APDL);
    assert.ok(bdf.includes("SOL 101"), "Should emit SOL 101 for static analysis");
    assert.ok(bdf.includes("BEGIN BULK"), "Should emit BEGIN BULK");
    assert.ok(bdf.includes("GRID,1,"), "Should emit GRID cards");
    assert.ok(bdf.includes("MAT1,1,"), "Should emit MAT1 material card");
    assert.ok(bdf.includes("PBEAM,1,1,"), "Should emit PBEAM property card");
    assert.ok(bdf.includes("CBEAM,1,1,1,2"), "Should emit CBEAM element cards");
    assert.ok(bdf.includes("SPC1,1,123456,1"), "Should emit SPC1 constraint card");
    assert.ok(bdf.includes("FORCE,1,3,0,"), "Should emit FORCE load card");
    assert.ok(bdf.includes("ENDDATA"), "Should terminate with ENDDATA");
  });

  it("projects an APDL LINK180 modal model to NASTRAN SOL 103 with CROD/PROD/EIGRL", () => {
    const src = `
/TITLE, TrussModal
/PREP7
ET, 1, LINK180
MP, EX, 1, 200e9
MP, DENS, 1, 7850
R, 1, 1e-4
N, 1, 0, 0, 0
N, 2, 1, 0, 0
E, 1, 2
FINISH
/SOLU
ANTYPE, MODAL
MODOPT, LANB, 3
D, 1, ALL, 0
SOLVE
FINISH
`;
    const bdf = apdlToNastranBdf(src);
    assert.ok(bdf.includes("SOL 103"));
    assert.ok(bdf.includes("EIGRL,1,,,3"));
    assert.ok(bdf.includes("PROD,1,1,"));
    assert.ok(bdf.includes("CROD,1,1,1,2"));
  });

  it("projects an APDL model to a valid Modelica structural dynamics model", () => {
    const mo = apdlToModelica(CANTILEVER_APDL, "CantileverModel");
    assert.ok(mo.includes("model CantileverModel"));
    assert.ok(mo.includes("parameter Real E_1 = 210000000000"));
    assert.ok(mo.includes("der(q_1) = v_1;"));
    assert.ok(mo.includes("der(v_1) = Q_1"));
    assert.ok(mo.includes("end CantileverModel;"));
  });
});
