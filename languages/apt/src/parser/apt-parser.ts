// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * APT (Automatically Programmed Tools, ISO 4342) Part Program Parser.
 *
 * Parses APT source code including `$$` comments, `$` line continuations,
 * postprocessor directives (`PARTNO`, `MACHIN`, `UNITS`, `INTOL`, `OUTTOL`,
 * `CUTTER`, `SPINDL`, `FEDRAT`, `COOLNT`, `RAPID`, `FINI`), canonical geometry
 * definitions (`POINT`, `LINE`, `CIRCLE`, `PLANE`, `PATERN`), and continuous-path
 * / point-to-point motion commands (`FROM`, `GOTO`, `GODLTA`, `GO`, `GOLFT`,
 * `GORGT`, `GOFWD`, `GOBACK`, `GOUP`, `GODOWN`).
 */

import type {
  AptGeometryDef,
  AptGeometryKind,
  AptMotionKeyword,
  AptMotionStmt,
  AptParseError,
  AptPostProcessorKeyword,
  AptPostProcessorStmt,
  AptProgram,
  AptStatement,
  AptUnits,
} from "../types.js";

const GEOMETRY_KINDS = new Set<string>(["POINT", "LINE", "CIRCLE", "PLANE", "PATERN"]);

const MOTION_KEYWORDS = new Set<string>([
  "FROM",
  "GOTO",
  "GODLTA",
  "GO",
  "GOLFT",
  "GORGT",
  "GOFWD",
  "GOBACK",
  "GOUP",
  "GODOWN",
]);

const POSTPROCESSOR_SLASH_KEYWORDS = new Set<string>([
  "MACHIN",
  "UNITS",
  "INTOL",
  "OUTTOL",
  "CUTTER",
  "SPINDL",
  "FEDRAT",
  "COOLNT",
]);

const POSTPROCESSOR_BARE_KEYWORDS = new Set<string>(["RAPID", "FINI"]);

interface LogicalLine {
  text: string;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  startOffset: number;
  endOffset: number;
}

/**
 * Strips `$$` comments and joins `$` continuation lines while preserving exact 1-based line/column spans.
 */
function preprocessLines(source: string): LogicalLine[] {
  const rawLines = source.split(/\r?\n/);
  const result: LogicalLine[] = [];

  let offset = 0;
  let pending: LogicalLine | null = null;

  for (let i = 0; i < rawLines.length; i++) {
    const raw = rawLines[i] ?? "";
    const lineNum = i + 1;
    const lineStartOffset = offset;
    offset += raw.length + 1; // +1 for \n (approximate for CRLF, accurate for LF)

    // Strip $$ comment
    const commentIdx = raw.indexOf("$$");
    const codePart = commentIdx >= 0 ? raw.slice(0, commentIdx) : raw;
    const trimmedRight = codePart.replace(/\s+$/, "");

    // Check single trailing $ continuation (not $$)
    const hasContinuation = trimmedRight.endsWith("$") && !trimmedRight.endsWith("$$");
    const cleanChunk = hasContinuation ? trimmedRight.slice(0, -1).trim() : trimmedRight.trim();

    if (!cleanChunk && !pending) {
      continue;
    }

    const leadingWs = codePart.length - codePart.trimStart().length;
    const col = leadingWs + 1;
    const endCol = col + Math.max(1, trimmedRight.trim().length);
    const startOff = lineStartOffset + leadingWs;
    const endOff = lineStartOffset + Math.max(leadingWs + 1, trimmedRight.length);

    if (pending) {
      if (cleanChunk) {
        pending.text = `${pending.text} ${cleanChunk}`;
      }
      pending.endLine = lineNum;
      pending.endColumn = endCol;
      pending.endOffset = endOff;
      if (!hasContinuation) {
        result.push(pending);
        pending = null;
      }
    } else {
      const entry: LogicalLine = {
        text: cleanChunk,
        line: lineNum,
        column: col,
        endLine: lineNum,
        endColumn: endCol,
        startOffset: startOff,
        endOffset: endOff,
      };
      if (hasContinuation) {
        pending = entry;
      } else if (entry.text.length > 0) {
        result.push(entry);
      }
    }
  }

  if (pending && pending.text.length > 0) {
    result.push(pending);
  }

  return result;
}

/**
 * Splits a comma-separated APT argument list while respecting parentheses.
 */
function splitAptArgs(argStr: string): string[] {
  const args: string[] = [];
  let current = "";
  let depth = 0;
  for (let i = 0; i < argStr.length; i++) {
    const ch = argStr[i]!;
    if (ch === "(") {
      depth++;
      current += ch;
    } else if (ch === ")") {
      depth = Math.max(0, depth - 1);
      current += ch;
    } else if (ch === "," && depth === 0) {
      const trimmed = current.trim();
      if (trimmed.length > 0) args.push(trimmed);
      current = "";
    } else {
      current += ch;
    }
  }
  const tail = current.trim();
  if (tail.length > 0) args.push(tail);
  return args;
}

/**
 * Parses an APT CNC part program into a structured `AptProgram` AST.
 */
