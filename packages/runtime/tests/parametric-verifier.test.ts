// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { verifyParametricBound } from "../src/analysis/parametric_verifier.js";
import { StaticTapeBuilder, TapeOpKind } from "../src/autodiff/wasm_tape.js";

console.log("=== Testing Tier 3 Parametric Worst-Case Bound Verifier (SBB) ===");

{
  // Test case: Power dissipation P = V^2 / R
  // Parameter uncertainties:
  // V in [10, 12] Volts
  // R in [2, 4] Ohms
  // Max power occurs at max V (12) and min R (2): P_max = 144 / 2 = 72.0 Watts
  // Min power occurs at min V (10) and max R (4): P_min = 100 / 4 = 25.0 Watts

  const tape = new StaticTapeBuilder();
  const vNode = tape.pushScalarOp(TapeOpKind.Var, tape.interner.intern("V"));
  const rNode = tape.pushScalarOp(TapeOpKind.Var, tape.interner.intern("R"));
  const v2Node = tape.pushScalarOp(TapeOpKind.Mul, vNode, vNode);
  const pNode = tape.pushScalarOp(TapeOpKind.Div, v2Node, rNode);

  const variables = ["V", "R"];
  const paramBounds = {
    V: [10.0, 12.0] as [number, number],
    R: [2.0, 4.0] as [number, number],
  };

  // 1. Upper bound requirement: P <= 80.0 Watts (SHOULD PASS, worst-case is 72.0)
  const reqPass = {
    name: "Req_MaxPowerDissipation_Safe",
    operator: "<=" as const,
    limitValue: 80.0,
  };

  const resultPass = verifyParametricBound({ ops: tape, outputIndex: pNode }, variables, paramBounds, reqPass);

  assert.strictEqual(resultPass.isCertified, true, "P <= 80.0 should be certified");
  assert.strictEqual(Math.round(resultPass.worstCaseValue), 72);
  assert(resultPass.margin >= 7.5, `Margin should be ~8.0, got ${resultPass.margin}`);
  console.log(`  ✓ Passed parametric requirement: ${resultPass.requirementName}`);
  console.log(
    `    Worst-case value: ${resultPass.worstCaseValue.toFixed(2)} W <= limit ${resultPass.limitValue} W (margin: ${resultPass.margin.toFixed(2)} W)`,
  );

  // 2. Strict upper bound requirement: P <= 65.0 Watts (SHOULD FAIL, worst-case is 72.0 > 65.0)
  const reqFail = {
    name: "Req_MaxPowerDissipation_Strict",
    operator: "<=" as const,
    limitValue: 65.0,
  };

  const resultFail = verifyParametricBound({ ops: tape, outputIndex: pNode }, variables, paramBounds, reqFail);

  assert.strictEqual(resultFail.isCertified, false, "P <= 65.0 must fail verification");
  assert(resultFail.margin < 0, "Violation must have negative margin");
  console.log(`  ✓ Correctly rejected strict requirement: ${resultFail.requirementName}`);
  console.log(
    `    Worst-case value: ${resultFail.worstCaseValue.toFixed(2)} W > limit ${resultFail.limitValue} W (margin: ${resultFail.margin.toFixed(2)} W)`,
  );

  // 3. Lower bound requirement: P >= 20.0 Watts (SHOULD PASS, worst-case min is 25.0 >= 20.0)
  const reqLower = {
    name: "Req_MinPowerDelivery",
    operator: ">=" as const,
    limitValue: 20.0,
  };

  const resultLower = verifyParametricBound({ ops: tape, outputIndex: pNode }, variables, paramBounds, reqLower);

  assert.strictEqual(resultLower.isCertified, true, "P >= 20.0 must pass verification");
  assert.strictEqual(Math.round(resultLower.worstCaseValue), 25);
  console.log(`  ✓ Lower bound requirement certified: ${resultLower.requirementName}`);
  console.log(
    `    Worst-case min value: ${resultLower.worstCaseValue.toFixed(2)} W >= limit ${resultLower.limitValue} W`,
  );
}

console.log("All Tier 3 Parametric SBB Verifier tests passed successfully!");
