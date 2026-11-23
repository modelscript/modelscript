// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EslErrorCode, lintEslSource } from "../src/index.js";

describe("@modelscript/esl Linter Suite (ESL1001–ESL5006)", () => {
  it("reports zero diagnostics for a valid ESL model", () => {
    const valid = `
MODEL ValidBall
  CONSTANT REAL: g = 9.81;
  REAL: y, v;
INITIAL
  y = 10.0;
  v = 0.0;
DYNAMIC
  y' = v;
  v' = -g;
  WHEN y <= 0.0 AND v < 0.0 THEN
    v := -0.8 * v;
    y := 0.0;
  END_WHEN
END MODEL ValidBall
`;
    const diags = lintEslSource(valid);
    assert.strictEqual(diags.length, 0, `Expected 0 diagnostics, got: ${JSON.stringify(diags)}`);
  });

  it("detects ESL1001 syntax error", () => {
    const src = `
MODEL BadSyntax
  REAL: x;
DYNAMIC
  WHEN x < 0.0
    x = 1.0;
  END_WHEN
END MODEL BadSyntax
`;
    const diags = lintEslSource(src);
    assert.ok(diags.some((d) => d.id === EslErrorCode.SYNTAX_ERROR.id));
  });

  it("detects ESL2001 duplicate declaration", () => {
    const src = `
MODEL DupModel
  REAL: x;
  REAL: x;
DYNAMIC
  x' = -x;
END MODEL DupModel
`;
    const diags = lintEslSource(src);
    assert.ok(diags.some((d) => d.id === EslErrorCode.DUPLICATE_DECLARATION.id));
  });

  it("detects ESL2002 undefined identifier", () => {
    const src = `
MODEL UndefModel
  REAL: x;
DYNAMIC
  x' = -k_missing * x;
END MODEL UndefModel
`;
    const diags = lintEslSource(src);
    assert.ok(diags.some((d) => d.id === EslErrorCode.UNDEFINED_IDENTIFIER.id && d.symbolName === "k_missing"));
  });

  it("detects ESL3001 invalid derivative target on CONSTANT and INTEGER", () => {
    const src = `
MODEL BadDeriv
  CONSTANT REAL: c = 5.0;
  INTEGER: n = 1;
DYNAMIC
  c' = 1.0;
  n' = 2.0;
END MODEL BadDeriv
`;
    const diags = lintEslSource(src);
    const derivDiags = diags.filter((d) => d.id === EslErrorCode.INVALID_DERIVATIVE_TARGET.id);
    assert.strictEqual(derivDiags.length, 2);
  });

  it("detects ESL4001 mismatched MODEL/END", () => {
    const src = `
MODEL Alpha
  REAL: x;
DYNAMIC
  x' = -x;
END MODEL Beta
`;
    const diags = lintEslSource(src);
    assert.ok(diags.some((d) => d.id === EslErrorCode.MISMATCHED_BLOCK_END.id));
  });

  it("detects ESL5001 invalid WHEN discontinuity expression", () => {
    const src = `
MODEL BadWhen
  CONSTANT REAL: c = 1.0;
  REAL: x;
DYNAMIC
  x' = 1.0;
  WHEN c > 0.0 THEN
    x := 0.0;
  END_WHEN
  WHEN x + 1.0 THEN
    x := 0.0;
  END_WHEN
END MODEL BadWhen
`;
    const diags = lintEslSource(src);
    const whenDiags = diags.filter((d) => d.id === EslErrorCode.INVALID_WHEN_DISCONTINUITY.id);
    assert.strictEqual(whenDiags.length, 2);
  });

  it("detects ESL5006 submodel arity mismatch", () => {
    const src = `
STUDY TestStudy
  SUBMODEL GainBlock(IN REAL: u; IN REAL: k; OUT REAL: y)
  DYNAMIC
    y = k * u;
  END SUBMODEL GainBlock

  MODEL Plant
    REAL: u, y;
  DYNAMIC
    u = 1.0;
    GainBlock(u, y);
  END MODEL Plant
END STUDY TestStudy
`;
    const diags = lintEslSource(src);
    assert.ok(diags.some((d) => d.id === EslErrorCode.SUBMODEL_ARITY_MISMATCH.id));
  });
});
