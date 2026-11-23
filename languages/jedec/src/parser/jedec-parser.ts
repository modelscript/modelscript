// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * JEDEC Standard 3 (JESD3) PLD Fuse-Map & Test Vector Parser and Serializer.
 */

import type {
  JedecDeviceName,
  JedecDocument,
  JedecFuseBlock,
  JedecNoteField,
  JedecSourceSpan,
  JedecSyntaxIssue,
  JedecTestVector,
} from "../types.js";
import { computeJedecFuseChecksum, computeJedecTransmissionChecksum, formatHex16 } from "./checksum.js";

const VALID_VECTOR_CHARS = new Set(["0", "1", "C", "K", "H", "L", "X", "Z", "N", "F", "P", "B"]);

function buildLineOffsets(text: string): number[] {
  const offsets: number[] = [0];
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) {
      offsets.push(i + 1);
    }
  }
  return offsets;
}

function offsetToLineCol(lineOffsets: number[], offset: number): { line: number; column: number } {
  let lo = 0;
  let hi = lineOffsets.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const midOff = lineOffsets[mid] ?? 0;
    if (midOff <= offset) {
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  const lineIdx = Math.max(0, hi);
  const lineStart = lineOffsets[lineIdx] ?? 0;
  return { line: lineIdx + 1, column: offset - lineStart + 1 };
}

function makeSpan(lineOffsets: number[], startOffset: number, endOffset: number): JedecSourceSpan {
  const { line, column } = offsetToLineCol(lineOffsets, startOffset);
  return { line, column, startOffset, endOffset };
}

function inferDeviceName(
  headerText: string,
  notes: JedecNoteField[],
  pinCount: number | undefined,
  fuseCount: number | undefined,
): JedecDeviceName {
  const combined = `${headerText}\n${notes.map((n) => n.text).join("\n")}`.toUpperCase();
  if (/\bGAL22V10\b/.test(combined) || /\b22V10\b/.test(combined)) return "GAL22V10";
  if (/\bGAL16V8\b/.test(combined) || /\b16V8\b/.test(combined)) return "GAL16V8";
  if (/\bPAL16R8\b/.test(combined) || /\b16R8\b/.test(combined)) return "PAL16R8";
  if (/\bPAL16L8\b/.test(combined) || /\b16L8\b/.test(combined)) return "PAL16L8";

  if (fuseCount === 5892 || pinCount === 24) return "GAL22V10";
  if (fuseCount === 2194) return "GAL16V8";
  if (fuseCount === 2048) return "PAL16L8";
  return "GENERIC";
}

function isKnownFieldStart(trimmed: string): boolean {
  if (!trimmed) return false;
  if (/^Q[PFV]\s*\d+/i.test(trimmed)) return true;
  if (/^[FGX]\s*[0-9A-Za-z]*/i.test(trimmed) && /^[FGX](?:\s|$|\d)/i.test(trimmed)) return true;
  if (/^L\s*\d+/i.test(trimmed)) return true;
  if (/^C\s*[0-9A-Fa-f]{1,4}\s*$/i.test(trimmed)) return true;
  if (/^V\s*\d+/i.test(trimmed)) return true;
  if (/^N(?:\s|$)/i.test(trimmed)) return true;
  return false;
}

function extractNameFromUri(uri?: string): string {
  if (!uri) return "jedec_pld";
  const base = uri.split(/[\\/]/).pop() ?? uri;
  return base.replace(/\.[^.]+$/, "") || "jedec_pld";
}

/**
 * Parses a JEDEC JESD3 (`.jed` / `.jedec`) fuse-map & test-vector file into a structured `JedecDocument`.
 */
export function parseJedec(source: string, uri?: string): JedecDocument {
  const lineOffsets = buildLineOffsets(source);
  const stxIdx = source.indexOf("\x02");
  const etxIdx = source.indexOf("\x03");
  const hasStx = stxIdx >= 0;
  const hasEtx = etxIdx >= 0;

  const bodyStart = hasStx ? stxIdx + 1 : 0;
  const bodyEnd = hasEtx ? etxIdx : source.length;

  let declaredTransmissionChecksum: number | undefined;
  let declaredTransmissionChecksumHex: string | undefined;
  let declaredTransmissionChecksumSpan: JedecSourceSpan | undefined;
  let computedTransmissionChecksum: number | undefined;

  if (hasEtx) {
    computedTransmissionChecksum = computeJedecTransmissionChecksum(source);
    const afterEtx = source.slice(etxIdx + 1);
    const hexMatch = /^\s*([0-9A-Fa-f]{4})/.exec(afterEtx);
    if (hexMatch && hexMatch[1]) {
      declaredTransmissionChecksumHex = hexMatch[1].toUpperCase();
      declaredTransmissionChecksum = Number.parseInt(hexMatch[1], 16);
      const matchOffset = etxIdx + 1 + (hexMatch.index ?? 0) + afterEtx.indexOf(hexMatch[1]);
      declaredTransmissionChecksumSpan = makeSpan(lineOffsets, matchOffset, matchOffset + 4);
    }
  }

  let headerText = "";
  let pinCount: number | undefined;
  let pinCountSpan: JedecSourceSpan | undefined;
  let fuseCount: number | undefined;
  let fuseCountSpan: JedecSourceSpan | undefined;
  let maxVectors: number | undefined;
  let maxVectorsSpan: JedecSourceSpan | undefined;
  let defaultFuseState: number | undefined;
  let rawDefaultFuseState: string | undefined;
  let defaultFuseSpan: JedecSourceSpan | undefined;
  let securityFuse: number | undefined;
  let rawSecurityFuse: string | undefined;
  let securityFuseSpan: JedecSourceSpan | undefined;
  let defaultTestCondition: number | undefined;
  let defaultTestConditionSpan: JedecSourceSpan | undefined;
  let declaredFuseChecksum: number | undefined;
  let declaredFuseChecksumHex: string | undefined;
  let declaredFuseChecksumSpan: JedecSourceSpan | undefined;

  const fuseBlocks: JedecFuseBlock[] = [];
  const testVectors: JedecTestVector[] = [];
  const notes: JedecNoteField[] = [];
  const syntaxIssues: JedecSyntaxIssue[] = [];

  // Split body by `*` delimiter while preserving exact source offsets
  let cursor = bodyStart;
  let fieldIndex = 0;

  while (cursor < bodyEnd) {
    const starIdx = source.indexOf("*", cursor);
    if (starIdx === -1 || starIdx >= bodyEnd) {
      // Check if remaining non-whitespace text exists without a terminating `*`
      const trailing = source.slice(cursor, bodyEnd);
      const trimmedTrailing = trailing.trim();
      if (trimmedTrailing.length > 0) {
        const leadingWs = trailing.length - trailing.trimStart().length;
        const startOff = cursor + leadingWs;
        const endOff = startOff + trimmedTrailing.length;
        syntaxIssues.push({
          kind: "missing-delimiter",
          message: `Missing '*' delimiter after '${trimmedTrailing.slice(0, 24)}'`,
          span: makeSpan(lineOffsets, startOff, endOff),
        });
      }
      break;
    }

    const rawField = source.slice(cursor, starIdx);
    const trimmed = rawField.trim();
    const leadingWs = rawField.length - rawField.trimStart().length;
    const fieldStart = cursor + leadingWs;
    const fieldEnd = starIdx + 1;
    const span = makeSpan(lineOffsets, fieldStart, fieldEnd);

    cursor = starIdx + 1;

    if (trimmed.length === 0) {
      fieldIndex++;
      continue;
    }

    // Per JESD3: text between STX (or start of file) and the first `*` is the design specification header
    // unless it already starts with a standard JESD3 field code.
    if (fieldIndex === 0 && !isKnownFieldStart(trimmed)) {
      headerText = trimmed;
      fieldIndex++;
      continue;
    }

    fieldIndex++;

    const upper0 = trimmed.charAt(0).toUpperCase();
    const upper2 = trimmed.slice(0, 2).toUpperCase();

    if (upper2 === "QP") {
      const m = /^QP\s*(\d+)\s*$/i.exec(trimmed);
      if (m && m[1]) {
        pinCount = Number.parseInt(m[1], 10);
        pinCountSpan = span;
      } else {
        syntaxIssues.push({ kind: "syntax", message: `Malformed QP field '${trimmed}'`, span });
      }
      continue;
    }

    if (upper2 === "QF") {
      const m = /^QF\s*(\d+)\s*$/i.exec(trimmed);
      if (m && m[1]) {
        fuseCount = Number.parseInt(m[1], 10);
        fuseCountSpan = span;
      } else {
        syntaxIssues.push({ kind: "syntax", message: `Malformed QF field '${trimmed}'`, span });
      }
      continue;
    }

    if (upper2 === "QV") {
      const m = /^QV\s*(\d+)\s*$/i.exec(trimmed);
      if (m && m[1]) {
        maxVectors = Number.parseInt(m[1], 10);
        maxVectorsSpan = span;
      } else {
        syntaxIssues.push({ kind: "syntax", message: `Malformed QV field '${trimmed}'`, span });
      }
      continue;
    }

    if (upper0 === "F") {
      const val = trimmed.slice(1).trim();
      rawDefaultFuseState = val;
      defaultFuseSpan = span;
      if (val === "0" || val === "1") {
        defaultFuseState = val === "1" ? 1 : 0;
      }
      continue;
    }

    if (upper0 === "G") {
      const val = trimmed.slice(1).trim();
      rawSecurityFuse = val;
      securityFuseSpan = span;
      if (val === "0" || val === "1") {
        securityFuse = val === "1" ? 1 : 0;
      }
      continue;
    }

    if (upper0 === "X") {
      const val = trimmed.slice(1).trim();
      defaultTestConditionSpan = span;
      if (val === "0" || val === "1") {
        defaultTestCondition = val === "1" ? 1 : 0;
      } else {
        syntaxIssues.push({ kind: "syntax", message: `Malformed X default test condition '${trimmed}'`, span });
      }
      continue;
    }

    if (upper0 === "N") {
      notes.push({ text: trimmed.slice(1).trim(), span });
      continue;
    }

    if (upper0 === "C") {
      const m = /^C\s*([0-9A-Fa-f]{1,4})\s*$/i.exec(trimmed);
      if (m && m[1]) {
        declaredFuseChecksumHex = m[1].toUpperCase().padStart(4, "0");
        declaredFuseChecksum = Number.parseInt(m[1], 16);
        declaredFuseChecksumSpan = span;
      } else {
        syntaxIssues.push({ kind: "syntax", message: `Malformed C checksum field '${trimmed}'`, span });
      }
      continue;
    }

    if (upper0 === "L") {
      const m = /^L\s*(\d+)\s+([\s\S]*)$/i.exec(trimmed);
      if (m && m[1] !== undefined && m[2] !== undefined) {
        const address = Number.parseInt(m[1], 10);
        const rawBits = m[2].replace(/\s+/g, "");
        let validBits = "";
        for (let i = 0; i < rawBits.length; i++) {
          const ch = rawBits.charAt(i);
          if (ch === "0" || ch === "1") {
            validBits += ch;
          } else {
            syntaxIssues.push({
              kind: "invalid-fuse-bit",
              message: `${ch}@${address}`,
              span,
            });
          }
        }
        fuseBlocks.push({ address, bits: validBits, span });
      } else {
        syntaxIssues.push({ kind: "syntax", message: `Malformed L fuse-list field '${trimmed.slice(0, 32)}'`, span });
      }
      continue;
    }

    if (upper0 === "V") {
      const m = /^V\s*(\d+)\s+([^\s*]+)\s*$/i.exec(trimmed);
      if (m && m[1] !== undefined && m[2] !== undefined) {
        const vectorNumber = Number.parseInt(m[1], 10);
        const pins = m[2].toUpperCase();
        for (let i = 0; i < pins.length; i++) {
          const ch = pins.charAt(i);
          if (!VALID_VECTOR_CHARS.has(ch)) {
            syntaxIssues.push({
              kind: "invalid-vector-char",
              message: `${ch}@${vectorNumber}`,
              span,
            });
          }
        }
        testVectors.push({ number: vectorNumber, pins, span });
      } else {
        syntaxIssues.push({ kind: "syntax", message: `Malformed V test vector field '${trimmed.slice(0, 32)}'`, span });
      }
      continue;
    }

    // Other valid JESD3 optional fields (D, K, U, S, R, T, etc.) are accepted without error;
    // completely unknown non-alphanumeric junk triggers syntax error.
    if (!/^[A-Z]/i.test(trimmed)) {
      syntaxIssues.push({ kind: "syntax", message: `Unexpected JESD3 field '${trimmed.slice(0, 24)}'`, span });
    }
  }

  // Materialize flat fuse array
  const effectiveFuseCount = fuseCount ?? 0;
  const fuses = new Uint8Array(effectiveFuseCount);
  if (defaultFuseState === 1) {
    fuses.fill(1);
  }

  for (const block of fuseBlocks) {
    for (let i = 0; i < block.bits.length; i++) {
      const idx = block.address + i;
      if (idx >= 0 && idx < effectiveFuseCount) {
        fuses[idx] = block.bits.charCodeAt(i) === 49 ? 1 : 0;
      }
    }
  }

  const computedFuseChecksum = computeJedecFuseChecksum(fuses);
  const deviceName = inferDeviceName(headerText, notes, pinCount, fuseCount);

  return {
    name: extractNameFromUri(uri),
    headerText,
    deviceName,
    pinCount,
    pinCountSpan,
    fuseCount,
    fuseCountSpan,
    maxVectors,
    maxVectorsSpan,
    defaultFuseState,
    rawDefaultFuseState,
    defaultFuseSpan,
    securityFuse,
    rawSecurityFuse,
    securityFuseSpan,
    defaultTestCondition,
    defaultTestConditionSpan,
    declaredFuseChecksum,
    declaredFuseChecksumHex,
    declaredFuseChecksumSpan,
    hasStx,
    hasEtx,
    declaredTransmissionChecksum,
    declaredTransmissionChecksumHex,
    declaredTransmissionChecksumSpan,
    computedTransmissionChecksum,
    fuseBlocks,
    testVectors,
    notes,
    fuses,
    computedFuseChecksum,
    syntaxIssues,
    sourceText: source,
  };
}

export interface SerializeJedecOptions {
  /** Wrap output with STX (`\x02`) and ETX (`\x03`) + 4-hex transmission checksum (default: `true`). */
  includeFraming?: boolean | undefined;
  /** Number of fuses per `L` line when emitting from `doc.fuses` (default: 32). */
  fusesPerLine?: number | undefined;
  /** Recompute `C` fuse checksum from `doc.fuses` (default: `true`). */
  recomputeChecksums?: boolean | undefined;
}

/**
 * Serializes a `JedecDocument` back into canonical JEDEC JESD3 text.
 */
export function serializeJedec(doc: JedecDocument, options?: SerializeJedecOptions): string {
  const includeFraming = options?.includeFraming ?? (doc.hasStx || doc.hasEtx);
  const fusesPerLine = options?.fusesPerLine ?? 32;
  const recomputeChecksums = options?.recomputeChecksums ?? true;

  const lines: string[] = [];

  if (doc.headerText.trim().length > 0) {
    lines.push(`${doc.headerText.trim()}*`);
  } else {
    lines.push(`JEDEC JESD3 ${doc.deviceName}*`);
  }

  if (doc.pinCount !== undefined) {
    lines.push(`QP${doc.pinCount}*`);
  }
  if (doc.fuseCount !== undefined) {
    lines.push(`QF${doc.fuseCount}*`);
  }
  if (doc.maxVectors !== undefined) {
    lines.push(`QV${doc.maxVectors}*`);
  }
  if (doc.defaultFuseState !== undefined) {
    lines.push(`F${doc.defaultFuseState}*`);
  }
  if (doc.securityFuse !== undefined) {
    lines.push(`G${doc.securityFuse}*`);
  }
  if (doc.defaultTestCondition !== undefined) {
    lines.push(`X${doc.defaultTestCondition}*`);
  }

  for (const note of doc.notes) {
    lines.push(`N ${note.text}*`);
  }

  const defaultBit = doc.defaultFuseState ?? 0;
  if (doc.fuses.length > 0) {
    const padWidth = String(doc.fuses.length).length;
    for (let addr = 0; addr < doc.fuses.length; addr += fusesPerLine) {
      const end = Math.min(addr + fusesPerLine, doc.fuses.length);
      let hasNonDefault = false;
      let bits = "";
      for (let i = addr; i < end; i++) {
        const b = doc.fuses[i] ?? 0;
        if (b !== defaultBit) hasNonDefault = true;
        bits += b ? "1" : "0";
      }
      if (hasNonDefault || doc.defaultFuseState === undefined) {
        lines.push(`L${String(addr).padStart(padWidth, "0")} ${bits}*`);
      }
    }
  } else {
    for (const block of doc.fuseBlocks) {
      lines.push(`L${block.address} ${block.bits}*`);
    }
  }

  for (const vec of doc.testVectors) {
    const vNum = String(vec.number).padStart(4, "0");
    lines.push(`V${vNum} ${vec.pins}*`);
  }

  const fuseChecksum = recomputeChecksums
    ? computeJedecFuseChecksum(doc.fuses)
    : (doc.declaredFuseChecksum ?? doc.computedFuseChecksum);
  lines.push(`C${formatHex16(fuseChecksum)}*`);

  const body = lines.join("\n") + "\n";

  if (!includeFraming) {
    return body;
  }

  const framed = `\x02${body}\x03`;
  const txChecksum = computeJedecTransmissionChecksum(framed);
  return `${framed}${formatHex16(txChecksum)}\n`;
}
