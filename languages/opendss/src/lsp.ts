// SPDX-License-Identifier: AGPL-3.0-or-later
/* eslint-disable @typescript-eslint/no-explicit-any */

import { lowerOpenDssToDae } from "./dae/opendss-to-dae.js";
import { lintOpenDss } from "./lints/index.js";
import { parseOpenDss } from "./parser/opendss-parser.js";
import { openDssToModelica } from "./projections/opendss-to-modelica.js";
import { solveDistributionPowerFlow } from "./solvers/power-flow-solver.js";

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

export function validateOpenDss(text: string): LspDiagnostic[] {
  try {
    const deck = parseOpenDss(text);
    const diags = lintOpenDss(deck);

    return diags.map((d) => {
      const severity = d.severity === "error" ? 1 : d.severity === "warning" ? 2 : 3;
      return {
        range: {
          start: { line: Math.max(0, d.range.startLine - 1), character: Math.max(0, d.range.startCol - 1) },
          end: { line: Math.max(0, d.range.endLine - 1), character: Math.max(0, d.range.endCol - 1) },
        },
        severity,
        code: `M${d.code}`,
        source: "modelscript-opendss",
        message: `[M${d.code}] ${d.message}`,
      };
    });
  } catch (err: any) {
    return [
      {
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 1 },
        },
        severity: 1,
        code: "M8400",
        source: "modelscript-opendss",
        message: `Parse Error: ${err.message}`,
      },
    ];
  }
}

export function getOpenDssDocumentSymbols(text: string): LspDocumentSymbol[] {
  try {
    const deck = parseOpenDss(text);
    const symbols: LspDocumentSymbol[] = [];

    const rootSymbol: LspDocumentSymbol = {
      name: deck.circuit ? `Circuit.${deck.circuit.name}` : "OpenDSS Circuit",
      detail: deck.circuit ? `${deck.circuit.baseKv} kV, ${deck.circuit.phases} Phases` : "Grid Model",
      kind: LspSymbolKind.Package,
      range: {
        start: { line: 0, character: 0 },
        end: { line: 100, character: 0 },
      },
      selectionRange: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 15 },
      },
      children: [],
    };

    // Transformers
    for (const [id, xfmr] of deck.transformers) {
      rootSymbol.children!.push({
        name: `Transformer.${id}`,
        detail: `[${xfmr.buses.join(" -> ")}] (${xfmr.kvs.join("kV / ")}kV)`,
        kind: LspSymbolKind.Class,
        range: {
          start: { line: Math.max(0, xfmr.range.startLine - 1), character: 0 },
          end: { line: Math.max(0, xfmr.range.endLine - 1), character: 30 },
        },
        selectionRange: {
          start: { line: Math.max(0, xfmr.range.startLine - 1), character: 0 },
          end: { line: Math.max(0, xfmr.range.startLine - 1), character: id.length },
        },
      });
    }

    // Lines
    for (const [id, line] of deck.lines) {
      rootSymbol.children!.push({
        name: `Line.${id}`,
        detail: `(${line.bus1} -> ${line.bus2}, L=${line.length})`,
        kind: LspSymbolKind.Class,
        range: {
          start: { line: Math.max(0, line.range.startLine - 1), character: 0 },
          end: { line: Math.max(0, line.range.endLine - 1), character: 30 },
        },
        selectionRange: {
          start: { line: Math.max(0, line.range.startLine - 1), character: 0 },
          end: { line: Math.max(0, line.range.startLine - 1), character: id.length },
        },
      });
    }

    // Loads
    for (const [id, load] of deck.loads) {
      rootSymbol.children!.push({
        name: `Load.${id}`,
        detail: `(Bus: ${load.bus1}, P=${load.kw}kW, Q=${load.kvar}kvar)`,
        kind: LspSymbolKind.Variable,
        range: {
          start: { line: Math.max(0, load.range.startLine - 1), character: 0 },
          end: { line: Math.max(0, load.range.endLine - 1), character: 30 },
        },
        selectionRange: {
          start: { line: Math.max(0, load.range.startLine - 1), character: 0 },
          end: { line: Math.max(0, load.range.startLine - 1), character: id.length },
        },
      });
    }

    // PV Systems
    for (const [id, pv] of deck.pvSystems) {
      rootSymbol.children!.push({
        name: `PVSystem.${id}`,
        detail: `(Bus: ${pv.bus1}, Pmpp=${pv.pmpp}kW, S=${pv.kva}kVA)`,
        kind: LspSymbolKind.Field,
        range: {
          start: { line: Math.max(0, pv.range.startLine - 1), character: 0 },
          end: { line: Math.max(0, pv.range.endLine - 1), character: 30 },
        },
        selectionRange: {
          start: { line: Math.max(0, pv.range.startLine - 1), character: 0 },
          end: { line: Math.max(0, pv.range.startLine - 1), character: id.length },
        },
      });
    }

    symbols.push(rootSymbol);
    return symbols;
  } catch {
    return [];
  }
}

