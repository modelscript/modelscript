// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseSindaDeck, sindaToModelica } from "../src/index.js";

describe("@modelscript/sinda — Modelica.Thermal.HeatTransfer Projection", () => {
  it("projects diffusion, arithmetic, boundary nodes, linear/radiation conductors, and sources to Modelica", () => {
    const deck = `
HEADER OPTIONS DATA
  TITLE = "Spacecraft Radiator"
HEADER NODE DATA
   1, 320.0, 500.0
   2, 300.0, 0.0
  -99, 4.0, 0.0
HEADER CONDUCTOR DATA
   10, 1, 2, 3.5
  -20, 2, 99, 0.9
HEADER SOURCE DATA
   1, 100.0
END OF DATA
`;

    const model = parseSindaDeck(deck);
    const mo = sindaToModelica(model);

    assert.ok(mo.includes("model Spacecraft_Radiator"), "Expected sanitized Modelica model header");
    assert.ok(mo.includes("import HT = Modelica.Thermal.HeatTransfer;"), "Expected HeatTransfer import");
    assert.ok(mo.includes("HT.Components.HeatCapacitor node_1(C = 500.0, T(start = 320.0, fixed = true));"));
    assert.ok(mo.includes("HT.Interfaces.HeatPort_a arith_2(T(start = 300.0));"));
    assert.ok(mo.includes("HT.Sources.FixedTemperature bc_99(T = 4.0);"));
    assert.ok(mo.includes("HT.Components.ThermalConductor cond_10(G = 3.5);"));
    assert.ok(mo.includes("HT.Components.BodyRadiation rad_20(Gr = 0.9);"));
    assert.ok(mo.includes("HT.Sources.FixedHeatFlow src_1(Q_flow = 100.0);"));
    assert.ok(mo.includes("connect(node_1.port, cond_10.port_a);"));
    assert.ok(mo.includes("connect(rad_20.port_b, bc_99.port);"));
    assert.ok(mo.includes("connect(src_1.port, node_1.port);"));
    assert.ok(mo.includes("end Spacecraft_Radiator;"));
  });
});
