// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/cantera — Zero-Regex Character-by-Character Parser & Serializer
 * for Cantera YAML (.yaml) and legacy CTI (.cti) Chemical Kinetics Mechanisms.
 *
 * Strictly zero regular expressions (no RegExp or slash-literal patterns).
 */

import type {
  ArrheniusRate,
  CanteraDocument,
  CanteraMechanism,
  CanteraPhase,
  CanteraPhaseState,
  CanteraRange,
  CanteraReaction,
  CanteraReactionType,
  CanteraSpecies,
  CanteraSpeciesStoich,
  Nasa7Polynomial,
  TroeFalloff,
} from "../types.js";

// ============================================================================
// Character Classification Helpers (Zero-Regex)
// ============================================================================

function isWhitespaceChar(ch: string): boolean {
  return ch === " " || ch === "\t" || ch === "\r" || ch === "\n";
}

function isInlineSpace(ch: string): boolean {
  return ch === " " || ch === "\t";
}

function isDigitChar(ch: string): boolean {
  const code = ch.charCodeAt(0);
  return code >= 48 && code <= 57;
}

function isAlphaChar(ch: string): boolean {
  const code = ch.charCodeAt(0);
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function isAlphaNumericChar(ch: string): boolean {
  return isAlphaChar(ch) || isDigitChar(ch);
}

function trimText(s: string): string {
  let start = 0;
  let end = s.length;
  while (start < end && isWhitespaceChar(s[start] ?? "")) start++;
  while (end > start && isWhitespaceChar(s[end - 1] ?? "")) end--;
  return s.slice(start, end);
}

function stripQuotes(s: string): string {
  const t = trimText(s);
  if (t.length >= 2) {
    const first = t[0];
    const last = t[t.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return t.slice(1, t.length - 1);
    }
  }
  return t;
}

function buildLineStarts(source: string): number[] {
  const starts: number[] = [0];
  for (let i = 0; i < source.length; i++) {
    if (source[i] === "\n") {
      starts.push(i + 1);
    }
  }
  return starts;
}

function offsetToPosition(lineStarts: number[], offset: number): { line: number; column: number } {
  const clamped = Math.max(0, offset);
  let low = 0;
  let high = lineStarts.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const start = lineStarts[mid] ?? 0;
    if (start <= clamped) {
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  const lineIdx = Math.max(0, low - 1);
  const lineStart = lineStarts[lineIdx] ?? 0;
  return {
    line: lineIdx + 1,
    column: clamped - lineStart + 1,
  };
}

function makeRange(lineStarts: number[], startOffset: number, endOffset: number): CanteraRange {
  const safeEnd = Math.max(startOffset, endOffset);
  const startPos = offsetToPosition(lineStarts, startOffset);
  const endPos = offsetToPosition(lineStarts, safeEnd);
  return {
    startLine: startPos.line,
    startColumn: startPos.column,
    endLine: endPos.line,
    endColumn: endPos.column,
    startOffset,
    endOffset: safeEnd,
  };
}

// ============================================================================
// Numeric & Unit Parsing Helpers (Zero-Regex)
// ============================================================================

/**
 * Parses a number optionally followed by an activation energy unit
 * (e.g. "15000.0", "15000 cal/mol", "15.0 kcal/mol", "1.5e7 J/kmol").
 * Converts activation energy to J/mol when unit is explicitly specified.
 */
function parseNumericWithUnit(raw: string, defaultEaUnit?: string | undefined): number {
  const cleaned = stripQuotes(raw);
  if (cleaned.length === 0) return 0;

  let i = 0;
  const n = cleaned.length;
  while (i < n && isInlineSpace(cleaned[i] ?? "")) i++;

  const numStart = i;
  if (i < n && (cleaned[i] === "+" || cleaned[i] === "-")) i++;
  while (i < n && isDigitChar(cleaned[i] ?? "")) i++;
  if (i < n && cleaned[i] === ".") {
    i++;
    while (i < n && isDigitChar(cleaned[i] ?? "")) i++;
  }
  if (i < n && (cleaned[i] === "e" || cleaned[i] === "E")) {
    i++;
    if (i < n && (cleaned[i] === "+" || cleaned[i] === "-")) i++;
    while (i < n && isDigitChar(cleaned[i] ?? "")) i++;
  }

  const numStr = cleaned.slice(numStart, i);
  const val = Number(numStr);
  if (Number.isNaN(val)) return 0;

  const unitPart = trimText(cleaned.slice(i));
  const effectiveUnit = unitPart.length > 0 ? unitPart : (defaultEaUnit ?? "");

  if (effectiveUnit === "cal/mol") {
    return val * 4.184;
  }
  if (effectiveUnit === "kcal/mol") {
    return val * 4184.0;
  }
  if (effectiveUnit === "J/kmol") {
    return val * 1e-3;
  }
  if (effectiveUnit === "kJ/mol") {
    return val * 1000.0;
  }
  return val;
}

// ============================================================================
// Stoichiometric Reaction Equation Parser (Zero-Regex)
// ============================================================================

export interface ParsedEquation {
  reversible: boolean;
  inferredType: CanteraReactionType;
  reactants: CanteraSpeciesStoich[];
  products: CanteraSpeciesStoich[];
}

function splitTopLevelPlus(side: string): string[] {
  const parts: string[] = [];
  let current = "";
  let parenDepth = 0;

  for (let i = 0; i < side.length; i++) {
    const ch = side[i] ?? "";
    if (ch === "(") {
      parenDepth++;
      current += ch;
      continue;
    }
    if (ch === ")") {
      if (parenDepth > 0) parenDepth--;
      current += ch;
      continue;
    }
    if (ch === "+" && parenDepth === 0) {
      // A '+' is a stoichiometric separator if preceded by space (e.g. "H3O+ + OH-")
      // or if followed directly by an alphanumeric character (e.g. "H2+O2").
      // A trailing '+' followed by space or end-of-string (e.g. "H3O+") is an ion charge.
      const prevChar = i > 0 ? (side[i - 1] ?? "") : " ";
      const nextChar = i + 1 < side.length ? (side[i + 1] ?? "") : "";
      const isSeparator = isInlineSpace(prevChar) || isAlphaNumericChar(nextChar);
      if (isSeparator) {
        const trimmed = trimText(current);
        if (trimmed.length > 0) {
          parts.push(trimmed);
        }
        current = "";
        continue;
      }
    }
    current += ch;
  }

  const tail = trimText(current);
  if (tail.length > 0) {
    parts.push(tail);
  }
  return parts;
}

function removeFalloffMarker(side: string): { cleaned: string; hasFalloff: boolean } {
  let hasFalloff = false;
  let out = "";
  let i = 0;
  while (i < side.length) {
    if (side[i] === "(") {
      let j = i + 1;
      while (j < side.length && isInlineSpace(side[j] ?? "")) j++;
      if (side[j] === "+") {
        j++;
        while (j < side.length && isInlineSpace(side[j] ?? "")) j++;
        // Check for M or third-body species inside (+M)
        const mStart = j;
        while (j < side.length && side[j] !== ")" && !isInlineSpace(side[j] ?? "")) j++;
        const mToken = side.slice(mStart, j);
        while (j < side.length && isInlineSpace(side[j] ?? "")) j++;
        if (side[j] === ")" && mToken.length > 0) {
          hasFalloff = true;
          i = j + 1;
          continue;
        }
      }
    }
    out += side[i] ?? "";
    i++;
  }
  return { cleaned: trimText(out), hasFalloff };
}

function parseStoichSide(side: string): {
  items: CanteraSpeciesStoich[];
  hasThirdBody: boolean;
  hasFalloff: boolean;
} {
  const { cleaned, hasFalloff } = removeFalloffMarker(side);
  const rawTerms = splitTopLevelPlus(cleaned);
  const items: CanteraSpeciesStoich[] = [];
  let hasThirdBody = false;

  for (const rawTerm of rawTerms) {
    const t = trimText(rawTerm);
    if (t.length === 0) continue;
    if (t === "M") {
      hasThirdBody = true;
      continue;
    }

    // Parse optional leading numeric stoichiometry (e.g. "2 H2", "0.5 O2", "2H2")
    let idx = 0;
    while (idx < t.length && (isDigitChar(t[idx] ?? "") || t[idx] === ".")) {
      idx++;
    }

    let stoich = 1.0;
    let speciesName = t;
    if (idx > 0 && idx < t.length) {
      const nextCh = t[idx] ?? "";
      // Only treat leading digits as stoichiometry if followed by space or uppercase letter
      if (isInlineSpace(nextCh) || isAlphaChar(nextCh) || nextCh === "(") {
        const parsedNum = Number(t.slice(0, idx));
        const rest = trimText(t.slice(idx));
        if (!Number.isNaN(parsedNum) && rest.length > 0) {
          stoich = parsedNum;
          speciesName = rest;
        }
      }
    }

    if (speciesName === "M") {
      hasThirdBody = true;
      continue;
    }

    const existing = items.find((entry) => entry.species === speciesName);
    if (existing) {
      existing.stoichiometry += stoich;
    } else {
      items.push({ species: speciesName, stoichiometry: stoich });
    }
  }

  return { items, hasThirdBody, hasFalloff };
}

export function parseReactionEquation(equation: string): ParsedEquation {
  const eq = stripQuotes(equation);
  let arrowIdx = -1;
  let arrowLen = 0;
  let reversible = true;

  const idxRev = eq.indexOf("<=>");
  if (idxRev !== -1) {
    arrowIdx = idxRev;
    arrowLen = 3;
    reversible = true;
  } else {
    const idxIrrev = eq.indexOf("=>");
    if (idxIrrev !== -1) {
      arrowIdx = idxIrrev;
      arrowLen = 2;
      reversible = false;
    } else {
      const idxEq = eq.indexOf("=");
      if (idxEq !== -1) {
        arrowIdx = idxEq;
        arrowLen = 1;
        reversible = true;
      }
    }
  }

  if (arrowIdx === -1) {
    const lhs = parseStoichSide(eq);
    return {
      reversible: true,
      inferredType: lhs.hasFalloff ? "falloff" : lhs.hasThirdBody ? "three-body" : "elementary",
      reactants: lhs.items,
      products: [],
    };
  }

  const lhsText = eq.slice(0, arrowIdx);
  const rhsText = eq.slice(arrowIdx + arrowLen);
  const lhs = parseStoichSide(lhsText);
  const rhs = parseStoichSide(rhsText);

  let inferredType: CanteraReactionType = "elementary";
  if (lhs.hasFalloff || rhs.hasFalloff) {
    inferredType = "falloff";
  } else if (lhs.hasThirdBody || rhs.hasThirdBody) {
    inferredType = "three-body";
  }

  return {
    reversible,
    inferredType,
    reactants: lhs.items,
    products: rhs.items,
  };
}

// ============================================================================
// Zero-Regex YAML Value & Structure Parser
// ============================================================================

type YamlValue = string | number | boolean | null | YamlValue[] | { [key: string]: YamlValue };

interface YamlNodeWithRange {
  value: YamlValue;
  startOffset: number;
  endOffset: number;
}

interface SourceLine {
  lineIndex: number; // 0-based
  indent: number;
  text: string; // trimmed of comments and trailing spaces, leading spaces removed
  rawStartOffset: number;
  rawEndOffset: number;
}

function stripYamlComment(line: string): string {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i] ?? "";
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
    } else if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
    } else if (ch === "#" && !inSingle && !inDouble) {
      return line.slice(0, i);
    }
  }
  return line;
}

