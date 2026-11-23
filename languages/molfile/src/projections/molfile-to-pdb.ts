// SPDX-License-Identifier: AGPL-3.0-or-later

import type { MolfileDocument, MolRecord } from "../types.js";

export interface MolfileToPdbOptions {
  /** 3-character residue name for HETATM records (default: `"MOL"`). */
  residueName?: string | undefined;
  /** Single-character chain ID (default: `"A"`). */
  chainId?: string | undefined;
}

function padLeft(val: string | number, width: number): string {
  const s = String(val);
  return s.length >= width ? s.slice(0, width) : s.padStart(width, " ");
}

function padRight(val: string, width: number): string {
  return val.length >= width ? val.slice(0, width) : val.padEnd(width, " ");
}

function formatPdbCharge(charge: number): string {
  if (charge === 0) return "  ";
  const mag = Math.min(9, Math.abs(charge));
  return `${mag}${charge > 0 ? "+" : "-"}`;
}

/**
 * Projects a single `MolRecord` into Protein Data Bank (PDB v3.3) format
 * with `HEADER`, `TITLE`, fixed-width `HETATM` coordinate records, `CONECT` topology records, and `END`.
 */
export function molRecordToPdb(record: MolRecord, options?: MolfileToPdbOptions): string {
  const resName = padLeft((options?.residueName ?? "MOL").toUpperCase().slice(0, 3), 3);
  const chainId = (options?.chainId ?? "A").slice(0, 1);
  const lines: string[] = [];

  lines.push(`HEADER    SMALL MOLECULE                          01-JAN-79   MOLS`);
  lines.push(`TITLE     ${(record.name || record.id).toUpperCase().slice(0, 68)}`);

  // Count element occurrences for unique PDB atom names (e.g. C1, C2, O1)
  const elemCounters = new Map<string, number>();

  for (const atom of record.atoms) {
    const elUpper = atom.element.toUpperCase().slice(0, 2);
    const count = (elemCounters.get(elUpper) ?? 0) + 1;
    elemCounters.set(elUpper, count);

    const rawAtomName = `${elUpper}${count}`;
    const atomName =
      elUpper.length === 1 && rawAtomName.length < 4 ? ` ${padRight(rawAtomName, 3)}` : padRight(rawAtomName, 4);

    // PDB HETATM columns:
    //  1-6  "HETATM"
    //  7-11 serial (5d)
    // 13-16 atomName (4s)
    // 18-20 resName (3s)
    // 22    chainId (1s)
    // 23-26 resSeq (4d)
    // 31-38 x (8.3f)
    // 39-46 y (8.3f)
    // 47-54 z (8.3f)
    // 55-60 occupancy (6.2f)
    // 61-66 tempFactor (6.2f)
    // 77-78 element (2s right-justified)
    // 79-80 charge (2s)
    const line =
      "HETATM" +
      padLeft(atom.index, 5) +
      " " +
      atomName +
      " " +
      resName +
      " " +
      chainId +
      padLeft(1, 4) +
      "    " +
      padLeft(atom.x.toFixed(3), 8) +
      padLeft(atom.y.toFixed(3), 8) +
      padLeft(atom.z.toFixed(3), 8) +
      padLeft("1.00", 6) +
      padLeft("0.00", 6) +
      "          " +
      padLeft(elUpper, 2) +
      formatPdbCharge(atom.charge);

    lines.push(line);
  }

  // Build adjacency for CONECT records
  const neighbors = new Map<number, number[]>();
  for (const b of record.bonds) {
    if (b.atom1 === b.atom2) continue;
    if (!neighbors.has(b.atom1)) neighbors.set(b.atom1, []);
    if (!neighbors.has(b.atom2)) neighbors.set(b.atom2, []);
    neighbors.get(b.atom1)!.push(b.atom2);
    neighbors.get(b.atom2)!.push(b.atom1);
  }

  const sortedAtomIndices = [...neighbors.keys()].sort((a, b) => a - b);
  for (const aIdx of sortedAtomIndices) {
    const bonded = [...new Set(neighbors.get(aIdx)!)].sort((a, b) => a - b);
    // PDB CONECT lines hold at most 4 bonded atoms per line
    for (let i = 0; i < bonded.length; i += 4) {
      const chunk = bonded.slice(i, i + 4);
      const conect = "CONECT" + padLeft(aIdx, 5) + chunk.map((n) => padLeft(n, 5)).join("");
      lines.push(conect);
    }
  }

  lines.push("END");
  return lines.join("\n") + "\n";
}

function isMolfileDocument(input: MolfileDocument | MolRecord): input is MolfileDocument {
  return "records" in input && Array.isArray(input.records);
}

/**
 * Projects a `MolfileDocument` (single or multi-model SDF) or `MolRecord` into PDB format.
 */
export function molfileToPdb(input: MolfileDocument | MolRecord, options?: MolfileToPdbOptions): string {
  if (isMolfileDocument(input)) {
    if (input.records.length === 0) return "END\n";
    if (input.records.length === 1) {
      return molRecordToPdb(input.records[0]!, options);
    }
    const blocks: string[] = [];
    for (let i = 0; i < input.records.length; i++) {
      const rec = input.records[i]!;
      const body = molRecordToPdb(rec, options).replace(/\nEND\n$/, "");
      blocks.push(`MODEL     ${padLeft(i + 1, 4)}\n${body}\nENDMDL`);
    }
    return blocks.join("\n") + "\nEND\n";
  }
  return molRecordToPdb(input, options);
}
