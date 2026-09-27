// SPDX-License-Identifier: AGPL-3.0-or-later

import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { calculateCostCredits } from "../compute-profiles.js";
import type {
  ComputeProfile,
  HpcDriver,
  HpcJobSpec,
  HpcJobState,
  HpcSubmissionResult,
  HpcUsageMetrics,
} from "../hpc-types.js";
import { generateSbatchScript } from "../sbatch-generator.js";

const execFileAsync = promisify(execFile);

export type CommandExecutor = (
  cmd: string,
  args: string[],
  cwd?: string,
) => Promise<{ stdout: string; stderr: string }>;

export interface SlurmDriverOptions {
  executor?: CommandExecutor | undefined;
  workingDirPrefix?: string | undefined;
}

/**
 * Parses raw sacct pipe-delimited output line.
 * Format: JobID|CPUTimeRAW|TotalCPU|MaxRSS|AllocCPUs|ElapsedRaw|State|ExitCode
 */
export function parseSacctOutput(output: string): {
  elapsedSeconds: number;
  cpuCoreSeconds: number;
  peakMemoryMb: number;
  state: HpcJobState;
  exitCode: number;
} {
  const lines = output
    .trim()
    .split("\n")
    .filter((l) => l.trim().length > 0);
  if (lines.length === 0) {
    return { elapsedSeconds: 0, cpuCoreSeconds: 0, peakMemoryMb: 0, state: "FAILED", exitCode: -1 };
  }

  // Use the main job step line (usually line 0 or step with MaxRSS)
  let maxMemoryBytes = 0;
  let cpuCoreSec = 0;
  let elapsedSec = 0;
  let finalState: HpcJobState = "COMPLETED";
  let finalExitCode = 0;

  for (const line of lines) {
    const parts = line.split("|");
    if (parts.length < 8) continue;

    const [, cpuTimeRaw, , maxRss, , elapsedRaw, stateStr, exitCodeStr] = parts;

    const parsedElapsed = parseInt(elapsedRaw || "0", 10);
    if (!isNaN(parsedElapsed) && parsedElapsed > elapsedSec) {
      elapsedSec = parsedElapsed;
    }

    const parsedCpu = parseInt(cpuTimeRaw || "0", 10);
    if (!isNaN(parsedCpu) && parsedCpu > cpuCoreSec) {
      cpuCoreSec = parsedCpu;
    }

    // Parse MaxRSS (e.g., "18452K", "124M", "2G")
    if (maxRss && maxRss.length > 0) {
      const bytes = parseMemoryStringToBytes(maxRss);
      if (bytes > maxMemoryBytes) maxMemoryBytes = bytes;
    }

    // Parse state
    const upperState = (stateStr || "").toUpperCase();
    if (upperState.startsWith("COMPLETED")) {
      finalState = "COMPLETED";
    } else if (upperState.startsWith("CANCELLED")) {
      finalState = "CANCELLED";
    } else if (upperState.startsWith("RUNNING")) {
      finalState = "RUNNING";
    } else if (upperState.startsWith("PENDING")) {
      finalState = "PENDING";
    } else {
      finalState = "FAILED";
    }

    // Parse exit code (e.g., "0:0")
    if (exitCodeStr) {
      const codePart = exitCodeStr.split(":")[0];
      const parsedCode = parseInt(codePart || "0", 10);
      if (!isNaN(parsedCode)) finalExitCode = parsedCode;
    }
  }

  return {
    elapsedSeconds: elapsedSec,
    cpuCoreSeconds: cpuCoreSec,
    peakMemoryMb: Math.round(maxMemoryBytes / (1024 * 1024)),
    state: finalState,
    exitCode: finalExitCode,
  };
}

/**
 * Converts memory string (e.g. "1024K", "512M", "4G") to bytes.
 */
export function parseMemoryStringToBytes(memStr: string): number {
  const match = memStr.trim().match(/^([0-9.]+)\s*([KMGTPkmgtp]?)(?:[iI]?[bB])?$/);
  if (!match) return 0;

  const value = parseFloat(match[1] || "0");
  const unit = (match[2] || "").toUpperCase();

  switch (unit) {
    case "K":
      return value * 1024;
    case "M":
      return value * 1024 * 1024;
    case "G":
      return value * 1024 * 1024 * 1024;
    case "T":
      return value * 1024 * 1024 * 1024 * 1024;
    default:
      return value;
  }
}

