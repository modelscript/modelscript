// SPDX-License-Identifier: AGPL-3.0-or-later
/* eslint-disable @typescript-eslint/no-explicit-any */

import { simulateGtSuiteTransient } from "./dae/cylinder-dae.js";
import { gtsuiteToDae } from "./dae/gtsuite-to-dae.js";
import { lintGtModel } from "./lints/index.js";
import { parseGtmModel } from "./parser/gtm-parser.js";
import { gtsuiteToModelica, gtsuiteToSsp, gtsuiteToSysml2 } from "./projections/index.js";
import type { GtModel } from "./types.js";

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
 * Validates a GT-SUITE engine model and returns LSP diagnostics.
 */
export function validateGtsuite(content: string, uri: string = "model.gtm"): LspDiagnostic[] {
  try {
    const model = parseGtmModel(content, uri);
    const diags = lintGtModel(model);
    const lines = content.split(/\r?\n/);

    return diags.map((d) => {
      let matchedLine = 0;
      if (d.componentId) {
        const found = lines.findIndex((l) => l.includes(d.componentId!));
        if (found >= 0) matchedLine = found;
      }
      const lineLen = lines[matchedLine]?.length ?? 1;

      return {
        range: {
          start: { line: matchedLine, character: 0 },
          end: { line: matchedLine, character: Math.max(1, lineLen) },
        },
        severity: d.severity === "error" ? 1 : d.severity === "warning" ? 2 : 3,
        code: `M${d.code}`,
        source: "modelscript-gtsuite",
        message: d.message,
      };
    });
  } catch (err: any) {
    return [
      {
        range: DEFAULT_RANGE,
        severity: 1,
        code: "M9000",
        source: "modelscript-gtsuite",
        message: `Failed to parse GT-SUITE model: ${err.message}`,
      },
    ];
  }
}

/**
 * Extracts document symbols for engine cylinders, manifolds, valves, and turbochargers.
 */
export function getGtsuiteDocumentSymbols(content: string, uri: string = "model.gtm"): LspDocumentSymbol[] {
  try {
    const model = parseGtmModel(content, uri);
    const children: LspDocumentSymbol[] = [];

    for (const comp of model.components) {
      let kind = LspSymbolKind.Property;
      let detail = `Kind: ${comp.kind}`;

      if (comp.kind === "cylinder") {
        kind = LspSymbolKind.Class;
        detail = `Bore: ${(comp as any).boreM * 1000}mm | Stroke: ${(comp as any).strokeM * 1000}mm`;
      } else if (comp.kind === "pipe") {
        kind = LspSymbolKind.Field;
        detail = `Len: ${(comp as any).lengthM}m | Diam: ${(comp as any).diameterM * 1000}mm`;
      } else if (comp.kind === "plenum") {
        kind = LspSymbolKind.Namespace;
        detail = `Vol: ${((comp as any).volumeM3 * 1e6).toFixed(0)}cm³`;
      } else if (comp.kind === "turbo_compressor" || comp.kind === "turbo_turbine") {
        kind = LspSymbolKind.Constructor;
        detail = `Type: ${comp.kind}`;
      }

      children.push({
        name: `${comp.title || comp.id} [${comp.kind}]`,
        detail,
        kind,
        range: DEFAULT_RANGE,
        selectionRange: DEFAULT_RANGE,
      });
    }

    return [
      {
        name: model.name || "GT-SUITE Model",
        detail: `Components: ${model.components.length} | Connections: ${model.connections.length} | Speed: ${model.simulationSettings.engineSpeedRpm} RPM`,
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
 * Contextual hover documentation for engine powertrain elements.
 */
export function getGtsuiteHover(
  content: string,
  position: LspPosition,
  uri: string = "model.gtm",
): LspHover | undefined {
  try {
    const model = parseGtmModel(content, uri);
    const lines = content.split(/\r?\n/);
    const line = lines[position.line] ?? "";

    for (const comp of model.components) {
      if (line.includes(comp.id) || (comp.title && line.includes(comp.title))) {
        let details = `### GT-SUITE Component \`${comp.title || comp.id}\`\n- **Kind**: \`${comp.kind}\`\n`;
        if (comp.kind === "cylinder") {
          const cyl = comp as any;
          details += `- **Bore**: ${(cyl.boreM * 1000).toFixed(1)} mm\n- **Stroke**: ${(cyl.strokeM * 1000).toFixed(1)} mm\n- **Compression Ratio**: ${cyl.compressionRatio ?? "default"}\n- **Clearance Vol**: ${cyl.clearanceVolumeM3 ? (cyl.clearanceVolumeM3 * 1e6).toFixed(1) + " cm³" : "calculated"}\n`;
        } else if (comp.kind === "pipe") {
          const pipe = comp as any;
          details += `- **Length**: ${pipe.lengthM} m\n- **Diameter**: ${(pipe.diameterM * 1000).toFixed(1)} mm\n- **Discretization**: ${pipe.discretizationLengthM ? (pipe.discretizationLengthM * 1000).toFixed(1) + " mm" : "auto"}\n`;
        } else if (comp.kind === "plenum") {
          const pl = comp as any;
          details += `- **Volume**: ${(pl.volumeM3 * 1e6).toFixed(1)} cm³\n- **Init Pressure**: ${pl.initialPressurePa ? (pl.initialPressurePa / 1000).toFixed(1) + " kPa" : "101.3 kPa"}\n`;
        }
        return {
          contents: {
            kind: "markdown",
            value: details,
          },
        };
      }
    }

    if (/speed|rpm|duration|timestep|engine/i.test(line)) {
      const s = model.simulationSettings;
      return {
        contents: {
          kind: "markdown",
          value: `### GT-SUITE Simulation Settings\n- **Engine Speed**: ${s.engineSpeedRpm} RPM\n- **Time Step**: ${(s.timeStepSeconds * 1e6).toFixed(1)} µs\n- **Air-Fuel Ratio**: λ = ${s.airFuelRatioLambda}`,
        },
      };
    }

    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Executes domain actions on a GT-SUITE model.
 */
export async function executeGtsuiteAction(action: string, args: Record<string, unknown>): Promise<any> {
  const content = typeof args["content"] === "string" ? args["content"] : "";
  const uri = typeof args["uri"] === "string" ? args["uri"] : "model.gtm";
  const model: GtModel = parseGtmModel(content, uri);

  switch (action) {
    case "lint":
      return lintGtModel(model);

    case "to_modelica":
      return gtsuiteToModelica(model);

    case "to_ssp":
      return gtsuiteToSsp(model);

    case "to_sysml2":
      return gtsuiteToSysml2(model);

    case "to_dae": {
      const dae = gtsuiteToDae(model);
      return {
        varCount: dae.varCount,
        eqCount: dae.eqCount,
      };
    }

    case "simulate": {
      const duration = typeof args["duration"] === "number" ? args["duration"] : 1.0;
      const timeStep = typeof args["timeStep"] === "number" ? args["timeStep"] : 1e-4;
      return simulateGtSuiteTransient(model, { durationSeconds: duration, timeStepSeconds: timeStep });
    }

    default:
      throw new Error(`Unknown GT-SUITE action: ${action}`);
  }
}
