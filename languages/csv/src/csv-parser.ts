// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Lightweight CSV parser for measurement data used in model calibration.
 *
 * Supports:
 *   - Comma, semicolon, and tab delimiters (auto-detect)
 *   - Configurable time-column name (default: "time" or "t")
 *   - Column mapping: csvColumn → modelicaVariable
 *   - Quoted fields with embedded commas/newlines
 */

// ── Public interface ──

/**
 * Scalar variable type inferred or declared for a CSV column.
 */
export type CsvVarType = "Real" | "Integer" | "Boolean" | "String";

/**
 * Structured column header metadata extracted from a CSV header cell.
 */
export interface CsvColumnHeader {
  /** Clean column identifier with `[unit]`, `(unit)`, and `: Type` annotations stripped. */
  name: string;
  /** Original trimmed header cell text. */
  rawHeader: string;
  /** Physical unit extracted from `[unit]` or `(unit)` annotation, if present. */
  unit?: string | undefined;
  /** Explicitly declared scalar type from `: Type` annotation, if present. */
  declaredType?: CsvVarType | undefined;
}

/**
 * Parsed time-series measurement table extracted from a CSV document.
 */
export interface CsvData {
  /** Column headers (after mapping and annotation stripping). */
  columns: string[];
  /** Time column values. */
  time: number[];
  /** Variable data: column name → values[]. */
  data: Map<string, number[]>;
  /** Extracted physical units keyed by column name (e.g., `"omega" -> "rad/s"`). */
  units: Map<string, string>;
  /** Inferred or explicitly declared column scalar types (`Real`, `Integer`, `Boolean`, `String`). */
  columnTypes: Map<string, CsvVarType>;
  /** Structured header annotations for all columns in the CSV header row. */
  headers: CsvColumnHeader[];
  /** Zero-copy Float64Array buffer for the time vector. */
  timeBuffer: Float64Array;
  /** Zero-copy Float64Array buffers for each measurement column. */
  columnar: Map<string, Float64Array>;
}

/**
 * Parse a CSV header cell into a clean column name, optional unit (`[rad/s]` or `(K)`),
 * and optional declared scalar type (`: Boolean`, `: Real`, `: Integer`, `: String`).
 */
