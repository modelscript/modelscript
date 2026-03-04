// SPDX-License-Identifier: AGPL-3.0-or-later

export type JobStatus = "pending" | "processing" | "completed" | "failed";

export interface JobInfo {
  status: JobStatus;
  error?: string;
}

type JobFn = () => Promise<void>;

/**
 * Simple in-process serial job queue.
 *
 * Jobs are processed one at a time to avoid resource contention
 * (the Modelica compiler is CPU-intensive).
 */
export class JobQueue {
  readonly #queue: { key: string; fn: JobFn }[] = [];
  readonly #status = new Map<string, JobInfo>();
  #running = false;

  /** Enqueue a job. If a job with the same key already exists, it is skipped. */
  enqueue(key: string, fn: JobFn): void {
    if (this.#status.has(key)) return;
    this.#status.set(key, { status: "pending" });
    this.#queue.push({ key, fn });
    void this.#process();
  }

  /** Get the status of a job by key. */
  getStatus(key: string): JobInfo | null {
    return this.#status.get(key) ?? null;
  }

  async #process(): Promise<void> {
    if (this.#running) return;
    this.#running = true;

    while (this.#queue.length > 0) {
      const job = this.#queue.shift();
      if (!job) continue;

      this.#status.set(job.key, { status: "processing" });
      try {
        await job.fn();
        this.#status.set(job.key, { status: "completed" });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        console.error(`Job "${job.key}" failed: ${message}`);
        this.#status.set(job.key, { status: "failed", error: message });
      }
    }

    this.#running = false;
  }
}
