// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/smiles — Zero-Regex Character-by-Character Parser for SMILES/SMARTS & MDL Molfile V2000/SDF.
 *
 * Strictly zero RegExp / regex literals. Supports:
 * - Organic subset unbracketed atoms: B, C, N, O, P, S, F, Cl, Br, I
 * - Aromatic unbracketed atoms: b, c, n, o, p, s
 * - Bracketed atoms with isotopes, chirality, explicit hydrogens, formal charges, and atom maps: [13CH4], [NH4+], [O-], [C@H], [C@@H]
 * - Explicit & directional bonds: -, =, #, :, /, \
 * - Arbitrary nested branches (...) and disconnected fragments .
 * - Ring closures 1..9 and two-digit %10..%99
 * - Multi-line .smi / .smarts files and MDL Molfile V2000 / SDF ($$$$) records
 */

import type {
  BondOrder,
  BondStereo,
  ChiralTag,
  ConflictingRingBondRecord,
  MolecularFormat,
  MolecularGraph,
  MoleculeAtom,
  MoleculeBond,
  SmilesDocument,
  SmilesRange,
  UnbalancedParenRecord,
  UnclosedRingRecord,
} from "../types.js";

export interface ElementInfo {
  atomicNumber: number;
  symbol: string;
  name: string;
  atomicWeight: number; // IUPAC standard atomic weight [g/mol]
  monoisotopicMass: number; // Exact monoisotopic mass [Da]
  defaultValences: readonly number[]; // OpenSMILES neutral valence levels
  maxValence: number; // Maximum neutral covalent valence
}

