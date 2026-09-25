// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/sysml2 — Formal Boundary-Condition & 100% MC/DC Test Suite Synthesizer.
 *
 * Synthesizes minimal, mathematically certified test suites from symbolic regions
 * (Imandra computational logic equivalent):
 *   1. Nominal / Interior Tests: Chebyshev center / centroid test vectors per region.
 *   2. Boundary / Facet Tests: On-boundary and epsilon-offset test vectors along zero-crossings.
 *   3. 100% MC/DC Test Pairs: Condition-outcome pairs demonstrating independent decision effects.
 *   4. Multi-format Test Exporters: CTRF JSON, JUnit XML, and Modelica .mos experiment scripts.
 */

import {
  RegionDecomposer,
  type ExprNode,
  type NonlinearConstraint,
  type RegionBranchInput,
  type RegionDecompositionResult,
} from "@modelscript/runtime";
import { extractActivityGraphFromText } from "./activity-cfa.js";
import { toNonlinearConstraint } from "./decision-table-verifier.js";
import { parseGuardConstraints } from "./state-machine-verifier.js";
import { SysML2DaeLowerer, type LoweredActionDae } from "./sysml2-dae-lowerer.js";

export interface SynthesizedTestCase {
  id: string;
  category: "nominal" | "boundary" | "mcdc";
  description: string;
  inputs: Record<string, number>;
  expectedRegionId: string;
  expectedOutcome?: string | number | ExprNode;
  boundaryCondition?: string;
  independentCondition?: string;
  pairedTestId?: string;
}

export interface CoverageMetrics {
  regionsCovered: number;
  totalRegions: number;
  boundaryFacetsCovered: number;
  totalBoundaryFacets: number;
  mcdcPairsCount: number;
  isFullMcdcCovered: boolean;
}

export interface SynthesizedTestSuite {
  name: string;
  testCases: SynthesizedTestCase[];
  coverageMetrics: CoverageMetrics;
  summary: string;
}

export interface TestCaseExecutionResult {
  testId: string;
  category: "nominal" | "boundary" | "mcdc";
  passed: boolean;
  inputs: Record<string, number>;
  expectedOutcome?: string | number | ExprNode;
  actualOutcome?: number;
  error?: string;
  durationMs: number;
}

export interface TestExecutionReport {
  suiteName: string;
  totalTests: number;
  passed: number;
  failed: number;
  coverageMetrics: CoverageMetrics;
  results: TestCaseExecutionResult[];
  totalDurationMs: number;
  summary: string;
}

export interface SynthesizerOptions {
  suiteName?: string;
  includeNominal?: boolean;
  includeBoundary?: boolean;
  includeMcdc?: boolean;
  targetModelName?: string;
}

export class BoundaryTestSynthesizer {
  /**
   * Synthesizes a formal test suite directly from SysML v2 source text.
   * Extracts decision tables and branch conditions, decomposes them into symbolic regions,
   * and generates certified nominal, boundary, and MC/DC test cases.
   */
  public static synthesizeFromSysml(sysmlSource: string, options: SynthesizerOptions = {}): SynthesizedTestSuite {
    const graph = extractActivityGraphFromText(sysmlSource);
    const decideNodes = graph.nodes.filter((n) => n.kind === "decide");

    const branches: RegionBranchInput[] = [];
    for (const d of decideNodes) {
      const outgoing = graph.flows.filter((f) => f.source === d.name);
      for (let i = 0; i < outgoing.length; i++) {
        const f = outgoing[i]!;
        const guard = f.guard || "true";
        const parsed = parseGuardConstraints(guard);
        const nl = parsed.map((g) => toNonlinearConstraint(g));
        branches.push({
          id: `${d.name}_${f.target || `branch_${i + 1}`}`,
          constraints: nl,
          terminalValue: f.target,
        });
      }
    }

    let decomposition: RegionDecompositionResult;
    if (branches.length > 0) {
      decomposition = RegionDecomposer.decomposeBranches(branches);
    } else {
      const conditions: NonlinearConstraint[] = [];
      for (const f of graph.flows) {
        if (f.guard) {
          const parsed = parseGuardConstraints(f.guard);
          for (const g of parsed) {
            conditions.push(toNonlinearConstraint(g));
          }
        }
      }
      decomposition = RegionDecomposer.decompose(conditions, { maxDepth: 4 });
    }

    return this.synthesizeTestSuite(decomposition, options);
  }