function extractSourceLines(source: string): SourceLine[] {
  const result: SourceLine[] = [];
  let lineIndex = 0;
  let i = 0;
  const n = source.length;

  while (i < n) {
    const lineStart = i;
    while (i < n && source[i] !== "\n") i++;
    const lineEnd = i;
    if (i < n && source[i] === "\n") i++;

    let rawLine = source.slice(lineStart, lineEnd);
    if (rawLine.endsWith("\r")) {
      rawLine = rawLine.slice(0, rawLine.length - 1);
    }

    const noComment = stripYamlComment(rawLine);
    let indent = 0;
    while (indent < noComment.length && noComment[indent] === " ") {
      indent++;
    }

    const trimmed = trimText(noComment);
    if (trimmed.length > 0 && trimmed !== "---" && trimmed !== "...") {
      result.push({
        lineIndex,
        indent,
        text: trimmed,
        rawStartOffset: lineStart + indent,
        rawEndOffset: lineStart + noComment.length,
      });
    }
    lineIndex++;
  }

  return result;
}

function splitTopLevelDelimited(input: string, delimiter: string): string[] {
  const parts: string[] = [];
  let current = "";
  let bracketDepth = 0;
  let braceDepth = 0;
  let parenDepth = 0;
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i] ?? "";
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      current += ch;
      continue;
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      current += ch;
      continue;
    }
    if (!inSingle && !inDouble) {
      if (ch === "[") bracketDepth++;
      else if (ch === "]") bracketDepth = Math.max(0, bracketDepth - 1);
      else if (ch === "{") braceDepth++;
      else if (ch === "}") braceDepth = Math.max(0, braceDepth - 1);
      else if (ch === "(") parenDepth++;
      else if (ch === ")") parenDepth = Math.max(0, parenDepth - 1);

      if (ch === delimiter && bracketDepth === 0 && braceDepth === 0 && parenDepth === 0) {
        parts.push(trimText(current));
        current = "";
        continue;
      }
    }
    current += ch;
  }

  const last = trimText(current);
  if (last.length > 0) {
    parts.push(last);
  }
  return parts;
}

