// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Projects an EDIF 2.0.0 netlist to a Modelica model using `Modelica.Electrical.Analog`
 * and/or algebraic digital gate equations.
 */

import { parseEdif } from "../parser/edif-parser.js";
import { flattenEdifNetlist } from "../solver/flattener.js";
import type { EdifDocument, FlattenedEdifInstance, FlattenedEdifNetlist } from "../types.js";

function moId(raw: string): string {
  const cleaned = raw.replace(/[^A-Za-z0-9_]/g, "_");
  return /^[0-9]/.test(cleaned) ? `n_${cleaned}` : cleaned;
}

function getNumericProp(inst: FlattenedEdifInstance, keys: string[], fallback: number): number {
  for (const k of keys) {
    const v = inst.properties[k.toUpperCase()];
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return fallback;
}

function getPinNet(inst: FlattenedEdifInstance, candidates: string[], fallbackIdx: number): string | undefined {
  const entries = Object.entries(inst.portToNet);
  for (const c of candidates) {
    const hit = entries.find(([k]) => k.toUpperCase() === c);
    if (hit) return hit[1];
  }
  return entries[fallbackIdx]?.[1];
}

/**
 * Generates a Modelica model source string from an EDIF 2.0.0 document, source string, or flattened netlist.
 */
export function edifToModelica(input: string | EdifDocument | FlattenedEdifNetlist): string {
  const docOrFlat = typeof input === "string" ? parseEdif(input) : input;
  const flat: FlattenedEdifNetlist = "libraries" in docOrFlat ? flattenEdifNetlist(docOrFlat) : docOrFlat;

  const modelName = moId(flat.designName || flat.topCellName || "EdifDesign");
  const decls: string[] = [];
  const eqs: string[] = [];

  // Declare node potential variables for every net
  for (const net of flat.nets) {
    decls.push(`  Real v_${moId(net.name)}(start = 0.0) "Voltage of net ${net.name}";`);
  }

  const kclTerms = new Map<string, string[]>();
  const fixedNets = new Set<string>();

  function addKcl(netName: string, term: string): void {
    let arr = kclTerms.get(netName);
    if (!arr) {
      arr = [];
      kclTerms.set(netName, arr);
    }
    arr.push(term);
  }

  for (const inst of flat.instances) {
    const cn = inst.cellName.toUpperCase();
    const id = moId(inst.name);

    if (cn === "RES" || cn === "RESISTOR" || cn === "R") {
      const pNet = getPinNet(inst, ["P", "POS", "1"], 0);
      const nNet = getPinNet(inst, ["N", "NEG", "2"], 1);
      const r = getNumericProp(inst, ["R", "VALUE", "RESISTANCE"], 1000);
      decls.push(`  parameter Real R_${id} = ${r};`);
      decls.push(`  Real i_${id};`);
      if (pNet && nNet) {
        eqs.push(`  v_${moId(pNet)} - v_${moId(nNet)} = R_${id} * i_${id};`);
        addKcl(pNet, `i_${id}`);
        addKcl(nNet, `-i_${id}`);
      }
    } else if (cn === "CAP" || cn === "CAPACITOR" || cn === "C") {
      const pNet = getPinNet(inst, ["P", "POS", "1"], 0);
      const nNet = getPinNet(inst, ["N", "NEG", "2"], 1);
      const c = getNumericProp(inst, ["C", "VALUE", "CAPACITANCE"], 1e-6);
      decls.push(`  parameter Real C_${id} = ${c};`);
      decls.push(`  Real vc_${id}(start = 0.0);`);
      decls.push(`  Real i_${id};`);
      if (pNet && nNet) {
        eqs.push(`  vc_${id} = v_${moId(pNet)} - v_${moId(nNet)};`);
        eqs.push(`  i_${id} = C_${id} * der(vc_${id});`);
        addKcl(pNet, `i_${id}`);
        addKcl(nNet, `-i_${id}`);
      }
    } else if (cn === "IND" || cn === "INDUCTOR" || cn === "L") {
      const pNet = getPinNet(inst, ["P", "POS", "1"], 0);
      const nNet = getPinNet(inst, ["N", "NEG", "2"], 1);
      const l = getNumericProp(inst, ["L", "VALUE", "INDUCTANCE"], 1e-3);
      decls.push(`  parameter Real L_${id} = ${l};`);
      decls.push(`  Real i_${id}(start = 0.0);`);
      if (pNet && nNet) {
        eqs.push(`  v_${moId(pNet)} - v_${moId(nNet)} = L_${id} * der(i_${id});`);
        addKcl(pNet, `i_${id}`);
        addKcl(nNet, `-i_${id}`);
      }
    } else if (cn === "GND" || cn === "GROUND" || cn === "VSS") {
      const pNet = getPinNet(inst, ["P", "GND", "1"], 0);
      if (pNet && !fixedNets.has(pNet)) {
        eqs.push(`  v_${moId(pNet)} = 0.0;`);
        fixedNets.add(pNet);
      }
    } else if (cn === "VCC" || cn === "VDD" || cn === "SUPPLY") {
      const pNet = getPinNet(inst, ["P", "VCC", "VDD", "1"], 0);
      const vVal = getNumericProp(inst, ["V", "VALUE", "VOLTAGE", "VDD", "VCC"], 5.0);
      if (pNet && !fixedNets.has(pNet)) {
        eqs.push(`  v_${moId(pNet)} = ${vVal};`);
        fixedNets.add(pNet);
      }
    } else if (cn === "INV" || cn === "NOT") {
      const aNet = getPinNet(inst, ["A", "I", "IN"], 0);
      const yNet = getPinNet(inst, ["Y", "O", "OUT"], 1);
      const vdd = getNumericProp(inst, ["VDD"], 5.0);
      if (aNet && yNet) {
        eqs.push(`  v_${moId(yNet)} = ${vdd} - v_${moId(aNet)};`);
        fixedNets.add(yNet);
      }
    } else if (
      cn === "AND2" ||
      cn === "AND" ||
      cn === "OR2" ||
      cn === "OR" ||
      cn === "XOR2" ||
      cn === "XOR" ||
      cn === "NAND2" ||
      cn === "NOR2"
    ) {
      const aNet = getPinNet(inst, ["A", "I0", "IN1"], 0);
      const bNet = getPinNet(inst, ["B", "I1", "IN2"], 1);
      const yNet = getPinNet(inst, ["Y", "O", "OUT"], 2);
      const vdd = getNumericProp(inst, ["VDD"], 5.0);
      if (aNet && bNet && yNet) {
        const va = `v_${moId(aNet)}`;
        const vb = `v_${moId(bNet)}`;
        const vy = `v_${moId(yNet)}`;
        if (cn === "AND2" || cn === "AND") {
          eqs.push(`  ${vy} = (${va} * ${vb}) / ${vdd};`);
        } else if (cn === "NAND2") {
          eqs.push(`  ${vy} = ${vdd} - (${va} * ${vb}) / ${vdd};`);
        } else if (cn === "OR2" || cn === "OR") {
          eqs.push(`  ${vy} = ${va} + ${vb} - (${va} * ${vb}) / ${vdd};`);
        } else if (cn === "NOR2") {
          eqs.push(`  ${vy} = ${vdd} - (${va} + ${vb} - (${va} * ${vb}) / ${vdd});`);
        } else {
          eqs.push(`  ${vy} = ${va} + ${vb} - 2.0 * (${va} * ${vb}) / ${vdd};`);
        }
        fixedNets.add(yNet);
      }
    }
  }

  for (const [netName, terms] of kclTerms) {
    if (fixedNets.has(netName) || terms.length === 0) continue;
    const expr = terms.join(" + ").replace(/\+ -/g, "- ");
    eqs.push(`  ${expr} = 0.0; // KCL at ${netName}`);
  }

  return [
    `model ${modelName} "Projected from EDIF 2.0.0 (${flat.topLibraryName}.${flat.topCellName})"`,
    ...decls,
    "equation",
    ...eqs,
    `end ${modelName};`,
    "",
  ].join("\n");
}
