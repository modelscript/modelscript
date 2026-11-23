// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lowerMelcorToDae, resolveMelcorSchemaParamDefaults } from "../src/dae/melcor-to-dae.js";
import { parseMelcor } from "../src/parser/melcor-parser.js";

describe("@modelscript/melcor — Direct DAEBuilder Lowering", () => {
  it("lowers CVH, FL, HS, and COR equations into a square DAEBuilder system", () => {
    const deck = parseMelcor(`MELGEN_INPUT
TITLE 'TwoVolumeCoreDAE'
EXEC_INPUT
  EXEC_TEND 10.0
CVH_INPUT
  CV_ID 'Primary' 100 NORMAL
  CV_THR 1.55e7 580.0
  CV_PAS 50.0
  CV_ID 'Containment' 200 NORMAL
  CV_THR 1.0e5 300.0
  CV_PAS 5000.0
FL_INPUT
  FL_ID 'Break' 10
  FL_FT 100 200
  FL_GEO 0.05 1.0 1.0
  FL_USL 1.5 1.5
HS_INPUT
  HS_ID 'VesselWall' 1
  HS_GD 0.1 40.0 31720.0 20.0 500.0 7930.0
  HS_LB 100 1000.0
  HS_RB 200 50.0
  HS_TEMP 550.0
COR_INPUT
  COR_RP 3 5 3.0e9
  COR_ZDF 80000.0 350.0 600.0 4000.0 20000.0
  COR_PWR 2.8e7 3.0e9
  COR_OX ON URBANIC_HEIDRICK
END
`);
    const dae = lowerMelcorToDae(deck);
    const vars = dae.variables();
    const eqs = dae.equations();

    // 2 CVs * 4 vars + 1 FL + 1 HS + 2 COR (T_cor, m_H2) = 12 vars and 12 eqs
    assert.equal(vars.length, 12);
    assert.equal(eqs.length, 12);
    assert.notEqual(dae.lookupVariable("m_cv_100"), -1);
    assert.notEqual(dae.lookupVariable("U_cv_100"), -1);
    assert.notEqual(dae.lookupVariable("P_cv_200"), -1);
    assert.notEqual(dae.lookupVariable("mdot_fl_10"), -1);
    assert.notEqual(dae.lookupVariable("T_hs_1"), -1);
    assert.notEqual(dae.lookupVariable("T_cor"), -1);
    assert.notEqual(dae.lookupVariable("m_H2"), -1);
  });

  it("resolves cleanroom schema parameter defaults with user overrides", () => {
    const params = resolveMelcorSchemaParamDefaults("COR_OX_UH", { cladArea: 5000.0 });
    assert.equal(params["aLow"], 29.6);
    assert.equal(params["eLow"], 16820.0);
    assert.equal(params["cladArea"], 5000.0);
  });
});
