// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Language Server Protocol (LSP) services for `@modelscript/segy`.
 * Provides diagnostics, document symbols, hover documentation, and completions
 * for SEG-Y Rev 0 / Rev 1 textual reel headers and standard header fields.
 */

import { getOrLoadLanguageWasmParser } from "@modelscript/dsl";
import { cstLineText, groupAllCstTokensByLine, type CstNodeLike } from "@modelscript/runtime";
import { createWasmParserSync } from "../src-gen/bindings.js";
import { getSegySchemasFromLibraries, lookupSegySchema } from "./catalog/library-package-adapter.js";
import { lintSegyTextualHeader } from "./lints/index.js";
import { parseSegyTextualHeader } from "./parser/textual-header.js";

export interface SegyLspPosition {
  line: number;
  character: number;
}

export interface SegyLspRange {
  start: SegyLspPosition;
  end: SegyLspPosition;
}

export enum SegyLspSymbolKind {
  Package = 4,
  Class = 5,
  Property = 7,
  Field = 8,
  Constant = 14,
}

export interface SegyLspDocumentSymbol {
  name: string;
  detail?: string | undefined;
  kind: SegyLspSymbolKind;
  range: SegyLspRange;
  selectionRange: SegyLspRange;
  children?: SegyLspDocumentSymbol[] | undefined;
}

export interface SegyLspDiagnostic {
  range: SegyLspRange;
  severity: 1 | 2 | 3 | 4;
  code: string;
  source: string;
  message: string;
}

export interface SegyLspHover {
  contents: {
    kind: "markdown" | "plaintext";
    value: string;
  };
  range?: SegyLspRange | undefined;
}

export interface SegyLspCompletionItem {
  label: string;
  detail: string;
  documentation: string;
  insertText: string;
}

const KEYWORD_DOCS: Record<string, { title: string; doc: string }> = {
  CLIENT: {
    title: "CLIENT — Survey Client / Operator",
    doc: "Identifies the client organization or operator owning the SEG-Y seismic survey.",
  },
  LINE: {
    title: "LINE — Seismic Line / Survey Identifier",
    doc: "Specifies the 2D seismic line name or 3D survey identifier.",
  },
  AREA: {
    title: "AREA — Geographic Survey Area / Basin",
    doc: "Specifies the geographic region, prospect, or geological basin.",
  },
  "SAMPLE INTERVAL": {
    title: "SAMPLE INTERVAL — Temporal Sampling Interval (Δt)",
    doc: "Recording sample interval in microseconds (µs) or milliseconds (ms); corresponds to binary reel header bytes 3217–3218.",
  },
  "TRACE LENGTH": {
    title: "TRACE LENGTH — Record Length",
    doc: "Total trace recording duration in milliseconds (ms).",
  },
  FORMAT: {
    title: "FORMAT — Sample Data Format Code",
    doc: "Binary sample encoding: 1 = IBM float32, 2 = int32, 3 = int16, 5 = IEEE float32, 8 = int8 (bytes 3225–3226).",
  },
  REV: {
    title: "REV — SEG-Y Format Revision",
    doc: "SEG-Y standard revision number (e.g. Rev 0 (1975) or Rev 1.0 (2002), bytes 3501–3502).",
  },
  "END TEXTUAL HEADER": {
    title: "END TEXTUAL HEADER — Rev 1 Sentinel Card",
    doc: "Mandatory Card 40 terminator for SEG-Y Rev 1 textual reel headers.",
  },
};

interface SegyCstLine {
  row: number;
  text: string;
  colLine: string;
  startCol: number;
  endCol: number;
}

interface SegyCstIndex {
  byRow: Map<number, SegyCstLine>;
  lastRow: number;
  lastEndCol: number;
}

function buildSegyCstIndex(content: string): SegyCstIndex {
  const byRow = new Map<number, SegyCstLine>();
  let lastRow = 0;
  let lastEndCol = 0;

  let rootNode: CstNodeLike | null = null;
  try {
    rootNode =
      (getOrLoadLanguageWasmParser("segy", import.meta.url, createWasmParserSync).parse(content)?.rootNode as
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
      byRow.set(i, { row: i, text: trimmed, colLine: raw, startCol, endCol });
      lastRow = i;
      lastEndCol = endCol;
    }
  }

  return { byRow, lastRow, lastEndCol };
}

/**
 * Validates a SEG-Y textual reel header and returns LSP diagnostics.
 */
