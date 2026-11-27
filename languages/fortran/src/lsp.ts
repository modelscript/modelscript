// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/fortran — Language Server Protocol (LSP) Service Integration.
 *
 * Provides diagnostic validation, hierarchical document symbols (programs, modules, subroutines, functions),
 * contextual hover assistance with intrinsic procedure specs, and intelligent code completions for Fortran 90/95/2003/2008.
 */

import { getOrLoadLanguageWasmParser } from "@modelscript/dsl";
import { createWasmParserSync, type SyntaxNode } from "../src-gen/bindings.js";
import { verifyFortranSource } from "./formal/verifier.js";
import { lintFortranSource, type FortranDiagnostic } from "./lints/index.js";

function tryParseFortranWasm(source: string, cstTree?: { rootNode?: unknown } | null): SyntaxNode | null {
  if (cstTree?.rootNode) {
    return cstTree.rootNode as SyntaxNode;
  }
  try {
    const parser = getOrLoadLanguageWasmParser("fortran", import.meta.url, createWasmParserSync);
    const tree = parser.parse(source);
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

function extractFortranSymbolsFromCst(root: SyntaxNode): LspDocumentSymbol[] {
  const symbols: LspDocumentSymbol[] = [];

  const visitUnit = (node: SyntaxNode, parentChildren: LspDocumentSymbol[] | null): void => {
    if (node.type === "ProgramDeclaration") {
      const nameNode = node.childForFieldName("name");
      const name = nameNode?.text.trim() ?? "";
      if (!name) return;
      const children: LspDocumentSymbol[] = [];
      for (const child of node.namedChildren) {
        if (child.type === "SubroutineDeclaration" || child.type === "FunctionDeclaration") {
          visitUnit(child, children);
        }
      }
      const sym: LspDocumentSymbol = {
        name: `program ${name}`,
        detail: "Main Program Unit",
        kind: LspSymbolKind.Module,
        range: nodeToRange(node),
        selectionRange: nodeToRange(nameNode ?? node),
        children,
      };
      (parentChildren ?? symbols).push(sym);
      return;
    }

    if (node.type === "ModuleDeclaration") {
      const nameNode = node.childForFieldName("name");
      const name = nameNode?.text.trim() ?? "";
      if (!name) return;
      const children: LspDocumentSymbol[] = [];
      for (const child of node.namedChildren) {
        if (child.type === "SubroutineDeclaration" || child.type === "FunctionDeclaration") {
          visitUnit(child, children);
        }
      }
      const sym: LspDocumentSymbol = {
        name: `module ${name}`,
        detail: "Fortran Module",
        kind: LspSymbolKind.Package,
        range: nodeToRange(node),
        selectionRange: nodeToRange(nameNode ?? node),
        children,
      };
      (parentChildren ?? symbols).push(sym);
      return;
    }

    if (node.type === "SubroutineDeclaration") {
      const nameNode = node.childForFieldName("name");
      const name = nameNode?.text.trim() ?? "";
      if (!name) return;
      const params =
        node.childForFieldName("parameters")?.text.trim() ??
        node.namedChildren.find((c) => c.type === "ParameterList")?.text.trim() ??
        "";
      const sym: LspDocumentSymbol = {
        name: `${name}(${params})`,
        detail: `subroutine ${name}`,
        kind: LspSymbolKind.Method,
        range: nodeToRange(node),
        selectionRange: nodeToRange(nameNode ?? node),
      };
      (parentChildren ?? symbols).push(sym);
      return;
    }

    if (node.type === "FunctionDeclaration") {
      const nameNode = node.childForFieldName("name");
      const name = nameNode?.text.trim() ?? "";
      if (!name) return;
      const params =
        node.childForFieldName("parameters")?.text.trim() ??
        node.namedChildren.find((c) => c.type === "ParameterList")?.text.trim() ??
        "";
      const sym: LspDocumentSymbol = {
        name: `${name}(${params})`,
        detail: `function ${name}`,
        kind: LspSymbolKind.Function,
        range: nodeToRange(node),
        selectionRange: nodeToRange(nameNode ?? node),
      };
      (parentChildren ?? symbols).push(sym);
      return;
    }

    for (const child of node.namedChildren) {
      visitUnit(child, parentChildren);
    }
  };

  visitUnit(root, null);
  return symbols;
}

function findFortranSymbolHoverInCst(root: SyntaxNode, lowerWord: string): string | null {
  const stack: SyntaxNode[] = [root];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node.type === "SubroutineDeclaration") {
      const name = node.childForFieldName("name")?.text.trim();
      if (name && name.toLowerCase() === lowerWord) {
        const params =
          node.childForFieldName("parameters")?.text.trim() ??
          node.namedChildren.find((c) => c.type === "ParameterList")?.text.trim() ??
          "";
        return "```fortran\n" + `subroutine ${name}(${params})\n` + "```\n\n*Fortran Subroutine*";
      }
    } else if (node.type === "FunctionDeclaration") {
      const name = node.childForFieldName("name")?.text.trim();
      if (name && name.toLowerCase() === lowerWord) {
        const ret = node.childForFieldName("returnType")?.text.trim();
        const params =
          node.childForFieldName("parameters")?.text.trim() ??
          node.namedChildren.find((c) => c.type === "ParameterList")?.text.trim() ??
          "";
        const prefix = ret ? `${ret} ` : "";
        return "```fortran\n" + `${prefix}function ${name}(${params})\n` + "```\n\n*Fortran Function*";
      }
    } else if (node.type === "ModuleDeclaration") {
      const name = node.childForFieldName("name")?.text.trim();
      if (name && name.toLowerCase() === lowerWord) {
        return "```fortran\n" + `module ${name}\n` + "```\n\n*Fortran Module*";
      }
    } else if (node.type === "ProgramDeclaration") {
      const name = node.childForFieldName("name")?.text.trim();
      if (name && name.toLowerCase() === lowerWord) {
        return "```fortran\n" + `program ${name}\n` + "```\n\n*Fortran Main Program*";
      }
    }
    for (let i = node.namedChildren.length - 1; i >= 0; i--) {
      stack.push(node.namedChildren[i]!);
    }
  }
  return null;
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
  insertText?: string | undefined;
}

