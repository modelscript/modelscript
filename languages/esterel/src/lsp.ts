// SPDX-License-Identifier: AGPL-3.0-or-later

import { ESTEREL_PATTERN_SPECS, lookupEsterelPatternSchema } from "./catalog/index.js";
import { lintEsterel } from "./lints/index.js";
import { parseEsterel } from "./parser/esterel-parser.js";
import type { EsterelStatement } from "./types.js";

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
  kind: "keyword" | "signal" | "module" | "snippet";
  detail: string;
  insertText?: string | undefined;
}

const KEYWORD_DOCS: Record<string, string> = {
  module: "**`module <Name>:`** — Declares an Esterel synchronous reactive module.",
  input: "**`input <S1>, <S2>;`** — Declares pure or valued input signals driven by the environment.",
  output: "**`output <S1>, <S2>;`** — Declares output signals emitted by the module.",
  inputoutput: "**`inputoutput <S>;`** — Declares bidirectional signals readable and emittable.",
  sensor: "**`sensor <S> : <Type>;`** — Declares a passive sensor readable at any instant.",
  relation:
    "**`relation A # B;`** / **`relation A => B;`** — Declares input signal exclusion (`#`) or implication (`=>`).",
  emit: "**`emit <S>`** — Broadcasts signal `<S>` instantaneously for the current reaction tick (0-tick).",
  sustain: "**`sustain <S>`** — Emits `<S>` at every instant indefinitely (equivalent to `loop emit S; pause end`).",
  present: "**`present <Expr> then <P> else <Q> end`** — Tests signal presence in the current instant.",
  await:
    "**`await [immediate] [N] <Expr>`** — Waits for the `N`-th occurrence of `<Expr>` (strictly after entry unless `immediate`).",
  pause: "**`pause`** — Waits for the next reaction tick (1-tick delay).",
  nothing: "**`nothing`** — Instantaneous no-op (0-tick termination).",
  halt: "**`halt`** — Stops control forever without terminating (`loop pause end`).",
  loop: "**`loop <P> end`** / **`loop <P> each <S>`** — Repeats `<P>`; body must not terminate instantaneously.",
  every: "**`every [immediate] <Expr> do <P> end`** — Starts/restarts `<P>` on every occurrence of `<Expr>`.",
  abort:
    "**`[weak] abort <P> when [immediate] <Expr> [do <H>] end`** — Preempts `<P>` strongly (or weakly) when `<Expr>` holds.",
  suspend: "**`suspend <P> when [immediate] <Expr> end`** — Freezes `<P>` during instants where `<Expr>` holds.",
  trap: "**`trap <T> in <P> [handle <T> do <H>] end`** — Declares lexical synchronous exceptions caught by `exit <T>`.",
  exit: "**`exit <T>`** — Synchronously exits enclosing `trap <T>` (outermost trap wins in parallel `||`).",
  signal: "**`signal <S> in <P> end`** — Declares a lexically scoped local signal `<S>`.",
  run: "**`run <Module> [ signal actual / formal ]`** — Instantiates a submodule with optional signal renaming.",
};

/**
 * Validates Esterel source text and returns LSP diagnostics.
 */
export function validateEsterel(content: string, _uri = "module.strl"): LspDiagnostic[] {
  const diags = lintEsterel(content);
  const lines = content.split(/\r?\n/);

  return diags.map((d) => {
    const lineNum = Math.max(0, d.line - 1);
    const lt = lines[lineNum] ?? "";
    const startChar = Math.max(0, d.column - 1);
    const endChar =
      d.endLine === d.line && d.endColumn !== undefined
        ? Math.max(startChar + 1, d.endColumn - 1)
        : Math.min(lt.length, startChar + Math.max(1, d.symbol?.length ?? 1));

    return {
      range: {
        start: { line: lineNum, character: startChar },
        end: { line: lineNum, character: Math.max(startChar + 1, endChar) },
      },
      severity: d.severity === "error" ? 1 : d.severity === "warning" ? 2 : 3,
      code: d.id,
      source: "modelscript-esterel",
      message: d.message,
    };
  });
}

function collectTrapSymbols(stmt: EsterelStatement, out: LspDocumentSymbol[]): void {
  switch (stmt.kind) {
    case "trap":
      for (const t of stmt.traps) {
        const range: LspRange = {
          start: { line: Math.max(0, stmt.span.startLine - 1), character: Math.max(0, stmt.span.startColumn - 1) },
          end: { line: Math.max(0, stmt.span.endLine - 1), character: Math.max(0, stmt.span.endColumn - 1) },
        };
        out.push({
          name: t,
          detail: "trap",
          kind: LspSymbolKind.Event,
          range,
          selectionRange: range,
        });
      }
      collectTrapSymbols(stmt.body, out);
      for (const h of stmt.handlers) collectTrapSymbols(h.body, out);
      break;
    case "signal":
      for (const s of stmt.signals) {
        const range: LspRange = {
          start: { line: Math.max(0, s.span.startLine - 1), character: Math.max(0, s.span.startColumn - 1) },
          end: { line: Math.max(0, s.span.endLine - 1), character: Math.max(0, s.span.endColumn - 1) },
        };
        out.push({
          name: s.name,
          detail: "local signal",
          kind: LspSymbolKind.Variable,
          range,
          selectionRange: range,
        });
      }
      collectTrapSymbols(stmt.body, out);
      break;
    case "seq":
      for (const s of stmt.statements) collectTrapSymbols(s, out);
      break;
    case "par":
      for (const b of stmt.branches) collectTrapSymbols(b, out);
      break;
    case "present":
      collectTrapSymbols(stmt.thenBranch, out);
      if (stmt.elseBranch) collectTrapSymbols(stmt.elseBranch, out);
      break;
    case "loop":
    case "every":
    case "suspend":
      collectTrapSymbols(stmt.body, out);
      break;
    case "abort":
      collectTrapSymbols(stmt.body, out);
      if (stmt.handler) collectTrapSymbols(stmt.handler, out);
      break;
    case "await":
      if (stmt.body) collectTrapSymbols(stmt.body, out);
      if (stmt.cases) {
        for (const c of stmt.cases) {
          if (c.body) collectTrapSymbols(c.body, out);
        }
      }
      break;
    default:
      break;
  }
}