export function parseCsvHeaderAnnotation(rawHeader: string): CsvColumnHeader {
  const rawTrimmed = rawHeader.trim();
  let working = rawTrimmed;
  let declaredType: CsvVarType | undefined;
  let unit: string | undefined;

  const normalizeVarType = (t: string): CsvVarType | undefined => {
    const lower = t.toLowerCase();
    if (lower === "real" || lower === "float" || lower === "double" || lower === "f64" || lower === "f32") {
      return "Real";
    }
    if (lower === "integer" || lower === "int" || lower === "i32" || lower === "i64") {
      return "Integer";
    }
    if (lower === "boolean" || lower === "bool") {
      return "Boolean";
    }
    if (lower === "string" || lower === "str") {
      return "String";
    }
    return undefined;
  };

  // Iteratively strip trailing `: Type` and `[unit]` / `(unit)` annotations in either order
  for (let pass = 0; pass < 2; pass++) {
    const typeMatch = working.match(/^(.*?)\s*:\s*([A-Za-z0-9_]+)\s*$/);
    const tm1 = typeMatch?.[1]?.trim();
    const tm2 = typeMatch?.[2];
    if (tm1 && tm1.length > 0 && tm2) {
      const norm = normalizeVarType(tm2);
      if (norm) {
        declaredType = norm;
        working = tm1;
      }
    }

    const bracketUnitMatch = working.match(/^(.*?)\s*\[\s*([^\]\r\n"]+)\s*\]\s*$/);
    const bum1 = bracketUnitMatch?.[1]?.trim();
    const bum2 = bracketUnitMatch?.[2]?.trim();
    if (bum1 && bum1.length > 0 && bum2) {
      unit = bum2;
      working = bum1;
      continue;
    }

    const parenUnitMatch = working.match(/^(.*?)\s*\(\s*([^)\r\n"]+)\s*\)\s*$/);
    const pum1 = parenUnitMatch?.[1]?.trim();
    const pum2 = parenUnitMatch?.[2]?.trim();
    if (pum1 && pum1.length > 0 && pum2) {
      unit = pum2;
      working = pum1;
    }
  }

  return {
    name: working || rawTrimmed,
    rawHeader: rawTrimmed,
    ...(unit !== undefined ? { unit } : {}),
    ...(declaredType !== undefined ? { declaredType } : {}),
  };
}

/**
 * Configuration options for `parseCsvMeasurements`.
 */
export interface CsvParseOptions {
  /** Name of the time column in the CSV (default: auto-detect "time" or "t"). */
  timeColumn?: string | undefined;
  /** Column delimiter (default: auto-detect from first line). */
  delimiter?: string | undefined;
  /** Map from CSV column name → Modelica variable name. */
  columnMapping?: Map<string, string> | undefined;
  /** Skip rows where any value is NaN. */
  skipNaN?: boolean | undefined;
}

// ── Parser ──

/**
 * Parse CSV text into structured measurement data.
 *
 * @param csvText  Raw CSV text content.
 * @param options  Parsing options.
 * @returns Parsed CSV data with time vector and per-variable arrays.
 * @throws Error if the time column is not found or if the CSV is malformed.
 */
export function parseCsvMeasurements(csvText: string, options?: CsvParseOptions): CsvData {
  const lines = splitCsvLines(csvText).filter((l) => !l.trim().startsWith("#"));
  while (lines.length > 0 && (lines[0] ?? "").trim() === "") {
    lines.shift();
  }
  if (lines.length < 2) {
    throw new Error("CSV must contain at least a header row and one data row.");
  }

  const firstLine = lines[0] ?? "";
  // Detect delimiter
  const delimiter = options?.delimiter ?? detectDelimiter(firstLine);

  // Parse header and extract unit/type annotations
  const rawHeaders = parseCsvRow(firstLine, delimiter);
  if (rawHeaders.length === 0) {
    throw new Error("CSV header row contains no columns.");
  }

  const mapping = options?.columnMapping;
  const parsedHeaders: CsvColumnHeader[] = rawHeaders.map((h) => {
    const parsed = parseCsvHeaderAnnotation(h);
    const mappedName = mapping?.get(parsed.rawHeader) ?? mapping?.get(parsed.name) ?? parsed.name;
    return {
      ...parsed,
      name: mappedName,
    };
  });
  const headers = parsedHeaders.map((h) => h.name);

  const units = new Map<string, string>();
  const columnTypes = new Map<string, CsvVarType>();
  for (const ph of parsedHeaders) {
    if (ph.unit) {
      units.set(ph.name, ph.unit);
    }
    if (ph.declaredType) {
      columnTypes.set(ph.name, ph.declaredType);
    }
  }

  // Find time column (match either clean name or raw header)
  const requestedTimeCol = options?.timeColumn
    ? (mapping?.get(options.timeColumn) ?? parseCsvHeaderAnnotation(options.timeColumn).name)
    : undefined;
  const timeColName = requestedTimeCol ?? findTimeColumn(headers);
  if (!timeColName) {
    throw new Error(
      `Could not find a time column. Searched for "time" or "t" in headers: [${headers.join(", ")}]. ` +
        `Specify timeColumn explicitly.`,
    );
  }
  const timeColIdx = headers.indexOf(timeColName);
  if (timeColIdx === -1) {
    throw new Error(`Time column "${timeColName}" not found in headers: [${headers.join(", ")}].`);
  }

  // Parse data rows
  const time: number[] = [];
  const dataColumns = new Map<string, number[]>();
  const rawCellTrackers = new Map<
    string,
    { allBool: boolean; allInt: boolean; hasNumeric: boolean; hasNonEmpty: boolean }
  >();
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i] ?? "";
    if (i !== timeColIdx && h) {
      dataColumns.set(h, []);
      rawCellTrackers.set(h, { allBool: true, allInt: true, hasNumeric: false, hasNonEmpty: false });
    }
  }

  for (let rowIdx = 1; rowIdx < lines.length; rowIdx++) {
    const line = lines[rowIdx] ?? "";
    if (line.trim() === "" || line.trim().startsWith("#")) continue; // skip blank and comment lines

    const fields = parseCsvRow(line, delimiter);
    if (fields.length < headers.length) {
      // Pad short rows with NaN
      while (fields.length < headers.length) fields.push("");
    }

    const tVal = parseFloat(fields[timeColIdx] ?? "NaN");
    if (isNaN(tVal)) {
      if (options?.skipNaN) continue;
      throw new Error(`Invalid time value at row ${rowIdx + 1}: "${fields[timeColIdx]}".`);
    }

    let hasNaN = false;
    const rowValues: number[] = [];
    for (let i = 0; i < headers.length; i++) {
      if (i === timeColIdx) continue;
      const h = headers[i] ?? "";
      const rawCell = (fields[i] ?? "").trim();
      const tracker = rawCellTrackers.get(h);
      const lowerCell = rawCell.toLowerCase();

      let val: number;
      if (lowerCell === "true" || lowerCell === "false") {
        val = lowerCell === "true" ? 1 : 0;
        if (tracker) {
          tracker.hasNonEmpty = true;
          tracker.allInt = false;
        }
      } else {
        val = parseFloat(rawCell || "NaN");
        if (tracker && rawCell !== "") {
          tracker.hasNonEmpty = true;
          tracker.allBool = false;
          if (!isNaN(val) && isStrictFiniteNumber(rawCell)) {
            tracker.hasNumeric = true;
            if (!/^[+-]?\d+$/.test(rawCell)) {
              tracker.allInt = false;
            }
          } else {
            tracker.allInt = false;
          }
        }
      }

      if (isNaN(val) && columnTypes.get(h) !== "String") {
        hasNaN = true;
      }
      rowValues.push(val);
    }

    if (hasNaN && options?.skipNaN) continue;

    time.push(tVal);
    let vi = 0;
    for (let i = 0; i < headers.length; i++) {
      if (i === timeColIdx) continue;
      const h = headers[i] ?? "";
      const col = dataColumns.get(h);
      if (col) col.push(rowValues[vi] ?? 0);
      vi++;
    }
  }

  if (time.length === 0) {
    throw new Error("CSV contains no valid data rows.");
  }

  // Finalize column type inference for columns without an explicit `: Type` annotation
  if (!columnTypes.has(timeColName)) {
    columnTypes.set(timeColName, "Real");
  }
  const columns: string[] = [];
  const columnar = new Map<string, Float64Array>();
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i];
    if (i !== timeColIdx && h) {
      columns.push(h);
      const arr = dataColumns.get(h) ?? [];
      columnar.set(h, Float64Array.from(arr));
      if (!columnTypes.has(h)) {
        const tracker = rawCellTrackers.get(h);
        if (tracker?.hasNonEmpty && tracker.allBool) {
          columnTypes.set(h, "Boolean");
        } else if (tracker?.hasNonEmpty && tracker.hasNumeric && tracker.allInt) {
          columnTypes.set(h, "Integer");
        } else if (tracker?.hasNonEmpty && !tracker.hasNumeric && !tracker.allBool) {
          columnTypes.set(h, "String");
        } else {
          columnTypes.set(h, "Real");
        }
      }
    }
  }

  const timeBuffer = Float64Array.from(time);
  return {
    columns,
    time,
    data: dataColumns,
    units,
    columnTypes,
    headers: parsedHeaders,
    timeBuffer,
    columnar,
  };
}

/**
 * Options for parsing raw tabular CSV records.
 */
export interface CsvRecordParseOptions {
  /** Column delimiter (default: auto-detect from first line). */
  delimiter?: string | undefined;
  /** Whether to trim whitespace from cell values (default: false). */
  trim?: boolean | undefined;
  /** Ignore comment lines starting with '#' (default: true). */
  skipComments?: boolean | undefined;
}

/**
 * Parse CSV text into a 2D array of string cells (rows x columns).
 */
export function parseCsvRows(csvText: string, options?: CsvRecordParseOptions): string[][] {
  if (!csvText || csvText.trim() === "") return [];
  const lines = splitCsvLines(csvText);
  const skipComments = options?.skipComments ?? true;
  const filtered = skipComments ? lines.filter((l) => !l.trim().startsWith("#")) : lines;
  const delimiter = options?.delimiter ?? (filtered.length > 0 ? detectDelimiter(filtered[0] ?? "") : ",");
  const trim = options?.trim ?? false;

  const rows: string[][] = [];
  for (const line of filtered) {
    if (line.trim() === "") continue;
    rows.push(parseCsvRow(line, delimiter, trim));
  }
  return rows;
}

/**
 * Parse CSV text into an array of object records using the first row as headers.
 */
export function parseCsvRecords(csvText: string, options?: CsvRecordParseOptions): Record<string, string>[] {
  const rows = parseCsvRows(csvText, options);
  const headers = rows[0];
  if (!headers || rows.length < 2) return [];

  const records: Record<string, string>[] = [];

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row) continue;
    const record: Record<string, string> = {};
    for (let c = 0; c < headers.length; c++) {
      const h = headers[c] ?? "";
      record[h] = row[c] ?? "";
    }
    records.push(record);
  }

  return records;
}

