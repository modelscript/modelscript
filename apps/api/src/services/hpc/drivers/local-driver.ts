// SPDX-License-Identifier: AGPL-3.0-or-later

import { execFile, spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { calculateCostCredits, getComputeProfile } from "../compute-profiles.js";
import type {
  ComputeProfile,
  HpcDriver,
  HpcJobSpec,
  HpcJobState,
  HpcSandboxConfig,
  HpcSubmissionResult,
  HpcUsageMetrics,
} from "../hpc-types.js";
import { generateSbatchScript, sanitizeUserEnv } from "../sbatch-generator.js";

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
  childCpuMicroseconds?: number | undefined;
  peakMemoryMb?: number | undefined;
  exitCode?: number | undefined;
  logPath: string;
  suspiciousActivity?: "potential_cryptomining" | "timeout" | "credit_exhausted" | undefined;
  networkIsolationEnforced?: boolean | undefined;
  sandboxRuntime?: string | undefined;
  containerName?: string | undefined;
  cleanupTimers?: (() => void) | undefined;
}

const BASE_ENV_ALLOWLIST = [
  "PATH",
  "LANG",
  "LC_ALL",
  "TZ",
  "TMPDIR",
  "HOME",
  "OMP_NUM_THREADS",
  "OPENBLAS_NUM_THREADS",
] as const;

const MINIMAL_BWRAP_RO_BINDS = [
  "/usr",
  "/lib",
  "/lib64",
  "/bin",
  "/etc/alternatives",
  "/etc/ld.so.cache",
  "/etc/ssl",
] as const;

const DEFAULT_SANDBOX_IMAGE = "ghcr.io/modelscript/cli-ee:v1.0.0";

function sanitizeContainerNameSuffix(jobId: string): string {
  const safe = path
    .basename(String(jobId))
    .replace(/[^a-zA-Z0-9_.-]/g, "_")
    .replace(/^[._-]+/, "")
    .slice(0, 48);
  return safe || "job";
}

function validateSandboxImage(image: string): string {
  const trimmed = image.trim();
  if (
    !trimmed ||
    trimmed.length > 256 ||
    trimmed.startsWith("-") ||
    trimmed.includes("..") ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._/@:-]*$/.test(trimmed)
  ) {
    throw new Error(`Invalid sandbox container image reference: ${image}`);
  }
  const allowedEnv = process.env["HPC_SANDBOX_ALLOWED_IMAGES"];
  if (allowedEnv && allowedEnv.trim().length > 0) {
    const allowlist = allowedEnv
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (!allowlist.includes(trimmed)) {
      throw new Error(`Sandbox image '${trimmed}' is not in HPC_SANDBOX_ALLOWED_IMAGES allowlist.`);
    }
  }
  return trimmed;
}

/**
 * Samples a spawned child process's cumulative CPU time (utime + stime + cutime + cstime)
 * and peak resident memory (VmHWM / VmRSS) from Linux `/proc/<pid>`.
 */
function sampleChildProcessMetrics(pid: number | undefined): {
  cpuMicroseconds?: number | undefined;
  rssMb?: number | undefined;
} {
  if (!pid || process.platform !== "linux") return {};
  let cpuMicroseconds: number | undefined;
  let rssMb: number | undefined;

  try {
    const statContent = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
    const closeParen = statContent.lastIndexOf(")");
    if (closeParen !== -1) {
      const fields = statContent
        .slice(closeParen + 2)
        .trim()
        .split(/\s+/);
      // fields[11] = utime, fields[12] = stime, fields[13] = cutime, fields[14] = cstime (in clock ticks, USER_HZ=100)
      const utime = Number(fields[11] ?? 0);
      const stime = Number(fields[12] ?? 0);
      const cutime = Number(fields[13] ?? 0);
      const cstime = Number(fields[14] ?? 0);
      const totalTicks = utime + stime + cutime + cstime;
      if (Number.isFinite(totalTicks) && totalTicks >= 0) {
        cpuMicroseconds = totalTicks * 10_000;
      }
    }
  } catch {
    // Process may have exited
  }

  try {
    const statusContent = fs.readFileSync(`/proc/${pid}/status`, "utf8");
    const hwmMatch = statusContent.match(/^VmHWM:\s+(\d+)\s+kB/m) ?? statusContent.match(/^VmRSS:\s+(\d+)\s+kB/m);
    if (hwmMatch && hwmMatch[1]) {
      const kb = Number(hwmMatch[1]);
      if (Number.isFinite(kb) && kb > 0) {
        rssMb = Math.max(1, Math.round(kb / 1024));
      }
    }
  } catch {
    // Process may have exited
  }

  return { cpuMicroseconds, rssMb };
}