/**
 * Slurm HPC Cluster Driver.
 * Interacts with Slurm batch schedulers via CLI commands (sbatch, squeue, sacct, scancel).
 */
export class SlurmDriver implements HpcDriver {
  readonly type = "slurm" as const;
  private readonly executor: CommandExecutor;

  constructor(options: SlurmDriverOptions = {}) {
    this.executor =
      options.executor ||
      (async (cmd: string, args: string[], cwd?: string) => {
        const res = await execFileAsync(cmd, args, { cwd });
        return { stdout: res.stdout.toString(), stderr: res.stderr.toString() };
      });
  }

  public async submit(spec: HpcJobSpec): Promise<HpcSubmissionResult> {
    fs.mkdirSync(spec.workingDir, { recursive: true });

    // 1. Write the .sbatch script into the job directory
    const sbatchContent = generateSbatchScript(spec);
    const sbatchPath = path.join(spec.workingDir, "run.sbatch");
    fs.writeFileSync(sbatchPath, sbatchContent, "utf8");

    // 2. Submit via sbatch
    const { stdout, stderr } = await this.executor("sbatch", ["run.sbatch"], spec.workingDir);
    const fullOut = stdout + "\n" + stderr;

    // Output pattern: "Submitted batch job 123456"
    const match = fullOut.match(/Submitted batch job\s+(\d+)/i);
    if (!match || !match[1]) {
      throw new Error(`Failed to submit Slurm job: ${fullOut.trim()}`);
    }

    const nativeJobId = match[1];

    return {
      nativeJobId,
      driverType: "slurm",
      allocatedResources: spec.resources,
      estimatedCreditsPerHour: 10,
    };
  }

  public async pollStatus(nativeJobId: string): Promise<{ state: HpcJobState; exitCode?: number | undefined }> {
    try {
      // 1. Check active queue first (squeue)
      const { stdout: squeueOut } = await this.executor("squeue", ["-h", "-j", nativeJobId, "-o", "%T"]);
      const stateStr = squeueOut.trim().toUpperCase();

      if (stateStr) {
        if (stateStr.includes("RUNNING") || stateStr.includes("COMPLETING")) {
          return { state: "RUNNING" };
        }
        if (stateStr.includes("PENDING") || stateStr.includes("CONFIGURING")) {
          return { state: "PENDING" };
        }
      }

      // 2. If not in active queue, check accounting (sacct)
      const { stdout: sacctOut } = await this.executor("sacct", [
        "-n",
        "-P",
        "-j",
        nativeJobId,
        "--format=JobID,CPUTimeRAW,TotalCPU,MaxRSS,AllocCPUs,ElapsedRaw,State,ExitCode",
      ]);

      const parsed = parseSacctOutput(sacctOut);
      return { state: parsed.state, exitCode: parsed.exitCode };
    } catch {
      return { state: "FAILED", exitCode: -1 };
    }
  }

  public async cancel(nativeJobId: string): Promise<boolean> {
    try {
      await this.executor("scancel", [nativeJobId]);
      return true;
    } catch {
      return false;
    }
  }

  public async getMetrics(nativeJobId: string, _workingDir: string, profile: ComputeProfile): Promise<HpcUsageMetrics> {
    try {
      const { stdout: sacctOut } = await this.executor("sacct", [
        "-n",
        "-P",
        "-j",
        nativeJobId,
        "--format=JobID,CPUTimeRAW,TotalCPU,MaxRSS,AllocCPUs,ElapsedRaw,State,ExitCode",
      ]);

      const parsed = parseSacctOutput(sacctOut);
      const costCredits = calculateCostCredits(parsed.elapsedSeconds, profile);

      return {
        wallClockSeconds: parsed.elapsedSeconds,
        cpuCoreSeconds: parsed.cpuCoreSeconds,
        peakMemoryMb: parsed.peakMemoryMb,
        gpuSeconds: profile.gpus ? parsed.elapsedSeconds * profile.gpus : 0,
        costCredits,
        nativeJobId,
        exitCode: parsed.exitCode,
      };
    } catch {
      return {
        wallClockSeconds: 0,
        cpuCoreSeconds: 0,
        peakMemoryMb: 0,
        costCredits: 0,
        nativeJobId,
        exitCode: -1,
      };
    }
  }

  public getLogPath(nativeJobId: string, workingDir: string): string {
    return path.join(workingDir, `slurm-${nativeJobId}.out`);
  }
}
