// SPDX-License-Identifier: AGPL-3.0-or-later

import type { MolAtom, MolBond, MolfileDocument, MolRecord } from "../types.js";

const ORGANIC_SUBSET = new Set(["B", "C", "N", "O", "P", "S", "F", "Cl", "Br", "I"]);

function bondSymbol(order: number, fromAromatic: boolean, toAromatic: boolean): string {
  switch (order) {
    case 2:
      return "=";
    case 3:
      return "#";
    case 4:
      return fromAromatic && toAromatic ? "" : ":";
    default:
      return "";
  }
}

function formatRingDigit(num: number): string {
  return num >= 10 ? `%${num}` : String(num);
}

function formatAtomToken(atom: MolAtom, isAromatic: boolean): string {
  const sym = isAromatic && ORGANIC_SUBSET.has(atom.element) ? atom.element.toLowerCase() : atom.element;
  const needsBracket =
    !ORGANIC_SUBSET.has(atom.element) ||
    atom.charge !== 0 ||
    atom.isotope !== undefined ||
    atom.massDiff !== 0 ||
    atom.atomMap !== undefined;

  if (!needsBracket) return sym;

  let inner = "";
  if (atom.isotope !== undefined && atom.isotope > 0) {
    inner += String(atom.isotope);
  }
  inner += sym;
  if (atom.charge > 0) {
    inner += atom.charge === 1 ? "+" : `+${atom.charge}`;
  } else if (atom.charge < 0) {
    inner += atom.charge === -1 ? "-" : String(atom.charge);
  }
  if (atom.atomMap !== undefined && atom.atomMap > 0) {
    inner += `:${atom.atomMap}`;
  }
  return `[${inner}]`;
}

/**
 * Projects a single `MolRecord` into a canonical-style SMILES string via DFS spanning tree
 * with ring-closure numbering and branch parentheses.
 */
export function molRecordToSmiles(record: MolRecord): string {
  if (record.atoms.length === 0) return "";

  const atomByIdx = new Map<number, MolAtom>();
  for (const a of record.atoms) atomByIdx.set(a.index, a);

  const aromaticAtoms = new Set<number>();
  const adj = new Map<number, Array<{ neighbor: number; bond: MolBond }>>();
  for (const a of record.atoms) adj.set(a.index, []);

  for (const b of record.bonds) {
    if (!atomByIdx.has(b.atom1) || !atomByIdx.has(b.atom2) || b.atom1 === b.atom2) continue;
    adj.get(b.atom1)!.push({ neighbor: b.atom2, bond: b });
    adj.get(b.atom2)!.push({ neighbor: b.atom1, bond: b });
    if (b.order === 4) {
      aromaticAtoms.add(b.atom1);
      aromaticAtoms.add(b.atom2);
    }
  }

  const visited = new Set<number>();
  const componentSmiles: string[] = [];

  for (const startAtom of record.atoms) {
    if (visited.has(startAtom.index)) continue;

    // Pass 1: Build DFS spanning tree and identify back-edges (ring closures)
    const parent = new Map<number, number>();
    const treeChildren = new Map<number, Array<{ neighbor: number; bond: MolBond }>>();
    const ringClosures = new Map<number, Array<{ ringNum: number; bondSym: string }>>();
    const seenEdges = new Set<string>();
    let nextRingNum = 1;

    const dfsBuild = (u: number): void => {
      visited.add(u);
      treeChildren.set(u, []);
      for (const edge of adj.get(u) ?? []) {
        const v = edge.neighbor;
        const lo = Math.min(u, v);
        const hi = Math.max(u, v);
        const edgeKey = `${lo}:${hi}`;
        if (seenEdges.has(edgeKey)) continue;
        seenEdges.add(edgeKey);

        if (!visited.has(v)) {
          parent.set(v, u);
          treeChildren.get(u)!.push(edge);
          dfsBuild(v);
        } else {
          // Back-edge -> ring closure between u and v
          const ringNum = nextRingNum++;
          const sym = bondSymbol(edge.bond.order, aromaticAtoms.has(u), aromaticAtoms.has(v));
          if (!ringClosures.has(u)) ringClosures.set(u, []);
          if (!ringClosures.has(v)) ringClosures.set(v, []);
          ringClosures.get(u)!.push({ ringNum, bondSym: sym });
          ringClosures.get(v)!.push({ ringNum, bondSym: "" });
        }
      }
    };

    dfsBuild(startAtom.index);

    // Pass 2: Emit SMILES string along the spanning tree
    const emit = (u: number): string => {
      const atom = atomByIdx.get(u)!;
      let out = formatAtomToken(atom, aromaticAtoms.has(u));

      for (const rc of ringClosures.get(u) ?? []) {
        out += `${rc.bondSym}${formatRingDigit(rc.ringNum)}`;
      }

      const children = treeChildren.get(u) ?? [];
      for (let i = 0; i < children.length; i++) {
        const child = children[i]!;
        const bSym = bondSymbol(child.bond.order, aromaticAtoms.has(u), aromaticAtoms.has(child.neighbor));
        const sub = `${bSym}${emit(child.neighbor)}`;
        if (i < children.length - 1) {
          out += `(${sub})`;
        } else {
          out += sub;
        }
      }
      return out;
    };

    componentSmiles.push(emit(startAtom.index));
  }

  return componentSmiles.join(".");
}

function isMolfileDocument(input: MolfileDocument | MolRecord): input is MolfileDocument {
  return "records" in input && Array.isArray(input.records);
}

/**
 * Projects a `MolfileDocument` or `MolRecord` to SMILES (one line per record: `<SMILES> <Name>`).
 */
export function molfileToSmiles(input: MolfileDocument | MolRecord): string {
  if (isMolfileDocument(input)) {
    return input.records
      .map((rec) => {
        const smi = molRecordToSmiles(rec);
        return rec.name ? `${smi} ${rec.name}` : smi;
      })
      .join("\n");
  }
  return molRecordToSmiles(input);
}
