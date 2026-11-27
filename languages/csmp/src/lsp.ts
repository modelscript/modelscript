// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Language Server Protocol (LSP) services for IBM CSMP/360 & SCi CSSL-67.
 *
 * Provides diagnostics, document symbols, hover documentation, and completions
 * backed by the cleanroom `@modelscript/csmp-std-lib` block catalog.
 */

import { getOrLoadLanguageWasmParser } from "@modelscript/dsl";
import { cstLineText, groupAllCstTokensByLine, type CstNodeLike } from "@modelscript/runtime";
import { createWasmParserSync } from "../src-gen/bindings.js";
import { getCsmpSchemasFromLibraries, lookupCsmpBlockSchema } from "./catalog/library-package-adapter.js";
import { lintCsmp, VALID_CSMP_METHODS } from "./lints/index.js";
import { parseCsmpDeck } from "./parser/deck-parser.js";

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

export interface LspCompletionItem {
  label: string;
  kind: number; // 3 = Function, 6 = Variable, 14 = Keyword, 21 = Constant
  detail?: string | undefined;
  documentation?: string | undefined;
  insertText?: string | undefined;
}

const CSMP_KEYWORDS: Array<{ keyword: string; detail: string; doc: string }> = [
  { keyword: "TITLE", detail: "Deck title directive", doc: "Declares the simulation title card." },
  { keyword: "INITIAL", detail: "Section header", doc: "Initial-condition computation section executed at t = 0." },
  { keyword: "DYNAMIC", detail: "Section header", doc: "Continuous-time dynamic equations section." },
  { keyword: "TERMINAL", detail: "Section header", doc: "Post-simulation computation section executed at t = FINTIM." },
  { keyword: "SORT", detail: "Sorting directive", doc: "Enables automatic topological sorting of equations." },
  { keyword: "NOSORT", detail: "Sorting directive", doc: "Disables automatic sorting for procedural blocks." },
  { keyword: "PARAM", detail: "Parameter declaration", doc: "Declares simulation parameters (alias: PARAMETER)." },
  {
    keyword: "CONST",
    detail: "Constant declaration",
    doc: "Declares physical/mathematical constants (alias: CONSTANT).",
  },
  { keyword: "INCON", detail: "Initial condition", doc: "Declares integrator initial conditions." },
  { keyword: "FIXED", detail: "Integer variables", doc: "Declares fixed-point (integer) variables." },
  { keyword: "FUNCTION", detail: "Lookup table", doc: "Declares piecewise (x, y) breakpoint table for AFGEN/NLFGEN." },
  { keyword: "MACRO", detail: "Macro block start", doc: "Begins a reusable macro definition (closed by ENDMAC)." },
  { keyword: "ENDMAC", detail: "Macro block end", doc: "Closes a MACRO definition." },
  { keyword: "PROCEDURE", detail: "Procedure block start", doc: "Begins a procedural block (closed by ENDPRO)." },
  { keyword: "ENDPRO", detail: "Procedure block end", doc: "Closes a PROCEDURE block." },
  { keyword: "TIMER", detail: "Simulation timer", doc: "Sets FINTIM, DELT, PRDEL, OUTDEL, DELMIN, DELMAX." },
  {
    keyword: "METHOD",
    detail: "Integration method",
    doc: "Selects ODE integrator (RKS, RKSFX, MILNE, ADAMS, TRAPZ, RECT).",
  },
  { keyword: "PRINT", detail: "Tabular output", doc: "Selects variables for tabular printout." },
  { keyword: "PRTPLT", detail: "Printer-plot output", doc: "Selects variables for line-printer plotting." },
  { keyword: "END", detail: "End of run", doc: "Terminates a CSMP simulation run." },
  { keyword: "STOP", detail: "End of job", doc: "Terminates the CSMP job." },
];

interface CsmpCstLineEntry {
  row: number;
  text: string;
  startCol: number;
  endCol: number;
}

