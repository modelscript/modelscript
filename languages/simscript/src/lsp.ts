// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Language Server Protocol (LSP) services for SIMSCRIPT II.5:
 * diagnostics, documentSymbols, hover, and completion.
 */

import { getOrLoadLanguageWasmParser } from "@modelscript/dsl";
import { cstLineText, groupAllCstTokensByLine, type CstNodeLike } from "@modelscript/runtime";
import { createWasmParserSync } from "../src-gen/bindings.js";
import { getSimscriptSchemasFromLibraries, lookupSimscriptModelSchema } from "./catalog/library-package-adapter.js";
import { lintSimscript } from "./lints/index.js";
import { parseSimscript } from "./parser/simscript-parser.js";

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
  kind: number; // 1=Text, 3=Function, 6=Variable, 7=Class, 14=Keyword
  detail?: string | undefined;
  documentation?: string | undefined;
}

const DEFAULT_RANGE: LspRange = {
  start: { line: 0, character: 0 },
  end: { line: 0, character: 1 },
};

const SIMSCRIPT_KEYWORDS: Array<{ label: string; detail: string; doc: string }> = [
  { label: "PREAMBLE", detail: "Declaration section", doc: "Begins the SIMSCRIPT II.5 global declaration section." },
  {
    label: "TEMPORARY ENTITIES",
    detail: "Preamble section",
    doc: "Declares dynamic entities created and destroyed during simulation.",
  },
  {
    label: "PERMANENT ENTITIES",
    detail: "Preamble section",
    doc: "Declares fixed-size entity arrays allocated before simulation.",
  },
  { label: "PROCESSES", detail: "Preamble section", doc: "Declares process-interaction routines." },
  { label: "RESOURCES", detail: "Preamble section", doc: "Declares multi-unit capacity-constrained resource pools." },
  { label: "EVENT NOTICES", detail: "Preamble section", doc: "Declares discrete event notices for SCHEDULE." },
  {
    label: "EVERY",
    detail: "Entity clause",
    doc: "Defines attributes (HAS), owned sets (OWNS), and membership (BELONGS TO).",
  },
  {
    label: "DEFINE",
    detail: "Variable/set declaration",
    doc: "Declares typed variables, arrays, or FIFO/LIFO/RANKED sets.",
  },
  {
    label: "TALLY",
    detail: "Observation statistic",
    doc: "Automatic observation-based statistics collector (MEAN, MAX, MIN, STD.DEV).",
  },
  {
    label: "ACCUMULATE",
    detail: "Time-weighted statistic",
    doc: "Automatic time-persistent statistics collector integrated over simulation time.",
  },
  { label: "MAIN", detail: "Entry routine", doc: "Main initialization routine invoking START SIMULATION." },
  { label: "PROCESS", detail: "Process routine", doc: "Defines a suspendable process-oriented coroutine." },
  { label: "EVENT", detail: "Event routine", doc: "Defines an instantaneous discrete event handler." },
  { label: "ROUTINE", detail: "Subroutine", doc: "Defines a reusable SIMSCRIPT II.5 subroutine." },
  { label: "CREATE", detail: "Entity creation", doc: "Allocates a temporary entity or permanent resource array." },
  { label: "DESTROY", detail: "Entity destruction", doc: "Releases a temporary entity instance." },
  { label: "ACTIVATE", detail: "Process activation", doc: "Spawns a process instance NOW or IN <expr> <units>." },
  { label: "SCHEDULE", detail: "Event scheduling", doc: "Schedules an event notice NOW or IN <expr> <units>." },
  { label: "WORK", detail: "Service delay", doc: "Advances simulation time while holding acquired resources." },
  { label: "WAIT", detail: "Passive delay", doc: "Suspends a process for a specified duration." },
  {
    label: "REQUEST",
    detail: "Resource acquisition",
    doc: "Requests units from a declared resource pool (queues if unavailable).",
  },
  { label: "RELINQUISH", detail: "Resource release", doc: "Releases resource units and wakes queued processes." },
  { label: "FILE", detail: "Set insertion", doc: "Inserts an entity into a declared set." },
  { label: "REMOVE", detail: "Set removal", doc: "Removes FIRST, LAST, or a specific entity from a declared set." },
  {
    label: "START SIMULATION",
    detail: "Simulation start",
    doc: "Starts the discrete-event simulation clock and event calendar loop.",
  },
  { label: "END", detail: "Block terminator", doc: "Terminates PREAMBLE, MAIN, PROCESS, EVENT, or ROUTINE." },
];

