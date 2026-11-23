// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * JCAMP-DX ASDF (ASCII Squeezed Difference Form) Codec.
 *
 * Implements full IUPAC JCAMP-DX 4.24 / 5.01 compression and decompression:
 * - AFFN (ASCII Free Format Numeric)
 * - PAC  (Packed sign-delimited numbers)
 * - SQZ  (Squeezed: `@` = 0, `A`..`I` = +1..+9, `a`..`i` = -1..-9)
 * - DIF  (Difference: `%` = 0, `J`..`R` = +1..+9, `j`..`r` = -1..-9)
 * - DUP  (Duplicate: `S`..`Z` = 1..8, `s` = 9, with optional trailing digits)
 * - DIFDUP (Combined SQZ + DIF + DUP with line-to-line checkpoint verification)
 */

import type { AsdfMode, JcampCheckpointError, JcampDataPoint, JcampParseError } from "../types.js";

const SQZ_POS = "@ABCDEFGHI"; // 0..9
const SQZ_NEG = "abcdefghi"; // -1..-9
const DIF_POS = "%JKLMNOPQR"; // 0..9
const DIF_NEG = "jklmnopqr"; // -1..-9
const DUP_CHARS = "STUVWXYZs"; // 1..9

interface ParsedLineResult {
  rawX: number;
  rawYs: number[];
  endedInDif: boolean;
  parseError?: string;
}

/**
 * Parses a single `(X++(Y..Y))` line containing AFFN, PAC, SQZ, DIF, and/or DUP tokens.
 */