// ── Internal helpers ──

/**
 * Split CSV text into lines, handling quoted fields that may contain newlines or escaped quotes.
 */
function splitCsvLines(text: string): string[] {
  const lines: string[] = [];
  let current = "";
  let inQuote = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i] ?? "";
    if (ch === '"') {
      if (inQuote && text[i + 1] === '"') {
        current += '""';
        i++;
      } else {
        inQuote = !inQuote;
        current += ch;
      }
    } else if ((ch === "\n" || ch === "\r") && !inQuote) {
      if (ch === "\r" && text[i + 1] === "\n") i++; // CRLF
      lines.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim() !== "") {
    lines.push(current);
  }
  return lines;
}

/**
 * Detect the delimiter from the first line of a CSV.
 * Checks for tab, semicolon, then falls back to comma.
 */
function detectDelimiter(headerLine: string): string {
  // Count occurrences of candidate delimiters outside quotes
  const candidates = ["\t", ";", ","];
  let maxCount = 0;
  let best = ",";

  for (const delim of candidates) {
    let count = 0;
    let inQuote = false;
    for (let i = 0; i < headerLine.length; i++) {
      const ch = headerLine[i];
      if (!ch) continue;
      if (ch === '"') {
        if (inQuote && headerLine[i + 1] === '"') {
          i++;
        } else {
          inQuote = !inQuote;
        }
      } else if (ch === delim && !inQuote) {
        count++;
      }
    }
    if (count > maxCount) {
      maxCount = count;
      best = delim;
    }
  }
  return best;
}

