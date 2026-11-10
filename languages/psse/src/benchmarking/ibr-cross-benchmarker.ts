// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * FERC Order 901 / IEEE 2800 / ERCOT DWG EMT-to-RMS Cross-Benchmarking Engine.
 *
 * Compares high-resolution 3-phase electromagnetic transient (EMT) waveforms
 * from PSCAD / EMTDC against positive-sequence RMS dynamic trajectories from PSS/E
 * across mandatory grid code disturbance events:
 * 1. Flat start initialization & numerical stability (0 - 5 s)
 * 2. Small-signal voltage step response (+/- 2% and +/- 5%)
 * 3. Symmetrical 3-phase Low Voltage Ride-Through (LVRT sag down to 0.05 pu, 150 ms)
 * 4. High Voltage Ride-Through (HVRT swell up to 1.20 pu)
 * 5. Phase-angle jump ride-through (25 deg / 45 deg)
 * 6. Frequency excursion and RoCoF ride-through (+/- 0.5 Hz, 3 Hz/s)
 */

import { computeGoodnessOfFit, type GoodnessOfFitMetrics } from "../playback/pmu-smib-harness.js";

/**
 * Disturbance test type for IBR model benchmarking.
 */
export type IbrBenchmarkTestKind =
  | "flat-start"
  | "voltage-step"
  | "lvrt-sag"
  | "hvrt-swell"
  | "phase-jump"
  | "frequency-ramp";

/**
 * Trajectory pair for a single simulation disturbance test.
 */
export interface IbrBenchmarkTrajectoryPair {
  testKind: IbrBenchmarkTestKind;
  testTitle: string;
  timeSec: Float64Array;

  // Positive-sequence RMS trajectories (from PSS/E .out / DAE simulator)
  pRmsMw: Float64Array;
  qRmsMvar: Float64Array;
  vRmsPu: Float64Array;

  // Extracted fundamental positive-sequence EMT trajectories (from PSCAD)
  pEmtMw: Float64Array;
  qEmtMvar: Float64Array;
  vEmtPu: Float64Array;

  // Optional 3-phase instantaneous EMT current and voltage peak envelopes
  iPeakEmtPu?: Float64Array | undefined;
}

/**
 * Evaluation result for a single benchmark disturbance event.
 */
export interface IbrBenchmarkTestResult {
  testKind: IbrBenchmarkTestKind;
  title: string;
  status: "PASS" | "WARN" | "FAIL";
  pMetrics: GoodnessOfFitMetrics;
  qMetrics: GoodnessOfFitMetrics;
  settlingTimeRmsSec: number;
  settlingTimeEmtSec: number;
  settlingTimeDiffMs: number;
  settlingDiffMs?: number | undefined;
  activePowerRecoveryRmsSec?: number | undefined;
  activePowerRecoveryEmtSec?: number | undefined;
  maxTransientOvervoltagePu: number;
  notes: string[];
}

/**
 * Complete FERC Order 901 / IEEE 2800 Model Quality & Cross-Benchmarking Dossier.
 */
export interface IbrCrossBenchmarkReport {
  timestamp: string;
  plantName: string;
  overallStatus: "COMPLIANT" | "NON-COMPLIANT" | "CONDITIONAL";
  summary: {
    totalTests: number;
    passedTests: number;
    warnings: number;
    failedTests: number;
    averagePnrmse: number;
    averageQnrmse: number;
  };
  testResults: IbrBenchmarkTestResult[];
  markdownReport: string;
}

/**
 * Options for EMT-to-RMS model cross-benchmarking.
 */
export interface IbrBenchmarkOptions {
  /** Allowable maximum Normalized RMSE between EMT and RMS active power (default: 0.08 = 8%). */
  maxPnrmse?: number | undefined;
  /** Allowable maximum Normalized RMSE between EMT and RMS reactive power (default: 0.12 = 12%). */
  maxQnrmse?: number | undefined;
  /** Allowable difference in 90% active power recovery time (default: 100 ms). */
  maxRecoveryTimeDiffMs?: number | undefined;
  /** Minimum R² determination coefficient (default: 0.80). */
  minRSquared?: number | undefined;
}

/**
 * Extracts the 90% settling time or active power recovery time from a trajectory.
 */