export function parseAsdfLine(rawLine: string): ParsedLineResult {
  // Strip inline $$ comments
  const commentIdx = rawLine.indexOf("$$");
  const line = (commentIdx >= 0 ? rawLine.slice(0, commentIdx) : rawLine).trim();
  if (!line) {
    return { rawX: NaN, rawYs: [], endedInDif: false };
  }

  let i = 0;
  const len = line.length;

  const skipSeparators = (): void => {
    while (i < len) {
      const ch = line[i]!;
      if (ch === " " || ch === "\t" || ch === "," || ch === ";") {
        i++;
      } else {
        break;
      }
    }
  };

  // Parse leading X value (AFFN / PAC numeric token)
  skipSeparators();
  const xStart = i;
  if (i < len && (line[i] === "+" || line[i] === "-")) i++;
  let hasDigits = false;
  while (i < len && line[i]! >= "0" && line[i]! <= "9") {
    hasDigits = true;
    i++;
  }
  if (i < len && line[i] === ".") {
    i++;
    while (i < len && line[i]! >= "0" && line[i]! <= "9") {
      hasDigits = true;
      i++;
    }
  }
  if (hasDigits && i < len && (line[i] === "e" || line[i] === "E")) {
    const expStart = i;
    i++;
    if (i < len && (line[i] === "+" || line[i] === "-")) i++;
    let expDigits = false;
    while (i < len && line[i]! >= "0" && line[i]! <= "9") {
      expDigits = true;
      i++;
    }
    if (!expDigits) {
      // Backtrack if 'E' was actually a SQZ pseudo-digit (+5) immediately following X!
      i = expStart;
    }
  }

  const xStr = line.slice(xStart, i);
  const rawX = Number(xStr);
  if (!hasDigits || !Number.isFinite(rawX)) {
    return {
      rawX: NaN,
      rawYs: [],
      endedInDif: false,
      parseError: `Invalid X coordinate '${xStr || line.slice(0, 12)}'`,
    };
  }

  const rawYs: number[] = [];
  let lastVal = 0;
  let lastDiff = 0;
  let lastWasDif = false;
  let anyDifOnLine = false;

  const readTrailingDigits = (): string => {
    let digits = "";
    while (i < len && ((line[i]! >= "0" && line[i]! <= "9") || line[i] === ".")) {
      digits += line[i]!;
      i++;
    }
    return digits;
  };

  while (i < len) {
    skipSeparators();
    if (i >= len) break;
    const ch = line[i]!;

    // 1. SQZ positive (@, A..I)
    const sqzPosIdx = SQZ_POS.indexOf(ch);
    if (sqzPosIdx >= 0) {
      i++;
      const rest = readTrailingDigits();
      const val = Number(`${sqzPosIdx}${rest}`);
      rawYs.push(val);
      lastVal = val;
      lastWasDif = false;
      continue;
    }

    // 2. SQZ negative (a..i)
    const sqzNegIdx = SQZ_NEG.indexOf(ch);
    if (sqzNegIdx >= 0) {
      i++;
      const rest = readTrailingDigits();
      const val = -Number(`${sqzNegIdx + 1}${rest}`);
      rawYs.push(val);
      lastVal = val;
      lastWasDif = false;
      continue;
    }

    // 3. DIF positive (%, J..R)
    const difPosIdx = DIF_POS.indexOf(ch);
    if (difPosIdx >= 0) {
      i++;
      const rest = readTrailingDigits();
      const diff = Number(`${difPosIdx}${rest}`);
      lastDiff = diff;
      lastVal = lastVal + diff;
      rawYs.push(lastVal);
      lastWasDif = true;
      anyDifOnLine = true;
      continue;
    }

    // 4. DIF negative (j..r)
    const difNegIdx = DIF_NEG.indexOf(ch);
    if (difNegIdx >= 0) {
      i++;
      const rest = readTrailingDigits();
      const diff = -Number(`${difNegIdx + 1}${rest}`);
      lastDiff = diff;
      lastVal = lastVal + diff;
      rawYs.push(lastVal);
      lastWasDif = true;
      anyDifOnLine = true;
      continue;
    }

    // 5. DUP (S..Z, s)
    const dupIdx = DUP_CHARS.indexOf(ch);
    if (dupIdx >= 0) {
      i++;
      let countStr = String(dupIdx + 1);
      while (i < len && line[i]! >= "0" && line[i]! <= "9") {
        countStr += line[i]!;
        i++;
      }
      const repeatTotal = Number.parseInt(countStr, 10);
      if (rawYs.length === 0) {
        return {
          rawX,
          rawYs,
          endedInDif: anyDifOnLine,
          parseError: `DUP token '${ch}${countStr.slice(1)}' has no preceding value`,
        };
      }
      for (let r = 1; r < repeatTotal; r++) {
        if (lastWasDif) {
          lastVal = lastVal + lastDiff;
        }
        rawYs.push(lastVal);
      }
      continue;
    }

    // 6. AFFN / PAC numeric value (+, -, digit, .)
    if (ch === "+" || ch === "-" || ch === "." || (ch >= "0" && ch <= "9")) {
      const start = i;
      if (ch === "+" || ch === "-") i++;
      let numHasDigits = false;
      while (i < len && line[i]! >= "0" && line[i]! <= "9") {
        numHasDigits = true;
        i++;
      }
      if (i < len && line[i] === ".") {
        i++;
        while (i < len && line[i]! >= "0" && line[i]! <= "9") {
          numHasDigits = true;
          i++;
        }
      }
      if (numHasDigits && i < len && (line[i] === "e" || line[i] === "E")) {
        const expStart = i;
        i++;
        if (i < len && (line[i] === "+" || line[i] === "-")) i++;
        let expDigits = false;
        while (i < len && line[i]! >= "0" && line[i]! <= "9") {
          expDigits = true;
          i++;
        }
        if (!expDigits) {
          i = expStart;
        }
      }
      const numStr = line.slice(start, i);
      const val = Number(numStr);
      if (!numHasDigits || !Number.isFinite(val)) {
        return { rawX, rawYs, endedInDif: anyDifOnLine, parseError: `Malformed numeric token '${numStr}'` };
      }
      rawYs.push(val);
      lastVal = val;
      lastWasDif = false;
      continue;
    }

    return { rawX, rawYs, endedInDif: anyDifOnLine, parseError: `Unexpected character '${ch}' in XYDATA` };
  }

  return { rawX, rawYs, endedInDif: anyDifOnLine };
}

