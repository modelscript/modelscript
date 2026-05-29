import express from "express";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { LibraryDatabase } from "../database.js";
import { requireAuth } from "../middleware/auth-middleware.js";

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

  router.post("/templates/:id/run", requireAuth, (req, res) => {
    try {
      const id = parseInt(req.params.id as string);
      const template = db.getScriptTemplate(id);
      if (!template) return res.status(404).json({ error: "Template not found" });

      const resultDir = fs.mkdtempSync(path.join(os.tmpdir(), "job-"));
      const logPath = path.join(resultDir, "output.log");
      fs.writeFileSync(logPath, `Starting job for template ${template.name}...\\n`);

      const jobId = db.createJob(
        template.name,
        "RUNNING",
        "TEMPLATE_RUN",
        "api",
        null,
        JSON.stringify({ templateSlug: template.slug, templateId: id, resultDir }),
      );

      const step1 = db.createJobStep(jobId, "Initializing Environment", "RUNNING");

      // Simulate a background job
      setTimeout(() => {
        db.updateJobStepStatus(step1, "SUCCESS");
        fs.appendFileSync(logPath, "Environment initialized successfully.\\n");
        const step2 = db.createJobStep(jobId, "Executing Script", "RUNNING");
        fs.appendFileSync(logPath, "Executing main script...\\n");

        setTimeout(() => {
          db.updateJobStepStatus(step2, "SUCCESS");
          fs.appendFileSync(logPath, "Script execution completed.\\n");
          db.updateJobStatus(jobId, "SUCCESS");
          fs.appendFileSync(logPath, "Job finished successfully.\\n");
        }, 2000);
      }, 2000);

      res.json({ jobId });
    } catch (error) {
      console.error("Error running template:", error);
      res.status(500).json({ error: "Failed to run template" });
    }
  });

  // ── Job Instances ────────────────────────────────────────────────
  router.get("/", (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 50;
      const offset = parseInt(req.query.offset as string) || 0;
      const jobs = db.getJobs(limit, offset);
      res.json({ jobs });
    } catch (error) {
      console.error("Error fetching jobs:", error);
      res.status(500).json({ error: "Failed to fetch jobs" });
    }
  });

  router.get("/:id", (req, res) => {
    try {
      const jobId = parseInt(req.params.id as string);
      const job = db.getJob(jobId);
      if (!job) {
        return res.status(404).json({ error: "Job not found" });
      }
      const steps = db.getJobSteps(jobId);
      res.json({ job, steps });
    } catch (error) {
      console.error("Error fetching job details:", error);
      res.status(500).json({ error: "Failed to fetch job details" });
    }
  });

  router.get("/:id/logs", requireAuth, (req, res) => {
    try {
      const jobId = parseInt(req.params.id as string);
      const job = db.getJob(jobId);
      if (!job || !job.metadata) return res.status(404).json({ error: "Logs not found" });

      const metadata = JSON.parse(job.metadata);
      if (!metadata.resultDir) return res.status(404).json({ error: "Log path not found" });

      const logPath = path.join(metadata.resultDir, "output.log");
      if (!fs.existsSync(logPath)) return res.status(404).json({ error: "Log file not created yet" });

      res.sendFile(logPath);
    } catch (error) {
      console.error("Error fetching logs:", error);
      res.status(500).json({ error: "Failed to fetch logs" });
    }
  });

  router.get("/:id/stream", requireAuth, (req, res) => {
    try {
      const jobId = parseInt(req.params.id as string);
      const job = db.getJob(jobId);
      if (!job || !job.metadata) return res.status(404).end();

      const metadata = JSON.parse(job.metadata);
      if (!metadata.resultDir) return res.status(404).end();

      const logPath = path.join(metadata.resultDir, "output.log");

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      const sendStatusUpdate = () => {
        const updatedJob = db.getJob(jobId);
        const steps = db.getJobSteps(jobId);
        res.write(`event: status\ndata: ${JSON.stringify({ job: updatedJob, steps })}\n\n`);
      };

      sendStatusUpdate();

      let bytesRead = 0;
      const sendNewLogs = () => {
        if (!fs.existsSync(logPath)) return;
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

  return router;
}
