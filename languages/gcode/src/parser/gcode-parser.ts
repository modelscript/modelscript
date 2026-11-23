// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * RS-274 / ISO 6983 G-code Parser with `#` parameter expression evaluation,
 * subprogram (`Oxxxx` ... `M99`) extraction, and syntax error recovery.
 */

import type {
  GCodeBlock,
  GCodeComment,
  GCodeParamAssignment,
  GCodeParseError,
  GCodeProgram,
  GCodeSubprogram,
  GCodeWord,
} from "../types.js";

const VALID_ADDRESS_LETTERS = new Set([
  "A",
  "B",
  "C",
  "D",
  "E",
  "F",
  "G",
  "H",
  "I",
  "J",
  "K",
  "L",
  "M",
  "N",
  "O",
  "P",
  "Q",
  "R",
  "S",
  "T",
  "U",
  "V",
  "W",
  "X",
  "Y",
  "Z",
]);

/**
 * Normalizes a G or M word value to ISO 6983 canonical two-digit code (e.g., G0 -> G00, M3 -> M03).
 */
export function normalizeGMCode(letter: string, value: number): string {
  const upper = letter.toUpperCase();
  if (!Number.isFinite(value)) return `${upper}?`;
  if (Math.abs(value - Math.round(value)) < 1e-9) {
    const intVal = Math.round(value);
    if (intVal >= 0 && intVal < 10) {
      return `${upper}0${intVal}`;
    }
    return `${upper}${intVal}`;
  }
  return `${upper}${value}`;
}

/**
 * Evaluates a safe RS-274 bracketed arithmetic expression (e.g. `[#100 + 5 * SIN[30]]`).
 */