export interface DecodeXyDataOptions {
  xFactor?: number;
  yFactor?: number;
  firstX?: number;
  lastX?: number;
  nPoints?: number;
  deltaX?: number;
  startLine?: number;
  /** Tolerance in raw unscaled ordinate units for DIFDUP checkpoint check (default 1e-6). */
  checkpointTolerance?: number;
}

export interface DecodeXyDataResult {
  points: JcampDataPoint[];
  checkpointErrors: JcampCheckpointError[];
  parseErrors: JcampParseError[];
}

/**
 * Decodes `##XYDATA=(X++(Y..Y))` data lines (supporting AFFN, PAC, SQZ, DIF, DUP, DIFDUP)
 * into scaled `{ x, y }` data points, performing DIFDUP checkpoint verification.
 */
export function decodeXyData(lines: string[], options: DecodeXyDataOptions = {}): DecodeXyDataResult {
  const xFactor = options.xFactor ?? 1;
  const yFactor = options.yFactor ?? 1;
  const startLine = options.startLine ?? 1;
  const tol = options.checkpointTolerance ?? 1e-6;

  const parsedLines: Array<{ lineNum: number; parsed: ParsedLineResult }> = [];
  const parseErrors: JcampParseError[] = [];
  const checkpointErrors: JcampCheckpointError[] = [];

  for (let idx = 0; idx < lines.length; idx++) {
    const rawLine = lines[idx]!;
    const stripped = rawLine.indexOf("$$") >= 0 ? rawLine.slice(0, rawLine.indexOf("$$")).trim() : rawLine.trim();
    if (!stripped) continue;
    const parsed = parseAsdfLine(rawLine);
    const lineNum = startLine + idx;
    if (parsed.parseError) {
      parseErrors.push({ line: lineNum, message: parsed.parseError });
      continue;
    }
    if (!Number.isFinite(parsed.rawX) || parsed.rawYs.length === 0) continue;
    parsedLines.push({ lineNum, parsed });
  }

  if (parsedLines.length === 0) {
    return { points: [], checkpointErrors, parseErrors };
  }

  // First pass: collect raw Y values per line, dropping DIFDUP checkpoint duplicates and verifying continuity
  const lineGroups: Array<{ scaledX: number; rawYs: number[] }> = [];
  let prevEndedInDif = false;
  let prevLastRawY = 0;
  let totalPoints = 0;

  for (let li = 0; li < parsedLines.length; li++) {
    const { lineNum, parsed } = parsedLines[li]!;
    const scaledX = parsed.rawX * xFactor;
    let ys = parsed.rawYs;

    if (li > 0 && prevEndedInDif) {
      const checkpointY = ys[0]!;
      const delta = Math.abs(checkpointY - prevLastRawY);
      if (delta > tol) {
        checkpointErrors.push({
          line: lineNum,
          expectedY: prevLastRawY,
          actualY: checkpointY,
          x: scaledX,
          delta,
        });
      }
      // Drop the checkpoint ordinate (it duplicates the previous line's final point)
      ys = ys.slice(1);
    }

    if (parsed.rawYs.length > 0) {
      prevLastRawY = parsed.rawYs[parsed.rawYs.length - 1]!;
    }
    prevEndedInDif = parsed.endedInDif;

    if (ys.length > 0) {
      lineGroups.push({ scaledX, rawYs: ys });
      totalPoints += ys.length;
    }
  }

  // Determine deltaX
  let deltaX = options.deltaX;
  if (deltaX === undefined || !Number.isFinite(deltaX) || deltaX === 0) {
    if (options.firstX !== undefined && options.lastX !== undefined && totalPoints > 1) {
      deltaX = (options.lastX - options.firstX) / (totalPoints - 1);
    } else if (lineGroups.length > 1) {
      const firstGroup = lineGroups[0]!;
      const secondGroup = lineGroups[1]!;
      deltaX = (secondGroup.scaledX - firstGroup.scaledX) / firstGroup.rawYs.length;
    } else {
      deltaX = xFactor;
    }
  }

  const points: JcampDataPoint[] = [];
  const baseX = options.firstX ?? lineGroups[0]!.scaledX;
  let globalIdx = 0;

  for (const group of lineGroups) {
    for (let j = 0; j < group.rawYs.length; j++) {
      const x =
        options.firstX !== undefined && options.lastX !== undefined && totalPoints > 1
          ? baseX + globalIdx * deltaX
          : group.scaledX + j * deltaX;
      points.push({ x, y: group.rawYs[j]! * yFactor });
      globalIdx++;
    }
  }

  return { points, checkpointErrors, parseErrors };
}

