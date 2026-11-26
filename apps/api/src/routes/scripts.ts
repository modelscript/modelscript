// SPDX-License-Identifier: AGPL-3.0-or-later

import express, { type Router } from "express";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { LibraryDatabase } from "../database.js";
import { optionalAuth, requireAuth } from "../middleware/auth-middleware.js";
import { simulateRateLimiter } from "../middleware/rate-limiter.js";
import {
  assertComputeJobAccess,
  holdComputeEscrow,
  isComputeJobAuthorized,
  resolveComputeActor,
  runComputePreflight,
} from "../services/compute-job-lifecycle.js";
import { checkComputeQuota } from "../services/hpc/quota-guard.js";
import { BUILTIN_STUDY_DEFINITIONS, CURATED_COMPATIBLE_MODELS } from "../services/studies/study-catalog.js";
import {
  computeStudyResultsPayload,
  executeStudyRun,
  findCompatibleModels,
  getLinkedPackageStudies,
  inspectModelicaSourceParameters,
  listStudyTemplates,
  previewStudyInstance,
  resolveStudyTemplate,
} from "../services/studies/study-execution-service.js";
import {
  inferStudyStandard,
  parseStandardStudyDocument,
  standardExtension,
  synthesizeStudyInstanceArtifact,
} from "../services/studies/study-standards.js";
import type {
  StudyCategory,
  StudyDomain,
  StudyExecutionTarget,
  StudyInstanceArtifact,
  StudyKind,
  StudyParameterBinding,
  StudyRunRequest,
  StudyRunResultsPayload,
  StudyStandardFormat,
} from "../services/studies/study-types.js";
import { enforceExportCompliance } from "../util/compliance.js";
import { checkComputeSandboxing } from "../util/compute-sandboxing.js";
import { cancelActiveCloudJob, enqueueRetriedCloudJob, getActiveCloudJob, type CloudJobRecord } from "./cloud.js";

const MAX_SSE_SUBSCRIBERS_PER_JOB = 20;

function sanitizeDispositionName(value: string): string {
  return String(value || "job").replace(/[^a-zA-Z0-9_.-]/g, "_") || "job";
}

