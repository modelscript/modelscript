// SPDX-License-Identifier: AGPL-3.0-or-later

export const FEB_26_2022_EPOCH = 1645833600000n; // 2022-02-26T00:00:00.000Z
export const MODELSCRIPT_EPOCH = FEB_26_2022_EPOCH;
export const DEFAULT_EPOCH = MODELSCRIPT_EPOCH;

let lastTimestamp = -1n;
let sequence = 0n;

const WORKER_ID_BITS = 10n;
const SEQUENCE_BITS = 12n;
const MAX_WORKER_ID = (1n << WORKER_ID_BITS) - 1n; // 1023
const MAX_SEQUENCE = (1n << SEQUENCE_BITS) - 1n; // 4095
const TIMESTAMP_LEFT_SHIFT = WORKER_ID_BITS + SEQUENCE_BITS; // 22n
const WORKER_ID_SHIFT = SEQUENCE_BITS; // 12n

export function generateSnowflakeId(
  timestampMs: number = Date.now(),
  machineId: number = 1,
  epoch: bigint = DEFAULT_EPOCH,
): string {
  let ts = BigInt(timestampMs);
  if (ts < epoch) {
    ts = epoch;
  }

  const worker = BigInt(machineId) & MAX_WORKER_ID;

  if (ts === lastTimestamp) {
    sequence = (sequence + 1n) & MAX_SEQUENCE;
    if (sequence === 0n) {
      while (ts <= lastTimestamp) {
        ts = BigInt(Date.now());
      }
    }
  } else {
    sequence = 0n;
  }
  lastTimestamp = ts;

  const snowflake = ((ts - epoch) << TIMESTAMP_LEFT_SHIFT) | (worker << WORKER_ID_SHIFT) | sequence;
  return snowflake.toString();
}

export function parseSnowflakeId(
  id: string | bigint | number,
  epoch: bigint = DEFAULT_EPOCH,
): {
  timestamp: number;
  workerId: number;
  sequence: number;
  date: Date;
} {
  const n = BigInt(id);
  const tsMs = Number((n >> TIMESTAMP_LEFT_SHIFT) + epoch);
  const workerId = Number((n >> WORKER_ID_SHIFT) & MAX_WORKER_ID);
  const seq = Number(n & MAX_SEQUENCE);
  return {
    timestamp: tsMs,
    workerId,
    sequence: seq,
    date: new Date(tsMs),
  };
}

export function isSnowflakeId(id: unknown): boolean {
  if (typeof id === "bigint") return id > 0n;
  if (typeof id === "number") return id > 1000000000000;
  if (typeof id === "string") return /^\d{16,21}$/.test(id.trim());
  return false;
}

export function normalizeWorkspaceTemplate(rawTemplate: string): {
  isWorkspace: boolean;
  workspaceId: string;
} {
  const template = (rawTemplate || "").trim().replace(/^\/+/, "").split("?")[0]!.split("&")[0]!;
  if (template === "scratch") {
    return { isWorkspace: true, workspaceId: "scratch" };
  }
  if (template.startsWith("artifact-")) {
    return { isWorkspace: true, workspaceId: template.slice("artifact-".length) };
  }
  if (/^\d+$/.test(template)) {
    return { isWorkspace: true, workspaceId: template };
  }
  return { isWorkspace: false, workspaceId: template };
}
