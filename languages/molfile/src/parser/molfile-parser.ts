// SPDX-License-Identifier: AGPL-3.0-or-later

import type {
  MolAtom,
  MolBond,
  MolCountsLine,
  MolfileDocument,
  MolfileVersion,
  MolHeader,
  MolParseError,
  MolPropertyKind,
  MolPropertyLine,
  MolRecord,
  SdfDataItem,
} from "../types.js";

/**
 * Maps V2000 atom-block charge code (columns 37-39) to formal charge and radical flag.
 */
function decodeV2000ChargeCode(code: number): { charge: number; radical: number } {
  switch (code) {
    case 1:
      return { charge: 3, radical: 0 };
    case 2:
      return { charge: 2, radical: 0 };
    case 3:
      return { charge: 1, radical: 0 };
    case 4:
      return { charge: 0, radical: 2 }; // doublet radical
    case 5:
      return { charge: -1, radical: 0 };
    case 6:
      return { charge: -2, radical: 0 };
    case 7:
      return { charge: -3, radical: 0 };
    default:
      return { charge: 0, radical: 0 };
  }
}

function parseIntField(line: string, start: number, end: number, fallback = 0): number {
  if (line.length <= start) return fallback;
  const slice = line.slice(start, end).trim();
  if (slice.length === 0) return fallback;
  const n = Number.parseInt(slice, 10);
  return Number.isNaN(n) ? fallback : n;
}

function parseFloatField(line: string, start: number, end: number): number {
  if (line.length <= start) return Number.NaN;
  const slice = line.slice(start, end).trim();
  if (slice.length === 0) return Number.NaN;
  return Number.parseFloat(slice);
}

/**
 * Heuristic check for whether a line looks like a V2000 atom line
 * (three coordinates followed by an alphabetic/wildcard symbol).
 */
function looksLikeV2000AtomLine(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length === 0) return false;
  if (trimmed.startsWith("M  ") || trimmed.startsWith(">") || trimmed === "$$$$") return false;
  // Match 3 numbers (usually floats) followed by an element/label token
  return /^[+-]?\d+(?:\.\d+)?\s+[+-]?\d+(?:\.\d+)?\s+[+-]?\d+(?:\.\d+)?\s+[A-Za-z*][A-Za-z0-9#*]*/.test(trimmed);
}

/**
 * Heuristic check for whether a line looks like a V2000 bond line
 * (at least 3 integers, no decimal points or element letters).
 */
function looksLikeV2000BondLine(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length === 0) return false;
  if (trimmed.startsWith("M  ") || trimmed.startsWith(">") || trimmed === "$$$$") return false;
  // Fixed-width bond lines can have concatenated 3-char integers like "100101  1  0"
  if (/^[+-]?\d+(?:\.\d+)?\s+[+-]?\d+(?:\.\d+)?\s+[+-]?\d+(?:\.\d+)?\s+[A-Za-z*]/.test(trimmed)) {
    return false;
  }
  return /^[\s0-9-]+$/.test(line) && /\d/.test(line);
}

function parseV2000CountsLine(line: string, lineNumber: number): MolCountsLine {
  const isV3000 = /V3000/i.test(line);
  const version: MolfileVersion = isV3000 ? "V3000" : "V2000";

  let atomCount = parseIntField(line, 0, 3, Number.NaN);
  let bondCount = parseIntField(line, 3, 6, Number.NaN);
  let chiralVal = parseIntField(line, 12, 15, 0);

  if (Number.isNaN(atomCount) || Number.isNaN(bondCount)) {
    const tokens = line.trim().split(/\s+/);
    const a = Number.parseInt(tokens[0] ?? "", 10);
    const b = Number.parseInt(tokens[1] ?? "", 10);
    atomCount = Number.isNaN(a) ? 0 : a;
    bondCount = Number.isNaN(b) ? 0 : b;
    const c = Number.parseInt(tokens[4] ?? "0", 10);
    chiralVal = Number.isNaN(c) ? 0 : c;
  }

  return {
    atomCount,
    bondCount,
    chiralFlag: chiralVal === 1,
    version,
    line: lineNumber,
    raw: line,
  };
}