interface CsmpCstLineIndex {
  byRow: Map<number, CsmpCstLineEntry>;
  lastRow: number;
  lastCol: number;
}

function buildCsmpCstLineIndex(content: string): CsmpCstLineIndex {
  let rootNode: unknown = null;
  try {
    rootNode =
      getOrLoadLanguageWasmParser("csmp", import.meta.url, createWasmParserSync).parse(content)?.rootNode ?? null;
  } catch {
    rootNode = null;
  }

  const byRow = new Map<number, CsmpCstLineEntry>();
  if (rootNode) {
    let maxRow = 0;
    let maxCol = 0;
    for (const { row, tokens } of groupAllCstTokensByLine(rootNode as CstNodeLike)) {
      const text = cstLineText(content, tokens);
      const first = tokens[0] as (CstNodeLike & { endPosition?: { column: number } }) | undefined;
      const last = tokens[tokens.length - 1] as (CstNodeLike & { endPosition?: { column: number } }) | undefined;
      const startCol = first?.startPosition?.column ?? 0;
      const endCol = last?.endPosition?.column ?? startCol + text.length;
      byRow.set(row, { row, text, startCol, endCol });
      if (row >= maxRow) {
        maxRow = row;
        maxCol = endCol;
      }
    }
    const rootEnd = (rootNode as { endPosition?: { row?: number; column?: number } }).endPosition;
    const lastRow = Math.max(maxRow, rootEnd?.row ?? 0);
    const lastCol = lastRow === maxRow ? maxCol : (rootEnd?.column ?? 0);
    return { byRow, lastRow, lastCol };
  }

  const rawLines = content.split(/\r?\n/);
  for (let i = 0; i < rawLines.length; i++) {
    const raw = rawLines[i] ?? "";
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const startCol = Math.max(0, raw.search(/\S/));
    byRow.set(i, { row: i, text: trimmed, startCol, endCol: startCol + trimmed.length });
  }
  const lastRow = Math.max(0, rawLines.length - 1);
  return { byRow, lastRow, lastCol: (rawLines[lastRow] ?? "").length };
}

function lineRange(lineNum: number, cstIndex: CsmpCstLineIndex): LspRange {
  const zeroLine = Math.max(0, lineNum - 1);
  const entry = cstIndex.byRow.get(zeroLine);
  return {
    start: { line: zeroLine, character: entry?.startCol ?? 0 },
    end: { line: zeroLine, character: Math.max((entry?.startCol ?? 0) + 1, entry?.endCol ?? 1) },
  };
}

function wordAtPosition(content: string, position: LspPosition): { word: string; range: LspRange } | null {
  const cstIndex = buildCsmpCstLineIndex(content);
  const entry = cstIndex.byRow.get(position.line);
  if (!entry) return null;
  const lineText = " ".repeat(entry.startCol) + entry.text;

  const isIdent = (ch: string): boolean => /[A-Za-z0-9_]/.test(ch);
  let start = Math.min(position.character, lineText.length);
  while (start > 0 && isIdent(lineText[start - 1]!)) start--;
  let end = Math.min(position.character, lineText.length);
  while (end < lineText.length && isIdent(lineText[end]!)) end++;

  if (end <= start) return null;
  return {
    word: lineText.slice(start, end),
    range: {
      start: { line: position.line, character: start },
      end: { line: position.line, character: end },
    },
  };
}

/**
 * Validates a CSMP/360 or CSSL-67 deck and returns LSP diagnostics.
 */
export function validateCsmp(content: string, _uri: string = "model.csmp"): LspDiagnostic[] {
  const program = parseCsmpDeck(content);
  const diags = lintCsmp(program);
  const cstIndex = buildCsmpCstLineIndex(content);

  return diags.map((d) => {
    const zeroLine = Math.max(0, d.line - 1);
    const lineEnd = cstIndex.byRow.get(zeroLine)?.endCol ?? 0;
    const startChar = Math.max(0, d.column - 1);
    const endChar = Math.max(startChar + 1, lineEnd);

    return {
      range: {
        start: { line: zeroLine, character: startChar },
        end: { line: zeroLine, character: endChar },
      },
      severity: d.severity === "error" ? 1 : d.severity === "warning" ? 2 : 3,
      code: d.id,
      source: "modelscript-csmp",
      message: d.message,
    };
  });
}

