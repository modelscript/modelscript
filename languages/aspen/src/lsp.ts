// SPDX-License-Identifier: AGPL-3.0-or-later

import { collectWasmSyntaxErrors } from "@modelscript/dsl";
import { lowerAspenToDae } from "./dae/aspen-to-dae.js";
import { lintAspen } from "./lints/index.js";
import { getAspenWasmParser, parseAspen } from "./parser/aspen-parser.js";
import { aspenToModelica } from "./projections/aspen-to-modelica.js";
import { solveFlashRachfordRice } from "./solvers/flash-solver.js";

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
  severity: 1 | 2 | 3 | 4; // 1 = Error, 2 = Warning, 3 = Info, 4 = Hint
  code?: string | number | undefined;
  source?: string | undefined;
  message: string;
}

export interface LspHover {
  contents: {
    kind: "markdown" | "plaintext";
    value: string;
  };
  range?: LspRange | undefined;
}

interface ErrNode {
  hasError?: boolean;
  isError?: boolean;
  text?: string;
  startPosition?: { row?: number; column?: number };
  endPosition?: { row?: number; column?: number };
  children?: unknown[];
}

function collectAllWasmErrors(rootNode: unknown) {
  const errs = collectWasmSyntaxErrors(rootNode);
  if (errs.length > 0 || !rootNode || typeof rootNode !== "object") return errs;
  const root = rootNode as ErrNode;
  if (!root.hasError) return errs;
  let target: ErrNode = root;
  let cur: ErrNode | undefined = root;
  while (cur && Array.isArray(cur.children)) {
    const next: ErrNode | undefined = cur.children.find((c): c is ErrNode =>
      Boolean(c && typeof c === "object" && ((c as ErrNode).isError || (c as ErrNode).hasError)),
    );
    if (!next) break;
    target = next;
    cur = next;
  }
  const sp = target.startPosition ?? { row: 0, column: 0 };
  const ep = target.endPosition ?? sp;
  const snippet = (target.text ?? "").trim().replace(/\s+/g, " ").slice(0, 32);
  return [
    {
      message: snippet ? `Unexpected or unclosed syntax near '${snippet}'.` : "Syntax error in input.",
      startLine: (sp.row ?? 0) + 1,
      startColumn: (sp.column ?? 0) + 1,
      endLine: (ep.row ?? sp.row ?? 0) + 1,
      endColumn: Math.max((sp.column ?? 0) + 2, (ep.column ?? 0) + 1),
      startOffset: 0,
      endOffset: 0,
    },
  ];
}

export function validateAspen(text: string): LspDiagnostic[] {
  try {
    const cstTree = getAspenWasmParser().parse(text);
    const syntaxDiags: LspDiagnostic[] = collectAllWasmErrors(cstTree?.rootNode).map((err) => ({
      range: {
        start: { line: Math.max(0, err.startLine - 1), character: Math.max(0, err.startColumn - 1) },
        end: { line: Math.max(0, err.endLine - 1), character: Math.max(0, err.endColumn - 1) },
      },
      severity: 1,
      code: "M8100",
      source: "modelscript-aspen",
      message: `[M8100] ${err.message}`,
    }));

    const deck = parseAspen(text, cstTree);
    const diags = lintAspen(deck);

    const lintDiags: LspDiagnostic[] = diags.map((d) => {
      const severity = d.severity === "error" ? 1 : d.severity === "warning" ? 2 : 3;
      return {
        range: {
          start: { line: Math.max(0, d.loc.startLine - 1), character: Math.max(0, d.loc.startColumn - 1) },
          end: { line: Math.max(0, d.loc.endLine - 1), character: Math.max(0, d.loc.endColumn - 1) },
        },
        severity,
        code: d.code,
        source: "modelscript-aspen",
        message: `[${d.code}] ${d.message}`,
      };
    });

    return [...syntaxDiags, ...lintDiags];
  } catch (err: unknown) {
    return [
      {
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 1 },
        },
        severity: 1,
        code: "M8100",
        source: "modelscript-aspen",
        message: `Parse Error: ${err instanceof Error ? err.message : String(err)}`,
      },
    ];
  }
}