export function getOpenDssHover(text: string, pos: LspPosition): LspHover | undefined {
  try {
    const deck = parseOpenDss(text);
    const line = pos.line + 1;

    // Check circuit
    if (deck.circuit && deck.circuit.range.startLine === line) {
      return {
        contents: {
          kind: "markdown",
          value: `**OpenDSS Circuit: \`${deck.circuit.name}\`**\n- **Substation Voltage:** ${deck.circuit.baseKv} kV\n- **Per-Unit:** ${deck.circuit.pu} pu\n- **Phases:** ${deck.circuit.phases}\n- **Source Bus:** ${deck.circuit.bus1}`,
        },
      };
    }

    // Check lines
    for (const [id, l] of deck.lines) {
      if (l.range.startLine === line) {
        return {
          contents: {
            kind: "markdown",
            value: `**Distribution Line: \`Line.${id}\`**\n- **Bus1:** ${l.bus1}\n- **Bus2:** ${l.bus2}\n- **Phases:** ${l.phases}\n- **Length:** ${l.length} ${l.units ?? ""}\n${l.lineCode ? `- **LineCode:** ${l.lineCode}\n` : ""}`,
          },
        };
      }
    }

    // Check transformers
    for (const [id, xfmr] of deck.transformers) {
      if (xfmr.range.startLine === line) {
        return {
          contents: {
            kind: "markdown",
            value: `**Transformer: \`Transformer.${id}\`**\n- **Buses:** ${xfmr.buses.join(" -> ")}\n- **Voltages:** ${xfmr.kvs.join(" kV / ")} kV\n- **Ratings:** ${xfmr.kvas.join(" kVA / ")} kVA`,
          },
        };
      }
    }

    // Check loads
    for (const [id, load] of deck.loads) {
      if (load.range.startLine === line) {
        return {
          contents: {
            kind: "markdown",
            value: `**Load: \`Load.${id}\`**\n- **Bus:** ${load.bus1}\n- **Voltage:** ${load.kv} kV\n- **Power:** ${load.kw} kW\n- **Reactive:** ${load.kvar} kvar`,
          },
        };
      }
    }

    return undefined;
  } catch {
    return undefined;
  }
}

export async function executeOpenDssAction(actionId: string, text: string): Promise<any> {
  const deck = parseOpenDss(text);

  switch (actionId) {
    case "opendss_lint":
      return lintOpenDss(deck);
    case "opendss_powerflow":
      return solveDistributionPowerFlow(deck);
    case "opendss_to_dae": {
      const dae = lowerOpenDssToDae(deck);
      return {
        modelName: deck.circuit?.name || "DistributionGrid",
        variableCount: dae.variables().length,
        equationCount: dae.equations().length,
      };
    }
    case "opendss_to_modelica":
      return openDssToModelica(deck);
    default:
      throw new Error(`Unknown OpenDSS action: ${actionId}`);
  }
}