/**
 * Extracts hierarchical LSP document symbols for a CSMP/360 or CSSL-67 deck.
 */
export function getCsmpDocumentSymbols(content: string, _uri: string = "model.csmp"): LspDocumentSymbol[] {
  const program = parseCsmpDeck(content);
  const cstIndex = buildCsmpCstLineIndex(content);
  const children: LspDocumentSymbol[] = [];

  for (const [name, decl] of program.parameters) {
    const r = lineRange(decl.span.line, cstIndex);
    children.push({
      name,
      detail: `PARAM = ${decl.value}`,
      kind: LspSymbolKind.Variable,
      range: r,
      selectionRange: r,
    });
  }

  for (const [name, decl] of program.constants) {
    const r = lineRange(decl.span.line, cstIndex);
    children.push({
      name,
      detail: `CONST = ${decl.value}`,
      kind: LspSymbolKind.Constant,
      range: r,
      selectionRange: r,
    });
  }

  for (const [name, decl] of program.incons) {
    const r = lineRange(decl.span.line, cstIndex);
    children.push({
      name,
      detail: `INCON = ${decl.value}`,
      kind: LspSymbolKind.Variable,
      range: r,
      selectionRange: r,
    });
  }

  for (const [name, tbl] of program.functionTables) {
    const r = lineRange(tbl.span.line, cstIndex);
    children.push({
      name,
      detail: `FUNCTION (${tbl.points.length} pts)`,
      kind: LspSymbolKind.Function,
      range: r,
      selectionRange: r,
    });
  }

  for (const [name, macro] of program.macros) {
    const r = lineRange(macro.span.line, cstIndex);
    children.push({
      name,
      detail: `MACRO (${macro.inputs.join(", ")}) -> (${macro.outputs.join(", ")})`,
      kind: LspSymbolKind.Class,
      range: r,
      selectionRange: r,
    });
  }

  for (const stmt of program.dynamicStatements) {
    const r = lineRange(stmt.span.line, cstIndex);
    const isState = stmt.expr.kind === "call" && stmt.expr.callee === "INTGRL";
    children.push({
      name: stmt.target,
      detail: isState ? `State (INTGRL)` : `Dynamic = ${stmt.rawExpr}`,
      kind: isState ? LspSymbolKind.Property : LspSymbolKind.Field,
      range: r,
      selectionRange: r,
    });
  }

  const fullRange: LspRange = {
    start: { line: 0, character: 0 },
    end: { line: cstIndex.lastRow, character: cstIndex.lastCol },
  };
  const firstEnd = cstIndex.byRow.get(0)?.endCol ?? 1;

  return [
    {
      name: program.title,
      detail: `CSMP/360 (${program.method ?? "RKSFX"}, FINTIM=${program.timer.fintim ?? 10})`,
      kind: LspSymbolKind.Module,
      range: fullRange,
      selectionRange: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: Math.max(1, firstEnd) },
      },
      children,
    },
  ];
}

/**
 * Provides markdown hover documentation for CSMP/360 blocks, keywords, parameters, and states.
 */
