// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Language Server Protocol (LSP) services for JEDEC JESD3:
 * diagnostics (`validateJedec`), document symbols (`getJedecDocumentSymbols`),
 * hover documentation (`getJedecHover`), and completions (`getJedecCompletions`).
 */

import { getOrLoadLanguageWasmParser } from "@modelscript/dsl";
import { cstLineText, groupAllCstTokensByLine, type CstNodeLike } from "@modelscript/runtime";
import { createWasmParserSync } from "../src-gen/bindings.js";
import { lintJedec, type JedecLintOptions } from "./lints/index.js";
import { formatHex16 } from "./parser/checksum.js";
import { parseJedec } from "./parser/jedec-parser.js";
import { extractJedecEquations } from "./solver/boolean-extractor.js";
import type { JedecSourceSpan } from "./types.js";

export interface LspPosition {
  line: number;
  character: number;
}

export interface LspRange {
  start: LspPosition;
  end: LspPosition;
}

export enum LspSymbolKind {
  File = 1,
  Module = 2,
  Namespace = 3,
  Package = 4,
  Class = 5,
  Method = 6,
  Property = 7,
  Field = 8,
  Constructor = 9,
  Enum = 10,
  Interface = 11,
  Function = 12,
  Variable = 13,
  Constant = 14,
  Struct = 23,
}

export interface LspDocumentSymbol {
  name: string;
  detail?: string | undefined;
  kind: LspSymbolKind;
  range: LspRange;
  selectionRange: LspRange;
  children?: LspDocumentSymbol[] | undefined;
}

export interface LspDiagnostic {
  range: LspRange;
  severity: 1 | 2 | 3 | 4;
  code: string;
  source: string;
  message: string;
}

export interface LspHover {
  contents: {
    kind: "markdown" | "plaintext";
    value: string;
  };
  range?: LspRange | undefined;
}

export interface LspCompletionItem {
  label: string;
  detail: string;
  insertText: string;
}

const DEFAULT_RANGE: LspRange = {
  start: { line: 0, character: 0 },
  end: { line: 0, character: 1 },
};

const JESD3_FIELD_DOCS: Record<string, string> = {
  QP: "**QP\\<n\\>*** — Device pin count declaration (e.g., `QP20*` for PAL16L8/GAL16V8, `QP24*` for GAL22V10).",
  QF: "**QF\\<n\\>*** — Mandatory total fuse count declaration (e.g., `QF2048*` for PAL16L8, `QF2194*` for GAL16V8).",
  QV: "**QV\\<n\\>*** — Maximum number of functional test vectors (`V` fields).",
  F: "**F\\<0|1\\>*** — Default state for unspecified fuses (`F0*` = intact/low, `F1*` = blown/high).",
  L: "**L\\<addr\\> \\<bits\\>*** — Fuse data list starting at decimal address `<addr>` (`0` = intact, `1` = blown).",
  G: "**G\\<0|1\\>*** — Security fuse (`G0*` = readable, `G1*` = blown / read-protected).",
  N: "**N \\<text\\>*** — Note / comment field (often carries `DEVICE PAL16L8` or pin assignments).",
  C: "**C\\<hhhh\\>*** — 16-bit hexadecimal fuse checksum (LSB-first 8-bit byte sum mod 0x10000).",
  V: "**V\\<n\\> \\<pins\\>*** — Functional test vector (`0`/`1`/`C`/`K` inputs, `H`/`L`/`Z`/`X`/`N` outputs/power).",
  X: "**X\\<0|1\\>*** — Default test condition for unspecified pins.",
  PAL16L8: "**PAL16L8** — 20-pin combinational PAL (2048 fuses = 64x32 AND array, 8 active-low outputs).",
  PAL16R8: "**PAL16R8** — 20-pin registered PAL (2048 fuses = 64x32 AND array, 8 D-FF outputs).",
  GAL16V8: "**GAL16V8** — 20-pin E2CMOS GAL (2194 fuses, 8 OLMC macrocells with programmable XOR polarity).",
  GAL22V10: "**GAL22V10** — 24-pin E2CMOS GAL (5892 fuses, 10 variable-product-term OLMC macrocells).",
};

interface CstLineEntry {
  row: number;
  text: string;
  startCol: number;
  endCol: number;
}

