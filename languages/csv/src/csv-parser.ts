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
 * Parsed time-series measurement table extracted from a CSV document.
 */
export interface CsvData {
  /** Column headers (after mapping). */
  columns: string[];
  /** Time column values. */
  time: number[];
  /** Variable data: column name → values[]. */
  data: Map<string, number[]>;
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
  const lines = splitCsvLines(csvText);
  if (lines.length < 2) {
    throw new Error("CSV must contain at least a header row and one data row.");
  }

  const firstLine = lines[0] ?? "";
  // Detect delimiter
  const delimiter = options?.delimiter ?? detectDelimiter(firstLine);

  // Parse header
  const rawHeaders = parseCsvRow(firstLine, delimiter);
  if (rawHeaders.length === 0) {
    throw new Error("CSV header row contains no columns.");
  }

  // Apply column mapping
  const mapping = options?.columnMapping;
  const headers = rawHeaders.map((h) => {
    const trimmed = h.trim();
    return mapping?.get(trimmed) ?? trimmed;
  });

  // Find time column
  const timeColName = options?.timeColumn ?? findTimeColumn(headers);
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
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i] ?? "";
    if (i !== timeColIdx && h) {
      dataColumns.set(h, []);
    }
  }

  for (let rowIdx = 1; rowIdx < lines.length; rowIdx++) {
    const line = lines[rowIdx] ?? "";
    if (line.trim() === "") continue; // skip blank lines

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
      const val = parseFloat(fields[i] ?? "NaN");
      if (isNaN(val)) hasNaN = true;
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

  // Build output column list (excluding time)
  const columns: string[] = [];
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i];
    if (i !== timeColIdx && h) columns.push(h);
  }

  return { columns, time, data: dataColumns };
}

// ── Internal helpers ──

/**
 * Split CSV text into lines, handling quoted fields that may contain newlines.
 */
function splitCsvLines(text: string): string[] {
  const lines: string[] = [];
  let current = "";
  let inQuote = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i] ?? "";
    if (ch === '"') {
      inQuote = !inQuote;
      current += ch;
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
    for (const ch of headerLine) {
      if (ch === '"') inQuote = !inQuote;
      else if (ch === delim && !inQuote) count++;
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
function parseCsvRow(line: string, delimiter: string): string[] {
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
      fields.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current.trim());
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
      if (this.lineStarts[mid]! <= clamped) {
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    const lineIdx = Math.max(0, low - 1);
    return {
      line: lineIdx + 1,
      column: clamped - this.lineStarts[lineIdx]! + 1,
    };
  }
}

/**
 * Tokenize a CSV string into rows and cells while tracking exact byte spans and unclosed quotes.
 */
function tokenizeCsvWithRanges(text: string): { rows: LocatedCsvRow[]; delimiter: string } {
  // Detect delimiter from first non-empty line
  let firstLineEnd = text.indexOf("\n");
  if (firstLineEnd === -1) firstLineEnd = text.length;
  const firstLine = text.slice(0, firstLineEnd).replace(/\r$/, "");
  const delimiter = detectDelimiter(firstLine);

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

    const rowStart = i;
    const cells: LocatedCsvCell[] = [];
    let cellStart = i;
    let currentVal = "";
    let inQuote = false;
    let unclosedQuote = false;

    while (i < len) {
      const ch = text[i]!;
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

  const { rows } = tokenizeCsvWithRanges(csvText);
  if (rows.length === 0) return diagnostics;

  const headerRow = rows[0]!;
  const numCols = headerRow.cells.length;
  const seenHeaders = new Map<string, number>();

  // 1. Validate header cells (empty or duplicate headers, unclosed quotes)
  for (let c = 0; c < numCols; c++) {
    const cell = headerRow.cells[c]!;
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
    if (seenHeaders.has(cell.text)) {
      emit(
        cell.startOffset,
        cell.endOffset,
        "CSV_DUPLICATE_HEADER",
        "error",
        `Duplicate header column '${cell.text}' (already defined at column ${seenHeaders.get(cell.text)! + 1}).`,
      );
    } else {
      seenHeaders.set(cell.text, c);
    }
  }

  // Determine which columns are numeric (at least one data row has a finite numeric value, or column is time/t)
  const numericCols = new Array<boolean>(numCols).fill(false);
  let timeColIdx = -1;
  for (let c = 0; c < numCols; c++) {
    const hName = headerRow.cells[c]!.text.toLowerCase();
    if (timeColIdx === -1 && (hName === "time" || hName === "t")) {
      timeColIdx = c;
      numericCols[c] = true;
    }
  }

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r]!;
    for (let c = 0; c < Math.min(numCols, row.cells.length); c++) {
      if (isStrictFiniteNumber(row.cells[c]!.text)) {
        numericCols[c] = true;
      }
    }
  }

  let prevTimeVal: number | undefined;

  // 2. Validate data rows (column count mismatch, unclosed quotes, invalid numeric cells, non-monotonic time)
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r]!;

    for (let c = 0; c < row.cells.length; c++) {
      const cell = row.cells[c]!;
      if (cell.unclosedQuote) {
        emit(
          cell.startOffset,
          cell.endOffset,
          "CSV_UNCLOSED_QUOTE",
          "error",
          `Unclosed quoted string at row ${r + 1}, column ${c + 1}.`,
        );
      }
    }

    if (row.cells.length !== numCols) {
      if (row.cells.length > numCols) {
        // Underline ONLY the excess cells
        const firstExcess = row.cells[numCols]!;
        const lastExcess = row.cells[row.cells.length - 1]!;
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

    const checkCols = Math.min(numCols, row.cells.length);
    for (let c = 0; c < checkCols; c++) {
      if (!numericCols[c]) continue;
      const cell = row.cells[c]!;
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
