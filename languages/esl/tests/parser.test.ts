// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseEsl } from "../src/index.js";

describe("@modelscript/esl Parser Suite", () => {
  it("parses STUDY, PACKAGE, SUBMODEL, MODEL, SEGMENT, and all sections with -- comments", () => {
    const src = `
-- ESA ESL Orbital & Attitude Study
STUDY OrbitStudy
  PACKAGE Constants
    CONSTANT REAL: MU = 3.986004418e14;
    CONSTANT REAL: G0 = 9.80665;
  END PACKAGE Constants

  SUBMODEL AttCtrl(IN REAL: err; OUT REAL: u)
    CONSTANT REAL: KP = 2.5;
  DYNAMIC
    u = -KP * err;
  END SUBMODEL AttCtrl

  MODEL Spacecraft
    REAL: theta, omega, u;
    INTEGER: mode = 0;
    LOGICAL: active = TRUE;
  INITIAL
    theta = 0.5;
    omega = 0.0;
  DYNAMIC
    AttCtrl(theta, u);
    theta' = omega;
    omega' = u;
    IF theta > 0.1 THEN
      mode = 1;
    ELSE
      mode = 0;
    END_IF
    WHEN theta <= 0.0 THEN
      active := FALSE;
    END_WHEN
  STEP
    mode = mode + 1;
  TERMINAL
    active = FALSE;
  END MODEL Spacecraft

  SEGMENT PostFlight
    REAL: metric = 0.0;
  DYNAMIC
    metric = 1.0;
  END SEGMENT PostFlight
END STUDY OrbitStudy
`;

    const program = parseEsl(src);
    assert.strictEqual(
      program.syntaxErrors.length,
      0,
      `Unexpected syntax errors: ${JSON.stringify(program.syntaxErrors)}`,
    );
    assert.strictEqual(program.studies.length, 1);
    assert.strictEqual(program.packages.size, 1);
    assert.strictEqual(program.submodels.size, 1);
    assert.strictEqual(program.models.size, 1);
    assert.strictEqual(program.segments.size, 1);

    const sc = program.models.get("Spacecraft")!;
    assert.ok(sc);
    assert.strictEqual(sc.declarations.length, 5);
    assert.strictEqual(sc.initialStatements.length, 2);
    assert.strictEqual(sc.dynamicStatements.length, 5);
    assert.strictEqual(sc.stepStatements.length, 1);
    assert.strictEqual(sc.terminalStatements.length, 1);

    const sub = program.submodels.get("AttCtrl")!;
    assert.ok(sub);
    assert.strictEqual(sub.parameters.length, 2);
    assert.strictEqual(sub.parameters[0]!.name, "err");
    assert.strictEqual(sub.parameters[1]!.name, "u");
  });

  it("parses prime derivative notation and expressions with operator precedence", () => {
    const src = `
MODEL Harmonic
  CONSTANT REAL: wn = 2.0;
  REAL: x, v;
INITIAL
  x = 1.0;
  v = 0.0;
DYNAMIC
  x' = v;
  v' = -wn ** 2 * x;
END Harmonic
`;
    const program = parseEsl(src);
    assert.strictEqual(program.syntaxErrors.length, 0);
    const m = program.models.get("Harmonic")!;
    assert.strictEqual(m.dynamicStatements.length, 2);
    const eq1 = m.dynamicStatements[0]!;
    assert.strictEqual(eq1.kind, "assign");
    if (eq1.kind === "assign") {
      assert.strictEqual(eq1.isDerivative, true);
      assert.strictEqual(eq1.target, "x");
    }
    const eq2 = m.dynamicStatements[1]!;
    assert.strictEqual(eq2.kind, "assign");
    if (eq2.kind === "assign") {
      assert.strictEqual(eq2.isDerivative, true);
      assert.strictEqual(eq2.target, "v");
    }
  });

  it("records syntax errors on malformed input", () => {
    const src = `
MODEL Broken
  REAL: x = "unterminated
  DYNAMIC
  WHEN x < 0
    x = 1.0
  END_WHEN
END Broken
`;
    const program = parseEsl(src);
    assert.ok(program.syntaxErrors.length >= 2, "Expected syntax errors for unterminated string and missing THEN");
  });
});
