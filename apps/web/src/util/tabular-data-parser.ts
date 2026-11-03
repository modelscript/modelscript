// SPDX-License-Identifier: AGPL-3.0-or-later

import Papa from "papaparse";

export type VegaFieldType = "quantitative" | "temporal" | "nominal" | "ordinal";

export interface TabularColumn {
  name: string;
  vegaType: VegaFieldType;
  dataType: "number" | "string" | "boolean";
  min?: number | undefined;
  max?: number | undefined;
  mean?: number | undefined;
  uniqueCount: number;
  isMonotonic: boolean;
  sampleValues: Array<string | number | boolean>;
}

export interface TabularTable {
  id: string;
  name: string;
  columns: TabularColumn[];
  rows: Record<string, unknown>[];
}

export interface ParsedTabularDataset {
  format: "csv" | "tsv" | "json" | "yaml" | "xml" | "hdf5";
  title: string;
  tables: TabularTable[];
  activeTableId: string;
  columns: TabularColumn[];
  rows: Record<string, unknown>[];
}

const DATA_VIEW_TYPES = new Set([
  "csv",
  "tsv",
  "dataset",
  "dataset-table",
  "json-table",
  "yaml-table",
  "xml-table",
  "hdf5",
  "h5",
]);

const DATA_EXTENSIONS = [".csv", ".tsv", ".json", ".yaml", ".yml", ".xml", ".h5", ".hdf5"];

/**
 * Determines whether an artifact view or filename represents a tabular dataset
 * (or a Vega-Lite visualization created from a tabular dataset).
 */
export function isTabularDataArtifact(
  artifactView: Record<string, unknown> | null | undefined,
  filename?: string,
): boolean {
  if (filename) {
    const lower = filename.toLowerCase();
    if (DATA_EXTENSIONS.some((ext) => lower.endsWith(ext))) {
      return true;
    }
  }
  if (!artifactView) return false;

  const viewType = String(artifactView.view_type || artifactView.artifact_type || "").toLowerCase();
  if (DATA_VIEW_TYPES.has(viewType)) return true;

  let config: Record<string, unknown> | null = null;
  if (typeof artifactView.view_config === "string") {
    try {
      config = JSON.parse(artifactView.view_config) as Record<string, unknown>;
    } catch {
      config = null;
    }
  } else if (artifactView.view_config && typeof artifactView.view_config === "object") {
    config = artifactView.view_config as Record<string, unknown>;
  }

  if (viewType === "vega" || viewType === "vega-plot") {
    if (
      config &&
      (Array.isArray(config.data) ||
        typeof config.rawData === "string" ||
        typeof config.sourceUrl === "string" ||
        typeof config.csvData === "string" ||
        (config.spec && typeof config.spec === "object" && (config.spec as Record<string, unknown>).data))
    ) {
      return true;
    }
  }

  const title = String(artifactView.title || config?.title || "").toLowerCase();
  if (DATA_EXTENSIONS.some((ext) => title.endsWith(ext))) {
    return true;
  }

  return false;
}

/**
 * Infers column types, summary statistics, and monotonicity from an array of row records.
 */
