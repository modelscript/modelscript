// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EsterelErrorCode } from "../src/errors.js";
import { lintEsterel } from "../src/lints/index.js";

describe("Esterel Lints & Constructive Causality Checker", () => {
  it("accepts clean Berry ABRO with zero diagnostics", () => {
    const src = `
      module ABRO:
      input A, B, R;
      output O;
      loop
        [ await A || await B ];
        emit O
      each R
      end module
    `;
    const diags = lintEsterel(src);
    assert.strictEqual(diags.length, 0, JSON.stringify(diags));
  });

  it("reports EST2001 duplicate module and EST2002 duplicate signal", () => {
    const src = `
      module M:
      input A, A;
      nothing
      end module
      module M:
      nothing
      end module
    `;
    const diags = lintEsterel(src);
    assert.ok(diags.some((d) => d.id === EsterelErrorCode.DUPLICATE_SIGNAL.code));
    assert.ok(diags.some((d) => d.id === EsterelErrorCode.DUPLICATE_MODULE.code));
  });

  it("reports EST2003 undeclared signal and EST5002 emitting an input signal", () => {
    const src = `
      module BadSig:
      input IN1;
      output OUT1;
      emit IN1;
      await GHOST;
      emit OUT1
      end module
    `;
    const diags = lintEsterel(src);
    assert.ok(diags.some((d) => d.id === EsterelErrorCode.EMIT_INPUT_SIGNAL.code));
    assert.ok(diags.some((d) => d.id === EsterelErrorCode.UNDECLARED_SIGNAL.code && d.symbol === "GHOST"));
  });

  it("reports EST4001 instantaneous infinite loop without pause or await", () => {
    const src = `
      module InfLoop:
      output O;
      loop
        emit O
      end
      end module
    `;
    const diags = lintEsterel(src);
    assert.ok(diags.some((d) => d.id === EsterelErrorCode.INSTANTANEOUS_LOOP.code));
  });

  it("does NOT report EST4001 when loop body pauses", () => {
    const src = `
      module SafeLoop:
      output O;
      loop
        emit O;
        pause
      end
      end module
    `;
    const diags = lintEsterel(src);
    assert.strictEqual(diags.length, 0);
  });

  it("reports EST4002 negative constructive causality cycle (present S else emit S)", () => {
    const src = `
      module Paradox:
      output S;
      present S else emit S end
      end module
    `;
    const diags = lintEsterel(src);
    assert.ok(diags.some((d) => d.id === EsterelErrorCode.CAUSALITY_CYCLE_NEGATIVE.code));
  });

  it("reports EST4003 positive causality cycle (present S then emit S)", () => {
    const src = `
      module SelfLoop:
      output S;
      present S then emit S end
      end module
    `;
    const diags = lintEsterel(src);
    assert.ok(diags.some((d) => d.id === EsterelErrorCode.CAUSALITY_CYCLE_POSITIVE.code));
  });

  it("reports EST2004 undefined trap in exit", () => {
    const src = `
      module BadTrap:
      trap T1 in
        exit T2
      end
      end module
    `;
    const diags = lintEsterel(src);
    assert.ok(diags.some((d) => d.id === EsterelErrorCode.UNDEFINED_TRAP.code && d.symbol === "T2"));
  });

  it("reports EST3001 invalid relation conflicts (self-exclusion and exclusion/implication conflict)", () => {
    const src = `
      module BadRel:
      input A, B;
      relation A # A;
      relation A # B, A => B;
      nothing
      end module
    `;
    const diags = lintEsterel(src);
    const relErrs = diags.filter((d) => d.id === EsterelErrorCode.INVALID_RELATION_CONFLICT.code);
    assert.ok(relErrs.length >= 2, JSON.stringify(diags));
  });

  it("reports EST5001 unreachable statement after halt", () => {
    const src = `
      module DeadCode:
      output O;
      halt;
      emit O
      end module
    `;
    const diags = lintEsterel(src);
    assert.ok(diags.some((d) => d.id === EsterelErrorCode.UNREACHABLE_STATEMENT.code));
  });
});
