// SPDX-License-Identifier: AGPL-3.0-or-later

import { DAEBuilder } from "@modelscript/runtime";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { acslToDae, lowerAcslToDae } from "../src/dae/index.js";
import { parseAcsl } from "../src/parser/index.js";

describe("ACSL Direct DAEBuilder Arena Lowering", () => {
  it("lowers continuous states, parameters, algebraic equations, and discrete blocks into DAEBuilder", () => {
    const src = `
PROGRAM HYBRID_OSC
  INITIAL
    CONSTANT wn = 2.0, zeta = 0.1
    x_init = 1.0
  END
  DYNAMIC
    DERIVATIVE
      acc = -wn**2 * x - 2.0 * zeta * wn * v
      v = INTEG(acc, 0.0)
      x = INTEG(v, x_init)
      y_filt = REALPL(0.5, x, 0.0)
    END
    DISCRETE sampler
      INTERVAL ts = 0.1
      x_sampled = x
    END
  END
END
`;
    const program = parseAcsl(src);
    const builder = new DAEBuilder(undefined, "HYBRID_OSC");
    const res = lowerAcslToDae(builder, program);

    assert.strictEqual(res.stateVarIndices.length, 3, "Expected 3 continuous states (v, x, y_filt)");
    assert.ok(res.parameterVarIndices.length >= 2, "Expected >=2 parameters (wn, zeta)");
    assert.strictEqual(res.discreteVarIndices.length, 1, "Expected 1 discrete variable (x_sampled)");
    assert.ok(res.equationCount >= 6, `Expected >=6 equations, got ${res.equationCount}`);
    assert.ok(builder.varCount >= 6);
    assert.ok(builder.eqCount >= 6);
  });

  it("supports one-shot acslToDae(source) convenience wrapper", () => {
    const dae = acslToDae(`
PROGRAM SECOND_ORDER
  DYNAMIC
    DERIVATIVE
      y = CMPXPL(1.0, 0.5, 1.0, 0.0, 0.0)
    END
  END
END
`);
    assert.ok(dae.varCount >= 2, "CMPXPL should introduce position & velocity state vars");
    assert.ok(dae.eqCount >= 2, "CMPXPL should emit 2 first-order differential equations");
  });
});
