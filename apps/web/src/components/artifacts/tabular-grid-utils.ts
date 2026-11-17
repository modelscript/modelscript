// SPDX-License-Identifier: AGPL-3.0-or-later

import Papa from "papaparse";
import { parseTabularDataInput, type TabularTable } from "../../util/tabular-data-parser.js";

export interface TabularGridTable {
  id: string;
  name: string;
  headers: string[];
  rows: string[][];
}

export interface ParsedTabularGrid {
  format: string;
  delimiter: string;
  editable: boolean;
  leadingComments: string[];
  headers: string[];
  rows: string[][];
  rowLineNumbers: number[];
  tables?: TabularGridTable[] | undefined;
}

export interface ParseTabularGridOptions {
  dialect?: string | undefined;
  format?: string | undefined;
  delimiter?: string | undefined;
  hasHeader?: boolean | undefined;
}

function detectDelimiter(lines: string[], explicit?: string, format?: string): string {
  if (explicit && explicit.length > 0) return explicit;
  if (format?.toLowerCase() === "tsv") return "\t";
  const sample = lines.slice(0, 5).filter((l) => l.trim().length > 0);
  if (sample.length === 0) return ",";
  const first = sample[0] ?? "";
  const tabCount = (first.match(/\t/g) ?? []).length;
  const commaCount = (first.match(/,/g) ?? []).length;
  const semiCount = (first.match(/;/g) ?? []).length;
  if (tabCount > commaCount && tabCount >= semiCount && tabCount > 0) return "\t";
  if (semiCount > commaCount && semiCount > tabCount && semiCount > 0) return ";";
  return ",";
}

function parsePdbGrid(text: string): ParsedTabularGrid {
  const lines = text.split(/\r?\n/);
  const headers = [
    "Record",
    "Serial",
    "Atom",
    "ResName",
    "Chain",
    "ResSeq",
    "X",
    "Y",
    "Z",
    "Occupancy",
    "B-Factor",
    "Element",
  ];
  const rows: string[][] = [];
  const rowLineNumbers: number[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const rec = line.slice(0, 6).trim();
    if (rec === "ATOM" || rec === "HETATM") {
      rows.push([
        rec,
        line.slice(6, 11).trim(),
        line.slice(12, 16).trim(),
        line.slice(17, 20).trim(),
        line.slice(21, 22).trim(),
        line.slice(22, 26).trim(),
        line.slice(30, 38).trim(),
        line.slice(38, 46).trim(),
        line.slice(46, 54).trim(),
        line.slice(54, 60).trim(),
        line.slice(60, 66).trim(),
        line.slice(76, 78).trim(),
      ]);
      rowLineNumbers.push(i + 1);
    }
  }

  // Fallback for mmCIF (_atom_site.) if no PDB ATOM/HETATM lines were found
  if (rows.length === 0 && lines.some((l) => l.trim().startsWith("_atom_site."))) {
    const cifHeaders: string[] = [];
    const cifRows: string[][] = [];
    const cifLineNums: number[] = [];
    let inAtomLoop = false;
    for (let i = 0; i < lines.length; i++) {
      const trimmed = (lines[i] ?? "").trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      if (trimmed.startsWith("_atom_site.")) {
        inAtomLoop = true;
        cifHeaders.push(trimmed.replace("_atom_site.", ""));
        continue;
      }
      if (inAtomLoop) {
        if (trimmed === "loop_" || trimmed.startsWith("_") || trimmed.startsWith("data_")) {
          if (cifRows.length > 0) break;
          continue;
        }
        const cells = trimmed.split(/\s+/);
        cifRows.push(cells);
        cifLineNums.push(i + 1);
      }
    }
    if (cifHeaders.length > 0 && cifRows.length > 0) {
      return {
        format: "mmcif",
        delimiter: "\t",
        editable: false,
        leadingComments: [],
        headers: cifHeaders,
        rows: cifRows,
        rowLineNumbers: cifLineNums,
      };
    }
  }

  return {
    format: "pdb",
    delimiter: "\t",
    editable: false,
    leadingComments: [],
    headers,
    rows,
    rowLineNumbers,
  };
}

