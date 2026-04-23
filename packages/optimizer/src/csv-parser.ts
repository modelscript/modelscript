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

export interface CsvData {
  /** Column headers (after mapping). */
  columns: string[];
  /** Time column values. */
  time: number[];
  /** Variable data: column name → values[]. */
  data: Map<string, number[]>;
}

export interface CsvParseOptions {
  /** Name of the time column in the CSV (default: auto-detect "time" or "t"). */
  timeColumn?: string;
  /** Column delimiter (default: auto-detect from first line). */
  delimiter?: string;
  /** Map from CSV column name → Modelica variable name. */
  columnMapping?: Map<string, string>;
  /** Skip rows where any value is NaN. */
  skipNaN?: boolean;
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
