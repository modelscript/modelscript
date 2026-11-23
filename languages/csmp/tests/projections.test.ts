// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { csmpToModelica, parseCsmpDeck } from "../src/index.js";

describe("@modelscript/csmp — Modelica Projection", () => {
  it("projects a CSMP/360 damped oscillator deck to valid Modelica 3.6 code", () => {
    const deck = `
TITLE SpringMassOscillator
CONST G = 9.81
PARAM M = 1.0, C = 0.4, K = 4.0
INCON X0 = 1.0, V0 = 0.0
DYNAMIC
SORT
  XDD = (-C * XD - K * X) / M
  XD = INTGRL(V0, XDD)
  X = INTGRL(X0, XD)
TIMER FINTIM = 10.0, DELT = 0.01, PRDEL = 0.1
END
`;
    const mo = csmpToModelica(parseCsmpDeck(deck));

    assert.ok(mo.includes("model SpringMassOscillator"), "Expected Modelica model header");
    assert.ok(mo.includes("constant Real G = 9.81;"), "Expected constant Real declaration");
    assert.ok(mo.includes("parameter Real M = 1;"), "Expected parameter Real declaration");
    assert.ok(mo.includes("Real X(start = X0, fixed = true);"), "Expected state start attribute");
    assert.ok(mo.includes("initial equation"), "Expected initial equation section");
    assert.ok(mo.includes("der(X) = XD;"), "Expected der(X) = XD equation");
    assert.ok(mo.includes("der(XD) = XDD;"), "Expected der(XD) = XDD equation");
    assert.ok(mo.includes("annotation(experiment(StopTime = 10, Interval = 0.1));"), "Expected experiment annotation");
    assert.ok(mo.includes("end SpringMassOscillator;"), "Expected closing end model");
  });

  it("projects REALPL, CMPXPL, LIMIT, and STEP expressions into Modelica equations", () => {
    const deck = `
TITLE ServoController
DYNAMIC
  U = LIMIT(-1.0, 1.0, STEP(0.5))
  Y1 = REALPL(0.0, 0.2, U)
  Y2 = CMPXPL(0.0, 0.0, 0.7, 3.0, Y1)
TIMER FINTIM = 5.0, DELT = 0.01
END
`;
    const mo = csmpToModelica(parseCsmpDeck(deck));
    assert.ok(mo.includes("if time >= 0.5 then 1.0 else 0.0"), "Expected STEP translation");
    assert.ok(mo.includes("min(1.0, max((-1.0),"), "Expected LIMIT translation");
    assert.ok(mo.includes("der(Y1) = (U - Y1) / 0.2;"), "Expected REALPL ODE translation");
    assert.ok(mo.includes("der(Y2) = Y2_der;"), "Expected CMPXPL 1st state ODE");
    assert.ok(
      mo.includes("der(Y2_der) = Y1 - 2.0 * 0.7 * 3.0 * Y2_der - (3.0^2) * Y2;"),
      "Expected CMPXPL 2nd state ODE",
    );
  });
});
