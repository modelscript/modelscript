// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/pdb — Zero-Regex Character-by-Character Parser & Serializer for PDB (.pdb) and mmCIF (.cif).
 *
 * Supports:
 * - wwPDB v3.3 records: HEADER, TITLE, REMARK, HELIX, SHEET, SSBOND, ATOM, HETATM, CONECT, MODEL, TER, END
 * - PDBx/mmCIF (STAR syntax): data_ blocks, key-value tags, and loop_ tables (_atom_site.*, _struct_conf.*, _struct_sheet_range.*, _struct_conn.*)
 * - Strictly zero regular expressions (no RegExp or /.../ literals).
 */

import type {
  PdbAtom,
  PdbChain,
  PdbConect,
  PdbDisulfideBond,
  PdbDocument,
  PdbFormat,
  PdbRange,
  PdbResidue,
  PdbSecondaryStructure,
  PdbStructure,
} from "../types.js";

export const STANDARD_AMINO_ACIDS: Readonly<Record<string, string>> = {
  ALA: "A",
  ARG: "R",
  ASN: "N",
  ASP: "D",
  CYS: "C",
  GLN: "Q",
  GLU: "E",
  GLY: "G",
  HIS: "H",
  ILE: "I",
  LEU: "L",
  LYS: "K",
  MET: "M",
  PHE: "F",
  PRO: "P",
  SER: "S",
  THR: "T",
  TRP: "W",
  TYR: "Y",
  VAL: "V",
};

export function isStandardAminoAcid(resName: string): boolean {
  const upper = resName.trim().toUpperCase();
  return Object.prototype.hasOwnProperty.call(STANDARD_AMINO_ACIDS, upper);
}

export function aminoAcidOneLetter(resName: string): string {
  const upper = resName.trim().toUpperCase();
  return STANDARD_AMINO_ACIDS[upper] ?? "X";
}

function isWhitespaceChar(code: number): boolean {
  return code === 32 || code === 9 || code === 13 || code === 10;
}

function isAlphaCode(code: number): boolean {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function isDigitCode(code: number): boolean {
  return code >= 48 && code <= 57;
}

function splitWhitespaceTokens(line: string): string[] {
  const tokens: string[] = [];
  const len = line.length;
  let i = 0;
  while (i < len) {
    while (i < len && isWhitespaceChar(line.charCodeAt(i))) {
      i++;
    }
    if (i >= len) break;
    const start = i;
    while (i < len && !isWhitespaceChar(line.charCodeAt(i))) {
      i++;
    }
    tokens.push(line.slice(start, i));
  }
  return tokens;
}

export function inferElementFromAtomName(atomName: string, resName: string, recordType: "ATOM" | "HETATM"): string {
  const trimmed = atomName.trim().toUpperCase();
  if (trimmed.length === 0) return "C";

  // Strip leading digits (e.g. "1HG1" -> "HG1")
  let start = 0;
  while (start < trimmed.length && isDigitCode(trimmed.charCodeAt(start))) {
    start++;
  }
  const alpha = trimmed.slice(start);
  if (alpha.length === 0) return "C";

  const first = alpha[0]!;
  if (recordType === "ATOM" && isStandardAminoAcid(resName)) {
    if (first === "C" || first === "N" || first === "O" || first === "S" || first === "H" || first === "P") {
      return first;
    }
  }

  // Check two-letter metal/halogen elements for HETATM or non-standard residues
  if (alpha.length >= 2) {
    const two = alpha.slice(0, 2);
    if (
      two === "FE" ||
      two === "ZN" ||
      two === "MG" ||
      two === "MN" ||
      two === "CU" ||
      two === "CO" ||
      two === "NI" ||
      two === "SE" ||
      two === "CL" ||
      two === "BR" ||
      two === "NA" ||
      two === "HG" ||
      two === "CD" ||
      two === "PT" ||
      two === "AU" ||
      two === "AG"
    ) {
      return two;
    }
    if (two === "CA" && recordType === "HETATM" && resName.trim().toUpperCase() === "CA") {
      return "CA";
    }
  }

  if (isAlphaCode(first.charCodeAt(0))) {
    return first;
  }
  return "C";
}

interface LineEntry {
  text: string;
  lineNumber: number; // 1-based
  startOffset: number;
  endOffset: number;
}

function splitLinesWithRanges(source: string): LineEntry[] {
  const lines: LineEntry[] = [];
  const len = source.length;
  let lineStart = 0;
  let lineNumber = 1;

  for (let i = 0; i < len; i++) {
    const code = source.charCodeAt(i);
    if (code === 10) {
      // '\n'
      const lineEnd = i > lineStart && source.charCodeAt(i - 1) === 13 ? i - 1 : i;
      lines.push({
        text: source.slice(lineStart, lineEnd),
        lineNumber,
        startOffset: lineStart,
        endOffset: lineEnd,
      });
      lineStart = i + 1;
      lineNumber++;
    }
  }

  if (lineStart <= len) {
    const lineEnd = len > lineStart && source.charCodeAt(len - 1) === 13 ? len - 1 : len;
    lines.push({
      text: source.slice(lineStart, lineEnd),
      lineNumber,
      startOffset: lineStart,
      endOffset: lineEnd,
    });
  }

  return lines;
}

function makeLineRange(entry: LineEntry): PdbRange {
  return {
    startLine: entry.lineNumber,
    startColumn: 1,
    endLine: entry.lineNumber,
    endColumn: Math.max(1, entry.text.length + 1),
    startOffset: entry.startOffset,
    endOffset: entry.endOffset,
  };
}

function buildResiduesAndChains(allAtoms: PdbAtom[]): {
  residues: PdbResidue[];
  chains: PdbChain[];
} {
  const residues: PdbResidue[] = [];
  const residueMap = new Map<string, PdbResidue>();

  for (const atom of allAtoms) {
    // Only group primary model (model 1 or undefined) into canonical residue hierarchy
    if (atom.modelNum !== undefined && atom.modelNum > 1) {
      continue;
    }
    const key = `${atom.chainId}:${atom.resSeq}:${atom.iCode ?? ""}:${atom.resName}:${atom.recordType}`;
    let res = residueMap.get(key);
    if (!res) {
      const std = atom.recordType === "ATOM" && isStandardAminoAcid(atom.resName);
      res = {
        resName: atom.resName,
        oneLetterCode: std ? aminoAcidOneLetter(atom.resName) : "X",
        chainId: atom.chainId,
        resSeq: atom.resSeq,
        ...(atom.iCode ? { iCode: atom.iCode } : {}),
        isStandardAminoAcid: std,
        isHetero: atom.recordType === "HETATM",
        atoms: [],
        ...(atom.range ? { range: { ...atom.range } } : {}),
      };
      residueMap.set(key, res);
      residues.push(res);
    }
    res.atoms.push(atom);
    if (res.range && atom.range) {
      res.range.endLine = atom.range.endLine;
      res.range.endColumn = atom.range.endColumn;
      res.range.endOffset = atom.range.endOffset;
    }
  }

  const chains: PdbChain[] = [];
  const chainMap = new Map<string, PdbChain>();

  for (const res of residues) {
    let chain = chainMap.get(res.chainId);
    if (!chain) {
      chain = {
        id: res.chainId,
        residues: [],
        atoms: [],
        sequence: "",
        ...(res.range ? { range: { ...res.range } } : {}),
      };
      chainMap.set(res.chainId, chain);
      chains.push(chain);
    }
    chain.residues.push(res);
    for (const a of res.atoms) {
      chain.atoms.push(a);
    }
    if (res.isStandardAminoAcid) {
      chain.sequence += res.oneLetterCode;
    }
    if (chain.range && res.range) {
      chain.range.endLine = res.range.endLine;
      chain.range.endColumn = res.range.endColumn;
      chain.range.endOffset = res.range.endOffset;
    }
  }

  return { residues, chains };
}

function finalizeDocument(structure: PdbStructure, sourceFile?: string): PdbDocument {
  return {
    ...structure,
    structures: [structure],
    ...(sourceFile !== undefined ? { sourceFile } : {}),
  };
}

function isMmCifSource(text: string): boolean {
  const lines = splitLinesWithRanges(text);
  for (const entry of lines) {
    const trimmed = entry.text.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) continue;
    if (
      trimmed.startsWith("data_") ||
      trimmed.startsWith("loop_") ||
      trimmed.startsWith("_atom_site.") ||
      trimmed.startsWith("_entry.") ||
      trimmed.startsWith("_struct.")
    ) {
      return true;
    }
    return false;
  }
  return false;
}