interface JedecCstIndex {
  byRow: Map<number, CstLineEntry>;
  lastRow: number;
  lastEndCol: number;
}

function buildJedecCstIndex(source: string): JedecCstIndex {
  const byRow = new Map<number, CstLineEntry>();
  let rootNode: unknown = null;
  try {
    rootNode =
      getOrLoadLanguageWasmParser("jedec", import.meta.url, createWasmParserSync).parse(source)?.rootNode ?? null;
  } catch {
    rootNode = null;
  }

  let lastRow = 0;
  let lastEndCol = 0;
  if (rootNode) {
    for (const { row, tokens } of groupAllCstTokensByLine(rootNode as CstNodeLike)) {
      const lineText = cstLineText(source, tokens);
      const first = tokens[0] as (CstNodeLike & { endPosition?: { column: number } }) | undefined;
      const last = tokens[tokens.length - 1] as (CstNodeLike & { endPosition?: { column: number } }) | undefined;
      const startCol = first?.startPosition?.column ?? 0;
      const endCol = last?.endPosition?.column ?? startCol + lineText.length;
      byRow.set(row, { row, text: lineText, startCol, endCol });
      if (row >= lastRow) {
        lastRow = row;
        lastEndCol = endCol;
      }
    }
  } else {
    const rawLines = source.split(/\r?\n/);
    for (let i = 0; i < rawLines.length; i++) {
      const raw = rawLines[i] ?? "";
      const trimmed = raw.trim();
      if (!trimmed) continue;
      const startCol = Math.max(0, raw.search(/\S/));
      const endCol = startCol + trimmed.length;
      byRow.set(i, { row: i, text: trimmed, startCol, endCol });
      lastRow = i;
      lastEndCol = endCol;
    }
  }
  return { byRow, lastRow, lastEndCol };
}

function spanToRange(span?: JedecSourceSpan): LspRange {
  if (!span) return DEFAULT_RANGE;
  const line = Math.max(0, span.line - 1);
  const startChar = Math.max(0, span.column - 1);
  const len = Math.max(1, span.endOffset - span.startOffset);
  return {
    start: { line, character: startChar },
    end: { line, character: startChar + len },
  };
}

/**
 * Validates a JEDEC JESD3 source string and returns LSP diagnostics.
 */
export function validateJedec(source: string, uri?: string, options?: JedecLintOptions): LspDiagnostic[] {
  const doc = parseJedec(source, uri);
  const lints = lintJedec(doc, options);
  return lints.map((d) => ({
    range: {
      start: { line: Math.max(0, d.line - 1), character: Math.max(0, d.column - 1) },
      end: {
        line: Math.max(0, d.line - 1),
        character: Math.max(0, d.column - 1) + Math.max(1, d.endOffset - d.startOffset),
      },
    },
    severity: d.severity === "error" ? 1 : d.severity === "warning" ? 2 : 3,
    code: d.code,
    source: "jedec",
    message: d.message,
  }));
}

/**
 * Returns hierarchical LSP document symbols for a JEDEC JESD3 file.
 */
export function getJedecDocumentSymbols(source: string, uri?: string): LspDocumentSymbol[] {
  const doc = parseJedec(source, uri);
  const extraction = extractJedecEquations(doc);
  const children: LspDocumentSymbol[] = [];

  if (doc.pinCount !== undefined) {
    const r = spanToRange(doc.pinCountSpan);
    children.push({
      name: `QP${doc.pinCount}`,
      detail: `${doc.pinCount} pins`,
      kind: LspSymbolKind.Property,
      range: r,
      selectionRange: r,
    });
  }

  if (doc.fuseCount !== undefined) {
    const r = spanToRange(doc.fuseCountSpan);
    children.push({
      name: `QF${doc.fuseCount}`,
      detail: `${doc.fuseCount} fuses`,
      kind: LspSymbolKind.Property,
      range: r,
      selectionRange: r,
    });
  }

  for (const block of doc.fuseBlocks) {
    const r = spanToRange(block.span);
    children.push({
      name: `L${block.address}`,
      detail: `${block.bits.length} fuses`,
      kind: LspSymbolKind.Field,
      range: r,
      selectionRange: r,
    });
  }

  for (const vec of doc.testVectors) {
    const r = spanToRange(vec.span);
    children.push({
      name: `V${String(vec.number).padStart(4, "0")}`,
      detail: vec.pins,
      kind: LspSymbolKind.Function,
      range: r,
      selectionRange: r,
    });
  }

  if (doc.declaredFuseChecksum !== undefined) {
    const r = spanToRange(doc.declaredFuseChecksumSpan);
    children.push({
      name: `C${doc.declaredFuseChecksumHex ?? formatHex16(doc.declaredFuseChecksum)}`,
      detail: `computed 0x${formatHex16(doc.computedFuseChecksum)}`,
      kind: LspSymbolKind.Constant,
      range: r,
      selectionRange: r,
    });
  }

  const cstIndex = buildJedecCstIndex(source);
  const fullRange: LspRange = {
    start: { line: 0, character: cstIndex.byRow.get(0)?.startCol ?? 0 },
    end: { line: cstIndex.lastRow, character: cstIndex.lastEndCol },
  };

  return [
    {
      name: doc.deviceName,
      detail: `${extraction.utilization.intactFuses}/${extraction.utilization.totalFuses} intact fuses`,
      kind: LspSymbolKind.Package,
      range: fullRange,
      selectionRange: DEFAULT_RANGE,
      children,
    },
  ];
}

