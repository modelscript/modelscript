// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/ampl — Language Server Protocol (LSP) Services for AMPL files.
 */

import {
  type LspDiagnostic,
  type LspDocumentSymbol,
  type LspHover,
  type LspPosition,
  type LspRange,
  LspSymbolKind,
} from "@modelscript/runtime";
import { lintAmpl } from "./lints/index.js";
import { parseAmplModel } from "./parser/ampl-mod-parser.js";
import type { AmplModel, SourceRange } from "./types.js";

export {
  LspSymbolKind,
  type LspDiagnostic,
  type LspDocumentSymbol,
  type LspHover,
  type LspPosition,
  type LspRange,
} from "@modelscript/runtime";

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
