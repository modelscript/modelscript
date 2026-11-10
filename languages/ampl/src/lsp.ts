// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/ampl — Language Server Protocol (LSP) Services for AMPL files.
 */

import { lintAmpl } from "./lints/index.js";
import { parseAmplModel } from "./parser/ampl-mod-parser.js";
import type { AmplModel, SourceRange } from "./types.js";

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
  severity: 1 | 2 | 3 | 4;
  code: number | string;
  source: string;
  message: string;
}

export interface LspHover {
  contents: { kind: "markdown" | "plaintext"; value: string };
  range?: LspRange | undefined;
}

function toLspRange(range?: SourceRange | undefined): LspRange {
  if (!range) {
    return {
      start: { line: 0, character: 0 },
      end: { line: 0, character: 0 },
    };
  }
  return {
    start: { line: Math.max(0, range.start.line - 1), character: Math.max(0, range.start.column - 1) },
    end: { line: Math.max(0, range.end.line - 1), character: Math.max(0, range.end.column - 1) },
  };
}

export function getAmplDiagnostics(documentText: string): LspDiagnostic[] {
  try {
    const model = parseAmplModel(documentText);
    const diags = lintAmpl(model);
    return diags.map((d) => ({
      range: toLspRange(d.range),
      severity: d.severity === "error" ? 1 : d.severity === "warning" ? 2 : 3,
      code: `M${d.code}`,
      source: "ampl",
      message: d.message,
    }));
  } catch (err) {
    return [
      {
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
        severity: 1,
        code: "M9501",
        source: "ampl",
        message: err instanceof Error ? err.message : String(err),
      },
    ];
  }
}

export function validateAmpl(documentText: string): LspDiagnostic[] {
  return getAmplDiagnostics(documentText);
}

export function getAmplDocumentSymbols(input: string | AmplModel): LspDocumentSymbol[] {
  let model: AmplModel;
  try {
    model = typeof input === "string" ? parseAmplModel(input) : input;
  } catch {
    return [];
  }
  const symbols: LspDocumentSymbol[] = [];

  // Sets
  for (const [name, decl] of model.sets.entries()) {
    const r = toLspRange(decl.range);
    symbols.push({
      name,
      detail: `set (dimen ${decl.dimen})`,
      kind: LspSymbolKind.Array,
      range: r,
      selectionRange: r,
    });
  }

  // Params
  for (const [name, decl] of model.params.entries()) {
    const r = toLspRange(decl.range);
    symbols.push({
      name,
      detail: `param (${decl.type})`,
      kind: LspSymbolKind.Constant,
      range: r,
      selectionRange: r,
    });
  }

  // Vars
  for (const [name, decl] of model.vars.entries()) {
    const r = toLspRange(decl.range);
    symbols.push({
      name,
      detail: `var (${decl.type})`,
      kind: LspSymbolKind.Variable,
      range: r,
      selectionRange: r,
    });
  }

  // Objectives
  for (const [name, decl] of model.objectives.entries()) {
    const r = toLspRange(decl.range);
    symbols.push({
      name,
      detail: `${decl.direction} objective`,
      kind: LspSymbolKind.Function,
      range: r,
      selectionRange: r,
    });
  }

  // Constraints
  for (const [name, decl] of model.constraints.entries()) {
    const r = toLspRange(decl.range);
    symbols.push({
      name,
      detail: `constraint (${decl.operator})`,
      kind: LspSymbolKind.Property,
      range: r,
      selectionRange: r,
    });
  }

  return symbols;
}

export function getAmplHover(documentText: string, pos: LspPosition): LspHover | null {
  try {
    const model = parseAmplModel(documentText);
    const symbols = getAmplDocumentSymbols(model);
    for (const s of symbols) {
      if (
        pos.line >= s.range.start.line &&
        pos.line <= s.range.end.line &&
        pos.character >= s.range.start.character &&
        pos.character <= s.range.end.character
      ) {
        return {
          contents: {
            kind: "markdown",
            value: `**AMPL ${s.detail ?? ""}**: \`${s.name}\``,
          },
          range: s.range,
        };
      }
    }
  } catch {
    // Ignore parse errors on hover
  }
  return null;
}
