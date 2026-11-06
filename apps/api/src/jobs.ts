// SPDX-License-Identifier: AGPL-3.0-or-later

import { fork, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import os from "node:os";

import type { HpcUsageMetrics } from "./services/hpc/hpc-types.js";

export type JobStatus = "pending" | "processing" | "completed" | "failed";

export type JobPriority = "high" | "normal" | "low";

export interface JobInfo {
  status: JobStatus;
  error?: string | undefined;
  resultPath?: string | undefined;
  classesProcessed?: number | undefined;
  logs?: string[] | undefined;
  profile?: string | undefined;
  usage?: HpcUsageMetrics | undefined;
  retried?: boolean | undefined;
  degraded?: boolean | undefined;
}

export type JobFn = () => Promise<void>;

export interface JobOptions {
  /** Maximum initial execution time in milliseconds before forcefully terminating (default: 30 minutes, or JOB_TIMEOUT_MS). */
  timeoutMs?: number | undefined;
  /** Maximum total execution time ceiling in milliseconds when extended by active progress (default: 45 minutes or max(timeoutMs, 45m)). */
  maxTimeoutMs?: number | undefined;
  /** Inactivity timeout in milliseconds (aborts if no stdout/stderr or IPC progress is received for this long). Default: 90s. */
  inactivityTimeoutMs?: number | undefined;
  /** Priority of the job: "high" (user publishes), "normal" (default), or "low" (pre-seeded standard libraries). */
  priority?: JobPriority | undefined;
  /** If true, automatically retries once in degraded mode if child process fails due to Out Of Memory. Default: true. */
  retryOnOom?: boolean | undefined;
}

export interface JobQueueOptions {
  /** Maximum number of concurrently executing jobs (defaults to 16 for Slurm/Slurm-REST, 4 for local, or memory-aware 1-4). */
  concurrency?: number | undefined;
  /** Default execution timeout in milliseconds for all jobs (default: 10 minutes, or JOB_TIMEOUT_MS env). */
  defaultTimeoutMs?: number | undefined;
  /** Default inactivity timeout in milliseconds for child processes (default: 90 seconds, or JOB_INACTIVITY_TIMEOUT_MS env). */
  defaultInactivityTimeoutMs?: number | undefined;
}

interface QueuedJob {
  key: string;
  fn: JobFn;
  priorityWeight: number;
  enqueuedAt: number;
}

/**
 * In-process concurrent job queue with configurable concurrency limits, priority scheduling,
 * hard execution timeouts, inactivity watchdogs, and automatic OOM graceful degradation.
 *
 * Supports two execution modes:
 * - `enqueue(key, fn, options)` — runs an async function in the main thread (for I/O-bound and cluster tasks).
 * - `enqueueProcess(key, scriptPath, data, options)` — forks an isolated child process (for CPU-bound tasks).
 */
export class JobQueue extends EventEmitter {
  readonly #queue: QueuedJob[] = [];
  readonly #status = new Map<string, JobInfo>();
  readonly #runningChildProcesses = new Set<ChildProcess>();
  #activeCount = 0;
  #generation = 0;
  #memoryBackoffTimer: NodeJS.Timeout | null = null;
  public readonly concurrency: number;
  public readonly defaultTimeoutMs: number;
  public readonly defaultInactivityTimeoutMs: number;

  constructor(options: JobQueueOptions = {}) {
    super();
    this.setMaxListeners(100);
    const envConcurrency = Number(process.env["JOB_QUEUE_CONCURRENCY"]);
    let defaultConcurrency: number;
    if (Number.isFinite(envConcurrency) && envConcurrency > 0) {
      defaultConcurrency = envConcurrency;
    } else if (process.env["HPC_BACKEND"] === "slurm" || process.env["HPC_BACKEND"] === "slurm-rest") {
      defaultConcurrency = 16;
    } else {
      // Dynamic memory-aware concurrency default:
      // High-memory workloads (AST parsing, SVG rendering, compilation) in publish-worker
      // peak at 800MB-1.1GB for large libraries (e.g. Modelica Standard Library).
      // On machines with <= 2.5GB RAM (e.g. 2GB DigitalOcean droplets), limit to 1 concurrent job.
      // On machines with <= 4.5GB RAM, limit to 2 concurrent jobs. Otherwise default to 4.
      const totalMemGb = os.totalmem() / (1024 * 1024 * 1024);
      if (totalMemGb <= 2.5) {
        defaultConcurrency = 1;
      } else if (totalMemGb <= 4.5) {
        defaultConcurrency = 2;
      } else {
        defaultConcurrency = 4;
      }
    }
    this.concurrency = Math.max(1, Math.floor(options.concurrency ?? defaultConcurrency));

    const envTimeout = Number(process.env["JOB_TIMEOUT_MS"]);
    this.defaultTimeoutMs =
      options.defaultTimeoutMs ?? (Number.isFinite(envTimeout) && envTimeout > 0 ? envTimeout : 30 * 60 * 1000);

    const envInactivity = Number(process.env["JOB_INACTIVITY_TIMEOUT_MS"]);
    this.defaultInactivityTimeoutMs =
      options.defaultInactivityTimeoutMs ??
      (Number.isFinite(envInactivity) && envInactivity > 0 ? envInactivity : 90 * 1000);
  }

  /** Number of currently executing jobs. */
  get activeCount(): number {
    return this.#activeCount;
  }

  /** Number of queued jobs waiting for an execution slot. */
  get pendingCount(): number {
    return this.#queue.length;
  }

  /** Enqueue an in-process async job. */
  enqueue(key: string, fn: JobFn, options?: JobOptions): void {
    const existing = this.#status.get(key);
    if (existing?.status === "pending" || existing?.status === "processing") return;
    this.#status.set(key, { status: "pending" });
    const priority = options?.priority ?? "normal";
    const priorityWeight = priority === "high" ? 2 : priority === "low" ? 0 : 1;
    const timeoutMs = options?.timeoutMs;
    const wrappedFn: JobFn =
      timeoutMs && timeoutMs > 0 && Number.isFinite(timeoutMs)
        ? () => {
            return new Promise<void>((resolve, reject) => {
              const timer = setTimeout(() => {
                reject(new Error(`In-process job timed out after ${Math.round(timeoutMs / 1000)}s`));
              }, timeoutMs);
              timer.unref();
              fn().then(
                () => {
                  clearTimeout(timer);
                  resolve();
                },
                (err) => {
                  clearTimeout(timer);
                  reject(err);
                },
              );
            });
          }
        : fn;

    this.#queue.push({
      key,
      fn: wrappedFn,
      priorityWeight,
      enqueuedAt: Date.now(),
    });
    this.#process();
  }

  /**
   * Enqueue a job that runs in a forked child process.
   * The child process script should listen for IPC messages and send back
   * `{ type: 'progress', classesProcessed }` and `{ type: 'complete', classesProcessed }`.
   */
  enqueueProcess(key: string, scriptPath: string, data: Record<string, unknown>, options?: JobOptions): void {
    const existing = this.#status.get(key);
    if (existing?.status === "pending" || existing?.status === "processing") return;
    this.#status.set(key, { status: "pending" });
    const priority = options?.priority ?? "normal";
    const priorityWeight = priority === "high" ? 2 : priority === "low" ? 0 : 1;
    this.#queue.push({
      key,
      fn: () => this.#runChildProcessWithRetry(key, scriptPath, data, options),
      priorityWeight,
      enqueuedAt: Date.now(),
    });
    this.#process();
  }

  /** Get the status of a job by key. */
  getStatus(key: string): JobInfo | null {
    return this.#status.get(key) ?? null;
  }

  /** Clear all jobs from the queue and reset status map (useful for dev resets). */
  clear(): void {
    this.#generation++;
    this.#activeCount = 0;
    this.#queue.length = 0;
    this.#status.clear();
    this.removeAllListeners();

    if (this.#memoryBackoffTimer) {
      clearTimeout(this.#memoryBackoffTimer);
      this.#memoryBackoffTimer = null;
    }

    if (this.#runningChildProcesses.size > 0) {
      console.log(`[JobQueue] Killing ${this.#runningChildProcesses.size} running child process(es)...`);
      for (const child of this.#runningChildProcesses) {
        try {
          child.kill("SIGTERM");
          setTimeout(() => {
            if (!child.killed) {
              try {
                child.kill("SIGKILL");
              } catch {}
            }
          }, 1000).unref();
        } catch {}
      }
      this.#runningChildProcesses.clear();
    }
  }

  /** Update progress info for a running job. */
  updateProgress(key: string, classesProcessed: number): void {
    const current = this.#status.get(key);
    if (current) {
      this.#status.set(key, { ...current, classesProcessed });
      this.emit(`progress:${key}`, classesProcessed);
    }
  }

  /** Append a log line to a running job. */
  appendLog(key: string, chunk: string): void {
    const current = this.#status.get(key);
    if (current) {
      const logs = current.logs ?? [];
      const lines = chunk.split("\n");
      for (const line of lines) {
        if (line.trim()) {
          logs.push(line);
          this.emit(`log:${key}`, line);
        }
      }
      // keep last 500 lines
      if (logs.length > 500) {
        logs.splice(0, logs.length - 500);
      }
      this.#status.set(key, { ...current, logs });
    }
  }

  async #runChildProcessWithRetry(
    key: string,
    scriptPath: string,
    data: Record<string, unknown>,
    options?: JobOptions,
  ): Promise<void> {
    try {
      await this.#runChildProcess(key, scriptPath, data, options);
    } catch (err) {
      const recentLogs = this.#status.get(key)?.logs?.slice(-20).join(" ") ?? "";
      const isOom =
        err instanceof Error &&
        (err.message.includes("Out of memory") ||
          err.message.includes("out of memory") ||
          err.message.includes("heap limit") ||
          err.message.includes("Allocation failed") ||
          err.message.includes("Ineffective mark-compacts") ||
          err.message.includes("SIGABRT") ||
          err.message.includes("SIGKILL") ||
          recentLogs.includes("heap limit") ||
          recentLogs.includes("Allocation failed") ||
          recentLogs.includes("JavaScript heap out of memory") ||
          recentLogs.includes("Ineffective mark-compacts"));

      const retryOnOom = options?.retryOnOom ?? true;
      if (isOom && retryOnOom && !data["skipSvg"]) {
        console.warn(`[JobQueue] Job "${key}" failed due to OOM. Retrying once in degraded mode (skipSvg: true)...`);
        this.appendLog(
          key,
          `[JobQueue] Warning: Out of Memory detected. Retrying job in degraded mode (skipping SVG generation)...`,
        );
        const current = this.#status.get(key);
        if (current) {
          this.#status.set(key, { ...current, degraded: true, retried: true });
        }
        const degradedData = { ...data, skipSvg: true };
        await this.#runChildProcess(key, scriptPath, degradedData, options);
        return;
      }
      throw err;
    }
  }

  async #runChildProcess(
    key: string,
    scriptPath: string,
    data: Record<string, unknown>,
    options?: JobOptions,
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const envMaxSpace = process.env["JOB_MAX_OLD_SPACE_SIZE"];
      const parentNodeOptions = process.env["NODE_OPTIONS"] || "";
      const matchParent = parentNodeOptions.match(/--max-old-space-size=(\d+)/);
      const isDev = process.env["NODE_ENV"] !== "production";
      const totalMemMb = Math.round(os.totalmem() / (1024 * 1024));
      let autoWorkerMaxSpace = isDev ? "4096" : "8192";
      if (totalMemMb <= 2500) {
        autoWorkerMaxSpace = "1400";
      } else if (totalMemMb <= 4500) {
        autoWorkerMaxSpace = "2500";
      }
      const maxSpace = envMaxSpace ?? (matchParent ? matchParent[1] : autoWorkerMaxSpace);

      let child: ChildProcess;
      try {
        child = fork(scriptPath, {
          stdio: ["pipe", "pipe", "pipe", "ipc"],
          execArgv: [...process.execArgv, `--max-old-space-size=${maxSpace}`, "--expose-gc"],
          // Clear NODE_OPTIONS so the child's explicit execArgv takes precedence cleanly
          env: { ...process.env, NODE_OPTIONS: "" },
        });
      } catch (forkErr) {
        reject(forkErr instanceof Error ? forkErr : new Error(String(forkErr)));
        return;
      }

      this.#runningChildProcesses.add(child);
      let ipcError: string | undefined;
      let settled = false;

      let hardTimeoutTimer: NodeJS.Timeout | undefined;
      let inactivityTimer: NodeJS.Timeout | undefined;

      const cleanup = () => {
        if (hardTimeoutTimer) clearTimeout(hardTimeoutTimer);
        if (inactivityTimer) clearTimeout(inactivityTimer);
        this.#runningChildProcesses.delete(child);
      };

      const settle = (err?: Error | null) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      };

      const startedAt = Date.now();
      const initialTimeoutMs = options?.timeoutMs ?? this.defaultTimeoutMs;
      const maxTimeoutMs = options?.maxTimeoutMs ?? Math.max(initialTimeoutMs, 45 * 60 * 1000);
      let currentDeadline = startedAt + initialTimeoutMs;
      let lastClassesProcessed = 0;

      const triggerTimeout = () => {
        const totalDurationSecs = Math.round((Date.now() - startedAt) / 1000);
        console.error(`[JobQueue] Job "${key}" timed out after ${totalDurationSecs}s. Terminating...`);
        this.appendLog(key, `[JobQueue] Job execution timed out after ${totalDurationSecs}s.`);
        try {
          child.kill("SIGTERM");
        } catch {}
        const sigkillTimer = setTimeout(() => {
          if (!child.killed) {
            try {
              child.kill("SIGKILL");
            } catch {}
          }
        }, 5000);
        sigkillTimer.unref();
        settle(new Error(`Job timed out after ${totalDurationSecs}s`));
      };

      const scheduleHardTimeout = () => {
        if (hardTimeoutTimer) clearTimeout(hardTimeoutTimer);
        if (!initialTimeoutMs || initialTimeoutMs <= 0 || !Number.isFinite(initialTimeoutMs)) return;
        const remainingMs = currentDeadline - Date.now();
        if (remainingMs <= 0) {
          triggerTimeout();
          return;
        }
        hardTimeoutTimer = setTimeout(() => {
          triggerTimeout();
        }, remainingMs);
        hardTimeoutTimer.unref();
      };

      scheduleHardTimeout();

      const extendTimeoutOnProgress = (classesProcessed: number) => {
        if (!initialTimeoutMs || initialTimeoutMs <= 0 || !Number.isFinite(initialTimeoutMs)) return;
        if (classesProcessed <= lastClassesProcessed) return;
        lastClassesProcessed = classesProcessed;

        const extensionMs = Math.max(5 * 60 * 1000, Math.round(initialTimeoutMs * 0.5));
        const candidateDeadline = Date.now() + extensionMs;
        const maxDeadline = startedAt + maxTimeoutMs;
        const newDeadline = Math.min(candidateDeadline, maxDeadline);

        if (newDeadline > currentDeadline) {
          currentDeadline = newDeadline;
          scheduleHardTimeout();
        }
      };

      const inactivityTimeoutMs = options?.inactivityTimeoutMs ?? this.defaultInactivityTimeoutMs;
      const resetInactivity = () => {
        if (!inactivityTimeoutMs || inactivityTimeoutMs <= 0 || !Number.isFinite(inactivityTimeoutMs)) return;
        if (inactivityTimer) clearTimeout(inactivityTimer);
        inactivityTimer = setTimeout(() => {
          const secs = Math.round(inactivityTimeoutMs / 1000);
          console.error(`[JobQueue] Job "${key}" stalled: no output or IPC progress for ${secs}s. Aborting...`);
          this.appendLog(key, `[JobQueue] Job stalled: no progress or logs received for ${secs}s.`);
          try {
            child.kill("SIGTERM");
          } catch {}
          const sigkillTimer = setTimeout(() => {
            if (!child.killed) {
              try {
                child.kill("SIGKILL");
              } catch {}
            }
          }, 5000);
          sigkillTimer.unref();
          settle(new Error(`Job stalled due to inactivity (${secs}s with no progress)`));
        }, inactivityTimeoutMs);
        inactivityTimer.unref();
      };

      resetInactivity();

      child.stdout?.setEncoding("utf8");
      child.stdout?.on("data", (chunk: string) => {
        resetInactivity();
        process.stdout.write(chunk);
        this.appendLog(key, chunk);
      });

      let lastStderr = "";
      child.stderr?.setEncoding("utf8");
      child.stderr?.on("data", (chunk: string) => {
        resetInactivity();
        process.stderr.write(chunk);
        this.appendLog(key, chunk);
        lastStderr = (lastStderr + chunk).slice(-4000);
      });

      child.on(
        "message",
        (msg: {
          type: string;
          classesProcessed?: number | undefined;
          error?: string | undefined;
          message?: string | undefined;
        }) => {
          resetInactivity();
          if (msg.type === "progress" && msg.classesProcessed !== undefined) {
            this.updateProgress(key, msg.classesProcessed);
            extendTimeoutOnProgress(msg.classesProcessed);
          } else if (msg.type === "complete" && msg.classesProcessed !== undefined) {
            this.updateProgress(key, msg.classesProcessed);
          } else if (msg.type === "error") {
            ipcError = msg.error || msg.message || "Child process reported an error";
            this.appendLog(key, ipcError);
          }
        },
      );

      child.on("error", (err) => {
        settle(err);
      });

      child.on("disconnect", () => {
        setTimeout(() => {
          if (!settled) {
            const stderrHasOom =
              lastStderr.includes("heap limit") ||
              lastStderr.includes("Allocation failed") ||
              lastStderr.includes("JavaScript heap out of memory") ||
              lastStderr.includes("Ineffective mark-compacts") ||
              lastStderr.includes("Out of memory") ||
              lastStderr.includes("out of memory");
            settle(
              new Error(
                stderrHasOom
                  ? `Child process IPC disconnected unexpectedly (Out of memory: JavaScript heap out of memory)`
                  : `Child process IPC disconnected unexpectedly`,
              ),
            );
          }
        }, 500).unref();
      });

      child.on("exit", (code, signal) => {
        const isOomSignal = signal === "SIGABRT" || signal === "SIGKILL" || (code !== null && code === 134);
        const stderrHasOom =
          lastStderr.includes("heap limit") ||
          lastStderr.includes("Allocation failed") ||
          lastStderr.includes("JavaScript heap out of memory") ||
          lastStderr.includes("Ineffective mark-compacts") ||
          lastStderr.includes("Out of memory") ||
          lastStderr.includes("out of memory");

        if (ipcError) {
          settle(new Error(ipcError));
        } else if (code === 0) {
          settle();
        } else if (isOomSignal || stderrHasOom) {
          settle(new Error(`Child process terminated by ${signal || `exit code ${code}`} (Out of memory: heap limit exceeded)`));
        } else if (signal) {
          settle(new Error(`Child process killed by signal ${signal}`));
        } else {
          settle(new Error(`Child process exited with code ${code}`));
        }
      });

      // Send the job data to the child process via IPC
      child.send(data, (sendErr) => {
        if (sendErr) {
          settle(sendErr);
        }
      });
    });
  }

  #process(): void {
    // Memory-aware backoff: if host free memory is critically low (< 200MB) on a low-memory host, pause briefly
    const freeMemMb = Math.round(os.freemem() / (1024 * 1024));
    if (freeMemMb < 200 && this.#queue.length > 0 && this.#activeCount === 0) {
      if (!this.#memoryBackoffTimer) {
        console.warn(
          `[JobQueue] Critically low host memory (${freeMemMb}MB free). Waiting 3s before starting next job...`,
        );
        this.#memoryBackoffTimer = setTimeout(() => {
          this.#memoryBackoffTimer = null;
          this.#process();
        }, 3000);
        this.#memoryBackoffTimer.unref();
      }
      return;
    }

    // Sort queue by priority weight descending, then enqueuedAt ascending (FIFO within same priority)
    this.#queue.sort((a, b) => b.priorityWeight - a.priorityWeight || a.enqueuedAt - b.enqueuedAt);

    while (this.#activeCount < this.concurrency && this.#queue.length > 0) {
      const job = this.#queue.shift();
      if (!job) continue;

      this.#activeCount++;
      void this.#executeJob(job, this.#generation);
    }
  }

  async #executeJob(job: { key: string; fn: JobFn }, gen: number): Promise<void> {
    try {
      const currentStatus = this.#status.get(job.key) || { status: "pending" as JobStatus };
      this.#status.set(job.key, { ...currentStatus, status: "processing" });
      try {
        this.emit(`status:${job.key}`, { status: "processing" });
      } catch (emitErr) {
        console.error(`[JobQueue] Error emitting status for "${job.key}":`, emitErr);
      }

      try {
        await job.fn();
        if (this.#generation !== gen) return;
        const updatedStatus = this.#status.get(job.key) || { status: "pending" as JobStatus };
        this.#status.set(job.key, { ...updatedStatus, status: "completed" });
        try {
          this.emit(`status:${job.key}`, { status: "completed" });
        } catch (emitErr) {
          console.error(`[JobQueue] Error emitting completed status for "${job.key}":`, emitErr);
        }
      } catch (err) {
        if (this.#generation !== gen) return;
        const message = err instanceof Error ? err.message : "Unknown error";
        console.error(`Job "${job.key}" failed: ${message}`);
        const updatedStatus = this.#status.get(job.key) || { status: "pending" as JobStatus };
        this.#status.set(job.key, { ...updatedStatus, status: "failed", error: message });
        try {
          this.emit(`status:${job.key}`, { status: "failed", error: message });
        } catch (emitErr) {
          console.error(`[JobQueue] Error emitting failed status for "${job.key}":`, emitErr);
        }
      }
    } finally {
      if (this.#generation === gen) {
        this.#activeCount = Math.max(0, this.#activeCount - 1);
        this.#prune();
        this.#process();
      }
    }
  }

  static readonly MAX_STATUS_ENTRIES = 1000;

  /** Evict oldest finished jobs when status map exceeds maximum size. */
  #prune(): void {
    if (this.#status.size <= JobQueue.MAX_STATUS_ENTRIES) return;
    for (const [key, info] of this.#status.entries()) {
      if (this.#status.size <= JobQueue.MAX_STATUS_ENTRIES) break;
      if (info.status === "completed" || info.status === "failed") {
        this.#status.delete(key);
      }
    }
  }
}