export const PERIODIC_TABLE: readonly ElementInfo[] = [
  {
    atomicNumber: 1,
    symbol: "H",
    name: "Hydrogen",
    atomicWeight: 1.008,
    monoisotopicMass: 1.007825,
    defaultValences: [1],
    maxValence: 1,
  },
  {
    atomicNumber: 2,
    symbol: "He",
    name: "Helium",
    atomicWeight: 4.0026,
    monoisotopicMass: 4.002603,
    defaultValences: [0],
    maxValence: 0,
  },
  {
    atomicNumber: 3,
    symbol: "Li",
    name: "Lithium",
    atomicWeight: 6.94,
    monoisotopicMass: 7.016003,
    defaultValences: [1],
    maxValence: 1,
  },
  {
    atomicNumber: 4,
    symbol: "Be",
    name: "Beryllium",
    atomicWeight: 9.0122,
    monoisotopicMass: 9.012183,
    defaultValences: [2],
    maxValence: 2,
  },
  {
    atomicNumber: 5,
    symbol: "B",
    name: "Boron",
    atomicWeight: 10.81,
    monoisotopicMass: 11.009305,
    defaultValences: [3],
    maxValence: 3,
  },
  {
    atomicNumber: 6,
    symbol: "C",
    name: "Carbon",
    atomicWeight: 12.011,
    monoisotopicMass: 12.0,
    defaultValences: [4],
    maxValence: 4,
  },
  {
    atomicNumber: 7,
    symbol: "N",
    name: "Nitrogen",
    atomicWeight: 14.007,
    monoisotopicMass: 14.003074,
    defaultValences: [3, 5],
    maxValence: 5,
  },
  {
    atomicNumber: 8,
    symbol: "O",
    name: "Oxygen",
    atomicWeight: 15.999,
    monoisotopicMass: 15.994915,
    defaultValences: [2],
    maxValence: 2,
  },
  {
    atomicNumber: 9,
    symbol: "F",
    name: "Fluorine",
    atomicWeight: 18.998,
    monoisotopicMass: 18.998403,
    defaultValences: [1],
    maxValence: 1,
  },
  {
    atomicNumber: 10,
    symbol: "Ne",
    name: "Neon",
    atomicWeight: 20.18,
    monoisotopicMass: 19.99244,
    defaultValences: [0],
    maxValence: 0,
  },
  {
    atomicNumber: 11,
    symbol: "Na",
    name: "Sodium",
    atomicWeight: 22.99,
    monoisotopicMass: 22.989769,
    defaultValences: [1],
    maxValence: 1,
  },
  {
    atomicNumber: 12,
    symbol: "Mg",
    name: "Magnesium",
    atomicWeight: 24.305,
    monoisotopicMass: 23.985042,
    defaultValences: [2],
    maxValence: 2,
  },
  {
    atomicNumber: 13,
    symbol: "Al",
    name: "Aluminium",
    atomicWeight: 26.982,
    monoisotopicMass: 26.981538,
    defaultValences: [3],
    maxValence: 3,
  },
  {
    atomicNumber: 14,
    symbol: "Si",
    name: "Silicon",
    atomicWeight: 28.085,
    monoisotopicMass: 27.976927,
    defaultValences: [4],
    maxValence: 4,
  },
  {
    atomicNumber: 15,
    symbol: "P",
    name: "Phosphorus",
    atomicWeight: 30.974,
    monoisotopicMass: 30.973762,
    defaultValences: [3, 5],
    maxValence: 5,
  },
  {
    atomicNumber: 16,
    symbol: "S",
    name: "Sulfur",
    atomicWeight: 32.06,
    monoisotopicMass: 31.972071,
    defaultValences: [2, 4, 6],
    maxValence: 6,
  },
  {
    atomicNumber: 17,
    symbol: "Cl",
    name: "Chlorine",
    atomicWeight: 35.45,
    monoisotopicMass: 34.968853,
    defaultValences: [1, 3, 5, 7],
    maxValence: 7,
  },
  {
    atomicNumber: 18,
    symbol: "Ar",
    name: "Argon",
    atomicWeight: 39.948,
    monoisotopicMass: 39.962383,
    defaultValences: [0],
    maxValence: 0,
  },
  {
    atomicNumber: 19,
    symbol: "K",
    name: "Potassium",
    atomicWeight: 39.098,
    monoisotopicMass: 38.963707,
    defaultValences: [1],
    maxValence: 1,
  },
  {
    atomicNumber: 20,
    symbol: "Ca",
    name: "Calcium",
    atomicWeight: 40.078,
    monoisotopicMass: 39.962591,
    defaultValences: [2],
    maxValence: 2,
  },
  {
    atomicNumber: 21,
    symbol: "Sc",
    name: "Scandium",
    atomicWeight: 44.956,
    monoisotopicMass: 44.95591,
    defaultValences: [3],
    maxValence: 3,
  },
  {
    atomicNumber: 22,
    symbol: "Ti",
    name: "Titanium",
    atomicWeight: 47.867,
    monoisotopicMass: 47.947947,
    defaultValences: [4],
    maxValence: 4,
  },
  {
    atomicNumber: 23,
    symbol: "V",
    name: "Vanadium",
    atomicWeight: 50.942,
    monoisotopicMass: 50.94396,
    defaultValences: [5],
    maxValence: 5,
  },
  {
    atomicNumber: 24,
    symbol: "Cr",
    name: "Chromium",
    atomicWeight: 51.996,
    monoisotopicMass: 51.94051,
    defaultValences: [3, 6],
    maxValence: 6,
  },
  {
    atomicNumber: 25,
    symbol: "Mn",
    name: "Manganese",
    atomicWeight: 54.938,
    monoisotopicMass: 54.938045,
    defaultValences: [2, 4, 7],
    maxValence: 7,
  },
  {
    atomicNumber: 26,
    symbol: "Fe",
    name: "Iron",
    atomicWeight: 55.845,
    monoisotopicMass: 55.93494,
    defaultValences: [2, 3],
    maxValence: 6,
  },
  {
    atomicNumber: 27,
    symbol: "Co",
    name: "Cobalt",
    atomicWeight: 58.933,
    monoisotopicMass: 58.933195,
    defaultValences: [2, 3],
    maxValence: 6,
  },
  {
    atomicNumber: 28,
    symbol: "Ni",
    name: "Nickel",
    atomicWeight: 58.693,
    monoisotopicMass: 57.935343,
    defaultValences: [2],
    maxValence: 4,
  },
  {
    atomicNumber: 29,
    symbol: "Cu",
    name: "Copper",
    atomicWeight: 63.546,
    monoisotopicMass: 62.929598,
    defaultValences: [1, 2],
    maxValence: 4,
  },
  {
    atomicNumber: 30,
    symbol: "Zn",
    name: "Zinc",
    atomicWeight: 65.38,
    monoisotopicMass: 63.929142,
    defaultValences: [2],
    maxValence: 2,
  },
  {
    atomicNumber: 31,
    symbol: "Ga",
    name: "Gallium",
    atomicWeight: 69.723,
    monoisotopicMass: 68.925574,
    defaultValences: [3],
    maxValence: 3,
  },
  {
    atomicNumber: 32,
    symbol: "Ge",
    name: "Germanium",
    atomicWeight: 72.63,
    monoisotopicMass: 73.921178,
    defaultValences: [4],
    maxValence: 4,
  },
  {
    atomicNumber: 33,
    symbol: "As",
    name: "Arsenic",
    atomicWeight: 74.922,
    monoisotopicMass: 74.921595,
    defaultValences: [3, 5],
    maxValence: 5,
  },
  {
    atomicNumber: 34,
    symbol: "Se",
    name: "Selenium",
    atomicWeight: 78.971,
    monoisotopicMass: 79.916521,
    defaultValences: [2, 4, 6],
    maxValence: 6,
  },
  {
    atomicNumber: 35,
    symbol: "Br",
    name: "Bromine",
    atomicWeight: 79.904,
    monoisotopicMass: 78.918337,
    defaultValences: [1, 3, 5, 7],
    maxValence: 7,
  },
  {
    atomicNumber: 36,
    symbol: "Kr",
    name: "Krypton",
    atomicWeight: 83.798,
    monoisotopicMass: 83.911507,
    defaultValences: [0],
    maxValence: 2,
  },
  {
    atomicNumber: 37,
    symbol: "Rb",
    name: "Rubidium",
    atomicWeight: 85.468,
    monoisotopicMass: 84.91179,
    defaultValences: [1],
    maxValence: 1,
  },
  {
    atomicNumber: 38,
    symbol: "Sr",
    name: "Strontium",
    atomicWeight: 87.62,
    monoisotopicMass: 87.905612,
    defaultValences: [2],
    maxValence: 2,
  },
  {
    atomicNumber: 46,
    symbol: "Pd",
    name: "Palladium",
    atomicWeight: 106.42,
    monoisotopicMass: 105.90348,
    defaultValences: [2, 4],
    maxValence: 4,
  },
  {
    atomicNumber: 47,
    symbol: "Ag",
    name: "Silver",
    atomicWeight: 107.868,
    monoisotopicMass: 106.90509,
    defaultValences: [1],
    maxValence: 3,
  },
  {
    atomicNumber: 48,
    symbol: "Cd",
    name: "Cadmium",
    atomicWeight: 112.414,
    monoisotopicMass: 113.90336,
    defaultValences: [2],
    maxValence: 2,
  },
  {
    atomicNumber: 50,
    symbol: "Sn",
    name: "Tin",
    atomicWeight: 118.71,
    monoisotopicMass: 119.9022,
    defaultValences: [2, 4],
    maxValence: 4,
  },
  {
    atomicNumber: 51,
    symbol: "Sb",
    name: "Antimony",
    atomicWeight: 121.76,
    monoisotopicMass: 120.90381,
    defaultValences: [3, 5],
    maxValence: 5,
  },
  {
    atomicNumber: 52,
    symbol: "Te",
    name: "Tellurium",
    atomicWeight: 127.6,
    monoisotopicMass: 129.90622,
    defaultValences: [2, 4, 6],
    maxValence: 6,
  },
  {
    atomicNumber: 53,
    symbol: "I",
    name: "Iodine",
    atomicWeight: 126.904,
    monoisotopicMass: 126.90447,
    defaultValences: [1, 3, 5, 7],
    maxValence: 7,
  },
  {
    atomicNumber: 54,
    symbol: "Xe",
    name: "Xenon",
    atomicWeight: 131.293,
    monoisotopicMass: 131.90415,
    defaultValences: [0],
    maxValence: 8,
  },
  {
    atomicNumber: 55,
    symbol: "Cs",
    name: "Cesium",
    atomicWeight: 132.905,
    monoisotopicMass: 132.90545,
    defaultValences: [1],
    maxValence: 1,
  },
  {
    atomicNumber: 56,
    symbol: "Ba",
    name: "Barium",
    atomicWeight: 137.327,
    monoisotopicMass: 137.90524,
    defaultValences: [2],
    maxValence: 2,
  },
  {
    atomicNumber: 78,
    symbol: "Pt",
    name: "Platinum",
    atomicWeight: 195.084,
    monoisotopicMass: 194.96479,
    defaultValences: [2, 4],
    maxValence: 6,
  },
  {
    atomicNumber: 79,
    symbol: "Au",
    name: "Gold",
    atomicWeight: 196.967,
    monoisotopicMass: 196.96657,
    defaultValences: [1, 3],
    maxValence: 5,
  },
  {
    atomicNumber: 80,
    symbol: "Hg",
    name: "Mercury",
    atomicWeight: 200.592,
    monoisotopicMass: 201.97064,
    defaultValences: [1, 2],
    maxValence: 2,
  },
  {
    atomicNumber: 82,
    symbol: "Pb",
    name: "Lead",
    atomicWeight: 207.2,
    monoisotopicMass: 207.97665,
    defaultValences: [2, 4],
    maxValence: 4,
  },
  {
    atomicNumber: 83,
    symbol: "Bi",
    name: "Bismuth",
    atomicWeight: 208.98,
    monoisotopicMass: 208.9804,
    defaultValences: [3, 5],
    maxValence: 5,
  },
];

