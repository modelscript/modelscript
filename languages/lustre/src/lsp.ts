// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Language Server Protocol (LSP) services for `@modelscript/lustre` (.lus, .ec):
 * diagnostics, document symbols, hover documentation, and keyword/stdlib completions.
 */

import { LUSTRE_OPERATOR_SPECS } from "./catalog/lustre-std-schemas.js";
import { formatClock, lintLustre } from "./lints/index.js";
import { parseLustre } from "./parser/lustre-parser.js";
import type { LustreSpan, LustreType } from "./types.js";

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
  kind: "keyword" | "operator" | "function" | "variable" | "constant" | "type";
  detail: string;
  documentation?: string | undefined;
}

const KEYWORD_DOCS: Record<string, string> = {
  node: "**node** — Declares a stateful synchronous dataflow node with memory (`pre`, `->`).",
  function: "**function** — Declares a stateless (combinatorial) Lustre function without temporal memory.",
  returns: "**returns** — Introduces the output stream signature of a `node` or `function`.",
  var: "**var** — Declares local stream variables inside a node.",
  let: "**let ... tel** — Encloses the concurrent dataflow equations and assertions of a node.",
  tel: "**tel** — Terminates a `let ... tel` equation block.",
  pre: "**pre(e)** — Synchronous unit delay operator; returns the value of stream `e` at the previous tick on its clock.",
  when: "**e when c** — Sub-sampling clock operator; produces stream `e` only on ticks where boolean clock `c` is `true`.",
  current:
    "**current(e)** — Clock projection operator; holds the most recent value of sub-sampled stream `e` on its parent clock.",
  merge:
    "**merge c (e1) (e2)** — Combines two complementary sub-clocked streams `e1` (on `c`) and `e2` (on `not c`) back onto `c`'s clock.",
  assert: "**assert expr;** — Declares a synchronous boolean invariant checked on every clock tick.",
  const: "**const** — Declares compile-time synchronous constants.",
  type: "**type** — Declares a type alias.",
  if: "**if c then e1 else e2** — Pointwise conditional stream selection.",
};

function spanToRange(span: LustreSpan): LspRange {
  return {
    start: { line: Math.max(0, span.line - 1), character: Math.max(0, span.column - 1) },
    end: { line: Math.max(0, span.endLine - 1), character: Math.max(0, span.endColumn - 1) },
  };
}

function formatType(t: LustreType): string {
  if (t.kind === "base") return t.name;
  if (t.kind === "named") return t.name;
  return `${formatType(t.element)}^${t.size}`;
}

/**
 * Validates Lustre source code and returns LSP diagnostics (`LUST1001`–`LUST5006`).
 */
export function validateLustre(content: string, _uri: string = "program.lus"): LspDiagnostic[] {
  const program = parseLustre(content);
  const diags = lintLustre(program);

  return diags.map((d) => {
    const startLine = Math.max(0, (d.line ?? 1) - 1);
    const startChar = Math.max(0, (d.column ?? 1) - 1);
    const endLine = Math.max(startLine, (d.endLine ?? d.line ?? 1) - 1);
    const endChar = Math.max(startLine === endLine ? startChar + 1 : 0, (d.endColumn ?? (d.column ?? 1) + 1) - 1);
    return {
      range: {
        start: { line: startLine, character: startChar },
        end: { line: endLine, character: endChar },
      },
      severity: d.severity === "error" ? 1 : d.severity === "warning" ? 2 : 3,
      code: d.id,
      source: "modelscript-lustre",
      message: d.message,
    };
  });
}

/**
 * Extracts hierarchical LSP document symbols (constants, types, nodes/functions, and variables).
 */
export function getLustreDocumentSymbols(content: string): LspDocumentSymbol[] {
  const program = parseLustre(content);
  const symbols: LspDocumentSymbol[] = [];

  for (const c of program.consts) {
    const range = spanToRange(c.span);
    symbols.push({
      name: c.name,
      detail: c.type ? `const : ${formatType(c.type)}` : "const",
      kind: LspSymbolKind.Constant,
      range,
      selectionRange: range,
    });
  }

  for (const t of program.types) {
    const range = spanToRange(t.span);
    symbols.push({
      name: t.name,
      detail: t.alias ? `type = ${formatType(t.alias)}` : "type",
      kind: LspSymbolKind.Interface,
      range,
      selectionRange: range,
    });
  }

  for (const node of program.nodes) {
    const range = spanToRange(node.span);
    const children: LspDocumentSymbol[] = [];
    for (const v of [...node.inputs, ...node.outputs, ...node.locals]) {
      const vRange = spanToRange(v.span);
      const clkStr = v.clock.kind === "base" ? "" : ` when ${formatClock(v.clock)}`;
      children.push({
        name: v.name,
        detail: `${v.role} : ${formatType(v.type)}${clkStr}`,
        kind: LspSymbolKind.Variable,
        range: vRange,
        selectionRange: vRange,
      });
    }

    const inSig = node.inputs.map((v) => `${v.name}: ${formatType(v.type)}`).join("; ");
    const outSig = node.outputs.map((v) => `${v.name}: ${formatType(v.type)}`).join("; ");
    symbols.push({
      name: node.name,
      detail: `${node.kind}(${inSig}) returns (${outSig})`,
      kind: node.kind === "function" ? LspSymbolKind.Function : LspSymbolKind.Class,
      range,
      selectionRange: range,
      children,
    });
  }

  return symbols;
}

