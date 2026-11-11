// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Request, Response, Router } from "express";
import { Router as createRouter } from "express";

import type { LibraryDatabase, RegistryCatalogItem } from "../database.js";
import type { LibraryStorage } from "../storage.js";

const MAX_INLINE_SVG_ITEMS = 80;

export interface StreamedRegistryCatalogEntry extends RegistryCatalogItem {
  iconUrl: string;
  diagramUrl: string;
  classUrl: string;
  iconSvg?: string | undefined;
  diagramSvg?: string | undefined;
}

function buildLibraryClassPath(packageName: string, packageVersion: string, fqn: string): string {
  const encVer = encodeURIComponent(packageVersion);
  const encClass = encodeURIComponent(fqn);
  if (packageName.startsWith("@") && packageName.includes("/")) {
    const slashIdx = packageName.indexOf("/");
    const scope = packageName.slice(0, slashIdx);
    const base = packageName.slice(slashIdx + 1);
    return `/api/v1/libraries/${encodeURIComponent(scope)}/${encodeURIComponent(base)}/${encVer}/classes/${encClass}`;
  }
  return `/api/v1/libraries/${encodeURIComponent(packageName)}/${encVer}/classes/${encClass}`;
}

export function sanitizeRegistrySvg(rawSvg: string): string {
  return rawSvg
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<foreignObject\b[\s\S]*?<\/foreignObject>/gi, "")
    .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/(?:href|xlink:href)\s*=\s*(?:"javascript:[^"]*"|'javascript:[^']*')/gi, "");
}

