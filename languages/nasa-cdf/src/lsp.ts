// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/nasa-cdf — Language Server Protocol (LSP) Service Integration.
 *
 * Provides diagnostics (`validateNasaCdf`), outline symbols (`getNasaCdfDocumentSymbols`),
 * hover documentation (`getNasaCdfHover`), and completions (`getNasaCdfCompletions`).
 */

import { getOrLoadLanguageWasmParser } from "@modelscript/dsl";
import { cstLineText, groupAllCstTokensByLine, type CstNodeLike } from "@modelscript/runtime";
import { createWasmParserSync } from "../src-gen/bindings.js";
import { getNasaCdfSchemasFromLibraries, lookupNasaCdfSchema } from "./catalog/library-package-adapter.js";
import { lintNasaCdf } from "./lints/index.js";
import { parseCdfSkeleton } from "./parser/skt-parser.js";
import { CDF_DATA_TYPES, type CdfDocument } from "./types.js";

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

const KEYWORD_DOCS: Record<string, string> = {
  "#header": "**#header**: Mandatory opening section declaring CDF file name, encoding, majority, format, and version.",
  "#GLOBALattributes":
    "**#GLOBALattributes**: Section declaring file-level (global) CDF attributes (e.g. `Project`, `Source_name`, `Discipline`).",
  "#VARIABLEattributes":
    "**#VARIABLEattributes**: Section declaring variable-scope attribute names (e.g. `DEPEND_0`, `UNITS`, `VALIDMIN`, `VALIDMAX`, `FILLVAL`).",
  "#variables":
    "**#variables**: Section declaring CDF variables, their data types, dimensions, attributes, and record values.",
  "#zVariables": "**#zVariables**: Section declaring CDF zVariables with independent dimensionality.",
  "#end": "**#end**: Mandatory terminator marking the end of a NASA CDF Skeleton Table.",
  ROW_MAJOR: "**ROW_MAJOR**: C-style array storage majority where the last dimension varies fastest.",
  COLUMN_MAJOR: "**COLUMN_MAJOR**: Fortran-style array storage majority where the first dimension varies fastest.",
  CDF_REAL4: "**CDF_REAL4** (code `21`): 32-bit IEEE-754 single-precision floating point.",
  CDF_REAL8: "**CDF_REAL8** (code `22`): 64-bit IEEE-754 double-precision floating point.",
  CDF_INT4: "**CDF_INT4** (code `4`): 32-bit signed two's-complement integer.",
  CDF_CHAR: "**CDF_CHAR** (code `51`): 1-byte signed ASCII/UTF-8 character.",
  CDF_EPOCH: "**CDF_EPOCH** (code `31`): IEEE-754 float64 milliseconds since `0000-01-01T00:00:00.000Z`.",
  CDF_TIME_TT2000:
    "**CDF_TIME_TT2000** (code `33`): 64-bit signed integer nanoseconds since J2000.0 TT (incorporating UTC leap seconds).",
};

interface NasaCdfCstLine {
  row: number;
  text: string;
  colLine: string;
  startCol: number;
  endCol: number;
}

interface NasaCdfCstIndex {
  byRow: Map<number, NasaCdfCstLine>;
}

function buildNasaCdfCstIndex(content: string): NasaCdfCstIndex {
  const byRow = new Map<number, NasaCdfCstLine>();

  let rootNode: CstNodeLike | null = null;
  try {
    rootNode =
      (getOrLoadLanguageWasmParser("nasa-cdf", import.meta.url, createWasmParserSync).parse(content)?.rootNode as
        CstNodeLike | undefined) ?? null;
  } catch {
    rootNode = null;
  }

  if (rootNode) {
    for (const { row, tokens } of groupAllCstTokensByLine(rootNode)) {
      const lineText = cstLineText(content, tokens);
      const first = tokens[0] as (CstNodeLike & { endPosition?: { column: number } }) | undefined;
      const last = tokens[tokens.length - 1] as (CstNodeLike & { endPosition?: { column: number } }) | undefined;
      const startCol = first?.startPosition?.column ?? 0;
      const endCol = last?.endPosition?.column ?? startCol + lineText.length;
      const colLine = startCol > 0 ? " ".repeat(startCol) + lineText : lineText;
      byRow.set(row, { row, text: lineText, colLine, startCol, endCol });
    }
  } else {
    const rawLines = content.split(/\r?\n/);
    for (let i = 0; i < rawLines.length; i++) {
      const raw = rawLines[i] ?? "";
      const trimmed = raw.trim();
      if (!trimmed) continue;
      const startCol = Math.max(0, raw.search(/\S/));
      const endCol = startCol + trimmed.length;
      byRow.set(i, { row: i, text: trimmed, colLine: raw, startCol, endCol });
    }
  }

  return { byRow };
}

/**
 * Validates NASA CDF Skeleton Table text and returns LSP diagnostics.
 */
export function validateNasaCdf(content: string, uri?: string): LspDiagnostic[] {
  let doc: CdfDocument;
  try {
    doc = parseCdfSkeleton(content, uri);
  } catch (err: unknown) {
    return [
      {
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
        severity: 1,
        code: "NCDF1001",
        source: "nasa-cdf-parser",
        message: `Parse error: ${err instanceof Error ? err.message : String(err)}`,
      },
    ];
  }

  const cstIndex = buildNasaCdfCstIndex(content);
  return lintNasaCdf(doc).map((d) => {
    const lineIdx = Math.max(0, d.line - 1);
    const entry = cstIndex.byRow.get(lineIdx);
    const startChar = Math.max(0, d.column - 1);
    const endChar = Math.max(startChar + 1, entry?.endCol ?? d.column + 16);
    return {
      range: {
        start: { line: lineIdx, character: startChar },
        end: { line: lineIdx, character: endChar },
      },
      severity: d.severity === "error" ? 1 : d.severity === "warning" ? 2 : 3,
      code: d.code,
      source: "nasa-cdf",
      message: d.message,
    };
  });
}