export const ELEMENT_BY_SYMBOL = new Map<string, ElementInfo>(PERIODIC_TABLE.map((el) => [el.symbol, el]));

export const ELEMENT_BY_ATOMIC_NUMBER = new Map<number, ElementInfo>(PERIODIC_TABLE.map((el) => [el.atomicNumber, el]));

export function getElementInfo(symbol: string): ElementInfo | undefined {
  return ELEMENT_BY_SYMBOL.get(symbol);
}

export function getMaxAllowedValence(element: string, formalCharge: number): number {
  switch (element) {
    case "H":
      return Math.max(0, 1 - formalCharge);
    case "He":
    case "Ne":
    case "Ar":
      return 0;
    case "B":
      return formalCharge < 0 ? 4 : 3;
    case "C":
      return 4 - Math.abs(formalCharge);
    case "N":
      return formalCharge > 0 ? 4 : 5;
    case "O":
      return formalCharge > 0 ? 3 : 2;
    case "F":
      return formalCharge > 0 ? 2 : 1;
    case "P":
      return 5;
    case "S":
      return 6;
    case "Cl":
    case "Br":
    case "I":
      return 7;
    default: {
      const info = ELEMENT_BY_SYMBOL.get(element);
      return info ? info.maxValence : 8;
    }
  }
}

// --- Zero-Regex Character Helpers ---

function isDigitChar(ch: string | undefined): boolean {
  if (!ch || ch.length === 0) return false;
  const code = ch.charCodeAt(0);
  return code >= 48 && code <= 57; // '0'..'9'
}

function isUpperAlphaChar(ch: string | undefined): boolean {
  if (!ch || ch.length === 0) return false;
  const code = ch.charCodeAt(0);
  return code >= 65 && code <= 90; // 'A'..'Z'
}

function isLowerAlphaChar(ch: string | undefined): boolean {
  if (!ch || ch.length === 0) return false;
  const code = ch.charCodeAt(0);
  return code >= 97 && code <= 122; // 'a'..'z'
}

function isWhitespaceChar(ch: string | undefined): boolean {
  if (!ch || ch.length === 0) return false;
  const code = ch.charCodeAt(0);
  return code === 32 || code === 9 || code === 10 || code === 13;
}

function isAromaticOrganicLower(ch: string | undefined): boolean {
  return ch === "b" || ch === "c" || ch === "n" || ch === "o" || ch === "p" || ch === "s";
}

function isAliphaticOrganicSingle(ch: string | undefined): boolean {
  return ch === "B" || ch === "C" || ch === "N" || ch === "O" || ch === "P" || ch === "S" || ch === "F" || ch === "I";
}

export function splitLinesZeroRegex(text: string): string[] {
  const lines: string[] = [];
  let start = 0;
  const n = text.length;
  for (let i = 0; i < n; i++) {
    const ch = text[i];
    if (ch === "\n") {
      const end = i > start && text[i - 1] === "\r" ? i - 1 : i;
      lines.push(text.slice(start, end));
      start = i + 1;
    }
  }
  if (start <= n) {
    const end = n > start && text[n - 1] === "\r" ? n - 1 : n;
    lines.push(text.slice(start, end));
  }
  return lines;
}

export function splitWhitespaceTokensZeroRegex(line: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  const n = line.length;
  while (i < n) {
    while (i < n && isWhitespaceChar(line[i])) i++;
    if (i >= n) break;
    const start = i;
    while (i < n && !isWhitespaceChar(line[i])) i++;
    tokens.push(line.slice(start, i));
  }
  return tokens;
}

function sanitizeIdentifierZeroRegex(raw: string): string {
  let out = "";
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (isUpperAlphaChar(ch) || isLowerAlphaChar(ch) || isDigitChar(ch) || ch === "_") {
      out += ch;
    } else {
      out += "_";
    }
  }
  if (out.length === 0) return "Molecule";
  if (isDigitChar(out[0])) return `M_${out}`;
  return out;
}

interface PendingBondSpec {
  order: BondOrder;
  isAromatic: boolean;
  stereo: BondStereo;
  explicit: boolean;
  offset: number;
}

interface OpenRingEntry {
  atomIndex: number;
  explicitOrder?: BondOrder | undefined;
  stereo: BondStereo;
  isAromatic?: boolean | undefined;
  offset: number;
}

/**
 * Computes implicit hydrogen counts on all unbracketed organic-subset atoms
 * according to OpenSMILES valence rules.
 */
export function computeImplicitHydrogens(mol: MolecularGraph): void {
  const adjBonds = new Map<number, MoleculeBond[]>();
  for (const atom of mol.atoms) {
    adjBonds.set(atom.index, []);
  }
  for (const bond of mol.bonds) {
    if (bond.source === bond.target) continue;
    adjBonds.get(bond.source)?.push(bond);
    adjBonds.get(bond.target)?.push(bond);
  }

  for (const atom of mol.atoms) {
    if (atom.isBracketed) {
      atom.implicitHydrogens = 0;
      continue;
    }

    const incident = adjBonds.get(atom.index) ?? [];
    if (atom.isAromatic) {
      let aromaticCount = 0;
      let exocyclicOrder = 0;
      for (const b of incident) {
        if (b.isAromatic) {
          aromaticCount++;
        } else {
          exocyclicOrder += b.order;
        }
      }

      if (atom.element === "C") {
        // In an aromatic ring:
        // - 2 aromatic bonds + 0 exocyclic bonds => =CH- (Kekule sum 3) => 1 implicit H
        // - 2 aromatic bonds + >=1 exocyclic bond => =C(R)- or -C(=O)- => 0 implicit H
        // - 3 aromatic bonds (bridgehead) => 0 implicit H
        if (aromaticCount === 2 && exocyclicOrder === 0) {
          atom.implicitHydrogens = 1;
        } else {
          atom.implicitHydrogens = 0;
        }
      } else if (atom.element === "B") {
        atom.implicitHydrogens = aromaticCount === 2 && exocyclicOrder === 0 ? 1 : 0;
      } else {
        // Unbracketed aromatic n, o, s, p have 0 implicit hydrogens (pyrrolic NH is written [nH])
        atom.implicitHydrogens = 0;
      }
      continue;
    }

    // Aliphatic unbracketed atom
    let bondOrderSum = 0;
    for (const b of incident) {
      bondOrderSum += b.isAromatic ? 1.5 : b.order;
    }
    const roundedBondSum = Math.round(bondOrderSum);
    const info = ELEMENT_BY_SYMBOL.get(atom.element);
    if (!info || info.defaultValences.length === 0) {
      atom.implicitHydrogens = 0;
      continue;
    }

    const effectiveTargetShift = atom.formalCharge;
    let targetValence: number | undefined;
    for (const v of info.defaultValences) {
      const adjusted = v + effectiveTargetShift;
      if (adjusted >= roundedBondSum) {
        targetValence = adjusted;
        break;
      }
    }
    if (targetValence === undefined) {
      atom.implicitHydrogens = 0;
    } else {
      atom.implicitHydrogens = Math.max(0, targetValence - roundedBondSum);
    }
  }
}