export function inferColumnsFromRows(rows: Record<string, unknown>[]): TabularColumn[] {
  if (!rows || rows.length === 0) return [];

  const columnNamesSet = new Set<string>();
  for (const row of rows.slice(0, 50)) {
    if (row && typeof row === "object") {
      for (const key of Object.keys(row)) {
        if (key.trim().length > 0) columnNamesSet.add(key);
      }
    }
  }

  const columns: TabularColumn[] = [];
  for (const name of columnNamesSet) {
    let numCount = 0;
    let boolCount = 0;
    let dateCount = 0;
    let nonEmptyCount = 0;
    let min = Infinity;
    let max = -Infinity;
    let sum = 0;
    let isIncreasing = true;
    let isDecreasing = true;
    let prevNum: number | null = null;
    const uniqueSet = new Set<string>();
    const samples: Array<string | number | boolean> = [];

    const sampleLimit = Math.min(rows.length, 500);
    for (let i = 0; i < sampleLimit; i++) {
      const rawVal = rows[i]?.[name];
      if (rawVal === null || rawVal === undefined || rawVal === "") continue;
      nonEmptyCount++;
      const strVal = String(rawVal).trim();
      uniqueSet.add(strVal);
      if (samples.length < 5) {
        if (typeof rawVal === "number" || typeof rawVal === "boolean" || typeof rawVal === "string") {
          samples.push(rawVal);
        } else {
          samples.push(strVal);
        }
      }

      if (typeof rawVal === "boolean" || strVal.toLowerCase() === "true" || strVal.toLowerCase() === "false") {
        boolCount++;
        continue;
      }

      const numVal = typeof rawVal === "number" ? rawVal : Number(strVal);
      if (!Number.isNaN(numVal) && Number.isFinite(numVal) && strVal !== "") {
        numCount++;
        if (numVal < min) min = numVal;
        if (numVal > max) max = numVal;
        sum += numVal;
        if (prevNum !== null) {
          if (numVal < prevNum) isIncreasing = false;
          if (numVal > prevNum) isDecreasing = false;
        }
        prevNum = numVal;
        continue;
      }

      // Check ISO date / timestamp patterns
      if (/^\d{4}-\d{2}-\d{2}(?:[T\s]\d{2}:\d{2}(?::\d{2})?)?/.test(strVal) && !Number.isNaN(Date.parse(strVal))) {
        dateCount++;
      }
    }

    const isNumeric = nonEmptyCount > 0 && numCount / nonEmptyCount >= 0.8;
    const isBoolean = !isNumeric && nonEmptyCount > 0 && boolCount / nonEmptyCount >= 0.8;
    const isTemporal = !isNumeric && !isBoolean && nonEmptyCount > 0 && dateCount / nonEmptyCount >= 0.7;

    let vegaType: VegaFieldType = "nominal";
    let dataType: "number" | "string" | "boolean" = "string";

    if (isNumeric) {
      vegaType = "quantitative";
      dataType = "number";
    } else if (isTemporal) {
      vegaType = "temporal";
      dataType = "string";
    } else if (isBoolean) {
      vegaType = "nominal";
      dataType = "boolean";
    } else {
      vegaType = "nominal";
      dataType = "string";
    }

    columns.push({
      name,
      vegaType,
      dataType,
      min: isNumeric && min !== Infinity ? min : undefined,
      max: isNumeric && max !== -Infinity ? max : undefined,
      mean: isNumeric && numCount > 0 ? sum / numCount : undefined,
      uniqueCount: uniqueSet.size,
      isMonotonic: isNumeric && numCount > 2 && (isIncreasing || isDecreasing),
      sampleValues: samples,
    });
  }

  return columns;
}

/**
 * Normalizes row values so numeric strings in quantitative columns become actual JS numbers for Vega-Lite.
 */
export function coerceRowsForColumns(
  rows: Record<string, unknown>[],
  columns: TabularColumn[],
): Record<string, unknown>[] {
  const numericCols = new Set(columns.filter((c) => c.dataType === "number").map((c) => c.name));
  const boolCols = new Set(columns.filter((c) => c.dataType === "boolean").map((c) => c.name));
  if (numericCols.size === 0 && boolCols.size === 0) return rows;

  return rows.map((row) => {
    const out: Record<string, unknown> = { ...row };
    for (const col of numericCols) {
      const val = out[col];
      if (typeof val === "string" && val.trim() !== "") {
        const parsed = Number(val.trim());
        if (!Number.isNaN(parsed) && Number.isFinite(parsed)) {
          out[col] = parsed;
        }
      }
    }
    for (const col of boolCols) {
      const val = out[col];
      if (typeof val === "string") {
        const lower = val.trim().toLowerCase();
        if (lower === "true") out[col] = true;
        else if (lower === "false") out[col] = false;
      }
    }
    return out;
  });
}

