// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DigitalThreadHypergraph,
  SafetyTheoryOracle,
  SemanticTheoryCoordinator,
  StlMonitor,
  ThreadDomain,
  ThreadRelation,
} from "../src/index.js";

import { ComplianceMatrixGenerator } from "@modelscript/exchange";

describe("Phase 4: Safety & Certification Thread (FTA, STL Barriers & Compliance)", () => {
  describe("SafetyTheoryOracle & ISO 26262 Fault Tree Analysis", () => {
    it("computes Minimal Cut Sets, PMHF, and detects ASIL-D Single-Point Failures", () => {
      const oracle = new SafetyTheoryOracle(10000); // 10,000 hr mission life

      // Component failure modes (rates in /hr: 1e-9 /hr = 1 FIT)
      oracle.registerFailureMode({
        id: "fm_mcu_primary",
        componentName: "PrimaryMCU",
        modeName: "lockup",
        failureRatePerHour: 20e-9, // 20 FIT
        diagnosticCoverage: 0.99,
        severityScore: 10,
      });

      oracle.registerFailureMode({
        id: "fm_mcu_secondary",
        componentName: "SecondaryMCU",
        modeName: "lockup",
        failureRatePerHour: 20e-9, // 20 FIT
        diagnosticCoverage: 0.99,
        severityScore: 10,
      });

      oracle.registerFailureMode({
        id: "fm_hydraulic_valve",
        componentName: "HydraulicValve",
        modeName: "stuck_closed",
        failureRatePerHour: 50e-9, // 50 FIT
        diagnosticCoverage: 0.0, // No safety mechanism yet! Unmitigated SPF!
        severityScore: 10,
      });

      // Fault Tree definition:
      // Top: Hazard_BrakingLoss = OR(HydraulicBranch, DualMcuFailure)
      // DualMcuFailure = AND(PrimaryMCU, SecondaryMCU)
      oracle.registerFtaNode({
        id: "top_gate",
        name: "Loss of Braking Actuation",
        gateType: "OR",
        children: ["gate_hydraulic", "gate_dual_mcu"],
      });

      oracle.registerFtaNode({
        id: "gate_hydraulic",
        name: "Hydraulic Valve Stuck",
        gateType: "PRIMARY_EVENT",
        children: [],
        failureModeId: "fm_hydraulic_valve",
      });

      oracle.registerFtaNode({
        id: "gate_dual_mcu",
        name: "Dual MCU Redundancy Exhaustion",
        gateType: "AND",
        children: ["leaf_mcu_prim", "leaf_mcu_sec"],
      });

      oracle.registerFtaNode({
        id: "leaf_mcu_prim",
        name: "Primary MCU Lockup",
        gateType: "PRIMARY_EVENT",
        children: [],
        failureModeId: "fm_mcu_primary",
      });

      oracle.registerFtaNode({
        id: "leaf_mcu_sec",
        name: "Secondary MCU Lockup",
        gateType: "PRIMARY_EVENT",
        children: [],
        failureModeId: "fm_mcu_secondary",
      });

      oracle.registerHazard({
        id: "hazard_brake_01",
        name: "Unintended Loss of Braking",
        asilLevel: "ASIL_D",
        targetPmhfFit: 10.0, // ASIL-D target < 10 FIT
        targetSpfm: 0.99, // ASIL-D target >= 99%
        targetLfm: 0.9, // ASIL-D target >= 90%
        rootNodeId: "top_gate",
      });

      // 1. Verify Minimal Cut Sets
      const mcs = oracle.computeMinimalCutSets("top_gate");
      assert.equal(mcs.length, 2, "Should have 2 minimal cut sets");

      // Verify single point failure
      const reportUnmitigated = oracle.evaluateHazard({
        id: "hazard_brake_01",
        name: "Unintended Loss of Braking",
        asilLevel: "ASIL_D",
        targetPmhfFit: 10.0,
        targetSpfm: 0.99,
        targetLfm: 0.9,
        rootNodeId: "top_gate",
      });

      assert.equal(reportUnmitigated.isCompliant, false, "Must fail ASIL-D due to unmitigated SPF and PMHF > 10 FIT");
      assert.equal(reportUnmitigated.singlePointsOfFailure.length, 1);
      assert.ok(reportUnmitigated.singlePointsOfFailure[0]!.includes("HydraulicValve"));
      assert.equal(reportUnmitigated.dualPointsOfFailure.length, 1);

      // Check conflict synthesis in theory coordinator
      const coord = new SemanticTheoryCoordinator();
      coord.registerOracle(oracle);
      const satRes = coord.checkSat();
      assert.equal(satRes.isSat, false);
      assert.ok(satRes.conflict?.explanation.includes("ASIL-D prohibits unmitigated Single Points of Failure"));
      assert.ok(satRes.conflict?.culpritEntities.some((c) => c.includes("HydraulicValve")));

      // 2. Now Mitigate: add dual-redundant relief valve with diagnostic coverage K_dc = 0.995 and failure rate 1 FIT
      oracle.registerFailureMode({
        id: "fm_hydraulic_valve",
        componentName: "HydraulicValve",
        modeName: "stuck_closed",
        failureRatePerHour: 2e-9, // 2 FIT with high-rel design
        safetyMechanism: "DualReliefValveAndPressureWatchdog",
        diagnosticCoverage: 0.995,
        severityScore: 10,
      });

      // Also make hydraulic actuation dual-redundant
      oracle.registerFtaNode({
        id: "top_gate",
        name: "Loss of Braking Actuation",
        gateType: "AND", // Both MCU and Hydraulics must fail or mitigated
        children: ["gate_dual_mcu"],
      });

      const reportMitigated = oracle.evaluateHazard({
        id: "hazard_brake_01",
        name: "Unintended Loss of Braking",
        asilLevel: "ASIL_D",
        targetPmhfFit: 10.0,
        targetSpfm: 0.99,
        targetLfm: 0.9,
        rootNodeId: "top_gate",
      });

      // Dual MCU failure rate over 10,000 hrs: (20e-9 * 1e4) * (20e-9 * 1e4) = 4e-8 -> PMHF << 1 FIT
      assert.ok(reportMitigated.actualPmhfFit < 1.0, `PMHF ${reportMitigated.actualPmhfFit} must be < 1 FIT`);
      assert.ok(reportMitigated.isCompliant, "Mitigated architecture must satisfy ASIL-D");

      // Verify FMEA table generation
      assert.ok(reportMitigated.fmeaTable.length >= 2);
      const mcuRow = reportMitigated.fmeaTable.find((r) => r.component === "PrimaryMCU")!;
      assert.ok(mcuRow.rpn > 0, "FMEA RPN score must be calculated");
      assert.equal(mcuRow.safetyClass, "ASIL_D");
    });
  });

  describe("Signal Temporal Logic (STL) Quantitative Safety Barrier Monitor", () => {
    it("evaluates robust temporal satisfaction and detects safety boundary violations", () => {
      // Formula: Always[0, 5] (Temp > 75 => Eventually[0, 1.0] Current <= 0)
      const stl = StlMonitor.always(
        [0, 5],
        StlMonitor.implies(
          StlMonitor.predicate("battery_temp", ">", 75.0),
          StlMonitor.eventually([0, 1.0], StlMonitor.predicate("charge_current", "<=", 0.0)),
        ),
      );

      const N = 100;
      const time = new Float64Array(N);
      for (let i = 0; i < N; i++) time[i] = i * 0.1; // 0 to 10s at 10 Hz

      // Scenario A: Compliant Trace
      // Temp spikes at t=2.0s, Current cuts off within 0.4s (at t=2.4s)
      const tempSafe = new Float64Array(N);
      const currSafe = new Float64Array(N);
      for (let i = 0; i < N; i++) {
        const t = time[i]!;
        tempSafe[i] = t >= 2.0 && t <= 4.0 ? 80.0 : 60.0;
        currSafe[i] = t >= 2.0 && t <= 2.3 ? 50.0 : 0.0; // Cut off at 2.4s
      }

      const resSafe = StlMonitor.evaluate(stl, {
        time,
        signals: { battery_temp: tempSafe, charge_current: currSafe },
      });

      assert.equal(resSafe.isSatisfied, true, "Scenario A must be satisfied");
      assert.ok(resSafe.robustness >= 0.0);
      assert.equal(resSafe.violationIntervals.length, 0);

      // Scenario B: Non-Compliant Trace
      // Temp spikes at t=2.0s, Current persists at 50A until t=3.5s (1.5s delay > 1.0s limit!)
      const tempViol = new Float64Array(N);
      const currViol = new Float64Array(N);
      for (let i = 0; i < N; i++) {
        const t = time[i]!;
        tempViol[i] = t >= 2.0 && t <= 4.0 ? 82.0 : 60.0;
        currViol[i] = t >= 2.0 && t <= 3.5 ? 50.0 : 0.0; // Persists until 3.5s!
      }

      const resViol = StlMonitor.evaluate(stl, {
        time,
        signals: { battery_temp: tempViol, charge_current: currViol },
      });

      assert.equal(resViol.isSatisfied, false, "Scenario B must be violated");
      assert.ok(resViol.robustness < 0.0, "Robustness degree must be strictly negative");
      assert.ok(resViol.worstRobustness < 0.0);
      assert.ok(resViol.timeOfWorstViolation !== undefined);
      assert.ok(resViol.diagnosticExplanation?.includes("STL Safety Constraint Violated"));
    });
  });

  describe("ComplianceMatrixGenerator & Digital Thread Certification Trace", () => {
    it("generates auditable compliance matrix and federates into hypergraph", () => {
      const generator = new ComplianceMatrixGenerator("ISO 26262-4 (Automotive System Safety)");

      generator.addItem({
        id: "SR-01",
        standardClause: "ISO 26262-4 Cl. 6.4.3",
        title: "Braking Actuation Freedom from Interference",
        safetyLevel: "ASIL_D",
        sysmlRequirementId: "SysML.Req.BrakeFFI",
        allocatedComponent: "HydraulicValveActuator",
        modelicaModelRef: "Vehicles.Braking.DualHydraulicActuator",
        verificationMethod: "FaultInjectionFTA",
        verificationArtifactRef: "Artifact.FTA.Braking.MCS",
        verificationStatus: "VERIFIED",
        evidenceHash: "a1b2c3d4e5f67890",
      });

      generator.addItem({
        id: "SR-02",
        standardClause: "ISO 26262-4 Cl. 6.4.4",
        title: "Battery Thermal Overheat Shutdown",
        safetyLevel: "ASIL_C",
        sysmlRequirementId: "SysML.Req.BatteryThermalSafety",
        allocatedComponent: "BMSController",
        modelicaModelRef: "Vehicles.Electrics.BatteryPack",
        verificationMethod: "SimulationRobustness",
        verificationArtifactRef: "Artifact.STL.ThermalShutdown.Trace",
        verificationStatus: "VERIFIED",
        evidenceHash: "f6e5d4c3b2a10987",
      });

      const summary = generator.computeSummary();
      assert.equal(summary.totalRequirements, 2);
      assert.equal(summary.verifiedCount, 2);
      assert.equal(summary.compliancePercentage, 100.0);
      assert.equal(summary.isFullyCertified, true);

      // Verify Markdown export
      const md = generator.generateMarkdownReport();
      assert.ok(md.includes("# Safety Certification & Compliance Matrix"));
      assert.ok(md.includes("ISO 26262-4 Cl. 6.4.3"));
      assert.ok(md.includes("ASIL_D"));
      assert.ok(md.includes("[PASS]"));

      // Federate into DigitalThreadHypergraph
      const hypergraph = new DigitalThreadHypergraph();
      const slots = generator.federateToHypergraph(hypergraph, 5000);

      assert.equal(slots.length, 2);
      assert.equal(hypergraph.getRelation(slots[0]!), ThreadRelation.Verifies);
      assert.ok(hypergraph.getDomainNode(slots[0]!, ThreadDomain.Safety) > 0);
      assert.ok(hypergraph.getDomainNode(slots[0]!, ThreadDomain.Requirements) > 0);
      assert.ok(hypergraph.getDomainNode(slots[0]!, ThreadDomain.Verification) > 0);
    });
  });
});
