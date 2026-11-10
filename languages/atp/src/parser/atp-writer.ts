// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Alternative Transients Program (ATP-EMTP) Serializer.
 */

import type { AtpCase } from "../types.js";

/**
 * Serializes an AtpCase to standard card-deck formatted text.
 */
export function writeAtp(atpCase: AtpCase): string {
  const lines: string[] = [];

  lines.push("BEGIN NEW DATA CASE");
  lines.push(`C ${atpCase.title}`);
  lines.push(`  ${atpCase.control.deltaTSec.toExponential(4)}  ${atpCase.control.tMaxSec.toExponential(4)}`);

  // /BRANCH section
  if (atpCase.branches.length > 0) {
    lines.push("/BRANCH");
    for (const b of atpCase.branches) {
      const n1 = b.node1.padEnd(6);
      const n2 = b.node2.padEnd(6);
      const r = b.rOhms.toFixed(4).padStart(10);
      const l = b.lMh.toFixed(4).padStart(10);
      const c = b.cUf.toFixed(4).padStart(10);
      lines.push(`${n1}${n2}${r}${l}${c}`);
    }
    lines.push("BLANK RECORD");
  }

  // /SWITCH section
  if (atpCase.switches.length > 0) {
    lines.push("/SWITCH");
    for (const s of atpCase.switches) {
      const n1 = s.node1.padEnd(6);
      const n2 = s.node2.padEnd(6);
      const tc = s.tCloseSec.toFixed(6).padStart(12);
      const to = s.tOpenSec.toFixed(6).padStart(12);
      lines.push(`${n1}${n2}${tc}${to}`);
    }
    lines.push("BLANK RECORD");
  }

  // /SOURCE section
  if (atpCase.sources.length > 0) {
    lines.push("/SOURCE");
    for (const s of atpCase.sources) {
      const code = String(s.typeCode).padStart(2);
      const node = s.node.padEnd(6);
      const amp = s.amplitude.toFixed(2).padStart(12);
      const freq = s.frequencyHz.toFixed(2).padStart(8);
      const phase = s.phaseDeg.toFixed(2).padStart(8);
      lines.push(`${code} ${node}${amp}${freq}${phase}`);
    }
    lines.push("BLANK RECORD");
  }

  // /OUTPUT section
  if (atpCase.outputNodes.length > 0) {
    lines.push("/OUTPUT");
    lines.push(atpCase.outputNodes.join(" "));
    lines.push("BLANK RECORD");
  }

  lines.push("BLANK RECORD");
  return lines.join("\n") + "\n";
}
