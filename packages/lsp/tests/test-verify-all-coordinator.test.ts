// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  AbstractDomainOracle,
  ConstraintTheoryOracle,
  DimensionalTheoryOracle,
  FlowAlgebraOracle,
  OntologyTheoryOracle,
  SemanticTheoryCoordinator,
} from "@modelscript/runtime";
import assert from "node:assert";
import test from "node:test";
import { TextDocument } from "vscode-languageserver-textdocument";
import { registerAnalysisEndpoints } from "../src/handlers/analysisEndpoints.js";

test("LSP Analysis Endpoints: Semantic Theory Coordinator Integration in verifyAll", async (t) => {
  const handlers = new Map<string, (...args: any[]) => any>();
  const mockConnection: any = {
    onRequest: (method: string, handler: (...args: any[]) => any) => {
      handlers.set(method, handler);
    },
    console: {
      info: () => {},
      warn: () => {},
      error: () => {},
    },
  };

  const docUri = "file:///workspace/TestTheoryModel.mo";
  const sourceText = `model TestTheoryModel
  parameter Real x = 1.0;
  parameter Real y = 2.0;
equation
  der(x) = y;
end TestTheoryModel;`;

  const doc = TextDocument.create(docUri, "modelica", 1, sourceText);
  const coordinator = new SemanticTheoryCoordinator();
  coordinator.registerOracle(new OntologyTheoryOracle());
  coordinator.registerOracle(new ConstraintTheoryOracle());
  coordinator.registerOracle(new AbstractDomainOracle());
  coordinator.registerOracle(new DimensionalTheoryOracle());
  coordinator.registerOracle(new FlowAlgebraOracle());

  const mockContext: any = {
    connection: mockConnection,
    workspaceManager: {
      getDocument: () => doc,
      getQueryEngine: () => undefined,
      unifiedWorkspace: undefined,
      coordinator,
      getCoordinator: () => coordinator,
    },
    parserService: {
      sharedContext: undefined,
    },
  };

  registerAnalysisEndpoints(mockContext);

  await t.test("modelscript/verifyAll handler runs theory_coordination stage by default", async () => {
    const handler = handlers.get("modelscript/verifyAll");
    assert.ok(handler, "modelscript/verifyAll must be registered");

    const report = await handler({
      uri: docUri,
      options: {
        all: true,
      },
    });

    assert.ok(report, "Must return unified report");
    assert.ok(report.stages.theory_coordination, "Stages must contain theory_coordination");
    assert.strictEqual(report.stages.theory_coordination.passed, true);
    assert.strictEqual(report.stages.theory_coordination.certified, true);
    assert.ok(report.stages.theory_coordination.name.includes("Semantic Theory Coordinator"));
    assert.ok(report.stages.theory_coordination.summary.includes("All theory oracles mutually satisfiable"));
  });

  await t.test("modelscript/verifyAll synthesizes domain stages from registered oracles", async () => {
    const handler = handlers.get("modelscript/verifyAll");
    const report = await handler({
      uri: docUri,
      options: { all: true },
    });

    assert.ok(report.stages.taxonomy_bundles, "Must contain taxonomy_bundles stage");
    assert.strictEqual(report.stages.taxonomy_bundles.passed, true);

    assert.ok(report.stages.decisions, "Must contain decisions stage");
    assert.strictEqual(report.stages.decisions.passed, true);

    assert.ok(report.stages.abstract_domains, "Must contain abstract_domains stage");
    assert.strictEqual(report.stages.abstract_domains.passed, true);

    assert.ok(report.stages.flow_algebra, "Must contain flow_algebra stage");
    assert.strictEqual(report.stages.flow_algebra.passed, true);

    assert.ok(report.stages.unit_systems, "Must contain unit_systems stage");
    assert.strictEqual(report.stages.unit_systems.passed, true);

    assert.strictEqual(report.summary.overallPassed, true);
    assert.ok(report.summary.passedStages >= 5);
  });

  await t.test(
    "modelscript/verifyAll isolates failing stage and reports conflict on oracle contradiction",
    async () => {
      const handler = handlers.get("modelscript/verifyAll");

      // Inject dimension conflict into workspace coordinator
      const coordinator = mockContext.workspaceManager.getCoordinator();
      coordinator.assertLiteral({
        predicate: "dimension",
        args: ["lengthVar", [1, 0, 0, 0, 0, 0, 0]],
        domain: "constraint",
      });
      coordinator.assertLiteral({
        predicate: "dimension",
        args: ["massVar", [0, 1, 0, 0, 0, 0, 0]],
        domain: "constraint",
      });
      coordinator.assertLiteral({
        predicate: "equal",
        args: ["lengthVar", "massVar"],
        domain: "constraint",
      });

      const report = await handler({
        uri: docUri,
        options: { all: true },
      });

      assert.strictEqual(report.summary.overallPassed, false);
      assert.strictEqual(report.stages.theory_coordination.passed, false);
      assert.strictEqual(report.stages.unit_systems.passed, false);
      assert.ok((report.stages.unit_systems.violations?.length ?? 0) > 0);
      assert.ok(report.stages.unit_systems.violations![0]!.message.includes("Dimensional Inconsistency"));

      // Other oracles without contradiction remain passed
      assert.strictEqual(report.stages.taxonomy_bundles.passed, true);
      assert.strictEqual(report.stages.abstract_domains.passed, true);
      assert.strictEqual(report.stages.flow_algebra.passed, true);

      // Clean up coordinator
      coordinator.reset();
    },
  );

  await t.test("modelscript/verifyAll supports SARIF, JUnit, CTRF, HTML, and DHF export formats", async () => {
    const handler = handlers.get("modelscript/verifyAll");

    // 1. SARIF format
    const sarifReport = await handler({
      uri: docUri,
      format: "sarif",
    });
    assert.ok(sarifReport.artifacts?.formattedOutput);
    const sarifJson = JSON.parse(sarifReport.artifacts.formattedOutput);
    assert.ok(sarifJson.$schema || sarifJson.version);
    assert.ok(Array.isArray(sarifJson.runs));

    // 2. JUnit format
    const junitReport = await handler({
      uri: docUri,
      format: "junit",
    });
    assert.ok(junitReport.artifacts?.formattedOutput);
    assert.ok(
      junitReport.artifacts.formattedOutput.includes("<testsuite") ||
        junitReport.artifacts.formattedOutput.includes("<?xml"),
    );

    // 3. CTRF format
    const ctrfReport = await handler({
      uri: docUri,
      format: "ctrf",
    });
    assert.ok(ctrfReport.artifacts?.formattedOutput);

    // 4. HTML format
    const htmlReport = await handler({
      uri: docUri,
      format: "html",
    });
    assert.ok(htmlReport.artifacts?.formattedOutput);
    assert.ok(htmlReport.artifacts.formattedOutput.includes("<!DOCTYPE html>"));

    // 5. DHF format
    const dhfReport = await handler({
      uri: docUri,
      format: "dhf",
    });
    assert.ok(dhfReport.artifacts?.formattedOutput);
    assert.ok(dhfReport.artifacts.formattedOutput.includes("ISO 26262"));
  });

  await t.test("modelscript/verifyAll extracts CandidateFilter Pareto fronts when trade study is enabled", async () => {
    const handler = handlers.get("modelscript/verifyAll");

    const mockCandidates = [
      { id: "variant_1", objectives: { mass: 10, cost: 100 }, tier1Passed: true, tier2Passed: true },
      { id: "variant_2", objectives: { mass: 20, cost: 50 }, tier1Passed: true, tier2Passed: true },
      { id: "variant_3", objectives: { mass: 30, cost: 120 }, tier1Passed: true, tier2Passed: true }, // Dominated by variant_1
    ];

    const report = await handler({
      uri: docUri,
      options: { tradeStudy: true },
      candidates: mockCandidates,
    });

    assert.ok(report.tradeStudy, "Must include tradeStudy field in report");
    assert.strictEqual(report.tradeStudy.candidatesCount, 3);
    assert.ok(report.tradeStudy.paretoFrontsCount >= 1);
    assert.ok(report.tradeStudy.topParetoFront.length >= 1);
  });
});
