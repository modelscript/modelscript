// SPDX-License-Identifier: AGPL-3.0-or-later

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { StorageDriver, StorageObjectMetadata } from "./driver.js";

/**
 * Storage driver operating on the local filesystem with path safety checks.
 */
export class FilesystemStorageDriver implements StorageDriver {
  readonly driverName = "filesystem" as const;
  readonly #baseDir: string;

  constructor(baseDir: string) {
    this.#baseDir = path.resolve(baseDir);
    if (!fs.existsSync(this.#baseDir)) {
      fs.mkdirSync(this.#baseDir, { recursive: true });
    }
  }

  get baseDir(): string {
    return this.#baseDir;
  }

  async exists(key: string): Promise<boolean> {
    const fullPath = this.#resolveKey(key);
    return fs.existsSync(fullPath);
  }

  async read(key: string): Promise<Buffer | null> {
    const fullPath = this.#resolveKey(key);
    if (!fs.existsSync(fullPath)) return null;
    return fs.readFileSync(fullPath);
  }

  async write(key: string, buffer: Buffer): Promise<void> {
    const fullPath = this.#resolveKey(key);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, buffer);
  }

  async delete(key: string): Promise<boolean> {
    const fullPath = this.#resolveKey(key);
    if (!fs.existsSync(fullPath)) return false;
    fs.rmSync(fullPath, { force: true });
    return true;
  }

  async list(prefix = ""): Promise<string[]> {
    const targetDir = this.#resolveKey(prefix);
    if (!fs.existsSync(targetDir)) return [];

    const results: string[] = [];
    const walk = (currentDir: string) => {
      const entries = fs.readdirSync(currentDir, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(currentDir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.isFile()) {
          const rel = path.relative(this.#baseDir, full).replace(/\\/g, "/");
          results.push(rel);
        }
      }
    };

    const stat = fs.statSync(targetDir);
    if (stat.isDirectory()) {
      walk(targetDir);
    } else {
      results.push(path.relative(this.#baseDir, targetDir).replace(/\\/g, "/"));
    }

    return results.sort();
  }

  async deletePrefix(prefix: string): Promise<number> {
    const targetPath = this.#resolveKey(prefix);
    if (!fs.existsSync(targetPath)) return 0;

    let count = 0;
    const stat = fs.statSync(targetPath);
    if (stat.isDirectory()) {
      const keys = await this.list(prefix);
      count = keys.length;
      fs.rmSync(targetPath, { recursive: true, force: true });
    } else {
      fs.rmSync(targetPath, { force: true });
      count = 1;
    }
    return count;
  }

  async getMetadata(key: string): Promise<StorageObjectMetadata | null> {
    const fullPath = this.#resolveKey(key);
    if (!fs.existsSync(fullPath)) return null;

    const stat = fs.statSync(fullPath);
    const buf = fs.readFileSync(fullPath);
    const contentHash = `sha256:${crypto.createHash("sha256").update(buf).digest("hex")}`;

    return {
      size: stat.size,
      contentHash,
      lastModified: stat.mtime,
    };
  }

  #resolveKey(key: string): string {
    const clean = key.replace(/\\/g, "/").replace(/^\/+/, "");
    const resolved = path.resolve(this.#baseDir, clean);
    if (!resolved.startsWith(this.#baseDir)) {
      throw new Error(`Path traversal detected: ${key}`);
    }
    return resolved;
  }
}
