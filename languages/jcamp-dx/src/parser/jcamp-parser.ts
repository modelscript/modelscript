// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * JCAMP-DX Document & Labeled Data Record (LDR) Parser and Serializer.
 *
 * Parses single-block and compound (`##DATA TYPE= LINK`) JCAMP-DX 4.24/5.01/6.00 files,
 * decoding `##XYDATA=(X++(Y..Y))`, `##PEAK TABLE=(XY..XY)`, `##XYPOINTS=(XY..XY)`,
 * and `$$` comments.
 */

import type { AsdfMode, JcampBlock, JcampDocument, JcampLdr, JcampParseError } from "../types.js";
import { decodePeakTable, decodeXyData, encodeAsdf } from "./asdf.js";

/**
 * Normalizes a JCAMP-DX LDR label according to IUPAC rules:
 * strips leading `##`, trailing `=`, uppercase, removes non-alphanumeric separators
 * while preserving readable canonical names.
 */
export function normalizeLdrLabel(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, " ");
}

function parseNumericLdr(value: string): number | undefined {
  const cleaned = value.trim().split(/\s+/)[0];
  if (!cleaned) return undefined;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : undefined;
}

interface RawLdrToken {
  label: string;
  rawLabel: string;
  firstLineValue: string;
  continuationLines: string[];
  line: number;
  endLine: number;
  startOffset: number;
  endOffset: number;
  comment?: string;
}

function createEmptyBlock(startLine: number): JcampBlock {
  return {
    title: "",
    jcampDxVersion: "",
    dataType: "",
    points: [],
    peakTable: [],
    ldrs: [],
    comments: [],
    checkpointErrors: [],
    parseErrors: [],
    children: [],
    startLine,
    endLine: startLine,
    hasEnd: false,
  };
}

function finalizeBlock(block: JcampBlock, rawTokens: RawLdrToken[]): void {
  // First pass: extract metadata LDRs (factors, ranges, units, counts)
  for (const tok of rawTokens) {
    const fullVal =
      tok.continuationLines.length > 0
        ? [tok.firstLineValue, ...tok.continuationLines].filter((s) => s.length > 0).join("\n")
        : tok.firstLineValue;

    const ldr: JcampLdr = {
      label: tok.label,
      rawLabel: tok.rawLabel,
      value: fullVal,
      line: tok.line,
      endLine: tok.endLine,
      startOffset: tok.startOffset,
      endOffset: tok.endOffset,
      ...(tok.comment !== undefined ? { comment: tok.comment } : {}),
    };
    block.ldrs.push(ldr);

    switch (tok.label) {
      case "TITLE":
        block.title = tok.firstLineValue;
        break;
      case "JCAMP-DX":
      case "JCAMPDX":
        block.jcampDxVersion = tok.firstLineValue;
        break;
      case "DATA TYPE":
      case "DATATYPE":
        block.dataType = tok.firstLineValue.toUpperCase();
        break;
      case "ORIGIN":
        block.origin = tok.firstLineValue;
        break;
      case "OWNER":
        block.owner = tok.firstLineValue;
        break;
      case "DATE":
        block.date = tok.firstLineValue;
        break;
      case "TIME":
        block.time = tok.firstLineValue;
        break;
      case "XUNITS":
        block.xUnits = tok.firstLineValue;
        break;
      case "YUNITS":
        block.yUnits = tok.firstLineValue;
        break;
      case "XLABEL":
        block.xLabel = tok.firstLineValue;
        break;
      case "YLABEL":
        block.yLabel = tok.firstLineValue;
        break;
      case "FIRSTX": {
        const v = parseNumericLdr(tok.firstLineValue);
        if (v !== undefined) block.firstX = v;
        break;
      }
      case "LASTX": {
        const v = parseNumericLdr(tok.firstLineValue);
        if (v !== undefined) block.lastX = v;
        break;
      }
      case "FIRSTY": {
        const v = parseNumericLdr(tok.firstLineValue);
        if (v !== undefined) block.firstY = v;
        break;
      }
      case "LASTY": {
        const v = parseNumericLdr(tok.firstLineValue);
        if (v !== undefined) block.lastY = v;
        break;
      }
      case "MAXX": {
        const v = parseNumericLdr(tok.firstLineValue);
        if (v !== undefined) block.maxX = v;
        break;
      }
      case "MINX": {
        const v = parseNumericLdr(tok.firstLineValue);
        if (v !== undefined) block.minX = v;
        break;
      }
      case "MAXY": {
        const v = parseNumericLdr(tok.firstLineValue);
        if (v !== undefined) block.maxY = v;
        break;
      }
      case "MINY": {
        const v = parseNumericLdr(tok.firstLineValue);
        if (v !== undefined) block.minY = v;
        break;
      }
      case "NPOINTS": {
        const v = parseNumericLdr(tok.firstLineValue);
        if (v !== undefined) block.nPoints = v;
        break;
      }
      case "XFACTOR": {
        const v = parseNumericLdr(tok.firstLineValue);
        if (v !== undefined) block.xFactor = v;
        break;
      }
      case "YFACTOR": {
        const v = parseNumericLdr(tok.firstLineValue);
        if (v !== undefined) block.yFactor = v;
        break;
      }
      case "DELTAX": {
        const v = parseNumericLdr(tok.firstLineValue);
        if (v !== undefined) block.deltaX = v;
        break;
      }
      case "END":
        block.hasEnd = true;
        break;
      default:
        break;
    }
  }

  // Second pass: decode XYDATA / PEAK TABLE / XYPOINTS using extracted factors & bounds
  const xFactor = block.xFactor !== undefined && block.xFactor > 0 ? block.xFactor : 1;
  const yFactor = block.yFactor !== undefined && block.yFactor > 0 ? block.yFactor : 1;

  for (const tok of rawTokens) {
    if (tok.label === "XYDATA" || tok.label === "DATA TABLE") {
      block.dataFormat = tok.firstLineValue.replace(/\s+/g, "");
      const decoded = decodeXyData(tok.continuationLines, {
        xFactor,
        yFactor,
        ...(block.firstX !== undefined ? { firstX: block.firstX } : {}),
        ...(block.lastX !== undefined ? { lastX: block.lastX } : {}),
        ...(block.nPoints !== undefined ? { nPoints: block.nPoints } : {}),
        ...(block.deltaX !== undefined ? { deltaX: block.deltaX } : {}),
        startLine: tok.line + 1,
      });
      block.points.push(...decoded.points);
      block.checkpointErrors.push(...decoded.checkpointErrors);
      block.parseErrors.push(...decoded.parseErrors);
    } else if (tok.label === "PEAK TABLE" || tok.label === "PEAKTABLE") {
      block.dataFormat = block.dataFormat ?? tok.firstLineValue.replace(/\s+/g, "");
      const decoded = decodePeakTable(tok.continuationLines, xFactor, yFactor, tok.line + 1);
      block.peakTable.push(...decoded.points);
      block.parseErrors.push(...decoded.parseErrors);
    } else if (tok.label === "XYPOINTS") {
      block.dataFormat = block.dataFormat ?? tok.firstLineValue.replace(/\s+/g, "");
      const decoded = decodePeakTable(tok.continuationLines, xFactor, yFactor, tok.line + 1);
      block.points.push(...decoded.points);
      block.parseErrors.push(...decoded.parseErrors);
    }
  }
}

