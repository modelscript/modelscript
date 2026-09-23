// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Request, Response, Router } from "express";
import { Router as createRouter } from "express";
import fs from "node:fs";
import path from "node:path";
import semver from "semver";

import {
  type AasxFileEntry,
  type CanonicalWorkspaceManifest,
  ManifestLensEngine,
  OpcAasxPackager,
  VariantResolver,
} from "@modelscript/exchange";
import type { LibraryDatabase } from "../database.js";
import type { JobQueue } from "../jobs.js";
import type { LibraryStorage } from "../storage.js";
import { parsePackageMo } from "../util/package-mo.js";
import { extractPackageMoFromZip } from "../util/zip.js";

function isValidPackageName(name: string): boolean {
  return /^[a-zA-Z0-9_.-]+$/.test(name);
}

function safeUpstreamUrl(pathname: string): URL {
  const base = process.env.UPSTREAM_HUB || "https://hub.modelscript.org";
  const url = new URL(pathname, base);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Invalid protocol for upstream hub");
  }
  return url;
}

function walkDir(dir: string, callback: (relPath: string, content: string) => void, baseDir = dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkDir(fullPath, callback, baseDir);
    } else {
      const relPath = path.relative(baseDir, fullPath).replace(/\\/g, "/");
      const content = fs.readFileSync(fullPath, "utf-8");
      callback(relPath, content);
    }
  }
}

async function resolveCanonicalManifest(
  storage: LibraryStorage,
  database: LibraryDatabase,
  name: string,
  version: string,
): Promise<{ manifest: CanonicalWorkspaceManifest; extractedDir: string | null }> {
  let extractedDir: string | null = null;
  try {
    extractedDir = await storage.extractLibrary(name, version);
  } catch {
    const p = storage.getExtractedPath(name, version);
    if (fs.existsSync(p)) extractedDir = p;
  }

  // 1. Look for modelscript.json in extracted dir
  if (extractedDir) {
    const msJsonPath = path.join(extractedDir, "modelscript.json");
    if (fs.existsSync(msJsonPath)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(msJsonPath, "utf-8")) as CanonicalWorkspaceManifest;
        return { manifest: parsed, extractedDir };
      } catch {
        // Fall through
      }
    }

    const okhJsonPath = path.join(extractedDir, "okh.json");
    if (fs.existsSync(okhJsonPath)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(okhJsonPath, "utf-8"));
        return {
          manifest: {
            globalAssetId: parsed.globalAssetId ?? `urn:modelscript:${name}`,
            idShort: parsed.name ?? name,
            title: parsed.title ?? name,
            version: parsed.version ?? version,
            description: parsed.description,
            license: parsed.license,
            bom: Array.isArray(parsed.bom) ? parsed.bom : undefined,
            makingInstructions: parsed["making-instructions"],
          },
          extractedDir,
        };
      } catch {
        // Fall through
      }
    }

    const pkgJsonPath = path.join(extractedDir, "package.json");
    if (fs.existsSync(pkgJsonPath)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(pkgJsonPath, "utf-8"));
        const scope = parsed.name?.startsWith("@") ? parsed.name.split("/")[0] : undefined;
        const idShort = parsed.name?.startsWith("@") ? parsed.name.split("/")[1] : (parsed.name ?? name);
        return {
          manifest: {
            globalAssetId: parsed.modelscript?.globalAssetId ?? `urn:modelscript:${parsed.name ?? name}`,
            idShort,
            title: parsed.title ?? parsed.description ?? idShort,
            version: parsed.version ?? version,
            scope,
            description: parsed.description,
            license: parsed.license,
            homepage: parsed.homepage,
            repository: parsed.repository,
            scripts: parsed.scripts,
          },
          extractedDir,
        };
      } catch {
        // Fall through
      }
    }
  }

  // Fallback: Synthesize from package record
  const pkgRecord = database.getPackage(name);
  const scope = name.startsWith("@") ? name.split("/")[0] : undefined;
  const idShort = (name.startsWith("@") ? name.split("/")[1] : name) || name;

  return {
    manifest: {
      globalAssetId: `urn:modelscript:${name}`,
      idShort,
      title: pkgRecord?.description ?? idShort,
      version,
      scope,
      description: pkgRecord?.description ?? undefined,
      license: pkgRecord?.license ?? "UNLICENSED",
      homepage: pkgRecord?.homepage ?? undefined,
      repository: pkgRecord?.repository_url
        ? { type: pkgRecord.repository_type ?? "git", url: pkgRecord.repository_url }
        : undefined,
    },
    extractedDir,
  };
}