/**
 * Parses a single SMILES or SMARTS line (`<SMILES> [Name]`) into a `MolecularGraph`.
 */
export function parseSmiles(
  smilesInput: string,
  explicitName?: string,
  lineNumber = 1,
  lineStartOffset = 0,
): MolecularGraph {
  let startIdx = 0;
  const totalLen = smilesInput.length;
  while (startIdx < totalLen && isWhitespaceChar(smilesInput[startIdx])) {
    startIdx++;
  }
  let endIdx = totalLen;
  while (endIdx > startIdx && isWhitespaceChar(smilesInput[endIdx - 1])) {
    endIdx--;
  }

  const trimmed = smilesInput.slice(startIdx, endIdx);
  if (trimmed.length === 0) {
    const emptyName = explicitName ?? "EmptyMolecule";
    return {
      id: sanitizeIdentifierZeroRegex(emptyName),
      name: emptyName,
      smiles: "",
      format: "smiles",
      atoms: [],
      bonds: [],
      properties: new Map(),
      range: {
        startLine: lineNumber,
        startColumn: 1,
        endLine: lineNumber,
        endColumn: 1,
        startOffset: lineStartOffset,
        endOffset: lineStartOffset,
      },
    };
  }

  // Separate SMILES token from optional trailing molecule name
  let smilesEnd = 0;
  while (smilesEnd < trimmed.length && !isWhitespaceChar(trimmed[smilesEnd])) {
    smilesEnd++;
  }
  const smilesStr = trimmed.slice(0, smilesEnd);
  let trailingName = "";
  if (smilesEnd < trimmed.length) {
    let nameStart = smilesEnd;
    while (nameStart < trimmed.length && isWhitespaceChar(trimmed[nameStart])) {
      nameStart++;
    }
    trailingName = trimmed.slice(nameStart);
  }

  const molName = explicitName ?? (trailingName.length > 0 ? trailingName : smilesStr);
  const molId = sanitizeIdentifierZeroRegex(trailingName.length > 0 ? trailingName : (explicitName ?? "Molecule_1"));

  const atoms: MoleculeAtom[] = [];
  const bonds: MoleculeBond[] = [];
  const unclosedRings: UnclosedRingRecord[] = [];
  const conflictingRingBonds: ConflictingRingBondRecord[] = [];
  const unbalancedParentheses: UnbalancedParenRecord[] = [];
  const openRings = new Map<number, OpenRingEntry>();
  const branchStack: { atomIndex: number | null; offset: number }[] = [];

  let currentAtomIndex: number | null = null;
  let pendingBond: PendingBondSpec | null = null;
  let isSmartsFormat = false;

  const makeRange = (relStart: number, relEnd: number): SmilesRange => ({
    startLine: lineNumber,
    startColumn: startIdx + relStart + 1,
    endLine: lineNumber,
    endColumn: startIdx + relEnd + 1,
    startOffset: lineStartOffset + startIdx + relStart,
    endOffset: lineStartOffset + startIdx + relEnd,
  });

  const appendAtom = (atom: MoleculeAtom): void => {
    const newAtomIdx = atoms.length;
    atom.index = newAtomIdx;
    atoms.push(atom);

    if (currentAtomIndex !== null) {
      const prevAtom = atoms[currentAtomIndex];
      const bothAromatic = Boolean(prevAtom?.isAromatic && atom.isAromatic);
      const order: BondOrder = pendingBond ? pendingBond.order : bothAromatic ? 1.5 : 1;
      const isAromatic = pendingBond ? pendingBond.isAromatic : bothAromatic;
      const stereo: BondStereo = pendingBond ? pendingBond.stereo : "none";

      bonds.push({
        index: bonds.length,
        source: currentAtomIndex,
        target: newAtomIdx,
        order,
        isAromatic,
        stereo,
        range: atom.range,
      });
    }
    currentAtomIndex = newAtomIdx;
    pendingBond = null;
  };

  let pos = 0;
  const n = smilesStr.length;

  while (pos < n) {
    const ch = smilesStr[pos];
    if (!ch) {
      pos++;
      continue;
    }

    // 1. Branch open '('
    if (ch === "(") {
      if (currentAtomIndex === null) {
        unbalancedParentheses.push({
          kind: "unclosed",
          offset: pos,
          range: makeRange(pos, pos + 1),
        });
      }
      branchStack.push({ atomIndex: currentAtomIndex, offset: pos });
      pos++;
      continue;
    }

    // 2. Branch close ')'
    if (ch === ")") {
      if (branchStack.length === 0) {
        unbalancedParentheses.push({
          kind: "unexpected_close",
          offset: pos,
          range: makeRange(pos, pos + 1),
        });
      } else {
        const popped = branchStack.pop();
        if (popped && popped.atomIndex !== null) {
          currentAtomIndex = popped.atomIndex;
        }
      }
      pendingBond = null;
      pos++;
      continue;
    }

    // 3. Disconnected fragment '.'
    if (ch === ".") {
      currentAtomIndex = null;
      pendingBond = null;
      pos++;
      continue;
    }

    // 4. Explicit bond tokens
    if (ch === "-" || ch === "=" || ch === "#" || ch === ":" || ch === "/" || ch === "\\" || ch === "~") {
      if (ch === "~") isSmartsFormat = true;
      const order: BondOrder = ch === "=" ? 2 : ch === "#" ? 3 : ch === ":" ? 1.5 : 1;
      const isAromatic = ch === ":";
      const stereo: BondStereo = ch === "/" ? "/" : ch === "\\" ? "\\" : "none";
      pendingBond = {
        order,
        isAromatic,
        stereo,
        explicit: true,
        offset: pos,
      };
      pos++;
      continue;
    }

    // 5. Ring closure: digit 0..9 or %10..%99
    if (isDigitChar(ch) || ch === "%") {
      const ringStart = pos;
      let ringId = 0;
      if (ch === "%") {
        pos++;
        let numStr = "";
        while (pos < n && isDigitChar(smilesStr[pos]) && numStr.length < 2) {
          numStr += smilesStr[pos];
          pos++;
        }
        ringId = numStr.length > 0 ? Number(numStr) : 0;
      } else {
        ringId = ch.charCodeAt(0) - 48;
        pos++;
      }

      const ringRange = makeRange(ringStart, pos);
      const bondSpec = pendingBond;
      pendingBond = null;

      if (currentAtomIndex !== null) {
        const existingOpen = openRings.get(ringId);
        if (existingOpen !== undefined) {
          openRings.delete(ringId);

          if (
            existingOpen.explicitOrder !== undefined &&
            bondSpec?.explicit &&
            existingOpen.explicitOrder !== bondSpec.order
          ) {
            conflictingRingBonds.push({
              ringId,
              openAtomIndex: existingOpen.atomIndex,
              closeAtomIndex: currentAtomIndex,
              openOrder: existingOpen.explicitOrder,
              closeOrder: bondSpec.order,
              range: ringRange,
            });
          }

          const openAtom = atoms[existingOpen.atomIndex];
          const closeAtom = atoms[currentAtomIndex];
          const bothArom = Boolean(openAtom?.isAromatic && closeAtom?.isAromatic);

          const order: BondOrder = bondSpec?.explicit
            ? bondSpec.order
            : existingOpen.explicitOrder !== undefined
              ? existingOpen.explicitOrder
              : bothArom
                ? 1.5
                : 1;
          const isAromatic = order === 1.5 || Boolean(bondSpec?.isAromatic || existingOpen.isAromatic);
          const stereo: BondStereo = bondSpec && bondSpec.stereo !== "none" ? bondSpec.stereo : existingOpen.stereo;

          bonds.push({
            index: bonds.length,
            source: existingOpen.atomIndex,
            target: currentAtomIndex,
            order,
            isAromatic,
            stereo,
            isRingClosure: true,
            ringId,
            range: ringRange,
          });
        } else {
          openRings.set(ringId, {
            atomIndex: currentAtomIndex,
            explicitOrder: bondSpec?.explicit ? bondSpec.order : undefined,
            stereo: bondSpec?.stereo ?? "none",
            isAromatic: bondSpec?.isAromatic,
            offset: ringStart,
          });
        }
      }
      continue;
    }

    // 6. Bracketed atom [...]
    if (ch === "[") {
      const bracketStart = pos;
      pos++; // skip '['
      let isotope: number | undefined;
      let rawSymbol = "";
      let element = "";
      let isAromatic = false;
      let chiralTag: ChiralTag = "none";
      let explicitHydrogens = 0;
      let formalCharge = 0;
      let atomMapNumber: number | undefined;

      // Optional leading isotope digits
      if (pos < n && isDigitChar(smilesStr[pos])) {
        let isoStr = "";
        while (pos < n && isDigitChar(smilesStr[pos])) {
          isoStr += smilesStr[pos];
          pos++;
        }
        isotope = Number(isoStr);
      }

      // SMARTS atomic number query [#6]
      if (pos < n && smilesStr[pos] === "#") {
        isSmartsFormat = true;
        pos++;
        let zStr = "";
        while (pos < n && isDigitChar(smilesStr[pos])) {
          zStr += smilesStr[pos];
          pos++;
        }
        const zNum = Number(zStr);
        const elByZ = ELEMENT_BY_ATOMIC_NUMBER.get(zNum);
        element = elByZ ? elByZ.symbol : "C";
        rawSymbol = `#${zStr}`;
      } else if (pos < n && smilesStr[pos] === "*") {
        isSmartsFormat = true;
        rawSymbol = "*";
        element = "*";
        pos++;
      } else if (pos < n && isLowerAlphaChar(smilesStr[pos])) {
        // Aromatic symbol inside brackets: [c], [nH], [se], [as], [o+]
        const first = smilesStr[pos]!;
        const second = smilesStr[pos + 1];
        if ((first === "s" && second === "e") || (first === "a" && second === "s")) {
          rawSymbol = first + second;
          element = first.toUpperCase() + second;
          pos += 2;
        } else {
          rawSymbol = first;
          element = first.toUpperCase();
          pos += 1;
        }
        isAromatic = true;
      } else if (pos < n && isUpperAlphaChar(smilesStr[pos])) {
        const first = smilesStr[pos]!;
        const second = smilesStr[pos + 1];
        if (second && isLowerAlphaChar(second)) {
          rawSymbol = first + second;
          element = rawSymbol;
          pos += 2;
        } else {
          rawSymbol = first;
          element = first;
          pos += 1;
        }
      }

      // Parse modifiers up to ']'
      while (pos < n && smilesStr[pos] !== "]") {
        const mCh = smilesStr[pos]!;
        if (mCh === "@") {
          if (smilesStr[pos + 1] === "@") {
            chiralTag = "@@";
            pos += 2;
          } else {
            chiralTag = "@";
            pos += 1;
          }
          // Skip optional extended chiral class like TH1, AL1
          if (pos + 1 < n && isUpperAlphaChar(smilesStr[pos]) && isUpperAlphaChar(smilesStr[pos + 1])) {
            pos += 2;
            while (pos < n && isDigitChar(smilesStr[pos])) pos++;
          }
          continue;
        }

        if (mCh === "H") {
          pos++;
          if (pos < n && isDigitChar(smilesStr[pos])) {
            let hStr = "";
            while (pos < n && isDigitChar(smilesStr[pos])) {
              hStr += smilesStr[pos];
              pos++;
            }
            explicitHydrogens += Number(hStr);
          } else {
            explicitHydrogens += 1;
          }
          continue;
        }

        if (mCh === "+" || mCh === "-") {
          const sign = mCh === "+" ? 1 : -1;
          pos++;
          if (pos < n && isDigitChar(smilesStr[pos])) {
            let cStr = "";
            while (pos < n && isDigitChar(smilesStr[pos])) {
              cStr += smilesStr[pos];
              pos++;
            }
            formalCharge += sign * Number(cStr);
          } else {
            let count = 1;
            while (pos < n && smilesStr[pos] === mCh) {
              count++;
              pos++;
            }
            formalCharge += sign * count;
          }
          continue;
        }

        if (mCh === ":") {
          pos++;
          let mapStr = "";
          while (pos < n && isDigitChar(smilesStr[pos])) {
            mapStr += smilesStr[pos];
            pos++;
          }
          if (mapStr.length > 0) {
            atomMapNumber = Number(mapStr);
          }
          continue;
        }

        if (mCh === ";" || mCh === "," || mCh === "!" || mCh === "&") {
          isSmartsFormat = true;
        }
        pos++;
      }

      if (pos < n && smilesStr[pos] === "]") {
        pos++;
      }

      const elInfo = ELEMENT_BY_SYMBOL.get(element);
      const atomicNumber = element === "*" ? 6 : (elInfo?.atomicNumber ?? 0);

      appendAtom({
        index: 0,
        element: element || "Unknown",
        rawSymbol: rawSymbol || element,
        atomicNumber,
        isotope,
        formalCharge,
        chiralTag,
        explicitHydrogens,
        implicitHydrogens: 0,
        isAromatic,
        isBracketed: true,
        atomMapNumber,
        range: makeRange(bracketStart, pos),
      });
      continue;
    }

    // 7. Wildcard '*'
    if (ch === "*") {
      isSmartsFormat = true;
      appendAtom({
        index: 0,
        element: "C",
        rawSymbol: "*",
        atomicNumber: 6,
        formalCharge: 0,
        chiralTag: "none",
        implicitHydrogens: 0,
        isAromatic: false,
        isBracketed: false,
        range: makeRange(pos, pos + 1),
      });
      pos++;
      continue;
    }

    // 8. Two-letter unbracketed organic subset: Cl, Br
    const nextCh = smilesStr[pos + 1];
    if ((ch === "C" && nextCh === "l") || (ch === "B" && nextCh === "r")) {
      const sym = ch + nextCh;
      const info = ELEMENT_BY_SYMBOL.get(sym)!;
      appendAtom({
        index: 0,
        element: sym,
        rawSymbol: sym,
        atomicNumber: info.atomicNumber,
        formalCharge: 0,
        chiralTag: "none",
        implicitHydrogens: 0,
        isAromatic: false,
        isBracketed: false,
        range: makeRange(pos, pos + 2),
      });
      pos += 2;
      continue;
    }

    // 9. Single-letter aromatic organic subset: b, c, n, o, p, s
    if (isAromaticOrganicLower(ch)) {
      const sym = ch.toUpperCase();
      const info = ELEMENT_BY_SYMBOL.get(sym)!;
      appendAtom({
        index: 0,
        element: sym,
        rawSymbol: ch,
        atomicNumber: info.atomicNumber,
        formalCharge: 0,
        chiralTag: "none",
        implicitHydrogens: 0,
        isAromatic: true,
        isBracketed: false,
        range: makeRange(pos, pos + 1),
      });
      pos++;
      continue;
    }

    // 10. Single-letter aliphatic organic subset: B, C, N, O, P, S, F, I (or H)
    if (isAliphaticOrganicSingle(ch) || ch === "H") {
      const info = ELEMENT_BY_SYMBOL.get(ch)!;
      appendAtom({
        index: 0,
        element: ch,
        rawSymbol: ch,
        atomicNumber: info.atomicNumber,
        formalCharge: 0,
        chiralTag: "none",
        implicitHydrogens: 0,
        isAromatic: false,
        isBracketed: false,
        range: makeRange(pos, pos + 1),
      });
      pos++;
      continue;
    }

    // 11. Any other alphabetic symbol (e.g. unbracketed unknown element symbol like Q, X, Zz)
    if (isUpperAlphaChar(ch) || isLowerAlphaChar(ch)) {
      const symStart = pos;
      let sym = ch;
      pos++;
      if (
        isUpperAlphaChar(ch) &&
        pos < n &&
        isLowerAlphaChar(smilesStr[pos]) &&
        !isAromaticOrganicLower(smilesStr[pos])
      ) {
        sym += smilesStr[pos]!;
        pos++;
      }
      const info = ELEMENT_BY_SYMBOL.get(sym);
      appendAtom({
        index: 0,
        element: sym,
        rawSymbol: sym,
        atomicNumber: info?.atomicNumber ?? 0,
        formalCharge: 0,
        chiralTag: "none",
        implicitHydrogens: 0,
        isAromatic: false,
        isBracketed: false,
        range: makeRange(symStart, pos),
      });
      continue;
    }

    pos++;
  }

  // Record any unclosed parentheses remaining on stack
  for (const openParen of branchStack) {
    unbalancedParentheses.push({
      kind: "unclosed",
      offset: openParen.offset,
      range: makeRange(openParen.offset, openParen.offset + 1),
    });
  }

  // Record any unclosed ring digits
  for (const [ringId, openEntry] of openRings) {
    unclosedRings.push({
      ringId,
      atomIndex: openEntry.atomIndex,
      range: makeRange(openEntry.offset, openEntry.offset + 1),
    });
  }

  const mol: MolecularGraph = {
    id: molId,
    name: molName,
    smiles: smilesStr,
    format: isSmartsFormat ? "smarts" : "smiles",
    atoms,
    bonds,
    properties: new Map(),
    unclosedRings: unclosedRings.length > 0 ? unclosedRings : undefined,
    conflictingRingBonds: conflictingRingBonds.length > 0 ? conflictingRingBonds : undefined,
    unbalancedParentheses: unbalancedParentheses.length > 0 ? unbalancedParentheses : undefined,
    range: makeRange(0, trimmed.length),
  };

  computeImplicitHydrogens(mol);
  return mol;
}

