// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lintEasy5, parseEasy5 } from "../src/index.js";

describe("@modelscript/easy5 Static Linter Suite", () => {
  it("M7001: warns on unconnected input ports", () => {
    const src = `MODEL: OpenLoop
COMPONENTS:
  GA01 TYPE=GP/GA
    XP: K=2.0
`;
    const model = parseEasy5(src);
    const diags = lintEasy5(model);
    assert.ok(diags.some((d) => d.code === 7001 && d.message.includes("GA01.IN")));
  });

  it("M7002: detects direct feedthrough algebraic loops", () => {
    const src = `MODEL: DirectLoop
COMPONENTS:
  GA01 TYPE=GP/GA
    XP: K=2.0
  SJ01 TYPE=GP/SJ
    XP: SGN1=1.0, SGN2=1.0

CONNECTIONS:
  GA01.OUT -> SJ01.IN1
  SJ01.OUT -> GA01.IN
`;
    const model = parseEasy5(src);
    const diags = lintEasy5(model);
    const loopDiag = diags.find((d) => d.code === 7002);
    assert.ok(loopDiag, "Expected M7002 algebraic loop diagnostic");
    assert.ok(loopDiag.message.includes("GA01"));
    assert.ok(loopDiag.message.includes("SJ01"));
  });

  it("does not report M7002 when feedback contains an integrator state", () => {
    const src = `MODEL: StableFeedback
COMPONENTS:
  IN01 TYPE=GP/IN
    XP: GAIN=1.0
  GA01 TYPE=GP/GA
    XP: K=2.0

CONNECTIONS:
  IN01.OUT -> GA01.IN
  GA01.OUT -> IN01.IN
`;
    const model = parseEasy5(src);
    const diags = lintEasy5(model);
    assert.ok(!diags.some((d) => d.code === 7002), "Should not flag loop broken by integrator");
  });

  it("M7005: flags improper transfer function where numerator degree exceeds denominator", () => {
    const src = `MODEL: ImproperTF
COMPONENTS:
  TF01 TYPE=GP/TF
    XP: NUM=[1.0, 2.0, 3.0], DEN=[1.0, 1.0]
`;
    const model = parseEasy5(src);
    const diags = lintEasy5(model);
    assert.ok(diags.some((d) => d.code === 7005 && d.message.includes("TF01")));
  });

  it("M7006: flags invalid limiter bounds (lower limit > upper limit)", () => {
    const src = `MODEL: BadLimiter
COMPONENTS:
  LM01 TYPE=GP/LM
    XP: UL=-5.0, LL=5.0
`;
    const model = parseEasy5(src);
    const diags = lintEasy5(model);
    assert.ok(diags.some((d) => d.code === 7006 && d.message.includes("LL")));
  });

  it("M7010: integrates Fortran syntax/semantic diagnostics in UG components", () => {
    const src = `MODEL: DefectiveFortran
COMPONENTS:
  UG01 TYPE=GP/UG
    PORTS: IN=input, OUT=output
    FORTRAN:
      IMPLICIT NONE
      SD(1) = UNDECLARED_VAR + IN
      OUT = S(1)
    ENDFORTRAN
`;
    const model = parseEasy5(src);
    const diags = lintEasy5(model);
    assert.ok(diags.some((d) => d.code === 7010 && d.message.includes("M4070")));
  });
});
