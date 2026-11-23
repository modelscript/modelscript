// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Language Server Protocol (LSP) services for MIT DYNAMO (`.dyn`, `.dynamo`).
 *
 * Provides diagnostics, document symbols, hover documentation, and completions.
 */

import { getDynamoSchemasFromLibraries, lookupDynamoFunctionSchema } from "./catalog/library-package-adapter.js";
import { lintDynamo } from "./lints/index.js";
import { parseDynamo } from "./parser/index.js";
import type { DynamoEquationKind } from "./types.js";

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
  kind: number; // 3 = Function, 6 = Variable, 14 = Keyword, 21 = Constant
  detail?: string | undefined;
  documentation?: string | undefined;
  insertText?: string | undefined;
}

const KIND_LABELS: Record<DynamoEquationKind, string> = {
  L: "Level (Stock)",
  R: "Rate (Flow)",
  A: "Auxiliary",
  N: "Initial Value",
  C: "Constant",
  T: "Table Lookup",
  S: "Supplementary",
};

/**
 * Validates a DYNAMO document and returns LSP diagnostics.
 */
export function validateDynamo(content: string, _uri = "model.dyn"): LspDiagnostic[] {
  const model = parseDynamo(content);
  const diags = lintDynamo(model);
  const lines = content.split(/\r?\n/);

  return diags.map((d) => {
    const lineIdx = Math.max(0, d.line - 1);
    const lineText = lines[lineIdx] ?? "";
    let startChar = Math.max(0, d.column - 1);
    let endChar = lineText.length;

    if (d.symbol) {
      const symIdx = lineText.toUpperCase().indexOf(d.symbol.toUpperCase());
      if (symIdx >= 0) {
        startChar = symIdx;
        endChar = symIdx + d.symbol.length;
      }
    }

    return {
      range: {
        start: { line: lineIdx, character: startChar },
        end: { line: lineIdx, character: Math.max(startChar + 1, endChar) },
      },
      severity: d.severity === "error" ? 1 : d.severity === "warning" ? 2 : 3,
      code: d.id,
      source: "modelscript-dynamo",
      message: d.message,
    };
  });
}

/**
 * Extracts hierarchical LSP document symbols from a DYNAMO document.
 */
export function getDynamoDocumentSymbols(content: string, _uri = "model.dyn"): LspDocumentSymbol[] {
  const model = parseDynamo(content);
  const lines = content.split(/\r?\n/);
  const fullRange: LspRange = {
    start: { line: 0, character: 0 },
    end: { line: Math.max(0, lines.length - 1), character: (lines[lines.length - 1] ?? "").length },
  };

  const children: LspDocumentSymbol[] = model.equations.map((eq) => {
    const lineIdx = Math.max(0, eq.span.line - 1);
    const lineText = lines[lineIdx] ?? "";
    const range: LspRange = {
      start: { line: lineIdx, character: 0 },
      end: { line: lineIdx, character: lineText.length },
    };
    const namePos = lineText.toUpperCase().indexOf(eq.name.toUpperCase());
    const selectionRange: LspRange =
      namePos >= 0
        ? {
            start: { line: lineIdx, character: namePos },
            end: { line: lineIdx, character: namePos + eq.name.length },
          }
        : range;

    const kind =
      eq.kind === "C"
        ? LspSymbolKind.Constant
        : eq.kind === "T"
          ? LspSymbolKind.Array
          : eq.kind === "L"
            ? LspSymbolKind.Field
            : eq.kind === "R"
              ? LspSymbolKind.Event
              : LspSymbolKind.Variable;

    const sub = eq.subscript ? `.${eq.subscript}` : "";
    return {
      name: `${eq.name}${sub}`,
      detail: `${KIND_LABELS[eq.kind]} = ${eq.rawRhs}`,
      kind,
      range,
      selectionRange,
    };
  });

  return [
    {
      name: model.name,
      detail: `DYNAMO Model (${model.equations.length} equations, DT=${model.spec.dt ?? 1}, LENGTH=${model.spec.length ?? 100})`,
      kind: LspSymbolKind.Module,
      range: fullRange,
      selectionRange: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: Math.min(1, fullRange.end.character) },
      },
      children,
    },
  ];
}

function wordAtPosition(lineText: string, character: number): { word: string; start: number; end: number } | null {
  if (character < 0 || character > lineText.length) return null;
  let start = character;
  let end = character;
  const isIdentChar = (c: string) => /[A-Za-z0-9_]/.test(c);
  while (start > 0 && isIdentChar(lineText[start - 1]!)) start--;
  while (end < lineText.length && isIdentChar(lineText[end]!)) end++;
  if (end <= start) return null;
  return { word: lineText.slice(start, end), start, end };
}

/**
 * Provides contextual hover documentation for DYNAMO symbols, keywords, and standard library functions.
 */
