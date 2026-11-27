// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/mps — Language Server Protocol (LSP) Providers.
 *
 * Provides diagnostics, document symbols, and hover documentation for IBM MPS decks.
 */

import { getOrLoadLanguageWasmParser } from "@modelscript/dsl";
import { cstLineText, groupAllCstTokensByLine, type CstNodeLike } from "@modelscript/runtime";
import { createWasmParserSync } from "../src-gen/bindings.js";
import { lintMps } from "./lints/index.js";
import { parseMps } from "./parser/mps-parser.js";

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

const MPS_SECTION_DOCS: Record<string, string> = {
  NAME: "**NAME** — Declares the problem identifier at the start of an IBM MPS deck.",
  OBJSENSE: "**OBJSENSE** — Declares optimization direction (`MIN`/`MINIMIZE` or `MAX`/`MAXIMIZE`).",
  ROWS: "**ROWS** — Declares row names and constraint senses (`N` objective/free, `L` `<=`, `G` `>=`, `E` `=`).",
  COLUMNS:
    "**COLUMNS** — Declares sparse constraint matrix entries `A_{ij}` grouped by variable column, plus `'MARKER'` `'INTORG'`/`'INTEND'` integer blocks.",
  RHS: "**RHS** — Declares right-hand side vector values `b_i` for constraint rows.",
  RANGES: "**RANGES** — Declares two-sided range bounds for `L`, `G`, or `E` constraint rows.",
  BOUNDS: "**BOUNDS** — Declares variable bounds (`LO`, `UP`, `FX`, `FR`, `MI`, `PL`, `BV`, `LI`, `UI`).",
  QUADOBJ: "**QUADOBJ** — Declares lower-triangular Hessian entries `Q_{ij}` for quadratic objective `(1/2) x^T Q x`.",
  QMATRIX: "**QMATRIX** — Declares symmetric Hessian entries `Q_{ij}` for quadratic objective `(1/2) x^T Q x`.",
  ENDATA: "**ENDATA** — Terminates the MPS problem deck.",
};

interface MpsCstLine {
  row: number;
  text: string;
  colLine: string;
  startCol: number;
  endCol: number;
}

interface MpsCstIndex {
  byRow: Map<number, MpsCstLine>;
  lastRow: number;
  lastEndCol: number;
}

