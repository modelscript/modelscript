// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { verifyAssumeGuaranteePair } from "../src/contract-verifier.js";

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
});
