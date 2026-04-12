// SPDX-License-Identifier: AGPL-3.0-or-later

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import semver from "semver";

import { extractZipToDir, findLibraryRoot } from "./util/zip.js";

const DEFAULT_DATA_DIR = "data/libraries";

/**
 * Simple filesystem-based storage for uploaded Modelica libraries.
 * Stores zips at `<dataDir>/<name>/<version>.zip`.
 */
export class LibraryStorage {
  readonly #dataDir: string;

  constructor(dataDir?: string) {
    this.#dataDir = dataDir ?? DEFAULT_DATA_DIR;
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
      .map((d) => d.name);

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
    const dir = path.join(this.#dataDir, name);
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

    return filePath;
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
    const dir = path.join(this.#dataDir, name, version, "svgs");
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

      const libraryRoot = findLibraryRoot(tmpDir);
      if (!libraryRoot) {
        throw new Error(`Could not find package.mo in the extracted zip for ${name}@${version}`);
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
    return path.join(this.#dataDir, name, version, "extracted", name);
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

    // Remove the zip file
    fs.rmSync(zipPath, { force: true });

    // Remove the version data directory (svgs, extracted, etc.)
    const versionDir = path.join(this.#dataDir, name, version);
    if (fs.existsSync(versionDir)) {
      fs.rmSync(versionDir, { recursive: true, force: true });
    }

    // Clean up the library directory if no more versions exist
    const libraryDir = path.join(this.#dataDir, name);
    if (fs.existsSync(libraryDir)) {
      const remaining = fs.readdirSync(libraryDir);
      if (remaining.length === 0) {
        fs.rmSync(libraryDir, { recursive: true, force: true });
      }
    }

    return true;
  }

  #svgDir(name: string, version: string, className: string): string {
    return path.join(this.#dataDir, name, version, "svgs", className);
  }

  #filePath(name: string, version: string): string {
    return path.join(this.#dataDir, name, `${version}.zip`);
  }
}

export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConflictError";
  }
}