interface SimscriptCstLine {
  row: number;
  text: string;
  colLine: string;
  startCol: number;
  endCol: number;
}

interface SimscriptCstIndex {
  byRow: Map<number, SimscriptCstLine>;
  rootRange: LspRange;
}

function buildSimscriptCstIndex(content: string): SimscriptCstIndex {
  const byRow = new Map<number, SimscriptCstLine>();
  let lastRow = 0;
  let lastEndCol = 0;

  let rootNode: CstNodeLike | null = null;
  try {
    rootNode =
      (getOrLoadLanguageWasmParser("simscript", import.meta.url, createWasmParserSync).parse(content)?.rootNode as
        CstNodeLike | undefined) ?? null;
  } catch {
    rootNode = null;
  }

  if (rootNode) {
    for (const { row, tokens } of groupAllCstTokensByLine(rootNode)) {
      const lineText = cstLineText(content, tokens);
      const first = tokens[0] as (CstNodeLike & { endPosition?: { column: number } }) | undefined;
      const last = tokens[tokens.length - 1] as (CstNodeLike & { endPosition?: { column: number } }) | undefined;
      const startCol = first?.startPosition?.column ?? 0;
      const endCol = last?.endPosition?.column ?? startCol + lineText.length;
      const colLine = startCol > 0 ? " ".repeat(startCol) + lineText : lineText;
      byRow.set(row, { row, text: lineText, colLine, startCol, endCol });
      if (row >= lastRow) {
        lastRow = row;
        lastEndCol = endCol;
      }
    }
  } else {
    const rawLines = content.split(/\r?\n/);
    for (let i = 0; i < rawLines.length; i++) {
      const raw = rawLines[i] ?? "";
      const trimmed = raw.trim();
      if (!trimmed) continue;
      const startCol = Math.max(0, raw.search(/\S/));
      const endCol = startCol + trimmed.length;
      byRow.set(i, { row: i, text: trimmed, colLine: raw, startCol, endCol });
      lastRow = i;
      lastEndCol = endCol;
    }
  }

  const rootRange: LspRange = {
    start: { line: 0, character: 0 },
    end: { line: lastRow, character: Math.max(1, lastEndCol) },
  };
  return { byRow, rootRange };
}

function lineRange(lineNum: number, entry: SimscriptCstLine | undefined, symbol?: string): LspRange {
  const zeroLine = Math.max(0, lineNum - 1);
  const lineText = entry?.colLine ?? "";
  if (symbol && lineText) {
    const idx = lineText.toUpperCase().indexOf(symbol.toUpperCase());
    if (idx >= 0) {
      return {
        start: { line: zeroLine, character: idx },
        end: { line: zeroLine, character: idx + symbol.length },
      };
    }
  }
  const startChar = entry?.startCol ?? 0;
  return {
    start: { line: zeroLine, character: startChar },
    end: { line: zeroLine, character: Math.max(startChar + 1, entry?.endCol ?? startChar + 1) },
  };
}

/**
 * Validates a SIMSCRIPT II.5 program and returns LSP diagnostics.
 */
export function validateSimscript(content: string, _uri: string = "model.sim"): LspDiagnostic[] {
  try {
    const model = parseSimscript(content);
    const diags = lintSimscript(model);
    const cstIndex = buildSimscriptCstIndex(content);

    return diags.map((d) => {
      const lineNum = d.line ?? 1;
      const entry = cstIndex.byRow.get(Math.max(0, lineNum - 1));
      return {
        range: lineRange(lineNum, entry, d.symbol),
        severity: d.severity === "error" ? 1 : d.severity === "warning" ? 2 : 3,
        code: d.id,
        source: "modelscript-simscript",
        message: d.message,
      };
    });
  } catch (err: unknown) {
    return [
      {
        range: DEFAULT_RANGE,
        severity: 1,
        code: "SIMS1001",
        source: "modelscript-simscript",
        message: `Failed to parse SIMSCRIPT II.5 program: ${err instanceof Error ? err.message : String(err)}`,
      },
    ];
  }
}

