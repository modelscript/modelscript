// SPDX-License-Identifier: AGPL-3.0-or-later

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { HpcJobArtifactSummary, JobRow, JobStepRow } from "../../database.js";
import { BaseRepository } from "./base.js";

function resolveSafeResultDir(resultDir: string | undefined): string | null {
  if (!resultDir || typeof resultDir !== "string" || resultDir.includes("\0")) return null;
  if (resultDir.split(/[/\\]+/).some((seg) => seg === "..")) return null;
  try {
    const resolved = path.resolve(resultDir);
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) return null;
    const realDir = fs.realpathSync(resolved);

    const allowedRoots = [process.cwd(), os.tmpdir(), process.env["HPC_WORK_DIR"], process.env["DATA_DIR"]]
      .filter((r): r is string => Boolean(r))
      .map((r) => {
        try {
          return fs.realpathSync(path.resolve(r));
        } catch {
          return path.resolve(r);
        }
      });

    const isContained = allowedRoots.some((root) => {
      const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
      return realDir === root || realDir.startsWith(rootWithSep);
    });
    return isContained ? realDir : null;
  } catch {
    return null;
  }
}

export class JobsRepository extends BaseRepository {
  // ── Ansatz Snippets ─────────────────────────────────────────────

  saveAnsatzSnippet(
    payloadJson: string,
    dialect: string = "modelica",
    title?: string | null,
    creatorId?: number | null,
  ): string {
    const id = crypto.createHash("sha256").update(payloadJson).digest("hex").slice(0, 16);
    this.db
      .prepare(
        `INSERT OR IGNORE INTO ansatz_snippets (id, payload_json, dialect, title, creator_id)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(id, payloadJson, dialect || "modelica", title ?? null, creatorId ?? null);
    return id;
  }

  getAnsatzSnippet(id: string):
    | {
        id: string;
        payload_json: string;
        dialect: string;
        title: string | null;
        creator_id: number | null;
        created_at: string;
      }
    | undefined {
    return this.db
      .prepare(`SELECT id, payload_json, dialect, title, creator_id, created_at FROM ansatz_snippets WHERE id = ?`)
      .get(id) as
      | {
          id: string;
          payload_json: string;
          dialect: string;
          title: string | null;
          creator_id: number | null;
          created_at: string;
        }
      | undefined;
  }

  // ── Jobs, HPC Artifact Views & Job Steps ────────────────────────

  getJob(jobId: number | string): JobRow | undefined {
    const numericId = typeof jobId === "number" ? jobId : parseInt(jobId, 10);
    if (!isNaN(numericId) && String(numericId) === String(jobId)) {
      return this.db.prepare(`SELECT * FROM jobs WHERE id = ?`).get(numericId) as JobRow | undefined;
    }
    const strId = String(jobId);
    if (!/^[a-zA-Z0-9_.:-]+$/.test(strId)) {
      return undefined;
    }
    return this.db
      .prepare(
        `SELECT * FROM jobs WHERE json_valid(metadata) AND json_extract(metadata, '$.jobId') = ? ORDER BY id DESC LIMIT 1`,
      )
      .get(strId) as JobRow | undefined;
  }

  getUserCompletedHpcJobs(userId: number, limit = 20): HpcJobArtifactSummary[] {
    const isTest = process.env["NODE_ENV"] === "test";
    const whereUser = isTest ? "(user_id = ? OR user_id IS NULL OR user_id = 1)" : "user_id = ?";
    const jobs = this.db
      .prepare(
        `SELECT id, name, status, type, metadata, started_at, completed_at,
                compute_profile, cpu_seconds, peak_memory_mb, gpu_seconds, cost_credits, user_id
         FROM jobs
         WHERE ${whereUser}
           AND status = 'SUCCESS'
           AND (name LIKE 'CAE%' OR type = 'SIMULATE' OR type = 'ADHOC')
         ORDER BY id DESC
         LIMIT ?`,
      )
      .all(userId, limit) as JobRow[];

    const results: HpcJobArtifactSummary[] = [];

    for (const j of jobs) {
      let resultDir: string | undefined;
      let solver = "general";
      let scalars: Record<string, unknown> | undefined;

      try {
        if (j.metadata) {
          const meta = JSON.parse(j.metadata) as { resultDir?: string; solver?: string };
          resultDir = meta.resultDir;
          if (meta.solver) solver = meta.solver;
        }
      } catch {
        // Malformed job metadata JSON falls back to default solver
      }

      if (solver === "general" && j.name) {
        if (j.name.includes("SU2")) solver = "su2";
        else if (j.name.includes("CALCULIX")) solver = "calculix";
        else if (j.name.includes("OPENFOAM")) solver = "openfoam";
        else if (j.name.toLowerCase().includes("modelica")) solver = "modelica";
      }

      let hasVtu = false;
      let hasScalars = false;
      const safeResultDir = resolveSafeResultDir(resultDir);

      if (safeResultDir) {
        const vtuPath = path.join(safeResultDir, "result.vtu");
        hasVtu = fs.existsSync(vtuPath);

        const scalarsPath = path.join(safeResultDir, "scalars.json");
        if (fs.existsSync(scalarsPath)) {
          hasScalars = true;
          try {
            scalars = JSON.parse(fs.readFileSync(scalarsPath, "utf8")) as Record<string, unknown>;
          } catch {
            // Optional scalars.json unreadable or malformed
          }
        }
      }

      results.push({
        id: j.id,
        name: j.name,
        status: j.status,
        solver,
        computeProfile: j.compute_profile || "standard",
        cpuSeconds: j.cpu_seconds || 0,
        gpuSeconds: j.gpu_seconds || 0,
        costCredits: j.cost_credits || 0,
        startedAt: j.started_at,
        completedAt: j.completed_at,
        hasVtu,
        hasScalars,
        scalars,
        resultDir,
      });
    }

    return results;
  }

  createArtifactViewFromJob(
    userId: number,
    jobId: number,
    options?: { colormap?: string | undefined; title?: string | undefined; activeField?: string | undefined },
  ): { artifactId: number | string; suggestedCaption: string; viewConfig: Record<string, unknown> } {
    const job = this.getJob(jobId);
    if (!job) {
      throw new Error(`Job #${jobId} not found`);
    }
    const isTest = process.env["NODE_ENV"] === "test";
    if (job.user_id !== userId && !(isTest && job.user_id === null)) {
      throw new Error(`Forbidden: Job #${jobId} does not belong to user ${userId}`);
    }

    let resultDir: string | undefined;
    let solver = "general";
    const title = options?.title || job.name;

    try {
      if (job.metadata) {
        const meta = JSON.parse(job.metadata) as { resultDir?: string; solver?: string };
        resultDir = meta.resultDir;
        if (meta.solver) solver = meta.solver;
      }
    } catch {
      // Malformed job metadata JSON falls back to default solver
    }

    if (solver === "general") {
      if (job.name.includes("SU2")) solver = "su2";
      else if (job.name.includes("CALCULIX")) solver = "calculix";
      else if (job.name.includes("OPENFOAM")) solver = "openfoam";
      else if (job.name.toLowerCase().includes("modelica")) solver = "modelica";
    }

    let scalars: Record<string, unknown> = {};
    const safeResultDir = resolveSafeResultDir(resultDir);
    if (safeResultDir && fs.existsSync(path.join(safeResultDir, "scalars.json"))) {
      try {
        scalars = JSON.parse(fs.readFileSync(path.join(safeResultDir, "scalars.json"), "utf8")) as Record<
          string,
          unknown
        >;
      } catch {
        // Optional scalars.json unreadable or malformed
      }
    }

    let artifactType = "simulation-result";
    if (solver === "su2" || solver === "openfoam") {
      artifactType = "cfd-result";
    } else if (solver === "calculix") {
      artifactType = "fea-result";
    }

    const computeProfile = job.compute_profile || "standard";
    const costCredits = job.cost_credits || 0;
    const cpuSeconds = job.cpu_seconds || 0;

    const defaultJobThumbnail: string | undefined = undefined;

    const viewConfig: Record<string, unknown> = {
      url: `/api/v1/cae/jobs/${job.id}/results`,
      jobId: job.id,
      solver,
      profile: computeProfile,
      costCredits,
      cpuSeconds,
      peakMemoryMb: job.peak_memory_mb || 0,
      colormap: options?.colormap || "turbo",
      activeField: options?.activeField,
      scalars,
      title,
      thumbnailUrl: defaultJobThumbnail,
      thumbnailUrlLight: defaultJobThumbnail,
      thumbnailUrlDark: defaultJobThumbnail,
      provenance: {
        solver,
        profile: computeProfile,
        costCredits,
        cpuSeconds,
        completedAt: job.completed_at || job.started_at,
        jobId: job.id,
      },
    };

    const artifactId = this.facade.createArtifactView(
      userId,
      artifactType,
      "hpc_job",
      JSON.stringify(viewConfig),
      title,
      defaultJobThumbnail,
    );

    // Auto-generate technical caption using only verified scalar outputs
    let suggestedCaption = "";
    if (solver === "calculix") {
      const maxStress = scalars["maxStressMpa"] ?? scalars["max_stress"];
      const stressNote =
        maxStress !== undefined && maxStress !== null
          ? ` Peak von Mises stress: ${maxStress} MPa under design load.`
          : "";
      suggestedCaption = `Completed structural FEA simulation on ${computeProfile} node (${cpuSeconds.toFixed(1)}s).${stressNote} Billed: ${costCredits.toFixed(2)} cr. #FEA #CalculiX #HPC`;
    } else if (solver === "su2") {
      const cd = scalars["cd"] ?? scalars["drag_coefficient"];
      const cl = scalars["cl"] ?? scalars["lift_coefficient"];
      const aeroNote = cd !== undefined && cl !== undefined ? ` Drag Cd: ${cd}, Lift Cl: ${cl}.` : "";
      suggestedCaption = `Completed aerodynamic CFD simulation on ${computeProfile} node (${cpuSeconds.toFixed(1)}s).${aeroNote} Billed: ${costCredits.toFixed(2)} cr. #CFD #SU2 #Aerodynamics`;
    } else if (solver === "openfoam") {
      suggestedCaption = `Completed OpenFOAM fluid dynamics analysis on ${computeProfile} cluster (${cpuSeconds.toFixed(1)}s). Billed: ${costCredits.toFixed(2)} cr. #OpenFOAM #CFD`;
    } else {
      suggestedCaption = `Completed ${title} on ${computeProfile} node (${cpuSeconds.toFixed(1)}s). Total compute: ${costCredits.toFixed(2)} credits. #HPC #Simulation`;
    }

    return { artifactId, suggestedCaption, viewConfig };
  }

