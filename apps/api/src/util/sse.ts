// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Response } from "express";

export interface SseStreamHandle {
  /** Safely writes an SSE event if the stream is still open. Returns false if closed. */
  send(event: string, data: unknown): boolean;
  /** Safely writes a raw SSE frame/comment if the stream is still open. */
  writeRaw(chunk: string): boolean;
  /** Stops heartbeat and invokes cleanup callbacks once. */
  close(): void;
  /** True when the underlying HTTP response is no longer writable. */
  readonly isClosed: boolean;
}

/**
 * Initializes a hardened Server-Sent Events (SSE) stream on an Express Response:
 * - Sets standard SSE headers and flushes headers
 * - Guards all writes against `res.writableEnded` / `res.destroyed` / broken-pipe errors
 * - Runs an `.unref()`'d heartbeat interval so keepalive timers never block graceful shutdown
 * - Cleans up deterministically on `res.on("close")`
 */
export function initSseStream(
  res: Response,
  options?: {
    heartbeatMs?: number | undefined;
    onClose?: (() => void) | undefined;
  },
): SseStreamHandle {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  let closed = false;
  const heartbeatMs = options?.heartbeatMs ?? 15_000;

  const writeRaw = (chunk: string): boolean => {
    if (closed || res.writableEnded || res.destroyed) {
      return false;
    }
    try {
      res.write(chunk);
      return true;
    } catch {
      cleanup();
      return false;
    }
  };

  let heartbeatTimer: NodeJS.Timeout | null = null;
  if (heartbeatMs > 0) {
    heartbeatTimer = setInterval(() => {
      if (!writeRaw(": heartbeat\n\n")) {
        cleanup();
      }
    }, heartbeatMs);
    heartbeatTimer.unref?.();
  }

  const cleanup = () => {
    if (closed) return;
    closed = true;
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    try {
      options?.onClose?.();
    } catch {
      // Ignore cleanup errors
    }
  };

  res.on("close", cleanup);

  return {
    send(event: string, data: unknown): boolean {
      const payload = typeof data === "string" ? data : JSON.stringify(data);
      return writeRaw(`event: ${event}\ndata: ${payload}\n\n`);
    },
    writeRaw,
    close(): void {
      cleanup();
      if (!res.writableEnded && !res.destroyed) {
        try {
          res.end();
        } catch {
          // Ignore end error
        }
      }
    },
    get isClosed(): boolean {
      return closed || res.writableEnded || res.destroyed;
    },
  };
}
