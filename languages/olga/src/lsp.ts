// SPDX-License-Identifier: AGPL-3.0-or-later

import { lowerOlgaToDae } from "./dae/olga-to-dae.js";
import { getOlgaQuickFixes, lintOlgaModel, type OlgaDiagnostic, type OlgaQuickFix } from "./lints/index.js";
import { parseOlga } from "./parser/index.js";
import { olgaToSysml2 } from "./projections/olga-to-sysml2.js";
import { simulateDriftFlux } from "./solver/drift-flux-dae.js";
import type { OlgaFlowpath, OlgaModel, OlgaSimulationResult } from "./types.js";

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
 * Validates an OLGA document and produces LSP diagnostics.
 */
export function validateOlga(content: string, _uri: string = "model.genkey"): LspDiagnostic[] {
  try {
    const model = parseOlga(content);
    const rawDiags = lintOlgaModel(model);

    return rawDiags.map((d) => ({
      range: DEFAULT_RANGE,
      severity: d.severity === "error" ? 1 : d.severity === "warning" ? 2 : 3,
      code: d.code,
      source: "modelscript-olga",
      message: d.message,
    }));
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return [
      {
        range: DEFAULT_RANGE,
        severity: 1,
        code: "M7600",
        source: "modelscript-olga",
        message: `OLGA syntax / deck parse error: ${msg}`,
      },
    ];
  }
}

function extractFlowpathSymbols(fp: OlgaFlowpath): LspDocumentSymbol {
  const children: LspDocumentSymbol[] = [];

  for (const pipe of fp.pipes) {
    children.push({
      name: pipe.label,
      detail: `Pipe (L=${pipe.length}m, D=${pipe.diameter}m, cells=${pipe.discretization})`,
      kind: LspSymbolKind.Field,
      range: DEFAULT_RANGE,
      selectionRange: DEFAULT_RANGE,
    });
  }

  for (const valve of fp.valves) {
    children.push({
      name: valve.name,
      detail: `Valve (opening=${valve.opening}, pos=${valve.position}m)`,
      kind: LspSymbolKind.Variable,
      range: DEFAULT_RANGE,
      selectionRange: DEFAULT_RANGE,
    });
  }

  for (const hex of fp.heatExchangers ?? []) {
    children.push({
      name: hex.name,
      detail: `HeatExchanger (pos=${hex.position}m, duty=${hex.dutyKw ?? 0}kW)`,
      kind: LspSymbolKind.Property,
      range: DEFAULT_RANGE,
      selectionRange: DEFAULT_RANGE,
    });
  }

  return {
    name: fp.name,
    detail: `Flowpath (${fp.pipes.length} pipes, ${fp.valves.length} valves)`,
    kind: LspSymbolKind.Class,
    range: DEFAULT_RANGE,
    selectionRange: DEFAULT_RANGE,
    children: children.length > 0 ? children : undefined,
  };
}

/**
 * Extracts hierarchical LSP document symbols from an OLGA model.
 */
export function getOlgaDocumentSymbols(content: string, _uri: string = "model.genkey"): LspDocumentSymbol[] {
  try {
    const model = parseOlga(content);
    const children: LspDocumentSymbol[] = [];

    for (const fp of model.flowpaths) {
      children.push(extractFlowpathSymbols(fp));
    }

    for (const node of model.nodes) {
      children.push({
        name: node.name,
        detail: `Node [${node.type}] (P=${((node.pressure ?? 0) / 1e5).toFixed(1)} bar)`,
        kind: LspSymbolKind.Interface,
        range: DEFAULT_RANGE,
        selectionRange: DEFAULT_RANGE,
      });
    }

    return [
      {
        name: model.title || model.flowpaths[0]?.name || "OlgaCase",
        detail: `OLGA Simulation (${model.flowpaths.length} flowpaths, ${model.nodes.length} nodes)`,
        kind: LspSymbolKind.Package,
        range: DEFAULT_RANGE,
        selectionRange: DEFAULT_RANGE,
        children: children.length > 0 ? children : undefined,
      },
    ];
  } catch {
    return [];
  }
}

/**
 * Provides contextual hover information for elements in an OLGA deck.
 */
export function getOlgaHover(
  content: string,
  position: LspPosition,
  _uri: string = "model.genkey",
): LspHover | undefined {
  try {
    const model = parseOlga(content);
    const lines = content.split(/\r?\n/);
    const line = lines[position.line] ?? "";

    // Match keywords or flowpath / node labels on hovered line
    for (const fp of model.flowpaths) {
      if (line.includes(fp.name)) {
        return {
          contents: {
            kind: "markdown",
            value: `### OLGA Flowpath \`${fp.name}\`\n- **Pipes**: ${fp.pipes.length}\n- **Valves**: ${fp.valves.length}\n- **Heat Exchangers**: ${fp.heatExchangers?.length ?? 0}`,
          },
        };
      }
      for (const p of fp.pipes) {
        if (line.includes(p.label)) {
          return {
            contents: {
              kind: "markdown",
              value: `### OLGA Pipe \`${p.label}\` (Flowpath: \`${fp.name}\`)\n- **Length**: ${p.length} m\n- **Diameter**: ${p.diameter} m\n- **Roughness**: ${p.roughness} m\n- **Discretization**: ${p.discretization} cells`,
            },
          };
        }
      }
    }

    for (const node of model.nodes) {
      if (line.includes(node.name)) {
        return {
          contents: {
            kind: "markdown",
            value: `### OLGA Node \`${node.name}\`\n- **Type**: \`${node.type}\`\n- **Pressure**: ${((node.pressure ?? 0) / 1e5).toFixed(2)} bar\n- **Temperature**: ${((node.temperature ?? 273.15) - 273.15).toFixed(1)} °C`,
          },
        };
      }
    }

    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Executes domain actions on an OLGA model.
 */
export async function executeOlgaAction(action: "lint", args: Record<string, unknown>): Promise<OlgaDiagnostic[]>;
export async function executeOlgaAction(action: "to_sysml", args: Record<string, unknown>): Promise<string>;
export async function executeOlgaAction(
  action: "to_dae",
  args: Record<string, unknown>,
): Promise<{ varCount: number; eqCount: number }>;
export async function executeOlgaAction(
  action: "simulate_drift_flux",
  args: Record<string, unknown>,
): Promise<OlgaSimulationResult>;
export async function executeOlgaAction(action: string, args: Record<string, unknown>): Promise<unknown>;
export async function executeOlgaAction(action: string, args: Record<string, unknown>): Promise<unknown> {
  const content = typeof args["content"] === "string" ? args["content"] : "";
  const model: OlgaModel = parseOlga(content);

  switch (action) {
    case "lint":
      return lintOlgaModel(model);

    case "to_sysml":
      return olgaToSysml2(model);

    case "to_dae": {
      const dae = lowerOlgaToDae(model);
      return {
        varCount: dae.varCount,
        eqCount: dae.eqCount,
      };
    }

    case "simulate_drift_flux": {
      const duration = typeof args["duration"] === "number" ? args["duration"] : 60.0;
      return simulateDriftFlux(model, { durationSeconds: duration });
    }

    default:
      throw new Error(`Unknown OLGA action: ${action}`);
  }
}

export { getOlgaQuickFixes, type OlgaQuickFix };
