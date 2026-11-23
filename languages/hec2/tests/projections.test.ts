// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseHec2Deck, projectHec2ToHecRas, projectHec2ToModelica } from "../src/index.js";

const SAMPLE_DECK = [
  "T1  CLEAR CREEK BACKWATER STUDY",
  "J1,0,0,0,0,0.001,1,0,60,103.5",
  "NC,0.05,0.05,0.03,0.1,0.3",
  "X1,1000,4,0,15,0,0,0",
  "GR,115,0,100,0,100,15,115,15",
  "X1,1500,4,0,15,500,500,500",
  "GR,115.5,0,100.5,0,100.5,15,115.5,15",
  "EJ",
].join("\n");

describe("@modelscript/hec2 — Projections to HEC-RAS (.g01/.f01) & Modelica", () => {
  it("projects a HEC-2 deck to HEC-RAS .g01 geometry and .f01 steady flow files", () => {
    const deck = parseHec2Deck(SAMPLE_DECK);
    const { geometryG01, steadyFlowF01 } = projectHec2ToHecRas(deck, {
      riverName: "ClearCreek",
      reachName: "Lower",
    });

    assert.ok(geometryG01.includes("Geom Title=CLEAR CREEK BACKWATER STUDY"));
    assert.ok(geometryG01.includes("River Reach=ClearCreek"));
    assert.ok(geometryG01.includes("Type RM Length L Ch R = 1 ,1500"));
    assert.ok(geometryG01.includes("Type RM Length L Ch R = 1 ,1000"));
    assert.ok(geometryG01.includes("#Sta/Elev= 4"));
    assert.ok(geometryG01.includes("Bank Sta=0,15"));
    assert.ok(geometryG01.includes("Exp/Cntr=0.1,0.3"));

    assert.ok(steadyFlowF01.includes("Flow Title=CLEAR CREEK BACKWATER STUDY"));
    assert.ok(steadyFlowF01.includes("River Rch & RM=ClearCreek,Lower,1500"));
    assert.ok(steadyFlowF01.includes("Dn Type= 1"));
    assert.ok(steadyFlowF01.includes("Dn Known WS=103.5"));
  });

  it("projects a HEC-2 deck to a valid Modelica steady hydraulics model", () => {
    const deck = parseHec2Deck(SAMPLE_DECK);
    const mo = projectHec2ToModelica(deck, { modelName: "ClearCreekProfile" });

    assert.ok(mo.includes("model ClearCreekProfile"));
    assert.ok(mo.includes("constant Real g = 9.80665;"));
    assert.ok(mo.includes("parameter Real Q_inflow = 60;"));
    assert.ok(mo.includes("equation"));
    assert.ok(mo.includes("V_s1 * A_s1 = Q_s1;"));
    assert.ok(mo.includes("egl_s2 = egl_s1 +"));
    assert.ok(mo.includes("end ClearCreekProfile;"));
  });
});
