// SPDX-License-Identifier: AGPL-3.0-or-later

import type { GtSimulationResult } from "../types.js";

export interface GtVerificationGateOptions {
  maxBsfcGPerKwh?: number;
  maxBoostBar?: number;
  maxNoxPpm?: number;
  minKnockMargin?: number;
}

export interface GtGateCheckResult {
  passed: boolean;
  metric: string;
  actual: number;
  threshold: number;
  unit: string;
  message: string;
}

export interface GtVerificationReport {
  passed: boolean;
  checks: GtGateCheckResult[];
  markdownSummary: string;
}

/**
 * Evaluates formal powertrain verification gates on a GT-SUITE simulation result.
 */
export function verifyEngineGates(
  result: GtSimulationResult,
  options: GtVerificationGateOptions = {},
): GtVerificationReport {
  const maxBsfc = options.maxBsfcGPerKwh ?? 240.0;
  const maxBoost = options.maxBoostBar ?? 2.8;
  const maxNox = options.maxNoxPpm ?? 60.0;
  const minKnock = options.minKnockMargin ?? 0.1;

  const checks: GtGateCheckResult[] = [];

  // 1. BSFC Check
  const actualBsfc = result.summary.meanBsfcGPerKwh;
  const bsfcPassed = actualBsfc <= maxBsfc;
  checks.push({
    passed: bsfcPassed,
    metric: "Brake Specific Fuel Consumption",
    actual: actualBsfc,
    threshold: maxBsfc,
    unit: "g/kWh",
    message: bsfcPassed
      ? `BSFC (${actualBsfc.toFixed(1)} g/kWh) satisfies fuel economy ceiling (<= ${maxBsfc.toFixed(1)} g/kWh).`
      : `BSFC (${actualBsfc.toFixed(1)} g/kWh) exceeds maximum fuel consumption threshold (<= ${maxBsfc.toFixed(1)} g/kWh).`,
  });

  // 2. Boost Pressure Check
  const maxPimPa = Math.max(...result.trajectories.map((t) => t.intakeManifoldPressurePa));
  const maxBoostBar = maxPimPa / 1e5;
  const boostPassed = maxBoostBar <= maxBoost;
  checks.push({
    passed: boostPassed,
    metric: "Peak Intake Manifold Boost Pressure",
    actual: maxBoostBar,
    threshold: maxBoost,
    unit: "bar",
    message: boostPassed
      ? `Boost pressure (${maxBoostBar.toFixed(2)} bar) is within manifold structural limits (<= ${maxBoost.toFixed(2)} bar).`
      : `Boost pressure (${maxBoostBar.toFixed(2)} bar) exceeds structural rating (<= ${maxBoost.toFixed(2)} bar).`,
  });

  // 3. NOx Emissions Check
  const meanNox = result.trajectories.reduce((a, b) => a + b.noxPpm, 0) / Math.max(1, result.trajectories.length);
  const noxPassed = meanNox <= maxNox;
  checks.push({
    passed: noxPassed,
    metric: "Mean Engine-Out NOx Emissions",
    actual: meanNox,
    threshold: maxNox,
    unit: "ppm",
    message: noxPassed
      ? `NOx concentration (${meanNox.toFixed(1)} ppm) complies with Euro 7 / EPA Tier 4 ceiling (<= ${maxNox.toFixed(1)} ppm).`
      : `NOx concentration (${meanNox.toFixed(1)} ppm) violates emissions ceiling (<= ${maxNox.toFixed(1)} ppm).`,
  });

  // 4. Knock Margin Check
  const actualKnock = result.summary.knockMargin;
  const knockPassed = actualKnock >= minKnock;
  checks.push({
    passed: knockPassed,
    metric: "Autoignition Knock Margin",
    actual: actualKnock,
    threshold: minKnock,
    unit: "fraction",
    message: knockPassed
      ? `Knock safety margin (${(actualKnock * 100).toFixed(1)}%) is above detonation limit (>= ${(minKnock * 100).toFixed(1)}%).`
      : `Knock safety margin (${(actualKnock * 100).toFixed(1)}%) indicates active autoignition risk (< ${(minKnock * 100).toFixed(1)}%).`,
  });

  const overallPassed = checks.every((c) => c.passed);

  const mdLines: string[] = [];
  mdLines.push(`### GT-SUITE Engine Verification Gate Report: ${result.modelName}`);
  mdLines.push(`**Overall Status:** ${overallPassed ? "✅ PASSED" : "❌ FAILED"}\n`);
  mdLines.push("| Metric | Actual | Target Threshold | Status |");
  mdLines.push("| :--- | :--- | :--- | :--- |");
  for (const c of checks) {
    const statusIcon = c.passed ? "✅ PASS" : "❌ FAIL";
    mdLines.push(
      `| ${c.metric} | ${c.actual.toFixed(2)} ${c.unit} | <= ${c.threshold.toFixed(2)} ${c.unit} | ${statusIcon} |`,
    );
  }

  return {
    passed: overallPassed,
    checks,
    markdownSummary: mdLines.join("\n"),
  };
}
