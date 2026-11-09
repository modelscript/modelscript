// SPDX-License-Identifier: AGPL-3.0-or-later

import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { calculateCostCredits, getComputeProfile } from "../compute-profiles.js";
import type {
  ComputeProfile,
  HpcDriver,
  HpcJobSpec,
  HpcJobState,
  HpcSubmissionResult,
  HpcUsageMetrics,
} from "../hpc-types.js";
import { escapeBashDoubleQuoted, isValidEnvKey, quoteShellArg, sanitizeSlurmToken } from "../sbatch-generator.js";

const execFileAsync = promisify(execFile);

export type CommandExecutor = (
  cmd: string,
  args: string[],
  cwd?: string,
) => Promise<{ stdout: string; stderr: string }>;

export interface PbsDriverOptions {
  executor?: CommandExecutor | undefined;
  defaultQueue?: string | undefined;
}

/**
 * Generates a reproducible PBS / Torque `#PBS` submission script.
 */
export function generatePbsScript(spec: HpcJobSpec): string {
  const r = spec.resources;
  const lines: string[] = ["#!/bin/bash"];

  const safeJobName = sanitizeSlurmToken(spec.name || spec.jobId, "modelscript-pbs-job");
  lines.push(`#PBS -N ${safeJobName}`);
  lines.push(`#PBS -o pbs-%j.out`);
  lines.push(`#PBS -e pbs-%j.err`);
  lines.push(`#PBS -j oe`);

  const nodes = Math.max(1, Math.floor(r.nodes ?? 1));
  const tasksPerNode = Math.max(1, Math.floor(r.tasksPerNode ?? 1));
  const cpusPerTask = Math.max(1, Math.floor(r.cpusPerTask ?? 4));

  // PBS select directive: select=<nodes>:ncpus=<cpusPerTask>:mpiprocs=<tasksPerNode>
  let selectClause = `select=${nodes}:ncpus=${cpusPerTask}:mpiprocs=${tasksPerNode}`;
  if (r.memoryMb && r.memoryMb > 0) {
    selectClause += `:mem=${Math.floor(r.memoryMb)}mb`;
  }
  if (r.gpus && r.gpus > 0) {
    selectClause += `:ngpus=${Math.floor(r.gpus)}`;
  }
  lines.push(`#PBS -l ${selectClause}`);

  if (r.timeLimitMinutes && r.timeLimitMinutes > 0) {
    const hours = Math.floor(r.timeLimitMinutes / 60);
    const mins = Math.floor(r.timeLimitMinutes % 60);
    lines.push(`#PBS -l walltime=${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}:00`);
  }

  const queue = r.partition || "batch";
  lines.push(`#PBS -q ${sanitizeSlurmToken(queue, "batch")}`);

  if (r.account) {
    lines.push(`#PBS -A ${sanitizeSlurmToken(r.account, "default")}`);
  }

  lines.push("");
  lines.push("# --- Working Directory Setup ---");
  lines.push(`if [ -n "\${PBS_O_WORKDIR:-}" ]; then cd "$PBS_O_WORKDIR"; fi`);
  lines.push(`export OMP_NUM_THREADS=${cpusPerTask}`);

  if (spec.env) {
    lines.push("");
    lines.push("# --- Environment Setup ---");
    for (const [key, value] of Object.entries(spec.env)) {
      if (!isValidEnvKey(key) || value === undefined) continue;
      lines.push(`export ${key}="${escapeBashDoubleQuoted(String(value))}"`);
    }
  }

  if (spec.modules && spec.modules.length > 0) {
    lines.push("");
    lines.push("# --- Environment Modules ---");
    for (const mod of spec.modules) {
      const safeMod = sanitizeSlurmToken(mod, "");
      if (safeMod) {
        lines.push(`module load ${safeMod}`);
      }
    }
  }

  if (spec.stagingManifest?.prologueScript) {
    lines.push("");
    lines.push(spec.stagingManifest.prologueScript);
  }

  lines.push("");
  lines.push("# --- Execution Command ---");

  const safeCommand = quoteShellArg(spec.command);
  const fullArgs = spec.args.map((a) => quoteShellArg(String(a))).join(" ");
  let baseCmd = fullArgs ? `${safeCommand} ${fullArgs}` : safeCommand;

  const totalTasks = nodes * tasksPerNode;
  if (totalTasks > 1) {
    lines.push(`mpirun -np ${totalTasks} ${baseCmd}`);
  } else {
    lines.push(baseCmd);
  }

  if (spec.stagingManifest?.epilogueScript) {
    lines.push("CMD_EXIT=$?");
    lines.push("");
    lines.push(spec.stagingManifest.epilogueScript);
    lines.push("exit $CMD_EXIT");
  }

  return lines.join("\n") + "\n";
}

