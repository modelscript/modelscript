// SPDX-License-Identifier: AGPL-3.0-or-later

import crypto from "node:crypto";
import type { StorageDriver, StorageObjectMetadata } from "./driver.js";

export interface S3ClientConfig {
  endpoint?: string | undefined;
  region?: string | undefined;
  bucket: string;
  accessKeyId?: string | undefined;
  secretAccessKey?: string | undefined;
  forcePathStyle?: boolean | undefined;
  prefix?: string | undefined;
}

/**
 * Storage driver compatible with AWS S3, Cloudflare R2, MinIO, and Google Cloud Storage.
 * Uses native standard HTTP / fetch with AWS Signature Version 4 (SigV4) for zero extra dependencies.
 */
export class S3StorageDriver implements StorageDriver {
  readonly driverName = "s3" as const;
  readonly #config: S3ClientConfig;
  readonly #endpoint: string;
  readonly #bucket: string;
  readonly #region: string;
  readonly #keyPrefix: string;

  constructor(config: S3ClientConfig) {
    this.#config = config;
    this.#bucket = config.bucket;
    this.#region = config.region || "us-east-1";
    this.#endpoint = (config.endpoint || `https://s3.${this.#region}.amazonaws.com`).replace(/\/+$/, "");
    this.#keyPrefix = config.prefix ? config.prefix.replace(/^\/+|\/+$/g, "") + "/" : "";
  }

  get config(): S3ClientConfig {
    return this.#config;
  }

  async exists(key: string): Promise<boolean> {
    const meta = await this.getMetadata(key);
    return meta !== null;
  }

  async read(key: string): Promise<Buffer | null> {
    const url = this.#buildUrl(key);
    const headers = this.#sign("GET", url, Buffer.alloc(0));

    try {
      const res = await fetch(url, { method: "GET", headers });
      if (res.status === 404) return null;
      if (!res.ok) {
        throw new Error(`S3 GET ${key} failed: ${res.status} ${res.statusText}`);
      }
      const arrayBuf = await res.arrayBuffer();
      return Buffer.from(arrayBuf);
    } catch (err: unknown) {
      if ((err as { status?: number | undefined })?.status === 404) return null;
      throw err;
    }
  }

  async write(key: string, buffer: Buffer, metadata?: { contentType?: string }): Promise<void> {
    const url = this.#buildUrl(key);
    const contentType = metadata?.contentType || "application/octet-stream";
    const extraHeaders: Record<string, string> = { "Content-Type": contentType };
    const headers = this.#sign("PUT", url, buffer, extraHeaders);

    const res = await fetch(url, {
      method: "PUT",
      headers,
      body: new Uint8Array(buffer),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`S3 PUT ${key} failed: ${res.status} ${res.statusText} ${text}`);
    }
  }

  async delete(key: string): Promise<boolean> {
    const url = this.#buildUrl(key);
    const headers = this.#sign("DELETE", url, Buffer.alloc(0));

    const res = await fetch(url, { method: "DELETE", headers });
    if (res.status === 404 || res.status === 204 || res.ok) {
      return true;
    }
    return false;
  }

