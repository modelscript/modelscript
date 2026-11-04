// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * ModelScript Snowflake 64-bit ID Generator and Parser.
 *
 * Structure (64-bit integer):
 *  - 1 bit: sign bit (always 0)
 *  - 41 bits: timestamp in milliseconds since ModelScript epoch (Feb 26 2022 00:00:00 UTC)
 *  - 10 bits: worker / machine ID (0-1023)
 *  - 12 bits: sequence number (0-4095)
 *
 * Produces collision-free, time-ordered ~18-19 digit numerical string IDs matching the
 * snowflake scheme (e.g. "6234825138435453369").
 */

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

function defaultWorkerId(): bigint {
  const envVal =
    typeof process !== "undefined"
      ? process.env?.["SNOWFLAKE_WORKER_ID"] || process.env?.["NODE_APP_INSTANCE"] || process.env?.["WORKER_ID"]
      : undefined;
  if (envVal && !Number.isNaN(Number(envVal))) {
    return BigInt(envVal) & MAX_WORKER_ID;
  }
  return 1n;
}

/**
 * Generates a 64-bit snowflake ID as a decimal string using the configured epoch (defaults to Feb 26, 2022).
 * e.g. "623412345678901234".
 */
export function generateSnowflakeId(
  timestampMs: number = Date.now(),
  machineId: number | bigint = defaultWorkerId(),
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

/**
 * Parses a snowflake ID into its constituent parts: timestamp, date, workerId, sequence.
 */
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

/**
 * Checks if a string or number represents a large Twitter snowflake ID (16-21 digits).
 */
export function isSnowflakeId(id: unknown): boolean {
  if (typeof id === "bigint") return id > 0n;
  if (typeof id === "number") return id > 1000000000000;
  if (typeof id === "string") return /^\d{16,21}$/.test(id.trim());
  return false;
}

/**
 * Normalizes a workspace template / memfs path:
 * Strips legacy "artifact-" prefix if present and extracts the ID (e.g. "artifact-53" -> "53", "2117825138435453369" -> "2117825138435453369").
 */
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
