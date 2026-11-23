// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Language Server Protocol (LSP) services for ITU-T Z.100 SDL-88:
 * diagnostics (`validateSdl`), document symbols (`getSdlDocumentSymbols`),
 * hover documentation (`getSdlHover`), and keyword/catalog completions (`getSdlCompletions`).
 */

import { getSdlSchemasFromLibraries, lookupSdlModelSchema } from "./catalog/library-package-adapter.js";
import { lintSdl } from "./lints/index.js";
import { parseSdl } from "./parser/sdl-parser.js";
import { analyzeSdlReachability } from "./solver/reachability.js";

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
  detail?: string;
  documentation?: string;
}

const SDL_KEYWORDS: Array<{ keyword: string; detail: string }> = [
  { keyword: "SYSTEM", detail: "Top-level SDL-88 system declaration" },
  { keyword: "ENDSYSTEM", detail: "End of SYSTEM declaration" },
  { keyword: "BLOCK", detail: "Structural subsystem block" },
  { keyword: "ENDBLOCK", detail: "End of BLOCK declaration" },
  { keyword: "PROCESS", detail: "Communicating Extended Finite State Machine (EFSM)" },
  { keyword: "ENDPROCESS", detail: "End of PROCESS declaration" },
  { keyword: "CHANNEL", detail: "Inter-block asynchronous communication channel" },
  { keyword: "ENDCHANNEL", detail: "End of CHANNEL declaration" },
  { keyword: "SIGNALROUTE", detail: "Intra-block signal route between processes/ENV" },
  { keyword: "CONNECT", detail: "Binds a CHANNEL to one or more SIGNALROUTEs" },
  { keyword: "SIGNAL", detail: "Declares asynchronous message signals and parameter sorts" },
  { keyword: "DCL", detail: "Declares process-local typed variables" },
  { keyword: "TIMER", detail: "Declares a supervision/retransmission timer" },
  { keyword: "START", detail: "Initial transition executed upon process creation" },
  { keyword: "STATE", detail: "EFSM state block containing INPUT transitions" },
  { keyword: "ENDSTATE", detail: "End of STATE block" },
  { keyword: "INPUT", detail: "Consumes a signal or timer expiry from the FIFO queue" },
  { keyword: "OUTPUT", detail: "Sends an asynchronous signal to a peer process or ENV" },
  { keyword: "TASK", detail: "Executes local variable assignments" },
  { keyword: "DECISION", detail: "Conditional branching on an SDL expression" },
  { keyword: "ENDDECISION", detail: "End of DECISION block" },
  { keyword: "NEXTSTATE", detail: "Transitions to the named state (or '-' for same state)" },
  { keyword: "SET", detail: "Arms a timer with expiry time NOW + duration" },
  { keyword: "RESET", detail: "Cancels an active timer" },
  { keyword: "STOP", detail: "Terminates the current process instance" },
];

function spanToRange(line: number | undefined, column: number | undefined, length = 1): LspRange {
  const l = Math.max(0, (line ?? 1) - 1);
  const c = Math.max(0, (column ?? 1) - 1);
  return {
    start: { line: l, character: c },
    end: { line: l, character: c + Math.max(1, length) },
  };
}

/**
 * Validates an SDL-88 document and returns LSP diagnostics.
 */
export function validateSdl(content: string, _uri = "system.sdl"): LspDiagnostic[] {
  const model = parseSdl(content);
  const diags = lintSdl(model);
  return diags.map((d) => ({
    range: spanToRange(d.line, d.column, d.symbolName?.length ?? 1),
    severity: d.severity === "error" ? 1 : d.severity === "warning" ? 2 : 3,
    code: d.id,
    source: "modelscript-sdl",
    message: d.message,
  }));
}

/**
 * Returns hierarchical LSP DocumentSymbols for SYSTEM -> BLOCK -> PROCESS -> STATE / SIGNAL / TIMER.
 */
