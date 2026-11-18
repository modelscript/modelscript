// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/rtds — Project RTDS RSCAD Draft (.dft) to ATP-EMTP Card Deck (.atp).
 */

import type { RtdsDraft } from "../types.js";

export function projectRtdsToAtp(draft: RtdsDraft): string {
  const lines: string[] = [];
  lines.push("BEGIN NEW DATA CASE");
  lines.push(`C Generated from RTDS Draft: ${draft.name}`);
  lines.push(`${draft.timeStepSec.toExponential(3)}  ${draft.finishTimeSec.toFixed(4)}`);
  lines.push("/BRANCH");
  for (const comp of draft.components) {
    if (comp.type === "SOURCE") continue;
    const n1 = (comp.nodes[0] ?? "BUS1").slice(0, 6).padEnd(6, " ");
    const n2 = (comp.nodes[1] ?? "      ").slice(0, 6).padEnd(6, " ");
    const r = Number(comp.params["R"] ?? 0);
    const l = Number(comp.params["L"] ?? 0) * 1e3; // mH
    const c = Number(comp.params["C"] ?? 0) * 1e6; // uF
    lines.push(`  ${n1}${n2}            ${r.toFixed(4)}  ${l.toFixed(4)}  ${c.toFixed(4)}`);
  }
  lines.push("/SOURCE");
  for (const comp of draft.components) {
    if (comp.type !== "SOURCE") continue;
    const n1 = (comp.nodes[0] ?? "BUS1").slice(0, 6).padEnd(6, " ");
    const v = Number(comp.params["V"] ?? 1000);
    lines.push(`14${n1}          ${v.toFixed(2)}  ${draft.frequencyHz.toFixed(2)}`);
  }
  lines.push("BEGIN NEW DATA CASE");
  lines.push("BLANK");
  return lines.join("\n");
}