function parseV2000AtomLine(line: string, index: number, lineNumber: number): MolAtom | null {
  let x = parseFloatField(line, 0, 10);
  let y = parseFloatField(line, 10, 20);
  let z = parseFloatField(line, 20, 30);
  let element = line.length >= 32 ? line.slice(31, 34).trim() : "";
  let massDiff = parseIntField(line, 34, 36, 0);
  let chargeCode = parseIntField(line, 36, 39, 0);
  let stereoParity = parseIntField(line, 39, 42, 0);
  let valence = parseIntField(line, 48, 51, 0);
  const atomMapVal = parseIntField(line, 60, 63, 0);

  // Whitespace-separated fallback for loosely formatted V2000 atom lines
  if (Number.isNaN(x) || Number.isNaN(y) || Number.isNaN(z) || element.length === 0) {
    const tokens = line.trim().split(/\s+/);
    if (tokens.length < 4) return null;
    x = Number.parseFloat(tokens[0]!);
    y = Number.parseFloat(tokens[1]!);
    z = Number.parseFloat(tokens[2]!);
    element = tokens[3]!;
    if (Number.isNaN(x) || Number.isNaN(y) || Number.isNaN(z)) return null;
    massDiff = tokens[4] !== undefined ? Number.parseInt(tokens[4], 10) || 0 : 0;
    chargeCode = tokens[5] !== undefined ? Number.parseInt(tokens[5], 10) || 0 : 0;
    stereoParity = tokens[6] !== undefined ? Number.parseInt(tokens[6], 10) || 0 : 0;
    valence = tokens[9] !== undefined ? Number.parseInt(tokens[9], 10) || 0 : 0;
  }

  const decoded = decodeV2000ChargeCode(chargeCode);

  return {
    index,
    x,
    y,
    z,
    element,
    massDiff,
    charge: decoded.charge,
    radical: decoded.radical,
    stereoParity,
    valence,
    atomMap: atomMapVal > 0 ? atomMapVal : undefined,
    line: lineNumber,
  };
}

function parseV2000BondLine(line: string, index: number, lineNumber: number): MolBond | null {
  let atom1 = parseIntField(line, 0, 3, Number.NaN);
  let atom2 = parseIntField(line, 3, 6, Number.NaN);
  let order = parseIntField(line, 6, 9, Number.NaN);
  let stereo = parseIntField(line, 9, 12, 0);
  let topology = parseIntField(line, 15, 18, 0);

  if (Number.isNaN(atom1) || Number.isNaN(atom2) || Number.isNaN(order)) {
    const tokens = line.trim().split(/\s+/);
    if (tokens.length < 3) return null;
    atom1 = Number.parseInt(tokens[0]!, 10);
    atom2 = Number.parseInt(tokens[1]!, 10);
    order = Number.parseInt(tokens[2]!, 10);
    stereo = tokens[3] !== undefined ? Number.parseInt(tokens[3], 10) || 0 : 0;
    topology = tokens[5] !== undefined ? Number.parseInt(tokens[5], 10) || 0 : 0;
    if (Number.isNaN(atom1) || Number.isNaN(atom2) || Number.isNaN(order)) return null;
  }

  return {
    index,
    atom1,
    atom2,
    order,
    stereo,
    topology,
    line: lineNumber,
  };
}

function classifyPropertyLine(line: string): MolPropertyKind {
  if (/^M\s+END\b/.test(line)) return "END";
  if (/^M\s+CHG\b/.test(line)) return "CHG";
  if (/^M\s+ISO\b/.test(line)) return "ISO";
  if (/^M\s+RAD\b/.test(line)) return "RAD";
  if (/^M\s+RGP\b/.test(line)) return "RGP";
  if (/^M\s+V30\b/.test(line)) return "V30";
  return "OTHER";
}

function mapV3000BondCfgToV2000Stereo(cfg: number): number {
  switch (cfg) {
    case 1:
      return 1; // up
    case 2:
      return 4; // either
    case 3:
      return 6; // down
    default:
      return 0;
  }
}

/**
 * Joins V3000 continuation lines (trailing `-` on `M  V30` lines).
 */
