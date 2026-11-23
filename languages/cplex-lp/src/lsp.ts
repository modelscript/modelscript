// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Language Server Protocol (LSP) services for @modelscript/cplex-lp.
 *
 * Provides diagnostics (`validateCplexLp`), document outline symbols
 * (`getCplexLpDocumentSymbols`), and hover information (`getCplexLpHover`).
 */

import { lintCplexLp } from "./lints/index.js";
import { parseCplexLp } from "./parser/lp-parser.js";

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
  severity: 1 | 2 | 3 | 4; // 1 = Error, 2 = Warning, 3 = Information, 4 = Hint
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

const KEYWORD_DOCS: Record<string, string> = {
  minimize: "**Minimize** (`MIN`) — Declares a minimization objective function.",
  maximize: "**Maximize** (`MAX`) — Declares a maximization objective function.",
  min: "**MIN** (LINDO) — Shorthand for `Minimize` objective section.",
  max: "**MAX** (LINDO) — Shorthand for `Maximize` objective section.",
  subject: "**Subject To** (`ST` / `S.T.`) — Begins the linear/quadratic constraints section.",
  st: "**ST** (LINDO) — Shorthand for `Subject To` constraints section.",
  bounds: "**Bounds** — Specifies lower/upper bounds, fixed values, or `free` variables.",
  generals: "**Generals** (`General`, `Gen`) — Declares general integer decision variables.",
  binaries: "**Binaries** (`Binary`, `Bin`) — Declares 0–1 binary decision variables.",
  semis: "**Semi-Continuous** (`Semis`) — Declares variables that are either 0 or in `[lb, ub]`.",
  sos: "**SOS** — Declares Special Ordered Sets (`S1::` at most one nonzero, `S2::` at most two adjacent nonzeros).",
  free: "**free** — Removes default `[0, +inf)` bounds so a variable spans `(-inf, +inf)`.",
  gin: "**GIN** (LINDO) — Declares general integer variable(s).",
  int: "**INT** (LINDO) — Declares 0–1 binary integer variable(s).",
  slb: "**SLB** (LINDO) — Sets a Simple Lower Bound on a variable.",
  sub: "**SUB** (LINDO) — Sets a Simple Upper Bound on a variable.",
  end: "**End** — Terminates the CPLEX LP / LINDO model specification.",
};

/**
 * Validates a CPLEX LP / LINDO document and returns LSP diagnostics.
 */
export function validateCplexLp(content: string, _uri = "model.lp"): LspDiagnostic[] {
  const model = parseCplexLp(content);
  const diags = lintCplexLp(model);
  const lines = content.split(/\r?\n/);

  return diags.map((d) => {
    const lineIdx = d.location ? Math.max(0, d.location.line - 1) : 0;
    const lineText = lines[lineIdx] ?? "";
    const startChar = d.location ? Math.max(0, d.location.column - 1) : 0;
    const endChar = Math.max(startChar + 1, lineText.length);

    return {
      range: {
        start: { line: lineIdx, character: startChar },
        end: { line: lineIdx, character: endChar },
      },
      severity: d.severity === "error" ? 1 : d.severity === "warning" ? 2 : 3,
      code: d.id,
      source: "modelscript-cplex-lp",
      message: d.message,
    };
  });
}

/**
 * Extracts hierarchical LSP document symbols (objective, constraints, variables, SOS).
 */
export function getCplexLpDocumentSymbols(content: string): LspDocumentSymbol[] {
  const model = parseCplexLp(content);
  const lines = content.split(/\r?\n/);

  const makeLineRange = (line1Based: number | undefined): LspRange => {
    const idx = line1Based ? Math.max(0, line1Based - 1) : 0;
    const len = (lines[idx] ?? "").length;
    return {
      start: { line: idx, character: 0 },
      end: { line: idx, character: Math.max(1, len) },
    };
  };

  const symbols: LspDocumentSymbol[] = [];

  if (model.objective) {
    const r = makeLineRange(model.objective.location?.line);
    symbols.push({
      name: model.objective.name ?? model.objective.sense,
      detail: `${model.objective.sense} (${model.objective.linearTerms.length} linear terms)`,
      kind: LspSymbolKind.Function,
      range: r,
      selectionRange: r,
    });
  }

  for (const con of model.constraints) {
    const r = makeLineRange(con.location?.line);
    symbols.push({
      name: con.name,
      detail: `${con.sense} ${con.rhs}`,
      kind: LspSymbolKind.Property,
      range: r,
      selectionRange: r,
    });
  }

  for (const [varName, info] of model.variables) {
    const r = makeLineRange(info.firstLocation?.line);
    const boundStr = info.isFree ? "free" : `[${info.lower}, ${info.upper}]`;
    symbols.push({
      name: varName,
      detail: `${info.domain} ${boundStr}`,
      kind: LspSymbolKind.Variable,
      range: r,
      selectionRange: r,
    });
  }

  return symbols;
}

/**
 * Provides Markdown hover documentation for keywords, variables, and constraints.
 */
export function getCplexLpHover(content: string, position: LspPosition): LspHover | null {
  const lines = content.split(/\r?\n/);
  const lineText = lines[position.line];
  if (lineText === undefined) return null;

  // Find word around position.character
  let start = position.character;
  let end = position.character;
  const isWordChar = (ch: string | undefined): boolean => Boolean(ch && /[A-Za-z0-9_.#$@%&~-]/.test(ch));

  while (start > 0 && isWordChar(lineText[start - 1])) start--;
  while (end < lineText.length && isWordChar(lineText[end])) end++;

  const word = lineText.slice(start, end);
  if (!word) return null;

  const range: LspRange = {
    start: { line: position.line, character: start },
    end: { line: position.line, character: end },
  };

  const kwDoc = KEYWORD_DOCS[word.toLowerCase()];
  if (kwDoc) {
    return {
      contents: { kind: "markdown", value: kwDoc },
      range,
    };
  }

  const model = parseCplexLp(content);

  const varInfo = model.variables.get(word);
  if (varInfo) {
    const boundStr = varInfo.isFree ? "(-∞, +∞) (free)" : `[${varInfo.lower}, ${varInfo.upper}]`;
    return {
      contents: {
        kind: "markdown",
        value: `**Variable** \`${varInfo.name}\`\n\n- Domain: \`${varInfo.domain}\`\n- Bounds: \`${boundStr}\``,
      },
      range,
    };
  }

  const con = model.constraints.find((c) => c.name === word);
  if (con) {
    return {
      contents: {
        kind: "markdown",
        value: `**Constraint** \`${con.name}\`\n\n- Sense: \`${con.sense}\`\n- RHS: \`${con.rhs}\`\n- Terms: ${con.linearTerms.length}`,
      },
      range,
    };
  }

  return null;
}
