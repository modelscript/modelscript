// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Artifact viewer routes.
 *
 * Provides API endpoints for the Web UI to query artifact metadata
 * and get viewer configuration for interactive artifact components.
 *
 * Endpoints:
 *   GET /api/v1/packages/:name/:version/artifacts
 *     → List artifacts for a package version with enriched metadata
 *
 *   GET /api/v1/packages/:name/:version/artifacts/:id
 *     → Get detailed metadata for a specific artifact (with viewer config)
 *
 *   GET /api/v1/artifacts/types
 *     → List all registered artifact types and their capabilities
 */

import type { Request, Response, Router } from "express";
import { Router as createRouter } from "express";
import { getArtifactRegistry } from "../artifacts/index.js";
import type { LibraryDatabase } from "../database.js";
import { optionalAuth } from "../middleware/auth-middleware.js";
import { convertStepToJson } from "../util/cad-converter.js";
import { verifySignedEmbedToken } from "./oembed.js";

/** Safely extract a string from an Express v5 param. */
function param(req: Request, name: string): string {
  const val = req.params[name];
  return Array.isArray(val) ? val.join("/") : String(val ?? "");
}

export function artifactViewerRouter(database: LibraryDatabase): Router {
  const router = createRouter();
  const registry = getArtifactRegistry();

  // ── GET /artifacts/types ──────────────────────────────────────
  // List all registered artifact types and their capabilities
  router.get("/artifacts/types", (_req: Request, res: Response): void => {
    const types = registry.getRegisteredTypes().map((type) => {
      const handler = registry.getHandler(type);
      return {
        type,
        displayName: handler?.displayName ?? type,
        extensions: handler?.extensions ?? [],
      };
    });
    res.json({ types });
  });

  // ── GET /artifacts/view/:id & GET /artifacts/:id ───────────────
  // Fetch social artifact view by ID (supports direct workbench & viewer hydration)
  router.get(["/artifacts/view/:id", "/artifacts/:id"], optionalAuth, (req: Request, res: Response): void => {
    const rawId = param(req, "id");
    if (!rawId || !/^\d+$/.test(rawId)) {
      res.status(400).json({ error: "Invalid artifact ID" });
      return;
    }

    const embedToken =
      (typeof req.query["embed_token"] === "string" ? req.query["embed_token"] : undefined) ||
      (typeof req.headers["x-embed-token"] === "string" ? req.headers["x-embed-token"] : undefined);

    let hasValidEmbedToken = false;
    if (embedToken) {
      const verification = verifySignedEmbedToken(embedToken, rawId, req.headers.origin);
      if (!verification.valid) {
        res.status(403).json({ error: verification.reason || "Invalid embed token" });
        return;
      }
      hasValidEmbedToken = true;
    }

    const artifactView = database.getArtifactView(rawId);
    if (!artifactView) {
      res.status(404).json({ error: "Artifact view not found" });
      return;
    }

    // Access control: check if artifact view is private
    let isPrivate = false;
    try {
      const parsedConfig = JSON.parse(artifactView.view_config || "{}");
      if (
        parsedConfig.private === true ||
        parsedConfig.visibility === "private" ||
        parsedConfig.visibility === "direct"
      ) {
        isPrivate = true;
      }
    } catch {
      // ignore
    }

    if (isPrivate) {
      const reqUser = (
        req as Request & {
          user?: { id?: number; accountType?: string; role?: string; is_admin?: number } | undefined;
        }
      ).user;
      const isOwner = reqUser && reqUser.id === artifactView.creator_id;
      const isAdmin =
        reqUser && (reqUser.accountType === "admin" || reqUser.role === "admin" || reqUser.is_admin === 1);
      if (!hasValidEmbedToken && !isOwner && !isAdmin) {
        res.status(403).json({ error: "Access denied: private artifact" });
        return;
      }
    }

    res.json({ artifactView });
  });

  // In-memory rate limiting map for CAD conversions (60 req/min per IP)
  const cadConvertHits = new Map<string, number[]>();

  // ── GET /cad/convert ───────────────────────────────────────────
  // Fetch a STEP file, convert it to JSON (web-optimized), and cache it.
  router.get("/cad/convert", async (req: Request, res: Response) => {
    const clientIp = req.socket?.remoteAddress || req.ip || "unknown";
    const now = Date.now();
    const timestamps = (cadConvertHits.get(clientIp) || []).filter((t) => now - t < 60_000);
    if (timestamps.length >= 60) {
      res.status(429).json({ error: "Too many CAD conversion requests. Please try again later." });
      return;
    }
    timestamps.push(now);
    cadConvertHits.set(clientIp, timestamps);
    if (cadConvertHits.size > 10_000) {
      for (const [k, v] of cadConvertHits.entries()) {
        if (v.every((t) => now - t >= 60_000)) cadConvertHits.delete(k);
      }
    }

    const url = req.query["url"] as string;
    if (!url || typeof url !== "string" || url.length > 2048 || /[\0\r\n]/.test(url)) {
      res.status(400).json({ error: "Missing or invalid 'url' query parameter" });
      return;
    }

    try {
      const geometry = await convertStepToJson(url, database);
      res.json(geometry);
    } catch (err: unknown) {
      console.error("[CAD Convert]", err);
      res.status(500).json({ error: (err as Error).message || "Failed to convert CAD geometry" });
    }
  });

  // ── GET /packages/:name/:version/artifacts ────────────────────
  // List all artifacts for a package version (supports both unscoped and @scope/name)
  router.get(
    ["/packages/:name/:version/artifacts", "/packages/:scope/:name/:version/artifacts"],
    (req: Request, res: Response): void => {
      const scope = req.params["scope"] ? decodeURIComponent(param(req, "scope")) : "";
      const rawName = decodeURIComponent(param(req, "name"));
      const packageName = scope ? `${scope.startsWith("@") ? scope : `@${scope}`}/${rawName}` : rawName;
      const version = param(req, "version");

      if (!packageName || !version) {
        res.status(400).json({ error: "Package name and version required" });
        return;
      }

      const pkg = database.getPackage(packageName);
      if (!pkg) {
        res.status(404).json({ error: "Package not found" });
        return;
      }

      const versionRow = database.getPackageVersion(pkg.id, version);
      if (!versionRow) {
        res.status(404).json({ error: "Version not found" });
        return;
      }

      const encodedPkgPath = packageName.startsWith("@")
        ? packageName
            .split("/")
            .map((s) => encodeURIComponent(s))
            .join("/")
        : encodeURIComponent(packageName);
      const encodedVer = encodeURIComponent(version);

      const artifacts = database.getArtifacts(versionRow.id);

      const enriched = artifacts.map((artifact) => {
        const meta = artifact.metadata ? (JSON.parse(artifact.metadata) as Record<string, unknown>) : {};
        const handler = registry.getHandler(artifact.type);
        const resourceUrl = `/api/v1/libraries/${encodedPkgPath}/${encodedVer}/resources/${artifact.path}`;

        // Build a view descriptor if a handler exists
        let viewer = null;
        if (handler) {
          viewer = handler.getViewDescriptor({
            type: artifact.type,
            path: artifact.path,
            details: meta,
          });
          if (viewer) {
            viewer = {
              ...viewer,
              config: {
                url: resourceUrl,
                resourceUrl,
                packageName,
                version,
                ...viewer.config,
                ...(typeof viewer.config?.["codeUrl"] === "string" && !viewer.config["codeUrl"].startsWith("/")
                  ? { codeUrl: resourceUrl }
                  : {}),
                ...(typeof viewer.config?.["spec"] === "string" && !viewer.config["spec"].startsWith("/")
                  ? { spec: resourceUrl }
                  : {}),
              },
            };
          }
        }

        return {
          id: artifact.id,
          type: artifact.type,
          path: artifact.path,
          displayName: handler?.displayName ?? artifact.type,
          metadata: meta,
          viewer,
        };
      });

      res.json({ artifacts: enriched });
    },
  );

  // ── GET /packages/:name/:version/artifacts/:id ────────────────
  // Get detailed artifact info with viewer configuration
  router.get(
    ["/packages/:name/:version/artifacts/:id", "/packages/:scope/:name/:version/artifacts/:id"],
    (req: Request, res: Response): void => {
      const scope = req.params["scope"] ? decodeURIComponent(param(req, "scope")) : "";
      const rawName = decodeURIComponent(param(req, "name"));
      const packageName = scope ? `${scope.startsWith("@") ? scope : `@${scope}`}/${rawName}` : rawName;
      const version = param(req, "version");
      const artifactId = parseInt(param(req, "id"), 10);

      if (!packageName || !version || isNaN(artifactId)) {
        res.status(400).json({ error: "Package name, version, and artifact ID required" });
        return;
      }

      const embedToken =
        (typeof req.query["embed_token"] === "string" ? req.query["embed_token"] : undefined) ||
        (typeof req.headers["x-embed-token"] === "string" ? req.headers["x-embed-token"] : undefined);
      if (embedToken) {
        const verification = verifySignedEmbedToken(embedToken, String(artifactId), req.headers.origin);
        if (!verification.valid) {
          res.status(403).json({ error: verification.reason || "Invalid embed token" });
          return;
        }
      }

      const pkg = database.getPackage(packageName);
      if (!pkg) {
        res.status(404).json({ error: "Package not found" });
        return;
      }

      const versionRow = database.getPackageVersion(pkg.id, version);
      if (!versionRow) {
        res.status(404).json({ error: "Version not found" });
        return;
      }

      const artifacts = database.getArtifacts(versionRow.id);
      const artifact = artifacts.find((a) => a.id === artifactId);
      if (!artifact) {
        res.status(404).json({ error: "Artifact not found" });
        return;
      }

      const encodedPkgPath = packageName.startsWith("@")
        ? packageName
            .split("/")
            .map((s) => encodeURIComponent(s))
            .join("/")
        : encodeURIComponent(packageName);
      const encodedVer = encodeURIComponent(version);
      const resourceUrl = `/api/v1/libraries/${encodedPkgPath}/${encodedVer}/resources/${artifact.path}`;

      const meta = artifact.metadata ? (JSON.parse(artifact.metadata) as Record<string, unknown>) : {};
      const handler = registry.getHandler(artifact.type);

      let viewer = null;
      if (handler) {
        viewer = handler.getViewDescriptor({
          type: artifact.type,
          path: artifact.path,
          details: meta,
        });
        if (viewer) {
          viewer = {
            ...viewer,
            config: {
              url: resourceUrl,
              resourceUrl,
              packageName,
              version,
              ...viewer.config,
            },
          };
        }
      }

      res.json({
        id: artifact.id,
        type: artifact.type,
        path: artifact.path,
        displayName: handler?.displayName ?? artifact.type,
        metadata: meta,
        viewer,
      });
    },
  );

  return router;
}
