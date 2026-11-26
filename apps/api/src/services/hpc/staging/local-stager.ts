// SPDX-License-Identifier: AGPL-3.0-or-later

import fs from "node:fs";
import path from "node:path";
import type { JobStagingManifest, ObjectStager, StagedDownloadSpec, StagedUploadSpec } from "./staging-types.js";

/**
 * Local filesystem object stager for development or HPC clusters sharing a POSIX/NFS filesystem.
 */
export class LocalFsObjectStager implements ObjectStager {
  readonly type = "local" as const;
  private readonly storageRoot: string;
  private readonly realStorageRoot: string;

  constructor(storageRoot?: string) {
    this.storageRoot = path.resolve(storageRoot || path.join(process.cwd(), "data", "hpc-staging"));
    fs.mkdirSync(this.storageRoot, { recursive: true });
    this.realStorageRoot = fs.realpathSync(this.storageRoot);
  }

  private assertContainedRealPath(candidatePath: string, label: string): void {
    // Walk up until we find an existing ancestor so realpathSync catches symlink escapes
    let current = candidatePath;
    while (!fs.existsSync(current)) {
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
    if (fs.existsSync(current)) {
      const realCurrent = fs.realpathSync(current);
      const realRootWithSep = this.realStorageRoot.endsWith(path.sep)
        ? this.realStorageRoot
        : this.realStorageRoot + path.sep;
      if (realCurrent !== this.realStorageRoot && !realCurrent.startsWith(realRootWithSep)) {
        throw new Error(`Symlink escape detected for ${label}`);
      }
    }
  }

  private resolveKey(remoteKey: string): string {
    if (
      typeof remoteKey !== "string" ||
      Array.isArray(remoteKey) ||
      remoteKey.length === 0 ||
      remoteKey.includes("\0")
    ) {
      throw new Error("Invalid remote key");
    }
    const rawSegments = remoteKey.split(/[/\\]+/).filter((s) => s.length > 0);
    if (rawSegments.length === 0 || rawSegments.some((s) => s === ".." || s === ".")) {
      throw new Error(`Path traversal detected: ${remoteKey}`);
    }
    const resolved = path.resolve(this.storageRoot, ...rawSegments);
    const rootWithSep = this.storageRoot.endsWith(path.sep) ? this.storageRoot : this.storageRoot + path.sep;
    if (!resolved.startsWith(rootWithSep) && resolved !== this.storageRoot) {
      throw new Error(`Path traversal detected: ${remoteKey}`);
    }
    this.assertContainedRealPath(resolved, remoteKey);
    return resolved;
  }

  private sanitizeIdentifier(value: string, label: string, allowSubpaths = false): string {
    if (typeof value !== "string" || value.length === 0 || value.includes("\0")) {
      throw new Error(`Invalid local staging ${label}: ${value}`);
    }
    const normalized = value.replace(/\\/g, "/").replace(/^\/+/, "");
    const segments = normalized.split("/");
    if (!allowSubpaths && segments.length !== 1) {
      throw new Error(`Invalid local staging ${label}: ${value}`);
    }
    for (const seg of segments) {
      if (!seg || seg === "." || seg === ".." || !/^[a-zA-Z0-9._-]+$/.test(seg)) {
        throw new Error(`Invalid local staging ${label}: ${value}`);
      }
    }
    return segments.join("/");
  }

  private assertSafeDestinationPath(localDestinationPath: string): string {
    if (
      typeof localDestinationPath !== "string" ||
      localDestinationPath.trim().length === 0 ||
      localDestinationPath.includes("\0")
    ) {
      throw new Error("Invalid local destination path");
    }
    const resolved = path.resolve(localDestinationPath);
    const blockedPrefixes = ["/etc", "/proc", "/sys", "/dev", "/usr", "/bin", "/sbin", "/boot", "/root"];
    for (const prefix of blockedPrefixes) {
      if (resolved === prefix || resolved.startsWith(prefix + path.sep)) {
        throw new Error(`Unsafe local destination path: ${localDestinationPath}`);
      }
    }
    return resolved;
  }

  public async uploadFile(remoteKey: string, localPathOrBuffer: string | Buffer): Promise<string> {
    const dest = this.resolveKey(remoteKey);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    this.assertContainedRealPath(dest, remoteKey);

    if (typeof localPathOrBuffer === "string") {
      if (localPathOrBuffer.includes("\0")) {
        throw new Error("Invalid local source path");
      }
      const cleanLocal = path.resolve(localPathOrBuffer);
      fs.copyFileSync(cleanLocal, dest);
    } else {
      fs.writeFileSync(dest, localPathOrBuffer);
    }
    return `file://${dest}`;
  }

  public async downloadFile(remoteKey: string, localDestinationPath: string): Promise<void> {
    const src = this.resolveKey(remoteKey);
    if (!fs.existsSync(src)) {
      throw new Error(`Local staged file not found: ${src}`);
    }
    const safeDest = this.assertSafeDestinationPath(localDestinationPath);
    fs.mkdirSync(path.dirname(safeDest), { recursive: true });
    fs.copyFileSync(src, safeDest);
  }

  public async getDownloadUrl(remoteKey: string): Promise<string> {
    return `file://${this.resolveKey(remoteKey)}`;
  }

  public async getUploadUrl(remoteKey: string): Promise<string> {
    return `file://${this.resolveKey(remoteKey)}`;
  }

  public async hasObject(remoteKey: string): Promise<boolean> {
    return fs.existsSync(this.resolveKey(remoteKey));
  }

  public async createJobStagingManifest(
    jobId: string,
    inputFiles: Record<string, string>,
    expectedOutputs: string[],
    _options?: { maxWalltimeSeconds?: number | undefined },
  ): Promise<JobStagingManifest> {
    const safeJobId = this.sanitizeIdentifier(jobId, "jobId", false);
    const inputDownloads: StagedDownloadSpec[] = [];
    const outputUploads: StagedUploadSpec[] = [];

    for (const [filename, localPath] of Object.entries(inputFiles)) {
      const safeFile = this.sanitizeIdentifier(filename, "input filename", true);
      const remoteKey = `jobs/${safeJobId}/inputs/${safeFile}`;
      if (fs.existsSync(localPath)) {
        await this.uploadFile(remoteKey, localPath);
      }
      inputDownloads.push({
        remoteKey,
        downloadUrl: `file://${this.resolveKey(remoteKey)}`,
        localFilename: safeFile,
      });
    }

    for (const filename of expectedOutputs) {
      const safeFile = this.sanitizeIdentifier(filename, "output filename", false);
      const remoteKey = `jobs/${safeJobId}/outputs/${safeFile}`;
      outputUploads.push({
        remoteKey,
        uploadUrl: `file://${this.resolveKey(remoteKey)}`,
        targetFilename: safeFile,
      });
    }

    return {
      jobId: safeJobId,
      inputDownloads,
      outputUploads,
      prologueScript: `# [Local Staging] Files reside on shared filesystem`,
      epilogueScript: `# [Local Staging] Output artifacts written directly to target directory`,
    };
  }

  public async readLogChunk(
    remoteKey: string,
    startByte: number,
  ): Promise<{ chunk: string; totalBytes: number } | null> {
    try {
      const filePath = this.resolveKey(remoteKey);
      if (!fs.existsSync(filePath)) return null;
      const stats = fs.statSync(filePath);
      if (stats.size <= startByte) return null;
      const fd = fs.openSync(filePath, "r");
      try {
        const length = stats.size - startByte;
        const buf = Buffer.alloc(length);
        fs.readSync(fd, buf, 0, length, startByte);
        return { chunk: buf.toString("utf8"), totalBytes: stats.size };
      } finally {
        fs.closeSync(fd);
      }
    } catch {
      return null;
    }
  }
}