export function getCsmpHover(content: string, position: LspPosition, _uri: string = "model.csmp"): LspHover | null {
  const hit = wordAtPosition(content, position);
  if (!hit) return null;

  const upper = hit.word.toUpperCase();

  // 1. Check standard library block catalog
  const schema = lookupCsmpBlockSchema(upper);
  if (schema) {
    const paramLines = schema.parameters
      .map((p) => `- \`${p.key}\` (default: \`${p.defaultValue}\`)${p.description ? ` — ${p.description}` : ""}`)
      .join("\n");
    return {
      range: hit.range,
      contents: {
        kind: "markdown",
        value: [
          `### ${schema.label}`,
          "",
          schema.description,
          "",
          paramLines ? `**Parameters:**\n${paramLines}` : "",
          `*Provenance:* ${schema.provenance}`,
        ]
          .filter(Boolean)
          .join("\n"),
      },
    };
  }

  // 2. Check CSMP keywords
  const kw = CSMP_KEYWORDS.find((k) => k.keyword === upper);
  if (kw) {
    return {
      range: hit.range,
      contents: {
        kind: "markdown",
        value: `**${kw.keyword}** — *${kw.detail}*\n\n${kw.doc}`,
      },
    };
  }

  // 3. Check integration methods
  if (VALID_CSMP_METHODS.has(upper)) {
    return {
      range: hit.range,
      contents: {
        kind: "markdown",
        value: `**METHOD ${upper}** — CSMP/360 numerical integration algorithm.`,
      },
    };
  }

  // 4. Check user-declared symbols in deck
  const program = parseCsmpDeck(content);
  const param = program.parameters.get(upper);
  if (param) {
    return {
      range: hit.range,
      contents: { kind: "markdown", value: `**PARAM \`${upper}\`** = \`${param.value}\`` },
    };
  }
  const constant = program.constants.get(upper);
  if (constant) {
    return {
      range: hit.range,
      contents: { kind: "markdown", value: `**CONST \`${upper}\`** = \`${constant.value}\`` },
    };
  }
  const incon = program.incons.get(upper);
  if (incon) {
    return {
      range: hit.range,
      contents: { kind: "markdown", value: `**INCON \`${upper}\`** = \`${incon.value}\`` },
    };
  }
  const dynStmt = program.dynamicStatements.find((s) => s.target === upper);
  if (dynStmt) {
    return {
      range: hit.range,
      contents: {
        kind: "markdown",
        value: `**${upper}** (${dynStmt.section} / ${dynStmt.sortMode})\n\n\`${dynStmt.target} = ${dynStmt.rawExpr}\``,
      },
    };
  }

  return null;
}

/**
 * Provides LSP completion items for CSMP/360 keywords, standard blocks, methods, and deck variables.
 */
export function getCsmpCompletions(
  content: string,
  position: LspPosition,
  _uri: string = "model.csmp",
): LspCompletionItem[] {
  const items: LspCompletionItem[] = [];
  const hit = wordAtPosition(content, position);
  const prefix = hit ? hit.word.toUpperCase() : "";

  for (const kw of CSMP_KEYWORDS) {
    if (!prefix || kw.keyword.startsWith(prefix)) {
      items.push({
        label: kw.keyword,
        kind: 14,
        detail: kw.detail,
        documentation: kw.doc,
      });
    }
  }

  for (const schema of getCsmpSchemasFromLibraries()) {
    if (!prefix || schema.name.toUpperCase().startsWith(prefix)) {
      items.push({
        label: schema.name,
        kind: 3,
        detail: schema.label,
        documentation: schema.description,
        insertText: `${schema.name}($1)`,
      });
    }
  }

  const program = parseCsmpDeck(content);
  const seen = new Set<string>(items.map((i) => i.label));
  for (const [name, decl] of [...program.parameters, ...program.constants, ...program.incons]) {
    if (!seen.has(name) && (!prefix || name.startsWith(prefix))) {
      seen.add(name);
      items.push({
        label: name,
        kind: decl.kind === "CONST" ? 21 : 6,
        detail: `${decl.kind} = ${decl.value}`,
      });
    }
  }
  for (const stmt of program.dynamicStatements) {
    if (!seen.has(stmt.target) && (!prefix || stmt.target.startsWith(prefix))) {
      seen.add(stmt.target);
      items.push({
        label: stmt.target,
        kind: 6,
        detail: `Dynamic variable (${stmt.section})`,
      });
    }
  }

  return items;
}