/**
 * Builds an LSP document symbol outline for a NASA CDF Skeleton Table.
 */
export function getNasaCdfDocumentSymbols(content: string, uri?: string): LspDocumentSymbol[] {
  const doc = parseCdfSkeleton(content, uri);
  const cstIndex = buildNasaCdfCstIndex(content);
  const symbols: LspDocumentSymbol[] = [];

  const mkRange = (line: number): LspRange => {
    const l = Math.max(0, line - 1);
    const entry = cstIndex.byRow.get(l);
    return {
      start: { line: l, character: entry?.startCol ?? 0 },
      end: { line: l, character: entry?.endCol ?? 1 },
    };
  };

  if (doc.hasHeaderSection) {
    const r = mkRange(doc.header.line);
    symbols.push({
      name: doc.header.fileName,
      detail: `CDF ${doc.formatVersion} (${doc.header.majority})`,
      kind: LspSymbolKind.File,
      range: r,
      selectionRange: r,
    });
  }

  if (doc.globalAttributes.length > 0) {
    const firstLine = doc.globalAttributes[0]!.line;
    const r = mkRange(firstLine);
    symbols.push({
      name: "#GLOBALattributes",
      detail: `${doc.globalAttributes.length} attributes`,
      kind: LspSymbolKind.Namespace,
      range: r,
      selectionRange: r,
      children: doc.globalAttributes.map((a) => {
        const ar = mkRange(a.line);
        return {
          name: a.name,
          detail: a.entries[0]?.values.join(", "),
          kind: LspSymbolKind.Property,
          range: ar,
          selectionRange: ar,
        };
      }),
    });
  }

  if (doc.variables.length > 0) {
    const firstLine = doc.variables[0]!.line;
    const r = mkRange(firstLine);
    symbols.push({
      name: "#variables",
      detail: `${doc.variables.length} variables`,
      kind: LspSymbolKind.Module,
      range: r,
      selectionRange: r,
      children: doc.variables.map((v) => {
        const vr = mkRange(v.line);
        const units = v.attributes["UNITS"]?.values[0];
        return {
          name: v.name,
          detail: `${v.dataType} ${v.numDims}:[${v.dimSizes.join(",")}]${units ? ` (${units})` : ""}`,
          kind: LspSymbolKind.Variable,
          range: vr,
          selectionRange: vr,
        };
      }),
    });
  }

  return symbols;
}

/**
 * Returns Markdown hover documentation for the NASA CDF keyword, data type, or ISTP attribute at `position`.
 */
export function getNasaCdfHover(content: string, position: LspPosition): LspHover | null {
  const cstIndex = buildNasaCdfCstIndex(content);
  const entry = cstIndex.byRow.get(position.line);
  if (!entry) return null;
  const lineText = entry.colLine;

  let start = position.character;
  let end = position.character;
  while (start > 0 && /[#A-Za-z0-9_]/.test(lineText[start - 1]!)) start--;
  while (end < lineText.length && /[#A-Za-z0-9_]/.test(lineText[end]!)) end++;
  const word = lineText.slice(start, end);
  if (!word) return null;

  const range: LspRange = {
    start: { line: position.line, character: start },
    end: { line: position.line, character: end },
  };

  if (KEYWORD_DOCS[word]) {
    return {
      contents: { kind: "markdown", value: KEYWORD_DOCS[word]! },
      range,
    };
  }

  const schema = lookupNasaCdfSchema(word);
  if (schema) {
    return {
      contents: {
        kind: "markdown",
        value: `**${schema.label}** (${schema.category})\n\n${schema.description}\n\n*Source: ${schema.provenance}*`,
      },
      range,
    };
  }

  return null;
}

/**
 * Returns LSP completion items for NASA CDF sections, data types, majority keywords, and ISTP standard attributes.
 */
export function getNasaCdfCompletions(): LspCompletionItem[] {
  const items: LspCompletionItem[] = [
    { label: "#header", detail: "CDF Section", documentation: KEYWORD_DOCS["#header"] },
    { label: "#GLOBALattributes", detail: "CDF Section", documentation: KEYWORD_DOCS["#GLOBALattributes"] },
    { label: "#VARIABLEattributes", detail: "CDF Section", documentation: KEYWORD_DOCS["#VARIABLEattributes"] },
    { label: "#variables", detail: "CDF Section", documentation: KEYWORD_DOCS["#variables"] },
    { label: "#end", detail: "CDF Section", documentation: KEYWORD_DOCS["#end"] },
    { label: "ROW_MAJOR", detail: "CDF Majority", documentation: KEYWORD_DOCS["ROW_MAJOR"] },
    { label: "COLUMN_MAJOR", detail: "CDF Majority", documentation: KEYWORD_DOCS["COLUMN_MAJOR"] },
  ];

  for (const dt of CDF_DATA_TYPES) {
    items.push({
      label: dt,
      detail: "CDF Data Type",
      documentation: KEYWORD_DOCS[dt] ?? `NASA CDF data type ${dt}.`,
    });
  }

  for (const schema of getNasaCdfSchemasFromLibraries()) {
    items.push({
      label: schema.name,
      detail: `ISTP ${schema.category}`,
      documentation: schema.description,
    });
  }

  return items;
}