export function packagesRouter(storage: LibraryStorage, jobQueue: JobQueue, database: LibraryDatabase): Router {
  const router = createRouter();

  /**
   * GET /api/v1/libraries
   *
   * List all published packages with their versions.
   * Supports an optional `?q=` query parameter
   * for case-insensitive substring filtering on the package name.
   */
  router.get("/", (req: Request, res: Response): void => {
    const q = req.query["q"];
    const query = typeof q === "string" ? q : undefined;
    const names = storage.list(query);
    const packages = names.map((name) => {
      const versions = storage.versions(name);
      const latestVersion = versions[0] || null;
      let jobStatus = null;
      if (latestVersion) {
        const status = jobQueue.getStatus(`${name}@${latestVersion}`);
        if (status) {
          jobStatus = {
            status: status.status,
            classesProcessed: status.classesProcessed,
            error: status.error,
          };
        }
      }
      return {
        name,
        versions,
        latestVersion,
        jobStatus,
      };
    });
    res.json({ packages });
  });

  /**
   * GET /api/v1/libraries/:name
   *
   * List all versions for a given package, sorted descending by semver.
   */
  router.get("/:name", async (req: Request, res: Response): Promise<void> => {
    const name = req.params["name"];
    if (typeof name !== "string" || !isValidPackageName(name)) {
      res.status(400).json({ error: "Package name is required" });
      return;
    }

    const versions = storage.versions(name);
    if (versions.length === 0) {
      // FEDERATION: Proxy list from upstream
      try {
        const upstreamUrl = safeUpstreamUrl(`/api/v1/libraries/${encodeURIComponent(name)}`);
        const upstreamRes = await fetch(upstreamUrl.toString());
        if (upstreamRes.ok) {
          const data = await upstreamRes.json();
          res.json(data);
          return;
        }
      } catch {
        // Fall through
      }

      res.status(404).json({ error: `Package "${name}" not found` });
      return;
    }

    res.json({ name, versions });
  });

  /**
   * GET /api/v1/libraries/:name/:version
   *
   * Get details for a specific package version, including metadata parsed
   * from the zip's package.mo file.
   */
  router.get("/:name/:version", async (req: Request, res: Response): Promise<void> => {
    const name = req.params["name"];
    const version = req.params["version"];

    if (typeof name !== "string" || typeof version !== "string" || !isValidPackageName(name)) {
      res.status(400).json({ error: "Package name and version are required" });
      return;
    }

    if (!semver.valid(version)) {
      res.status(400).json({ error: `Invalid semantic version: "${version}"` });
      return;
    }

    const file = storage.read(name, version);
    if (!file) {
      // FEDERATION: Proxy metadata from upstream
      try {
        const upstreamUrl = safeUpstreamUrl(
          `/api/v1/libraries/${encodeURIComponent(name)}/${encodeURIComponent(version)}`,
        );
        const upstreamRes = await fetch(upstreamUrl.toString());
        if (upstreamRes.ok) {
          const data = await upstreamRes.json();
          res.json(data);
          return;
        }
      } catch {
        // Fall through
      }

      res.status(404).json({ error: `Package "${name}@${version}" not found` });
      return;
    }

    try {
      const packageMoContent = await extractPackageMoFromZip(file.buffer);
      const parsed = parsePackageMo(packageMoContent);

      res.json({
        name,
        version,
        description: parsed.description,
        modelicaVersion: parsed.version,
        size: file.size,
      });
    } catch {
      // If we cannot parse the zip, still return basic info
      res.json({
        name,
        version,
        description: null,
        modelicaVersion: null,
        size: file.size,
      });
    }
  });

  /**
   * GET /api/v1/libraries/:name/:version/files
   *
   * Get all .mo files extracted for a specific package version.
   * This allows the LSP to download all source files without a zip.
   */
  router.get("/:name/:version/files", async (req: Request, res: Response): Promise<void> => {
    const name = req.params["name"];
    const version = req.params["version"];
    const isStream = req.query["stream"] === "true";

    if (typeof name !== "string" || typeof version !== "string") {
      res.status(400).json({ error: "Package name and version are required" });
      return;
    }

    const extractedDir = storage.getExtractedPath(name, version);
    if (!fs.existsSync(extractedDir)) {
      // FEDERATION: Proxy from upstream
      try {
        const upstreamUrl = safeUpstreamUrl(
          `/api/v1/libraries/${encodeURIComponent(name)}/${encodeURIComponent(version)}/files${isStream ? "?stream=true" : ""}`,
        );

        const upstreamRes = await fetch(upstreamUrl.toString());
        if (upstreamRes.ok) {
          if (isStream && upstreamRes.body) {
            res.setHeader("Content-Type", "application/x-ndjson");
            const { Readable } = await import("node:stream");
            Readable.fromWeb(upstreamRes.body as import("stream/web").ReadableStream).pipe(res);
            return;
          } else {
            const data = await upstreamRes.json();
            res.json(data);
            return;
          }
        }
      } catch {
        // Fall through
      }

      res.status(404).json({ error: "Library not extracted" });
      return;
    }

    if (isStream) {
      res.setHeader("Content-Type", "application/x-ndjson");
      walkDir(extractedDir, (relPath, content) => {
        if (relPath.endsWith(".mo")) {
          res.write(JSON.stringify({ [relPath]: content }) + "\n");
        }
      });
      res.end();
    } else {
      const files: Record<string, string> = {};
      walkDir(extractedDir, (relPath, content) => {
        if (relPath.endsWith(".mo")) {
          files[relPath] = content;
        }
      });
      res.json({ name, version, files });
    }
  });

  /**
   * GET /api/v1/libraries/:name/:version/download
   *
   * Download the zip file for a specific package version.
   */
  router.get("/:name/:version/download", async (req: Request, res: Response): Promise<void> => {
    const name = req.params["name"];
    const version = req.params["version"];

    if (typeof name !== "string" || typeof version !== "string") {
      res.status(400).json({ error: "Package name and version are required" });
      return;
    }

    if (!semver.valid(version)) {
      res.status(400).json({ error: `Invalid semantic version: "${version}"` });
      return;
    }

    const file = storage.read(name, version);
    if (!file) {
      // FEDERATION: Proxy download from upstream and cache it
      try {
        const upstreamUrl = safeUpstreamUrl(
          `/api/v1/libraries/${encodeURIComponent(name)}/${encodeURIComponent(version)}/download`,
        );
        const upstreamRes = await fetch(upstreamUrl.toString());
        if (upstreamRes.ok) {
          const buffer = await upstreamRes.arrayBuffer();
          const nodeBuffer = Buffer.from(buffer);

          // Cache locally
          try {
            await storage.store(name, version, nodeBuffer);
            // Also extract and compile locally for index parity
            const libraryPath = await storage.extractLibrary(name, version);
            const { fileURLToPath } = await import("node:url");
            const ext = import.meta.url.endsWith(".ts") ? ".ts" : ".js";
            const workerScript = fileURLToPath(new URL(`../publish-worker${ext}`, import.meta.url));
            jobQueue.enqueueProcess(`${name}@${version}`, workerScript, { name, version, libraryPath });
          } catch {
            // Ignore if it already exists or fails
          }

          res.setHeader("Content-Type", "application/zip");
          res.setHeader("Content-Disposition", `attachment; filename="${name}-${version}.zip"`);
          res.setHeader("Content-Length", nodeBuffer.length);
          res.send(nodeBuffer);
          return;
        }
      } catch {
        // Fall through
      }

      res.status(404).json({ error: `Package "${name}@${version}" not found` });
      return;
    }

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${name}-${version}.zip"`);
    res.setHeader("Content-Length", file.size);
    res.send(file.buffer);
  });

  function extractPkgAndVersion(req: Request): { name: string; version: string } {
    if (req.params["scope"] && req.params["name"]) {
      const scope = Array.isArray(req.params["scope"]) ? req.params["scope"][0] : req.params["scope"];
      const baseName = Array.isArray(req.params["name"]) ? req.params["name"][0] : req.params["name"];
      const version = Array.isArray(req.params["version"]) ? req.params["version"][0] : req.params["version"];
      return { name: `${scope}/${baseName}`, version: version ?? "" };
    }
    const rawName = Array.isArray(req.params["name"]) ? req.params["name"][0] : req.params["name"];
    const rawVersion = Array.isArray(req.params["version"]) ? req.params["version"][0] : req.params["version"];
    return { name: decodeURIComponent(rawName ?? ""), version: rawVersion ?? "" };
  }

  /**
   * GET /api/v1/libraries/:name/:version/manifest
   * GET /api/v1/libraries/:scope/:name/:version/manifest
   * Multi-projection manifest endpoint.
   * Supports ?lens=npm|aas|okh (default: npm) and optional ?variant=<variantId>.
   */
  router.get(
    ["/:name/:version/manifest", "/:scope/:name/:version/manifest"],
    async (req: Request, res: Response): Promise<void> => {
      const { name, version } = extractPkgAndVersion(req);
      const lens = (req.query["lens"] as string) || "npm";
      const variant = req.query["variant"] as string | undefined;

      if (!name || !version) {
        res.status(400).json({ error: "Package name and version are required" });
        return;
      }

      try {
        const { manifest } = await resolveCanonicalManifest(storage, database, name, version);
        const { resolvedManifest } = VariantResolver.resolveVariant(manifest, variant);

        if (lens === "aas") {
          res.json(ManifestLensEngine.projectToAasJson(resolvedManifest));
          return;
        }
        if (lens === "okh") {
          res.json(ManifestLensEngine.projectToOkhJson(resolvedManifest));
          return;
        }
        res.json(ManifestLensEngine.projectToPackageJson(resolvedManifest));
      } catch (err: unknown) {
        res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  /**
   * GET /api/v1/libraries/:name/:version/export/aasx
   * GET /api/v1/libraries/:scope/:name/:version/export/aasx
   * Materialize and export an Open Packaging Conventions (OPC) compliant .aasx container.
   * Cached on demand. Supports optional ?variant=<variantId>.
   */
  router.get(
    ["/:name/:version/export/aasx", "/:scope/:name/:version/export/aasx"],
    async (req: Request, res: Response): Promise<void> => {
      const { name, version } = extractPkgAndVersion(req);
      const variant = req.query["variant"] as string | undefined;

      if (!name || !version) {
        res.status(400).json({ error: "Package name and version are required" });
        return;
      }

      // Check cache if standard variant
      if (!variant) {
        const cached = storage.readCachedAasx(name, version);
        if (cached) {
          res.setHeader("Content-Type", "application/asset-administration-shell-package+json");
          res.setHeader("Content-Disposition", `attachment; filename="${name}-${version}.aasx"`);
          res.setHeader("Content-Length", cached.length);
          res.send(cached);
          return;
        }
      }

      try {
        const { manifest, extractedDir } = await resolveCanonicalManifest(storage, database, name, version);
        const { resolvedManifest } = VariantResolver.resolveVariant(manifest, variant);
        const aasJson = ManifestLensEngine.projectToAasJson(resolvedManifest);

        // Collect files from extracted directory
        const files: AasxFileEntry[] = [];
        if (extractedDir && fs.existsSync(extractedDir)) {
          walkDir(extractedDir, (relPath, content) => {
            files.push({ path: relPath, data: content });
          });
        }

        const aasxU8 = OpcAasxPackager.buildAasx({ aasJson, files });
        const nodeBuf = Buffer.from(aasxU8);

        if (!variant) {
          storage.storeCachedAasx(name, version, nodeBuf);
        }

        res.setHeader("Content-Type", "application/asset-administration-shell-package");
        res.setHeader("Content-Disposition", `attachment; filename="${name}-${version}.aasx"`);
        res.setHeader("Content-Length", nodeBuf.length);
        res.send(nodeBuf);
      } catch (err: unknown) {
        res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  /**
   * GET /api/v1/libraries/:name/:version/export/okh
   * GET /api/v1/libraries/:scope/:name/:version/export/okh
   * Export an Open Know-How (DIN SPEC 3105) compliant okh.json.
   */
  router.get(
    ["/:name/:version/export/okh", "/:scope/:name/:version/export/okh"],
    async (req: Request, res: Response): Promise<void> => {
      const { name, version } = extractPkgAndVersion(req);
      const variant = req.query["variant"] as string | undefined;

      if (!name || !version) {
        res.status(400).json({ error: "Package name and version are required" });
        return;
      }

      try {
        const { manifest } = await resolveCanonicalManifest(storage, database, name, version);
        const { resolvedManifest } = VariantResolver.resolveVariant(manifest, variant);
        const okhJson = ManifestLensEngine.projectToOkhJson(resolvedManifest);
        res.json(okhJson);
      } catch (err: unknown) {
        res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  /**
   * GET /api/v1/libraries/:name/:version/lsp-bundle
   *
   * Download the optimized pre-computed bundle for the LSP client.
   * Includes index.json, icons.json, and all .mo source files.
   */
  router.get("/:name/:version/lsp-bundle", async (req: Request, res: Response): Promise<void> => {
    const name = req.params["name"];
    const version = req.params["version"];

    if (typeof name !== "string" || typeof version !== "string") {
      res.status(400).json({ error: "Package name and version are required" });
      return;
    }

    const indexPath = storage.getIndexPath(name, version);
    const bundlePath = path.join(path.dirname(indexPath), "lsp-bundle.zip");

    if (!fs.existsSync(bundlePath)) {
      // FEDERATION: Proxy download from upstream and cache it
      try {
        const upstreamUrl = safeUpstreamUrl(
          `/api/v1/libraries/${encodeURIComponent(name)}/${encodeURIComponent(version)}/lsp-bundle`,
        );
        const upstreamRes = await fetch(upstreamUrl.toString());
        if (upstreamRes.ok) {
          const buffer = await upstreamRes.arrayBuffer();
          const nodeBuffer = Buffer.from(buffer);

          // We can optionally cache this bundle locally to serve subsequent requests faster
          fs.mkdirSync(path.dirname(bundlePath), { recursive: true });
          fs.writeFileSync(bundlePath, nodeBuffer);

          res.setHeader("Content-Type", "application/zip");
          res.setHeader("Content-Disposition", `attachment; filename="${name}-${version}-lsp-bundle.zip"`);
          res.setHeader("Content-Length", nodeBuffer.length);
          res.send(nodeBuffer);
          return;
        }
      } catch {
        // Fall through
      }

      res.status(404).json({ error: `LSP bundle not found for "${name}@${version}"` });
      return;
    }

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${name}-${version}-lsp-bundle.zip"`);
    res.sendFile(path.resolve(bundlePath));
  });

  /**
   * GET /api/v1/libraries/:name/:version/salsa-index.db
   *
   * Download the pre-computed Salsa query engine SQLite index for the package.
   */
  router.get("/:name/:version/salsa-index.db", (req: Request, res: Response): void => {
    const name = req.params["name"];
    const version = req.params["version"];

    if (typeof name !== "string" || typeof version !== "string") {
      res.status(400).json({ error: "Package name and version are required" });
      return;
    }

    const indexPath = storage.getIndexPath(name, version);
    if (!fs.existsSync(indexPath)) {
      res.status(404).json({ error: `Salsa index not found for "${name}@${version}"` });
      return;
    }

    res.setHeader("Content-Type", "application/vnd.sqlite3");
    res.setHeader("Content-Disposition", `attachment; filename="${name}-${version}-salsa-index.db"`);
    res.sendFile(path.resolve(indexPath));
  });

  /**
   * GET /api/v1/libraries/:name/:version/memos
   *
   * Federated API: Query specific memoized keys from the pre-computed salsa-index.db.
   * Query params: `keys` (comma-separated string of memo keys).
   */
  router.get("/:name/:version/memos", (req: Request, res: Response): void => {
    const name = req.params["name"];
    const version = req.params["version"];
    const keysParam = req.query["keys"];

    if (typeof name !== "string" || typeof version !== "string") {
      res.status(400).json({ error: "Package name and version are required" });
      return;
    }

    if (typeof keysParam !== "string" || !keysParam) {
      res.status(400).json({ error: "Missing 'keys' query parameter" });
      return;
    }

    const indexPath = storage.getIndexPath(name, version);
    if (!fs.existsSync(indexPath)) {
      res.status(404).json({ error: `Salsa index not found for "${name}@${version}"` });
      return;
    }

    const keys = keysParam.split(",");
    const result: Record<string, unknown> = {};

    try {
      // Import dynamically to avoid top-level better-sqlite3 requirement if not needed
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Database = require("better-sqlite3");
      const db = new Database(indexPath, { readonly: true });
      const stmt = db.prepare("SELECT data FROM memos WHERE key = ?");

      for (const key of keys) {
        const row = stmt.get(key) as { data: string } | undefined;
        if (row) {
          result[key] = JSON.parse(row.data);
        }
      }

      db.close();
      res.json({ memos: result });
    } catch {
      res.status(500).json({ error: "Failed to read salsa index" });
    }
  });

  /**
   * GET /api/v1/libraries/:name/:version/status
   *
   * Check the SVG generation job status for a library version.
   */
  router.get("/:name/:version/status", (req: Request, res: Response): void => {
    const name = req.params["name"];
    const version = req.params["version"];

    if (typeof name !== "string" || typeof version !== "string") {
      res.status(400).json({ error: "Package name and version are required" });
      return;
    }

    const jobKey = `${name}@${version}`;
    const status = jobQueue.getStatus(jobKey);

    if (!status) {
      res.status(404).json({ error: `No job found for "${jobKey}"` });
      return;
    }

    res.json({ name, version, ...status });
  });

  /**
   * GET /api/v1/libraries/:name/:version/classes
   *
   * List all classes for a library version. Supports optional
   * `?kind=` and `?q=` query parameters for filtering.
   */
  router.get("/:name/:version/classes", (req: Request, res: Response): void => {
    const name = req.params["name"];
    const version = req.params["version"];

    if (typeof name !== "string" || typeof version !== "string") {
      res.status(400).json({ error: "Package name and version are required" });
      return;
    }

    const kind = typeof req.query["kind"] === "string" ? req.query["kind"] : undefined;
    const q = typeof req.query["q"] === "string" ? req.query["q"] : undefined;

    const classes = database.getClasses(name, version, { kind, q });
    res.json({ name, version, classes });
  });

  /**
   * GET /api/v1/libraries/:name/:version/classes/:className
   *
   * Get details for a specific class, including extends and components.
   */
  router.get("/:name/:version/classes/:className", (req: Request, res: Response): void => {
    const name = req.params["name"];
    const version = req.params["version"];
    const className = req.params["className"];

    if (typeof name !== "string" || typeof version !== "string" || typeof className !== "string") {
      res.status(400).json({ error: "Package name, version, and class name are required" });
      return;
    }

    const cls = database.getClass(name, version, className);
    if (!cls) {
      res.status(404).json({ error: `Class "${className}" not found in ${name}@${version}` });
      return;
    }

    res.json({ name, version, className, ...cls });
  });

  /**
   * GET /api/v1/libraries/:name/:version/classes/:className/icon.svg
   *
   * Serve the icon SVG for a specific class.
   */
  router.get("/:name/:version/classes/:className/icon.svg", (req: Request, res: Response): void => {
    const name = req.params["name"];
    const version = req.params["version"];
    const className = req.params["className"];

    if (typeof name !== "string" || typeof version !== "string" || typeof className !== "string") {
      res.status(400).json({ error: "Package name, version, and class name are required" });
      return;
    }

    const svg = storage.readSvg(name, version, className, "icon");
    if (!svg) {
      res.status(204).end();
      return;
    }

    // Return 404 if the icon has no meaningful visual content
    const hasVisual = /<(line|rect|circle|path|polygon|polyline|ellipse|text|image)\b/i.test(svg);
    if (!hasVisual) {
      res.status(204).end();
      return;
    }

    res.setHeader("Content-Type", "image/svg+xml");
    res.send(svg);
  });

  /**
   * GET /api/v1/libraries/:name/:version/icons
   *
   * Serve all icon SVGs as a JSON map { className: svgString }.
   * Used by the LSP to bulk-populate the icon cache when lsp-bundle is unavailable.
   */
  router.get("/:name/:version/icons", (req: Request, res: Response): void => {
    const name = req.params["name"];
    const version = req.params["version"];

    if (typeof name !== "string" || typeof version !== "string") {
      res.status(400).json({ error: "Package name and version are required" });
      return;
    }

    const classNames = storage.listClasses(name, version);
    const icons: Record<string, string> = {};

    for (const className of classNames) {
      const svg = storage.readSvg(name, version, className, "icon");
      if (svg) {
        const hasVisual = /<(line|rect|circle|path|polygon|polyline|ellipse|text|image)\b/i.test(svg);
        if (hasVisual) {
          icons[className] = svg;
        }
      }
    }

    res.json({ icons });
  });

  /**
   * GET /api/v1/libraries/:name/:version/classes/:className/diagram.svg
   *
   * Serve the diagram SVG for a specific class.
   */
  router.get("/:name/:version/classes/:className/diagram.svg", (req: Request, res: Response): void => {
    const name = req.params["name"];
    const version = req.params["version"];
    const className = req.params["className"];

    if (typeof name !== "string" || typeof version !== "string" || typeof className !== "string") {
      res.status(400).json({ error: "Package name, version, and class name are required" });
      return;
    }

    const svg = storage.readSvg(name, version, className, "diagram");
    if (!svg) {
      res.status(204).end();
      return;
    }

    // Return 404 if the diagram has no meaningful visual content
    const hasVisual = /<(line|rect|circle|path|polygon|polyline|ellipse|text|image)\b/i.test(svg);
    if (!hasVisual) {
      res.status(204).end();
      return;
    }

    res.setHeader("Content-Type", "image/svg+xml");
    res.send(svg);
  });

  /**
   * GET /api/v1/libraries/:name/:version/resources/*
   *
   * Serve files from an extracted library's directory.
   * Used to resolve `modelica://` URIs in documentation HTML.
   * e.g. modelica://Modelica/Resources/Images/foo.png
   *   → GET /api/v1/libraries/Modelica/4.1.0/resources/Resources/Images/foo.png
   */
  router.get("/:name/:version/resources/{*path}", (req: Request, res: Response): void => {
    const name = String(req.params["name"] ?? "");
    const version = String(req.params["version"] ?? "");
    // path-to-regexp v8 returns wildcard captures as arrays
    const rawPath = req.params["path"];
    const resourcePath = Array.isArray(rawPath) ? rawPath.join("/") : String(rawPath || "");

    if (!name || !version || !resourcePath) {
      res.status(400).json({ error: "Missing required parameters" });
      return;
    }

    const extractedDir = storage.getExtractedPath(name, version);
    const filePath = path.join(extractedDir, resourcePath);

    // Security: ensure the resolved path is within the extracted directory
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(path.resolve(extractedDir))) {
      res.status(403).json({ error: "Access denied" });
      return;
    }

    if (!fs.existsSync(resolved)) {
      res.status(404).json({ error: "Resource not found" });
      return;
    }

    res.sendFile(resolved);
  });

  return router;
}
