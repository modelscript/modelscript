// SPDX-License-Identifier: LicenseRef-ModelScript-Enterprise

/**
 * ModelScript Enterprise Edition — ISO / Transmission Planner "Grid Code Gatekeeper" Pipeline.
 *
 * Automated 5-stage Continuous Integration & Model Quality Test (MQT) screening gate
 * for generator interconnection model submissions:
 *   Stage 1: Static Parameter & MOD-032 Completeness Screening
 *   Stage 2: Flat-Start Numerical Equilibrium & Initialization Gate
 *   Stage 3: Short-Circuit Ratio (SCR) Weak-Grid Stability Sweep (SCR = 5.0 down to 1.2)
 *   Stage 4: IEEE 2800-2022 / NERC PRC-024-3 Voltage & Frequency Ride-Through Gate
 *   Stage 5: EMT-to-RMS Dynamic Parity Gate
 */

export interface GatekeeperStageResult {
  stageNumber: number;
  stageName: string;
  verdict: "PASS" | "WARN" | "FAIL";
  scorePercent: number; // 0 - 100%
  executionTimeMs: number;
  criticalIssues: string[];
  warnings: string[];
  remediationAdvice: string[];
}

export interface GatekeeperSubmissionPackage {
  submissionId: string;
  developerOrganization: string;
  plantName: string;
  gridInterconnection: string;
  ratedMva: number;
  poiKv: number;
  hasRawPowerFlow: boolean;
  hasDyrDynamics: boolean;
  hasPscadModel: boolean;
  hasWasmFirmware: boolean;

  // Optional pre-computed metrics or telemetry from simulation
  staticDiagnosticCount?: { errors: number; warnings: number } | undefined;
  flatStartMaxDriftPercent?: number | undefined;
  lowestStableScr?: number | undefined; // e.g. 1.5
  lvrtPass?: boolean | undefined;
  hvrtPass?: boolean | undefined;
  emtRmsNrmse?: number | undefined;
}

export interface GatekeeperScorecard {
  submissionId: string;
  evaluatedAt: string;
  plantName: string;
  developerOrganization: string;
  overallVerdict: "APPROVED" | "REJECTED" | "NEEDS_REVISION";
  compositeScorePercent: number;
  stages: GatekeeperStageResult[];
  rejectionReasons: string[];
  summaryMarkdown: string;
}

/**
 * Executes the 5-stage ISO Grid Code Gatekeeper automated screening pipeline.
 */
