// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Projects an IUCr CIF crystal structure to RCSB PDB format (`HEADER`, `CRYST1`, `ATOM`, `CONECT`, `END`).
 */

import { solveCrystalStructure } from "../solver/index.js";
import type { CifDataBlock, CifDocument, CrystalStructure } from "../types.js";

function padL(s: string, width: number): string {
  return s.length >= width ? s.slice(0, width) : " ".repeat(width - s.length) + s;
}

function padR(s: string, width: number): string {
  return s.length >= width ? s.slice(0, width) : s + " ".repeat(width - s.length);
}

/**
 * Projects a CIF document or `CrystalStructure` to RCSB PDB text.
 */
export function cifToPdb(input: string | CifDocument | CifDataBlock | CrystalStructure): string {
  const sol = solveCrystalStructure(input);
  const { structure, expandedAtoms, bonds } = sol;
  const { a, b, c, alpha, beta, gamma } = structure.cell;
  const sg = (structure.spaceGroupName ?? "P 1").slice(0, 11);
  const z = structure.zFormulaUnits ?? Math.max(1, expandedAtoms.length);

  const lines: string[] = [];
  lines.push(`HEADER    CRYSTAL STRUCTURE                       ${padR(structure.name.toUpperCase(), 20)}`);
  lines.push(
    `CRYST1${padL(a.toFixed(3), 9)}${padL(b.toFixed(3), 9)}${padL(c.toFixed(3), 9)}` +
      `${padL(alpha.toFixed(2), 7)}${padL(beta.toFixed(2), 7)}${padL(gamma.toFixed(2), 7)} ` +
      `${padR(sg, 11)}${padL(String(Math.round(z)), 4)}`,
  );

  for (let i = 0; i < expandedAtoms.length; i++) {
    const atom = expandedAtoms[i]!;
    const serial = padL(String(i + 1), 5);
    const atomName = atom.label.length <= 3 ? ` ${padR(atom.label, 3)}` : padR(atom.label, 4);
    const x = padL(atom.cart[0].toFixed(3), 8);
    const y = padL(atom.cart[1].toFixed(3), 8);
    const zCoord = padL(atom.cart[2].toFixed(3), 8);
    const occ = padL(atom.occupancy.toFixed(2), 6);
    const temp = padL(atom.bIso.toFixed(2), 6);
    const elem = padL(atom.symbol.toUpperCase(), 2);
    lines.push(`HETATM${serial} ${atomName} CRY A   1    ${x}${y}${zCoord}${occ}${temp}          ${elem}`);
  }

  // Emit CONECT records for intra-cell bonds (imageShift = [0, 0, 0])
  const adj = new Map<number, number[]>();
  for (const bond of bonds) {
    if (bond.imageShift[0] !== 0 || bond.imageShift[1] !== 0 || bond.imageShift[2] !== 0) continue;
    const aIdx = bond.atomA + 1;
    const bIdx = bond.atomB + 1;
    const listA = adj.get(aIdx) ?? [];
    if (!listA.includes(bIdx)) listA.push(bIdx);
    adj.set(aIdx, listA);
    const listB = adj.get(bIdx) ?? [];
    if (!listB.includes(aIdx)) listB.push(aIdx);
    adj.set(bIdx, listB);
  }

  const sortedKeys = [...adj.keys()].sort((u, v) => u - v);
  for (const serial of sortedKeys) {
    const neighbors = adj.get(serial)!.sort((u, v) => u - v);
    for (let k = 0; k < neighbors.length; k += 4) {
      const chunk = neighbors
        .slice(k, k + 4)
        .map((n) => padL(String(n), 5))
        .join("");
      lines.push(`CONECT${padL(String(serial), 5)}${chunk}`);
    }
  }

  lines.push("END");
  return lines.join("\n") + "\n";
}
