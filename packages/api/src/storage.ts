// SPDX-License-Identifier: AGPL-3.0-or-later

import fs from "node:fs";
import path from "node:path";

import semver from "semver";

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
