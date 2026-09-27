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

  constructor(storageRoot?: string) {
    this.storageRoot = storageRoot || path.join(process.cwd(), "data", "hpc-staging");
    fs.mkdirSync(this.storageRoot, { recursive: true });
  }

  private resolveKey(remoteKey: string): string {
    return path.join(this.storageRoot, remoteKey.replace(/^\/+/, ""));
  }

  public async uploadFile(remoteKey: string, localPathOrBuffer: string | Buffer): Promise<string> {
    const dest = this.resolveKey(remoteKey);
    fs.mkdirSync(path.dirname(dest), { recursive: true });

    if (typeof localPathOrBuffer === "string") {
      fs.copyFileSync(localPathOrBuffer, dest);
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
    fs.mkdirSync(path.dirname(localDestinationPath), { recursive: true });
    fs.copyFileSync(src, localDestinationPath);
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
  ): Promise<JobStagingManifest> {
    const inputDownloads: StagedDownloadSpec[] = [];
    const outputUploads: StagedUploadSpec[] = [];

    for (const [filename, localPath] of Object.entries(inputFiles)) {
      const remoteKey = `jobs/${jobId}/inputs/${filename}`;
      if (fs.existsSync(localPath)) {
        await this.uploadFile(remoteKey, localPath);
      }
      inputDownloads.push({
        remoteKey,
        downloadUrl: `file://${this.resolveKey(remoteKey)}`,
        localFilename: filename,
      });
    }

    for (const filename of expectedOutputs) {
      const remoteKey = `jobs/${jobId}/outputs/${filename}`;
      outputUploads.push({
        remoteKey,
        uploadUrl: `file://${this.resolveKey(remoteKey)}`,
        targetFilename: filename,
      });
    }

    return {
      jobId,
      inputDownloads,
      outputUploads,
      prologueScript: `# [Local Staging] Files reside on shared filesystem`,
      epilogueScript: `# [Local Staging] Output artifacts written directly to target directory`,
    };
  }
}
