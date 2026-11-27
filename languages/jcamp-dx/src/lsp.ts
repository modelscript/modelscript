// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Language Server Protocol (LSP) services for `@modelscript/jcamp-dx`:
 * - `validateJcampDx`
 * - `getJcampDxDocumentSymbols`
 * - `getJcampDxHover`
 * - `getJcampDxCompletions`
 */

import { getOrLoadLanguageWasmParser } from "@modelscript/dsl";
import { cstLineText, groupAllCstTokensByLine, type CstNodeLike } from "@modelscript/runtime";
import { createWasmParserSync } from "../src-gen/bindings.js";
import { lintJcampDx } from "./lints/index.js";
import { parseJcampDx } from "./parser/jcamp-parser.js";

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
}

export interface LspDocumentSymbol {
  name: string;
  detail?: string;
  kind: LspSymbolKind;
  range: LspRange;
  selectionRange: LspRange;
  children?: LspDocumentSymbol[];
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
  range?: LspRange;
}

export interface LspCompletionItem {
  label: string;
  detail: string;
  insertText: string;
  documentation?: string;
}

const LDR_DOCS: Record<string, { detail: string; doc: string; insert: string }> = {
  TITLE: {
    detail: "Mandatory Spectrum Title",
    doc: "First Labeled Data Record of every JCAMP-DX block. Identifies the chemical substance or experiment.",
    insert: "##TITLE=",
  },
  "JCAMP-DX": {
    detail: "Mandatory Format Version (4.24 / 5.01 / 6.00)",
    doc: "Specifies the IUPAC JCAMP-DX standard version used to encode this file.",
    insert: "##JCAMP-DX=4.24",
  },
  "DATA TYPE": {
    detail: "Mandatory Spectroscopy Modality",
    doc: "Defines the spectrum modality (`INFRARED SPECTRUM`, `NMR SPECTRUM`, `MASS SPECTRUM`, `UV/VIS SPECTRUM`, `RAMAN SPECTRUM`, or `LINK`).",
    insert: "##DATA TYPE=INFRARED SPECTRUM",
  },
  ORIGIN: {
    detail: "Instrument / Laboratory Origin",
    doc: "Identifies the laboratory, instrument, or software that produced the spectrum.",
    insert: "##ORIGIN=",
  },
  OWNER: {
    detail: "Copyright / Data Owner",
    doc: "Identifies the copyright holder or organization owning the dataset.",
    insert: "##OWNER=PUBLIC DOMAIN",
  },
  XUNITS: {
    detail: "Abscissa Units",
    doc: "Units of the X-axis (e.g. `1/CM`, `PPM`, `M/Z`, `NANOMETERS`, `MICROMETERS`).",
    insert: "##XUNITS=1/CM",
  },
  YUNITS: {
    detail: "Ordinate Units",
    doc: "Units of the Y-axis (e.g. `ABSORBANCE`, `TRANSMITTANCE`, `RELATIVE ABUNDANCE`).",
    insert: "##YUNITS=ABSORBANCE",
  },
  FIRSTX: {
    detail: "First Abscissa Value",
    doc: "Exact X coordinate of the first spectral data point (in scaled XUNITS).",
    insert: "##FIRSTX=",
  },
  LASTX: {
    detail: "Last Abscissa Value",
    doc: "Exact X coordinate of the last spectral data point (in scaled XUNITS).",
    insert: "##LASTX=",
  },
  NPOINTS: {
    detail: "Number of Data Points",
    doc: "Total number of decoded `(X, Y)` points in `##XYDATA=` or `##PEAK TABLE=`.",
    insert: "##NPOINTS=",
  },
  XFACTOR: {
    detail: "Abscissa Scaling Factor",
    doc: "Positive multiplier applied to raw X values in tabular data.",
    insert: "##XFACTOR=1.0",
  },
  YFACTOR: {
    detail: "Ordinate Scaling Factor",
    doc: "Positive multiplier applied to raw Y values in ASDF/AFFN tabular data.",
    insert: "##YFACTOR=1.0",
  },
  XYDATA: {
    detail: "ASDF/AFFN Spectral Data Block",
    doc: "Continuous spectrum encoded as `(X++(Y..Y))` using AFFN, PAC, SQZ, DIF, DUP, or DIFDUP.",
    insert: "##XYDATA=(X++(Y..Y))",
  },
  "PEAK TABLE": {
    detail: "Discrete Peak Table",
    doc: "Discrete `(XY..XY)` peak list (common for Mass Spectra and peak-picked IR/NMR).",
    insert: "##PEAK TABLE=(XY..XY)",
  },
  END: {
    detail: "Mandatory Block Terminator",
    doc: "Marks the end of the current JCAMP-DX data block.",
    insert: "##END=",
  },
};

interface CstLineEntry {
  row: number;
  text: string;
  startCol: number;
  endCol: number;
}

interface JcampDxCstIndex {
  byRow: Map<number, CstLineEntry>;
  lastRow: number;
  lastEndCol: number;
}

