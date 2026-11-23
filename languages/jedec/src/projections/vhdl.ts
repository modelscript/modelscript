// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Synthesizable VHDL-93 projection from JEDEC JESD3 PAL/GAL fuse maps.
 */

import { extractJedecEquations } from "../solver/boolean-extractor.js";
import type { JedecDeviceProfile } from "../solver/device-profiles.js";
import type { JedecDocument, JedecProductTerm } from "../types.js";

function sanitizeVhdlIdent(name: string): string {
  const cleaned = name
    .replace(/[^A-Za-z0-9_]/g, "_")
    .replace(/^(\d)/, "p_$1")
    .replace(/__+/g, "_")
    .replace(/_$/, "");
  return cleaned || "jedec_pld";
}

function formatVhdlTerm(term: JedecProductTerm): string {
  if (term.alwaysFalse) return "'0'";
  if (term.alwaysTrue) return "'1'";
  return term.literals.map((l) => (l.negated ? `(not ${l.signalName})` : l.signalName)).join(" and ");
}

/**
 * Projects a parsed `JedecDocument` into a synthesizable VHDL-93 entity & RTL architecture.
 */
export function jedecToVhdl(
  doc: JedecDocument,
  options?: { entityName?: string; profile?: JedecDeviceProfile },
): string {
  const extraction = extractJedecEquations(doc, options?.profile);
  const entityName = sanitizeVhdlIdent(options?.entityName ?? doc.name);

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

  lines.push(`-- Synthesizable VHDL-93 projection from JEDEC JESD3 (${extraction.deviceName})`);
  lines.push(
    `-- Fuses: ${extraction.utilization.totalFuses} (${extraction.utilization.intactFuses} intact, ${extraction.utilization.blownFuses} blown)`,
  );
  lines.push("library ieee;");
  lines.push("use ieee.std_logic_1164.all;");
  lines.push("");
  lines.push(`entity ${entityName} is`);
  lines.push("  port (");

  const portDecls: string[] = [
    ...inputPorts.map((p) => `    ${p} : in  std_logic`),
    ...outputPorts.map((p) => `    ${p} : out std_logic`),
  ];
  lines.push(portDecls.join(";\n"));
  lines.push("  );");
  lines.push(`end entity ${entityName};`);
  lines.push("");
  lines.push(`architecture rtl of ${entityName} is`);
  lines.push("begin");

  for (const eq of extraction.equations) {
    let sopExpr: string;
    if (eq.activeTerms.length === 0) {
      sopExpr = "'0'";
    } else if (eq.activeTerms.some((t) => t.alwaysTrue)) {
      sopExpr = "'1'";
    } else if (eq.activeTerms.length === 1) {
      sopExpr = formatVhdlTerm(eq.activeTerms[0]!);
    } else {
      sopExpr = eq.activeTerms.map((t) => `(${formatVhdlTerm(t)})`).join(" or ");
    }

    const coreExpr = eq.activeLow
      ? sopExpr === "'0'"
        ? "'1'"
        : sopExpr === "'1'"
          ? "'0'"
          : `not (${sopExpr})`
      : sopExpr;

    if (eq.oeTerm && !eq.oeTerm.alwaysTrue) {
      if (eq.oeTerm.alwaysFalse) {
        lines.push(`  ${eq.signalName} <= 'Z'; -- pin ${eq.pin} (OE disabled)`);
      } else {
        const oeExpr = formatVhdlTerm(eq.oeTerm);
        lines.push(`  ${eq.signalName} <= (${coreExpr}) when (${oeExpr}) = '1' else 'Z'; -- pin ${eq.pin}`);
      }
    } else {
      lines.push(`  ${eq.signalName} <= ${coreExpr}; -- pin ${eq.pin}`);
    }
  }

  lines.push("end architecture rtl;");
  return lines.join("\n") + "\n";
}
