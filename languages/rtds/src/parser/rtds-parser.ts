// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/rtds — Parser for RTDS RSCAD Draft (.dft) & HIL Netlists.
 */

import type { RtdsComponent, RtdsComponentType, RtdsDraft } from "../types.js";

const KNOWN_TYPES = new Set<string>(["SOURCE", "R", "L", "C", "RLC", "LINE", "XFMR", "BREAKER", "IBR", "LOAD"]);

function parseParamValue(raw: string): number | string {
  const n = Number(raw);
  return Number.isFinite(n) ? n : raw;
}

export function parseRtdsDraft(source: string): RtdsDraft {
  let name = "RTDS_Case";
  let timeStepSec = 50e-6;
  let finishTimeSec = 0.2;
  let frequencyHz = 60;
  let currentSubsystem = 1;
  const subsystems = new Set<number>([1]);
  const components: RtdsComponent[] = [];
  const nodes = new Set<string>();

  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine
      .replace(/\/\/.*$/, "")
      .replace(/!.*$/, "")
      .replace(/#.*$/, "")
      .trim();
    if (!line) continue;

    const parts = line.split(/\s+/);
    const head = parts[0]?.toUpperCase();

    if (head === "CASE" && parts[1]) {
      name = parts[1];
    } else if (head === "TIME_STEP" && parts[1]) {
      timeStepSec = Number(parts[1]);
    } else if (head === "FINISH_TIME" && parts[1]) {
      finishTimeSec = Number(parts[1]);
    } else if (head === "FREQUENCY" && parts[1]) {
      frequencyHz = Number(parts[1]);
    } else if (head === "SUBSYSTEM" && parts[1]) {
      currentSubsystem = Number(parts[1]) || 1;
      subsystems.add(currentSubsystem);
    } else if (head === "COMPONENT" && parts.length >= 3) {
      const compType = (
        KNOWN_TYPES.has(parts[1]!.toUpperCase()) ? parts[1]!.toUpperCase() : "RLC"
      ) as RtdsComponentType;
      const compName = parts[2]!;
      const compNodes: string[] = [];
      const params: Record<string, number | string> = {};

      for (const tok of parts.slice(3)) {
        const eq = tok.indexOf("=");
        if (eq !== -1) {
          const k = tok.slice(0, eq);
          const v = tok.slice(eq + 1);
          if (k === "nodes") {
            for (const n of v.split(",")) {
              const clean = n.trim();
              if (clean) {
                compNodes.push(clean);
                if (clean !== "0" && clean.toUpperCase() !== "GND") nodes.add(clean);
              }
            }
          } else {
            params[k] = parseParamValue(v);
          }
        }
      }

      components.push({
        name: compName,
        type: compType,
        subsystem: currentSubsystem,
        nodes: compNodes,
        params,
      });
    }
  }

  return {
    name,
    timeStepSec,
    finishTimeSec,
    frequencyHz,
    subsystems: Array.from(subsystems).sort((a, b) => a - b),
    components,
    nodes,
  };
}
