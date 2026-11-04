// SPDX-License-Identifier: AGPL-3.0-or-later

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import semver from "semver";
import yazl from "yazl";

import type { LibraryDatabase } from "../database.js";
import type { JobQueue } from "../jobs.js";
import type { LibraryStorage } from "../storage.js";
import { indexSysmlFiles } from "./polyglot-doc-indexer.js";

function zipFolderToBuffer(dir: string, ignorePatterns: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const zipfile = new yazl.ZipFile();
    const chunks: Buffer[] = [];
    zipfile.outputStream.on("data", (chunk: Buffer) => chunks.push(chunk));
    zipfile.outputStream.on("end", () => resolve(Buffer.concat(chunks)));
    zipfile.outputStream.on("error", reject);

    const addDirectory = (currentDir: string, zipPathPrefix = "") => {
      const entries = fs.readdirSync(currentDir, { withFileTypes: true });
      for (const entry of entries) {
        // Simple ignore check
        const relPath = zipPathPrefix ? `${zipPathPrefix}/${entry.name}` : entry.name;

        // Check if relPath matches any ignore pattern (basic prefix/substring check)
        const shouldIgnore = ignorePatterns.some(
          (p) => relPath === p || relPath.startsWith(p + "/") || entry.name === p || entry.name.startsWith(p + "/"),
        );

        if (shouldIgnore) continue;

        const fullPath = path.join(currentDir, entry.name);
        if (entry.isDirectory()) {
          addDirectory(fullPath, relPath);
        } else if (entry.isFile()) {
          zipfile.addFile(fullPath, relPath);
        }
      }
    };

    addDirectory(dir);
    zipfile.end();
  });
}

function zipSysmlStdlibToBuffer(stdlibDir: string, version: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const zipfile = new yazl.ZipFile();
    const chunks: Buffer[] = [];
    zipfile.outputStream.on("data", (chunk: Buffer) => chunks.push(chunk));
    zipfile.outputStream.on("end", () => resolve(Buffer.concat(chunks)));
    zipfile.outputStream.on("error", reject);

    const manifest = JSON.stringify(
      {
        name: "SysML",
        version,
        description: "OMG SysML v2 & KerML Standard Library",
        license: "OMG-SysML-2.0",
      },
      null,
      2,
    );
    zipfile.addBuffer(Buffer.from(manifest, "utf-8"), "package.json");

    if (fs.existsSync(stdlibDir)) {
      for (const entry of fs.readdirSync(stdlibDir, { withFileTypes: true })) {
        if (
          entry.isFile() &&
          (entry.name.endsWith(".sysml") ||
            entry.name.endsWith(".kerml") ||
            entry.name === "README.md" ||
            entry.name === ".meta.json")
        ) {
          zipfile.addFile(path.join(stdlibDir, entry.name), entry.name);
        }
      }
    }
    zipfile.end();
  });
}

