// SPDX-License-Identifier: AGPL-3.0-or-later

import type { RocetsPerformanceMap } from "../types.js";

/**
 * Parses turbomachinery pump/turbine performance map tables.
 */
export function parseRocetsMap(sourceText: string): RocetsPerformanceMap {
  const lines = sourceText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
  let name = "CUSTOM_MAP";

  const speeds: number[] = [];
  const flows: number[] = [];
  const headData: number[][] = [];
  const effData: number[][] = [];

  let readingHead = true;

  for (const line of lines) {
    if (line.startsWith("MAP:") || line.startsWith("NAME:")) {
      name = line.replace(/^(MAP|NAME):\s*/i, "").trim();
      continue;
    }

    if (line.startsWith("SPEEDS:") || line.startsWith("RPM:")) {
      const parts = line
        .replace(/^(SPEEDS|RPM):\s*/i, "")
        .split(/[\s,]+/)
        .map(Number);
      speeds.push(...parts.filter((v) => !isNaN(v)));
      continue;
    }

    if (line.startsWith("FLOWS:") || line.startsWith("FLOW_KGS:")) {
      const parts = line
        .replace(/^(FLOWS|FLOW_KGS):\s*/i, "")
        .split(/[\s,]+/)
        .map(Number);
      flows.push(...parts.filter((v) => !isNaN(v)));
      continue;
    }

    if (line.startsWith("HEAD:") || line.startsWith("PR:")) {
      readingHead = true;
      continue;
    }

    if (line.startsWith("EFFICIENCY:") || line.startsWith("EFF:")) {
      readingHead = false;
      continue;
    }

    // Row of numbers
    const vals = line
      .split(/[\s,]+/)
      .map(Number)
      .filter((v) => !isNaN(v));
    if (vals.length > 0) {
      if (readingHead) {
        headData.push(vals);
      } else {
        effData.push(vals);
      }
    }
  }

  return {
    name,
    speedRpm: speeds.length > 0 ? speeds : [10000, 20000, 30000],
    flowKgS: flows.length > 0 ? flows : [10, 20, 30, 40, 50],
    headOrPressureRatio: headData.length > 0 ? headData : [[1500, 1400, 1300, 1200, 1100]],
    efficiency: effData.length > 0 ? effData : [[0.6, 0.75, 0.8, 0.78, 0.7]],
  };
}
