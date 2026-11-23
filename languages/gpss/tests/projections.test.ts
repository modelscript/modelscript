// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseGpss } from "../src/parser/index.js";
import { gpssToModelica } from "../src/projections/index.js";

describe("GPSS to Modelica Projection", () => {
  it("projects a GPSS queuing model into valid Modelica 3.x equations with Little's Law", () => {
    const model = parseGpss(`
* MODEL: BarbershopFluid
CHAIRS STORAGE 3
      GENERATE 10,2
      QUEUE    LINE
      SEIZE    JOE
      ENTER    CHAIRS,1
      DEPART   LINE
      ADVANCE  8,2
      LEAVE    CHAIRS,1
      RELEASE  JOE
      TERMINATE 1
      START    100
`);
    const mo = gpssToModelica(model);

    assert.ok(mo.includes("model BarbershopFluid"));
    assert.ok(mo.includes("end BarbershopFluid;"));
    assert.ok(mo.includes("fac_JOE_rho = lambda / mu;"));
    assert.ok(mo.includes("fac_JOE_L = lambda * fac_JOE_W;"));
    assert.ok(mo.includes("sto_CHAIRS_capacity = 3"));
    assert.ok(mo.includes("sto_CHAIRS_R = sto_CHAIRS_capacity - sto_CHAIRS_S;"));
    assert.ok(mo.includes("der(que_LINE_Q) = que_LINE_inflow - que_LINE_outflow;"));
    assert.ok(mo.includes("que_LINE_Q = que_LINE_inflow * que_LINE_Wq;"));
  });
});
