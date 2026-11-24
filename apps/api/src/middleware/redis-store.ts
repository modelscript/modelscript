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

export const MAX_RATE_LIMIT_RECORDS = 10_000;

export const ATOMIC_INCR_LUA =
  "local c = redis.call('INCR', KEYS[1]); if c == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]); end; local t = redis.call('PTTL', KEYS[1]); return {c, t}";

export interface ExpiringRecord {
  resetAt: number;
}

/**
 * Shared eviction helper for bounded in-memory rate-limit Maps.
 * First purges expired entries; if still at or above `maxRecords`, evicts the oldest entry (FIFO).
 */
export function enforceMapLimit<K, V extends ExpiringRecord>(
  map: Map<K, V>,
  now: number,
  maxRecords = MAX_RATE_LIMIT_RECORDS,
): void {
  if (map.size < maxRecords) return;
  for (const [k, v] of map) {
    if (now >= v.resetAt) {
      map.delete(k);
    }
  }
  while (map.size >= maxRecords) {
    const oldestKey = map.keys().next().value;
    if (oldestKey === undefined) break;
    map.delete(oldestKey);
  }
}

/**
 * Starts an unref'd periodic cleanup timer that purges expired records from a Map.
 */
export function startExpiringMapCleanup<K, V extends ExpiringRecord>(
  map: Map<K, V>,
  intervalMs = 60_000,
): NodeJS.Timeout {
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of map) {
      if (now >= v.resetAt) {
        map.delete(k);
      }
    }
  }, intervalMs);
  timer.unref?.();
  return timer;
}

let sharedRedisClient: MinimalRedisClient | undefined;
let sharedRedisUrl: string | undefined;

/**
 * Returns a lazily initialized shared MinimalRedisClient when `REDIS_URL` (or an explicit URL)
 * is configured, or `undefined` when running in single-node memory-only mode.
 */
export function getSharedRedisClient(redisUrl?: string): MinimalRedisClient | undefined {
  const url = redisUrl ?? process.env["REDIS_URL"];
  if (!url) return undefined;

  if (sharedRedisClient && sharedRedisUrl === url) {
    return sharedRedisClient;
  }

  try {
    const client = new MinimalRedisClient(url);
    void client.connect().catch(() => {
      // Ignore connection failure; callers gracefully use local fallback
    });
    if (!redisUrl) {
      sharedRedisClient = client;
      sharedRedisUrl = url;
    }
    return client;
  } catch {
    return undefined;
  }
}

export interface DistributedCounterRecord extends ExpiringRecord {
  count: number;
  lastEventAt: number;
}

export interface DistributedCounterBridgeOptions {
  prefix: string;
  windowMs: number;
  maxRecords?: number;
  cleanupIntervalMs?: number;
  redisUrl?: string;
  client?: MinimalRedisClient;
}

/**
 * Lightweight bridge backing synchronous custom rate limiters with a bounded in-memory Map
 * (capped at MAX_RATE_LIMIT_RECORDS with unref'd periodic expiration) and fire-and-forget
 * atomic Redis Lua replication when REDIS_URL is configured.
 */
export class DistributedCounterBridge {
  private readonly records = new Map<string, DistributedCounterRecord>();
  private readonly prefix: string;
  private readonly windowMs: number;
  private readonly maxRecords: number;
  private readonly explicitClient?: MinimalRedisClient | undefined;
  private readonly explicitRedisUrl?: string | undefined;
  private cleanupTimer?: NodeJS.Timeout | undefined;

  constructor(options: DistributedCounterBridgeOptions) {
    this.prefix = options.prefix;
    this.windowMs = options.windowMs;
    this.maxRecords = options.maxRecords ?? MAX_RATE_LIMIT_RECORDS;
    this.explicitClient = options.client;
    this.explicitRedisUrl = options.redisUrl;
    this.cleanupTimer = startExpiringMapCleanup(this.records, options.cleanupIntervalMs ?? 60_000);
  }

  private resolveClient(): MinimalRedisClient | undefined {
    return this.explicitClient ?? getSharedRedisClient(this.explicitRedisUrl);
  }

  public get size(): number {
    return this.records.size;
  }