function parseTouchstoneGrid(text: string): ParsedTabularGrid {
  const lines = text.split(/\r?\n/);
  const rows: string[][] = [];
  const rowLineNumbers: number[] = [];
  let freqUnit = "GHz";
  let paramType = "S";

  for (let i = 0; i < lines.length; i++) {
    const trimmed = (lines[i] ?? "").trim();
    if (!trimmed || trimmed.startsWith("!")) continue;
    if (trimmed.startsWith("#")) {
      const parts = trimmed.slice(1).trim().split(/\s+/);
      if (parts[0]) freqUnit = parts[0];
      if (parts[1]) paramType = parts[1];
      continue;
    }
    const cells = trimmed.split(/\s+/);
    if (cells.length >= 2) {
      rows.push(cells);
      rowLineNumbers.push(i + 1);
    }
  }

  const maxCols = rows.reduce((m, r) => Math.max(m, r.length), 0);
  const headers: string[] = [];
  for (let c = 0; c < maxCols; c++) {
    if (c === 0) {
      headers.push(`Freq (${freqUnit})`);
    } else {
      const pairIdx = Math.floor((c - 1) / 2) + 1;
      const part = (c - 1) % 2 === 0 ? "Mag/Re" : "Ang/Im";
      headers.push(`${paramType}[${pairIdx}] ${part}`);
    }
  }

  return {
    format: "touchstone",
    delimiter: "\t",
    editable: false,
    leadingComments: [],
    headers,
    rows,
    rowLineNumbers,
  };
}

function parseSmilesGrid(text: string): ParsedTabularGrid {
  const lines = text.split(/\r?\n/);
  let headers: string[] | null = null;
  const rows: string[][] = [];
  const rowLineNumbers: number[] = [];

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] ?? "";
    const trimmed = raw.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("#")) {
      if (!headers && rows.length === 0) {
        const candidate = trimmed
          .slice(1)
          .trim()
          .split(/\t+|\s{2,}/);
        if (candidate.length >= 2) {
          headers = candidate;
        }
      }
      continue;
    }
    const cells = raw.includes("\t") ? raw.split("\t") : trimmed.split(/\s+/);
    rows.push(cells);
    rowLineNumbers.push(i + 1);
  }

  const maxCols = rows.reduce((m, r) => Math.max(m, r.length), headers?.length ?? 0);
  const finalHeaders =
    headers && headers.length >= maxCols
      ? headers.slice(0, maxCols)
      : Array.from({ length: maxCols }, (_, idx) => {
          if (headers && headers[idx]) return headers[idx]!;
          if (idx === 0) return "SMILES";
          if (idx === 1) return "Compound ID";
          return `Col ${idx + 1}`;
        });

  return {
    format: "smiles",
    delimiter: "\t",
    editable: false,
    leadingComments: [],
    headers: finalHeaders,
    rows,
    rowLineNumbers,
  };
}

function parseLasGrid(text: string): ParsedTabularGrid {
  const lines = text.split(/\r?\n/);
  const headers: string[] = [];
  const rows: string[][] = [];
  const rowLineNumbers: number[] = [];
  let section: "none" | "curve" | "ascii" = "none";

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] ?? "";
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    if (trimmed.startsWith("~")) {
      const upper = trimmed.toUpperCase();
      if (upper.startsWith("~C")) {
        section = "curve";
      } else if (upper.startsWith("~A")) {
        section = "ascii";
      } else {
        section = "none";
      }
      continue;
    }

    if (section === "curve") {
      // Curve lines: MNEM.UNIT   API CODE : DESCRIPTION
      const beforeColon = trimmed.split(":")[0] ?? "";
      const dotIdx = beforeColon.indexOf(".");
      if (dotIdx > 0) {
        const mnem = beforeColon.slice(0, dotIdx).trim();
        const rest = beforeColon.slice(dotIdx + 1).trim();
        const unit = rest.split(/\s+/)[0] ?? "";
        headers.push(unit ? `${mnem} [${unit}]` : mnem);
      } else {
        const mnem = beforeColon.trim().split(/\s+/)[0];
        if (mnem) headers.push(mnem);
      }
    } else if (section === "ascii") {
      const cells = trimmed.split(/\s+/);
      if (cells.length > 0) {
        rows.push(cells);
        rowLineNumbers.push(i + 1);
      }
    }
  }

  const colCount = Math.max(
    headers.length,
    rows.reduce((m, r) => Math.max(m, r.length), 0),
  );
  const finalHeaders = Array.from({ length: colCount }, (_, idx) => headers[idx] ?? `Curve ${idx + 1}`);

  return {
    format: "las",
    delimiter: "\t",
    editable: false,
    leadingComments: [],
    headers: finalHeaders,
    rows,
    rowLineNumbers,
  };
}

