// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/c — Language Server Protocol (LSP) Service Integration.
 *
 * Provides diagnostic validation, document symbol hierarchy extraction,
 * contextual hover assistance, and intelligent code completions for C source & headers.
 */

import { collectWasmSyntaxErrors, getOrLoadLanguageWasmParser } from "@modelscript/dsl";
import { createWasmParserSync, type SyntaxNode } from "../src-gen/bindings.js";
import { scrapeCHeader } from "./bridge/header-scraper.js";
import { lintCSource, type CDiagnostic, type CLintOptions } from "./lints/rules.js";

/**
 * Replaces C preprocessor directive lines (`#include`, `#define`, etc.) with spaces
 * of identical length so the WASM GLR parser preserves exact line and column offsets.
 */
function blankPreprocessorDirectives(source: string): string {
  return source.replace(/^([ \t]*#[^\r\n]*)/gm, (m) => " ".repeat(m.length));
}

function tryParseCWasm(source: string, cstTree?: { rootNode?: unknown } | null): SyntaxNode | null {
  if (cstTree?.rootNode) {
    return cstTree.rootNode as SyntaxNode;
  }
  try {
    const parser = getOrLoadLanguageWasmParser("c", import.meta.url, createWasmParserSync);
    const tree = parser.parse(blankPreprocessorDirectives(source));
    return (tree?.rootNode as SyntaxNode | undefined) ?? null;
  } catch {
    return null;
  }
}

function nodeToRange(node: SyntaxNode): LspRange {
  return {
    start: { line: node.startPosition.row, character: node.startPosition.column },
    end: { line: node.endPosition.row, character: node.endPosition.column },
  };
}

function unwrapDeclaratorName(declNode: SyntaxNode | null): { name: string; node: SyntaxNode | null } {
  if (!declNode) return { name: "", node: null };
  if (declNode.type === "IDENTIFIER") {
    return { name: declNode.text.trim(), node: declNode };
  }
  const direct = declNode.childForFieldName("name");
  if (direct) return { name: direct.text.trim(), node: direct };
  for (const child of declNode.namedChildren) {
    if (
      child.type === "VariableDeclarator" ||
      child.type === "ArrayDeclarator" ||
      child.type === "FunctionDeclarator" ||
      child.type === "Declarator" ||
      child.type === "IDENTIFIER"
    ) {
      const found = unwrapDeclaratorName(child);
      if (found.name) return found;
    }
  }
  return { name: declNode.text.replace(/^\*+/, "").trim(), node: declNode };
}

function extractStructFieldsFromCst(structSpec: SyntaxNode): LspDocumentSymbol[] {
  const fields: LspDocumentSymbol[] = [];
  const body =
    structSpec.childForFieldName("body") ??
    structSpec.namedChildren.find((c) => c.type === "StructDeclarationList") ??
    null;
  if (!body) return fields;

  for (const fieldDecl of body.namedChildren) {
    if (fieldDecl.type !== "StructFieldDeclaration") continue;
    const typeNode = fieldDecl.childForFieldName("type") ?? fieldDecl.namedChildren[0] ?? null;
    const typeName = typeNode?.text.trim() ?? "";
    const declList =
      fieldDecl.childForFieldName("declarators") ??
      fieldDecl.namedChildren.find((c) => c.type === "StructDeclaratorList") ??
      null;
    const declarators = declList ? declList.namedChildren : [];
    for (const decl of declarators) {
      const { name: fieldName, node: nameNode } = unwrapDeclaratorName(decl);
      if (!fieldName) continue;
      fields.push({
        name: fieldName,
        detail: typeName,
        kind: LspSymbolKind.Field,
        range: nodeToRange(fieldDecl),
        selectionRange: nodeToRange(nameNode ?? decl),
      });
    }
  }
  return fields;
}

function extractCSymbolsFromCst(root: SyntaxNode): LspDocumentSymbol[] {
  const symbols: LspDocumentSymbol[] = [];
  const seenStructs = new Set<number>();

  for (const child of root.namedChildren) {
    if (child.type === "Declaration") {
      const storage = child.childForFieldName("storage");
      const isTypedef =
        storage?.text.trim() === "typedef" ||
        child.namedChildren.some((c) => c.type === "StorageClassSpecifier" && c.text.trim() === "typedef");
      const typeSpec =
        child.childForFieldName("type") ?? child.namedChildren.find((c) => c.type === "TypeSpecifier") ?? null;
      const structSpec =
        typeSpec?.type === "StructSpecifier"
          ? typeSpec
          : (typeSpec?.namedChildren.find((c) => c.type === "StructSpecifier") ?? null);

      if (structSpec && !seenStructs.has(structSpec.id)) {
        const body =
          structSpec.childForFieldName("body") ??
          structSpec.namedChildren.find((c) => c.type === "StructDeclarationList") ??
          null;
        if (body) {
          seenStructs.add(structSpec.id);
          const nameNode = structSpec.childForFieldName("name");
          const structName = nameNode?.text.trim() ?? "";
          let alias: string | undefined;
          if (isTypedef) {
            const initList =
              child.childForFieldName("declarators") ??
              child.namedChildren.find((c) => c.type === "InitDeclaratorList") ??
              null;
            const firstInit = initList?.namedChildren[0] ?? null;
            const decl = firstInit?.childForFieldName("declarator") ?? firstInit?.namedChildren[0] ?? null;
            const { name } = unwrapDeclaratorName(decl);
            if (name) alias = name;
          }

          const fields = extractStructFieldsFromCst(structSpec);
          const displayName = structName
            ? alias
              ? `struct ${structName} (${alias})`
              : `struct ${structName}`
            : alias
              ? `struct ${alias}`
              : "struct (anonymous)";

          symbols.push({
            name: displayName,
            detail: isTypedef ? `typedef struct ${structName || alias || ""}`.trim() : `struct ${structName}`.trim(),
            kind: LspSymbolKind.Struct,
            range: nodeToRange(child),
            selectionRange: nodeToRange(nameNode ?? structSpec),
            children: fields,
          });
        }
      }
    } else if (child.type === "FunctionDefinition") {
      const returnType = child.childForFieldName("returnType")?.text.trim() ?? "void";
      const decl =
        child.childForFieldName("declarator") ??
        child.namedChildren.find((c) => c.type === "FunctionDeclarator") ??
        null;
      const nameNode = decl?.childForFieldName("name") ?? null;
      const fnName = nameNode?.text.trim() ?? "";
      if (!fnName) continue;
      const paramsNode =
        decl?.childForFieldName("parameters") ?? decl?.namedChildren.find((c) => c.type === "ParameterList") ?? null;
      const params = paramsNode?.text.trim() ?? "";

      symbols.push({
        name: `${fnName}(${params})`,
        detail: `${returnType} ${fnName}`,
        kind: LspSymbolKind.Function,
        range: nodeToRange(child),
        selectionRange: nodeToRange(nameNode ?? decl ?? child),
      });
    }
  }

  return symbols;
}

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
export function validateC(
  source: string,
  options: CLintOptions = {},
  cstTree?: { rootNode?: unknown } | null,
): LspDiagnostic[] {
  const diags: LspDiagnostic[] = [];

  const lines = source.split(/\r?\n/);

  // 1. Run static lint rules
  const rawLints: CDiagnostic[] = lintCSource(source, options);
  for (const lint of rawLints) {
    const lineNum = Math.min(Math.max(0, (lint.line ?? 1) - 1), Math.max(0, lines.length - 1));
    const lineText = lines[lineNum] ?? "";
    let colNum = Math.max(0, Math.min((lint.col ?? 1) - 1, lineText.length));
    while (colNum < lineText.length && (lineText[colNum] === " " || lineText[colNum] === "\t")) {
      colNum++;
    }
    const tok = lineText.slice(colNum).match(/^[A-Za-z_][A-Za-z0-9_]*|^[0-9]+(?:\.[0-9]+)?|^[^\s;(){},]+/);
    const endCol = Math.min(lineText.length, colNum + (tok ? tok[0].length : 1));
    let sev: 1 | 2 | 3 | 4 = 1;
    if (lint.severity === "warning") sev = 2;
    else if (lint.severity === "info") sev = 3;

    diags.push({
      range: {
        start: { line: lineNum, character: colNum },
        end: { line: lineNum, character: endCol },
      },
      severity: sev,
      code: `M${lint.code}`,
      source: "c-linter",
      message: lint.message,
    });
  }

  // 2. Structural syntax check via WASM GLR CST (with clean fallback if WASM is unavailable)
  const root = tryParseCWasm(source, cstTree);
  if (root) {
    const syntaxErrors = collectWasmSyntaxErrors(root);
    for (const err of syntaxErrors) {
      diags.push({
        range: {
          start: { line: Math.max(0, err.startLine - 1), character: Math.max(0, err.startColumn - 1) },
          end: { line: Math.max(0, err.endLine - 1), character: Math.max(0, err.endColumn - 1) },
        },
        severity: 1,
        code: "M8400",
        source: "c-parser",
        message: err.message,
      });
    }
    if (syntaxErrors.length === 0 && root.hasError) {
      const ep = root.endPosition ?? { row: Math.max(0, lines.length - 1), column: 0 };
      diags.push({
        range: {
          start: { line: Math.max(0, ep.row), character: Math.max(0, ep.column - 1) },
          end: { line: Math.max(0, ep.row), character: Math.max(1, ep.column) },
        },
        severity: 1,
        code: "M8400",
        source: "c-parser",
        message: "Syntax error: incomplete or invalid C construct.",
      });
    }
    return diags;
  }

  // Fallback balanced-delimiter check when WASM parser is unavailable
  let braceCount = 0;
  let parenCount = 0;
  let bracketCount = 0;
  for (let l = 0; l < lines.length; l++) {
    const line = lines[l]!;
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
      range: { start: { line: lines.length - 1, character: 0 }, end: { line: lines.length - 1, character: 1 } },
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
export function getCDocumentSymbols(source: string, cstTree?: { rootNode?: unknown } | null): LspDocumentSymbol[] {
  const root = tryParseCWasm(source, cstTree);
  if (root) {
    const cstSymbols = extractCSymbolsFromCst(root);
    if (cstSymbols.length > 0 || !root.hasError) {
      return cstSymbols;
    }
  }

  // Fallback when WASM parser is unavailable or failed to recover symbols
  const symbols: LspDocumentSymbol[] = [];

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
export function getCHover(
  source: string,
  pos: LspPosition,
  cstTree?: { rootNode?: unknown } | null,
): LspHover | undefined {
  let word = "";
  let hoverRange: LspRange | undefined;

  const root = tryParseCWasm(source, cstTree);
  if (root) {
    const target = root.descendantForPosition({ row: pos.line, column: pos.character });
    if (target) {
      const candidate = target.text.trim();
      if (/^[a-zA-Z_]\w*$/.test(candidate)) {
        word = candidate;
        hoverRange = nodeToRange(target);
      }
    }
  }

  if (!word) {
    const lines = source.split(/\r?\n/);
    if (pos.line >= lines.length) return undefined;
    const line = lines[pos.line] ?? "";
    const left = line.slice(0, pos.character).match(/[a-zA-Z_]\w*$/);
    const right = line.slice(pos.character).match(/^[a-zA-Z_]\w*/);
    if (!left && !right) return undefined;
    word = (left ? left[0] : "") + (right ? right[0] : "");
    if (!word) return undefined;
  }

  if (C_KEYWORDS_HOVER[word]) {
    return {
      contents: {
        kind: "markdown",
        value: C_KEYWORDS_HOVER[word]!,
      },
      ...(hoverRange ? { range: hoverRange } : {}),
    };
  }

  // Look up function or struct in CST first
  if (root) {
    for (const child of root.namedChildren) {
      if (child.type === "FunctionDefinition") {
        const decl =
          child.childForFieldName("declarator") ??
          child.namedChildren.find((c) => c.type === "FunctionDeclarator") ??
          null;
        const fnName = decl?.childForFieldName("name")?.text.trim();
        if (fnName === word) {
          const returnType = child.childForFieldName("returnType")?.text.trim() ?? "void";
          const paramsNode =
            decl?.childForFieldName("parameters") ??
            decl?.namedChildren.find((c) => c.type === "ParameterList") ??
            null;
          const params = paramsNode
            ? paramsNode.namedChildren
                .filter((p) => p.type === "ParameterDeclaration")
                .map((p) => `  ${p.text.trim()}`)
                .join(",\n")
            : "";
          return {
            contents: {
              kind: "markdown",
              value: "```c\n" + `${returnType} ${fnName}(\n${params}\n);\n` + "```\n\n*C Function Definition*",
            },
            ...(hoverRange ? { range: hoverRange } : {}),
          };
        }
      } else if (child.type === "Declaration") {
        const typeSpec =
          child.childForFieldName("type") ?? child.namedChildren.find((c) => c.type === "TypeSpecifier") ?? null;
        const structSpec =
          typeSpec?.type === "StructSpecifier"
            ? typeSpec
            : (typeSpec?.namedChildren.find((c) => c.type === "StructSpecifier") ?? null);
        if (structSpec) {
          const structName = structSpec.childForFieldName("name")?.text.trim();
          const initList =
            child.childForFieldName("declarators") ??
            child.namedChildren.find((c) => c.type === "InitDeclaratorList") ??
            null;
          const alias = unwrapDeclaratorName(
            initList?.namedChildren[0]?.childForFieldName("declarator") ?? initList?.namedChildren[0] ?? null,
          ).name;
          if (structName === word || alias === word) {
            const fields = extractStructFieldsFromCst(structSpec)
              .map((f) => `  ${f.detail ?? ""} ${f.name};`.trimStart())
              .map((s) => `  ${s}`)
              .join("\n");
            const displayName = structName || alias;
            return {
              contents: {
                kind: "markdown",
                value:
                  "```c\n" +
                  `typedef struct ${displayName} {\n${fields}\n} ${alias || displayName};\n` +
                  "```\n\n*C Struct Definition*",
              },
              ...(hoverRange ? { range: hoverRange } : {}),
            };
          }
        }
      }
    }
  }

  // Fallback to header scraper for prototypes / declarations not matched above
  const scraped = scrapeCHeader(source);
  const fn = scraped.functions.find((f) => f.name === word);
  if (fn) {
    const params = fn.params.map((p) => `  ${p.type} ${p.name}`).join(",\n");
    return {
      contents: {
        kind: "markdown",
        value: "```c\n" + `${fn.returnType} ${fn.name}(\n${params}\n);\n` + "```\n\n*C Function Prototype*",
      },
      ...(hoverRange ? { range: hoverRange } : {}),
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
      ...(hoverRange ? { range: hoverRange } : {}),
    };
  }

  return {
    contents: {
      kind: "markdown",
      value: `\`${word}\` (C identifier)`,
    },
    ...(hoverRange ? { range: hoverRange } : {}),
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