export function calculateSettlingTime(
  time: Float64Array,
  signal: Float64Array,
  targetFinalVal: number,
  toleranceBand = 0.05,
): number {
  const n = time.length;
  if (n < 2) return 0;
  const tol = Math.max(1e-4, Math.abs(targetFinalVal) * toleranceBand);

  // Scan backwards from end to find last departure from tolerance band
  for (let i = n - 1; i >= 0; i--) {
    if (Math.abs(signal[i]! - targetFinalVal) > tol) {
      return time[Math.min(n - 1, i + 1)]!;
    }
  }
  return time[0]!;
}

/**
 * Evaluates an EMT-vs-RMS benchmark disturbance test case.
 */
export function evaluateIbrBenchmarkTest(
  pair: IbrBenchmarkTrajectoryPair,
  options: IbrBenchmarkOptions = {},
): IbrBenchmarkTestResult {
  const maxP = options.maxPnrmse ?? 0.08;
  const maxQ = options.maxQnrmse ?? 0.12;
  const maxRecDiff = options.maxRecoveryTimeDiffMs ?? 100.0;
  const minR2 = options.minRSquared ?? 0.80;

  const pMetrics = computeGoodnessOfFit(pair.pRmsMw, pair.pEmtMw);
  const qMetrics = computeGoodnessOfFit(pair.qRmsMvar, pair.qEmtMvar);

  const n = pair.timeSec.length;
  const finalPEmt = pair.pEmtMw[n - 1]!;
  const finalPRms = pair.pRmsMw[n - 1]!;

  const settlingEmt = calculateSettlingTime(pair.timeSec, pair.pEmtMw, finalPEmt);
  const settlingRms = calculateSettlingTime(pair.timeSec, pair.pRmsMw, finalPRms);
  const settlingDiffMs = Math.abs(settlingEmt - settlingRms) * 1000.0;

  // Maximum transient overvoltage check (Clause 5.4.2: Vpeak <= 1.20 pu)
  let maxV = 0;
  for (let i = 0; i < n; i++) {
    if (pair.vEmtPu[i]! > maxV) maxV = pair.vEmtPu[i]!;
  }

  const notes: string[] = [];
  let status: "PASS" | "WARN" | "FAIL" = "PASS";

  // Check if signal has meaningful variance or is nearly flat
  let minP = Infinity;
  let maxPVal = -Infinity;
  for (let i = 0; i < n; i++) {
    const val = pair.pEmtMw[i]!;
    if (val < minP) minP = val;
    if (val > maxPVal) maxPVal = val;
  }
  const isPFlat = maxPVal - minP < 0.05 * Math.max(1.0, Math.abs(finalPEmt));

  if (pMetrics.nrmse > maxP) {
    status = "FAIL";
    notes.push(
      `Active power NRMSE (${(pMetrics.nrmse * 100).toFixed(1)}%) exceeds allowable ${(maxP * 100).toFixed(1)}% threshold.`,
    );
  } else if (!isPFlat && pMetrics.rSquared < minR2) {
    status = "WARN";
    notes.push(
      `Active power correlation R² (${pMetrics.rSquared.toFixed(2)}) is below recommended ${minR2.toFixed(2)}.`,
    );
  }

  if (qMetrics.nrmse > maxQ) {
    if (status !== "FAIL") status = "WARN";
    notes.push(
      `Reactive power NRMSE (${(qMetrics.nrmse * 100).toFixed(1)}%) exceeds ${(maxQ * 100).toFixed(1)}% threshold.`,
    );
  }

  if (settlingDiffMs > maxRecDiff) {
    if (status !== "FAIL") status = "WARN";
    notes.push(
      `Active power recovery settling time discrepancy (${settlingDiffMs.toFixed(0)} ms) exceeds ${maxRecDiff} ms limit.`,
    );
  }

  if (maxV > 1.20) {
    status = "FAIL";
    notes.push(`Transient overvoltage peak (${maxV.toFixed(2)} pu) violates IEEE 2800 Clause 5.4.2 limit (1.20 pu).`);
  }

  if (notes.length === 0) {
    notes.push("High-fidelity alignment between positive-sequence RMS and EMT waveforms.");
  }

  return {
    testKind: pair.testKind,
    title: pair.testTitle,
    status,
    pMetrics,
    qMetrics,
    settlingTimeRmsSec: settlingRms,
    settlingTimeEmtSec: settlingEmt,
    settlingTimeDiffMs: settlingDiffMs,
    settlingDiffMs,
    maxTransientOvervoltagePu: maxV,
    notes,
  };
}