function findTopLevelColon(input: string): number {
  let bracketDepth = 0;
  let braceDepth = 0;
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i] ?? "";
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      continue;
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      continue;
    }
    if (!inSingle && !inDouble) {
      if (ch === "[") bracketDepth++;
      else if (ch === "]") bracketDepth = Math.max(0, bracketDepth - 1);
      else if (ch === "{") braceDepth++;
      else if (ch === "}") braceDepth = Math.max(0, braceDepth - 1);
      else if (ch === ":" && bracketDepth === 0 && braceDepth === 0) {
        const nextCh = i + 1 < input.length ? (input[i + 1] ?? "") : " ";
        if (isWhitespaceChar(nextCh) || i + 1 === input.length) {
          return i;
        }
      }
    }
  }
  return -1;
}

function parseFlowScalarOrCollection(raw: string): YamlValue {
  const t = trimText(raw);
  if (t.length === 0 || t === "null" || t === "~") return null;
  if (t === "true" || t === "True" || t === "yes") return true;
  if (t === "false" || t === "False" || t === "no") return false;

  if (t.startsWith("[") && t.endsWith("]")) {
    const inner = trimText(t.slice(1, t.length - 1));
    if (inner.length === 0) return [];
    const items = splitTopLevelDelimited(inner, ",");
    return items.map((item) => parseFlowScalarOrCollection(item));
  }

  if (t.startsWith("{") && t.endsWith("}")) {
    const inner = trimText(t.slice(1, t.length - 1));
    const obj: Record<string, YamlValue> = {};
    if (inner.length === 0) return obj;
    const entries = splitTopLevelDelimited(inner, ",");
    for (const entry of entries) {
      const colonIdx = findTopLevelColon(entry);
      if (colonIdx !== -1) {
        const k = stripQuotes(entry.slice(0, colonIdx));
        const v = parseFlowScalarOrCollection(entry.slice(colonIdx + 1));
        obj[k] = v;
      }
    }
    return obj;
  }

  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return stripQuotes(t);
  }

  const num = Number(t);
  if (!Number.isNaN(num) && t.length > 0) {
    return num;
  }

  return t;
}

function countUnbalancedBrackets(s: string): number {
  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i] ?? "";
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (!inSingle && !inDouble) {
      if (ch === "[" || ch === "{") depth++;
      else if (ch === "]" || ch === "}") depth--;
    }
  }
  return depth;
}

function collectMultilineFlow(
  lines: SourceLine[],
  startIdx: number,
  initialText: string,
): {
  combined: string;
  nextIdx: number;
  endOffset: number;
} {
  let combined = initialText;
  let idx = startIdx;
  let endOffset = lines[startIdx]?.rawEndOffset ?? 0;

  while (countUnbalancedBrackets(combined) > 0 && idx + 1 < lines.length) {
    idx++;
    const nextLine = lines[idx]!;
    combined += " " + nextLine.text;
    endOffset = nextLine.rawEndOffset;
  }

  return { combined, nextIdx: idx + 1, endOffset };
}

