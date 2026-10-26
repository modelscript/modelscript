// SPDX-License-Identifier: AGPL-3.0-or-later
/* eslint-disable @typescript-eslint/no-explicit-any */

import { lowerSimaToDae } from "./dae/sima-to-dae.js";
import { lintSimaProject } from "./lints/index.js";
import { parseSimaFile } from "./parser/index.js";
import { simaToModelica, simaToSsp, simaToSysml2 } from "./projections/index.js";
import { simulateCumminsDynamics } from "./solver/index.js";
import type { SimaModel } from "./types.js";

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
 * Validates a SIMO/RIFLEX or SIMA XML marine file and returns diagnostics.
 */
export function validateSima(content: string, uri: string = "model.inp"): LspDiagnostic[] {
  try {
    const model = parseSimaFile(content, uri);
    const diags = lintSimaProject(model);
    const lines = content.split(/\r?\n/);

    return diags.map((d) => {
      // Find matching line in source if possible
      let matchedLine = 0;
      if (d.target) {
        const found = lines.findIndex((l) => l.includes(d.target!));
        if (found >= 0) matchedLine = found;
      }
      const lineLen = lines[matchedLine]?.length ?? 1;

      return {
        range: {
          start: { line: matchedLine, character: 0 },
          end: { line: matchedLine, character: Math.max(1, lineLen) },
        },
        severity: d.severity === "error" ? 1 : d.severity === "warning" ? 2 : 3,
        code: String(d.code),
        source: "modelscript-sima",
        message: d.message,
      };
    });
  } catch (err: any) {
    return [
      {
        range: DEFAULT_RANGE,
        severity: 1,
        code: "M7000",
        source: "modelscript-sima",
        message: `Failed to parse SIMA model: ${err.message}`,
      },
    ];
  }
}

/**
 * Extracts document symbols for floater vessels, fairleads, mooring lines, and environmental conditions.
 */
