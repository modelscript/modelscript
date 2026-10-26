// SPDX-License-Identifier: AGPL-3.0-or-later
/* eslint-disable @typescript-eslint/no-explicit-any */

import { lowerLpsToDae } from "./dae/lps-to-dae.js";
import { lintLpsModel } from "./lints/index.js";
import { parseLps } from "./parser/index.js";
import { lpsToModelica } from "./projections/lps-to-modelica.js";
import { lpsToSysml2 } from "./projections/lps-to-sysml2.js";
import { SteadyNetworkSolver } from "./solver/steady/steady-network-solver.js";
import { GasEulerDaeSolver } from "./solver/transient/gas-euler-dae.js";
import type { LpsModel } from "./types.js";

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
  severity: 1 | 2 | 3 | 4; // 1 = Error, 2 = Warning, 3 = Information, 4 = Hint
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

const DEFAULT_RANGE: LspRange = {
  start: { line: 0, character: 0 },
  end: { line: 0, character: 1 },
};

/**
 * Validates a PipelineStudio model deck / XML and emits pre-flight diagnostics.
 */
export function validateLps(content: string, _uri: string = "network.lps"): LspDiagnostic[] {
  try {
    const model = parseLps(content);
    const issues = lintLpsModel(model);
    const lines = content.split(/\r?\n/);

    return issues.map((issue) => {
      let targetLine = 0;
      if (issue.target) {
        const found = lines.findIndex((l) => l.includes(issue.target!));
        if (found >= 0) targetLine = found;
      }

      return {
        range: {
          start: { line: targetLine, character: 0 },
          end: { line: targetLine, character: lines[targetLine]?.length ?? 1 },
        },
        severity: issue.severity === "error" ? 1 : issue.severity === "warning" ? 2 : 3,
        code: issue.code,
        source: "modelscript-lps",
        message: issue.message,
      };
    });
  } catch (err: any) {
    return [
      {
        range: DEFAULT_RANGE,
        severity: 1,
        code: "M8000",
        source: "modelscript-lps",
        message: `Failed to parse PipelineStudio network: ${err.message}`,
      },
    ];
  }
}

/**
 * Extracts document symbol hierarchy for pipeline network components.
 */
export function getLpsDocumentSymbols(content: string, _uri: string = "network.lps"): LspDocumentSymbol[] {
  try {
    const model = parseLps(content);
    const children: LspDocumentSymbol[] = [];

    // Nodes
    for (const node of model.nodes) {
      children.push({
        name: node.name,
        detail: `Node [${node.type}] (Elev: ${node.elevation}m, P=${((node.pressure ?? 0) / 1e5).toFixed(1)} bar)`,
        kind: LspSymbolKind.Interface,
        range: DEFAULT_RANGE,
        selectionRange: DEFAULT_RANGE,
      });
    }

    // Pipes
    for (const pipe of model.pipes) {
      children.push({
        name: pipe.name,
        detail: `Pipe [${pipe.fromNode} -> ${pipe.toNode}] (L=${(pipe.length / 1000).toFixed(1)}km, D=${(pipe.diameter * 1000).toFixed(0)}mm, MAOP=${(pipe.maop / 1e5).toFixed(1)} bar)`,
        kind: LspSymbolKind.Property,
        range: DEFAULT_RANGE,
        selectionRange: DEFAULT_RANGE,
      });
    }

    // Compressors
    for (const comp of model.compressors) {
      children.push({
        name: comp.name,
        detail: `Compressor [${comp.fromNode} -> ${comp.toNode}] (${(comp.maxPower / 1e6).toFixed(1)} MW, PR=${comp.maxPressureRatio})`,
        kind: LspSymbolKind.Class,
        range: DEFAULT_RANGE,
        selectionRange: DEFAULT_RANGE,
      });
    }

    // Regulators
    for (const reg of model.regulators) {
      children.push({
        name: reg.name,
        detail: `Regulator [${reg.fromNode} -> ${reg.toNode}] (P_set=${(reg.setpointPressure / 1e5).toFixed(1)} bar)`,
        kind: LspSymbolKind.Field,
        range: DEFAULT_RANGE,
        selectionRange: DEFAULT_RANGE,
      });
    }

    return [
      {
        name: model.title || model.id || "PipelineNetwork",
        detail: `PipelineStudio Network (${model.nodes.length} nodes, ${model.pipes.length} pipes, ${model.compressors.length} compressors)`,
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
 * Contextual hover documentation for pipeline network elements.
 */
export function getLpsHover(
  content: string,
  position: LspPosition,
  _uri: string = "network.lps",
): LspHover | undefined {
  try {
    const model = parseLps(content);
    const lines = content.split(/\r?\n/);
    const line = lines[position.line] ?? "";

    for (const pipe of model.pipes) {
      if (line.includes(pipe.name)) {
        return {
          contents: {
            kind: "markdown",
            value: `### PipelineStudio Pipe \`${pipe.name}\`\n- **From**: \`${pipe.fromNode}\` -> **To**: \`${pipe.toNode}\`\n- **Length**: ${(pipe.length / 1000).toFixed(2)} km\n- **Diameter**: ${(pipe.diameter * 1000).toFixed(1)} mm\n- **Roughness**: ${(pipe.roughness * 1e6).toFixed(1)} µm\n- **MAOP**: ${(pipe.maop / 1e5).toFixed(1)} bar`,
          },
        };
      }
    }

    for (const node of model.nodes) {
      if (line.includes(node.name)) {
        return {
          contents: {
            kind: "markdown",
            value: `### PipelineStudio Node \`${node.name}\`\n- **Type**: \`${node.type}\`\n- **Elevation**: ${node.elevation} m\n- **Pressure**: ${((node.pressure ?? 0) / 1e5).toFixed(2)} bar\n- **Temperature**: ${((node.temperature ?? 293.15) - 273.15).toFixed(1)} °C`,
          },
        };
      }
    }

    for (const comp of model.compressors) {
      if (line.includes(comp.name)) {
        return {
          contents: {
            kind: "markdown",
            value: `### Compressor Station \`${comp.name}\`\n- **Type**: \`${comp.type}\`\n- **Driver Power**: ${(comp.maxPower / 1e6).toFixed(2)} MW\n- **Max Pressure Ratio**: ${comp.maxPressureRatio}\n- **Efficiency**: ${(comp.polytropicEfficiency * 100).toFixed(1)}%`,
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
 * Executes domain actions on a PipelineStudio model.
 */
export async function executeLpsAction(action: string, args: Record<string, unknown>): Promise<any> {
  const content = typeof args["content"] === "string" ? args["content"] : "";
  const model: LpsModel = parseLps(content);

  switch (action) {
    case "lint":
      return lintLpsModel(model);

    case "to_sysml":
      return lpsToSysml2(model);

    case "to_modelica":
      return lpsToModelica(model);

    case "to_dae": {
      const dae = lowerLpsToDae(model);
      return {
        varCount: dae.varCount,
        eqCount: dae.eqCount,
      };
    }

    case "solve_steady":
      return SteadyNetworkSolver.solve(model);

    case "simulate_transient": {
      const duration = typeof args["duration"] === "number" ? args["duration"] : 3600;
      return GasEulerDaeSolver.simulate(model, { durationSeconds: duration });
    }

    default:
      throw new Error(`Unknown LPS action: ${action}`);
  }
}