/**
 * Provides Markdown hover documentation for JESD3 field codes and PLD device names.
 */
export function getJedecHover(source: string, position: LspPosition): LspHover | null {
  const cstIndex = buildJedecCstIndex(source);
  const entry = cstIndex.byRow.get(position.line);
  if (!entry) return null;

  const line = entry.text;
  const relChar = position.character - entry.startCol;
  if (relChar < 0 || relChar > line.length) return null;

  // Extract alphanumeric token around cursor
  let start = relChar;
  while (start > 0 && /[A-Za-z0-9]/.test(line.charAt(start - 1))) start--;
  let end = relChar;
  while (end < line.length && /[A-Za-z0-9]/.test(line.charAt(end))) end++;

  const token = line.slice(start, end).toUpperCase();
  if (!token) return null;

  // Match device names first, then 2-letter field codes (QP/QF/QV), then 1-letter field codes
  const exactDoc = JESD3_FIELD_DOCS[token] ?? JESD3_FIELD_DOCS[token.slice(0, 2)] ?? JESD3_FIELD_DOCS[token.charAt(0)];

  if (!exactDoc) return null;

  return {
    contents: {
      kind: "markdown",
      value: exactDoc,
    },
    range: {
      start: { line: position.line, character: entry.startCol + start },
      end: { line: position.line, character: entry.startCol + end },
    },
  };
}

/**
 * Provides JESD3 field & classic PLD template completion items.
 */
export function getJedecCompletions(): LspCompletionItem[] {
  return [
    { label: "QP20*", detail: "20-pin PLD pin count (PAL16L8 / GAL16V8)", insertText: "QP20*" },
    { label: "QP24*", detail: "24-pin PLD pin count (GAL22V10)", insertText: "QP24*" },
    { label: "QF2048*", detail: "2048 fuses (PAL16L8 / PAL16R8)", insertText: "QF2048*" },
    { label: "QF2194*", detail: "2194 fuses (GAL16V8)", insertText: "QF2194*" },
    { label: "QF5892*", detail: "5892 fuses (GAL22V10)", insertText: "QF5892*" },
    { label: "QV", detail: "Maximum test vector count", insertText: "QV16*" },
    { label: "F0*", detail: "Default fuse state: intact (0)", insertText: "F0*" },
    { label: "F1*", detail: "Default fuse state: blown (1)", insertText: "F1*" },
    { label: "G0*", detail: "Security fuse: unblown (readable)", insertText: "G0*" },
    { label: "G1*", detail: "Security fuse: blown (read-protected)", insertText: "G1*" },
    {
      label: "L0000",
      detail: "Fuse data block starting at address",
      insertText: "L0000 00000000000000000000000000000000*",
    },
    { label: "V0001", detail: "Functional test vector", insertText: "V0001 000000000N0XXXXXXXXN*" },
    { label: "C0000*", detail: "16-bit hexadecimal fuse checksum", insertText: "C0000*" },
    { label: "N", detail: "Note / comment field", insertText: "N DEVICE PAL16L8*" },
    { label: "X0*", detail: "Default test condition (0)", insertText: "X0*" },
  ];
}