export function getSimaDocumentSymbols(content: string, uri: string = "model.inp"): LspDocumentSymbol[] {
  try {
    const model = parseSimaFile(content, uri);
    const children: LspDocumentSymbol[] = [];

    // Environment
    children.push({
      name: "Environment",
      detail: `Depth: ${model.environment.waterDepth}m | Hs: ${model.environment.wave.hs}m | Tp: ${model.environment.wave.tp}s`,
      kind: LspSymbolKind.Namespace,
      range: DEFAULT_RANGE,
      selectionRange: DEFAULT_RANGE,
    });

    // Vessels
    for (const vessel of model.vessels) {
      const fairleadChildren: LspDocumentSymbol[] = vessel.fairleads.map((f) => ({
        name: `Fairlead ${f.name}`,
        detail: `Pos: [${f.position.join(", ")}]`,
        kind: LspSymbolKind.Field,
        range: DEFAULT_RANGE,
        selectionRange: DEFAULT_RANGE,
      }));

      children.push({
        name: `Vessel ${vessel.name}`,
        detail: `Mass: ${(vessel.mass / 1000).toFixed(1)}t | Disp: ${vessel.displacement.toFixed(1)}m³ | GMt: ${vessel.gmTransverse}m`,
        kind: LspSymbolKind.Class,
        range: DEFAULT_RANGE,
        selectionRange: DEFAULT_RANGE,
        children: fairleadChildren.length > 0 ? fairleadChildren : undefined,
      });
    }

    // Mooring Lines
    for (const line of model.lines) {
      const segSummary = line.segments.map((s) => `${s.length}m ${s.name}`).join(", ");
      children.push({
        name: `Mooring Line ${line.name}`,
        detail: `Type: ${line.type} | Len: ${line.totalLength}m | Segments: [${segSummary}]`,
        kind: LspSymbolKind.Property,
        range: DEFAULT_RANGE,
        selectionRange: DEFAULT_RANGE,
      });
    }

    return [
      {
        name: model.title || "SIMA Marine System",
        detail: `Vessels: ${model.vessels.length} | Lines: ${model.lines.length} | Depth: ${model.environment.waterDepth}m`,
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
 * Contextual hover documentation for marine offshore floater & mooring elements.
 */
export function getSimaHover(content: string, position: LspPosition, uri: string = "model.inp"): LspHover | undefined {
  try {
    const model = parseSimaFile(content, uri);
    const lines = content.split(/\r?\n/);
    const line = lines[position.line] ?? "";

    // Match vessel by name or id
    for (const v of model.vessels) {
      if (line.includes(v.name) || line.includes(v.id)) {
        return {
          contents: {
            kind: "markdown",
            value: `### Floater Vessel \`${v.name}\`\n- **Mass**: ${(v.mass / 1000).toFixed(1)} tonnes\n- **Displacement**: ${v.displacement.toFixed(1)} m³\n- **Transverse GM (GMt)**: ${v.gmTransverse} m\n- **Longitudinal GM (GMl)**: ${v.gmLongitudinal} m\n- **Fairleads**: ${v.fairleads.length}`,
          },
        };
      }
    }

    // Match mooring line by name or id
    for (const ml of model.lines) {
      if (line.includes(ml.name) || line.includes(ml.id)) {
        return {
          contents: {
            kind: "markdown",
            value: `### Mooring Line \`${ml.name}\`\n- **Type**: \`${ml.type}\`\n- **Total Unstretched Length**: ${ml.totalLength} m\n- **Segments**: ${ml.segments.length}\n- **Anchor Position**: [${ml.anchorPosition.join(", ")}]\n- **Pretension**: ${ml.pretension ? `${(ml.pretension / 1000).toFixed(1)} kN` : "Nominal catenary"}`,
          },
        };
      }
    }

    // Match environmental keywords
    if (/wave|depth|density|wind|current|env/i.test(line)) {
      const env = model.environment;
      return {
        contents: {
          kind: "markdown",
          value: `### Marine Environment\n- **Water Depth**: ${env.waterDepth} m\n- **Water Density**: ${env.waterDensity} kg/m³\n- **Wave**: Hs = ${env.wave.hs} m, Tp = ${env.wave.tp} s (${env.wave.spectrum})\n- **Wind**: Speed = ${env.wind.speed} m/s, Dir = ${env.wind.direction}°\n- **Current**: Speed = ${env.current.surfaceSpeed} m/s`,
        },
      };
    }

    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Executes domain actions on a SIMA model.
 */
export async function executeSimaAction(action: string, args: Record<string, unknown>): Promise<any> {
  const content = typeof args["content"] === "string" ? args["content"] : "";
  const uri = typeof args["uri"] === "string" ? args["uri"] : "model.inp";
  const model: SimaModel = parseSimaFile(content, uri);

  switch (action) {
    case "lint":
      return lintSimaProject(model);

    case "to_modelica":
      return simaToModelica(model);

    case "to_ssp":
      return simaToSsp(model);

    case "to_sysml2":
      return simaToSysml2(model);

    case "to_dae": {
      const dae = lowerSimaToDae(model);
      return {
        varCount: dae.varCount,
        eqCount: dae.eqCount,
      };
    }

    case "simulate": {
      const vessel = model.vessels[0];
      if (!vessel) throw new Error("No vessel found in SIMA model to simulate.");
      const duration = typeof args["duration"] === "number" ? args["duration"] : 10;
      const timeStep = typeof args["timeStep"] === "number" ? args["timeStep"] : 0.1;
      return simulateCumminsDynamics(vessel, model, {
        durationSeconds: duration,
        timeStepSeconds: timeStep,
        waveHs: model.environment.wave.hs,
        waveTp: model.environment.wave.tp,
      });
    }

    default:
      throw new Error(`Unknown SIMA action: ${action}`);
  }
}
