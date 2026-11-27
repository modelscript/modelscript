// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/grib — Language Server Protocol (LSP) Service Integration.
 *
 * Provides diagnostics (`validateGrib`), outline symbols (`getGribDocumentSymbols`),
 * keyword/parameter hover documentation (`getGribHover`), and completions (`getGribCompletions`).
 */

import { getOrLoadLanguageWasmParser } from "@modelscript/dsl";
import { cstLineText, groupAllCstTokensByLine, type CstNodeLike } from "@modelscript/runtime";
import { createWasmParserSync } from "../src-gen/bindings.js";
import { getGribSchemasFromLibraries, lookupGribSchema } from "./catalog/library-package-adapter.js";
import { lintGribDocument } from "./lints/index.js";
import { parseGribDescriptor } from "./parser/text-parser.js";
import type { GribDocument } from "./types.js";

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
  Property = 7,
  Field = 8,
  Variable = 13,
  Constant = 14,
  String = 15,
  Number = 16,
  Boolean = 17,
  Key = 20,
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
  code: string | number;
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
  detail?: string | undefined;
  documentation?: string | undefined;
  insertText?: string | undefined;
}

const SECTION_DOCS: Record<string, string> = {
  GRIB: "**GRIB** (Section 0): Indicator Section opening a WMO GRIB Edition 1 message (`edition = 1`).",
  IS: "**IS** (Indicator Section): 8-octet header containing `'GRIB'`, 3-byte total length, and edition number (`1`).",
  PDS: "**PDS** (Product Definition Section, Section 1): Originating center, WMO Table 2 parameter, Table 3 level, reference time, and decimal scale factor `D`.",
  GDS: "**GDS** (Grid Definition Section, Section 2): Geographic grid geometry (`ni`, `nj`, `la1`, `lo1`, `la2`, `lo2`, `di`, `dj`).",
  BMS: "**BMS** (Bit-Map Section, Section 3): Optional MSB-first presence mask (`1` = data present, `0` = missing).",
  BDS: "**BDS** (Binary Data Section, Section 4): Binary scale factor `E`, IBM System/360 32-bit float reference value `R`, `bitsPerValue`, and gridded `values`.",
  "7777": "**7777** (End Section, Section 5): Mandatory 4-octet trailer terminating every WMO GRIB Edition 1 message.",
};

interface CstLineEntry {
  row: number;
  text: string;
  startCol: number;
  endCol: number;
}

interface GribCstIndex {
  byRow: Map<number, CstLineEntry>;
  lastRow: number;
  lastEndCol: number;
}

