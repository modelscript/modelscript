// SPDX-License-Identifier: AGPL-3.0-or-later

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { JobStagingManifest, ObjectStager, StagedDownloadSpec, StagedUploadSpec } from "./staging-types.js";

export interface S3StagerOptions {
  endpoint: string; // e.g. "http://localhost:9000" or "https://s3.amazonaws.com"
  bucket: string; // e.g. "modelscript-hpc-artifacts"
  region?: string; // e.g. "us-east-1"
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle?: boolean; // true for MinIO / local dev (default: true)
  fetchFn?: typeof fetch; // optional injectable fetch for unit testing
}

function hmacSha256(key: Buffer | string, data: string): Buffer {
  return crypto.createHmac("sha256", key).update(data, "utf8").digest();
}

function sha256Hex(data: Buffer | string): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

function getAmzDates(date = new Date()): { dateStamp: string; amzDate: string } {
  const amzDate = date.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  return { dateStamp, amzDate };
}

/**
 * Generates AWS Signature Version 4 (SigV4) presigned URLs and authenticated requests.
 * Fully compatible with AWS S3, MinIO, Ceph, and Cloudflare R2 without external dependencies.
 */
export class S3ObjectStager implements ObjectStager {
  readonly type = "s3" as const;
  private readonly endpoint: string;
  private readonly bucket: string;
  private readonly region: string;
  private readonly accessKeyId: string;
  private readonly secretAccessKey: string;
  private readonly forcePathStyle: boolean;
  private readonly fetchFn: typeof fetch;

  constructor(options: S3StagerOptions) {
    this.endpoint = options.endpoint.replace(/\/+$/, "");
    this.bucket = options.bucket;
    this.region = options.region || "us-east-1";
    this.accessKeyId = options.accessKeyId;
    this.secretAccessKey = options.secretAccessKey;
    this.forcePathStyle = options.forcePathStyle ?? true;
    this.fetchFn = options.fetchFn || globalThis.fetch;
  }

  private getSigningKey(dateStamp: string): Buffer {
    const kDate = hmacSha256(`AWS4${this.secretAccessKey}`, dateStamp);
    const kRegion = hmacSha256(kDate, this.region);
    const kService = hmacSha256(kRegion, "s3");
    return hmacSha256(kService, "aws4_request");
  }

  private buildUrlPath(remoteKey: string): { url: URL; canonicalPath: string } {
    const cleanKey = remoteKey.replace(/^\/+/, "");
    if (this.forcePathStyle) {
      const url = new URL(`${this.endpoint}/${this.bucket}/${cleanKey}`);
      return { url, canonicalPath: `/${this.bucket}/${cleanKey}` };
    } else {
      const parsed = new URL(this.endpoint);
      parsed.hostname = `${this.bucket}.${parsed.hostname}`;
      parsed.pathname = `/${cleanKey}`;
      return { url: parsed, canonicalPath: `/${cleanKey}` };
    }
  }

