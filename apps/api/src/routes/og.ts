// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Dynamic OpenGraph Preview Image Route
 *
 * Provides real-time, deterministic 1200x630 vector preview cards and raster PNGs for:
 *   - /api/v1/og/post/:id(.png)?
 *   - /api/v1/og/package/:scope?/:name(.png)?
 *   - /api/v1/og/class/:scope?/:name/:version/:className(.png)?
 *   - /api/v1/og/brand(.png)?
 */

import { Resvg } from "@resvg/resvg-js";
import type { Request, Response, Router } from "express";
import { Router as createRouter } from "express";
import type { LibraryDatabase } from "../database.js";
import { renderBrandOgSvg, renderClassOgSvg, renderPackageOgSvg, renderPostOgSvg } from "../util/og-renderer.js";
import { resolveRequestHost } from "../util/seo-injector.js";
import { isCorporateOrAirgapTier } from "../util/tier-presets.js";

const pngCache = new Map<string, Buffer>();
const MAX_PNG_CACHE = 250;

function convertSvgToPng(svg: string): Buffer {
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: 1200 },
    font: { loadSystemFonts: false },
  });
  return resvg.render().asPng();
}

function sendOgResponse(
  _req: Request,
  res: Response,
  svg: string,
  cacheKey: string,
  isPngRequested: boolean,
  isCorporate: boolean,
): void {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader(
    "Cache-Control",
    isCorporate ? "private, no-store" : "public, max-age=86400, stale-while-revalidate=604800",
  );

  if (isPngRequested) {
    let png = pngCache.get(cacheKey);
    if (!png) {
      try {
        png = convertSvgToPng(svg);
        if (pngCache.size >= MAX_PNG_CACHE) {
          const firstKey = pngCache.keys().next().value;
          if (firstKey) pngCache.delete(firstKey);
        }
        pngCache.set(cacheKey, png);
      } catch (err) {
        console.error("[OG] Failed to render SVG to PNG:", err);
      }
    }

    if (png) {
      res.setHeader("Content-Type", "image/png");
      res.setHeader("Content-Length", String(png.length));
      res.send(png);
      return;
    }
  }

  res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
  res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'");
  res.send(svg);
}

function isPngTarget(paramName: string, req: Request): boolean {
  if (paramName.endsWith(".png")) return true;
  if (req.query["format"] === "png") return true;
  const accept = req.headers["accept"] || "";
  if (accept.includes("image/png") && !accept.includes("image/svg+xml")) return true;
  return false;
}

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

  // ── Brand OpenGraph Card ──
  const handleBrandOg = (req: Request, res: Response): void => {
    const { brandName, host, isCorporate } = getBaseContext(req);
    const isPng = req.path.endsWith(".png") || req.query["format"] === "png";
    const svg = renderBrandOgSvg(host, brandName);
    sendOgResponse(req, res, svg, `brand:${brandName}`, isPng, isCorporate);
  };

  router.get("/brand", handleBrandOg);
  router.get("/brand.png", handleBrandOg);

  // ── Post OpenGraph Card ──
  const handlePostOg = (req: Request, res: Response): void => {
    const rawParam = getParam(req.params["id"]);
    const isPng = isPngTarget(rawParam, req);
    const rawId = rawParam.replace(/\.(svg|png)$/, "");
    if (!rawId || !/^[a-zA-Z0-9_-]+$/.test(rawId.trim())) {
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

    if (!post) {
      res.status(404).send("Post not found");
      return;
    }

    let viewType: string | null = null;
    if (post.artifact_view_id) {
      try {
        const art = database.getArtifactView(post.artifact_view_id);
        if (art?.view_type) viewType = art.view_type;
      } catch {
        // ignore
      }
    }

    const svg = renderPostOgSvg(
      {
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
      },
      host,
      brandName,
    );

    sendOgResponse(req, res, svg, `post:${postId}`, isPng, isCorporate);
  };

  router.get("/post/:id", handlePostOg);

  // ── Package OpenGraph Card ──
  const handlePackageOg = (req: Request, res: Response): void => {
    const scope = getParam(req.params["scope"]);
    const rawParam = getParam(req.params["name"]);
    const isPng = isPngTarget(rawParam, req);
    const name = rawParam.replace(/\.(svg|png)$/, "");
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
    const downloadStats = database.getPackageStats(fullPkgName);

    const svg = renderPackageOgSvg(
      {
        name: fullPkgName,
        version: latestVersion?.version || "1.0.0",
        description: pkg?.description,
        license: pkg?.license || "AGPL-3.0-or-later",
        class_count: classCount,
        downloads_count: downloadStats.totalDownloads,
      },
      host,
      brandName,
    );

    sendOgResponse(req, res, svg, `package:${fullPkgName}`, isPng, isCorporate);
  };

  router.get("/package/:scope/:name", handlePackageOg);
  router.get("/package/:name", handlePackageOg);

  // ── Class Specification OpenGraph Card ──
  const handleClassOg = (req: Request, res: Response): void => {
    const scope = getParam(req.params["scope"]);
    const rawName = getParam(req.params["name"]);
    const version = getParam(req.params["version"]);
    const rawClassParam = getParam(req.params["className"]);
    const isPng = isPngTarget(rawClassParam, req);
    const className = rawClassParam.replace(/\.(svg|png)$/, "");

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

    sendOgResponse(req, res, svg, `class:${fullPkgName}:${version}:${className}`, isPng, isCorporate);
  };

  router.get("/class/:scope/:name/:version/:className", handleClassOg);
  router.get("/class/:name/:version/:className", handleClassOg);

  return router;
}