function parseAtomLine(
  line: string,
  recordType: "ATOM" | "HETATM",
  currentModel: number | undefined,
  range: PdbRange,
): PdbAtom | null {
  // Try standard wwPDB v3.3 fixed columns first
  if (line.length >= 54) {
    const serialStr = line.slice(6, 11).trim();
    const nameStr = line.slice(12, 16).trim();
    const altLocStr = line.slice(16, 17).trim();
    const resNameStr = line.slice(17, 20).trim();
    const chainIdStr = line.slice(21, 22).trim() || "A";
    const resSeqStr = line.slice(22, 26).trim();
    const iCodeStr = line.slice(26, 27).trim();
    const xStr = line.slice(30, 38).trim();
    const yStr = line.slice(38, 46).trim();
    const zStr = line.slice(46, 54).trim();

    const serial = Number.parseInt(serialStr, 10);
    const resSeq = Number.parseInt(resSeqStr, 10);
    const x = Number.parseFloat(xStr);
    const y = Number.parseFloat(yStr);
    const z = Number.parseFloat(zStr);

    if (
      !Number.isNaN(serial) &&
      nameStr.length > 0 &&
      resNameStr.length > 0 &&
      !Number.isNaN(resSeq) &&
      !Number.isNaN(x) &&
      !Number.isNaN(y) &&
      !Number.isNaN(z)
    ) {
      const occStr = line.length >= 60 ? line.slice(54, 60).trim() : "";
      const bStr = line.length >= 66 ? line.slice(60, 66).trim() : "";
      const elemStr = line.length >= 78 ? line.slice(76, 78).trim() : "";
      const chargeStr = line.length >= 80 ? line.slice(78, 80).trim() : "";

      const occupancy = occStr.length > 0 ? Number.parseFloat(occStr) : 1.0;
      const tempFactor = bStr.length > 0 ? Number.parseFloat(bStr) : 20.0;
      const element =
        elemStr.length > 0 ? elemStr.toUpperCase() : inferElementFromAtomName(nameStr, resNameStr, recordType);

      return {
        recordType,
        serial,
        name: nameStr,
        ...(altLocStr.length > 0 ? { altLoc: altLocStr } : {}),
        resName: resNameStr.toUpperCase(),
        chainId: chainIdStr,
        resSeq,
        ...(iCodeStr.length > 0 ? { iCode: iCodeStr } : {}),
        x,
        y,
        z,
        occupancy: Number.isNaN(occupancy) ? 1.0 : occupancy,
        tempFactor: Number.isNaN(tempFactor) ? 20.0 : tempFactor,
        element,
        ...(chargeStr.length > 0 ? { charge: chargeStr } : {}),
        ...(currentModel !== undefined ? { modelNum: currentModel } : {}),
        range,
      };
    }
  }

  // Fallback whitespace-tokenized ATOM / HETATM record:
  // ATOM <serial> <name> <resName> <chainId> <resSeq> <x> <y> <z> [<occupancy> [<tempFactor> [<element>]]]
  // or ATOM <serial> <name> <resName> <resSeq> <x> <y> <z> ...
  const tokens = splitWhitespaceTokens(line);
  if (tokens.length < 8) return null;

  const serial = Number.parseInt(tokens[1] ?? "", 10);
  const name = tokens[2] ?? "";
  const resName = (tokens[3] ?? "UNK").toUpperCase();
  if (Number.isNaN(serial) || name.length === 0) return null;

  let chainId = "A";
  let resSeqIndex = 5;
  const token4 = tokens[4] ?? "";
  const token4AsInt = Number.parseInt(token4, 10);
  if (!Number.isNaN(token4AsInt) && String(token4AsInt) === token4 && tokens.length >= 8) {
    // Check if token[5], token[6], token[7] are floats (meaning chainId was omitted)
    const maybeResSeq = Number.parseInt(tokens[5] ?? "", 10);
    if (tokens.length >= 9 && !Number.isNaN(maybeResSeq) && token4.length === 1) {
      chainId = token4;
      resSeqIndex = 5;
    } else {
      chainId = "A";
      resSeqIndex = 4;
    }
  } else {
    chainId = token4 || "A";
    resSeqIndex = 5;
  }

  const resSeq = Number.parseInt(tokens[resSeqIndex] ?? "1", 10);
  const x = Number.parseFloat(tokens[resSeqIndex + 1] ?? "");
  const y = Number.parseFloat(tokens[resSeqIndex + 2] ?? "");
  const z = Number.parseFloat(tokens[resSeqIndex + 3] ?? "");
  if (Number.isNaN(resSeq) || Number.isNaN(x) || Number.isNaN(y) || Number.isNaN(z)) {
    return null;
  }

  const occToken = tokens[resSeqIndex + 4];
  const bToken = tokens[resSeqIndex + 5];
  const elemToken = tokens[resSeqIndex + 6];

  const occupancy = occToken !== undefined ? Number.parseFloat(occToken) : 1.0;
  const tempFactor = bToken !== undefined ? Number.parseFloat(bToken) : 20.0;
  const element =
    elemToken !== undefined && elemToken.length > 0 && isAlphaCode(elemToken.charCodeAt(0))
      ? elemToken.toUpperCase()
      : inferElementFromAtomName(name, resName, recordType);

  return {
    recordType,
    serial,
    name,
    resName,
    chainId,
    resSeq,
    x,
    y,
    z,
    occupancy: Number.isNaN(occupancy) ? 1.0 : occupancy,
    tempFactor: Number.isNaN(tempFactor) ? 20.0 : tempFactor,
    element,
    ...(currentModel !== undefined ? { modelNum: currentModel } : {}),
    range,
  };
}