function parseYamlBlock(
  lines: SourceLine[],
  startIdx: number,
  minIndent: number,
): {
  node: YamlNodeWithRange;
  nextIdx: number;
} {
  const firstLine = lines[startIdx];
  if (!firstLine) {
    return {
      node: { value: null, startOffset: 0, endOffset: 0 },
      nextIdx: startIdx,
    };
  }

  // Check if block sequence (starts with '-' followed by space or end of line)
  if (firstLine.text === "-" || firstLine.text.startsWith("- ")) {
    const seqIndent = firstLine.indent;
    const arr: YamlNodeWithRange[] = [];
    let idx = startIdx;
    const blockStartOffset = firstLine.rawStartOffset;
    let blockEndOffset = firstLine.rawEndOffset;

    while (idx < lines.length) {
      const line = lines[idx]!;
      if (line.indent < seqIndent) break;
      if (line.indent > seqIndent) break;
      if (line.text !== "-" && !line.text.startsWith("- ")) break;

      const itemStartOffset = line.rawStartOffset;
      const afterDash = trimText(line.text.slice(1));

      if (afterDash.length === 0) {
        // Nested block on following lines
        if (idx + 1 < lines.length && lines[idx + 1]!.indent > seqIndent) {
          const child = parseYamlBlock(lines, idx + 1, lines[idx + 1]!.indent);
          arr.push({
            value: child.node.value,
            startOffset: itemStartOffset,
            endOffset: child.node.endOffset,
          });
          blockEndOffset = child.node.endOffset;
          idx = child.nextIdx;
        } else {
          arr.push({ value: null, startOffset: itemStartOffset, endOffset: line.rawEndOffset });
          blockEndOffset = line.rawEndOffset;
          idx++;
        }
        continue;
      }

      // Check if afterDash is a flow sequence/mapping (possibly multi-line)
      if (afterDash.startsWith("[") || afterDash.startsWith("{")) {
        const flow = collectMultilineFlow(lines, idx, afterDash);
        const val = parseFlowScalarOrCollection(flow.combined);
        arr.push({ value: val, startOffset: itemStartOffset, endOffset: flow.endOffset });
        blockEndOffset = flow.endOffset;
        idx = flow.nextIdx;
        continue;
      }

      // Check if afterDash is an inline mapping entry `key: value` that continues on subsequent indented lines
      const colonIdx = findTopLevelColon(afterDash);
      if (colonIdx !== -1) {
        const mapObj: Record<string, YamlValue> = {};
        const key = stripQuotes(afterDash.slice(0, colonIdx));
        const valStr = trimText(afterDash.slice(colonIdx + 1));
        let itemEndOffset = line.rawEndOffset;
        let nextCursor = idx + 1;

        if (valStr.length === 0) {
          if (nextCursor < lines.length && lines[nextCursor]!.indent > seqIndent) {
            const sub = parseYamlBlock(lines, nextCursor, lines[nextCursor]!.indent);
            mapObj[key] = sub.node.value;
            itemEndOffset = sub.node.endOffset;
            nextCursor = sub.nextIdx;
          } else {
            mapObj[key] = null;
          }
        } else if (valStr.startsWith("[") || valStr.startsWith("{")) {
          const flow = collectMultilineFlow(lines, idx, valStr);
          mapObj[key] = parseFlowScalarOrCollection(flow.combined);
          itemEndOffset = flow.endOffset;
          nextCursor = flow.nextIdx;
        } else {
          mapObj[key] = parseFlowScalarOrCollection(valStr);
        }

        // Continue reading additional mapping keys indented further than seqIndent
        while (nextCursor < lines.length && lines[nextCursor]!.indent > seqIndent) {
          const subLine = lines[nextCursor]!;
          if (subLine.text === "-" || subLine.text.startsWith("- ")) {
            break;
          }
          const subColon = findTopLevelColon(subLine.text);
          if (subColon === -1) {
            nextCursor++;
            continue;
          }
          const subKey = stripQuotes(subLine.text.slice(0, subColon));
          const subValStr = trimText(subLine.text.slice(subColon + 1));
          const propIndent = subLine.indent;

          if (subValStr.length === 0) {
            if (nextCursor + 1 < lines.length && lines[nextCursor + 1]!.indent > propIndent) {
              const nested = parseYamlBlock(lines, nextCursor + 1, lines[nextCursor + 1]!.indent);
              mapObj[subKey] = nested.node.value;
              itemEndOffset = nested.node.endOffset;
              nextCursor = nested.nextIdx;
            } else if (
              nextCursor + 1 < lines.length &&
              lines[nextCursor + 1]!.indent === propIndent &&
              (lines[nextCursor + 1]!.text === "-" || lines[nextCursor + 1]!.text.startsWith("- "))
            ) {
              const nested = parseYamlBlock(lines, nextCursor + 1, propIndent);
              mapObj[subKey] = nested.node.value;
              itemEndOffset = nested.node.endOffset;
              nextCursor = nested.nextIdx;
            } else {
              mapObj[subKey] = null;
              itemEndOffset = subLine.rawEndOffset;
              nextCursor++;
            }
          } else if (subValStr.startsWith("[") || subValStr.startsWith("{")) {
            const flow = collectMultilineFlow(lines, nextCursor, subValStr);
            mapObj[subKey] = parseFlowScalarOrCollection(flow.combined);
            itemEndOffset = flow.endOffset;
            nextCursor = flow.nextIdx;
          } else {
            mapObj[subKey] = parseFlowScalarOrCollection(subValStr);
            itemEndOffset = subLine.rawEndOffset;
            nextCursor++;
          }
        }

        mapObj["__startOffset"] = itemStartOffset;
        mapObj["__endOffset"] = itemEndOffset;
        arr.push({ value: mapObj, startOffset: itemStartOffset, endOffset: itemEndOffset });
        blockEndOffset = itemEndOffset;
        idx = nextCursor;
        continue;
      }

      // Simple scalar sequence item
      arr.push({
        value: parseFlowScalarOrCollection(afterDash),
        startOffset: itemStartOffset,
        endOffset: line.rawEndOffset,
      });
      blockEndOffset = line.rawEndOffset;
      idx++;
    }

    return {
      node: {
        value: arr.map((a) => a.value),
        startOffset: blockStartOffset,
        endOffset: blockEndOffset,
      },
      nextIdx: idx,
    };
  }

  // Otherwise parse block mapping
  const mapObj: Record<string, YamlValue> = {};
  let idx = startIdx;
  const blockStartOffset = firstLine.rawStartOffset;
  let blockEndOffset = firstLine.rawEndOffset;

  while (idx < lines.length) {
    const line = lines[idx]!;
    if (line.indent < minIndent) break;
    if (line.text === "-" || line.text.startsWith("- ")) break;

    const colonIdx = findTopLevelColon(line.text);
    if (colonIdx === -1) {
      idx++;
      continue;
    }

    const key = stripQuotes(line.text.slice(0, colonIdx));
    const valStr = trimText(line.text.slice(colonIdx + 1));
    const currentIndent = line.indent;

    if (valStr.length === 0) {
      if (idx + 1 < lines.length && lines[idx + 1]!.indent > currentIndent) {
        const child = parseYamlBlock(lines, idx + 1, lines[idx + 1]!.indent);
        mapObj[key] = child.node.value;
        blockEndOffset = child.node.endOffset;
        idx = child.nextIdx;
      } else if (
        idx + 1 < lines.length &&
        lines[idx + 1]!.indent === currentIndent &&
        (lines[idx + 1]!.text === "-" || lines[idx + 1]!.text.startsWith("- "))
      ) {
        const child = parseYamlBlock(lines, idx + 1, currentIndent);
        mapObj[key] = child.node.value;
        blockEndOffset = child.node.endOffset;
        idx = child.nextIdx;
      } else {
        mapObj[key] = null;
        blockEndOffset = line.rawEndOffset;
        idx++;
      }
    } else if (valStr === "|" || valStr === ">") {
      // Multiline scalar block
      let textAccum = "";
      let nextIdx = idx + 1;
      while (nextIdx < lines.length && lines[nextIdx]!.indent > currentIndent) {
        textAccum += (textAccum.length > 0 ? " " : "") + lines[nextIdx]!.text;
        blockEndOffset = lines[nextIdx]!.rawEndOffset;
        nextIdx++;
      }
      mapObj[key] = textAccum;
      idx = nextIdx;
    } else if (valStr.startsWith("[") || valStr.startsWith("{")) {
      const flow = collectMultilineFlow(lines, idx, valStr);
      mapObj[key] = parseFlowScalarOrCollection(flow.combined);
      blockEndOffset = flow.endOffset;
      idx = flow.nextIdx;
    } else {
      mapObj[key] = parseFlowScalarOrCollection(valStr);
      blockEndOffset = line.rawEndOffset;
      idx++;
    }
  }

  mapObj["__startOffset"] = blockStartOffset;
  mapObj["__endOffset"] = blockEndOffset;

  return {
    node: {
      value: mapObj,
      startOffset: blockStartOffset,
      endOffset: blockEndOffset,
    },
    nextIdx: idx,
  };
}

// ============================================================================
// Conversion from Parsed YAML Objects to Cantera AST
// ============================================================================

function asRecord(v: YamlValue | undefined): Record<string, YamlValue> | undefined {
  if (v !== null && typeof v === "object" && !Array.isArray(v)) {
    return v as Record<string, YamlValue>;
  }
  return undefined;
}

function asArray(v: YamlValue | undefined): YamlValue[] | undefined {
  if (Array.isArray(v)) return v;
  return undefined;
}

function asString(v: YamlValue | undefined, fallback = ""): string {
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return fallback;
}

function asNumber(v: YamlValue | undefined, fallback = 0): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = Number(v);
    if (!Number.isNaN(n)) return n;
  }
  return fallback;
}

