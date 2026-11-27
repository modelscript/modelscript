// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/gams — Language Server Protocol (LSP) Services.
 *
 * Provides diagnostics, document symbols, hover documentation (including cleanroom
 * stdlib operators & GAMSlib archetypes), completions, and go-to-definition.
 */

import { getOrLoadLanguageWasmParser } from "@modelscript/dsl";
import { cstLineText, groupAllCstTokensByLine, type CstNodeLike } from "@modelscript/runtime";
import { createWasmParserSync } from "../src-gen/bindings.js";
import { lookupGamsModelSchema } from "./catalog/library-package-adapter.js";
import { lintGams } from "./lints/index.js";
import { parseGams } from "./parser/gams-parser.js";
import type { SourceSpan } from "./types.js";

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
}

export interface LspLocation {
  uri: string;
  range: LspRange;
}

const DEFAULT_RANGE: LspRange = {
  start: { line: 0, character: 0 },
  end: { line: 0, character: 1 },
};

function spanToRange(span?: SourceSpan): LspRange {
  if (!span) return DEFAULT_RANGE;
  return {
    start: { line: Math.max(0, span.startLine - 1), character: Math.max(0, span.startColumn - 1) },
    end: { line: Math.max(0, span.endLine - 1), character: Math.max(0, span.endColumn - 1) },
  };
}

function getGamsCstLineAt(content: string, row: number): string {
  let rootNode: unknown = null;
  try {
    rootNode =
      getOrLoadLanguageWasmParser("gams", import.meta.url, createWasmParserSync).parse(content)?.rootNode ?? null;
  } catch {
    rootNode = null;
  }

  if (rootNode) {
    for (const { row: lineRow, tokens } of groupAllCstTokensByLine(rootNode as CstNodeLike)) {
      if (lineRow === row) {
        const text = cstLineText(content, tokens);
        const first = tokens[0] as CstNodeLike | undefined;
        const startCol = first?.startPosition?.column ?? 0;
        return " ".repeat(startCol) + text;
      }
    }
    return "";
  }

  return content.split(/\r?\n/)[row] ?? "";
}

function wordAtPosition(content: string, pos: LspPosition): string {
  const line = getGamsCstLineAt(content, pos.line);
  let start = pos.character;
  let end = pos.character;
  while (start > 0 && /[A-Za-z0-9_]/.test(line[start - 1] ?? "")) start--;
  while (end < line.length && /[A-Za-z0-9_]/.test(line[end] ?? "")) end++;
  return line.slice(start, end);
}

/**
 * Validates GAMS source text and returns LSP diagnostics.
 */
export function validateGams(content: string, _uri = "model.gms"): LspDiagnostic[] {
  const model = parseGams(content);
  const diags = lintGams(model);
  return diags.map((d) => ({
    range: d.span
      ? spanToRange(d.span)
      : {
          start: { line: Math.max(0, d.line - 1), character: Math.max(0, d.column - 1) },
          end: {
            line: Math.max(0, (d.endLine ?? d.line) - 1),
            character: Math.max(1, (d.endColumn ?? d.column + 1) - 1),
          },
        },
    severity: d.severity === "error" ? 1 : d.severity === "warning" ? 2 : 3,
    code: d.id,
    source: "modelscript-gams",
    message: d.message,
  }));
}

/**
 * Extracts hierarchical LSP DocumentSymbols for a GAMS file.
 */
export function getGamsDocumentSymbols(content: string): LspDocumentSymbol[] {
  const model = parseGams(content);
  const symbols: LspDocumentSymbol[] = [];

  for (const s of model.sets) {
    const r = spanToRange(s.span);
    symbols.push({
      name: s.name,
      detail: `Set (${s.elements.length} elements)`,
      kind: LspSymbolKind.Enum,
      range: r,
      selectionRange: r,
    });
  }

  for (const p of model.parameters) {
    const r = spanToRange(p.span);
    const dom = p.domain.length > 0 ? `(${p.domain.join(",")})` : "";
    symbols.push({
      name: p.name,
      detail: `${p.kind}${dom}`,
      kind: LspSymbolKind.Constant,
      range: r,
      selectionRange: r,
    });
  }

  for (const v of model.variables) {
    const r = spanToRange(v.span);
    const dom = v.domain.length > 0 ? `(${v.domain.join(",")})` : "";
    symbols.push({
      name: v.name,
      detail: `${v.varKind} variable${dom}`,
      kind: LspSymbolKind.Variable,
      range: r,
      selectionRange: r,
    });
  }

  for (const eq of model.equationDecls) {
    const r = spanToRange(eq.span);
    const dom = eq.domain.length > 0 ? `(${eq.domain.join(",")})` : "";
    symbols.push({
      name: eq.name,
      detail: `equation${dom}`,
      kind: LspSymbolKind.Function,
      range: r,
      selectionRange: r,
    });
  }

  for (const m of model.models) {
    const r = spanToRange(m.span);
    symbols.push({
      name: m.name,
      detail: m.allEquations ? "Model / all /" : `Model / ${m.equations.join(", ")} /`,
      kind: LspSymbolKind.Class,
      range: r,
      selectionRange: r,
    });
  }

  return symbols;
}