export async function seedExamplePackages(
  storage: LibraryStorage,
  database: LibraryDatabase,
  jobQueue: JobQueue,
): Promise<void> {
  const thisDir = path.dirname(fileURLToPath(import.meta.url));
  const examplesDirCandidates = [
    path.resolve(thisDir, "../../../../packages/examples"),
    path.resolve(thisDir, "../../../packages/examples"),
    path.resolve("packages/examples"),
  ];
  const examplesDir = examplesDirCandidates.find((p) => fs.existsSync(p));
  if (!examplesDir) return;

  const packages = fs.readdirSync(examplesDir, { withFileTypes: true });
  for (const pkgEntry of packages) {
    if (!pkgEntry.isDirectory()) continue;

    const pkgDir = path.join(examplesDir, pkgEntry.name);
    const pkgJsonPath = path.join(pkgDir, "package.json");
    const msJsonPath = path.join(pkgDir, "modelscript.json");
    const manifestPath = fs.existsSync(pkgJsonPath) ? pkgJsonPath : fs.existsSync(msJsonPath) ? msJsonPath : null;
    if (!manifestPath) continue;

    const manifestStr = fs.readFileSync(manifestPath, "utf-8");
    const manifest = JSON.parse(manifestStr) as Record<string, unknown>;
    const name = typeof manifest["name"] === "string" ? manifest["name"] : null;
    const version = typeof manifest["version"] === "string" ? manifest["version"] : null;

    if (!name || !version) {
      console.warn(`[Seed] Example ${pkgEntry.name} is missing name or version in manifest. Skipping.`);
      continue;
    }

    // Check if already seeded in both database and storage
    const existingPkg = database.getPackage(name);
    if (existingPkg) {
      const existingVer = database.getPackageVersion(existingPkg.id, version);
      if (existingVer && storage.exists(name, version)) {
        const contentHash = storage.getContentHash(name, version) ?? `sha256:${existingVer.tarball_shasum}`;
        database.saveLibraryRelease({
          libraryName: name,
          libraryVersion: version,
          contentHash,
          signature: null,
          publishedBy: null,
        });
        continue;
      }
    }

    console.log(`[Seed] Loading example package: ${name}@${version}`);

    // Parse .modelscriptignore
    const ignorePath = path.join(pkgDir, ".modelscriptignore");
    const ignorePatterns = ["node_modules", "dist", ".git"];
    if (fs.existsSync(ignorePath)) {
      const lines = fs.readFileSync(ignorePath, "utf-8").split("\n");
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith("#")) {
          ignorePatterns.push(trimmed.replace(/\/$/, ""));
        }
      }
    }

    // Zip and store
    const zipBuffer = await zipFolderToBuffer(pkgDir, ignorePatterns);
    try {
      await storage.store(name, version, zipBuffer);
    } catch (err: unknown) {
      const errObj = err as { name?: string | undefined; message?: string | undefined };
      if (errObj?.name !== "ConflictError" && !errObj?.message?.includes("already exists")) {
        throw err;
      }
    }
    const libraryPath = await storage.extractLibrary(name, version);

    // Register in database
    const { id: packageId } = database.getOrCreatePackage(name);
    const readmeText = fs.existsSync(path.join(pkgDir, "README.md"))
      ? fs.readFileSync(path.join(pkgDir, "README.md"), "utf-8")
      : null;

    const shasum = crypto.createHash("sha1").update(zipBuffer).digest("hex");
    const sha256 = crypto.createHash("sha256").update(zipBuffer).digest("hex");
    if (!database.getPackageVersion(packageId, version)) {
      database.storePackageVersion(
        packageId,
        version,
        `file://${pkgDir}`,
        shasum,
        null,
        zipBuffer.length,
        manifestStr,
        null,
        null,
      );
    }
    const currentExampleLatest = database.getDistTags(packageId)["latest"];
    const isLatest =
      !currentExampleLatest ||
      !semver.valid(currentExampleLatest) ||
      !semver.valid(version) ||
      semver.gte(version, currentExampleLatest);
    if (isLatest) {
      database.setDistTag(packageId, "latest", version);
      database.updatePackageMeta(packageId, {
        description: typeof manifest["description"] === "string" ? manifest["description"] : null,
        readme: readmeText,
        license: typeof manifest["license"] === "string" ? manifest["license"] : null,
      });
    }
    database.saveLibraryRelease({
      libraryName: name,
      libraryVersion: version,
      contentHash: `sha256:${sha256}`,
      signature: null,
      publishedBy: null,
    });

    // Enqueue job to process Modelica classes, SVGs, and scan artifacts
    const jobKey = `${name}@${version}`;
    const ext = import.meta.url.endsWith(".ts") ? ".ts" : ".js";
    const workerScript = fileURLToPath(new URL(`../publish-worker${ext}`, import.meta.url));
    jobQueue.enqueueProcess(jobKey, workerScript, {
      name,
      version,
      libraryPath,
      storageDir: storage.dataDir,
      dbDir: database.dbDir,
    });
  }
}

import { getStdlibsByPack, type StdlibEntry, type StdlibPackId } from "@modelscript/exchange";