/**
 * Parses a JCAMP-DX source string into a `JcampDocument` containing one or more blocks.
 */
export function parseJcampDx(source: string): JcampDocument {
  const lines = source.split(/\r?\n/);
  const blocks: JcampBlock[] = [];
  const stack: Array<{ block: JcampBlock; tokens: RawLdrToken[] }> = [];
  let currentToken: RawLdrToken | null = null;

  let offset = 0;

  const ensureActiveFrame = (lineNum: number): { block: JcampBlock; tokens: RawLdrToken[] } => {
    if (stack.length === 0) {
      const frame = { block: createEmptyBlock(lineNum), tokens: [] as RawLdrToken[] };
      stack.push(frame);
      blocks.push(frame.block);
    }
    return stack[stack.length - 1]!;
  };

  for (let idx = 0; idx < lines.length; idx++) {
    const rawLine = lines[idx]!;
    const lineNum = idx + 1;
    const lineStart = offset;
    const lineEnd = offset + rawLine.length;
    offset = lineEnd + 1;

    const trimmed = rawLine.trim();

    // Full-line comment
    if (trimmed.startsWith("$$")) {
      const frame = ensureActiveFrame(lineNum);
      frame.block.comments.push(trimmed.slice(2).trim());
      continue;
    }

    // Labeled Data Record: starts with `##`
    if (trimmed.startsWith("##")) {
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx < 0) {
        const frame = ensureActiveFrame(lineNum);
        const err: JcampParseError = {
          line: lineNum,
          column: 1,
          message: `Malformed Labeled Data Record missing '=': '${trimmed.slice(0, 40)}'`,
        };
        frame.block.parseErrors.push(err);
        currentToken = null;
        continue;
      }

      const rawLabel = trimmed.slice(2, eqIdx).trim();
      const label = normalizeLdrLabel(rawLabel);
      let rest = trimmed.slice(eqIdx + 1);
      let comment: string | undefined;
      const commentIdx = rest.indexOf("$$");
      if (commentIdx >= 0) {
        comment = rest.slice(commentIdx + 2).trim();
        rest = rest.slice(0, commentIdx);
      }
      const firstLineValue = rest.trim();

      if (label === "TITLE") {
        // Start a new block (either top-level or nested inside a LINK block)
        const newBlock = createEmptyBlock(lineNum);
        const newFrame = { block: newBlock, tokens: [] as RawLdrToken[] };
        if (stack.length > 0) {
          stack[stack.length - 1]!.block.children.push(newBlock);
        } else {
          blocks.push(newBlock);
        }
        stack.push(newFrame);
      }

      const frame = ensureActiveFrame(lineNum);
      const token: RawLdrToken = {
        label,
        rawLabel,
        firstLineValue,
        continuationLines: [],
        line: lineNum,
        endLine: lineNum,
        startOffset: lineStart,
        endOffset: lineEnd,
        ...(comment !== undefined ? { comment } : {}),
      };
      frame.tokens.push(token);
      currentToken = token;

      if (label === "END") {
        frame.block.endLine = lineNum;
        finalizeBlock(frame.block, frame.tokens);
        stack.pop();
        currentToken = null;
      }
      continue;
    }

    // Continuation line for active LDR
    if (trimmed.length === 0) continue;

    if (currentToken) {
      currentToken.continuationLines.push(rawLine);
      currentToken.endLine = lineNum;
      currentToken.endOffset = lineEnd;
    } else {
      const frame = ensureActiveFrame(lineNum);
      frame.block.parseErrors.push({
        line: lineNum,
        column: 1,
        message: `Unexpected text outside Labeled Data Record: '${trimmed.slice(0, 40)}'`,
      });
    }
  }

  // Finalize any unclosed blocks (missing ##END=)
  while (stack.length > 0) {
    const frame = stack.pop()!;
    frame.block.endLine = lines.length;
    finalizeBlock(frame.block, frame.tokens);
  }

  // Primary block: first non-LINK block (preferring first child of a LINK block), else first block
  let primary: JcampBlock | null = null;
  for (const b of blocks) {
    if (b.dataType === "LINK" && b.children.length > 0) {
      primary = b.children[0]!;
      break;
    }
    primary = b;
    break;
  }

  return { blocks, primary };
}

