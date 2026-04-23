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

  // ── GET /packages/:name/:version/artifacts ────────────────────
  // List all artifacts for a package version
  router.get("/packages/:name/:version/artifacts", (req: Request, res: Response): void => {
    const packageName = decodeURIComponent(param(req, "name"));
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

    const artifacts = database.getArtifacts(versionRow.id);

    const enriched = artifacts.map((artifact) => {
      const meta = artifact.metadata ? (JSON.parse(artifact.metadata) as Record<string, unknown>) : {};
      const handler = registry.getHandler(artifact.type);

      // Build a view descriptor if a handler exists
      let viewer = null;
      if (handler) {
        viewer = handler.getViewDescriptor({
          type: artifact.type,
          path: artifact.path,
          details: meta,
        });
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
  });

  // ── GET /packages/:name/:version/artifacts/:id ────────────────
  // Get detailed artifact info with viewer configuration
  router.get("/packages/:name/:version/artifacts/:id", (req: Request, res: Response): void => {
    const packageName = decodeURIComponent(param(req, "name"));
    const version = param(req, "version");
    const artifactId = parseInt(param(req, "id"), 10);

    if (!packageName || !version || isNaN(artifactId)) {
      res.status(400).json({ error: "Package name, version, and artifact ID required" });
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

    const artifacts = database.getArtifacts(versionRow.id);
    const artifact = artifacts.find((a) => a.id === artifactId);
    if (!artifact) {
      res.status(404).json({ error: "Artifact not found" });
      return;
    }

    const meta = artifact.metadata ? (JSON.parse(artifact.metadata) as Record<string, unknown>) : {};
    const handler = registry.getHandler(artifact.type);

    let viewer = null;
    if (handler) {
      viewer = handler.getViewDescriptor({
        type: artifact.type,
        path: artifact.path,
        details: meta,
      });
    }

    res.json({
      id: artifact.id,
      type: artifact.type,
      path: artifact.path,
      displayName: handler?.displayName ?? artifact.type,
      metadata: meta,
      viewer,
    });
  });

  return router;
}