function buildMpsCstIndex(content: string): MpsCstIndex {
  const byRow = new Map<number, MpsCstLine>();
  let lastRow = 0;
  let lastEndCol = 0;

  let rootNode: CstNodeLike | null = null;
  try {
    rootNode =
      (getOrLoadLanguageWasmParser("mps", import.meta.url, createWasmParserSync).parse(content)?.rootNode as
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
 * Validates an MPS document and returns LSP diagnostics.
 */
export function validateMps(content: string, _uri: string = "problem.mps"): LspDiagnostic[] {
  const model = parseMps(content);
  const diags = lintMps(model);
  const cstIndex = buildMpsCstIndex(content);

  return diags.map((d) => {
    const lineNum = d.line ? Math.max(0, d.line - 1) : 0;
    const entry = cstIndex.byRow.get(lineNum);
    const startChar = d.column ? Math.max(0, d.column - 1) : (entry?.startCol ?? 0);
    const endChar = Math.max(startChar + 1, entry?.endCol ?? startChar + 1);

    return {
      range: {
        start: { line: lineNum, character: startChar },
        end: { line: lineNum, character: endChar },
      },
      severity: d.severity === "error" ? 1 : d.severity === "warning" ? 2 : 3,
      code: d.id,
      source: "modelscript-mps",
      message: d.message,
    };
  });
}

/**
 * Extracts hierarchical LSP document symbols (Problem -> Rows & Columns).
 */
export function getMpsDocumentSymbols(content: string, _uri: string = "problem.mps"): LspDocumentSymbol[] {
  const model = parseMps(content);
  const cstIndex = buildMpsCstIndex(content);

  const mkLineRange = (ln: number): LspRange => {
    const entry = cstIndex.byRow.get(ln);
    return {
      start: { line: ln, character: entry?.startCol ?? 0 },
      end: { line: ln, character: entry?.endCol ?? 0 },
    };
  };

  const rowSymbols: LspDocumentSymbol[] = [];
  for (const row of model.rows.values()) {
    const ln = row.span ? Math.max(0, row.span.line - 1) : 0;
    const range = mkLineRange(ln);
    const senseLabel = row.type === "N" ? "Objective" : row.type === "L" ? "<=" : row.type === "G" ? ">=" : "=";
    rowSymbols.push({
      name: row.name,
      detail: row.type === "N" ? `${senseLabel} (${model.sense})` : `${senseLabel} ${row.rhs}`,
      kind: row.type === "N" ? LspSymbolKind.Function : LspSymbolKind.Property,
      range,
      selectionRange: range,
    });
  }

  const colSymbols: LspDocumentSymbol[] = [];
  for (const col of model.columns.values()) {
    const ln = col.span ? Math.max(0, col.span.line - 1) : 0;
    const range = mkLineRange(ln);
    const lbStr = Number.isFinite(col.lb) ? String(col.lb) : "-inf";
    const ubStr = Number.isFinite(col.ub) ? String(col.ub) : "+inf";
    colSymbols.push({
      name: col.name,
      detail: `${col.varType} [${lbStr}, ${ubStr}]`,
      kind: LspSymbolKind.Variable,
      range,
      selectionRange: range,
    });
  }

  const rootRange: LspRange = {
    start: { line: 0, character: 0 },
    end: { line: cstIndex.lastRow, character: cstIndex.lastEndCol },
  };
  const firstEntry = cstIndex.byRow.get(0);

  return [
    {
      name: model.name,
      detail: `${model.problemClass} (${model.sense}) — ${model.rows.size} rows, ${model.columns.size} cols`,
      kind: LspSymbolKind.Package,
      range: rootRange,
      selectionRange: {
        start: { line: 0, character: firstEntry?.startCol ?? 0 },
        end: { line: 0, character: firstEntry?.endCol ?? 0 },
      },
      children: [...rowSymbols, ...colSymbols],
    },
  ];
}

/**
 * Provides hover information for MPS section headers, row names, and column variables.
 */
export function getMpsHover(content: string, position: LspPosition): LspHover | null {
  const cstIndex = buildMpsCstIndex(content);
  const entry = cstIndex.byRow.get(position.line);
  if (!entry) return null;
  const line = entry.colLine;

  // Extract token under cursor
  let start = position.character;
  let end = position.character;
  while (start > 0 && !/\s/.test(line[start - 1]!)) start--;
  while (end < line.length && !/\s/.test(line[end]!)) end++;
  const token = line.slice(start, end);
  if (!token) return null;

  const range: LspRange = {
    start: { line: position.line, character: start },
    end: { line: position.line, character: end },
  };

  const upper = token.toUpperCase();
  if (MPS_SECTION_DOCS[upper]) {
    return {
      contents: { kind: "markdown", value: MPS_SECTION_DOCS[upper]! },
      range,
    };
  }

  const model = parseMps(content);
  const row = model.rows.get(token);
  if (row) {
    const desc =
      row.type === "N"
        ? `**Objective Row** \`${row.name}\` (${model.sense})`
        : `**Constraint Row** \`${row.name}\` (type \`${row.type}\`, RHS = \`${row.rhs}\`${row.range !== undefined ? `, range = \`${row.range}\`` : ""})`;
    return {
      contents: { kind: "markdown", value: desc },
      range,
    };
  }

  const col = model.columns.get(token);
  if (col) {
    const lbStr = Number.isFinite(col.lb) ? String(col.lb) : "-∞";
    const ubStr = Number.isFinite(col.ub) ? String(col.ub) : "+∞";
    return {
      contents: {
        kind: "markdown",
        value: `**Decision Variable** \`${col.name}\` (${col.varType}, bounds: \`[${lbStr}, ${ubStr}]\`, ${col.entries.length} non-zeros)`,
      },
      range,
    };
  }

  return null;
}
