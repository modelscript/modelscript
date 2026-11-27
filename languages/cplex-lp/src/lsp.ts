// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Language Server Protocol (LSP) services for @modelscript/cplex-lp.
 *
 * Provides diagnostics (`validateCplexLp`), document outline symbols
 * (`getCplexLpDocumentSymbols`), and hover information (`getCplexLpHover`).
 */

import { getOrLoadLanguageWasmParser } from "@modelscript/dsl";
import { cstLineText, groupAllCstTokensByLine, type CstNodeLike } from "@modelscript/runtime";
import { createWasmParserSync } from "../src-gen/bindings.js";
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

interface CplexLpCstLine {
  row: number;
  text: string;
  startCol: number;
  endCol: number;
  tokens: CstNodeLike[];
}

function buildCplexLpCstLineMap(content: string, cstTree?: { rootNode?: unknown } | null): Map<number, CplexLpCstLine> {
  const byRow = new Map<number, CplexLpCstLine>();
  let rootNode: unknown = cstTree?.rootNode ?? null;
  if (!rootNode) {
    try {
      rootNode =
        getOrLoadLanguageWasmParser("cplex-lp", import.meta.url, createWasmParserSync).parse(content)?.rootNode ?? null;
    } catch {
      rootNode = null;
    }
  }
  if (!rootNode) return byRow;

  for (const { row, tokens } of groupAllCstTokensByLine(rootNode as CstNodeLike)) {
    const lineText = cstLineText(content, tokens);
    const first = tokens[0] as (CstNodeLike & { endPosition?: { column: number } }) | undefined;
    const last = tokens[tokens.length - 1] as (CstNodeLike & { endPosition?: { column: number } }) | undefined;
    const startCol = first?.startPosition?.column ?? 0;
    const endCol = last?.endPosition?.column ?? startCol + lineText.length;
    byRow.set(row, { row, text: lineText, startCol, endCol, tokens });
  }
  return byRow;
}

/**
 * Validates a CPLEX LP / LINDO document and returns LSP diagnostics.
 */
export function validateCplexLp(
  content: string,
  _uri = "model.lp",
  cstTree?: { rootNode?: unknown } | null,
): LspDiagnostic[] {
  const model = parseCplexLp(content);
  const diags = lintCplexLp(model);
  const lineMap = buildCplexLpCstLineMap(content, cstTree);

  return diags.map((d) => {
    const lineIdx = d.location ? Math.max(0, d.location.line - 1) : 0;
    const lineEntry = lineMap.get(lineIdx);
    const startChar = d.location ? Math.max(0, d.location.column - 1) : (lineEntry?.startCol ?? 0);
    const endChar = Math.max(startChar + 1, lineEntry?.endCol ?? startChar + 1);

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
export function getCplexLpDocumentSymbols(
  content: string,
  cstTree?: { rootNode?: unknown } | null,
): LspDocumentSymbol[] {
  const model = parseCplexLp(content);
  const lineMap = buildCplexLpCstLineMap(content, cstTree);

  const makeLineRange = (line1Based: number | undefined): LspRange => {
    const idx = line1Based ? Math.max(0, line1Based - 1) : 0;
    const endCol = lineMap.get(idx)?.endCol ?? 1;
    return {
      start: { line: idx, character: 0 },
      end: { line: idx, character: Math.max(1, endCol) },
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
export function getCplexLpHover(
  content: string,
  position: LspPosition,
  cstTree?: { rootNode?: unknown } | null,
): LspHover | null {
  const lineMap = buildCplexLpCstLineMap(content, cstTree);
  const lineEntry = lineMap.get(position.line);
  if (!lineEntry) return null;

  let word = "";
  let start = position.character;
  let end = position.character;
  for (const tok of lineEntry.tokens) {
    const t = tok as CstNodeLike & { endPosition?: { column: number } };
    const tokText = (t.text ?? "").trim();
    if (!tokText) continue;
    const tStart = t.startPosition?.column ?? 0;
    const tEnd = t.endPosition?.column ?? tStart + tokText.length;
    if (position.character >= tStart && position.character <= tEnd) {
      word = tokText;
      start = tStart;
      end = tEnd;
      break;
    }
  }
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