export async function seedPrepackagedLibraries(
  storage: LibraryStorage,
  database: LibraryDatabase,
  jobQueue: JobQueue,
): Promise<void> {
  const requestedPacks = (process.env["STDLIB_PACKS"] || "all")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);

  const targetsMap = new Map<string, StdlibEntry>();
  for (const pack of requestedPacks) {
    const libs = getStdlibsByPack(pack as StdlibPackId | "all");
    for (const lib of libs) {
      targetsMap.set(lib.id, lib);
    }
  }

  const prepackaged = Array.from(targetsMap.values()).map((lib) => ({
    name: lib.packageName,
    version: lib.version,
    filename: lib.filename,
    description: lib.description,
    license: lib.license,
    domain: lib.domain,
    tier: lib.tier,
    minExpectedClasses: lib.minExpectedClasses ?? (lib.packageName === "Modelica" ? 6000 : 40),
    upstream: lib.upstream,
  }));

  const ext = import.meta.url.endsWith(".ts") ? ".ts" : ".js";
  const workerScript = fileURLToPath(new URL(`../publish-worker${ext}`, import.meta.url));
  const repoRoot = path.resolve(path.dirname(workerScript), "../../..");

  for (const pkg of prepackaged) {
    const existingPkg = database.getPackage(pkg.name);
    if (existingPkg) {
      const existingVer = database.getPackageVersion(existingPkg.id, pkg.version);
      if (existingVer && storage.exists(pkg.name, pkg.version)) {
        const contentHash = storage.getContentHash(pkg.name, pkg.version) ?? `sha256:${existingVer.tarball_shasum}`;
        database.saveLibraryRelease({
          libraryName: pkg.name,
          libraryVersion: pkg.version,
          contentHash,
          signature: null,
          publishedBy: null,
        });

        // Backfill missing Modelica root README from indexed Modelica root class documentation if needed
        const currentLatestVer = database.getDistTags(existingPkg.id)["latest"];
        const isLatestVer = !currentLatestVer || currentLatestVer === pkg.version;
        if (pkg.name === "Modelica" && isLatestVer && !existingPkg.readme) {
          const rootModelica = database.getClass("Modelica", pkg.version, "Modelica");
          if (rootModelica?.documentation) {
            database.updatePackageMeta(existingPkg.id, {
              description: rootModelica.description ?? pkg.description,
              readme: rootModelica.documentation,
              license: pkg.license,
            });
          }
        }

        const classCount = database.getClassCount(pkg.name, pkg.version);
        const minExpectedClasses = pkg.minExpectedClasses;
        const hasSysmlRoot =
          pkg.name !== "SysML" ||
          (database.hasClass(pkg.name, pkg.version, "SysML") &&
            database.hasClass(pkg.name, pkg.version, "Parts.Part") &&
            Boolean(existingPkg.readme));
        if (classCount >= minExpectedClasses && hasSysmlRoot) {
          continue; // Already seeded and fully processed
        }

        // For SysML stdlib, refresh the zip/extracted dir from languages/sysml2/stdlib if incomplete
        if (pkg.name === "SysML") {
          const stdlibDir = path.resolve(repoRoot, "languages/sysml2/stdlib");
          if (fs.existsSync(stdlibDir)) {
            try {
              const zipBuf = await zipSysmlStdlibToBuffer(stdlibDir, pkg.version);
              const targetZipPath = path.join(storage.dataDir, "SysML", `${pkg.version}.zip`);
              fs.mkdirSync(path.dirname(targetZipPath), { recursive: true });
              fs.writeFileSync(targetZipPath, zipBuf);
              const extractedPath = storage.getExtractedPath(pkg.name, pkg.version);
              if (fs.existsSync(extractedPath)) {
                fs.rmSync(extractedPath, { recursive: true, force: true });
              }
              const libPath = await storage.extractLibrary(pkg.name, pkg.version);
              const readmePath = path.join(stdlibDir, "README.md");
              const readmeText = fs.existsSync(readmePath) ? fs.readFileSync(readmePath, "utf-8") : null;
              const currentLatestSysml = database.getDistTags(existingPkg.id)["latest"];
              const isLatestSysml = !currentLatestSysml || currentLatestSysml === pkg.version;
              if (isLatestSysml) {
                database.updatePackageMeta(existingPkg.id, {
                  description: pkg.description,
                  readme: readmeText,
                  license: pkg.license,
                });
              }
              const indexed = await indexSysmlFiles({
                extractedDir: libPath,
                packageName: pkg.name,
                version: pkg.version,
              });
              for (const item of indexed) {
                storage.storeSvg(pkg.name, pkg.version, item.metadata.className, item.iconSvg, item.diagramSvg);
              }
              if (indexed.length > 0) {
                database.storeClassBatch(
                  pkg.name,
                  pkg.version,
                  indexed.map((i) => i.metadata),
                );
              }
            } catch (err) {
              console.warn(`[Seed] Failed to refresh SysML stdlib:`, err);
            }
          }
        }

        // If package and version exist but classes are incomplete, re-enqueue job
        let libraryPath = storage.getExtractedPath(pkg.name, pkg.version);
        if (!fs.existsSync(libraryPath)) {
          try {
            libraryPath = await storage.extractLibrary(pkg.name, pkg.version);
          } catch (err) {
            console.warn(`[Seed] Could not extract library for ${pkg.name}@${pkg.version}:`, err);
          }
        }
        if (fs.existsSync(libraryPath)) {
          console.log(`[Seed] Re-enqueuing processing for prepackaged library: ${pkg.name}@${pkg.version}`);
          const jobKey = `${pkg.name}@${pkg.version}`;
          const isMassiveLib = pkg.name === "Modelica" || (pkg.minExpectedClasses && pkg.minExpectedClasses > 1000);
          const timeoutMs = isMassiveLib ? 40 * 60 * 1000 : 20 * 60 * 1000;
          const maxTimeoutMs = isMassiveLib ? 60 * 60 * 1000 : 35 * 60 * 1000;
          jobQueue.enqueueProcess(
            jobKey,
            workerScript,
            {
              name: pkg.name,
              version: pkg.version,
              libraryPath,
              storageDir: storage.dataDir,
              dbDir: database.dbDir,
            },
            { priority: "low", timeoutMs, maxTimeoutMs },
          );
          continue;
        }
      }
    }

    if (pkg.name === "Complex" || pkg.name === "ModelicaServices") {
      storage.ensureCompanionPackage(pkg.name, pkg.version);
    }

    const candidateZipPaths = [
      path.resolve(storage.dataDir, pkg.name, `${pkg.version}.zip`),
      path.resolve(repoRoot, "scripts", pkg.filename),
      path.resolve(repoRoot, "apps/api/data/libraries", pkg.name, `${pkg.version}.zip`),
      path.resolve(repoRoot, "apps/api/data/libraries", pkg.filename),
      path.resolve(repoRoot, "modelscript_libraries", pkg.filename),
      path.resolve(repoRoot, "scripts", `${pkg.name}-${pkg.version}.lsp-bundle.zip`),
      process.env["STDLIB_STORAGE_DIR"] ? path.resolve(process.env["STDLIB_STORAGE_DIR"], pkg.filename) : null,
      process.env["STDLIB_STORAGE_DIR"]
        ? path.resolve(process.env["STDLIB_STORAGE_DIR"], pkg.name, `${pkg.version}.zip`)
        : null,
    ].filter(Boolean) as string[];

    let resolvedZipPath: string | null = null;
    let zipBuffer: Buffer | null = null;

    const stdlibDir = path.resolve(repoRoot, "languages/sysml2/stdlib");
    const existingStorageZip = path.resolve(storage.dataDir, pkg.name, `${pkg.version}.zip`);
    if (pkg.name === "SysML" && fs.existsSync(stdlibDir) && !fs.existsSync(existingStorageZip)) {
      zipBuffer = await zipSysmlStdlibToBuffer(stdlibDir, pkg.version);
      resolvedZipPath = path.resolve(repoRoot, "scripts", pkg.filename);
    } else {
      for (const cand of candidateZipPaths) {
        if (fs.existsSync(cand)) {
          resolvedZipPath = cand;
          zipBuffer = fs.readFileSync(cand);
          break;
        }
      }
    }

    if (!zipBuffer || !resolvedZipPath) {
      if (pkg.upstream?.url) {
        console.log(
          `[Seed] Archive for ${pkg.name}@${pkg.version} not found locally on disk. Attempting on-the-fly download...`,
        );
        const candidateUrls = [pkg.upstream.url, pkg.upstream.fallbackUrl, ...(pkg.upstream.mirrorUrls || [])].filter(
          Boolean,
        ) as string[];

        for (const url of candidateUrls) {
          try {
            console.log(`[Seed] Fetching ${pkg.name} from ${url}...`);
            const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(60000) });
            if (res.ok) {
              const buf = Buffer.from(await res.arrayBuffer());
              if (buf.length > 100) {
                zipBuffer = buf;
                resolvedZipPath = path.resolve(storage.dataDir, pkg.name, `${pkg.version}.zip`);
                fs.mkdirSync(path.dirname(resolvedZipPath), { recursive: true });
                fs.writeFileSync(resolvedZipPath, zipBuffer);
                console.log(
                  `[Seed] Successfully downloaded and cached ${pkg.name}@${pkg.version} (${(zipBuffer.length / 1024 / 1024).toFixed(2)} MB).`,
                );
                break;
              }
            }
          } catch (fetchErr) {
            console.warn(`[Seed] Download failed from ${url}:`, fetchErr);
          }
        }
      }
    }

    if (!zipBuffer || !resolvedZipPath) {
      console.warn(`[Seed] Prepackaged library zip not found for ${pkg.name}@${pkg.version}`);
      continue;
    }

    console.log(`[Seed] Loading prepackaged library: ${pkg.name}@${pkg.version} from ${resolvedZipPath}`);

    if (pkg.name === "SysML") {
      // Ensure stale extracted directory without SysML.sysml or metadata.json is replaced
      const existingExtracted = storage.getExtractedPath(pkg.name, pkg.version);
      if (
        fs.existsSync(existingExtracted) &&
        !fs.existsSync(path.join(existingExtracted, "SysML.sysml")) &&
        !fs.existsSync(path.join(existingExtracted, "metadata.json"))
      ) {
        fs.rmSync(existingExtracted, { recursive: true, force: true });
      }
      const targetZipPath = path.join(storage.dataDir, "SysML", `${pkg.version}.zip`);
      if (resolvedZipPath !== targetZipPath) {
        fs.mkdirSync(path.dirname(targetZipPath), { recursive: true });
        fs.writeFileSync(targetZipPath, zipBuffer);
      }
    } else {
      try {
        await storage.store(pkg.name, pkg.version, zipBuffer);
      } catch (err: unknown) {
        const errObj = err as { name?: string | undefined; message?: string | undefined };
        if (errObj?.name !== "ConflictError" && !errObj?.message?.includes("already exists")) {
          throw err;
        }
      }
    }
    const libraryPath = await storage.extractLibrary(pkg.name, pkg.version);

    const { id: packageId } = database.getOrCreatePackage(pkg.name);
    const readmeCandidate = path.join(libraryPath, "README.md");
    const readmeText = fs.existsSync(readmeCandidate) ? fs.readFileSync(readmeCandidate, "utf-8") : null;

    let isPreIndexed = false;
    const metadataCandidate = path.join(libraryPath, "metadata.json");
    const iconsCandidate = path.join(libraryPath, "icons.json");
    const indexCandidate = path.join(libraryPath, "index.json");

    if (fs.existsSync(metadataCandidate)) {
      try {
        const metaStr = fs.readFileSync(metadataCandidate, "utf-8");
        const parsed = JSON.parse(metaStr);
        const classes = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.classes) ? parsed.classes : [];
        if (classes.length > 0) {
          database.storeClassBatch(pkg.name, pkg.version, classes);
          isPreIndexed = true;
          console.log(
            `[Seed] Fast-ingested ${classes.length} pre-indexed classes for ${pkg.name}@${pkg.version} in O(1) time.`,
          );
        }
      } catch (metaErr) {
        console.warn(`[Seed] Warning parsing metadata.json for ${pkg.name}@${pkg.version}:`, metaErr);
      }
    }

    if (fs.existsSync(iconsCandidate)) {
      try {
        const iconsStr = fs.readFileSync(iconsCandidate, "utf-8");
        const icons = JSON.parse(iconsStr) as Record<string, string>;
        for (const [clsName, svg] of Object.entries(icons)) {
          if (typeof svg === "string") {
            storage.storeSvg(pkg.name, pkg.version, clsName, svg, null);
          }
        }
      } catch (iconErr) {
        console.warn(`[Seed] Warning parsing icons.json for ${pkg.name}@${pkg.version}:`, iconErr);
      }
    }

    if (pkg.name === "SysML" && !isPreIndexed) {
      try {
        const indexed = await indexSysmlFiles({
          extractedDir: libraryPath,
          packageName: pkg.name,
          version: pkg.version,
        });
        for (const item of indexed) {
          storage.storeSvg(pkg.name, pkg.version, item.metadata.className, item.iconSvg, item.diagramSvg);
        }
        if (indexed.length > 0) {
          database.storeClassBatch(
            pkg.name,
            pkg.version,
            indexed.map((i) => i.metadata),
          );
        }
      } catch (err) {
        console.warn(`[Seed] Synchronous SysML indexing warning:`, err);
      }
    }

    const shasum = crypto.createHash("sha1").update(zipBuffer).digest("hex");
    const sha256 = crypto.createHash("sha256").update(zipBuffer).digest("hex");
    const manifestObj = {
      name: pkg.name,
      version: pkg.version,
      description: pkg.description,
      license: pkg.license,
      modelscript: {
        domains: pkg.domain ? [pkg.domain] : [],
        tier: pkg.tier,
      },
    };
    if (!database.getPackageVersion(packageId, pkg.version)) {
      database.storePackageVersion(
        packageId,
        pkg.version,
        `file://${resolvedZipPath}`,
        shasum,
        null,
        zipBuffer.length,
        JSON.stringify(manifestObj),
        null,
        null,
      );
    }
    const currentLatest = database.getDistTags(packageId)["latest"];
    const isLatest =
      !currentLatest ||
      !semver.valid(currentLatest) ||
      !semver.valid(pkg.version) ||
      semver.gte(pkg.version, currentLatest);
    if (isLatest) {
      database.setDistTag(packageId, "latest", pkg.version);
      database.updatePackageMeta(packageId, {
        description: pkg.description,
        readme: readmeText,
        license: pkg.license,
      });
    }
    database.saveLibraryRelease({
      libraryName: pkg.name,
      libraryVersion: pkg.version,
      contentHash: `sha256:${sha256}`,
      signature: null,
      publishedBy: null,
    });

    if (!isPreIndexed && !fs.existsSync(indexCandidate)) {
      const jobKey = `${pkg.name}@${pkg.version}`;
      const isMassiveLib = pkg.name === "Modelica" || (pkg.minExpectedClasses && pkg.minExpectedClasses > 1000);
      const timeoutMs = isMassiveLib ? 40 * 60 * 1000 : 20 * 60 * 1000;
      const maxTimeoutMs = isMassiveLib ? 60 * 60 * 1000 : 35 * 60 * 1000;
      jobQueue.enqueueProcess(
        jobKey,
        workerScript,
        {
          name: pkg.name,
          version: pkg.version,
          libraryPath,
          storageDir: storage.dataDir,
          dbDir: database.dbDir,
        },
        { priority: "low", timeoutMs, maxTimeoutMs },
      );
    } else {
      console.log(`[Seed] Skipped background worker queue for ${pkg.name}@${pkg.version} (already pre-indexed).`);
    }
  }
}
