// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * STAR / IUCr CIF 1.1 Lexer, Parser, Standard-Uncertainty Parser, and Crystal Structure Extractor.
 */

import type {
  AtomSite,
  CifDataBlock,
  CifDocument,
  CifLoop,
  CifNumericValue,
  CifParseError,
  CifTagEntry,
  CifValue,
  CrystalStructure,
  UnitCellParams,
} from "../types.js";

const NUMERIC_SU_REGEX = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)(?:\((\d+)\))?$/;

/**
 * Parses a CIF numeric string with optional standard uncertainty in parentheses,
 * e.g. `5.4310(2)` -> `{ value: 5.431, su: 0.0002 }`, `1.23e-4(5)` -> `{ value: 1.23e-4, su: 5e-6 }`.
 */
export function parseCifNumber(raw: string): CifNumericValue | undefined {
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "?" || trimmed === ".") return undefined;
  const match = NUMERIC_SU_REGEX.exec(trimmed);
  if (!match) return undefined;

  const numPart = match[1];
  const suDigits = match[2];
  if (!numPart) return undefined;

  const value = Number(numPart);
  if (!Number.isFinite(value)) return undefined;

  if (!suDigits) {
    return { value, raw: trimmed };
  }

  const suInt = Number.parseInt(suDigits, 10);
  // Determine decimal places in mantissa and optional exponent
  const expIdx = numPart.search(/[eE]/);
  const mantissa = expIdx >= 0 ? numPart.slice(0, expIdx) : numPart;
  const exponent = expIdx >= 0 ? Number.parseInt(numPart.slice(expIdx + 1), 10) : 0;
  const dotIdx = mantissa.indexOf(".");
  const decimalPlaces = dotIdx >= 0 ? mantissa.length - dotIdx - 1 : 0;
  const su = suInt * Math.pow(10, exponent - decimalPlaces);

  return { value, su, raw: trimmed };
}

type TokenKind = "DATA" | "LOOP" | "SAVE" | "STOP" | "GLOBAL" | "TAG" | "VALUE";

interface LexToken {
  kind: TokenKind;
  raw: string;
  value: string;
  quoted: boolean;
  line: number;
  column: number;
  startOffset: number;
  endOffset: number;
}

function isWhitespace(ch: string): boolean {
  return ch === " " || ch === "\t" || ch === "\r" || ch === "\n";
}

