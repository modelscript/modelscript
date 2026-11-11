// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/powerfactory — Language Server Protocol (LSP) Service Integration.
 *
 * Provides diagnostic validation, hierarchical document symbols (Substations, Terminals, Lines, Transformers, Generators),
 * contextual hover tooltips, and intelligent completions for PowerFactory XML/DGS models.
 */

import { lintPowerFactoryModel, type PowerFactoryDiagnostic } from "./lints/index.js";
import { parsePowerFactoryText } from "./parser/powerfactory-parser.js";
import type { PowerFactoryModel } from "./types.js";

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
 * Validates a PowerFactory model document and produces LSP diagnostics.
 */
export function validatePowerFactory(source: string): LspDiagnostic[] {
  const diags: LspDiagnostic[] = [];
  const lines = source.split(/\r?\n/);

  let model: PowerFactoryModel;
  try {
    model = parsePowerFactoryText(source);
  } catch (err: unknown) {
    return [
      {
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 1 },
        },
        severity: 1,
        code: "PF1000",
        source: "powerfactory-parser",
        message: `Parse Error: ${err instanceof Error ? err.message : String(err)}`,
      },
    ];
  }

  const rawDiags: PowerFactoryDiagnostic[] = lintPowerFactoryModel(model);
  for (const diag of rawDiags) {
    let lineIdx = 0;
    const match = diag.element.split("/")[1] ?? diag.element;
    const foundLine = lines.findIndex((l) => l.includes(match));
    if (foundLine >= 0) lineIdx = foundLine;

    let sev: 1 | 2 | 3 | 4 = 1;
    if (diag.severity === "warning") sev = 2;
    else if (diag.severity === "info") sev = 3;

    diags.push({
      range: {
        start: { line: lineIdx, character: 0 },
        end: { line: lineIdx, character: 30 },
      },
      severity: sev,
      code: diag.code,
      source: "powerfactory-linter",
      message: diag.message,
    });
  }

  return diags;
}

/**
 * Extracts hierarchical document symbols for PowerFactory elements.
 */
export function getPowerFactoryDocumentSymbols(source: string): LspDocumentSymbol[] {
  const symbols: LspDocumentSymbol[] = [];
  const lines = source.split(/\r?\n/);

  let model: PowerFactoryModel;
  try {
    model = parsePowerFactoryText(source);
  } catch {
    return symbols;
  }

  const findLine = (needle: string): number => {
    const idx = lines.findIndex((l) => l.includes(needle));
    return idx >= 0 ? idx : 0;
  };

  // 1. Busbars & Terminals
  if (model.terminals.size > 0) {
    const termSymbols: LspDocumentSymbol[] = [];
    for (const [, term] of model.terminals) {
      const lineIdx = findLine(term.loc_name);
      termSymbols.push({
        name: `Terminal: ${term.loc_name}`,
        detail: `${term.uknom} kV, ${term.fnom} Hz`,
        kind: LspSymbolKind.Field,
        range: { start: { line: lineIdx, character: 0 }, end: { line: lineIdx, character: 20 } },
        selectionRange: { start: { line: lineIdx, character: 0 }, end: { line: lineIdx, character: 20 } },
      });
    }

    symbols.push({
      name: "Terminals & Busbars",
      detail: `${model.terminals.size} buses`,
      kind: LspSymbolKind.Package,
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 20 } },
      selectionRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 20 } },
      children: termSymbols,
    });
  }

  // 2. Lines
  if (model.lines.size > 0) {
    const lineSymbols: LspDocumentSymbol[] = [];
    for (const [, line] of model.lines) {
      const lineIdx = findLine(line.loc_name);
      lineSymbols.push({
        name: `Line: ${line.loc_name}`,
        detail: `${line.bus1Id} -> ${line.bus2Id} (${line.dline} km)`,
        kind: LspSymbolKind.Class,
        range: { start: { line: lineIdx, character: 0 }, end: { line: lineIdx, character: 20 } },
        selectionRange: { start: { line: lineIdx, character: 0 }, end: { line: lineIdx, character: 20 } },
      });
    }

    symbols.push({
      name: "Transmission Lines",
      detail: `${model.lines.size} lines`,
      kind: LspSymbolKind.Module,
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 20 } },
      selectionRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 20 } },
      children: lineSymbols,
    });
  }

  // 3. Generators
  if (model.generators.size > 0) {
    const genSymbols: LspDocumentSymbol[] = [];
    for (const [, gen] of model.generators) {
      const lineIdx = findLine(gen.loc_name);
      genSymbols.push({
        name: `Generator: ${gen.loc_name}`,
        detail: `P=${gen.pgini} MW, V=${gen.usetp} pu`,
        kind: LspSymbolKind.Method,
        range: { start: { line: lineIdx, character: 0 }, end: { line: lineIdx, character: 20 } },
        selectionRange: { start: { line: lineIdx, character: 0 }, end: { line: lineIdx, character: 20 } },
      });
    }

    symbols.push({
      name: "Generators",
      detail: `${model.generators.size} machines`,
      kind: LspSymbolKind.Module,
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 20 } },
      selectionRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 20 } },
      children: genSymbols,
    });
  }

  return symbols;
}

