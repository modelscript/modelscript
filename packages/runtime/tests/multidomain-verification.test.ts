// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import {
  CaeContractOracle,
  MarineMooringTheoryOracle,
  MultiDomainVerificationCoordinator,
  PowerGridTheoryOracle,
  type RequirementContractSpec,
} from "../src/index.js";

test("Multi-Domain Formal Verification — Nelson-Oppen Coordinator (@modelscript/runtime)", async (t) => {
  await t.test("PowerGridTheoryOracle: verifies bus voltages, reactive power, and IEEE 2800 clauses", () => {
    const oracle = new PowerGridTheoryOracle();

    // 1. Assert compliant grid state
    oracle.assertBusVoltage({
      busId: 101,
      busName: "Substation_Alpha",
      actualVm: 1.02,
      minVm: 0.95,
      maxVm: 1.05,
      baseKv: 230,
    });
    oracle.assertReactivePower({
      genId: "G1",
      busId: 101,
      actualQgMvar: 25.0,
      minQgMvar: -50.0,
      maxQgMvar: 100.0,
    });
    oracle.assertBranchLoading({
      fromBus: 101,
      toBus: 102,
      actualMva: 140.0,
      rateMva: 200.0,
      loadingPercent: 70.0,
    });
    oracle.assertIeee2800Clause({
      clause: "7.2.2.3.4",
      name: "Reactive Current Injection Droop (k2)",
      isCompliant: true,
      actualValue: 2.5,
      threshold: 2.0,
      operator: ">=",
      unit: "",
    });

    const satRes = oracle.checkSat();
    assert.equal(satRes.isSat, true, "Compliant power grid state should be SAT");

    // Check shared equality propagation
    const eqs = oracle.propagateEqualities();
    assert.ok(eqs.some((e) => e.varA === "grid.bus_voltage.101" && e.bounds?.[0] === 1.02));
    assert.ok(eqs.some((e) => e.varA === "grid.ieee2800.7.2.2.3.4"));

    // 2. Introduce under-voltage violation
    oracle.pushLevel();
    oracle.assertBusVoltage({
      busId: 103,
      busName: "Remote_Feeder",
      actualVm: 0.89, // Severe under-voltage
      minVm: 0.95,
      maxVm: 1.05,
    });
    const failRes = oracle.checkSat();
    assert.equal(failRes.isSat, false, "Under-voltage bus should cause UNSAT");
    assert.ok(failRes.conflict?.explanation.includes("under-voltage"));
    assert.ok(failRes.conflict?.culpritEntities.includes("103"));
    oracle.popLevel();

    // 3. Introduce thermal overload
    oracle.pushLevel();
    oracle.assertBranchLoading({
      fromBus: 101,
      toBus: 105,
      actualMva: 245.0,
      rateMva: 200.0,
      loadingPercent: 122.5, // 122.5% overload
    });
    const overloadRes = oracle.checkSat();
    assert.equal(overloadRes.isSat, false, "Thermal overload must cause UNSAT");
    assert.ok(overloadRes.conflict?.explanation.includes("thermal loading 122.5%"));
    oracle.popLevel();
  });

  await t.test("MarineMooringTheoryOracle: verifies DNV-OS-E301 safety factors and anchor uplift", () => {
    const oracle = new MarineMooringTheoryOracle();

    // 1. Compliant 3-line spread mooring
    oracle.assertMooringLine({
      lineId: "ML_01",
      lineName: "Mooring Line 1 (Bow)",
      mbl: 12.5e6, // 12.5 MN
      tensionIntact: 5.2e6, // 5.2 MN
      safetyFactorIntact: 12.5 / 5.2, // SF = 2.40 >= 1.67
      passedIntact: true,
      consequenceClass: 2,
      anchorUpliftDeg: 0.0,
      anchorUpliftPassed: true,
    });
    oracle.assertFloaterExcursion({
      floaterId: "SemiSub_Platform",
      actualOffsetMeters: 6.8,
      maxAllowableOffsetMeters: 15.0,
    });

    const satRes = oracle.checkSat();
    assert.equal(satRes.isSat, true, "Compliant mooring lines and offset must be SAT");

    const eqs = oracle.propagateEqualities();
    assert.ok(eqs.some((e) => e.varA === "mooring.safety_factor.ML_01"));
    assert.ok(eqs.some((e) => e.varA === "floater.offset.SemiSub_Platform"));

    // 2. Introduce insufficient safety factor (over-tension)
    oracle.pushLevel();
    oracle.assertMooringLine({
      lineId: "ML_02",
      lineName: "Mooring Line 2 (Stern)",
      mbl: 10.0e6,
      tensionIntact: 7.5e6,
      safetyFactorIntact: 10.0 / 7.5, // SF = 1.33 < 1.67
      passedIntact: false,
      consequenceClass: 2,
    });
    const failRes = oracle.checkSat();
    assert.equal(failRes.isSat, false, "Sub-1.67 safety factor must cause UNSAT");
    assert.ok(failRes.conflict?.explanation.includes("DNV-OS-E301 Mooring Compliance Failure"));
    assert.ok(failRes.conflict?.culpritEntities.includes("ML_02"));
    oracle.popLevel();

    // 3. Introduce anchor uplift violation
    oracle.pushLevel();
    oracle.assertMooringLine({
      lineId: "ML_03",
      mbl: 15.0e6,
      tensionIntact: 6.0e6,
      safetyFactorIntact: 2.5,
      passedIntact: true,
      anchorUpliftDeg: 5.4, // Drag embedment anchor cannot sustain vertical uplift
      anchorUpliftPassed: false,
    });
    const upliftRes = oracle.checkSat();
    assert.equal(upliftRes.isSat, false, "Anchor uplift angle > 0 deg must cause UNSAT");
    assert.ok(upliftRes.conflict?.explanation.includes("vertical anchor uplift"));
    oracle.popLevel();
  });

  await t.test("CaeContractOracle: verifies FEA stress and CFD aerodynamic contracts", () => {
    const oracle = new CaeContractOracle();

    // FEA structural yield verification
    oracle.assertFeaStressContract({
      partName: "rotor_hub",
      maxVonMisesStressPa: 185e6, // 185 MPa
      yieldStrengthPa: 250e6, // 250 MPa yield
    });

    // CFD aerodynamic drag verification
    oracle.assertCfdAerodynamicContract({
      partName: "nacelle_fairing",
      dragCoeff: 0.28,
      maxDragCoeff: 0.35,
      liftDragRatio: 12.5,
      minLiftDragRatio: 8.0,
    });

    const satRes = oracle.checkSat();
    assert.equal(satRes.isSat, true, "Stress within yield and Cd below limit must be SAT");

    const eqs = oracle.propagateEqualities();
    assert.ok(eqs.some((e) => e.varA === "fea.von_mises_stress"));
    assert.ok(eqs.some((e) => e.varA === "cfd.drag_coeff"));

    // Breach yield strength
    oracle.pushLevel();
    oracle.assertFeaStressContract({
      partName: "tower_base",
      maxVonMisesStressPa: 310e6, // 310 MPa
      yieldStrengthPa: 275e6, // 275 MPa yield
    });
    const failRes = oracle.checkSat();
    assert.equal(failRes.isSat, false, "Stress exceeding yield must cause UNSAT");
    assert.ok(failRes.conflict?.explanation.includes("CAE Contract Violation"));
    oracle.popLevel();
  });

  await t.test(
    "MultiDomainVerificationCoordinator: proves SAT across 4 physics domains and issues ProofManifest",
    () => {
      const coordinator = new MultiDomainVerificationCoordinator();

      const requirements: RequirementContractSpec[] = [
        { id: "REQ-GRID-V", variable: "voltage_pu", operator: ">=", limitValue: 0.95, unit: "p.u." },
        { id: "REQ-MOOR-SF", variable: "mooring_safety_factor", operator: ">=", limitValue: 1.67 },
        { id: "REQ-HUB-STRESS", variable: "von_mises_stress", operator: "<=", limitValue: 250e6, unit: "Pa" },
        { id: "REQ-AERO-DRAG", variable: "drag_coeff", operator: "<=", limitValue: 0.32 },
      ];

      const decks = {
        powerGrid: {
          busOverrides: [{ busId: 1, busName: "PCC_Bus", actualVm: 1.01, minVm: 0.95, maxVm: 1.05 }],
        },
        marineMooring: {
          lineOverrides: [{ lineId: "L1", mbl: 10e6, tensionIntact: 4.5e6, consequenceClass: 2 as const }],
          floaterOffset: { floaterId: "F1", actualOffsetMeters: 5.2, maxAllowableOffsetMeters: 10.0 },
        },
        fea: {
          parts: [{ partName: "RotorHub", maxVonMisesStressPa: 195e6, yieldStrengthPa: 250e6 }],
        },
        cfd: {
          aerodynamics: [{ partName: "BladeSection", dragCoeff: 0.24, maxDragCoeff: 0.32 }],
        },
      };

      const report = coordinator.verify(requirements, decks);
      assert.equal(report.isCertified, true, "All domains conforming must produce certified report");
      assert.equal(report.status, "CERTIFIED_SAFE");
      assert.equal(report.summary.totalRequirements, 4);
      assert.equal(report.summary.satisfiedRequirements, 4);
      assert.equal(report.summary.violatedRequirements, 0);
      assert.ok(report.proofManifest, "Must issue cryptographic DigitalThreadProofManifest");
      assert.equal(report.proofManifest.items[0]?.verificationStatus, "CERTIFIED_SAFE");
      assert.equal(report.proofManifest.isCertifiedCompliant, true);
    },
  );

  await t.test(
    "MultiDomainVerificationCoordinator: detects cross-theory conflict and identifies culprit domain",
    () => {
      const coordinator = new MultiDomainVerificationCoordinator();

      const requirements: RequirementContractSpec[] = [
        { id: "REQ-GRID-V", variable: "voltage_pu", operator: ">=", limitValue: 0.95, unit: "p.u." },
        { id: "REQ-MOOR-SF", variable: "mooring_safety_factor", operator: ">=", limitValue: 1.67 },
        { id: "REQ-HUB-STRESS", variable: "von_mises_stress", operator: "<=", limitValue: 200e6, unit: "Pa" },
      ];

      // Decks where FEA structural stress violates the 200 MPa requirement
      const decks = {
        powerGrid: {
          busOverrides: [{ busId: 1, actualVm: 1.01 }],
        },
        marineMooring: {
          lineOverrides: [{ lineId: "L1", mbl: 10e6, tensionIntact: 4.5e6 }],
        },
        fea: {
          parts: [
            {
              partName: "RotorHub",
              maxVonMisesStressPa: 245e6, // 245 MPa violates REQ-HUB-STRESS (<= 200 MPa)
              yieldStrengthPa: 280e6,
            },
          ],
        },
      };

      const report = coordinator.verify(requirements, decks);
      assert.equal(report.isCertified, false, "Contract violation must prevent certification");
      assert.equal(report.status, "CONTRACT_VIOLATION");
      assert.ok(report.conflict, "Must return conflict clause");
      assert.ok(
        report.diagnosticMessage?.includes("CAE Contract Violation") || report.diagnosticMessage?.includes("RotorHub"),
      );
    },
  );
});