export function getDynamoHover(content: string, position: LspPosition): LspHover | null {
  const lines = content.split(/\r?\n/);
  const lineText = lines[position.line];
  if (lineText === undefined) return null;

  const token = wordAtPosition(lineText, position.character);
  if (!token) return null;

  const upper = token.word.toUpperCase();
  const range: LspRange = {
    start: { line: position.line, character: token.start },
    end: { line: position.line, character: token.end },
  };

  // 1. Check built-in DYNAMO standard library functions
  const stdSchema = lookupDynamoFunctionSchema(upper);
  if (stdSchema) {
    const sig = (stdSchema.extra?.["signature"] as string | undefined) ?? `${stdSchema.name}(...)`;
    return {
      range,
      contents: {
        kind: "markdown",
        value: `**DYNAMO Standard Function**: \`${sig}\`\n\n${stdSchema.description}\n\n*Category*: ${stdSchema.category}\n*Provenance*: ${stdSchema.provenance}`,
      },
    };
  }

  // 2. Check simulation built-ins
  if (upper === "DT") {
    return {
      range,
      contents: {
        kind: "markdown",
        value: "**DT** — Simulation solution interval (integration time step) specified in `SPEC DT=...`.",
      },
    };
  }
  if (upper === "TIME") {
    return {
      range,
      contents: {
        kind: "markdown",
        value:
          "**TIME** — Current simulation clock time (`TIME.K`), advancing from `0` to `LENGTH` in increments of `DT`.",
      },
    };
  }
  if (upper === "SPEC") {
    return {
      range,
      contents: {
        kind: "markdown",
        value:
          "**SPEC** — Simulation specification card: `SPEC DT=<step>/LENGTH=<horizon>/PRTPER=<print>/PLTPER=<plot>`.",
      },
    };
  }

  // 3. Check user-defined symbols in the DYNAMO model
  const model = parseDynamo(content);
  const matching = model.equations.filter((e) => e.name === upper);
  if (matching.length > 0) {
    const details = matching
      .map((eq) => {
        const sub = eq.subscript ? `.${eq.subscript}` : "";
        return `- **${KIND_LABELS[eq.kind]}** (line ${eq.span.line}): \`${eq.kind} ${eq.name}${sub} = ${eq.rawRhs}\``;
      })
      .join("\n");
    return {
      range,
      contents: {
        kind: "markdown",
        value: `**${upper}**\n\n${details}`,
      },
    };
  }

  return null;
}

/**
 * Provides code completion items for DYNAMO directives, standard library functions, and declared symbols.
 */
export function getDynamoCompletions(content: string, _position?: LspPosition): LspCompletionItem[] {
  const items: LspCompletionItem[] = [];

  // 1. DYNAMO equation type & directive keywords
  const keywords: Array<[string, string, string]> = [
    ["L", "Level (stock) equation", "L ${1:VAR}.K=${1:VAR}.J+(DT)*(${2:INFLOW}.JK-${3:OUTFLOW}.JK)"],
    ["R", "Rate (flow) equation", "R ${1:RATE}.KL=${2:EXPR}"],
    ["A", "Auxiliary equation", "A ${1:AUX}.K=${2:EXPR}"],
    ["N", "Initial value equation", "N ${1:VAR}=${2:0}"],
    ["C", "Constant parameter", "C ${1:CONST}=${2:1}"],
    ["T", "Table lookup values", "T ${1:TAB}=${2:0/0.5/1}"],
    ["S", "Supplementary output equation", "S ${1:SUPP}.K=${2:EXPR}"],
    ["NOTE", "Comment line", "NOTE ${1:description}"],
    ["SPEC", "Simulation specification", "SPEC DT=0.25/LENGTH=100/PRTPER=5/PLTPER=2"],
    ["PRINT", "Tabular output directive", "PRINT ${1:VAR}"],
    ["PLOT", "Graphical plot directive", "PLOT ${1:VAR}=V"],
    ["RUN", "Execute simulation run", "RUN"],
  ];
  for (const [label, detail, insertText] of keywords) {
    items.push({ label, kind: 14, detail, insertText });
  }

  // 2. DYNAMO cleanroom standard library functions
  for (const schema of getDynamoSchemasFromLibraries()) {
    const sig = (schema.extra?.["signature"] as string | undefined) ?? schema.name;
    items.push({
      label: schema.name,
      kind: 3,
      detail: sig,
      documentation: schema.description,
      insertText: `${schema.name}(`,
    });
  }

  // 3. Declared model symbols
  const model = parseDynamo(content);
  const seen = new Set<string>();
  for (const eq of model.equations) {
    if (seen.has(eq.name)) continue;
    seen.add(eq.name);
    items.push({
      label: eq.name,
      kind: eq.kind === "C" || eq.kind === "T" ? 21 : 6,
      detail: `${KIND_LABELS[eq.kind]} (${eq.rawRhs})`,
      insertText: eq.kind === "L" || eq.kind === "A" ? `${eq.name}.K` : eq.kind === "R" ? `${eq.name}.JK` : eq.name,
    });
  }

  return items;
}