/**
 * Parses a Protein Data Bank (.pdb) or PDBx/mmCIF (.cif) macromolecular structure document.
 */
export function parsePdb(text: string, sourceFile?: string): PdbDocument {
  if (isMmCifSource(text)) {
    return parseMmCif(text, sourceFile);
  }

  const lines = splitLinesWithRanges(text);
  let id = "XXXX";
  let classification: string | undefined;
  let depositionDate: string | undefined;
  let resolution: number | undefined;
  const titleParts: string[] = [];

  const atoms: PdbAtom[] = [];
  const hetAtoms: PdbAtom[] = [];
  const allAtoms: PdbAtom[] = [];
  const secondaryStructures: PdbSecondaryStructure[] = [];
  const disulfideBonds: PdbDisulfideBond[] = [];
  const conectRecords: PdbConect[] = [];

  let currentModel: number | undefined;

  for (const entry of lines) {
    const line = entry.text;
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;

    const range = makeLineRange(entry);

    if (line.startsWith("HEADER")) {
      const classSlice = line.length >= 50 ? line.slice(10, 50).trim() : "";
      const dateSlice = line.length >= 59 ? line.slice(50, 59).trim() : "";
      const idSlice = line.length >= 66 ? line.slice(62, 66).trim() : "";

      if (classSlice.length > 0) classification = classSlice;
      if (dateSlice.length > 0) depositionDate = dateSlice;
      if (idSlice.length > 0) {
        id = idSlice.toUpperCase();
      } else {
        const tokens = splitWhitespaceTokens(line);
        if (tokens.length >= 2) {
          const lastTok = tokens[tokens.length - 1]!;
          if (lastTok.length === 4) {
            id = lastTok.toUpperCase();
          }
          if (!classification && tokens.length >= 3) {
            classification = tokens.slice(1, tokens.length - 1).join(" ");
          }
        }
      }
      continue;
    }

    if (line.startsWith("TITLE")) {
      const content = line.length > 10 ? line.slice(10).trim() : line.slice(5).trim();
      if (content.length > 0) {
        titleParts.push(content);
      }
      continue;
    }

    if (line.startsWith("REMARK")) {
      const upper = line.toUpperCase();
      const resIdx = upper.indexOf("RESOLUTION.");
      if (resIdx >= 0) {
        const after = upper.slice(resIdx + 11);
        const tokens = splitWhitespaceTokens(after);
        for (const tok of tokens) {
          const val = Number.parseFloat(tok);
          if (!Number.isNaN(val) && val > 0) {
            resolution = val;
            break;
          }
        }
      }
      continue;
    }

    if (line.startsWith("MODEL")) {
      const tokens = splitWhitespaceTokens(line);
      if (tokens.length >= 2) {
        const m = Number.parseInt(tokens[1]!, 10);
        if (!Number.isNaN(m)) currentModel = m;
      }
      continue;
    }

    if (line.startsWith("ENDMDL")) {
      currentModel = undefined;
      continue;
    }

    if (line.startsWith("HELIX")) {
      let parsedHelix: PdbSecondaryStructure | null = null;
      if (line.length >= 37) {
        const serNum = Number.parseInt(line.slice(7, 10).trim(), 10);
        const helixId = line.slice(11, 14).trim();
        const initResName = line.slice(15, 18).trim();
        const initChainId = line.slice(19, 20).trim() || "A";
        const initSeqNum = Number.parseInt(line.slice(21, 25).trim(), 10);
        const endResName = line.slice(27, 30).trim();
        const endChainId = line.slice(31, 32).trim() || initChainId;
        const endSeqNum = Number.parseInt(line.slice(33, 37).trim(), 10);
        const helixClass = line.length >= 40 ? Number.parseInt(line.slice(38, 40).trim(), 10) : 1;
        const lengthVal = line.length >= 76 ? Number.parseInt(line.slice(71, 76).trim(), 10) : undefined;

        if (!Number.isNaN(initSeqNum) && !Number.isNaN(endSeqNum) && initResName.length > 0) {
          parsedHelix = {
            kind: "helix",
            id: helixId || String(Number.isNaN(serNum) ? secondaryStructures.length + 1 : serNum),
            serial: Number.isNaN(serNum) ? secondaryStructures.length + 1 : serNum,
            initResName,
            initChainId,
            initSeqNum,
            endResName,
            endChainId,
            endSeqNum,
            helixClass: Number.isNaN(helixClass) ? 1 : helixClass,
            ...(lengthVal !== undefined && !Number.isNaN(lengthVal)
              ? { length: lengthVal }
              : { length: endSeqNum - initSeqNum + 1 }),
            range,
          };
        }
      }
      if (!parsedHelix) {
        const tokens = splitWhitespaceTokens(line);
        // HELIX <serial> <id> <initRes> <initChain> <initSeq> <endRes> <endChain> <endSeq> [<class> [<len>]]
        if (tokens.length >= 9) {
          const serial = Number.parseInt(tokens[1]!, 10) || secondaryStructures.length + 1;
          const helixId = tokens[2]!;
          const initResName = tokens[3]!;
          const initChainId = tokens[4]!;
          const initSeqNum = Number.parseInt(tokens[5]!, 10);
          const endResName = tokens[6]!;
          const endChainId = tokens[7]!;
          const endSeqNum = Number.parseInt(tokens[8]!, 10);
          const helixClass = tokens[9] ? Number.parseInt(tokens[9], 10) : 1;
          const lengthVal = tokens[10] ? Number.parseInt(tokens[10], 10) : endSeqNum - initSeqNum + 1;
          if (!Number.isNaN(initSeqNum) && !Number.isNaN(endSeqNum)) {
            parsedHelix = {
              kind: "helix",
              id: helixId,
              serial,
              initResName,
              initChainId,
              initSeqNum,
              endResName,
              endChainId,
              endSeqNum,
              ...(!Number.isNaN(helixClass) ? { helixClass } : {}),
              ...(!Number.isNaN(lengthVal) ? { length: lengthVal } : {}),
              range,
            };
          }
        }
      }
      if (parsedHelix) secondaryStructures.push(parsedHelix);
      continue;
    }

    if (line.startsWith("SHEET")) {
      let parsedSheet: PdbSecondaryStructure | null = null;
      if (line.length >= 37) {
        const strand = Number.parseInt(line.slice(7, 10).trim(), 10);
        const sheetId = line.slice(11, 14).trim();
        const initResName = line.slice(17, 20).trim();
        const initChainId = line.slice(21, 22).trim() || "A";
        const initSeqNum = Number.parseInt(line.slice(22, 26).trim(), 10);
        const endResName = line.slice(28, 31).trim();
        const endChainId = line.slice(32, 33).trim() || initChainId;
        const endSeqNum = Number.parseInt(line.slice(33, 37).trim(), 10);
        const sense = line.length >= 40 ? Number.parseInt(line.slice(38, 40).trim(), 10) : 0;

        if (!Number.isNaN(initSeqNum) && !Number.isNaN(endSeqNum) && initResName.length > 0) {
          parsedSheet = {
            kind: "sheet",
            id: sheetId || String(Number.isNaN(strand) ? secondaryStructures.length + 1 : strand),
            serial: Number.isNaN(strand) ? secondaryStructures.length + 1 : strand,
            initResName,
            initChainId,
            initSeqNum,
            endResName,
            endChainId,
            endSeqNum,
            ...(!Number.isNaN(sense) ? { sense } : {}),
            length: endSeqNum - initSeqNum + 1,
            range,
          };
        }
      }
      if (!parsedSheet) {
        const tokens = splitWhitespaceTokens(line);
        // SHEET <strand> <sheetId> [numStrands] <initRes> <initChain> <initSeq> <endRes> <endChain> <endSeq>
        if (tokens.length >= 9) {
          const serial = Number.parseInt(tokens[1]!, 10) || secondaryStructures.length + 1;
          const sheetId = tokens[2]!;
          const hasNumStrands = !Number.isNaN(Number.parseInt(tokens[3]!, 10)) && tokens.length >= 10;
          const offset = hasNumStrands ? 4 : 3;
          const initResName = tokens[offset] ?? "ALA";
          const initChainId = tokens[offset + 1] ?? "A";
          const initSeqNum = Number.parseInt(tokens[offset + 2] ?? "", 10);
          const endResName = tokens[offset + 3] ?? "ALA";
          const endChainId = tokens[offset + 4] ?? initChainId;
          const endSeqNum = Number.parseInt(tokens[offset + 5] ?? "", 10);
          if (!Number.isNaN(initSeqNum) && !Number.isNaN(endSeqNum)) {
            parsedSheet = {
              kind: "sheet",
              id: sheetId,
              serial,
              initResName,
              initChainId,
              initSeqNum,
              endResName,
              endChainId,
              endSeqNum,
              length: endSeqNum - initSeqNum + 1,
              range,
            };
          }
        }
      }
      if (parsedSheet) secondaryStructures.push(parsedSheet);
      continue;
    }

    if (line.startsWith("SSBOND")) {
      let parsedBond: PdbDisulfideBond | null = null;
      if (line.length >= 35) {
        const serNum = Number.parseInt(line.slice(7, 10).trim(), 10);
        const resName1 = line.slice(11, 14).trim() || "CYS";
        const chainId1 = line.slice(15, 16).trim() || "A";
        const resSeq1 = Number.parseInt(line.slice(17, 21).trim(), 10);
        const resName2 = line.slice(25, 28).trim() || "CYS";
        const chainId2 = line.slice(29, 30).trim() || "A";
        const resSeq2 = Number.parseInt(line.slice(31, 35).trim(), 10);
        const sym1 = line.length >= 65 ? line.slice(59, 65).trim() : "";
        const sym2 = line.length >= 72 ? line.slice(66, 72).trim() : "";
        const lenStr = line.length >= 78 ? line.slice(73, 78).trim() : "";
        const lengthVal = lenStr.length > 0 ? Number.parseFloat(lenStr) : undefined;

        if (!Number.isNaN(resSeq1) && !Number.isNaN(resSeq2)) {
          parsedBond = {
            serial: Number.isNaN(serNum) ? disulfideBonds.length + 1 : serNum,
            chainId1,
            resName1,
            resSeq1,
            chainId2,
            resName2,
            resSeq2,
            ...(sym1.length > 0 ? { sym1 } : {}),
            ...(sym2.length > 0 ? { sym2 } : {}),
            ...(lengthVal !== undefined && !Number.isNaN(lengthVal) ? { length: lengthVal } : {}),
            range,
          };
        }
      }
      if (!parsedBond) {
        const tokens = splitWhitespaceTokens(line);
        // SSBOND <serial> CYS <chain1> <seq1> CYS <chain2> <seq2> [<length>]
        if (tokens.length >= 8) {
          const serial = Number.parseInt(tokens[1]!, 10) || disulfideBonds.length + 1;
          const resName1 = tokens[2]!;
          const chainId1 = tokens[3]!;
          const resSeq1 = Number.parseInt(tokens[4]!, 10);
          const resName2 = tokens[5]!;
          const chainId2 = tokens[6]!;
          const resSeq2 = Number.parseInt(tokens[7]!, 10);
          const lengthVal = tokens[8] !== undefined ? Number.parseFloat(tokens[8]) : undefined;
          if (!Number.isNaN(resSeq1) && !Number.isNaN(resSeq2)) {
            parsedBond = {
              serial,
              chainId1,
              resName1,
              resSeq1,
              chainId2,
              resName2,
              resSeq2,
              ...(lengthVal !== undefined && !Number.isNaN(lengthVal) ? { length: lengthVal } : {}),
              range,
            };
          }
        }
      }
      if (parsedBond) disulfideBonds.push(parsedBond);
      continue;
    }

    if (line.startsWith("ATOM  ") || line.startsWith("ATOM\t") || line.startsWith("ATOM ")) {
      const atom = parseAtomLine(line, "ATOM", currentModel, range);
      if (atom) {
        atoms.push(atom);
        allAtoms.push(atom);
      }
      continue;
    }

    if (line.startsWith("HETATM")) {
      const atom = parseAtomLine(line, "HETATM", currentModel, range);
      if (atom) {
        hetAtoms.push(atom);
        allAtoms.push(atom);
      }
      continue;
    }

    if (line.startsWith("CONECT")) {
      const tokens = splitWhitespaceTokens(line.slice(6));
      const serials: number[] = [];
      // If whitespace tokens all parse cleanly as integers, use them; otherwise use 5-char fixed columns
      let allCleanTokens = tokens.length >= 2;
      for (const tok of tokens) {
        if (tok.length > 5) {
          allCleanTokens = false;
          break;
        }
        const n = Number.parseInt(tok, 10);
        if (Number.isNaN(n)) {
          allCleanTokens = false;
          break;
        }
        serials.push(n);
      }

      if (!allCleanTokens) {
        serials.length = 0;
        for (let col = 6; col < line.length; col += 5) {
          const chunk = line.slice(col, col + 5).trim();
          if (chunk.length === 0) continue;
          const n = Number.parseInt(chunk, 10);
          if (!Number.isNaN(n)) {
            serials.push(n);
          }
        }
      }

      if (serials.length >= 1) {
        conectRecords.push({
          atomSerial: serials[0]!,
          bondedSerials: serials.slice(1),
          range,
        });
      }
      continue;
    }
  }

  const { residues, chains } = buildResiduesAndChains(allAtoms);
  const title = titleParts.length > 0 ? titleParts.join(" ") : `PDB Structure ${id}`;

  const structure: PdbStructure = {
    id,
    title,
    ...(classification !== undefined ? { classification } : {}),
    ...(depositionDate !== undefined ? { depositionDate } : {}),
    ...(resolution !== undefined ? { resolution } : {}),
    format: "pdb",
    atoms,
    hetAtoms,
    residues,
    chains,
    secondaryStructures,
    disulfideBonds,
    conectRecords,
    range: {
      startLine: 1,
      startColumn: 1,
      endLine: Math.max(1, lines.length),
      endColumn: 1,
      startOffset: 0,
      endOffset: text.length,
    },
  };

  return finalizeDocument(structure, sourceFile);
}