export function evaluateGCodeExpression(expr: string, params: Map<number, number>): number {
  const src = expr.trim();
  let pos = 0;

  function skipWs(): void {
    while (pos < src.length && /\s/.test(src[pos] ?? "")) pos++;
  }

  function parseAddSub(): number {
    let left = parseMulDiv();
    while (true) {
      skipWs();
      const ch = src[pos];
      if (ch === "+") {
        pos++;
        left += parseMulDiv();
      } else if (ch === "-") {
        pos++;
        left -= parseMulDiv();
      } else {
        break;
      }
    }
    return left;
  }

  function parseMulDiv(): number {
    let left = parseUnary();
    while (true) {
      skipWs();
      const ch = src[pos];
      if (ch === "*") {
        pos++;
        left *= parseUnary();
      } else if (ch === "/") {
        pos++;
        const rhs = parseUnary();
        left = rhs === 0 ? Number.NaN : left / rhs;
      } else if (src.slice(pos, pos + 3).toUpperCase() === "MOD") {
        pos += 3;
        const rhs = parseUnary();
        left = rhs === 0 ? Number.NaN : left % rhs;
      } else {
        break;
      }
    }
    return left;
  }

  function parseUnary(): number {
    skipWs();
    const ch = src[pos];
    if (ch === "+") {
      pos++;
      return parseUnary();
    }
    if (ch === "-") {
      pos++;
      return -parseUnary();
    }
    return parsePrimary();
  }

  function parsePrimary(): number {
    skipWs();
    const ch = src[pos];

    if (ch === "[") {
      pos++;
      const val = parseAddSub();
      skipWs();
      if (src[pos] === "]") pos++;
      return val;
    }

    if (ch === "#") {
      pos++;
      const numMatch = src.slice(pos).match(/^\d+/);
      if (!numMatch) return Number.NaN;
      pos += numMatch[0].length;
      const paramId = Number.parseInt(numMatch[0], 10);
      return params.get(paramId) ?? 0;
    }

    // Standard RS-274 math functions (angles in degrees per RS-274NGC)
    const fnMatch = src.slice(pos).match(/^(SIN|COS|TAN|SQRT|ABS|ROUND|FIX|FUP)\s*\[/i);
    if (fnMatch) {
      const fnName = (fnMatch[1] ?? "").toUpperCase();
      pos += fnMatch[0].length;
      const arg = parseAddSub();
      skipWs();
      if (src[pos] === "]") pos++;
      switch (fnName) {
        case "SIN":
          return Math.sin((arg * Math.PI) / 180);
        case "COS":
          return Math.cos((arg * Math.PI) / 180);
        case "TAN":
          return Math.tan((arg * Math.PI) / 180);
        case "SQRT":
          return Math.sqrt(arg);
        case "ABS":
          return Math.abs(arg);
        case "ROUND":
          return Math.round(arg);
        case "FIX":
          return Math.trunc(arg);
        case "FUP":
          return arg >= 0 ? Math.ceil(arg) : Math.floor(arg);
        default:
          return Number.NaN;
      }
    }

    const numMatch = src.slice(pos).match(/^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/);
    if (numMatch) {
      pos += numMatch[0].length;
      return Number.parseFloat(numMatch[0]);
    }

    return Number.NaN;
  }

  const result = parseAddSub();
  skipWs();
  if (pos < src.length) return Number.NaN;
  return result;
}

/**
 * Extracts a balanced `[...]` expression starting at `startIdx`. Returns end index (exclusive) or -1.
 */
function findMatchingBracket(line: string, startIdx: number): number {
  let depth = 0;
  for (let i = startIdx; i < line.length; i++) {
    if (line[i] === "[") depth++;
    else if (line[i] === "]") {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

/**
 * Parses an RS-274 / ISO 6983 G-code program string into a structured `GCodeProgram`.
 */
export function parseGCode(source: string, defaultName = "Program"): GCodeProgram {
  const allBlocks: GCodeBlock[] = [];
  const allComments: GCodeComment[] = [];
  const parseErrors: GCodeParseError[] = [];
  const parameters = new Map<number, number>();
  const subprograms = new Map<number, GCodeSubprogram>();

  const rawLines = source.split(/\r?\n/);
  let offset = 0;
  let mainProgramNumber: number | undefined;
  let programName = defaultName;

  for (let lineIdx = 0; lineIdx < rawLines.length; lineIdx++) {
    const rawLine = rawLines[lineIdx] ?? "";
    const lineNum = lineIdx + 1;
    const lineStartOffset = offset;
    const lineEndOffset = offset + rawLine.length;

    // Advance offset for next line (+1 for \n, or +2 if \r\n)
    const nextChar = source[lineEndOffset];
    if (nextChar === "\r" && source[lineEndOffset + 1] === "\n") {
      offset = lineEndOffset + 2;
    } else if (nextChar === "\n" || nextChar === "\r") {
      offset = lineEndOffset + 1;
    } else {
      offset = lineEndOffset;
    }

    const blockComments: GCodeComment[] = [];
    const words: GCodeWord[] = [];
    const gCodes: string[] = [];
    const mCodes: string[] = [];
    const paramAssignments: GCodeParamAssignment[] = [];

    let blockDelete = false;
    let isTapeMarker = false;
    let blockLineNumber: number | undefined;
    let blockProgramNumber: number | undefined;

    let i = 0;
    const len = rawLine.length;

    // Skip leading whitespace
    while (i < len && /\s/.test(rawLine[i] ?? "")) i++;

    if (i < len && rawLine[i] === "%") {
      isTapeMarker = true;
      i++;
      while (i < len && /\s/.test(rawLine[i] ?? "")) i++;
    }

    if (!isTapeMarker && i < len && rawLine[i] === "/") {
      blockDelete = true;
      i++;
      // Optional slash level digit (e.g., /1)
      if (i < len && /\d/.test(rawLine[i] ?? "")) i++;
    }

    while (i < len) {
      const ch = rawLine[i] ?? "";

      // Skip whitespace
      if (/\s/.test(ch)) {
        i++;
        continue;
      }

      // Semicolon end-of-line comment
      if (ch === ";") {
        const text = rawLine.slice(i + 1).trim();
        const comment: GCodeComment = {
          kind: "semicolon",
          text,
          line: lineNum,
          column: i + 1,
          startOffset: lineStartOffset + i,
          endOffset: lineEndOffset,
        };
        blockComments.push(comment);
        allComments.push(comment);
        break;
      }

      // Parenthesized inline comment ( ... )
      if (ch === "(") {
        const closeIdx = rawLine.indexOf(")", i + 1);
        if (closeIdx === -1) {
          parseErrors.push({
            message: "Unclosed parenthesized comment '('",
            line: lineNum,
            column: i + 1,
            startOffset: lineStartOffset + i,
            endOffset: lineEndOffset,
          });
          const text = rawLine.slice(i + 1).trim();
          const comment: GCodeComment = {
            kind: "paren",
            text,
            line: lineNum,
            column: i + 1,
            startOffset: lineStartOffset + i,
            endOffset: lineEndOffset,
          };
          blockComments.push(comment);
          allComments.push(comment);
          break;
        }
        const text = rawLine.slice(i + 1, closeIdx).trim();
        const comment: GCodeComment = {
          kind: "paren",
          text,
          line: lineNum,
          column: i + 1,
          startOffset: lineStartOffset + i,
          endOffset: lineStartOffset + closeIdx + 1,
        };
        blockComments.push(comment);
        allComments.push(comment);
        i = closeIdx + 1;
        continue;
      }

      // Parameter assignment: #100 = 12.5 or #101 = [#100 + 5]
      if (ch === "#") {
        const assignStart = i;
        const match = rawLine.slice(i).match(/^#(\d+)\s*=\s*/);
        if (!match) {
          parseErrors.push({
            message: `Malformed parameter expression starting at '${rawLine.slice(i, i + 12)}'`,
            line: lineNum,
            column: i + 1,
            startOffset: lineStartOffset + i,
            endOffset: lineStartOffset + Math.min(len, i + 8),
          });
          i++;
          continue;
        }
        const paramNum = Number.parseInt(match[1] ?? "0", 10);
        i += match[0].length;
        let exprRaw = "";
        if (rawLine[i] === "[") {
          const endBracket = findMatchingBracket(rawLine, i);
          if (endBracket === -1) {
            parseErrors.push({
              message: `Unclosed '[' in parameter #${paramNum} assignment`,
              line: lineNum,
              column: i + 1,
              startOffset: lineStartOffset + i,
              endOffset: lineEndOffset,
            });
            break;
          }
          exprRaw = rawLine.slice(i, endBracket);
          i = endBracket;
        } else {
          const valMatch = rawLine.slice(i).match(/^(?:#\d+|[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/);
          if (!valMatch) {
            parseErrors.push({
              message: `Missing value in parameter #${paramNum} assignment`,
              line: lineNum,
              column: i + 1,
              startOffset: lineStartOffset + i,
              endOffset: lineStartOffset + Math.min(len, i + 4),
            });
            break;
          }
          exprRaw = valMatch[0];
          i += valMatch[0].length;
        }
        const evaluated = evaluateGCodeExpression(exprRaw, parameters);
        if (!Number.isFinite(evaluated)) {
          parseErrors.push({
            message: `Invalid expression '${exprRaw}' in parameter #${paramNum} assignment`,
            line: lineNum,
            column: assignStart + 1,
            startOffset: lineStartOffset + assignStart,
            endOffset: lineStartOffset + i,
          });
        } else {
          parameters.set(paramNum, evaluated);
        }
        paramAssignments.push({
          paramNumber: paramNum,
          expression: exprRaw,
          value: evaluated,
          line: lineNum,
          column: assignStart + 1,
          startOffset: lineStartOffset + assignStart,
          endOffset: lineStartOffset + i,
        });
        continue;
      }

      // Address word: Letter + value / #param / [expr]
      const upper = ch.toUpperCase();
      if (/[A-Z]/.test(upper)) {
        const wordStart = i;
        i++;
        // Allow optional whitespace between letter and value in permissive RS-274
        while (i < len && (rawLine[i] === " " || rawLine[i] === "\t")) i++;

        if (!VALID_ADDRESS_LETTERS.has(upper)) {
          parseErrors.push({
            message: `Unknown G-code address letter '${upper}'`,
            line: lineNum,
            column: wordStart + 1,
            startOffset: lineStartOffset + wordStart,
            endOffset: lineStartOffset + wordStart + 1,
          });
          continue;
        }

        let value = Number.NaN;
        let exprStr: string | undefined;

        if (rawLine[i] === "[") {
          const endBracket = findMatchingBracket(rawLine, i);
          if (endBracket === -1) {
            parseErrors.push({
              message: `Unclosed '[' expression for word '${upper}'`,
              line: lineNum,
              column: i + 1,
              startOffset: lineStartOffset + i,
              endOffset: lineEndOffset,
            });
            break;
          }
          exprStr = rawLine.slice(i, endBracket);
          value = evaluateGCodeExpression(exprStr, parameters);
          i = endBracket;
        } else if (rawLine[i] === "#") {
          const pMatch = rawLine.slice(i).match(/^#(\d+)/);
          if (!pMatch) {
            parseErrors.push({
              message: `Invalid parameter reference after '${upper}'`,
              line: lineNum,
              column: i + 1,
              startOffset: lineStartOffset + i,
              endOffset: lineStartOffset + Math.min(len, i + 4),
            });
            i++;
            continue;
          }
          exprStr = pMatch[0];
          value = parameters.get(Number.parseInt(pMatch[1] ?? "0", 10)) ?? 0;
          i += pMatch[0].length;
        } else {
          const numMatch = rawLine.slice(i).match(/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/);
          if (!numMatch) {
            parseErrors.push({
              message: `Missing numeric value for address word '${upper}'`,
              line: lineNum,
              column: wordStart + 1,
              startOffset: lineStartOffset + wordStart,
              endOffset: lineStartOffset + i,
            });
            continue;
          }
          value = Number.parseFloat(numMatch[0]);
          i += numMatch[0].length;
        }

        const raw = rawLine.slice(wordStart, i);
        const canonicalCode = upper === "G" || upper === "M" ? normalizeGMCode(upper, value) : undefined;

        if (upper === "G" && canonicalCode) gCodes.push(canonicalCode);
        if (upper === "M" && canonicalCode) mCodes.push(canonicalCode);
        if (upper === "N" && Number.isFinite(value)) blockLineNumber = Math.round(value);
        if (upper === "O" && Number.isFinite(value)) {
          blockProgramNumber = Math.round(value);
          if (mainProgramNumber === undefined) {
            mainProgramNumber = blockProgramNumber;
            programName = `O${String(blockProgramNumber).padStart(4, "0")}`;
          }
        }

        words.push({
          letter: upper,
          value,
          canonicalCode,
          raw,
          expression: exprStr,
          line: lineNum,
          column: wordStart + 1,
          startOffset: lineStartOffset + wordStart,
          endOffset: lineStartOffset + i,
        });
        continue;
      }

      // Unexpected character
      parseErrors.push({
        message: `Unexpected character '${ch}'`,
        line: lineNum,
        column: i + 1,
        startOffset: lineStartOffset + i,
        endOffset: lineStartOffset + i + 1,
      });
      i++;
    }

    // Store non-empty blocks (or tape markers / comment-only lines)
    if (isTapeMarker || words.length > 0 || paramAssignments.length > 0 || blockComments.length > 0) {
      allBlocks.push({
        blockIndex: allBlocks.length,
        line: lineNum,
        lineNumber: blockLineNumber,
        programNumber: blockProgramNumber,
        blockDelete,
        isTapeMarker,
        words,
        gCodes,
        mCodes,
        paramAssignments,
        comments: blockComments,
        rawText: rawLine,
        startOffset: lineStartOffset,
        endOffset: lineEndOffset,
      });
    }
  }

  // Partition main program blocks vs subprograms (Oxxxx ... M99)
  const mainBlocks: GCodeBlock[] = [];
  let activeSub: GCodeSubprogram | undefined;
  let seenFirstProgramHeader = false;

  for (const block of allBlocks) {
    if (block.programNumber !== undefined) {
      if (!seenFirstProgramHeader) {
        seenFirstProgramHeader = true;
        mainBlocks.push(block);
        continue;
      }
      // Close any previous subprogram
      if (activeSub) {
        subprograms.set(activeSub.programNumber, activeSub);
      }
      activeSub = {
        programNumber: block.programNumber,
        name: `O${String(block.programNumber).padStart(4, "0")}`,
        startLine: block.line,
        endLine: block.line,
        startOffset: block.startOffset,
        endOffset: block.endOffset,
        blocks: [block],
      };
      continue;
    }

    if (activeSub) {
      if (block.isTapeMarker) {
        subprograms.set(activeSub.programNumber, activeSub);
        activeSub = undefined;
        mainBlocks.push(block);
        continue;
      }
      activeSub.blocks.push(block);
      activeSub.endLine = block.line;
      activeSub.endOffset = block.endOffset;
      if (block.mCodes.includes("M99")) {
        subprograms.set(activeSub.programNumber, activeSub);
        activeSub = undefined;
      }
    } else {
      mainBlocks.push(block);
    }
  }

  if (activeSub) {
    subprograms.set(activeSub.programNumber, activeSub);
  }

  return {
    name: programName,
    programNumber: mainProgramNumber,
    blocks: mainBlocks,
    subprograms,
    parameters,
    comments: allComments,
    parseErrors,
    rawText: source,
  };
}