/**
 * Decodes `##PEAK TABLE=(XY..XY)` or `##XYPOINTS=(XY..XY)` lines into `{ x, y }` pairs.
 */
export function decodePeakTable(
  lines: string[],
  xFactor: number = 1,
  yFactor: number = 1,
  startLine: number = 1,
): { points: JcampDataPoint[]; parseErrors: JcampParseError[] } {
  const points: JcampDataPoint[] = [];
  const parseErrors: JcampParseError[] = [];

  for (let idx = 0; idx < lines.length; idx++) {
    const rawLine = lines[idx]!;
    const commentIdx = rawLine.indexOf("$$");
    const line = (commentIdx >= 0 ? rawLine.slice(0, commentIdx) : rawLine).trim();
    if (!line) continue;

    // Pairs may be separated by spaces, semicolons, or commas: e.g. "1715, 0.85; 2950, 0.62" or "1715 0.85 2950 0.62"
    const nums = line.match(/[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g);
    if (!nums || nums.length === 0) continue;

    if (nums.length % 2 !== 0) {
      parseErrors.push({
        line: startLine + idx,
        message: `Odd number of coordinates (${nums.length}) in XY peak table line`,
      });
    }

    for (let k = 0; k + 1 < nums.length; k += 2) {
      const x = Number(nums[k]!) * xFactor;
      const y = Number(nums[k + 1]!) * yFactor;
      if (Number.isFinite(x) && Number.isFinite(y)) {
        points.push({ x, y });
      }
    }
  }

  return { points, parseErrors };
}

// ---------------------------------------------------------------------------
// ASDF Encoder (AFFN, PAC, SQZ, DIF, DUP, DIFDUP)
// ---------------------------------------------------------------------------

function encodeSqzInt(n: number): string {
  const rounded = Math.round(n);
  if (rounded === 0) return "@";
  const absStr = String(Math.abs(rounded));
  const firstDigit = Number.parseInt(absStr[0]!, 10);
  const rest = absStr.slice(1);
  const prefix = rounded > 0 ? SQZ_POS[firstDigit]! : SQZ_NEG[firstDigit - 1]!;
  return `${prefix}${rest}`;
}

function encodeDifInt(d: number): string {
  const rounded = Math.round(d);
  if (rounded === 0) return "%";
  const absStr = String(Math.abs(rounded));
  const firstDigit = Number.parseInt(absStr[0]!, 10);
  const rest = absStr.slice(1);
  const prefix = rounded > 0 ? DIF_POS[firstDigit]! : DIF_NEG[firstDigit - 1]!;
  return `${prefix}${rest}`;
}

function encodeDupCount(count: number): string {
  const str = String(count);
  const firstDigit = Number.parseInt(str[0]!, 10);
  return `${DUP_CHARS[firstDigit - 1]!}${str.slice(1)}`;
}

export interface EncodeAsdfOptions {
  mode?: AsdfMode;
  xFactor?: number;
  yFactor?: number;
  pointsPerLine?: number;
}

/**
 * Encodes an array of `{ x, y }` data points into JCAMP-DX `(X++(Y..Y))` lines
 * in the requested ASDF mode (`AFFN`, `PAC`, `SQZ`, `DIF`, `DUP`, or `DIFDUP`).
 */
export function encodeAsdf(points: JcampDataPoint[], options: EncodeAsdfOptions = {}): string[] {
  if (points.length === 0) return [];
  const mode: AsdfMode = options.mode ?? "DIFDUP";
  const xFactor = options.xFactor ?? 1;
  const yFactor = options.yFactor ?? 1;
  const pointsPerLine = Math.max(2, options.pointsPerLine ?? 8);

  const rawXs = points.map((p) => p.x / xFactor);
  const rawYs = points.map((p) => Math.round(p.y / yFactor));
  const lines: string[] = [];

  const formatX = (v: number): string => {
    const rounded = Math.round(v);
    if (Math.abs(v - rounded) < 1e-9) return String(rounded);
    return Number(v.toPrecision(10)).toString();
  };

  if (mode === "AFFN" || mode === "PAC") {
    for (let start = 0; start < points.length; start += pointsPerLine) {
      const end = Math.min(points.length, start + pointsPerLine);
      let line = formatX(rawXs[start]!);
      for (let j = start; j < end; j++) {
        const y = rawYs[j]!;
        if (mode === "AFFN") {
          line += ` ${y}`;
        } else {
          line += y >= 0 ? `+${y}` : `${y}`;
        }
      }
      lines.push(line);
    }
    return lines;
  }

  if (mode === "SQZ") {
    for (let start = 0; start < points.length; start += pointsPerLine) {
      const end = Math.min(points.length, start + pointsPerLine);
      let line = `${formatX(rawXs[start]!)} `;
      for (let j = start; j < end; j++) {
        line += encodeSqzInt(rawYs[j]!);
      }
      lines.push(line);
    }
    return lines;
  }

  if (mode === "DUP") {
    // SQZ + DUP (no DIF, so no checkpoint repetition needed)
    for (let start = 0; start < points.length; start += pointsPerLine) {
      const end = Math.min(points.length, start + pointsPerLine);
      let line = `${formatX(rawXs[start]!)} `;
      let j = start;
      while (j < end) {
        const val = rawYs[j]!;
        let run = 1;
        while (j + run < end && rawYs[j + run] === val) {
          run++;
        }
        line += encodeSqzInt(val);
        if (run > 1) {
          line += encodeDupCount(run);
        }
        j += run;
      }
      lines.push(line);
    }
    return lines;
  }

  // DIF and DIFDUP modes:
  // Each continuation line starts with the previous line's LAST point as its checkpoint!
  const useDup = mode === "DIFDUP";
  let idx = 0;
  let isFirstLine = true;

  while (idx < points.length) {
    // On continuation lines, checkpoint is the point at (idx - 1)
    const startIdx = isFirstLine ? idx : idx - 1;
    const endIdx = Math.min(points.length, idx + pointsPerLine);
    let line = `${formatX(rawXs[startIdx]!)} ${encodeSqzInt(rawYs[startIdx]!)}`;

    // Emit differences from startIdx+1 .. endIdx-1
    let j = startIdx + 1;
    while (j < endIdx) {
      const diff = rawYs[j]! - rawYs[j - 1]!;
      if (useDup) {
        let run = 1;
        while (j + run < endIdx) {
          const nextDiff = rawYs[j + run]! - rawYs[j + run - 1]!;
          if (nextDiff !== diff) break;
          run++;
        }
        line += encodeDifInt(diff);
        if (run > 1) {
          line += encodeDupCount(run);
        }
        j += run;
      } else {
        line += encodeDifInt(diff);
        j++;
      }
    }

    lines.push(line);
    idx = endIdx;
    isFirstLine = false;
  }

  return lines;
}
