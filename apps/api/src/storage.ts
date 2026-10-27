// SPDX-License-Identifier: AGPL-3.0-or-later

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import semver from "semver";

import type { StorageDriver } from "./storage/driver.js";
import { FilesystemStorageDriver } from "./storage/filesystem-driver.js";
import { S3StorageDriver } from "./storage/s3-driver.js";
import { extractZipToDir, findLibraryRoot } from "./util/zip.js";

export * from "./storage/driver.js";
export * from "./storage/filesystem-driver.js";
export * from "./storage/s3-driver.js";

const DEFAULT_DATA_DIR = (() => {
  try {
    const repoRootLibDir = path.resolve(import.meta.dirname, "../../../data/libraries");
    if (fs.existsSync(repoRootLibDir)) {
      return repoRootLibDir;
    }
  } catch {
    // fallback
  }
  return "data/libraries";
})();

/**
 * Storage manager for ModelScript libraries, supporting pluggable drivers
 * (Filesystem or S3/MinIO) and local extracted caching.
 */
export class LibraryStorage {
  readonly #dataDir: string;
  readonly #driver: StorageDriver;

  constructor(dataDirOrDriver?: string | StorageDriver) {
    if (typeof dataDirOrDriver === "object" && dataDirOrDriver !== null && "driverName" in dataDirOrDriver) {
      this.#driver = dataDirOrDriver;
      this.#dataDir = path.resolve(DEFAULT_DATA_DIR);
    } else {
      this.#dataDir = path.resolve(dataDirOrDriver ?? DEFAULT_DATA_DIR);
      this.#driver = new FilesystemStorageDriver(this.#dataDir);
    }
  }

  /**
   * Factory method creating a LibraryStorage instance from environment variables.
   * Supports `STORAGE_BACKEND=s3` with S3 / MinIO / R2 configurations.
   */
  static fromEnv(defaultDir?: string): LibraryStorage {
    const backend = process.env["STORAGE_BACKEND"] || "filesystem";
    if (backend === "s3") {
      const bucket = process.env["S3_BUCKET"] || "modelscript-packages";
      const endpoint = process.env["S3_ENDPOINT"];
      const region = process.env["S3_REGION"] || "us-east-1";
      const accessKeyId = process.env["S3_ACCESS_KEY_ID"];
      const secretAccessKey = process.env["S3_SECRET_ACCESS_KEY"];
      const forcePathStyle = process.env["S3_FORCE_PATH_STYLE"] === "true";
      const prefix = process.env["S3_PREFIX"];

      const driver = new S3StorageDriver({
        bucket,
        endpoint,
        region,
        accessKeyId,
        secretAccessKey,
        forcePathStyle,
        prefix,
      });
      return new LibraryStorage(driver);
    }
    return new LibraryStorage(defaultDir);
  }

  get dataDir(): string {
    return this.#dataDir;
  }

  get driver(): StorageDriver {
    return this.#driver;
  }

  /**
   * Check if a library version already exists.
   */
  exists(name: string, version: string): boolean {
    return fs.existsSync(this.#filePath(name, version));
  }

  /**
   * List all package names, optionally filtered by a case-insensitive query.
   */
  list(query?: string): string[] {
    if (!fs.existsSync(this.#dataDir)) {
      return [];
    }

    let names = fs
      .readdirSync(this.#dataDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => {
        if (d.name.startsWith("@") && d.name.includes("__")) {
          return "@" + d.name.slice(1).replace(/__/g, "/");
        }
        return d.name;
      })
      .filter((name) => this.versions(name).length > 0);

    if (query) {
      const lower = query.toLowerCase();
      names = names.filter((n) => n.toLowerCase().includes(lower));
    }

    return names.sort();
  }

  /**
   * List all versions for a given package, sorted descending by semver.
   */
  versions(name: string): string[] {
    const dir = path.resolve(this.#dataDir, this.#safe(name));
    if (!fs.existsSync(dir)) {
      return [];
    }

    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".zip"))
      .map((f) => f.replace(/\.zip$/, ""))
      .filter((v) => semver.valid(v) !== null)
      .sort((a, b) => semver.rcompare(a, b));
  }

  /**
   * Read the zip buffer for a specific library version.
   * Returns null if the file does not exist.
   */
  read(name: string, version: string): { buffer: Buffer; size: number } | null {
    const filePath = this.#filePath(name, version);
    if (!fs.existsSync(filePath)) {
      return null;
    }

    const buffer = fs.readFileSync(filePath);
    return { buffer, size: buffer.length };
  }

