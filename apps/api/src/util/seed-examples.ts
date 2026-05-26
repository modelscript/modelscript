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

export async function seedExamplePackages(
  storage: LibraryStorage,
  database: LibraryDatabase,
  jobQueue: JobQueue,
): Promise<void> {
  const examplesDir = path.resolve("packages/examples");
  if (!fs.existsSync(examplesDir)) return;

  const packages = fs.readdirSync(examplesDir, { withFileTypes: true });
  for (const pkgEntry of packages) {
    if (!pkgEntry.isDirectory()) continue;

    const pkgDir = path.join(examplesDir, pkgEntry.name);
    const pkgJsonPath = path.join(pkgDir, "package.json");
    if (!fs.existsSync(pkgJsonPath)) continue;

    const manifestStr = fs.readFileSync(pkgJsonPath, "utf-8");
    const manifest = JSON.parse(manifestStr) as Record<string, unknown>;
    const name = typeof manifest["name"] === "string" ? manifest["name"] : null;
    const version = typeof manifest["version"] === "string" ? manifest["version"] : null;

    if (!name || !version) {
      console.warn(`[Seed] Example ${pkgEntry.name} is missing name or version in package.json. Skipping.`);
      continue;
    }

    // Check if already seeded
    const existingPkg = database.getPackage(name);
    if (existingPkg) {
      const existingVer = database.getPackageVersion(existingPkg.id, version);
      if (existingVer) {
        // Already loaded
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
    database.setDistTag(packageId, "latest", version);

    // Enqueue job to process Modelica classes, SVGs, and scan artifacts
    const jobKey = `${name}@${version}`;
    const ext = import.meta.url.endsWith(".ts") ? ".ts" : ".js";
    const workerScript = fileURLToPath(new URL(`../publish-worker${ext}`, import.meta.url));
    jobQueue.enqueueProcess(jobKey, workerScript, { name, version, libraryPath });
  }
}