export function parseAptProgram(source: string): AptProgram {
  const logicalLines = preprocessLines(source);
  const geometries = new Map<string, AptGeometryDef>();
  const geometryList: AptGeometryDef[] = [];
  const statements: AptStatement[] = [];
  const parseErrors: AptParseError[] = [];

  let partno = "UNNAMED_PART";
  let machin: string | undefined;
  let units: AptUnits = "INCHES";
  let intol = 0.001;
  let outtol = 0.001;
  let hasFini = false;

  for (const entry of logicalLines) {
    const text = entry.text;
    const span = {
      line: entry.line,
      column: entry.column,
      endLine: entry.endLine,
      endColumn: entry.endColumn,
      startOffset: entry.startOffset,
      endOffset: entry.endOffset,
    };

    // 1. PARTNO (free-form title after keyword)
    const partnoMatch = /^PARTNO(?:\s+(.*))?$/i.exec(text);
    if (partnoMatch) {
      const title = (partnoMatch[1] ?? "").trim();
      partno = title || "UNNAMED_PART";
      const stmt: AptPostProcessorStmt = {
        stmtKind: "postprocessor",
        keyword: "PARTNO",
        args: title ? [title] : [],
        raw: text,
        ...span,
      };
      statements.push(stmt);
      continue;
    }

    // 2. Bare postprocessor keywords: RAPID, FINI
    const upperBare = text.toUpperCase();
    if (POSTPROCESSOR_BARE_KEYWORDS.has(upperBare)) {
      const kw = upperBare as AptPostProcessorKeyword;
      if (kw === "FINI") hasFini = true;
      const stmt: AptPostProcessorStmt = {
        stmtKind: "postprocessor",
        keyword: kw,
        args: [],
        raw: text,
        ...span,
      };
      statements.push(stmt);
      continue;
    }

    // 3. Geometry definition: LABEL = KIND / ARGS
    const geomMatch = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([A-Za-z_][A-Za-z0-9_]*)\s*\/\s*(.*)$/.exec(text);
    if (geomMatch) {
      const label = geomMatch[1]!.toUpperCase();
      const kindRaw = geomMatch[2]!.toUpperCase();
      const argStr = geomMatch[3]!.trim();

      if (!GEOMETRY_KINDS.has(kindRaw)) {
        parseErrors.push({
          ...span,
          message: `Unknown geometry type '${kindRaw}' in definition of '${label}'`,
          rawLine: text,
        });
        continue;
      }

      const args = splitAptArgs(argStr);
      if (args.length === 0) {
        parseErrors.push({
          ...span,
          message: `Missing arguments in ${kindRaw} definition '${label}'`,
          rawLine: text,
        });
        continue;
      }

      const geomDef: AptGeometryDef = {
        stmtKind: "geometry",
        label,
        geometryKind: kindRaw as AptGeometryKind,
        args,
        raw: text,
        ...span,
      };
      geometryList.push(geomDef);
      if (!geometries.has(label)) {
        geometries.set(label, geomDef);
      }
      statements.push(geomDef);
      continue;
    }

    // 4. Slash-delimited command: KEYWORD / ARGS
    const slashMatch = /^([A-Za-z_][A-Za-z0-9_]*)\s*\/\s*(.*)$/.exec(text);
    if (slashMatch) {
      const kwRaw = slashMatch[1]!.toUpperCase();
      const argStr = slashMatch[2]!.trim();
      const args = splitAptArgs(argStr);

      if (POSTPROCESSOR_SLASH_KEYWORDS.has(kwRaw)) {
        const kw = kwRaw as AptPostProcessorKeyword;
        if (args.length === 0) {
          parseErrors.push({
            ...span,
            message: `Missing arguments for '${kw}' statement`,
            rawLine: text,
          });
          continue;
        }
        if (kw === "MACHIN") {
          machin = args.join(", ");
        } else if (kw === "UNITS") {
          const u = (args[0] ?? "").toUpperCase();
          if (u === "MM" || u === "MILLIMETERS") {
            units = "MM";
          } else if (u === "INCHES" || u === "INCH" || u === "IN") {
            units = "INCHES";
          } else {
            parseErrors.push({
              ...span,
              message: `Unknown UNITS specifier '${args[0]}' (expected INCHES or MM)`,
              rawLine: text,
            });
            continue;
          }
        } else if (kw === "INTOL") {
          const v = Number(args[0]);
          if (Number.isFinite(v)) intol = v;
        } else if (kw === "OUTTOL") {
          const v = Number(args[0]);
          if (Number.isFinite(v)) outtol = v;
        }

        const stmt: AptPostProcessorStmt = {
          stmtKind: "postprocessor",
          keyword: kw,
          args,
          raw: text,
          ...span,
        };
        statements.push(stmt);
        continue;
      }

      if (MOTION_KEYWORDS.has(kwRaw)) {
        if (args.length === 0) {
          parseErrors.push({
            ...span,
            message: `Missing target or surface arguments for '${kwRaw}' motion statement`,
            rawLine: text,
          });
          continue;
        }
        const stmt: AptMotionStmt = {
          stmtKind: "motion",
          keyword: kwRaw as AptMotionKeyword,
          args,
          raw: text,
          ...span,
        };
        statements.push(stmt);
        continue;
      }

      parseErrors.push({
        ...span,
        message: `Unrecognized APT keyword '${kwRaw}'`,
        rawLine: text,
      });
      continue;
    }

    // 5. Unrecognized statement
    parseErrors.push({
      ...span,
      message: `Unrecognized APT statement '${text}'`,
      rawLine: text,
    });
  }

  return {
    partno,
    machin,
    units,
    intol,
    outtol,
    hasFini,
    geometries,
    geometryList,
    statements,
    parseErrors,
  };
}