  /**
   * Store a library zip file. Throws if the version already exists.
   */
  async store(name: string, version: string, buffer: Buffer): Promise<string> {
    const filePath = this.#filePath(name, version);

    if (fs.existsSync(filePath)) {
      throw new ConflictError(`Library ${name}@${version} already exists`);
    }

    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, buffer);

    const hash = crypto.createHash("sha256").update(buffer).digest("hex");
    fs.writeFileSync(path.join(dir, `${this.#safe(version)}.sha256`), hash, "utf-8");

    if (this.#driver.driverName === "s3") {
      const s3Key = `${this.#safe(name)}/${this.#safe(version)}.zip`;
      await this.#driver.write(s3Key, buffer, { contentType: "application/zip" });
    }

    return filePath;
  }

  /**
   * Retrieves the cryptographic SHA-256 content hash of a stored library version.
   */
  getContentHash(name: string, version: string): string | null {
    const shaFile = path.resolve(this.#dataDir, this.#safe(name), `${this.#safe(version)}.sha256`);
    if (fs.existsSync(shaFile)) {
      return `sha256:${fs.readFileSync(shaFile, "utf-8").trim()}`;
    }
    const file = this.read(name, version);
    if (!file) return null;
    const hash = crypto.createHash("sha256").update(file.buffer).digest("hex");
    try {
      fs.writeFileSync(shaFile, hash, "utf-8");
    } catch {
      // ignore
    }
    return `sha256:${hash}`;
  }

  /**
   * Store SVGs for a single class.
   */
  storeSvg(name: string, version: string, className: string, icon: string | null, diagram: string | null): void {
    const dir = this.#svgDir(name, version, className);
    fs.mkdirSync(dir, { recursive: true });

    if (icon) {
      fs.writeFileSync(path.join(dir, "icon.svg"), icon, "utf-8");
    }
    if (diagram) {
      fs.writeFileSync(path.join(dir, "diagram.svg"), diagram, "utf-8");
    }
  }

  /**
   * Store generated SVG files for all classes in a library version.
   */
  storeSvgs(name: string, version: string, svgs: Map<string, { icon: string | null; diagram: string | null }>): void {
    for (const [className, { icon, diagram }] of svgs) {
      this.storeSvg(name, version, className, icon, diagram);
    }
  }

  /**
   * Read a single SVG file for a class.
   */
  readSvg(name: string, version: string, className: string, type: "icon" | "diagram"): string | null {
    const filePath = path.join(this.#svgDir(name, version, className), `${type}.svg`);
    if (!fs.existsSync(filePath)) {
      return null;
    }
    return fs.readFileSync(filePath, "utf-8");
  }

  /**
   * List class names that have generated SVGs for a library version.
   */
  listClasses(name: string, version: string): string[] {
    const dir = path.resolve(this.#dataDir, this.#safe(name), this.#safe(version), "svgs");
    if (!fs.existsSync(dir)) {
      return [];
    }

    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
  }

  /**
   * Extract the library zip to an extracted folder inside storage.
   * Returns the path to the root of the extracted library (the folder containing package.mo).
   * Throws if the zip is missing or invalid.
   */
  async extractLibrary(name: string, version: string): Promise<string> {
    const extPath = this.getExtractedPath(name, version);
    if (fs.existsSync(extPath)) {
      return extPath;
    }

    const zipData = this.read(name, version);
    if (!zipData) {
      throw new Error(`Library ${name}@${version} not found`);
    }

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "modelscript-extract-"));
    try {
      await extractZipToDir(zipData.buffer, tmpDir);

      let libraryRoot = findLibraryRoot(tmpDir, name);
      if (!libraryRoot) {
        // Fallback for data-only packages (like drone-chassis)
        const entries = fs.readdirSync(tmpDir, { withFileTypes: true });
        const firstEntry = entries[0];
        if (entries.length === 1 && firstEntry && firstEntry.isDirectory()) {
          libraryRoot = path.join(tmpDir, firstEntry.name);
        } else {
          libraryRoot = tmpDir;
        }
      }

      fs.mkdirSync(path.dirname(extPath), { recursive: true });
      fs.cpSync(libraryRoot, extPath, { recursive: true });

      return extPath;
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  /**
   * Get the persistent path where the library is extracted.
   * Format: `<dataDir>/<name>/<version>/extracted/<name>`
   */
  getExtractedPath(name: string, version: string): string {
    return path.join(this.#dataDir, this.#safe(name), this.#safe(version), "extracted", this.#safe(name));
  }

  /**
   * Get the path to the pre-computed salsa-index.db for this library version.
   */
  getIndexPath(name: string, version: string): string {
    return path.join(this.#dataDir, this.#safe(name), this.#safe(version), "salsa-index.db");
  }

  /**
   * Get the path to the cached .aasx container for this library version.
   */
  getCachedAasxPath(name: string, version: string): string {
    return path.join(this.#dataDir, this.#safe(name), this.#safe(version), "package.aasx");
  }

  /**
   * Read the cached .aasx buffer if available.
   */
  readCachedAasx(name: string, version: string): Buffer | null {
    const p = this.getCachedAasxPath(name, version);
    if (!fs.existsSync(p)) return null;
    return fs.readFileSync(p);
  }

  /**
   * Store a generated .aasx container into cache.
   */
  storeCachedAasx(name: string, version: string, buffer: Buffer): void {
    const p = this.getCachedAasxPath(name, version);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, buffer);
  }

  /**
   * Get the path to the cached pre-tessellated CAD mesh file.
   */
  getCadMeshPath(name: string, version: string, relPath: string): string {
    const cleanRel = relPath.replace(/^(\.\/|\/)+/, "").replace(/[^a-zA-Z0-9_.-]/g, "_");
    return path.join(this.#dataDir, this.#safe(name), this.#safe(version), "cad-meshes", `${cleanRel}.mesh.json`);
  }

  /**
   * Read the cached CAD mesh JSON if available.
   */
  readCadMesh(name: string, version: string, relPath: string): string | null {
    const p = this.getCadMeshPath(name, version, relPath);
    if (!fs.existsSync(p)) return null;
    return fs.readFileSync(p, "utf-8");
  }

  /**
   * Store pre-tessellated CAD mesh JSON.
   */
  storeCadMesh(name: string, version: string, relPath: string, meshContent: string): void {
    const p = this.getCadMeshPath(name, version, relPath);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, meshContent, "utf-8");
  }

  /**
   * Delete a specific library version.
   * Removes the zip file and all version data (SVGs, extracted files).
   * If no other versions remain, removes the library directory entirely.
   */
  delete(name: string, version: string): boolean {
    const zipPath = this.#filePath(name, version);
    if (!fs.existsSync(zipPath)) {
      return false;
    }

    // Remove the zip file and its sha256 sidecar
    fs.rmSync(zipPath, { force: true });
    const shaPath = path.resolve(this.#dataDir, this.#safe(name), `${this.#safe(version)}.sha256`);
    fs.rmSync(shaPath, { force: true });

    // Remove the version data directory (svgs, extracted, etc.)
    const versionDir = path.resolve(this.#dataDir, this.#safe(name), this.#safe(version));
    if (fs.existsSync(versionDir)) {
      fs.rmSync(versionDir, { recursive: true, force: true });
    }

    // Clean up the library directory if no more versions exist
    const libraryDir = path.resolve(this.#dataDir, this.#safe(name));
    if (fs.existsSync(libraryDir)) {
      if (this.versions(name).length === 0) {
        fs.rmSync(libraryDir, { recursive: true, force: true });
      }
    }

    if (this.#driver.driverName === "s3") {
      const s3Key = `${this.#safe(name)}/${this.#safe(version)}.zip`;
      this.#driver.delete(s3Key).catch(() => {});
    }

    return true;
  }

  #safe(val: string): string {
    if (typeof val !== "string") {
      throw new Error("Invalid path component: expected string");
    }
    const normalized = val.startsWith("@") ? "@" + val.slice(1).replace(/[/\\]/g, "__") : val;
    const clean = path.basename(normalized).replace(/[^@a-zA-Z0-9_.-]/g, "_");
    if (!clean || clean === "." || clean === "..") {
      throw new Error(`Invalid path component: ${val}`);
    }
    const resolved = path.resolve(this.#dataDir, clean);
    if (!resolved.startsWith(this.#dataDir + path.sep) && resolved !== this.#dataDir) {
      throw new Error(`Path traversal detected: ${val}`);
    }
    return clean;
  }

  #svgDir(name: string, version: string, className: string): string {
    return path.join(this.#dataDir, this.#safe(name), this.#safe(version), "svgs", this.#safe(className));
  }

  #filePath(name: string, version: string): string {
    return path.join(this.#dataDir, this.#safe(name), `${this.#safe(version)}.zip`);
  }
}

export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConflictError";
  }
}
