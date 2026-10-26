// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/gensys — Automated Safety, Derailment & Homologation Reporting Engine
 *
 * Generates standards-compliant railway homologation reports:
 * - EN 14363: Running safety (Nadal Y/Q <= 0.80) & Track fatigue (Prud'homme lateral force)
 * - EN 14067-6: Cross-wind dynamic wheel unloading ratio (Delta Q / Q0 <= 0.90)
 * - Sperling / EN 12299: Passenger ride comfort index (Wz <= 2.5 / 3.0)
 * - Exporters: SARIF 2.1.0, JUnit XML, CTRF JSON, and interactive standalone HTML dashboard.
 */

export type HomologationStatus = "PASS" | "FAIL" | "WARNING";
export type HomologationCategory =
  | "running_safety"
  | "track_fatigue"
  | "cross_wind"
  | "ride_comfort"
  | "contact_mechanics";

export interface HomologationCheck {
  id: string; // e.g. "EN14363-Y-OVER-Q"
  standard: string; // e.g. "EN 14363 / UIC 518"
  name: string; // e.g. "Nadal Derailment Risk Limit (Y/Q)"
  category: HomologationCategory;
  measuredValue: number;
  limitValue: number;
  unit: string;
  operator: "<=" | ">=";
  status: HomologationStatus;
  description: string;
  recommendation?: string | undefined;
}

export interface HomologationReportSummary {
  passed: boolean;
  totalChecks: number;
  checksPassed: number;
  checksFailed: number;
  checksWarning: number;
}

export interface HomologationReport {
  modelName: string;
  vehicleType: string;
  timestamp: string;
  evaluator: string;
  summary: HomologationReportSummary;
  checks: HomologationCheck[];
}

export interface CreateHomologationReportInput {
  modelName: string;
  vehicleType?: string | undefined;
  maxNadalYOverQ: number; // Y/Q
  maxLateralForceYKn: number; // Y [kN]
  nominalAxleLoadQ0Kn: number; // Axle load 2*Q0 [kN]
  sperlingVerticalWz?: number | undefined;
  sperlingHorizontalWz?: number | undefined;
  crossWindUnloadingRatio?: number | undefined; // Delta Q / Q0
  equivalentConicity?: number | undefined;
  additionalChecks?: HomologationCheck[] | undefined;
}

/**
 * Builds a complete homologation report evaluating standard railway safety and comfort criteria.
 */
export function createHomologationReport(input: CreateHomologationReportInput): HomologationReport {
  const checks: HomologationCheck[] = [];

  // 1. EN 14363: Nadal derailment coefficient Y/Q <= 0.80
  const yqPassed = input.maxNadalYOverQ <= 0.8;
  const yqWarning = !yqPassed && input.maxNadalYOverQ <= 0.9;
  checks.push({
    id: "EN14363-DERAILMENT-YQ",
    standard: "EN 14363:2016 §5.3.2",
    name: "Nadal Derailment Quotient (Y/Q)",
    category: "running_safety",
    measuredValue: input.maxNadalYOverQ,
    limitValue: 0.8,
    unit: "-",
    operator: "<=",
    status: yqPassed ? "PASS" : yqWarning ? "WARNING" : "FAIL",
    description:
      "Evaluates wheel climb derailment safety based on ratio of lateral guiding force Y to vertical wheel load Q.",
    recommendation: yqPassed
      ? undefined
      : "Increase primary suspension lateral damping or improve wheelset steering geometry.",
  });

  // 2. EN 14363: Prud'homme lateral track shifting force limit H_lim = 10 + 2*Q0/3
  const prudhommeLimit = 10 + (2 / 3) * (input.nominalAxleLoadQ0Kn / 2);
  const prudPassed = input.maxLateralForceYKn <= prudhommeLimit;
  checks.push({
    id: "EN14363-PRUDHOMME-FORCE",
    standard: "EN 14363:2016 §5.3.3",
    name: "Prud'homme Lateral Track Shifting Force",
    category: "track_fatigue",
    measuredValue: input.maxLateralForceYKn,
    limitValue: prudhommeLimit,
    unit: "kN",
    operator: "<=",
    status: prudPassed ? "PASS" : "FAIL",
    description:
      "Limits maximum lateral track shifting force to prevent track lateral displacement and ballast destabilization.",
    recommendation: prudPassed
      ? undefined
      : "Reduce axle load, lower curve negotiation speed, or soften bogie yaw stiffness.",
  });

  // 3. EN 14067-6: Cross-wind dynamic wheel unloading ratio Delta Q / Q0 <= 0.90
  if (input.crossWindUnloadingRatio !== undefined) {
    const unloadingPassed = input.crossWindUnloadingRatio <= 0.9;
    checks.push({
      id: "EN14067-WHEEL-UNLOADING",
      standard: "EN 14067-6:2018 §6.2",
      name: "Cross-Wind Dynamic Wheel Unloading Ratio (Delta Q / Q0)",
      category: "cross_wind",
      measuredValue: input.crossWindUnloadingRatio,
      limitValue: 0.9,
      unit: "-",
      operator: "<=",
      status: unloadingPassed ? "PASS" : "FAIL",
      description: "Limits dynamic wheel unloading due to aerodynamic overturning roll moment and lift force.",
      recommendation: unloadingPassed
        ? undefined
        : "Lower vehicle center of gravity or enforce speed restrictions under severe crosswinds.",
    });
  }

  // 4. Sperling ride comfort index Wz (vertical) <= 3.0
  if (input.sperlingVerticalWz !== undefined) {
    const wzVertPassed = input.sperlingVerticalWz <= 3.0;
    const wzVertWarning = input.sperlingVerticalWz > 2.5 && wzVertPassed;
    checks.push({
      id: "SPERLING-RIDE-VERTICAL",
      standard: "EN 12299 / Sperling Wz",
      name: "Sperling Ride Index Wz (Vertical)",
      category: "ride_comfort",
      measuredValue: input.sperlingVerticalWz,
      limitValue: 3.0,
      unit: "-",
      operator: "<=",
      status: wzVertWarning ? "WARNING" : wzVertPassed ? "PASS" : "FAIL",
      description:
        "Evaluates passenger ride comfort in vertical direction (Wz < 2.5: Very Good, 2.5-3.0: Good, >3.0: Mediocre).",
    });
  }

  // 5. Sperling ride comfort index Wz (horizontal) <= 3.0
  if (input.sperlingHorizontalWz !== undefined) {
    const wzHorizPassed = input.sperlingHorizontalWz <= 3.0;
    const wzHorizWarning = input.sperlingHorizontalWz > 2.5 && wzHorizPassed;
    checks.push({
      id: "SPERLING-RIDE-HORIZONTAL",
      standard: "EN 12299 / Sperling Wz",
      name: "Sperling Ride Index Wz (Horizontal)",
      category: "ride_comfort",
      measuredValue: input.sperlingHorizontalWz,
      limitValue: 3.0,
      unit: "-",
      operator: "<=",
      status: wzHorizWarning ? "WARNING" : wzHorizPassed ? "PASS" : "FAIL",
      description: "Evaluates passenger ride comfort in lateral horizontal direction.",
    });
  }

  // 6. Equivalent conicity lambda_eq <= 0.40
  if (input.equivalentConicity !== undefined) {
    const conicityPassed = input.equivalentConicity <= 0.4;
    checks.push({
      id: "UIC518-EQUIVALENT-CONICITY",
      standard: "UIC 518 / EN 14363",
      name: "Wheel-Rail Equivalent Conicity (lambda_eq)",
      category: "contact_mechanics",
      measuredValue: input.equivalentConicity,
      limitValue: 0.4,
      unit: "-",
      operator: "<=",
      status: conicityPassed ? "PASS" : "FAIL",
      description: "Prevents high-speed kinematic wheelset hunting instability.",
    });
  }

  // Additional custom checks
  if (input.additionalChecks) {
    checks.push(...input.additionalChecks);
  }

  let passedCount = 0;
  let failedCount = 0;
  let warningCount = 0;

  for (const c of checks) {
    if (c.status === "PASS") passedCount++;
    else if (c.status === "FAIL") failedCount++;
    else if (c.status === "WARNING") warningCount++;
  }

  return {
    modelName: input.modelName,
    vehicleType: input.vehicleType ?? "Passenger Coach",
    timestamp: new Date().toISOString(),
    evaluator: "@modelscript/gensys Homologation Engine v1.0",
    summary: {
      passed: failedCount === 0,
      totalChecks: checks.length,
      checksPassed: passedCount,
      checksFailed: failedCount,
      checksWarning: warningCount,
    },
    checks,
  };
}

/**
 * Exports report into SARIF 2.1.0 JSON format for GitHub Security / Code Quality scanning.
 */
export function exportHomologationSarif(report: HomologationReport): string {
  const sarif = {
    $schema: "https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json",
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: "ModelScript Railway Homologation Engine",
            version: "1.0.0",
            informationUri: "https://modelscript.org",
            rules: report.checks.map((c) => ({
              id: c.id,
              name: c.name,
              shortDescription: { text: `${c.standard}: ${c.name}` },
              fullDescription: { text: c.description },
              defaultConfiguration: {
                level: c.status === "FAIL" ? "error" : c.status === "WARNING" ? "warning" : "note",
              },
            })),
          },
        },
        results: report.checks
          .filter((c) => c.status !== "PASS")
          .map((c) => ({
            ruleId: c.id,
            level: c.status === "FAIL" ? "error" : "warning",
            message: {
              text: `${c.name} violation: measured ${c.measuredValue.toFixed(3)} ${c.unit} exceeds limit of ${c.limitValue.toFixed(3)} ${c.unit}. ${c.recommendation ?? ""}`,
            },
            locations: [
              {
                physicalLocation: {
                  artifactLocation: { uri: `${report.modelName}.ins` },
                  region: { startLine: 1, startColumn: 1 },
                },
              },
            ],
          })),
      },
    ],
  };

  return JSON.stringify(sarif, null, 2);
}

