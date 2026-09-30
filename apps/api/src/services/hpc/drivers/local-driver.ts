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
  HpcSandboxConfig,
  HpcSubmissionResult,
  HpcUsageMetrics,
} from "../hpc-types.js";
import { generateSbatchScript } from "../sbatch-generator.js";

export interface LocalDriverOptions {
  defaultSandbox?: HpcSandboxConfig | undefined;
  defaultMaxWallClockMinutes?: number | undefined;
  walletBalanceChecker?: ((userId: number) => number) | undefined;
  anomalyDetectionEnabled?: boolean | undefined;
  cryptoAnomalyThresholdSeconds?: number | undefined;
}

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
  suspiciousActivity?: "potential_cryptomining" | "timeout" | "credit_exhausted" | undefined;
  networkIsolationEnforced?: boolean | undefined;
  sandboxRuntime?: string | undefined;
}

/**
 * Local process execution driver.
 * Emulates Slurm's execution model and accounting on developer workstations
 * and single-node instances with optional containerized (Docker/Podman) or
 * kernel namespace (unshare) zero-egress sandboxing.
 */
export class LocalProcessDriver implements HpcDriver {
  readonly type = "local" as const;
  private readonly jobs = new Map<string, LocalJobRecord>();
  private readonly options: LocalDriverOptions;

  constructor(options: LocalDriverOptions = {}) {
    this.options = options;
  }

  /**
   * Resolves the execution command and arguments, applying container or namespace sandboxing.
   */
  public resolveSandboxCommand(spec: HpcJobSpec): {
    execCmd: string;
    execArgs: string[];
    runtime: string;
    networkIsolation: boolean;
  } {
    const totalTasks = (spec.resources.nodes ?? 1) * (spec.resources.tasksPerNode ?? 1);
    let execCmd = spec.command;
    let execArgs = [...spec.args];

    if (totalTasks > 1 && this.isExecutableInPath("mpirun")) {
      execArgs = ["-n", String(totalTasks), execCmd, ...execArgs];
      execCmd = "mpirun";
    }

    const sandboxConfig = spec.sandbox || this.options.defaultSandbox;
    let networkIsolation = false;
    let runtime = "none";

    const requestedRuntime =
      sandboxConfig?.runtime ||
      (process.env["HPC_SANDBOX_RUNTIME"] as "auto" | "docker" | "podman" | "unshare" | "none") ||
      "auto";

    const isSandboxRequested =
      sandboxConfig?.enabled === true ||
      spec.resources.networkIsolation === true ||
      process.env["HPC_SANDBOX_ENABLED"] === "true";

    let effectiveRuntime = requestedRuntime;
    if (requestedRuntime === "auto") {
      if (isSandboxRequested) {
        if (this.isExecutableInPath("podman")) {
          effectiveRuntime = "podman";
        } else if (this.isExecutableInPath("docker")) {
          effectiveRuntime = "docker";
        } else if (process.platform === "linux" && this.isExecutableInPath("unshare")) {
          effectiveRuntime = "unshare";
        } else {
          effectiveRuntime = "none";
        }
      } else {
        effectiveRuntime = "none";
      }
    }

    if (effectiveRuntime === "docker" || effectiveRuntime === "podman") {
      runtime = effectiveRuntime;
      networkIsolation = sandboxConfig?.networkIsolation !== false;
      const readOnly = sandboxConfig?.readOnlyRoot !== false;
      const tmpfsMb = sandboxConfig?.tmpfsSizeMb ?? 2048;
      const image = sandboxConfig?.image || process.env["HPC_SANDBOX_IMAGE"] || "ghcr.io/modelscript/runner:latest";
      const absWorkingDir = path.resolve(spec.workingDir);

      const containerArgs: string[] = ["run", "--rm"];
      if (networkIsolation) {
        containerArgs.push("--network", "none");
      }
      if (readOnly) {
        containerArgs.push("--read-only");
      }
      containerArgs.push("--tmpfs", `/tmp:rw,size=${tmpfsMb}m`);
      containerArgs.push("-v", `${absWorkingDir}:${absWorkingDir}:rw`);
      containerArgs.push("-w", absWorkingDir);

      const cpus = spec.resources.cpusPerTask ?? 4;
      containerArgs.push("--cpus", String(cpus));

      const memMb = spec.resources.memoryMb ?? 1024;
      containerArgs.push("--memory", `${memMb}m`);

      if (sandboxConfig?.dropCapabilities !== false) {
        containerArgs.push("--cap-drop=ALL", "--security-opt=no-new-privileges");
      }

      containerArgs.push(image, execCmd, ...execArgs);
      execCmd = effectiveRuntime;
      execArgs = containerArgs;
    } else if (effectiveRuntime === "unshare" && process.platform === "linux") {
      runtime = "unshare";
      networkIsolation = true;
      execArgs = ["-n", "-r", execCmd, ...execArgs];
      execCmd = "unshare";
    }

    return { execCmd, execArgs, runtime, networkIsolation };
  }

