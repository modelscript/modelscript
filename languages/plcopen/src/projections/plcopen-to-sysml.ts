// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/plcopen — Bidirectional Projections to SysML v2.
 *
 * Translates IEC 61131-3 PLCopen POUs into SysML v2 Action and State definitions:
 * - POU -> action def
 * - VAR_INPUT -> in item
 * - VAR_OUTPUT -> out item
 * - ST statements -> action body
 */

import type { PlcPou, PlcProject } from "../types.js";

export function plcopenToSysML(target: PlcPou | PlcProject): string {
  const pous = "pous" in target ? target.pous : [target];
  const pkgName = "pous" in target ? (target.contentHeader?.name ?? "PlcPackage") : "PlcPackage";

  const lines: string[] = [];
  lines.push(`package ${sanitizeIdent(pkgName)} {`);

  for (const pou of pous) {
    const name = sanitizeIdent(pou.name);
    lines.push(`  action def ${name} {`);

    for (const v of pou.variables) {
      const vName = sanitizeIdent(v.name);
      if (v.scope === "input") {
        lines.push(`    in item ${vName};`);
      } else if (v.scope === "output") {
        lines.push(`    out item ${vName};`);
      } else {
        lines.push(`    attribute ${vName};`);
      }
    }

    if (pou.body.kind === "ST" && pou.body.st) {
      lines.push("    action executeCycle;");
    }

    lines.push("  }");
  }

  lines.push("}");
  return lines.join("\n");
}

function sanitizeIdent(name: string): string {
  return name.replace(/[^a-zA-Z0-9_]/g, "_");
}
