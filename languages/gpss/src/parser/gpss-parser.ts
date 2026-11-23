// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Line-oriented GPSS (General Purpose Simulation System) source parser.
 *
 * Supports classic IBM GPSS/360, GPSS V, GPSS/H, and GPSS World syntax:
 * - `*` full-line comments and `;` full-line / inline comments
 * - Optional symbolic labels (e.g. `NEXT SEIZE JOE`, `CHAIRS STORAGE 3`, `EXPON FUNCTION RN1,C24`)
 * - All 16 core transaction blocks and 10 control statements
 * - Positional comma-separated A–G operands with omitted slots (e.g. `TRANSFER ,DONE`)
 * - Multi-line `FUNCTION` coordinate pair data (`x,y/x,y/...`)
 */

import {
  GPSS_BLOCK_OPCODES,
  GPSS_CONTROL_OPCODES,
  type GpssEquDef,
  type GpssFunctionDef,
  type GpssModel,
  type GpssStatement,
  type GpssStorageDef,
  type GpssSyntaxError,
  type GpssTableDef,
} from "../types.js";

const TEST_AUX_OPERATORS = new Set(["E", "NE", "G", "GE", "L", "LE"]);
const GATE_AUX_OPERATORS = new Set(["NU", "U", "SNF", "SF", "SE", "SNE", "LR", "LS", "NI", "I", "FV", "FNV"]);

function isKnownOpcode(token: string): boolean {
  const upper = token.toUpperCase();
  return GPSS_BLOCK_OPCODES.has(upper) || GPSS_CONTROL_OPCODES.has(upper);
}

/**
 * Detects whether a line is a `FUNCTION` data continuation line (`x,y/x,y/...`).
 */
function isFunctionDataLine(trimmed: string): boolean {
  if (!trimmed || trimmed.startsWith("*") || trimmed.startsWith(";")) return false;
  // Must start with a number (possibly signed or leading dot) and contain a comma
  return /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?\s*,/.test(trimmed);
}

/**
 * Parses slash-separated `x,y` coordinate pairs from a GPSS `FUNCTION` data line.
 */
function parseFunctionPairs(line: string): Array<[number, number]> {
  const withoutComment = line.split(";")[0]?.trim() ?? "";
  if (!withoutComment) return [];
  const pairs: Array<[number, number]> = [];
  const segments = withoutComment.split("/");
  for (const seg of segments) {
    const clean = seg.trim();
    if (!clean) continue;
    const parts = clean.split(",");
    if (parts.length >= 2) {
      const x = Number(parts[0]?.trim());
      const y = Number(parts[1]?.trim());
      if (Number.isFinite(x) && Number.isFinite(y)) {
        pairs.push([x, y]);
      }
    }
  }
  return pairs;
}

/**
 * Normalizes a storage name from `STORAGE` operands like `S$CHAIRS`, `S(CHAIRS)`, `S1`, or `CHAIRS`.
 */
function normalizeStorageEntity(raw: string): string {
  const trimmed = raw.trim().toUpperCase();
  if (trimmed.startsWith("S$")) return trimmed.slice(2);
  const parenMatch = /^S\(([^)]+)\)$/.exec(trimmed);
  if (parenMatch && parenMatch[1]) return parenMatch[1].trim().toUpperCase();
  return trimmed;
}

/**
 * Splits GPSS positional operands A–G on commas, keeping empty strings for omitted operands.
 */
function splitOperands(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  return trimmed.split(",").map((s) => s.trim());
}

/**
 * Parses a GPSS source string into a structured `GpssModel`.
 */
