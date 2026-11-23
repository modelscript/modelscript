// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lintDynamo, parseDynamo } from "../src/index.js";

describe("@modelscript/dynamo Static Analysis & Linter Suite (DYN1001–DYN5006)", () => {
  it("passes cleanly with zero diagnostics on a valid DYNAMO model", () => {
    const valid = `
NOTE EXPONENTIAL GROWTH
L POP.K=POP.J+(DT)*(BIRTH.JK)
N POP=100
R BIRTH.KL=POP.K*BR
C BR=0.05
SPEC DT=0.25/LENGTH=20
RUN
`;
    const diags = lintDynamo(parseDynamo(valid));
    assert.strictEqual(diags.length, 0, `Expected 0 diagnostics, got: ${JSON.stringify(diags)}`);
  });

  it("reports DYN1001 on syntax errors", () => {
    const bad = `INVALID_CARD X = 1`;
    const diags = lintDynamo(parseDynamo(bad));
    assert.ok(diags.some((d) => d.id === "DYN1001"));
  });

  it("reports DYN2001 on undefined symbols", () => {
    const src = `
L POP.K=POP.J+(DT)*(BIRTH.JK)
N POP=100
R BIRTH.KL=POP.K*UNKNOWN_RATE
`;
    const diags = lintDynamo(parseDynamo(src));
    assert.ok(diags.some((d) => d.id === "DYN2001" && d.symbol === "UNKNOWN_RATE"));
  });

  it("reports DYN2002 on duplicate equation definitions", () => {
    const src = `
C BR=0.05
C BR=0.08
`;
    const diags = lintDynamo(parseDynamo(src));
    assert.ok(diags.some((d) => d.id === "DYN2002" && d.symbol === "BR"));
  });

  it("reports DYN3001 on invalid time subscripts for equation types", () => {
    const src = `
L POP.KL=POP.J+(DT)*(BIRTH.JK)
N POP=100
R BIRTH.K=POP.K*0.05
C RATE.K=0.05
`;
    const diags = lintDynamo(parseDynamo(src));
    const subErrors = diags.filter((d) => d.id === "DYN3001");
    assert.ok(subErrors.length >= 3, `Expected >= 3 DYN3001 diagnostics, got ${subErrors.length}`);
  });

  it("reports DYN4001 when a Level equation is missing an N initial equation", () => {
    const src = `
L STOCK.K=STOCK.J+(DT)*(INFLOW.JK)
R INFLOW.KL=5
`;
    const diags = lintDynamo(parseDynamo(src));
    assert.ok(diags.some((d) => d.id === "DYN4001" && d.symbol === "STOCK"));
  });

  it("reports DYN4002 on non-positive SPEC DT or LENGTH", () => {
    const src = `
C K=1
SPEC DT=0/LENGTH=-10
`;
    const diags = lintDynamo(parseDynamo(src));
    const specErrors = diags.filter((d) => d.id === "DYN4002");
    assert.strictEqual(specErrors.length, 2);
  });

  it("reports DYN5006 on simultaneous auxiliary algebraic cycles", () => {
    const src = `
A X.K=Y.K+1
A Y.K=Z.K*2
A Z.K=X.K-3
`;
    const diags = lintDynamo(parseDynamo(src));
    assert.ok(diags.some((d) => d.id === "DYN5006"));
  });
});