function collectV3000LogicalLines(
  lines: string[],
  startIdx: number,
  baseLineNumber: number,
): {
  v30Lines: Array<{ body: string; line: number }>;
  endIdx: number;
  hasMEnd: boolean;
  properties: MolPropertyLine[];
} {
  const v30Lines: Array<{ body: string; line: number }> = [];
  const properties: MolPropertyLine[] = [];
  let hasMEnd = false;
  let i = startIdx;

  while (i < lines.length) {
    const raw = lines[i]!;
    const lineNum = baseLineNumber + i;
    if (/^M\s+END\b/.test(raw)) {
      properties.push({ kind: "END", raw, line: lineNum });
      hasMEnd = true;
      i++;
      break;
    }
    if (raw.startsWith(">") || raw.trim() === "$$$$") {
      break;
    }
    if (/^M\s+V30\s/.test(raw)) {
      properties.push({ kind: "V30", raw, line: lineNum });
      let body = raw.replace(/^M\s+V30\s+/, "");
      const startLine = lineNum;
      while (body.endsWith("-") && i + 1 < lines.length && /^M\s+V30\s/.test(lines[i + 1]!)) {
        body = body.slice(0, -1);
        i++;
        const contRaw = lines[i]!;
        properties.push({ kind: "V30", raw: contRaw, line: baseLineNumber + i });
        body += contRaw.replace(/^M\s+V30\s+/, "");
      }
      v30Lines.push({ body: body.trim(), line: startLine });
    } else if (/^M\s+/.test(raw)) {
      properties.push({ kind: classifyPropertyLine(raw), raw, line: lineNum });
    }
    i++;
  }

  return { v30Lines, endIdx: i, hasMEnd, properties };
}

function parseV3000Block(
  v30Lines: Array<{ body: string; line: number }>,
  counts: MolCountsLine,
  parseErrors: MolParseError[],
): { atoms: MolAtom[]; bonds: MolBond[]; counts: MolCountsLine } {
  const atoms: MolAtom[] = [];
  const bonds: MolBond[] = [];
  let updatedCounts = { ...counts, version: "V3000" as MolfileVersion };

  let mode: "none" | "ctab" | "atom" | "bond" = "none";

  for (const { body, line } of v30Lines) {
    if (/^BEGIN\s+CTAB\b/i.test(body)) {
      mode = "ctab";
      continue;
    }
    if (/^END\s+CTAB\b/i.test(body)) {
      mode = "none";
      continue;
    }
    if (/^BEGIN\s+ATOM\b/i.test(body)) {
      mode = "atom";
      continue;
    }
    if (/^END\s+ATOM\b/i.test(body)) {
      mode = "ctab";
      continue;
    }
    if (/^BEGIN\s+BOND\b/i.test(body)) {
      mode = "bond";
      continue;
    }
    if (/^END\s+BOND\b/i.test(body)) {
      mode = "ctab";
      continue;
    }
    if (/^COUNTS\s+/i.test(body)) {
      const tokens = body.split(/\s+/);
      const natoms = Number.parseInt(tokens[1] ?? "0", 10);
      const nbonds = Number.parseInt(tokens[2] ?? "0", 10);
      const chiral = Number.parseInt(tokens[5] ?? "0", 10);
      updatedCounts = {
        atomCount: Number.isNaN(natoms) ? 0 : natoms,
        bondCount: Number.isNaN(nbonds) ? 0 : nbonds,
        chiralFlag: chiral === 1,
        version: "V3000",
        line,
        raw: `M  V30 ${body}`,
      };
      continue;
    }

    if (mode === "atom") {
      // Format: <index> <type> <x> <y> <z> <aamap> [KEY=VAL ...]
      const tokens = body.split(/\s+/);
      if (tokens.length < 6) {
        parseErrors.push({ message: `Malformed V3000 atom line '${body}'`, line });
        continue;
      }
      const idx = Number.parseInt(tokens[0]!, 10);
      const element = tokens[1]!.replace(/^"|"$/g, "");
      const x = Number.parseFloat(tokens[2]!);
      const y = Number.parseFloat(tokens[3]!);
      const z = Number.parseFloat(tokens[4]!);
      const aamap = Number.parseInt(tokens[5]!, 10);

      if (Number.isNaN(idx) || Number.isNaN(x) || Number.isNaN(y) || Number.isNaN(z)) {
        parseErrors.push({ message: `Invalid numeric fields in V3000 atom line '${body}'`, line });
        continue;
      }

      let charge = 0;
      let radical = 0;
      let stereoParity = 0;
      let isotope: number | undefined;
      let valence = 0;

      for (let t = 6; t < tokens.length; t++) {
        const kv = tokens[t]!;
        const eqIdx = kv.indexOf("=");
        if (eqIdx < 0) continue;
        const k = kv.slice(0, eqIdx).toUpperCase();
        const v = Number.parseInt(kv.slice(eqIdx + 1), 10);
        if (Number.isNaN(v)) continue;
        if (k === "CHG") charge = v;
        else if (k === "RAD") radical = v;
        else if (k === "CFG") stereoParity = v;
        else if (k === "MASS") isotope = v;
        else if (k === "VAL") valence = v === -1 ? 15 : v;
      }

      atoms.push({
        index: idx,
        x,
        y,
        z,
        element,
        massDiff: 0,
        isotope,
        charge,
        radical,
        stereoParity,
        valence,
        atomMap: !Number.isNaN(aamap) && aamap > 0 ? aamap : undefined,
        line,
      });
    } else if (mode === "bond") {
      // Format: <index> <type> <atom1> <atom2> [CFG=n] [TOPO=n]
      const tokens = body.split(/\s+/);
      if (tokens.length < 4) {
        parseErrors.push({ message: `Malformed V3000 bond line '${body}'`, line });
        continue;
      }
      const idx = Number.parseInt(tokens[0]!, 10);
      const order = Number.parseInt(tokens[1]!, 10);
      const atom1 = Number.parseInt(tokens[2]!, 10);
      const atom2 = Number.parseInt(tokens[3]!, 10);

      if (Number.isNaN(idx) || Number.isNaN(order) || Number.isNaN(atom1) || Number.isNaN(atom2)) {
        parseErrors.push({ message: `Invalid numeric fields in V3000 bond line '${body}'`, line });
        continue;
      }

      let stereo = 0;
      let topology = 0;

      for (let t = 4; t < tokens.length; t++) {
        const kv = tokens[t]!;
        const eqIdx = kv.indexOf("=");
        if (eqIdx < 0) continue;
        const k = kv.slice(0, eqIdx).toUpperCase();
        const v = Number.parseInt(kv.slice(eqIdx + 1), 10);
        if (Number.isNaN(v)) continue;
        if (k === "CFG") stereo = mapV3000BondCfgToV2000Stereo(v);
        else if (k === "TOPO") topology = v;
      }

      bonds.push({
        index: idx,
        atom1,
        atom2,
        order,
        stereo,
        topology,
        line,
      });
    }
  }

  return { atoms, bonds, counts: updatedCounts };
}

