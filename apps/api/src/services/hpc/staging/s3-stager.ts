// SPDX-License-Identifier: AGPL-3.0-or-later

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { JobStagingManifest, ObjectStager, StagedDownloadSpec, StagedUploadSpec } from "./staging-types.js";

export interface S3StagerOptions {
  endpoint: string; // e.g. "http://localhost:9000" or "https://s3.amazonaws.com"
  bucket: string; // e.g. "modelscript-hpc-artifacts"
  region?: string | undefined; // e.g. "us-east-1"
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle?: boolean | undefined; // true for MinIO / local dev (default: true)
  fetchFn?: typeof fetch | undefined; // optional injectable fetch for unit testing
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

const MAX_S3_BUFFER_BYTES = 512 * 1024 * 1024; // 512 MB cap for staged artifacts
const MAX_S3_PRESIGNED_TTL_SECONDS = 7 * 24 * 3600; // S3 SigV4 7-day maximum
const S3_FETCH_TIMEOUT_MS = 30_000;

function encodeRfc3986(segment: string): string {
  return encodeURIComponent(segment).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
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
    let parsedEndpoint: URL;
    try {
      parsedEndpoint = new URL(options.endpoint);
    } catch {
      throw new Error(`Invalid S3 endpoint URL: ${options.endpoint}`);
    }
    if (parsedEndpoint.protocol !== "http:" && parsedEndpoint.protocol !== "https:") {
      throw new Error(`S3 endpoint must use http:// or https:// protocol (got ${parsedEndpoint.protocol})`);
    }
    const bucket = String(options.bucket || "").trim();
    if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket) || bucket.includes("..")) {
      throw new Error(`Invalid S3 bucket name: ${options.bucket}`);
    }

    this.endpoint = options.endpoint.replace(/\/+$/, "");
    this.bucket = bucket;
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
    if (typeof remoteKey !== "string" || remoteKey.includes("\0")) {
      throw new Error("Invalid S3 remote key");
    }
    const rawSegments = remoteKey
      .replace(/^\/+/, "")
      .split("/")
      .filter((s) => s.length > 0);
    if (rawSegments.length === 0 || rawSegments.some((s) => s === ".." || s === ".")) {
      throw new Error(`Invalid S3 remote key (path traversal rejected): ${remoteKey}`);
    }
    const encodedKey = rawSegments.map(encodeRfc3986).join("/");

    if (this.forcePathStyle) {
      const encodedBucket = encodeRfc3986(this.bucket);
      const canonicalPath = `/${encodedBucket}/${encodedKey}`;
      const url = new URL(`${this.endpoint}${canonicalPath}`);
      return { url, canonicalPath };
    } else {
      const parsed = new URL(this.endpoint);
      parsed.hostname = `${this.bucket}.${parsed.hostname}`;
      const canonicalPath = `/${encodedKey}`;
      parsed.pathname = canonicalPath;
      return { url: parsed, canonicalPath };
    }
  }

  public async getPresignedUrl(
    method: "GET" | "PUT" | "HEAD",
    remoteKey: string,
    expiresInSeconds = 7200,
  ): Promise<string> {
    const clampedTtl = Math.min(MAX_S3_PRESIGNED_TTL_SECONDS, Math.max(60, Math.floor(expiresInSeconds)));
    const { url, canonicalPath } = this.buildUrlPath(remoteKey);
    const { dateStamp, amzDate } = getAmzDates();
    const credentialScope = `${dateStamp}/${this.region}/s3/aws4_request`;

    const queryParams: Record<string, string> = {
      "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
      "X-Amz-Credential": `${this.accessKeyId}/${credentialScope}`,
      "X-Amz-Date": amzDate,
      "X-Amz-Expires": String(clampedTtl),
      "X-Amz-SignedHeaders": "host",
    };

    // Sort query params
    const sortedKeys = Object.keys(queryParams).sort();
    const canonicalQuery = sortedKeys.map((k) => `${encodeRfc3986(k)}=${encodeRfc3986(queryParams[k]!)}`).join("&");

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
      const stat = fs.statSync(localPathOrBuffer);
      if (stat.size > MAX_S3_BUFFER_BYTES) {
        throw new Error(`Artifact exceeds maximum upload size (${MAX_S3_BUFFER_BYTES} bytes): ${localPathOrBuffer}`);
      }
      body = fs.readFileSync(localPathOrBuffer);
    } else {
      if (localPathOrBuffer.byteLength > MAX_S3_BUFFER_BYTES) {
        throw new Error(`Buffer exceeds maximum upload size (${MAX_S3_BUFFER_BYTES} bytes)`);
      }
      body = localPathOrBuffer;
    }

    const res = await this.fetchFn(putUrl, {
      method: "PUT",
      headers: { "Content-Type": contentType },
      body,
      signal: AbortSignal.timeout(S3_FETCH_TIMEOUT_MS),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Failed to upload to S3 (${remoteKey}): HTTP ${res.status} ${errText}`);
    }

    return putUrl.split("?")[0]!;
  }

  public async downloadFile(remoteKey: string, localDestinationPath: string): Promise<void> {
    const getUrl = await this.getDownloadUrl(remoteKey);
    const res = await this.fetchFn(getUrl, {
      method: "GET",
      signal: AbortSignal.timeout(S3_FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      throw new Error(`Failed to download from S3 (${remoteKey}): HTTP ${res.status}`);
    }

    fs.mkdirSync(path.dirname(localDestinationPath), { recursive: true });
    if (res.body && typeof (res.body as ReadableStream<Uint8Array>).getReader === "function") {
      const reader = (res.body as ReadableStream<Uint8Array>).getReader();
      const ws = fs.createWriteStream(localDestinationPath);
      let totalBytes = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            totalBytes += value.byteLength;
            if (totalBytes > MAX_S3_BUFFER_BYTES) {
              ws.destroy();
              throw new Error(`Downloaded artifact exceeds maximum size (${MAX_S3_BUFFER_BYTES} bytes): ${remoteKey}`);
            }
            if (!ws.write(Buffer.from(value))) {
              await new Promise<void>((resolve, reject) => {
                ws.once("drain", resolve);
                ws.once("error", reject);
              });
            }
          }
        }
        await new Promise<void>((resolve, reject) => {
          ws.end(() => resolve());
          ws.once("error", reject);
        });
      } catch (err) {
        ws.destroy();
        try {
          if (fs.existsSync(localDestinationPath)) fs.unlinkSync(localDestinationPath);
        } catch {
          // ignore cleanup failure
        }
        throw err;
      }
      return;
    }

    const arrayBuffer = await res.arrayBuffer();
    if (arrayBuffer.byteLength > MAX_S3_BUFFER_BYTES) {
      throw new Error(`Downloaded artifact exceeds maximum size (${MAX_S3_BUFFER_BYTES} bytes): ${remoteKey}`);
    }
    fs.writeFileSync(localDestinationPath, Buffer.from(arrayBuffer));
  }

  public async hasObject(remoteKey: string): Promise<boolean> {
    try {
      const headUrl = await this.getPresignedUrl("HEAD", remoteKey, 300);
      const res = await this.fetchFn(headUrl, {
        method: "HEAD",
        signal: AbortSignal.timeout(S3_FETCH_TIMEOUT_MS),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  private sanitizeStagingIdentifier(value: string, label: string, allowSubpaths = false): string {
    if (typeof value !== "string" || value.length === 0 || value.includes("\0")) {
      throw new Error(`Invalid HPC staging ${label}: ${value}`);
    }
    const normalized = value.replace(/\\/g, "/");
    if (!allowSubpaths) {
      const clean = path.basename(normalized);
      if (!clean || clean !== normalized || clean === "." || clean === ".." || !/^[a-zA-Z0-9._-]+$/.test(clean)) {
        throw new Error(`Invalid HPC staging ${label}: ${value}`);
      }
      return clean;
    }
    const segments = normalized.split("/");
    for (const seg of segments) {
      if (!seg || seg === "." || seg === ".." || !/^[a-zA-Z0-9._-]+$/.test(seg)) {
        throw new Error(`Invalid HPC staging ${label}: ${value}`);
      }
    }
    return segments.join("/");
  }

  public async createJobStagingManifest(
    jobId: string,
    inputFiles: Record<string, string>,
    expectedOutputs: string[],
    options?: { maxWalltimeSeconds?: number | undefined },
  ): Promise<JobStagingManifest> {
    const safeJobId = this.sanitizeStagingIdentifier(jobId, "jobId", false);
    const maxWalltimeSeconds = options?.maxWalltimeSeconds ?? 3600;
    const putTtlSeconds = Math.min(MAX_S3_PRESIGNED_TTL_SECONDS, Math.max(7200, Math.ceil(maxWalltimeSeconds) + 3600));
    const inputDownloads: StagedDownloadSpec[] = [];
    const outputUploads: StagedUploadSpec[] = [];

    // 1. Stage each input file
    for (const [filename, localPath] of Object.entries(inputFiles)) {
      const safeFile = this.sanitizeStagingIdentifier(filename, "input filename", true);
      const remoteKey = `jobs/${safeJobId}/inputs/${safeFile}`;
      if (fs.existsSync(localPath)) {
        await this.uploadFile(remoteKey, localPath);
      }
      const downloadUrl = await this.getDownloadUrl(remoteKey, putTtlSeconds);
      inputDownloads.push({
        remoteKey,
        downloadUrl,
        localFilename: safeFile,
      });
    }

    // 2. Prepare pre-signed upload URLs for expected output files
    for (const filename of expectedOutputs) {
      const safeFile = this.sanitizeStagingIdentifier(filename, "output filename", false);
      const remoteKey = `jobs/${safeJobId}/outputs/${safeFile}`;
      const uploadUrl = await this.getUploadUrl(remoteKey, putTtlSeconds);
      outputUploads.push({
        remoteKey,
        uploadUrl,
        targetFilename: safeFile,
      });
    }

    const logSpec = outputUploads.find((o) => o.targetFilename === "output.log");
    const logUploadUrl = logSpec?.uploadUrl;

    // 3. Generate prologue bash snippet
    const prologueLines = [
      `# --- MODELScript HPC Prologue (Input Staging) ---`,
      `echo "[HPC-Prologue] Staging input files for Job #${safeJobId}..."`,
      ...inputDownloads.map((inSpec) =>
        inSpec.localFilename.includes("/")
          ? `mkdir -p "$(dirname "${inSpec.localFilename}")" && curl -s -f -o "${inSpec.localFilename}" --retry 3 --max-time 60 "${inSpec.downloadUrl}"`
          : `curl -s -f -o "${inSpec.localFilename}" --retry 3 --max-time 60 "${inSpec.downloadUrl}"`,
      ),
      `echo "[HPC-Prologue] All inputs staged successfully."`,
    ];

    if (logUploadUrl) {
      prologueLines.push(
        `# --- MODELScript HPC Background In-Flight Log Sync ---`,
        `(`,
        `  while true; do`,
        `    sleep 2`,
        `    for logfile in slurm-*.out pbs-*.out output.log; do`,
        `      if [ -f "$logfile" ] && [ -s "$logfile" ]; then`,
        `        curl -s -f -X PUT --data-binary @"$logfile" --max-time 30 "${logUploadUrl}" 2>/dev/null || true`,
        `        break`,
        `      fi`,
        `    done`,
        `  done`,
        `) &`,
        `MSX_LOG_SYNC_PID=$!`,
      );
    }

    // 4. Generate epilogue bash snippet
    const epilogueLines = [
      `# --- MODELScript HPC Epilogue (Output Publishing) ---`,
      `if [ -n "\${MSX_LOG_SYNC_PID:-}" ]; then kill $MSX_LOG_SYNC_PID 2>/dev/null || true; wait $MSX_LOG_SYNC_PID 2>/dev/null || true; fi`,
      `echo "[HPC-Epilogue] Publishing results for Job #${safeJobId}..."`,
      `for f in slurm-*.out pbs-*.out; do if [ -f "$f" ] && [ ! -f "output.log" ]; then cp "$f" "output.log"; break; fi; done`,
      ...outputUploads.map(
        (outSpec) =>
          `if [ -f "${outSpec.targetFilename}" ]; then curl -s -f -X PUT --data-binary @"${outSpec.targetFilename}" --retry 3 --max-time 60 "${outSpec.uploadUrl}"; fi`,
      ),
      `echo "[HPC-Epilogue] Output publishing completed."`,
    ];

    return {
      jobId: safeJobId,
      inputDownloads,
      outputUploads,
      prologueScript: prologueLines.join("\n"),
      epilogueScript: epilogueLines.join("\n"),
    };
  }

  public async readLogChunk(
    remoteKey: string,
    startByte: number,
  ): Promise<{ chunk: string; totalBytes: number } | null> {
    try {
      const getUrl = await this.getDownloadUrl(remoteKey);
      const headers: Record<string, string> = {};
      if (startByte > 0) {
        headers["Range"] = `bytes=${startByte}-`;
      }
      const res = await this.fetchFn(getUrl, {
        method: "GET",
        headers,
        signal: AbortSignal.timeout(S3_FETCH_TIMEOUT_MS),
      });
      if (res.status === 416) {
        return null;
      }
      if (!res.ok) {
        return null;
      }
      const arrayBuffer = await res.arrayBuffer();
      const chunkBuf = Buffer.from(arrayBuffer);
      if (chunkBuf.byteLength === 0) {
        return null;
      }
      const chunk = chunkBuf.toString("utf8");
      const totalBytes = startByte + chunkBuf.byteLength;
      return { chunk, totalBytes };
    } catch {
      return null;
    }
  }
}