function extractNodeRange(obj: Record<string, YamlValue> | undefined, lineStarts: number[]): CanteraRange | undefined {
  if (!obj) return undefined;
  const s = obj["__startOffset"];
  const e = obj["__endOffset"];
  if (typeof s === "number" && typeof e === "number") {
    return makeRange(lineStarts, s, e);
  }
  return undefined;
}

function parseNumberMap(raw: YamlValue | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  const rec = asRecord(raw);
  if (rec) {
    for (const [k, v] of Object.entries(rec)) {
      if (k === "__startOffset" || k === "__endOffset") continue;
      out[k] = asNumber(v, 0);
    }
    return out;
  }
  if (typeof raw === "string") {
    // Support Cantera string composition/mole-fraction format: "H2:2.0, O2:1.0" or "H:2 O:1"
    const tokens = splitSpaceOrCommaPairs(raw);
    for (const [k, v] of tokens) {
      out[k] = v;
    }
  }
  return out;
}

function splitSpaceOrCommaPairs(text: string): Array<[string, number]> {
  const pairs: Array<[string, number]> = [];
  let i = 0;
  const n = text.length;

  while (i < n) {
    while (i < n && (isWhitespaceChar(text[i] ?? "") || text[i] === ",")) i++;
    if (i >= n) break;
    const tokenStart = i;
    while (i < n && !isWhitespaceChar(text[i] ?? "") && text[i] !== ",") i++;
    const token = text.slice(tokenStart, i);
    const colonPos = token.indexOf(":");
    if (colonPos !== -1) {
      const k = trimText(token.slice(0, colonPos));
      const v = Number(trimText(token.slice(colonPos + 1)));
      if (k.length > 0 && !Number.isNaN(v)) {
        pairs.push([k, v]);
      }
    }
  }
  return pairs;
}

function parseStringList(raw: YamlValue | undefined): string[] {
  const arr = asArray(raw);
  if (arr) {
    return arr.map((x) => asString(x)).filter((s) => s.length > 0);
  }
  if (typeof raw === "string") {
    const out: string[] = [];
    let i = 0;
    while (i < raw.length) {
      while (i < raw.length && (isWhitespaceChar(raw[i] ?? "") || raw[i] === ",")) i++;
      if (i >= raw.length) break;
      const start = i;
      while (i < raw.length && !isWhitespaceChar(raw[i] ?? "") && raw[i] !== ",") i++;
      const tok = raw.slice(start, i);
      if (tok.length > 0) out.push(tok);
    }
    return out;
  }
  return [];
}

function parseArrheniusRateValue(
  raw: YamlValue | undefined,
  defaultEaUnit: string | undefined,
  lineStarts: number[],
): ArrheniusRate | undefined {
  if (raw === undefined || raw === null) return undefined;
  const arr = asArray(raw);
  if (arr && arr.length >= 3) {
    return {
      A: asNumber(arr[0], 0),
      b: asNumber(arr[1], 0),
      Ea:
        typeof arr[2] === "string"
          ? parseNumericWithUnit(arr[2], defaultEaUnit)
          : parseNumericWithUnit(String(asNumber(arr[2], 0)), defaultEaUnit),
    };
  }
  const rec = asRecord(raw);
  if (rec) {
    const rawEa = rec["Ea"];
    const eaVal =
      typeof rawEa === "string"
        ? parseNumericWithUnit(rawEa, defaultEaUnit)
        : parseNumericWithUnit(String(asNumber(rawEa, 0)), defaultEaUnit);
    return {
      A: asNumber(rec["A"], 0),
      b: asNumber(rec["b"], 0),
      Ea: eaVal,
      range: extractNodeRange(rec, lineStarts),
    };
  }
  return undefined;
}

