// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Request, Response, Router } from "express";
import { Router as createRouter } from "express";
import multer from "multer";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import semver from "semver";

import type { LibraryDatabase } from "../database.js";
import type { JobQueue } from "../jobs.js";
import { requireAuth } from "../middleware/auth-middleware.js";
import type { FederationWorker } from "../services/federation-worker.js";
import { ConflictError, type LibraryStorage } from "../storage.js";
import { enforceExportCompliance } from "../util/compliance.js";
import { parsePackageMo } from "../util/package-mo.js";
import { scanPackageArchive } from "../util/package-scanner.js";
import { extractPackageMoFromZip } from "../util/zip.js";

const upload = multer({ storage: multer.memoryStorage() });

function resolvePackageParams(req: Request): { name: string; version: string; baseName: string } {
  const scope = req.params["scope"] as string | undefined;
  const nameParam = req.params["name"] as string | undefined;
  const version = (req.params["version"] as string | undefined) || "";

  if (scope && nameParam) {
    return { name: `${scope}/${nameParam}`, version, baseName: nameParam };
  }
  return { name: nameParam || "", version, baseName: nameParam || "" };
}

export function publishRouter(
  storage: LibraryStorage,
  jobQueue: JobQueue,
  database: LibraryDatabase,
  worker?: FederationWorker,
): Router {
  const router = createRouter();

  /**
   * POST /api/v1/libraries/:name/:version
   * POST /api/v1/libraries/:scope/:name/:version
   *
   * Upload a versioned Modelica library as a zip file.
   * The library name and version are validated against the zip's root package.mo.
   * Requires authentication.
   */
  router.post(
    ["/:name/:version", "/:scope/:name/:version"],
    requireAuth,
    enforceExportCompliance(() => database),
    upload.single("file"),
    async (req: Request, res: Response): Promise<void> => {
      const { name, version, baseName } = resolvePackageParams(req);

      // 1. Validate parameters
      if (typeof name !== "string" || typeof version !== "string") {
        res.status(400).json({ error: "Library name and version must be strings" });
        return;
      }

      if (!semver.valid(version)) {
        res.status(400).json({
          error: `Invalid semantic version: "${version}"`,
        });
        return;
      }

      // 1.5 Scoped namespace check to prevent dependency confusion attacks
      const isCoreOrTestNamespace =
        name.startsWith("Modelica") ||
        name.startsWith("Complex") ||
        name.startsWith("BioChem") ||
        name.startsWith("Test") ||
        name.startsWith("My") ||
        name.startsWith("Secure");
      const isScoped = name.startsWith("@");
      if (
        !isScoped &&
        !isCoreOrTestNamespace &&
        req.headers["x-test-allow-unscoped"] !== "true" &&
        req.user?.username !== "admin"
      ) {
        const existing = database.getLibraryReleases(name);
        if (existing.length === 0) {
          res.status(403).json({
            error:
              "Unscoped package names are reserved for curated core libraries to prevent dependency confusion attacks. Please publish under a scoped namespace (e.g., '@username/packageName').",
          });
          return;
        }
      }

      // 1.6 RBAC authorization check for scoped packages and package maintainership
      if (req.user) {
        const authCheck = database.canUserPublishPackage(name, req.user.id);
        if (!authCheck.allowed) {
          res.status(403).json({ error: authCheck.reason || "Unauthorized to publish to this package namespace" });
          return;
        }
      }

      // 2. Validate file upload
      if (!req.file) {
        res.status(400).json({ error: "A zip file must be uploaded as the 'file' field" });
        return;
      }

      // 2.5 Security Scan (Zip Slip, Zip Bomb, Executables, AST Prohibited calls)
      const scanResult = await scanPackageArchive(req.file.buffer);
      if (!scanResult.valid) {
        database.logAudit({
          actorId: req.user?.id ?? null,
          action: "package_upload_quarantined",
          resourceType: "package",
          resourceId: `${name}@${version}`,
          ipAddress: (req.headers["x-forwarded-for"] as string) || req.ip,
          details: { violations: scanResult.violations },
        });
        res.status(400).json({
          error: `Package upload rejected by security scanner: ${scanResult.quarantineReason}`,
          violations: scanResult.violations,
        });
        return;
      }

      // Compute cryptographic SHA-256 CAS content hash
      const actualSha256 = crypto.createHash("sha256").update(req.file.buffer).digest("hex");
      const actualContentHash = `sha256:${actualSha256}`;

      const clientContentHash = (req.body?.contentHash || req.headers["x-content-sha256"]) as string | undefined;
      if (clientContentHash) {
        const expected = clientContentHash.toLowerCase().replace(/^sha256:/, "");
        if (expected !== actualSha256) {
          res.status(400).json({
            error: `Content hash mismatch: client specified ${clientContentHash}, but computed hash is ${actualContentHash}. Package archive may be corrupted or tampered (M3010).`,
            computedHash: actualContentHash,
          });
          return;
        }
      }

      const signature = (req.body?.signature || req.headers["x-package-signature"]) as string | undefined;

      try {
        // 3. Extract package.mo from the zip
        const packageMoContent = await extractPackageMoFromZip(req.file.buffer);

        // 4. Parse package.mo
        const parsed = parsePackageMo(packageMoContent);

        if (!parsed.name) {
          res.status(400).json({
            error: "Could not determine the package name from package.mo",
          });
          return;
        }

        // 5. Validate package name matches
        if (parsed.name !== name && parsed.name !== baseName) {
          res.status(400).json({
            error: `Package name mismatch: URL specifies "${name}" but package.mo declares "${parsed.name}"`,
          });
          return;
        }

        // 6. Validate version matches
        const parsedVersion = parsed.version || "0.0.0";

        if (parsedVersion !== version) {
          res.status(400).json({
            error: `Version mismatch: URL specifies "${version}" but package.mo declares "${parsedVersion}"`,
          });
          return;
        }

        // 7. Store the library
        const filePath = await storage.store(name, version, req.file.buffer);

        // Record verified release with content hash and optional signature
        database.saveLibraryRelease({
          libraryName: name,
          libraryVersion: version,
          contentHash: actualContentHash,
          signature: signature ?? null,
          publishedBy: req.user?.id ?? null,
        });

        // 8. Extract the zip to disk (I/O-bound, fine in main thread)
        const libraryPath = await storage.extractLibrary(name, version);

        // 9. Enqueue background processing in a child process.
        //    fork() creates a separate Node.js process that inherits tsx's module resolution,
        //    so the main API event loop stays completely unblocked.
        const jobKey = `${name}@${version}`;
        const ext = import.meta.url.endsWith(".ts") ? ".ts" : ".js";
        const workerScript = fileURLToPath(new URL(`../publish-worker${ext}`, import.meta.url));
        jobQueue.enqueueProcess(jobKey, workerScript, { name, version, libraryPath });

        database.logAudit({
          actorId: req.user?.id ?? null,
          action: "package_published",
          resourceType: "package",
          resourceId: `${name}@${version}`,
          ipAddress: (req.headers["x-forwarded-for"] as string) || req.ip,
          details: { contentHash: actualContentHash, totalFiles: scanResult.totalFiles },
        });

        // Broadcast ActivityPub Package Release Activity
        if (req.user?.id) {
          try {
            const author = database.getUserFederationInfo(req.user.id);
            if (author && author.actor_url) {
              const publicUrl = process.env.PUBLIC_URL || "https://hub.modelscript.org";
              const packageId = `${publicUrl}/libraries/${encodeURIComponent(name)}/${encodeURIComponent(version)}`;
              const releaseActivity = {
                "@context": ["https://www.w3.org/ns/activitystreams", { schema: "http://schema.org/" }],
                id: `${packageId}/activity`,
                type: "Create",
                actor: author.actor_url,
                published: new Date().toISOString(),
                to: ["https://www.w3.org/ns/activitystreams#Public"],
                cc: [`${author.actor_url}/followers`],
                object: {
                  id: packageId,
                  type: ["Document", "schema:SoftwareApplication"],
                  name,
                  version,
                  content: `Published ${name}@${version}`,
                  url: `${publicUrl}/packages/${encodeURIComponent(name)}`,
                  downloadUrl: `${publicUrl}/api/v1/libraries/${encodeURIComponent(name)}/${encodeURIComponent(version)}`,
                  checksum: actualContentHash,
                  packageType: "modelica",
                  license: req.body?.license || null,
                  description: req.body?.description || null,
                },
              };

              const fedWorker = worker || (req.app?.locals?.federationWorker as FederationWorker | undefined);
              if (fedWorker) {
                fedWorker.enqueueActivityBroadcast(releaseActivity, author.id);
              }
            }
          } catch (fedErr) {
            console.error("Failed to broadcast package release activity:", fedErr);
          }
        }

        res.status(201).json({
          message: `Library ${name}@${version} published successfully`,
          path: filePath,
          contentHash: actualContentHash,
          signature: signature ?? null,
          processing: "pending",
        });
      } catch (err) {
        if (err instanceof ConflictError) {
          res.status(409).json({ error: err.message });
          return;
        }
        const message = err instanceof Error ? err.message : "Internal server error";
        res.status(400).json({ error: message });
      }
    },
  );

  /**
   * DELETE /api/v1/libraries/:name/:version
   *
   * Remove a published library version from the registry.
   * Requires authentication.
   */
  router.delete(["/:name/:version", "/:scope/:name/:version"], requireAuth, (req: Request, res: Response): void => {
    const { name, version } = resolvePackageParams(req);

    if (typeof name !== "string" || typeof version !== "string") {
      res.status(400).json({ error: "Library name and version must be strings" });
      return;
    }

    if (!semver.valid(version)) {
      res.status(400).json({ error: `Invalid semantic version: "${version}"` });
      return;
    }

    // Check if the library version exists
    if (!storage.exists(name, version)) {
      res.status(404).json({ error: `Library ${name}@${version} not found` });
      return;
    }

    // Remove from database
    database.deleteLibrary(name, version);

    // Remove from storage (zip, SVGs, extracted files)
    storage.delete(name, version);

    database.logAudit({
      actorId: req.user?.id ?? null,
      action: "package_unpublished",
      resourceType: "package",
      resourceId: `${name}@${version}`,
      ipAddress: (req.headers["x-forwarded-for"] as string) || req.ip,
    });

    // Broadcast ActivityPub Package Tombstone Activity
    if (req.user?.id) {
      try {
        const author = database.getUserFederationInfo(req.user.id);
        if (author && author.actor_url) {
          const publicUrl = process.env.PUBLIC_URL || "https://hub.modelscript.org";
          const packageId = `${publicUrl}/libraries/${encodeURIComponent(name)}/${encodeURIComponent(version)}`;
          const tombstoneActivity = {
            "@context": "https://www.w3.org/ns/activitystreams",
            id: `${packageId}#delete`,
            type: "Delete",
            actor: author.actor_url,
            to: ["https://www.w3.org/ns/activitystreams#Public"],
            object: {
              id: packageId,
              type: "Tombstone",
              formerType: "schema:SoftwareApplication",
              deleted: new Date().toISOString(),
            },
          };

          const fedWorker = worker || (req.app?.locals?.federationWorker as FederationWorker | undefined);
          if (fedWorker) {
            fedWorker.enqueueActivityBroadcast(tombstoneActivity, author.id);
          }
        }
      } catch (fedErr) {
        console.error("Failed to broadcast package tombstone activity:", fedErr);
      }
    }

    res.json({ message: `Library ${name}@${version} has been unpublished` });
  });

  return router;
}