const PF_CLASS_DOCS: Record<string, string> = {
  ElmTerm: "### `ElmTerm` (Busbar / Terminal)\nElectrical node connecting branches, loads, and generation equipment.",
  ElmLne: "### `ElmLne` (Transmission Line)\nOverhead or underground AC transmission branch.",
  ElmTr2: "### `ElmTr2` (2-Winding Transformer)\nTwo-winding step-up or step-down power transformer.",
  ElmSym: "### `ElmSym` (Synchronous Machine)\nSynchronous generator or condenser with voltage setpoint control.",
  ElmLod: "### `ElmLod` (General Load)\nStatic or dynamic PQ / impedance electrical power load.",
  TypLne: "### `TypLne` (Line Type)\nPer-unit electrical parameters for a transmission line type.",
  TypTr2: "### `TypTr2` (Transformer Type)\nRated voltages, short-circuit impedance, and iron losses for transformer.",
};

/**
 * Returns contextual hover information for PowerFactory elements.
 */
export function getPowerFactoryHover(source: string, pos: LspPosition): LspHover | undefined {
  const lines = source.split(/\r?\n/);
  if (pos.line >= lines.length) return undefined;
  const line = lines[pos.line] ?? "";

  for (const [cls, doc] of Object.entries(PF_CLASS_DOCS)) {
    if (line.includes(`class="${cls}"`) || line.includes(cls)) {
      return {
        contents: {
          kind: "markdown",
          value: doc,
        },
      };
    }
  }

  const nameMatch = line.match(/loc_name="([^"]+)"/);
  if (nameMatch) {
    return {
      contents: {
        kind: "markdown",
        value: `**Equipment Name:** \`${nameMatch[1]}\`\n\n*DIgSILENT PowerFactory Network Element*`,
      },
    };
  }

  return undefined;
}

/**
 * Intelligent completion proposals for PowerFactory models.
 */
export function getPowerFactoryCompletions(_source: string, _pos: LspPosition): LspCompletionItem[] {
  return [
    {
      label: "ElmTerm",
      kind: 7,
      detail: "Terminal / Busbar node",
      insertText: '<DataObject class="ElmTerm" loc_name="${1:Bus1}">\n\t<uknom>${2:110.0}</uknom>\n</DataObject>',
    },
    { label: "ElmLne", kind: 7, detail: "Transmission Line" },
    { label: "ElmTr2", kind: 7, detail: "Two-winding transformer" },
    { label: "ElmSym", kind: 7, detail: "Synchronous Generator" },
    { label: "ElmLod", kind: 7, detail: "PQ Electrical Load" },
    { label: "TypLne", kind: 7, detail: "Line Type Definition" },
    { label: "TypTr2", kind: 7, detail: "Transformer Type Definition" },
  ];
}

/**
 * Unified PowerFactory Language Server Protocol Service.
 */
export class PowerFactoryLspService {
  validate(source: string): LspDiagnostic[] {
    return validatePowerFactory(source);
  }

  getDocumentSymbols(source: string): LspDocumentSymbol[] {
    return getPowerFactoryDocumentSymbols(source);
  }

  getHover(source: string, pos: LspPosition): LspHover | undefined {
    return getPowerFactoryHover(source, pos);
  }

  getCompletions(source: string, pos: LspPosition): LspCompletionItem[] {
    return getPowerFactoryCompletions(source, pos);
  }
}