/**
 * Parses raw PBS qstat text output.
 * Maps job states: Q/H/W -> PENDING, R/E -> RUNNING, C -> COMPLETED/FAILED.
 */
export function parsePbsQstatOutput(output: string): {
  state: HpcJobState;
  exitCode?: number | undefined;
  cpuSeconds?: number | undefined;
  memoryMb?: number | undefined;
} {
  const trimmed = output.trim();
  if (!trimmed) {
    return { state: "FAILED", exitCode: -1 };
  }

  // Check JSON format if available
  try {
    const json = JSON.parse(trimmed);
    const jobs = json.Jobs || json.jobs || {};
    const firstKey = Object.keys(jobs)[0];
    if (firstKey) {
      const job = jobs[firstKey];
      const rawState = String(job.job_state || "").toUpperCase();
      let state: HpcJobState = "FAILED";
      if (rawState === "Q" || rawState === "H" || rawState === "W") {
        state = "PENDING";
      } else if (rawState === "R" || rawState === "E") {
        state = "RUNNING";
      } else if (rawState === "C") {
        state = job.Exit_status === 0 ? "COMPLETED" : "FAILED";
      }
      const exitCode = typeof job.Exit_status === "number" ? job.Exit_status : undefined;
      return { state, exitCode };
    }
  } catch {
    // Non-JSON format
  }

  // Standard multi-line or tabular qstat
  const stateMatch = trimmed.match(/job_state\s*=\s*([A-Za-z])/i);
  if (stateMatch && stateMatch[1]) {
    const rawState = stateMatch[1].toUpperCase();
    if (rawState === "Q" || rawState === "H" || rawState === "W") {
      return { state: "PENDING" };
    }
    if (rawState === "R" || rawState === "E") {
      return { state: "RUNNING" };
    }
    if (rawState === "C") {
      const exitMatch = trimmed.match(/Exit_status\s*=\s*(\d+)/i);
      const exitCode = exitMatch?.[1] ? parseInt(exitMatch[1], 10) : 0;
      return { state: exitCode === 0 ? "COMPLETED" : "FAILED", exitCode };
    }
  }

  // Fallback check for tabular summary line (e.g. "12345.server user batch name 00:01:00 R")
  if (/\b(R|E)\b/.test(trimmed)) return { state: "RUNNING" };
  if (/\b(Q|H|W)\b/.test(trimmed)) return { state: "PENDING" };
  if (/\bC\b/.test(trimmed)) return { state: "COMPLETED", exitCode: 0 };

  return { state: "COMPLETED", exitCode: 0 };
}

/**
 * PBS / Torque HPC Cluster Driver.
 * Interacts with PBS workload managers via CLI commands (`qsub`, `qstat`, `qdel`).
 */
export class PbsDriver implements HpcDriver {
  readonly type = "pbs" as const;
  private readonly executor: CommandExecutor;

  constructor(options: PbsDriverOptions = {}) {
    this.executor =
      options.executor ||
      (async (cmd: string, args: string[], cwd?: string) => {
        const res = await execFileAsync(cmd, args, { cwd });
        return { stdout: res.stdout.toString(), stderr: res.stderr.toString() };
      });
  }

  public async submit(spec: HpcJobSpec): Promise<HpcSubmissionResult> {
    fs.mkdirSync(spec.workingDir, { recursive: true });

    const pbsContent = generatePbsScript(spec);
    const pbsPath = path.join(spec.workingDir, "run.pbs");
    fs.writeFileSync(pbsPath, pbsContent, "utf8");

    const { stdout, stderr } = await this.executor("qsub", ["run.pbs"], spec.workingDir);
    const fullOut = stdout + "\n" + stderr;

    // Output pattern: "123456.pbs-server" or "123456"
    const match = fullOut.trim().match(/^([0-9]+(?:[.\-_][a-zA-Z0-9\-_]+)*)/m);
    if (!match || !match[1]) {
      throw new Error(`Failed to submit PBS job: ${fullOut.trim()}`);
    }

    const nativeJobId = match[1];
    const profile = getComputeProfile(spec.profileId);

    return {
      nativeJobId,
      driverType: "pbs",
      allocatedResources: spec.resources,
      estimatedCreditsPerHour: profile.costCreditsPerHour,
    };
  }

