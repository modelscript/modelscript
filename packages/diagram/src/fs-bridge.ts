// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Common FileSystem Bridge interface for environment-agnostic file I/O
 * across Node.js desktop, browser webworkers, and LSP client workspaces.
 */
export interface FileSystemBridge {
  readFile(uri: string): Promise<string | null>;
  writeFile(uri: string, content: string): Promise<void>;
  exists(uri: string): Promise<boolean>;
  deleteFile?(uri: string): Promise<void>;
}

/**
 * In-memory FileSystem Bridge.
 * Ideal for unit testing, browser sessions, or temporary scratch workspaces.
 */
export class MemoryFsBridge implements FileSystemBridge {
  private files = new Map<string, string>();

  async readFile(uri: string): Promise<string | null> {
    return this.files.get(uri) ?? null;
  }

  async writeFile(uri: string, content: string): Promise<void> {
    this.files.set(uri, content);
  }

  async exists(uri: string): Promise<boolean> {
    return this.files.has(uri);
  }

  async deleteFile(uri: string): Promise<void> {
    this.files.delete(uri);
  }

  clear(): void {
    this.files.clear();
  }
}

/**
 * Node.js Native FileSystem Bridge.
 * Uses node:fs and node:url to read and write files to the local disk.
 */
export class NodeFsBridge implements FileSystemBridge {
  private fs: typeof import("node:fs") | null = null;
  private fileURLToPath: ((url: string | URL) => string) | null = null;

  constructor() {
    try {
      if (typeof process !== "undefined" && process.versions?.node) {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        this.fs = require("node:fs") as typeof import("node:fs");
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        this.fileURLToPath = (require("node:url") as typeof import("node:url")).fileURLToPath;
      }
    } catch {
      // In browser webworker
    }
  }

  private toPath(uri: string): string | null {
    if (typeof uri !== "string") return null;
    if (uri.startsWith("file://")) {
      try {
        if (this.fileURLToPath) {
          return this.fileURLToPath(uri);
        }
        return decodeURIComponent(new URL(uri).pathname);
      } catch {
        return null;
      }
    }
    return uri.startsWith("/") ? uri : null;
  }

  async readFile(uri: string): Promise<string | null> {
    const path = this.toPath(uri);
    if (!path || !this.fs) return null;
    try {
      if (this.fs.existsSync(path)) {
        return this.fs.readFileSync(path, "utf-8");
      }
    } catch {
      // ignore read error
    }
    return null;
  }

  async writeFile(uri: string, content: string): Promise<void> {
    const path = this.toPath(uri);
    if (!path || !this.fs) return;
    try {
      // Ensure parent directory exists
      const lastSlash = path.lastIndexOf("/");
      if (lastSlash > 0) {
        const dir = path.substring(0, lastSlash);
        if (!this.fs.existsSync(dir)) {
          this.fs.mkdirSync(dir, { recursive: true });
        }
      }
      this.fs.writeFileSync(path, content, "utf-8");
    } catch {
      // ignore write error
    }
  }

  async exists(uri: string): Promise<boolean> {
    const path = this.toPath(uri);
    if (!path || !this.fs) return false;
    try {
      return this.fs.existsSync(path);
    } catch {
      return false;
    }
  }

  async deleteFile(uri: string): Promise<void> {
    const path = this.toPath(uri);
    if (!path || !this.fs) return;
    try {
      if (this.fs.existsSync(path)) {
        this.fs.unlinkSync(path);
      }
    } catch {
      // ignore
    }
  }
}

/**
 * Creates the default FileSystemBridge appropriate for the active runtime environment.
 */
export function createDefaultFsBridge(): FileSystemBridge {
  if (typeof process !== "undefined" && process.versions?.node) {
    return new NodeFsBridge();
  }
  return new MemoryFsBridge();
}
