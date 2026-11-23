// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lintMelcor } from "../src/lints/index.js";
import { parseMelcor } from "../src/parser/melcor-parser.js";

describe("@modelscript/melcor — Static Lints (MEL1001 - MEL5006)", () => {
  it("reports zero diagnostics on a valid MELCOR deck", () => {
    const valid = `MELGEN_INPUT
TITLE 'Clean Deck'
EXEC_INPUT
  EXEC_TEND 20.0
  EXEC_DT 0.05 1.0 1.0e-5
CVH_INPUT
  CV_ID 'V1' 100
  CV_THR 5.0e6 550.0
  CV_PAS 20.0
  CV_ID 'V2' 200
  CV_THR 1.0e5 300.0
  CV_PAS 100.0
FL_INPUT
  FL_ID 'F1' 10
  FL_FT 100 200
  FL_GEO 0.05 1.0 1.0
  FL_USL 1.0 1.0
HS_INPUT
  HS_ID 'Wall' 1
  HS_GD 0.05 10.0
  HS_LB 100 500.0
  HS_RB 200 100.0
  HS_TEMP 450.0
END
`;
    const diags = lintMelcor(parseMelcor(valid));
    assert.equal(diags.length, 0, `Expected 0 diagnostics, got: ${JSON.stringify(diags)}`);
  });

  it("detects duplicate CV, FL, HS, CF, TF IDs (MEL2001-MEL2005)", () => {
    const deck = parseMelcor(`EXEC_INPUT
  EXEC_TEND 10.0
CVH_INPUT
  CV_ID 'A' 100
  CV_THR 1e5 300
  CV_PAS 10
  CV_ID 'B' 100
FL_INPUT
  FL_ID 'F1' 1
  FL_FT 100 100
  FL_ID 'F2' 1
HS_INPUT
  HS_ID 'H1' 1
  HS_ID 'H2' 1
CF_INPUT
  CF_ID 'C1' 1 ADD
  CF_ID 'C2' 1 ADD
TF_INPUT
  TF_ID 'T1' 1
  TF_ID 'T2' 1
END
`);
    const codes = new Set(lintMelcor(deck).map((d) => d.code));
    assert.ok(codes.has("MEL2001"));
    assert.ok(codes.has("MEL2002"));
    assert.ok(codes.has("MEL2003"));
    assert.ok(codes.has("MEL2004"));
    assert.ok(codes.has("MEL2005"));
  });

  it("detects undefined flow CVs (MEL3001), HS boundary CVs (MEL3002), and non-positive geometry/thermo (MEL4001-MEL4004)", () => {
    const deck = parseMelcor(`EXEC_INPUT
  EXEC_TEND 10.0
CVH_INPUT
  CV_ID 'BadCV' 100
  CV_THR -100.0 0.0
  CV_PAS -5.0
FL_INPUT
  FL_ID 'BadFL' 10
  FL_FT 100 999
  FL_GEO 0.0 1.0
  FL_USL -0.5 1.0
HS_INPUT
  HS_ID 'BadHS' 1
  HS_LB 100 100.0
  HS_RB 888 100.0
  HS_TEMP -10.0
END
`);
    const codes = new Set(lintMelcor(deck).map((d) => d.code));
    assert.ok(codes.has("MEL3001"));
    assert.ok(codes.has("MEL3002"));
    assert.ok(codes.has("MEL4001"));
    assert.ok(codes.has("MEL4002"));
    assert.ok(codes.has("MEL4003"));
    assert.ok(codes.has("MEL4004"));
    assert.ok(codes.has("MEL5004"));
  });

  it("detects cyclic control functions (MEL5001) and missing EXEC_INPUT time bounds (MEL5002)", () => {
    const deck = parseMelcor(`MELGEN_INPUT
CF_INPUT
  CF_ID 'LoopA' 1 ADD
  CF_ARG CF 2
  CF_ID 'LoopB' 2 ADD
  CF_ARG CF 1
END
`);
    const codes = new Set(lintMelcor(deck).map((d) => d.code));
    assert.ok(codes.has("MEL5001"));
    assert.ok(codes.has("MEL5002"));
  });
});