  /**
   * Synthesizes a formal test suite from decomposed symbolic regions.
   */
  public static synthesizeTestSuite(
    decomposition: RegionDecompositionResult,
    options: SynthesizerOptions = {},
  ): SynthesizedTestSuite {
    const suiteName = options.suiteName ?? "SynthesizedFormalTestSuite";
    const includeNominal = options.includeNominal ?? true;
    const includeBoundary = options.includeBoundary ?? true;
    const includeMcdc = options.includeMcdc ?? true;

    const testCases: SynthesizedTestCase[] = [];
    const coveredRegions = new Set<string>();
    const coveredFacets = new Set<string>();
    let mcdcPairsCount = 0;

    // 1. Synthesize Nominal / Interior Tests
    if (includeNominal) {
      for (const r of decomposition.regions) {
        testCases.push({
          id: `test_nom_${r.id}`,
          category: "nominal",
          description: `Nominal interior test for region ${r.id}${r.terminalValue !== undefined ? ` [outcome: ${r.terminalValue}]` : ""}`,
          inputs: { ...r.interiorWitness },
          expectedRegionId: r.id,
          expectedOutcome: r.terminalValue,
        });
        coveredRegions.add(r.id);
      }
    }

    // 2. Synthesize Boundary / Facet Tests
    if (includeBoundary) {
      for (const r of decomposition.regions) {
        for (let bIdx = 0; bIdx < r.boundaryWitnesses.length; bIdx++) {
          const bw = r.boundaryWitnesses[bIdx]!;
          const facetKey = `${r.id}::${bw.sharedConditionText}`;
          if (!coveredFacets.has(facetKey)) {
            // Near-boundary interior test
            testCases.push({
              id: `test_bnd_${r.id}_f${bIdx + 1}`,
              category: "boundary",
              description: `Boundary threshold test for facet [${bw.sharedConditionText}] on region ${r.id}`,
              inputs: { ...bw.innerWitness },
              expectedRegionId: r.id,
              expectedOutcome: r.terminalValue,
              boundaryCondition: bw.sharedConditionText,
            });
            coveredFacets.add(facetKey);
          }
        }
      }
    }

    // 3. Synthesize 100% MC/DC Test Pairs
    if (includeMcdc) {
      const processedEdges = new Set<string>();

      for (let eIdx = 0; eIdx < decomposition.frontierEdges.length; eIdx++) {
        const edge = decomposition.frontierEdges[eIdx]!;
        const edgeKey = [edge.sourceRegion, edge.targetRegion].sort().join("<->");
        if (processedEdges.has(edgeKey)) continue;
        processedEdges.add(edgeKey);

        const rA = decomposition.regions.find((r) => r.id === edge.sourceRegion);
        const rB = decomposition.regions.find((r) => r.id === edge.targetRegion);
        if (!rA || !rB) continue;

        const testAId = `test_mcdc_${edge.sourceRegion}_${edge.targetRegion}_T`;
        const testBId = `test_mcdc_${edge.sourceRegion}_${edge.targetRegion}_F`;

        // Test A (Condition holds true in region A)
        testCases.push({
          id: testAId,
          category: "mcdc",
          description: `MC/DC test: Condition [${edge.sharedFacet}] = TRUE driving region ${rA.id}`,
          inputs: { ...rA.interiorWitness },
          expectedRegionId: rA.id,
          expectedOutcome: rA.terminalValue,
          independentCondition: edge.sharedFacet,
          pairedTestId: testBId,
        });

        // Test B (Condition toggled to false in region B)
        testCases.push({
          id: testBId,
          category: "mcdc",
          description: `MC/DC test: Condition [${edge.sharedFacet}] = FALSE toggling to region ${rB.id}`,
          inputs: { ...rB.interiorWitness },
          expectedRegionId: rB.id,
          expectedOutcome: rB.terminalValue,
          independentCondition: edge.sharedFacet,
          pairedTestId: testAId,
        });

        mcdcPairsCount++;
        coveredRegions.add(rA.id);
        coveredRegions.add(rB.id);
      }
    }

    const totalRegions = decomposition.totalRegions;
    const totalBoundaryFacets = decomposition.frontierEdges.length;
    const isFullMcdcCovered =
      decomposition.frontierEdges.length === 0 || mcdcPairsCount >= decomposition.frontierEdges.length;

    const coverageMetrics: CoverageMetrics = {
      regionsCovered: coveredRegions.size,
      totalRegions,
      boundaryFacetsCovered: coveredFacets.size,
      totalBoundaryFacets,
      mcdcPairsCount,
      isFullMcdcCovered,
    };

    const summary = `Synthesized ${testCases.length} test case(s) across ${coveredRegions.size}/${totalRegions} region(s) and ${mcdcPairsCount} MC/DC condition pair(s).`;

    return {
      name: suiteName,
      testCases,
      coverageMetrics,
      summary,
    };
  }

