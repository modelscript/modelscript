// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CifCommand, CifDocument, CifParseError, CifPoint, CifSymbolDef, CifTransform } from "../types.js";

interface LineIndex {
  lineStarts: number[];
}

function buildLineIndex(text: string): LineIndex {
  const lineStarts: number[] = [0];
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) {
      lineStarts.push(i + 1);
    }
  }
  return { lineStarts };
}

function offsetToLineCol(index: LineIndex, offset: number): { line: number; column: number } {
  const starts = index.lineStarts;
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((starts[mid] ?? 0) <= offset) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  const lineStart = starts[lo] ?? 0;
  return { line: lo + 1, column: offset - lineStart + 1 };
}

function extractSignedInts(body: string): number[] {
  const matches = body.match(/[+-]?\d+/g);
  if (!matches) return [];
  return matches.map((m) => Number.parseInt(m, 10));
}

function parsePoints(nums: number[]): CifPoint[] {
  const pts: CifPoint[] = [];
  for (let i = 0; i + 1 < nums.length; i += 2) {
    pts.push({ x: nums[i]!, y: nums[i + 1]! });
  }
  return pts;
}

function parseTransforms(
  body: string,
  line: number,
  column: number,
  startOffset: number,
  endOffset: number,
  errors: CifParseError[],
): CifTransform[] {
  const transforms: CifTransform[] = [];
  // Match T x y, MX, MY, R x y in order
  const tokenRegex = /(MX|MY|T|R|[+-]?\d+)/g;
  const tokens: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = tokenRegex.exec(body)) !== null) {
    tokens.push(match[1]!);
  }

  let idx = 0;
  while (idx < tokens.length) {
    const tok = tokens[idx]!;
    if (tok === "MX") {
      transforms.push({ kind: "MX" });
      idx += 1;
    } else if (tok === "MY") {
      transforms.push({ kind: "MY" });
      idx += 1;
    } else if (tok === "T") {
      const xs = tokens[idx + 1];
      const ys = tokens[idx + 2];
      if (xs === undefined || ys === undefined || !/^[+-]?\d+$/.test(xs) || !/^[+-]?\d+$/.test(ys)) {
        errors.push({
          message: "Expected two integer coordinates after 'T' transform in Call command",
          line,
          column,
          startOffset,
          endOffset,
        });
        idx += 1;
      } else {
        transforms.push({ kind: "T", x: Number.parseInt(xs, 10), y: Number.parseInt(ys, 10) });
        idx += 3;
      }
    } else if (tok === "R") {
      const xs = tokens[idx + 1];
      const ys = tokens[idx + 2];
      if (xs === undefined || ys === undefined || !/^[+-]?\d+$/.test(xs) || !/^[+-]?\d+$/.test(ys)) {
        errors.push({
          message: "Expected two integer direction components after 'R' transform in Call command",
          line,
          column,
          startOffset,
          endOffset,
        });
        idx += 1;
      } else {
        transforms.push({ kind: "R", x: Number.parseInt(xs, 10), y: Number.parseInt(ys, 10) });
        idx += 3;
      }
    } else {
      errors.push({
        message: `Unexpected token '${tok}' in Call transform list`,
        line,
        column,
        startOffset,
        endOffset,
      });
      idx += 1;
    }
  }
  return transforms;
}

/**
 * Parses a Caltech Intermediate Form 2.0 (CIF) source string into a structured `CifDocument`.
 */