interface CifToken {
  value: string;
  isQuoted: boolean;
  line: number;
  column: number;
  startOffset: number;
  endOffset: number;
}

function tokenizeMmCif(text: string): CifToken[] {
  const tokens: CifToken[] = [];
  const len = text.length;
  let i = 0;
  let line = 1;
  let lineStart = 0;

  while (i < len) {
    const code = text.charCodeAt(i);

    // Handle newline
    if (code === 10) {
      i++;
      line++;
      lineStart = i;
      continue;
    }
    if (code === 13) {
      i++;
      continue;
    }

    // Skip spaces and tabs
    if (code === 32 || code === 9) {
      i++;
      continue;
    }

    // Comment starting with '#'
    if (code === 35) {
      while (i < len && text.charCodeAt(i) !== 10) {
        i++;
      }
      continue;
    }

    // Multi-line semicolon text field at start of line
    if (code === 59 && i === lineStart) {
      const startOffset = i;
      const startLine = line;
      const startCol = 1;
      i++; // skip opening ';'
      const contentStart = i;
      while (i < len) {
        if (text.charCodeAt(i) === 10) {
          line++;
          lineStart = i + 1;
          if (lineStart < len && text.charCodeAt(lineStart) === 59) {
            const contentEnd = i > contentStart && text.charCodeAt(i - 1) === 13 ? i - 1 : i;
            const value = text.slice(contentStart, contentEnd).trim();
            i = lineStart + 1;
            tokens.push({
              value,
              isQuoted: true,
              line: startLine,
              column: startCol,
              startOffset,
              endOffset: i,
            });
            break;
          }
        }
        i++;
      }
      continue;
    }

    // Single-quoted or double-quoted string
    if (code === 39 || code === 34) {
      const quote = code;
      const startOffset = i;
      const startCol = i - lineStart + 1;
      i++; // skip opening quote
      const contentStart = i;
      while (i < len) {
        const c = text.charCodeAt(i);
        if (c === 10 || c === 13) break;
        if (c === quote) {
          const nextCode = i + 1 < len ? text.charCodeAt(i + 1) : 32;
          if (isWhitespaceChar(nextCode) || nextCode === 35) {
            break;
          }
        }
        i++;
      }
      const value = text.slice(contentStart, i);
      if (i < len && text.charCodeAt(i) === quote) {
        i++;
      }
      tokens.push({
        value,
        isQuoted: true,
        line,
        column: startCol,
        startOffset,
        endOffset: i,
      });
      continue;
    }

    // Unquoted token
    const startOffset = i;
    const startCol = i - lineStart + 1;
    while (i < len && !isWhitespaceChar(text.charCodeAt(i)) && text.charCodeAt(i) !== 35) {
      i++;
    }
    const value = text.slice(startOffset, i);
    tokens.push({
      value,
      isQuoted: false,
      line,
      column: startCol,
      startOffset,
      endOffset: i,
    });
  }

  return tokens;
}