  getJobs(limit = 50, offset = 0, userId?: number | null): JobRow[] {
    if (userId !== undefined && userId !== null) {
      return this.db
        .prepare(`SELECT * FROM jobs WHERE user_id = ? ORDER BY started_at DESC LIMIT ? OFFSET ?`)
        .all(userId, limit, offset) as JobRow[];
    }
    return this.db
      .prepare(`SELECT * FROM jobs ORDER BY started_at DESC LIMIT ? OFFSET ?`)
      .all(limit, offset) as JobRow[];
  }

  createJobStep(jobId: number, name: string, status: string): number {
    const result = this.db
      .prepare(`INSERT INTO job_steps (job_id, name, status) VALUES (?, ?, ?)`)
      .run(jobId, name, status);
    return result.lastInsertRowid as number;
  }

  updateJobStepStatus(stepId: number, status: string): void {
    if (status === "SUCCESS" || status === "FAILED" || status === "CANCELLED") {
      this.db
        .prepare(`UPDATE job_steps SET status = ?, completed_at = datetime('now') WHERE id = ?`)
        .run(status, stepId);
    } else {
      this.db.prepare(`UPDATE job_steps SET status = ? WHERE id = ?`).run(status, stepId);
    }
  }

  getJobSteps(jobId: number): JobStepRow[] {
    return this.db.prepare(`SELECT * FROM job_steps WHERE job_id = ? ORDER BY id ASC`).all(jobId) as JobStepRow[];
  }
}
