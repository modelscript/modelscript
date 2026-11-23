// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Language Server Protocol (LSP) services for `@modelscript/gpss`:
 * diagnostics, document symbols, contextual hover, completions, and domain actions.
 */

import { GPSS_MODEL_SPECS, lookupGpssModelSchema } from "./catalog/index.js";
import { gpssToDae } from "./dae/gpss-to-dae.js";
import { lintGpss } from "./lints/index.js";
import { parseGpss } from "./parser/gpss-parser.js";
import { gpssToModelica } from "./projections/gpssToModelica.js";
import { simulateGpss } from "./solver/des-simulator.js";
import type { GpssModel } from "./types.js";

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
  insertText?: string | undefined;
}

const DEFAULT_RANGE: LspRange = {
  start: { line: 0, character: 0 },
  end: { line: 0, character: 1 },
};

function lineRange(lineIndex: number, lineText: string): LspRange {
  const safeLine = Math.max(0, lineIndex);
  return {
    start: { line: safeLine, character: 0 },
    end: { line: safeLine, character: Math.max(1, lineText.length) },
  };
}

/**
 * Validates a GPSS model and returns LSP diagnostics.
 */
export function validateGpss(content: string, _uri: string = "model.gps"): LspDiagnostic[] {
  try {
    const model = parseGpss(content);
    const diags = lintGpss(model);
    const lines = content.split(/\r?\n/);

    return diags.map((d) => {
      const lineIdx = Math.max(0, d.line - 1);
      const lt = lines[lineIdx] ?? "";
      const startChar = Math.max(0, d.column - 1);
      const endChar = Math.max(startChar + 1, lt.length);

      return {
        range: {
          start: { line: lineIdx, character: startChar },
          end: { line: lineIdx, character: endChar },
        },
        severity: d.severity === "error" ? 1 : d.severity === "warning" ? 2 : 3,
        code: d.id,
        source: "modelscript-gpss",
        message: d.message,
      };
    });
  } catch (err: unknown) {
    return [
      {
        range: DEFAULT_RANGE,
        severity: 1,
        code: "GPSS1001",
        source: "modelscript-gpss",
        message: `Failed to parse GPSS model: ${err instanceof Error ? err.message : String(err)}`,
      },
    ];
  }
}

/**
 * Extracts hierarchical LSP document symbols for facilities, storages, queues, functions, tables, and labels.
 */
export function getGpssDocumentSymbols(content: string, _uri: string = "model.gps"): LspDocumentSymbol[] {
  try {
    const model = parseGpss(content);
    const lines = content.split(/\r?\n/);
    const children: LspDocumentSymbol[] = [];

    for (const fac of model.facilities) {
      const stmt = model.blocks.find(
        (b) => (b.opcode === "SEIZE" || b.opcode === "RELEASE") && (b.operands[0] ?? "").toUpperCase() === fac,
      );
      const r = stmt ? lineRange(stmt.line - 1, lines[stmt.line - 1] ?? "") : DEFAULT_RANGE;
      children.push({
        name: fac,
        detail: "Facility (Single-Server)",
        kind: LspSymbolKind.Class,
        range: r,
        selectionRange: r,
      });
    }

    for (const [name, def] of model.storages) {
      const r = lineRange(def.line - 1, lines[def.line - 1] ?? "");
      children.push({
        name,
        detail: `Storage (Capacity: ${def.capacity})`,
        kind: LspSymbolKind.Struct,
        range: r,
        selectionRange: r,
      });
    }

    for (const q of model.queues) {
      const stmt = model.blocks.find(
        (b) => (b.opcode === "QUEUE" || b.opcode === "DEPART") && (b.operands[0] ?? "").toUpperCase() === q,
      );
      const r = stmt ? lineRange(stmt.line - 1, lines[stmt.line - 1] ?? "") : DEFAULT_RANGE;
      children.push({
        name: q,
        detail: "Queue",
        kind: LspSymbolKind.Property,
        range: r,
        selectionRange: r,
      });
    }

    for (const [name, fn] of model.functions) {
      const r = lineRange(fn.line - 1, lines[fn.line - 1] ?? "");
      children.push({
        name,
        detail: `Function (${fn.argument}, ${fn.mode}${fn.points.length})`,
        kind: LspSymbolKind.Function,
        range: r,
        selectionRange: r,
      });
    }

    for (const [name, tbl] of model.tables) {
      const r = lineRange(tbl.line - 1, lines[tbl.line - 1] ?? "");
      children.push({
        name,
        detail: `Table (${tbl.argument})`,
        kind: LspSymbolKind.Interface,
        range: r,
        selectionRange: r,
      });
    }

    for (const [label, blkIdx] of model.labels) {
      const blk = model.blocks[blkIdx];
      const r = blk ? lineRange(blk.line - 1, lines[blk.line - 1] ?? "") : DEFAULT_RANGE;
      children.push({
        name: label,
        detail: `Block Label (${blk?.opcode ?? "BLOCK"})`,
        kind: LspSymbolKind.Key,
        range: r,
        selectionRange: r,
      });
    }

    const fullRange: LspRange = {
      start: { line: 0, character: 0 },
      end: { line: Math.max(0, lines.length - 1), character: (lines[lines.length - 1] ?? "").length },
    };

    return [
      {
        name: model.name || "GPSS Model",
        detail: `Blocks: ${model.blocks.length} | Facilities: ${model.facilities.size} | Storages: ${model.storages.size} | Queues: ${model.queues.size}`,
        kind: LspSymbolKind.Package,
        range: fullRange,
        selectionRange: DEFAULT_RANGE,
        children: children.length > 0 ? children : undefined,
      },
    ];
  } catch {
    return [];
  }
}