/**
 * Parses a PDBx/mmCIF (.cif) macromolecular crystallographic structure file using a zero-regex STAR parser.
 */
export function parseMmCif(text: string, sourceFile?: string): PdbDocument {
  const tokens = tokenizeMmCif(text);
  let id = "XXXX";
  let title = "";
  let classification: string | undefined;
  let resolution: number | undefined;

  const atoms: PdbAtom[] = [];
  const hetAtoms: PdbAtom[] = [];
  const allAtoms: PdbAtom[] = [];
  const secondaryStructures: PdbSecondaryStructure[] = [];
  const disulfideBonds: PdbDisulfideBond[] = [];
  const conectRecords: PdbConect[] = [];

  let i = 0;
  const n = tokens.length;

  while (i < n) {
    const tok = tokens[i]!;
    const val = tok.value;

    if (!tok.isQuoted && val.toLowerCase().startsWith("data_")) {
      const blockId = val.slice(5).trim();
      if (blockId.length > 0) {
        id = blockId.toUpperCase();
      }
      i++;
      continue;
    }

    if (!tok.isQuoted && val.toLowerCase() === "loop_") {
      i++;
      const headers: string[] = [];
      while (i < n && !tokens[i]!.isQuoted && tokens[i]!.value.startsWith("_")) {
        headers.push(tokens[i]!.value);
        i++;
      }

      const numCols = headers.length;
      if (numCols === 0) continue;

      const rows: CifToken[][] = [];
      while (i < n) {
        const cur = tokens[i]!;
        if (
          !cur.isQuoted &&
          (cur.value.startsWith("_") ||
            cur.value.toLowerCase() === "loop_" ||
            cur.value.toLowerCase().startsWith("data_"))
        ) {
          break;
        }
        const row: CifToken[] = [];
        for (let c = 0; c < numCols && i < n; c++) {
          row.push(tokens[i]!);
          i++;
        }
        if (row.length === numCols) {
          rows.push(row);
        }
      }

      const firstHeader = headers[0] ?? "";
      if (firstHeader.startsWith("_atom_site.")) {
        const colIdx = (name: string): number => headers.indexOf(`_atom_site.${name}`);
        const idxGroup = colIdx("group_PDB");
        const idxId = colIdx("id");
        const idxSymbol = colIdx("type_symbol");
        const idxAtomId = colIdx("label_atom_id") >= 0 ? colIdx("label_atom_id") : colIdx("auth_atom_id");
        const idxAltId = colIdx("label_alt_id");
        const idxCompId = colIdx("label_comp_id") >= 0 ? colIdx("label_comp_id") : colIdx("auth_comp_id");
        const idxAsymId = colIdx("auth_asym_id") >= 0 ? colIdx("auth_asym_id") : colIdx("label_asym_id");
        const idxSeqId = colIdx("auth_seq_id") >= 0 ? colIdx("auth_seq_id") : colIdx("label_seq_id");
        const idxInsCode = colIdx("pdbx_PDB_ins_code");
        const idxX = colIdx("Cartn_x");
        const idxY = colIdx("Cartn_y");
        const idxZ = colIdx("Cartn_z");
        const idxOcc = colIdx("occupancy");
        const idxB = colIdx("B_iso_or_equiv");
        const idxCharge = colIdx("pdbx_formal_charge");
        const idxModel = colIdx("pdbx_PDB_model_num");

        for (let r = 0; r < rows.length; r++) {
          const row = rows[r]!;
          const firstTok = row[0]!;
          const lastTok = row[row.length - 1]!;
          const groupRaw = idxGroup >= 0 ? row[idxGroup]!.value.toUpperCase() : "ATOM";
          const recordType: "ATOM" | "HETATM" = groupRaw === "HETATM" ? "HETATM" : "ATOM";
          const serial = idxId >= 0 ? Number.parseInt(row[idxId]!.value, 10) : r + 1;
          const name = idxAtomId >= 0 ? row[idxAtomId]!.value : "CA";
          const altRaw = idxAltId >= 0 ? row[idxAltId]!.value : ".";
          const resName = (idxCompId >= 0 ? row[idxCompId]!.value : "ALA").toUpperCase();
          const chainId = idxAsymId >= 0 ? row[idxAsymId]!.value : "A";
          const seqRaw = idxSeqId >= 0 ? row[idxSeqId]!.value : String(r + 1);
          const resSeq = Number.parseInt(seqRaw, 10);
          const insRaw = idxInsCode >= 0 ? row[idxInsCode]!.value : ".";
          const x = idxX >= 0 ? Number.parseFloat(row[idxX]!.value) : 0.0;
          const y = idxY >= 0 ? Number.parseFloat(row[idxY]!.value) : 0.0;
          const z = idxZ >= 0 ? Number.parseFloat(row[idxZ]!.value) : 0.0;
          const occ = idxOcc >= 0 ? Number.parseFloat(row[idxOcc]!.value) : 1.0;
          const bVal = idxB >= 0 ? Number.parseFloat(row[idxB]!.value) : 20.0;
          const elemRaw = idxSymbol >= 0 ? row[idxSymbol]!.value : "";
          const chargeRaw = idxCharge >= 0 ? row[idxCharge]!.value : ".";
          const modelRaw = idxModel >= 0 ? Number.parseInt(row[idxModel]!.value, 10) : undefined;

          if (Number.isNaN(x) || Number.isNaN(y) || Number.isNaN(z)) continue;

          const atom: PdbAtom = {
            recordType,
            serial: Number.isNaN(serial) ? r + 1 : serial,
            name,
            ...(altRaw !== "." && altRaw !== "?" && altRaw.length > 0 ? { altLoc: altRaw } : {}),
            resName,
            chainId: chainId === "." || chainId === "?" ? "A" : chainId,
            resSeq: Number.isNaN(resSeq) ? 1 : resSeq,
            ...(insRaw !== "." && insRaw !== "?" && insRaw.length > 0 ? { iCode: insRaw } : {}),
            x,
            y,
            z,
            occupancy: Number.isNaN(occ) ? 1.0 : occ,
            tempFactor: Number.isNaN(bVal) ? 20.0 : bVal,
            element:
              elemRaw !== "." && elemRaw !== "?" && elemRaw.length > 0
                ? elemRaw.toUpperCase()
                : inferElementFromAtomName(name, resName, recordType),
            ...(chargeRaw !== "." && chargeRaw !== "?" && chargeRaw.length > 0 ? { charge: chargeRaw } : {}),
            ...(modelRaw !== undefined && !Number.isNaN(modelRaw) ? { modelNum: modelRaw } : {}),
            range: {
              startLine: firstTok.line,
              startColumn: firstTok.column,
              endLine: lastTok.line,
              endColumn: lastTok.column + lastTok.value.length,
              startOffset: firstTok.startOffset,
              endOffset: lastTok.endOffset,
            },
          };

          if (recordType === "HETATM") {
            hetAtoms.push(atom);
          } else {
            atoms.push(atom);
          }
          allAtoms.push(atom);
        }
      } else if (firstHeader.startsWith("_struct_conf.")) {
        const colIdx = (name: string): number => headers.indexOf(`_struct_conf.${name}`);
        const idxId = colIdx("id");
        const idxBegComp = colIdx("beg_label_comp_id");
        const idxBegAsym = colIdx("beg_label_asym_id");
        const idxBegSeq = colIdx("beg_label_seq_id");
        const idxEndComp = colIdx("end_label_comp_id");
        const idxEndAsym = colIdx("end_label_asym_id");
        const idxEndSeq = colIdx("end_label_seq_id");

        for (let r = 0; r < rows.length; r++) {
          const row = rows[r]!;
          const initSeqNum = idxBegSeq >= 0 ? Number.parseInt(row[idxBegSeq]!.value, 10) : 1;
          const endSeqNum = idxEndSeq >= 0 ? Number.parseInt(row[idxEndSeq]!.value, 10) : initSeqNum;
          secondaryStructures.push({
            kind: "helix",
            id: idxId >= 0 ? row[idxId]!.value : `H${r + 1}`,
            serial: r + 1,
            initResName: idxBegComp >= 0 ? row[idxBegComp]!.value : "ALA",
            initChainId: idxBegAsym >= 0 ? row[idxBegAsym]!.value : "A",
            initSeqNum: Number.isNaN(initSeqNum) ? 1 : initSeqNum,
            endResName: idxEndComp >= 0 ? row[idxEndComp]!.value : "ALA",
            endChainId: idxEndAsym >= 0 ? row[idxEndAsym]!.value : "A",
            endSeqNum: Number.isNaN(endSeqNum) ? 1 : endSeqNum,
            helixClass: 1,
            length: endSeqNum - initSeqNum + 1,
          });
        }
      } else if (firstHeader.startsWith("_struct_conn.")) {
        const colIdx = (name: string): number => headers.indexOf(`_struct_conn.${name}`);
        const idxType = colIdx("conn_type_id");
        const idxAsym1 = colIdx("ptnr1_label_asym_id");
        const idxComp1 = colIdx("ptnr1_label_comp_id");
        const idxSeq1 = colIdx("ptnr1_label_seq_id");
        const idxAsym2 = colIdx("ptnr2_label_asym_id");
        const idxComp2 = colIdx("ptnr2_label_comp_id");
        const idxSeq2 = colIdx("ptnr2_label_seq_id");
        const idxDist = colIdx("pdbx_dist_value");

        for (let r = 0; r < rows.length; r++) {
          const row = rows[r]!;
          const connType = idxType >= 0 ? row[idxType]!.value.toLowerCase() : "disulf";
          if (!connType.startsWith("disulf")) continue;
          const seq1 = idxSeq1 >= 0 ? Number.parseInt(row[idxSeq1]!.value, 10) : 1;
          const seq2 = idxSeq2 >= 0 ? Number.parseInt(row[idxSeq2]!.value, 10) : 2;
          const distVal = idxDist >= 0 ? Number.parseFloat(row[idxDist]!.value) : undefined;
          disulfideBonds.push({
            serial: disulfideBonds.length + 1,
            chainId1: idxAsym1 >= 0 ? row[idxAsym1]!.value : "A",
            resName1: idxComp1 >= 0 ? row[idxComp1]!.value : "CYS",
            resSeq1: Number.isNaN(seq1) ? 1 : seq1,
            chainId2: idxAsym2 >= 0 ? row[idxAsym2]!.value : "A",
            resName2: idxComp2 >= 0 ? row[idxComp2]!.value : "CYS",
            resSeq2: Number.isNaN(seq2) ? 2 : seq2,
            ...(distVal !== undefined && !Number.isNaN(distVal) ? { length: distVal } : {}),
          });
        }
      }

      continue;
    }

    // Scalar key-value tag: _category.field <value>
    if (!tok.isQuoted && val.startsWith("_") && i + 1 < n) {
      const key = val.toLowerCase();
      const valTok = tokens[i + 1]!;
      if (key === "_entry.id") {
        id = valTok.value.toUpperCase();
      } else if (key === "_struct.title") {
        title = valTok.value;
      } else if (key === "_struct_keywords.pdbx_keywords") {
        classification = valTok.value;
      } else if (key === "_refine.ls_d_res_high") {
        const resVal = Number.parseFloat(valTok.value);
        if (!Number.isNaN(resVal)) resolution = resVal;
      }
      i += 2;
      continue;
    }

    i++;
  }

  const { residues, chains } = buildResiduesAndChains(allAtoms);

  const structure: PdbStructure = {
    id,
    title: title || `mmCIF Structure ${id}`,
    ...(classification !== undefined ? { classification } : {}),
    ...(resolution !== undefined ? { resolution } : {}),
    format: "mmcif" as PdbFormat,
    atoms,
    hetAtoms,
    residues,
    chains,
    secondaryStructures,
    disulfideBonds,
    conectRecords,
    range: {
      startLine: 1,
      startColumn: 1,
      endLine: Math.max(1, splitLinesWithRanges(text).length),
      endColumn: 1,
      startOffset: 0,
      endOffset: text.length,
    },
  };

  return finalizeDocument(structure, sourceFile);
}