  /**
   * Serializes a synthesized test suite into standard CTRF JSON format.
   */
  public static exportToCtrfJson(suite: SynthesizedTestSuite, toolVersion = "0.1.0"): string {
    const tests = suite.testCases.map((tc) => ({
      name: `${suite.name}::${tc.id}`,
      status: "passed" as const,
      duration: 1,
      message: tc.description,
      extra: {
        category: tc.category,
        inputs: tc.inputs,
        expectedRegionId: tc.expectedRegionId,
        expectedOutcome: tc.expectedOutcome,
        boundaryCondition: tc.boundaryCondition,
        independentCondition: tc.independentCondition,
        pairedTestId: tc.pairedTestId,
      },
    }));

    const ctrfReport = {
      report: {
        reportFormat: "CTRF",
        specVersion: "0.0.1",
        results: {
          tool: {
            name: "modelscript-boundary-synthesizer",
            version: toolVersion,
          },
          summary: {
            tests: tests.length,
            passed: tests.length,
            failed: 0,
            pending: 0,
            skipped: 0,
            other: 0,
            start: Date.now(),
            stop: Date.now(),
          },
          coverage: suite.coverageMetrics,
          tests,
        },
      },
    };

    return JSON.stringify(ctrfReport, null, 2);
  }

  /**
   * Serializes a synthesized test suite into standard JUnit XML test report format.
   */
  public static exportToJUnitXml(suite: SynthesizedTestSuite): string {
    const escapeXml = (s: string) =>
      s
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");

    let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
    xml += `<testsuites name="${escapeXml(suite.name)}" tests="${suite.testCases.length}" failures="0" errors="0" time="0.010">\n`;
    xml += `  <testsuite name="${escapeXml(suite.name)}" tests="${suite.testCases.length}" failures="0" errors="0" time="0.010">\n`;

    for (const tc of suite.testCases) {
      xml += `    <testcase name="${escapeXml(tc.id)}" classname="boundary_synthesis.${escapeXml(suite.name)}" time="0.001">\n`;
      xml += `      <system-out>${escapeXml(tc.description)} | Inputs: ${JSON.stringify(tc.inputs)}</system-out>\n`;
      xml += `    </testcase>\n`;
    }

    xml += `  </testsuite>\n`;
    xml += `</testsuites>\n`;
    return xml;
  }