function tableToGrid(table: TabularTable): TabularGridTable {
  const headers = table.columns.map((c) => c.name);
  const rows = table.rows.map((rec) =>
    headers.map((h) => {
      const val = rec[h];
      return val === undefined || val === null ? "" : String(val);
    }),
  );
  return {
    id: table.id,
    name: table.name,
    headers,
    rows,
  };
}

/**
 * Parses raw text from CSV/TSV or other supported tabular formats into a normalized grid.
 */
export function parseTabularGrid(text: string, options: ParseTabularGridOptions = {}): ParsedTabularGrid {
  const dialect = (options.dialect ?? options.format ?? "").toLowerCase();

  if (dialect === "pdb" || dialect === "mmcif" || dialect === "cif") {
    return parsePdbGrid(text);
  }
  if (dialect === "las") {
    return parseLasGrid(text);
  }
  if (dialect === "touchstone" || dialect === "s2p" || dialect === "snp") {
    return parseTouchstoneGrid(text);
  }
  if (dialect === "smiles" || dialect === "smi") {
    return parseSmilesGrid(text);
  }
  if (dialect === "json" || dialect === "yaml" || dialect === "yml" || dialect === "xml" || dialect === "hdf5") {
    const formatArg: Parameters<typeof parseTabularDataInput>[2] = dialect === "yml" ? "yaml" : dialect;
    const parsed = parseTabularDataInput(text, undefined, formatArg);
    const gridTables = parsed.tables.map(tableToGrid);
    const active = gridTables[0] ?? { id: "default", name: "Dataset", headers: [], rows: [] };
    return {
      format: parsed.format,
      delimiter: ",",
      editable: false,
      leadingComments: [],
      headers: active.headers,
      rows: active.rows,
      rowLineNumbers: active.rows.map((_, idx) => idx + 1),
      tables: gridTables.length > 1 ? gridTables : undefined,
    };
  }

  // Standard CSV / TSV parsing with comment preservation and line number mapping
  const allLines = text.split(/\r?\n/);
  const leadingComments: string[] = [];
  let dataStartLineIdx = 0;

  while (dataStartLineIdx < allLines.length) {
    const line = allLines[dataStartLineIdx] ?? "";
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) {
      if (trimmed.startsWith("#")) {
        leadingComments.push(line);
      }
      dataStartLineIdx++;
    } else {
      break;
    }
  }

  const dataLines = allLines.slice(dataStartLineIdx);
  const dataText = dataLines.join("\n");
  const delimiter = detectDelimiter(dataLines, options.delimiter, options.format);
  const hasHeader = options.hasHeader !== false;

  const parsed = Papa.parse<string[]>(dataText, {
    skipEmptyLines: true,
    delimiter,
  });

  if (parsed.errors && parsed.errors.length > 0 && parsed.data.length === 0) {
    throw new Error(parsed.errors[0]?.message || "Failed to parse tabular data");
  }

  const rawRecords = parsed.data || [];
  if (rawRecords.length === 0) {
    return {
      format: delimiter === "\t" ? "tsv" : "csv",
      delimiter,
      editable: true,
      leadingComments,
      headers: [],
      rows: [],
      rowLineNumbers: [],
    };
  }

  const headers = hasHeader ? (rawRecords[0] ?? []) : (rawRecords[0] ?? []).map((_, idx) => `Col ${idx + 1}`);
  const rawDataRows = hasHeader ? rawRecords.slice(1) : rawRecords;

  // Normalize row lengths to match header count
  const colCount = Math.max(
    headers.length,
    rawDataRows.reduce((m, r) => Math.max(m, r.length), 0),
  );
  const normalizedHeaders = Array.from({ length: colCount }, (_, i) => headers[i] ?? `Col ${i + 1}`);
  const rows = rawDataRows.map((r) => Array.from({ length: colCount }, (_, i) => r[i] ?? ""));

  // Map each data row to its 1-based line number in the original text
  const nonEmptyLineNums: number[] = [];
  for (let i = dataStartLineIdx; i < allLines.length; i++) {
    if ((allLines[i] ?? "").trim().length > 0) {
      nonEmptyLineNums.push(i + 1);
    }
  }
  const rowLineNumbers = rows.map((_, idx) => {
    const lineIdx = hasHeader ? idx + 1 : idx;
    return nonEmptyLineNums[lineIdx] ?? dataStartLineIdx + lineIdx + 1;
  });

  return {
    format: delimiter === "\t" ? "tsv" : "csv",
    delimiter,
    editable: true,
    leadingComments,
    headers: normalizedHeaders,
    rows,
    rowLineNumbers,
  };
}