/**
 * Provides Markdown hover information at a cursor position for Lustre keywords, stdlib operators,
 * nodes, constants, and stream variables.
 */
export function getLustreHover(content: string, position: LspPosition): LspHover | null {
  const lines = content.split(/\r?\n/);
  const lineText = lines[position.line] ?? "";
  if (!lineText) return null;

  // Check for `->` operator under cursor
  if (
    (lineText[position.character] === "-" && lineText[position.character + 1] === ">") ||
    (lineText[position.character] === ">" && lineText[position.character - 1] === "-")
  ) {
    return {
      contents: {
        kind: "markdown",
        value:
          "**`->` (Followed-By)** — Evaluates to its left operand on the initial clock tick (step 0) and its right operand on all subsequent ticks.",
      },
    };
  }

  let start = position.character;
  let end = position.character;
  while (start > 0 && /[A-Za-z0-9_]/.test(lineText[start - 1]!)) start--;
  while (end < lineText.length && /[A-Za-z0-9_]/.test(lineText[end]!)) end++;
  const word = lineText.slice(start, end);
  if (!word) return null;

  const hoverRange: LspRange = {
    start: { line: position.line, character: start },
    end: { line: position.line, character: end },
  };

  if (KEYWORD_DOCS[word]) {
    return {
      contents: { kind: "markdown", value: KEYWORD_DOCS[word]! },
      range: hoverRange,
    };
  }

  // Check stdlib operators
  const stdOp = LUSTRE_OPERATOR_SPECS.find((op) => op.name === word || op.aliases?.includes(word));
  if (stdOp) {
    const sig = `${stdOp.name}(${stdOp.inputs.map((i) => `${i.name}: ${i.type}`).join(", ")}) returns (${stdOp.outputs.map((o) => `${o.name}: ${o.type}`).join(", ")})`;
    return {
      contents: {
        kind: "markdown",
        value: `\`\`\`lustre\nnode ${sig}\n\`\`\`\n${stdOp.description}\n\n*Category:* ${stdOp.category}  \n*Source:* ${stdOp.provenance}`,
      },
      range: hoverRange,
    };
  }

  // Check symbols in current program
  const program = parseLustre(content);
  for (const c of program.consts) {
    if (c.name === word) {
      return {
        contents: {
          kind: "markdown",
          value: `**const \`${c.name}\`**${c.type ? ` : \`${formatType(c.type)}\`` : ""}`,
        },
        range: hoverRange,
      };
    }
  }

  for (const node of program.nodes) {
    if (node.name === word) {
      const inSig = node.inputs.map((v) => `${v.name}: ${formatType(v.type)}`).join("; ");
      const outSig = node.outputs.map((v) => `${v.name}: ${formatType(v.type)}`).join("; ");
      return {
        contents: {
          kind: "markdown",
          value: `\`\`\`lustre\n${node.kind} ${node.name}(${inSig}) returns (${outSig})\n\`\`\``,
        },
        range: hoverRange,
      };
    }
    for (const v of [...node.inputs, ...node.outputs, ...node.locals]) {
      if (v.name === word) {
        return {
          contents: {
            kind: "markdown",
            value: `**${v.role} \`${v.name}\`** : \`${formatType(v.type)}\` *(clock: \`${formatClock(v.clock)}\`)* in \`${node.name}\``,
          },
          range: hoverRange,
        };
      }
    }
  }

  return null;
}

/**
 * Provides LSP completion items for Lustre keywords, stdlib operators, and in-scope declarations.
 */
export function getLustreCompletions(content: string): LspCompletionItem[] {
  const items: LspCompletionItem[] = [];

  for (const [kw, doc] of Object.entries(KEYWORD_DOCS)) {
    items.push({ label: kw, kind: "keyword", detail: "Lustre keyword", documentation: doc });
  }

  for (const op of LUSTRE_OPERATOR_SPECS) {
    items.push({
      label: op.name,
      kind: "function",
      detail: `Lustre.Std.${op.name} (${op.category})`,
      documentation: op.description,
    });
  }

  const program = parseLustre(content);
  for (const c of program.consts) {
    items.push({ label: c.name, kind: "constant", detail: "constant" });
  }
  for (const node of program.nodes) {
    items.push({ label: node.name, kind: "function", detail: `${node.kind} ${node.name}` });
    for (const v of [...node.inputs, ...node.outputs, ...node.locals]) {
      items.push({
        label: v.name,
        kind: "variable",
        detail: `${v.role} : ${formatType(v.type)}`,
      });
    }
  }

  return items;
}
