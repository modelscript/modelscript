// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Request, Response, Router } from "express";
import { Router as createRouter } from "express";
import multer from "multer";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import semver from "semver";

import type { LibraryDatabase } from "../database.js";
import type { JobQueue } from "../jobs.js";
import { matchesPackagePattern, requireAuth } from "../middleware/auth-middleware.js";
import type { FederationWorker } from "../services/federation-worker.js";
import { ConflictError, type LibraryStorage } from "../storage.js";
import { enforceExportCompliance } from "../util/compliance.js";
import { indexDataPackageResources } from "../util/datapackage-indexer.js";
import { verifyOidcPackageAuthorization, verifyOidcToken, type OidcAttestation } from "../util/oidc-verifier.js";
import { parsePackageMo } from "../util/package-mo.js";
import { scanPackageArchive } from "../util/package-scanner.js";
import { verifyPackageReleaseSignature } from "../util/package-signature.js";
import { extractManifestFromZip } from "../util/zip.js";

const uploadDir = process.env["UPLOAD_TEMP_DIR"] || path.join(os.tmpdir(), "modelscript-uploads");
try {
  fs.mkdirSync(uploadDir, { recursive: true });
} catch {}

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename: (_req, _file, cb) => {
      const uniqueSuffix = `${Date.now()}-${crypto.randomBytes(16).toString("hex")}.tmp`;
      cb(null, `upload-${uniqueSuffix}`);
    },
  }),
  limits: { fileSize: 100 * 1024 * 1024 },
});

function getSafeUploadPath(filePath: string | undefined): string | null {
  if (!filePath || typeof filePath !== "string") return null;
  const resolvedDir = path.resolve(uploadDir);
  const resolvedPath = path.resolve(filePath);
  if (!resolvedPath.startsWith(resolvedDir + path.sep)) {
    return null;
  }
  return resolvedPath;
}

function isValidPackageName(name: string): boolean {
  return /^(@[a-zA-Z0-9_.-]+\/)?[a-zA-Z0-9_.-]+$/.test(name);
}

function resolvePackageParams(req: Request): { name: string; version: string; baseName: string } {
  const scope = req.params["scope"] as string | undefined;
  const nameParam = req.params["name"] as string | undefined;
  const version = (req.params["version"] as string | undefined) || "";

  if (scope && nameParam) {
    return { name: `${scope}/${nameParam}`, version, baseName: nameParam };
  }
  return { name: nameParam || "", version, baseName: nameParam || "" };
}

const RESERVED_CORE_NAMES = ["modelica", "complex", "sysml", "kerml", "openmodelica", "modelscript", "ansatz"];

function levenshteinDistance(a: string, b: string): number {
  const an = a.length;
  const bn = b.length;
  if (an === 0) return bn;
  if (bn === 0) return an;
  const matrix: number[][] = [];
  for (let i = 0; i <= bn; i++) {
    matrix[i] = new Array(an + 1).fill(0);
    matrix[i]![0] = i;
  }
  for (let j = 0; j <= an; j++) {
    matrix[0]![j] = j;
  }

  for (let i = 1; i <= bn; i++) {
    for (let j = 1; j <= an; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i]![j] = matrix[i - 1]![j - 1]!;
      } else {
        matrix[i]![j] = Math.min(matrix[i - 1]![j - 1]! + 1, matrix[i]![j - 1]! + 1, matrix[i - 1]![j]! + 1);
      }
    }
  }
  return matrix[bn]![an]!;
}

function findTyposquatConflict(packageName: string): string | null {
  const baseName = (
    packageName.startsWith("@") && packageName.includes("/") ? packageName.split("/")[1]! : packageName
  ).toLowerCase();

  for (const reserved of RESERVED_CORE_NAMES) {
    if (baseName !== reserved) {
      const dist = levenshteinDistance(baseName, reserved);
      if (dist <= 2 && Math.abs(baseName.length - reserved.length) <= 2) {
        return reserved;
      }
    }
  }
  return null;
}

