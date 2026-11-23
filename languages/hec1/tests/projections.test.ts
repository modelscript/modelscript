// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hec1ToHms, hec1ToModelica, parseHec1Deck } from "../src/index.js";

describe("@modelscript/hec1 — Polyglot Projections (HEC-HMS & Modelica)", () => {
  const deck = parseHec1Deck(
    [
      "ID CASTRO VALLEY WATERSHED",
      "IT 15 01JUN90 0000 100",
      "KK SUB1",
      "KM Upper urbanized basin",
      "BA 5.5",
      "PB 4.2",
      "PI 0.2 0.8 1.8 1.0 0.4",
      "LS 0.4 82 25",
      "UC 1.5 2.0",
      "KK RCH1",
      "RM 3 1.2 0.2",
      "KK SUB2",
      "BA 3.5",
      "PB 4.2",
      "LS 0.5 72 10",
      "UD 1.1",
      "KK JUNC1",
      "HC 2",
      "ZZ",
    ].join("\n"),
  );

  it("projects HEC-1 deck to USACE HEC-HMS .basin and .met files with inferred downstream topology", () => {
    const hms = hec1ToHms(deck);
    assert.ok(hms.basinText.includes("Basin: CASTRO_VALLEY_WATERSHED"));
    assert.ok(hms.basinText.includes("Subbasin: SUB1"));
    assert.ok(hms.basinText.includes("Downstream: RCH1"));
    assert.ok(hms.basinText.includes("Curve Number: 82"));
    assert.ok(hms.basinText.includes("Transform: Clark"));
    assert.ok(hms.basinText.includes("Reach: RCH1"));
    assert.ok(hms.basinText.includes("Route: Muskingum"));
    assert.ok(hms.basinText.includes("Muskingum K: 1.2"));
    assert.ok(hms.basinText.includes("Downstream: JUNC1"));
    assert.ok(hms.basinText.includes("Junction: JUNC1"));

    assert.ok(hms.metText.includes("Meteorology: CASTRO_VALLEY_WATERSHED_Met"));
    assert.ok(hms.metText.includes("Subbasin: SUB1"));
    assert.ok(hms.metText.includes("Total Storm Depth: 4.2"));
    assert.ok(hms.metText.includes("Incremental Depth: 0.2 0.8 1.8 1 0.4"));
  });

  it("projects HEC-1 deck to executable Modelica .mo code with watershed & Muskingum ODEs", () => {
    const mo = hec1ToModelica(deck, { modelName: "CastroValley" });
    assert.ok(mo.includes("model CastroValley"));
    assert.ok(mo.includes("parameter Real A_SUB1 = 5.5;"));
    assert.ok(mo.includes("der(S_SUB1) = P_net_SUB1 - Q_SUB1;"));
    assert.ok(mo.includes("Q_SUB1 = S_SUB1 / R_SUB1;"));
    assert.ok(mo.includes("der(S_reach_RCH1) = Q_SUB1 - Q_RCH1;"));
    assert.ok(mo.includes("S_reach_RCH1 = K_RCH1 * (X_RCH1 * Q_SUB1 + (1.0 - X_RCH1) * Q_RCH1);"));
    assert.ok(mo.includes("Q_JUNC1 = Q_SUB2 + Q_RCH1;"));
    assert.ok(mo.includes("end CastroValley;"));
  });
});