export function parseCif(source: string): CifDocument {
  const lineIndex = buildLineIndex(source);
  const symbols = new Map<number, CifSymbolDef>();
  const symbolOrder: number[] = [];
  const duplicateSymbolIds: Array<{ id: number; line: number; column: number }> = [];
  const unmatchedDefFinishes: Array<{ line: number; column: number }> = [];
  const nestedDefStarts: Array<{ id: number; parentId: number; line: number; column: number }> = [];
  const topLevelCommands: CifCommand[] = [];
  const allCommands: CifCommand[] = [];
  const parseErrors: CifParseError[] = [];

  let activeSymbol: CifSymbolDef | null = null;
  let hasEndCommand = false;

  const emitCommand = (cmd: CifCommand): void => {
    allCommands.push(cmd);
    if (activeSymbol && cmd.kind !== "DS" && cmd.kind !== "DF") {
      activeSymbol.commands.push(cmd);
    } else if (cmd.kind !== "DS" && cmd.kind !== "DF") {
      topLevelCommands.push(cmd);
    }
  };

  let pos = 0;
  const len = source.length;

  while (pos < len) {
    // Skip whitespace and stray semicolons
    while (pos < len) {
      const ch = source[pos]!;
      if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n" || ch === ";") {
        pos++;
      } else {
        break;
      }
    }
    if (pos >= len) break;

    const startOffset = pos;
    const { line, column } = offsetToLineCol(lineIndex, startOffset);
    const ch = source[pos]!;

    // 1. Comment command: ( ... ) with nested parentheses support and optional trailing ';'
    if (ch === "(") {
      let depth = 0;
      let i = pos;
      while (i < len) {
        if (source[i] === "(") depth++;
        else if (source[i] === ")") {
          depth--;
          if (depth === 0) {
            i++;
            break;
          }
        }
        i++;
      }
      if (depth !== 0) {
        parseErrors.push({
          message: "Unterminated comment '(' without matching ')'",
          line,
          column,
          startOffset,
          endOffset: len,
        });
        pos = len;
        break;
      }
      const commentText = source.slice(startOffset + 1, i - 1).trim();
      let endOffset = i;
      // Optional trailing semicolon after ')'
      let peek = i;
      while (peek < len && (source[peek] === " " || source[peek] === "\t")) peek++;
      if (peek < len && source[peek] === ";") {
        endOffset = peek + 1;
      }
      emitCommand({
        kind: "Comment",
        text: commentText,
        line,
        column,
        startOffset,
        endOffset,
      });
      pos = endOffset;
      continue;
    }

    // 2. End command: 'E' (does not require semicolon in CIF 2.0, though optional ';' is allowed)
    if (ch === "E" && (pos + 1 >= len || /[\s;(]/.test(source[pos + 1]!))) {
      hasEndCommand = true;
      let endOffset = pos + 1;
      while (endOffset < len && (source[endOffset] === " " || source[endOffset] === "\t")) endOffset++;
      if (endOffset < len && source[endOffset] === ";") endOffset++;
      emitCommand({
        kind: "E",
        line,
        column,
        startOffset,
        endOffset,
      });
      pos = endOffset;
      break;
    }

    // 3. Regular semicolon-terminated CIF command
    let semi = pos;
    while (semi < len && source[semi] !== ";") {
      semi++;
    }
    const rawCmd = source.slice(startOffset, semi).trim();
    const endOffset = semi < len ? semi + 1 : len;
    if (semi >= len) {
      parseErrors.push({
        message: `Command '${rawCmd.slice(0, 24)}' is missing terminating ';'`,
        line,
        column,
        startOffset,
        endOffset,
      });
    }
    pos = endOffset;

    if (rawCmd.length === 0) continue;

    // 3a. User extension command (starts with digit 0..9)
    if (rawCmd[0]! >= "0" && rawCmd[0]! <= "9") {
      const digit = Number.parseInt(rawCmd[0]!, 10);
      const rest = rawCmd.slice(1).trim();
      emitCommand({
        kind: "User",
        digit,
        text: rest,
        line,
        column,
        startOffset,
        endOffset,
      });
      // Convention: `9 symbolName;` inside DS names the symbol
      if (digit === 9 && activeSymbol && rest.length > 0 && !activeSymbol.name) {
        const firstToken = rest.split(/\s+/)[0];
        if (firstToken && !/^\d+$/.test(firstToken)) {
          activeSymbol.name = firstToken;
        }
      }
      continue;
    }

    // 3b. Definition commands: DS, DF, DD
    if (rawCmd.startsWith("DS") && (rawCmd.length === 2 || /[^A-Za-z]/.test(rawCmd[2]!))) {
      const rest = rawCmd.slice(2).trim();
      const nums = extractSignedInts(rest);
      if (nums.length < 1) {
        parseErrors.push({
          message: "Definition Start 'DS' requires a symbol ID integer",
          line,
          column,
          startOffset,
          endOffset,
        });
        continue;
      }
      const symbolId = nums[0]!;
      const a = nums.length >= 2 ? nums[1]! : 1;
      const b = nums.length >= 3 ? nums[2]! : 1;

      const cmd: CifCommand = {
        kind: "DS",
        symbolId,
        a,
        b,
        line,
        column,
        startOffset,
        endOffset,
      };
      allCommands.push(cmd);

      if (activeSymbol) {
        nestedDefStarts.push({ id: symbolId, parentId: activeSymbol.id, line, column });
      }
      if (symbols.has(symbolId)) {
        duplicateSymbolIds.push({ id: symbolId, line, column });
      } else {
        symbolOrder.push(symbolId);
      }

      const def: CifSymbolDef = {
        id: symbolId,
        scaleA: a,
        scaleB: b,
        commands: [],
        startLine: line,
        endLine: line,
        startOffset,
        endOffset,
        closed: false,
      };
      symbols.set(symbolId, def);
      activeSymbol = def;
      continue;
    }

    if (rawCmd === "DF" || (rawCmd.startsWith("DF") && /[\s]/.test(rawCmd[2] ?? ""))) {
      const cmd: CifCommand = {
        kind: "DF",
        line,
        column,
        startOffset,
        endOffset,
      };
      allCommands.push(cmd);
      if (!activeSymbol) {
        unmatchedDefFinishes.push({ line, column });
      } else {
        activeSymbol.closed = true;
        activeSymbol.endLine = line;
        activeSymbol.endOffset = endOffset;
        activeSymbol = null;
      }
      continue;
    }

    if (rawCmd.startsWith("DD") && (rawCmd.length === 2 || /[^A-Za-z]/.test(rawCmd[2]!))) {
      const nums = extractSignedInts(rawCmd.slice(2));
      if (nums.length < 1) {
        parseErrors.push({
          message: "Delete Definition 'DD' requires a symbol ID integer",
          line,
          column,
          startOffset,
          endOffset,
        });
        continue;
      }
      emitCommand({
        kind: "DD",
        symbolId: nums[0]!,
        line,
        column,
        startOffset,
        endOffset,
      });
      continue;
    }

    // 3c. Call command: C symbolId [transforms]
    if (rawCmd[0] === "C" && (rawCmd.length === 1 || /[\s0-9+-]/.test(rawCmd[1]!))) {
      const rest = rawCmd.slice(1).trim();
      const idMatch = rest.match(/^([+-]?\d+)([\s\S]*)$/);
      if (!idMatch) {
        parseErrors.push({
          message: "Call command 'C' requires a target symbol ID integer",
          line,
          column,
          startOffset,
          endOffset,
        });
        continue;
      }
      const symbolId = Number.parseInt(idMatch[1]!, 10);
      const transformBody = idMatch[2]!.trim();
      const transforms =
        transformBody.length > 0
          ? parseTransforms(transformBody, line, column, startOffset, endOffset, parseErrors)
          : [];
      emitCommand({
        kind: "C",
        symbolId,
        transforms,
        line,
        column,
        startOffset,
        endOffset,
      });
      continue;
    }

    // 3d. Layer command: L shortname
    if (rawCmd[0] === "L" && (rawCmd.length === 1 || /[\sA-Za-z0-9]/.test(rawCmd[1]!))) {
      const layerName = rawCmd.slice(1).trim();
      if (!/^[A-Za-z0-9]{1,8}$/.test(layerName)) {
        parseErrors.push({
          message: `Invalid layer name '${layerName}' in 'L' command`,
          line,
          column,
          startOffset,
          endOffset,
        });
        continue;
      }
      emitCommand({
        kind: "L",
        layer: layerName.toUpperCase(),
        line,
        column,
        startOffset,
        endOffset,
      });
      continue;
    }

    // 3e. Box command: B length width centerX centerY [dirX dirY]
    if (rawCmd[0] === "B" && (rawCmd.length === 1 || /[\s0-9+-]/.test(rawCmd[1]!))) {
      const nums = extractSignedInts(rawCmd.slice(1));
      if (nums.length !== 4 && nums.length !== 6) {
        parseErrors.push({
          message: `Box command 'B' requires 4 or 6 integers (length, width, cx, cy [, dx, dy]), got ${nums.length}`,
          line,
          column,
          startOffset,
          endOffset,
        });
        continue;
      }
      const direction: CifPoint | undefined = nums.length === 6 ? { x: nums[4]!, y: nums[5]! } : undefined;
      emitCommand({
        kind: "B",
        length: nums[0]!,
        width: nums[1]!,
        center: { x: nums[2]!, y: nums[3]! },
        ...(direction ? { direction } : {}),
        line,
        column,
        startOffset,
        endOffset,
      });
      continue;
    }

    // 3f. Polygon command: P x1 y1 x2 y2 ...
    if (rawCmd[0] === "P" && (rawCmd.length === 1 || /[\s0-9+-]/.test(rawCmd[1]!))) {
      const nums = extractSignedInts(rawCmd.slice(1));
      if (nums.length % 2 !== 0) {
        parseErrors.push({
          message: `Polygon command 'P' must have an even number of coordinate integers, got ${nums.length}`,
          line,
          column,
          startOffset,
          endOffset,
        });
      }
      emitCommand({
        kind: "P",
        points: parsePoints(nums),
        line,
        column,
        startOffset,
        endOffset,
      });
      continue;
    }

    // 3g. Roundflash command: R diameter centerX centerY
    if (rawCmd[0] === "R" && (rawCmd.length === 1 || /[\s0-9+-]/.test(rawCmd[1]!))) {
      const nums = extractSignedInts(rawCmd.slice(1));
      if (nums.length !== 3) {
        parseErrors.push({
          message: `Roundflash command 'R' requires 3 integers (diameter, cx, cy), got ${nums.length}`,
          line,
          column,
          startOffset,
          endOffset,
        });
        continue;
      }
      emitCommand({
        kind: "R",
        diameter: nums[0]!,
        center: { x: nums[1]!, y: nums[2]! },
        line,
        column,
        startOffset,
        endOffset,
      });
      continue;
    }

    // 3h. Wire command: W width x1 y1 x2 y2 ...
    if (rawCmd[0] === "W" && (rawCmd.length === 1 || /[\s0-9+-]/.test(rawCmd[1]!))) {
      const nums = extractSignedInts(rawCmd.slice(1));
      if (nums.length < 1 || (nums.length - 1) % 2 !== 0) {
        parseErrors.push({
          message: `Wire command 'W' requires width followed by coordinate pairs, got ${nums.length} integers`,
          line,
          column,
          startOffset,
          endOffset,
        });
        continue;
      }
      emitCommand({
        kind: "W",
        width: nums[0]!,
        points: parsePoints(nums.slice(1)),
        line,
        column,
        startOffset,
        endOffset,
      });
      continue;
    }

    // Unknown command
    parseErrors.push({
      message: `Unrecognized CIF command '${rawCmd.slice(0, 32)}'`,
      line,
      column,
      startOffset,
      endOffset,
    });
  }

  return {
    symbols,
    symbolOrder,
    duplicateSymbolIds,
    unmatchedDefFinishes,
    nestedDefStarts,
    topLevelCommands,
    allCommands,
    hasEndCommand,
    parseErrors,
    rawLength: source.length,
  };
}