function parseDelimitedText(text: string, delimiter?: string): Record<string, unknown>[] {
  const cleaned = text
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith("#"))
    .join("\n")
    .trim();
  if (!cleaned) return [];

  const parsed = Papa.parse<Record<string, unknown>>(cleaned, {
    header: true,
    dynamicTyping: true,
    skipEmptyLines: true,
    ...(delimiter ? { delimiter } : {}),
  });

  if (parsed.data && parsed.data.length > 0 && Object.keys(parsed.data[0] || {}).length > 0) {
    return parsed.data;
  }

  // Fallback for headerless matrix
  const matrix = Papa.parse<string[]>(cleaned, {
    header: false,
    skipEmptyLines: true,
  });
  const rows2d = matrix.data || [];
  if (rows2d.length < 2) return [];
  const headers = (rows2d[0] || []).map((h, idx) => String(h || `col_${idx + 1}`).trim());
  return rows2d.slice(1).map((r) => {
    const obj: Record<string, unknown> = {};
    headers.forEach((h, i) => {
      const raw = r[i];
      const num = Number(raw);
      obj[h] = raw !== undefined && raw !== "" && !Number.isNaN(num) ? num : raw;
    });
    return obj;
  });
}

/**
 * Extracts one or more named tabular tables from arbitrary JSON / YAML / HDF5-JSON structures.
 */
function extractTablesFromStructuredObject(root: unknown, defaultName = "dataset"): TabularTable[] {
  const tables: TabularTable[] = [];

  const addCandidateRows = (name: string, rawRows: Record<string, unknown>[]) => {
    if (rawRows.length === 0) return;
    const cols = inferColumnsFromRows(rawRows);
    if (cols.length === 0) return;
    const coerced = coerceRowsForColumns(rawRows, cols);
    tables.push({
      id: name,
      name,
      columns: cols,
      rows: coerced,
    });
  };

  if (Array.isArray(root)) {
    if (root.length > 0 && Array.isArray(root[0])) {
      // 2D array: [headers, ...rows]
      const headers = (root[0] as unknown[]).map((h, idx) => String(h ?? `col_${idx + 1}`));
      const records = root.slice(1).map((rowArr) => {
        const obj: Record<string, unknown> = {};
        if (Array.isArray(rowArr)) {
          headers.forEach((h, i) => {
            obj[h] = rowArr[i];
          });
        }
        return obj;
      });
      addCandidateRows(defaultName, records);
    } else if (root.length > 0 && typeof root[0] === "object" && root[0] !== null) {
      addCandidateRows(defaultName, root as Record<string, unknown>[]);
    }
    return tables;
  }

  if (root && typeof root === "object") {
    const obj = root as Record<string, unknown>;

    // Case 1: Columnar object { colA: [1, 2, 3], colB: [4, 5, 6] }
    const arrayEntries = Object.entries(obj).filter(
      ([, v]) =>
        Array.isArray(v) &&
        v.length > 0 &&
        (typeof v[0] === "number" || typeof v[0] === "string" || typeof v[0] === "boolean"),
    );
    if (arrayEntries.length >= 2) {
      const maxLen = Math.max(...arrayEntries.map(([, v]) => (v as unknown[]).length));
      const records: Record<string, unknown>[] = [];
      for (let i = 0; i < maxLen; i++) {
        const rec: Record<string, unknown> = {};
        for (const [key, arr] of arrayEntries) {
          rec[key] = (arr as unknown[])[i];
        }
        records.push(rec);
      }
      addCandidateRows(defaultName, records);
    }

    // Case 2: Nested datasets/tables (e.g., { data: [...] }, { datasets: { "/telemetry": [...] } })
    const visit = (node: Record<string, unknown>, pathPrefix: string, depth: number) => {
      if (depth > 4) return;
      for (const [key, val] of Object.entries(node)) {
        const label = pathPrefix ? `${pathPrefix}/${key}` : key;
        if (Array.isArray(val) && val.length > 0) {
          if (typeof val[0] === "object" && val[0] !== null && !Array.isArray(val[0])) {
            addCandidateRows(label, val as Record<string, unknown>[]);
          } else if (Array.isArray(val[0])) {
            const sub = extractTablesFromStructuredObject(val, label);
            tables.push(...sub);
          }
        } else if (val && typeof val === "object" && !Array.isArray(val)) {
          const childObj = val as Record<string, unknown>;
          // Check if childObj is itself a columnar group (common in HDF5 groups)
          const childCols = Object.entries(childObj).filter(
            ([, v]) => Array.isArray(v) && v.length > 0 && (typeof v[0] === "number" || typeof v[0] === "string"),
          );
          if (childCols.length >= 1) {
            const len = Math.max(...childCols.map(([, v]) => (v as unknown[]).length));
            const records: Record<string, unknown>[] = [];
            for (let i = 0; i < len; i++) {
              const rec: Record<string, unknown> = { index: i };
              for (const [colName, arr] of childCols) {
                rec[colName] = (arr as unknown[])[i];
              }
              records.push(rec);
            }
            addCandidateRows(label, records);
          } else {
            visit(childObj, label, depth + 1);
          }
        }
      }
    };

    visit(obj, "", 0);
  }

  return tables;
}

