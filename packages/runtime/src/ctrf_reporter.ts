// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Common Test Report Format (CTRF) and JUnit XML Reporter for ModelScript Verification.
 *
 * Emits standard test reports for CI/CD digital thread test runners, dashboards,
 * and automated gatekeepers.
 */

import type { VerificationResult } from "./wasm_verifier.js";

export interface CtrfTest {
  name: string;
  status: "passed" | "failed" | "pending" | "skipped";
  duration: number;
  message?: string;
  trace?: string;
  extra?: Record<string, any>;
}

export interface CtrfReport {
  report: {
    reportFormat: "CTRF";
    specVersion: "0.0.1";
    results: {
      tool: {
        name: "modelscript-verify";
        version: string;
      };
      summary: {
        tests: number;
        passed: number;
        failed: number;
        pending: number;
        skipped: number;
        other: number;
        start: number;
        stop: number;
      };
      tests: CtrfTest[];
    };
  };
}

/**
 * Converts verification results into standard Common Test Report Format (CTRF) JSON structure.
 */
export function generateCtrfReport(
  results: VerificationResult[],
  durationMs: number = 0,
  toolVersion: string = "0.1.0",
): CtrfReport {
  const startTime = Date.now() - durationMs;
  const stopTime = Date.now();

  let passed = 0;
  let failed = 0;

  const tests: CtrfTest[] = results.map((res, idx) => {
    const testName = res.requirementName
      ? `${res.requirementName} (Constraint #${res.constraintId})`
      : `Requirement_${res.requirementId}_Constraint_${res.constraintId}`;

    if (res.isSatisfied) {
      passed++;
      return {
        name: testName,
        status: "passed",
        duration: Math.round(durationMs / Math.max(results.length, 1)),
        extra: {
          requirementId: res.requirementId,
          constraintId: res.constraintId,
          lhsName: res.lhsName,
          peakValue: res.peakValue,
          limitValue: res.limitValue,
          metricName: res.metricName,
          metricValue: res.metricValue,
        },
      };
    } else {
      failed++;
      return {
        name: testName,
        status: "failed",
        duration: Math.round(durationMs / Math.max(results.length, 1)),
        message: res.message || "Requirement constraint violated",
        extra: {
          requirementId: res.requirementId,
          constraintId: res.constraintId,
          lhsName: res.lhsName,
          peakValue: res.peakValue,
          limitValue: res.limitValue,
          violationTime: res.violationTime,
          metricName: res.metricName,
          metricValue: res.metricValue,
          blastRadius: res.blastRadius,
        },
      };
    }
  });

  return {
    report: {
      reportFormat: "CTRF",
      specVersion: "0.0.1",
      results: {
        tool: {
          name: "modelscript-verify",
          version: toolVersion,
        },
        summary: {
          tests: results.length,
          passed,
          failed,
          pending: 0,
          skipped: 0,
          other: 0,
          start: startTime,
          stop: stopTime,
        },
        tests,
      },
    },
  };
}

/**
 * Escapes text for XML entities.
 */
function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Converts verification results into standard JUnit XML test report string.
 */
export function generateJUnitReport(suiteName: string, results: VerificationResult[], durationMs: number = 0): string {
  const durationSec = (durationMs / 1000).toFixed(3);
  let failures = 0;

  for (const r of results) {
    if (!r.isSatisfied) failures++;
  }

  let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
  xml += `<testsuites name="${escapeXml(suiteName)}" tests="${results.length}" failures="${failures}" errors="0" time="${durationSec}">\n`;
  xml += `  <testsuite name="${escapeXml(suiteName)}" tests="${results.length}" failures="${failures}" errors="0" time="${durationSec}">\n`;

  const perTestSec = (durationMs / Math.max(results.length, 1) / 1000).toFixed(3);

  for (const res of results) {
    const testName = res.requirementName
      ? `${res.requirementName}::Constraint_${res.constraintId}`
      : `Requirement_${res.requirementId}::Constraint_${res.constraintId}`;
    const className = `verification.${escapeXml(suiteName)}`;

    xml += `    <testcase name="${escapeXml(testName)}" classname="${className}" time="${perTestSec}">\n`;
    if (!res.isSatisfied) {
      const msg = res.message || "Constraint violated";
      xml += `      <failure message="${escapeXml(msg)}" type="VerificationFailure">\n`;
      xml += `        ${escapeXml(msg)}\n`;
      if (res.violationTime !== undefined) {
        xml += `        First violation at t = ${res.violationTime.toFixed(4)} s\n`;
      }
      if (res.blastRadius !== undefined) {
        xml += `        Blast radius impacted nodes: ${res.blastRadius}\n`;
      }
      xml += `      </failure>\n`;
    }
    xml += `    </testcase>\n`;
  }

  xml += `  </testsuite>\n`;
  xml += `</testsuites>\n`;

  return xml;
}
