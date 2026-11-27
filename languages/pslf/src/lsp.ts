// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/pslf — Language Server Protocol (LSP) Service Integration.
 *
 * Provides diagnostic validation, hierarchical document symbols (Buses, Generators, Branches, Transformers),
 * contextual hover tooltips, and intelligent completions for GE PSLF (.epc and .dyd) models.
 */

import { getOrLoadLanguageWasmParser } from "@modelscript/dsl";
import { cstLineText, groupAllCstTokensByLine, type CstNodeLike } from "@modelscript/runtime";
import { createWasmParserSync } from "../src-gen/bindings.js";
import { lintPslfDyd, lintPslfEpc, type PslfDiagnostic } from "./lints/index.js";
import { parsePslfDyd } from "./parser/dyd-parser.js";
import { parsePslfEpc } from "./parser/epc-parser.js";
import type { PslfDydCase, PslfEpcCase } from "./types.js";

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
  String = 15,
  Number = 16,
  Boolean = 17,
  Array = 18,
  Object = 19,
  Key = 20,
  Null = 21,
  EnumMember = 22,
  Struct = 23,
  Event = 24,
  Operator = 25,
  TypeParameter = 26,
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
  severity: 1 | 2 | 3 | 4; // 1: Error, 2: Warning, 3: Info, 4: Hint
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
  kind: number;
  detail?: string | undefined;
  documentation?: string | undefined;
  insertText?: string | undefined;
}

interface PslfCstLine {
  row: number;
  text: string;
  colLine: string;
  startCol: number;
  endCol: number;
  firstToken: string;
  firstTokenEnd: number;
}

interface PslfCstIndex {
  byRow: Map<number, PslfCstLine>;
  entries: PslfCstLine[];
  rootRange: LspRange;
}

function buildPslfCstIndex(content: string): PslfCstIndex {
  const byRow = new Map<number, PslfCstLine>();
  const entries: PslfCstLine[] = [];
  let lastRow = 0;
  let lastEndCol = 0;

  let rootNode: CstNodeLike | null = null;
  try {
    rootNode =
      (getOrLoadLanguageWasmParser("pslf", import.meta.url, createWasmParserSync).parse(content)?.rootNode as
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
      const firstToken = (first?.text ?? lineText.split(/[\s,]+/)[0] ?? "").trim();
      const firstTokenEnd = first?.endPosition?.column ?? startCol + Math.max(1, firstToken.length);
      const entry: PslfCstLine = { row, text: lineText, colLine, startCol, endCol, firstToken, firstTokenEnd };
      byRow.set(row, entry);
      entries.push(entry);
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
      const firstToken = trimmed.split(/[\s,]+/)[0] ?? "";
      const entry: PslfCstLine = {
        row: i,
        text: trimmed,
        colLine: raw,
        startCol,
        endCol,
        firstToken,
        firstTokenEnd: startCol + Math.max(1, firstToken.length),
      };
      byRow.set(i, entry);
      entries.push(entry);
      lastRow = i;
      lastEndCol = endCol;
    }
  }

  const rootRange: LspRange = {
    start: { line: 0, character: 0 },
    end: { line: lastRow, character: Math.max(1, lastEndCol) },
  };
  return { byRow, entries, rootRange };
}

function findPslfNeedleRange(cstIndex: PslfCstIndex, needle: string | number): LspRange {
  const s = String(needle);
  const found = cstIndex.entries.find((e) => e.text.includes(s));
  if (!found) {
    const first = cstIndex.entries[0];
    return {
      start: { line: first?.row ?? 0, character: first?.startCol ?? 0 },
      end: { line: first?.row ?? 0, character: Math.max(1, first?.endCol ?? 1) },
    };
  }
  return {
    start: { line: found.row, character: found.startCol },
    end: { line: found.row, character: Math.max(found.startCol + 1, found.endCol) },
  };
}

/**
 * Validates a PSLF EPC (and optional companion DYD) model, producing LSP diagnostics.
 */