/**
 * Lightweight YAML tabular parser supporting list-of-maps and columnar YAML structures.
 */
function parseSimpleYamlTabular(text: string, defaultName = "yaml_data"): TabularTable[] {
  const lines = text.split(/\r?\n/);
  const items: Record<string, unknown>[] = [];
  let current: Record<string, unknown> | null = null;

  const parseScalar = (raw: string): unknown => {
    const trimmed = raw.trim().replace(/^["']|["']$/g, "");
    if (trimmed === "true") return true;
    if (trimmed === "false") return false;
    const num = Number(trimmed);
    if (trimmed !== "" && !Number.isNaN(num) && Number.isFinite(num)) return num;
    return trimmed;
  };

  // Also check inline arrays like `colName: [1, 2, 3]`
  const columnar: Record<string, unknown[]> = {};

  for (const rawLine of lines) {
    const line = rawLine.replace(/#.*$/, "");
    if (!line.trim()) continue;

    const inlineArrMatch = line.match(/^\s*([a-zA-Z0-9_.-]+)\s*:\s*\[(.*)\]\s*$/);
    if (inlineArrMatch) {
      const key = inlineArrMatch[1]!;
      const vals = inlineArrMatch[2]!
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .map(parseScalar);
      if (vals.length > 0) columnar[key] = vals;
      continue;
    }

    const listStartMatch = line.match(/^\s*-\s+([a-zA-Z0-9_.-]+)\s*:\s*(.+)$/);
    if (listStartMatch) {
      if (current && Object.keys(current).length > 0) items.push(current);
      current = { [listStartMatch[1]!]: parseScalar(listStartMatch[2]!) };
      continue;
    }

    if (/^\s*-\s*$/.test(line)) {
      if (current && Object.keys(current).length > 0) items.push(current);
      current = {};
      continue;
    }

    const kvMatch = line.match(/^\s+([a-zA-Z0-9_.-]+)\s*:\s*(.+)$/);
    if (kvMatch && current !== null) {
      current[kvMatch[1]!] = parseScalar(kvMatch[2]!);
    }
  }
  if (current && Object.keys(current).length > 0) {
    items.push(current);
  }

  if (items.length > 0) {
    return extractTablesFromStructuredObject(items, defaultName);
  }
  if (Object.keys(columnar).length > 0) {
    return extractTablesFromStructuredObject(columnar, defaultName);
  }
  return [];
}

/**
 * Parses repeating XML elements or attributes into tabular records.
 */
function parseXmlTabular(text: string, defaultName = "xml_data"): TabularTable[] {
  if (typeof DOMParser !== "undefined") {
    try {
      const doc = new DOMParser().parseFromString(text, "text/xml");
      const root = doc.documentElement;
      if (root && root.nodeName !== "parsererror") {
        // Group children by tagName to find repeating row elements
        const tagBuckets = new Map<string, Element[]>();
        const collectRepeating = (parent: Element) => {
          const byTag = new Map<string, Element[]>();
          for (const child of Array.from(parent.children)) {
            const list = byTag.get(child.tagName) || [];
            list.push(child);
            byTag.set(child.tagName, list);
          }
          for (const [tag, elems] of byTag.entries()) {
            if (elems.length >= 2) {
              tagBuckets.set(tag, elems);
            } else if (elems.length === 1) {
              collectRepeating(elems[0]!);
            }
          }
        };
        collectRepeating(root);

        const tables: TabularTable[] = [];
        for (const [tag, elems] of tagBuckets.entries()) {
          const rows: Record<string, unknown>[] = elems.map((el) => {
            const rec: Record<string, unknown> = {};
            for (const attr of Array.from(el.attributes)) {
              const num = Number(attr.value);
              rec[attr.name] = attr.value !== "" && !Number.isNaN(num) ? num : attr.value;
            }
            for (const child of Array.from(el.children)) {
              const txt = (child.textContent || "").trim();
              const num = Number(txt);
              rec[child.tagName] = txt !== "" && !Number.isNaN(num) ? num : txt;
            }
            return rec;
          });
          const extracted = extractTablesFromStructuredObject(rows, tag);
          tables.push(...extracted);
        }
        if (tables.length > 0) return tables;
      }
    } catch {
      // Fall through to regex parser
    }
  }

  // Regex fallback for repeating tags with attributes or simple child tags
  const rows: Record<string, unknown>[] = [];
  const rowRegex = /<([a-zA-Z0-9_:-]+)((?:\s+[a-zA-Z0-9_:-]+="[^"]*")+)[^>]*\/?>/g;
  let match: RegExpExecArray | null;
  while ((match = rowRegex.exec(text)) !== null) {
    const attrsText = match[2] || "";
    const attrRegex = /([a-zA-Z0-9_:-]+)="([^"]*)"/g;
    const rec: Record<string, unknown> = {};
    let attrMatch: RegExpExecArray | null;
    while ((attrMatch = attrRegex.exec(attrsText)) !== null) {
      const k = attrMatch[1]!;
      const v = attrMatch[2]!;
      const num = Number(v);
      rec[k] = v !== "" && !Number.isNaN(num) ? num : v;
    }
    if (Object.keys(rec).length >= 2) {
      rows.push(rec);
    }
  }
  return extractTablesFromStructuredObject(rows, defaultName);
}

const HDF5_INTERNAL_TOKENS = new Set([
  "HDF",
  "SNOD",
  "TREE",
  "HEAP",
  "OHDR",
  "GCOL",
  "FRHP",
  "BTHD",
  "BTLF",
  "FHDB",
  "FSHD",
  "OCHK",
]);

/**
 * Parses a binary HDF5 (`.h5` / `.hdf5`) buffer by inspecting the HDF5 superblock (`\x89HDF\r\n\x1a\n`),
 * extracting symbol-table / local-heap dataset identifiers, and reading aligned IEEE-754 Float64 arrays.
 * Falls back to UTF-8 text parsing if the buffer contains text/JSON/CSV HDF5 exports.
 */
export function parseBinaryHdf5Buffer(
  buffer: ArrayBuffer | Uint8Array,
  filenameOrTitle = "dataset.h5",
): ParsedTabularDataset {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const baseTitle = filenameOrTitle.replace(/\.[a-z0-9]+$/i, "") || "Dataset";

  const isHdf5Magic =
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x48 && // 'H'
    bytes[2] === 0x44 && // 'D'
    bytes[3] === 0x46 && // 'F'
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a;

  if (!isHdf5Magic) {
    const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    return parseTabularDataInput(text, filenameOrTitle, "hdf5");
  }

  // Check if there is an embedded JSON payload after the superblock (used by lightweight HDF5 containers)
  const asciiText = new TextDecoder("latin1").decode(bytes.subarray(8));
  const jsonStart = asciiText.indexOf("{");
  const jsonEnd = asciiText.lastIndexOf("}");
  if (jsonStart >= 0 && jsonEnd > jsonStart) {
    const candidateJson = asciiText.slice(jsonStart, jsonEnd + 1);
    try {
      const parsedObj = JSON.parse(candidateJson);
      if (parsedObj && typeof parsedObj === "object") {
        return parseTabularDataInput(parsedObj as Record<string, unknown>, filenameOrTitle, "hdf5");
      }
    } catch {
      // Continue to binary heap + Float64 extraction
    }
  }

  // Extract null-terminated identifier strings from the HDF5 local heap / symbol table
  const symbolNames: string[] = [];
  const identRegex = /([a-zA-Z_][a-zA-Z0-9_]{1,31})\0/g;
  let match: RegExpExecArray | null;
  while ((match = identRegex.exec(asciiText)) !== null) {
    const token = match[1]!;
    if (!HDF5_INTERNAL_TOKENS.has(token) && !symbolNames.includes(token)) {
      symbolNames.push(token);
    }
  }

  // Scan 8-byte aligned IEEE-754 Float64 runs after the 8-byte signature
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const numericRuns: number[][] = [];
  let currentRun: number[] = [];

  for (let offset = 8; offset + 8 <= bytes.byteLength; offset += 8) {
    const val = view.getFloat64(offset, true);
    const isPlausibleFloat = Number.isFinite(val) && (val === 0 || (Math.abs(val) >= 1e-9 && Math.abs(val) <= 1e9));
    if (isPlausibleFloat) {
      currentRun.push(Number(val.toPrecision(12)));
    } else {
      if (currentRun.length >= 2) {
        numericRuns.push(currentRun);
      }
      currentRun = [];
    }
  }
  if (currentRun.length >= 2) {
    numericRuns.push(currentRun);
  }

  const columnarObj: Record<string, number[]> = {};
  if (numericRuns.length > 0) {
    const colNames = symbolNames.length > 0 ? symbolNames : numericRuns.map((_, i) => `var_${i + 1}`);
    if (numericRuns.length === 1 && colNames.length >= 2 && numericRuns[0]!.length % colNames.length === 0) {
      // Single contiguous block partitioned across N named datasets
      const flat = numericRuns[0]!;
      const rowsPerCol = flat.length / colNames.length;
      colNames.forEach((colName, cIdx) => {
        columnarObj[colName] = flat.slice(cIdx * rowsPerCol, (cIdx + 1) * rowsPerCol);
      });
    } else {
      numericRuns.forEach((run, idx) => {
        const colName = colNames[idx] || `dataset_${idx + 1}`;
        columnarObj[colName] = run;
      });
    }
  }

  return parseTabularDataInput(columnarObj, baseTitle, "hdf5");
}

/**
 * Parses raw text, binary HDF5 buffer, or structured viewConfig into a normalized `ParsedTabularDataset`.
 */
export function parseTabularDataInput(
  input: string | Record<string, unknown> | unknown[] | ArrayBuffer | Uint8Array,
  filenameOrTitle = "dataset.csv",
  explicitFormat?: string,
): ParsedTabularDataset {
  if (input instanceof ArrayBuffer || input instanceof Uint8Array) {
    return parseBinaryHdf5Buffer(input, filenameOrTitle);
  }

  const lowerName = filenameOrTitle.toLowerCase();
  const baseTitle = filenameOrTitle.replace(/\.[a-z0-9]+$/i, "") || "Dataset";

  let detectedFormat: ParsedTabularDataset["format"] = "csv";
  if (explicitFormat) {
    const f = explicitFormat.toLowerCase();
    if (f === "tsv") detectedFormat = "tsv";
    else if (f === "json" || f === "json-table") detectedFormat = "json";
    else if (f === "yaml" || f === "yml" || f === "yaml-table") detectedFormat = "yaml";
    else if (f === "xml" || f === "xml-table") detectedFormat = "xml";
    else if (f === "hdf5" || f === "h5") detectedFormat = "hdf5";
  } else if (lowerName.endsWith(".tsv")) {
    detectedFormat = "tsv";
  } else if (lowerName.endsWith(".json")) {
    detectedFormat = "json";
  } else if (lowerName.endsWith(".yaml") || lowerName.endsWith(".yml")) {
    detectedFormat = "yaml";
  } else if (lowerName.endsWith(".xml")) {
    detectedFormat = "xml";
  } else if (lowerName.endsWith(".h5") || lowerName.endsWith(".hdf5")) {
    detectedFormat = "hdf5";
  }

  let tables: TabularTable[] = [];

  if (typeof input !== "string") {
    tables = extractTablesFromStructuredObject(input, baseTitle);
  } else {
    const trimmed = input.trim();
    if (detectedFormat === "json" || trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        const parsedJson = JSON.parse(trimmed);
        tables = extractTablesFromStructuredObject(parsedJson, baseTitle);
        if (detectedFormat === "csv") detectedFormat = "json";
      } catch {
        // Fallback to CSV if not valid JSON
      }
    }

    if (tables.length === 0 && (detectedFormat === "xml" || trimmed.startsWith("<"))) {
      tables = parseXmlTabular(trimmed, baseTitle);
      if (tables.length > 0) detectedFormat = "xml";
    }

    if (
      tables.length === 0 &&
      (detectedFormat === "yaml" || /^(\s*-\s+[a-zA-Z0-9_.-]+\s*:|\s*[a-zA-Z0-9_.-]+\s*:\s*\[)/m.test(trimmed))
    ) {
      tables = parseSimpleYamlTabular(trimmed, baseTitle);
      if (tables.length > 0 && detectedFormat === "csv") detectedFormat = "yaml";
    }

    if (tables.length === 0) {
      const rows = parseDelimitedText(trimmed, detectedFormat === "tsv" ? "\t" : undefined);
      const cols = inferColumnsFromRows(rows);
      const coerced = coerceRowsForColumns(rows, cols);
      if (cols.length > 0) {
        tables = [
          {
            id: baseTitle,
            name: baseTitle,
            columns: cols,
            rows: coerced,
          },
        ];
      }
    }
  }

  const firstTable = tables[0] || {
    id: baseTitle,
    name: baseTitle,
    columns: [],
    rows: [],
  };

  return {
    format: detectedFormat,
    title: baseTitle,
    tables: tables.length > 0 ? tables : [firstTable],
    activeTableId: firstTable.id,
    columns: firstTable.columns,
    rows: firstTable.rows,
  };
}

/**
 * Loads and parses tabular data from an attached artifact view object (resolving inline `data`, `code`, or fetching `url`).
 */
export async function loadTabularDatasetFromArtifactView(
  artifactView: Record<string, unknown>,
): Promise<ParsedTabularDataset> {
  const title = String(artifactView.title || "Dataset");
  let config: Record<string, unknown> = {};
  if (typeof artifactView.view_config === "string") {
    try {
      config = JSON.parse(artifactView.view_config) as Record<string, unknown>;
    } catch {
      config = {};
    }
  } else if (artifactView.view_config && typeof artifactView.view_config === "object") {
    config = artifactView.view_config as Record<string, unknown>;
  }

  const explicitFormat = typeof config.format === "string" ? config.format : undefined;
  const effectiveTitle = String(config.title || title || "Dataset");
  const lowerTitle = effectiveTitle.toLowerCase();

  // 1. Check if structured tables / datasets are already present (e.g., preprocessed HDF5 or JSON)
  if (config.datasets && typeof config.datasets === "object") {
    return parseTabularDataInput(config.datasets as Record<string, unknown>, effectiveTitle, explicitFormat || "hdf5");
  }

  // 2. Check if inline data array or string is present
  if (Array.isArray(config.data) && config.data.length > 0) {
    return parseTabularDataInput(config.data, effectiveTitle, explicitFormat);
  }
  if (typeof config.rawData === "string" && config.rawData.trim()) {
    return parseTabularDataInput(config.rawData, effectiveTitle, explicitFormat);
  }
  if (typeof config.data === "string" && config.data.trim()) {
    return parseTabularDataInput(config.data, effectiveTitle, explicitFormat);
  }
  if (typeof config.code === "string" && config.code.trim()) {
    return parseTabularDataInput(config.code, effectiveTitle, explicitFormat);
  }

  // 3. Check if this is an existing Vega-Lite artifact with embedded spec.data.values
  if (config.spec && typeof config.spec === "object") {
    const specObj = config.spec as Record<string, unknown>;
    if (specObj.data && typeof specObj.data === "object") {
      const values = (specObj.data as Record<string, unknown>).values;
      if (Array.isArray(values) && values.length > 0) {
        return parseTabularDataInput(values, effectiveTitle, explicitFormat);
      }
    }
  }

  // 4. Fetch from URL if available
  const url =
    (typeof config.sourceUrl === "string" && config.sourceUrl) || (typeof config.url === "string" && config.url);
  if (url) {
    const response = await fetch(url);
    if (response.ok) {
      if (lowerTitle.endsWith(".h5") || lowerTitle.endsWith(".hdf5") || explicitFormat === "hdf5") {
        const buf = await response.arrayBuffer();
        return parseBinaryHdf5Buffer(buf, effectiveTitle);
      }
      const text = await response.text();
      return parseTabularDataInput(text, effectiveTitle, explicitFormat);
    }
  }

  return parseTabularDataInput("", effectiveTitle, explicitFormat);
}
