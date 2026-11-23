// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/mps — Fixed-Column (80-col) and Free-Format IBM MPS Parser.
 *
 * Supports classic IBM MPSX/370 fixed-column punch-card layouts:
 *   Field 1: cols  2– 3 (0-indexed  1.. 3) — row/bound type code
 *   Field 2: cols  5–12 (0-indexed  4..12) — name 1 (row, col, vector)
 *   Field 3: cols 15–22 (0-indexed 14..22) — name 2 (row1, col, 'MARKER')
 *   Field 4: cols 25–36 (0-indexed 24..36) — numeric value 1
 *   Field 5: cols 40–47 (0-indexed 39..47) — name 3 (row2, 'INTORG'/'INTEND')
 *   Field 6: cols 50–61 (0-indexed 49..61) — numeric value 2
 *
 * And modern Free MPS (whitespace-delimited tokens of arbitrary length).
 */

import type {
  MpsBoundDirective,
  MpsColumn,
  MpsFormatMode,
  MpsModel,
  MpsObjectiveSense,
  MpsParseIssue,
  MpsParseOptions,
  MpsProblemClass,
  MpsQuadTerm,
  MpsRow,
  MpsRowType,
  MpsSourceSpan,
  MpsVarType,
} from "../types.js";

const SECTION_KEYWORDS = new Set([
  "NAME",
  "OBJSENSE",
  "OBJNAME",
  "ROWS",
  "COLUMNS",
  "RHS",
  "RANGES",
  "BOUNDS",
  "QUADOBJ",
  "QMATRIX",
  "ENDATA",
]);

const VALID_ROW_TYPES = new Set<string>(["N", "L", "G", "E"]);
const VALID_BOUND_TYPES = new Set<string>(["LO", "UP", "FX", "FR", "MI", "PL", "BV", "LI", "UI"]);
const VALUELESS_BOUNDS = new Set<string>(["FR", "MI", "PL", "BV"]);

interface RawBoundState {
  lb?: number | undefined;
  ub?: number | undefined;
  isFree?: boolean | undefined;
  isFixed?: boolean | undefined;
}

/**
 * Detects whether an MPS source text uses fixed-column IBM card layout or free format.
 */
function detectMpsFormat(lines: string[]): "fixed" | "free" {
  let embeddedSpaceSignals = 0;
  let freeSignals = 0;
  let section = "";

  for (const rawLine of lines) {
    if (!rawLine || rawLine.startsWith("*")) continue;
    const trimmed = rawLine.trim();
    if (!trimmed) continue;

    if (rawLine[0] !== " " && rawLine[0] !== "\t") {
      const kw = trimmed.split(/\s+/)[0]!.toUpperCase();
      if (SECTION_KEYWORDS.has(kw)) {
        section = kw;
        if (kw === "ENDATA") break;
        continue;
      }
    }

    if (section === "COLUMNS" || section === "RHS" || section === "RANGES") {
      const toks = trimmed.split(/\s+/);
      if (toks.some((t) => !t.startsWith("'") && t.length > 8 && Number.isNaN(Number(t)))) {
        freeSignals++;
      }
      // Classic fixed-column MPS can have spaces inside 8-char names (e.g. "ROW 1")
      if (rawLine.length >= 25 && rawLine.startsWith("    ") && rawLine[4] !== " ") {
        const f2 = rawLine.slice(4, 12).trim();
        const f3 = rawLine.slice(14, 22).trim();
        if (rawLine.slice(12, 14) === "  " && rawLine.slice(22, 24) === "  ") {
          if (f2.includes(" ") || f3.includes(" ")) {
            embeddedSpaceSignals++;
          }
        }
      }
    }
  }

  return embeddedSpaceSignals > 0 && freeSignals === 0 ? "fixed" : "free";
}

function sliceFixed(line: string, start: number, end: number): string {
  if (line.length <= start) return "";
  return line.slice(start, Math.min(line.length, end)).trim();
}

function parseNumberStrict(text: string): number {
  if (!text) return Number.NaN;
  // Classic Fortran/IBM D-exponent support (e.g. 1.5D-3)
  const normalized = text.replace(/[dD](?=[+-]?\d)/, "e");
  return Number(normalized);
}