/**
 * Exports report into standard JUnit XML format for CI/CD test runners.
 */
export function exportHomologationJunit(report: HomologationReport): string {
  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push(
    `<testsuites name="Railway Homologation" tests="${report.summary.totalChecks}" failures="${report.summary.checksFailed}" errors="0">`,
  );
  lines.push(
    `  <testsuite name="${report.modelName}" tests="${report.summary.totalChecks}" failures="${report.summary.checksFailed}" errors="0" timestamp="${report.timestamp}">`,
  );

  for (const c of report.checks) {
    lines.push(`    <testcase classname="${report.modelName}.${c.category}" name="${c.id} - ${c.name}" time="0.001">`);
    if (c.status === "FAIL") {
      lines.push(
        `      <failure message="${c.name} failed: measured ${c.measuredValue.toFixed(3)} ${c.unit} violates limit ${c.operator} ${c.limitValue.toFixed(3)} ${c.unit}">`,
      );
      lines.push(
        `Standard: ${c.standard}\nDescription: ${c.description}\nRecommendation: ${c.recommendation ?? "None"}`,
      );
      lines.push(`      </failure>`);
    } else if (c.status === "WARNING") {
      lines.push(
        `      <!-- Warning: measured ${c.measuredValue.toFixed(3)} is close to limit ${c.limitValue.toFixed(3)} -->`,
      );
    }
    lines.push(`    </testcase>`);
  }

  lines.push(`  </testsuite>`);
  lines.push(`</testsuites>`);
  return lines.join("\n");
}

