// SPDX-License-Identifier: AGPL-3.0-or-later

import { extractEmtNetlist } from "../netlist/emt-netlist.js";
import type { PscxProject } from "../types.js";
import { analyzeControlIntervals, isBounded } from "./control-intervals.js";

/** One row of the editor's signal-range overlay. `null` bounds mean unbounded (JSON cannot carry infinity). */
export interface PscadSignalRange {
  /** Control block id (also the id of the signal on its output wire). */
  blockId: string;
  kind: string;
  lo: number | null;
  hi: number | null;
  /** True when both bounds are finite. */
  bounded: boolean;
}

/**
 * Tier 2 result for the editor: a sound output interval for every CSMF control block of the project,
 * suitable for wire tooltips. Blocks the analysis could not reach (algebraic loops) are omitted.
 */
export function analyzePscadSignalRanges(project: PscxProject): PscadSignalRange[] {
  const blocks = extractEmtNetlist(project).controlBlocks ?? [];
  const intervals = analyzeControlIntervals(blocks);
  const fin = (v: number): number | null => (Number.isFinite(v) ? v : null);
  const rows: PscadSignalRange[] = [];
  for (const b of blocks) {
    const iv = intervals.get(b.id);
    if (!iv) continue;
    rows.push({ blockId: b.id, kind: b.kind, lo: fin(iv.lo), hi: fin(iv.hi), bounded: isBounded(iv) });
  }
  return rows;
}