export function publishRouter(
  storage: LibraryStorage,
  jobQueue: JobQueue,
  database: LibraryDatabase,
  worker?: FederationWorker,
): Router {
  const router = createRouter();

  /**
   * Middleware that authenticates publish requests via ambient/keyless CI/CD OIDC tokens
   * or falls back to standard session/PAT authentication.
   */
  const authenticatePublishRequest = async (req: Request, res: Response, next: () => void): Promise<void> => {
    const oidcHeader = (req.headers["x-package-oidc-token"] || req.headers["x-oidc-token"]) as string | undefined;
    const authHeader = req.headers["authorization"];
    let candidateOidcToken = oidcHeader;

    // Detect if Authorization header carries an OIDC JWT (3 segments, not ms_pat_ / ms_bot_)
    if (!candidateOidcToken && authHeader?.startsWith("Bearer ")) {
      const rawBearer = authHeader.slice(7).trim();
      if (!rawBearer.startsWith("ms_pat_") && !rawBearer.startsWith("ms_bot_") && rawBearer.split(".").length === 3) {
        try {
          const payload = JSON.parse(Buffer.from(rawBearer.split(".")[1]!, "base64url").toString("utf-8"));
          if (
            payload.iss &&
            (payload.iss.includes("github") ||
              payload.iss.includes("gitlab") ||
              payload.iss.includes("circleci") ||
              payload.iss.includes("test"))
          ) {
            candidateOidcToken = rawBearer;
          }
        } catch {}
      }
    }

    if (candidateOidcToken) {
      const oidcVerify = await verifyOidcToken(candidateOidcToken);
      if (!oidcVerify.valid || !oidcVerify.attestation) {
        res.status(401).json({
          error: `OIDC attestation verification failed: ${oidcVerify.error || "Invalid token"} (M3012)`,
          code: "M3012",
        });
        return;
      }

      (req as any).oidcAttestation = oidcVerify.attestation;
      if (!req.user) {
        const botUser = database.getOrCreateCiBotUser({
          provider: oidcVerify.attestation.provider,
          repository: oidcVerify.attestation.repository,
          actor: oidcVerify.attestation.actor,
        });
        req.user = {
          ...botUser,
          role: botUser.account_type || "bot",
          accountType: botUser.account_type || "bot",
        } as any;
      }
      next();
      return;
    }

    // Standard session / PAT / proxy auth
    requireAuth(req, res, () => {
      // If user also provided an explicit X-Package-OIDC-Token, verify and attach attestation
      if (oidcHeader) {
        verifyOidcToken(oidcHeader).then((v) => {
          if (v.valid && v.attestation) {
            (req as any).oidcAttestation = v.attestation;
          }
          next();
        });
      } else {
        next();
      }
    });
  };

  /**
   * POST /api/v1/libraries/:name/:version
   * POST /api/v1/libraries/:scope/:name/:version
   *
   * Upload a versioned Modelica library as a zip file.
   * The library name and version are validated against the zip's root package.mo.
   * Requires authentication (API token or Keyless OIDC CI/CD ID token).
   */
  router.post(
    ["/:name/:version", "/:scope/:name/:version"],
    authenticatePublishRequest,
    enforceExportCompliance(() => database),
    upload.single("file"),
    async (req: Request, res: Response): Promise<void> => {
      const { name, version, baseName } = resolvePackageParams(req);

      // 1. Validate parameters
      if (typeof name !== "string" || typeof version !== "string" || !isValidPackageName(name)) {
        res.status(400).json({ error: "Invalid library name or version format" });
        return;
      }

      if (!semver.valid(version)) {
        res.status(400).json({
          error: `Invalid semantic version: "${version}"`,
        });
        return;
      }

      // 1.1 Strict Package Immutability Check: Fast-fail early if version already exists
      if (storage.exists(name, version) || database.getLibraryRelease(name, version)) {
        res.status(409).json({
          error: `Package version '${name}@${version}' already exists and is immutable (M4009). Published package versions cannot be modified or re-published.`,
        });
        return;
      }

      // Check token scope & package pattern if using an API token
      if (req.tokenScopes) {
        if (
          !req.tokenScopes.includes("*") &&
          !req.tokenScopes.includes("admin") &&
          !req.tokenScopes.includes("packages:publish")
        ) {
          res.status(403).json({ error: "Insufficient permissions: token lacks 'packages:publish' scope" });
          return;
        }
      }
      if (req.tokenPackagePattern && !matchesPackagePattern(name, req.tokenPackagePattern)) {
        res.status(403).json({
          error: `Insufficient permissions: token package pattern '${req.tokenPackagePattern}' does not permit publishing '${name}'`,
        });
        return;
      }

      // 1.5 Scoped namespace check to prevent dependency confusion attacks
      const isCoreReserved = /^(?:modelica|complex|modelscript|sysml|ansatz)/i.test(name);
      const isScoped = name.startsWith("@");
      const reqUser = req.user as { username?: string; account_type?: string; role?: string } | undefined;
      const isAdmin = req.user?.username === "admin" || reqUser?.account_type === "admin" || reqUser?.role === "admin";
      const isTestUnscopedAllowed =
        process.env["NODE_ENV"] !== "production" && req.headers["x-test-allow-unscoped"] === "true";

      if (isCoreReserved && !isAdmin) {
        res.status(403).json({
          error: `Reserved package name '${name}' can only be published by system administrators.`,
        });
        return;
      }

      // Typosquatting defense against protected namespaces
      const typosquatConflict = findTyposquatConflict(name);
      if (typosquatConflict && !isAdmin) {
        res.status(403).json({
          error: `Package name '${name}' is suspiciously similar to protected core package '${typosquatConflict}' (M2006). Typosquatting defense is active.`,
          code: "M2006",
        });
        return;
      }

      if (!isScoped && !isTestUnscopedAllowed && !isAdmin) {
        const existing = database.getLibraryReleases(name);
        if (existing.length === 0) {
          res.status(403).json({
            error:
              "Unscoped package names are reserved for curated core libraries to prevent dependency confusion attacks. Please publish under a scoped namespace (e.g., '@username/packageName').",
          });
          return;
        }
      }

      // 1.6 RBAC / OIDC authorization check for scoped packages and package maintainership
      const oidcAttestation = (req as any).oidcAttestation as OidcAttestation | undefined;
      let oidcAuthorized = false;
      if (oidcAttestation) {
        const oidcAuth = verifyOidcPackageAuthorization(oidcAttestation, name, database);
        if (!oidcAuth.authorized && !isAdmin) {
          res.status(403).json({
            error:
              oidcAuth.reason ||
              `OIDC repository '${oidcAttestation.repository}' is not authorized to publish to package namespace '${name}' (M4012)`,
            code: "M4012",
          });
          return;
        }
        oidcAuthorized = oidcAuth.authorized;
      }

      if (req.user && !oidcAuthorized) {
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

      const tempUploadPath = getSafeUploadPath(req.file.path);
      try {
        const fileBuffer = req.file.buffer || (tempUploadPath ? await fs.promises.readFile(tempUploadPath) : null);
        if (!fileBuffer) {
          res.status(400).json({ error: "Failed to read uploaded archive content" });
          return;
        }

        // 2.5 Security Scan (Zip Slip, Zip Bomb, Executables, AST Prohibited calls)
        const scanResult = await scanPackageArchive(fileBuffer);
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
        const actualSha256 = crypto.createHash("sha256").update(fileBuffer).digest("hex");
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
        const explicitPublicKey = (req.body?.publicKey || req.headers["x-package-public-key"]) as string | undefined;
        const authorUser = req.user?.id ? database.getUserById(req.user.id) : undefined;
        const isStrictSigning = Boolean(authorUser?.signing_policy_strict);

        if (signature) {
          const sigVerifyResult = verifyPackageReleaseSignature({
            contentHash: actualContentHash,
            signature,
            userId: req.user?.id,
            database,
            explicitPublicKey,
            packageName: name,
            packageVersion: version,
          });
          if (!sigVerifyResult.valid) {
            res.status(422).json({
              error: sigVerifyResult.error || "Cryptographic signature verification failed (M3011).",
              code: "M3011",
            });
            return;
          }
        } else if (isStrictSigning) {
          res.status(422).json({
            error:
              "Strict signing policy is active for your account. All package releases must carry a valid cryptographic Ed25519 signature (M3011).",
            code: "M3011",
          });
          return;
        }

        // 3. Extract manifest (package.json, package.mo, or adapted native manifest) from the zip
        const manifestResult = await extractManifestFromZip(fileBuffer, {
          fallbackName: name,
          fallbackVersion: version,
        });
        let parsedName: string | null = null;
        let parsedVersion: string | null = null;

        if (manifestResult.type === "json") {
          try {
            const pkgJson = JSON.parse(manifestResult.content);
            parsedName = typeof pkgJson.name === "string" ? pkgJson.name : null;
            parsedVersion = typeof pkgJson.version === "string" ? pkgJson.version : "0.0.0";
          } catch {
            res.status(400).json({ error: "Invalid JSON syntax in package.json manifest" });
            return;
          }
        } else {
          const parsed = parsePackageMo(manifestResult.content);
          parsedName = parsed.name ?? null;
          parsedVersion = parsed.version || "0.0.0";
        }

        if (!parsedName) {
          res.status(400).json({
            error: `Could not determine the package name from ${manifestResult.type === "json" ? "package.json" : "package.mo"}`,
          });
          return;
        }

        // 5. Validate package name matches
        if (parsedName !== name && parsedName !== baseName) {
          res.status(400).json({
            error: `Package name mismatch: URL specifies "${name}" but manifest declares "${parsedName}"`,
          });
          return;
        }

        // 6. Validate version matches
        if (parsedVersion !== version) {
          res.status(400).json({
            error: `Version mismatch: URL specifies "${version}" but manifest declares "${parsedVersion}"`,
          });
          return;
        }

        // 7. Store the library
        const filePath = await storage.store(name, version, fileBuffer);

        // Record verified release with content hash, optional signature, and OIDC provenance
        database.saveLibraryRelease({
          libraryName: name,
          libraryVersion: version,
          contentHash: actualContentHash,
          signature: signature ?? null,
          publishedBy: req.user?.id ?? null,
          oidcIssuer: oidcAttestation?.issuer ?? null,
          oidcSubject: oidcAttestation?.subject ?? null,
          oidcRepository: oidcAttestation?.repository ?? null,
          oidcWorkflowRef: oidcAttestation?.workflowRef ?? oidcAttestation?.workflow ?? null,
          oidcRunId: oidcAttestation?.runId ?? null,
        });

        // Assign dist-tag (default "latest", or custom tag such as "beta")
        const { id: packageId } = database.getOrCreatePackage(name);
        const explicitTag = req.body?.tag || req.query?.["tag"];
        const tag = String(explicitTag || "latest");
        if (explicitTag || tag !== "latest") {
          database.setDistTag(packageId, tag, version);
        } else {
          const currentLatest = database.getDistTags(packageId)["latest"];
          if (
            !currentLatest ||
            !semver.valid(currentLatest) ||
            !semver.valid(version) ||
            semver.gte(version, currentLatest)
          ) {
            database.setDistTag(packageId, "latest", version);
          }
        }

        // Record package version and metadata synchronously so packuments resolve immediately
        let initialManifestStr = JSON.stringify({ name, version });
        let initialDescription: string | null =
          typeof req.body?.description === "string" && req.body.description.trim() ? req.body.description.trim() : null;
        let initialLicense: string | null =
          typeof req.body?.license === "string" && req.body.license.trim() ? req.body.license.trim() : null;

        if (manifestResult.type === "json") {
          initialManifestStr = manifestResult.content;
          try {
            const pkgJson = JSON.parse(manifestResult.content) as Record<string, unknown>;
            if (!initialDescription && typeof pkgJson["description"] === "string") {
              initialDescription = pkgJson["description"];
            }
            if (!initialLicense && typeof pkgJson["license"] === "string") {
              initialLicense = pkgJson["license"];
            }
          } catch {
            // ignore
          }
        } else {
          const parsed = parsePackageMo(manifestResult.content);
          if (!initialDescription && parsed.description) {
            initialDescription = parsed.description;
          }
          initialManifestStr = JSON.stringify({
            name,
            version,
            description: initialDescription ?? undefined,
            license: initialLicense ?? undefined,
          });
        }

        const isLatest = database.getDistTags(packageId)["latest"] === version;
        if (isLatest && (initialDescription || initialLicense)) {
          database.updatePackageMeta(packageId, {
            description: initialDescription,
            license: initialLicense,
          });
        }

        let versionId = database.getPackageVersion(packageId, version)?.id;
        if (!versionId) {
          const shasum = crypto.createHash("sha1").update(fileBuffer).digest("hex");
          versionId = database.storePackageVersion(
            packageId,
            version,
            filePath,
            shasum,
            null,
            fileBuffer.length,
            initialManifestStr,
            null,
            req.user?.id ?? null,
          );
        }

        // 8. Extract the zip to disk (I/O-bound, fine in main thread)
        const libraryPath = await storage.extractLibrary(name, version);

        // 8.5 Synchronously index any declared Data Package resources (datapackage.json / CSV / Parquet / CAS pointers)
        try {
          await indexDataPackageResources(database, versionId, libraryPath, initialManifestStr);
        } catch (dpErr) {
          console.warn("[publish] Non-fatal error indexing Data Package resources for %s@%s:", name, version, dpErr);
        }

        // 9. Enqueue background processing in a child process.
        //    fork() creates a separate Node.js process that inherits tsx's module resolution,
        //    so the main API event loop stays completely unblocked.
        const jobKey = `${name}@${version}`;
        const ext = import.meta.url.endsWith(".ts") ? ".ts" : ".js";
        const workerScript = fileURLToPath(new URL(`../publish-worker${ext}`, import.meta.url));
        jobQueue.enqueueProcess(
          jobKey,
          workerScript,
          {
            name,
            version,
            libraryPath,
            storageDir: storage.dataDir,
            dbDir: database.dbDir,
          },
          { priority: "high" },
        );

        database.logAudit({
          actorId: req.user?.id ?? null,
          action: "package_published",
          resourceType: "package",
          resourceId: `${name}@${version}`,
          ipAddress: (req.headers["x-forwarded-for"] as string) || req.ip,
          details: {
            contentHash: actualContentHash,
            totalFiles: scanResult.totalFiles,
            oidc: oidcAttestation
              ? {
                  repository: oidcAttestation.repository,
                  workflow: oidcAttestation.workflow,
                  runId: oidcAttestation.runId,
                }
              : undefined,
          },
        });

        if (req.user?.id) {
          database.createNotification(req.user.id, req.user.id, "package_published", null, {
            packageName: name,
            packageVersion: version,
            distTag: tag,
            totalFiles: scanResult.totalFiles,
          });
        }

        // Broadcast ActivityPub Package Release Activity
        if (req.user?.id) {
          try {
            const author = database.getUserFederationInfo(req.user.id);
            if (author && author.actor_url) {
              const publicUrl = process.env["PUBLIC_URL"] || "https://hub.modelscript.org";
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

              const fedWorker = worker || (req.app?.locals?.["federationWorker"] as FederationWorker | undefined);
              if (fedWorker) {
                fedWorker.enqueueActivityBroadcast(releaseActivity, author.id);
              }
            }
          } catch (fedErr) {
            console.error("Failed to broadcast package release activity:", fedErr);
          }
        }

        res.status(201).json({
          name,
          version,
          tag,
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
      } finally {
        if (tempUploadPath && fs.existsSync(tempUploadPath)) {
          try {
            fs.unlinkSync(tempUploadPath);
          } catch {}
        }
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

    if (req.tokenScopes) {
      if (
        !req.tokenScopes.includes("*") &&
        !req.tokenScopes.includes("admin") &&
        !req.tokenScopes.includes("packages:manage")
      ) {
        res.status(403).json({ error: "Insufficient permissions: token lacks 'packages:manage' scope" });
        return;
      }
    }
    if (req.tokenPackagePattern && !matchesPackagePattern(name, req.tokenPackagePattern)) {
      res.status(403).json({
        error: `Insufficient permissions: token package pattern '${req.tokenPackagePattern}' does not permit unpublishing '${name}'`,
      });
      return;
    }

    // Check if user has owner/admin permission to unpublish this package
    if (!database.canUserAdministerPackage(name, req.user!.id)) {
      res.status(403).json({ error: "You do not have permission to unpublish this package" });
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
          const publicUrl = process.env["PUBLIC_URL"] || "https://hub.modelscript.org";
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

          const fedWorker = worker || (req.app?.locals?.["federationWorker"] as FederationWorker | undefined);
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
