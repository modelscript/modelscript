// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/pslf — Language Server Protocol (LSP) Service Integration.
 *
 * Provides diagnostic validation, hierarchical document symbols (Buses, Generators, Branches, Transformers),
 * contextual hover tooltips, and intelligent completions for GE PSLF (.epc and .dyd) models.
 */

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

/**
 * Validates a PSLF EPC (and optional companion DYD) model, producing LSP diagnostics.
 */
export function validatePslf(epcSource: string, dydSource?: string): LspDiagnostic[] {
  const diags: LspDiagnostic[] = [];
  const lines = epcSource.split(/\r?\n/);

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
    let lineIdx = 0;
    if (lint.element) {
      const matchIdx = lines.findIndex((l) => l.includes(lint.element!));
      if (matchIdx >= 0) lineIdx = matchIdx;
    }

    let sev: 1 | 2 | 3 | 4 = 1;
    if (lint.severity === "warning") sev = 2;
    else if (lint.severity === "info") sev = 3;

    diags.push({
      range: {
        start: { line: lineIdx, character: 0 },
        end: { line: lineIdx, character: 30 },
      },
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
  const lines = epcSource.split(/\r?\n/);

  let epcCase: PslfEpcCase;
  try {
    epcCase = parsePslfEpc(epcSource);
  } catch {
    return symbols;
  }

  const findLine = (needle: string | number): number => {
    const s = String(needle);
    const idx = lines.findIndex((l) => l.includes(s));
    return idx >= 0 ? idx : 0;
  };

  // 1. Buses
  if (epcCase.buses.size > 0) {
    const busSymbols: LspDocumentSymbol[] = [];
    for (const b of epcCase.buses.values()) {
      const lineIdx = findLine(b.busNumber);
      busSymbols.push({
        name: `Bus ${b.busNumber}: ${b.name.trim()}`,
        detail: `${b.baseKv} kV (Type ${b.busType})`,
        kind: LspSymbolKind.Field,
        range: { start: { line: lineIdx, character: 0 }, end: { line: lineIdx, character: 20 } },
        selectionRange: { start: { line: lineIdx, character: 0 }, end: { line: lineIdx, character: 20 } },
      });
    }

    symbols.push({
      name: "Buses",
      detail: `${epcCase.buses.size} buses`,
      kind: LspSymbolKind.Package,
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 20 } },
      selectionRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 20 } },
      children: busSymbols,
    });
  }

  // 2. Generators
  if (epcCase.generators.length > 0) {
    const genSymbols: LspDocumentSymbol[] = [];
    for (const g of epcCase.generators) {
      const lineIdx = findLine(g.busNumber);
      genSymbols.push({
        name: `Gen @ Bus ${g.busNumber} [${g.genId.trim()}]`,
        detail: `P=${g.pgMw} MW, Q=${g.qgMvar} Mvar`,
        kind: LspSymbolKind.Method,
        range: { start: { line: lineIdx, character: 0 }, end: { line: lineIdx, character: 20 } },
        selectionRange: { start: { line: lineIdx, character: 0 }, end: { line: lineIdx, character: 20 } },
      });
    }

    symbols.push({
      name: "Generators",
      detail: `${epcCase.generators.length} machines`,
      kind: LspSymbolKind.Module,
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 20 } },
      selectionRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 20 } },
      children: genSymbols,
    });
  }

  // 3. Branches
  if (epcCase.branches.length > 0) {
    const branchSymbols: LspDocumentSymbol[] = [];
    for (const br of epcCase.branches) {
      const lineIdx = findLine(br.fromBus);
      branchSymbols.push({
        name: `Line ${br.fromBus} -> ${br.toBus}`,
        detail: `R=${br.rPu} pu, X=${br.xPu} pu`,
        kind: LspSymbolKind.Class,
        range: { start: { line: lineIdx, character: 0 }, end: { line: lineIdx, character: 20 } },
        selectionRange: { start: { line: lineIdx, character: 0 }, end: { line: lineIdx, character: 20 } },
      });
    }

    symbols.push({
      name: "Transmission Branches",
      detail: `${epcCase.branches.length} branches`,
      kind: LspSymbolKind.Module,
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 20 } },
      selectionRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 20 } },
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
  const lines = epcSource.split(/\r?\n/);
  if (pos.line >= lines.length) return undefined;
  const line = lines[pos.line] ?? "";

  const trimmed = line.trim();
  const firstToken = trimmed.split(/[\s,]+/)[0]?.toUpperCase();
  if (firstToken && PSLF_RECORD_DOCS[firstToken]) {
    return {
      contents: {
        kind: "markdown",
        value: PSLF_RECORD_DOCS[firstToken]!,
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