/**
 * Parses an MDL Molfile V2000 connection table into a `MolecularGraph`.
 */
export function parseMolfile(molText: string, explicitName?: string): MolecularGraph {
  const lines = splitLinesZeroRegex(molText);
  const titleLine = (lines[0] ?? "").trim();
  const commentLine = (lines[2] ?? "").trim();
  const molName = explicitName ?? (titleLine.length > 0 ? titleLine : "MolfileMolecule");
  const molId = sanitizeIdentifierZeroRegex(molName);

  // Locate the V2000 counts line (standard is line index 3, but scan first 6 lines for robustness)
  let countsLineIdx = 3;
  for (let i = 0; i < Math.min(lines.length, 8); i++) {
    const l = lines[i] ?? "";
    if (l.includes("V2000") || l.includes("v2000")) {
      countsLineIdx = i;
      break;
    }
  }

  const countsLine = lines[countsLineIdx] ?? "";
  let atomCount = 0;
  let bondCount = 0;

  if (countsLine.length >= 6) {
    const fixedAtoms = Number(countsLine.slice(0, 3).trim());
    const fixedBonds = Number(countsLine.slice(3, 6).trim());
    const tokens = splitWhitespaceTokensZeroRegex(countsLine);
    if (!Number.isNaN(fixedAtoms) && !Number.isNaN(fixedBonds) && countsLine.slice(0, 3).trim().length > 0) {
      atomCount = fixedAtoms;
      bondCount = fixedBonds;
    } else if (tokens.length >= 2) {
      atomCount = Number(tokens[0]) || 0;
      bondCount = Number(tokens[1]) || 0;
    }
  }

  const atoms: MoleculeAtom[] = [];
  const bonds: MoleculeBond[] = [];
  const properties = new Map<string, string>();
  if (commentLine.length > 0) {
    properties.set("comment", commentLine);
  }

  const atomStartLine = countsLineIdx + 1;
  for (let i = 0; i < atomCount; i++) {
    const lineIdx = atomStartLine + i;
    const line = lines[lineIdx] ?? "";
    const tokens = splitWhitespaceTokensZeroRegex(line);
    const x = Number(tokens[0] ?? 0) || 0;
    const y = Number(tokens[1] ?? 0) || 0;
    const z = Number(tokens[2] ?? 0) || 0;
    const rawSym = tokens[3] ?? "C";
    const chargeCode = Number(tokens[5] ?? 0) || 0;

    // V2000 charge table: 0=0, 1=+3, 2=+2, 3=+1, 4=0(doublet), 5=-1, 6=-2, 7=-3
    let formalCharge = 0;
    if (chargeCode === 1) formalCharge = 3;
    else if (chargeCode === 2) formalCharge = 2;
    else if (chargeCode === 3) formalCharge = 1;
    else if (chargeCode === 5) formalCharge = -1;
    else if (chargeCode === 6) formalCharge = -2;
    else if (chargeCode === 7) formalCharge = -3;

    const info = ELEMENT_BY_SYMBOL.get(rawSym);
    atoms.push({
      index: i,
      element: rawSym,
      rawSymbol: rawSym,
      atomicNumber: info?.atomicNumber ?? 0,
      formalCharge,
      chiralTag: "none",
      implicitHydrogens: 0,
      isAromatic: false,
      isBracketed: false,
      x,
      y,
      z,
      range: {
        startLine: lineIdx + 1,
        startColumn: 1,
        endLine: lineIdx + 1,
        endColumn: line.length + 1,
        startOffset: 0,
        endOffset: line.length,
      },
    });
  }

  const bondStartLine = atomStartLine + atomCount;
  for (let i = 0; i < bondCount; i++) {
    const lineIdx = bondStartLine + i;
    const line = lines[lineIdx] ?? "";
    const tokens = splitWhitespaceTokensZeroRegex(line);
    if (tokens.length < 3) continue;

    let a1 = Number(tokens[0]) - 1;
    let a2 = Number(tokens[1]) - 1;
    let bType = Number(tokens[2]) || 1;
    const bStereoCode = Number(tokens[3] ?? 0) || 0;

    if (line.length >= 9 && (Number.isNaN(a1) || Number.isNaN(a2) || a1 >= atomCount || a2 >= atomCount)) {
      a1 = Number(line.slice(0, 3).trim()) - 1;
      a2 = Number(line.slice(3, 6).trim()) - 1;
      bType = Number(line.slice(6, 9).trim()) || 1;
    }

    if (a1 < 0 || a2 < 0 || a1 >= atoms.length || a2 >= atoms.length) continue;

    const isAromatic = bType === 4;
    const order: BondOrder = bType === 2 ? 2 : bType === 3 ? 3 : bType === 4 ? 1.5 : 1;
    const stereo: BondStereo =
      bStereoCode === 1 ? "up" : bStereoCode === 6 ? "down" : bStereoCode === 4 ? "either" : "none";

    if (isAromatic) {
      const atom1 = atoms[a1];
      const atom2 = atoms[a2];
      if (atom1) atom1.isAromatic = true;
      if (atom2) atom2.isAromatic = true;
    }

    bonds.push({
      index: bonds.length,
      source: a1,
      target: a2,
      order,
      isAromatic,
      stereo,
      range: {
        startLine: lineIdx + 1,
        startColumn: 1,
        endLine: lineIdx + 1,
        endColumn: line.length + 1,
        startOffset: 0,
        endOffset: line.length,
      },
    });
  }

  // Process M  CHG and M  ISO property lines up to M  END
  for (let lineIdx = bondStartLine + bondCount; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx] ?? "";
    const trimmed = line.trim();
    if (trimmed.startsWith("M  END")) break;
    if (trimmed.startsWith("M  CHG")) {
      const tokens = splitWhitespaceTokensZeroRegex(trimmed);
      // Format: M CHG count idx1 chg1 idx2 chg2 ...
      const count = Number(tokens[2] ?? 0) || 0;
      for (let k = 0; k < count; k++) {
        const atomIdx = (Number(tokens[3 + 2 * k]) || 0) - 1;
        const chgVal = Number(tokens[4 + 2 * k]) || 0;
        const targetAtom = atoms[atomIdx];
        if (targetAtom) {
          targetAtom.formalCharge = chgVal;
        }
      }
    } else if (trimmed.startsWith("M  ISO")) {
      const tokens = splitWhitespaceTokensZeroRegex(trimmed);
      const count = Number(tokens[2] ?? 0) || 0;
      for (let k = 0; k < count; k++) {
        const atomIdx = (Number(tokens[3 + 2 * k]) || 0) - 1;
        const isoVal = Number(tokens[4 + 2 * k]) || 0;
        const targetAtom = atoms[atomIdx];
        if (targetAtom && isoVal > 0) {
          targetAtom.isotope = isoVal;
        }
      }
    }
  }

  const mol: MolecularGraph = {
    id: molId,
    name: molName,
    smiles: "",
    format: "mol2000",
    atoms,
    bonds,
    properties,
    range: {
      startLine: 1,
      startColumn: 1,
      endLine: lines.length,
      endColumn: (lines[lines.length - 1] ?? "").length + 1,
      startOffset: 0,
      endOffset: molText.length,
    },
  };

  computeImplicitHydrogens(mol);
  mol.smiles = serializeSmiles(mol);
  return mol;
}