/**
 * Parse a single CSV row into fields, respecting quoted strings.
 */
function parseCsvRow(line: string, delimiter: string, trim = true): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuote = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i] ?? "";
    if (ch === '"') {
      if (inQuote && line[i + 1] === '"') {
        // Escaped quote
        current += '"';
        i++;
      } else {
        inQuote = !inQuote;
      }
    } else if (ch === delimiter && !inQuote) {
      fields.push(trim ? current.trim() : current);
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(trim ? current.trim() : current);
  return fields;
}

/**
 * Auto-detect the time column name from headers.
 */
function findTimeColumn(headers: string[]): string | null {
  const candidates = ["time", "t", "Time", "TIME", "T"];
  for (const c of candidates) {
    const idx = headers.indexOf(c);
    if (idx !== -1) return headers[idx] ?? null;
  }
  // Case-insensitive fallback
  for (const h of headers) {
    if (h.toLowerCase() === "time" || h.toLowerCase() === "t") return h;
  }
  return null;
}

/**
 * CSV Polyglot Adapter
 *
 * Transcompiles a CSV file into a Modelica package containing constant arrays.
 * This allows CSV data to be indexed by the polyglot WorkspaceIndex and imported
 * directly into Modelica models as if it were code.
 */
export function parseCsvToModelica(csvText: string, modelName: string): string {
  const lines = splitCsvLines(csvText).filter((l) => l.trim().length > 0 && !l.trim().startsWith("#"));
  if (lines.length < 2) {
    return `package ${modelName}\nend ${modelName};`;
  }

  // Detect delimiter from first line (comma, semicolon, tab) using quote-aware helper
  const headerLine = lines[0] as string;
  const delimiter = detectDelimiter(headerLine);
  const headers = parseCsvRow(headerLine, delimiter).map((h) => h.trim().replace(/[^a-zA-Z0-9_]/g, "_"));
  const numCols = headers.length;

  const data: number[][] = [];
  for (let i = 1; i < lines.length; i++) {
    const parts = parseCsvRow(lines[i] as string, delimiter);
    const row = parts.map((p) => parseFloat(p.trim()));
    if (row.length === numCols && !row.some(isNaN)) {
      data.push(row);
    }
  }

  const numRows = data.length;
  let mo = `package ${modelName}\n`;
  mo += `  // Auto-generated from CSV data\n`;
  mo += `  constant Integer numRows = ${numRows};\n`;
  mo += `  constant Integer numCols = ${numCols};\n\n`;

  // Provide the full 2D matrix
  mo += `  constant Real values[${numRows}, ${numCols}] = {\n`;
  for (let r = 0; r < numRows; r++) {
    mo += `    {${(data[r] as number[]).join(", ")}}${r < numRows - 1 ? "," : ""}\n`;
  }
  mo += `  };\n\n`;

  // Provide convenient 1D arrays for each column
  for (let c = 0; c < numCols; c++) {
    const colName = headers[c] || `col${c}`;
    const colData = data.map((row) => row[c]);
    mo += `  constant Real ${colName}[${numRows}] = {${colData.join(", ")}};\n`;
  }

  mo += `end ${modelName};\n`;
  return mo;
}

// ── Semantic Linter ──────────────────────────────────────────────────────────

/**
 * Diagnostic emitted by the CSV semantic linter with exact byte and 1-indexed line/column spans.
 */
export interface CsvDiagnostic {
  /** Machine-readable diagnostic code (e.g., `"CSV_COLUMN_COUNT_MISMATCH"`). */
  code: string;
  /** Severity level of the diagnostic. */
  severity: "error" | "warning" | "info";
  /** Human-readable diagnostic message. */
  message: string;
  /** 0-indexed character/byte start offset in CSV text */
  startOffset: number;
  /** 0-indexed character/byte end offset in CSV text */
  endOffset: number;
  /** 1-indexed start line */
  line: number;
  /** 1-indexed start column */
  column: number;
  /** 1-indexed end line */
  endLine: number;
  /** 1-indexed end column */
  endColumn: number;
}

/**
 * Tokenized CSV cell with trimmed text and source byte offsets.
 */
