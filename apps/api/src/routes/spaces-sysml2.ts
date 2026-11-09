// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Ansatz Space-Scoped SysML v2 OMG API Bridge Router.
 *
 * Bridges Ansatz Engineering Spaces (@namespace/slug) directly into the
 * OMG Systems Modeling API & Services (ptc/2024-02-03) data model:
 *   - Auto-creates / resolves canonical OMG Project: urn:ansatz:space:<namespace>:<slug>
 *   - Native OMG REST routes scoped directly to the Space
 *   - Real-time SSE collaboration stream: /api/v1/spaces/:namespace/:slug/sysml2/events
 *   - Space-scoped GraphQL endpoint: /api/v1/spaces/:namespace/:slug/sysml2/graphql
 */

import type { Request, Response, Router } from "express";
import { Router as createRouter } from "express";
import type { LibraryDatabase } from "../database.js";
import { sysml2EventBus } from "../services/sysml2-event-bus.js";
import { OMG_SYSML2_CONTEXT, SysML2OmgService } from "../services/sysml2-omg-service.js";
import { sysml2GraphQLRouter } from "./sysml2-graphql.js";

function getParam(val: string | string[] | undefined): string {
  if (Array.isArray(val)) return val[0] || "";
  return val || "";
}

export function createSpaceSysml2Router(database?: LibraryDatabase | null, service?: SysML2OmgService): Router {
  const router = createRouter({ mergeParams: true });
  const omgService = service || new SysML2OmgService(database);

  function getProjectId(req: Request): string {
    if ((req as any).spaceProjectId) return (req as any).spaceProjectId;
    const ns = getParam(req.params["namespace"]).replace(/^@/, "");
    const slug = getParam(req.params["slug"]);
    if (ns && slug) return `urn:ansatz:space:${ns}:${slug}`;
    return getParam(req.params["projectId"]);
  }

  function sendJsonLd(req: Request, res: Response, payload: unknown, status = 200): void {
    const acceptsJson = req.accepts(["application/ld+json", "application/json"]);
    const contentType =
      acceptsJson === "application/ld+json" ? "application/ld+json; charset=utf-8" : "application/json; charset=utf-8";

    res.status(status);
    res.setHeader("Content-Type", contentType);

    if (payload && typeof payload === "object" && !Array.isArray(payload)) {
      const obj = payload as Record<string, unknown>;
      if (!obj["@context"]) {
        res.json({ "@context": OMG_SYSML2_CONTEXT, ...obj });
        return;
      }
    }
    res.json(payload);
  }

  // Middleware: resolve space & ensure OMG project exists
  router.use((req: Request, res: Response, next) => {
    const namespace = getParam(req.params["namespace"]);
    const slug = getParam(req.params["slug"]);

    if (!namespace || !slug) {
      res.status(400).json({ error: "Route parameters 'namespace' and 'slug' are required." });
      return;
    }

    const projectId = `urn:ansatz:space:${namespace.replace(/^@/, "")}:${slug}`;
    (req as any).spaceProjectId = projectId;
    req.params["projectId"] = projectId;

    let project = omgService.getProject(projectId);
    if (!project) {
      let spaceName = `${namespace}/${slug}`;
      let description = "Ansatz Collaborative Engineering Space";

      if (database) {
        try {
          const space = database.getSpaceByNamespaceAndSlug(namespace, slug);
          if (space) {
            spaceName = space.name || spaceName;
            description = space.description || description;
          }
        } catch {
          // Fall back to generated defaults
        }
      }

      project = omgService.createProject(spaceName, description, projectId);
    }

    (req as any).omgProject = project;
    next();
  });

  // Mount GraphQL under space after project resolution
  router.use("/graphql", sysml2GraphQLRouter(omgService));

  /**
   * GET /: Get Space OMG Project descriptor
   */
  router.get("/", (req: Request, res: Response) => {
    const project = (req as any).omgProject;
    sendJsonLd(req, res, project);
  });

  /**
   * GET /commits: List commits in this Space
   */
  router.get("/commits", (req: Request, res: Response) => {
    const projectId = getProjectId(req);
    const commits = omgService.listCommits(projectId);
    sendJsonLd(req, res, {
      "@type": "Collection",
      members: commits,
      totalCount: commits.length,
    });
  });

  /**
   * GET /commits/:commitId: Get single commit
   */
  router.get("/commits/:commitId", (req: Request, res: Response) => {
    const projectId = getProjectId(req);
    const commitId = getParam(req.params["commitId"]);
    const commit = omgService.getCommit(projectId, commitId);
    if (!commit) {
      res.status(404).json({ error: `Commit '${commitId}' not found.` });
      return;
    }
    sendJsonLd(req, res, commit);
  });

  /**
   * GET /commits/:commitId/elements: Query elements in commit
   */
  router.get("/commits/:commitId/elements", (req: Request, res: Response) => {
    const projectId = getProjectId(req);
    const commitId = getParam(req.params["commitId"]);
    const type = typeof req.query["type"] === "string" ? req.query["type"] : undefined;
    const name = typeof req.query["name"] === "string" ? req.query["name"] : undefined;

    const result = omgService.getElements(projectId, commitId, { type, name });
    sendJsonLd(req, res, {
      "@type": "Collection",
      members: result.elements,
      totalCount: result.totalCount,
    });
  });

  /**
   * GET /elements: Convenience endpoint to query elements at HEAD of default branch
   */
  router.get("/elements", (req: Request, res: Response) => {
    const project = (req as any).omgProject;
    const headCommitId = project.defaultBranch?.headCommitId;
    if (!headCommitId) {
      sendJsonLd(req, res, { "@type": "Collection", members: [], totalCount: 0 });
      return;
    }
    const type = typeof req.query["type"] === "string" ? req.query["type"] : undefined;
    const name = typeof req.query["name"] === "string" ? req.query["name"] : undefined;

    const result = omgService.getElements(project["@id"], headCommitId, { type, name });
    sendJsonLd(req, res, {
      "@type": "Collection",
      members: result.elements,
      totalCount: result.totalCount,
    });
  });

  /**
   * POST /ingest: Ingest SysML model text directly into Space commit
   */
  router.post("/ingest", (req: Request, res: Response) => {
    const projectId = getProjectId(req);
    const { source, description, branch } = req.body || {};
    if (!source || typeof source !== "string") {
      res.status(400).json({ error: "Field 'source' is required (SysML v2 model text)." });
      return;
    }

    try {
      const commit = omgService.ingestSysML2(
        projectId,
        description || "Space SysML v2 update",
        source,
        `sysml2://spaces/${projectId}/model.sysml`,
        branch,
      );

      sysml2EventBus.emitEvent({
        type: "commit.created",
        projectId,
        timestamp: new Date().toISOString(),
        data: { commitId: commit["@id"], description: commit.description },
      });

      sendJsonLd(req, res, commit, 201);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  /**
   * GET /events: Real-time SSE collaboration stream for Space
   */
  router.get("/events", (req: Request, res: Response) => {
    const projectId = getProjectId(req);

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    res.write(`event: connected\ndata: ${JSON.stringify({ projectId, timestamp: new Date().toISOString() })}\n\n`);

    const unsubscribe = sysml2EventBus.onProjectEvent(projectId, (event) => {
      res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    });

    const heartbeatTimer = setInterval(() => {
      res.write(": heartbeat\n\n");
    }, 15000);

    req.on("close", () => {
      clearInterval(heartbeatTimer);
      unsubscribe();
    });
  });

  return router;
}