/**
 * Parses an MDL SDfile (.sdf) containing one or more `$$$$`-delimited records.
 */
export function parseSdf(sdfText: string): MolecularGraph[] {
  const lines = splitLinesZeroRegex(sdfText);
  const records: string[][] = [];
  let current: string[] = [];

  for (const line of lines) {
    if (line.trim() === "$$$$") {
      if (current.length > 0) {
        records.push(current);
        current = [];
      }
    } else {
      current.push(line);
    }
  }
  if (current.some((l) => l.trim().length > 0)) {
    records.push(current);
  }

  const molecules: MolecularGraph[] = [];
  for (let rIdx = 0; rIdx < records.length; rIdx++) {
    const recLines = records[rIdx]!;
    const recText = recLines.join("\n");
    const firstNonEmptyTitle = (recLines[0] ?? "").trim();
    const fallbackName = firstNonEmptyTitle.length > 0 ? firstNonEmptyTitle : `SDF_Record_${rIdx + 1}`;
    const mol = parseMolfile(recText, fallbackName);
    mol.format = "sdf";

    // Extract SDF data items after M  END: > <FieldName>
    let afterEnd = false;
    let activeField: string | null = null;
    let activeValueLines: string[] = [];

    for (const line of recLines) {
      const trimmed = line.trim();
      if (!afterEnd) {
        if (trimmed.startsWith("M  END")) {
          afterEnd = true;
        }
        continue;
      }

      if (trimmed.startsWith(">")) {
        if (activeField !== null) {
          mol.properties.set(activeField, activeValueLines.join("\n").trim());
        }
        const openAngle = trimmed.indexOf("<");
        const closeAngle = trimmed.indexOf(">", openAngle + 1);
        if (openAngle !== -1 && closeAngle !== -1 && closeAngle > openAngle + 1) {
          activeField = trimmed.slice(openAngle + 1, closeAngle).trim();
        } else {
          activeField = trimmed.slice(1).trim();
        }
        activeValueLines = [];
      } else if (activeField !== null) {
        if (trimmed.length === 0) {
          mol.properties.set(activeField, activeValueLines.join("\n").trim());
          activeField = null;
          activeValueLines = [];
        } else {
          activeValueLines.push(trimmed);
        }
      }
    }
    if (activeField !== null && activeValueLines.length > 0) {
      mol.properties.set(activeField, activeValueLines.join("\n").trim());
    }

    const propSmiles = mol.properties.get("SMILES") ?? mol.properties.get("CANONICAL_SMILES");
    if (propSmiles && propSmiles.length > 0) {
      mol.smiles = propSmiles;
    }

    molecules.push(mol);
  }

  return molecules;
}