/**
 * Runs a complete FERC Order 901 / IEEE 2800 cross-benchmarking evaluation across
 * a suite of disturbance tests and formats a formal submission report.
 */
export function benchmarkIbrModels(
  plantName: string,
  testBattery: IbrBenchmarkTrajectoryPair[],
  options: IbrBenchmarkOptions = {},
): IbrCrossBenchmarkReport {
  const results: IbrBenchmarkTestResult[] = [];
  let passed = 0;
  let warnings = 0;
  let failed = 0;
  let sumPnrmse = 0;
  let sumQnrmse = 0;

  for (const pair of testBattery) {
    const res = evaluateIbrBenchmarkTest(pair, options);
    results.push(res);

    if (res.status === "PASS") passed++;
    else if (res.status === "WARN") warnings++;
    else failed++;

    sumPnrmse += res.pMetrics.nrmse;
    sumQnrmse += res.qMetrics.nrmse;
  }

  const numTests = Math.max(1, testBattery.length);
  const avgPnrmse = sumPnrmse / numTests;
  const avgQnrmse = sumQnrmse / numTests;

  const overallStatus = failed > 0 ? "NON-COMPLIANT" : warnings > 0 ? "CONDITIONAL" : "COMPLIANT";

  // Markdown report formatting
  const lines: string[] = [
    `# FERC Order 901 / IEEE 2800 EMT-to-RMS Model Cross-Benchmarking Dossier`,
    ``,
    `* **Facility Name:** ${plantName}`,
    `* **Evaluation Timestamp:** ${new Date().toISOString()}`,
    `* **Overall Regulatory Verdict:** **${overallStatus}**`,
    `* **Summary:** ${passed} Passed, ${warnings} Conditional, ${failed} Failed (Total ${numTests} tests)`,
    `* **Average Active Power NRMSE:** ${(avgPnrmse * 100).toFixed(1)}%`,
    `* **Average Reactive Power NRMSE:** ${(avgQnrmse * 100).toFixed(1)}%`,
    ``,
    `---`,
    ``,
    `## 1. Disturbance Test Suite Verification Matrix`,
    ``,
    `| Test Event | Status | Active Power NRMSE | Reactive Power NRMSE | Settling Time Diff | Max Vpeak | IEEE 2800 Compliance |`,
    `| :--- | :--- | :--- | :--- | :--- | :--- | :--- |`,
  ];

  for (const r of results) {
    const badge = r.status === "PASS" ? "✅ PASS" : r.status === "WARN" ? "⚠️ WARN" : "❌ FAIL";
    lines.push(
      `| **${r.title}** | ${badge} | ${(r.pMetrics.nrmse * 100).toFixed(1)}% | ${(r.qMetrics.nrmse * 100).toFixed(1)}% | ${r.settlingTimeDiffMs.toFixed(0)} ms | ${r.maxTransientOvervoltagePu.toFixed(2)} pu | ${r.status !== "FAIL" ? "Compliant" : "Deficient"} |`,
    );
  }

  lines.push(``);
  lines.push(`---`);
  lines.push(``);
  lines.push(`## 2. Detailed Technical Findings by Disturbance Case`);

  for (const r of results) {
    lines.push(`### ${r.title} (${r.status})`);
    for (const note of r.notes) {
      lines.push(`* ${note}`);
    }
    lines.push(``);
  }

  lines.push(`---`);
  lines.push(`*Generated by ModelScript Polyglot Engineering Compiler — IEEE 2800-2022 & FERC Order 901 Suite.*`);

  return {
    timestamp: new Date().toISOString(),
    plantName,
    overallStatus,
    summary: {
      totalTests: numTests,
      passedTests: passed,
      warnings,
      failedTests: failed,
      averagePnrmse: avgPnrmse,
      averageQnrmse: avgQnrmse,
    },
    testResults: results,
    markdownReport: lines.join("\n"),
  };
}