/**
 * Convenience helper to parse a single JCAMP-DX spectrum block.
 */
export function parseJcampDxBlock(source: string): JcampBlock {
  const doc = parseJcampDx(source);
  return doc.primary ?? createEmptyBlock(1);
}

/**
 * Serializes a `JcampBlock` back to canonical JCAMP-DX 4.24 text in the requested ASDF mode.
 */
export function serializeJcampDx(block: JcampBlock, mode: AsdfMode = "DIFDUP"): string {
  const lines: string[] = [];
  const pts = block.points.length > 0 ? block.points : block.peakTable;
  const xFactor = block.xFactor ?? 1;
  const yFactor = block.yFactor ?? 1;

  lines.push(`##TITLE=${block.title || "Untitled Spectrum"}`);
  lines.push(`##JCAMP-DX=${block.jcampDxVersion || "4.24"}`);
  lines.push(`##DATA TYPE=${block.dataType || "INFRARED SPECTRUM"}`);
  if (block.origin) lines.push(`##ORIGIN=${block.origin}`);
  if (block.owner) lines.push(`##OWNER=${block.owner}`);
  if (block.xUnits) lines.push(`##XUNITS=${block.xUnits}`);
  if (block.yUnits) lines.push(`##YUNITS=${block.yUnits}`);

  if (pts.length > 0) {
    const firstX = block.firstX ?? pts[0]!.x;
    const lastX = block.lastX ?? pts[pts.length - 1]!.x;
    lines.push(`##FIRSTX=${firstX}`);
    lines.push(`##LASTX=${lastX}`);
    lines.push(`##NPOINTS=${pts.length}`);
    lines.push(`##XFACTOR=${xFactor}`);
    lines.push(`##YFACTOR=${yFactor}`);
  }

  if (block.points.length > 0) {
    lines.push("##XYDATA=(X++(Y..Y))");
    lines.push(...encodeAsdf(block.points, { mode, xFactor, yFactor }));
  } else if (block.peakTable.length > 0) {
    lines.push("##PEAK TABLE=(XY..XY)");
    for (const p of block.peakTable) {
      lines.push(`${p.x / xFactor}, ${p.y / yFactor}`);
    }
  }

  lines.push("##END=");
  return lines.join("\n") + "\n";
}
