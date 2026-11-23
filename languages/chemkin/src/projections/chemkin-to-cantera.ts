// SPDX-License-Identifier: AGPL-3.0-or-later

import { resolveSpeciesThermo } from "../solver/thermo.js";
import type { ChemkinDocument, ChemkinEnergyUnits } from "../types.js";

function mapCanteraActivationUnit(u: ChemkinEnergyUnits): string {
  switch (u) {
    case "CAL/MOLE":
      return "cal/mol";
    case "KCAL/MOLE":
      return "kcal/mol";
    case "JOULES/MOLE":
      return "J/mol";
    case "KJOULES/MOLE":
      return "kJ/mol";
    case "KELVINS":
      return "K";
    case "EVOLTS":
      return "eV";
  }
}

function formatNum(v: number): string {
  if (v === 0) return "0.0";
  const abs = Math.abs(v);
  if (abs >= 1e5 || abs < 1e-3) {
    return v.toExponential(6);
  }
  return Number.isInteger(v) ? `${v}.0` : String(v);
}

/**
 * Projects a parsed `ChemkinDocument` into Cantera YAML format.
 */
export function chemkinToCanteraYaml(doc: ChemkinDocument): string {
  const mech = doc.mechanism;
  const lines: string[] = [];

  lines.push(`description: |-`);
  lines.push(`  Projected from CHEMKIN mechanism '${mech.name}' by @modelscript/chemkin.`);
  lines.push("");
  lines.push("units:");
  lines.push("  length: cm");
  lines.push("  time: s");
  lines.push(`  quantity: ${mech.quantityUnits === "MOLECULES" ? "molec" : "mol"}`);
  lines.push(`  activation-energy: ${mapCanteraActivationUnit(mech.energyUnits)}`);
  lines.push("");

  const elements = Array.from(mech.elements.keys());
  const species = Array.from(mech.species.keys());

  lines.push("phases:");
  lines.push(`- name: ${mech.name || "gas"}`);
  lines.push("  thermo: ideal-gas");
  lines.push("  kinetics: gas");
  lines.push(`  elements: [${elements.join(", ")}]`);
  lines.push(`  species: [${species.join(", ")}]`);
  lines.push("  state: {T: 1000.0, P: 1 atm}");
  lines.push("");

  lines.push("species:");
  for (const spName of species) {
    const rec = resolveSpeciesThermo(mech, spName);
    lines.push(`- name: ${spName}`);
    if (rec) {
      const compEntries = Object.entries(rec.composition)
        .map(([el, cnt]) => `${el}: ${cnt}`)
        .join(", ");
      lines.push(`  composition: {${compEntries}}`);
      lines.push("  thermo:");
      lines.push("    model: NASA7");
      lines.push(`    temperature-ranges: [${formatNum(rec.tLow)}, ${formatNum(rec.tMid)}, ${formatNum(rec.tHigh)}]`);
      lines.push("    data:");
      lines.push(`    - [${rec.lowCoeffs.map(formatNum).join(", ")}]`);
      lines.push(`    - [${rec.highCoeffs.map(formatNum).join(", ")}]`);
    } else {
      lines.push("  composition: {}");
    }
  }
  lines.push("");

  lines.push("reactions:");
  for (const rxn of mech.reactions) {
    lines.push(`- equation: ${rxn.equation}`);
    if (rxn.plog && rxn.plog.length > 0) {
      lines.push("  type: pressure-dependent-Arrhenius");
      lines.push("  rate-constants:");
      for (const e of rxn.plog) {
        lines.push(
          `  - {P: ${formatNum(e.pressureAtm)} atm, A: ${formatNum(e.A)}, b: ${formatNum(e.b)}, Ea: ${formatNum(e.Ea)}}`,
        );
      }
    } else if (rxn.falloff && rxn.low) {
      lines.push("  type: falloff");
      lines.push(
        `  high-P-rate-constant: {A: ${formatNum(rxn.rate.A)}, b: ${formatNum(rxn.rate.b)}, Ea: ${formatNum(rxn.rate.Ea)}}`,
      );
      lines.push(
        `  low-P-rate-constant: {A: ${formatNum(rxn.low.A)}, b: ${formatNum(rxn.low.b)}, Ea: ${formatNum(rxn.low.Ea)}}`,
      );
      if (rxn.troe) {
        const parts = [`A: ${formatNum(rxn.troe.a)}`, `T3: ${formatNum(rxn.troe.T3)}`, `T1: ${formatNum(rxn.troe.T1)}`];
        if (rxn.troe.T2 !== undefined) parts.push(`T2: ${formatNum(rxn.troe.T2)}`);
        lines.push(`  Troe: {${parts.join(", ")}}`);
      } else if (rxn.sri) {
        const parts = [`A: ${formatNum(rxn.sri.a)}`, `B: ${formatNum(rxn.sri.b)}`, `C: ${formatNum(rxn.sri.c)}`];
        if (rxn.sri.d !== undefined) parts.push(`D: ${formatNum(rxn.sri.d)}`);
        if (rxn.sri.e !== undefined) parts.push(`E: ${formatNum(rxn.sri.e)}`);
        lines.push(`  SRI: {${parts.join(", ")}}`);
      }
    } else {
      if (rxn.thirdBody) {
        lines.push("  type: three-body");
      }
      lines.push(
        `  rate-constant: {A: ${formatNum(rxn.rate.A)}, b: ${formatNum(rxn.rate.b)}, Ea: ${formatNum(rxn.rate.Ea)}}`,
      );
    }

    const effKeys = Object.keys(rxn.efficiencies);
    if (effKeys.length > 0) {
      const effStr = effKeys.map((k) => `${k}: ${formatNum(rxn.efficiencies[k]!)}`).join(", ");
      lines.push(`  efficiencies: {${effStr}}`);
    }
    if (rxn.duplicate) {
      lines.push("  duplicate: true");
    }
  }

  lines.push("");
  return lines.join("\n");
}