function parseYamlCanteraDocument(source: string, sourceFile?: string | undefined): CanteraDocument {
  const lineStarts = buildLineStarts(source);
  const lines = extractSourceLines(source);
  const rootObj: Record<string, YamlValue> =
    lines.length > 0 ? (asRecord(parseYamlBlock(lines, 0, 0).node.value) ?? {}) : {};

  const unitsRec = asRecord(rootObj["units"]);
  const units: Record<string, string> | undefined = unitsRec ? {} : undefined;
  if (unitsRec && units) {
    for (const [k, v] of Object.entries(unitsRec)) {
      if (k === "__startOffset" || k === "__endOffset") continue;
      units[k] = asString(v);
    }
  }
  const defaultEaUnit = units?.["activation-energy"];

  const phases = new Map<string, CanteraPhase>();
  const phasesArr = asArray(rootObj["phases"]) ?? [];
  for (const pItem of phasesArr) {
    const pRec = asRecord(pItem);
    if (!pRec) continue;
    const name = asString(pRec["name"], "gas");
    const thermo = asString(pRec["thermo"], "ideal-gas");
    const kinetics = pRec["kinetics"] !== undefined ? asString(pRec["kinetics"]) : undefined;
    const elements = parseStringList(pRec["elements"]);
    const species = parseStringList(pRec["species"]);

    let state: CanteraPhaseState | undefined;
    const stateRec = asRecord(pRec["state"]);
    if (stateRec) {
      state = {
        T: stateRec["T"] !== undefined ? parseNumericWithUnit(asString(stateRec["T"])) : undefined,
        P:
          stateRec["P"] !== undefined
            ? asString(stateRec["P"]).includes("atm")
              ? parseNumericWithUnit(asString(stateRec["P"])) * 101325.0
              : parseNumericWithUnit(asString(stateRec["P"]))
            : undefined,
        X: stateRec["X"] !== undefined ? parseNumberMap(stateRec["X"]) : undefined,
        Y: stateRec["Y"] !== undefined ? parseNumberMap(stateRec["Y"]) : undefined,
      };
    }

    phases.set(name, {
      name,
      thermo,
      kinetics,
      elements,
      species,
      state,
      range: extractNodeRange(pRec, lineStarts),
    });
  }

  const speciesMap = new Map<string, CanteraSpecies>();
  const speciesArr = asArray(rootObj["species"]) ?? [];
  for (const sItem of speciesArr) {
    const sRec = asRecord(sItem);
    if (!sRec) continue;
    const name = asString(sRec["name"]);
    if (!name) continue;

    const composition = parseNumberMap(sRec["composition"]);
    let charge: number | undefined = sRec["charge"] !== undefined ? asNumber(sRec["charge"]) : undefined;
    if (charge === undefined && composition["E"] !== undefined) {
      charge = -composition["E"];
    }

    let thermo: Nasa7Polynomial | undefined;
    const thermoRec = asRecord(sRec["thermo"]);
    if (thermoRec) {
      const tRanges = asArray(thermoRec["temperature-ranges"]) ?? [];
      const Tmin = asNumber(tRanges[0], 200.0);
      const Tmid = asNumber(tRanges[1], 1000.0);
      const Tmax = asNumber(tRanges[2], tRanges.length === 2 ? asNumber(tRanges[1], 3500.0) : 3500.0);
      const dataArr = asArray(thermoRec["data"]) ?? [];
      const lowArr = asArray(dataArr[0]) ?? [];
      const highArr = asArray(dataArr[1]) ?? lowArr;

      const lowCoeffs = lowArr.map((c) => asNumber(c, 0));
      const highCoeffs = highArr.map((c) => asNumber(c, 0));

      thermo = {
        model: "NASA7",
        Tmin,
        Tmid: tRanges.length === 2 ? (Tmin + Tmax) * 0.5 : Tmid,
        Tmax,
        lowCoeffs,
        highCoeffs,
        range: extractNodeRange(thermoRec, lineStarts),
      };
    }

    let transport: CanteraSpecies["transport"] | undefined;
    const transRec = asRecord(sRec["transport"]);
    if (transRec) {
      const rawDiam = transRec["diameter"] ?? transRec["collision-diameter"] ?? transRec["sigma"];
      transport = {
        model: transRec["model"] !== undefined ? asString(transRec["model"]) : undefined,
        geometry: transRec["geometry"] !== undefined ? asString(transRec["geometry"]) : undefined,
        diameter: rawDiam !== undefined ? asNumber(rawDiam, 0) : undefined,
        wellDepth: transRec["well-depth"] !== undefined ? asNumber(transRec["well-depth"], 0) : undefined,
        range: extractNodeRange(transRec, lineStarts),
      };
    }

    speciesMap.set(name, {
      name,
      composition,
      charge,
      thermo,
      transport,
      note: sRec["note"] !== undefined ? asString(sRec["note"]) : undefined,
      range: extractNodeRange(sRec, lineStarts),
    });
  }

  const reactions: CanteraReaction[] = [];
  const reactionsArr = asArray(rootObj["reactions"]) ?? [];
  let rxnIndex = 1;
  for (const rItem of reactionsArr) {
    const rRec = asRecord(rItem);
    if (!rRec) continue;
    const equation = asString(rRec["equation"]);
    const parsedEq = parseReactionEquation(equation);

    const explicitType = rRec["type"] !== undefined ? asString(rRec["type"]) : undefined;
    const lowRateConstant = parseArrheniusRateValue(
      rRec["low-P-rate-constant"] ?? rRec["low_P_rate_constant"],
      defaultEaUnit,
      lineStarts,
    );
    const highRateConstant = parseArrheniusRateValue(
      rRec["rate-constant"] ?? rRec["high-P-rate-constant"] ?? rRec["rate_constant"],
      defaultEaUnit,
      lineStarts,
    ) ?? { A: 1.0, b: 0.0, Ea: 0.0 };

    let troe: TroeFalloff | undefined;
    const troeRec = asRecord(rRec["Troe"] ?? rRec["troe"]);
    if (troeRec) {
      troe = {
        A: asNumber(troeRec["A"], 0),
        T3: asNumber(troeRec["T3"], 0),
        T1: asNumber(troeRec["T1"], 0),
        T2: troeRec["T2"] !== undefined ? asNumber(troeRec["T2"]) : undefined,
        range: extractNodeRange(troeRec, lineStarts),
      };
    }

    let type: CanteraReactionType = parsedEq.inferredType;
    if (
      explicitType === "elementary" ||
      explicitType === "three-body" ||
      explicitType === "falloff" ||
      explicitType === "plog"
    ) {
      type = explicitType;
    } else if (lowRateConstant !== undefined || troe !== undefined) {
      type = "falloff";
    }

    const effRaw = rRec["efficiencies"];
    const efficiencies = effRaw !== undefined ? parseNumberMap(effRaw) : undefined;
    const duplicate = rRec["duplicate"] === true || rRec["duplicate"] === "true" ? true : undefined;
    const orders = rRec["orders"] !== undefined ? parseNumberMap(rRec["orders"]) : undefined;

    const id = rRec["id"] !== undefined ? asString(rRec["id"]) : `R${rxnIndex}`;
    rxnIndex++;

    reactions.push({
      id,
      equation,
      type,
      reversible: parsedEq.reversible,
      reactants: parsedEq.reactants,
      products: parsedEq.products,
      rateConstant: highRateConstant,
      lowRateConstant,
      troe,
      efficiencies,
      duplicate,
      orders,
      range: extractNodeRange(rRec, lineStarts),
    });
  }

  const firstPhaseName = phases.keys().next().value;
  const mechName = asString(rootObj["name"], firstPhaseName ?? "CanteraMechanism");
  const description = rootObj["description"] !== undefined ? asString(rootObj["description"]) : undefined;

  const mechanism: CanteraMechanism = {
    name: mechName,
    description,
    units,
    phases,
    species: speciesMap,
    reactions,
    range: makeRange(lineStarts, 0, source.length),
  };

  return {
    format: "yaml",
    mechanism,
    sourceFile,
  };
}

// ============================================================================
// Legacy CTI (.cti) Zero-Regex Parser
// ============================================================================

interface CtiCallBlock {
  fnName: string;
  argsBody: string;
  startOffset: number;
  endOffset: number;
}

function extractCtiCallBlocks(source: string): CtiCallBlock[] {
  const blocks: CtiCallBlock[] = [];
  let i = 0;
  const n = source.length;

  while (i < n) {
    const ch = source[i] ?? "";
    if (ch === "#") {
      while (i < n && source[i] !== "\n") i++;
      continue;
    }
    if (isAlphaChar(ch) || ch === "_") {
      const startOffset = i;
      while (i < n && (isAlphaNumericChar(source[i] ?? "") || source[i] === "_")) i++;
      const fnName = source.slice(startOffset, i);
      while (i < n && isWhitespaceChar(source[i] ?? "")) i++;
      if (source[i] === "(") {
        i++; // skip '('
        const bodyStart = i;
        let depth = 1;
        let inSingle = false;
        let inDouble = false;
        while (i < n && depth > 0) {
          const c = source[i] ?? "";
          if (c === "'" && !inDouble) inSingle = !inSingle;
          else if (c === '"' && !inSingle) inDouble = !inDouble;
          else if (!inSingle && !inDouble) {
            if (c === "#") {
              while (i < n && source[i] !== "\n") i++;
              continue;
            }
            if (c === "(") depth++;
            else if (c === ")") depth--;
          }
          i++;
        }
        const bodyEnd = Math.max(bodyStart, i - 1);
        blocks.push({
          fnName,
          argsBody: source.slice(bodyStart, bodyEnd),
          startOffset,
          endOffset: i,
        });
        continue;
      }
    }
    i++;
  }

  return blocks;
}

