// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ClientRateLimitInfo, Options, Store } from "express-rate-limit";
import net from "node:net";
import tls from "node:tls";
import { URL } from "node:url";

interface FallbackRecord {
  totalHits: number;
  resetTime: Date;
}

/**
 * Minimal, zero-dependency Redis RESP client supporting atomic rate-limiting
 * commands (INCR, PEXPIRE, PTTL, DEL, DECR) over TCP / TLS with automatic reconnection
 * and transparent local fallback if Redis is unavailable.
 */
export class MinimalRedisClient {
  private socket: net.Socket | tls.TLSSocket | null = null;
  private connected = false;
  private connecting = false;
  private readonly url: URL;
  private readonly isTls: boolean;
  private readonly password?: string;
  private readonly dbIndex?: number;
  private buffer = Buffer.alloc(0);
  private readonly pendingQueue: Array<{
    resolve: (res: unknown) => void;
    reject: (err: Error) => void;
  }> = [];

  constructor(redisUrl: string) {
    this.url = new URL(redisUrl);
    this.isTls = this.url.protocol === "rediss:";
    if (this.url.password) {
      this.password = decodeURIComponent(this.url.password);
    }
    const pathPart = this.url.pathname.replace(/^\//, "");
    if (pathPart && /^\d+$/.test(pathPart)) {
      this.dbIndex = parseInt(pathPart, 10);
    }
  }

  public isConnected(): boolean {
    return this.connected;
  }

  public async connect(): Promise<boolean> {
    if (this.connected) return true;
    if (this.connecting) return false;
    this.connecting = true;

    return new Promise<boolean>((resolve) => {
      const port = Number(this.url.port) || 6379;
      const host = this.url.hostname || "127.0.0.1";

      const onConnect = async () => {
        this.connected = true;
        this.connecting = false;
        try {
          if (this.password) {
            await this.sendCommand(["AUTH", this.password]);
          }
          if (typeof this.dbIndex === "number") {
            await this.sendCommand(["SELECT", String(this.dbIndex)]);
          }
          resolve(true);
        } catch {
          this.connected = false;
          resolve(false);
        }
      };

      const onError = () => {
        this.connected = false;
        this.connecting = false;
        this.cleanup();
        resolve(false);
      };

      try {
        if (this.isTls) {
          this.socket = tls.connect({ host, port, servername: host }, onConnect);
        } else {
          this.socket = net.connect({ host, port }, onConnect);
        }

        this.socket.on("data", (chunk) => this.handleData(chunk));
        this.socket.on("error", onError);
        this.socket.on("close", () => {
          this.connected = false;
          this.connecting = false;
          this.cleanup();
        });
      } catch {
        this.connecting = false;
        resolve(false);
      }
    });
  }

  private cleanup(): void {
    while (this.pendingQueue.length > 0) {
      const item = this.pendingQueue.shift();
      item?.reject(new Error("Redis socket closed"));
    }
    this.buffer = Buffer.alloc(0);
  }

  private handleData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length > 0) {
      const parsed = this.parseResp(this.buffer);
      if (!parsed) break;
      this.buffer = this.buffer.subarray(parsed.bytesRead);
      const pending = this.pendingQueue.shift();
      if (pending) {
        if (parsed.error) {
          pending.reject(parsed.error);
        } else {
          pending.resolve(parsed.value);
        }
      }
    }
  }

  private parseResp(buf: Buffer): { value: unknown; bytesRead: number; error?: Error } | null {
    if (buf.length === 0) return null;
    const type = buf[0];
    const crlfIndex = buf.indexOf("\r\n");
    if (crlfIndex === -1) return null;

    if (type === 43) {
      // '+' Simple String
      const val = buf.subarray(1, crlfIndex).toString("utf-8");
      return { value: val, bytesRead: crlfIndex + 2 };
    }
    if (type === 45) {
      // '-' Error
      const msg = buf.subarray(1, crlfIndex).toString("utf-8");
      return { value: null, bytesRead: crlfIndex + 2, error: new Error(msg) };
    }
    if (type === 58) {
      // ':' Integer
      const numStr = buf.subarray(1, crlfIndex).toString("utf-8");
      return { value: parseInt(numStr, 10), bytesRead: crlfIndex + 2 };
    }
    if (type === 36) {
      // '$' Bulk String
      const lenStr = buf.subarray(1, crlfIndex).toString("utf-8");
      const len = parseInt(lenStr, 10);
      if (len === -1) {
        return { value: null, bytesRead: crlfIndex + 2 };
      }
      const dataStart = crlfIndex + 2;
      const dataEnd = dataStart + len;
      if (buf.length < dataEnd + 2) return null; // wait for full payload
      const val = buf.subarray(dataStart, dataEnd).toString("utf-8");
      return { value: val, bytesRead: dataEnd + 2 };
    }
    if (type === 42) {
      // '*' Array
      const countStr = buf.subarray(1, crlfIndex).toString("utf-8");
      const count = parseInt(countStr, 10);
      if (count === -1) {
        return { value: null, bytesRead: crlfIndex + 2 };
      }
      let offset = crlfIndex + 2;
      const items: unknown[] = [];
      for (let i = 0; i < count; i++) {
        const sub = this.parseResp(buf.subarray(offset));
        if (!sub) return null;
        items.push(sub.value);
        offset += sub.bytesRead;
      }
      return { value: items, bytesRead: offset };
    }

    return null;
  }

  public async sendCommand(args: string[]): Promise<unknown> {
    if (!this.connected || !this.socket) {
      const ok = await this.connect();
      if (!ok || !this.socket) {
        throw new Error("Cannot connect to Redis");
      }
    }

    let payload = `*${args.length}\r\n`;
    for (const arg of args) {
      const b = Buffer.from(arg, "utf-8");
      payload += `$${b.length}\r\n${arg}\r\n`;
    }

    return new Promise((resolve, reject) => {
      this.pendingQueue.push({ resolve, reject });
      try {
        this.socket!.write(payload, "utf-8");
      } catch (err) {
        const item = this.pendingQueue.pop();
        item?.reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  public disconnect(): void {
    if (this.socket) {
      try {
        this.socket.destroy();
      } catch {
        // ignore
      }
      this.socket = null;
    }
    this.connected = false;
    this.connecting = false;
    this.cleanup();
  }
}

/**
 * Distributed rate limit store implementing the express-rate-limit Store contract.
 * Backed by Redis when available, falling back safely to local memory when Redis is not reachable.
 */
export class RedisRateLimitStore implements Store {
  public windowMs = 60 * 1000;
  public readonly localKeys = false;
  private readonly client?: MinimalRedisClient | undefined;
  public readonly prefix: string;
  private readonly fallbackMap = new Map<string, FallbackRecord>();
  private fallbackCleanupTimer?: NodeJS.Timeout | undefined;

  constructor(options?: { redisUrl?: string; prefix?: string; client?: MinimalRedisClient }) {
    this.prefix = options?.prefix || "rl:";
    const url = options?.redisUrl || process.env["REDIS_URL"];
    if (options?.client) {
      this.client = options.client;
    } else if (url) {
      try {
        this.client = new MinimalRedisClient(url);
        void this.client.connect().catch(() => {
          // ignore connection failure; store gracefully uses fallback
        });
      } catch {
        // invalid URL: proceed with local fallback
      }
    }

    // Periodic cleanup of local fallback map
    this.fallbackCleanupTimer = setInterval(() => {
      const now = Date.now();
      for (const [k, v] of this.fallbackMap.entries()) {
        if (v.resetTime.getTime() <= now) {
          this.fallbackMap.delete(k);
        }
      }
    }, 60 * 1000);
    this.fallbackCleanupTimer.unref?.();
  }

  public init(options: Options): void {
    this.windowMs = options.windowMs;
  }

  private fallbackIncrement(key: string): ClientRateLimitInfo {
    const now = Date.now();
    let record = this.fallbackMap.get(key);
    if (!record || record.resetTime.getTime() <= now) {
      record = { totalHits: 1, resetTime: new Date(now + this.windowMs) };
      this.fallbackMap.set(key, record);
    } else {
      record.totalHits += 1;
    }
    return { totalHits: record.totalHits, resetTime: record.resetTime };
  }

  public async increment(key: string): Promise<ClientRateLimitInfo> {
    const redisKey = `${this.prefix}${key}`;
    if (this.client) {
      try {
        const hits = (await this.client.sendCommand(["INCR", redisKey])) as number;
        if (hits === 1) {
          await this.client.sendCommand(["PEXPIRE", redisKey, String(this.windowMs)]);
        }
        const ttlMs = (await this.client.sendCommand(["PTTL", redisKey])) as number;
        const resetTime = new Date(Date.now() + (ttlMs > 0 ? ttlMs : this.windowMs));
        return { totalHits: hits, resetTime };
      } catch {
        // Fall back to memory map if Redis command fails
        return this.fallbackIncrement(key);
      }
    }
    return this.fallbackIncrement(key);
  }

  public async decrement(key: string): Promise<void> {
    const redisKey = `${this.prefix}${key}`;
    if (this.client) {
      try {
        await this.client.sendCommand(["DECR", redisKey]);
        return;
      } catch {
        // fallback
      }
    }
    const record = this.fallbackMap.get(key);
    if (record && record.totalHits > 0) {
      record.totalHits -= 1;
    }
  }

  public async resetKey(key: string): Promise<void> {
    const redisKey = `${this.prefix}${key}`;
    if (this.client) {
      try {
        await this.client.sendCommand(["DEL", redisKey]);
        return;
      } catch {
        // fallback
      }
    }
    this.fallbackMap.delete(key);
  }

  public async resetAll(): Promise<void> {
    this.fallbackMap.clear();
  }

  public shutdown(): void {
    if (this.fallbackCleanupTimer) {
      clearInterval(this.fallbackCleanupTimer);
      this.fallbackCleanupTimer = undefined;
    }
    this.fallbackMap.clear();
    this.client?.disconnect();
  }
}

/**
 * Factory helper resolving a distributed RedisRateLimitStore if REDIS_URL is defined,
 * or an optimized Memory-fallback store otherwise.
 */
export function resolveRateLimitStore(prefix = "rl:"): Store {
  return new RedisRateLimitStore({ prefix });
}
