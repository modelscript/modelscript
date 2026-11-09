// SPDX-License-Identifier: AGPL-3.0-or-later

import { execFileSync, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { gitSubprocessEnv } from "../../util/git-hardening.js";
import type { EcoSimulationResult } from "../spaces/eco-simulation-gate-service.js";
import { computeEcoSimulationVerification } from "../spaces/eco-simulation-gate-service.js";
import { inspectWorkflowArtifacts, synthesizeEcoSimulationFromArtifacts } from "./artifact-inspector.js";
import type { WorkflowJob, WorkflowManifest, WorkflowStep } from "./workflow-parser.js";

export interface WorkflowStepResult {
  id?: string | undefined;
  name: string;
  status: "passed" | "failed" | "skipped";
  exitCode: number;
  durationMs: number;
  stdout: string;
  stderr: string;
}

export interface WorkflowJobResult {
  id: string;
  name: string;
  status: "passed" | "failed" | "skipped";
  durationMs: number;
  steps: WorkflowStepResult[];
}

export interface WorkflowRunResult {
  id: string;
  provider: "github" | "gitlab" | "ansatz";
  workflowFile: string;
  workflowName: string;
  ref: string;
  commitSha?: string | undefined;
  status: "passed" | "failed";
  conclusion: "success" | "failure";
  startedAt: string;
  completedAt: string;
  durationMs: number;
  jobs: WorkflowJobResult[];
  artifacts: { name: string; path: string; size: number }[];
  simulationSummary: EcoSimulationResult;
  hasArtifactSummary: boolean;
  logs: string;
}

/**
 * Sorts jobs into topological execution order based on their `needs` dependencies.
 */
export function sortJobsTopologically(jobs: Map<string, WorkflowJob>): WorkflowJob[] {
  const result: WorkflowJob[] = [];
  const inDegree = new Map<string, number>();
  const graph = new Map<string, string[]>();

  for (const [id] of jobs) {
    inDegree.set(id, 0);
    graph.set(id, []);
  }

  for (const [id, job] of jobs) {
    for (const dep of job.needs) {
      if (jobs.has(dep)) {
        graph.get(dep)!.push(id);
        inDegree.set(id, (inDegree.get(id) || 0) + 1);
      }
    }
  }

  const queue: string[] = [];
  for (const [id, deg] of inDegree.entries()) {
    if (deg === 0) queue.push(id);
  }

  while (queue.length > 0) {
    const cur = queue.shift()!;
    const j = jobs.get(cur);
    if (j) result.push(j);

    for (const nxt of graph.get(cur) || []) {
      inDegree.set(nxt, (inDegree.get(nxt) || 1) - 1);
      if (inDegree.get(nxt) === 0) {
        queue.push(nxt);
      }
    }
  }

  // If there's a cycle or remaining jobs not caught by queue, append them
  for (const [id, job] of jobs) {
    if (!result.some((r) => r.id === id)) {
      result.push(job);
    }
  }

  return result;
}

/**
 * Executes a WorkflowManifest (parsed from .github/workflows/*.yml or .gitlab-ci.yml)
 * natively within an isolated scratch environment extracted from the target git ref.
 */
export function executeWorkflowManifest(opts: {
  repoPath: string;
  ref: string;
  commitSha?: string | undefined;
  manifest: WorkflowManifest;
  ecoId?: string | undefined;
  spaceId?: string | undefined;
  extraEnv?: Record<string, string> | undefined;
  timeoutMs?: number | undefined;
}): WorkflowRunResult {
  const runId = `wfr_${crypto.randomBytes(8).toString("hex")}`;
  const startedAt = new Date().toISOString();
  const startTime = Date.now();

  const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), "ansatz-ci-"));
  const gitEnv = gitSubprocessEnv();

  // Extract source files at ref into scratch directory using git archive
  try {
    const tarBuf = execFileSync("git", ["-C", opts.repoPath, "archive", "--format=tar", opts.ref], {
      env: gitEnv,
      maxBuffer: 50 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });

    execFileSync("tar", ["-x", "-C", scratchDir], {
      input: tarBuf,
      stdio: ["pipe", "ignore", "ignore"],
    });
  } catch {
    // If git archive fails (e.g. empty repo or non-existent ref), proceed with empty directory
  }

  const sortedJobs = sortJobsTopologically(opts.manifest.jobs);
  const jobResults: WorkflowJobResult[] = [];
  const combinedLogs: string[] = [];

  let overallPassed = true;
  const completedJobStatuses = new Map<string, "passed" | "failed" | "skipped">();

  for (const job of sortedJobs) {
    const jobStartTime = Date.now();
    const stepResults: WorkflowStepResult[] = [];
    combinedLogs.push(`\n=== Job: ${job.name} (${job.id}) ===`);

    // Check if any prerequisite jobs failed
    const depsFailed = job.needs.some((dep) => completedJobStatuses.get(dep) !== "passed");
    if (depsFailed) {
      jobResults.push({
        id: job.id,
        name: job.name,
        status: "skipped",
        durationMs: 0,
        steps: [],
      });
      completedJobStatuses.set(job.id, "skipped");
      combinedLogs.push(`Job skipped because prerequisite dependency failed.`);
      overallPassed = false;
      continue;
    }

    let jobFailed = false;

    // Merge env
    const jobEnv: Record<string, string> = {
      ...(process.env as Record<string, string>),
      CI: "true",
      ANSATZ_CI: "true",
      GITHUB_ACTIONS: opts.manifest.provider === "github" ? "true" : "false",
      GITLAB_CI: opts.manifest.provider === "gitlab" ? "true" : "false",
      REF: opts.ref,
      COMMIT_SHA: opts.commitSha || "",
      ECO_ID: opts.ecoId || "",
      SPACE_ID: opts.spaceId || "",
      ...(opts.manifest.env || {}),
      ...(job.env || {}),
      ...(opts.extraEnv || {}),
    };

    for (let sIdx = 0; sIdx < job.steps.length; sIdx++) {
      const step: WorkflowStep = job.steps[sIdx]!;
      const stepName = step.name || step.run?.slice(0, 40) || step.uses || `Step ${sIdx + 1}`;

      if (jobFailed) {
        stepResults.push({
          id: step.id,
          name: stepName,
          status: "skipped",
          exitCode: -1,
          durationMs: 0,
          stdout: "",
          stderr: "Skipped due to previous step failure",
        });
        continue;
      }

      // Handle standard action uses
      if (step.uses) {
        if (/^actions\/checkout/i.test(step.uses)) {
          stepResults.push({
            id: step.id,
            name: stepName,
            status: "passed",
            exitCode: 0,
            durationMs: 1,
            stdout: `Checked out revision ${opts.ref}`,
            stderr: "",
          });
          combinedLogs.push(`[${stepName}] -> Success (Workspace ready)`);
          continue;
        }

        if (/^actions\/upload-artifact/i.test(step.uses)) {
          stepResults.push({
            id: step.id,
            name: stepName,
            status: "passed",
            exitCode: 0,
            durationMs: 1,
            stdout: `Artifacts staged for inspection`,
            stderr: "",
          });
          combinedLogs.push(`[${stepName}] -> Staged artifacts`);
          continue;
        }
      }

      // Execute command if 'run' is provided
      if (step.run) {
        const stepStart = Date.now();
        const stepWorkDir = step.workingDirectory ? path.resolve(scratchDir, step.workingDirectory) : scratchDir;

        if (!fs.existsSync(stepWorkDir)) {
          fs.mkdirSync(stepWorkDir, { recursive: true });
        }

        const stepMergedEnv = {
          ...jobEnv,
          ...(step.env || {}),
        };

        const timeout = opts.timeoutMs || 30_000;
        const proc = spawnSync("/bin/bash", ["-c", step.run], {
          cwd: stepWorkDir,
          env: stepMergedEnv,
          timeout,
          encoding: "utf-8",
          maxBuffer: 10 * 1024 * 1024,
        });

        const stepDuration = Date.now() - stepStart;
        const stdout = proc.stdout || "";
        const stderr = proc.stderr || (proc.error ? proc.error.message : "");
        const exitCode = proc.status ?? (proc.signal ? 137 : 1);

        const stepPassed = exitCode === 0;
        if (!stepPassed) {
          jobFailed = true;
          overallPassed = false;
        }

        stepResults.push({
          id: step.id,
          name: stepName,
          status: stepPassed ? "passed" : "failed",
          exitCode,
          durationMs: stepDuration,
          stdout,
          stderr,
        });

        combinedLogs.push(`\n[${stepName}] (exit code: ${exitCode})`);
        if (stdout) combinedLogs.push(stdout.trim());
        if (stderr) combinedLogs.push(`ERROR: ${stderr.trim()}`);
      } else {
        // Step with no run command
        stepResults.push({
          id: step.id,
          name: stepName,
          status: "passed",
          exitCode: 0,
          durationMs: 0,
          stdout: "",
          stderr: "",
        });
      }
    }

    const jobStatus = jobFailed ? "failed" : "passed";
    completedJobStatuses.set(job.id, jobStatus);
    jobResults.push({
      id: job.id,
      name: job.name,
      status: jobStatus,
      durationMs: Date.now() - jobStartTime,
      steps: stepResults,
    });
  }

  // Inspect artifacts in scratchDir
  const inspected = inspectWorkflowArtifacts(scratchDir);
  if (inspected.status === "failed") {
    overallPassed = false;
  }

  // Synthesize simulation result
  const baselineFallback = computeEcoSimulationVerification({
    repoPath: opts.repoPath,
    baseRef: "main",
    targetRef: opts.ref,
    gateStatus: overallPassed ? "passed" : "failed",
  });

  const simulationSummary = synthesizeEcoSimulationFromArtifacts({
    inspected,
    fallbackBaseResult: baselineFallback,
  });

  // Ensure overall gate reflects simulation summary checks
  if (simulationSummary.checks.some((c) => c.status === "failed")) {
    overallPassed = false;
    simulationSummary.gateStatus = "failed";
  }

  // Cleanup scratch directory
  try {
    fs.rmSync(scratchDir, { recursive: true, force: true });
  } catch {}

  const completedAt = new Date().toISOString();
  const durationMs = Date.now() - startTime;

  return {
    id: runId,
    provider: opts.manifest.provider,
    workflowFile: opts.manifest.filePath,
    workflowName: opts.manifest.name,
    ref: opts.ref,
    commitSha: opts.commitSha,
    status: overallPassed ? "passed" : "failed",
    conclusion: overallPassed ? "success" : "failure",
    startedAt,
    completedAt,
    durationMs,
    jobs: jobResults,
    artifacts: inspected.rawArtifacts || [],
    simulationSummary,
    hasArtifactSummary: inspected.hasDiscoveredReports,
    logs: combinedLogs.join("\n"),
  };
}
