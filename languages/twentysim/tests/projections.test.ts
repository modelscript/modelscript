// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { twentySimToModelica } from "../src/projections/index.js";

describe("20-sim to Modelica Projection", () => {
  it("projects a Bond Graph model into valid acausal Modelica equations", () => {
    const sid = `
model MSD
  submodels
    Se F (effort = 10);
    OneJunction j1;
    I m (i = 2);
    R b (r = 1);
    C k (c = 0.5);
  connections
    F.p => j1.p;
    j1.p => m.p;
    j1.p => b.p;
    j1.p => k.p;
end MSD;
`;
    const mo = twentySimToModelica(sid);
    assert.ok(mo.includes("model MSD"));
    assert.ok(mo.includes("equation"));
    assert.ok(mo.includes("der(m_p_state) = m_p_e;"));
    assert.ok(mo.includes("der(k_q) = k_p_f;"));
    assert.ok(mo.includes("end MSD;"));
  });
});