/**
 * Auto-detects format (`.smi`, `.smarts`, `.mol`, `.sdf`) and parses into a `SmilesDocument`.
 */
export function parseSmilesDocument(text: string, sourceFile?: string): SmilesDocument {
  const lowerSource = (sourceFile ?? "").toLowerCase();
  const hasV2000 = text.includes("V2000") || text.includes("M  END");
  const hasSdfDelim = text.includes("$$$$");

  if (lowerSource.endsWith(".sdf") || hasSdfDelim) {
    const molecules = parseSdf(text);
    return {
      format: "sdf",
      molecules,
      sourceFile,
    };
  }

  if (lowerSource.endsWith(".mol") || hasV2000) {
    const mol = parseMolfile(text);
    return {
      format: "mol2000",
      molecules: [mol],
      sourceFile,
    };
  }

  const lines = splitLinesZeroRegex(text);
  const molecules: MolecularGraph[] = [];
  let offset = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const trimmed = line.trim();
    if (trimmed.length > 0 && !trimmed.startsWith("#") && !trimmed.startsWith("//")) {
      const mol = parseSmiles(line, undefined, i + 1, offset);
      if (lowerSource.endsWith(".smarts")) {
        mol.format = "smarts";
      }
      molecules.push(mol);
    }
    offset += line.length + 1;
  }

  if (molecules.length === 0) {
    molecules.push(parseSmiles("", "EmptyDocument", 1, 0));
  }

  const format: MolecularFormat =
    lowerSource.endsWith(".smarts") || molecules.some((m) => m.format === "smarts") ? "smarts" : "smiles";

  return {
    format,
    molecules,
    sourceFile,
  };
}

