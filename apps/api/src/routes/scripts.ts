// SPDX-License-Identifier: AGPL-3.0-or-later

import express from "express";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { LibraryDatabase } from "../database.js";
import { optionalAuth, requireAuth, type AuthUser } from "../middleware/auth-middleware.js";
import { checkComputeQuota } from "../services/hpc/quota-guard.js";
import { enforceExportCompliance } from "../util/compliance.js";
import { getActiveCloudJob } from "./cloud.js";

export function scriptsRouter(db: LibraryDatabase) {
  const router = express.Router();

  // ── Script Templates ─────────────────────────────────────────────
  router.get("/templates", (req, res) => {
    try {
      const templates = db.getScriptTemplates();
      res.json({ templates });
    } catch (error) {
      console.error("Error fetching templates:", error);
      res.status(500).json({ error: "Failed to fetch templates" });
    }
  });

  router.get("/templates/:id", (req, res) => {
    try {
      const id = parseInt(req.params.id as string);
      const template = db.getScriptTemplate(id);
      if (!template) return res.status(404).json({ error: "Template not found" });
      res.json({ template });
    } catch (error) {
      console.error("Error fetching template:", error);
      res.status(500).json({ error: "Failed to fetch template" });
    }
  });

  router.post(
    "/templates/:id/run",
    requireAuth,
    enforceExportCompliance(() => db),
    (req, res) => {
      try {
        const id = parseInt(req.params.id as string);
        const template = db.getScriptTemplate(id);
        if (!template) return res.status(404).json({ error: "Template not found" });

        const reqUser = (req as any).user as AuthUser | undefined;
        const userId = reqUser?.id;
        if (!userId) {
          return res.status(401).json({ error: "Authentication required" });
        }

        const quota = checkComputeQuota(userId, "standard", db, 0.05);
        if (!quota.allowed) {
          return res.status(402).json({ error: quota.reason });
        }

        const resultDir = fs.mkdtempSync(path.join(os.tmpdir(), "job-"));
        const logPath = path.join(resultDir, "output.log");
        fs.writeFileSync(logPath, `Starting job for template ${template.name}...\n`);

        const jobId = db.createJob(
          template.name,
          "RUNNING",
          "TEMPLATE_RUN",
          "api",
          null,
          { templateSlug: template.slug, templateId: id, resultDir },
          userId,
        );

        const holdRes = db.holdUserCredits(userId, 0.05, jobId, `Template Run Escrow: ${template.name}`, {
          templateSlug: template.slug,
          templateId: id,
        });
        if (!holdRes.success) {
          db.updateJobStatus(jobId, "FAILED");
          return res.status(402).json({ error: holdRes.reason });
        }

        const step1 = db.createJobStep(jobId, "Initializing Environment", "RUNNING");

        // Simulate a background job
        setTimeout(() => {
          const currentJob1 = db.getJob(jobId);
          if (currentJob1?.status === "CANCELLED") return;

          db.updateJobStepStatus(step1, "SUCCESS");
          fs.appendFileSync(logPath, "Environment initialized successfully.\n");
          const step2 = db.createJobStep(jobId, "Executing Script", "RUNNING");
          fs.appendFileSync(logPath, "Executing main script...\n");

          setTimeout(() => {
            const currentJob2 = db.getJob(jobId);
            if (currentJob2?.status === "CANCELLED") return;

            db.updateJobStepStatus(step2, "SUCCESS");
            fs.appendFileSync(logPath, "Script execution completed.\n");
            db.updateJobStatus(jobId, "SUCCESS");
            db.settleUserEscrow(userId, jobId, 0.05, `Template Run: ${template.name}`);
            fs.appendFileSync(logPath, "Job finished successfully.\n");
          }, 2000);
        }, 2000);

        res.json({ jobId });
      } catch (error) {
        console.error("Error running template:", error);
        res.status(500).json({ error: "Failed to run template" });
      }
    },
  );

  // ── Job Instances ────────────────────────────────────────────────
  router.get("/", optionalAuth, (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 50;
      const offset = parseInt(req.query.offset as string) || 0;
      const reqUser = (req as any).user as AuthUser | undefined;
      const isAdmin = reqUser?.role === "admin" || reqUser?.accountType === "admin";
      const userId = isAdmin ? null : (reqUser?.id ?? null);
      const jobs = db.getJobs(limit, offset, userId);
      res.json({ jobs });
    } catch (error) {
      console.error("Error fetching jobs:", error);
      res.status(500).json({ error: "Failed to fetch jobs" });
    }
  });

  router.post("/:id/cancel", requireAuth, (req, res) => {
    try {
      const paramId = req.params.id as string;
      const job = db.getJob(paramId);
      const reqUser = (req as any).user as AuthUser | undefined;
      const isAdmin = reqUser?.role === "admin" || reqUser?.accountType === "admin";

      if (job) {
        if (!isAdmin && job.user_id && job.user_id !== reqUser?.id) {
          return res.status(403).json({ error: "Not authorized to cancel this job" });
        }
        db.updateJobStatus(job.id, "CANCELLED");
        if (job.user_id) {
          db.releaseUserEscrow(job.user_id, job.id, "User requested cancellation");
        }
        try {
          if (job.metadata) {
            const meta = JSON.parse(job.metadata);
            if (meta.jobId) {
              const cJob = getActiveCloudJob(meta.jobId);
              if (cJob) {
                cJob.status = "cancelled";
                cJob.logs.push("[Cloud] Job cancelled via job manager.");
                for (const sub of cJob.subscribers) sub({ type: "status", data: { status: "cancelled" } });
              }
            }
          }
        } catch {}

        return res.json({ success: true, message: `Job ${job.id} cancelled` });
      }

      const cloudJob = getActiveCloudJob(paramId);
      if (cloudJob) {
        if (!isAdmin && cloudJob.userId && cloudJob.userId !== reqUser?.id) {
          return res.status(403).json({ error: "Not authorized to cancel this job" });
        }
        cloudJob.status = "cancelled";
        cloudJob.logs.push("[Cloud] Job cancelled via job manager.");
        for (const sub of cloudJob.subscribers) sub({ type: "status", data: { status: "cancelled" } });
        if (cloudJob.dbJobId) {
          db.updateJobStatus(cloudJob.dbJobId, "CANCELLED");
          if (cloudJob.userId) db.releaseUserEscrow(cloudJob.userId, cloudJob.dbJobId, "User requested cancellation");
        }
        return res.json({ success: true, message: `Job ${cloudJob.jobId} cancelled` });
      }

      return res.status(404).json({ error: "Job not found" });
    } catch (error) {
      console.error("Error cancelling job:", error);
      res.status(500).json({ error: "Failed to cancel job" });
    }
  });

  router.get("/:id", (req, res) => {
    try {
      const paramId = req.params.id as string;
      const job = db.getJob(paramId);
      if (job) {
        const steps = db.getJobSteps(job.id);
        return res.json({ job, steps });
      }

      const cloudJob = getActiveCloudJob(paramId);
      if (cloudJob) {
        return res.json({
          job: {
            id: cloudJob.jobId,
            name: cloudJob.name,
            status: cloudJob.status.toUpperCase(),
            type: cloudJob.domain.toUpperCase(),
            started_at: new Date(cloudJob.startTime).toISOString(),
            completed_at: cloudJob.endTime ? new Date(cloudJob.endTime).toISOString() : null,
            metadata: JSON.stringify({ profile: cloudJob.profile, domain: cloudJob.domain }),
          },
          steps: [],
        });
      }

      res.status(404).json({ error: "Job not found" });
    } catch (error) {
      console.error("Error fetching job details:", error);
      res.status(500).json({ error: "Failed to fetch job details" });
    }
  });

  router.get("/:id/logs", requireAuth, (req, res) => {
    try {
      const paramId = req.params.id as string;
      const job = db.getJob(paramId);

      const cloudJob = getActiveCloudJob(paramId);
      if (cloudJob && cloudJob.logs?.length) {
        return res.send(cloudJob.logs.join("\n"));
      }

      if (!job) return res.status(404).json({ error: "Logs not found" });

      if (job.metadata) {
        try {
          const metadata = JSON.parse(job.metadata);
          if (metadata.jobId) {
            const cJob = getActiveCloudJob(metadata.jobId);
            if (cJob && cJob.logs?.length) {
              return res.send(cJob.logs.join("\n"));
            }
          }
          if (metadata.resultDir) {
            const candidates = [
              path.join(metadata.resultDir, "output.log"),
              path.join(metadata.resultDir, "simulate.log"),
              path.join(metadata.resultDir, "run.log"),
            ];
            for (const logPath of candidates) {
              if (fs.existsSync(logPath)) {
                return res.sendFile(logPath);
              }
            }
          }
        } catch {}
      }

      return res.send(
        `[Job ${job.id}] Status: ${job.status}\nName: ${job.name}\nType: ${job.type}\nStarted: ${job.started_at || "N/A"}\nCompleted: ${job.completed_at || "N/A"}`,
      );
    } catch (error) {
      console.error("Error fetching logs:", error);
      res.status(500).json({ error: "Failed to fetch logs" });
    }
  });

  router.get("/:id/stream", requireAuth, (req, res) => {
    try {
      const paramId = req.params.id as string;
      const job = db.getJob(paramId);
      const cloudJob = !job ? getActiveCloudJob(paramId) : undefined;

      if (!job && !cloudJob) {
        return res.status(404).end();
      }

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      if (cloudJob) {
        res.write(
          `event: status\ndata: ${JSON.stringify({
            job: {
              id: cloudJob.jobId,
              name: cloudJob.name,
              status: cloudJob.status.toUpperCase(),
              type: cloudJob.domain.toUpperCase(),
            },
            steps: [],
          })}\n\n`,
        );

        for (const line of cloudJob.logs) {
          res.write(`event: log\ndata: ${JSON.stringify(line + "\n")}\n\n`);
        }

        const listener = (event: { type: string; data: unknown }) => {
          if (event.type === "log") {
            res.write(`event: log\ndata: ${JSON.stringify(String(event.data) + "\n")}\n\n`);
          } else if (event.type === "status") {
            const st = (event.data as any)?.status || cloudJob.status;
            res.write(
              `event: status\ndata: ${JSON.stringify({
                job: {
                  id: cloudJob.jobId,
                  name: cloudJob.name,
                  status: String(st).toUpperCase(),
                },
                steps: [],
              })}\n\n`,
            );
            if (st === "completed" || st === "failed" || st === "cancelled") {
              res.write(`event: complete\ndata: ${String(st).toUpperCase()}\n\n`);
              res.end();
            }
          }
        };

        cloudJob.subscribers.push(listener);
        req.on("close", () => {
          const idx = cloudJob.subscribers.indexOf(listener);
          if (idx !== -1) cloudJob.subscribers.splice(idx, 1);
        });
        return;
      }

      const jobId = job!.id;
      const sendStatusUpdate = () => {
        const updatedJob = db.getJob(jobId);
        const steps = db.getJobSteps(jobId);
        res.write(`event: status\ndata: ${JSON.stringify({ job: updatedJob, steps })}\n\n`);
      };

      sendStatusUpdate();

      let resultDir: string | undefined;
      try {
        if (job!.metadata) {
          const meta = JSON.parse(job!.metadata);
          resultDir = meta.resultDir;
        }
      } catch {}

      let logPath = resultDir ? path.join(resultDir, "output.log") : undefined;
      if (resultDir && (!logPath || !fs.existsSync(logPath))) {
        const altSimLog = path.join(resultDir, "simulate.log");
        if (fs.existsSync(altSimLog)) logPath = altSimLog;
      }

      let bytesRead = 0;
      const sendNewLogs = () => {
        if (!logPath || !fs.existsSync(logPath)) return;
        const stats = fs.statSync(logPath);
        if (stats.size > bytesRead) {
          const stream = fs.createReadStream(logPath, { start: bytesRead, end: stats.size - 1 });
          stream.on("data", (chunk) => {
            res.write(`event: log\ndata: ${JSON.stringify(chunk.toString())}\n\n`);
          });
          bytesRead = stats.size;
        }
      };

      sendNewLogs();

      const intervalId = setInterval(() => {
        sendNewLogs();
        sendStatusUpdate();

        const currentJob = db.getJob(jobId);
        if (
          currentJob &&
          (currentJob.status === "SUCCESS" || currentJob.status === "FAILED" || currentJob.status === "CANCELLED")
        ) {
          clearInterval(intervalId);
          res.write(`event: complete\ndata: ${currentJob.status}\n\n`);
          res.end();
        }
      }, 1000);

      req.on("close", () => {
        clearInterval(intervalId);
      });
    } catch (error) {
      console.error("Error in stream:", error);
      res.status(500).end();
    }
  });

  router.get("/:id/result", optionalAuth, (req, res) => {
    try {
      const paramId = req.params.id as string;
      const job = db.getJob(paramId);

      // Check active cloud job
      const cloudJob = getActiveCloudJob(paramId);
      if (cloudJob?.resultPath && fs.existsSync(cloudJob.resultPath)) {
        const ext = path.extname(cloudJob.resultPath).toLowerCase();
        if (ext === ".csv") {
          res.setHeader("Content-Type", "text/csv");
          res.setHeader("Content-Disposition", `attachment; filename="${cloudJob.name}_res.csv"`);
        } else {
          res.setHeader("Content-Type", "application/octet-stream");
          res.setHeader("Content-Disposition", `attachment; filename="${cloudJob.name}_result${ext}"`);
        }
        return fs.createReadStream(cloudJob.resultPath).pipe(res);
      }

      if (job?.metadata) {
        try {
          const metadata = JSON.parse(job.metadata);
          if (metadata.jobId) {
            const cJob = getActiveCloudJob(metadata.jobId);
            if (cJob?.resultPath && fs.existsSync(cJob.resultPath)) {
              return fs.createReadStream(cJob.resultPath).pipe(res);
            }
          }
          if (metadata.resultDir) {
            const candidates = [
              path.join(metadata.resultDir, "results.vtu"),
              path.join(metadata.resultDir, "results.csv"),
              path.join(metadata.resultDir, "output.csv"),
            ];
            for (const cand of candidates) {
              if (fs.existsSync(cand)) {
                const ext = path.extname(cand).toLowerCase();
                res.setHeader("Content-Disposition", `attachment; filename="job_${job.id}_result${ext}"`);
                return fs.createReadStream(cand).pipe(res);
              }
            }
          }
        } catch {}
      }

      res.status(404).json({ error: "Results not available for this job" });
    } catch (error) {
      console.error("Error streaming job result:", error);
      res.status(500).json({ error: "Failed to download result" });
    }
  });

  return router;
}
