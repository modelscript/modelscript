// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/c — Language Server Protocol (LSP) Service Integration.
 *
 * Provides diagnostic validation, document symbol hierarchy extraction,
 * contextual hover assistance, and intelligent code completions for C source & headers.
 */

import { scrapeCHeader } from "./bridge/header-scraper.js";
import { lintCSource, type CDiagnostic, type CLintOptions } from "./lints/rules.js";

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
  code: string | number;
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
 * Validates C source code returning LSP diagnostics.
 */
export function validateC(source: string, options: CLintOptions = {}): LspDiagnostic[] {
  const diags: LspDiagnostic[] = [];

  // 1. Run static lint rules
  const rawLints: CDiagnostic[] = lintCSource(source, options);
  for (const lint of rawLints) {
    const lineNum = Math.max(0, (lint.line ?? 1) - 1);
    const colNum = Math.max(0, (lint.col ?? 1) - 1);
    let sev: 1 | 2 | 3 | 4 = 1;
    if (lint.severity === "warning") sev = 2;
    else if (lint.severity === "info") sev = 3;

    diags.push({
      range: {
        start: { line: lineNum, character: colNum },
        end: { line: lineNum, character: colNum + 10 },
      },
      severity: sev,
      code: `M${lint.code}`,
      source: "c-linter",
      message: lint.message,
    });
  }

  // 2. Structural syntax check: verify balanced brackets/braces/parentheses
  let braceCount = 0;
  let parenCount = 0;
  let bracketCount = 0;
  const rawLines = source.split(/\r?\n/);
  for (let l = 0; l < rawLines.length; l++) {
    const line = rawLines[l]!;
    // Skip comments and strings in basic check
    const stripped = line.replace(/\/\/.*/, "").replace(/"(?:[^"\\]|\\.)*"/g, '""');
    for (let c = 0; c < stripped.length; c++) {
      const ch = stripped[c];
      if (ch === "{") braceCount++;
      else if (ch === "}") braceCount--;
      else if (ch === "(") parenCount++;
      else if (ch === ")") parenCount--;
      else if (ch === "[") bracketCount++;
      else if (ch === "]") bracketCount--;

      if (braceCount < 0 || parenCount < 0 || bracketCount < 0) {
        diags.push({
          range: {
            start: { line: l, character: c },
            end: { line: l, character: c + 1 },
          },
          severity: 1,
          code: "M8400",
          source: "c-parser",
          message: `Unmatched closing '${ch}' at line ${l + 1}:${c + 1}.`,
        });
        braceCount = Math.max(0, braceCount);
        parenCount = Math.max(0, parenCount);
        bracketCount = Math.max(0, bracketCount);
      }
    }
  }

  if (braceCount > 0) {
    diags.push({
      range: { start: { line: rawLines.length - 1, character: 0 }, end: { line: rawLines.length - 1, character: 1 } },
      severity: 1,
      code: "M8400",
      source: "c-parser",
      message: `Unclosed '{' (missing ${braceCount} closing brace(s)).`,
    });
  }

  return diags;
}

/**
 * Extracts hierarchical document symbols (functions, structs, fields, global declarations).
 */
export function getCDocumentSymbols(source: string): LspDocumentSymbol[] {
  const symbols: LspDocumentSymbol[] = [];

  // Match typedef struct Name { ... } Alias; or struct Name { ... };
  const structRegex = /(?:typedef\s+)?struct\s+([A-Za-z0-9_]+)\s*\{([^}]*)\}\s*([A-Za-z0-9_]+)?\s*;/g;
  let sMatch: RegExpExecArray | null;
  while ((sMatch = structRegex.exec(source)) !== null) {
    const structName = sMatch[1]!;
    const body = sMatch[2]!;
    const alias = sMatch[3];
    const lineIdx = source.slice(0, sMatch.index).split("\n").length - 1;
    const range: LspRange = {
      start: { line: lineIdx, character: 0 },
      end: { line: lineIdx, character: structName.length },
    };

    const fields: LspDocumentSymbol[] = [];
    const fieldLines = body.split(";");
    for (const f of fieldLines) {
      const trimmed = f.trim();
      if (!trimmed) continue;
      const parts = trimmed.split(/\s+/);
      if (parts.length >= 2) {
        const fieldName = parts[parts.length - 1]!.replace(/^\*+/, "");
        const typeName = parts.slice(0, -1).join(" ").trim();
        fields.push({
          name: fieldName,
          detail: typeName,
          kind: LspSymbolKind.Field,
          range,
          selectionRange: range,
        });
      }
    }

    symbols.push({
      name: alias ? `struct ${structName} (${alias})` : `struct ${structName}`,
      detail: `typedef struct ${structName}`,
      kind: LspSymbolKind.Struct,
      range,
      selectionRange: range,
      children: fields,
    });
  }

  // Regex-based scan for function definitions and declarations
  const fnRegex = /\b([a-zA-Z_]\w*(?:\s*\*+)?)\s+([a-zA-Z_]\w*)\s*\(([^)]*)\)\s*\{/g;
  let match: RegExpExecArray | null;
  while ((match = fnRegex.exec(source)) !== null) {
    const returnType = match[1]?.trim() ?? "void";
    const fnName = match[2]?.trim() ?? "";
    const params = match[3]?.trim() ?? "";

    if (["if", "while", "for", "switch"].includes(fnName)) continue;
    if (symbols.some((s) => s.name.startsWith(fnName))) continue;

    const lineIdx = source.slice(0, match.index).split("\n").length - 1;
    const range: LspRange = {
      start: { line: lineIdx, character: 0 },
      end: { line: lineIdx, character: fnName.length },
    };

    symbols.push({
      name: `${fnName}(${params})`,
      detail: `${returnType} ${fnName}`,
      kind: LspSymbolKind.Function,
      range,
      selectionRange: range,
    });
  }

  return symbols;
}