export function getAspenDocumentSymbols(text: string): LspDocumentSymbol[] {
  try {
    const deck = parseAspen(text);
    const symbols: LspDocumentSymbol[] = [];

    // Root symbol
    const rootSymbol: LspDocumentSymbol = {
      name: deck.title ?? "AspenProcess",
      detail: `Property Method: ${deck.propertyMethod ?? "NRTL"}`,
      kind: LspSymbolKind.Package,
      range: {
        start: { line: 0, character: 0 },
        end: { line: Math.max(0, (deck.loc?.endLine ?? 1) - 1), character: 0 },
      },
      selectionRange: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 10 },
      },
      children: [],
    };

    // Components
    for (const [cId, comp] of deck.components) {
      rootSymbol.children!.push({
        name: cId,
        detail: comp.formula ?? "Chemical Species",
        kind: LspSymbolKind.Variable,
        range: {
          start: { line: comp.loc.startLine - 1, character: comp.loc.startColumn - 1 },
          end: { line: comp.loc.endLine - 1, character: comp.loc.endColumn - 1 },
        },
        selectionRange: {
          start: { line: comp.loc.startLine - 1, character: comp.loc.startColumn - 1 },
          end: { line: comp.loc.startLine - 1, character: comp.loc.startColumn - 1 + cId.length },
        },
      });
    }

    // Blocks
    for (const [bId, block] of deck.blocks) {
      rootSymbol.children!.push({
        name: bId,
        detail: `Unit Operation: ${block.type}`,
        kind: LspSymbolKind.Class,
        range: {
          start: { line: block.loc.startLine - 1, character: block.loc.startColumn - 1 },
          end: { line: block.loc.endLine - 1, character: block.loc.endColumn - 1 },
        },
        selectionRange: {
          start: { line: block.loc.startLine - 1, character: block.loc.startColumn - 1 },
          end: { line: block.loc.startLine - 1, character: block.loc.startColumn - 1 + bId.length },
        },
      });
    }

    // Streams
    for (const [sId, stream] of deck.streams) {
      rootSymbol.children!.push({
        name: sId,
        detail: `Stream (T=${stream.temperature ?? 25}C, P=${stream.pressure ?? 1}bar, F=${stream.moleFlow ?? 100}kmol/h)`,
        kind: LspSymbolKind.Field,
        range: {
          start: { line: stream.loc.startLine - 1, character: stream.loc.startColumn - 1 },
          end: { line: stream.loc.endLine - 1, character: stream.loc.endColumn - 1 },
        },
        selectionRange: {
          start: { line: stream.loc.startLine - 1, character: stream.loc.startColumn - 1 },
          end: { line: stream.loc.startLine - 1, character: stream.loc.startColumn - 1 + sId.length },
        },
      });
    }

    symbols.push(rootSymbol);
    return symbols;
  } catch {
    return [];
  }
}

export function getAspenHover(text: string, pos: LspPosition): LspHover | undefined {
  try {
    const deck = parseAspen(text);
    const line = pos.line + 1;
    const col = pos.character + 1;

    // Check blocks
    for (const [bId, block] of deck.blocks) {
      if (
        line >= block.loc.startLine &&
        line <= block.loc.endLine &&
        (line !== block.loc.startLine || col >= block.loc.startColumn)
      ) {
        return {
          contents: {
            kind: "markdown",
            value: `**Aspen Unit Operation: \`${bId}\`**\n- **Type:** ${block.type}\n- **Parameters:** ${JSON.stringify(block.params)}\n${block.nStages ? `- **Stages:** ${block.nStages}\n` : ""}`,
          },
        };
      }
    }

    // Check streams
    for (const [sId, stream] of deck.streams) {
      if (
        line >= stream.loc.startLine &&
        line <= stream.loc.endLine &&
        (line !== stream.loc.startLine || col >= stream.loc.startColumn)
      ) {
        const fracList = Array.from(stream.moleFractions.entries())
          .map(([c, f]) => `  - **${c}:** ${(f * 100).toFixed(1)}%`)
          .join("\n");
        return {
          contents: {
            kind: "markdown",
            value: `**Aspen Stream: \`${sId}\`**\n- **Temperature:** ${stream.temperature ?? 25.0} °C\n- **Pressure:** ${stream.pressure ?? 1.0} bar\n- **Flow Rate:** ${stream.moleFlow ?? 100.0} kmol/hr\n- **Compositions:**\n${fracList}`,
          },
        };
      }
    }

    return undefined;
  } catch {
    return undefined;
  }
}

export async function executeAspenAction(
  actionId: string,
  text: string,
  params?: { streamId?: string | undefined },
): Promise<unknown> {
  const deck = parseAspen(text);

  switch (actionId) {
    case "aspen_lint":
      return lintAspen(deck);
    case "aspen_to_dae": {
      const dae = lowerAspenToDae(deck);
      return {
        modelName: "AspenFlowsheet",
        variableCount: dae.variables().length,
        equationCount: dae.equations().length,
      };
    }
    case "aspen_to_modelica":
      return aspenToModelica(deck);
    case "aspen_solve_flash": {
      const streamId = params?.streamId ?? deck.streams.keys().next().value ?? "FEED";
      const s = deck.streams.get(streamId);
      const comps = Array.from(s?.moleFractions.keys() ?? deck.components.keys());
      const fracs = comps.map((c) => s?.moleFractions.get(c) ?? 1.0 / comps.length);
      return solveFlashRachfordRice({
        temperature: s?.temperature ?? 75.0,
        pressure: s?.pressure ?? 1.2,
        components: comps,
        moleFractions: fracs,
        totalFlow: s?.moleFlow ?? 100.0,
      });
    }
    default:
      throw new Error(`Unknown Aspen action: ${actionId}`);
  }
}
