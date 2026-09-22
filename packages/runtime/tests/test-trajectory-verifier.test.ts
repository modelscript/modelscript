// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from "node:assert";
import { describe, it } from "node:test";
import { DigitalThreadHypergraph, generateCtrfReport, generateJUnitReport, ThreadDomain } from "../src/index.js";
import {
  computeIntegral,
  computeOvershoot,
  computeSettlingTime,
  computeSteadyState,
  VerificationRunner,
  type SimulationResult,
  type VerificationResult,
} from "../src/simulation/wasm_verifier.js";

describe("Closed-Loop V&V Trajectory Evaluator & Reporter", () => {
  describe("Temporal Trajectory Metrics", () => {
    it("should compute settling time within specified tolerance band", () => {
      // Time from 0 to 5s
      const t = [0, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 4.5, 5.0];
      // Step response settling around 100; leaves band at 1.5s, stays within [98, 102] from 2.0s onward
      const x = [0, 60, 115, 95, 101, 99.5, 100.2, 99.8, 100.0, 100.0, 100.0];

      const settlingTime = computeSettlingTime(t, x, 0.02);
      assert.strictEqual(settlingTime, 2.0, `Expected settling time to be 2.0s, got ${settlingTime}`);
    });

    it("should compute percentage overshoot correctly", () => {
      const stepResponse = [0, 50, 90, 125, 110, 98, 102, 100];
      // Target / steady-state is 100, max is 125 -> overshoot is 25%
      const os = computeOvershoot(stepResponse, 100);
      assert.strictEqual(Math.round(os), 25);

      // Monotonic step (no overshoot)
      const monotonic = [0, 20, 50, 80, 95, 100];
      assert.strictEqual(computeOvershoot(monotonic, 100), 0);
    });

    it("should compute steady-state value from final window fraction", () => {
      const x = [10, 20, 30, 40, 50, 60, 70, 80, 100, 100];
      // Last 10% is just [100] -> steady state = 100
      assert.strictEqual(computeSteadyState(x, 0.1), 100);
      // Last 20% is [100, 100] -> steady state = 100
      assert.strictEqual(computeSteadyState(x, 0.2), 100);
    });

    it("should compute trapezoidal integral accurately", () => {
      const t = [0, 1, 2, 3, 4];
      // Constant function f(t) = 5 -> integral over [0, 4] = 20
      const xConst = [5, 5, 5, 5, 5];
      assert.strictEqual(computeIntegral(t, xConst), 20);

      // Linear function f(t) = 2*t -> integral over [0, 4] = 4^2 = 16
      const xLinear = [0, 2, 4, 6, 8];
      assert.strictEqual(computeIntegral(t, xLinear), 16);
    });
  });

  describe("Temporal Metric Constraint Evaluation & Hypergraph Sync", () => {
    it("should evaluate settlingTime, max, and overshoot in VerificationRunner", () => {
      // Mock QueryDB with CST comparison nodes
      const mockDB: any = {
        cstNode: (id: number) => {
          if (id === 101) {
            return {
              childForFieldName: (field: string) => {
                if (field === "operator") return { text: "<=" };
                if (field === "left") return { text: "settlingTime(speed)" };
                if (field === "right") return { text: "2.0" };
                return null;
              },
            };
          }
          if (id === 102) {
            return {
              childForFieldName: (field: string) => {
                if (field === "operator") return { text: "<=" };
                if (field === "left") return { text: "max(speed)" };
                if (field === "right") return { text: "150" };
                return null;
              },
            };
          }
          if (id === 103) {
            return {
              childForFieldName: (field: string) => {
                if (field === "operator") return { text: "<=" };
                if (field === "left") return { text: "overshoot(speed)" };
                if (field === "right") return { text: "10.0" }; // Should fail (overshoot is 25%)
                return null;
              },
            };
          }
          return null;
        },
        childrenOf: (parentId: number) => {
          if (parentId === 1) {
            return [
              { id: 101, parentId: 1, name: "c1", ruleName: "ConstraintUsage", kind: "Usage" },
              { id: 102, parentId: 1, name: "c2", ruleName: "ConstraintUsage", kind: "Usage" },
              { id: 103, parentId: 1, name: "c3", ruleName: "ConstraintUsage", kind: "Usage" },
            ];
          }
          return [];
        },
        byName: () => [],
        allEntries: () => [],
        evaluate: () => undefined,
      };

      const simResult: SimulationResult = {
        t: [0, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0],
        states: ["speed"],
        y: [[0], [60], [125], [95], [101], [100], [100]],
      };

      const hypergraph = new DigitalThreadHypergraph();
      // Bind downstream Modelica and CAD elements to verifyCase thread to test blast radius
      const slot = hypergraph.createThread(1);
      hypergraph.bindDomainNode(slot, ThreadDomain.Requirements, 1);
      hypergraph.bindDomainNode(slot, ThreadDomain.SysML2, 201);
      hypergraph.bindDomainNode(slot, ThreadDomain.Modelica, 301);
      hypergraph.bindDomainNode(slot, ThreadDomain.CAD, 401);

      const runner = new VerificationRunner(mockDB);
      const results = runner.verifyCase(1, simResult, hypergraph);

      assert.strictEqual(results.length, 3);

      // Constraint 101: settlingTime <= 2.0 -> PASSED
      const r1 = results.find((r) => r.constraintId === 101);
      assert.ok(r1?.isSatisfied);
      assert.strictEqual(r1?.metricName, "settlingTime");

      // Constraint 102: max <= 150 -> PASSED (peak is 125)
      const r2 = results.find((r) => r.constraintId === 102);
      assert.ok(r2?.isSatisfied);
      assert.strictEqual(r2?.metricName, "max");

      // Constraint 103: overshoot <= 10.0 -> FAILED (overshoot is 25%)
      const r3 = results.find((r) => r.constraintId === 103);
      assert.strictEqual(r3?.isSatisfied, false);
      assert.strictEqual(r3?.metricName, "overshoot");
      assert.ok(r3?.message?.includes("overshoot(speed) was 25.00"));

      // Hypergraph sync & blast radius verification:
      // Since constraint 103 failed, thread should be marked CONFLICT and blast radius traced
      assert.ok(hypergraph.isConflicted(slot));
      assert.ok(r3?.blastRadius !== undefined && r3.blastRadius > 0);
    });
  });

  describe("Automated CTRF and JUnit XML Report Generation", () => {
    it("should generate compliant CTRF JSON report", () => {
      const mockResults: VerificationResult[] = [
        {
          requirementId: 1,
          constraintId: 101,
          requirementName: "MaxSpeedRequirement",
          isSatisfied: true,
          metricName: "max",
          metricValue: 120,
          limitValue: 150,
        },
        {
          requirementId: 2,
          constraintId: 102,
          requirementName: "SettlingTimeRequirement",
          isSatisfied: false,
          metricName: "settlingTime",
          metricValue: 2.5,
          limitValue: 2.0,
          message: "Requirement violated: settlingTime was 2.5 (limit: <= 2.0)",
          blastRadius: 4,
        },
      ];

      const report = generateCtrfReport(mockResults, 150);

      assert.strictEqual(report.report.reportFormat, "CTRF");
      assert.strictEqual(report.report.results.summary.tests, 2);
      assert.strictEqual(report.report.results.summary.passed, 1);
      assert.strictEqual(report.report.results.summary.failed, 1);

      const failedTest = report.report.results.tests.find((t) => t.status === "failed");
      assert.ok(failedTest);
      assert.strictEqual(failedTest?.extra?.blastRadius, 4);
    });

    it("should generate compliant JUnit XML report", () => {
      const mockResults: VerificationResult[] = [
        {
          requirementId: 1,
          constraintId: 101,
          requirementName: "SpeedReq",
          isSatisfied: true,
        },
        {
          requirementId: 1,
          constraintId: 102,
          requirementName: "TempReq",
          isSatisfied: false,
          violationTime: 3.1415,
          blastRadius: 3,
          message: "Temp exceeded 100C",
        },
      ];

      const xml = generateJUnitReport("TestSuite_Powertrain", mockResults, 200);

      assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
      assert.ok(xml.includes('<testsuites name="TestSuite_Powertrain" tests="2" failures="1"'));
      assert.ok(xml.includes('<testcase name="SpeedReq::Constraint_101"'));
      assert.ok(xml.includes('<testcase name="TempReq::Constraint_102"'));
      assert.ok(xml.includes('<failure message="Temp exceeded 100C" type="VerificationFailure">'));
      assert.ok(xml.includes("First violation at t = 3.1415 s"));
      assert.ok(xml.includes("Blast radius impacted nodes: 3"));
    });
  });
});
