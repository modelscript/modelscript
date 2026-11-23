// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { acslToModelica } from "../src/projections/index.js";

describe("ACSL to Modelica Projection", () => {
  it("projects continuous states, parameters, REALPL, DISCRETE sampling, and TERMT to valid Modelica", () => {
    const src = `
PROGRAM CTRL_LOOP
  INITIAL
    CONSTANT kp = 2.0, tau = 0.5
    x0 = 0.0
  END
  DYNAMIC
    DERIVATIVE
      u = STEP(1.0)
      y = REALPL(tau, u, 0.0)
      err = kp * (u - y)
      x = INTEG(err, x0)
    END
    DISCRETE zoh
      INTERVAL ts = 0.1
      y_hold = y
    END
    TERMT(t .GE. 10.0, 'Done')
  END
END
`;
    const mo = acslToModelica(src);
    assert.ok(mo.includes("model CTRL_LOOP"));
    assert.ok(mo.includes("parameter Real kp = 2.0;"));
    assert.ok(mo.includes("parameter Real tau = 0.5;"));
    assert.ok(mo.includes("der(x) = err;"));
    assert.ok(mo.includes("tau * der(y) + y = u;"));
    assert.ok(mo.includes("when sample(0.0, 0.1) then"));
    assert.ok(mo.includes('terminate("Done");'));
    assert.ok(mo.includes("end CTRL_LOOP;"));
  });
});
