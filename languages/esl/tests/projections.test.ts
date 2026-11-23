// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { eslToModelica } from "../src/index.js";

describe("@modelscript/esl Modelica Projection Suite", () => {
  it("projects ESL declarations, INITIAL, DYNAMIC, IF/ELSE, and WHEN to Modelica 3.x", () => {
    const src = `
MODEL BouncingBall
  CONSTANT REAL: g = 9.81;
  CONSTANT REAL: e = 0.8;
  REAL: h, v, drag;
INITIAL
  h = 10.0;
  v = 0.0;
DYNAMIC
  IF v < 0.0 THEN
    drag = 0.05 * v * v;
  ELSE
    drag = -0.05 * v * v;
  END_IF
  h' = v;
  v' = -g + drag;
  WHEN h <= 0.0 AND v < 0.0 THEN
    v := -e * v;
    h := 0.0;
  END_WHEN
END MODEL BouncingBall
`;

    const mo = eslToModelica(src);
    assert.ok(mo.includes("model BouncingBall"));
    assert.ok(mo.includes("parameter Real g = 9.81;"));
    assert.ok(mo.includes("initial equation"));
    assert.ok(mo.includes("equation"));
    assert.ok(mo.includes("der(h) = v;"));
    assert.ok(mo.includes("der(v) = (-(g) + drag);"));
    assert.ok(mo.includes("if (v < 0.0) then"));
    assert.ok(mo.includes("when ((h <= 0.0) and (v < 0.0)) then"));
    assert.ok(mo.includes("reinit(v, (-(e) * v));"));
    assert.ok(mo.includes("end when;"));
    assert.ok(mo.includes("end BouncingBall;"));
  });
});
