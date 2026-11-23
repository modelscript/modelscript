// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lintAcslSource } from "../src/lints/index.js";

describe("ACSL Static Analysis Linter (ACSL1001–ACSL5006)", () => {
  it("produces zero diagnostics for a valid ACSL model", () => {
    const src = `
PROGRAM VALID_MODEL
  INITIAL
    CONSTANT k = 2.0, x0 = 1.0
    CINTERVAL cint = 0.1
    MAXTERVAL maxt = 0.01
    ALGORITHM ialg = 5
  END
  DYNAMIC
    DERIVATIVE
      xdot = -k * x
      x = INTEG(xdot, x0)
    END
    TERMT(t .GE. 5.0)
  END
END
`;
    const diags = lintAcslSource(src);
    assert.strictEqual(diags.length, 0, `Unexpected diagnostics: ${JSON.stringify(diags)}`);
  });

  it("detects syntax errors (ACSL1001) and mismatched END (ACSL1002)", () => {
    const src = `
PROGRAM BROKEN
  INITIAL
    CONSTANT k = 1.0
    @@@ invalid statement
  DYNAMIC
    DERIVATIVE
      x = INTEG(-k * x, 1.0)
    END
  END
`;
    const diags = lintAcslSource(src);
    assert.ok(
      diags.some((d) => d.id === "ACSL1001"),
      "Expected ACSL1001",
    );
    assert.ok(
      diags.some((d) => d.id === "ACSL1002"),
      "Expected ACSL1002",
    );
  });

  it("detects duplicate symbols (ACSL2001) and undefined variables (ACSL2002)", () => {
    const src = `
PROGRAM SYM_ERR
  INITIAL
    CONSTANT k = 1.0
    CONSTANT k = 2.0
  END
  DYNAMIC
    DERIVATIVE
      x = INTEG(-k * x + ghost_var, 1.0)
    END
  END
END
`;
    const diags = lintAcslSource(src);
    assert.ok(
      diags.some((d) => d.id === "ACSL2001"),
      "Expected ACSL2001",
    );
    assert.ok(
      diags.some((d) => d.id === "ACSL2002" && d.symbol === "GHOST_VAR"),
      "Expected ACSL2002",
    );
  });

  it("detects invalid section placement (ACSL3001)", () => {
    const src = `
PROGRAM BAD_SECTION
  INITIAL
    DERIVATIVE
      x = INTEG(-x, 1.0)
    END
  END
END
`;
    const diags = lintAcslSource(src);
    assert.ok(
      diags.some((d) => d.id === "ACSL3001"),
      "Expected ACSL3001",
    );
  });

  it("detects uninitialized integrator (ACSL4001) and non-positive CINTERVAL/MAXTERVAL (ACSL4002/ACSL4003)", () => {
    const src = `
PROGRAM BAD_CTRL
  INITIAL
    CINTERVAL cint = 0.0
    MAXTERVAL maxt = -0.01
    ALGORITHM ialg = 99
  END
  DYNAMIC
    DERIVATIVE
      x = INTEG(-x)
    END
    TERMT(.FALSE.)
  END
END
`;
    const diags = lintAcslSource(src);
    assert.ok(
      diags.some((d) => d.id === "ACSL4001"),
      "Expected ACSL4001",
    );
    assert.ok(
      diags.some((d) => d.id === "ACSL4002"),
      "Expected ACSL4002",
    );
    assert.ok(
      diags.some((d) => d.id === "ACSL4003"),
      "Expected ACSL4003",
    );
    assert.ok(
      diags.some((d) => d.id === "ACSL5002"),
      "Expected ACSL5002",
    );
    assert.ok(
      diags.some((d) => d.id === "ACSL5003"),
      "Expected ACSL5003",
    );
  });

  it("detects cyclic algebraic loops (ACSL5001), table mismatch (ACSL5005), and missing SCHEDULE target (ACSL5006)", () => {
    const src = `
PROGRAM ALG_LOOP
  INITIAL
    TABLE badt, 1, 3 / 0.0, 1.0, 2.0, 10.0, 20.0 /
  END
  DYNAMIC
    DERIVATIVE
      a = b + 1.0
      b = a * 2.0
      SCHEDULE nonexistent_blk .AT. 1.0
    END
  END
END
`;
    const diags = lintAcslSource(src);
    assert.ok(
      diags.some((d) => d.id === "ACSL5001"),
      "Expected ACSL5001",
    );
    assert.ok(
      diags.some((d) => d.id === "ACSL5005"),
      "Expected ACSL5005",
    );
    assert.ok(
      diags.some((d) => d.id === "ACSL5006"),
      "Expected ACSL5006",
    );
  });
});