/**
 * Updates a single cell in headers (rowIdx === -1) or data rows (rowIdx >= 0).
 */
export function updateGridCell(
  headers: string[],
  rows: string[][],
  rowIdx: number,
  colIdx: number,
  value: string,
): { headers: string[]; rows: string[][] } {
  if (rowIdx === -1) {
    const nextHeaders = [...headers];
    while (nextHeaders.length <= colIdx) nextHeaders.push(`Col ${nextHeaders.length + 1}`);
    nextHeaders[colIdx] = value;
    return { headers: nextHeaders, rows };
  }
  const nextRows = rows.map((r, idx) => {
    if (idx !== rowIdx) return r;
    const nextRow = [...r];
    while (nextRow.length <= colIdx) nextRow.push("");
    nextRow[colIdx] = value;
    return nextRow;
  });
  return { headers, rows: nextRows };
}

/**
 * Inserts an empty row after `afterRowIdx` (or appends at end if omitted).
 */
export function insertGridRow(headers: string[], rows: string[][], afterRowIdx?: number): string[][] {
  const emptyRow = Array.from({ length: Math.max(1, headers.length) }, () => "");
  if (afterRowIdx === undefined || afterRowIdx < 0 || afterRowIdx >= rows.length) {
    return [...rows, emptyRow];
  }
  const next = [...rows];
  next.splice(afterRowIdx + 1, 0, emptyRow);
  return next;
}

/**
 * Deletes the row at `rowIdx`.
 */
export function deleteGridRow(rows: string[][], rowIdx: number): string[][] {
  if (rowIdx < 0 || rowIdx >= rows.length) return rows;
  return rows.filter((_, idx) => idx !== rowIdx);
}

/**
 * Inserts a new column after `afterColIdx` (or appends at the right edge if omitted).
 */
export function insertGridColumn(
  headers: string[],
  rows: string[][],
  afterColIdx?: number,
  colName?: string,
): { headers: string[]; rows: string[][] } {
  const insertAt =
    afterColIdx === undefined || afterColIdx < 0 || afterColIdx >= headers.length ? headers.length : afterColIdx + 1;
  const name = colName ?? `col_${headers.length + 1}`;
  const nextHeaders = [...headers];
  nextHeaders.splice(insertAt, 0, name);
  const nextRows = rows.map((r) => {
    const nextRow = [...r];
    while (nextRow.length < headers.length) nextRow.push("");
    nextRow.splice(insertAt, 0, "");
    return nextRow;
  });
  return { headers: nextHeaders, rows: nextRows };
}

/**
 * Deletes the column at `colIdx` (noop if only 1 column remains).
 */