export function scriptsRouter(db: LibraryDatabase): Router {
  const router = express.Router();

  // ── 1. Study & Script Templates Gallery (SharePoint-Style Faceted Search) ──
  router.get("/templates", (req, res) => {
    try {
      const filters = {
        q: typeof req.query["q"] === "string" ? req.query["q"] : undefined,
        sourceType: typeof req.query["sourceType"] === "string" ? req.query["sourceType"] : undefined,
        standardFormat: typeof req.query["standardFormat"] === "string" ? req.query["standardFormat"] : undefined,
        kind: typeof req.query["kind"] === "string" ? req.query["kind"] : undefined,
        category: typeof req.query["category"] === "string" ? req.query["category"] : undefined,
        domain: typeof req.query["domain"] === "string" ? req.query["domain"] : undefined,
        target: typeof req.query["target"] === "string" ? req.query["target"] : undefined,
      };

      const { templates: studyDefs, facets } = listStudyTemplates(db, filters);
      const templates = studyDefs.map((sd, idx) => ({
        id: sd.dbId ?? idx + 1,
        name: sd.name,
        slug: sd.slug,
        description: sd.description,
        category: sd.category,
        icon: sd.icon,
        config: JSON.stringify(sd),
        studyDefinition: sd,
      }));

      res.json({
        templates,
        studyDefinitions: studyDefs,
        facets,
      });
    } catch (error) {
      console.error("Error fetching study templates:", error);
      res.status(500).json({ error: "Failed to fetch templates" });
    }
  });

  // ── 2. Author / Publish / Fork a Custom Study Template (.sedml, .ssv, .dakota) ──
  router.post("/templates", optionalAuth, express.json(), (req, res) => {
    try {
      const reqUser = req.user;
      const { isAdmin } = resolveComputeActor(req);
      if (process.env["NODE_ENV"] === "production" && !reqUser) {
        return res.status(401).json({ error: "Authentication required to publish study templates." });
      }
      const body = (req.body || {}) as Record<string, unknown>;

      // Optional raw standard document (.sedml, .ssv, .dakota) import
      const rawStandardContent =
        typeof body["rawStandardContent"] === "string" ? body["rawStandardContent"].trim() : "";
      const parsedFromStandard: Partial<ReturnType<typeof parseStandardStudyDocument>> = rawStandardContent
        ? parseStandardStudyDocument(
            rawStandardContent,
            String(
              body["filename"] ||
                `study.${body["standardFormat"] === "ssp-ssv" ? "ssv" : body["standardFormat"] === "dakota" ? "dakota" : "sedml"}`,
            ),
          )
        : {};

      const name = String(body["name"] || parsedFromStandard.name || "").trim();
      if (!name) {
        return res.status(400).json({ error: "Study template 'name' is required." });
      }

      const rawSlug = String(body["slug"] || parsedFromStandard.slug || name)
        .toLowerCase()
        .replace(/[^a-z0-9-_]/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "");
      const slug = rawSlug || `custom-study-${Date.now()}`;
      if (!isAdmin && BUILTIN_STUDY_DEFINITIONS.some((b) => b.slug === slug)) {
        return res.status(403).json({
          error: `Cannot overwrite built-in standard study template '${slug}'. Please choose a distinct slug.`,
        });
      }
      const description = String(
        body["description"] || parsedFromStandard.description || `Custom engineering study template: ${name}`,
      );
      const kind = String(body["kind"] || parsedFromStandard.kind || "time-course");
      const category = String(body["category"] || parsedFromStandard.category || "simulation");
      const icon = String(body["icon"] || "sliders");
      const packageName = body["packageName"] ? String(body["packageName"]) : null;
      const packageVersion = body["packageVersion"] ? String(body["packageVersion"]) : "1.0.0";
      const sourceType = packageName ? "package" : "community";
      const authorUsername = reqUser?.username || String(body["authorUsername"] || "community-engineer");

      const baseTemplate = BUILTIN_STUDY_DEFINITIONS.find((b) => b.kind === kind) || BUILTIN_STUDY_DEFINITIONS[0]!;

      const stdFormat: StudyStandardFormat =
        (body["standardFormat"] as StudyStandardFormat) ||
        parsedFromStandard.standardFormat ||
        inferStudyStandard({ kind: kind as StudyKind, category: category as StudyCategory });
      const ext = standardExtension(stdFormat);

      const customStudyConfig: Record<string, unknown> = {
        ...baseTemplate,
        ...parsedFromStandard,
        schemaVersion: "1.0.0",
        standardFormat: stdFormat,
        id: `custom.studies.${slug}`,
        slug,
        name,
        version: packageVersion || "1.0.0",
        kind,
        category,
        sourceType,
        packageName,
        packageVersion: packageName ? packageVersion : null,
        targetModel: body["targetModel"] ? String(body["targetModel"]) : null,
        targetArtifact: body["targetArtifact"] ? String(body["targetArtifact"]) : null,
        bundledInRelease: false,
        artifactPath: `studies/${slug}${ext}`,
        authorUsername,
        icon,
        description,
        tags: Array.isArray(body["tags"]) ? body["tags"] : [kind, category, stdFormat, "custom"],
        featured: false,
        starsCount: 1,
        runsCount: 0,
        modelContract: body["modelContract"] || parsedFromStandard.modelContract || baseTemplate.modelContract,
        inputs:
          Array.isArray(body["inputs"]) && body["inputs"].length > 0
            ? body["inputs"]
            : parsedFromStandard.inputs && parsedFromStandard.inputs.length > 0
              ? parsedFromStandard.inputs
              : baseTemplate.inputs,
        presets: Array.isArray(body["presets"]) && body["presets"].length > 0 ? body["presets"] : baseTemplate.presets,
        execution: body["execution"] || parsedFromStandard.execution || baseTemplate.execution,
        outputs: body["outputs"] || parsedFromStandard.outputs || baseTemplate.outputs,
      };

      const id = db.createScriptTemplate(name, slug, description, category, icon, customStudyConfig);
      const resolved = resolveStudyTemplate(db, slug);

      return res.status(201).json({
        id,
        slug,
        template: {
          id,
          name,
          slug,
          description,
          category,
          icon,
          config: JSON.stringify(customStudyConfig),
          studyDefinition: resolved,
        },
        studyDefinition: resolved,
      });
    } catch (error) {
      console.error("Error creating custom study template:", error);
      return res.status(500).json({ error: "Failed to create study template" });
    }
  });

  // ── 2b. Linked Studies, Study Templates, Study Instances & Jobs for a Package or Artifact ──
  router.get("/linked", optionalAuth, (req, res) => {
    try {
      const packageName =
        typeof req.query["package"] === "string"
          ? req.query["package"]
          : typeof req.query["packageName"] === "string"
            ? req.query["packageName"]
            : undefined;
      const packageVersion = typeof req.query["version"] === "string" ? req.query["version"] : undefined;
      const targetArtifact = typeof req.query["artifact"] === "string" ? req.query["artifact"] : undefined;
      const targetModel = typeof req.query["model"] === "string" ? req.query["model"] : undefined;
      const domain = typeof req.query["domain"] === "string" ? req.query["domain"] : undefined;

      const actor = resolveComputeActor(req);
      const linked = getLinkedPackageStudies(db, {
        packageName,
        packageVersion,
        targetArtifact,
        targetModel,
        domain,
        userId: actor.userId,
        isAdmin: actor.isAdmin,
      });

      return res.json(linked);
    } catch (error) {
      console.error("Error fetching linked package/artifact studies:", error);
      return res.status(500).json({ error: "Failed to fetch linked studies" });
    }
  });

  // ── 3. Cross-Package Compatible Model Discovery ──
  router.get("/compatible-models", (req, res) => {
    try {
      const models = findCompatibleModels(db, {
        templateSlug: typeof req.query["templateSlug"] === "string" ? req.query["templateSlug"] : undefined,
        domain: typeof req.query["domain"] === "string" ? req.query["domain"] : undefined,
        q: typeof req.query["q"] === "string" ? req.query["q"] : undefined,
        limit: req.query["limit"] ? Math.min(200, Math.max(1, parseInt(String(req.query["limit"]), 10) || 30)) : 30,
      });
      res.json({ models });
    } catch (error) {
      console.error("Error searching compatible models:", error);
      res.status(500).json({ error: "Failed to search compatible models" });
    }
  });

  // ── 4. Live Model Source Parameter & Observable Inspector ──
  router.post("/inspect-model", express.json(), (req, res) => {
    try {
      const code = String(req.body?.code || "");
      if (!code.trim()) {
        return res.status(400).json({ error: "Missing 'code' string to inspect." });
      }
      const inspected = inspectModelicaSourceParameters(code);
      return res.json(inspected);
    } catch (error) {
      console.error("Error inspecting model source:", error);
      return res.status(500).json({ error: "Failed to inspect model parameters" });
    }
  });

  // ── 5. Single Study Template Detail (by numeric ID or slug) ──
  router.get("/templates/:id", (req, res) => {
    try {
      const idOrSlug = req.params["id"] as string;
      // Preserve strict 404 check for non-existent numeric IDs (e.g. 99999 in tests)
      const numericId = parseInt(idOrSlug, 10);
      if (!Number.isNaN(numericId) && String(numericId) === idOrSlug) {
        const dbRow = db.getScriptTemplate(numericId);
        if (!dbRow) {
          return res.status(404).json({ error: "Template not found" });
        }
      }

      const studyDef = resolveStudyTemplate(db, idOrSlug);
      if (!studyDef) {
        return res.status(404).json({ error: "Template not found" });
      }

      const compatibleModels = findCompatibleModels(db, { templateSlug: studyDef.slug, limit: 25 });
      const template = {
        id: studyDef.dbId ?? 1,
        name: studyDef.name,
        slug: studyDef.slug,
        description: studyDef.description,
        category: studyDef.category,
        icon: studyDef.icon,
        config: JSON.stringify(studyDef),
        studyDefinition: studyDef,
      };

      res.json({
        template,
        studyDefinition: studyDef,
        compatibleModels,
      });
    } catch (error) {
      console.error("Error fetching template:", error);
      res.status(500).json({ error: "Failed to fetch template" });
    }
    return;
  });

  // ── 5b. Live Study Instance Artifact Synthesis (.sedml, .ssv, .dakota) ──
  const handleSynthesizeStudyInstance = (req: express.Request, res: express.Response) => {
    try {
      const idOrSlug = (req.params["id"] as string) || req.body?.templateIdOrSlug || req.body?.templateSlug;
      if (!idOrSlug) {
        return res.status(400).json({ error: "Missing study template identifier." });
      }
      const studyDef = resolveStudyTemplate(db, idOrSlug);
      if (!studyDef) {
        return res.status(404).json({ error: "Template not found" });
      }

      const rawBindings = req.body?.parameterBindings;
      const rawOverrides = req.body?.parameterOverrides as Record<string, number> | undefined;
      const parameterBindings = Array.isArray(rawBindings)
        ? rawBindings
        : rawOverrides && typeof rawOverrides === "object"
          ? Object.entries(rawOverrides).map(([parameterName, nominalValue]) => ({
              parameterName,
              nominalValue: Number(nominalValue),
            }))
          : undefined;

      const studyReq: StudyRunRequest = {
        templateIdOrSlug: studyDef.slug,
        standardFormat: req.body?.standardFormat,
        modelId: req.body?.modelId,
        modelName: req.body?.modelName,
        modelDomain: req.body?.modelDomain || req.body?.dialect,
        modelCode: req.body?.modelCode || req.body?.code,
        packageName: req.body?.packageName,
        packageVersion: req.body?.packageVersion,
        executionTarget: req.body?.executionTarget,
        computeProfile: req.body?.computeProfile,
        inputs: req.body?.inputs || req.body?.studyInputs || req.body?.config,
        parameterBindings,
        observables: req.body?.observables,
        saveInstanceToPackage: req.body?.saveInstanceToPackage ?? req.body?.linkToPackage,
        linkToPackage: req.body?.linkToPackage ?? req.body?.saveInstanceToPackage,
        targetArtifact: req.body?.targetArtifact,
      };

      const synthesized = previewStudyInstance(db, studyReq);
      return res.json(synthesized);
    } catch (error) {
      console.error("Error synthesizing study instance artifact:", error);
      return res.status(500).json({ error: "Failed to synthesize study instance artifact" });
    }
  };

  router.post("/synthesize", optionalAuth, express.json(), handleSynthesizeStudyInstance);
  router.post("/templates/:id/synthesize", optionalAuth, express.json(), handleSynthesizeStudyInstance);

  // ── 6. Execute a Study Run against a Model (via /templates/:id/run or /runs) ──
  const handleRunStudy = (req: express.Request, res: express.Response) => {
    try {
      const idOrSlug = (req.params["id"] as string) || req.body?.templateIdOrSlug || req.body?.templateSlug;
      if (!idOrSlug) {
        return res.status(400).json({ error: "Missing study template identifier." });
      }

      const numericId = parseInt(String(idOrSlug), 10);
      if (!Number.isNaN(numericId) && String(numericId) === String(idOrSlug)) {
        const dbRow = db.getScriptTemplate(numericId);
        if (!dbRow) {
          return res.status(404).json({ error: "Template not found" });
        }
      }

      const studyDef = resolveStudyTemplate(db, idOrSlug);
      if (!studyDef) {
        return res.status(404).json({ error: "Template not found" });
      }

      const { userId } = resolveComputeActor(req);
      if (process.env["NODE_ENV"] === "production" && !userId) {
        return res.status(401).json({ error: "Authentication required" });
      }
      const executionTarget = req.body?.executionTarget || "local-wasm";

      if (userId && (executionTarget === "hpc-cluster" || executionTarget === "hpc-slurm")) {
        const user = db.getUserById(userId);
        const sandbox = checkComputeSandboxing(user);
        if (sandbox.sandboxed) {
          return res.status(403).json({
            error: sandbox.error,
            code: sandbox.code,
            fallbackAvailable: sandbox.fallbackAvailable,
          });
        }
        const quota = checkComputeQuota(userId, req.body?.computeProfile || "standard", db, 0.05);
        if (!quota.allowed) {
          return res.status(402).json({ error: quota.reason });
        }
      }

      const rawBindings = req.body?.parameterBindings;
      const rawOverrides = req.body?.parameterOverrides as Record<string, number> | undefined;
      const parameterBindings = Array.isArray(rawBindings)
        ? rawBindings
        : rawOverrides && typeof rawOverrides === "object"
          ? Object.entries(rawOverrides).map(([parameterName, nominalValue]) => ({
              parameterName,
              nominalValue: Number(nominalValue),
            }))
          : undefined;

      const normalizedTarget = req.body?.executionTarget === "hpc-slurm" ? "hpc-cluster" : req.body?.executionTarget;

      const studyReq: StudyRunRequest = {
        templateIdOrSlug: studyDef.slug,
        modelId: req.body?.modelId,
        modelName: req.body?.modelName,
        modelDomain: req.body?.modelDomain || req.body?.dialect,
        modelCode: req.body?.modelCode || req.body?.code,
        packageName: req.body?.packageName,
        packageVersion: req.body?.packageVersion,
        targetArtifact: req.body?.targetArtifact,
        executionTarget: normalizedTarget,
        computeProfile: req.body?.computeProfile,
        inputs: req.body?.inputs || req.body?.studyInputs || req.body?.config,
        parameterBindings,
        observables: req.body?.observables,
        studyInstanceSource: req.body?.studyInstanceSource,
        saveInstanceToPackage: req.body?.saveInstanceToPackage ?? req.body?.linkToPackage,
        linkToPackage: req.body?.linkToPackage ?? req.body?.saveInstanceToPackage,
      };

      const runOutput = executeStudyRun(db, studyReq, userId);
      return res.json({
        ...runOutput,
        studyResults: runOutput.results,
      });
    } catch (error) {
      console.error("Error executing study run:", error);
      return res.status(500).json({ error: "Failed to run study" });
    }
  };

  router.post(
    "/templates/:id/run",
    optionalAuth,
    simulateRateLimiter,
    enforceExportCompliance(() => db),
    express.json(),
    handleRunStudy,
  );

  router.post(
    "/runs",
    optionalAuth,
    simulateRateLimiter,
    enforceExportCompliance(() => db),
    express.json(),
    handleRunStudy,
  );

  // ── 7. Job / Study Run Instances ──
  router.get("/", optionalAuth, (req, res) => {
    try {
      const limit = Math.min(Math.max(1, parseInt(req.query["limit"] as string) || 50), 200);
      const offset = Math.max(0, parseInt(req.query["offset"] as string) || 0);
      const { userId: reqUserId, isAdmin } = resolveComputeActor(req);
      if (!isAdmin && !reqUserId) {
        return res.json({ jobs: [] });
      }
      const userId = isAdmin ? null : reqUserId;
      let jobs = db.getJobs(limit, offset, userId);
      // Also include public/seeded example study runs (where user_id IS NULL) if user has few jobs
      if (userId !== null && jobs.length < 5) {
        const allRecent = db.getJobs(limit, offset, null);
        const ownedOrSeeded = allRecent.filter((j) => j.user_id === userId || j.user_id === null);
        const byId = new Map(jobs.map((j) => [j.id, j]));
        for (const j of ownedOrSeeded) {
          if (!byId.has(j.id)) byId.set(j.id, j);
        }
        jobs = Array.from(byId.values()).sort((a, b) => b.id - a.id);
      }
      return res.json({ jobs });
    } catch (error) {
      console.error("Error fetching jobs:", error);
      return res.status(500).json({ error: "Failed to fetch jobs" });
    }
  });

  router.post("/:id/cancel", requireAuth, async (req, res) => {
    try {
      const paramId = req.params["id"] as string;
      const job = db.getJob(paramId);

      if (job) {
        if (
          !assertComputeJobAccess(req, res, undefined, {
            allowInTest: false,
            ownerId: job.user_id,
            allowWhenUnowned: true,
          })
        ) {
          return;
        }
        // Cancel underlying cloud / HPC / CAE job FIRST before updating DB status and releasing escrow
        try {
          if (job.metadata) {
            const meta = JSON.parse(job.metadata) as { jobId?: string | undefined };
            if (typeof meta.jobId === "string" && meta.jobId) {
              await cancelActiveCloudJob(meta.jobId, undefined, "User requested cancellation");
            }
          }
        } catch {
          // Best-effort underlying process termination
        }

        db.updateJobStatus(job.id, "CANCELLED");
        if (job.user_id) {
          db.releaseUserEscrow(job.user_id, job.id, "User requested cancellation");
        }

        return res.json({ success: true, message: `Job ${job.id} cancelled` });
      }

      const cloudJob = getActiveCloudJob(paramId);
      if (cloudJob) {
        if (
          !assertComputeJobAccess(req, res, undefined, {
            allowInTest: false,
            ownerId: cloudJob.userId,
            allowWhenUnowned: true,
          })
        ) {
          return;
        }
        await cancelActiveCloudJob(cloudJob.jobId, db, "User requested cancellation");
        return res.json({ success: true, message: `Job ${cloudJob.jobId} cancelled` });
      }

      return res.status(404).json({ error: "Job not found" });
    } catch (error) {
      console.error("Error cancelling job:", error);
      res.status(500).json({ error: "Failed to cancel job" });
    }
    return;
  });

  router.post(
    "/:id/retry",
    optionalAuth,
    simulateRateLimiter,
    enforceExportCompliance(() => db),
    (req, res) => {
      try {
        const paramId = req.params["id"] as string;
        const { userId: reqUserId } = resolveComputeActor(req);
        if (process.env["NODE_ENV"] === "production" && !reqUserId) {
          return res.status(401).json({ error: "Authentication required" });
        }

        const retryCloudRecord = (existingCloudJob: CloudJobRecord, previousIdLabel: string) => {
          if (!existingCloudJob.payload) {
            return res.status(400).json({
              error:
                "Cannot retry job: original dispatch payload is unavailable. Please submit a new dispatch request.",
            });
          }

          const preflight = runComputePreflight(req, res, db, {
            profileId: existingCloudJob.profile,
            allowAnonymous: process.env["NODE_ENV"] !== "production",
          });
          if (!preflight.allowed) {
            return;
          }
          const { userId: billingUserId, estimatedCost } = preflight;

          const newCloudJobId = `cloud-${existingCloudJob.domain}-${Date.now()}-${crypto.randomBytes(6).toString("hex")}`;
          const retried: CloudJobRecord = {
            jobId: newCloudJobId,
            domain: existingCloudJob.domain,
            name: existingCloudJob.name,
            profile: existingCloudJob.profile,
            payload: existingCloudJob.payload,
            status: "queued",
            startTime: Date.now(),
            logs: [`[Cloud] Retried from job ${previousIdLabel}`],
            subscribers: [],
            userId: billingUserId,
          };

          let dbJobId: number | null = null;
          const billingActive = Boolean(billingUserId && estimatedCost > 0);
          try {
            dbJobId = db.createJob(
              `Cloud [${existingCloudJob.domain.toUpperCase()}]: ${existingCloudJob.name} (Retry)`,
              "RUNNING",
              "ADHOC",
              existingCloudJob.domain === "modelica" ? "omc" : existingCloudJob.domain,
              null,
              {
                jobId: newCloudJobId,
                previousJobId: previousIdLabel,
                profile: existingCloudJob.profile,
                domain: existingCloudJob.domain,
              },
              billingUserId,
            );
            retried.dbJobId = dbJobId;
          } catch (err) {
            console.error("[ScriptsRouter] Failed to create DB job record for cloud retry:", err);
            if (billingActive) {
              return res.status(503).json({
                error: "Compute billing service temporarily unavailable. Please try again later.",
              });
            }
          }

          try {
            if (
              !holdComputeEscrow({
                database: db,
                res,
                userId: billingUserId,
                dbJobId,
                estimatedCost,
                description: `HPC Escrow Hold (Retry): Cloud [${existingCloudJob.domain.toUpperCase()}] ${existingCloudJob.name}`,
                metadata: {
                  jobId: newCloudJobId,
                  previousJobId: previousIdLabel,
                  profile: existingCloudJob.profile,
                  domain: existingCloudJob.domain,
                },
              })
            ) {
              return;
            }
          } catch (err) {
            console.error("[ScriptsRouter] Failed to hold compute escrow for cloud retry:", err);
            if (billingActive) {
              return res.status(503).json({
                error: "Compute billing service temporarily unavailable. Please try again later.",
              });
            }
          }

          if (!enqueueRetriedCloudJob(existingCloudJob, retried, existingCloudJob.payload)) {
            if (dbJobId) {
              db.updateJobStatus(dbJobId, "FAILED");
              if (billingUserId) {
                db.releaseUserEscrow(billingUserId, dbJobId, "Retry enqueue unavailable");
              }
            }
            return res.status(400).json({
              error: "Cannot retry job: cloud execution handler is unavailable.",
            });
          }

          return res.status(202).json({
            success: true,
            jobId: newCloudJobId,
            previousJobId: previousIdLabel,
            status: "queued",
            streamUrl: `/api/v1/cloud/jobs/${newCloudJobId}/events`,
          });
        };

        const job = db.getJob(paramId);

        if (job) {
          if (
            !assertComputeJobAccess(req, res, undefined, {
              allowInTest: false,
              ownerId: job.user_id,
              allowWhenUnowned: true,
            })
          ) {
            return;
          }
          const meta = job.metadata ? (JSON.parse(job.metadata) as Record<string, unknown>) : {};
          const linkedCloudJob = typeof meta["jobId"] === "string" ? getActiveCloudJob(meta["jobId"]) : undefined;
          if (linkedCloudJob) {
            return retryCloudRecord(linkedCloudJob, job.id.toString());
          }

          const storedInstance = meta["studyInstance"] as Record<string, unknown> | undefined;
          const studyResults = meta["studyResults"] as StudyRunResultsPayload | undefined;
          const hasStudyReplayMetadata = Boolean(
            meta["templateSlug"] || storedInstance || studyResults || meta["modelName"] || meta["modelCode"],
          );

          if (!hasStudyReplayMetadata) {
            return res.status(400).json({
              error: "Cannot retry job: replay payload is missing for this job.",
            });
          }

          const templateIdOrSlug = String(
            meta["templateSlug"] ||
              storedInstance?.["templateSlug"] ||
              studyResults?.templateSlug ||
              "modelica-sundials-dae",
          );
          const executionTarget = (meta["executionTarget"] || "local-wasm") as StudyExecutionTarget;
          const computeProfile = job.compute_profile || (meta["computeProfile"] as string) || "standard";
          const billingUserId = reqUserId ?? (process.env["NODE_ENV"] === "test" ? (job.user_id ?? null) : null);

          if (billingUserId && (executionTarget === "hpc-cluster" || (executionTarget as string) === "hpc-slurm")) {
            const user = db.getUserById(billingUserId);
            const sandbox = checkComputeSandboxing(user);
            if (sandbox.sandboxed) {
              return res.status(403).json({
                error: sandbox.error,
                code: sandbox.code,
                fallbackAvailable: sandbox.fallbackAvailable,
              });
            }
            const quota = checkComputeQuota(billingUserId, computeProfile, db, 0.05);
            if (!quota.allowed) {
              return res.status(402).json({
                error: "Payment Required",
                message: quota.reason,
                balance: quota.userBalance,
                required: quota.estimatedCost,
              });
            }
          }

          const studyReq: StudyRunRequest = {
            templateIdOrSlug,
            modelId: (meta["modelId"] as string | undefined) || (storedInstance?.["modelId"] as string | undefined),
            modelName:
              (meta["modelName"] as string | undefined) ||
              (storedInstance?.["modelName"] as string | undefined) ||
              job.name,
            modelDomain: (meta["modelDomain"] || storedInstance?.["modelDomain"]) as StudyDomain | undefined,
            modelCode: meta["modelCode"] as string | undefined,
            packageName: (meta["packageName"] || storedInstance?.["packageName"]) as string | undefined,
            packageVersion: (meta["packageVersion"] || storedInstance?.["packageVersion"]) as string | undefined,
            executionTarget,
            computeProfile,
            inputs: (meta["inputs"] || storedInstance?.["inputs"] || {}) as Record<string, string | number | boolean>,
            parameterBindings: (meta["parameterBindings"] ||
              storedInstance?.["parameterBindings"] ||
              []) as StudyParameterBinding[],
            observables: (meta["observables"] || storedInstance?.["observables"] || []) as string[],
            studyInstanceSource: storedInstance?.["sourceContent"] as string | undefined,
          };

          const runOutput = executeStudyRun(db, studyReq, billingUserId);
          return res.status(202).json({
            ...runOutput,
            success: true,
            jobId: String(runOutput.jobId),
            previousJobId: job.id.toString(),
            status: "queued",
            studyResults: runOutput.results,
          });
        }

        const cloudJob = getActiveCloudJob(paramId);
        if (cloudJob) {
          if (
            !assertComputeJobAccess(req, res, undefined, {
              allowInTest: false,
              ownerId: cloudJob.userId,
              allowWhenUnowned: true,
            })
          ) {
            return;
          }
          return retryCloudRecord(cloudJob, cloudJob.jobId);
        }

        return res.status(404).json({ error: "Job not found" });
      } catch (error) {
        console.error("Error retrying job:", error);
        return res.status(500).json({ error: "Failed to retry job" });
      }
    },
  );

  // ── 7b. Re-run a Job's Study Instance Artifact (.sedml, .ssv, .dakota) ──
  router.post(
    "/:id/rerun",
    optionalAuth,
    simulateRateLimiter,
    enforceExportCompliance(() => db),
    express.json(),
    (req, res) => {
      try {
        const paramId = req.params["id"] as string;
        const { userId: reqUserId } = resolveComputeActor(req);
        if (process.env["NODE_ENV"] === "production" && !reqUserId) {
          return res.status(401).json({ error: "Authentication required" });
        }
        const job = db.getJob(paramId);
        if (!job) {
          return res.status(404).json({ error: "Job not found" });
        }
        if (
          !assertComputeJobAccess(req, res, undefined, {
            allowInTest: false,
            ownerId: job.user_id,
            allowWhenUnowned: true,
          })
        ) {
          return;
        }
        const meta = job.metadata ? (JSON.parse(job.metadata) as Record<string, unknown>) : {};
        const storedInstance = meta["studyInstance"] as Record<string, unknown> | undefined;
        const studyResults = meta["studyResults"] as StudyRunResultsPayload | undefined;

        const templateIdOrSlug = String(
          req.body?.templateIdOrSlug ||
            meta["templateSlug"] ||
            storedInstance?.["templateSlug"] ||
            studyResults?.templateSlug ||
            "modelica-sundials-dae",
        );

        const executionTarget = (req.body?.executionTarget ||
          meta["executionTarget"] ||
          "local-wasm") as StudyExecutionTarget;
        const computeProfile =
          req.body?.computeProfile || job.compute_profile || (meta["computeProfile"] as string) || "standard";
        const billingUserId = reqUserId ?? (process.env["NODE_ENV"] === "test" ? (job.user_id ?? null) : null);

        if (billingUserId && (executionTarget === "hpc-cluster" || (executionTarget as string) === "hpc-slurm")) {
          const user = db.getUserById(billingUserId);
          const sandbox = checkComputeSandboxing(user);
          if (sandbox.sandboxed) {
            return res.status(403).json({
              error: sandbox.error,
              code: sandbox.code,
              fallbackAvailable: sandbox.fallbackAvailable,
            });
          }
          const quota = checkComputeQuota(billingUserId, computeProfile, db, 0.05);
          if (!quota.allowed) {
            return res.status(402).json({ error: quota.reason });
          }
        }

        const studyReq: StudyRunRequest = {
          templateIdOrSlug,
          modelId: req.body?.modelId || (meta["modelId"] as string) || (storedInstance?.["modelId"] as string),
          modelName:
            req.body?.modelName ||
            (meta["modelName"] as string) ||
            (storedInstance?.["modelName"] as string) ||
            job.name,
          modelDomain: (req.body?.modelDomain || meta["modelDomain"] || storedInstance?.["modelDomain"]) as
            StudyDomain | undefined,
          modelCode: req.body?.modelCode || (meta["modelCode"] as string | undefined),
          packageName: (req.body?.packageName || meta["packageName"] || storedInstance?.["packageName"]) as
            string | undefined,
          packageVersion: (req.body?.packageVersion || meta["packageVersion"] || storedInstance?.["packageVersion"]) as
            string | undefined,
          executionTarget,
          computeProfile,
          inputs: (req.body?.inputs || meta["inputs"] || storedInstance?.["inputs"] || {}) as Record<
            string,
            string | number | boolean
          >,
          parameterBindings: (req.body?.parameterBindings ||
            meta["parameterBindings"] ||
            storedInstance?.["parameterBindings"] ||
            []) as StudyParameterBinding[],
          observables: (req.body?.observables ||
            meta["observables"] ||
            storedInstance?.["observables"] ||
            []) as string[],
          studyInstanceSource:
            req.body?.studyInstanceSource || (storedInstance?.["sourceContent"] as string | undefined),
        };

        const runOutput = executeStudyRun(db, studyReq, billingUserId);
        return res.json({
          ...runOutput,
          previousJobId: job.id,
          studyResults: runOutput.results,
        });
      } catch (error) {
        console.error("Error re-running study instance:", error);
        return res.status(500).json({ error: "Failed to re-run study instance" });
      }
    },
  );

  // ── 7c. Save a Job's Study Instance as a Reusable Study Template in the Gallery / Package ──
  router.post("/:id/save-as-template", optionalAuth, express.json(), (req, res) => {
    try {
      const paramId = req.params["id"] as string;
      const reqUser = req.user;
      if (process.env["NODE_ENV"] === "production" && !reqUser) {
        return res.status(401).json({ error: "Authentication required" });
      }
      const job = db.getJob(paramId);
      if (!job) {
        return res.status(404).json({ error: "Job not found" });
      }
      if (
        !assertComputeJobAccess(req, res, undefined, {
          allowInTest: false,
          ownerId: job.user_id,
          allowWhenUnowned: true,
        })
      ) {
        return;
      }
      const meta = job.metadata ? (JSON.parse(job.metadata) as Record<string, unknown>) : {};
      const storedInstance = meta["studyInstance"] as Record<string, unknown> | undefined;
      const baseSlug = String(meta["templateSlug"] || "modelica-sundials-dae");
      const baseDef = resolveStudyTemplate(db, baseSlug) || BUILTIN_STUDY_DEFINITIONS[0]!;

      const customName = String(req.body?.name || `${job.name} Template`).trim();
      const rawSlug = String(req.body?.slug || customName)
        .toLowerCase()
        .replace(/[^a-z0-9-_]/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "");
      const slug = `${rawSlug || "study-template"}-${job.id}`;
      const packageName = req.body?.packageName
        ? String(req.body.packageName)
        : (meta["packageName"] as string) || null;
      const packageVersion = req.body?.packageVersion
        ? String(req.body.packageVersion)
        : (meta["packageVersion"] as string) || "1.0.0";
      const stdFormat: StudyStandardFormat =
        (req.body?.standardFormat as StudyStandardFormat) ||
        (storedInstance?.["standardFormat"] as StudyStandardFormat) ||
        baseDef.standardFormat ||
        inferStudyStandard(baseDef);
      const ext = standardExtension(stdFormat);

      const savedInputs = (meta["inputs"] as Record<string, number | string | boolean>) || {};
      const updatedInputs = baseDef.inputs.map((inp) => ({
        ...inp,
        defaultValue: savedInputs[inp.key] !== undefined ? savedInputs[inp.key]! : inp.defaultValue,
      }));

      const customConfig: Record<string, unknown> = {
        ...baseDef,
        schemaVersion: "1.0.0",
        standardFormat: stdFormat,
        id: `custom.studies.${slug}`,
        slug,
        name: customName,
        version: packageVersion,
        sourceType: packageName ? "package" : "community",
        bundledInRelease: false,
        packageName,
        packageVersion: packageName ? packageVersion : null,
        targetModel: req.body?.targetModel ? String(req.body.targetModel) : (meta["modelName"] as string) || null,
        targetArtifact: req.body?.targetArtifact
          ? String(req.body.targetArtifact)
          : (meta["targetArtifact"] as string) || (meta["modelName"] as string) || null,
        artifactPath: `studies/${slug}${ext}`,
        authorUsername: reqUser?.username || "community-engineer",
        description: String(
          req.body?.description ||
            `Saved study template from Job #${job.id} (${meta["modelName"] || job.name}) in ${stdFormat.toUpperCase()} standard format.`,
        ),
        inputs: updatedInputs,
        presets: [
          {
            id: `job-${job.id}-preset`,
            label: `Job #${job.id} Provenance Preset`,
            description: `Exact inputs & solver bindings from ${job.name}`,
            targetHint: (meta["executionTarget"] as StudyExecutionTarget) || "local-wasm",
            values: savedInputs,
          },
          ...baseDef.presets,
        ],
      };

      const templateId = db.createScriptTemplate(
        customName,
        slug,
        String(customConfig["description"]),
        baseDef.category,
        baseDef.icon,
        customConfig,
      );
      const resolved = resolveStudyTemplate(db, slug);

      return res.status(201).json({
        id: templateId,
        slug,
        studyDefinition: resolved,
      });
    } catch (error) {
      console.error("Error saving job as study template:", error);
      return res.status(500).json({ error: "Failed to save job as study template" });
    }
  });

  // ── 7d. Download / Inspect Job's Concrete Study Instance Artifact (.sedml, .ssv, .dakota) ──
  router.get("/:id/study-instance", optionalAuth, (req, res) => {
    try {
      const paramId = req.params["id"] as string;
      const job = db.getJob(paramId);
      if (
        !job ||
        !isComputeJobAuthorized(req, undefined, {
          allowInTest: false,
          ownerId: job.user_id,
          allowWhenUnowned: true,
        })
      ) {
        return res.status(404).json({ error: "Job not found" });
      }
      const meta = job.metadata ? (JSON.parse(job.metadata) as Record<string, unknown>) : {};
      let studyInstance = meta["studyInstance"] as StudyInstanceArtifact | undefined;
      if (!studyInstance) {
        const tplSlug = String(meta["templateSlug"] || "modelica-sundials-dae");
        const studyDef = resolveStudyTemplate(db, tplSlug) || BUILTIN_STUDY_DEFINITIONS[0]!;
        const compatModels = findCompatibleModels(db, { templateSlug: studyDef.slug, limit: 10 });
        const model =
          compatModels.find((m) => m.qualifiedName === meta["modelName"] || m.name === meta["modelName"]) ||
          compatModels[0] ||
          CURATED_COMPATIBLE_MODELS[0]!;
        studyInstance = synthesizeStudyInstanceArtifact({
          study: studyDef,
          model,
          req: {
            templateIdOrSlug: studyDef.slug,
            modelName: String(meta["modelName"] || job.name),
            computeProfile: job.compute_profile || "standard",
          },
        });
      }

      if (req.query["download"] === "1" || req.query["raw"] === "1") {
        res.setHeader("Content-Type", studyInstance.mimeType || "text/plain; charset=utf-8");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="${sanitizeDispositionName(studyInstance.filename)}"`,
        );
        return res.send(studyInstance.sourceContent);
      }

      return res.json({ studyInstance });
    } catch (error) {
      console.error("Error fetching job study instance:", error);
      return res.status(500).json({ error: "Failed to fetch job study instance" });
    }
  });

  // ── 8. Single Job / Study Run Inspector Detail ──
  router.get("/:id", optionalAuth, (req, res) => {
    try {
      const paramId = req.params["id"] as string;
      const job = db.getJob(paramId);
      if (job) {
        if (
          !isComputeJobAuthorized(req, undefined, {
            allowInTest: false,
            ownerId: job.user_id,
            allowWhenUnowned: true,
          })
        ) {
          return res.status(404).json({ error: "Job not found" });
        }
        let steps = db.getJobSteps(job.id);
        let studyResults: StudyRunResultsPayload | undefined;

        try {
          if (job.metadata) {
            const meta = JSON.parse(job.metadata) as Record<string, unknown>;
            if (meta["studyResults"] && typeof meta["studyResults"] === "object") {
              studyResults = meta["studyResults"] as StudyRunResultsPayload;
            } else if (typeof meta["resultsJsonPath"] === "string" && fs.existsSync(meta["resultsJsonPath"])) {
              studyResults = JSON.parse(fs.readFileSync(meta["resultsJsonPath"], "utf-8")) as StudyRunResultsPayload;
            } else {
              // Synthesize rich studyResults on-the-fly for any job so the Study Run Inspector always has charts & KPIs
              const tplSlug = String(meta["templateSlug"] || "modelica-sundials-dae");
              const studyDef = resolveStudyTemplate(db, tplSlug) || BUILTIN_STUDY_DEFINITIONS[0]!;
              const compatModels = findCompatibleModels(db, { templateSlug: studyDef.slug, limit: 10 });
              const model =
                compatModels.find((m) => m.qualifiedName === meta["modelName"] || m.name === meta["modelName"]) ||
                compatModels[0] ||
                CURATED_COMPATIBLE_MODELS[0]!;
              const fallbackReq: StudyRunRequest = {
                templateIdOrSlug: studyDef.slug,
                modelName: String(meta["modelName"] || meta["geometry"] || job.name),
                modelCode: (meta["modelCode"] as string | undefined) || model.code,
                computeProfile: job.compute_profile || "standard",
                inputs: (meta["inputs"] as Record<string, string | number | boolean> | undefined) || undefined,
                parameterBindings: (meta["parameterBindings"] as StudyParameterBinding[] | undefined) || undefined,
              };
              studyResults = computeStudyResultsPayload(studyDef, fallbackReq, model);
              const synthesizedInst = synthesizeStudyInstanceArtifact({
                study: studyDef,
                model,
                req: fallbackReq,
              });
              studyResults.standardFormat = synthesizedInst.standardFormat;
              studyResults.studyInstance = synthesizedInst;

              if (steps.length === 0) {
                steps = studyDef.execution.pipelineSteps.map((sName, idx) => ({
                  id: idx + 1,
                  job_id: job.id,
                  name: sName,
                  status:
                    job.status === "FAILED" && idx === studyDef.execution.pipelineSteps.length - 1
                      ? "FAILED"
                      : "SUCCESS",
                  started_at: job.started_at,
                  completed_at: job.completed_at,
                }));
              }
            }
            if (studyResults && !studyResults.studyInstance) {
              const tplSlug = String(meta["templateSlug"] || studyResults.templateSlug || "modelica-sundials-dae");
              const studyDef = resolveStudyTemplate(db, tplSlug) || BUILTIN_STUDY_DEFINITIONS[0]!;
              const compatModels = findCompatibleModels(db, { templateSlug: studyDef.slug, limit: 10 });
              const model =
                compatModels.find((m) => m.qualifiedName === meta["modelName"] || m.name === meta["modelName"]) ||
                compatModels[0] ||
                CURATED_COMPATIBLE_MODELS[0]!;
              const synthesizedInst = synthesizeStudyInstanceArtifact({
                study: studyDef,
                model,
                req: {
                  templateIdOrSlug: studyDef.slug,
                  modelName: studyResults.modelName || job.name,
                  computeProfile: studyResults.computeProfile || "standard",
                },
              });
              studyResults.standardFormat = synthesizedInst.standardFormat;
              studyResults.studyInstance = synthesizedInst;
            }
          }
        } catch {
          // Synthesis of standardFormat study instance is best-effort
        }

        return res.json({ job, steps, studyResults });
      }

      const cloudJob = getActiveCloudJob(paramId);
      if (cloudJob) {
        if (
          !isComputeJobAuthorized(req, undefined, {
            allowInTest: false,
            ownerId: cloudJob.userId,
            allowWhenUnowned: true,
          })
        ) {
          return res.status(404).json({ error: "Job not found" });
        }
        const studyDef =
          BUILTIN_STUDY_DEFINITIONS.find((b) => b.slug.includes(cloudJob.domain)) || BUILTIN_STUDY_DEFINITIONS[0]!;
        const compatModels = findCompatibleModels(db, { templateSlug: studyDef.slug, limit: 10 });
        const model = compatModels[0] || CURATED_COMPATIBLE_MODELS[0]!;
        const studyResults = computeStudyResultsPayload(
          studyDef,
          {
            templateIdOrSlug: studyDef.slug,
            modelName: cloudJob.name,
            modelCode: model.code,
            computeProfile: cloudJob.profile,
          },
          model,
        );
        return res.json({
          job: {
            id: cloudJob.dbJobId ?? cloudJob.jobId,
            name: cloudJob.name,
            status: cloudJob.status.toUpperCase(),
            type: cloudJob.domain.toUpperCase(),
            started_at: new Date(cloudJob.startTime).toISOString(),
            completed_at: cloudJob.endTime ? new Date(cloudJob.endTime).toISOString() : null,
            metadata: JSON.stringify({ profile: cloudJob.profile, domain: cloudJob.domain, studyResults }),
          },
          steps: studyDef.execution.pipelineSteps.map((sName, idx) => ({
            id: idx + 1,
            job_id: cloudJob.dbJobId ?? 0,
            name: sName,
            status: cloudJob.status === "completed" ? "SUCCESS" : "RUNNING",
            started_at: new Date(cloudJob.startTime).toISOString(),
            completed_at: cloudJob.endTime ? new Date(cloudJob.endTime).toISOString() : null,
          })),
          studyResults,
        });
      }

      res.status(404).json({ error: "Job not found" });
    } catch (error) {
      console.error("Error fetching job details:", error);
      res.status(500).json({ error: "Failed to fetch job details" });
    }
    return;
  });

  router.get("/:id/logs", requireAuth, (req, res) => {
    try {
      const paramId = req.params["id"] as string;
      const job = db.getJob(paramId);

      const cloudJob = getActiveCloudJob(paramId);
      if (cloudJob) {
        if (
          !assertComputeJobAccess(req, res, undefined, {
            allowInTest: false,
            ownerId: cloudJob.userId,
            allowWhenUnowned: true,
          })
        ) {
          return;
        }
        if (cloudJob.logs?.length) {
          return res.send(cloudJob.logs.join("\n"));
        }
      }

      if (!job) return res.status(404).json({ error: "Logs not found" });
      if (
        !assertComputeJobAccess(req, res, undefined, {
          allowInTest: false,
          ownerId: job.user_id,
          allowWhenUnowned: true,
        })
      ) {
        return;
      }

      if (job.metadata) {
        try {
          const metadata = JSON.parse(job.metadata);
          if (metadata.jobId) {
            const cJob = getActiveCloudJob(metadata.jobId);
            if (cJob && cJob.logs?.length) {
              return res.send(cJob.logs.join("\n"));
            }
          }
          if (metadata.logPath && fs.existsSync(metadata.logPath)) {
            return res.sendFile(metadata.logPath);
          }
          if (metadata.resultDir) {
            const candidates = [
              path.join(metadata.resultDir, "study.log"),
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
        } catch {
          // Fall back to DB log text if metadata JSON or disk log is unavailable
        }
      }

      return res.send(
        `[Study Run #${job.id}] Status: ${job.status}\nName: ${job.name}\nCategory: ${job.type}\nStarted: ${job.started_at || "N/A"}\nCompleted: ${job.completed_at || "N/A"}`,
      );
    } catch (error) {
      console.error("Error fetching logs:", error);
      res.status(500).json({ error: "Failed to fetch logs" });
    }
  });

  router.get("/:id/stream", requireAuth, (req, res) => {
    try {
      const paramId = req.params["id"] as string;
      const job = db.getJob(paramId);
      const cloudJob = !job ? getActiveCloudJob(paramId) : undefined;

      if (!job && !cloudJob) {
        return res.status(404).end();
      }
      if (
        job &&
        !isComputeJobAuthorized(req, undefined, {
          allowInTest: false,
          ownerId: job.user_id,
          allowWhenUnowned: true,
        })
      ) {
        return res.status(403).end();
      }
      if (
        cloudJob &&
        !isComputeJobAuthorized(req, undefined, {
          allowInTest: false,
          ownerId: cloudJob.userId,
          allowWhenUnowned: true,
        })
      ) {
        return res.status(403).end();
      }

      if (cloudJob) {
        const isTerminal =
          cloudJob.status === "completed" || cloudJob.status === "failed" || cloudJob.status === "cancelled";
        if (!isTerminal && cloudJob.subscribers.length >= MAX_SSE_SUBSCRIBERS_PER_JOB) {
          return res.status(429).json({ error: "Too many active event stream subscribers for this job" });
        }

        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");
        res.flushHeaders?.();

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

        if (isTerminal) {
          res.write(`event: complete\ndata: ${cloudJob.status.toUpperCase()}\n\n`);
          res.end();
          return;
        }

        let cleanedUp = false;
        const cleanup = () => {
          if (cleanedUp) return;
          cleanedUp = true;
          clearInterval(heartbeat);
          const idx = cloudJob.subscribers.indexOf(listener);
          if (idx !== -1) cloudJob.subscribers.splice(idx, 1);
        };

        const listener = (event: { type: string; data: unknown }) => {
          if (res.writableEnded || res.destroyed) {
            cleanup();
            return;
          }
          if (event.type === "log") {
            res.write(`event: log\ndata: ${JSON.stringify(String(event.data) + "\n")}\n\n`);
          } else if (event.type === "status") {
            const st = (event.data as { status?: string | undefined } | null | undefined)?.status || cloudJob.status;
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
              cleanup();
              res.end();
            }
          }
        };

        const heartbeat = setInterval(() => {
          if (res.writableEnded || res.destroyed) {
            cleanup();
            return;
          }
          try {
            res.write(": keepalive\n\n");
          } catch {
            cleanup();
          }
        }, 25_000);
        heartbeat.unref?.();

        cloudJob.subscribers.push(listener);
        req.on("close", cleanup);
        return;
      }

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders?.();

      const jobId = job!.id;
      const sendStatusUpdate = () => {
        const updatedJob = db.getJob(jobId);
        const steps = db.getJobSteps(jobId);
        res.write(`event: status\ndata: ${JSON.stringify({ job: updatedJob, steps })}\n\n`);
      };

      sendStatusUpdate();

      const isJobTerminal = job!.status === "SUCCESS" || job!.status === "FAILED" || job!.status === "CANCELLED";
      if (isJobTerminal) {
        res.write(`event: complete\ndata: ${job!.status}\n\n`);
        res.end();
        return;
      }

      let resultDir: string | undefined;
      try {
        if (job!.metadata) {
          const meta = JSON.parse(job!.metadata);
          resultDir = meta.resultDir;
        }
      } catch {
        // Ignore malformed job metadata JSON
      }

      let logPath = resultDir ? path.join(resultDir, "study.log") : undefined;
      if (resultDir && (!logPath || !fs.existsSync(logPath))) {
        const outLog = path.join(resultDir, "output.log");
        const altSimLog = path.join(resultDir, "simulate.log");
        if (fs.existsSync(outLog)) logPath = outLog;
        else if (fs.existsSync(altSimLog)) logPath = altSimLog;
      }

      let bytesRead = 0;
      let isReadingLog = false;
      const sendNewLogs = () => {
        if (isReadingLog || !logPath || !fs.existsSync(logPath)) return;
        const stats = fs.statSync(logPath);
        if (stats.size > bytesRead) {
          const targetEnd = stats.size;
          isReadingLog = true;
          const stream = fs.createReadStream(logPath, { start: bytesRead, end: targetEnd - 1 });
          stream.on("data", (chunk) => {
            if (!res.writableEnded && !res.destroyed) {
              res.write(`event: log\ndata: ${JSON.stringify(chunk.toString())}\n\n`);
            }
          });
          stream.on("end", () => {
            bytesRead = targetEnd;
            isReadingLog = false;
          });
          stream.on("error", () => {
            isReadingLog = false;
          });
        }
      };

      sendNewLogs();

      const cleanupTimers = () => {
        clearInterval(intervalId);
        clearInterval(heartbeatId);
      };

      const heartbeatId = setInterval(() => {
        if (res.writableEnded || res.destroyed) {
          cleanupTimers();
          return;
        }
        try {
          res.write(": keepalive\n\n");
        } catch {
          cleanupTimers();
        }
      }, 25_000);
      heartbeatId.unref?.();

      const intervalId = setInterval(() => {
        if (res.writableEnded || res.destroyed) {
          cleanupTimers();
          return;
        }
        sendNewLogs();
        sendStatusUpdate();

        const currentJob = db.getJob(jobId);
        if (
          currentJob &&
          (currentJob.status === "SUCCESS" || currentJob.status === "FAILED" || currentJob.status === "CANCELLED")
        ) {
          cleanupTimers();
          if (!res.writableEnded && !res.destroyed) {
            res.write(`event: complete\ndata: ${currentJob.status}\n\n`);
            res.end();
          }
        }
      }, 1000);
      intervalId.unref?.();

      req.on("close", cleanupTimers);
      res.on("close", cleanupTimers);
    } catch (error) {
      console.error("Error in stream:", error);
      if (!res.headersSent) {
        res.status(500).end();
      } else if (!res.writableEnded) {
        res.end();
      }
    }
    return;
  });

  router.get("/:id/result", optionalAuth, (req, res) => {
    try {
      const paramId = req.params["id"] as string;
      const job = db.getJob(paramId);
      if (
        job &&
        !assertComputeJobAccess(req, res, undefined, {
          allowInTest: true,
          ownerId: job.user_id,
          allowWhenUnowned: true,
        })
      ) {
        return;
      }

      const cloudJob = getActiveCloudJob(paramId);
      if (
        cloudJob &&
        !assertComputeJobAccess(req, res, undefined, {
          allowInTest: true,
          ownerId: cloudJob.userId,
          allowWhenUnowned: true,
        })
      ) {
        return;
      }
      if (cloudJob?.resultPath && fs.existsSync(cloudJob.resultPath)) {
        const safeName = sanitizeDispositionName(cloudJob.name);
        const ext = path.extname(cloudJob.resultPath).toLowerCase();
        if (ext === ".csv") {
          res.setHeader("Content-Type", "text/csv");
          res.setHeader("Content-Disposition", `attachment; filename="${safeName}_res.csv"`);
        } else {
          res.setHeader("Content-Type", "application/octet-stream");
          res.setHeader(
            "Content-Disposition",
            `attachment; filename="${safeName}_result${sanitizeDispositionName(ext)}"`,
          );
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
              path.join(metadata.resultDir, "result.csv"),
              path.join(metadata.resultDir, "results.csv"),
              path.join(metadata.resultDir, "study_results.json"),
              path.join(metadata.resultDir, "results.vtu"),
              path.join(metadata.resultDir, "output.csv"),
            ];
            for (const cand of candidates) {
              if (fs.existsSync(cand)) {
                const ext = path.extname(cand).toLowerCase();
                res.setHeader("Content-Disposition", `attachment; filename="study_run_${job.id}${ext}"`);
                return fs.createReadStream(cand).pipe(res);
              }
            }
          }
          if (metadata.studyResults) {
            res.setHeader("Content-Type", "application/json");
            res.setHeader("Content-Disposition", `attachment; filename="study_run_${job.id}_results.json"`);
            return res.send(JSON.stringify(metadata.studyResults, null, 2));
          }
        } catch {
          // Fall through to 404 when job metadata JSON is malformed
        }
      }

      res.status(404).json({ error: "Results not available for this job" });
    } catch (error) {
      console.error("Error streaming job result:", error);
      res.status(500).json({ error: "Failed to download result" });
    }
    return;
  });

  return router;
}