/**
 * Validates Fortran source returning LSP diagnostics.
 */
export function validateFortran(source: string, _cstTree?: { rootNode?: unknown } | null): LspDiagnostic[] {
  const diags: LspDiagnostic[] = [];
  const rawLints: FortranDiagnostic[] = lintFortranSource(source);

  const lines = source.split(/\r?\n/);

  for (const lint of rawLints) {
    const lineNum = Math.min(Math.max(0, (lint.line ?? 1) - 1), Math.max(0, lines.length - 1));
    const lineText = lines[lineNum] ?? "";
    let colNum = Math.max(0, Math.min((lint.column ?? 1) - 1, lineText.length));
    while (colNum < lineText.length && (lineText[colNum] === " " || lineText[colNum] === "\t")) {
      colNum++;
    }
    const tok = lineText.slice(colNum).match(/^[A-Za-z_][A-Za-z0-9_]*|^[0-9]+(?:\.[0-9]+)?|^[^\s,;()]+/);
    const fallbackEndCol = Math.min(lineText.length, colNum + (tok ? tok[0].length : 1));
    let sev: 1 | 2 | 3 | 4 = 1;
    if (lint.severity === "warning") sev = 2;
    else if (lint.severity === "info") sev = 3;

    diags.push({
      range: {
        start: { line: lineNum, character: colNum },
        end: {
          line: lint.endLine !== undefined ? Math.max(0, lint.endLine - 1) : lineNum,
          character: lint.endColumn !== undefined ? Math.max(colNum + 1, lint.endColumn - 1) : fallbackEndCol,
        },
      },
      severity: sev,
      code: lint.id,
      source: "fortran-linter",
      message: lint.message,
    });
  }

  // Run formal CFG abstract interpretation & DAE reachability verification
  try {
    const verification = verifyFortranSource(source);
    for (const check of verification.checks) {
      if (check.verdict !== "definite_bug" && check.verdict !== "potential_bug") continue;
      const line0 = Math.max(0, (check.astNodeId ?? 1) - 1);
      const alreadyReportedOnLine = diags.some(
        (d) =>
          d.range.start.line === line0 &&
          ((check.category === "division_by_zero" && String(d.code).includes("4072")) ||
            (check.category === "math_domain" && String(d.code).includes("4084")) ||
            (check.category === "array_out_of_bounds" && String(d.code).includes("4073"))),
      );
      if (!alreadyReportedOnLine) {
        const lineText = lines[line0] ?? "";
        let startChar = 0;
        while (startChar < lineText.length && (lineText[startChar] === " " || lineText[startChar] === "\t")) {
          startChar++;
        }
        if (startChar >= lineText.length) startChar = 0;
        diags.push({
          severity: check.verdict === "definite_bug" ? 1 : 2,
          range: {
            start: { line: line0, character: startChar },
            end: { line: line0, character: Math.max(startChar + 1, lineText.length) },
          },
          code: "M4085",
          message: `[M4085] Formal Verifier (${check.category}): ${check.description}`,
          source: "fortran-verifier",
        });
      }
    }
  } catch {
    // Formal verifier is best-effort on incomplete/invalid source
  }

  return diags;
}