function tokenizeCif(source: string): {
  tokens: LexToken[];
  errors: CifParseError[];
  comments: string[];
} {
  const tokens: LexToken[] = [];
  const errors: CifParseError[] = [];
  const comments: string[] = [];

  const len = source.length;
  let i = 0;
  let line = 1;
  let col = 1;

  while (i < len) {
    const ch = source[i]!;

    // Whitespace
    if (isWhitespace(ch)) {
      if (ch === "\n") {
        line++;
        col = 1;
      } else {
        col++;
      }
      i++;
      continue;
    }

    // Comment
    if (ch === "#") {
      const start = i;
      while (i < len && source[i] !== "\n") {
        i++;
        col++;
      }
      comments.push(source.slice(start + 1, i).trim());
      continue;
    }

    // Semicolon-delimited multiline text field (must start at column 1)
    if (ch === ";" && col === 1) {
      const startOffset = i;
      const startLine = line;
      const startCol = col;
      i++; // skip opening ';'
      col++;
      const contentStart = i;
      let closed = false;
      let contentEnd = i;

      while (i < len) {
        if (source[i] === "\n") {
          i++;
          line++;
          col = 1;
          if (i < len && source[i] === ";") {
            contentEnd = i - 1;
            if (contentEnd > contentStart && source[contentEnd - 1] === "\r") {
              contentEnd--;
            }
            i++; // skip closing ';'
            col++;
            closed = true;
            break;
          }
        } else {
          i++;
          col++;
        }
      }

      if (!closed) {
        errors.push({
          message: "Unterminated semicolon-delimited text field",
          line: startLine,
          column: startCol,
        });
        contentEnd = i;
      }

      let body = source.slice(contentStart, contentEnd);
      if (body.startsWith("\r\n")) body = body.slice(2);
      else if (body.startsWith("\n")) body = body.slice(1);

      tokens.push({
        kind: "VALUE",
        raw: source.slice(startOffset, i),
        value: body,
        quoted: true,
        line: startLine,
        column: startCol,
        startOffset,
        endOffset: i,
      });
      continue;
    }

    // Single or double quoted string (CIF 1.1: closing quote followed by whitespace or EOF)
    if (ch === "'" || ch === '"') {
      const quote = ch;
      const startOffset = i;
      const startLine = line;
      const startCol = col;
      i++;
      col++;
      const contentStart = i;
      let closed = false;

      while (i < len && source[i] !== "\n" && source[i] !== "\r") {
        if (source[i] === quote) {
          const next = i + 1 < len ? source[i + 1]! : "";
          if (next === "" || isWhitespace(next)) {
            const val = source.slice(contentStart, i);
            i++;
            col++;
            tokens.push({
              kind: "VALUE",
              raw: source.slice(startOffset, i),
              value: val,
              quoted: true,
              line: startLine,
              column: startCol,
              startOffset,
              endOffset: i,
            });
            closed = true;
            break;
          }
        }
        i++;
        col++;
      }

      if (!closed) {
        errors.push({
          message: `Unterminated ${quote === "'" ? "single" : "double"}-quoted string`,
          line: startLine,
          column: startCol,
        });
        tokens.push({
          kind: "VALUE",
          raw: source.slice(startOffset, i),
          value: source.slice(contentStart, i),
          quoted: true,
          line: startLine,
          column: startCol,
          startOffset,
          endOffset: i,
        });
      }
      continue;
    }

    // Unquoted token
    const startOffset = i;
    const startLine = line;
    const startCol = col;
    while (i < len && !isWhitespace(source[i]!)) {
      i++;
      col++;
    }
    const raw = source.slice(startOffset, i);
    const lower = raw.toLowerCase();

    if (lower.startsWith("data_")) {
      tokens.push({
        kind: "DATA",
        raw,
        value: raw.slice(5),
        quoted: false,
        line: startLine,
        column: startCol,
        startOffset,
        endOffset: i,
      });
    } else if (lower === "loop_") {
      tokens.push({
        kind: "LOOP",
        raw,
        value: raw,
        quoted: false,
        line: startLine,
        column: startCol,
        startOffset,
        endOffset: i,
      });
    } else if (lower.startsWith("save_")) {
      tokens.push({
        kind: "SAVE",
        raw,
        value: raw.slice(5),
        quoted: false,
        line: startLine,
        column: startCol,
        startOffset,
        endOffset: i,
      });
    } else if (lower === "stop_") {
      tokens.push({
        kind: "STOP",
        raw,
        value: raw,
        quoted: false,
        line: startLine,
        column: startCol,
        startOffset,
        endOffset: i,
      });
    } else if (lower === "global_") {
      tokens.push({
        kind: "GLOBAL",
        raw,
        value: raw,
        quoted: false,
        line: startLine,
        column: startCol,
        startOffset,
        endOffset: i,
      });
    } else if (raw.startsWith("_")) {
      if (raw.length === 1) {
        errors.push({
          message: "Empty data tag '_' without identifier",
          line: startLine,
          column: startCol,
        });
      }
      tokens.push({
        kind: "TAG",
        raw,
        value: raw,
        quoted: false,
        line: startLine,
        column: startCol,
        startOffset,
        endOffset: i,
      });
    } else {
      tokens.push({
        kind: "VALUE",
        raw,
        value: raw,
        quoted: false,
        line: startLine,
        column: startCol,
        startOffset,
        endOffset: i,
      });
    }
  }

  return { tokens, errors, comments };
}