function buildGribCstIndex(content: string): GribCstIndex {
  const byRow = new Map<number, CstLineEntry>();
  let rootNode: unknown = null;
  try {
    rootNode =
      getOrLoadLanguageWasmParser("grib", import.meta.url, createWasmParserSync).parse(content)?.rootNode ?? null;
  } catch {
    rootNode = null;
  }

  let lastRow = 0;
  let lastEndCol = 0;
  if (rootNode) {
    for (const { row, tokens } of groupAllCstTokensByLine(rootNode as CstNodeLike)) {
      const lineText = cstLineText(content, tokens);
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
    const rawLines = content.split(/\r?\n/);
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

function gribLineRange(cstIndex: GribCstIndex, lineZeroBased: number, fallbackLen = 3): LspRange {
  const safeLine = Math.max(0, lineZeroBased);
  const entry = cstIndex.byRow.get(safeLine);
  const startChar = entry?.startCol ?? 0;
  const endChar = entry ? entry.endCol : fallbackLen;
  return {
    start: { line: safeLine, character: startChar },
    end: { line: safeLine, character: endChar },
  };
}

/**
 * Validates textual GRIB1 descriptor content and returns LSP diagnostics.
 */
export function validateGrib(content: string, uri?: string): LspDiagnostic[] {
  let doc: GribDocument;
  try {
    doc = parseGribDescriptor(content, uri);
  } catch (err: unknown) {
    return [
      {
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
        severity: 1,
        code: "GRIB1001",
        source: "grib-parser",
        message: `Parse error: ${err instanceof Error ? err.message : String(err)}`,
      },
    ];
  }

  const cstIndex = buildGribCstIndex(content);
  return lintGribDocument(doc).map((d) => {
    const startLine = Math.max(0, d.line - 1);
    const endLine = Math.max(startLine, d.endLine - 1);
    const startEntry = cstIndex.byRow.get(startLine);
    const endEntry = cstIndex.byRow.get(endLine);
    const startChar = d.column > 1 ? d.column - 1 : (startEntry?.startCol ?? 0);
    const endChar = d.endColumn > 1 ? d.endColumn - 1 : Math.max(startChar + 1, endEntry?.endCol ?? startChar + 1);
    return {
      range: {
        start: { line: startLine, character: startChar },
        end: { line: endLine, character: endChar },
      },
      severity: d.severity === "error" ? 1 : d.severity === "warning" ? 2 : 3,
      code: d.code,
      source: "grib-linter",
      message: d.message,
    };
  });
}

/**
 * Builds hierarchical LSP document symbols for GRIB1 messages and their sections (IS, PDS, GDS, BMS, BDS).
 */
export function getGribDocumentSymbols(content: string, uri?: string): LspDocumentSymbol[] {
  const doc = parseGribDescriptor(content, uri);
  const cstIndex = buildGribCstIndex(content);
  const symbols: LspDocumentSymbol[] = [];

  for (const msg of doc.messages) {
    const startLine = Math.max(0, (msg.span?.startLine ?? 1) - 1);
    const endLine = Math.max(startLine, (msg.span?.endLine ?? startLine + 1) - 1);
    const startEntry = cstIndex.byRow.get(startLine);
    const endEntry = cstIndex.byRow.get(endLine);
    const range: LspRange = {
      start: { line: startLine, character: startEntry?.startCol ?? 0 },
      end: { line: endLine, character: endEntry?.endCol ?? 0 },
    };

    const children: LspDocumentSymbol[] = [];

    if (msg.pds) {
      const pLine = Math.max(0, (msg.pds.span?.startLine ?? startLine + 1) - 1);
      const pRange = gribLineRange(cstIndex, pLine, 3);
      children.push({
        name: "PDS",
        detail: `${msg.pds.parameterName ?? msg.pds.parameterCode} @ ${msg.pds.levelValue} ${msg.pds.levelName ?? msg.pds.levelType}`,
        kind: LspSymbolKind.Struct,
        range: pRange,
        selectionRange: pRange,
      });
    }

    if (msg.gds) {
      const gLine = Math.max(0, (msg.gds.span?.startLine ?? startLine + 1) - 1);
      const gRange = gribLineRange(cstIndex, gLine, 3);
      children.push({
        name: "GDS",
        detail: `${msg.gds.ni}x${msg.gds.nj} (${msg.gds.la1}..${msg.gds.la2}, ${msg.gds.lo1}..${msg.gds.lo2})`,
        kind: LspSymbolKind.Struct,
        range: gRange,
        selectionRange: gRange,
      });
    }

    if (msg.bms) {
      const mLine = Math.max(0, (msg.bms.span?.startLine ?? startLine + 1) - 1);
      const mRange = gribLineRange(cstIndex, mLine, 3);
      children.push({
        name: "BMS",
        detail: `${msg.bms.bitmap.length} bits`,
        kind: LspSymbolKind.Field,
        range: mRange,
        selectionRange: mRange,
      });
    }

    if (msg.bds) {
      const bLine = Math.max(0, (msg.bds.span?.startLine ?? startLine + 1) - 1);
      const bRange = gribLineRange(cstIndex, bLine, 3);
      children.push({
        name: "BDS",
        detail: `${msg.bds.values.length} values (${msg.bds.bitsPerValue} bits/val)`,
        kind: LspSymbolKind.Variable,
        range: bRange,
        selectionRange: bRange,
      });
    }

    symbols.push({
      name: `GRIB #${msg.index} (${msg.pds?.parameterName ?? `P${msg.pds?.parameterCode ?? "?"}`})`,
      detail: `Edition ${msg.indicator.edition}`,
      kind: LspSymbolKind.Module,
      range,
      selectionRange: gribLineRange(cstIndex, startLine, 4),
      children,
    });
  }

  return symbols;
}

/**
 * Provides markdown hover documentation for GRIB1 sections, WMO Table 2 parameters, and Table 3 levels.
 */
export function getGribHover(content: string, position: LspPosition): LspHover | null {
  const cstIndex = buildGribCstIndex(content);
  const entry = cstIndex.byRow.get(position.line);
  if (!entry) return null;

  const line = entry.text;
  const relChar = position.character - entry.startCol;
  if (relChar < 0 || relChar > line.length) return null;

  let start = relChar;
  let end = relChar;
  while (start > 0 && /[A-Za-z0-9_]/.test(line[start - 1]!)) start--;
  while (end < line.length && /[A-Za-z0-9_]/.test(line[end]!)) end++;

  const token = line.slice(start, end).trim();
  if (!token) return null;

  const upper = token.toUpperCase();
  const range: LspRange = {
    start: { line: position.line, character: entry.startCol + start },
    end: { line: position.line, character: entry.startCol + end },
  };

  if (SECTION_DOCS[upper]) {
    return {
      contents: { kind: "markdown", value: SECTION_DOCS[upper]! },
      range,
    };
  }

  const schema = lookupGribSchema(token);
  if (schema) {
    const unit = typeof schema.extra?.["unit"] === "string" ? ` (${schema.extra["unit"]})` : "";
    return {
      contents: {
        kind: "markdown",
        value: `**${schema.label}**${unit}\n\n${schema.description}\n\n*Provenance:* ${schema.provenance}`,
      },
      range,
    };
  }

  return null;
}

/**
 * Provides section, attribute, WMO Table 2 parameter, and Table 3 level completions.
 */
export function getGribCompletions(prefix = ""): LspCompletionItem[] {
  const needle = prefix.trim().toLowerCase();
  const items: LspCompletionItem[] = [];

  for (const [sec, doc] of Object.entries(SECTION_DOCS)) {
    items.push({
      label: sec,
      detail: "GRIB1 Section",
      documentation: doc,
      insertText: sec === "GRIB" || sec === "7777" ? sec : `${sec} {\n  \n}`,
    });
  }

  for (const schema of getGribSchemasFromLibraries()) {
    items.push({
      label: schema.name,
      detail: `${schema.category} — ${schema.label}`,
      documentation: schema.description,
      insertText: schema.name,
    });
  }

  if (!needle) return items;
  return items.filter(
    (it) => it.label.toLowerCase().includes(needle) || (it.detail?.toLowerCase().includes(needle) ?? false),
  );
}
