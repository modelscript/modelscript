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

  // ── GET /cad/convert ───────────────────────────────────────────
  // Fetch a STEP file, convert it to JSON (web-optimized), and cache it.
  router.get("/cad/convert", async (req: Request, res: Response) => {
    const url = req.query["url"] as string;
    if (!url) {
      res.status(400).json({ error: "Missing 'url' query parameter" });
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
