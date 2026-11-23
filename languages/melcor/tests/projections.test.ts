// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseMelcor } from "../src/parser/melcor-parser.js";
import { melcorToModelica } from "../src/projections/melcor-to-modelica.js";
import { melcorToRelap5 } from "../src/projections/melcor-to-relap5.js";

const DECK_SRC = `MELGEN_INPUT
TITLE 'PWR_LOCA_Projection'
EXEC_INPUT
  EXEC_TEND 50.0
  EXEC_DT 0.05 0.5 1.0e-5
CVH_INPUT
  CV_ID 'Vessel' 100 NORMAL
  CV_THR 1.55e7 580.0
  CV_PAS 80.0 0.0 10.0
  CV_ID 'Containment' 200 NORMAL
  CV_THR 1.01325e5 310.0
  CV_PAS 45000.0 0.0 30.0
FL_INPUT
  FL_ID 'BreakPath' 10
  FL_FT 100 200
  FL_GEO 0.05 1.2 1.0
  FL_USL 1.5 2.0
HS_INPUT
  HS_ID 'Wall' 1 CYLINDRICAL
  HS_GD 0.15 100.0
  HS_LB 100 1000.0
  HS_RB 200 50.0
  HS_TEMP 560.0
COR_INPUT
  COR_RP 3 5 3.0e9
  COR_ZDF 85000.0 350.0 600.0 4500.0 20000.0
  COR_PWR 3.0e7 3.0e9
  COR_OX ON URBANIC_HEIDRICK
END
`;

describe("@modelscript/melcor — Projections (Modelica & RELAP5)", () => {
  it("projects MELCOR deck to valid Modelica 3.x source", () => {
    const deck = parseMelcor(DECK_SRC);
    const mo = melcorToModelica(deck);

    assert.ok(mo.includes("model PWR_LOCA_Projection"));
    assert.ok(mo.includes("der(m_cv_100)"));
    assert.ok(mo.includes("der(U_cv_100)"));
    assert.ok(mo.includes("der(mdot_fl_10)"));
    assert.ok(mo.includes("der(T_hs_1)"));
    assert.ok(mo.includes("m_cor * cp_cor * der(T_cor) = Q_decay;"));
    assert.ok(mo.includes("der(w2_ox)"));
    assert.ok(mo.includes("end PWR_LOCA_Projection;"));
  });

  it("projects MELCOR deck to US NRC RELAP5-3D card deck format", () => {
    const deck = parseMelcor(DECK_SRC);
    const r5 = melcorToRelap5(deck);

    assert.ok(r5.includes("= PWR_LOCA_Projection"));
    assert.ok(r5.includes("0000100 new transnt"));
    assert.ok(r5.includes("0000201"));
    assert.ok(r5.includes("snglvol"));
    assert.ok(r5.includes("sngljun"));
    assert.ok(r5.includes("10010000"));
    assert.ok(r5.trimEnd().endsWith("."));
  });
});