  public async getPresignedUrl(
    method: "GET" | "PUT" | "HEAD",
    remoteKey: string,
    expiresInSeconds = 7200,
  ): Promise<string> {
    const { url, canonicalPath } = this.buildUrlPath(remoteKey);
    const { dateStamp, amzDate } = getAmzDates();
    const credentialScope = `${dateStamp}/${this.region}/s3/aws4_request`;

    const queryParams: Record<string, string> = {
      "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
      "X-Amz-Credential": `${this.accessKeyId}/${credentialScope}`,
      "X-Amz-Date": amzDate,
      "X-Amz-Expires": String(expiresInSeconds),
      "X-Amz-SignedHeaders": "host",
    };

    // Sort query params
    const sortedKeys = Object.keys(queryParams).sort();
    const canonicalQuery = sortedKeys
      .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(queryParams[k]!)}`)
      .join("&");

    const host = url.port ? `${url.hostname}:${url.port}` : url.hostname;
    const canonicalHeaders = `host:${host}\n`;
    const signedHeaders = "host";
    const payloadHash = "UNSIGNED-PAYLOAD";

    const canonicalRequest = [method, canonicalPath, canonicalQuery, canonicalHeaders, signedHeaders, payloadHash].join(
      "\n",
    );

    const stringToSign = ["AWS4-HMAC-SHA256", amzDate, credentialScope, sha256Hex(canonicalRequest)].join("\n");

    const signingKey = this.getSigningKey(dateStamp);
    const signature = crypto.createHmac("sha256", signingKey).update(stringToSign).digest("hex");

    url.search = `${canonicalQuery}&X-Amz-Signature=${signature}`;
    return url.toString();
  }

  public async getDownloadUrl(remoteKey: string, expiresInSeconds = 7200): Promise<string> {
    return this.getPresignedUrl("GET", remoteKey, expiresInSeconds);
  }

  public async getUploadUrl(remoteKey: string, expiresInSeconds = 7200): Promise<string> {
    return this.getPresignedUrl("PUT", remoteKey, expiresInSeconds);
  }

  public async uploadFile(
    remoteKey: string,
    localPathOrBuffer: string | Buffer,
    contentType = "application/octet-stream",
  ): Promise<string> {
    const putUrl = await this.getUploadUrl(remoteKey);
    let body: Buffer;
    if (typeof localPathOrBuffer === "string") {
      body = fs.readFileSync(localPathOrBuffer);
    } else {
      body = localPathOrBuffer;
    }

    const res = await this.fetchFn(putUrl, {
      method: "PUT",
      headers: { "Content-Type": contentType },
      body,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Failed to upload to S3 (${remoteKey}): HTTP ${res.status} ${errText}`);
    }

    return putUrl.split("?")[0]!;
  }

  public async downloadFile(remoteKey: string, localDestinationPath: string): Promise<void> {
    const getUrl = await this.getDownloadUrl(remoteKey);
    const res = await this.fetchFn(getUrl, { method: "GET" });
    if (!res.ok) {
      throw new Error(`Failed to download from S3 (${remoteKey}): HTTP ${res.status}`);
    }

    const arrayBuffer = await res.arrayBuffer();
    fs.mkdirSync(path.dirname(localDestinationPath), { recursive: true });
    fs.writeFileSync(localDestinationPath, Buffer.from(arrayBuffer));
  }

  public async hasObject(remoteKey: string): Promise<boolean> {
    try {
      const headUrl = await this.getPresignedUrl("HEAD", remoteKey, 300);
      const res = await this.fetchFn(headUrl, { method: "HEAD" });
      return res.ok;
    } catch {
      return false;
    }
  }

  public async createJobStagingManifest(
    jobId: string,
    inputFiles: Record<string, string>,
    expectedOutputs: string[],
  ): Promise<JobStagingManifest> {
    const inputDownloads: StagedDownloadSpec[] = [];
    const outputUploads: StagedUploadSpec[] = [];

    // 1. Stage each input file
    for (const [filename, localPath] of Object.entries(inputFiles)) {
      const remoteKey = `jobs/${jobId}/inputs/${filename}`;
      if (fs.existsSync(localPath)) {
        await this.uploadFile(remoteKey, localPath);
      }
      const downloadUrl = await this.getDownloadUrl(remoteKey);
      inputDownloads.push({
        remoteKey,
        downloadUrl,
        localFilename: filename,
      });
    }

    // 2. Prepare pre-signed upload URLs for expected output files
    for (const filename of expectedOutputs) {
      const remoteKey = `jobs/${jobId}/outputs/${filename}`;
      const uploadUrl = await this.getUploadUrl(remoteKey);
      outputUploads.push({
        remoteKey,
        uploadUrl,
        targetFilename: filename,
      });
    }

    // 3. Generate prologue bash snippet
    const prologueLines = [
      `# --- MODELScript HPC Prologue (Input Staging) ---`,
      `echo "[HPC-Prologue] Staging input files for Job #${jobId}..."`,
      ...inputDownloads.map((inSpec) => `curl -s -f -o "${inSpec.localFilename}" "${inSpec.downloadUrl}"`),
      `echo "[HPC-Prologue] All inputs staged successfully."`,
    ];

    // 4. Generate epilogue bash snippet
    const epilogueLines = [
      `# --- MODELScript HPC Epilogue (Output Publishing) ---`,
      `echo "[HPC-Epilogue] Publishing results for Job #${jobId}..."`,
      ...outputUploads.map(
        (outSpec) =>
          `if [ -f "${outSpec.targetFilename}" ]; then curl -s -f -X PUT --data-binary @"${outSpec.targetFilename}" "${outSpec.uploadUrl}"; fi`,
      ),
      `echo "[HPC-Epilogue] Output publishing completed."`,
    ];

    return {
      jobId,
      inputDownloads,
      outputUploads,
      prologueScript: prologueLines.join("\n"),
      epilogueScript: epilogueLines.join("\n"),
    };
  }
}
