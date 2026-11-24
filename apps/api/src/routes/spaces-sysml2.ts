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
import { optionalAuth } from "../middleware/auth-middleware.js";
import { sysml2EventBus } from "../services/sysml2-event-bus.js";
import { OMG_SYSML2_CONTEXT, SysML2OmgService } from "../services/sysml2-omg-service.js";
import { initSseStream } from "../util/sse.js";
import { sysml2GraphQLRouter } from "./sysml2-graphql.js";

function getParam(val: string | string[] | undefined): string {
  if (Array.isArray(val)) return val[0] || "";
  return val || "";
}

export function createSpaceSysml2Router(database?: LibraryDatabase | null, service?: SysML2OmgService): Router {
  const router = createRouter({ mergeParams: true });
  const omgService = service || new SysML2OmgService(database);

  type SpaceSysmlRequest = Request & {
    spaceProjectId?: string;
    omgProject?: NonNullable<ReturnType<SysML2OmgService["getProject"]>>;
  };

  function getProjectId(req: SpaceSysmlRequest): string {
    if (req.spaceProjectId) return req.spaceProjectId;
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

  if (database) {
    router.use(optionalAuth);
  }

  // Middleware: resolve space, enforce visibility/write ACLs, and ensure OMG project exists
  router.use((req: SpaceSysmlRequest, res: Response, next) => {
    const namespace = getParam(req.params["namespace"]);
    const slug = getParam(req.params["slug"]);

    if (!namespace || !slug) {
      res.status(400).json({ error: "Route parameters 'namespace' and 'slug' are required." });
      return;
    }

    let spaceName = `${namespace}/${slug}`;
    let description = "Ansatz Collaborative Engineering Space";

    if (database) {
      const space = database.getSpaceByNamespaceAndSlug(namespace, slug);
      if (!space) {
        res.status(404).json({ error: "Space not found" });
        return;
      }
      spaceName = space.name || spaceName;
      description = space.description || description;

      const userId = req.user?.id;
      const isAdmin = req.user?.role === "admin" || req.user?.accountType === "admin";
      if (space.visibility === "private" && !isAdmin) {
        const canRead = database.canUserViewSpace(space, userId, isAdmin);
        if (!canRead) {
          res.status(userId ? 403 : 401).json({ error: "Access denied to private space" });
          return;
        }
      }

      const isMutation =
        req.method === "POST" || req.method === "PUT" || req.method === "PATCH" || req.method === "DELETE";
      const isGraphqlReadQuery =
        req.path === "/graphql" && typeof req.body?.query === "string" && !/\bmutation\b/i.test(req.body.query);

      if (isMutation && !isGraphqlReadQuery && !isAdmin) {
        if (!userId) {
          res.status(401).json({ error: "Authentication required" });
          return;
        }
        if (!database.canUserWriteSpace(space, userId, isAdmin)) {
          res.status(403).json({ error: "Forbidden: write access to space required" });
          return;
        }
      }
    }

    const projectId = `urn:ansatz:space:${namespace.replace(/^@/, "")}:${slug}`;
    req.spaceProjectId = projectId;
    req.params["projectId"] = projectId;

    let project = omgService.getProject(projectId);
    if (!project) {
      project = omgService.createProject(spaceName, description, projectId);
    }

    req.omgProject = project;
    next();
  });

  // Mount GraphQL under space after project resolution
  router.use("/graphql", sysml2GraphQLRouter(omgService, { requireAuthForMutations: Boolean(database) }));

  /**
   * GET /: Get Space OMG Project descriptor
   */
  router.get("/", (req: SpaceSysmlRequest, res: Response) => {
    const project = req.omgProject;
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
  router.get("/elements", (req: SpaceSysmlRequest, res: Response) => {
    const project = req.omgProject!;
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

    let unsubscribe: (() => void) | null = null;
    const sse = initSseStream(res, {
      heartbeatMs: 15_000,
      onClose: () => {
        unsubscribe?.();
      },
    });

    sse.send("connected", { projectId, timestamp: new Date().toISOString() });

    unsubscribe = sysml2EventBus.onProjectEvent(projectId, (event) => {
      sse.send(event.type, event);
    });
  });

  return router;
}
