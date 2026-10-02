// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ContractAlgebra,
  checkSymbolicEntailment,
  exportContractToNuXmv,
  verifyAssumeGuaranteePair,
  verifyTemporalContractSymbolic,
} from "../src/contract-verifier.js";

describe("SysML v2 Assume-Guarantee (A/G) Contract Verifier", () => {
  it("should verify compatible interface contract where guarantees satisfy assumptions", () => {
    const supplierGuarantees = ["p.voltage >= 380", "p.voltage <= 420"];
    const consumerAssumptions = ["p.voltage >= 350", "p.voltage <= 450"];

    const result = verifyAssumeGuaranteePair(
      "Battery.p",
      "MotorInverter.p",
      supplierGuarantees,
      consumerAssumptions,
      "powerConnection",
    );

    assert.strictEqual(result.isSatisfied, true, "Contract must be satisfied");
    assert.strictEqual(result.violations.length, 0);
  });

  it("should detect lower bound contract violation with counterexample", () => {
    // Supplier only guarantees voltage >= 320, but consumer requires at least 350
    const supplierGuarantees = ["p.voltage >= 320", "p.voltage <= 400"];
    const consumerAssumptions = ["p.voltage >= 350"];

    const result = verifyAssumeGuaranteePair(
      "WeakBattery.p",
      "MotorInverter.p",
      supplierGuarantees,
      consumerAssumptions,
      "powerConnection",
    );

    assert.strictEqual(result.isSatisfied, false, "Contract should fail due to voltage under-delivery");
    assert.strictEqual(result.violations.length, 1);
    const v = result.violations[0]!;
    assert.strictEqual(v.variable, "voltage");
    assert.strictEqual(v.counterexample, 320);
    assert(v.reason.includes("Supplier 'WeakBattery.p' can deliver voltage = 320"));
  });

  it("should detect upper bound contract violation with counterexample", () => {
    // Supplier might push up to 150A, but consumer can only accept 100A
    const supplierGuarantees = ["current <= 150"];
    const consumerAssumptions = ["current <= 100"];

    const result = verifyAssumeGuaranteePair(
      "HighCurrentSupply",
      "SensitiveLoad",
      supplierGuarantees,
      consumerAssumptions,
      "line1",
    );

    assert.strictEqual(result.isSatisfied, false, "Contract should fail due to current over-delivery");
    assert.strictEqual(result.violations.length, 1);
    const v = result.violations[0]!;
    assert.strictEqual(v.variable, "current");
    assert.strictEqual(v.counterexample, 150);
  });

  it("should verify multi-variable interface contracts", () => {
    const supplierGuarantees = ["voltage >= 380", "voltage <= 400", "current <= 50"];
    const consumerAssumptions = ["voltage >= 360", "current <= 60"];

    const result = verifyAssumeGuaranteePair(
      "SubsystemA",
      "SubsystemB",
      supplierGuarantees,
      consumerAssumptions,
      "busConn",
    );

    assert.strictEqual(result.isSatisfied, true);
    assert.strictEqual(result.violations.length, 0);
  });

  it("should symbolically verify temporal contract A => G", () => {
    const validContract = {
      name: "SafeSpeedContract",
      assumption: "speed >= 10 && speed <= 50",
      guarantee: "speed >= 5 && speed <= 60",
    };
    const validRes = verifyTemporalContractSymbolic(validContract);
    assert.strictEqual(validRes.isSatisfied, true);

    const violatingContract = {
      name: "ViolatingSpeedContract",
      assumption: "speed >= 10 && speed <= 70",
      guarantee: "speed <= 60",
    };
    const failRes = verifyTemporalContractSymbolic(violatingContract);
    assert.strictEqual(failRes.isSatisfied, false);
    assert(
      failRes.reason?.includes("does not satisfy") || failRes.reason?.includes("does not symbolically imply"),
      `Expected failure reason, got: ${failRes.reason}`,
    );
  });

  it("should export temporal and interface contracts to standard nuXmv / OCRA SMV syntax", () => {
    const agContract = {
      name: "BatterySubsystem",
      assumptions: ["temp >= 0", "temp <= 50"],
      guarantees: ["voltage >= 380", "voltage <= 420"],
      inputs: ["temp"],
      outputs: ["voltage"],
    };

    const smv = exportContractToNuXmv(agContract);
    assert(smv.includes("MODULE main"));
    assert(smv.includes("VAR"));
    assert(smv.includes("voltage : real;"));
    assert(smv.includes("temp : real;"));
    assert(smv.includes("INVAR temp >= 0 & temp <= 50;"));
    assert(smv.includes("INVARSPEC voltage >= 380 & voltage <= 420;"));

    const tempContract = {
      name: "TemporalSafety",
      assumption: "pressure >= 10",
      guarantee: "flowRate <= 100",
      timeHorizon: [0, 10] as [number, number],
    };
    const tempSmv = exportContractToNuXmv(tempContract);
    assert(tempSmv.includes("LTLSPEC G ((pressure >= 10) -> (flowRate <= 100));"));
  });

  it("should verify system composition with ContractAlgebra", () => {
    const sysContract = {
      name: "PowertrainSystem",
      assumptions: ["ambientTemp >= -20", "ambientTemp <= 50"],
      guarantees: ["speed >= 0", "speed <= 120"],
    };

    const motorContract = {
      name: "MotorContract",
      assumptions: ["ambientTemp >= -20"],
      guarantees: ["torque >= 0", "torque <= 300"],
    };

    const transmissionContract = {
      name: "TransmissionContract",
      assumptions: ["torque <= 300"],
      guarantees: ["speed >= 0", "speed <= 120"],
    };

    const compRes = ContractAlgebra.verifySystemComposition(sysContract, [motorContract, transmissionContract]);
    assert.strictEqual(compRes.isCompatible, true);
    assert.strictEqual(compRes.isRefined, true);
  });

  it("should preserve qualified variable paths and require portMapping for mismatched component scopes", () => {
    // motor1.temp guarantee must NOT satisfy motor2.temp assumption without explicit port mapping
    const resultUnmapped = verifyAssumeGuaranteePair(
      "Motor1",
      "Motor2",
      ["motor1.temp <= 50"],
      ["motor2.temp <= 50"],
      "thermalBus",
    );
    assert.strictEqual(resultUnmapped.isSatisfied, false, "Must fail because motor1.temp != motor2.temp");
    assert.strictEqual(resultUnmapped.violations.length, 1);

    // With explicit portMapping, translation succeeds
    const resultMapped = verifyAssumeGuaranteePair(
      "Motor1",
      "Motor2",
      ["motor1.temp <= 50"],
      ["motor2.temp <= 50"],
      "thermalBus",
      new Map([["motor1", "motor2"]]),
    );
    assert.strictEqual(resultMapped.isSatisfied, true, "Must succeed with valid portMapping");
    assert.strictEqual(resultMapped.violations.length, 0);
  });

  it("should recognize vacuous entailment when premises are contradictory", () => {
    // False => anything is vacuously True in first-order logic
    const res = checkSymbolicEntailment(["x >= 10", "x <= 5"], "y == 42");
    assert.strictEqual(res.entailed, true, "Contradictory premises must vacuously entail any conclusion");
  });

  it("should find counterexamples beyond small bounds in expanded search box", () => {
    // x >= 200,000 does NOT imply x >= 500,000; counterexample must be found in [200000, 500000]
    const res = checkSymbolicEntailment(["x >= 200000"], "x >= 500000");
    assert.strictEqual(res.entailed, false);
    assert.ok(res.counterexample, "Counterexample should be produced");
    const xInterval = res.counterexample["x"];
    assert.ok(xInterval, "Counterexample for x must exist");
    assert.ok(
      xInterval[0] >= 199999 && xInterval[1] <= 500001,
      `Counterexample [${xInterval[0]}, ${xInterval[1]}] must fall in [200000, 500000]`,
    );
  });

  it("should detect unsound instantaneous circular assume-guarantee dependencies", () => {
    const sysContract = {
      name: "FeedbackSystem",
      assumptions: [],
      guarantees: ["out_a >= 10"],
    };

    // ComponentA assumes out_b <= 50, guarantees out_a >= 10
    const compA = {
      name: "ComponentA",
      assumptions: ["out_b <= 50"],
      guarantees: ["out_a >= 10"],
    };

    // ComponentB assumes out_a >= 10, guarantees out_b <= 50 (Instantaneous circular dependency!)
    const compB = {
      name: "ComponentB",
      assumptions: ["out_a >= 10"],
      guarantees: ["out_b <= 50"],
    };

    const compRes = ContractAlgebra.verifySystemComposition(sysContract, [compA, compB]);
    assert.strictEqual(compRes.isCompatible, false, "Instantaneous circular AG dependency must fail compatibility");
    const circDiag = compRes.compatibilityViolations.find((v) =>
      v.reason.includes("Circular assume-guarantee dependency"),
    );
    assert.ok(circDiag, "Should flag circular assume-guarantee dependency diagnostic");
    assert.ok(circDiag.reason.includes("ComponentA -> ComponentB -> ComponentA"));

    // If temporal delay is present (e.g. prev(out_a)), circular dependency is sound
    const compBWithDelay = {
      name: "ComponentB",
      assumptions: ["prev(out_a) >= 10"],
      guarantees: ["out_b <= 50"],
    };
    const compResDelay = ContractAlgebra.verifySystemComposition(sysContract, [compA, compBWithDelay]);
    const circDiagDelay = compResDelay.compatibilityViolations.find((v) =>
      v.reason.includes("Circular assume-guarantee dependency"),
    );
    assert.strictEqual(circDiagDelay, undefined, "Temporal delay breaks unsound instantaneous algebraic cycle");
  });
});