interface LocatedCsvCell {
  text: string;
  rawText: string;
  startOffset: number;
  endOffset: number;
  unclosedQuote?: boolean | undefined;
}

/**
 * Tokenized CSV row containing its constituent cells and source byte span.
 */
interface LocatedCsvRow {
  rowIndex: number;
  startOffset: number;
  endOffset: number;
  cells: LocatedCsvCell[];
}

/**
 * Binary-search line/column locator over raw CSV source text.
 */
class CsvLineLocator {
  private lineStarts: number[] = [0];

  constructor(private source: string) {
    for (let i = 0; i < source.length; i++) {
      if (source.charCodeAt(i) === 10) {
        this.lineStarts.push(i + 1);
      }
    }
  }

  /**
   * Convert a 0-indexed character offset into a 1-indexed `{ line, column }` position.
   */
  offsetToPos(offset: number): { line: number; column: number } {
    const clamped = Math.max(0, Math.min(offset, this.source.length));
    let low = 0;
    let high = this.lineStarts.length - 1;
    while (low <= high) {
      const mid = (low + high) >>> 1;
      if ((this.lineStarts[mid] ?? 0) <= clamped) {
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    const lineIdx = Math.max(0, low - 1);
    return {
      line: lineIdx + 1,
      column: clamped - (this.lineStarts[lineIdx] ?? 0) + 1,
    };
  }
}

/**
 * Tokenize a CSV string into rows and cells while tracking exact byte spans and unclosed quotes.
 */
function tokenizeCsvWithRanges(text: string): { rows: LocatedCsvRow[]; delimiter: string } {
  // Detect delimiter from first non-empty, non-comment line
  const firstNonCommentLine = splitCsvLines(text).find((l) => l.trim().length > 0 && !l.trim().startsWith("#")) ?? "";
  const delimiter = detectDelimiter(firstNonCommentLine);

  const rows: LocatedCsvRow[] = [];
  let i = 0;
  const len = text.length;
  let rowIndex = 0;

  while (i < len) {
    // Skip blank lines outside quotes
    if (text[i] === "\r" || text[i] === "\n") {
      if (text[i] === "\r" && text[i + 1] === "\n") i += 2;
      else i++;
      continue;
    }

    // Skip # comment lines while preserving byte offsets
    let peekIdx = i;
    while (peekIdx < len && (text[peekIdx] === " " || text[peekIdx] === "\t")) {
      peekIdx++;
    }
    if (peekIdx < len && text[peekIdx] === "#") {
      while (i < len && text[i] !== "\n" && text[i] !== "\r") {
        i++;
      }
      continue;
    }

    const rowStart = i;
    const cells: LocatedCsvCell[] = [];
    let cellStart = i;
    let currentVal = "";
    let inQuote = false;
    let unclosedQuote = false;

    while (i < len) {
      const ch = text[i] ?? "";
      if (ch === '"') {
        if (inQuote && text[i + 1] === '"') {
          currentVal += '"';
          i += 2;
          continue;
        }
        inQuote = !inQuote;
        i++;
        continue;
      }

      if (!inQuote && ch === delimiter) {
        const rawSlice = text.slice(cellStart, i);
        const leadWs = rawSlice.length - rawSlice.trimStart().length;
        const trailWs = rawSlice.length - rawSlice.trimEnd().length;
        const trimmedStart = rawSlice.trim().length > 0 ? cellStart + leadWs : cellStart;
        const trimmedEnd = rawSlice.trim().length > 0 ? i - trailWs : Math.min(len, cellStart + 1);
        cells.push({
          text: currentVal.trim(),
          rawText: rawSlice,
          startOffset: trimmedStart,
          endOffset: trimmedEnd,
        });
        currentVal = "";
        i++;
        cellStart = i;
        continue;
      }

      if (!inQuote && (ch === "\n" || ch === "\r")) {
        break;
      }

      currentVal += ch;
      i++;
    }

    if (inQuote) {
      unclosedQuote = true;
    }

    const rowEnd = i;
    const rawSlice = text.slice(cellStart, rowEnd);
    const leadWs = rawSlice.length - rawSlice.trimStart().length;
    const trailWs = rawSlice.length - rawSlice.trimEnd().length;
    const trimmedStart = rawSlice.trim().length > 0 ? cellStart + leadWs : Math.max(rowStart, cellStart - 1);
    const trimmedEnd =
      rawSlice.trim().length > 0 ? rowEnd - trailWs : Math.min(len, Math.max(trimmedStart + 1, rowEnd));
    cells.push({
      text: currentVal.trim(),
      rawText: rawSlice,
      startOffset: trimmedStart,
      endOffset: trimmedEnd,
      unclosedQuote,
    });

    if (i < len && (text[i] === "\r" || text[i] === "\n")) {
      if (text[i] === "\r" && text[i + 1] === "\n") i += 2;
      else i++;
    }

    // Ignore pure whitespace lines
    if (text.slice(rowStart, rowEnd).trim().length > 0) {
      rows.push({
        rowIndex: rowIndex++,
        startOffset: rowStart,
        endOffset: rowEnd,
        cells,
      });
    }
  }

  return { rows, delimiter };
}

/**
 * Return `true` if `str` is a strictly formatted finite decimal or scientific-notation number.
 */
function isStrictFiniteNumber(str: string): boolean {
  if (!str) return false;
  return /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(str);
}

/**
 * Perform semantic linting on a CSV string, returning diagnostics with exact cell/row ranges.
 */
export function lintCsv(csvText: string, baseStartByte = 0): CsvDiagnostic[] {
  const diagnostics: CsvDiagnostic[] = [];
  const locator = new CsvLineLocator(csvText);

  const emit = (
    startOffset: number,
    endOffset: number,
    code: string,
    severity: "error" | "warning" | "info",
    message: string,
  ) => {
    const localStart = Math.max(0, startOffset);
    const localEnd = Math.max(localStart + 1, endOffset);
    const startPos = locator.offsetToPos(localStart);
    const endPos = locator.offsetToPos(localEnd);
    diagnostics.push({
      code,
      severity,
      message,
      startOffset: baseStartByte + localStart,
      endOffset: baseStartByte + localEnd,
      line: startPos.line,
      column: startPos.column,
      endLine: endPos.line,
      endColumn: endPos.column,
    });
  };

  const { rows, delimiter } = tokenizeCsvWithRanges(csvText);
  if (rows.length === 0) return diagnostics;

  const headerRow = rows[0];
  if (!headerRow) return diagnostics;
  const numCols = headerRow.cells.length;
  const seenHeaders = new Map<string, number>();
  const parsedHeaders: CsvColumnHeader[] = [];

  // 1. Validate header cells (empty or duplicate headers, unclosed quotes)
  for (let c = 0; c < numCols; c++) {
    const cell = headerRow.cells[c];
    if (!cell) continue;
    const parsedHeader = parseCsvHeaderAnnotation(cell.text);
    parsedHeaders.push(parsedHeader);
    if (cell.unclosedQuote) {
      emit(
        cell.startOffset,
        cell.endOffset,
        "CSV_UNCLOSED_QUOTE",
        "error",
        `Unclosed quoted string in header column ${c + 1}.`,
      );
    }
    if (!cell.text) {
      emit(cell.startOffset, cell.endOffset, "CSV_EMPTY_HEADER", "error", `Header column ${c + 1} is empty.`);
      continue;
    }
    const cleanKey = parsedHeader.name || cell.text;
    const existingCol = seenHeaders.get(cleanKey);
    if (existingCol !== undefined) {
      emit(
        cell.startOffset,
        cell.endOffset,
        "CSV_DUPLICATE_HEADER",
        "error",
        `Duplicate header column '${cell.text}' (already defined at column ${existingCol + 1}).`,
      );
    } else {
      seenHeaders.set(cleanKey, c);
    }
  }

  // Determine which columns are numeric (at least one data row has a finite numeric value, or column is time/t)
  const numericCols = new Array<boolean>(numCols).fill(false);
  let timeColIdx = -1;
  for (let c = 0; c < numCols; c++) {
    const ph = parsedHeaders[c];
    const hName = (ph?.name ?? headerRow.cells[c]?.text ?? "").toLowerCase();
    if (timeColIdx === -1 && (hName === "time" || hName === "t")) {
      timeColIdx = c;
      numericCols[c] = true;
    } else if (ph?.declaredType === "Real" || ph?.declaredType === "Integer") {
      numericCols[c] = true;
    }
  }

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row) continue;
    for (let c = 0; c < Math.min(numCols, row.cells.length); c++) {
      const ph = parsedHeaders[c];
      if (ph?.declaredType === "Boolean" || ph?.declaredType === "String") continue;
      if (isStrictFiniteNumber(row.cells[c]?.text ?? "")) {
        numericCols[c] = true;
      }
    }
  }