  public get(key: string, now = Date.now()): DistributedCounterRecord | undefined {
    const record = this.records.get(key);
    if (!record) return undefined;
    if (now >= record.resetAt) {
      this.records.delete(key);
      return undefined;
    }
    return record;
  }

  public increment(key: string, now = Date.now()): DistributedCounterRecord {
    let record = this.records.get(key);
    if (!record || now >= record.resetAt) {
      if (!record) {
        enforceMapLimit(this.records, now, this.maxRecords);
      }
      record = {
        count: 1,
        resetAt: now + this.windowMs,
        lastEventAt: now,
      };
      this.records.set(key, record);
    } else {
      record.count += 1;
      record.lastEventAt = now;
    }

    this.syncIncrementToRedis(key, record);
    return record;
  }

  public delete(key: string): void {
    this.records.delete(key);
    this.syncDeleteToRedis([key]);
  }

  public clear(): void {
    const keys = Array.from(this.records.keys());
    this.records.clear();
    this.syncDeleteToRedis(keys);
  }

  public shutdown(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
    this.records.clear();
  }

  private syncIncrementToRedis(key: string, localRecord: DistributedCounterRecord): void {
    const client = this.resolveClient();
    if (!client) return;

    const redisKey = `${this.prefix}${key}`;
    void (async () => {
      try {
        let hits: number | undefined;
        let ttlMs: number | undefined;
        try {
          const evalRes = (await client.sendCommand([
            "EVAL",
            ATOMIC_INCR_LUA,
            "1",
            redisKey,
            String(this.windowMs),
          ])) as [number, number];
          if (Array.isArray(evalRes) && typeof evalRes[0] === "number") {
            hits = evalRes[0];
            ttlMs = typeof evalRes[1] === "number" && evalRes[1] > 0 ? evalRes[1] : this.windowMs;
          }
        } catch {
          // Fall back to sequential commands if Redis server/mock doesn't support EVAL
          const incrHits = (await client.sendCommand(["INCR", redisKey])) as number;
          if (incrHits === 1) {
            await client.sendCommand(["PEXPIRE", redisKey, String(this.windowMs)]);
          }
          const pttl = (await client.sendCommand(["PTTL", redisKey])) as number;
          if (typeof incrHits === "number") {
            hits = incrHits;
            ttlMs = typeof pttl === "number" && pttl > 0 ? pttl : this.windowMs;
          }
        }

        if (typeof hits === "number") {
          const current = this.records.get(key);
          if (current === localRecord) {
            if (hits > current.count) {
              current.count = hits;
            }
            if (typeof ttlMs === "number" && ttlMs > 0) {
              current.resetAt = Date.now() + ttlMs;
            }
          }
        }
      } catch {
        // Redis unavailable: local bounded Map remains authoritative
      }
    })();
  }

  private syncDeleteToRedis(keys: string[]): void {
    if (keys.length === 0) return;
    const client = this.resolveClient();
    if (!client) return;

    const BATCH_SIZE = 500;
    for (let i = 0; i < keys.length; i += BATCH_SIZE) {
      const batch = keys.slice(i, i + BATCH_SIZE).map((k) => `${this.prefix}${k}`);
      void client.sendCommand(["DEL", ...batch]).catch(() => {
        // Redis unavailable: ignore
      });
    }
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
      if (this.fallbackMap.size >= MAX_RATE_LIMIT_RECORDS) {
        const oldestKey = this.fallbackMap.keys().next().value;
        if (oldestKey !== undefined) {
          this.fallbackMap.delete(oldestKey);
        }
      }
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
        try {
          const evalRes = (await this.client.sendCommand([
            "EVAL",
            ATOMIC_INCR_LUA,
            "1",
            redisKey,
            String(this.windowMs),
          ])) as [number, number];
          if (Array.isArray(evalRes) && typeof evalRes[0] === "number") {
            const hits = evalRes[0];
            const ttlMs = typeof evalRes[1] === "number" && evalRes[1] > 0 ? evalRes[1] : this.windowMs;
            return { totalHits: hits, resetTime: new Date(Date.now() + ttlMs) };
          }
        } catch {
          // Fall back to sequential commands if Redis server/mock doesn't support EVAL
        }
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