export function getSdlDocumentSymbols(content: string, _uri = "system.sdl"): LspDocumentSymbol[] {
  const model = parseSdl(content);
  const sysChildren: LspDocumentSymbol[] = [];

  for (const sig of model.signals) {
    const r = spanToRange(sig.line, sig.column, sig.name.length);
    sysChildren.push({
      name: sig.name,
      detail: sig.parameterSorts.length > 0 ? `SIGNAL(${sig.parameterSorts.join(", ")})` : "SIGNAL",
      kind: LspSymbolKind.Event,
      range: r,
      selectionRange: r,
    });
  }

  for (const ch of model.channels) {
    const r = spanToRange(ch.line, ch.column, ch.name.length);
    sysChildren.push({
      name: ch.name,
      detail: ch.noDelay ? "CHANNEL NODELAY" : "CHANNEL",
      kind: LspSymbolKind.Interface,
      range: r,
      selectionRange: r,
    });
  }

  for (const block of model.blocks) {
    const blockChildren: LspDocumentSymbol[] = [];
    for (const proc of block.processes) {
      const procChildren: LspDocumentSymbol[] = [];
      for (const v of proc.variables) {
        const vr = spanToRange(v.line, v.column, v.name.length);
        procChildren.push({
          name: v.name,
          detail: `DCL ${v.sort}`,
          kind: LspSymbolKind.Variable,
          range: vr,
          selectionRange: vr,
        });
      }
      for (const t of proc.timers) {
        const tr = spanToRange(t.line, t.column, t.name.length);
        procChildren.push({
          name: t.name,
          detail: "TIMER",
          kind: LspSymbolKind.Event,
          range: tr,
          selectionRange: tr,
        });
      }
      for (const st of proc.states) {
        for (const sName of st.names) {
          const sr = spanToRange(st.line, st.column, sName.length);
          procChildren.push({
            name: sName,
            detail: `STATE (${st.inputs.length} inputs)`,
            kind: LspSymbolKind.EnumMember,
            range: sr,
            selectionRange: sr,
          });
        }
      }
      const pr = spanToRange(proc.line, proc.column, proc.name.length);
      blockChildren.push({
        name: proc.name,
        detail: `PROCESS (${proc.states.length} states)`,
        kind: LspSymbolKind.Class,
        range: pr,
        selectionRange: pr,
        children: procChildren,
      });
    }

    const br = spanToRange(block.line, block.column, block.name.length);
    sysChildren.push({
      name: block.name,
      detail: `BLOCK (${block.processes.length} processes)`,
      kind: LspSymbolKind.Module,
      range: br,
      selectionRange: br,
      children: blockChildren,
    });
  }

  const sysRange = spanToRange(model.span.line, model.span.column, model.name.length);
  return [
    {
      name: model.name,
      detail: "SDL-88 SYSTEM",
      kind: LspSymbolKind.Package,
      range: sysRange,
      selectionRange: sysRange,
      children: sysChildren,
    },
  ];
}

function wordAtPosition(content: string, pos: LspPosition): string | null {
  const lines = content.split(/\r?\n/);
  const lineText = lines[pos.line];
  if (!lineText) return null;
  let start = pos.character;
  let end = pos.character;
  while (start > 0 && /[A-Za-z0-9_]/.test(lineText[start - 1] ?? "")) start--;
  while (end < lineText.length && /[A-Za-z0-9_]/.test(lineText[end] ?? "")) end++;
  const word = lineText.slice(start, end);
  return word.length > 0 ? word : null;
}

/**
 * Provides hover markdown documentation for SDL-88 keywords, predefined sorts, signals, processes, and states.
 */
export function getSdlHover(content: string, position: LspPosition): LspHover | null {
  const word = wordAtPosition(content, position);
  if (!word) return null;

  const upper = word.toUpperCase();
  const kw = SDL_KEYWORDS.find((k) => k.keyword === upper);
  if (kw) {
    return {
      contents: {
        kind: "markdown",
        value: `**SDL-88 Keyword \`${kw.keyword}\`**\n\n${kw.detail}.`,
      },
    };
  }

  const schema = lookupSdlModelSchema(word);
  if (schema) {
    return {
      contents: {
        kind: "markdown",
        value: `**${schema.label}** (\`${schema.namePath}\`)\n\n${schema.description}\n\n*Provenance:* ${schema.provenance}`,
      },
    };
  }

  const model = parseSdl(content);
  const sig = model.signals.find((s) => s.name.toUpperCase() === upper);
  if (sig) {
    const sorts = sig.parameterSorts.length > 0 ? `(${sig.parameterSorts.join(", ")})` : "";
    return {
      contents: {
        kind: "markdown",
        value: `**SDL Signal \`${sig.name}${sorts}\`**\n\nDeclared in system \`${model.name}\`.`,
      },
    };
  }

  const reach = analyzeSdlReachability(model);
  for (const p of reach.processes) {
    if (p.processName.toUpperCase() === upper) {
      return {
        contents: {
          kind: "markdown",
          value: `**SDL Process \`${p.processName}\`** (Block \`${p.blockName}\`)\n\n- States: ${p.declaredStates.join(", ") || "none"}\n- Reachable: ${p.reachableStates.length}/${p.declaredStates.length}\n- Deadlock-free: ${p.deadlockStates.length === 0 ? "Yes" : `No (${p.deadlockStates.join(", ")})`}`,
        },
      };
    }
    if (p.declaredStates.some((s) => s.toUpperCase() === upper)) {
      const isReach = p.reachableStates.some((s) => s.toUpperCase() === upper);
      const isDead = p.deadlockStates.some((s) => s.toUpperCase() === upper);
      return {
        contents: {
          kind: "markdown",
          value: `**SDL State \`${word}\`** in process \`${p.processName}\`\n\n- Reachable: ${isReach ? "Yes" : "No"}\n- Deadlock/Sink: ${isDead ? "Yes" : "No"}`,
        },
      };
    }
  }

  return null;
}

/**
 * Returns LSP completion items for SDL-88 keywords, ITU-T Z.100 predefined sorts, and telecom blocks.
 */
export function getSdlCompletions(): LspCompletionItem[] {
  const items: LspCompletionItem[] = SDL_KEYWORDS.map((k) => ({
    label: k.keyword,
    kind: 14, // Keyword
    detail: "SDL-88 keyword",
    documentation: k.detail,
  }));

  for (const s of getSdlSchemasFromLibraries()) {
    items.push({
      label: s.name,
      kind: s.symbolKind === "Type" ? 7 : 9,
      detail: s.category,
      documentation: s.description,
    });
  }
  return items;
}