/**
 * Returns Markdown hover information for GAMS sets, parameters, variables, equations, or stdlib operators.
 */
export function getGamsHover(content: string, pos: LspPosition): LspHover | null {
  const word = wordAtPosition(content, pos);
  if (!word) return null;
  const lower = word.toLowerCase();
  const model = parseGams(content);

  const setDecl = model.sets.find((s) => s.name.toLowerCase() === lower);
  if (setDecl) {
    return {
      contents: {
        kind: "markdown",
        value: `**Set \`${setDecl.name}\`**\n\nElements (${setDecl.elements.length}): \`${setDecl.elements.join(", ")}\`${setDecl.description ? `\n\n${setDecl.description}` : ""}`,
      },
    };
  }

  const paramDecl = model.parameters.find((p) => p.name.toLowerCase() === lower);
  if (paramDecl) {
    const dom = paramDecl.domain.length > 0 ? `(${paramDecl.domain.join(", ")})` : "";
    return {
      contents: {
        kind: "markdown",
        value: `**${paramDecl.kind.toUpperCase()} \`${paramDecl.name}${dom}\`**${paramDecl.description ? `\n\n${paramDecl.description}` : ""}`,
      },
    };
  }

  const varDecl = model.variables.find((v) => v.name.toLowerCase() === lower);
  if (varDecl) {
    const dom = varDecl.domain.length > 0 ? `(${varDecl.domain.join(", ")})` : "";
    return {
      contents: {
        kind: "markdown",
        value: `**${varDecl.varKind} Variable \`${varDecl.name}${dom}\`**${varDecl.description ? `\n\n${varDecl.description}` : ""}`,
      },
    };
  }

  const eqDecl = model.equationDecls.find((e) => e.name.toLowerCase() === lower);
  if (eqDecl) {
    const dom = eqDecl.domain.length > 0 ? `(${eqDecl.domain.join(", ")})` : "";
    return {
      contents: {
        kind: "markdown",
        value: `**Equation \`${eqDecl.name}${dom}\`**${eqDecl.description ? `\n\n${eqDecl.description}` : ""}`,
      },
    };
  }

  const stdSchema = lookupGamsModelSchema(lower);
  if (stdSchema) {
    return {
      contents: {
        kind: "markdown",
        value: `**GAMS \`${stdSchema.name}\`** — ${stdSchema.label}\n\n${stdSchema.description}\n\n*${stdSchema.provenance}*`,
      },
    };
  }

  return null;
}

const GAMS_KEYWORDS = [
  "Sets",
  "Set",
  "Alias",
  "Parameters",
  "Parameter",
  "Scalars",
  "Scalar",
  "Tables",
  "Table",
  "Variables",
  "Positive Variables",
  "Binary Variables",
  "Integer Variables",
  "Equations",
  "Equation",
  "Model",
  "Solve",
  "Display",
  "sum",
  "prod",
  "smin",
  "smax",
  "ord",
  "card",
  "sameas",
];

/**
 * Provides keyword and local symbol completions for a GAMS document.
 */
export function getGamsCompletions(content: string): LspCompletionItem[] {
  const model = parseGams(content);
  const items: LspCompletionItem[] = GAMS_KEYWORDS.map((kw) => ({
    label: kw,
    kind: 14,
    detail: "GAMS keyword / operator",
  }));

  for (const s of model.sets) items.push({ label: s.name, kind: 13, detail: "Set" });
  for (const p of model.parameters) items.push({ label: p.name, kind: 21, detail: p.kind });
  for (const v of model.variables) items.push({ label: v.name, kind: 6, detail: `${v.varKind} variable` });
  for (const e of model.equationDecls) items.push({ label: e.name, kind: 3, detail: "Equation" });
  for (const m of model.models) items.push({ label: m.name, kind: 7, detail: "Model" });

  return items;
}

/**
 * Resolves go-to-definition for a symbol at `pos` inside a GAMS file.
 */
export function getGamsDefinition(content: string, pos: LspPosition, uri = "model.gms"): LspLocation | null {
  const word = wordAtPosition(content, pos);
  if (!word) return null;
  const lower = word.toLowerCase();
  const model = parseGams(content);

  const candidates: Array<{ name: string; span?: SourceSpan | undefined }> = [
    ...model.sets,
    ...model.parameters,
    ...model.variables,
    ...model.equationDecls,
    ...model.models,
  ];
  const hit = candidates.find((c) => c.name.toLowerCase() === lower && c.span);
  if (!hit?.span) return null;

  return { uri, range: spanToRange(hit.span) };
}
