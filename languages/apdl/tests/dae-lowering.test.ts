// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { apdlToDae } from "../src/dae/index.js";

describe("APDL Structural Equilibrium & Dynamics DAE Lowering", () => {
  it("lowers a BEAM188 cantilever beam to DAEBuilder with material params, static displacements, and modal ODEs", () => {
    const src = `
/TITLE, CantileverDAE
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
ESIZE, , 4
LMESH, ALL
FINISH
/SOLU
ANTYPE, STATIC
D, 1, ALL, 0
F, 5, FY, -1000
SOLVE
FINISH
`;
    const dae = apdlToDae(src, { numModes: 3, dampingRatio: 0.03 });
    assert.ok(dae.varCount > 10, `Expected >10 DAE variables, got ${dae.varCount}`);
    assert.ok(dae.eqCount >= 8, `Expected >=8 DAE equations, got ${dae.eqCount}`);

    const varNames = dae.getVariables().map((v) => v.name);
    assert.ok(varNames.includes("MAT1_EX"), "Should emit MAT1_EX parameter");
    assert.ok(varNames.includes("StrainEnergy"), "Should emit StrainEnergy output");
    assert.ok(varNames.includes("MaxDisplacement"), "Should emit MaxDisplacement output");
    assert.ok(varNames.includes("q_1"), "Should emit modal displacement q_1");
    assert.ok(varNames.includes("v_1"), "Should emit modal velocity v_1");
    assert.ok(varNames.includes("N5_UY"), "Should emit nodal displacement N5_UY");
  });

  it("lowers a LINK180 truss model cleanly to DAEBuilder", () => {
    const src = `
/TITLE, TrussDAE
/PREP7
ET, 1, LINK180
MP, EX, 1, 200e9
MP, DENS, 1, 7850
R, 1, 1e-4
N, 1, 0, 0, 0
N, 2, 2, 0, 0
N, 3, 1, 1, 0
E, 1, 3
E, 2, 3
FINISH
/SOLU
ANTYPE, STATIC
D, 1, ALL, 0
D, 2, ALL, 0
F, 3, FY, -5000
SOLVE
FINISH
`;
    const dae = apdlToDae(src, { numModes: 2 });
    assert.ok(dae.varCount >= 10);
    assert.ok(dae.eqCount >= 6);
  });
});