/**
 * Extracts hierarchical LSP document symbols for a SIMSCRIPT II.5 program.
 */
export function getSimscriptDocumentSymbols(content: string, _uri: string = "model.sim"): LspDocumentSymbol[] {
  try {
    const model = parseSimscript(content);
    const cstIndex = buildSimscriptCstIndex(content);
    const children: LspDocumentSymbol[] = [];

    // Preamble entities, processes, resources, sets, stats
    for (const ent of model.preamble.entities) {
      const entry = cstIndex.byRow.get(Math.max(0, ent.span.line - 1));
      const range = lineRange(ent.span.line, entry, ent.name);
      const kind =
        ent.kind === "resource"
          ? LspSymbolKind.Struct
          : ent.kind === "process"
            ? LspSymbolKind.Method
            : ent.kind === "event"
              ? LspSymbolKind.Event
              : LspSymbolKind.Class;
      const capDetail = ent.capacity !== undefined ? ` | U.${ent.name} = ${ent.capacity}` : "";
      children.push({
        name: ent.name,
        detail: `${ent.kind.toUpperCase()}${capDetail}`,
        kind,
        range,
        selectionRange: range,
      });
    }

    for (const st of model.preamble.stats) {
      const entry = cstIndex.byRow.get(Math.max(0, st.span.line - 1));
      const range = lineRange(st.span.line, entry, st.statName);
      children.push({
        name: st.statName,
        detail: `${st.kind} ${st.measure} OF ${st.target}`,
        kind: LspSymbolKind.Property,
        range,
        selectionRange: range,
      });
    }

    if (model.main) {
      const entry = cstIndex.byRow.get(Math.max(0, model.main.span.line - 1));
      const range = lineRange(model.main.span.line, entry, "MAIN");
      children.push({
        name: "MAIN",
        detail: `Entry routine (${model.main.statements.length} statements)`,
        kind: LspSymbolKind.Function,
        range,
        selectionRange: range,
      });
    }

    for (const proc of model.processes.values()) {
      const entry = cstIndex.byRow.get(Math.max(0, proc.span.line - 1));
      const range = lineRange(proc.span.line, entry, proc.name);
      children.push({
        name: `PROCESS ${proc.name}`,
        detail: `${proc.statements.length} statements`,
        kind: LspSymbolKind.Function,
        range,
        selectionRange: range,
      });
    }

    for (const ev of model.events.values()) {
      const entry = cstIndex.byRow.get(Math.max(0, ev.span.line - 1));
      const range = lineRange(ev.span.line, entry, ev.name);
      children.push({
        name: `EVENT ${ev.name}`,
        detail: `${ev.statements.length} statements`,
        kind: LspSymbolKind.Event,
        range,
        selectionRange: range,
      });
    }

    for (const rt of model.routines.values()) {
      const entry = cstIndex.byRow.get(Math.max(0, rt.span.line - 1));
      const range = lineRange(rt.span.line, entry, rt.name);
      children.push({
        name: `ROUTINE ${rt.name}`,
        detail: `${rt.statements.length} statements`,
        kind: LspSymbolKind.Function,
        range,
        selectionRange: range,
      });
    }

    return [
      {
        name: model.name,
        detail: `Resources: ${model.preamble.entities.filter((e) => e.kind === "resource").length} | Processes: ${model.processes.size} | Events: ${model.events.size}`,
        kind: LspSymbolKind.Package,
        range: cstIndex.rootRange,
        selectionRange: cstIndex.rootRange,
        children: children.length > 0 ? children : undefined,
      },
    ];
  } catch {
    return [];
  }
}

function wordAtPosition(line: string, character: number): string {
  const isWordChar = (ch: string): boolean => /[A-Za-z0-9._]/.test(ch);
  let start = Math.min(character, line.length);
  while (start > 0 && isWordChar(line[start - 1]!)) start--;
  let end = start;
  while (end < line.length && isWordChar(line[end]!)) end++;
  return line.slice(start, end);
}

/**
 * Provides contextual hover documentation for SIMSCRIPT II.5 symbols, distributions, and keywords.
 */
