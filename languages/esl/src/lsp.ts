// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Language Server Protocol (LSP) services for `@modelscript/esl`:
 *  - `validateEsl` (diagnostics)
 *  - `getEslDocumentSymbols` (document outline)
 *  - `getEslHover` (contextual hover for keywords, variables, submodels, and ESA stdlib blocks)
 *  - `getEslCompletions` (keyword, stdlib block, and declared symbol completions)
 *  - `executeEslAction` (domain actions: lint, simulate, to_modelica, to_dae)
 */

import { getEslSchemasFromLibraries, lookupEslModelSchema } from "./catalog/library-package-adapter.js";
import { eslToDae } from "./dae/esl-to-dae.js";
import { lintEsl } from "./lints/index.js";
import { parseEsl } from "./parser/esl-parser.js";
import { eslToModelica } from "./projections/eslToModelica.js";
import { simulateEsl, type EslSimulationOptions } from "./solver/hybrid-solver.js";
import type { EslBlock } from "./types.js";

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

const ESL_KEYWORD_DOCS: Record<string, string> = {
  STUDY: "**STUDY** — Top-level ESA ESL simulation study container holding models, submodels, and experiment setup.",
  MODEL:
    "**MODEL** — Continuous/hybrid dynamical system model with `INITIAL`, `DYNAMIC`, `STEP`, and `TERMINAL` sections.",
  SUBMODEL: "**SUBMODEL** — Reusable parameterized ESL submodel invoked from `MODEL` or `SEGMENT` blocks.",
  SEGMENT: "**SEGMENT** — Independent parallel or sequential simulation segment within an ESL study.",
  PACKAGE: "**PACKAGE** — Shared constants, types, and utility submodel package.",
  INITIAL: "**INITIAL** — Initialization section evaluated once at `t = tStart` before ODE integration begins.",
  DYNAMIC:
    "**DYNAMIC** — Continuous-time differential and algebraic equations (`x' = f(t, x)`) integrated at each step.",
  STEP: "**STEP** — Discrete section executed at each communication interval `CINT`.",
  TERMINAL: "**TERMINAL** — Post-processing section executed once when simulation reaches `TFIN` or `TERMINATE`.",
  WHEN: "**WHEN ... THEN ... END_WHEN** — State-event discontinuity handler triggered on zero-crossing.",
  IF: "**IF ... THEN ... ELSE ... END_IF** — Conditional branch or piecewise-smooth control law.",
  REAL: "**REAL** — Continuous 64-bit floating-point state or algebraic variable.",
  INTEGER: "**INTEGER** — Discrete integer variable.",
  LOGICAL: "**LOGICAL** — Boolean flag (`TRUE` / `FALSE`).",
  CONSTANT: "**CONSTANT** — Immutable simulation parameter.",
  TERMINATE: "**TERMINATE** — Early simulation termination condition.",
};

function spanToRange(span: { line: number; column: number; endLine: number; endColumn: number }): LspRange {
  return {
    start: { line: Math.max(0, span.line - 1), character: Math.max(0, span.column - 1) },
    end: { line: Math.max(0, span.endLine - 1), character: Math.max(1, span.endColumn - 1) },
  };
}

/**
 * Validates an ESL document and returns LSP diagnostics.
 */
export function validateEsl(content: string, _uri = "model.esl"): LspDiagnostic[] {
  const program = parseEsl(content);
  const diags = lintEsl(program);
  return diags.map((d) => {
    const startLine = Math.max(0, (d.line ?? 1) - 1);
    const startChar = Math.max(0, (d.column ?? 1) - 1);
    const endLine = Math.max(startLine, (d.endLine ?? d.line ?? 1) - 1);
    const endChar = Math.max(startChar + 1, (d.endColumn ?? (d.column ?? 1) + 1) - 1);
    return {
      range: {
        start: { line: startLine, character: startChar },
        end: { line: endLine, character: endChar },
      },
      severity: d.severity === "error" ? 1 : d.severity === "warning" ? 2 : 3,
      code: d.id,
      source: "modelscript-esl",
      message: d.message,
    };
  });
}

function blockToSymbol(block: EslBlock): LspDocumentSymbol {
  const kind =
    block.kind === "STUDY" || block.kind === "PACKAGE"
      ? LspSymbolKind.Package
      : block.kind === "SUBMODEL"
        ? LspSymbolKind.Function
        : LspSymbolKind.Class;

  const range = spanToRange(block.span);
  const children: LspDocumentSymbol[] = [];

  for (const decl of block.declarations) {
    const dRange = spanToRange(decl.span);
    children.push({
      name: decl.name,
      detail: decl.isConstant ? `CONSTANT ${decl.dataType}` : decl.dataType,
      kind: decl.isConstant ? LspSymbolKind.Constant : LspSymbolKind.Variable,
      range: dRange,
      selectionRange: dRange,
    });
  }

  for (const child of block.children) {
    children.push(blockToSymbol(child));
  }

  return {
    name: block.name,
    detail: `${block.kind}${block.parameters.length > 0 ? `(${block.parameters.map((p) => p.name).join(", ")})` : ""}`,
    kind,
    range,
    selectionRange: range,
    children,
  };
}

/**
 * Extracts hierarchical LSP DocumentSymbols for an ESL source file.
 */
export function getEslDocumentSymbols(content: string, _uri = "model.esl"): LspDocumentSymbol[] {
  const program = parseEsl(content);
  return program.blocks.map(blockToSymbol);
}

