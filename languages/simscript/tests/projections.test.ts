// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseSimscript } from "../src/parser/index.js";
import { simscriptToModelica } from "../src/projections/index.js";

const SAMPLE_SIMSCRIPT = `
'' MODEL: HarborProjection
PREAMBLE
  PROCESSES
    INCLUDE ARRIVAL
    INCLUDE SHIP
  RESOURCES
    EVERY BERTH
  ACCUMULATE AVG.BUSY AS THE MEAN OF N.X.BERTH
  ACCUMULATE AVG.Q AS THE MEAN OF N.Q.BERTH
END

MAIN
  LET U.BERTH = 4
  ACTIVATE A ARRIVAL NOW
  START SIMULATION
END

PROCESS ARRIVAL
  ACTIVATE A SHIP NOW
  ACTIVATE A ARRIVAL IN EXPONENTIAL.F(2.0, 1) HOURS
END

PROCESS SHIP
  REQUEST 1 BERTH
  WORK EXPONENTIAL.F(5.0, 2) HOURS
  RELINQUISH 1 BERTH
END
`;

describe("SIMSCRIPT II.5 to Modelica Projection", () => {
  it("projects SIMSCRIPT resources, utilization invariants, Little's Law, and ACCUMULATE stats to Modelica", () => {
    const model = parseSimscript(SAMPLE_SIMSCRIPT);
    const mo = simscriptToModelica(model);

    assert.ok(mo.includes("model HarborProjection"), "Expected Modelica model header");
    assert.ok(mo.includes("parameter Real U_BERTH = 4.0"), "Expected BERTH capacity parameter");
    assert.ok(mo.includes("rho_BERTH * (U_BERTH * mu_BERTH) = lambda_BERTH;"), "Expected utilization equation");
    assert.ok(mo.includes("L_BERTH = lambda_BERTH * W_BERTH;"), "Expected Little's Law equation");
    assert.ok(mo.includes("der(Q_BERTH) = lambda_BERTH - busy_BERTH * mu_BERTH;"), "Expected fluid queue ODE");
    assert.ok(mo.includes("accumulate_AVG_BUSY = busy_BERTH;"), "Expected ACCUMULATE busy binding");
    assert.ok(mo.includes("accumulate_AVG_Q = Q_BERTH;"), "Expected ACCUMULATE queue binding");
    assert.ok(mo.includes("end HarborProjection;"), "Expected Modelica end statement");
  });
});