  public async submit(spec: HpcJobSpec): Promise<HpcSubmissionResult> {
    fs.mkdirSync(spec.workingDir, { recursive: true });

    // 1. Generate and save reproducible .sbatch script in workingDir
    const sbatchContent = generateSbatchScript(spec);
    const sbatchPath = path.join(spec.workingDir, "run.sbatch");
    fs.writeFileSync(sbatchPath, sbatchContent, "utf8");

    // 2. Prepare log file (mimicking Slurm output naming)
    const logPath = this.getLogPath(spec.jobId, spec.workingDir);
    const logStream = fs.createWriteStream(logPath, { flags: "a" });

    // 3. Resolve command, MPI, and Sandboxing
    const { execCmd, execArgs, runtime, networkIsolation } = this.resolveSandboxCommand(spec);

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
      networkIsolationEnforced: networkIsolation,
      sandboxRuntime: runtime,
    };

    this.jobs.set(spec.jobId, record);

    // 5. Wall-Clock Timeout Watchdog
    let timeoutTimer: NodeJS.Timeout | undefined;
    const maxTimeMinutes =
      spec.resources.timeLimitMinutes ??
      (spec.resources.maxWallClockSeconds ? spec.resources.maxWallClockSeconds / 60 : undefined) ??
      this.options.defaultMaxWallClockMinutes ??
      30;

    if (maxTimeMinutes > 0) {
      timeoutTimer = setTimeout(
        () => {
          if (record.state === "RUNNING") {
            record.state = "FAILED";
            record.exitCode = 124; // Standard timeout code
            record.suspiciousActivity = "timeout";
            logStream.write(`\n[HPC Local Driver]: Job exceeded time limit of ${maxTimeMinutes}m\n`);
            child.kill("SIGTERM");
            setTimeout(() => {
              if (!child.killed) child.kill("SIGKILL");
            }, 2000);
          }
        },
        maxTimeMinutes * 60 * 1000,
      );
    }

    // 6. Credit drain & Anomaly Watchdog
    let watchdogTimer: NodeJS.Timeout | undefined;
    const anomalyThresholdSec = this.options.cryptoAnomalyThresholdSeconds ?? 600;

    watchdogTimer = setInterval(() => {
      if (record.state !== "RUNNING") {
        if (watchdogTimer) clearInterval(watchdogTimer);
        return;
      }

      const elapsedSeconds = (Date.now() - record.startTime) / 1000;

      // Check credit exhaustion
      if (spec.userId !== undefined && this.options.walletBalanceChecker) {
        try {
          const balance = this.options.walletBalanceChecker(spec.userId);
          const currentCost = (elapsedSeconds / 3600) * 10;
          if (balance - currentCost < 0) {
            record.state = "FAILED";
            record.exitCode = 402;
            record.suspiciousActivity = "credit_exhausted";
            logStream.write(
              `\n[HPC Security Watchdog]: Job terminated due to compute credit exhaustion (balance: ${balance.toFixed(2)} cr).\n`,
            );
            child.kill("SIGTERM");
            if (watchdogTimer) clearInterval(watchdogTimer);
            return;
          }
        } catch {
          // ignore checker errors
        }
      }

      // Anomaly heuristics (e.g. sustained high compute with no log output or result files)
      if (this.options.anomalyDetectionEnabled !== false && elapsedSeconds >= anomalyThresholdSec) {
        try {
          const stats = fs.existsSync(logPath) ? fs.statSync(logPath) : null;
          const logBytes = stats?.size ?? 0;
          const files = fs.readdirSync(spec.workingDir).filter((f) => f !== "run.sbatch" && !f.startsWith("slurm-"));

          if (logBytes < 64 && files.length === 0) {
            record.suspiciousActivity = "potential_cryptomining";
            logStream.write(
              `\n[HPC Security Watchdog]: Alert: Sustained compute with zero solver output detected (potential cryptomining).\n`,
            );
            record.state = "FAILED";
            record.exitCode = 137;
            child.kill("SIGTERM");
            if (watchdogTimer) clearInterval(watchdogTimer);
          }
        } catch {
          // ignore
        }
      }
    }, 1000);

    const cleanupTimers = () => {
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (watchdogTimer) clearInterval(watchdogTimer);
    };

    child.on("close", (code) => {
      cleanupTimers();
      const diffCpu = process.cpuUsage(record.startCpuUsage);
      record.totalCpuMicroseconds = diffCpu.user + diffCpu.system;
      record.endTime = Date.now();
      if (record.exitCode === undefined) {
        record.exitCode = code ?? -1;
      }

      if (record.state === "RUNNING") {
        record.state = code === 0 ? "COMPLETED" : "FAILED";
      }

      logStream.end();
    });

    child.on("error", (err) => {
      cleanupTimers();
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
      suspiciousActivity: record?.suspiciousActivity,
      networkIsolationEnforced: record?.networkIsolationEnforced,
      sandboxRuntime: record?.sandboxRuntime,
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
