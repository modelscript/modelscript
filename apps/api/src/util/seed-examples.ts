// SPDX-License-Identifier: AGPL-3.0-or-later

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yazl from "yazl";

import type { LibraryDatabase } from "../database.js";
import type { JobQueue } from "../jobs.js";
import type { LibraryStorage } from "../storage.js";

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
        if (entry.isFile() && (entry.name.endsWith(".sysml") || entry.name.endsWith(".kerml"))) {
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      if (err.name !== "ConflictError" && !err.message.includes("already exists")) {
        throw err;
      }
    }
    const libraryPath = await storage.extractLibrary(name, version);

    // Register in database
    const { id: packageId } = database.getOrCreatePackage(name);
    database.updatePackageMeta(packageId, {
      description: typeof manifest["description"] === "string" ? manifest["description"] : null,
      readme: fs.existsSync(path.join(pkgDir, "README.md"))
        ? fs.readFileSync(path.join(pkgDir, "README.md"), "utf-8")
        : null,
      license: typeof manifest["license"] === "string" ? manifest["license"] : null,
    });

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
    database.setDistTag(packageId, "latest", version);
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

export async function seedPrepackagedLibraries(
  storage: LibraryStorage,
  database: LibraryDatabase,
  jobQueue: JobQueue,
): Promise<void> {
  const prepackaged = [
    {
      name: "Modelica",
      version: "4.1.0",
      filename: "ModelicaStandardLibrary_v4.1.0.zip",
      description: "Modelica Standard Library",
      license: "BSD-3-Clause",
    },
    {
      name: "SysML",
      version: "2026.3.0",
      filename: "SysML-v2-Release-2026-03.zip",
      description: "OMG SysML v2 & KerML Standard Library",
      license: "OMG-SysML-2.0",
    },
  ];

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

        const classes = database.getClasses(pkg.name, pkg.version);
        if (classes.length > 0 || pkg.name !== "Modelica") {
          continue; // Already seeded and processed
        }

        // If package and version exist but classes are empty (e.g. failed/interrupted processing), re-enqueue job
        let libraryPath = storage.getExtractedPath(pkg.name, pkg.version);
        if (!fs.existsSync(libraryPath)) {
          try {
            libraryPath = await storage.extractLibrary(pkg.name, pkg.version);
          } catch (err) {
            console.warn(`[Seed] Could not extract library for ${pkg.name}@${pkg.version}:`, err);
          }
        }
        if (fs.existsSync(libraryPath)) {
          console.log(`[Seed] Re-enqueuing processing for unindexed prepackaged library: ${pkg.name}@${pkg.version}`);
          const jobKey = `${pkg.name}@${pkg.version}`;
          jobQueue.enqueueProcess(jobKey, workerScript, {
            name: pkg.name,
            version: pkg.version,
            libraryPath,
            storageDir: storage.dataDir,
            dbDir: database.dbDir,
          });
          continue;
        }
      }
    }

    const zipPath = path.resolve(repoRoot, "scripts", pkg.filename);
    let zipBuffer: Buffer | null = null;
    if (fs.existsSync(zipPath)) {
      zipBuffer = fs.readFileSync(zipPath);
    } else if (pkg.name === "SysML") {
      const stdlibDir = path.resolve(repoRoot, "languages/sysml2/stdlib");
      if (fs.existsSync(stdlibDir)) {
        zipBuffer = await zipSysmlStdlibToBuffer(stdlibDir, pkg.version);
      }
    }

    if (!zipBuffer) {
      console.warn(`[Seed] Prepackaged library zip not found: ${zipPath}`);
      continue;
    }

    console.log(`[Seed] Loading prepackaged library: ${pkg.name}@${pkg.version}`);

    try {
      await storage.store(pkg.name, pkg.version, zipBuffer);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      if (err.name !== "ConflictError" && !err.message.includes("already exists")) {
        throw err;
      }
    }
    const libraryPath = await storage.extractLibrary(pkg.name, pkg.version);

    const { id: packageId } = database.getOrCreatePackage(pkg.name);
    database.updatePackageMeta(packageId, { description: pkg.description, license: pkg.license });

    const shasum = crypto.createHash("sha1").update(zipBuffer).digest("hex");
    const sha256 = crypto.createHash("sha256").update(zipBuffer).digest("hex");
    if (!database.getPackageVersion(packageId, pkg.version)) {
      database.storePackageVersion(
        packageId,
        pkg.version,
        `file://${zipPath}`,
        shasum,
        null,
        zipBuffer.length,
        JSON.stringify({ name: pkg.name, version: pkg.version, description: pkg.description, license: pkg.license }),
        null,
        null,
      );
    }
    database.setDistTag(packageId, "latest", pkg.version);
    database.saveLibraryRelease({
      libraryName: pkg.name,
      libraryVersion: pkg.version,
      contentHash: `sha256:${sha256}`,
      signature: null,
      publishedBy: null,
    });

    const jobKey = `${pkg.name}@${pkg.version}`;
    jobQueue.enqueueProcess(jobKey, workerScript, {
      name: pkg.name,
      version: pkg.version,
      libraryPath,
      storageDir: storage.dataDir,
      dbDir: database.dbDir,
    });
  }
}
