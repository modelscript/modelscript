// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ContractAlgebra, type AssumeGuaranteeContract } from "../src/contract-verifier.js";

describe("SysML v2 Compositional Contract Algebra", () => {
  it("should certify valid contract refinement C_sub <= C_super", () => {
    // cSuper: assumes voltage >= 10, guarantees current <= 20
    const cSuper: AssumeGuaranteeContract = {
      name: "BatteryInterfaceSuper",
      assumptions: ["voltage >= 10"],
      guarantees: ["current <= 20"],
    };

    // cSub: assumes voltage >= 8 (weaker), guarantees current <= 15 (stronger)
    const cSub: AssumeGuaranteeContract = {
      name: "BatteryInterfaceSub",
      assumptions: ["voltage >= 8"],
      guarantees: ["current <= 15"],
    };

    const res = ContractAlgebra.refines(cSub, cSuper);
    assert.strictEqual(res.isRefined, true);
    assert.strictEqual(res.assumptionViolations.length, 0);
    assert.strictEqual(res.guaranteeViolations.length, 0);
    assert.ok(res.summary.includes("successfully refines"));
  });

  it("should reject invalid contract refinement when assumption is too strong", () => {
    const cSuper: AssumeGuaranteeContract = {
      name: "BatterySuper",
      assumptions: ["voltage >= 10"],
      guarantees: ["current <= 20"],
    };

    // cBad: assumes voltage >= 12 (stronger assumption! cannot accept 10V input)
    const cBad: AssumeGuaranteeContract = {
      name: "BatteryBad",
      assumptions: ["voltage >= 12"],
      guarantees: ["current <= 15"],
    };

    const res = ContractAlgebra.refines(cBad, cSuper);
    assert.strictEqual(res.isRefined, false);
    assert.ok(res.assumptionViolations.length > 0);
  });

  it("should compute parallel composition and discharge internal mutual assumptions", () => {
    // Component 1: Sensor assumes power >= 5, guarantees dataRate <= 100
    const cSensor: AssumeGuaranteeContract = {
      name: "Sensor",
      assumptions: ["power >= 5"],
      guarantees: ["dataRate <= 100"],
    };

    // Component 2: Battery assumes temp <= 50, guarantees power >= 12
    const cBattery: AssumeGuaranteeContract = {
      name: "Battery",
      assumptions: ["temp <= 50"],
      guarantees: ["power >= 12"],
    };

    const composite = ContractAlgebra.composeParallel(cSensor, cBattery);

    // Guaranteed power >= 12 from Battery discharges Sensor's assumption power >= 5!
    // External assumptions should only contain temp <= 50.
    assert.strictEqual(composite.assumptions.length, 1);
    assert.strictEqual(composite.assumptions[0], "temp <= 50");
    assert.ok(composite.guarantees.includes("dataRate <= 100"));
    assert.ok(composite.guarantees.includes("power >= 12"));
  });

  it("should compute quotient contract C_sys / C_1", () => {
    const cSys: AssumeGuaranteeContract = {
      name: "SystemSpec",
      assumptions: ["ambientTemp <= 40"],
      guarantees: ["deliveredThrust >= 500"],
    };

    const cMotor: AssumeGuaranteeContract = {
      name: "MotorSpec",
      assumptions: ["current >= 50"],
      guarantees: ["deliveredTorque >= 200"],
    };

    const cPropeller = ContractAlgebra.quotient(cSys, cMotor, "PropellerSpec");

    assert.strictEqual(cPropeller.name, "PropellerSpec");
    assert.ok(cPropeller.assumptions.includes("ambientTemp <= 40"));
    assert.ok(cPropeller.assumptions.includes("deliveredTorque >= 200"));
    assert.ok(cPropeller.guarantees.includes("deliveredThrust >= 500"));
  });
});
