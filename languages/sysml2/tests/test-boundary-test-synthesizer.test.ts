// SPDX-License-Identifier: AGPL-3.0-or-later

import { RegionDecomposer, type NonlinearConstraint, type RegionBranchInput } from "@modelscript/runtime";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BoundaryTestSynthesizer } from "../src/boundary-test-synthesizer.js";

describe("Formal Boundary-Condition & 100% MC/DC Test Suite Synthesizer (Imandra Parity)", () => {
  it("synthesizes nominal and boundary test cases from decomposed regions", () => {
    // Piecewise controller: speed <= 50 (Eco) vs speed > 50 (Power)
    const condition: NonlinearConstraint = {
      expr: { kind: "var", name: "speed" },
      rel: "<=",
      rhs: 50,
    };

    const decomposition = RegionDecomposer.decompose([condition], {
      domainBounds: new Map([["speed", [0, 100]]]),
    });

    const suite = BoundaryTestSynthesizer.synthesizeTestSuite(decomposition, {
      suiteName: "SpeedControllerTests",
    });

    assert.strictEqual(suite.name, "SpeedControllerTests");
    assert.strictEqual(suite.coverageMetrics.totalRegions, 2);
    assert.strictEqual(suite.coverageMetrics.regionsCovered, 2);

    // Verify nominal test cases
    const nominalTests = suite.testCases.filter((tc) => tc.category === "nominal");
    assert.strictEqual(nominalTests.length, 2, "Should generate 1 nominal test per region");

    const t1 = nominalTests.find((t) => t.expectedRegionId === "R_1")!;
    assert.ok(t1.inputs["speed"]! <= 50.05, "t1 speed must fall within region 1");

    const t2 = nominalTests.find((t) => t.expectedRegionId === "R_2")!;
    assert.ok(t2.inputs["speed"]! >= 49.95, "t2 speed must fall within region 2");

    // Verify boundary test cases
    const boundaryTests = suite.testCases.filter((tc) => tc.category === "boundary");
    assert.ok(boundaryTests.length >= 1, "Should generate boundary test cases for the shared facet");
  });

  it("synthesizes 100% MC/DC test pairs demonstrating independent condition effects", () => {
    const branches: RegionBranchInput[] = [
      {
        id: "mode_safe",
        constraints: [
          { expr: { kind: "var", name: "pressure" }, rel: "<=", rhs: 100 },
          { expr: { kind: "var", name: "temp" }, rel: "<=", rhs: 75 },
        ],
        terminalValue: "safe",
      },
      {
        id: "mode_vent",
        constraints: [{ expr: { kind: "var", name: "pressure" }, rel: ">=", rhs: 100 }],
        terminalValue: "vent",
      },
    ];

    const decomposition = RegionDecomposer.decomposeBranches(branches, {
      domainBounds: new Map([
        ["pressure", [0, 200]],
        ["temp", [0, 150]],
      ]),
    });

    const suite = BoundaryTestSynthesizer.synthesizeTestSuite(decomposition, {
      suiteName: "SafetyValveMcdc",
    });

    // Check MC/DC test cases
    const mcdcTests = suite.testCases.filter((tc) => tc.category === "mcdc");
    assert.ok(mcdcTests.length >= 2, "Should generate paired MC/DC test cases");

    const testT = mcdcTests.find((t) => t.id.endsWith("_T"))!;
    const testF = mcdcTests.find((t) => t.id.endsWith("_F"))!;

    assert.ok(testT, "Must have true-branch test");
    assert.ok(testF, "Must have false-branch test");
    assert.strictEqual(testT.pairedTestId, testF.id, "Test pairs must reference each other");
    assert.strictEqual(testF.pairedTestId, testT.id);
    assert.strictEqual(testT.independentCondition, testF.independentCondition);
    assert.notStrictEqual(testT.expectedRegionId, testF.expectedRegionId, "Toggling condition must toggle outcome");
  });

  it("serializes test suite to CTRF JSON format", () => {
    const condition: NonlinearConstraint = {
      expr: { kind: "var", name: "flow" },
      rel: "<=",
      rhs: 10,
    };
    const decomp = RegionDecomposer.decompose([condition], {
      domainBounds: new Map([["flow", [0, 30]]]),
    });

    const suite = BoundaryTestSynthesizer.synthesizeTestSuite(decomp, {
      suiteName: "FlowRegulatorSuite",
    });

    const ctrfJson = BoundaryTestSynthesizer.exportToCtrfJson(suite);
    const parsed = JSON.parse(ctrfJson);

    assert.strictEqual(parsed.report.reportFormat, "CTRF");
    assert.strictEqual(parsed.report.results.tool.name, "modelscript-boundary-synthesizer");
    assert.ok(parsed.report.results.summary.tests > 0);
    assert.strictEqual(parsed.report.results.tests.length, suite.testCases.length);
  });

  it("serializes test suite to JUnit XML format", () => {
    const condition: NonlinearConstraint = {
      expr: { kind: "var", name: "altitude" },
      rel: "<=",
      rhs: 1000,
    };
    const decomp = RegionDecomposer.decompose([condition], {
      domainBounds: new Map([["altitude", [0, 5000]]]),
    });

    const suite = BoundaryTestSynthesizer.synthesizeTestSuite(decomp, {
      suiteName: "AltitudeWarningSuite",
    });

    const junitXml = BoundaryTestSynthesizer.exportToJUnitXml(suite);

    assert.ok(junitXml.includes('<?xml version="1.0" encoding="UTF-8"?>'));
    assert.ok(junitXml.includes('<testsuites name="AltitudeWarningSuite"'));
    assert.ok(junitXml.includes('<testcase name="test_nom_R_1"'));
  });

  it("generates executable Modelica .mos experiment script", () => {
    const condition: NonlinearConstraint = {
      expr: { kind: "var", name: "temp" },
      rel: "<=",
      rhs: 100,
    };
    const decomp = RegionDecomposer.decompose([condition], {
      domainBounds: new Map([["temp", [0, 200]]]),
    });

    const suite = BoundaryTestSynthesizer.synthesizeTestSuite(decomp, {
      suiteName: "ThermostatSimulation",
    });

    const mos = BoundaryTestSynthesizer.exportToModelicaMos(suite, "ThermostatModel");

    assert.ok(mos.includes("loadModel(Modelica);"));
    assert.ok(mos.includes('loadFile("ThermostatModel.mo");'));
    assert.ok(mos.includes("simulate(ThermostatModel"));
    assert.ok(mos.includes('"temp"'));
  });
});