function extractWordAtPosition(content: string, pos: LspPosition): { word: string; range: LspRange } | null {
  const lines = content.split(/\r?\n/);
  const lineText = lines[pos.line];
  if (!lineText) return null;
  const col = Math.min(Math.max(0, pos.character), lineText.length);

  let start = col;
  while (start > 0 && /[A-Za-z0-9_]/.test(lineText[start - 1]!)) start--;
  let end = col;
  while (end < lineText.length && /[A-Za-z0-9_]/.test(lineText[end]!)) end++;

  if (end <= start) return null;
  return {
    word: lineText.slice(start, end),
    range: {
      start: { line: pos.line, character: start },
      end: { line: pos.line, character: end },
    },
  };
}

/**
 * Provides contextual hover markdown for ESL keywords, standard library blocks,
 * declared models/submodels, and variables.
 */
export function getEslHover(content: string, position: LspPosition): LspHover | null {
  const hit = extractWordAtPosition(content, position);
  if (!hit) return null;

  const upper = hit.word.toUpperCase();

  // 1. ESL Keywords
  if (ESL_KEYWORD_DOCS[upper]) {
    return {
      contents: { kind: "markdown", value: ESL_KEYWORD_DOCS[upper]! },
      range: hit.range,
    };
  }

  // 2. Cleanroom ESL standard library blocks
  const stdSchema = lookupEslModelSchema(hit.word);
  if (stdSchema) {
    const paramsDoc = stdSchema.parameters
      .map((p) => `- \`${p.key}\` = \`${p.defaultValue}\`${p.unit ? ` (${p.unit})` : ""}: ${p.description ?? ""}`)
      .join("\n");
    return {
      contents: {
        kind: "markdown",
        value: `### \`${stdSchema.name}\` — ${stdSchema.label}\n\n${stdSchema.description}\n\n**Parameters:**\n${paramsDoc}`,
      },
      range: hit.range,
    };
  }

  // 3. Declared blocks & variables in document
  const program = parseEsl(content);
  const searchBlock = (block: EslBlock): LspHover | null => {
    if (block.name.toUpperCase() === upper) {
      return {
        contents: {
          kind: "markdown",
          value: `**${block.kind} \`${block.name}\`**\n\n- Declarations: ${block.declarations.length}\n- Dynamic statements: ${block.dynamicStatements.length}`,
        },
        range: hit.range,
      };
    }
    for (const d of block.declarations) {
      if (d.name.toUpperCase() === upper) {
        return {
          contents: {
            kind: "markdown",
            value: `**${d.isConstant ? "CONSTANT " : ""}${d.dataType} \`${d.name}\`** (in ${block.kind} \`${block.name}\`)`,
          },
          range: hit.range,
        };
      }
    }
    for (const c of block.children) {
      const found = searchBlock(c);
      if (found) return found;
    }
    return null;
  };

  for (const b of program.blocks) {
    const found = searchBlock(b);
    if (found) return found;
  }

  return null;
}

/**
 * Returns LSP completion items for ESL keywords, ESA stdlib blocks, and in-scope declarations.
 */
export function getEslCompletions(content: string, position: LspPosition): LspCompletionItem[] {
  const hit = extractWordAtPosition(content, position);
  const prefix = hit ? hit.word.toUpperCase() : "";
  const items: LspCompletionItem[] = [];
  const seen = new Set<string>();

  // Keywords (CompletionItemKind.Keyword = 14)
  for (const [kw, doc] of Object.entries(ESL_KEYWORD_DOCS)) {
    if (!prefix || kw.startsWith(prefix)) {
      seen.add(kw);
      items.push({ label: kw, kind: 14, detail: "ESL keyword", documentation: doc });
    }
  }

  // Standard library blocks (CompletionItemKind.Function = 3)
  for (const schema of getEslSchemasFromLibraries()) {
    const key = schema.name.toUpperCase();
    if (!seen.has(key) && (!prefix || key.startsWith(prefix))) {
      seen.add(key);
      items.push({
        label: schema.name,
        kind: 3,
        detail: `ESL stdlib (${schema.category})`,
        documentation: schema.description,
      });
    }
  }

  // Declared variables & submodels in document (CompletionItemKind.Variable = 6)
  const program = parseEsl(content);
  const collectDecls = (block: EslBlock): void => {
    for (const d of block.declarations) {
      const key = d.name.toUpperCase();
      if (!seen.has(key) && (!prefix || key.startsWith(prefix))) {
        seen.add(key);
        items.push({
          label: d.name,
          kind: d.isConstant ? 21 : 6,
          detail: d.isConstant ? `CONSTANT ${d.dataType}` : d.dataType,
        });
      }
    }
    for (const c of block.children) collectDecls(c);
  };
  for (const b of program.blocks) collectDecls(b);

  return items;
}

/**
 * Executes high-level ESL domain actions (lint, simulate, to_modelica, to_dae).
 */
export async function executeEslAction(
  action: "lint" | "simulate" | "to_modelica" | "to_dae",
  params: { content: string; options?: EslSimulationOptions },
): Promise<unknown> {
  switch (action) {
    case "lint":
      return validateEsl(params.content);
    case "simulate":
      return simulateEsl(params.content, params.options);
    case "to_modelica":
      return eslToModelica(params.content);
    case "to_dae": {
      const dae = eslToDae(params.content);
      return { varCount: dae.varCount, eqCount: dae.eqCount };
    }
  }
}