/**
 * Extracts the word/token under a cursor position in a line.
 */
function tokenAtPosition(line: string, character: number): string {
  if (!line) return "";
  const idx = Math.min(Math.max(0, character), line.length);
  let start = idx;
  let end = idx;
  const isWordChar = (ch: string) => /[A-Za-z0-9_$]/.test(ch);
  while (start > 0 && isWordChar(line[start - 1] ?? "")) start--;
  while (end < line.length && isWordChar(line[end] ?? "")) end++;
  return line.slice(start, end);
}

/**
 * Contextual hover documentation for GPSS blocks, SNAs, facilities, storages, queues, and labels.
 */
export function getGpssHover(content: string, position: LspPosition, _uri: string = "model.gps"): LspHover | undefined {
  try {
    const model = parseGpss(content);
    const lines = content.split(/\r?\n/);
    const line = lines[position.line] ?? "";
    const word = tokenAtPosition(line, position.character).toUpperCase();
    if (!word) return undefined;

    // 1. Check Standard Numerical Attribute prefix (Q$, F$, S$, R$, FR$, SR$)
    const snaPrefixMatch = /^(FR\$|SR\$|Q\$|F\$|S\$|R\$)/.exec(word);
    if (snaPrefixMatch && snaPrefixMatch[1]) {
      const schema = lookupGpssModelSchema(snaPrefixMatch[1]);
      if (schema) {
        return {
          contents: {
            kind: "markdown",
            value: `### GPSS SNA \`${word}\`\n- **Attribute**: ${schema.label}\n- **Description**: ${schema.description}\n- **Reference**: ${schema.provenance}`,
          },
        };
      }
    }

    // 2. Check cleanroom block schema (GENERATE, SEIZE, ADVANCE, etc.)
    const blockSchema = lookupGpssModelSchema(word);
    if (blockSchema) {
      const paramDocs = blockSchema.parameters
        .map((p) => `- \`${p.key}\` (default \`${p.defaultValue}\`): ${p.description ?? ""}`)
        .join("\n");
      return {
        contents: {
          kind: "markdown",
          value: `### GPSS Block \`${blockSchema.name}\`\n${blockSchema.description}\n\n${paramDocs}\n\n*${blockSchema.provenance}*`,
        },
      };
    }

    // 3. Check user-declared entities (storages, facilities, queues, functions, labels)
    const storageDef = model.storages.get(word);
    if (storageDef) {
      return {
        contents: {
          kind: "markdown",
          value: `### GPSS Storage \`${word}\`\n- **Capacity**: \`${storageDef.capacity}\` servers\n- **Declared**: line ${storageDef.line}\n- **SNAs**: \`S$${word}\` (occupied), \`R$${word}\` (remaining), \`SR$${word}\` (utilization permille)`,
        },
      };
    }

    if (model.facilities.has(word)) {
      return {
        contents: {
          kind: "markdown",
          value: `### GPSS Facility \`${word}\`\n- **Type**: Single-server facility (capacity 1)\n- **SNAs**: \`F$${word}\` (busy 0/1), \`FR$${word}\` (utilization permille)`,
        },
      };
    }

    if (model.queues.has(word)) {
      return {
        contents: {
          kind: "markdown",
          value: `### GPSS Queue \`${word}\`\n- **Type**: Waiting-line statistics collector\n- **SNAs**: \`Q$${word}\` (current length)`,
        },
      };
    }

    const fnDef = model.functions.get(word);
    if (fnDef) {
      return {
        contents: {
          kind: "markdown",
          value: `### GPSS Function \`${word}\`\n- **Argument**: \`${fnDef.argument}\`\n- **Mode**: \`${fnDef.mode}\` (${fnDef.points.length} coordinate pairs)`,
        },
      };
    }

    if (model.labels.has(word)) {
      const idx = model.labels.get(word)!;
      const blk = model.blocks[idx];
      return {
        contents: {
          kind: "markdown",
          value: `### GPSS Block Label \`${word}\`\n- **Target Block**: \`${blk?.opcode ?? "BLOCK"}\` (line ${blk?.line ?? 1})`,
        },
      };
    }

    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Provides code completion items for GPSS block opcodes, control statements, SNAs, and user-defined entities.
 */
export function getGpssCompletions(content: string, position: LspPosition): LspCompletionItem[] {
  const lines = content.split(/\r?\n/);
  const line = lines[position.line] ?? "";
  const prefix = tokenAtPosition(line, position.character).toUpperCase();
  const items: LspCompletionItem[] = [];

  // 1. Cleanroom GPSS blocks & SNAs
  for (const spec of GPSS_MODEL_SPECS) {
    if (!prefix || spec.modelType.toUpperCase().startsWith(prefix)) {
      items.push({
        label: spec.modelType,
        kind: spec.category === "Standard Numerical Attributes" ? 5 : 14,
        detail: spec.label,
        documentation: spec.description,
      });
    }
  }

  // 2. Control statements not in GPSS_MODEL_SPECS
  const extraControls: Array<[string, string]> = [
    ["START", "Execute simulation for A transaction terminations"],
    ["RESET", "Reset statistics accumulators while keeping active transactions"],
    ["CLEAR", "Clear all transactions and statistics for a new replication"],
    ["END", "End of GPSS simulation deck"],
    ["EQU", "Equate symbolic name to numeric value"],
    ["SIMULATE", "Begin GPSS simulation execution"],
    ["RMULT", "Set random number generator seed(s)"],
  ];
  for (const [kw, doc] of extraControls) {
    if (!prefix || kw.startsWith(prefix)) {
      items.push({
        label: kw,
        kind: 14,
        detail: "GPSS Control Statement",
        documentation: doc,
      });
    }
  }

  // 3. User-defined entities from current document
  try {
    const model = parseGpss(content);
    for (const fac of model.facilities) {
      if (!prefix || fac.startsWith(prefix)) {
        items.push({ label: fac, kind: 7, detail: "Declared Facility" });
      }
    }
    for (const [sName, sDef] of model.storages) {
      if (!prefix || sName.startsWith(prefix)) {
        items.push({ label: sName, kind: 22, detail: `Declared Storage (capacity ${sDef.capacity})` });
      }
    }
    for (const q of model.queues) {
      if (!prefix || q.startsWith(prefix)) {
        items.push({ label: q, kind: 10, detail: "Declared Queue" });
      }
    }
    for (const label of model.labels.keys()) {
      if (!prefix || label.startsWith(prefix)) {
        items.push({ label, kind: 21, detail: "Block Label" });
      }
    }
  } catch {
    // Ignore parse errors during completion
  }

  return items;
}

/**
 * Executes domain actions on a GPSS simulation model (`lint`, `simulate`, `to_dae`, `to_modelica`).
 */
export async function executeGpssAction(action: string, args: Record<string, unknown>): Promise<unknown> {
  const content = typeof args["content"] === "string" ? args["content"] : "";
  const model: GpssModel = parseGpss(content);

  switch (action) {
    case "lint":
      return lintGpss(model);

    case "simulate": {
      const seed = typeof args["seed"] === "number" ? args["seed"] : undefined;
      const terminationCount = typeof args["terminationCount"] === "number" ? args["terminationCount"] : undefined;
      const warmupTime = typeof args["warmupTime"] === "number" ? args["warmupTime"] : undefined;
      return simulateGpss(model, { seed, terminationCount, warmupTime });
    }

    case "to_dae": {
      const dae = gpssToDae(model);
      return {
        varCount: dae.varCount,
        eqCount: dae.eqCount,
      };
    }

    case "to_modelica":
      return gpssToModelica(model);

    default:
      throw new Error(`Unknown GPSS action: ${action}`);
  }
}
