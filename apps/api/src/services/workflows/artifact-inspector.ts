// SPDX-License-Identifier: AGPL-3.0-or-later

import fs from "node:fs";
import path from "node:path";
import type {
  EcoSimulationCheck,
  EcoSimulationResult,
  EcoSimulationTrajectoryPoint,
} from "../spaces/eco-simulation-gate-service.js";

export interface InspectedArtifactSummary {
  status: "passed" | "failed";
  hasDiscoveredReports: boolean;
  solver?: string | undefined;
  tolerance?: number | undefined;
  maxRelError?: number | undefined;
  variablesCount?: number | undefined;
  equationsCount?: number | undefined;
  trajectories?: EcoSimulationTrajectoryPoint[] | undefined;
  checks?: EcoSimulationCheck[] | undefined;
  rawArtifacts?: { name: string; path: string; size: number }[] | undefined;
  testSummary?:
    | {
        total: number;
        passed: number;
        failed: number;
        skipped: number;
      }
    | undefined;
}

/**
 * Inspects a directory or list of file paths for simulation summaries, test results,
 * or physics trajectory artifacts produced during a CI/CD workflow run.
 */
export function inspectWorkflowArtifacts(workDir: string): InspectedArtifactSummary {
  const result: InspectedArtifactSummary = {
    status: "passed",
    hasDiscoveredReports: false,
    checks: [],
    rawArtifacts: [],
  };

  if (!fs.existsSync(workDir)) {
    return result;
  }

  // 1. Scan directory recursively up to depth 3
  const foundFiles: string[] = [];
  function scan(dir: string, depth = 0) {
    if (depth > 3) return;
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const ent of entries) {
        if (ent.name === ".git" || ent.name === "node_modules") continue;
        const full = path.join(dir, ent.name);
        if (ent.isDirectory()) {
          scan(full, depth + 1);
        } else if (ent.isFile()) {
          foundFiles.push(full);
        }
      }
    } catch {}
  }
  scan(workDir);

  for (const f of foundFiles) {
    const rel = path.relative(workDir, f);
    try {
      const stat = fs.statSync(f);
      result.rawArtifacts?.push({
        name: rel,
        path: rel,
        size: stat.size,
      });
    } catch {}
  }

  // 2. Look for simulation summary JSON
  const simSummaryFile = foundFiles.find((f) =>
    /(?:sim-summary|simulation-summary|sim_result|simulation_result|sim-result)\.json$/i.test(f),
  );

  if (simSummaryFile) {
    try {
      const content = fs.readFileSync(simSummaryFile, "utf-8");
      const parsed = JSON.parse(content) as Record<string, unknown>;
      result.hasDiscoveredReports = true;

      if (parsed["status"] === "failed") {
        result.status = "failed";
      }

      if (parsed["solver"]) result.solver = String(parsed["solver"]);
      if (typeof parsed["tolerance"] === "number") result.tolerance = parsed["tolerance"];
      if (typeof parsed["maxRelError"] === "number") result.maxRelError = parsed["maxRelError"];
      if (typeof parsed["variablesCount"] === "number") result.variablesCount = parsed["variablesCount"];
      if (typeof parsed["equationsCount"] === "number") result.equationsCount = parsed["equationsCount"];

      if (Array.isArray(parsed["trajectories"])) {
        result.trajectories = parsed["trajectories"] as EcoSimulationTrajectoryPoint[];
      }

      if (Array.isArray(parsed["checks"])) {
        const rawChecks = parsed["checks"] as Record<string, unknown>[];
        for (const c of rawChecks) {
          result.checks?.push({
            name: String(c["name"] || "Simulation Check"),
            status: c["status"] === "failed" ? "failed" : "passed",
            value: String(c["value"] || ""),
            limit: String(c["limit"] || ""),
            margin: String(c["margin"] || ""),
          });
          if (c["status"] === "failed") {
            result.status = "failed";
          }
        }
      }
    } catch {}
  }

  // 3. Look for JUnit XML or CTRF test results
  const junitFile = foundFiles.find((f) => /(?:junit|test-results?|report).*\.xml$/i.test(f));
  if (junitFile) {
    try {
      const content = fs.readFileSync(junitFile, "utf-8");
      // Simple regex parse of standard JUnit XML <testsuite tests="X" failures="Y" errors="Z">
      const suiteMatch = content.match(/<testsuite[^>]*tests=["'](\d+)["'][^>]*failures=["'](\d+)["']/i);
      if (suiteMatch) {
        const total = parseInt(suiteMatch[1] || "0", 10);
        const failed = parseInt(suiteMatch[2] || "0", 10);
        const passed = Math.max(0, total - failed);
        result.testSummary = {
          total,
          passed,
          failed,
          skipped: 0,
        };

        result.checks?.push({
          name: `JUnit Test Suite: ${path.basename(junitFile)}`,
          status: failed === 0 ? "passed" : "failed",
          value: `${passed}/${total} passed`,
          limit: "0 failures",
          margin: failed === 0 ? "All tests passing" : `${failed} failing tests`,
        });

        if (failed > 0) {
          result.status = "failed";
        }
      }
    } catch {}
  }

  // 4. Look for CTRF JSON test reports
  const ctrfFile = foundFiles.find((f) => /ctrf.*\.json$/i.test(f));
  if (ctrfFile) {
    try {
      const content = fs.readFileSync(ctrfFile, "utf-8");
      const parsed = JSON.parse(content) as Record<string, unknown>;
      const summary = (parsed["results"] as Record<string, unknown> | undefined)?.["summary"] as
        | Record<string, unknown>
        | undefined;
      if (summary) {
        const tests = Number(summary["tests"] || 0);
        const passed = Number(summary["passed"] || 0);
        const failed = Number(summary["failed"] || 0);
        const skipped = Number(summary["skipped"] || 0);

        result.testSummary = { total: tests, passed, failed, skipped };
        result.checks?.push({
          name: "CTRF Test Suite",
          status: failed === 0 ? "passed" : "failed",
          value: `${passed}/${tests} passed`,
          limit: "0 failures",
          margin: failed === 0 ? "100% compliance" : `${failed} test failure(s)`,
        });

        if (failed > 0) {
          result.status = "failed";
        }
      }
    } catch {}
  }

  // 5. Look for Trajectory CSV (e.g. trajectories.csv or result.csv)
  const csvFile = foundFiles.find((f) => /(?:trajectories|trajectory|simulation_trajectory)\.csv$/i.test(f));
  if (csvFile && (!result.trajectories || result.trajectories.length === 0)) {
    try {
      const lines = fs
        .readFileSync(csvFile, "utf-8")
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
      if (lines.length > 1) {
        const header = lines[0]!.split(",").map((c) => c.trim().toLowerCase());
        const timeIdx = header.indexOf("time");
        const baseIdx = header.findIndex((h) => h.includes("base"));
        const branchIdx = header.findIndex((h) => h.includes("branch") || h.includes("cand") || h.includes("actual"));

        if (timeIdx !== -1 && baseIdx !== -1) {
          const points: EcoSimulationTrajectoryPoint[] = [];
          for (let i = 1; i < lines.length && points.length < 50; i++) {
            const cols = lines[i]!.split(",").map((c) => parseFloat(c.trim()));
            const t = cols[timeIdx] ?? 0;
            const b = cols[baseIdx] ?? 0;
            const c = (branchIdx !== -1 ? cols[branchIdx] : b) ?? b;
            const env = Math.abs(b * 0.05) + 0.02;
            points.push({
              time: Number(t.toFixed(2)),
              baseline: Number(b.toFixed(4)),
              branch: Number(c.toFixed(4)),
              upperTolerance: Number((b + env).toFixed(4)),
              lowerTolerance: Number((b - env).toFixed(4)),
            });
          }
          if (points.length > 0) {
            result.trajectories = points;
          }
        }
      }
    } catch {}
  }

  return result;
}

/**
 * Builds a full EcoSimulationResult object from inspected artifacts, falling back
 * gracefully to synthesized verification envelopes if some fields are missing.
 */
export function synthesizeEcoSimulationFromArtifacts(opts: {
  inspected: InspectedArtifactSummary;
  fallbackBaseResult: EcoSimulationResult;
}): EcoSimulationResult {
  const { inspected, fallbackBaseResult } = opts;

  const trajectories =
    inspected.trajectories && inspected.trajectories.length > 0
      ? inspected.trajectories
      : fallbackBaseResult.trajectories;

  const checks = inspected.checks && inspected.checks.length > 0 ? inspected.checks : fallbackBaseResult.checks;

  const gateStatus = inspected.status === "failed" ? "failed" : fallbackBaseResult.gateStatus;

  return {
    gateStatus,
    checkedAt: new Date().toISOString(),
    solver: inspected.solver || fallbackBaseResult.solver,
    tolerance: inspected.tolerance || fallbackBaseResult.tolerance,
    maxRelError: inspected.maxRelError ?? fallbackBaseResult.maxRelError,
    variablesCount: inspected.variablesCount || fallbackBaseResult.variablesCount,
    equationsCount: inspected.equationsCount || fallbackBaseResult.equationsCount,
    trajectories,
    checks,
  };
}