function hasDistinctIconVisual(svg: string | null): svg is string {
  if (!svg || svg.includes('viewBox="0 0 120 80"')) return false;
  return (
    /<(line|circle|path|polygon|polyline|ellipse|image)\b/i.test(svg) ||
    /url\(#/i.test(svg) ||
    /<text\b[^>]*>(?:(?!<\/?text\b)[^<])+<\/text>/i.test(svg) ||
    /<rect\b[^>]*\b(?:rx="[^0]|ry="[^0]|fill="url\(#|width="(?!200(?:\.0+)?")[^"]+"|height="(?!200(?:\.0+)?")[^"]+)/i.test(
      svg,
    )
  );
}

function resolveInlineIconSvg(
  storage: LibraryStorage,
  database: LibraryDatabase,
  packageName: string,
  packageVersion: string,
  fqn: string,
): string | undefined {
  const direct = storage.readSvg(packageName, packageVersion, fqn, "icon");
  if (hasDistinctIconVisual(direct)) {
    return sanitizeRegistrySvg(direct);
  }

  const cls = database.getClass(packageName, packageVersion, fqn);
  if (cls?.extends && cls.extends.length > 0) {
    for (const baseClass of cls.extends) {
      const baseSvg = storage.readSvg(packageName, packageVersion, baseClass, "icon");
      if (hasDistinctIconVisual(baseSvg)) {
        return sanitizeRegistrySvg(baseSvg);
      }
    }
  }
  return undefined;
}

function resolveInlineDiagramSvg(
  storage: LibraryStorage,
  packageName: string,
  packageVersion: string,
  fqn: string,
): string | undefined {
  const raw = storage.readSvg(packageName, packageVersion, fqn, "diagram");
  if (!raw || raw.includes("«") || raw.includes('viewBox="0 0 680 240"')) {
    return undefined;
  }
  if (!/<(line|rect|circle|path|polygon|polyline|ellipse|text|image)\b/i.test(raw)) {
    return undefined;
  }
  return sanitizeRegistrySvg(raw);
}

function parsePositiveInt(raw: unknown, fallback: number): number {
  if (typeof raw !== "string" || raw.trim().length === 0) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseBoolParam(raw: unknown): boolean {
  if (typeof raw !== "string") return false;
  const lower = raw.trim().toLowerCase();
  return lower === "1" || lower === "true" || lower === "yes";
}

/**
 * Cross-package Ansatz Registry streaming endpoints for Component & Library Hub
 * (`GET /api/v1/components`) and Open Model Hub (`GET /api/v1/models`).
 */
export function registryCatalogRouter(storage: LibraryStorage, database: LibraryDatabase): Router {
  const router = createRouter();

  router.get("/components", (req: Request, res: Response): void => {
    const q = typeof req.query["q"] === "string" ? req.query["q"] : undefined;
    const domain = typeof req.query["domain"] === "string" ? req.query["domain"] : undefined;
    const packageName = typeof req.query["package"] === "string" ? req.query["package"] : undefined;
    const subpackage = typeof req.query["subpackage"] === "string" ? req.query["subpackage"] : undefined;
    const kind = typeof req.query["kind"] === "string" ? req.query["kind"] : undefined;
    const limit = parsePositiveInt(req.query["limit"], 72);
    const offset = parsePositiveInt(req.query["offset"], 0);
    const includeSvg = parseBoolParam(req.query["includeSvg"]);

    const queryRes = database.queryRegistryCatalog({
      mode: "components",
      q,
      domain,
      packageName,
      subpackage,
      kind,
      limit,
      offset,
    });

    const components: StreamedRegistryCatalogEntry[] = queryRes.items.map((item, idx) => {
      const classUrl = buildLibraryClassPath(item.packageName, item.packageVersion, item.fqn);
      const iconSvg =
        includeSvg && idx < MAX_INLINE_SVG_ITEMS
          ? resolveInlineIconSvg(storage, database, item.packageName, item.packageVersion, item.fqn)
          : undefined;

      return {
        ...item,
        hasIcon: item.hasIcon || Boolean(iconSvg),
        classUrl,
        iconUrl: `${classUrl}/icon.svg`,
        diagramUrl: `${classUrl}/diagram.svg`,
        ...(iconSvg ? { iconSvg } : {}),
      };
    });

    res.setHeader("Cache-Control", "public, max-age=15");
    res.json({
      total: queryRes.total,
      offset: queryRes.offset,
      limit: queryRes.limit,
      hasMore: queryRes.hasMore,
      items: components,
      components,
      availablePackages: queryRes.availablePackages,
      availableSubpackages: queryRes.availableSubpackages,
      packageDependencies: queryRes.packageDependencies,
    });
  });

  router.get("/models", (req: Request, res: Response): void => {
    const q = typeof req.query["q"] === "string" ? req.query["q"] : undefined;
    const domain = typeof req.query["domain"] === "string" ? req.query["domain"] : undefined;
    const packageName = typeof req.query["package"] === "string" ? req.query["package"] : undefined;
    const subpackage = typeof req.query["subpackage"] === "string" ? req.query["subpackage"] : undefined;
    const kind = typeof req.query["kind"] === "string" ? req.query["kind"] : undefined;
    const limit = parsePositiveInt(req.query["limit"], 48);
    const offset = parsePositiveInt(req.query["offset"], 0);
    const includeSvg = parseBoolParam(req.query["includeSvg"]);

    const queryRes = database.queryRegistryCatalog({
      mode: "models",
      q,
      domain,
      packageName,
      subpackage,
      kind,
      limit,
      offset,
    });

    const models: StreamedRegistryCatalogEntry[] = queryRes.items.map((item, idx) => {
      const classUrl = buildLibraryClassPath(item.packageName, item.packageVersion, item.fqn);
      const diagramSvg =
        includeSvg && idx < MAX_INLINE_SVG_ITEMS
          ? resolveInlineDiagramSvg(storage, item.packageName, item.packageVersion, item.fqn)
          : undefined;
      const iconSvg =
        includeSvg && !diagramSvg && idx < MAX_INLINE_SVG_ITEMS
          ? resolveInlineIconSvg(storage, database, item.packageName, item.packageVersion, item.fqn)
          : undefined;

      return {
        ...item,
        hasDiagram: item.hasDiagram || Boolean(diagramSvg),
        hasIcon: item.hasIcon || Boolean(iconSvg),
        classUrl,
        iconUrl: `${classUrl}/icon.svg`,
        diagramUrl: `${classUrl}/diagram.svg`,
        ...(diagramSvg ? { diagramSvg } : {}),
        ...(iconSvg ? { iconSvg } : {}),
      };
    });

    res.setHeader("Cache-Control", "public, max-age=15");
    res.json({
      total: queryRes.total,
      offset: queryRes.offset,
      limit: queryRes.limit,
      hasMore: queryRes.hasMore,
      items: models,
      models,
      availablePackages: queryRes.availablePackages,
      availableSubpackages: queryRes.availableSubpackages,
      packageDependencies: queryRes.packageDependencies,
    });
  });

  return router;
}
