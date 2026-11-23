// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Synthesizable Verilog-2001 projection from JEDEC JESD3 PAL/GAL fuse maps.
 */

import { extractJedecEquations } from "../solver/boolean-extractor.js";
import type { JedecDeviceProfile } from "../solver/device-profiles.js";
import type { JedecDocument, JedecProductTerm } from "../types.js";

function sanitizeIdent(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9_]/g, "_").replace(/^(\d)/, "_$1");
  return cleaned || "jedec_pld";
}

function formatVerilogTerm(term: JedecProductTerm): string {
  if (term.alwaysFalse) return "1'b0";
  if (term.alwaysTrue) return "1'b1";
  return term.literals.map((l) => (l.negated ? `~${l.signalName}` : l.signalName)).join(" & ");
}

/**
 * Projects a parsed `JedecDocument` into a synthesizable Verilog-2001 module.
 */
export function jedecToVerilog(
  doc: JedecDocument,
  options?: { moduleName?: string; profile?: JedecDeviceProfile },
): string {
  const extraction = extractJedecEquations(doc, options?.profile);
  const moduleName = sanitizeIdent(options?.moduleName ?? doc.name);

  // Collect input and output port names
  const outputSet = new Set(extraction.equations.map((e) => e.signalName));
  const inputPorts: string[] = [];
  const inputSet = new Set<string>();

  for (const pin of extraction.inputPins) {
    const name = `I${pin}`;
    if (!inputSet.has(name) && !outputSet.has(name)) {
      inputSet.add(name);
      inputPorts.push(name);
    }
  }
  for (const eq of extraction.equations) {
    for (const term of eq.allTerms) {
      for (const lit of term.literals) {
        if (!inputSet.has(lit.signalName) && !outputSet.has(lit.signalName)) {
          inputSet.add(lit.signalName);
          inputPorts.push(lit.signalName);
        }
      }
    }
  }

  const outputPorts = extraction.equations.map((e) => e.signalName);
  const lines: string[] = [];

  lines.push(`// Synthesizable Verilog-2001 projection from JEDEC JESD3 (${extraction.deviceName})`);
  lines.push(
    `// Fuses: ${extraction.utilization.totalFuses} (${extraction.utilization.intactFuses} intact, ${extraction.utilization.blownFuses} blown)`,
  );
  lines.push(`module ${moduleName} (`);

  const portDecls: string[] = [
    ...inputPorts.map((p) => `  input  wire ${p}`),
    ...outputPorts.map((p) => `  output wire ${p}`),
  ];
  lines.push(portDecls.join(",\n"));
  lines.push(`);`);
  lines.push("");

  for (const eq of extraction.equations) {
    let sopExpr: string;
    if (eq.activeTerms.length === 0) {
      sopExpr = "1'b0";
    } else if (eq.activeTerms.some((t) => t.alwaysTrue)) {
      sopExpr = "1'b1";
    } else if (eq.activeTerms.length === 1) {
      sopExpr = formatVerilogTerm(eq.activeTerms[0]!);
    } else {
      sopExpr = eq.activeTerms.map((t) => `(${formatVerilogTerm(t)})`).join(" | ");
    }

    const coreExpr = eq.activeLow
      ? sopExpr === "1'b0"
        ? "1'b1"
        : sopExpr === "1'b1"
          ? "1'b0"
          : `~(${sopExpr})`
      : sopExpr;

    if (eq.oeTerm && !eq.oeTerm.alwaysTrue) {
      if (eq.oeTerm.alwaysFalse) {
        lines.push(`  assign ${eq.signalName} = 1'bz; // pin ${eq.pin} (OE disabled)`);
      } else {
        const oeExpr = formatVerilogTerm(eq.oeTerm);
        lines.push(`  assign ${eq.signalName} = (${oeExpr}) ? (${coreExpr}) : 1'bz; // pin ${eq.pin}`);
      }
    } else {
      lines.push(`  assign ${eq.signalName} = ${coreExpr}; // pin ${eq.pin}`);
    }
  }

  lines.push("");
  lines.push("endmodule");
  return lines.join("\n") + "\n";
}
