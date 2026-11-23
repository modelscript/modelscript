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
import { AmplLexer } from "./parser/ampl-lexer.js";
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

const AMPL_TYPE_KEYWORDS = new Set(["binary", "integer", "semicont", "semiint", "symbolic", "ordered", "circular"]);

const AMPL_AGGREGATE_KEYWORDS = new Set(["sum", "prod", "min", "max", "forall", "exists", "count", "numberof"]);

const AMPL_BUILTIN_FUNCTIONS = new Set([
  "abs",
  "sqrt",
  "exp",
  "log",
  "ln",
  "log10",
  "sin",
  "cos",
  "tan",
  "asin",
  "acos",
  "atan",
  "sinh",
  "cosh",
  "tanh",
  "ceil",
  "floor",
  "round",
  "trunc",
  "erf",
  "erfc",
  "gamma",
  "lgamma",
  "bessel_j0",
  "bessel_j1",
  "bessel_y0",
  "bessel_y1",
  "normal",
  "normal01",
  "normal_pdf",
]);

// Matches packages/lsp/src/providers/semanticTokensProvider.ts legend:
// ["keyword", "type", "class", "variable", "parameter", "function", "string", "number", "operator", "comment"]
const SEM_KEYWORD = 0;
const SEM_TYPE = 1;
const SEM_CLASS = 2;
const SEM_VARIABLE = 3;
const SEM_PARAMETER = 4;
const SEM_FUNCTION = 5;
const SEM_STRING = 6;
const SEM_NUMBER = 7;
const SEM_OPERATOR = 8;
const SEM_COMMENT = 9;

const MOD_DECLARATION = 1;
const MOD_READONLY = 2;

/**
 * Computes LSP semantic tokens (`[deltaLine, deltaChar, length, tokenType, tokenModifiers]`)
 * for AMPL `.mod`, `.dat`, and `.ampl` documents.
 */
export function getAmplSemanticTokens(documentText: string): number[] {
  if (!documentText) return [];

  let model: AmplModel | null = null;
  try {
    model = parseAmplModelWithDiagnostics(documentText).model;
  } catch {
    model = null;
  }

  const rawTokens: { line: number; char: number; length: number; type: number; mod: number }[] = [];

  // 1. Collect # line comments and /* ... */ block comments
  const lines = documentText.split(/\r?\n/);
  let inBlockComment = false;
  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx]!;
    let col = 0;
    while (col < line.length) {
      if (inBlockComment) {
        const closeIdx = line.indexOf("*/", col);
        if (closeIdx === -1) {
          if (line.length - col > 0) {
            rawTokens.push({ line: lineIdx, char: col, length: line.length - col, type: SEM_COMMENT, mod: 0 });
          }
          col = line.length;
        } else {
          const end = closeIdx + 2;
          rawTokens.push({ line: lineIdx, char: col, length: end - col, type: SEM_COMMENT, mod: 0 });
          inBlockComment = false;
          col = end;
        }
        continue;
      }
      const ch = line[col]!;
      if (ch === '"' || ch === "'") {
        const quote = ch;
        col++;
        while (col < line.length) {
          if (line[col] === "\\" && col + 1 < line.length) {
            col += 2;
          } else if (line[col] === quote) {
            col++;
            break;
          } else {
            col++;
          }
        }
        continue;
      }
      if (ch === "#") {
        rawTokens.push({ line: lineIdx, char: col, length: line.length - col, type: SEM_COMMENT, mod: 0 });
        break;
      }
      if (ch === "/" && line[col + 1] === "*") {
        const closeIdx = line.indexOf("*/", col + 2);
        if (closeIdx === -1) {
          rawTokens.push({ line: lineIdx, char: col, length: line.length - col, type: SEM_COMMENT, mod: 0 });
          inBlockComment = true;
          break;
        } else {
          const end = closeIdx + 2;
          rawTokens.push({ line: lineIdx, char: col, length: end - col, type: SEM_COMMENT, mod: 0 });
          col = end;
          continue;
        }
      }
      col++;
    }
  }

  // 2. Collect lexer tokens with semantic classification from parsed symbol tables
  try {
    const tokens = new AmplLexer(documentText).tokenize();
    for (const tok of tokens) {
      if (tok.type === "EOF" || tok.type === "PUNCTUATION") continue;
      const line = Math.max(0, tok.range.start.line - 1);
      const char = Math.max(0, tok.range.start.column - 1);
      const length = Math.max(1, tok.range.end.column - tok.range.start.column);
      if (tok.range.start.line !== tok.range.end.line) continue;

      let type = SEM_VARIABLE;
      let mod = 0;

      if (tok.type === "KEYWORD") {
        const lower = tok.value.toLowerCase();
        if (AMPL_TYPE_KEYWORDS.has(lower)) {
          type = SEM_TYPE;
        } else if (AMPL_AGGREGATE_KEYWORDS.has(lower)) {
          type = SEM_FUNCTION;
        } else {
          type = SEM_KEYWORD;
        }
      } else if (tok.type === "NUMBER") {
        type = SEM_NUMBER;
      } else if (tok.type === "STRING") {
        type = SEM_STRING;
      } else if (tok.type === "OPERATOR") {
        type = SEM_OPERATOR;
      } else if (tok.type === "IDENTIFIER") {
        const name = tok.value;
        if (model?.vars.has(name)) {
          type = SEM_VARIABLE;
          const decl = model.vars.get(name);
          if (decl?.range && decl.range.start.line - 1 === line) mod = MOD_DECLARATION;
        } else if (model?.params.has(name)) {
          type = SEM_PARAMETER;
          mod = MOD_READONLY;
          const decl = model.params.get(name);
          if (decl?.range && decl.range.start.line - 1 === line) mod |= MOD_DECLARATION;
        } else if (model?.sets.has(name)) {
          type = SEM_TYPE;
          const decl = model.sets.get(name);
          if (decl?.range && decl.range.start.line - 1 === line) mod = MOD_DECLARATION;
        } else if (
          model?.objectives.has(name) ||
          model?.functions?.has(name) ||
          AMPL_BUILTIN_FUNCTIONS.has(name.toLowerCase())
        ) {
          type = SEM_FUNCTION;
          const decl = model?.objectives.get(name) ?? model?.functions?.get(name);
          if (decl?.range && decl.range.start.line - 1 === line) mod = MOD_DECLARATION;
        } else if (model?.constraints.has(name)) {
          type = SEM_CLASS;
          const decl = model.constraints.get(name);
          if (decl?.range && decl.range.start.line - 1 === line) mod = MOD_DECLARATION;
        } else {
          type = SEM_VARIABLE;
        }
      }

      rawTokens.push({ line, char, length, type, mod });
    }
  } catch {
    // Return comment tokens if lexer fails
  }

  rawTokens.sort((a, b) => (a.line !== b.line ? a.line - b.line : a.char - b.char));

  const data: number[] = [];
  let prevLine = 0;
  let prevChar = 0;
  for (const t of rawTokens) {
    // Skip overlapping tokens on the same line
    if (t.line === prevLine && t.char < prevChar && data.length > 0) continue;
    const deltaLine = t.line - prevLine;
    const deltaChar = deltaLine === 0 ? t.char - prevChar : t.char;
    if (deltaLine < 0 || deltaChar < 0) continue;
    data.push(deltaLine, deltaChar, t.length, t.type, t.mod);
    prevLine = t.line;
    prevChar = t.char;
  }

  return data;
}
