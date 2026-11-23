// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DATCOM_AIRCRAFT_TEMPLATES } from "../src/catalog/datcom-std-schemas.js";
import { parseDatcomDeck } from "../src/parser/deck-parser.js";
import { datcomToJsbsim, datcomToModelica } from "../src/projections/index.js";

describe("DATCOM Projections (JSBSim XML & Modelica)", () => {
  it("projects Citation-class DATCOM case to valid JSBSim <fdm_config> XML", () => {
    const deck = parseDatcomDeck(DATCOM_AIRCRAFT_TEMPLATES.CITATION_JET);
    const xml = datcomToJsbsim(deck.cases[0]!);

    assert.ok(xml.includes("<fdm_config"));
    assert.ok(xml.includes("</fdm_config>"));
    assert.ok(xml.includes('<wingarea unit="FT2">'));
    assert.ok(xml.includes('<axis name="LIFT">'));
    assert.ok(xml.includes('<axis name="DRAG">'));
    assert.ok(xml.includes('<axis name="PITCH">'));
    assert.ok(xml.includes('<axis name="ROLL">'));
    assert.ok(xml.includes('<axis name="YAW">'));
    assert.ok(xml.includes("aero/moment/Pitch_damp"));
    assert.ok(xml.includes("aero/moment/Roll_damp"));
    assert.ok(xml.includes("aero/moment/Yaw_damp"));
  });

  it("projects Cessna-172 DATCOM case to valid Modelica 6-DOF linearized model", () => {
    const deck = parseDatcomDeck(DATCOM_AIRCRAFT_TEMPLATES.CESSNA_172);
    const mo = datcomToModelica(deck.cases[0]!);

    assert.ok(mo.includes("model CESSNA_172_CLASS_TRAINER"));
    assert.ok(mo.includes("end CESSNA_172_CLASS_TRAINER;"));
    assert.ok(mo.includes("der(u) = Xu * u + Xw * w - g * theta;"));
    assert.ok(mo.includes("der(w) = Zu * u + Zw * w + V0 * q;"));
    assert.ok(mo.includes("der(q) = Mu * u + Mw * w + Mq * q;"));
    assert.ok(mo.includes("der(theta) = q;"));
    assert.ok(mo.includes("der(v) = Yv * v - V0 * r + g * phi;"));
    assert.ok(mo.includes("der(p) = Lv * v + Lp * p + Lr * r;"));
    assert.ok(mo.includes("der(r) = Nv * v + Np * p + Nr * r;"));
    assert.ok(mo.includes("der(phi) = p;"));
  });
});
