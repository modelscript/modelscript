// SPDX-License-Identifier: AGPL-3.0-or-later

import { execFile, execFileSync, spawn, spawnSync } from "node:child_process";
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

export interface WorkflowRunOptions {
  repoPath: string;
  ref: string;
  commitSha?: string | undefined;
  manifest: WorkflowManifest;
  ecoId?: string | undefined;
  spaceId?: string | undefined;
  extraEnv?: Record<string, string> | undefined;
  timeoutMs?: number | undefined;
}

const SAFE_HOST_ENV_KEYS = ["PATH", "HOME", "USER", "LANG", "LC_ALL", "TZ", "TMPDIR", "TERM", "NODE_ENV"] as const;

function buildJobEnv(opts: WorkflowRunOptions, job: WorkflowJob): Record<string, string> {
  // Merge minimal safe environment (never forward host API secrets into workflow scripts)
  const safeHostEnv: Record<string, string> = {};
  for (const key of SAFE_HOST_ENV_KEYS) {
    if (process.env[key] !== undefined) {
      safeHostEnv[key] = process.env[key]!;
    }
  }
  return {
    ...safeHostEnv,
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
}

function resolveContainedWorkDir(scratchDir: string, workingDirectory?: string): string | null {
  const resolvedScratch = path.resolve(scratchDir);
  const stepWorkDir = workingDirectory ? path.resolve(resolvedScratch, workingDirectory) : resolvedScratch;
  if (stepWorkDir !== resolvedScratch && !stepWorkDir.startsWith(resolvedScratch + path.sep)) {
    return null;
  }
  return stepWorkDir;
}

async function extractGitArchiveAsync(
  repoPath: string,
  ref: string,
  scratchDir: string,
  gitEnv: NodeJS.ProcessEnv,
): Promise<void> {
  const tarBuf = await new Promise<Buffer>((resolve, reject) => {
    execFile(
      "git",
      ["-C", repoPath, "archive", "--format=tar", ref],
      {
        env: gitEnv,
        maxBuffer: 50 * 1024 * 1024,
        encoding: "buffer",
      },
      (err, stdout) => {
        if (err) return reject(err);
        resolve(Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout));
      },
    );
  });

  await new Promise<void>((resolve, reject) => {
    const tarProc = spawn("tar", ["-x", "-C", scratchDir], {
      stdio: ["pipe", "ignore", "ignore"],
    });
    tarProc.on("error", reject);
    tarProc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`tar exited with code ${code}`));
    });
    tarProc.stdin?.on("error", () => {});
    tarProc.stdin?.end(tarBuf);
  });
}

async function runStepCommandAsync(
  command: string,
  cwd: string,
  env: Record<string, string>,
  timeoutMs: number,
  maxBuffer = 10 * 1024 * 1024,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    const child = spawn("/bin/bash", ["-c", command], {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;
    let killedReason: string | null = null;

    const finish = (exitCode: number, errMsg?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const stdout = Buffer.concat(stdoutChunks).toString("utf-8");
      const rawStderr = Buffer.concat(stderrChunks).toString("utf-8");
      const stderr = rawStderr || errMsg || killedReason || "";
      resolve({ stdout, stderr, exitCode });
    };

    const timer = setTimeout(() => {
      killedReason = `Process timed out after ${timeoutMs}ms`;
      try {
        child.kill("SIGKILL");
      } catch {}
    }, timeoutMs);
    timer.unref?.();

    child.stdout?.on("data", (chunk: Buffer) => {
      if (stdoutBytes + chunk.length > maxBuffer) {
        const remaining = Math.max(0, maxBuffer - stdoutBytes);
        if (remaining > 0) stdoutChunks.push(chunk.subarray(0, remaining));
        stdoutBytes = maxBuffer;
        killedReason = "stdout maxBuffer length exceeded";
        try {
          child.kill("SIGKILL");
        } catch {}
        return;
      }
      stdoutChunks.push(chunk);
      stdoutBytes += chunk.length;
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      if (stderrBytes + chunk.length > maxBuffer) {
        const remaining = Math.max(0, maxBuffer - stderrBytes);
        if (remaining > 0) stderrChunks.push(chunk.subarray(0, remaining));
        stderrBytes = maxBuffer;
        killedReason = "stderr maxBuffer length exceeded";
        try {
          child.kill("SIGKILL");
        } catch {}
        return;
      }
      stderrChunks.push(chunk);
      stderrBytes += chunk.length;
    });

    child.on("error", (err) => {
      finish(1, err.message);
    });

    child.on("close", (code, signal) => {
      const exitCode = code ?? (signal ? 137 : 1);
      finish(exitCode);
    });
  });
}

/**
 * Executes a WorkflowManifest (parsed from .github/workflows/*.yml or .gitlab-ci.yml)
 * natively within an isolated scratch environment extracted from the target git ref.
 */
export function executeWorkflowManifest(opts: WorkflowRunOptions): WorkflowRunResult {
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
    const jobEnv = buildJobEnv(opts, job);

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
        const stepWorkDir = resolveContainedWorkDir(scratchDir, step.workingDirectory);
        if (!stepWorkDir) {
          jobFailed = true;
          overallPassed = false;
          stepResults.push({
            id: step.id,
            name: stepName,
            status: "failed",
            exitCode: 1,
            durationMs: 0,
            stdout: "",
            stderr: `Invalid workingDirectory '${step.workingDirectory}': escapes workflow workspace`,
          });
          combinedLogs.push(`\n[${stepName}] (exit code: 1)\nERROR: workingDirectory escapes workflow workspace`);
          continue;
        }

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

/**
 * Asynchronously executes a WorkflowManifest within an isolated scratch environment
 * extracted from the target git ref, using non-blocking child_process and fs.promises
 * so HTTP handlers do not block the Node.js event loop.
 */
export async function executeWorkflowManifestAsync(opts: WorkflowRunOptions): Promise<WorkflowRunResult> {
  const runId = `wfr_${crypto.randomBytes(8).toString("hex")}`;
  const startedAt = new Date().toISOString();
  const startTime = Date.now();

  const scratchDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "ansatz-ci-"));
  const gitEnv = gitSubprocessEnv();

  try {
    // Extract source files at ref into scratch directory using git archive
    try {
      await extractGitArchiveAsync(opts.repoPath, opts.ref, scratchDir, gitEnv);
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
      const jobEnv = buildJobEnv(opts, job);

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
          const stepWorkDir = resolveContainedWorkDir(scratchDir, step.workingDirectory);
          if (!stepWorkDir) {
            jobFailed = true;
            overallPassed = false;
            stepResults.push({
              id: step.id,
              name: stepName,
              status: "failed",
              exitCode: 1,
              durationMs: 0,
              stdout: "",
              stderr: `Invalid workingDirectory '${step.workingDirectory}': escapes workflow workspace`,
            });
            combinedLogs.push(`\n[${stepName}] (exit code: 1)\nERROR: workingDirectory escapes workflow workspace`);
            continue;
          }

          await fs.promises.mkdir(stepWorkDir, { recursive: true });

          const stepMergedEnv = {
            ...jobEnv,
            ...(step.env || {}),
          };

          const timeout = opts.timeoutMs || 30_000;
          const { stdout, stderr, exitCode } = await runStepCommandAsync(step.run, stepWorkDir, stepMergedEnv, timeout);

          const stepDuration = Date.now() - stepStart;
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
  } finally {
    await fs.promises.rm(scratchDir, { recursive: true, force: true }).catch(() => {});
  }
}