  private assertSafeNativeJobId(nativeJobId: string): string {
    const trimmed = String(nativeJobId).trim();
    if (!/^[a-zA-Z0-9_.-]{1,64}$/.test(trimmed) || trimmed.startsWith("-")) {
      throw new Error(`Invalid PBS nativeJobId: ${nativeJobId}`);
    }
    return trimmed;
  }

  public async pollStatus(nativeJobId: string): Promise<{ state: HpcJobState; exitCode?: number | undefined }> {
    try {
      const safeId = this.assertSafeNativeJobId(nativeJobId);
      const { stdout } = await this.executor("qstat", ["-f", safeId]);
      return parsePbsQstatOutput(stdout);
    } catch {
      // If qstat fails or job has left accounting queue, treat as completed
      return { state: "COMPLETED", exitCode: 0 };
    }
  }

  public async cancel(nativeJobId: string): Promise<boolean> {
    try {
      const safeId = this.assertSafeNativeJobId(nativeJobId);
      await this.executor("qdel", [safeId]);
      return true;
    } catch {
      return false;
    }
  }

  public async getMetrics(nativeJobId: string, _workingDir: string, profile: ComputeProfile): Promise<HpcUsageMetrics> {
    try {
      const safeId = this.assertSafeNativeJobId(nativeJobId);
      const { stdout } = await this.executor("qstat", ["-f", safeId]);
      const parsed = parsePbsQstatOutput(stdout);

      // Extract cput if present (e.g. resources_used.cput = 00:05:30)
      let cpuCoreSeconds = 0;
      const cputMatch = stdout.match(/resources_used\.cput\s*=\s*(\d+):(\d+):(\d+)/i);
      if (cputMatch && cputMatch[1] && cputMatch[2] && cputMatch[3]) {
        cpuCoreSeconds =
          parseInt(cputMatch[1], 10) * 3600 + parseInt(cputMatch[2], 10) * 60 + parseInt(cputMatch[3], 10);
      }

      // Extract walltime
      let elapsedSeconds = 0;
      const wallMatch = stdout.match(/resources_used\.walltime\s*=\s*(\d+):(\d+):(\d+)/i);
      if (wallMatch && wallMatch[1] && wallMatch[2] && wallMatch[3]) {
        elapsedSeconds =
          parseInt(wallMatch[1], 10) * 3600 + parseInt(wallMatch[2], 10) * 60 + parseInt(wallMatch[3], 10);
      } else {
        elapsedSeconds = cpuCoreSeconds > 0 ? Math.ceil(cpuCoreSeconds / profile.cpus) : 60;
      }

      // Extract peak memory
      let peakMemoryMb = profile.memoryMb;
      const memMatch = stdout.match(/resources_used\.mem\s*=\s*(\d+)\s*([A-Za-z]+)/i);
      if (memMatch && memMatch[1]) {
        const val = parseInt(memMatch[1], 10);
        const unit = (memMatch[2] || "kb").toLowerCase();
        if (unit.startsWith("m")) peakMemoryMb = val;
        else if (unit.startsWith("g")) peakMemoryMb = val * 1024;
        else if (unit.startsWith("k")) peakMemoryMb = Math.round(val / 1024);
      }

      const costCredits = calculateCostCredits(elapsedSeconds, profile);

      return {
        wallClockSeconds: elapsedSeconds,
        cpuCoreSeconds: cpuCoreSeconds || elapsedSeconds * profile.cpus,
        peakMemoryMb,
        gpuSeconds: profile.gpus ? elapsedSeconds * profile.gpus : 0,
        costCredits,
        nativeJobId: safeId,
        exitCode: parsed.exitCode ?? 0,
      };
    } catch {
      return {
        wallClockSeconds: 0,
        cpuCoreSeconds: 0,
        peakMemoryMb: profile.memoryMb,
        costCredits: 0,
        nativeJobId,
        exitCode: 0,
      };
    }
  }

  public getLogPath(nativeJobId: string, workingDir: string): string {
    const safeId = this.assertSafeNativeJobId(nativeJobId);
    return path.join(workingDir, `pbs-${safeId}.out`);
  }
}
