// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  generateHtmlReport,
  generateSarifReport,
  UnifiedVerifier,
  type UnifiedVerificationReport,
} from "@modelscript/runtime";
import assert from "node:assert/strict";
import test, { describe } from "node:test";

describe("Unified Formal Verification & Multi-Format Reporting", () => {
  const sampleSysml = `
    action def SpeedController {
      in speed : Real;
      out throttle : Real;

      decide SpeedGovernor {
        case speed < 0.0 => throttle := 0.0;
        case speed >= 0.0 && speed <= 100.0 => throttle := speed * 0.8;
        case speed > 100.0 => throttle := 80.0;
      }
    }
  `;

  test("UnifiedVerifier.verify executes multi-stage verification on SysML v2 source", async () => {
    const report: UnifiedVerificationReport = await UnifiedVerifier.verify(
      {
        uri: "file:///test/speed_controller.sysml",
        sourceText: sampleSysml,
      },
      {
        decisions: true,
        regionDecomposition: true,
        mcdc: true,
      },
    );

    assert(report.summary.totalStages >= 2, "Expected at least 2 stages executed");
    assert.strictEqual(report.summary.overallPassed, true, "Expected all stages to pass");
    assert(report.stages["decisions"], "Expected decisions stage");
    assert(report.stages["regionDecomposition"], "Expected region decomposition stage");

    assert.strictEqual(report.stages["decisions"]?.passed, true);
    assert(report.stages["regionDecomposition"]?.details?.testCases?.length > 0);
  });

  test("generateSarifReport produces valid OASIS SARIF v2.1.0 JSON", () => {
    const mockReport: UnifiedVerificationReport = {
      timestamp: new Date().toISOString(),
      target: "SpeedController",
      summary: {
        totalStages: 2,
        passedStages: 1,
        failedStages: 1,
        certifiedStages: 1,
        skippedStages: 0,
        totalViolations: 1,
        durationMs: 42.5,
        overallPassed: false,
      },
      stages: {
        decisions: {
          stage: "decisions",
          name: "Decision Table & Guard Verifier",
          passed: false,
          durationMs: 12.3,
          summary: "1 decision table issue detected.",
          violations: [
            {
              id: "MSC-VERIFY-DECISION-GAP",
              stage: "decisions",
              severity: "error",
              message: "Decision table 'SpeedGovernor' has uncovered gap for speed in [50.1, 59.9]",
              location: { uri: "file:///model.sysml", line: 12, column: 5 },
            },
          ],
        },
      },
    };

    const sarif = generateSarifReport(mockReport, "1.0.0");
    assert.strictEqual(sarif.version, "2.1.0");
    assert.strictEqual(sarif.$schema, "https://json.schemastore.org/sarif-2.1.0.json");
    assert.strictEqual(sarif.runs.length, 1);
    assert.strictEqual(sarif.runs[0]!.tool.driver.name, "ModelScript Formal Verifier");
    assert.strictEqual(sarif.runs[0]!.results.length, 1);
    assert.strictEqual(sarif.runs[0]!.results[0]!.ruleId, "MSC-VERIFY-DECISION-GAP");
    assert.strictEqual(sarif.runs[0]!.results[0]!.level, "error");
    assert.strictEqual(sarif.runs[0]!.results[0]!.locations?.[0]!.physicalLocation.region?.startLine, 12);
  });

  test("generateHtmlReport creates self-contained dashboard without external dependencies", () => {
    const mockReport: UnifiedVerificationReport = {
      timestamp: "2026-09-25T00:00:00.000Z",
      target: "PowertrainArchitecture",
      summary: {
        totalStages: 3,
        passedStages: 3,
        failedStages: 0,
        certifiedStages: 2,
        skippedStages: 0,
        totalViolations: 0,
        durationMs: 85.0,
        overallPassed: true,
      },
      stages: {
        decisions: {
          stage: "decisions",
          name: "Decision Tables",
          passed: true,
          certified: true,
          durationMs: 25.0,
          summary: "All 4 decision tables certified exhaustive and deterministic.",
          violations: [],
        },
        contracts: {
          stage: "contracts",
          name: "Assume-Guarantee Contracts",
          passed: true,
          certified: true,
          durationMs: 40.0,
          summary: "All 6 contracts certified compatible.",
          violations: [],
        },
      },
    };

    const html = generateHtmlReport(mockReport);
    assert(html.includes("<!DOCTYPE html>"), "Must be valid HTML5");
    assert(html.includes("PowertrainArchitecture"), "Must contain target name");
    assert(html.includes("ALL CERTIFIED / PASSED"), "Must contain success badge");
    assert(html.includes("Decision Tables"), "Must contain stage cards");
    assert(!html.includes("http://"), "Must not rely on unencrypted CDNs");
    assert(!html.includes("https://cdn"), "Must be zero-dependency self-contained");
  });

  test("UnifiedVerifier terminal and CTRF formatters operate consistently", () => {
    const mockReport: UnifiedVerificationReport = {
      timestamp: new Date().toISOString(),
      target: "TestSystem",
      summary: {
        totalStages: 1,
        passedStages: 1,
        failedStages: 0,
        certifiedStages: 1,
        skippedStages: 0,
        totalViolations: 0,
        durationMs: 15.0,
        overallPassed: true,
      },
      stages: {
        decisions: {
          stage: "decisions",
          name: "Decision Table & Guard Verifier",
          passed: true,
          certified: true,
          durationMs: 15.0,
          summary: "All tables certified.",
          violations: [],
        },
      },
    };

    const termOutput = UnifiedVerifier.formatTerminal(mockReport);
    assert(termOutput.includes("ModelScript Unified Formal Verification"));
    assert(termOutput.includes("[CERTIFIED]"));

    const ctrf = UnifiedVerifier.formatCtrf(mockReport);
    assert.strictEqual(ctrf.report.reportFormat, "CTRF");
    assert.strictEqual(ctrf.report.results.summary.passed, 1);
  });

  test("UnifiedVerifier executes Stage 10 (algorithms) abstract interpretation on Modelica code", async () => {
    const modelicaCode = `
      function safeAccumulator
        input Real[10] arr;
        output Real total;
        protected
          Integer i;
      algorithm
        total := 0.0;
        for i in 1:10 loop
          total := total + arr[i];
        end for;
      end safeAccumulator;
    `;

    const report = await UnifiedVerifier.verify(
      {
        uri: "file:///test/safe_accumulator.mo",
        sourceText: modelicaCode,
      },
      {
        algorithms: true,
      },
    );

    assert(report.stages["algorithms"], "Expected algorithms stage");
    const algoStage = report.stages["algorithms"]!;
    assert.strictEqual(algoStage.passed, true, "Algorithm should pass");
    assert.strictEqual(algoStage.certified, true, "Algorithm should be certified safe");
    assert(algoStage.summary.includes("100% Certified Safe"));
    assert(algoStage.details?.formattedMatrix.includes("Modelica Algorithmic Abstract Interpretation"));
    assert(algoStage.details?.formattedMatrix.includes("Array Subscripts (In-Bounds)"));

    // Check Terminal Formatting includes matrix
    const termOutput = UnifiedVerifier.formatTerminal(report);
    assert(termOutput.includes("Modelica Algorithmic Abstract Interpretation"));
    assert(termOutput.includes("STATUS: 100% CERTIFIED SAFE"));

    // Check HTML Dashboard includes Polyspace matrix
    const htmlOutput = UnifiedVerifier.formatHtml(report);
    assert(htmlOutput.includes("Polyspace/Astrée Formal Proof Matrix"));
    assert(htmlOutput.includes("matrix-container"));

    // Check SARIF report generation
    const sarifOutput = UnifiedVerifier.formatSarif(report);
    const parsedSarif = JSON.parse(sarifOutput);
    assert.strictEqual(parsedSarif.version, "2.1.0");
  });

  test("UnifiedVerifier detects algorithm defects and unproven conditions with SARIF mapping", async () => {
    const buggyCode = `
      function defectiveAlgorithm
        input Real denom;
        output Real result;
      algorithm
        result := 10.0 / denom;
      end defectiveAlgorithm;
    `;

    const report = await UnifiedVerifier.verify(
      {
        uri: "file:///test/defective.mo",
        sourceText: buggyCode,
      },
      {
        algorithms: true,
      },
    );

    assert(report.stages["algorithms"], "Expected algorithms stage");
    const algoStage = report.stages["algorithms"]!;
    assert.strictEqual(algoStage.passed, false, "Expected verification failure for unproven denom");
    assert.strictEqual(algoStage.violations && algoStage.violations.length > 0, true);

    const sarif = generateSarifReport(report);
    assert(
      sarif.runs[0]!.results.some(
        (r) => r.ruleId === "MSC-VERIFY-ALGO-UNPROVEN" || r.ruleId === "MSC-VERIFY-ALGO-DEFECT",
      ),
    );
  });
});
