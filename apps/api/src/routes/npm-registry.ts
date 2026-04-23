// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * npm-compatible registry routes.
 *
 * Implements the subset of the npm registry protocol that `npm install`,
 * `npm publish`, and `npm search` rely on. Mounted at the root path so that
 * npm can use the base URL directly as `--registry`.
 *
 * Protocol reference:
 *   https://github.com/npm/registry/blob/master/docs/REGISTRY-API.md
 *   https://github.com/npm/registry/blob/master/docs/responses/package-metadata.md
 */

import type { Request, Response, Router } from "express";
import { Router as createRouter } from "express";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import semver from "semver";

import type { LibraryDatabase } from "../database.js";
import { requireAuth } from "../middleware/auth-middleware.js";

const DEFAULT_TARBALL_DIR = "data/tarballs";

/** Safely extract a string from an Express v5 param (which can be string | string[]). */
function param(req: Request, name: string): string {
  const val = req.params[name];
  return Array.isArray(val) ? val.join("/") : String(val ?? "");
}

/**
 * Get the base URL of this registry (used for tarball URLs in packuments).
 */
function getRegistryUrl(req: Request): string {
  const proto = req.headers["x-forwarded-proto"] || req.protocol || "http";
  const host = req.headers["x-forwarded-host"] || req.headers["host"] || "localhost:3000";
  return `${proto}://${host}`;
}