/**
 * Exports report into CTRF (Common Test Report Format) JSON.
 */
export function exportHomologationCtrf(report: HomologationReport): string {
  const ctrf = {
    results: {
      tool: {
        name: "ModelScript Railway Homologation Engine",
        version: "1.0.0",
      },
      summary: {
        tests: report.summary.totalChecks,
        passed: report.summary.checksPassed,
        failed: report.summary.checksFailed,
        pending: 0,
        skipped: 0,
        other: report.summary.checksWarning,
        start: Date.now(),
        stop: Date.now() + 10,
      },
      tests: report.checks.map((c) => ({
        name: `${c.id} - ${c.name}`,
        status: c.status === "PASS" ? "passed" : c.status === "FAIL" ? "failed" : "other",
        duration: 1,
        message: `${c.standard}: measured ${c.measuredValue.toFixed(3)} vs limit ${c.operator} ${c.limitValue.toFixed(3)} ${c.unit}`,
      })),
    },
  };
  return JSON.stringify(ctrf, null, 2);
}

/**
 * Exports report into a responsive standalone HTML dashboard with dark mode and interactive visuals.
 */
export function exportHomologationHtml(report: HomologationReport): string {
  const isPassed = report.summary.passed;
  const statusColor = isPassed ? "#10b981" : "#ef4444";
  const statusLabel = isPassed ? "PASSED" : "FAILED";

  const rows = report.checks
    .map((c) => {
      const badgeBg =
        c.status === "PASS"
          ? "rgba(16, 185, 129, 0.2)"
          : c.status === "WARNING"
            ? "rgba(245, 158, 11, 0.2)"
            : "rgba(239, 68, 68, 0.2)";
      const badgeFg = c.status === "PASS" ? "#34d399" : c.status === "WARNING" ? "#fbbf24" : "#f87171";
      return `
        <tr style="border-bottom: 1px solid rgba(255,255,255,0.06);">
          <td style="padding: 12px 16px; font-weight: 600; color: #f3f4f6;">${c.name}<br/><span style="font-size: 11px; color: #9ca3af; font-weight: 400;">${c.standard}</span></td>
          <td style="padding: 12px 16px; font-family: monospace; color: #93c5fd;">${c.category}</td>
          <td style="padding: 12px 16px; font-family: monospace; font-size: 14px; color: #e5e7eb;">${c.measuredValue.toFixed(3)} ${c.unit}</td>
          <td style="padding: 12px 16px; font-family: monospace; font-size: 14px; color: #9ca3af;">${c.operator} ${c.limitValue.toFixed(3)} ${c.unit}</td>
          <td style="padding: 12px 16px; text-align: center;">
            <span style="display: inline-block; padding: 4px 10px; border-radius: 9999px; font-size: 12px; font-weight: 700; background: ${badgeBg}; color: ${badgeFg};">
              ${c.status}
            </span>
          </td>
        </tr>`;
    })
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Railway Homologation Report — ${report.modelName}</title>
  <style>
    body {
      margin: 0;
      padding: 32px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background-color: #0d1117;
      color: #c9d1d9;
    }
    .container {
      max-width: 1000px;
      margin: 0 auto;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-bottom: 24px;
      border-bottom: 1px solid #30363d;
      margin-bottom: 28px;
    }
    .title {
      font-size: 26px;
      font-weight: 800;
      color: #ffffff;
      margin: 0 0 6px 0;
    }
    .subtitle {
      font-size: 14px;
      color: #8b949e;
      margin: 0;
    }
    .badge-status {
      padding: 8px 20px;
      border-radius: 9999px;
      font-size: 16px;
      font-weight: 800;
      letter-spacing: 0.05em;
      background: ${statusColor}22;
      color: ${statusColor};
      border: 1px solid ${statusColor}66;
    }
    .cards {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 16px;
      margin-bottom: 32px;
    }
    .card {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 8px;
      padding: 16px 20px;
    }
    .card-label {
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #8b949e;
      margin-bottom: 4px;
    }
    .card-val {
      font-size: 24px;
      font-weight: 700;
      color: #f0f6fc;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      background: #161b22;
      border-radius: 8px;
      overflow: hidden;
      border: 1px solid #30363d;
    }
    th {
      background: #21262d;
      padding: 12px 16px;
      text-align: left;
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #8b949e;
      border-bottom: 1px solid #30363d;
    }
    .footer {
      margin-top: 36px;
      font-size: 12px;
      color: #6e7681;
      text-align: center;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div>
        <h1 class="title">${report.modelName}</h1>
        <p class="subtitle">Vehicle Type: ${report.vehicleType} • Evaluated: ${report.timestamp} by ${report.evaluator}</p>
      </div>
      <div class="badge-status">${statusLabel}</div>
    </div>

    <div class="cards">
      <div class="card">
        <div class="card-label">Total Checks</div>
        <div class="card-val">${report.summary.totalChecks}</div>
      </div>
      <div class="card">
        <div class="card-label">Passed</div>
        <div class="card-val" style="color: #34d399;">${report.summary.checksPassed}</div>
      </div>
      <div class="card">
        <div class="card-label">Failed</div>
        <div class="card-val" style="color: #f87171;">${report.summary.checksFailed}</div>
      </div>
      <div class="card">
        <div class="card-label">Warnings</div>
        <div class="card-val" style="color: #fbbf24;">${report.summary.checksWarning}</div>
      </div>
    </div>

    <table>
      <thead>
        <tr>
          <th>Standard & Criterion</th>
          <th>Domain</th>
          <th>Measured</th>
          <th>Limit</th>
          <th style="text-align: center;">Status</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>

    <div class="footer">
      Generated automatically by ModelScript Multi-Body Engineering Suite per EN 14363, EN 14067-6, and UIC 518.
    </div>
  </div>
</body>
</html>`;
}

import type { En14363TrajectoryAssessment } from "./en14363.js";

/**
 * Convenience builder to generate a complete homologation report directly from
 * a full EN 14363 trajectory assessment.
 */
export function createHomologationReportFromTrajectory(
  trajectory: En14363TrajectoryAssessment,
  input: {
    modelName: string;
    vehicleType?: string | undefined;
    nominalAxleLoadQ0Kn: number;
    sperlingVerticalWz?: number | undefined;
    sperlingHorizontalWz?: number | undefined;
    crossWindUnloadingRatio?: number | undefined;
    equivalentConicity?: number | undefined;
  },
): HomologationReport {
  return createHomologationReport({
    modelName: input.modelName,
    vehicleType: input.vehicleType,
    maxNadalYOverQ: trajectory.maxSlidingYOverQ,
    maxLateralForceYKn: trajectory.maxPrudhommeForceKn,
    nominalAxleLoadQ0Kn: input.nominalAxleLoadQ0Kn,
    sperlingVerticalWz: input.sperlingVerticalWz,
    sperlingHorizontalWz: input.sperlingHorizontalWz,
    crossWindUnloadingRatio: input.crossWindUnloadingRatio,
    equivalentConicity: input.equivalentConicity,
    additionalChecks: [
      {
        id: "EN14363-QUASI-STATIC-Y",
        standard: "EN 14363:2016 §5.3.3",
        name: "Quasi-Static Lateral Guiding Force (Y_qst)",
        category: "track_fatigue",
        measuredValue: trajectory.maxQuasiStaticGuidingForceKn,
        limitValue: trajectory.quasiStaticLimitKn,
        unit: "kN",
        operator: "<=",
        status: trajectory.quasiStaticPassed ? "PASS" : "FAIL",
        description: "Limits track fatigue and rail rollover under steady curve negotiation.",
        recommendation: trajectory.quasiStaticPassed
          ? undefined
          : "Reduce vehicle speed on curves or optimize wheel conicity.",
      },
    ],
  });
}
