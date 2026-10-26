// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/simulink — Language Server Protocol (LSP) Service Integration.
 */

import { lowerSimulinkToDae } from "./dae/index.js";
import { lintSimulinkModel } from "./lints/index.js";
import { parseSimulink } from "./parser/index.js";
import { simulinkToModelica } from "./projections/index.js";
import { synchronizeModelicaToSimulink } from "./tgg/index.js";
import type { SimulinkBlock, SimulinkSystem } from "./types.js";

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
  severity: 1 | 2 | 3 | 4; // 1=Error, 2=Warning, 3=Info, 4=Hint
  code?: string | number | undefined;
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

const DEFAULT_RANGE: LspRange = {
  start: { line: 0, character: 0 },
  end: { line: 0, character: 0 },
};

/**
 * Validates a Simulink document and produces LSP diagnostics.
 */
export function validateSimulink(content: string | Buffer | Uint8Array, uri: string = "model.mdl"): LspDiagnostic[] {
  try {
    const model = parseSimulink(content, uri);
    const rawDiags = lintSimulinkModel(model);

    return rawDiags.map((d) => ({
      range: {
        start: { line: Math.max(0, d.range.startLine - 1), character: Math.max(0, d.range.startColumn - 1) },
        end: { line: Math.max(0, d.range.endLine - 1), character: Math.max(0, d.range.endColumn) },
      },
      severity: d.severity === "error" ? 1 : d.severity === "warning" ? 2 : 3,
      code: d.code,
      source: "modelscript-simulink",
      message: d.message,
    }));
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return [
      {
        range: DEFAULT_RANGE,
        severity: 1,
        code: "M7200",
        source: "modelscript-simulink",
        message: `Simulink syntax / container error: ${msg}`,
      },
    ];
  }
}

/**
 * Extracts hierarchical LSP document symbols from a Simulink model.
 */
export function getSimulinkDocumentSymbols(
  content: string | Buffer | Uint8Array,
  uri: string = "model.mdl",
): LspDocumentSymbol[] {
  try {
    const model = parseSimulink(content, uri);
    const rootRange: LspRange = {
      start: { line: 0, character: 0 },
      end: { line: 1000, character: 0 },
    };

    const children: LspDocumentSymbol[] = extractSystemSymbols(model.rootSystem);

    return [
      {
        name: model.name || "SimulinkModel",
        detail: `Simulink Model (${model.rootSystem.blocks.size} blocks, ${model.rootSystem.lines.length} lines)`,
        kind: LspSymbolKind.Package,
        range: rootRange,
        selectionRange: rootRange,
        children,
      },
    ];
  } catch {
    return [];
  }
}

function extractSystemSymbols(system: SimulinkSystem): LspDocumentSymbol[] {
  const symbols: LspDocumentSymbol[] = [];

  for (const block of system.blocks.values()) {
    const range: LspRange = block.range
      ? {
          start: { line: Math.max(0, block.range.startLine - 1), character: Math.max(0, block.range.startColumn - 1) },
          end: { line: Math.max(0, block.range.endLine - 1), character: Math.max(0, block.range.endColumn) },
        }
      : DEFAULT_RANGE;

    let kind = LspSymbolKind.Class;
    if (block.type === "Constant") kind = LspSymbolKind.Constant;
    else if (block.type === "Inport" || block.type === "Outport") kind = LspSymbolKind.Interface;
    else if (block.type === "SubSystem") kind = LspSymbolKind.Module;

    const childSyms = block.subsystem ? extractSystemSymbols(block.subsystem) : undefined;

    symbols.push({
      name: block.name,
      detail: `${block.type} [SID: ${block.id}]`,
      kind: kind as LspSymbolKind,
      range,
      selectionRange: range,
      children: childSyms,
    });
  }

  return symbols;
}

/**
 * Provides contextual markdown hover for Simulink blocks and ports.
 */
export function getSimulinkHover(
  content: string | Buffer | Uint8Array,
  pos: LspPosition,
  uri: string,
): LspHover | null {
  try {
    const model = parseSimulink(content, uri);
    const line1 = pos.line + 1;
    const col1 = pos.character + 1;

    // Find block enclosing position
    const block = findBlockAtPosition(model.rootSystem, line1, col1);
    if (!block) return null;

    const paramsStr = Array.from(block.parameters.entries())
      .map(([k, v]) => `- **${k}**: \`${v}\``)
      .join("\n");

    const markdown = [
      `### Simulink Block: \`${block.name}\``,
      `**Type:** \`${block.type}\` | **SID:** \`${block.id}\``,
      ``,
      paramsStr ? `#### Parameters:\n${paramsStr}` : `*No explicitly overridden parameters.*`,
    ].join("\n");

    return {
      contents: {
        kind: "markdown",
        value: markdown,
      },
    };
  } catch {
    return null;
  }
}

function findBlockAtPosition(system: SimulinkSystem, line: number, col: number): SimulinkBlock | undefined {
  for (const block of system.blocks.values()) {
    if (block.range) {
      if (
        (line > block.range.startLine || (line === block.range.startLine && col >= block.range.startColumn)) &&
        (line < block.range.endLine || (line === block.range.endLine && col <= block.range.endColumn))
      ) {
        return block;
      }
    }
    if (block.subsystem) {
      const found = findBlockAtPosition(block.subsystem, line, col);
      if (found) return found;
    }
  }
  return undefined;
}

/**
 * Executes a custom Simulink action from the language server.
 */
export async function executeSimulinkAction(action: string, args: Record<string, unknown>): Promise<unknown> {
  const content = args["content"] as string | undefined;
  const uri = (args["uri"] as string) ?? "model.mdl";
  if (!content) throw new Error("Missing 'content' parameter in Simulink action");

  const model = parseSimulink(content, uri);

  switch (action) {
    case "lint":
      return lintSimulinkModel(model);
    case "to_modelica":
      return { modelica: simulinkToModelica(model) };
    case "to_dae": {
      const dae = lowerSimulinkToDae(model);
      return {
        varCount: dae.varCount,
        eqCount: dae.eqCount,
      };
    }
    case "sync_from_modelica": {
      const modelicaText = args["modelicaText"] as string;
      if (!modelicaText) throw new Error("Missing 'modelicaText' in sync_from_modelica action");
      const options = args["options"] as any;
      return synchronizeModelicaToSimulink(content, modelicaText, options);
    }
    default:
      throw new Error(`Unsupported Simulink action: '${action}'`);
  }
}