/**
 * Serializes a `MolecularGraph` into a valid SMILES string via DFS spanning tree traversal.
 */
export function serializeSmiles(mol: MolecularGraph): string {
  if (mol.atoms.length === 0) return "";

  const adj = new Map<number, { neighbor: number; bond: MoleculeBond }[]>();
  for (const atom of mol.atoms) {
    adj.set(atom.index, []);
  }
  for (const bond of mol.bonds) {
    if (bond.source === bond.target) continue;
    adj.get(bond.source)?.push({ neighbor: bond.target, bond });
    adj.get(bond.target)?.push({ neighbor: bond.source, bond });
  }

  // First DFS pass to identify ring-closure back-edges
  const visited = new Set<number>();
  const parentAtom = new Map<number, number>();
  const treeEdges = new Set<number>();
  const ringBonds: { bond: MoleculeBond; ringId: number; openAtom: number; closeAtom: number }[] = [];
  let nextRingId = 1;

  const findCyclesDfs = (u: number, p: number): void => {
    visited.add(u);
    parentAtom.set(u, p);
    const edges = adj.get(u) ?? [];
    for (const { neighbor: v, bond } of edges) {
      if (v === p) continue;
      if (!visited.has(v)) {
        treeEdges.add(bond.index);
        findCyclesDfs(v, u);
      } else if (!treeEdges.has(bond.index)) {
        // Back-edge encountered (only record once when visiting closeAtom -> openAtom)
        if (!ringBonds.some((rb) => rb.bond.index === bond.index)) {
          ringBonds.push({
            bond,
            ringId: nextRingId++,
            openAtom: v,
            closeAtom: u,
          });
        }
      }
    }
  };

  for (const atom of mol.atoms) {
    if (!visited.has(atom.index)) {
      findCyclesDfs(atom.index, -1);
    }
  }

  const formatAtomToken = (atom: MoleculeAtom): string => {
    const needsBrackets =
      atom.isBracketed ||
      atom.isotope !== undefined ||
      atom.formalCharge !== 0 ||
      atom.chiralTag !== "none" ||
      (atom.explicitHydrogens !== undefined && atom.explicitHydrogens > 0) ||
      atom.atomMapNumber !== undefined ||
      (!isAliphaticOrganicSingle(atom.element) && atom.element !== "Cl" && atom.element !== "Br");

    if (!needsBrackets) {
      return atom.isAromatic ? atom.element.toLowerCase() : atom.element;
    }

    let s = "[";
    if (atom.isotope !== undefined) s += String(atom.isotope);
    s += atom.isAromatic ? atom.element.toLowerCase() : atom.element;
    if (atom.chiralTag !== "none") s += atom.chiralTag;
    const hCount = atom.explicitHydrogens ?? 0;
    if (hCount === 1) s += "H";
    else if (hCount > 1) s += `H${hCount}`;
    if (atom.formalCharge > 0) {
      s += atom.formalCharge === 1 ? "+" : `+${atom.formalCharge}`;
    } else if (atom.formalCharge < 0) {
      s += atom.formalCharge === -1 ? "-" : `${atom.formalCharge}`;
    }
    if (atom.atomMapNumber !== undefined) {
      s += `:${atom.atomMapNumber}`;
    }
    s += "]";
    return s;
  };

  const formatBondSymbol = (bond: MoleculeBond, u: number, v: number): string => {
    const aU = mol.atoms[u];
    const aV = mol.atoms[v];
    const bothArom = Boolean(aU?.isAromatic && aV?.isAromatic);
    if (bond.order === 2) return "=";
    if (bond.order === 3) return "#";
    if (bond.order === 1 && bothArom && !bond.isAromatic) return "-";
    if (bond.stereo === "/" || bond.stereo === "\\") return bond.stereo;
    return "";
  };

  const visitedEmit = new Set<number>();
  const componentStrings: string[] = [];

  const emitDfs = (u: number, incomingBond: MoleculeBond | null, p: number): string => {
    visitedEmit.add(u);
    const atom = mol.atoms[u]!;
    let out = incomingBond ? formatBondSymbol(incomingBond, p, u) : "";
    out += formatAtomToken(atom);

    // Emit ring digits attached to u
    for (const rb of ringBonds) {
      if (rb.openAtom === u) {
        const rStr = rb.ringId >= 10 ? `%${rb.ringId}` : String(rb.ringId);
        out += rStr;
      } else if (rb.closeAtom === u) {
        const bSym = formatBondSymbol(rb.bond, rb.openAtom, rb.closeAtom);
        const rStr = rb.ringId >= 10 ? `%${rb.ringId}` : String(rb.ringId);
        out += `${bSym}${rStr}`;
      }
    }

    const children: { neighbor: number; bond: MoleculeBond }[] = [];
    for (const edge of adj.get(u) ?? []) {
      if (treeEdges.has(edge.bond.index) && !visitedEmit.has(edge.neighbor)) {
        children.push(edge);
      }
    }

    for (let i = 0; i < children.length; i++) {
      const child = children[i]!;
      const sub = emitDfs(child.neighbor, child.bond, u);
      if (i < children.length - 1) {
        out += `(${sub})`;
      } else {
        out += sub;
      }
    }

    return out;
  };

  for (const atom of mol.atoms) {
    if (!visitedEmit.has(atom.index)) {
      componentStrings.push(emitDfs(atom.index, null, -1));
    }
  }

  return componentStrings.join(".");
}
