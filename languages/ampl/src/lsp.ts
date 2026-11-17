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
import { parseAmplModel, parseAmplModelWithDiagnostics } from "./parser/ampl-mod-parser.js";
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
  const startLine = Math.max(0, range.start.line - 1);
  const startChar = Math.max(0, range.start.column - 1);
  const endLine = Math.max(startLine, range.end.line - 1);
  const endChar =
    endLine === startLine ? Math.max(startChar + 1, range.end.column - 1) : Math.max(0, range.end.column - 1);
  return {
    start: { line: startLine, character: startChar },
    end: { line: endLine, character: endChar },
  };
}

export function getAmplDiagnostics(documentText: string): LspDiagnostic[] {
  try {
    const { model, errors } = parseAmplModelWithDiagnostics(documentText);
    const out: LspDiagnostic[] = errors.map((err) => ({
      range: toLspRange(err.range),
      severity: 1,
      code: "M9501",
      source: "ampl",
      message: err.message,
    }));

    const diags = lintAmpl(model);
    for (const d of diags) {
      out.push({
        range: toLspRange(d.range),
        severity: d.severity === "error" ? 1 : d.severity === "warning" ? 2 : 3,
        code: `M${d.code}`,
        source: "ampl",
        message: d.message,
      });
    }
    return out;
  } catch (err) {
    const lines = documentText.split(/\r?\n/);
    let range = { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } };
    for (let i = 0; i < lines.length; i++) {
      const match = /\S+/.exec(lines[i] ?? "");
      if (match) {
        range = {
          start: { line: i, character: match.index },
          end: { line: i, character: match.index + match[0].length },
        };
        break;
      }
    }
    return [
      {
        range,
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
    model = typeof input === "string" ? parseAmplModelWithDiagnostics(input).model : input;
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
