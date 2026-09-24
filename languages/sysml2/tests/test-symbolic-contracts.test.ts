// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { type AssumeGuaranteeContract, checkSymbolicEntailment, ContractAlgebra } from "../src/contract-verifier.js";

describe("SMT-Powered Symbolic Compositional Contract Verification (OCRA / SAVVS)", () => {
  it("should symbolically prove linear entailment across multiple constraints", () => {
    const premises = ["voltage >= 380", "voltage <= 400", "current <= 20"];
    // Conclusion: voltage >= 350 and current <= 25
    const res = checkSymbolicEntailment(premises, "voltage >= 350 && current <= 25");
    assert.strictEqual(res.entailed, true);
  });

  it("should symbolically prove non-linear contract entailment via DPLL(T) + HC4", () => {
    // Premise: radius^2 <= 25 (meaning radius in [-5, 5])
    const premises = ["radius^2 <= 25"];
    // Conclusion: radius <= 5.0
    const res = checkSymbolicEntailment(premises, "radius <= 5.0");
    assert.strictEqual(res.entailed, true);

    // Failing non-linear conclusion: radius <= 2.0 (should fail with counterexample box)
    const failRes = checkSymbolicEntailment(premises, "radius <= 2.0");
    assert.strictEqual(failRes.entailed, false);
    assert(failRes.counterexample !== undefined);
  });

  it("should verify 3-component system compositional compatibility and refinement", () => {
    // System Contract: Top-level Electric Powertrain
    const sysContract: AssumeGuaranteeContract = {
      name: "ElectricPowertrainSys",
      assumptions: ["gridVoltage >= 380", "gridVoltage <= 420"],
      guarantees: ["wheelTorque >= 250", "wheelTorque <= 300"],
    };

    // Subcomponent 1: BatteryPack
    const battery: AssumeGuaranteeContract = {
      name: "BatteryPack",
      assumptions: ["gridVoltage >= 350"], // Satisfied by sysContract assumption [380, 420]
      guarantees: ["dcBusVoltage >= 390", "dcBusVoltage <= 410"],
    };

    // Subcomponent 2: Inverter
    const inverter: AssumeGuaranteeContract = {
      name: "Inverter",
      assumptions: ["dcBusVoltage >= 380", "dcBusVoltage <= 420"], // Satisfied by battery guarantees [390, 410]
      guarantees: ["motorCurrent >= 80", "motorCurrent <= 100"],
    };

    // Subcomponent 3: TractionMotor
    const motor: AssumeGuaranteeContract = {
      name: "TractionMotor",
      assumptions: ["motorCurrent >= 70"], // Satisfied by inverter guarantee [80, 100]
      guarantees: ["wheelTorque >= 260", "wheelTorque <= 290"], // Satisfies sysContract guarantee [250, 300]
    };

    const proof = ContractAlgebra.verifySystemComposition(sysContract, [battery, inverter, motor]);

    assert.strictEqual(proof.isCompatible, true, "All subcomponents must be mutually compatible");
    assert.strictEqual(proof.isRefined, true, "Subcomponents must refine system guarantees");
    assert.strictEqual(proof.compatibilityViolations.length, 0);
    assert.strictEqual(proof.refinementViolations.length, 0);
  });

  it("should detect compatibility failure when a component assumption is violated in the system", () => {
    const sysContract: AssumeGuaranteeContract = {
      name: "SystemSpec",
      assumptions: ["temp <= 40"],
      guarantees: ["outputPower >= 100"],
    };

    const sensor: AssumeGuaranteeContract = {
      name: "Sensor",
      // Sensor assumes temp <= 25, but system environment only guarantees temp <= 40
      assumptions: ["temp <= 25"],
      guarantees: ["signalValid == 1"],
    };

    const actuator: AssumeGuaranteeContract = {
      name: "Actuator",
      assumptions: ["signalValid == 1"],
      guarantees: ["outputPower >= 100"],
    };

    const proof = ContractAlgebra.verifySystemComposition(sysContract, [sensor, actuator]);

    assert.strictEqual(proof.isCompatible, false);
    assert(proof.compatibilityViolations.length >= 1);
    assert.strictEqual(proof.compatibilityViolations[0]?.component, "Sensor");
    assert(proof.compatibilityViolations[0]?.missingAssumption.includes("temp <= 25"));
  });
});