function splitCtiArguments(argsBody: string): {
  positional: string[];
  named: Record<string, string>;
} {
  const parts = splitTopLevelDelimited(argsBody, ",");
  const positional: string[] = [];
  const named: Record<string, string> = {};

  for (const part of parts) {
    // Find top-level '=' not inside quotes/brackets/parens
    let eqIdx = -1;
    let bDepth = 0;
    let pDepth = 0;
    let inSingle = false;
    let inDouble = false;

    for (let i = 0; i < part.length; i++) {
      const ch = part[i] ?? "";
      if (ch === "'" && !inDouble) inSingle = !inSingle;
      else if (ch === '"' && !inSingle) inDouble = !inDouble;
      else if (!inSingle && !inDouble) {
        if (ch === "[") bDepth++;
        else if (ch === "]") bDepth = Math.max(0, bDepth - 1);
        else if (ch === "(") pDepth++;
        else if (ch === ")") pDepth = Math.max(0, pDepth - 1);
        else if (ch === "=" && bDepth === 0 && pDepth === 0) {
          const prev = i > 0 ? (part[i - 1] ?? "") : "";
          const next = i + 1 < part.length ? (part[i + 1] ?? "") : "";
          if (prev !== "<" && next !== ">") {
            eqIdx = i;
            break;
          }
        }
      }
    }

    if (eqIdx !== -1) {
      const key = trimText(part.slice(0, eqIdx));
      const val = trimText(part.slice(eqIdx + 1));
      named[key] = val;
    } else {
      positional.push(part);
    }
  }

  return { positional, named };
}

function parseCtiNumberArray(raw: string): number[] {
  const t = trimText(raw);
  const inner = t.startsWith("[") && t.endsWith("]") ? t.slice(1, t.length - 1) : t;
  const parts = splitTopLevelDelimited(inner, ",");
  return parts.map((p) => parseNumericWithUnit(p));
}

function parseCtiNasaThermo(thermoRaw: string, range: CanteraRange): Nasa7Polynomial | undefined {
  const calls = extractCtiCallBlocks(thermoRaw).filter((b) => b.fnName === "NASA");
  if (calls.length === 0) return undefined;

  const parsedPolys: Array<{ tLow: number; tHigh: number; coeffs: number[] }> = [];
  for (const call of calls) {
    const { positional } = splitCtiArguments(call.argsBody);
    const tRange = parseCtiNumberArray(positional[0] ?? "[]");
    const coeffs = parseCtiNumberArray(positional[1] ?? "[]");
    if (tRange.length >= 2 && coeffs.length >= 7) {
      parsedPolys.push({
        tLow: tRange[0] ?? 200,
        tHigh: tRange[1] ?? 1000,
        coeffs: coeffs.slice(0, 7),
      });
    }
  }

  if (parsedPolys.length === 0) return undefined;
  parsedPolys.sort((a, b) => a.tLow - b.tLow);
  const low = parsedPolys[0]!;
  const high = parsedPolys[1] ?? low;

  return {
    model: "NASA7",
    Tmin: low.tLow,
    Tmid: low.tHigh,
    Tmax: high.tHigh,
    lowCoeffs: low.coeffs,
    highCoeffs: high.coeffs,
    range,
  };
}

function parseCtiDocument(source: string, sourceFile?: string | undefined): CanteraDocument {
  const lineStarts = buildLineStarts(source);
  const blocks = extractCtiCallBlocks(source);

  const phases = new Map<string, CanteraPhase>();
  const speciesMap = new Map<string, CanteraSpecies>();
  const reactions: CanteraReaction[] = [];
  let rxnIdx = 1;

  for (const block of blocks) {
    const range = makeRange(lineStarts, block.startOffset, block.endOffset);
    const { positional, named } = splitCtiArguments(block.argsBody);

    if (block.fnName === "ideal_gas") {
      const name = stripQuotes(named["name"] ?? positional[0] ?? "gas");
      const elements = parseStringList(stripQuotes(named["elements"] ?? ""));
      const species = parseStringList(stripQuotes(named["species"] ?? ""));
      phases.set(name, {
        name,
        thermo: "ideal-gas",
        kinetics: stripQuotes(named["kinetics"] ?? "gas"),
        elements,
        species,
        range,
      });
    } else if (block.fnName === "species") {
      const name = stripQuotes(named["name"] ?? positional[0] ?? "");
      if (!name) continue;
      const atomsStr = stripQuotes(named["atoms"] ?? "");
      const composition: Record<string, number> = {};
      for (const [el, count] of splitSpaceOrCommaPairs(atomsStr)) {
        composition[el] = count;
      }
      const charge = composition["E"] !== undefined ? -composition["E"] : undefined;
      const thermo = named["thermo"] ? parseCtiNasaThermo(named["thermo"], range) : undefined;
      speciesMap.set(name, {
        name,
        composition,
        charge,
        thermo,
        note: named["note"] ? stripQuotes(named["note"]) : undefined,
        range,
      });
    } else if (
      block.fnName === "reaction" ||
      block.fnName === "three_body_reaction" ||
      block.fnName === "falloff_reaction"
    ) {
      const equation = stripQuotes(named["equation"] ?? positional[0] ?? "");
      const parsedEq = parseReactionEquation(equation);
      const rateRaw = named["kf"] ?? named["rate"] ?? positional[1] ?? "[1.0, 0.0, 0.0]";
      const rateNums = parseCtiNumberArray(rateRaw);
      const rateConstant: ArrheniusRate = {
        A: rateNums[0] ?? 1.0,
        b: rateNums[1] ?? 0.0,
        Ea: rateNums[2] ?? 0.0,
        range,
      };

      let lowRateConstant: ArrheniusRate | undefined;
      if (named["kf0"] || (block.fnName === "falloff_reaction" && positional[2])) {
        const lowNums = parseCtiNumberArray(named["kf0"] ?? positional[2] ?? "[]");
        if (lowNums.length >= 3) {
          lowRateConstant = {
            A: lowNums[0] ?? 1.0,
            b: lowNums[1] ?? 0.0,
            Ea: lowNums[2] ?? 0.0,
            range,
          };
        }
      }

      let troe: TroeFalloff | undefined;
      if (named["falloff"]) {
        const troeCalls = extractCtiCallBlocks(named["falloff"]).filter((c) => c.fnName === "Troe");
        if (troeCalls[0]) {
          const troeArgs = splitCtiArguments(troeCalls[0].argsBody);
          troe = {
            A: parseNumericWithUnit(troeArgs.named["A"] ?? troeArgs.positional[0] ?? "0"),
            T3: parseNumericWithUnit(troeArgs.named["T3"] ?? troeArgs.positional[1] ?? "0"),
            T1: parseNumericWithUnit(troeArgs.named["T1"] ?? troeArgs.positional[2] ?? "0"),
            T2:
              troeArgs.named["T2"] !== undefined || troeArgs.positional[3] !== undefined
                ? parseNumericWithUnit(troeArgs.named["T2"] ?? troeArgs.positional[3] ?? "0")
                : undefined,
            range,
          };
        }
      }

      let efficiencies: Record<string, number> | undefined;
      if (named["efficiencies"]) {
        efficiencies = {};
        for (const [sp, eff] of splitSpaceOrCommaPairs(stripQuotes(named["efficiencies"]))) {
          efficiencies[sp] = eff;
        }
      }

      let type: CanteraReactionType = parsedEq.inferredType;
      if (block.fnName === "three_body_reaction") type = "three-body";
      else if (block.fnName === "falloff_reaction") type = "falloff";

      const optionsStr = named["options"] ? stripQuotes(named["options"]) : "";
      const duplicate = optionsStr.includes("duplicate") ? true : undefined;

      reactions.push({
        id: stripQuotes(named["id"] ?? `R${rxnIdx}`),
        equation,
        type,
        reversible: parsedEq.reversible,
        reactants: parsedEq.reactants,
        products: parsedEq.products,
        rateConstant,
        lowRateConstant,
        troe,
        efficiencies,
        duplicate,
        range,
      });
      rxnIdx++;
    }
  }

  const firstPhaseName = phases.keys().next().value;
  return {
    format: "cti",
    mechanism: {
      name: firstPhaseName ?? "CanteraMechanism",
      phases,
      species: speciesMap,
      reactions,
      range: makeRange(lineStarts, 0, source.length),
    },
    sourceFile,
  };
}

