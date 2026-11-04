// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Dynamic OpenGraph Preview Image Route
 *
 * Provides real-time, deterministic 1200x630 vector preview cards for:
 *   - /api/v1/og/post/:id
 *   - /api/v1/og/package/:scope?/:name
 *   - /api/v1/og/class/:scope?/:name/:version/:className
 */

import type { Request, Response, Router } from "express";
import { Router as createRouter } from "express";
import type { LibraryDatabase } from "../database.js";
import { renderClassOgSvg, renderPackageOgSvg, renderPostOgSvg } from "../util/og-renderer.js";
import { resolveRequestHost } from "../util/seo-injector.js";
import { isCorporateOrAirgapTier } from "../util/tier-presets.js";

export function ogRouter(database: LibraryDatabase): Router {
  const router = createRouter();

  function getParam(param: string | string[] | undefined): string {
    if (Array.isArray(param)) return param[0] || "";
    return param || "";
  }

  function getBaseContext(req: Request) {
    const settings = database.getInstanceSettings();
    const brandName = settings.instanceName || "Ansatz";
    const host = resolveRequestHost(req);
    const isCorporate = isCorporateOrAirgapTier(settings);
    return { brandName, host, isCorporate };
  }

  // ── Post OpenGraph Card ──
  const handlePostOg = (req: Request, res: Response): void => {
    const rawId = getParam(req.params["id"]).replace(/\.(svg|png)$/, "");
    if (!rawId || !rawId.trim()) {
      res.status(400).send("Invalid post ID");
      return;
    }
    const postId = rawId.trim();

    const { brandName, host, isCorporate } = getBaseContext(req);
    const rawPost = database.getPost(postId);
    const post =
      rawPost && (!rawPost.visibility || rawPost.visibility === "public" || rawPost.visibility === "unlisted")
        ? rawPost
        : undefined;

    let viewType: string | null = null;
    if (post?.artifact_view_id) {
      try {
        const art = database.getArtifactView(post.artifact_view_id);
        if (art?.view_type) viewType = art.view_type;
      } catch {
        // ignore
      }
    }

    const svg = renderPostOgSvg(
      post
        ? {
            id: post.id,
            title: post.title,
            content: post.content,
            username: post.username,
            display_name: post.display_name,
            created_at: post.created_at,
            thumbnail_url: post.thumbnail_url,
            artifact_view_id: post.artifact_view_id,
            view_type: viewType,
            like_count: post.like_count,
            reply_count: post.reply_count,
          }
        : {
            id: postId,
            title: `${brandName} Engineering Simulation`,
            content: "Interactive physical modeling and cyber-physical systems simulation.",
          },
      host,
      brandName,
    );

    res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
    res.setHeader(
      "Cache-Control",
      isCorporate ? "private, no-store" : "public, max-age=86400, stale-while-revalidate=604800",
    );
    res.send(svg);
  };

  router.get("/post/:id", handlePostOg);

  // ── Package OpenGraph Card ──
  const handlePackageOg = (req: Request, res: Response): void => {
    const scope = getParam(req.params["scope"]);
    let name = getParam(req.params["name"]).replace(/\.(svg|png)$/, "");
    if (!name) {
      res.status(400).send("Missing package name");
      return;
    }
    const fullPkgName = scope ? `${scope}/${name}` : name;
    const { brandName, host, isCorporate } = getBaseContext(req);

    const pkg = database.getPackage(fullPkgName);
    const versions = pkg ? database.getPackageVersions(pkg.id) : [];
    const latestVersion = versions.length > 0 ? versions[versions.length - 1] : undefined;
    const classCount = latestVersion ? database.getClassCount(fullPkgName, latestVersion.version) : 0;

    const svg = renderPackageOgSvg(
      {
        name: fullPkgName,
        version: latestVersion?.version || "1.0.0",
        description: pkg?.description,
        license: pkg?.license || "AGPL-3.0-or-later",
        class_count: classCount,
        downloads_count: 142,
      },
      host,
      brandName,
    );

    res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
    res.setHeader(
      "Cache-Control",
      isCorporate ? "private, no-store" : "public, max-age=86400, stale-while-revalidate=604800",
    );
    res.send(svg);
  };

  router.get("/package/:scope/:name", handlePackageOg);
  router.get("/package/:name", handlePackageOg);

  // ── Class Specification OpenGraph Card ──
  const handleClassOg = (req: Request, res: Response): void => {
    const scope = getParam(req.params["scope"]);
    const rawName = getParam(req.params["name"]);
    const version = getParam(req.params["version"]);
    let className = getParam(req.params["className"]).replace(/\.(svg|png)$/, "");

    if (!rawName || !version || !className) {
      res.status(400).send("Missing package name, version, or class name");
      return;
    }
    const fullPkgName = scope ? `${scope}/${rawName}` : rawName;
    const { brandName, host, isCorporate } = getBaseContext(req);

    const cls = database.getClass(fullPkgName, version, className);

    const svg = renderClassOgSvg(
      {
        className,
        classKind: cls?.classKind || "model",
        description: cls?.description,
        documentation: cls?.documentation,
        packageName: fullPkgName,
        packageVersion: version,
        extends: cls?.extends || [],
        components: cls?.components || [],
      },
      host,
      brandName,
    );

    res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
    res.setHeader(
      "Cache-Control",
      isCorporate ? "private, no-store" : "public, max-age=86400, stale-while-revalidate=604800",
    );
    res.send(svg);
  };

  router.get("/class/:scope/:name/:version/:className", handleClassOg);
  router.get("/class/:name/:version/:className", handleClassOg);

  return router;
}