  const altDelimiters = [",", ";", "\t"].filter((d) => d !== delimiter);
  const delimLabel = (d: string) => (d === "\t" ? "tab ('\\t')" : `'${d}'`);
  let prevTimeVal: number | undefined;

  // 2. Validate data rows (mixed delimiters, column count mismatch, unclosed quotes, invalid numeric cells, non-monotonic time)
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row) continue;

    let hasMixedDelimiter = false;
    for (let c = 0; c < row.cells.length; c++) {
      const cell = row.cells[c];
      if (!cell) continue;
      if (cell.unclosedQuote) {
        emit(
          cell.startOffset,
          cell.endOffset,
          "CSV_UNCLOSED_QUOTE",
          "error",
          `Unclosed quoted string at row ${r + 1}, column ${c + 1}.`,
        );
      }

      // Check unquoted cells for mixed delimiters
      const rawTrimmed = cell.rawText.trim();
      if (!rawTrimmed.startsWith('"')) {
        for (const alt of altDelimiters) {
          if (rawTrimmed.includes(alt)) {
            const subParts = rawTrimmed.split(alt).map((s) => s.trim());
            if (
              row.cells.length !== numCols ||
              subParts.some((sp) => isStrictFiniteNumber(sp) || sp === "true" || sp === "false")
            ) {
              hasMixedDelimiter = true;
              emit(
                cell.startOffset,
                cell.endOffset,
                "CSV_MIXED_DELIMITER",
                "error",
                `Mixed delimiter ${delimLabel(alt)} found in row ${r + 1}, column ${c + 1}; expected primary delimiter ${delimLabel(delimiter)}.`,
              );
              break;
            }
          }
        }
      }
    }

    if (row.cells.length !== numCols) {
      const firstExcess = row.cells[numCols];
      const lastExcess = row.cells[row.cells.length - 1];
      if (row.cells.length > numCols && firstExcess && lastExcess) {
        // Underline ONLY the excess cells
        emit(
          firstExcess.startOffset,
          lastExcess.endOffset,
          "CSV_COLUMN_COUNT_MISMATCH",
          "error",
          `Row ${r + 1} has ${row.cells.length} columns, expected ${numCols} to match header row.`,
        );
      } else {
        emit(
          row.startOffset,
          row.endOffset,
          "CSV_COLUMN_COUNT_MISMATCH",
          "error",
          `Row ${r + 1} has ${row.cells.length} columns, expected ${numCols} to match header row.`,
        );
      }
    }

    if (hasMixedDelimiter && row.cells.length !== numCols) {
      continue;
    }

    const checkCols = Math.min(numCols, row.cells.length);
    for (let c = 0; c < checkCols; c++) {
      if (!numericCols[c]) continue;
      const cell = row.cells[c];
      if (!cell) continue;
      const colName = headerRow.cells[c]?.text || `column ${c + 1}`;
      if (!cell.text) {
        emit(
          cell.startOffset,
          cell.endOffset,
          "CSV_INVALID_NUMERIC_CELL",
          "warning",
          `Missing numeric value in column '${colName}' at row ${r + 1}.`,
        );
        continue;
      }
      if (!isStrictFiniteNumber(cell.text)) {
        emit(
          cell.startOffset,
          cell.endOffset,
          "CSV_INVALID_NUMERIC_CELL",
          "error",
          `Invalid numeric value '${cell.text}' in column '${colName}' at row ${r + 1}.`,
        );
        continue;
      }

      if (c === timeColIdx) {
        const tVal = parseFloat(cell.text);
        if (prevTimeVal !== undefined && tVal < prevTimeVal) {
          emit(
            cell.startOffset,
            cell.endOffset,
            "CSV_NON_MONOTONIC_TIME",
            "warning",
            `Non-monotonic time value ${tVal} at row ${r + 1} (previous time was ${prevTimeVal}).`,
          );
        }
        prevTimeVal = tVal;
      }
    }
  }

  return diagnostics;
}

