// SPDX-License-Identifier: AGPL-3.0-or-later

import { fork, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";

import type { HpcUsageMetrics } from "./services/hpc/hpc-types.js";

export type JobStatus = "pending" | "processing" | "completed" | "failed";

export interface JobInfo {
  status: JobStatus;
  error?: string | undefined;
  resultPath?: string | undefined;
  classesProcessed?: number | undefined;
  logs?: string[] | undefined;
  profile?: string | undefined;
  usage?: HpcUsageMetrics | undefined;
}

type JobFn = () => Promise<void>;

export interface JobQueueOptions {
  /** Maximum number of concurrently executing jobs (defaults to 16 for Slurm/Slurm-REST, 4 for local). */
  concurrency?: number | undefined;
}

/**
 * In-process concurrent job queue with configurable concurrency limits.
 *
 * Supports two execution modes:
 * - `enqueue(key, fn)` — runs an async function in the main thread (for I/O-bound and cluster tasks).
 * - `enqueueProcess(key, scriptPath, data)` — forks a child process (for CPU-bound tasks).
 */
export class JobQueue extends EventEmitter {
  readonly #queue: { key: string; fn: JobFn }[] = [];
  readonly #status = new Map<string, JobInfo>();
  readonly #runningChildProcesses = new Set<ChildProcess>();
  #activeCount = 0;
  #generation = 0;
  public readonly concurrency: number;

  constructor(options: JobQueueOptions = {}) {
    super();
    this.setMaxListeners(100);
    const defaultConcurrency =
      Number(process.env["JOB_QUEUE_CONCURRENCY"]) ||
      (process.env["HPC_BACKEND"] === "slurm" || process.env["HPC_BACKEND"] === "slurm-rest" ? 16 : 4);
    this.concurrency = Math.max(1, Math.floor(options.concurrency ?? defaultConcurrency));
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
  enqueue(key: string, fn: JobFn): void {
    const existing = this.#status.get(key);
    if (existing?.status === "pending" || existing?.status === "processing") return;
    this.#status.set(key, { status: "pending" });
    this.#queue.push({ key, fn });
    this.#process();
  }

  /**
   * Enqueue a job that runs in a forked child process.
   * The child process script should listen for IPC messages and send back
   * `{ type: 'progress', classesProcessed }` and `{ type: 'complete', classesProcessed }`.
   */
  enqueueProcess(key: string, scriptPath: string, data: Record<string, unknown>): void {
    const existing = this.#status.get(key);
    if (existing?.status === "pending" || existing?.status === "processing") return;
    this.#status.set(key, { status: "pending" });
    this.#queue.push({
      key,
      fn: () => this.#runChildProcess(key, scriptPath, data),
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

    if (this.#runningChildProcesses.size > 0) {
      console.log(`[JobQueue] Killing ${this.#runningChildProcesses.size} running child process(es)...`);
      for (const child of this.#runningChildProcesses) {
        child.kill("SIGTERM");
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

  async #runChildProcess(key: string, scriptPath: string, data: Record<string, unknown>): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const isDev = process.env["NODE_ENV"] !== "production";
      const maxSpace = isDev ? "8192" : "16384";

      const child: ChildProcess = fork(scriptPath, {
        stdio: ["pipe", "pipe", "pipe", "ipc"],
        execArgv: [...process.execArgv, `--max-old-space-size=${maxSpace}`, "--expose-gc"],
        // Clear NODE_OPTIONS so the parent's --max-old-space-size=8192 doesn't override ours
        env: { ...process.env, NODE_OPTIONS: "" },
      });

      this.#runningChildProcesses.add(child);
      let ipcError: string | undefined;

      child.stdout?.setEncoding("utf8");
      child.stdout?.on("data", (chunk: string) => {
        process.stdout.write(chunk); // Still print to console
        this.appendLog(key, chunk);
      });

      child.stderr?.setEncoding("utf8");
      child.stderr?.on("data", (chunk: string) => {
        process.stderr.write(chunk); // Still print to console
        this.appendLog(key, chunk);
      });

      child.on(
        "message",
        (msg: {
          type: string;
          classesProcessed?: number | undefined;
          error?: string | undefined;
          message?: string | undefined;
        }) => {
          if (msg.type === "progress" && msg.classesProcessed !== undefined) {
            this.updateProgress(key, msg.classesProcessed);
          } else if (msg.type === "complete" && msg.classesProcessed !== undefined) {
            this.updateProgress(key, msg.classesProcessed);
          } else if (msg.type === "error") {
            ipcError = msg.error || msg.message || "Child process reported an error";
            this.appendLog(key, ipcError);
          }
        },
      );

      child.on("error", (err) => {
        this.#runningChildProcesses.delete(child);
        reject(err);
      });

      child.on("exit", (code, signal) => {
        this.#runningChildProcesses.delete(child);
        if (ipcError) {
          reject(new Error(ipcError));
        } else if (code === 0) {
          resolve();
        } else if (signal) {
          reject(new Error(`Child process killed by signal ${signal} (likely out of memory)`));
        } else {
          reject(new Error(`Child process exited with code ${code}`));
        }
      });

      // Send the job data to the child process via IPC
      child.send(data);
    });
  }

  #process(): void {
    while (this.#activeCount < this.concurrency && this.#queue.length > 0) {
      const job = this.#queue.shift();
      if (!job) continue;

      this.#activeCount++;
      void this.#executeJob(job, this.#generation);
    }
  }

  async #executeJob(job: { key: string; fn: JobFn }, gen: number): Promise<void> {
    const currentStatus = this.#status.get(job.key) || { status: "pending" as JobStatus };
    this.#status.set(job.key, { ...currentStatus, status: "processing" });
    this.emit(`status:${job.key}`, { status: "processing" });
    try {
      await job.fn();
      if (this.#generation !== gen) return;
      const updatedStatus = this.#status.get(job.key) || { status: "pending" as JobStatus };
      this.#status.set(job.key, { ...updatedStatus, status: "completed" });
      this.emit(`status:${job.key}`, { status: "completed" });
    } catch (err) {
      if (this.#generation !== gen) return;
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error(`Job "${job.key}" failed: ${message}`);
      const updatedStatus = this.#status.get(job.key) || { status: "pending" as JobStatus };
      this.#status.set(job.key, { ...updatedStatus, status: "failed", error: message });
      this.emit(`status:${job.key}`, { status: "failed", error: message });
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