export function validatePslf(epcSource: string, dydSource?: string): LspDiagnostic[] {
  const diags: LspDiagnostic[] = [];
  const cstIndex = buildPslfCstIndex(epcSource);

  let epcCase: PslfEpcCase;
  try {
    epcCase = parsePslfEpc(epcSource);
  } catch (err: unknown) {
    return [
      {
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 1 },
        },
        severity: 1,
        code: "PSLF-PARSE",
        source: "pslf-epc-parser",
        message: `EPC Parse Error: ${err instanceof Error ? err.message : String(err)}`,
      },
    ];
  }

  let dydCase: PslfDydCase | undefined;
  if (dydSource) {
    try {
      dydCase = parsePslfDyd(dydSource);
    } catch {
      // Ignored for optional DYD validation
    }
  }

  const rawLints: PslfDiagnostic[] = [...lintPslfEpc(epcCase)];
  if (dydCase) {
    rawLints.push(...lintPslfDyd(dydCase, epcCase));
  }
  for (const lint of rawLints) {
    const range = lint.element
      ? findPslfNeedleRange(cstIndex, lint.element)
      : {
          start: { line: 0, character: cstIndex.entries[0]?.startCol ?? 0 },
          end: { line: 0, character: Math.max(1, cstIndex.entries[0]?.endCol ?? 1) },
        };

    let sev: 1 | 2 | 3 | 4 = 1;
    if (lint.severity === "warning") sev = 2;
    else if (lint.severity === "info") sev = 3;

    diags.push({
      range,
      severity: sev,
      code: lint.code,
      source: "pslf-linter",
      message: lint.message,
    });
  }

  return diags;
}

/**
 * Extracts hierarchical document symbols for buses, generators, loads, and branches.
 */
export function getPslfDocumentSymbols(epcSource: string): LspDocumentSymbol[] {
  const symbols: LspDocumentSymbol[] = [];
  const cstIndex = buildPslfCstIndex(epcSource);

  let epcCase: PslfEpcCase;
  try {
    epcCase = parsePslfEpc(epcSource);
  } catch {
    return symbols;
  }

  // 1. Buses
  if (epcCase.buses.size > 0) {
    const busSymbols: LspDocumentSymbol[] = [];
    for (const b of epcCase.buses.values()) {
      const range = findPslfNeedleRange(cstIndex, b.busNumber);
      busSymbols.push({
        name: `Bus ${b.busNumber}: ${b.name.trim()}`,
        detail: `${b.baseKv} kV (Type ${b.busType})`,
        kind: LspSymbolKind.Field,
        range,
        selectionRange: range,
      });
    }

    symbols.push({
      name: "Buses",
      detail: `${epcCase.buses.size} buses`,
      kind: LspSymbolKind.Package,
      range: cstIndex.rootRange,
      selectionRange: cstIndex.rootRange,
      children: busSymbols,
    });
  }

  // 2. Generators
  if (epcCase.generators.length > 0) {
    const genSymbols: LspDocumentSymbol[] = [];
    for (const g of epcCase.generators) {
      const range = findPslfNeedleRange(cstIndex, g.busNumber);
      genSymbols.push({
        name: `Gen @ Bus ${g.busNumber} [${g.genId.trim()}]`,
        detail: `P=${g.pgMw} MW, Q=${g.qgMvar} Mvar`,
        kind: LspSymbolKind.Method,
        range,
        selectionRange: range,
      });
    }

    symbols.push({
      name: "Generators",
      detail: `${epcCase.generators.length} machines`,
      kind: LspSymbolKind.Module,
      range: cstIndex.rootRange,
      selectionRange: cstIndex.rootRange,
      children: genSymbols,
    });
  }

  // 3. Branches
  if (epcCase.branches.length > 0) {
    const branchSymbols: LspDocumentSymbol[] = [];
    for (const br of epcCase.branches) {
      const range = findPslfNeedleRange(cstIndex, br.fromBus);
      branchSymbols.push({
        name: `Line ${br.fromBus} -> ${br.toBus}`,
        detail: `R=${br.rPu} pu, X=${br.xPu} pu`,
        kind: LspSymbolKind.Class,
        range,
        selectionRange: range,
      });
    }

    symbols.push({
      name: "Transmission Branches",
      detail: `${epcCase.branches.length} branches`,
      kind: LspSymbolKind.Module,
      range: cstIndex.rootRange,
      selectionRange: cstIndex.rootRange,
      children: branchSymbols,
    });
  }

  return symbols;
}

