// SPDX-License-Identifier: AGPL-3.0-or-later

import AdmZip from "adm-zip";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parsePackageUses } from "./package-mo.js";

export interface LinkResult {
  hardlinks: number;
  symlinks: number;
  copies: number;
  totalFiles: number;
}

/**
 * Global content-addressable and hardlink package store for ModelScript.
 * Default location: ~/.modelscript/store/v1 (override via MODELSCRIPT_STORE_DIR).
 */
export class GlobalPackageStore {
  readonly #storeRoot: string;

  constructor(customStoreRoot?: string) {
    this.#storeRoot =
      customStoreRoot || process.env["MODELSCRIPT_STORE_DIR"] || path.join(os.homedir(), ".modelscript", "store", "v1");
  }

  get storeRoot(): string {
    return this.#storeRoot;
  }

  /**
   * Sanitizes package name for safe filesystem path.
   * e.g. '@modelica/Standard' -> '@modelica__Standard'
   */
  sanitizePackageName(packageName: string): string {
    return packageName.replace(/\//g, "__").replace(/[^a-zA-Z0-9@_.-]/g, "_");
  }

  /**
   * Computes the deterministic directory path for a stored package release.
   */
  getPackageStorePath(packageName: string, version: string, contentHash: string): string {
    const safePkg = this.sanitizePackageName(packageName);
    const cleanHash = contentHash
      .toLowerCase()
      .replace(/^sha256:/, "")
      .slice(0, 12);
    const versionDir = `${version}-${cleanHash}`;
    return path.join(this.#storeRoot, "packages", safePkg, versionDir);
  }

  /**
   * Checks whether a package release is already fully extracted in the global store.
   */
  hasPackage(packageName: string, version: string, contentHash: string): boolean {
    const pkgDir = this.getPackageStorePath(packageName, version, contentHash);
    if (!fs.existsSync(pkgDir)) return false;
    const metaFile = path.join(pkgDir, ".msx-store-complete");
    return fs.existsSync(metaFile);
  }

  /**
   * Atomically unpacks a zip archive into the global store.
   * Uses a temporary directory and atomic rename to prevent partial extractions.
   */
  extractToStore(packageName: string, version: string, contentHash: string, zipBuffer: Buffer): string {
    const targetDir = this.getPackageStorePath(packageName, version, contentHash);
    if (this.hasPackage(packageName, version, contentHash)) {
      return targetDir;
    }

    const tmpParent = path.join(this.#storeRoot, ".tmp");
    fs.mkdirSync(tmpParent, { recursive: true });
    const tmpDir = path.join(tmpParent, `ext-${Date.now()}-${crypto.randomBytes(6).toString("hex")}`);

    try {
      fs.mkdirSync(tmpDir, { recursive: true });
      const zip = new AdmZip(zipBuffer);
      zip.extractAllTo(tmpDir, true);

      // Write integrity marker
      fs.writeFileSync(
        path.join(tmpDir, ".msx-store-complete"),
        JSON.stringify(
          {
            packageName,
            version,
            contentHash,
            extractedAt: new Date().toISOString(),
          },
          null,
          2,
        ),
        "utf8",
      );

      // Save archive in store archives/
      this.saveCachedArchive(contentHash, zipBuffer);

      // Ensure parent directory exists for atomic rename
      fs.mkdirSync(path.dirname(targetDir), { recursive: true });

      try {
        fs.renameSync(tmpDir, targetDir);
      } catch (renameErr) {
        // If targetDir already exists (e.g. concurrent extraction), cleanup tmpDir
        if (fs.existsSync(targetDir)) {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        } else {
          throw renameErr;
        }
      }

      return targetDir;
    } catch (err) {
      if (fs.existsSync(tmpDir)) {
        try {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        } catch {}
      }
      throw err;
    }
  }

  /**
   * Links all files from the stored package into the target destination directory.
   * Tries hardlink first (fs.linkSync).
   * Falls back to symlink if hardlinks fail (e.g., cross-filesystem EXDEV).
   * Falls back to copy if symlinks fail (e.g., Windows non-developer mode permissions).
   */
  linkToWorkspace(storePackageDir: string, destDir: string): LinkResult {
    fs.mkdirSync(destDir, { recursive: true });

    let hardlinks = 0;
    let symlinks = 0;
    let copies = 0;
    let totalFiles = 0;

    const walkAndLink = (srcSubDir: string, destSubDir: string): void => {
      const entries = fs.readdirSync(srcSubDir, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.name === ".msx-store-complete") continue;

        const srcPath = path.join(srcSubDir, entry.name);
        const destPath = path.join(destSubDir, entry.name);

        if (entry.isDirectory()) {
          fs.mkdirSync(destPath, { recursive: true });
          walkAndLink(srcPath, destPath);
        } else if (entry.isFile()) {
          totalFiles++;
          if (fs.existsSync(destPath)) {
            try {
              fs.unlinkSync(destPath);
            } catch {}
          }

          // 1. Try hardlink
          try {
            fs.linkSync(srcPath, destPath);
            hardlinks++;
            continue;
          } catch {
            // Hardlink failed, fall through to symlink
          }

          // 2. Try symlink
          try {
            fs.symlinkSync(srcPath, destPath, "file");
            symlinks++;
            continue;
          } catch {
            // Symlink failed, fall through to copy
          }

          // 3. Fallback to copy
          fs.copyFileSync(srcPath, destPath);
          copies++;
        }
      }
    };

    walkAndLink(storePackageDir, destDir);

    return { hardlinks, symlinks, copies, totalFiles };
  }

  /**
   * Checks whether the raw archive is cached in the store.
   */
  hasCachedArchive(contentHash: string): boolean {
    const archivePath = this.getArchiveStorePath(contentHash);
    return fs.existsSync(archivePath);
  }

  /**
   * Returns path to cached archive file.
   */
  getArchiveStorePath(contentHash: string): string {
    const cleanHash = contentHash.toLowerCase().replace(/^sha256:/, "");
    return path.join(this.#storeRoot, "archives", `${cleanHash}.zip`);
  }

  /**
   * Retrieves cached archive buffer if available.
   */
  getCachedArchive(contentHash: string): Buffer | null {
    const archivePath = this.getArchiveStorePath(contentHash);
    if (!fs.existsSync(archivePath)) return null;
    try {
      return fs.readFileSync(archivePath);
    } catch {
      return null;
    }
  }

  /**
   * Saves raw archive buffer into the store's archives directory.
   */
  saveCachedArchive(contentHash: string, buffer: Buffer): void {
    const archivePath = this.getArchiveStorePath(contentHash);
    if (fs.existsSync(archivePath)) return;
    try {
      fs.mkdirSync(path.dirname(archivePath), { recursive: true });
      fs.writeFileSync(archivePath, buffer);
    } catch {
      // Non-fatal archive cache write failure
    }
  }

  /**
   * Lists all cached versions of a package currently extracted in the store.
   */
  listCachedVersions(packageName: string): string[] {
    const safePkg = this.sanitizePackageName(packageName);
    const pkgRoot = path.join(this.#storeRoot, "packages", safePkg);
    if (!fs.existsSync(pkgRoot)) return [];
    const versions: string[] = [];
    try {
      const entries = fs.readdirSync(pkgRoot, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const completeMarker = path.join(pkgRoot, entry.name, ".msx-store-complete");
          if (fs.existsSync(completeMarker)) {
            try {
              const meta = JSON.parse(fs.readFileSync(completeMarker, "utf-8"));
              if (meta.version && !versions.includes(meta.version)) {
                versions.push(meta.version);
              }
            } catch {
              const v = entry.name.split("-")[0];
              if (v && !versions.includes(v)) versions.push(v);
            }
          }
        }
      }
    } catch {
      return [];
    }
    return versions;
  }

  /**
   * Finds the extracted directory in the CAS store for packageName@version.
   */
  getCachedPackageDir(packageName: string, version: string): string | null {
    const safePkg = this.sanitizePackageName(packageName);
    const pkgRoot = path.join(this.#storeRoot, "packages", safePkg);
    if (!fs.existsSync(pkgRoot)) return null;
    try {
      const entries = fs.readdirSync(pkgRoot, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const completeMarker = path.join(pkgRoot, entry.name, ".msx-store-complete");
          if (fs.existsSync(completeMarker)) {
            try {
              const meta = JSON.parse(fs.readFileSync(completeMarker, "utf-8"));
              if (meta.version === version) {
                return path.join(pkgRoot, entry.name);
              }
            } catch {
              if (entry.name.startsWith(`${version}-`)) {
                return path.join(pkgRoot, entry.name);
              }
            }
          }
        }
      }
    } catch {
      return null;
    }
    return null;
  }

  /**
   * Retrieves parsed metadata from .msx-store-complete for a cached package.
   */
  getCachedPackageMeta(
    packageName: string,
    version: string,
  ): { name: string; version: string; contentHash: string } | null {
    const dir = this.getCachedPackageDir(packageName, version);
    if (!dir) return null;
    const marker = path.join(dir, ".msx-store-complete");
    if (!fs.existsSync(marker)) return null;
    try {
      return JSON.parse(fs.readFileSync(marker, "utf-8"));
    } catch {
      return null;
    }
  }

  /**
   * Constructs a package manifest from a cached package in the CAS store.
   */
  getCachedManifest(
    packageName: string,
    version: string,
  ): { name: string; version: string; dependencies?: Record<string, string> } | null {
    const dir = this.getCachedPackageDir(packageName, version);
    if (!dir) return null;

    const pkgJsonPath = path.join(dir, "package.json");
    if (fs.existsSync(pkgJsonPath)) {
      try {
        const data = JSON.parse(fs.readFileSync(pkgJsonPath, "utf-8"));
        const dependencies = { ...data.dependencies, ...data.modelscript?.dependencies };
        return { name: packageName, version, dependencies };
      } catch {}
    }

    const pkgMoPath = path.join(dir, "package.mo");
    if (fs.existsSync(pkgMoPath)) {
      try {
        const content = fs.readFileSync(pkgMoPath, "utf-8");
        const dependencies = parsePackageUses(content);
        return { name: packageName, version, dependencies };
      } catch {}
    }

    return { name: packageName, version, dependencies: {} };
  }
}

export const defaultPackageStore = new GlobalPackageStore();