/**
 * Extracts hierarchical document symbols for programs, modules, subroutines, and functions.
 */
export function getFortranDocumentSymbols(
  source: string,
  cstTree?: { rootNode?: unknown } | null,
): LspDocumentSymbol[] {
  const root = tryParseFortranWasm(source, cstTree);
  if (root) {
    const cstSymbols = extractFortranSymbolsFromCst(root);
    if (cstSymbols.length > 0 || !root.hasError) {
      return cstSymbols;
    }
  }

  // Fallback for F90/F95 constructs not yet covered by the WASM grammar or when WASM is unavailable
  const symbols: LspDocumentSymbol[] = [];
  const lines = source.split(/\r?\n/);

  let currentParent: LspDocumentSymbol | null = null;

  for (let idx = 0; idx < lines.length; idx++) {
    const rawLine = lines[idx]!;
    const line = rawLine.replace(/!.*$/, "").trim(); // strip comments
    if (!line) continue;

    // 1. Program
    const progMatch = line.match(/^program\s+([a-zA-Z_]\w*)/i);
    if (progMatch) {
      const progName = progMatch[1]!;
      const sym: LspDocumentSymbol = {
        name: `program ${progName}`,
        detail: "Main Program Unit",
        kind: LspSymbolKind.Module,
        range: { start: { line: idx, character: 0 }, end: { line: idx, character: line.length } },
        selectionRange: { start: { line: idx, character: 0 }, end: { line: idx, character: line.length } },
        children: [],
      };
      symbols.push(sym);
      currentParent = sym;
      continue;
    }

    // 2. Module
    const modMatch = line.match(/^module\s+([a-zA-Z_]\w*)/i);
    if (modMatch && !line.match(/^module\s+procedure/i)) {
      const modName = modMatch[1]!;
      const sym: LspDocumentSymbol = {
        name: `module ${modName}`,
        detail: "Fortran Module",
        kind: LspSymbolKind.Package,
        range: { start: { line: idx, character: 0 }, end: { line: idx, character: line.length } },
        selectionRange: { start: { line: idx, character: 0 }, end: { line: idx, character: line.length } },
        children: [],
      };
      symbols.push(sym);
      currentParent = sym;
      continue;
    }

    // 3. Subroutine
    const subMatch = line.match(/\bsubroutine\s+([a-zA-Z_]\w*)\s*(?:\(([^)]*)\))?/i);
    if (subMatch && !line.match(/^end\s+subroutine/i)) {
      const subName = subMatch[1]!;
      const params = subMatch[2] ?? "";
      const sym: LspDocumentSymbol = {
        name: `${subName}(${params})`,
        detail: `subroutine ${subName}`,
        kind: LspSymbolKind.Method,
        range: { start: { line: idx, character: 0 }, end: { line: idx, character: line.length } },
        selectionRange: { start: { line: idx, character: 0 }, end: { line: idx, character: line.length } },
      };

      if (currentParent && currentParent.children) {
        currentParent.children.push(sym);
      } else {
        symbols.push(sym);
      }
      continue;
    }

    // 4. Function
    const fnMatch = line.match(/\bfunction\s+([a-zA-Z_]\w*)\s*(?:\(([^)]*)\))?/i);
    if (fnMatch && !line.match(/^end\s+function/i)) {
      const fnName = fnMatch[1]!;
      const params = fnMatch[2] ?? "";
      const sym: LspDocumentSymbol = {
        name: `${fnName}(${params})`,
        detail: `function ${fnName}`,
        kind: LspSymbolKind.Function,
        range: { start: { line: idx, character: 0 }, end: { line: idx, character: line.length } },
        selectionRange: { start: { line: idx, character: 0 }, end: { line: idx, character: line.length } },
      };

      if (currentParent && currentParent.children) {
        currentParent.children.push(sym);
      } else {
        symbols.push(sym);
      }
      continue;
    }

    // 5. End of parent unit
    if (line.match(/^end\s+(?:program|module)\b/i)) {
      if (currentParent) {
        currentParent.range.end = { line: idx, character: line.length };
      }
      currentParent = null;
    }
  }

  return symbols;
}

