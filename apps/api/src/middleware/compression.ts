// SPDX-License-Identifier: AGPL-3.0-or-later

import type { NextFunction, Request, Response } from "express";
import zlib from "node:zlib";

const COMPRESSIBLE_TYPES = /json|text|javascript|xml|svg|html/i;
const MIN_COMPRESS_SIZE = 1024;

/**
 * Lightweight, high-performance HTTP response compression middleware powered by Node.js `node:zlib`.
 *
 * Automatically gzips or deflates JSON, HTML, XML, SVG, and text responses >= 1 KB while safely
 * bypassing SSE streams, WebSockets, pre-compressed files, and sub-threshold small responses.
 */
export function responseCompressionMiddleware(req: Request, res: Response, next: NextFunction): void {
  const acceptEncoding = req.headers["accept-encoding"];
  if (!acceptEncoding || typeof acceptEncoding !== "string" || req.method === "HEAD") {
    next();
    return;
  }

  // Never intercept SSE streams, live co-sim streaming, or WebSocket upgrades
  const accept = req.headers["accept"];
  if (
    (typeof accept === "string" && accept.includes("text/event-stream")) ||
    req.path.includes("/stream") ||
    req.headers["upgrade"]
  ) {
    next();
    return;
  }

  const supportsGzip = acceptEncoding.includes("gzip");
  const supportsDeflate = acceptEncoding.includes("deflate");
  if (!supportsGzip && !supportsDeflate) {
    next();
    return;
  }

  type WriteFn = (chunk: unknown, encoding?: unknown, cb?: unknown) => boolean;
  type EndFn = (chunk?: unknown, encoding?: unknown, cb?: unknown) => Response;

  const origWrite: WriteFn = res.write.bind(res) as unknown as WriteFn;
  const origEnd: EndFn = res.end.bind(res) as unknown as EndFn;
  const chunks: Buffer[] = [];
  let isIntercepting = true;

  res.write = function (chunk: unknown, encoding?: unknown, cb?: unknown): boolean {
    if (!isIntercepting) {
      return origWrite(chunk, encoding, cb);
    }
    if (chunk) {
      chunks.push(
        Buffer.isBuffer(chunk)
          ? chunk
          : Buffer.from(chunk as string, typeof encoding === "string" ? (encoding as BufferEncoding) : "utf8"),
      );
    }
    if (typeof encoding === "function") {
      encoding();
    } else if (typeof cb === "function") {
      cb();
    }
    return true;
  } as typeof res.write;

  res.end = function (chunk?: unknown, encoding?: unknown, cb?: unknown): Response {
    if (!isIntercepting) {
      return origEnd(chunk, encoding, cb);
    }
    isIntercepting = false;

    if (chunk) {
      chunks.push(
        Buffer.isBuffer(chunk)
          ? chunk
          : Buffer.from(chunk as string, typeof encoding === "string" ? (encoding as BufferEncoding) : "utf8"),
      );
    }

    const totalLen = chunks.reduce((sum, c) => sum + c.length, 0);
    const body = Buffer.concat(chunks, totalLen);
    const contentType = String(res.getHeader("Content-Type") || "");
    const existingEncoding = res.getHeader("Content-Encoding");

    // Don't compress if already encoded, empty, below threshold, or non-compressible type
    if (
      existingEncoding ||
      totalLen < MIN_COMPRESS_SIZE ||
      !COMPRESSIBLE_TYPES.test(contentType) ||
      contentType.includes("event-stream")
    ) {
      const finalCb = typeof chunk === "function" ? chunk : typeof encoding === "function" ? encoding : cb;
      return origEnd(body, finalCb);
    }

    const currentVary = res.getHeader("Vary");
    if (!currentVary) {
      res.setHeader("Vary", "Accept-Encoding");
    } else if (typeof currentVary === "string" && !currentVary.includes("Accept-Encoding")) {
      res.setHeader("Vary", `${currentVary}, Accept-Encoding`);
    }

    const finalCallback = typeof chunk === "function" ? chunk : typeof encoding === "function" ? encoding : cb;

    if (supportsGzip) {
      res.setHeader("Content-Encoding", "gzip");
      res.removeHeader("Content-Length");
      zlib.gzip(body, { level: 6 }, (err, compressed) => {
        if (err) {
          origEnd(body, finalCallback);
        } else {
          res.setHeader("Content-Length", compressed.length);
          origEnd(compressed, finalCallback);
        }
      });
    } else {
      res.setHeader("Content-Encoding", "deflate");
      res.removeHeader("Content-Length");
      zlib.deflate(body, (err, compressed) => {
        if (err) {
          origEnd(body, finalCallback);
        } else {
          res.setHeader("Content-Length", compressed.length);
          origEnd(compressed, finalCallback);
        }
      });
    }
    return res;
  } as typeof res.end;

  next();
}