export const parsePdbDocument = parsePdb;

function padLeft(str: string, width: number): string {
  if (str.length >= width) return str.slice(0, width);
  return " ".repeat(width - str.length) + str;
}

function padRight(str: string, width: number): string {
  if (str.length >= width) return str.slice(0, width);
  return str + " ".repeat(width - str.length);
}

/**
 * Serializes a PdbStructure or PdbDocument back into standard 80-column wwPDB v3.3 format.
 */
export function serializePdb(input: PdbStructure | PdbDocument): string {
  const lines: string[] = [];

  const classification = padRight(input.classification ?? "PROTEIN", 40);
  const depDate = padRight(input.depositionDate ?? "01-JAN-26", 9);
  const pdbId = padRight(input.id || "1PDB", 4);
  lines.push(`HEADER    ${classification}${depDate}   ${pdbId}`);

  if (input.title) {
    lines.push(`TITLE     ${input.title.toUpperCase()}`);
  }

  for (const sec of input.secondaryStructures) {
    if (sec.kind === "helix") {
      const ser = padLeft(String(sec.serial), 3);
      const hid = padLeft(sec.id, 3);
      const iRes = padRight(sec.initResName, 3);
      const iCh = padRight(sec.initChainId, 1);
      const iSeq = padLeft(String(sec.initSeqNum), 4);
      const eRes = padRight(sec.endResName, 3);
      const eCh = padRight(sec.endChainId, 1);
      const eSeq = padLeft(String(sec.endSeqNum), 4);
      const hCls = padLeft(String(sec.helixClass ?? 1), 2);
      const len = padLeft(String(sec.length ?? sec.endSeqNum - sec.initSeqNum + 1), 5);
      lines.push(`HELIX  ${ser} ${hid} ${iRes} ${iCh} ${iSeq}  ${eRes} ${eCh} ${eSeq}${hCls}${" ".repeat(31)}${len}`);
    } else {
      const ser = padLeft(String(sec.serial), 3);
      const sid = padLeft(sec.id, 3);
      const iRes = padRight(sec.initResName, 3);
      const iCh = padRight(sec.initChainId, 1);
      const iSeq = padLeft(String(sec.initSeqNum), 4);
      const eRes = padRight(sec.endResName, 3);
      const eCh = padRight(sec.endChainId, 1);
      const eSeq = padLeft(String(sec.endSeqNum), 4);
      const sense = padLeft(String(sec.sense ?? 0), 2);
      lines.push(`SHEET  ${ser} ${sid} 1 ${iRes} ${iCh}${iSeq}  ${eRes} ${eCh}${eSeq}${sense}`);
    }
  }

  for (const ssb of input.disulfideBonds) {
    const ser = padLeft(String(ssb.serial), 3);
    const r1 = padRight(ssb.resName1, 3);
    const c1 = padRight(ssb.chainId1, 1);
    const s1 = padLeft(String(ssb.resSeq1), 4);
    const r2 = padRight(ssb.resName2, 3);
    const c2 = padRight(ssb.chainId2, 1);
    const s2 = padLeft(String(ssb.resSeq2), 4);
    const sym1 = padRight(ssb.sym1 ?? "1555", 6);
    const sym2 = padRight(ssb.sym2 ?? "1555", 6);
    const dist = ssb.length !== undefined ? padLeft(ssb.length.toFixed(2), 5) : " 2.04";
    lines.push(`SSBOND ${ser} ${r1} ${c1} ${s1}    ${r2} ${c2} ${s2}${" ".repeat(24)}${sym1} ${sym2} ${dist}`);
  }

  const allAtoms = [...input.atoms, ...input.hetAtoms].sort((a, b) => a.serial - b.serial);
  for (const atom of allAtoms) {
    const rec = padRight(atom.recordType, 6);
    const ser = padLeft(String(atom.serial), 5);
    const atomNameField = atom.name.length === 4 ? atom.name : ` ${padRight(atom.name, 3)}`;
    const alt = padRight(atom.altLoc ?? " ", 1);
    const res = padLeft(atom.resName, 3);
    const chain = padRight(atom.chainId || "A", 1);
    const seq = padLeft(String(atom.resSeq), 4);
    const iCode = padRight(atom.iCode ?? " ", 1);
    const x = padLeft(atom.x.toFixed(3), 8);
    const y = padLeft(atom.y.toFixed(3), 8);
    const z = padLeft(atom.z.toFixed(3), 8);
    const occ = padLeft(atom.occupancy.toFixed(2), 6);
    const b = padLeft(atom.tempFactor.toFixed(2), 6);
    const elem = padLeft(atom.element || "C", 2);
    const chg = padRight(atom.charge ?? "  ", 2);
    lines.push(
      `${rec}${ser} ${atomNameField}${alt}${res} ${chain}${seq}${iCode}   ${x}${y}${z}${occ}${b}          ${elem}${chg}`,
    );
  }

  for (const con of input.conectRecords) {
    let line = `CONECT${padLeft(String(con.atomSerial), 5)}`;
    for (const target of con.bondedSerials) {
      line += padLeft(String(target), 5);
    }
    lines.push(line);
  }

  lines.push("END");
  return lines.join("\n");
}
