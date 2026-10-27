// SPDX-License-Identifier: AGPL-3.0-or-later

import { lowerSwmmToDae } from "./dae/swmm-to-dae.js";
import { lintSwmm } from "./lints/index.js";
import { parseSwmm } from "./parser/swmm-parser.js";
import { swmmToModelica } from "./projections/swmm-to-modelica.js";
import { routeNetworkFlow } from "./solver/hydraulic-solver.js";

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

export function validateSwmm(text: string): LspDiagnostic[] {
  try {
    const deck = parseSwmm(text);
    const diags = lintSwmm(deck);

    return diags.map((d) => {
      const severity = d.severity === "error" ? 1 : d.severity === "warning" ? 2 : 3;
      return {
        range: {
          start: { line: Math.max(0, d.range.startLine - 1), character: Math.max(0, d.range.startColumn - 1) },
          end: { line: Math.max(0, d.range.endLine - 1), character: Math.max(0, d.range.endColumn - 1) },
        },
        severity,
        code: d.code,
        source: "modelscript-swmm",
        message: `[${d.code}] ${d.message}`,
      };
    });
  } catch (err: unknown) {
    return [
      {
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 1 },
        },
        severity: 1,
        code: "M8200",
        source: "modelscript-swmm",
        message: `Parse Error: ${err instanceof Error ? err.message : String(err)}`,
      },
    ];
  }
}

export function getSwmmDocumentSymbols(text: string): LspDocumentSymbol[] {
  try {
    const deck = parseSwmm(text);
    const symbols: LspDocumentSymbol[] = [];

    const rootSymbol: LspDocumentSymbol = {
      name: deck.title ?? "SwmmNetwork",
      detail: `Flow Units: ${deck.flowUnits}, Routing: ${deck.routingModel}`,
      kind: LspSymbolKind.Package,
      range: {
        start: { line: 0, character: 0 },
        end: { line: Math.max(0, (deck.range?.endLine ?? 1) - 1), character: 0 },
      },
      selectionRange: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 10 },
      },
      children: [],
    };

    // Junctions
    for (const [id, j] of deck.junctions) {
      rootSymbol.children!.push({
        name: id,
        detail: `Junction (Elev=${j.elevation}m, MaxDepth=${j.maxDepth}m)`,
        kind: LspSymbolKind.Variable,
        range: {
          start: { line: j.range.startLine - 1, character: j.range.startColumn - 1 },
          end: { line: j.range.endLine - 1, character: j.range.endColumn - 1 },
        },
        selectionRange: {
          start: { line: j.range.startLine - 1, character: j.range.startColumn - 1 },
          end: { line: j.range.startLine - 1, character: j.range.startColumn - 1 + id.length },
        },
      });
    }

    // Outfalls
    for (const [id, o] of deck.outfalls) {
      rootSymbol.children!.push({
        name: id,
        detail: `Outfall [${o.type}] (Elev=${o.elevation}m)`,
        kind: LspSymbolKind.Variable,
        range: {
          start: { line: o.range.startLine - 1, character: o.range.startColumn - 1 },
          end: { line: o.range.endLine - 1, character: o.range.endColumn - 1 },
        },
        selectionRange: {
          start: { line: o.range.startLine - 1, character: o.range.startColumn - 1 },
          end: { line: o.range.startLine - 1, character: o.range.startColumn - 1 + id.length },
        },
      });
    }

    // Conduits
    for (const [id, c] of deck.conduits) {
      rootSymbol.children!.push({
        name: id,
        detail: `Conduit (${c.inletNode} -> ${c.outletNode}, L=${c.length}m, n=${c.roughness})`,
        kind: LspSymbolKind.Class,
        range: {
          start: { line: c.range.startLine - 1, character: c.range.startColumn - 1 },
          end: { line: c.range.endLine - 1, character: c.range.endColumn - 1 },
        },
        selectionRange: {
          start: { line: c.range.startLine - 1, character: c.range.startColumn - 1 },
          end: { line: c.range.startLine - 1, character: c.range.startColumn - 1 + id.length },
        },
      });
    }

    // Subcatchments
    for (const [id, sc] of deck.subcatchments) {
      rootSymbol.children!.push({
        name: id,
        detail: `Subcatchment (Area=${sc.area}ha, Imperv=${sc.impervPct}%, Outlet=${sc.outlet})`,
        kind: LspSymbolKind.Field,
        range: {
          start: { line: sc.range.startLine - 1, character: sc.range.startColumn - 1 },
          end: { line: sc.range.endLine - 1, character: sc.range.endColumn - 1 },
        },
        selectionRange: {
          start: { line: sc.range.startLine - 1, character: sc.range.startColumn - 1 },
          end: { line: sc.range.startLine - 1, character: sc.range.startColumn - 1 + id.length },
        },
      });
    }

    symbols.push(rootSymbol);
    return symbols;
  } catch {
    return [];
  }
}

export function getSwmmHover(text: string, pos: LspPosition): LspHover | undefined {
  try {
    const deck = parseSwmm(text);
    const line = pos.line + 1;

    // Check Conduits
    for (const [id, c] of deck.conduits) {
      if (line >= c.range.startLine && line <= c.range.endLine) {
        const xsec = deck.crossSections.get(id);
        return {
          contents: {
            kind: "markdown",
            value: `**SWMM Conduit: \`${id}\`**\n- **Inlet Node:** ${c.inletNode}\n- **Outlet Node:** ${c.outletNode}\n- **Length:** ${c.length} m\n- **Manning n:** ${c.roughness}\n${xsec ? `- **Cross-Section:** ${xsec.shape} (Geom1=${xsec.geom1}m)\n` : ""}`,
          },
        };
      }
    }

    // Check Junctions
    for (const [id, j] of deck.junctions) {
      if (line >= j.range.startLine && line <= j.range.endLine) {
        return {
          contents: {
            kind: "markdown",
            value: `**SWMM Junction: \`${id}\`**\n- **Invert Elevation:** ${j.elevation} m\n- **Max Depth:** ${j.maxDepth} m\n- **Initial Depth:** ${j.initDepth ?? 0} m\n- **Surcharge Depth:** ${j.surDepth ?? 0} m`,
          },
        };
      }
    }

    return undefined;
  } catch {
    return undefined;
  }
}

export async function executeSwmmAction(actionId: string, text: string): Promise<unknown> {
  const deck = parseSwmm(text);

  switch (actionId) {
    case "swmm_lint":
      return lintSwmm(deck);
    case "swmm_to_dae": {
      const dae = lowerSwmmToDae(deck);
      return {
        modelName: "StormwaterNetwork",
        variableCount: dae.variables().length,
        equationCount: dae.equations().length,
      };
    }
    case "swmm_to_modelica":
      return swmmToModelica(deck);
    case "swmm_route_flow":
      return routeNetworkFlow(deck);
    default:
      throw new Error(`Unknown SWMM action: ${actionId}`);
  }
}