// ── Columnar Time-Table Interpolation ────────────────────────────────────────

/**
 * Interpolation method supported for CSV time-series tables.
 */
export type CsvInterpolationMethod = "linear" | "akima" | "constant";

/**
 * Zero-copy columnar time-series table backed by contiguous `Float64Array` buffers.
 */
export interface CsvColumnarTimeTable {
  columns: string[];
  time: Float64Array;
  data: Map<string, Float64Array>;
  units: Map<string, string>;
  columnTypes: Map<string, CsvVarType>;
}

/**
 * Convert raw CSV text or an already-parsed `CsvData` object into a zero-copy
 * `CsvColumnarTimeTable` backed by `Float64Array` buffers.
 */
export function toColumnarTimeTable(input: string | CsvData, options?: CsvParseOptions): CsvColumnarTimeTable {
  const parsed = typeof input === "string" ? parseCsvMeasurements(input, options) : input;
  const timeBuf = parsed.timeBuffer instanceof Float64Array ? parsed.timeBuffer : Float64Array.from(parsed.time);
  const colMap = new Map<string, Float64Array>();
  for (const col of parsed.columns) {
    const existing = parsed.columnar?.get(col);
    if (existing instanceof Float64Array) {
      colMap.set(col, existing);
    } else {
      colMap.set(col, Float64Array.from(parsed.data.get(col) ?? []));
    }
  }
  return {
    columns: [...parsed.columns],
    time: timeBuf,
    data: colMap,
    units: new Map(parsed.units ?? []),
    columnTypes: new Map(parsed.columnTypes ?? []),
  };
}

