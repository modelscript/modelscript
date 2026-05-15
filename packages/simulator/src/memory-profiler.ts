// SPDX-License-Identifier: AGPL-3.0-or-later

export interface MemorySnapshot {
  /** The V8 heap space currently in use (in MB) */
  heapUsedMB: number;
  /** Total available V8 heap space (in MB) */
  heapTotalMB: number;
  /** C++ and other external memory usage (in MB) */
  externalMB: number;
  /** Total resident set size of the process (in MB) */
  rssMB: number;
}

/**
 * Capture a memory snapshot, optionally forcing garbage collection if enabled.
 * Run Node with `--expose-gc` to enable forced garbage collection.
 */
export function snapshotMemory(forceGC = false): MemorySnapshot {
  if (forceGC && global.gc) {
    global.gc();
  }

  const mem = process.memoryUsage();
  return {
    heapUsedMB: mem.heapUsed / 1024 / 1024,
    heapTotalMB: mem.heapTotal / 1024 / 1024,
    externalMB: mem.external / 1024 / 1024,
    rssMB: mem.rss / 1024 / 1024,
  };
}

/**
 * Format a memory snapshot for logging.
 */
export function formatMemorySnapshot(snap: MemorySnapshot): string {
  return `Heap: ${snap.heapUsedMB.toFixed(2)} MB / ${snap.heapTotalMB.toFixed(2)} MB | Ext: ${snap.externalMB.toFixed(2)} MB | RSS: ${snap.rssMB.toFixed(2)} MB`;
}

/**
 * Format the difference between two memory snapshots for logging.
 */
export function formatMemoryDiff(before: MemorySnapshot, after: MemorySnapshot): string {
  const diffHeap = after.heapUsedMB - before.heapUsedMB;
  const diffExt = after.externalMB - before.externalMB;
  const diffRss = after.rssMB - before.rssMB;

  const sign = (v: number) => (v >= 0 ? "+" : "");

  return `Δ Heap: ${sign(diffHeap)}${diffHeap.toFixed(2)} MB | Δ Ext: ${sign(diffExt)}${diffExt.toFixed(2)} MB | Δ RSS: ${sign(diffRss)}${diffRss.toFixed(2)} MB`;
}