export function getSimscriptHover(
  content: string,
  position: LspPosition,
  _uri: string = "model.sim",
): LspHover | undefined {
  try {
    const model = parseSimscript(content);
    const cstIndex = buildSimscriptCstIndex(content);
    const line = cstIndex.byRow.get(position.line)?.colLine ?? "";
    const word = wordAtPosition(line, position.character).toUpperCase();
    if (!word) return undefined;

    // 1. Check stdlib distribution / primitive schema
    const schema = lookupSimscriptModelSchema(word);
    if (schema) {
      const params = schema.parameters.map((p) => `\`${p.key}\` (default ${p.defaultValue})`).join(", ");
      return {
        contents: {
          kind: "markdown",
          value: `### SIMSCRIPT II.5 Standard Library: \`${schema.name}\`\n- **Category**: ${schema.category}\n- **Description**: ${schema.description}\n- **Parameters**: ${params}\n- **Provenance**: ${schema.provenance}`,
        },
      };
    }

    // 2. Check declared entities / resources / processes
    for (const ent of model.preamble.entities) {
      if (ent.name.toUpperCase() === word) {
        let md = `### SIMSCRIPT II.5 ${ent.kind.toUpperCase()} \`${ent.name}\`\n`;
        if (ent.capacity !== undefined) md += `- **Capacity** (\`U.${ent.name}\`): ${ent.capacity}\n`;
        if (ent.attributes.length > 0) md += `- **Attributes**: ${ent.attributes.join(", ")}\n`;
        if (ent.ownedSets.length > 0) md += `- **Owns Sets**: ${ent.ownedSets.join(", ")}\n`;
        if (ent.belongsToSets.length > 0) md += `- **Belongs To**: ${ent.belongsToSets.join(", ")}\n`;
        return { contents: { kind: "markdown", value: md } };
      }
    }

    // 3. Check declared sets
    const setDisc = model.preamble.sets.get(word);
    if (setDisc) {
      return {
        contents: {
          kind: "markdown",
          value: `### SIMSCRIPT II.5 Set \`${word}\`\n- **Discipline**: \`${setDisc}\``,
        },
      };
    }

    // 4. Check keywords
    const kw = SIMSCRIPT_KEYWORDS.find((k) => k.label === word || k.label.startsWith(word + " "));
    if (kw) {
      return {
        contents: {
          kind: "markdown",
          value: `### SIMSCRIPT II.5 Keyword \`${kw.label}\`\n- **Role**: ${kw.detail}\n- ${kw.doc}`,
        },
      };
    }

    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Provides LSP completion items for SIMSCRIPT II.5 keywords, declared symbols, and standard distributions.
 */
export function getSimscriptCompletions(
  content: string,
  position: LspPosition,
  _uri: string = "model.sim",
): LspCompletionItem[] {
  const items: LspCompletionItem[] = [];
  const seen = new Set<string>();

  const cstIndex = buildSimscriptCstIndex(content);
  const line = cstIndex.byRow.get(position.line)?.colLine ?? "";
  const prefix = wordAtPosition(line, position.character).toUpperCase();

  function add(item: LspCompletionItem): void {
    const key = item.label.toUpperCase();
    if (seen.has(key)) return;
    if (prefix && !key.startsWith(prefix)) return;
    seen.add(key);
    items.push(item);
  }

  // 1. Declared symbols from current document
  try {
    const model = parseSimscript(content);
    for (const ent of model.preamble.entities) {
      add({
        label: ent.name,
        kind: ent.kind === "process" ? 3 : 7,
        detail: `SIMSCRIPT ${ent.kind}`,
      });
    }
    for (const [setName, disc] of model.preamble.sets) {
      add({
        label: setName,
        kind: 6,
        detail: `SIMSCRIPT ${disc} SET`,
      });
    }
  } catch {
    // Ignore parse errors during completion
  }

  // 2. Cleanroom stdlib distributions & primitives
  for (const schema of getSimscriptSchemasFromLibraries()) {
    add({
      label: schema.name,
      kind: 3,
      detail: schema.label,
      documentation: schema.description,
    });
  }

  // 3. SIMSCRIPT II.5 keywords
  for (const kw of SIMSCRIPT_KEYWORDS) {
    add({
      label: kw.label,
      kind: 14,
      detail: kw.detail,
      documentation: kw.doc,
    });
  }

  return items;
}
