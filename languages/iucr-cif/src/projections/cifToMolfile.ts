// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Projects an IUCr CIF crystal structure to MDL Molfile V2000 (`.mol`) format.
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
 * Projects a CIF document or `CrystalStructure` to MDL Molfile V2000 text.
 */
export function cifToMolfile(input: string | CifDocument | CifDataBlock | CrystalStructure): string {
  const sol = solveCrystalStructure(input);
  const { structure, metric, expandedAtoms, bonds } = sol;

  // Keep intra-cell bonds (imageShift === [0, 0, 0]) for molecular connectivity table
  const intraBonds = bonds.filter((b) => b.imageShift[0] === 0 && b.imageShift[1] === 0 && b.imageShift[2] === 0);

  const lines: string[] = [];
  lines.push(structure.name);
  lines.push("  ModelScript iucr-cif 3D");
  lines.push(`Crystal unit cell V=${metric.volume.toFixed(3)} A^3`);
  lines.push(
    `${padL(String(expandedAtoms.length), 3)}${padL(String(intraBonds.length), 3)}  0  0  0  0  0  0  0  0999 V2000`,
  );

  for (const atom of expandedAtoms) {
    const x = padL(atom.cart[0].toFixed(4), 10);
    const y = padL(atom.cart[1].toFixed(4), 10);
    const z = padL(atom.cart[2].toFixed(4), 10);
    const sym = padR(atom.symbol, 3);
    lines.push(`${x}${y}${z} ${sym} 0  0  0  0  0  0  0  0  0  0  0  0`);
  }

  for (const bond of intraBonds) {
    const a = padL(String(bond.atomA + 1), 3);
    const b = padL(String(bond.atomB + 1), 3);
    lines.push(`${a}${b}  1  0  0  0  0`);
  }

  lines.push("M  END");
  return lines.join("\n") + "\n";
}
