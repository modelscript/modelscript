// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lintApdl } from "../src/lints/index.js";

describe("APDL Lints & Diagnostics (APDL1001–APDL5006)", () => {
  it("reports zero diagnostics on a well-formed APDL cantilever beam script", () => {
    const src = `
/TITLE, Clean Cantilever
/UNITS, SI
/PREP7
L = 2.0
ET, 1, BEAM188
MP, EX, 1, 210e9
MP, PRXY, 1, 0.3
MP, DENS, 1, 7850
SECTYPE, 1, BEAM, RECT
SECDATA, 0.05, 0.10
N, 1, 0, 0, 0
N, 2, L, 0, 0
E, 1, 2
FINISH
/SOLU
ANTYPE, STATIC
D, 1, ALL, 0
F, 2, FY, -1000
SOLVE
FINISH
`;
    const diags = lintApdl(src);
    assert.strictEqual(diags.length, 0, `Expected 0 diagnostics, got: ${JSON.stringify(diags)}`);
  });

  it("detects APDL1001 syntax errors, APDL1002 unmatched *DO, and APDL1003 unmatched *IF", () => {
    const src = `
X = (1 + 2
*DO, I, 1, 5
  Y = I
*ENDDO
*ENDDO
*IF, X, GT, 0, THEN
  Z = 1
`;
    const diags = lintApdl(src);
    const codes = new Set(diags.map((d) => d.code));
    assert.ok(codes.has("APDL1001"), "Should report APDL1001 syntax error");
    assert.ok(codes.has("APDL1002"), "Should report APDL1002 unmatched *ENDDO");
    assert.ok(codes.has("APDL1003"), "Should report APDL1003 unclosed *IF");
  });

  it("detects APDL2001 undefined parameter and APDL2002/2003/2004 undefined node/ET/MAT", () => {
    const src = `
/PREP7
Y = UNKNOWN_VAR + 5
TYPE, 9
MAT, 7
N, 1, 0, 0, 0
E, 1, 99
FINISH
`;
    const diags = lintApdl(src);
    const codes = new Set(diags.map((d) => d.code));
    assert.ok(codes.has("APDL2001"), "Should report APDL2001 undefined parameter");
    assert.ok(codes.has("APDL2002"), "Should report APDL2002 undefined node 99");
    assert.ok(codes.has("APDL2003"), "Should report APDL2003 undefined ET 9");
    assert.ok(codes.has("APDL2004"), "Should report APDL2004 undefined MAT 7");
  });

  it("detects APDL3001 non-positive EX, APDL3002 invalid PRXY, and APDL3003 non-positive DENS", () => {
    const src = `
/PREP7
MP, EX, 1, -100
MP, PRXY, 1, 0.5
MP, DENS, 1, 0
FINISH
`;
    const diags = lintApdl(src);
    const codes = new Set(diags.map((d) => d.code));
    assert.ok(codes.has("APDL3001"), "Should report APDL3001 non-positive EX");
    assert.ok(codes.has("APDL3002"), "Should report APDL3002 invalid PRXY");
    assert.ok(codes.has("APDL3003"), "Should report APDL3003 non-positive DENS");
  });

  it("detects APDL4001 rigid-body motion (SOLVE without D) and APDL5001/5002 wrong processor", () => {
    const src = `
/PREP7
ET, 1, BEAM188
MP, EX, 1, 210e9
N, 1, 0, 0, 0
N, 2, 1, 0, 0
E, 1, 2
SOLVE
FINISH
/SOLU
ET, 2, LINK180
ANTYPE, STATIC
F, 2, FY, -100
SOLVE
FINISH
`;
    const diags = lintApdl(src);
    const codes = new Set(diags.map((d) => d.code));
    assert.ok(codes.has("APDL4001"), "Should report APDL4001 rigid-body motion");
    assert.ok(codes.has("APDL5001"), "Should report APDL5001 ET in /SOLU");
    assert.ok(codes.has("APDL5002"), "Should report APDL5002 SOLVE in /PREP7");
  });

  it("detects APDL5004 duplicate node, APDL5005 degenerate element, and APDL5006 empty *DO loop", () => {
    const src = `
/PREP7
ET, 1, LINK180
MP, EX, 1, 210e9
N, 1, 0, 0, 0
N, 1, 1, 0, 0
E, 1, 1
*DO, K, 10, 1, 1
  X = K
*ENDDO
FINISH
`;
    const diags = lintApdl(src);
    const codes = new Set(diags.map((d) => d.code));
    assert.ok(codes.has("APDL5004"), "Should report APDL5004 duplicate node");
    assert.ok(codes.has("APDL5005"), "Should report APDL5005 degenerate element");
    assert.ok(codes.has("APDL5006"), "Should report APDL5006 empty *DO loop");
  });
});
