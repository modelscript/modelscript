// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * GE PSLF Dynamic Data (.dyd) Serializer.
 */

import type { PslfDydCase } from "../types.js";

/**
 * Serializes a `PslfDydCase` into standard PSLF .dyd file format.
 */
export function writePslfDyd(dydCase: PslfDydCase): string {
  const lines: string[] = [];

  lines.push(`# =========================================================================`);
  lines.push(`# GE PSLF Dynamic Simulation Data (.dyd)`);
  lines.push(`# Exported by ModelScript Polyglot Engineering Compiler`);
  lines.push(`# =========================================================================`);
  lines.push("");

  for (const m of dydCase.models) {
    if (m.comment) {
      lines.push(`# ${m.comment}`);
    }

    const paddedModel = m.modelType.padEnd(8, " ");
    const kvStr = m.baseKv > 0 ? m.baseKv.toFixed(2) : "0.0";
    const idStr = `"${m.id}"`;
    const countTag = `#${m.params.length}`;

    // Format parameter numbers cleanly
    const paramStrings = m.params.map((p) => {
      if (Number.isInteger(p)) return p.toFixed(1);
      return Number(p.toPrecision(6)).toString();
    });

    lines.push(`${paddedModel} ${m.busNumber} ${idStr} ${kvStr} : ${countTag} ${paramStrings.join(" ")}`);
  }

  return lines.join("\n");
}