function buildJcampDxCstIndex(content: string): JcampDxCstIndex {
  const byRow = new Map<number, CstLineEntry>();
  let rootNode: unknown = null;
  try {
    rootNode =
      getOrLoadLanguageWasmParser("jcamp-dx", import.meta.url, createWasmParserSync).parse(content)?.rootNode ?? null;
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

/**
 * Validates a JCAMP-DX document and returns LSP diagnostics.
 */
export function validateJcampDx(content: string, _uri: string = "spectrum.jdx"): LspDiagnostic[] {
  const diags = lintJcampDx(content);
  const cstIndex = buildJcampDxCstIndex(content);

  return diags.map((d) => {
    const lineIdx = Math.max(0, d.line - 1);
    const entry = cstIndex.byRow.get(lineIdx);
    const startChar = d.column ? Math.max(0, d.column - 1) : (entry?.startCol ?? 0);
    const endChar = Math.max(startChar + 1, entry?.endCol ?? startChar + 1);
    const severity: 1 | 2 | 3 = d.severity === "error" ? 1 : d.severity === "warning" ? 2 : 3;

    return {
      range: {
        start: { line: lineIdx, character: startChar },
        end: { line: lineIdx, character: endChar },
      },
      severity,
      code: d.code,
      source: "jcamp-dx",
      message: d.message,
    };
  });
}

/**
 * Returns hierarchical LSP document symbols for a JCAMP-DX file.
 */
export function getJcampDxDocumentSymbols(content: string): LspDocumentSymbol[] {
  const doc = parseJcampDx(content);
  const cstIndex = buildJcampDxCstIndex(content);

  return doc.blocks.map((block) => {
    const startLine = Math.max(0, block.startLine - 1);
    const endLine = Math.max(startLine, block.endLine - 1);
    const startEntry = cstIndex.byRow.get(startLine);
    const endEntry = cstIndex.byRow.get(endLine);
    const endChar = endEntry?.endCol ?? 0;

    const children: LspDocumentSymbol[] = block.ldrs.map((ldr) => {
      const lStart = Math.max(0, ldr.line - 1);
      const lEnd = Math.max(lStart, ldr.endLine - 1);
      const lsEntry = cstIndex.byRow.get(lStart);
      const leEntry = cstIndex.byRow.get(lEnd);
      const lsCol = lsEntry?.startCol ?? 0;
      const lEndChar = leEntry?.endCol ?? 0;
      return {
        name: `##${ldr.label}`,
        detail: ldr.label === "XYDATA" ? `${block.points.length} pts` : ldr.value.slice(0, 48),
        kind: ldr.label === "XYDATA" || ldr.label === "PEAK TABLE" ? LspSymbolKind.Variable : LspSymbolKind.Property,
        range: {
          start: { line: lStart, character: lsCol },
          end: { line: lEnd, character: lEndChar },
        },
        selectionRange: {
          start: { line: lStart, character: lsCol },
          end: {
            line: lStart,
            character: Math.min(lsEntry?.endCol ?? lsCol + ldr.rawLabel.length + 3, lsCol + ldr.rawLabel.length + 3),
          },
        },
      };
    });

    return {
      name: block.title || "JCAMP-DX Block",
      detail: block.dataType || "SPECTRUM",
      kind: LspSymbolKind.Package,
      range: {
        start: { line: startLine, character: startEntry?.startCol ?? 0 },
        end: { line: endLine, character: endChar },
      },
      selectionRange: {
        start: { line: startLine, character: startEntry?.startCol ?? 0 },
        end: { line: startLine, character: startEntry?.endCol ?? 0 },
      },
      children,
    };
  });
}

/**
 * Provides Markdown hover documentation for JCAMP-DX Labeled Data Records at a cursor position.
 */
export function getJcampDxHover(content: string, position: LspPosition): LspHover | null {
  const cstIndex = buildJcampDxCstIndex(content);
  const entry = cstIndex.byRow.get(position.line);
  if (!entry) return null;

  const trimmed = entry.text.trim();
  if (!trimmed.startsWith("##")) return null;
  const eqIdx = trimmed.indexOf("=");
  if (eqIdx < 0) return null;

  const label = trimmed.slice(2, eqIdx).trim().toUpperCase().replace(/\s+/g, " ");
  const info = LDR_DOCS[label];
  if (!info) return null;

  return {
    contents: {
      kind: "markdown",
      value: `**\`##${label}=\`** — *${info.detail}*\n\n${info.doc}`,
    },
    range: {
      start: { line: position.line, character: entry.startCol },
      end: { line: position.line, character: entry.startCol + eqIdx + 1 },
    },
  };
}

/**
 * Provides JCAMP-DX Labeled Data Record completion items.
 */
export function getJcampDxCompletions(content: string, position: LspPosition): LspCompletionItem[] {
  const cstIndex = buildJcampDxCstIndex(content);
  const entry = cstIndex.byRow.get(position.line);
  const line = entry
    ? entry.text
        .slice(0, Math.max(0, position.character - entry.startCol))
        .trim()
        .toUpperCase()
    : "";
  const prefix = line.startsWith("##") ? line.slice(2) : line;

  const items: LspCompletionItem[] = [];
  for (const [label, info] of Object.entries(LDR_DOCS)) {
    if (!prefix || label.startsWith(prefix)) {
      items.push({
        label: `##${label}=`,
        detail: info.detail,
        insertText: info.insert,
        documentation: info.doc,
      });
    }
  }
  return items;
}
