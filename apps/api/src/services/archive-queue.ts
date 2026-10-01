// SPDX-License-Identifier: AGPL-3.0-or-later

import fs from "node:fs";
import path from "node:path";
import type { LibraryDatabase } from "../database.js";
import { gatherUserDataBundle, generateUserArchiveZip } from "./user-archive.js";

export type ArchiveJobStatus = "queued" | "processing" | "completed" | "failed";

export interface ArchiveJob {
  id: string;
  userId: number;
  username: string;
  format: "zip" | "json";
  status: ArchiveJobStatus;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  expiresAt?: string;
  error?: string;
  filePath?: string;
  fileSizeBytes?: number;
  queuePosition?: number;
}

export interface ArchiveQueueOptions {
  /** Maximum number of concurrent archive generation workers. Defaults to ARCHIVE_CONCURRENCY env or 2. */
  maxConcurrency?: number;
  /** Storage directory for staged archives. Defaults to 'data/archives'. */
  storageDir?: string;
  /** TTL for completed archive files in milliseconds. Defaults to 24 hours. */
  ttlMs?: number;
}

/**
 * Asynchronous job queue for GDPR Art. 20 / CCPA user data archive compilation.
 * Limits concurrent compression jobs to prevent V8 heap exhaustion and CPU starvation.
 */
export class ArchiveQueue {
  private readonly jobs = new Map<string, ArchiveJob>();
  private readonly queue: string[] = [];
  private activeCount = 0;
  private readonly maxConcurrency: number;
  private readonly storageDir: string;
  private readonly ttlMs: number;

  constructor(options: ArchiveQueueOptions = {}) {
    const envConcurrency = Number(process.env["ARCHIVE_CONCURRENCY"] || process.env["ARCHIVE_MAX_CONCURRENCY"]);
    this.maxConcurrency =
      options.maxConcurrency ?? (Number.isFinite(envConcurrency) && envConcurrency > 0 ? envConcurrency : 2);
    this.storageDir = options.storageDir ?? path.resolve(process.cwd(), "apps/api/data/archives");
    this.ttlMs = options.ttlMs ?? 24 * 60 * 60 * 1000; // 24 hours

    try {
      fs.mkdirSync(this.storageDir, { recursive: true });
    } catch {}
  }

  public getConcurrency(): number {
    return this.maxConcurrency;
  }

  /**
   * Enqueues a data archive export for a given user.
   * If the user already has an active (queued or processing) job, returns that existing job.
   */
  public enqueue(
    database: LibraryDatabase,
    userId: number,
    username: string,
    format: "zip" | "json" = "zip",
  ): ArchiveJob {
    // Check if user already has an in-flight job
    for (const job of this.jobs.values()) {
      if (job.userId === userId && (job.status === "queued" || job.status === "processing")) {
        job.queuePosition = this.getQueuePosition(job.id);
        return job;
      }
    }

    const jobId = `export_${userId}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const job: ArchiveJob = {
      id: jobId,
      userId,
      username,
      format,
      status: "queued",
      createdAt: new Date().toISOString(),
    };

    this.jobs.set(jobId, job);
    this.queue.push(jobId);
    job.queuePosition = this.getQueuePosition(jobId);

    // Trigger queue drain in background
    setTimeout(() => this.drain(database), 0);

    return job;
  }

  public getJob(jobId: string): ArchiveJob | null {
    const job = this.jobs.get(jobId);
    if (!job) return null;
    if (job.status === "queued") {
      job.queuePosition = this.getQueuePosition(job.id);
    }
    return job;
  }

  public getLatestUserJob(userId: number): ArchiveJob | null {
    let latest: ArchiveJob | null = null;
    for (const job of this.jobs.values()) {
      if (job.userId === userId) {
        if (!latest || new Date(job.createdAt).getTime() > new Date(latest.createdAt).getTime()) {
          latest = job;
        }
      }
    }
    if (latest && latest.status === "queued") {
      latest.queuePosition = this.getQueuePosition(latest.id);
    }
    return latest;
  }

  public getQueuePosition(jobId: string): number {
    const idx = this.queue.indexOf(jobId);
    return idx >= 0 ? idx + 1 : 0;
  }

  private drain(database: LibraryDatabase): void {
    while (this.activeCount < this.maxConcurrency && this.queue.length > 0) {
      const jobId = this.queue.shift();
      if (!jobId) break;

      const job = this.jobs.get(jobId);
      if (!job) continue;

      this.activeCount++;
      job.status = "processing";
      job.startedAt = new Date().toISOString();
      delete job.queuePosition;

      // Process in next tick to avoid blocking the event loop
      setImmediate(async () => {
        try {
          fs.mkdirSync(this.storageDir, { recursive: true });
          const targetFile = path.join(this.storageDir, `${job.id}.${job.format}`);

          if (job.format === "zip") {
            const zipBuffer = generateUserArchiveZip(database, job.userId);
            if (!zipBuffer) {
              throw new Error("Failed to generate archive: user record or data missing.");
            }
            fs.writeFileSync(targetFile, zipBuffer);
            job.fileSizeBytes = zipBuffer.length;
          } else {
            const bundle = gatherUserDataBundle(database, job.userId);
            if (!bundle) {
              throw new Error("Failed to gather user data: user record missing.");
            }
            const jsonStr = JSON.stringify(bundle, null, 2);
            fs.writeFileSync(targetFile, jsonStr, "utf-8");
            job.fileSizeBytes = Buffer.byteLength(jsonStr, "utf-8");
          }

          job.status = "completed";
          job.filePath = targetFile;
          job.completedAt = new Date().toISOString();
          job.expiresAt = new Date(Date.now() + this.ttlMs).toISOString();
        } catch (err: any) {
          job.status = "failed";
          job.error = err.message || "Archive compilation failed";
        } finally {
          this.activeCount--;
          this.drain(database);
        }
      });
    }
  }

  /**
   * Purges staged archive files that have exceeded their TTL.
   */
  public cleanupExpiredArchives(): { removedCount: number } {
    const now = Date.now();
    let removedCount = 0;

    for (const [id, job] of this.jobs.entries()) {
      if (job.expiresAt && now > new Date(job.expiresAt).getTime()) {
        if (job.filePath && fs.existsSync(job.filePath)) {
          try {
            fs.unlinkSync(job.filePath);
          } catch {}
        }
        this.jobs.delete(id);
        removedCount++;
      }
    }

    return { removedCount };
  }
}

export const defaultArchiveQueue = new ArchiveQueue();