export function validateSegy(content: string): SegyLspDiagnostic[] {
  const diags = lintSegyTextualHeader(content);
  const cstIndex = buildSegyCstIndex(content);

  return diags.map((d) => {
    const lineIdx = Math.max(0, (d.line ?? 1) - 1);
    const entry = cstIndex.byRow.get(lineIdx);
    const startChar = d.column !== undefined ? Math.max(0, d.column - 1) : (entry?.startCol ?? 0);
    const endChar = Math.max(startChar + 1, entry?.endCol ?? startChar + 1);
    return {
      range: {
        start: { line: lineIdx, character: startChar },
        end: { line: lineIdx, character: endChar },
      },
      severity: d.severity === "error" ? 1 : d.severity === "warning" ? 2 : 3,
      code: d.code,
      source: "modelscript-segy",
      message: d.message,
    };
  });
}

/**
 * Extracts hierarchical LSP document symbols from a SEG-Y textual reel header.
 */
export function getSegyDocumentSymbols(content: string): SegyLspDocumentSymbol[] {
  const header = parseSegyTextualHeader(content);
  const cstIndex = buildSegyCstIndex(content);

  const children: SegyLspDocumentSymbol[] = [];
  for (const card of header.cards) {
    if (!card.key) continue;
    const lineIdx = Math.max(0, card.line - 1);
    const entry = cstIndex.byRow.get(lineIdx);
    const range: SegyLspRange = {
      start: { line: lineIdx, character: entry?.startCol ?? 0 },
      end: { line: lineIdx, character: entry?.endCol ?? card.raw.length },
    };
    children.push({
      name: card.key,
      detail: card.value || `C${card.cardNumber}`,
      kind: card.key === "END TEXTUAL HEADER" ? SegyLspSymbolKind.Constant : SegyLspSymbolKind.Field,
      range,
      selectionRange: range,
    });
  }

  const rootRange: SegyLspRange = {
    start: { line: 0, character: 0 },
    end: { line: cstIndex.lastRow, character: cstIndex.lastEndCol },
  };
  const firstEntry = cstIndex.byRow.get(0);

  return [
    {
      name: header.line ?? header.client ?? "SEG-Y Textual Header",
      detail: header.revision ? `SEG-Y Rev ${header.revision}` : "SEG-Y Reel Header",
      kind: SegyLspSymbolKind.Package,
      range: rootRange,
      selectionRange: {
        start: { line: 0, character: firstEntry?.startCol ?? 0 },
        end: { line: 0, character: firstEntry?.endCol ?? 0 },
      },
      children,
    },
  ];
}

/**
 * Returns hover documentation for a position inside a SEG-Y textual reel header.
 */
export function getSegyHover(content: string, position: SegyLspPosition): SegyLspHover | null {
  const cstIndex = buildSegyCstIndex(content);
  const entry = cstIndex.byRow.get(position.line);
  if (!entry) return null;
  const lineText = entry.colLine;

  // 1. Check multi-word standard keywords on this line
  const upperLine = lineText.toUpperCase();
  for (const [kw, info] of Object.entries(KEYWORD_DOCS)) {
    const idx = upperLine.indexOf(kw);
    if (idx >= 0 && position.character >= idx && position.character <= idx + kw.length) {
      return {
        contents: {
          kind: "markdown",
          value: `**${info.title}**\n\n${info.doc}`,
        },
        range: {
          start: { line: position.line, character: idx },
          end: { line: position.line, character: idx + kw.length },
        },
      };
    }
  }

  // 2. Check word under cursor against cleanroom stdlib schemas
  const before = lineText.slice(0, position.character);
  const after = lineText.slice(position.character);
  const startMatch = /[A-Za-z0-9_]+$/.exec(before);
  const endMatch = /^[A-Za-z0-9_]+/.exec(after);
  const word = `${startMatch ? startMatch[0] : ""}${endMatch ? endMatch[0] : ""}`;
  if (word) {
    const schema = lookupSegySchema(word);
    if (schema) {
      const startCol = position.character - (startMatch ? startMatch[0].length : 0);
      return {
        contents: {
          kind: "markdown",
          value: `**${schema.label}** (\`${schema.namePath}\`)\n\n${schema.description}\n\n*Provenance:* ${schema.provenance}`,
        },
        range: {
          start: { line: position.line, character: startCol },
          end: { line: position.line, character: startCol + word.length },
        },
      };
    }
  }

  return null;
}

/**
 * Returns completion items for SEG-Y textual header cards and standard library schemas.
 */
export function getSegyCompletions(): SegyLspCompletionItem[] {
  const items: SegyLspCompletionItem[] = Object.entries(KEYWORD_DOCS).map(([kw, info]) => ({
    label: kw,
    detail: info.title,
    documentation: info.doc,
    insertText: kw === "END TEXTUAL HEADER" ? "C40 END TEXTUAL HEADER" : `${kw}: `,
  }));

  for (const schema of getSegySchemasFromLibraries()) {
    items.push({
      label: schema.name,
      detail: `${schema.category} — ${schema.label}`,
      documentation: schema.description,
      insertText: schema.name,
    });
  }

  return items;
}