const C_KEYWORDS_HOVER: Record<string, string> = {
  int: "`int` — Signed standard integer type (at least 16 bits, typically 32 bits).",
  double: "`double` — IEEE 754 double precision floating point number (64 bits).",
  float: "`float` — IEEE 754 single precision floating point number (32 bits).",
  void: "`void` — Empty or incomplete type / function returning no value.",
  char: "`char` — 8-bit character integer type.",
  struct: "`struct` — Aggregate data structure definition.",
  typedef: "`typedef` — Type alias declaration.",
  static: "`static` — Internal linkage or persistent storage duration.",
  const: "`const` — Read-only type qualifier.",
  extern: "`extern` — External linkage declaration.",
  return: "`return` — Returns execution and an optional value from a function.",
  sizeof: "`sizeof` — Compile-time byte size operator.",
};

/**
 * Returns contextual hover documentation for the token under the cursor.
 */
export function getCHover(source: string, pos: LspPosition): LspHover | undefined {
  const lines = source.split(/\r?\n/);
  if (pos.line >= lines.length) return undefined;
  const line = lines[pos.line] ?? "";

  // Find word at pos.character
  const left = line.slice(0, pos.character).match(/[a-zA-Z_]\w*$/);
  const right = line.slice(pos.character).match(/^[a-zA-Z_]\w*/);
  if (!left && !right) return undefined;

  const word = (left ? left[0] : "") + (right ? right[0] : "");
  if (!word) return undefined;

  if (C_KEYWORDS_HOVER[word]) {
    return {
      contents: {
        kind: "markdown",
        value: C_KEYWORDS_HOVER[word]!,
      },
    };
  }

  // Look for function definition or struct
  const scraped = scrapeCHeader(source);
  const fn = scraped.functions.find((f) => f.name === word);
  if (fn) {
    const params = fn.params.map((p) => `  ${p.type} ${p.name}`).join(",\n");
    return {
      contents: {
        kind: "markdown",
        value: "```c\n" + `${fn.returnType} ${fn.name}(\n${params}\n);\n` + "```\n\n*C Function Prototype*",
      },
    };
  }

  const st = scraped.structs.find((s) => s.name === word);
  if (st) {
    const fields = st.fields.map((f) => `  ${f.type} ${f.name};`).join("\n");
    return {
      contents: {
        kind: "markdown",
        value: "```c\n" + `typedef struct ${st.name} {\n${fields}\n} ${st.name};\n` + "```\n\n*C Struct Definition*",
      },
    };
  }

  return {
    contents: {
      kind: "markdown",
      value: `\`${word}\` (C identifier)`,
    },
  };
}

/**
 * Provides intelligent completion suggestions.
 */
export function getCCompletions(_source: string, _pos: LspPosition): LspCompletionItem[] {
  const items: LspCompletionItem[] = [
    { label: "int", kind: 14, detail: "Primitive 32-bit signed integer" },
    { label: "double", kind: 14, detail: "Primitive 64-bit IEEE float" },
    { label: "float", kind: 14, detail: "Primitive 32-bit IEEE float" },
    { label: "char", kind: 14, detail: "Primitive 8-bit character" },
    { label: "void", kind: 14, detail: "Void return / empty type" },
    { label: "struct", kind: 7, detail: "Struct definition", insertText: "struct ${1:Name} {\n\t$0\n};" },
    { label: "typedef", kind: 14, detail: "Type definition" },
    { label: "return", kind: 14, detail: "Return statement" },
    { label: "sizeof", kind: 3, detail: "Sizeof operator" },
    { label: "printf", kind: 3, detail: "int printf(const char *format, ...)" },
    { label: "malloc", kind: 3, detail: "void *malloc(size_t size)" },
    { label: "free", kind: 3, detail: "void free(void *ptr)" },
    { label: "memcpy", kind: 3, detail: "void *memcpy(void *dest, const void *src, size_t n)" },
  ];
  return items;
}

/**
 * Unified C Language Server Protocol Service.
 */
export class CLspService {
  validate(source: string, options?: CLintOptions): LspDiagnostic[] {
    return validateC(source, options);
  }

  getDocumentSymbols(source: string): LspDocumentSymbol[] {
    return getCDocumentSymbols(source);
  }

  getHover(source: string, pos: LspPosition): LspHover | undefined {
    return getCHover(source, pos);
  }

  getCompletions(source: string, pos: LspPosition): LspCompletionItem[] {
    return getCCompletions(source, pos);
  }
}