function isCtiFormat(source: string, sourceFile?: string | undefined): boolean {
  if (sourceFile && sourceFile.toLowerCase().endsWith(".cti")) {
    return true;
  }
  const hasCtiCall =
    source.includes("ideal_gas(") ||
    source.includes("three_body_reaction(") ||
    source.includes("falloff_reaction(") ||
    (source.includes("species(") && source.includes("NASA("));
  return hasCtiCall;
}

// ============================================================================
// Public Entry Points: parseCantera & serializeCantera
// ============================================================================

export function parseCantera(sourceText: string, sourceFile?: string | undefined): CanteraDocument {
  if (isCtiFormat(sourceText, sourceFile)) {
    return parseCtiDocument(sourceText, sourceFile);
  }
  return parseYamlCanteraDocument(sourceText, sourceFile);
}

export function serializeCantera(doc: CanteraDocument): string {
  const m = doc.mechanism;
  const lines: string[] = [];

  if (m.description) {
    lines.push(`description: "${m.description}"`);
    lines.push(``);
  }

  if (m.units && Object.keys(m.units).length > 0) {
    const pairs = Object.entries(m.units).map(([k, v]) => `${k}: ${v}`);
    lines.push(`units: {${pairs.join(", ")}}`);
    lines.push(``);
  }

  if (m.phases.size > 0) {
    lines.push(`phases:`);
    for (const phase of m.phases.values()) {
      lines.push(`- name: ${phase.name}`);
      lines.push(`  thermo: ${phase.thermo}`);
      if (phase.kinetics) {
        lines.push(`  kinetics: ${phase.kinetics}`);
      }
      if (phase.elements.length > 0) {
        lines.push(`  elements: [${phase.elements.join(", ")}]`);
      }
      if (phase.species.length > 0) {
        lines.push(`  species: [${phase.species.join(", ")}]`);
      }
      if (phase.state) {
        lines.push(`  state:`);
        if (phase.state.T !== undefined) lines.push(`    T: ${phase.state.T}`);
        if (phase.state.P !== undefined) lines.push(`    P: ${phase.state.P}`);
        if (phase.state.X) {
          const xPairs = Object.entries(phase.state.X).map(([k, v]) => `${k}: ${v}`);
          lines.push(`    X: {${xPairs.join(", ")}}`);
        }
      }
    }
    lines.push(``);
  }

  if (m.species.size > 0) {
    lines.push(`species:`);
    for (const sp of m.species.values()) {
      lines.push(`- name: ${sp.name}`);
      const compPairs = Object.entries(sp.composition).map(([k, v]) => `${k}: ${v}`);
      lines.push(`  composition: {${compPairs.join(", ")}}`);
      if (sp.charge !== undefined) {
        lines.push(`  charge: ${sp.charge}`);
      }
      if (sp.thermo) {
        lines.push(`  thermo:`);
        lines.push(`    model: NASA7`);
        lines.push(`    temperature-ranges: [${sp.thermo.Tmin}, ${sp.thermo.Tmid}, ${sp.thermo.Tmax}]`);
        lines.push(`    data:`);
        lines.push(`    - [${sp.thermo.lowCoeffs.join(", ")}]`);
        lines.push(`    - [${sp.thermo.highCoeffs.join(", ")}]`);
      }
      if (sp.note) {
        lines.push(`  note: "${sp.note}"`);
      }
    }
    lines.push(``);
  }

  if (m.reactions.length > 0) {
    lines.push(`reactions:`);
    for (const rxn of m.reactions) {
      lines.push(`- equation: "${rxn.equation}"`);
      if (rxn.type !== "elementary") {
        lines.push(`  type: ${rxn.type}`);
      }
      lines.push(`  rate-constant: {A: ${rxn.rateConstant.A}, b: ${rxn.rateConstant.b}, Ea: ${rxn.rateConstant.Ea}}`);
      if (rxn.lowRateConstant) {
        lines.push(
          `  low-P-rate-constant: {A: ${rxn.lowRateConstant.A}, b: ${rxn.lowRateConstant.b}, Ea: ${rxn.lowRateConstant.Ea}}`,
        );
      }
      if (rxn.troe) {
        const t2Part = rxn.troe.T2 !== undefined ? `, T2: ${rxn.troe.T2}` : "";
        lines.push(`  Troe: {A: ${rxn.troe.A}, T3: ${rxn.troe.T3}, T1: ${rxn.troe.T1}${t2Part}}`);
      }
      if (rxn.efficiencies && Object.keys(rxn.efficiencies).length > 0) {
        const effPairs = Object.entries(rxn.efficiencies).map(([k, v]) => `${k}: ${v}`);
        lines.push(`  efficiencies: {${effPairs.join(", ")}}`);
      }
      if (rxn.duplicate) {
        lines.push(`  duplicate: true`);
      }
    }
  }

  return lines.join("\n") + "\n";
}
