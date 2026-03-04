// SPDX-License-Identifier: AGPL-3.0-or-later

import fs from "node:fs";
import path from "node:path";

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
