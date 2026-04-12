// SPDX-License-Identifier: AGPL-3.0-or-later

import { fork, type ChildProcess } from "node:child_process";

export type JobStatus = "pending" | "processing" | "completed" | "failed";

export interface JobInfo {
  status: JobStatus;
  error?: string;
  resultPath?: string;
  classesProcessed?: number;
}

type JobFn = () => Promise<void>;

/**
 * In-process serial job queue.
 *
 * Supports two execution modes:
 * - `enqueue(key, fn)` — runs an async function in the main thread (for I/O-bound tasks).
 * - `enqueueProcess(key, scriptPath, data)` — forks a child process (for CPU-bound tasks).
 */
export class JobQueue {
  readonly #queue: { key: string; fn: JobFn }[] = [];
  readonly #status = new Map<string, JobInfo>();
  #running = false;

  /** Enqueue an in-process async job. */
  enqueue(key: string, fn: JobFn): void {
    if (this.#status.has(key)) return;
    this.#status.set(key, { status: "pending" });
    this.#queue.push({ key, fn });
    void this.#process();
  }

  /**
   * Enqueue a job that runs in a forked child process.
   * The child process script should listen for IPC messages and send back
   * `{ type: 'progress', classesProcessed }` and `{ type: 'complete', classesProcessed }`.
   */
  enqueueProcess(key: string, scriptPath: string, data: Record<string, unknown>): void {
    if (this.#status.has(key)) return;
    this.#status.set(key, { status: "pending" });
    this.#queue.push({
      key,
      fn: () => this.#runChildProcess(key, scriptPath, data),
    });
    void this.#process();
  }

  /** Get the status of a job by key. */
  getStatus(key: string): JobInfo | null {
    return this.#status.get(key) ?? null;
  }

  /** Update progress info for a running job. */
  updateProgress(key: string, classesProcessed: number): void {
    const current = this.#status.get(key);
    if (current) {
      this.#status.set(key, { ...current, classesProcessed });
    }
  }

  async #runChildProcess(key: string, scriptPath: string, data: Record<string, unknown>): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const child: ChildProcess = fork(scriptPath, {
        stdio: ["pipe", "inherit", "inherit", "ipc"],
        execArgv: [...process.execArgv, "--max-old-space-size=16384", "--expose-gc"],
        // Clear NODE_OPTIONS so the parent's --max-old-space-size=8192 doesn't override ours
        env: { ...process.env, NODE_OPTIONS: "" },
      });

      child.on("message", (msg: { type: string; classesProcessed?: number }) => {
        if (msg.type === "progress" && msg.classesProcessed !== undefined) {
          this.updateProgress(key, msg.classesProcessed);
        } else if (msg.type === "complete" && msg.classesProcessed !== undefined) {
          this.updateProgress(key, msg.classesProcessed);
        }
      });

      child.on("error", (err) => {
        reject(err);
      });

      child.on("exit", (code, signal) => {
        if (code === 0) {
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

  async #process(): Promise<void> {
    if (this.#running) return;
    this.#running = true;

    while (this.#queue.length > 0) {
      const job = this.#queue.shift();
      if (!job) continue;

      const currentStatus = this.#status.get(job.key) || { status: "pending" as JobStatus };
      this.#status.set(job.key, { ...currentStatus, status: "processing" });
      try {
        await job.fn();
        const updatedStatus = this.#status.get(job.key) || { status: "pending" as JobStatus };
        this.#status.set(job.key, { ...updatedStatus, status: "completed" });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        console.error(`Job "${job.key}" failed: ${message}`);
        const updatedStatus = this.#status.get(job.key) || { status: "pending" as JobStatus };
        this.#status.set(job.key, { ...updatedStatus, status: "failed", error: message });
      }
    }

    this.#running = false;
  }
}