export function parseMps(source: string, options?: MpsParseOptions): MpsModel {
  const lines = source.split(/\r?\n/);
  const mode: MpsFormatMode = options?.format ?? "auto";
  const detectedFormat: "fixed" | "free" = mode === "auto" ? detectMpsFormat(lines) : mode;

  let problemName = options?.defaultName ?? "MPS_MODEL";
  let sense: MpsObjectiveSense = options?.defaultSense ?? "MIN";
  let objectiveRow: string | undefined;
  let explicitObjName: string | undefined;

  let hasNameCard = false;
  let hasRowsSection = false;
  let hasEndataCard = false;
  let unclosedIntorgLine: number | undefined;

  let rhsName: string | undefined;
  let rangesName: string | undefined;
  let boundsName: string | undefined;

  const rows = new Map<string, MpsRow>();
  const columns = new Map<string, MpsColumn>();
  const colVarType = new Map<string, MpsVarType>();
  const colBounds = new Map<string, RawBoundState>();
  const colEntrySeen = new Map<string, Map<string, number>>();
  const bounds: MpsBoundDirective[] = [];
  const quadObj: MpsQuadTerm[] = [];
  const parseIssues: MpsParseIssue[] = [];

  let currentSection = "";
  let inIntegerBlock = false;
  let intorgLine: number | undefined;
  let charOffset = 0;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i]!;
    const lineNum = i + 1;
    const lineStart = charOffset;
    const lineEnd = charOffset + rawLine.length;
    charOffset = lineEnd + 1; // +1 for newline

    const makeSpan = (col = 1): MpsSourceSpan => ({
      line: lineNum,
      column: col,
      startOffset: lineStart,
      endOffset: lineEnd,
    });

    // Skip comment lines ('*' in column 1) and empty lines
    if (rawLine.startsWith("*")) continue;
    const trimmed = rawLine.trim();
    if (!trimmed) continue;

    // Check for section header card (must start in col 1 or be a known section header keyword)
    const startsAtCol0 = rawLine[0] !== " " && rawLine[0] !== "\t";
    const firstWord = trimmed.split(/\s+/)[0]!.toUpperCase();

    if (SECTION_KEYWORDS.has(firstWord) && (startsAtCol0 || currentSection === "" || firstWord === "ENDATA")) {
      if (firstWord === "NAME") {
        hasNameCard = true;
        currentSection = "NAME";
        if (detectedFormat === "fixed") {
          const fixedName = sliceFixed(rawLine, 14, 22) || trimmed.slice(4).trim();
          if (fixedName) problemName = fixedName;
        } else {
          const parts = trimmed.split(/\s+/);
          if (parts.length > 1) {
            problemName = parts.slice(1).join(" ");
          }
        }
        continue;
      }

      if (firstWord === "OBJSENSE") {
        const parts = trimmed.split(/\s+/);
        if (parts.length > 1) {
          const s = parts[1]!.toUpperCase();
          sense = s.startsWith("MAX") ? "MAX" : "MIN";
          currentSection = "OBJSENSE_DONE";
        } else {
          currentSection = "OBJSENSE";
        }
        continue;
      }

      if (firstWord === "OBJNAME") {
        const parts = trimmed.split(/\s+/);
        if (parts.length > 1) {
          explicitObjName = parts[1]!;
          currentSection = "OBJNAME_DONE";
        } else {
          currentSection = "OBJNAME";
        }
        continue;
      }

      if (firstWord === "ROWS") {
        hasRowsSection = true;
        currentSection = "ROWS";
        continue;
      }

      if (firstWord === "ENDATA") {
        hasEndataCard = true;
        currentSection = "ENDATA";
        break;
      }

      currentSection = firstWord;
      continue;
    }

    switch (currentSection) {
      case "OBJSENSE": {
        const s = trimmed.toUpperCase();
        if (s === "MAX" || s === "MAXIMIZE") {
          sense = "MAX";
        } else if (s === "MIN" || s === "MINIMIZE") {
          sense = "MIN";
        } else {
          parseIssues.push({
            kind: "syntax-error",
            message: `Unrecognized OBJSENSE value '${trimmed}'`,
            span: makeSpan(),
          });
        }
        currentSection = "OBJSENSE_DONE";
        break;
      }

      case "OBJNAME": {
        explicitObjName = trimmed.split(/\s+/)[0]!;
        currentSection = "OBJNAME_DONE";
        break;
      }

      case "ROWS": {
        let rowTypeRaw: string;
        let rowName: string;
        if (detectedFormat === "fixed") {
          rowTypeRaw = sliceFixed(rawLine, 1, 3).toUpperCase();
          rowName = sliceFixed(rawLine, 4, 12);
          if (!rowTypeRaw || !rowName) {
            const toks = trimmed.split(/\s+/);
            rowTypeRaw = (toks[0] ?? "").toUpperCase();
            rowName = toks[1] ?? "";
          }
        } else {
          const toks = trimmed.split(/\s+/);
          rowTypeRaw = (toks[0] ?? "").toUpperCase();
          rowName = toks[1] ?? "";
        }

        if (!rowTypeRaw || !rowName) {
          parseIssues.push({
            kind: "syntax-error",
            message: `Malformed ROWS card '${trimmed}'`,
            span: makeSpan(),
          });
          break;
        }

        if (!VALID_ROW_TYPES.has(rowTypeRaw)) {
          parseIssues.push({
            kind: "invalid-row-type",
            message: `Invalid row type '${rowTypeRaw}'`,
            symbol: rowTypeRaw,
            span: makeSpan(2),
          });
          break;
        }

        if (rows.has(rowName)) {
          parseIssues.push({
            kind: "duplicate-row",
            message: `Duplicate row '${rowName}'`,
            symbol: rowName,
            span: makeSpan(5),
          });
          break;
        }

        const rowType = rowTypeRaw as MpsRowType;
        if (rowType === "N" && !objectiveRow) {
          objectiveRow = rowName;
        }

        rows.set(rowName, {
          name: rowName,
          type: rowType,
          rhs: 0,
          span: makeSpan(5),
        });
        break;
      }

      case "COLUMNS": {
        let colName: string;
        const pairs: Array<{ row: string; valStr: string }> = [];
        let isMarker = false;
        let markerKind = "";

        if (detectedFormat === "fixed") {
          colName = sliceFixed(rawLine, 4, 12);
          const f3 = sliceFixed(rawLine, 14, 22);
          const f4 = sliceFixed(rawLine, 24, 36);
          const f5 = sliceFixed(rawLine, 39, 47);
          const f6 = sliceFixed(rawLine, 49, 61);

          if (f3 === "'MARKER'" || f3.toUpperCase() === "MARKER") {
            isMarker = true;
            markerKind = f5.replace(/'/g, "").toUpperCase();
          } else {
            if (f3 && f4) pairs.push({ row: f3, valStr: f4 });
            if (f5 && f6) pairs.push({ row: f5, valStr: f6 });
          }
        } else {
          const toks = trimmed.split(/\s+/);
          colName = toks[0] ?? "";
          if (toks.some((t) => t.toUpperCase().includes("MARKER"))) {
            isMarker = true;
            const kindTok = toks.find((t) => {
              const u = t.replace(/'/g, "").toUpperCase();
              return u === "INTORG" || u === "INTEND";
            });
            markerKind = kindTok ? kindTok.replace(/'/g, "").toUpperCase() : "";
          } else {
            for (let t = 1; t + 1 < toks.length; t += 2) {
              pairs.push({ row: toks[t]!, valStr: toks[t + 1]! });
            }
          }
        }

        if (isMarker) {
          if (markerKind === "INTORG") {
            inIntegerBlock = true;
            intorgLine = lineNum;
          } else if (markerKind === "INTEND") {
            inIntegerBlock = false;
            intorgLine = undefined;
          }
          break;
        }

        if (!colName || pairs.length === 0) {
          parseIssues.push({
            kind: "syntax-error",
            message: `Malformed COLUMNS card '${trimmed}'`,
            span: makeSpan(),
          });
          break;
        }

        if (!columns.has(colName)) {
          const varType: MpsVarType = inIntegerBlock ? "integer" : "continuous";
          colVarType.set(colName, varType);
          columns.set(colName, {
            name: colName,
            varType,
            lb: 0,
            ub: Infinity,
            entries: [],
            span: makeSpan(5),
          });
          colEntrySeen.set(colName, new Map());
        } else if (inIntegerBlock && colVarType.get(colName) === "continuous") {
          colVarType.set(colName, "integer");
        }

        const colObj = columns.get(colName)!;
        const seenRows = colEntrySeen.get(colName)!;

        for (const p of pairs) {
          const val = parseNumberStrict(p.valStr);
          if (Number.isNaN(val)) {
            parseIssues.push({
              kind: "syntax-error",
              message: `Invalid numeric coefficient '${p.valStr}' for column '${colName}', row '${p.row}'`,
              span: makeSpan(),
            });
            continue;
          }

          if (!rows.has(p.row)) {
            parseIssues.push({
              kind: "undefined-row-columns",
              message: `Undefined row '${p.row}' in COLUMNS`,
              symbol: `${p.row}|${colName}`,
              span: makeSpan(),
            });
            continue;
          }

          const existingIdx = seenRows.get(p.row);
          if (existingIdx !== undefined) {
            colObj.entries[existingIdx]!.coeff += val;
            parseIssues.push({
              kind: "duplicate-column-entry",
              message: `Duplicate entry (${colName}, ${p.row})`,
              symbol: `${colName}|${p.row}`,
              span: makeSpan(),
            });
          } else {
            seenRows.set(p.row, colObj.entries.length);
            colObj.entries.push({
              rowName: p.row,
              coeff: val,
              span: makeSpan(),
            });
          }
        }
        break;
      }

      case "RHS": {
        let vecName = "";
        const pairs: Array<{ row: string; valStr: string }> = [];

        if (detectedFormat === "fixed") {
          vecName = sliceFixed(rawLine, 4, 12);
          const f3 = sliceFixed(rawLine, 14, 22);
          const f4 = sliceFixed(rawLine, 24, 36);
          const f5 = sliceFixed(rawLine, 39, 47);
          const f6 = sliceFixed(rawLine, 49, 61);
          if (f3 && f4) pairs.push({ row: f3, valStr: f4 });
          if (f5 && f6) pairs.push({ row: f5, valStr: f6 });
        } else {
          const toks = trimmed.split(/\s+/);
          let startIdx = 0;
          if (toks.length % 2 === 1) {
            vecName = toks[0]!;
            startIdx = 1;
          }
          for (let t = startIdx; t + 1 < toks.length; t += 2) {
            pairs.push({ row: toks[t]!, valStr: toks[t + 1]! });
          }
        }

        if (rhsName === undefined) {
          rhsName = vecName;
        } else if (vecName && rhsName && vecName !== rhsName) {
          // Standard MPS: ignore secondary RHS vectors
          break;
        }

        if (pairs.length === 0) {
          parseIssues.push({
            kind: "syntax-error",
            message: `Malformed RHS card '${trimmed}'`,
            span: makeSpan(),
          });
          break;
        }

        for (const p of pairs) {
          const val = parseNumberStrict(p.valStr);
          if (Number.isNaN(val)) {
            parseIssues.push({
              kind: "syntax-error",
              message: `Invalid RHS numeric value '${p.valStr}' for row '${p.row}'`,
              span: makeSpan(),
            });
            continue;
          }
          const row = rows.get(p.row);
          if (!row) {
            parseIssues.push({
              kind: "undefined-row-rhs",
              message: `Undefined row '${p.row}' in RHS`,
              symbol: p.row,
              span: makeSpan(),
            });
            continue;
          }
          row.rhs = val;
        }
        break;
      }

      case "RANGES": {
        let vecName = "";
        const pairs: Array<{ row: string; valStr: string }> = [];

        if (detectedFormat === "fixed") {
          vecName = sliceFixed(rawLine, 4, 12);
          const f3 = sliceFixed(rawLine, 14, 22);
          const f4 = sliceFixed(rawLine, 24, 36);
          const f5 = sliceFixed(rawLine, 39, 47);
          const f6 = sliceFixed(rawLine, 49, 61);
          if (f3 && f4) pairs.push({ row: f3, valStr: f4 });
          if (f5 && f6) pairs.push({ row: f5, valStr: f6 });
        } else {
          const toks = trimmed.split(/\s+/);
          let startIdx = 0;
          if (toks.length % 2 === 1) {
            vecName = toks[0]!;
            startIdx = 1;
          }
          for (let t = startIdx; t + 1 < toks.length; t += 2) {
            pairs.push({ row: toks[t]!, valStr: toks[t + 1]! });
          }
        }

        if (rangesName === undefined) {
          rangesName = vecName;
        } else if (vecName && rangesName && vecName !== rangesName) {
          break;
        }

        for (const p of pairs) {
          const val = parseNumberStrict(p.valStr);
          if (Number.isNaN(val)) {
            parseIssues.push({
              kind: "syntax-error",
              message: `Invalid RANGES value '${p.valStr}' for row '${p.row}'`,
              span: makeSpan(),
            });
            continue;
          }
          const row = rows.get(p.row);
          if (!row) {
            parseIssues.push({
              kind: "undefined-row-ranges",
              message: `Undefined row '${p.row}' in RANGES`,
              symbol: p.row,
              span: makeSpan(),
            });
            continue;
          }
          if (row.type === "N") {
            parseIssues.push({
              kind: "range-on-objective",
              message: `RANGES applied to N row '${p.row}'`,
              symbol: p.row,
              span: makeSpan(),
            });
          }
          row.range = val;
        }
        break;
      }

      case "BOUNDS": {
        let boundType = "";
        let bndName = "";
        let colName = "";
        let valStr = "";

        if (detectedFormat === "fixed") {
          boundType = sliceFixed(rawLine, 1, 3).toUpperCase();
          bndName = sliceFixed(rawLine, 4, 12);
          colName = sliceFixed(rawLine, 14, 22);
          valStr = sliceFixed(rawLine, 24, 36);
        } else {
          const toks = trimmed.split(/\s+/);
          if (toks.length < 2) {
            parseIssues.push({
              kind: "syntax-error",
              message: `Malformed BOUNDS card '${trimmed}'`,
              span: makeSpan(),
            });
            break;
          }
          boundType = toks[0]!.toUpperCase();
          if (VALUELESS_BOUNDS.has(boundType)) {
            if (toks.length >= 3) {
              bndName = toks[1]!;
              colName = toks[2]!;
            } else {
              colName = toks[1]!;
            }
          } else {
            if (toks.length >= 4) {
              bndName = toks[1]!;
              colName = toks[2]!;
              valStr = toks[3]!;
            } else if (toks.length === 3) {
              colName = toks[1]!;
              valStr = toks[2]!;
            }
          }
        }

        if (!VALID_BOUND_TYPES.has(boundType)) {
          parseIssues.push({
            kind: "invalid-bound-type",
            message: `Invalid bound type '${boundType}'`,
            symbol: boundType,
            span: makeSpan(2),
          });
          break;
        }

        if (boundsName === undefined) {
          boundsName = bndName;
        } else if (bndName && boundsName && bndName !== boundsName) {
          break;
        }

        const val = VALUELESS_BOUNDS.has(boundType) ? undefined : parseNumberStrict(valStr);
        if (!VALUELESS_BOUNDS.has(boundType) && (val === undefined || Number.isNaN(val))) {
          parseIssues.push({
            kind: "syntax-error",
            message: `Missing or invalid bound value '${valStr}' for '${boundType}' on '${colName}'`,
            span: makeSpan(),
          });
          break;
        }

        bounds.push({
          boundType,
          boundSetName: bndName || "BND1",
          columnName: colName,
          value: val,
          span: makeSpan(2),
        });

        if (!columns.has(colName)) {
          parseIssues.push({
            kind: "undefined-col-bounds",
            message: `Undefined column '${colName}' in BOUNDS`,
            symbol: colName,
            span: makeSpan(15),
          });
          break;
        }

        let b = colBounds.get(colName);
        if (!b) {
          b = {};
          colBounds.set(colName, b);
        }

        switch (boundType) {
          case "LO":
            b.lb = val!;
            b.isFree = false;
            break;
          case "UP":
            b.ub = val!;
            b.isFree = false;
            break;
          case "FX":
            b.lb = val!;
            b.ub = val!;
            b.isFixed = true;
            b.isFree = false;
            break;
          case "FR":
            b.lb = -Infinity;
            b.ub = Infinity;
            b.isFree = true;
            break;
          case "MI":
            b.lb = -Infinity;
            b.isFree = false;
            if (b.ub === undefined) b.ub = 0;
            break;
          case "PL":
            b.ub = Infinity;
            b.isFree = false;
            if (b.lb === undefined) b.lb = 0;
            break;
          case "BV":
            b.lb = 0;
            b.ub = 1;
            b.isFree = false;
            colVarType.set(colName, "binary");
            break;
          case "LI":
            b.lb = val!;
            b.isFree = false;
            colVarType.set(colName, "integer");
            break;
          case "UI":
            b.ub = val!;
            b.isFree = false;
            colVarType.set(colName, "integer");
            break;
        }
        break;
      }

      case "QUADOBJ":
      case "QMATRIX": {
        let col1 = "";
        let col2 = "";
        let valStr = "";

        if (detectedFormat === "fixed") {
          col1 = sliceFixed(rawLine, 4, 12);
          col2 = sliceFixed(rawLine, 14, 22);
          valStr = sliceFixed(rawLine, 24, 36);
        } else {
          const toks = trimmed.split(/\s+/);
          col1 = toks[0] ?? "";
          col2 = toks[1] ?? "";
          valStr = toks[2] ?? "";
        }

        const val = parseNumberStrict(valStr);
        if (!col1 || !col2 || Number.isNaN(val)) {
          parseIssues.push({
            kind: "syntax-error",
            message: `Malformed ${currentSection} card '${trimmed}'`,
            span: makeSpan(),
          });
          break;
        }

        if (!columns.has(col1)) {
          parseIssues.push({
            kind: "undefined-col-quadobj",
            message: `Undefined column '${col1}' in ${currentSection}`,
            symbol: col1,
            span: makeSpan(),
          });
          break;
        }
        if (!columns.has(col2)) {
          parseIssues.push({
            kind: "undefined-col-quadobj",
            message: `Undefined column '${col2}' in ${currentSection}`,
            symbol: col2,
            span: makeSpan(),
          });
          break;
        }

        // QMATRIX specifies full symmetric matrix (both (i,j) and (j,i)), so skip duplicate off-diagonal
        if (currentSection === "QMATRIX" && col1 > col2) {
          break;
        }

        quadObj.push({
          col1,
          col2,
          coeff: val,
          span: makeSpan(),
        });
        break;
      }

      default: {
        parseIssues.push({
          kind: "syntax-error",
          message: `Unexpected line outside MPS section: '${trimmed}'`,
          span: makeSpan(),
        });
        break;
      }
    }
  }

  if (inIntegerBlock) {
    unclosedIntorgLine = intorgLine;
  }

  if (explicitObjName && rows.has(explicitObjName)) {
    objectiveRow = explicitObjName;
  }

  // Finalize column bounds & types
  let hasDiscrete = false;
  for (const [colName, col] of columns) {
    const varType = colVarType.get(colName) ?? "continuous";
    col.varType = varType;
    if (varType === "integer" || varType === "binary") {
      hasDiscrete = true;
    }

    const b = colBounds.get(colName);
    if (!b) {
      // Standard MPS default: 0 <= x < +inf (or 0 <= x <= 1 for INTORG without explicit UB? Standard MPS: 0..+inf for LP, 0..1 for INTORG unless UI/UP specified; we keep 0..Infinity unless BV)
      col.lb = 0;
      col.ub = Infinity;
    } else if (varType === "binary") {
      col.lb = b.lb ?? 0;
      col.ub = b.ub ?? 1;
    } else if (b.isFree) {
      col.lb = -Infinity;
      col.ub = Infinity;
    } else if (b.isFixed) {
      col.lb = b.lb!;
      col.ub = b.ub!;
    } else {
      col.lb = b.lb ?? 0;
      col.ub = b.ub ?? Infinity;
    }
  }

  const hasQuad = quadObj.length > 0;
  let problemClass: MpsProblemClass;
  if (hasDiscrete && hasQuad) problemClass = "MIQP";
  else if (hasDiscrete) problemClass = "MILP";
  else if (hasQuad) problemClass = "QP";
  else problemClass = "LP";

  return {
    name: problemName,
    sense,
    objectiveRow,
    format: detectedFormat,
    problemClass,
    rows,
    columns,
    bounds,
    quadObj,
    hasNameCard,
    hasRowsSection,
    hasEndataCard,
    unclosedIntorgLine,
    rhsName,
    rangesName,
    boundsName,
    parseIssues,
  };
}