function makeCifValue(tok: LexToken): CifValue {
  if (!tok.quoted) {
    if (tok.value === "?") {
      return {
        raw: tok.raw,
        value: "?",
        kind: "unknown",
        line: tok.line,
        column: tok.column,
      };
    }
    if (tok.value === ".") {
      return {
        raw: tok.raw,
        value: ".",
        kind: "inapplicable",
        line: tok.line,
        column: tok.column,
      };
    }
    const numeric = parseCifNumber(tok.value);
    if (numeric) {
      return {
        raw: tok.raw,
        value: tok.value,
        kind: "number",
        numeric,
        line: tok.line,
        column: tok.column,
      };
    }
  }

  return {
    raw: tok.raw,
    value: tok.value,
    kind: "string",
    line: tok.line,
    column: tok.column,
  };
}

/**
 * Parses a STAR / IUCr CIF 1.1 document string into a structured `CifDocument`.
 */
export function parseIucrCif(source: string): CifDocument {
  const { tokens, errors, comments } = tokenizeCif(source);
  const blocks: CifDataBlock[] = [];
  let currentBlock: CifDataBlock | null = null;
  let i = 0;

  while (i < tokens.length) {
    const tok = tokens[i]!;

    if (tok.kind === "DATA") {
      if (currentBlock) {
        currentBlock.endOffset = tok.startOffset;
      }
      if (!tok.value) {
        errors.push({
          message: "Missing block identifier after 'data_'",
          line: tok.line,
          column: tok.column,
        });
      }
      currentBlock = {
        name: tok.value || "unnamed",
        tags: new Map<string, CifTagEntry>(),
        tagEntries: [],
        loops: [],
        line: tok.line,
        column: tok.column,
        startOffset: tok.startOffset,
        endOffset: source.length,
      };
      blocks.push(currentBlock);
      i++;
      continue;
    }

    if (tok.kind === "SAVE" || tok.kind === "STOP" || tok.kind === "GLOBAL") {
      i++;
      continue;
    }

    if (!currentBlock) {
      errors.push({
        message: `Unexpected token '${tok.raw}' outside of a data_ block`,
        line: tok.line,
        column: tok.column,
      });
      i++;
      continue;
    }

    if (tok.kind === "LOOP") {
      const loopLine = tok.line;
      const loopCol = tok.column;
      i++;

      const tags: string[] = [];
      const canonicalTags: string[] = [];
      while (i < tokens.length && tokens[i]!.kind === "TAG") {
        const tagTok = tokens[i]!;
        tags.push(tagTok.value);
        canonicalTags.push(tagTok.value.toLowerCase());
        i++;
      }

      const values: CifValue[] = [];
      while (i < tokens.length && tokens[i]!.kind === "VALUE") {
        values.push(makeCifValue(tokens[i]!));
        i++;
      }

      const rows: CifValue[][] = [];
      if (tags.length > 0 && values.length > 0) {
        const colCount = tags.length;
        for (let r = 0; r < values.length; r += colCount) {
          rows.push(values.slice(r, r + colCount));
        }
      }

      const loop: CifLoop = {
        tags,
        canonicalTags,
        rows,
        rawValueCount: values.length,
        line: loopLine,
        column: loopCol,
      };
      currentBlock.loops.push(loop);
      continue;
    }

    if (tok.kind === "TAG") {
      const next = i + 1 < tokens.length ? tokens[i + 1] : undefined;
      if (!next || next.kind !== "VALUE") {
        errors.push({
          message: `Tag '${tok.value}' is missing a value`,
          line: tok.line,
          column: tok.column,
        });
        i++;
        continue;
      }

      const entry: CifTagEntry = {
        tag: tok.value,
        canonicalTag: tok.value.toLowerCase(),
        value: makeCifValue(next),
        line: tok.line,
        column: tok.column,
      };
      currentBlock.tagEntries.push(entry);
      if (!currentBlock.tags.has(entry.canonicalTag)) {
        currentBlock.tags.set(entry.canonicalTag, entry);
      }
      i += 2;
      continue;
    }

    // Stray value
    errors.push({
      message: `Unexpected standalone value '${tok.raw}' without preceding tag or loop_`,
      line: tok.line,
      column: tok.column,
    });
    i++;
  }

  return { blocks, errors, comments };
}