export function deleteGridColumn(
  headers: string[],
  rows: string[][],
  colIdx: number,
): { headers: string[]; rows: string[][] } {
  if (headers.length <= 1 || colIdx < 0 || colIdx >= headers.length) {
    return { headers, rows };
  }
  const nextHeaders = headers.filter((_, idx) => idx !== colIdx);
  const nextRows = rows.map((r) => r.filter((_, idx) => idx !== colIdx));
  return { headers: nextHeaders, rows: nextRows };
}

/**
 * Serializes headers and rows back to CSV/TSV text, preserving leading comment lines.
 */
export function serializeGridToCsv(
  headers: string[],
  rows: string[][],
  delimiter = ",",
  leadingComments: string[] = [],
  includeHeader = true,
): string {
  const matrix = includeHeader && headers.length > 0 ? [headers, ...rows] : rows;
  const csvBody = Papa.unparse(matrix, {
    delimiter,
    newline: "\n",
  });
  const prefix = leadingComments.length > 0 ? `${leadingComments.join("\n")}\n` : "";
  return `${prefix}${csvBody}\n`;
}

export interface GridRange {
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
}

export function normalizeGridRange(a: { row: number; col: number }, b: { row: number; col: number }): GridRange {
  return {
    startRow: Math.min(a.row, b.row),
    startCol: Math.min(a.col, b.col),
    endRow: Math.max(a.row, b.row),
    endCol: Math.max(a.col, b.col),
  };
}

/**
 * Serializes a rectangular cell range (rows >= 0) as tab-separated text for clipboard copy.
 */
export function serializeRangeToTsv(rows: string[][], range: GridRange): string {
  const lines: string[] = [];
  const rStart = Math.max(0, range.startRow);
  const rEnd = Math.min(rows.length - 1, range.endRow);
  for (let r = rStart; r <= rEnd; r++) {
    const row = rows[r] ?? [];
    const cells: string[] = [];
    for (let c = range.startCol; c <= range.endCol; c++) {
      cells.push(row[c] ?? "");
    }
    lines.push(cells.join("\t"));
  }
  return lines.join("\n");
}

/**
 * Pastes a TSV/CSV clipboard block starting at (startRow, startCol), expanding rows/columns if needed.
 */
export function applyPasteBlock(
  headers: string[],
  rows: string[][],
  startRow: number,
  startCol: number,
  pasteText: string,
): { headers: string[]; rows: string[][] } {
  const clean = pasteText.replace(/\r\n/g, "\n").replace(/\n$/, "");
  if (!clean) return { headers, rows };

  const delimiter = clean.includes("\t") ? "\t" : ",";
  const parsed = Papa.parse<string[]>(clean, {
    delimiter,
    skipEmptyLines: false,
  });
  const block = parsed.data.length > 0 ? parsed.data : clean.split("\n").map((l) => [l]);
  const blockRows = block.length;
  const blockCols = block.reduce((m, r) => Math.max(m, r.length), 0);
  if (blockRows === 0 || blockCols === 0) return { headers, rows };

  const safeStartRow = Math.max(0, startRow);
  const safeStartCol = Math.max(0, startCol);
  const neededCols = Math.max(headers.length, safeStartCol + blockCols);
  const neededRows = Math.max(rows.length, safeStartRow + blockRows);

  const nextHeaders = [...headers];
  while (nextHeaders.length < neededCols) {
    nextHeaders.push(`col_${nextHeaders.length + 1}`);
  }

  const nextRows = Array.from({ length: neededRows }, (_, rIdx) => {
    const existing = rows[rIdx] ?? [];
    return Array.from({ length: neededCols }, (__, cIdx) => existing[cIdx] ?? "");
  });

  for (let br = 0; br < blockRows; br++) {
    const srcRow = block[br] ?? [];
    const targetRow = nextRows[safeStartRow + br]!;
    for (let bc = 0; bc < srcRow.length; bc++) {
      targetRow[safeStartCol + bc] = srcRow[bc] ?? "";
    }
  }

  return { headers: nextHeaders, rows: nextRows };
}
