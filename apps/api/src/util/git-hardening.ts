// SPDX-License-Identifier: AGPL-3.0-or-later

import { execFileSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import type { IncomingMessage } from "node:http";
import path from "node:path";
import { Transform, type Readable } from "node:stream";
import zlib from "node:zlib";

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Limits applied to `git receive-pack` (push). Overridable via environment variables. */
export function getReceivePackLimits(): { maxBytes: number; timeoutMs: number; maxConcurrent: number } {
  return {
    maxBytes: envInt("GIT_RECEIVE_MAX_BYTES", 256 * 1024 * 1024),
    timeoutMs: envInt("GIT_RECEIVE_TIMEOUT_MS", 10 * 60 * 1000),
    maxConcurrent: envInt("GIT_RECEIVE_MAX_CONCURRENT", 8),
  };
}

/** Limits applied to `git upload-pack` (fetch/clone) request bodies, which are tiny negotiation messages. */
export function getUploadPackLimits(): { maxBytes: number; timeoutMs: number } {
  return {
    maxBytes: envInt("GIT_UPLOAD_MAX_REQUEST_BYTES", 8 * 1024 * 1024),
    timeoutMs: envInt("GIT_UPLOAD_TIMEOUT_MS", 30 * 60 * 1000),
  };
}

export class GitBodyLimitError extends Error {
  constructor(public readonly limitBytes: number) {
    super(`Request body exceeds ${limitBytes} bytes`);
    this.name = "GitBodyLimitError";
  }
}

/** Transform that counts bytes and errors once `maxBytes` is exceeded (independent of Content-Length). */
export function createByteLimiter(maxBytes: number): Transform {
  let seen = 0;
  return new Transform({
    transform(chunk: Buffer, _enc, cb) {
      seen += chunk.length;
      if (seen > maxBytes) {
        cb(new GitBodyLimitError(maxBytes));
        return;
      }
      cb(null, chunk);
    },
  });
}

/**
 * Returns a readable stream of the (decompressed, if `Content-Encoding: gzip`) request body,
 * capped at `maxBytes` of *decompressed* data. Errors from any stage surface on the returned stream.
 */
export function limitedRequestBody(req: IncomingMessage, maxBytes: number): Readable {
  const encoding = String(req.headers["content-encoding"] || "").toLowerCase();
  const declared = Number.parseInt(String(req.headers["content-length"] || ""), 10);
  const limiter = createByteLimiter(maxBytes);
  const forward = (err: Error) => limiter.destroy(err);

  if (Number.isFinite(declared) && declared > maxBytes && encoding !== "gzip") {
    queueMicrotask(() => limiter.destroy(new GitBodyLimitError(maxBytes)));
    return limiter;
  }

  if (encoding === "gzip" || encoding === "x-gzip") {
    const gunzip = zlib.createGunzip();
    req.on("error", forward);
    gunzip.on("error", forward);
    req.pipe(gunzip).pipe(limiter);
  } else {
    req.on("error", forward);
    req.pipe(limiter);
  }
  return limiter;
}

/** Minimal clean environment for git subprocesses: no inherited secrets, no user/system config. */
export function gitSubprocessEnv(): NodeJS.ProcessEnv {
  return {
    PATH: process.env["PATH"] || "/usr/bin:/bin:/usr/local/bin",
    HOME: "/nonexistent",
    LANG: "C",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_TERMINAL_PROMPT: "0",
  };
}

/** Repository config re-asserted on every push so older repos receive the same protections. */
export const HARDENED_REPO_CONFIG: ReadonlyArray<readonly [string, string]> = [
  ["http.receivepack", "true"],
  ["uploadpack.allowFilter", "true"],
  ["receive.fsckObjects", "true"],
  ["transfer.fsckObjects", "true"],
  ["receive.denyNonFastForwards", "true"],
  ["receive.denyDeletes", "true"],
  ["receive.denyCurrentBranch", "refuse"],
  ["core.protectNTFS", "true"],
  ["core.protectHFS", "true"],
  ["core.hooksPath", "/dev/null"],
  ["gc.auto", "256"],
];

export function applyHardenedRepoConfig(
  repoPath: string,
  maxInputBytes: number = getReceivePackLimits().maxBytes,
): void {
  const markerPath = path.join(repoPath, ".msx-hardened-v1");
  const configPath = path.join(repoPath, "config");
  const expectedStamp = String(maxInputBytes);
  try {
    if (fs.existsSync(markerPath) && fs.existsSync(configPath)) {
      const stamp = fs.readFileSync(markerPath, "utf-8").trim();
      const cfg = fs.readFileSync(configPath, "utf-8");
      if (stamp === expectedStamp && cfg.includes("hooksPath = /dev/null") && cfg.includes("fsckObjects = true")) {
        return;
      }
    }
  } catch {
    // Fall through to full git config enforcement
  }

  const entries: Array<readonly [string, string]> = [...HARDENED_REPO_CONFIG, ["receive.maxInputSize", expectedStamp]];
  for (const [key, value] of entries) {
    execFileSync("git", ["-C", repoPath, "config", key, value], { env: gitSubprocessEnv(), stdio: "ignore" });
  }
  try {
    fs.writeFileSync(markerPath, expectedStamp, "utf-8");
  } catch {
    // Non-fatal if repo directory is read-only
  }
}

/** Global counting semaphore + per-key mutual exclusion for receive-pack processes. */
export class ReceivePackGate {
  private active = 0;
  private readonly lockedKeys = new Set<string>();

  constructor(private readonly maxConcurrent: () => number = () => getReceivePackLimits().maxConcurrent) {}

  /** Returns a release function, or a rejection reason when the push cannot start now. */
  tryAcquire(key: string): { release: () => void } | { reason: "busy-global" | "busy-repo" } {
    if (this.lockedKeys.has(key)) return { reason: "busy-repo" };
    if (this.active >= this.maxConcurrent()) return { reason: "busy-global" };
    this.active++;
    this.lockedKeys.add(key);
    let released = false;
    return {
      release: () => {
        if (released) return;
        released = true;
        this.active--;
        this.lockedKeys.delete(key);
      },
    };
  }

  get activeCount(): number {
    return this.active;
  }
}

/** Kills `proc` after `timeoutMs`. Returns a function to cancel the timer. */
export function killAfter(proc: ChildProcess, timeoutMs: number, onTimeout?: () => void): () => void {
  const timer = setTimeout(() => {
    onTimeout?.();
    proc.kill("SIGKILL");
  }, timeoutMs);
  timer.unref?.();
  return () => clearTimeout(timer);
}