/**
 * Binary search (`O(log N)`) to locate interval index `i` in `0 <= i <= N - 2`
 * such that `time[i] <= t <= time[i + 1]`.
 */
export function bsearchTimeInterval(time: Float64Array | number[], t: number): number {
  const n = time.length;
  if (n <= 2 || t <= (time[0] ?? 0)) return 0;
  if (t >= (time[n - 1] ?? 0)) return n - 2;

  let low = 0;
  let high = n - 2;
  while (low <= high) {
    const mid = (low + high) >>> 1;
    const tMid = time[mid] ?? 0;
    const tNext = time[mid + 1] ?? 0;
    if (t < tMid) {
      high = mid - 1;
    } else if (t > tNext) {
      low = mid + 1;
    } else {
      return mid;
    }
  }
  return Math.max(0, Math.min(n - 2, low));
}

/**
 * Evaluate a single column at time `t` using `O(log N)` binary search and the specified
 * interpolation scheme (`"linear"`, `"akima"`, or `"constant"`).
 */
export function interpolateCsvColumn(
  time: Float64Array | number[],
  values: Float64Array | number[],
  t: number,
  method: CsvInterpolationMethod = "linear",
  intervalIdx?: number,
): number {
  const n = Math.min(time.length, values.length);
  if (n === 0) return NaN;
  if (n === 1 || t <= (time[0] ?? 0)) return values[0] ?? NaN;
  if (t >= (time[n - 1] ?? 0)) return values[n - 1] ?? NaN;

  const i = intervalIdx !== undefined ? intervalIdx : bsearchTimeInterval(time, t);
  const t0 = time[i] ?? 0;
  const t1 = time[i + 1] ?? 0;
  const y0 = values[i] ?? 0;
  const y1 = values[i + 1] ?? 0;

  if (method === "constant" || t1 <= t0) {
    return y0;
  }

  const h = t1 - t0;
  const dx = t - t0;

  if (method === "linear" || n < 3) {
    return y0 + (dx / h) * (y1 - y0);
  }

  // Akima 5-point cubic spline interpolation with outlier-resistant slope weights
  const secant = (k: number): number => {
    if (k >= 0 && k < n - 1) {
      const dt = (time[k + 1] ?? 0) - (time[k] ?? 0);
      return dt > 0 ? ((values[k + 1] ?? 0) - (values[k] ?? 0)) / dt : 0;
    }
    if (k === -1) {
      const m0 = secant(0);
      const m1 = n >= 3 ? secant(1) : m0;
      return 2 * m0 - m1;
    }
    if (k <= -2) {
      const m_1 = secant(-1);
      const m0 = secant(0);
      return 2 * m_1 - m0;
    }
    if (k === n - 1) {
      const mn2 = secant(n - 2);
      const mn3 = n >= 3 ? secant(n - 3) : mn2;
      return 2 * mn2 - mn3;
    }
    const mn1 = secant(n - 1);
    const mn2 = secant(n - 2);
    return 2 * mn1 - mn2;
  };

  const akimaSlope = (nodeIdx: number): number => {
    const mm2 = secant(nodeIdx - 2);
    const mm1 = secant(nodeIdx - 1);
    const m0 = secant(nodeIdx);
    const mp1 = secant(nodeIdx + 1);
    const w1 = Math.abs(mp1 - m0);
    const w2 = Math.abs(mm1 - mm2);
    if (w1 + w2 > 1e-12) {
      return (w1 * mm1 + w2 * m0) / (w1 + w2);
    }
    return 0.5 * (mm1 + m0);
  };

  const m_i = (y1 - y0) / h;
  const s0 = akimaSlope(i);
  const s1 = akimaSlope(i + 1);

  const c2 = (3 * m_i - 2 * s0 - s1) / h;
  const c3 = (s0 + s1 - 2 * m_i) / (h * h);
  return y0 + dx * (s0 + dx * (c2 + dx * c3));
}

/**
 * Interpolate all columns of a CSV time-series table at query time `t` using a shared
 * `O(log N)` binary search over the `Float64Array` time vector.
 */
export function interpolateCsvTimeTable(
  table: CsvData | CsvColumnarTimeTable,
  t: number,
  method: CsvInterpolationMethod = "linear",
): Record<string, number> {
  const timeVec = "timeBuffer" in table && table.timeBuffer instanceof Float64Array ? table.timeBuffer : table.time;
  const n = timeVec.length;
  const idx = n > 2 ? bsearchTimeInterval(timeVec, t) : 0;
  const result: Record<string, number> = {};

  for (const col of table.columns) {
    const colVec = ("columnar" in table ? table.columnar?.get(col) : undefined) ?? table.data.get(col);
    if (colVec) {
      result[col] = interpolateCsvColumn(timeVec, colVec, t, method, idx);
    }
  }
  return result;
}
