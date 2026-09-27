// SPDX-License-Identifier: AGPL-3.0-or-later

import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
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

interface LocalJobRecord {
  spec: HpcJobSpec;
  child: ChildProcess;
  state: HpcJobState;
  startTime: number;
  endTime?: number | undefined;
  startCpuUsage: NodeJS.CpuUsage;
  totalCpuMicroseconds?: number | undefined;
  exitCode?: number | undefined;
  logPath: string;
}

/**
 * Local process execution driver.
 * Emulates Slurm's execution model and accounting on developer workstations
 * and single-node instances without requiring Slurm daemons or root access.
 */
export class LocalProcessDriver implements HpcDriver {
  readonly type = "local" as const;
  private readonly jobs = new Map<string, LocalJobRecord>();

  public async submit(spec: HpcJobSpec): Promise<HpcSubmissionResult> {
    fs.mkdirSync(spec.workingDir, { recursive: true });

    // 1. Generate and save reproducible .sbatch script in workingDir
    const sbatchContent = generateSbatchScript(spec);
    const sbatchPath = path.join(spec.workingDir, "run.sbatch");
    fs.writeFileSync(sbatchPath, sbatchContent, "utf8");

    // 2. Prepare log file (mimicking Slurm output naming)
    const logPath = this.getLogPath(spec.jobId, spec.workingDir);
    const logStream = fs.createWriteStream(logPath, { flags: "a" });

    // 3. Resolve command & MPI wrapping
    const totalTasks = (spec.resources.nodes ?? 1) * (spec.resources.tasksPerNode ?? 1);
    let execCmd = spec.command;
    let execArgs = [...spec.args];

    if (totalTasks > 1 && this.isExecutableInPath("mpirun")) {
      execArgs = ["-n", String(totalTasks), execCmd, ...execArgs];
      execCmd = "mpirun";
    }

    const startCpuUsage = process.cpuUsage();
    const startTime = Date.now();

    // 4. Spawn child process
    const child = spawn(execCmd, execArgs, {
      cwd: spec.workingDir,
      env: {
        ...process.env,
        ...spec.env,
        OMP_NUM_THREADS: String(spec.resources.cpusPerTask ?? 4),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    child.stdout?.pipe(logStream);
    child.stderr?.pipe(logStream);

    const record: LocalJobRecord = {
      spec,
      child,
      state: "RUNNING",
      startTime,
      startCpuUsage,
      logPath,
    };

    this.jobs.set(spec.jobId, record);

    // Timeout watchdog
    let timeoutTimer: NodeJS.Timeout | undefined;
    if (spec.resources.timeLimitMinutes && spec.resources.timeLimitMinutes > 0) {
      timeoutTimer = setTimeout(
        () => {
          if (record.state === "RUNNING") {
            record.state = "FAILED";
            record.exitCode = 124; // Standard timeout code
            logStream.write(`\n[HPC Local Driver]: Job exceeded time limit of ${spec.resources.timeLimitMinutes}m\n`);
            child.kill("SIGTERM");
          }
        },
        spec.resources.timeLimitMinutes * 60 * 1000,
      );
    }

    child.on("close", (code) => {
      if (timeoutTimer) clearTimeout(timeoutTimer);
      const diffCpu = process.cpuUsage(record.startCpuUsage);
      record.totalCpuMicroseconds = diffCpu.user + diffCpu.system;
      record.endTime = Date.now();
      record.exitCode = code ?? -1;

      if (record.state === "RUNNING") {
        record.state = code === 0 ? "COMPLETED" : "FAILED";
      }

      logStream.end();
    });

    child.on("error", (err) => {
      if (timeoutTimer) clearTimeout(timeoutTimer);
      record.endTime = Date.now();
      record.state = "FAILED";
      record.exitCode = -1;
      logStream.write(`\n[HPC Local Driver Spawn Error]: ${err.message}\n`);
      logStream.end();
    });

    return {
      nativeJobId: spec.jobId,
      driverType: "local",
      allocatedResources: spec.resources,
      estimatedCreditsPerHour: 10,
    };
  }

  public async pollStatus(nativeJobId: string): Promise<{ state: HpcJobState; exitCode?: number | undefined }> {
    const record = this.jobs.get(nativeJobId);
    if (!record) {
      return { state: "FAILED", exitCode: -1 };
    }
    return { state: record.state, exitCode: record.exitCode };
  }

  public async cancel(nativeJobId: string): Promise<boolean> {
    const record = this.jobs.get(nativeJobId);
    if (record && record.state === "RUNNING") {
      record.child.kill("SIGTERM");
      record.state = "CANCELLED";
      setTimeout(() => {
        if (!record.child.killed) {
          record.child.kill("SIGKILL");
        }
      }, 2000);
      return true;
    }
    return false;
  }

  public async getMetrics(nativeJobId: string, _workingDir: string, profile: ComputeProfile): Promise<HpcUsageMetrics> {
    const record = this.jobs.get(nativeJobId);
    const wallClockSeconds = record?.endTime ? Math.max(1, Math.round((record.endTime - record.startTime) / 1000)) : 1;

    // CPU core-seconds from captured process CPU or estimated by core allocation
    const cpus = record?.spec.resources.cpusPerTask ?? profile.cpus;
    const measuredCpuSec = record?.totalCpuMicroseconds
      ? Math.round(record.totalCpuMicroseconds / 1000) / 1000
      : wallClockSeconds * cpus;

    const memoryMb = Math.round(process.memoryUsage().rss / (1024 * 1024));
    const costCredits = calculateCostCredits(wallClockSeconds, profile);

    return {
      wallClockSeconds,
      cpuCoreSeconds: measuredCpuSec,
      peakMemoryMb: memoryMb,
      gpuSeconds: profile.gpus ? wallClockSeconds * profile.gpus : 0,
      costCredits,
      nativeJobId,
      exitCode: record?.exitCode,
    };
  }

  public getLogPath(nativeJobId: string, workingDir: string): string {
    return path.join(workingDir, `slurm-${nativeJobId}.out`);
  }

  private isExecutableInPath(name: string): boolean {
    const paths = (process.env["PATH"] || "").split(path.delimiter);
    for (const p of paths) {
      try {
        const full = path.join(p, name);
        if (fs.existsSync(full) && fs.statSync(full).isFile()) {
          return true;
        }
      } catch {
        // ignore
      }
    }
    return false;
  }
}