/**
 * Extracts hierarchical LSP document symbols (modules, signals, local signals, traps).
 */
export function getEsterelDocumentSymbols(content: string): LspDocumentSymbol[] {
  const prog = parseEsterel(content);
  const symbols: LspDocumentSymbol[] = [];

  for (const mod of prog.modules) {
    const children: LspDocumentSymbol[] = [];
    for (const sig of mod.signals) {
      const r: LspRange = {
        start: { line: Math.max(0, sig.span.startLine - 1), character: Math.max(0, sig.span.startColumn - 1) },
        end: { line: Math.max(0, sig.span.endLine - 1), character: Math.max(0, sig.span.endColumn - 1) },
      };
      children.push({
        name: sig.name,
        detail: sig.valueType ? `${sig.direction} : ${sig.valueType}` : sig.direction,
        kind: LspSymbolKind.Variable,
        range: r,
        selectionRange: r,
      });
    }
    collectTrapSymbols(mod.body, children);

    const modRange: LspRange = {
      start: { line: Math.max(0, mod.span.startLine - 1), character: Math.max(0, mod.span.startColumn - 1) },
      end: { line: Math.max(0, mod.span.endLine - 1), character: Math.max(0, mod.span.endColumn - 1) },
    };

    symbols.push({
      name: mod.name,
      detail: `Esterel module (${mod.signals.length} signals)`,
      kind: LspSymbolKind.Module,
      range: modRange,
      selectionRange: modRange,
      children,
    });
  }

  return symbols;
}

/**
 * Provides hover documentation for Esterel keywords, declared signals, and stdlib patterns.
 */
export function getEsterelHover(content: string, position: LspPosition): LspHover | null {
  const lines = content.split(/\r?\n/);
  const lineText = lines[position.line];
  if (!lineText) return null;

  // Extract word under cursor
  let start = position.character;
  let end = position.character;
  while (start > 0 && /[A-Za-z0-9_]/.test(lineText[start - 1] ?? "")) start--;
  while (end < lineText.length && /[A-Za-z0-9_]/.test(lineText[end] ?? "")) end++;
  const word = lineText.slice(start, end);
  if (!word) return null;

  const range: LspRange = {
    start: { line: position.line, character: start },
    end: { line: position.line, character: end },
  };

  // 1. Keyword documentation
  const kwDoc = KEYWORD_DOCS[word];
  if (kwDoc) {
    return { contents: { kind: "markdown", value: kwDoc }, range };
  }

  // 2. Declared signal or module in document
  const prog = parseEsterel(content);
  for (const mod of prog.modules) {
    if (mod.name === word) {
      const inputs = mod.signals.filter((s) => s.direction === "input").map((s) => s.name);
      const outputs = mod.signals.filter((s) => s.direction === "output").map((s) => s.name);
      return {
        contents: {
          kind: "markdown",
          value: `**Esterel Module \`${mod.name}\`**\n\n- Inputs: ${inputs.join(", ") || "none"}\n- Outputs: ${outputs.join(", ") || "none"}`,
        },
        range,
      };
    }
    const sig = mod.signals.find((s) => s.name === word);
    if (sig) {
      const typeInfo = sig.valueType ? ` : \`${sig.valueType}\`` : "";
      return {
        contents: {
          kind: "markdown",
          value: `**\`${sig.direction} ${sig.name}\`**${typeInfo} — Signal in module \`${mod.name}\`.`,
        },
        range,
      };
    }
  }

  // 3. Standard library pattern lookup
  const stdSchema = lookupEsterelPatternSchema(word);
  if (stdSchema) {
    return {
      contents: {
        kind: "markdown",
        value: `**\`${stdSchema.namePath}\`** (${stdSchema.category})\n\n${stdSchema.description}`,
      },
      range,
    };
  }

  return null;
}

/**
 * Provides Esterel keyword, signal, and standard library pattern completions.
 */
export function getEsterelCompletions(content: string): LspCompletionItem[] {
  const items: LspCompletionItem[] = [];
  for (const [kw, doc] of Object.entries(KEYWORD_DOCS)) {
    items.push({ label: kw, kind: "keyword", detail: doc });
  }

  const prog = parseEsterel(content);
  const seenSigs = new Set<string>();
  for (const mod of prog.modules) {
    for (const sig of mod.signals) {
      if (!seenSigs.has(sig.name)) {
        seenSigs.add(sig.name);
        items.push({ label: sig.name, kind: "signal", detail: `${sig.direction} signal (${mod.name})` });
      }
    }
  }

  for (const spec of ESTEREL_PATTERN_SPECS) {
    items.push({
      label: spec.patternType,
      kind: "snippet",
      detail: `${spec.label} (${spec.category})`,
      insertText: spec.esterelSource,
    });
  }

  return items;
}