export function npmRegistryRouter(database: LibraryDatabase, tarballDir?: string): Router {
  const router = createRouter();
  const tgzDir = tarballDir ?? DEFAULT_TARBALL_DIR;

  // Ensure tarball directory exists
  if (!fs.existsSync(tgzDir)) {
    fs.mkdirSync(tgzDir, { recursive: true });
  }

  // ── GET /-/v1/search ──────────────────────────────────────────
  // npm search uses this endpoint
  router.get("/-/v1/search", (req: Request, res: Response): void => {
    const text = typeof req.query["text"] === "string" ? req.query["text"] : "";
    const size = Math.min(parseInt(String(req.query["size"] ?? "20"), 10), 250);
    const from = parseInt(String(req.query["from"] ?? "0"), 10);

    if (!text) {
      // Return all packages when no search text
      const allPackages = database.listPackages();
      res.json({
        objects: allPackages.map((p) => ({
          package: {
            name: p.name,
            version: p.latest_version ?? "0.0.0",
            description: p.description,
            date: p.modified_at,
            links: {},
          },
        })),
        total: allPackages.length,
        time: new Date().toUTCString(),
      });
      return;
    }

    const results = database.searchPackages(text, size, from);
    res.json({
      objects: results.objects.map((o) => ({
        ...o,
        score: { final: 1, detail: { quality: 1, popularity: 1, maintenance: 1 } },
        searchScore: 1,
      })),
      total: results.total,
      time: new Date().toUTCString(),
    });
  });

  // ── GET /{package} ────────────────────────────────────────────
  // npm install requests the packument from this endpoint
  // Supports scoped packages: @scope/name → URL-encoded @scope%2Fname
  router.get("/:package", (req: Request, res: Response): void => {
    const rawName = param(req, "package");
    if (!rawName) {
      res.status(400).json({ error: "Package name required" });
      return;
    }

    // Decode scoped package names (e.g., %40scope%2Fname → @scope/name)
    const decodedName = decodeURIComponent(rawName);

    const packument = database.buildPackument(decodedName, getRegistryUrl(req));
    if (!packument) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    res.json(packument);
  });

  // ── GET /{package}/{version} ──────────────────────────────────
  // npm install can also request a specific version
  router.get("/:package/:version", (req: Request, res: Response): void => {
    const packageName = decodeURIComponent(param(req, "package"));
    const version = param(req, "version");

    if (!packageName || !version) {
      res.status(400).json({ error: "Package name and version required" });
      return;
    }

    const pkg = database.getPackage(packageName);
    if (!pkg) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    const v = database.getPackageVersion(pkg.id, version);
    if (!v) {
      // Try resolving dist-tags (e.g. "latest")
      const distTags = database.getDistTags(pkg.id);
      const tagVersion = distTags[version];
      if (tagVersion) {
        const tagV = database.getPackageVersion(pkg.id, tagVersion);
        if (tagV) {
          const manifest = JSON.parse(tagV.manifest) as Record<string, unknown>;
          manifest["dist"] = {
            shasum: tagV.tarball_shasum,
            integrity: tagV.tarball_integrity,
            tarball: `${getRegistryUrl(req)}/${encodeURIComponent(packageName)}/-/${packageName}-${tagV.version}.tgz`,
          };
          manifest["_id"] = `${packageName}@${tagV.version}`;
          res.json(manifest);
          return;
        }
      }

      res.status(404).json({ error: "Version not found" });
      return;
    }

    const manifest = JSON.parse(v.manifest) as Record<string, unknown>;
    manifest["dist"] = {
      shasum: v.tarball_shasum,
      integrity: v.tarball_integrity,
      tarball: `${getRegistryUrl(req)}/${encodeURIComponent(packageName)}/-/${packageName}-${v.version}.tgz`,
    };
    manifest["_id"] = `${packageName}@${v.version}`;
    res.json(manifest);
  });

  // ── GET /{package}/-/{tarball} ────────────────────────────────
  // npm install downloads tarballs from this URL
  router.get("/:package/-/:tarball", (req: Request, res: Response): void => {
    const packageName = decodeURIComponent(param(req, "package"));
    const tarball = param(req, "tarball");

    if (!packageName || !tarball) {
      res.status(400).json({ error: "Invalid tarball request" });
      return;
    }

    const pkg = database.getPackage(packageName);
    if (!pkg) {
      res.status(404).json({ error: "Package not found" });
      return;
    }

    // Extract version from tarball name: {name}-{version}.tgz
    const prefix = `${packageName}-`;
    const suffix = ".tgz";
    if (!tarball.startsWith(prefix) || !tarball.endsWith(suffix)) {
      res.status(400).json({ error: "Invalid tarball filename format" });
      return;
    }
    const version = tarball.slice(prefix.length, -suffix.length);

    const v = database.getPackageVersion(pkg.id, version);
    if (!v) {
      res.status(404).json({ error: "Version not found" });
      return;
    }

    const filePath = path.resolve(v.tarball_path);
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: "Tarball file not found" });
      return;
    }

    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="${tarball}"`);
    res.sendFile(filePath);
  });

  // ── PUT /{package} ────────────────────────────────────────────
  // npm publish sends the tarball as a base64-encoded attachment in JSON body.
  // Body format:
  //   {
  //     _id: "package-name",
  //     name: "package-name",
  //     "dist-tags": { "latest": "1.0.0" },
  //     versions: { "1.0.0": { ... } },
  //     _attachments: {
  //       "package-name-1.0.0.tgz": {
  //         content_type: "application/octet-stream",
  //         data: "<base64>",
  //         length: 12345
  //       }
  //     }
  //   }
  router.put("/:package", requireAuth, (req: Request, res: Response): void => {
    const packageName = decodeURIComponent(param(req, "package"));
    if (!packageName) {
      res.status(400).json({ error: "Package name required" });
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body = req.body as any;

    if (!body || !body.versions || !body._attachments) {
      res.status(400).json({ error: "Invalid publish payload: missing versions or _attachments" });
      return;
    }

    // Validate package name matches URL
    if (body.name && body.name !== packageName) {
      res.status(400).json({ error: `Package name mismatch: URL "${packageName}" vs body "${body.name}"` });
      return;
    }

    const distTags: Record<string, string> = body["dist-tags"] || {};
    const versions: Record<string, Record<string, unknown>> = body.versions || {};
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const attachments: Record<string, any> = body._attachments || {};

    // Process each version
    for (const [version, manifest] of Object.entries(versions)) {
      if (!semver.valid(version)) {
        res.status(400).json({ error: `Invalid semver: "${version}"` });
        return;
      }

      // Find the corresponding attachment
      const tarballName = `${packageName}-${version}.tgz`;
      const attachment = attachments[tarballName];
      if (!attachment || !attachment.data) {
        res.status(400).json({ error: `Missing attachment for ${tarballName}` });
        return;
      }

      // Decode the base64 tarball
      const tarballBuffer = Buffer.from(attachment.data, "base64");
      const tarballSize = tarballBuffer.length;

      // Compute hashes
      const shasum = crypto.createHash("sha1").update(tarballBuffer).digest("hex");
      const integrityHash = crypto.createHash("sha512").update(tarballBuffer).digest("base64");
      const integrity = `sha512-${integrityHash}`;

      // Get or create the package
      const { id: pkgId } = database.getOrCreatePackage(packageName);

      // Check if version already exists
      const existing = database.getPackageVersion(pkgId, version);
      if (existing) {
        res.status(409).json({ error: `Version ${version} already exists for ${packageName}` });
        return;
      }

      // Store the tarball to disk
      const safePackageName = packageName.replace(/\//g, "-").replace(/^@/, "");
      const tarballDir2 = path.join(tgzDir, safePackageName);
      fs.mkdirSync(tarballDir2, { recursive: true });
      const tarballPath = path.join(tarballDir2, `${version}.tgz`);
      fs.writeFileSync(tarballPath, tarballBuffer);

      // Extract metadata from manifest
      const manifestStr = JSON.stringify(manifest);
      const modelscriptMeta = manifest["modelscript"] ? JSON.stringify(manifest["modelscript"]) : null;

      // Store version in database
      const userId = req.user?.id ?? null;
      database.storePackageVersion(
        pkgId,
        version,
        tarballPath,
        shasum,
        integrity,
        tarballSize,
        manifestStr,
        modelscriptMeta,
        userId,
      );

      // Update package-level metadata (hoisted from this version)
      const desc = manifest["description"];
      const readme = body.readme || manifest["readme"];
      const readmeFilename = body.readmeFilename || manifest["readmeFilename"];
      const license = manifest["license"];
      const homepage = manifest["homepage"];
      const repo = manifest["repository"] as { type?: string; url?: string } | undefined;

      database.updatePackageMeta(pkgId, {
        description: typeof desc === "string" ? desc : null,
        readme: typeof readme === "string" ? readme : null,
        readme_filename: typeof readmeFilename === "string" ? readmeFilename : null,
        license: typeof license === "string" ? license : null,
        homepage: typeof homepage === "string" ? homepage : null,
        repository_type: repo?.type ?? null,
        repository_url: repo?.url ?? null,
      });

      // Store artifacts if present in modelscript metadata
      if (manifest["modelscript"]) {
        const msMeta = manifest["modelscript"] as { artifacts?: { type: string; path: string }[] };
        if (msMeta.artifacts) {
          const versionRow = database.getPackageVersion(pkgId, version);
          if (versionRow) {
            for (const artifact of msMeta.artifacts) {
              database.storeArtifact(versionRow.id, artifact.type, artifact.path, JSON.stringify(artifact));
            }
          }
        }
      }
    }

    // Update dist-tags
    const { id: packageId } = database.getOrCreatePackage(packageName);
    for (const [tag, version] of Object.entries(distTags)) {
      database.setDistTag(packageId, tag, version);
    }

    // If no "latest" dist-tag was provided, set it to the highest semver
    if (!distTags["latest"]) {
      const allVersions = Object.keys(versions);
      const sorted = allVersions.sort((a, b) => semver.rcompare(a, b));
      if (sorted[0]) {
        database.setDistTag(packageId, "latest", sorted[0]);
      }
    }

    res.status(201).json({ ok: true });
  });

  // ── DELETE /{package}/-/{tarball}/-rev/{rev} ──────────────────
  // npm unpublish uses this endpoint
  router.delete("/:package/-/:tarball/-rev/:rev", requireAuth, (req: Request, res: Response): void => {
    const packageName = decodeURIComponent(param(req, "package"));
    const tarball = param(req, "tarball");

    if (!packageName || !tarball) {
      res.status(400).json({ error: "Invalid unpublish request" });
      return;
    }

    // Extract version from tarball name
    const prefix = `${packageName}-`;
    const suffix = ".tgz";
    if (!tarball.startsWith(prefix) || !tarball.endsWith(suffix)) {
      res.status(400).json({ error: "Invalid tarball filename" });
      return;
    }
    const version = tarball.slice(prefix.length, -suffix.length);

    const deleted = database.deletePackageVersion(packageName, version);
    if (!deleted) {
      res.status(404).json({ error: `${packageName}@${version} not found` });
      return;
    }

    res.json({ ok: true });
  });

  // ── DELETE /{package}/-rev/{rev} ──────────────────────────────
  // npm unpublish --force uses this to delete an entire package
  router.delete("/:package/-rev/:rev", requireAuth, (req: Request, res: Response): void => {
    const packageName = decodeURIComponent(param(req, "package"));
    if (!packageName) {
      res.status(400).json({ error: "Package name required" });
      return;
    }

    const pkg = database.getPackage(packageName);
    if (!pkg) {
      res.status(404).json({ error: "Package not found" });
      return;
    }

    // Delete all versions
    const allVersions = database.getPackageVersions(pkg.id);
    for (const v of allVersions) {
      database.deletePackageVersion(packageName, v.version);
      // Remove tarball file
      try {
        fs.rmSync(v.tarball_path, { force: true });
      } catch {
        // best-effort
      }
    }

    res.json({ ok: true });
  });

  return router;
}