/**
 * Strips oxidation state and trailing digits from a CIF atom type symbol or label
 * (e.g. `"Fe3+"` -> `"Fe"`, `"Si1"` -> `"Si"`, `"O2-"` -> `"O"`).
 */
export function normalizeElementSymbol(raw: string): string {
  const cleaned = raw.trim().replace(/[0-9+-]+.*$/, "");
  if (!cleaned) return "";
  if (cleaned.length === 1) return cleaned.toUpperCase();
  return cleaned[0]!.toUpperCase() + cleaned.slice(1).toLowerCase();
}

function getTagNumeric(block: CifDataBlock, ...canonicalNames: string[]): CifNumericValue | undefined {
  for (const name of canonicalNames) {
    const entry = block.tags.get(name.toLowerCase());
    if (entry?.value.numeric) return entry.value.numeric;
    if (entry?.value.value) {
      const parsed = parseCifNumber(entry.value.value);
      if (parsed) return parsed;
    }
  }
  return undefined;
}

function getTagString(block: CifDataBlock, ...canonicalNames: string[]): string | undefined {
  for (const name of canonicalNames) {
    const entry = block.tags.get(name.toLowerCase());
    if (entry && entry.value.kind !== "unknown" && entry.value.kind !== "inapplicable") {
      return entry.value.value.trim();
    }
  }
  return undefined;
}

/**
 * Extracts a `CrystalStructure` from a parsed `CifDataBlock`, `CifDocument`, or raw CIF string.
 */