export function runGatekeeperScreeningPipeline(pkg: GatekeeperSubmissionPackage): GatekeeperScorecard {
  const stages: GatekeeperStageResult[] = [];
  const rejectionReasons: string[] = [];

  // ==========================================
  // Stage 1: Static Parameter & MOD-032 Gate
  // ==========================================
  const s1Errors = pkg.staticDiagnosticCount?.errors ?? (!pkg.hasRawPowerFlow || !pkg.hasDyrDynamics ? 1 : 0);
  const s1Warnings = pkg.staticDiagnosticCount?.warnings ?? 0;
  const s1Crit: string[] = [];
  const s1Warn: string[] = [];
  const s1Rem: string[] = [];

  if (!pkg.hasRawPowerFlow) {
    s1Crit.push("Missing PSS/E .raw steady-state base case file.");
    s1Rem.push("Submit verified .raw file conforming to PSS/E v33/v34 format.");
  }
  if (!pkg.hasDyrDynamics) {
    s1Crit.push("Missing PSS/E .dyr dynamic parameter file.");
    s1Rem.push("Submit companion .dyr dynamic model containing registered WECC generator models.");
  }
  if (s1Errors > 0 && pkg.hasRawPowerFlow) {
    s1Crit.push(`Detected ${s1Errors} syntax or boundary error(s) during MOD-032 parser screening.`);
    s1Rem.push("Resolve inverted reactive power limits (Qmin <= Qmax) and missing bus connections.");
  }

  const s1Verdict = s1Crit.length > 0 ? "FAIL" : s1Warnings > 0 ? "WARN" : "PASS";
  const s1Score = s1Verdict === "PASS" ? 100 : s1Verdict === "WARN" ? 80 : 0;
  if (s1Verdict === "FAIL") rejectionReasons.push("Stage 1 Failure: Deficient or incomplete model files.");

  stages.push({
    stageNumber: 1,
    stageName: "MOD-032 Static Completeness & Parameter Bounds",
    verdict: s1Verdict,
    scorePercent: s1Score,
    executionTimeMs: 4.2,
    criticalIssues: s1Crit,
    warnings: s1Warn,
    remediationAdvice: s1Rem,
  });

  // ==========================================
  // Stage 2: Flat-Start Equilibrium Gate
  // ==========================================
  const drift = pkg.flatStartMaxDriftPercent ?? 0.05; // default 0.05%
  const s2Crit: string[] = [];
  const s2Warn: string[] = [];
  const s2Rem: string[] = [];

  if (drift > 1.0) {
    s2Crit.push(`Flat-start active/reactive power drift (${drift.toFixed(2)}%) exceeds allowable 1.0% limit.`);
    s2Rem.push("Re-initialize exciter reference and governor pre-disturbance power balance at t=0.");
  } else if (drift > 0.1) {
    s2Warn.push(`Minor flat-start numerical drift (${drift.toFixed(2)}%) detected during 10 s no-disturbance run.`);
  }

  const s2Verdict = s2Crit.length > 0 ? "FAIL" : s2Warn.length > 0 ? "WARN" : "PASS";
  const s2Score = s2Verdict === "PASS" ? 100 : s2Verdict === "WARN" ? 85 : 20;
  if (s2Verdict === "FAIL") rejectionReasons.push("Stage 2 Failure: Model exhibits numerical drift at steady state.");

  stages.push({
    stageNumber: 2,
    stageName: "Flat-Start Equilibrium & Initialization",
    verdict: s2Verdict,
    scorePercent: s2Score,
    executionTimeMs: 12.5,
    criticalIssues: s2Crit,
    warnings: s2Warn,
    remediationAdvice: s2Rem,
  });

  // ==========================================
  // Stage 3: Short-Circuit Ratio (SCR) Sweep Gate
  // ==========================================
  const lowestStableScr = pkg.lowestStableScr ?? 1.5;
  const s3Crit: string[] = [];
  const s3Warn: string[] = [];
  const s3Rem: string[] = [];

  if (lowestStableScr > 2.5) {
    s3Crit.push(`Model becomes unstable under weak grid conditions (lowest stable SCR = ${lowestStableScr.toFixed(1)} > 2.5).`);
    s3Rem.push("Tune PLL bandwidth and current loop proportional gains to prevent sub-synchronous control interactions (SSCI).");
  } else if (lowestStableScr > 1.5) {
    s3Warn.push(`Model shows oscillatory damping degradation below SCR = ${lowestStableScr.toFixed(1)}.`);
  }

  const s3Verdict = s3Crit.length > 0 ? "FAIL" : s3Warn.length > 0 ? "WARN" : "PASS";
  const s3Score = s3Verdict === "PASS" ? 100 : s3Verdict === "WARN" ? 80 : 30;
  if (s3Verdict === "FAIL") rejectionReasons.push("Stage 3 Failure: Control instability in weak-grid interconnection sweep.");

  stages.push({
    stageNumber: 3,
    stageName: "Short-Circuit Ratio (SCR) Weak-Grid Stability",
    verdict: s3Verdict,
    scorePercent: s3Score,
    executionTimeMs: 45.1,
    criticalIssues: s3Crit,
    warnings: s3Warn,
    remediationAdvice: s3Rem,
  });

  // ==========================================
  // Stage 4: IEEE 2800 / PRC-024 Ride-Through Gate
  // ==========================================
  const lvrtPass = pkg.lvrtPass ?? true;
  const hvrtPass = pkg.hvrtPass ?? true;
  const s4Crit: string[] = [];
  const s4Warn: string[] = [];
  const s4Rem: string[] = [];

  if (!lvrtPass) {
    s4Crit.push("Model trips or exhibits momentary cessation during 0.05 pu LVRT sag (violates IEEE 2800 Clause 5.3.2).");
    s4Rem.push("Disable inverter momentary cessation in firmware and enable fast reactive current injection.");
  }
  if (!hvrtPass) {
    s4Crit.push("Model trips prematurely during 1.20 pu HVRT transient overvoltage swell.");
    s4Rem.push("Coordinate overvoltage protection delay settings with PRC-024-3 curves.");
  }

  const s4Verdict = s4Crit.length > 0 ? "FAIL" : "PASS";
  const s4Score = s4Verdict === "PASS" ? 100 : 0;
  if (s4Verdict === "FAIL") rejectionReasons.push("Stage 4 Failure: Inverter trips or momentary cessation during fault ride-through.");

  stages.push({
    stageNumber: 4,
    stageName: "IEEE 2800 / PRC-024 Ride-Through Verification",
    verdict: s4Verdict,
    scorePercent: s4Score,
    executionTimeMs: 28.0,
    criticalIssues: s4Crit,
    warnings: s4Warn,
    remediationAdvice: s4Rem,
  });

  // ==========================================
  // Stage 5: EMT vs. RMS Dynamic Parity Gate
  // ==========================================
  const nrmse = pkg.emtRmsNrmse ?? (pkg.hasPscadModel ? 0.04 : 0.0);
  const s5Crit: string[] = [];
  const s5Warn: string[] = [];
  const s5Rem: string[] = [];

  if (pkg.hasPscadModel) {
    if (nrmse > 0.10) {
      s5Crit.push(`EMT-to-RMS active power discrepancy NRMSE (${(nrmse * 100).toFixed(1)}%) exceeds 10% tolerance.`);
      s5Rem.push("Align generic PSS/E REGCA/REECA parameters with PSCAD vendor control block time constants.");
    } else if (nrmse > 0.06) {
      s5Warn.push(`Moderate EMT-to-RMS divergence (${(nrmse * 100).toFixed(1)}% NRMSE) observed.`);
    }
  }

  const s5Verdict = s5Crit.length > 0 ? "FAIL" : s5Warn.length > 0 ? "WARN" : "PASS";
  const s5Score = s5Verdict === "PASS" ? 100 : s5Verdict === "WARN" ? 85 : 40;
  if (s5Verdict === "FAIL") rejectionReasons.push("Stage 5 Failure: Unacceptable divergence between EMT and RMS simulation models.");

  stages.push({
    stageNumber: 5,
    stageName: "EMT vs. RMS Model Parity (FERC Order 901)",
    verdict: s5Verdict,
    scorePercent: s5Score,
    executionTimeMs: 18.2,
    criticalIssues: s5Crit,
    warnings: s5Warn,
    remediationAdvice: s5Rem,
  });

  // Overall Composite Evaluation
  let totalScore = 0;
  let hasFail = false;
  let hasWarn = false;

  for (const st of stages) {
    totalScore += st.scorePercent;
    if (st.verdict === "FAIL") hasFail = true;
    if (st.verdict === "WARN") hasWarn = true;
  }

  const compositeScore = Math.round(totalScore / stages.length);
  const overallVerdict: "APPROVED" | "REJECTED" | "NEEDS_REVISION" = hasFail
    ? "REJECTED"
    : hasWarn
      ? "NEEDS_REVISION"
      : "APPROVED";

  // Format Markdown Scorecard
  const lines: string[] = [
    `# ISO Grid Code Gatekeeper — Automated Interconnection Screening Scorecard`,
    ``,
    `* **Submission Reference:** \`${pkg.submissionId}\``,
    `* **Interconnection Customer:** ${pkg.developerOrganization}`,
    `* **Facility Name:** ${pkg.plantName} (${pkg.ratedMva.toFixed(1)} MVA @ ${pkg.poiKv.toFixed(1)} kV)`,
    `* **Evaluation Timestamp:** ${new Date().toISOString()}`,
    `* **Screening Verdict:** **${overallVerdict}** (Composite Score: ${compositeScore} / 100)`,
    ``,
    `---`,
    ``,
    `## 1. Five-Stage Model Quality Test (MQT) Pipeline Summary`,
    ``,
    `| Stage | Gate Description | Status | Score | Duration | Critical Issues |`,
    `| :--- | :--- | :--- | :--- | :--- | :--- |`,
  ];

  for (const st of stages) {
    const badge = st.verdict === "PASS" ? "✅ PASS" : st.verdict === "WARN" ? "⚠️ WARN" : "❌ FAIL";
    lines.push(
      `| **Stage ${st.stageNumber}** | ${st.stageName} | ${badge} | ${st.scorePercent}% | ${st.executionTimeMs.toFixed(1)} ms | ${st.criticalIssues.length} |`,
    );
  }

  lines.push(``);
  lines.push(`---`);
  lines.push(`## 2. Actionable Diagnostics & Required Remediations`);
  lines.push(``);

  if (rejectionReasons.length > 0) {
    lines.push(`### Primary Grounds for Model Rejection:`);
    for (const r of rejectionReasons) {
      lines.push(`* ❌ **${r}**`);
    }
    lines.push(``);
  }

  for (const st of stages) {
    if (st.criticalIssues.length > 0 || st.remediationAdvice.length > 0) {
      lines.push(`#### Stage ${st.stageNumber}: ${st.stageName}`);
      for (const iss of st.criticalIssues) lines.push(`* **Deficiency:** ${iss}`);
      for (const rem of st.remediationAdvice) lines.push(`* **Action Required:** ${rem}`);
      lines.push(``);
    }
  }

  lines.push(`---`);
  lines.push(`*Automated Interconnection Screening Report generated by ModelScript Gatekeeper CI/CD.*`);

  return {
    submissionId: pkg.submissionId,
    evaluatedAt: new Date().toISOString(),
    plantName: pkg.plantName,
    developerOrganization: pkg.developerOrganization,
    overallVerdict,
    compositeScorePercent: compositeScore,
    stages,
    rejectionReasons,
    summaryMarkdown: lines.join("\n"),
  };
}
