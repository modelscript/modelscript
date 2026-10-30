// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * OMG Systems Modeling REST API Router (SysML v2 REST API - ptc/2024-02-03).
 *
 * Implements standard OMG REST / JSON-LD endpoints:
 *   - /projects
 *   - /projects/:projectId
 *   - /projects/:projectId/commits
 *   - /projects/:projectId/commits/:commitId
 *   - /projects/:projectId/commits/:commitId/elements
 *   - /projects/:projectId/commits/:commitId/elements/:elementId
 *   - /projects/:projectId/commits/:commitId/elements/:elementId/relationships
 *   - /projects/:projectId/commits/:commitId/queries
 *   - /projects/:projectId/ingest
 */

import type { Request, Response, Router } from "express";
import { Router as createRouter } from "express";
import { optionalAuth } from "../middleware/auth-middleware.js";
import { defaultApiLimiter } from "../middleware/rate-limiter.js";
import { OMG_SYSML2_CONTEXT, SysML2OmgService } from "../services/sysml2-omg-service.js";

function getParam(val: string | string[] | undefined): string {
  if (Array.isArray(val)) return val[0] || "";
  return val || "";
}

export function sysml2OmgRouter(service?: SysML2OmgService): Router {
  const router = createRouter();
  router.use(defaultApiLimiter);
  router.use(optionalAuth);
  router.use((req: Request, res: Response, next) => {
    if (
      process.env["NODE_ENV"] === "production" &&
      (req.method === "POST" || req.method === "PUT" || req.method === "PATCH" || req.method === "DELETE") &&
      !req.path.endsWith("/queries") &&
      !req.user
    ) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    next();
  });
  const omgService = service || new SysML2OmgService();

  // Helper to set standard OMG JSON-LD headers
  function sendJsonLd(req: Request, res: Response, payload: unknown, status = 200): void {
    const acceptsJson = req.accepts(["application/ld+json", "application/json"]);
    const contentType =
      acceptsJson === "application/ld+json" ? "application/ld+json; charset=utf-8" : "application/json; charset=utf-8";

    res.status(status);
    res.setHeader("Content-Type", contentType);

    // If payload is an object, ensure @context is present
    if (payload && typeof payload === "object" && !Array.isArray(payload)) {
      const obj = payload as Record<string, unknown>;
      if (!obj["@context"]) {
        res.json({ "@context": OMG_SYSML2_CONTEXT, ...obj });
        return;
      }
    }
    res.json(payload);
  }

  // ── 1. Projects ──

  /**
   * GET /projects: List all projects
   */
  router.get("/projects", (req: Request, res: Response) => {
    const projects = omgService.listProjects();
    sendJsonLd(req, res, {
      "@type": "Collection",
      members: projects,
      totalCount: projects.length,
    });
  });

  /**
   * POST /projects: Create a new project
   */
  router.post("/projects", (req: Request, res: Response) => {
    const { name, description } = req.body || {};
    if (!name || typeof name !== "string") {
      res.status(400).json({ error: "Field 'name' is required and must be a string." });
      return;
    }

    const project = omgService.createProject(name, description);
    sendJsonLd(req, res, project, 201);
  });

  /**
   * GET /projects/:projectId: Get project details
   */
  router.get("/projects/:projectId", (req: Request, res: Response) => {
    const projectId = getParam(req.params["projectId"]);
    const project = omgService.getProject(projectId);
    if (!project) {
      res.status(404).json({ error: `Project '${projectId}' not found.` });
      return;
    }
    sendJsonLd(req, res, project);
  });

  /**
   * DELETE /projects/:projectId: Delete a project
   */
  router.delete("/projects/:projectId", (req: Request, res: Response) => {
    const projectId = getParam(req.params["projectId"]);
    const deleted = omgService.deleteProject(projectId);
    if (!deleted) {
      res.status(404).json({ error: `Project '${projectId}' not found.` });
      return;
    }
    res.sendStatus(204);
  });

  // ── 2. Commits ──

  /**
   * GET /projects/:projectId/commits: List commits
   */
  router.get("/projects/:projectId/commits", (req: Request, res: Response) => {
    const projectId = getParam(req.params["projectId"]);
    const project = omgService.getProject(projectId);
    if (!project) {
      res.status(404).json({ error: `Project '${projectId}' not found.` });
      return;
    }

    const commits = omgService.listCommits(projectId);
    sendJsonLd(req, res, {
      "@type": "Collection",
      members: commits,
      totalCount: commits.length,
    });
  });

  /**
   * POST /projects/:projectId/commits: Create commit
   */
  router.post("/projects/:projectId/commits", (req: Request, res: Response) => {
    const projectId = getParam(req.params["projectId"]);
    const { description, elements, relationships, branch } = req.body || {};
    if (!description || typeof description !== "string") {
      res.status(400).json({ error: "Field 'description' is required." });
      return;
    }

    try {
      const commit = omgService.createCommit(
        projectId,
        description,
        Array.isArray(elements) ? elements : [],
        Array.isArray(relationships) ? relationships : [],
        typeof branch === "string" ? branch : undefined,
      );
      sendJsonLd(req, res, commit, 201);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(404).json({ error: message });
    }
  });

  /**
   * GET /projects/:projectId/commits/:commitId: Get single commit
   */
  router.get("/projects/:projectId/commits/:commitId", (req: Request, res: Response) => {
    const projectId = getParam(req.params["projectId"]);
    const commitId = getParam(req.params["commitId"]);
    const commit = omgService.getCommit(projectId, commitId);
    if (!commit) {
      res.status(404).json({ error: `Commit '${commitId}' not found.` });
      return;
    }
    sendJsonLd(req, res, commit);
  });

  // ── 3. Elements & Relationships ──

  /**
   * GET /projects/:projectId/commits/:commitId/elements: Query elements in commit
   */
  router.get("/projects/:projectId/commits/:commitId/elements", (req: Request, res: Response) => {
    const projectId = getParam(req.params["projectId"]);
    const commitId = getParam(req.params["commitId"]);
    const commit = omgService.getCommit(projectId, commitId);
    if (!commit) {
      res.status(404).json({ error: `Commit '${commitId}' not found.` });
      return;
    }

    const rawPageSize = req.query["page[size]"]
      ? Number(req.query["page[size]"])
      : req.query["pageSize"]
        ? Number(req.query["pageSize"])
        : undefined;
    const pageSize =
      rawPageSize !== undefined && Number.isFinite(rawPageSize) ? Math.min(Math.max(1, rawPageSize), 200) : undefined;

    const pageAfter = (req.query["page[after]"] || req.query["pageAfter"]) as string | undefined;
    const type = req.query["type"] as string | undefined;
    const name = req.query["name"] as string | undefined;

    const result = omgService.getElements(projectId, commitId, {
      pageSize,
      pageAfter,
      type,
      name,
    });

    sendJsonLd(req, res, {
      "@type": "Collection",
      members: result.elements,
      totalCount: result.totalCount,
      nextCursor: result.nextCursor,
    });
  });

  /**
   * GET /projects/:projectId/commits/:commitId/elements/:elementId: Single element
   */
  router.get("/projects/:projectId/commits/:commitId/elements/:elementId", (req: Request, res: Response) => {
    const projectId = getParam(req.params["projectId"]);
    const commitId = getParam(req.params["commitId"]);
    const elementId = getParam(req.params["elementId"]);
    const element = omgService.getElementById(projectId, commitId, elementId);
    if (!element) {
      res.status(404).json({ error: `Element '${elementId}' not found.` });
      return;
    }
    sendJsonLd(req, res, element);
  });

  /**
   * GET /projects/:projectId/commits/:commitId/elements/:elementId/relationships
   */
  router.get(
    "/projects/:projectId/commits/:commitId/elements/:elementId/relationships",
    (req: Request, res: Response) => {
      const projectId = getParam(req.params["projectId"]);
      const commitId = getParam(req.params["commitId"]);
      const elementId = getParam(req.params["elementId"]);
      const rels = omgService.getElementRelationships(projectId, commitId, elementId);
      sendJsonLd(req, res, {
        "@type": "Collection",
        members: rels,
        totalCount: rels.length,
      });
    },
  );

  // ── 4. Structured Model Query ──

  /**
   * POST /projects/:projectId/commits/:commitId/queries: Execute structured query
   */
  router.post("/projects/:projectId/commits/:commitId/queries", (req: Request, res: Response) => {
    const projectId = getParam(req.params["projectId"]);
    const commitId = getParam(req.params["commitId"]);
    const commit = omgService.getCommit(projectId, commitId);
    if (!commit) {
      res.status(404).json({ error: `Commit '${commitId}' not found.` });
      return;
    }

    const querySpec = req.body || {};
    const elements = omgService.executeQuery(projectId, commitId, querySpec);

    sendJsonLd(req, res, {
      "@type": "Collection",
      members: elements,
      totalCount: elements.length,
    });
  });

  // ── 5. Ingestion Helper ──

  /**
   * POST /projects/:projectId/ingest: Ingest raw SysML v2 source into a new commit
   */
  router.post("/projects/:projectId/ingest", (req: Request, res: Response) => {
    const projectId = getParam(req.params["projectId"]);
    const { source, description, uri, branch, branchName } = req.body || {};
    if (!source || typeof source !== "string") {
      res.status(400).json({ error: "Field 'source' is required (SysML v2 model text)." });
      return;
    }

    const resolvedBranch =
      typeof branch === "string" ? branch : typeof branchName === "string" ? branchName : undefined;
    try {
      const commit = omgService.ingestSysML2(
        projectId,
        description || "Ingested SysML v2 model",
        source,
        uri,
        resolvedBranch,
      );
      sendJsonLd(req, res, commit, 201);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  // ── 6. Branches, Tags, Diff & 3-Way Merge ──

  /**
   * GET /projects/:projectId/branches: List branches in project
   */
  router.get("/projects/:projectId/branches", (req: Request, res: Response) => {
    const projectId = getParam(req.params["projectId"]);
    const project = omgService.getProject(projectId);
    if (!project) {
      res.status(404).json({ error: `Project '${projectId}' not found.` });
      return;
    }
    const branches = omgService.listBranches(projectId);
    sendJsonLd(req, res, {
      "@type": "Collection",
      members: branches,
      totalCount: branches.length,
    });
  });

  /**
   * POST /projects/:projectId/branches: Create a new branch
   */
  router.post("/projects/:projectId/branches", (req: Request, res: Response) => {
    const projectId = getParam(req.params["projectId"]);
    const { name, headCommitId } = req.body || {};
    if (!name || typeof name !== "string") {
      res.status(400).json({ error: "Field 'name' is required." });
      return;
    }
    try {
      const branch = omgService.createBranch(
        projectId,
        name,
        typeof headCommitId === "string" ? headCommitId : undefined,
      );
      sendJsonLd(req, res, branch, 201);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(message.includes("not found") ? 404 : 400).json({ error: message });
    }
  });

  /**
   * GET /projects/:projectId/branches/:branchId: Get single branch by ID or name
   */
  router.get("/projects/:projectId/branches/:branchId", (req: Request, res: Response) => {
    const projectId = getParam(req.params["projectId"]);
    const branchId = getParam(req.params["branchId"]);
    const branch = omgService.getBranch(projectId, branchId);
    if (!branch) {
      res.status(404).json({ error: `Branch '${branchId}' not found.` });
      return;
    }
    sendJsonLd(req, res, branch);
  });

  /**
   * DELETE /projects/:projectId/branches/:branchId: Delete non-default branch
   */
  router.delete("/projects/:projectId/branches/:branchId", (req: Request, res: Response) => {
    const projectId = getParam(req.params["projectId"]);
    const branchId = getParam(req.params["branchId"]);
    try {
      const deleted = omgService.deleteBranch(projectId, branchId);
      if (!deleted) {
        res.status(404).json({ error: `Branch '${branchId}' not found.` });
        return;
      }
      res.sendStatus(204);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(400).json({ error: message });
    }
  });

  /**
   * GET /projects/:projectId/tags: List tags in project
   */
  router.get("/projects/:projectId/tags", (req: Request, res: Response) => {
    const projectId = getParam(req.params["projectId"]);
    const project = omgService.getProject(projectId);
    if (!project) {
      res.status(404).json({ error: `Project '${projectId}' not found.` });
      return;
    }
    const tags = omgService.listTags(projectId);
    sendJsonLd(req, res, {
      "@type": "Collection",
      members: tags,
      totalCount: tags.length,
    });
  });

  /**
   * POST /projects/:projectId/tags: Create a tag on a commit
   */
  router.post("/projects/:projectId/tags", (req: Request, res: Response) => {
    const projectId = getParam(req.params["projectId"]);
    const { name, commitId, taggedCommitId, taggedCommit } = req.body || {};
    if (!name || typeof name !== "string") {
      res.status(400).json({ error: "Field 'name' is required." });
      return;
    }
    const targetCommitId =
      typeof commitId === "string"
        ? commitId
        : typeof taggedCommitId === "string"
          ? taggedCommitId
          : typeof taggedCommit?.["@id"] === "string"
            ? taggedCommit["@id"]
            : undefined;
    try {
      const tag = omgService.createTag(projectId, name, targetCommitId);
      sendJsonLd(req, res, tag, 201);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(message.includes("not found") ? 404 : 400).json({ error: message });
    }
  });

  /**
   * GET /projects/:projectId/diff: Compute semantic diff between two commits
   */
  router.get("/projects/:projectId/diff", (req: Request, res: Response) => {
    const projectId = getParam(req.params["projectId"]);
    const baseCommitId = String(req.query["baseCommitId"] || "");
    const targetCommitId = String(req.query["targetCommitId"] || "");
    if (!baseCommitId || !targetCommitId) {
      res.status(400).json({ error: "Query parameters 'baseCommitId' and 'targetCommitId' are required." });
      return;
    }
    try {
      const diff = omgService.diffCommits(projectId, baseCommitId, targetCommitId);
      sendJsonLd(req, res, { "@type": "CommitDiff", ...diff });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(message.includes("not found") ? 404 : 400).json({ error: message });
    }
  });

  /**
   * POST /projects/:projectId/merge: Perform 3-way semantic merge between two branches
   */
  router.post("/projects/:projectId/merge", (req: Request, res: Response) => {
    const projectId = getParam(req.params["projectId"]);
    const { sourceBranch, targetBranch, strategy, description, bounds } = req.body || {};
    if (!sourceBranch || !targetBranch) {
      res.status(400).json({ error: "Fields 'sourceBranch' and 'targetBranch' are required." });
      return;
    }
    try {
      const result = omgService.mergeBranches(projectId, String(sourceBranch), String(targetBranch), {
        strategy,
        description,
        bounds,
      });
      sendJsonLd(req, res, { "@type": "BranchMergeResult", ...result }, result.hasConflicts ? 409 : 200);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(message.includes("not found") ? 404 : 400).json({ error: message });
    }
  });

  // ── 7. Multi-Physics Container Export (SSP & FMI 3.0) ──

  /**
   * POST /projects/:projectId/export/ssp: Export project to SSP (.ssp) container
   */
  router.post("/projects/:projectId/export/ssp", async (req: Request, res: Response) => {
    const projectId = getParam(req.params["projectId"]);
    const { commitId, version, description } = req.body || {};
    try {
      const result = await omgService.exportProjectToSsp(projectId, commitId, {
        version,
        description,
      });
      res.setHeader("Content-Type", "application/octet-stream");
      res.setHeader("Content-Disposition", `attachment; filename="${result.filename}"`);
      res.send(Buffer.from(result.data));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(message.includes("not found") ? 404 : 500).json({ error: message });
    }
  });

  /**
   * GET /projects/:projectId/commits/:commitId/ssp: Download SSP for a specific commit
   */
  router.get("/projects/:projectId/commits/:commitId/ssp", async (req: Request, res: Response) => {
    const projectId = getParam(req.params["projectId"]);
    const commitId = getParam(req.params["commitId"]);
    try {
      const result = await omgService.exportProjectToSsp(projectId, commitId);
      res.setHeader("Content-Type", "application/octet-stream");
      res.setHeader("Content-Disposition", `attachment; filename="${result.filename}"`);
      res.send(Buffer.from(result.data));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(message.includes("not found") ? 404 : 500).json({ error: message });
    }
  });

  /**
   * POST /projects/:projectId/export/fmu3: Export project to monolithic FMI 3.0 FMU
   */
  router.post("/projects/:projectId/export/fmu3", async (req: Request, res: Response) => {
    const projectId = getParam(req.params["projectId"]);
    const { commitId } = req.body || {};
    try {
      const result = await omgService.exportProjectToFmi3(projectId, commitId);
      res.setHeader("Content-Type", "application/octet-stream");
      res.setHeader("Content-Disposition", `attachment; filename="${result.filename}"`);
      res.send(Buffer.from(result.data));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(message.includes("not found") ? 404 : 500).json({ error: message });
    }
  });

  /**
   * GET /projects/:projectId/commits/:commitId/fmu3: Download FMI 3.0 FMU for a specific commit
   */
  router.get("/projects/:projectId/commits/:commitId/fmu3", async (req: Request, res: Response) => {
    const projectId = getParam(req.params["projectId"]);
    const commitId = getParam(req.params["commitId"]);
    try {
      const result = await omgService.exportProjectToFmi3(projectId, commitId);
      res.setHeader("Content-Type", "application/octet-stream");
      res.setHeader("Content-Disposition", `attachment; filename="${result.filename}"`);
      res.send(Buffer.from(result.data));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(message.includes("not found") ? 404 : 500).json({ error: message });
    }
  });

  return router;
}