function parseSdfDataItems(
  lines: string[],
  startIdx: number,
  baseLineNumber: number,
): { dataItems: Record<string, string>; sdfDataItems: SdfDataItem[] } {
  const dataItems: Record<string, string> = {};
  const sdfDataItems: SdfDataItem[] = [];
  let i = startIdx;

  while (i < lines.length) {
    const line = lines[i]!;
    const match = /^>\s*(?:[^<]*?)<([^>]+)>/.exec(line);
    if (match) {
      const tag = match[1]!.trim();
      const headerLine = baseLineNumber + i;
      i++;
      const valueLines: string[] = [];
      while (i < lines.length) {
        const valLine = lines[i]!;
        if (valLine.trim() === "" || valLine.startsWith(">") || valLine.trim() === "$$$$") {
          break;
        }
        valueLines.push(valLine);
        i++;
      }
      const value = valueLines.join("\n");
      dataItems[tag] = value;
      sdfDataItems.push({ tag, value, line: headerLine });
    } else {
      i++;
    }
  }

  return { dataItems, sdfDataItems };
}

function parseSingleRecord(
  recordLines: string[],
  recordIdx: number,
  baseLineNumber: number,
  startOffset: number,
  endOffset: number,
): MolRecord {
  const parseErrors: MolParseError[] = [];

  const title = (recordLines[0] ?? "").trim();
  const programLine = recordLines[1] ?? "";
  const comment = (recordLines[2] ?? "").trim();

  let dimensionCode: "2D" | "3D" | "" = "";
  const dimSlice = programLine.length >= 22 ? programLine.slice(20, 22).trim().toUpperCase() : "";
  if (dimSlice === "2D" || dimSlice === "3D") {
    dimensionCode = dimSlice;
  } else if (/\b3D\b/i.test(programLine)) {
    dimensionCode = "3D";
  } else if (/\b2D\b/i.test(programLine)) {
    dimensionCode = "2D";
  }

  const header: MolHeader = {
    title,
    programLine,
    comment,
    dimensionCode,
  };

  if (recordLines.length < 4) {
    parseErrors.push({
      message: "Incomplete Molfile record: expected at least 4 lines (3 header lines + counts line)",
      line: baseLineNumber,
    });
    const name = title || `Molecule_${recordIdx + 1}`;
    return {
      id: `mol_${recordIdx + 1}`,
      name,
      header,
      counts: {
        atomCount: 0,
        bondCount: 0,
        chiralFlag: false,
        version: "V2000",
        line: baseLineNumber + Math.min(3, Math.max(0, recordLines.length - 1)),
        raw: recordLines[3] ?? "",
      },
      atoms: [],
      bonds: [],
      properties: [],
      hasMEnd: false,
      dataItems: {},
      sdfDataItems: [],
      range: {
        startLine: baseLineNumber,
        startColumn: 1,
        endLine: baseLineNumber + Math.max(0, recordLines.length - 1),
        endColumn: Math.max(1, (recordLines[recordLines.length - 1] ?? "").length + 1),
        startOffset,
        endOffset,
      },
      parseErrors,
    };
  }

  const countsLineRaw = recordLines[3]!;
  let counts = parseV2000CountsLine(countsLineRaw, baseLineNumber + 3);
  let atoms: MolAtom[] = [];
  let bonds: MolBond[] = [];
  let properties: MolPropertyLine[] = [];
  let hasMEnd = false;
  let cursor = 4;

  if (counts.version === "V3000") {
    const v30Res = collectV3000LogicalLines(recordLines, cursor, baseLineNumber);
    const parsedV30 = parseV3000Block(v30Res.v30Lines, counts, parseErrors);
    atoms = parsedV30.atoms;
    bonds = parsedV30.bonds;
    counts = parsedV30.counts;
    properties = v30Res.properties;
    hasMEnd = v30Res.hasMEnd;
    cursor = v30Res.endIdx;
  } else {
    // V2000 Atom Block: read all contiguous atom lines (even if count differs from counts line)
    let atomIndex = 1;
    while (cursor < recordLines.length) {
      const line = recordLines[cursor]!;
      const trimmed = line.trim();
      if (trimmed.startsWith("M  ") || trimmed.startsWith(">") || trimmed === "$$$$") break;
      if (!looksLikeV2000AtomLine(line)) {
        // Stop atom block when bond block or empty/invalid section begins
        if (looksLikeV2000BondLine(line)) break;
        if (atoms.length >= counts.atomCount) break;
        parseErrors.push({
          message: `Malformed V2000 atom line '${trimmed}'`,
          line: baseLineNumber + cursor,
        });
        cursor++;
        continue;
      }
      const atom = parseV2000AtomLine(line, atomIndex, baseLineNumber + cursor);
      if (atom) {
        atoms.push(atom);
        atomIndex++;
      } else {
        parseErrors.push({
          message: `Could not parse V2000 atom line '${trimmed}'`,
          line: baseLineNumber + cursor,
        });
      }
      cursor++;
    }

    // V2000 Bond Block: read all contiguous bond lines
    let bondIndex = 1;
    while (cursor < recordLines.length) {
      const line = recordLines[cursor]!;
      const trimmed = line.trim();
      if (trimmed.startsWith("M  ") || trimmed.startsWith(">") || trimmed === "$$$$") break;
      if (trimmed.length === 0) {
        cursor++;
        continue;
      }
      const bond = parseV2000BondLine(line, bondIndex, baseLineNumber + cursor);
      if (bond) {
        bonds.push(bond);
        bondIndex++;
      } else {
        parseErrors.push({
          message: `Malformed V2000 bond line '${trimmed}'`,
          line: baseLineNumber + cursor,
        });
      }
      cursor++;
    }

    // V2000 Property Block
    let sawMChg = false;
    let sawMRad = false;
    const chgUpdates: Array<{ atomIdx: number; value: number }> = [];
    const isoUpdates: Array<{ atomIdx: number; value: number }> = [];
    const radUpdates: Array<{ atomIdx: number; value: number }> = [];

    while (cursor < recordLines.length) {
      const line = recordLines[cursor]!;
      const lineNum = baseLineNumber + cursor;
      if (line.startsWith(">") || line.trim() === "$$$$") break;
      if (/^M\s+/.test(line)) {
        const kind = classifyPropertyLine(line);
        properties.push({ kind, raw: line, line: lineNum });
        if (kind === "END") {
          hasMEnd = true;
          cursor++;
          break;
        }
        if (kind === "CHG" || kind === "ISO" || kind === "RAD") {
          const tokens = line.trim().split(/\s+/);
          // tokens: ["M", "CHG", "<count>", "<idx1>", "<val1>", ...]
          const pairCount = Number.parseInt(tokens[2] ?? "0", 10);
          if (!Number.isNaN(pairCount) && pairCount > 0) {
            if (kind === "CHG") sawMChg = true;
            if (kind === "RAD") sawMRad = true;
            for (let p = 0; p < pairCount; p++) {
              const aIdx = Number.parseInt(tokens[3 + p * 2] ?? "", 10);
              const val = Number.parseInt(tokens[4 + p * 2] ?? "", 10);
              if (!Number.isNaN(aIdx) && !Number.isNaN(val)) {
                if (kind === "CHG") chgUpdates.push({ atomIdx: aIdx, value: val });
                else if (kind === "ISO") isoUpdates.push({ atomIdx: aIdx, value: val });
                else if (kind === "RAD") radUpdates.push({ atomIdx: aIdx, value: val });
              }
            }
          }
        }
      }
      cursor++;
    }

    // Per CTfile specification: M  CHG / M  RAD supersede atom-block charge/radical codes
    if (sawMChg) {
      for (const atom of atoms) atom.charge = 0;
      for (const upd of chgUpdates) {
        const atom = atoms[upd.atomIdx - 1];
        if (atom) atom.charge = upd.value;
      }
    }
    if (sawMRad) {
      for (const atom of atoms) atom.radical = 0;
      for (const upd of radUpdates) {
        const atom = atoms[upd.atomIdx - 1];
        if (atom) atom.radical = upd.value;
      }
    }
    for (const upd of isoUpdates) {
      const atom = atoms[upd.atomIdx - 1];
      if (atom) atom.isotope = upd.value;
    }
  }

  // SDF Data Items (if any follow M  END)
  const { dataItems, sdfDataItems } = parseSdfDataItems(recordLines, cursor, baseLineNumber);

  const name =
    title ||
    dataItems["NAME"] ||
    dataItems["Name"] ||
    dataItems["COMMON_NAME"] ||
    dataItems["ID"] ||
    `Molecule_${recordIdx + 1}`;

  const endLine = baseLineNumber + Math.max(0, recordLines.length - 1);
  const lastLineText = recordLines[recordLines.length - 1] ?? "";

  return {
    id: `mol_${recordIdx + 1}`,
    name,
    header,
    counts,
    atoms,
    bonds,
    properties,
    hasMEnd,
    dataItems,
    sdfDataItems,
    range: {
      startLine: baseLineNumber,
      startColumn: 1,
      endLine,
      endColumn: Math.max(1, lastLineText.length + 1),
      startOffset,
      endOffset,
    },
    parseErrors,
  };
}