const FORTRAN_INTRINSICS: Record<string, string> = {
  matmul: "### `matmul(matrix_a, matrix_b)`\nPerforms matrix multiplication of two matrices or a matrix and vector.",
  dot_product: "### `dot_product(vector_a, vector_b)`\nComputes the scalar dot product of two numeric vectors.",
  size: "### `size(array, [dim, kind])`\nReturns the extent of an array along a specified dimension or the total count.",
  shape: "### `shape(source, [kind])`\nReturns the shape vector representing dimensions of an array.",
  reshape:
    "### `reshape(source, shape, [pad, order])`\nConstructs an array with specified shape from elements of source array.",
  allocated: "### `allocated(array)`\nReturns `.true.` if an allocatable array is currently allocated.",
  sum: "### `sum(array, [dim, mask])`\nReturns the sum of all elements along specified array dimensions.",
  maxval: "### `maxval(array, [dim, mask])`\nReturns the maximum value of array elements.",
  minval: "### `minval(array, [dim, mask])`\nReturns the minimum value of array elements.",
  sqrt: "### `sqrt(x)`\nCalculates the principal square root of an argument `x >= 0`.",
  sin: "### `sin(x)`\nComputes the sine of an angle `x` specified in radians.",
  cos: "### `cos(x)`\nComputes the cosine of an angle `x` specified in radians.",
  exp: "### `exp(x)`\nComputes the exponential function $e^x$.",
  log: "### `log(x)`\nComputes the natural logarithm $\\ln(x)$ for $x > 0$.",
  implicit:
    "### `implicit none`\nDisables implicit data typing based on initial letters, requiring all variables to be explicitly declared.",
};

/**
 * Returns contextual hover documentation for Fortran keywords, intrinsics, and symbols.
 */
export function getFortranHover(
  source: string,
  pos: LspPosition,
  cstTree?: { rootNode?: unknown } | null,
): LspHover | undefined {
  let word = "";
  let hoverRange: LspRange | undefined;

  const root = tryParseFortranWasm(source, cstTree);
  if (root) {
    const target = root.descendantForPosition({ row: pos.line, column: pos.character });
    if (target) {
      const candidate = target.text.trim();
      if (/^[a-zA-Z_]\w*$/.test(candidate)) {
        word = candidate.toLowerCase();
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
    word = ((left ? left[0] : "") + (right ? right[0] : "")).toLowerCase();
    if (!word) return undefined;
  }

  if (FORTRAN_INTRINSICS[word]) {
    return {
      contents: {
        kind: "markdown",
        value: FORTRAN_INTRINSICS[word]!,
      },
      ...(hoverRange ? { range: hoverRange } : {}),
    };
  }

  if (root) {
    const cstDoc = findFortranSymbolHoverInCst(root, word);
    if (cstDoc) {
      return {
        contents: {
          kind: "markdown",
          value: cstDoc,
        },
        ...(hoverRange ? { range: hoverRange } : {}),
      };
    }
  }

  return {
    contents: {
      kind: "markdown",
      value: `\`${word}\` (Fortran procedure / variable)`,
    },
    ...(hoverRange ? { range: hoverRange } : {}),
  };
}

/**
 * Intelligent completion proposals for Fortran language constructs.
 */
export function getFortranCompletions(_source: string, _pos: LspPosition): LspCompletionItem[] {
  return [
    { label: "implicit none", kind: 14, detail: "Strict typing directive" },
    {
      label: "subroutine",
      kind: 7,
      detail: "Subroutine definition",
      insertText: "subroutine ${1:name}(${2:args})\n\timplicit none\n\t$0\nend subroutine ${1:name}",
    },
    {
      label: "function",
      kind: 7,
      detail: "Function definition",
      insertText: "function ${1:name}(${2:args}) result(${3:res})\n\timplicit none\n\t$0\nend function ${1:name}",
    },
    {
      label: "module",
      kind: 7,
      detail: "Module definition",
      insertText: "module ${1:name}\n\timplicit none\n\tcontains\n\t$0\nend module ${1:name}",
    },
    {
      label: "program",
      kind: 7,
      detail: "Main program",
      insertText: "program ${1:main}\n\timplicit none\n\t$0\nend program ${1:main}",
    },
    { label: "intent(in)", kind: 14, detail: "Immutable input argument" },
    { label: "intent(out)", kind: 14, detail: "Output argument" },
    { label: "intent(inout)", kind: 14, detail: "Mutable in/out argument" },
    { label: "matmul", kind: 3, detail: "Matrix multiplication intrinsic" },
    { label: "dot_product", kind: 3, detail: "Vector dot product intrinsic" },
    { label: "size", kind: 3, detail: "Array size intrinsic" },
    { label: "allocated", kind: 3, detail: "Allocatable array status intrinsic" },
  ];
}

/**
 * Unified Fortran Language Server Protocol Service.
 */
export class FortranLspService {
  validate(source: string): LspDiagnostic[] {
    return validateFortran(source);
  }

  getDocumentSymbols(source: string): LspDocumentSymbol[] {
    return getFortranDocumentSymbols(source);
  }

  getHover(source: string, pos: LspPosition): LspHover | undefined {
    return getFortranHover(source, pos);
  }

  getCompletions(source: string, pos: LspPosition): LspCompletionItem[] {
    return getFortranCompletions(source, pos);
  }
}
