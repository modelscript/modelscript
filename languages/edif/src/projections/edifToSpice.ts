// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Projects an EDIF 2.0.0 netlist to a standard SPICE netlist (`.SUBCKT` / element cards / `.END`).
 */

import { parseEdif } from "../parser/edif-parser.js";
import { flattenEdifNetlist } from "../solver/flattener.js";
import type { EdifDocument, FlattenedEdifInstance, FlattenedEdifNetlist } from "../types.js";

function spiceId(raw: string): string {
  return raw.replace(/[^A-Za-z0-9_]/g, "_");
}

function spiceNode(raw: string): string {
  const u = raw.toUpperCase();
  if (u === "GND" || u === "VSS" || u === "0") return "0";
  return spiceId(raw);
}

function getNumericProp(inst: FlattenedEdifInstance, keys: string[], fallback: number): number {
  for (const k of keys) {
    const v = inst.properties[k.toUpperCase()];
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return fallback;
}

function getOrderedNets(inst: FlattenedEdifInstance, preferred: string[]): string[] {
  const entries = Object.entries(inst.portToNet);
  const out: string[] = [];
  const used = new Set<string>();

  for (const cand of preferred) {
    const hit = entries.find(([k]) => k.toUpperCase() === cand);
    if (hit && !used.has(hit[0])) {
      out.push(spiceNode(hit[1]));
      used.add(hit[0]);
    }
  }
  for (const [k, net] of entries) {
    if (!used.has(k)) {
      out.push(spiceNode(net));
    }
  }
  return out;
}

/**
 * Generates a SPICE netlist from an EDIF 2.0.0 document, source string, or flattened netlist.
 */
export function edifToSpice(input: string | EdifDocument | FlattenedEdifNetlist): string {
  const docOrFlat = typeof input === "string" ? parseEdif(input) : input;
  const flat: FlattenedEdifNetlist = "libraries" in docOrFlat ? flattenEdifNetlist(docOrFlat) : docOrFlat;

  const lines: string[] = [
    `* SPICE Netlist projected from EDIF 2.0.0 design '${flat.designName}'`,
    `* Top cell: ${flat.topLibraryName}.${flat.topCellName}`,
    "",
  ];

  for (const inst of flat.instances) {
    const cn = inst.cellName.toUpperCase();
    const id = spiceId(inst.name);

    if (cn === "RES" || cn === "RESISTOR" || cn === "R") {
      const nodes = getOrderedNets(inst, ["P", "N"]);
      const val = getNumericProp(inst, ["R", "VALUE", "RESISTANCE"], 1000);
      lines.push(`R_${id} ${nodes[0] ?? "0"} ${nodes[1] ?? "0"} ${val}`);
    } else if (cn === "CAP" || cn === "CAPACITOR" || cn === "C") {
      const nodes = getOrderedNets(inst, ["P", "N"]);
      const val = getNumericProp(inst, ["C", "VALUE", "CAPACITANCE"], 1e-6);
      lines.push(`C_${id} ${nodes[0] ?? "0"} ${nodes[1] ?? "0"} ${val}`);
    } else if (cn === "IND" || cn === "INDUCTOR" || cn === "L") {
      const nodes = getOrderedNets(inst, ["P", "N"]);
      const val = getNumericProp(inst, ["L", "VALUE", "INDUCTANCE"], 1e-3);
      lines.push(`L_${id} ${nodes[0] ?? "0"} ${nodes[1] ?? "0"} ${val}`);
    } else if (cn === "VCC" || cn === "VDD" || cn === "SUPPLY") {
      const nodes = getOrderedNets(inst, ["P", "VCC", "VDD"]);
      const val = getNumericProp(inst, ["V", "VALUE", "VOLTAGE", "VDD", "VCC"], 5.0);
      lines.push(`V_${id} ${nodes[0] ?? "VCC"} 0 DC ${val}`);
    } else if (cn === "VDC" || cn === "VSOURCE") {
      const nodes = getOrderedNets(inst, ["P", "N"]);
      const val = getNumericProp(inst, ["V", "VALUE", "DC", "VOLTAGE"], 5.0);
      lines.push(`V_${id} ${nodes[0] ?? "0"} ${nodes[1] ?? "0"} DC ${val}`);
    } else if (cn === "GND" || cn === "GROUND" || cn === "VSS") {
      const nodes = getOrderedNets(inst, ["P", "GND"]);
      lines.push(`* GND reference ${id} -> node ${nodes[0] ?? "0"}`);
    } else {
      // Digital gates or generic subcircuit call
      const nodes = getOrderedNets(inst, ["A", "B", "D", "CLK", "Y", "Q"]);
      lines.push(`X_${id} ${nodes.join(" ")} ${cn}`);
    }
  }

  lines.push("");
  lines.push(".OP");
  lines.push(".END");
  lines.push("");

  return lines.join("\n");
}