/**
 * Parses an MDL Molfile (V2000 or V3000) or multi-record SDF document into a structured `MolfileDocument`.
 */
export function parseMolfileDocument(text: string, sourceFile?: string): MolfileDocument {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const allLines = normalized.split("\n");

  // Compute starting byte offset for each line
  const lineOffsets: number[] = [];
  let offset = 0;
  for (const l of allLines) {
    lineOffsets.push(offset);
    offset += l.length + 1;
  }

  const hasSdfDelimiter = allLines.some((l) => l.trim() === "$$$$");
  const format: "mol" | "sdf" =
    hasSdfDelimiter || (sourceFile !== undefined && sourceFile.toLowerCase().endsWith(".sdf")) ? "sdf" : "mol";

  const records: MolRecord[] = [];
  let blockStart = 0;

  for (let i = 0; i < allLines.length; i++) {
    if (allLines[i]!.trim() === "$$$$") {
      const slice = allLines.slice(blockStart, i);
      if (slice.some((l) => l.trim().length > 0)) {
        const startOff = lineOffsets[blockStart] ?? 0;
        const endOff = (lineOffsets[i] ?? normalized.length) + allLines[i]!.length;
        records.push(parseSingleRecord(slice, records.length, blockStart + 1, startOff, endOff));
      }
      blockStart = i + 1;
    }
  }

  // Remaining lines after last $$$$ (or entire file if no $$$$)
  if (blockStart < allLines.length) {
    const slice = allLines.slice(blockStart);
    if (slice.some((l) => l.trim().length > 0)) {
      const startOff = lineOffsets[blockStart] ?? 0;
      const endOff = normalized.length;
      records.push(parseSingleRecord(slice, records.length, blockStart + 1, startOff, endOff));
    }
  }

  return {
    format,
    sourceFile,
    records,
    rawText: text,
  };
}
