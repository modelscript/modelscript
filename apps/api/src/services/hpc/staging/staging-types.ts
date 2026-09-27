// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Type definitions for HPC asset and artifact staging across remote storage boundaries.
 */

export interface StagedUploadSpec {
  remoteKey: string;
  uploadUrl: string;
  targetFilename: string;
}

export interface StagedDownloadSpec {
  remoteKey: string;
  downloadUrl: string;
  localFilename: string;
}

export interface JobStagingManifest {
  jobId: string;
  inputDownloads: StagedDownloadSpec[];
  outputUploads: StagedUploadSpec[];
  prologueScript: string;
  epilogueScript: string;
}

export interface ObjectStager {
  readonly type: "s3" | "local";

  /** Uploads a local file or buffer to remote object storage */
  uploadFile(remoteKey: string, localPathOrBuffer: string | Buffer, contentType?: string): Promise<string>;

  /** Downloads a remote artifact to a local destination file */
  downloadFile(remoteKey: string, localDestinationPath: string): Promise<void>;

  /** Generates a time-limited pre-signed GET URL for downloading */
  getDownloadUrl(remoteKey: string, expiresInSeconds?: number): Promise<string>;

  /** Generates a time-limited pre-signed PUT URL for uploading */
  getUploadUrl(remoteKey: string, expiresInSeconds?: number): Promise<string>;

  /** Checks if a remote artifact exists in storage */
  hasObject(remoteKey: string): Promise<boolean>;

  /** Prepares staging manifest with input downloads and output uploads */
  createJobStagingManifest(
    jobId: string,
    inputFiles: Record<string, string>, // { "deck.inp": "/local/path/deck.inp" }
    expectedOutputs: string[], // ["result.vtu", "scalars.json", "output.log"]
  ): Promise<JobStagingManifest>;
}