/**
 * Local process execution driver.
 * Emulates Slurm's execution model and accounting on developer workstations
 * and single-node instances with optional containerized (Docker/Podman) or
 * bubblewrap (bwrap) zero-egress sandboxing.
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
    containerName?: string | undefined;
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
    let containerName: string | undefined;

    const requestedRuntime =
      sandboxConfig?.runtime ||
      (process.env["HPC_SANDBOX_RUNTIME"] as "auto" | "docker" | "podman" | "unshare" | "bwrap" | "none") ||
      "auto";

    const isSandboxRequested =
      sandboxConfig?.enabled === true ||
      sandboxConfig?.networkIsolation === true ||
      spec.resources.networkIsolation === true ||
      process.env["HPC_SANDBOX_ENABLED"] === "true";

    const allowTestFallback = process.env["NODE_ENV"] === "test" && sandboxConfig?.allowUnsandboxedFallback === true;

    let effectiveRuntime = requestedRuntime;
    if (requestedRuntime === "auto") {
      if (isSandboxRequested) {
        if (this.isExecutableInPath("podman")) {
          effectiveRuntime = "podman";
        } else if (this.isExecutableInPath("docker")) {
          effectiveRuntime = "docker";
        } else if (process.platform === "linux" && this.isExecutableInPath("bwrap")) {
          effectiveRuntime = "bwrap";
        } else if (allowTestFallback) {
          effectiveRuntime = "none";
        } else {
          throw new Error(
            "HPC sandboxing was requested, but no compliant sandbox runtime (podman, docker, bwrap) is available.",
          );
        }
      } else {
        effectiveRuntime = "none";
      }
    } else if (
      (effectiveRuntime === "docker" || effectiveRuntime === "podman" || effectiveRuntime === "bwrap") &&
      process.env["NODE_ENV"] !== "test" &&
      !this.isExecutableInPath(effectiveRuntime)
    ) {
      throw new Error(`Requested HPC sandbox runtime '${effectiveRuntime}' is not installed on this host.`);
    }

    if (effectiveRuntime === "docker" || effectiveRuntime === "podman") {
      runtime = effectiveRuntime;
      networkIsolation = sandboxConfig?.networkIsolation !== false;
      const readOnly = sandboxConfig?.readOnlyRoot !== false;
      const tmpfsMb = sandboxConfig?.tmpfsSizeMb ?? 2048;
      const rawImage = sandboxConfig?.image || process.env["HPC_SANDBOX_IMAGE"] || DEFAULT_SANDBOX_IMAGE;
      const image = validateSandboxImage(rawImage);
      const absWorkingDir = path.resolve(spec.workingDir);
      containerName = `msx-${sanitizeContainerNameSuffix(spec.jobId)}`;

      const containerArgs: string[] = [
        "run",
        "--rm",
        "--name",
        containerName,
        "--pids-limit=256",
        "--user",
        "65534:65534",
      ];
      if (networkIsolation) {
        containerArgs.push("--network", "none");
      }
      if (readOnly) {
        containerArgs.push("--read-only");
      }
      containerArgs.push("--tmpfs", `/tmp:rw,size=${tmpfsMb}m`);
      containerArgs.push("-v", `${absWorkingDir}:${absWorkingDir}:rw`);
      containerArgs.push("-w", absWorkingDir);

      const baseCpus = spec.resources.cpusPerTask ?? 4;
      const effectiveCpus =
        spec.resources.cpuMaxLimitPercent && spec.resources.cpuMaxLimitPercent > 0
          ? Math.max(0.1, Math.round(((baseCpus * spec.resources.cpuMaxLimitPercent) / 100) * 100) / 100)
          : baseCpus;
      containerArgs.push("--cpus", String(effectiveCpus));

      const memMb = spec.resources.memoryMaxMb ?? spec.resources.memoryMb ?? 1024;
      containerArgs.push("--memory", `${Math.floor(memMb)}m`);

      if (sandboxConfig?.dropCapabilities !== false) {
        containerArgs.push("--cap-drop=ALL", "--security-opt=no-new-privileges");
      }

      if (sandboxConfig?.seccompProfile) {
        const seccomp = sandboxConfig.seccompProfile.trim();
        if (/[\s\0\r\n]/.test(seccomp)) {
          throw new Error("Invalid seccompProfile path.");
        }
        containerArgs.push("--security-opt", `seccomp=${seccomp}`);
      }

      containerArgs.push(image, execCmd, ...execArgs);
      execCmd = effectiveRuntime;
      execArgs = containerArgs;
    } else if (effectiveRuntime === "bwrap") {
      if (process.platform !== "linux") {
        if (!allowTestFallback && process.env["NODE_ENV"] !== "test") {
          throw new Error("bwrap sandbox runtime is only supported on Linux.");
        }
      } else {
        runtime = "bwrap";
        networkIsolation = sandboxConfig?.networkIsolation !== false;
        const absWorkingDir = path.resolve(spec.workingDir);
        const bwrapArgs: string[] = [
          "--unshare-pid",
          "--unshare-ipc",
          "--unshare-uts",
          "--die-with-parent",
          "--new-session",
        ];
        for (const sysPath of MINIMAL_BWRAP_RO_BINDS) {
          if (fs.existsSync(sysPath)) {
            bwrapArgs.push("--ro-bind", sysPath, sysPath);
          }
        }
        bwrapArgs.push(
          "--dev",
          "/dev",
          "--proc",
          "/proc",
          "--tmpfs",
          "/tmp",
          "--bind",
          absWorkingDir,
          absWorkingDir,
          "--chdir",
          absWorkingDir,
        );
        if (networkIsolation) {
          bwrapArgs.push("--unshare-net");
        }
        bwrapArgs.push("--", execCmd, ...execArgs);
        execCmd = "bwrap";
        execArgs = bwrapArgs;
      }
    } else if (effectiveRuntime === "unshare" && process.platform === "linux") {
      runtime = "unshare";
      networkIsolation = true;
      execArgs = ["-n", "-r", execCmd, ...execArgs];
      execCmd = "unshare";
    }

    return { execCmd, execArgs, runtime, networkIsolation, containerName };
  }

  /**
   * Sends SIGTERM to the entire process group, escalates to SIGKILL if still alive,
   * and force-removes any backing container runtime instance.
   */
  private terminateJobProcess(record: LocalJobRecord): void {
    const { child, sandboxRuntime, containerName } = record;
    const pid = child.pid;

    const sendSignal = (sig: NodeJS.Signals) => {
      if (pid && process.platform !== "win32") {
        try {
          process.kill(-pid, sig);
          return;
        } catch {
          // Process group may already be gone; fall back to direct child signal
        }
      }
      try {
        child.kill(sig);
      } catch {
        // Process already exited
      }
    };

    sendSignal("SIGTERM");

    const killTimer = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) {
        sendSignal("SIGKILL");
      }
    }, 2000);
    killTimer.unref?.();

    if (containerName && (sandboxRuntime === "docker" || sandboxRuntime === "podman")) {
      execFile(sandboxRuntime, ["rm", "-f", containerName], { timeout: 5000 }, (err) => {
        if (err) {
          console.warn(`[HPC Local Driver] Failed to force-remove container ${containerName}: ${err.message}`);
        }
      });
    }
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
    logStream.on("error", () => {
      // Ignore write stream errors if workingDir is cleaned up during cancellation
    });

    // 3. Resolve command, MPI, and Sandboxing
    const { execCmd, execArgs, runtime, networkIsolation, containerName } = this.resolveSandboxCommand(spec);

    const startTime = Date.now();

    // 4. Spawn child process with strict allowlist base environment merged with sanitized user env
    const baseEnv: Record<string, string> = {};
    for (const key of BASE_ENV_ALLOWLIST) {
      const val = process.env[key];
      if (typeof val === "string") {
        baseEnv[key] = val;
      }
    }
    const safeUserEnv = sanitizeUserEnv(spec.env);

    const child = spawn(execCmd, execArgs, {
      cwd: spec.workingDir,
      detached: process.platform !== "win32",
      env: {
        ...baseEnv,
        ...safeUserEnv,
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
      logPath,
      networkIsolationEnforced: networkIsolation,
      sandboxRuntime: runtime,
      containerName,
    };

    const updateChildMetrics = () => {
      const sample = sampleChildProcessMetrics(child.pid);
      if (sample.cpuMicroseconds !== undefined && sample.cpuMicroseconds > (record.childCpuMicroseconds ?? 0)) {
        record.childCpuMicroseconds = sample.cpuMicroseconds;
      }
      if (sample.rssMb !== undefined && sample.rssMb > (record.peakMemoryMb ?? 0)) {
        record.peakMemoryMb = sample.rssMb;
      }
    };

    // Sample immediately after spawn
    updateChildMetrics();

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
            record.endTime = Date.now();
            record.suspiciousActivity = "timeout";
            logStream.write(`\n[HPC Local Driver]: Job exceeded time limit of ${maxTimeMinutes}m\n`);
            this.terminateJobProcess(record);
          }
        },
        maxTimeMinutes * 60 * 1000,
      );
      timeoutTimer.unref?.();
    }

    // 6. Credit drain & Anomaly Watchdog
    let watchdogTimer: NodeJS.Timeout | undefined;
    const anomalyThresholdSec = this.options.cryptoAnomalyThresholdSeconds ?? 600;

    watchdogTimer = setInterval(() => {
      if (record.state !== "RUNNING") {
        if (watchdogTimer) clearInterval(watchdogTimer);
        return;
      }

      updateChildMetrics();
      const elapsedSeconds = (Date.now() - record.startTime) / 1000;

      // Check credit exhaustion
      const activeProfile = getComputeProfile(spec.profileId);
      if (spec.userId !== undefined && this.options.walletBalanceChecker) {
        try {
          const balance = this.options.walletBalanceChecker(spec.userId);
          const currentCost = (elapsedSeconds / 3600) * activeProfile.costCreditsPerHour;
          if (balance - currentCost < 0) {
            record.state = "FAILED";
            record.exitCode = 402;
            record.endTime = Date.now();
            record.suspiciousActivity = "credit_exhausted";
            logStream.write(
              `\n[HPC Security Watchdog]: Job terminated due to compute credit exhaustion (balance: ${balance.toFixed(2)} cr).\n`,
            );
            this.terminateJobProcess(record);
            if (watchdogTimer) clearInterval(watchdogTimer);
            return;
          }
        } catch (err) {
          console.warn(`[HPC Local Driver] Wallet balance checker error for job ${spec.jobId}:`, err);
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
            record.endTime = Date.now();
            this.terminateJobProcess(record);
            if (watchdogTimer) clearInterval(watchdogTimer);
          }
        } catch (err) {
          console.warn(`[HPC Local Driver] Anomaly check error for job ${spec.jobId}:`, err);
        }
      }
    }, 1000);
    watchdogTimer.unref?.();

    const cleanupTimers = () => {
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (watchdogTimer) clearInterval(watchdogTimer);
    };
    record.cleanupTimers = cleanupTimers;

    const pruneOldJobs = () => {
      if (this.jobs.size <= 500) return;
      for (const [id, rec] of this.jobs.entries()) {
        if (this.jobs.size <= 500) break;
        if (rec.state !== "RUNNING" && rec.state !== "PENDING") {
          this.jobs.delete(id);
        }
      }
    };

    child.on("close", (code) => {
      updateChildMetrics();
      cleanupTimers();
      record.endTime = record.endTime ?? Date.now();
      if (record.exitCode === undefined) {
        record.exitCode = code ?? -1;
      }

      if (record.state === "RUNNING") {
        record.state = code === 0 ? "COMPLETED" : "FAILED";
      }

      logStream.end();
      pruneOldJobs();
    });

    child.on("error", (err) => {
      cleanupTimers();
      record.endTime = record.endTime ?? Date.now();
      record.state = "FAILED";
      record.exitCode = -1;
      logStream.write(`\n[HPC Local Driver Spawn Error]: ${err.message}\n`);
      logStream.end();
      pruneOldJobs();
    });

    const profile = getComputeProfile(spec.profileId);
    return {
      nativeJobId: spec.jobId,
      driverType: "local",
      allocatedResources: spec.resources,
      estimatedCreditsPerHour: profile.costCreditsPerHour,
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
      record.state = "CANCELLED";
      record.endTime = Date.now();
      record.cleanupTimers?.();
      this.terminateJobProcess(record);
      return true;
    }
    return false;
  }

  public async getMetrics(nativeJobId: string, _workingDir: string, profile: ComputeProfile): Promise<HpcUsageMetrics> {
    const record = this.jobs.get(nativeJobId);
    const endTs = record?.endTime ?? Date.now();
    const wallClockSeconds = record ? Math.max(1, Math.round((endTs - record.startTime) / 1000)) : 0;

    // CPU core-seconds from child process /proc/<pid>/stat, or wallClockSeconds * allocated CPUs
    const cpus = record?.spec.resources.cpusPerTask ?? profile.cpus;
    const measuredCpuSec =
      record?.childCpuMicroseconds && record.childCpuMicroseconds > 0
        ? Math.round(record.childCpuMicroseconds / 1000) / 1000
        : wallClockSeconds * cpus;

    const memoryMb = record?.peakMemoryMb && record.peakMemoryMb > 0 ? record.peakMemoryMb : 0;
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
    const safeId = path.basename(String(nativeJobId)).replace(/[^a-zA-Z0-9_.-]/g, "_");
    return path.join(workingDir, `slurm-${safeId}.out`);
  }

  public async healthCheck(): Promise<{ ok: boolean; details?: string | undefined }> {
    let runningCount = 0;
    for (const rec of this.jobs.values()) {
      if (rec.state === "RUNNING") runningCount++;
    }
    return {
      ok: true,
      details: `LocalProcessDriver healthy (${runningCount} running, ${this.jobs.size} tracked)`,
    };
  }

  public async shutdown(): Promise<void> {
    for (const record of this.jobs.values()) {
      if (record.state === "RUNNING") {
        record.state = "CANCELLED";
        record.endTime = Date.now();
        record.cleanupTimers?.();
        this.terminateJobProcess(record);
      }
    }
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
