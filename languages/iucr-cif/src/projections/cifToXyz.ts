// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Projects an IUCr CIF crystal structure to extended Cartesian XYZ format.
 */

import { solveCrystalStructure } from "../solver/index.js";
import type { CifDataBlock, CifDocument, CrystalStructure } from "../types.js";

/**
 * Projects a CIF document or `CrystalStructure` to XYZ format with lattice metadata in the comment line.
 */
export function cifToXyz(input: string | CifDocument | CifDataBlock | CrystalStructure): string {
  const sol = solveCrystalStructure(input);
  const { structure, metric, expandedAtoms } = sol;
  const { M } = metric;

  // Extended XYZ Lattice="ax ay az bx by bz cx cy cz" (column vectors of M)
  const lattice = [M[0][0], M[1][0], M[2][0], M[0][1], M[1][1], M[2][1], M[0][2], M[1][2], M[2][2]]
    .map((v) => v.toFixed(6))
    .join(" ");

  const lines: string[] = [
    String(expandedAtoms.length),
    `${structure.name} Lattice="${lattice}" Volume=${metric.volume.toFixed(4)} Properties=species:S:1:pos:R:3`,
  ];

  for (const atom of expandedAtoms) {
    const sym = atom.symbol.padEnd(2, " ");
    const x = atom.cart[0].toFixed(6).padStart(12, " ");
    const y = atom.cart[1].toFixed(6).padStart(12, " ");
    const z = atom.cart[2].toFixed(6).padStart(12, " ");
    lines.push(`${sym} ${x} ${y} ${z}`);
  }

  return lines.join("\n") + "\n";
}