const PSLF_RECORD_DOCS: Record<string, string> = {
  B: "### `B` (Bus Record)\nDeclares a transmission bus, its nominal voltage, angle, voltage limits, and type (1=PQ, 2=PV, 3=Slack).",
  G: "### `G` (Generator Record)\nDeclares a synchronous generator, active/reactive output, and capability limits.",
  L: "### `L` (Load Record)\nDeclares a static load with constant power (PQ), constant current (I), and constant impedance (Y) components.",
  T: "### `T` (Transmission Line Record)\nDeclares an AC transmission line with per-unit series impedance R+jX and shunt susceptance B.",
  X: "### `X` (Transformer Record)\nDeclares a two-winding power transformer with tap ratio and phase shift.",
  A: "### `A` (Area Record)\nDeclares a control area and net interchange schedule.",
};

/**
 * Returns contextual hover information for PSLF EPC record types.
 */
export function getPslfHover(epcSource: string, pos: LspPosition): LspHover | undefined {
  const cstIndex = buildPslfCstIndex(epcSource);
  const entry = cstIndex.byRow.get(pos.line);
  if (!entry) return undefined;

  const firstToken = entry.firstToken.toUpperCase();
  if (firstToken && PSLF_RECORD_DOCS[firstToken]) {
    return {
      contents: {
        kind: "markdown",
        value: PSLF_RECORD_DOCS[firstToken]!,
      },
      range: {
        start: { line: pos.line, character: entry.startCol },
        end: { line: pos.line, character: entry.firstTokenEnd },
      },
    };
  }

  return undefined;
}

/**
 * Intelligent completion proposals for PSLF records and dynamic models.
 */
export function getPslfCompletions(_source: string, _pos: LspPosition): LspCompletionItem[] {
  return [
    { label: "B", kind: 7, detail: "Bus record", insertText: 'B ${1:1} "${2:BUS 1}" ${3:230.0} ${4:1}' },
    { label: "G", kind: 7, detail: "Generator record", insertText: 'G ${1:1} "${2:1 }" 1 ${3:100.0} ${4:20.0}' },
    { label: "L", kind: 7, detail: "Load record", insertText: 'L ${1:1} "${2:1 }" 1 ${3:50.0} ${4:10.0}' },
    {
      label: "T",
      kind: 7,
      detail: "Transmission Line record",
      insertText: 'T ${1:1} ${2:2} "${3:1 }" 1 ${4:0.02} ${5:0.08}',
    },
    { label: "X", kind: 7, detail: "Transformer record" },
    { label: "genrou", kind: 3, detail: "Round-rotor generator dynamic model (.dyd)" },
    { label: "exac1", kind: 3, detail: "IEEE Type AC1 excitation system model (.dyd)" },
    { label: "tgov1", kind: 3, detail: "Steam turbine-governor dynamic model (.dyd)" },
  ];
}

/**
 * Unified PSLF Language Server Protocol Service.
 */
export class PslfLspService {
  validate(epcSource: string, dydSource?: string): LspDiagnostic[] {
    return validatePslf(epcSource, dydSource);
  }

  getDocumentSymbols(epcSource: string): LspDocumentSymbol[] {
    return getPslfDocumentSymbols(epcSource);
  }

  getHover(epcSource: string, pos: LspPosition): LspHover | undefined {
    return getPslfHover(epcSource, pos);
  }

  getCompletions(source: string, pos: LspPosition): LspCompletionItem[] {
    return getPslfCompletions(source, pos);
  }
}