  async list(prefix = ""): Promise<string[]> {
    const fullPrefix = this.#fullKey(prefix);
    const query = new URLSearchParams({ "list-type": "2", prefix: fullPrefix });
    const url = `${this.#endpoint}/${this.#bucket}?${query.toString()}`;
    const headers = this.#sign("GET", url, Buffer.alloc(0));

    const res = await fetch(url, { method: "GET", headers });
    if (!res.ok) return [];

    const xml = await res.text();
    const keyMatches = xml.matchAll(/<Key>(.*?)<\/Key>/g);
    const keys: string[] = [];

    for (const match of keyMatches) {
      let key = match[1]!;
      if (this.#keyPrefix && key.startsWith(this.#keyPrefix)) {
        key = key.slice(this.#keyPrefix.length);
      }
      keys.push(key);
    }

    return keys.sort();
  }

  async deletePrefix(prefix: string): Promise<number> {
    const keys = await this.list(prefix);
    if (keys.length === 0) return 0;

    let deleted = 0;
    for (const k of keys) {
      if (await this.delete(k)) {
        deleted++;
      }
    }
    return deleted;
  }

  async getMetadata(key: string): Promise<StorageObjectMetadata | null> {
    const url = this.#buildUrl(key);
    const headers = this.#sign("HEAD", url, Buffer.alloc(0));

    try {
      const res = await fetch(url, { method: "HEAD", headers });
      if (res.status === 404) return null;
      if (!res.ok) return null;

      const size = parseInt(res.headers.get("content-length") || "0", 10);
      const etag = res.headers.get("etag")?.replace(/['"]/g, "") || "";
      const contentType = res.headers.get("content-type") || undefined;
      const lastModifiedStr = res.headers.get("last-modified");
      const lastModified = lastModifiedStr ? new Date(lastModifiedStr) : undefined;

      return {
        size,
        contentHash: etag.startsWith("sha256:") ? etag : `sha256:${etag}`,
        contentType,
        lastModified,
      };
    } catch {
      return null;
    }
  }

  #fullKey(key: string): string {
    const clean = key.replace(/\\/g, "/").replace(/^\/+/, "");
    return `${this.#keyPrefix}${clean}`;
  }

  #buildUrl(key: string): string {
    const full = this.#fullKey(key);
    if (this.#config.forcePathStyle || this.#endpoint.includes("localhost") || this.#endpoint.includes("127.0.0.1")) {
      return `${this.#endpoint}/${this.#bucket}/${encodeURIComponent(full).replace(/%2F/g, "/")}`;
    }
    // Virtual hosted style: https://bucket.s3.region.amazonaws.com/key
    const urlObj = new URL(this.#endpoint);
    return `${urlObj.protocol}//${this.#bucket}.${urlObj.host}/${encodeURIComponent(full).replace(/%2F/g, "/")}`;
  }

  #sign(
    method: string,
    urlStr: string,
    payload: Buffer,
    extraHeaders: Record<string, string> = {},
  ): Record<string, string> {
    const accessKey = this.#config.accessKeyId || process.env["AWS_ACCESS_KEY_ID"] || "";
    const secretKey = this.#config.secretAccessKey || process.env["AWS_SECRET_ACCESS_KEY"] || "";

    if (!accessKey || !secretKey) {
      // Unauthenticated / public access fallback
      return { ...extraHeaders };
    }

    const url = new URL(urlStr);
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
    const dateStamp = amzDate.slice(0, 8);

    const payloadHash = crypto.createHash("sha256").update(payload).digest("hex");

    const headersToSign: Record<string, string> = {
      host: url.host,
      "x-amz-date": amzDate,
      "x-amz-content-sha256": payloadHash,
      ...extraHeaders,
    };

    const sortedHeaderKeys = Object.keys(headersToSign).sort();
    const canonicalHeaders = sortedHeaderKeys.map((k) => `${k.toLowerCase()}:${headersToSign[k]!.trim()}\n`).join("");
    const signedHeaders = sortedHeaderKeys.map((k) => k.toLowerCase()).join(";");

    const canonicalRequest = [
      method,
      url.pathname,
      url.searchParams.toString(),
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join("\n");

    const credentialScope = `${dateStamp}/${this.#region}/s3/aws4_request`;
    const stringToSign = [
      "AWS4-HMAC-SHA256",
      amzDate,
      credentialScope,
      crypto.createHash("sha256").update(canonicalRequest).digest("hex"),
    ].join("\n");

    const kDate = crypto.createHmac("sha256", `AWS4${secretKey}`).update(dateStamp).digest();
    const kRegion = crypto.createHmac("sha256", kDate).update(this.#region).digest();
    const kService = crypto.createHmac("sha256", kRegion).update("s3").digest();
    const kSigning = crypto.createHmac("sha256", kService).update("aws4_request").digest();
    const signature = crypto.createHmac("sha256", kSigning).update(stringToSign).digest("hex");

    const authorization = `AWS4-HMAC-SHA256 Credential=${accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

    return {
      ...headersToSign,
      Authorization: authorization,
    };
  }
}
