// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CaeContractOracle, DigitalThreadHypergraph, SemanticTheoryCoordinator } from "../src/index.js";

describe("CaeContractOracle: Closed-Loop Digital Thread Formal Requirement Checking", () => {
  it("verifies FEA max stress and CFD drag requirements (SAT vs VIOLATION)", () => {
    const oracle = new CaeContractOracle();

    // 1. SAT Contract: Wing root stress requirement: max stress <= 250 MPa
    oracle.assertContract({
      contractId: "REQ-STR-001",
      metricName: "maxVonMisesStress",
      actualValue: 214.5,
      threshold: 250.0,
      operator: "<=",
      unit: "MPa",
      partName: "WingSpar",
      sourceRunId: "calculix_42",
      sysmlRequirementId: "SysML::Requirement::MaxStress",
    });

    // SAT Contract: Wing drag coefficient requirement: Cd <= 0.035
    oracle.assertContract({
      contractId: "REQ-AERO-002",
      metricName: "dragCoefficient",
      actualValue: 0.0294,
      threshold: 0.035,
      operator: "<=",
      unit: "dimensionless",
      partName: "AirfoilSurface",
      sourceRunId: "su2_108",
      sysmlRequirementId: "SysML::Requirement::DragLimit",
    });

    const satRes = oracle.checkSat();
    assert.equal(satRes.isSat, true, "Valid contracts must be SAT");

    const model = oracle.getModel();
    assert.equal(model["REQ-STR-001"]?.isSatisfied, true);
    assert.ok(model["REQ-STR-001"]!.marginPercent > 0);
    assert.equal(model["REQ-AERO-002"]?.isSatisfied, true);

    // 2. Add violating contract: Overloaded pressure limit
    oracle.assertContract({
      contractId: "REQ-PRES-003",
      metricName: "maxCabinPressureDrop",
      actualValue: 12.8,
      threshold: 10.0,
      operator: "<=",
      unit: "kPa",
      partName: "FuselageBulkhead",
      sourceRunId: "calculix_99",
    });

    const unsatRes = oracle.checkSat();
    assert.equal(unsatRes.isSat, false, "Violated contract must trigger conflict");
    assert.ok(unsatRes.conflict);
    assert.match(unsatRes.conflict.explanation, /CAE Contract Violation/);
    assert.ok(unsatRes.conflict.culpritEntities.includes("REQ-PRES-003"));
    assert.ok(unsatRes.conflict.culpritEntities.includes("FuselageBulkhead"));
    assert.ok(unsatRes.conflict.culpritEntities.includes("Run#calculix_99"));
  });

  it("synchronizes contract verdicts directly into DigitalThreadHypergraph thread slots", () => {
    const oracle = new CaeContractOracle();
    const hypergraph = new DigitalThreadHypergraph();

    const thread1 = 1001;
    const thread2 = 1002;

    oracle.assertContract({
      contractId: "CONTRACT-01",
      metricName: "stress",
      actualValue: 180.0,
      threshold: 200.0,
      operator: "<=",
      hypergraphThreadId: thread1,
    });

    oracle.assertContract({
      contractId: "CONTRACT-02",
      metricName: "drag",
      actualValue: 0.045, // Violates limit 0.03
      threshold: 0.03,
      operator: "<=",
      hypergraphThreadId: thread2,
    });

    const sync = oracle.syncToHypergraph(hypergraph);
    assert.deepEqual(sync.syncedThreads, [thread1]);
    assert.deepEqual(sync.conflictedThreads, [thread2]);

    const slot1 = hypergraph.findSlotByThreadId(thread1)!;
    const slot2 = hypergraph.findSlotByThreadId(thread2)!;

    const rec1 = hypergraph.getRecord(slot1)!;
    const rec2 = hypergraph.getRecord(slot2)!;

    assert.equal(rec1.isSynced, true);
    assert.equal(rec1.isConflicted, false);

    assert.equal(rec2.isConflicted, true);
    assert.ok(hypergraph.getConflict(slot2));
  });

  it("integrates seamlessly into Nelson-Oppen SemanticTheoryCoordinator", () => {
    const coordinator = new SemanticTheoryCoordinator();
    const oracle = new CaeContractOracle();
    coordinator.registerOracle(oracle);

    oracle.assertContract({
      contractId: "THRUST-REQ",
      metricName: "netThrust",
      actualValue: 1540.0,
      threshold: 1500.0,
      operator: ">=",
      unit: "N",
    });

    const res = coordinator.checkSat();
    assert.equal(res.isSat, true);

    const equalities = oracle.propagateEqualities();
    assert.ok(equalities.length >= 1);
    assert.equal(equalities[0]?.varA, "THRUST-REQ.netThrust");
    assert.deepEqual(equalities[0]?.bounds, [1540.0, 1540.0]);
  });
});