export function extractCrystalStructure(
  input: string | CifDocument | CifDataBlock,
  blockIndex = 0,
): CrystalStructure | null {
  let block: CifDataBlock | undefined;
  if (typeof input === "string") {
    const doc = parseIucrCif(input);
    block = doc.blocks[blockIndex];
  } else if ("blocks" in input) {
    block = input.blocks[blockIndex];
  } else {
    block = input;
  }

  if (!block) return null;

  const aNum = getTagNumeric(block, "_cell_length_a");
  const bNum = getTagNumeric(block, "_cell_length_b");
  const cNum = getTagNumeric(block, "_cell_length_c");
  const alphaNum = getTagNumeric(block, "_cell_angle_alpha");
  const betaNum = getTagNumeric(block, "_cell_angle_beta");
  const gammaNum = getTagNumeric(block, "_cell_angle_gamma");

  const cell: UnitCellParams = {
    a: aNum?.value ?? 1.0,
    b: bNum?.value ?? aNum?.value ?? 1.0,
    c: cNum?.value ?? aNum?.value ?? 1.0,
    alpha: alphaNum?.value ?? 90.0,
    beta: betaNum?.value ?? 90.0,
    gamma: gammaNum?.value ?? 90.0,
    aSu: aNum?.su,
    bSu: bNum?.su,
    cSu: cNum?.su,
    alphaSu: alphaNum?.su,
    betaSu: betaNum?.su,
    gammaSu: gammaNum?.su,
  };

  const spaceGroupName = getTagString(
    block,
    "_symmetry_space_group_name_h-m",
    "_space_group_name_h-m_alt",
    "_symmetry_space_group_name_hall",
  );
  const sgNum = getTagNumeric(block, "_symmetry_int_tables_number", "_space_group_it_number");
  const zNum = getTagNumeric(block, "_cell_formula_units_z");
  const formula = getTagString(block, "_chemical_formula_sum", "_chemical_formula_structural");
  const wavelengthNum = getTagNumeric(block, "_diffrn_radiation_wavelength");

  // Extract symmetry operations from loop or scalar
  const symmetryOps: string[] = [];
  for (const loop of block.loops) {
    const symIdx = loop.canonicalTags.findIndex(
      (t) => t === "_symmetry_equiv_pos_as_xyz" || t === "_space_group_symop_operation_xyz",
    );
    if (symIdx >= 0) {
      for (const row of loop.rows) {
        const val = row[symIdx];
        if (val && val.kind !== "unknown" && val.kind !== "inapplicable") {
          symmetryOps.push(val.value.trim());
        }
      }
    }
  }
  if (symmetryOps.length === 0) {
    const singleOp = getTagString(block, "_symmetry_equiv_pos_as_xyz", "_space_group_symop_operation_xyz");
    if (singleOp) symmetryOps.push(singleOp);
  }

  // Extract asymmetric atom sites
  const asymmetricAtoms: AtomSite[] = [];
  for (const loop of block.loops) {
    const xIdx = loop.canonicalTags.indexOf("_atom_site_fract_x");
    const yIdx = loop.canonicalTags.indexOf("_atom_site_fract_y");
    const zIdx = loop.canonicalTags.indexOf("_atom_site_fract_z");
    if (xIdx < 0 || yIdx < 0 || zIdx < 0) continue;

    const labelIdx = loop.canonicalTags.indexOf("_atom_site_label");
    const symIdx = loop.canonicalTags.indexOf("_atom_site_type_symbol");
    const occIdx = loop.canonicalTags.indexOf("_atom_site_occupancy");
    const bIsoIdx = loop.canonicalTags.indexOf("_atom_site_b_iso_or_equiv");
    const uIsoIdx = loop.canonicalTags.indexOf("_atom_site_u_iso_or_equiv");
    const multIdx = loop.canonicalTags.indexOf("_atom_site_symmetry_multiplicity");
    const wyckIdx = loop.canonicalTags.indexOf("_atom_site_wyckoff_symbol");

    for (let r = 0; r < loop.rows.length; r++) {
      const row = loop.rows[r]!;
      const xVal = row[xIdx]?.numeric ?? (row[xIdx] ? parseCifNumber(row[xIdx].value) : undefined);
      const yVal = row[yIdx]?.numeric ?? (row[yIdx] ? parseCifNumber(row[yIdx].value) : undefined);
      const zVal = row[zIdx]?.numeric ?? (row[zIdx] ? parseCifNumber(row[zIdx].value) : undefined);
      if (!xVal || !yVal || !zVal) continue;

      const label = labelIdx >= 0 && row[labelIdx] ? row[labelIdx].value : `Atom${r + 1}`;
      const rawSymbol = symIdx >= 0 && row[symIdx] ? row[symIdx].value : label;
      const symbol = normalizeElementSymbol(rawSymbol);

      const occVal =
        occIdx >= 0 && row[occIdx] ? (row[occIdx].numeric ?? parseCifNumber(row[occIdx].value)) : undefined;
      const bIsoVal =
        bIsoIdx >= 0 && row[bIsoIdx] ? (row[bIsoIdx].numeric ?? parseCifNumber(row[bIsoIdx].value)) : undefined;
      const uIsoVal =
        uIsoIdx >= 0 && row[uIsoIdx] ? (row[uIsoIdx].numeric ?? parseCifNumber(row[uIsoIdx].value)) : undefined;
      const multVal =
        multIdx >= 0 && row[multIdx] ? (row[multIdx].numeric ?? parseCifNumber(row[multIdx].value)) : undefined;
      const wyckVal = wyckIdx >= 0 && row[wyckIdx] && row[wyckIdx].kind === "string" ? row[wyckIdx].value : undefined;

      const bIso = bIsoVal?.value ?? (uIsoVal !== undefined ? 8 * Math.PI * Math.PI * uIsoVal.value : undefined);

      asymmetricAtoms.push({
        label,
        symbol,
        fractX: xVal.value,
        fractY: yVal.value,
        fractZ: zVal.value,
        occupancy: occVal?.value ?? 1.0,
        bIso,
        uIso: uIsoVal?.value,
        multiplicity: multVal?.value,
        wyckoff: wyckVal,
        line: row[xIdx]?.line,
      });
    }
  }

  return {
    name: block.name,
    cell,
    spaceGroupName,
    spaceGroupNumber: sgNum?.value,
    symmetryOps,
    asymmetricAtoms,
    zFormulaUnits: zNum?.value,
    formula,
    wavelength: wavelengthNum?.value,
  };
}