export function parseGpss(source: string, defaultName: string = "GpssModel"): GpssModel {
  const statements: GpssStatement[] = [];
  const blocks: GpssStatement[] = [];
  const labels = new Map<string, number>();
  const facilities = new Set<string>();
  const queues = new Set<string>();
  const storages = new Map<string, GpssStorageDef>();
  const functions = new Map<string, GpssFunctionDef>();
  const tables = new Map<string, GpssTableDef>();
  const equs = new Map<string, GpssEquDef>();
  const syntaxErrors: GpssSyntaxError[] = [];

  let modelName = defaultName;
  let startCount: number | undefined;
  let rmultSeed: number | undefined;
  let hasStart = false;
  let hasEnd = false;

  const lines = source.split(/\r?\n/);
  let offset = 0;
  let activeFunction: GpssFunctionDef | null = null;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i] ?? "";
    const lineNum = i + 1;
    const lineStart = offset;
    const lineEnd = offset + rawLine.length;
    // Advance offset for next line (accounting for \n; \r\n handled consistently enough for line offsets)
    offset = lineEnd + 1;

    const trimmed = rawLine.trim();
    if (!trimmed) continue;

    // Full-line comments (* or ;)
    if (trimmed.startsWith("*") || trimmed.startsWith(";")) {
      const titleMatch = /^[*;]\s*(?:MODEL|TITLE)\s*[:-]\s*([A-Za-z_][A-Za-z0-9_ -]*)/i.exec(trimmed);
      if (titleMatch && titleMatch[1] && modelName === defaultName) {
        modelName = titleMatch[1].trim().replace(/\s+/g, "_");
      }
      continue;
    }

    // Continuation lines for FUNCTION coordinate pairs
    if (activeFunction && isFunctionDataLine(trimmed)) {
      const pairs = parseFunctionPairs(trimmed);
      activeFunction.points.push(...pairs);
      activeFunction.endOffset = lineEnd;
      if (activeFunction.expectedPoints > 0 && activeFunction.points.length >= activeFunction.expectedPoints) {
        activeFunction = null;
      }
      continue;
    }
    activeFunction = null;

    // Strip inline `;` comment
    let codePart = rawLine;
    let comment: string | undefined;
    const semiIdx = rawLine.indexOf(";");
    if (semiIdx >= 0) {
      codePart = rawLine.slice(0, semiIdx);
      comment = rawLine.slice(semiIdx + 1).trim();
    }

    const codeTrimmed = codePart.trim();
    if (!codeTrimmed) continue;

    const leadingSpaces = codePart.length - codePart.trimStart().length;
    const column = leadingSpaces + 1;

    // Tokenize by whitespace while preserving trailing comment detection
    const tokens = codeTrimmed.split(/\s+/);
    let label: string | undefined;
    let opcode = "";
    let auxOperator: string | undefined;
    let operandTokenIndex = 1;

    const firstToken = tokens[0] ?? "";
    const secondToken = tokens[1] ?? "";

    if (isKnownOpcode(firstToken)) {
      opcode = firstToken.toUpperCase();
      operandTokenIndex = 1;
    } else if (secondToken && isKnownOpcode(secondToken)) {
      label = firstToken.toUpperCase();
      opcode = secondToken.toUpperCase();
      operandTokenIndex = 2;
    } else {
      // Unrecognized opcode or malformed statement
      opcode = firstToken.toUpperCase();
      operandTokenIndex = 1;
      syntaxErrors.push({
        message: `Unrecognized GPSS statement or opcode '${firstToken}'`,
        line: lineNum,
        column,
        startOffset: lineStart + leadingSpaces,
        endOffset: lineEnd,
      });
    }

    // Handle auxiliary operators for TEST and GATE (e.g. `TEST G Q$LINE,5,BALK` or `GATE NU JOE,WAIT`)
    if (opcode === "TEST" && tokens[operandTokenIndex]) {
      const candidate = (tokens[operandTokenIndex] ?? "").toUpperCase();
      if (TEST_AUX_OPERATORS.has(candidate)) {
        auxOperator = candidate;
        operandTokenIndex++;
      }
    } else if (opcode === "GATE" && tokens[operandTokenIndex]) {
      const candidate = (tokens[operandTokenIndex] ?? "").toUpperCase();
      if (GATE_AUX_OPERATORS.has(candidate)) {
        auxOperator = candidate;
        operandTokenIndex++;
      }
    }

    // In classic GPSS, the operand field has no internal spaces; any whitespace after the operand field begins an inline comment.
    const rawOperandField = tokens[operandTokenIndex] ?? "";
    if (!comment && tokens.length > operandTokenIndex + 1) {
      comment = tokens.slice(operandTokenIndex + 1).join(" ");
    }

    const operands = splitOperands(rawOperandField);

    const stmt: GpssStatement = {
      label,
      opcode,
      auxOperator,
      operands,
      rawOperands: rawOperandField,
      comment,
      line: lineNum,
      column,
      startOffset: lineStart + leadingSpaces,
      endOffset: lineEnd,
    };

    statements.push(stmt);

    // Track executable transaction blocks
    if (GPSS_BLOCK_OPCODES.has(opcode)) {
      const blockIdx = blocks.length;
      stmt.blockIndex = blockIdx;
      blocks.push(stmt);

      if (label && !labels.has(label)) {
        labels.set(label, blockIdx);
      }

      // Collect referenced facilities, queues, and storages
      const opA = (operands[0] ?? "").toUpperCase();
      if ((opcode === "SEIZE" || opcode === "RELEASE") && opA) {
        facilities.add(opA);
      } else if ((opcode === "QUEUE" || opcode === "DEPART") && opA) {
        queues.add(opA);
      } else if (opcode === "GATE" && opA && (auxOperator === "U" || auxOperator === "NU")) {
        facilities.add(opA);
      }
    } else if (opcode === "STORAGE") {
      // Form 1: `CHAIRS STORAGE 3`
      // Form 2: `STORAGE S$CHAIRS,3` or `STORAGE S1,3/S2,4`
      if (label) {
        const cap = Number(operands[0]);
        storages.set(label, {
          name: label,
          capacity: Number.isFinite(cap) ? cap : Number.NaN,
          line: lineNum,
          startOffset: stmt.startOffset,
          endOffset: stmt.endOffset,
        });
      } else if (rawOperandField) {
        const entries = rawOperandField.split("/");
        for (const entry of entries) {
          const parts = entry.split(",");
          if (parts.length >= 2) {
            const name = normalizeStorageEntity(parts[0] ?? "");
            const cap = Number(parts[1]?.trim());
            if (name) {
              storages.set(name, {
                name,
                capacity: Number.isFinite(cap) ? cap : Number.NaN,
                line: lineNum,
                startOffset: stmt.startOffset,
                endOffset: stmt.endOffset,
              });
            }
          }
        }
      }
    } else if (opcode === "FUNCTION") {
      const fnName = (label || operands[0] || "FN1").toUpperCase();
      const arg = (operands[0] || "RN1").toUpperCase();
      const modeSpec = (operands[1] || "C2").toUpperCase();
      const modeChar = modeSpec[0];
      const mode: "C" | "D" | "L" | "E" = modeChar === "D" || modeChar === "L" || modeChar === "E" ? modeChar : "C";
      const expectedPoints = parseInt(modeSpec.slice(1), 10) || 0;
      const fnDef: GpssFunctionDef = {
        name: fnName,
        argument: arg,
        mode,
        expectedPoints,
        points: [],
        line: lineNum,
        startOffset: stmt.startOffset,
        endOffset: stmt.endOffset,
      };
      functions.set(fnName, fnDef);
      activeFunction = fnDef;
    } else if (opcode === "TABLE") {
      const tableName = (label || "TAB1").toUpperCase();
      const argument = (operands[0] || "M1").toUpperCase();
      const firstUpperLimit = Number(operands[1] ?? 10);
      const width = Number(operands[2] ?? 10);
      const classCount = Number(operands[3] ?? 20);
      tables.set(tableName, {
        name: tableName,
        argument,
        firstUpperLimit: Number.isFinite(firstUpperLimit) ? firstUpperLimit : 10,
        width: Number.isFinite(width) && width > 0 ? width : 10,
        classCount: Number.isFinite(classCount) && classCount > 0 ? classCount : 20,
        line: lineNum,
        startOffset: stmt.startOffset,
        endOffset: stmt.endOffset,
      });
    } else if (opcode === "EQU") {
      if (label) {
        const val = Number(operands[0]);
        equs.set(label, {
          name: label,
          value: Number.isFinite(val) ? val : 0,
          entityType: operands[1]?.toUpperCase(),
          line: lineNum,
          startOffset: stmt.startOffset,
          endOffset: stmt.endOffset,
        });
      }
    } else if (opcode === "START") {
      hasStart = true;
      const count = Number(operands[0]);
      if (Number.isFinite(count) && count > 0) {
        startCount = count;
      }
    } else if (opcode === "RMULT") {
      const seed = Number(operands[0]);
      if (Number.isFinite(seed)) {
        rmultSeed = Math.floor(Math.abs(seed));
      }
    } else if (opcode === "END") {
      hasEnd = true;
    }
  }

  return {
    name: modelName,
    statements,
    blocks,
    labels,
    facilities,
    queues,
    storages,
    functions,
    tables,
    equs,
    startCount,
    rmultSeed,
    hasStart,
    hasEnd,
    syntaxErrors,
  };
}