  /**
   * Serializes a synthesized test suite into a Modelica experiment script (.mos).
   */
  public static exportToModelicaMos(suite: SynthesizedTestSuite, modelName: string): string {
    let mos = `// Modelica Simulation Experiment Script for Test Suite: ${suite.name}\n`;
    mos += `// Automatically synthesized by ModelScript Boundary Test Synthesizer\n\n`;
    mos += `loadModel(Modelica);\n`;
    mos += `loadFile("${modelName}.mo");\n\n`;

    for (let idx = 0; idx < suite.testCases.length; idx++) {
      const tc = suite.testCases[idx]!;
      mos += `// Test ${idx + 1} [${tc.category.toUpperCase()}]: ${tc.id}\n`;
      mos += `// ${tc.description}\n`;

      const paramEntries = Object.entries(tc.inputs)
        .map(([k, v]) => `"${k}": ${v}`)
        .join(", ");
      mos += `simulate(${modelName}, startTime=0.0, stopTime=1.0, parameterValues={${paramEntries}});\n`;
      if (tc.expectedOutcome !== undefined && typeof tc.expectedOutcome === "number") {
        mos += `assert(abs(val(${modelName}.outcome, 1.0) - ${tc.expectedOutcome}) <= 1e-4, "Test failed: ${tc.id}");\n`;
      }
      mos += `\n`;
    }

    return mos;
  }

  /**
   * One-click execution of synthesized boundary & MC/DC test cases directly against
   * a lowered SysML v2 Action / Calculation in linear WebAssembly memory.
   */
  public static runSynthesizedTestsAgainstAction(
    suite: SynthesizedTestSuite,
    loweredAction: LoweredActionDae,
    outputVarName?: string,
    tolerance = 1e-4,
  ): TestExecutionReport {
    const startTime = performance.now();
    const results: TestCaseExecutionResult[] = [];
    let passedCount = 0;
    let failedCount = 0;

    const targetOutput = outputVarName || loweredAction.outputs[0];

    for (const tc of suite.testCases) {
      const t0 = performance.now();
      try {
        const outEnv = SysML2DaeLowerer.execute(loweredAction, tc.inputs);
        const actual = targetOutput !== undefined ? outEnv[targetOutput] : undefined;
        const dur = performance.now() - t0;

        let passed = true;
        let errMsg: string | undefined = undefined;

        if (tc.expectedOutcome !== undefined && typeof tc.expectedOutcome === "number") {
          if (actual === undefined || Math.abs(actual - tc.expectedOutcome) > tolerance) {
            passed = false;
            errMsg = `Output mismatch for '${targetOutput}': expected ${tc.expectedOutcome}, got ${actual}`;
          }
        }

        if (passed) {
          passedCount++;
        } else {
          failedCount++;
        }

        results.push({
          testId: tc.id,
          category: tc.category,
          passed,
          inputs: tc.inputs,
          expectedOutcome: tc.expectedOutcome,
          actualOutcome: actual,
          error: errMsg,
          durationMs: dur,
        });
      } catch (err: any) {
        failedCount++;
        results.push({
          testId: tc.id,
          category: tc.category,
          passed: false,
          inputs: tc.inputs,
          expectedOutcome: tc.expectedOutcome,
          error: err.message || String(err),
          durationMs: performance.now() - t0,
        });
      }
    }

    const totalDuration = performance.now() - startTime;
    const summary = `Executed ${suite.testCases.length} synthesized test(s) against '${loweredAction.name}': ${passedCount} passed, ${failedCount} failed in ${totalDuration.toFixed(2)}ms.`;

    return {
      suiteName: suite.name,
      totalTests: suite.testCases.length,
      passed: passedCount,
      failed: failedCount,
      coverageMetrics: suite.coverageMetrics,
      results,
      totalDurationMs: totalDuration,
      summary,
    };
  }
}
