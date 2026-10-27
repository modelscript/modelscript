// SPDX-License-Identifier: AGPL-3.0-or-later

import { lowerRelap5ToDae } from "./dae/relap5-to-dae.js";
import { lintRelap5 } from "./lints/index.js";
import { parseRelap5 } from "./parser/relap5-parser.js";
import { relap5ToModelica } from "./projections/relap5-to-modelica.js";
import { solvePointKinetics, type KineticsSolverOptions } from "./solvers/point-kinetics-solver.js";

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
  code: number | string;
  source: string;
  message: string;
}

export interface LspHover {
  contents: {
    kind: "markdown";
    value: string;
  };
}

export function validateRelap5(text: string): LspDiagnostic[] {
  try {
    const deck = parseRelap5(text);
    const diags = lintRelap5(deck);

    return diags.map((d) => {
      const line = d.range ? Math.max(0, d.range.startLine - 1) : 0;
      const col = d.range ? Math.max(0, d.range.startColumn - 1) : 0;
      const endLine = d.range ? Math.max(0, d.range.endLine - 1) : line;
      const endCol = d.range ? Math.max(0, d.range.endColumn - 1) : col + 10;

      let sev: 1 | 2 | 3 = 1;
      if (d.severity === "warning") sev = 2;
      if (d.severity === "info") sev = 3;

      return {
        range: {
          start: { line, character: col },
          end: { line: endLine, character: endCol },
        },
        severity: sev,
        code: `M${d.code}`,
        source: "relap5-linter",
        message: d.message,
      };
    });
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return [
      {
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 10 },
        },
        severity: 1,
        code: "M8600",
        source: "relap5-parser",
        message: `RELAP5 parse error: ${errMsg}`,
      },
    ];
  }
}

export function getRelap5DocumentSymbols(text: string): LspDocumentSymbol[] {
  const deck = parseRelap5(text);
  const symbols: LspDocumentSymbol[] = [];

  const rootRange: LspRange = {
    start: { line: 0, character: 0 },
    end: { line: text.split("\n").length, character: 0 },
  };

  const volumeSymbols: LspDocumentSymbol[] = [];
  for (const vol of deck.volumes.values()) {
    const startLine = vol.range ? Math.max(0, vol.range.startLine - 1) : 0;
    const endLine = vol.range ? Math.max(0, vol.range.endLine - 1) : startLine;
    const r: LspRange = {
      start: { line: startLine, character: 0 },
      end: { line: endLine, character: 40 },
    };
    volumeSymbols.push({
      name: vol.name,
      detail: `Volume ${vol.id} (${vol.type}) P=${(vol.initialPressure / 1e6).toFixed(2)}MPa, T=${vol.initialTemperature.toFixed(1)}K`,
      kind: LspSymbolKind.Class,
      range: r,
      selectionRange: r,
    });
  }

  const junctionSymbols: LspDocumentSymbol[] = [];
  for (const junc of deck.junctions.values()) {
    const startLine = junc.range ? Math.max(0, junc.range.startLine - 1) : 0;
    const endLine = junc.range ? Math.max(0, junc.range.endLine - 1) : startLine;
    const r: LspRange = {
      start: { line: startLine, character: 0 },
      end: { line: endLine, character: 40 },
    };
    junctionSymbols.push({
      name: `Junc_${junc.id}`,
      detail: `Junction ${junc.id}: ${junc.fromVolume} -> ${junc.toVolume} (A=${junc.area.toFixed(3)}m²)`,
      kind: LspSymbolKind.Field,
      range: r,
      selectionRange: r,
    });
  }

  const otherChildren: LspDocumentSymbol[] = [];
  if (deck.kinetics) {
    otherChildren.push({
      name: "ReactorPointKinetics",
      detail: `Core Power: ${(deck.kinetics.initialPower / 1e6).toFixed(1)} MWth, 6 Delayed Precursor Groups`,
      kind: LspSymbolKind.Module,
      range: rootRange,
      selectionRange: rootRange,
    });
  }

  for (const trip of deck.trips.values()) {
    otherChildren.push({
      name: `Trip_${trip.id}`,
      detail: trip.isLogical ? "Logical Trip" : `Trip on ${trip.variableName} ${trip.operator} ${trip.setpoint}`,
      kind: LspSymbolKind.Event,
      range: rootRange,
      selectionRange: rootRange,
    });
  }

  symbols.push({
    name: deck.title,
    detail: `RELAP5 ${deck.executionType} ${deck.problemType} (${deck.volumes.size} volumes, ${deck.junctions.size} junctions)`,
    kind: LspSymbolKind.Package,
    range: rootRange,
    selectionRange: rootRange,
    children: [...volumeSymbols, ...junctionSymbols, ...otherChildren],
  });

  return symbols;
}

export function getRelap5Hover(text: string, position: LspPosition): LspHover | null {
  const deck = parseRelap5(text);
  const lines = text.split("\n");
  const lineText = lines[position.line] ?? "";

  // Check Volume match
  for (const vol of deck.volumes.values()) {
    if (lineText.includes(vol.name) || lineText.startsWith(String(vol.id * 10000))) {
      return {
        contents: {
          kind: "markdown",
          value: [
            `### RELAP5 Hydrodynamic Volume: **${vol.name}** (ID: ${vol.id})`,
            `- **Type:** \`${vol.type}\``,
            `- **Length:** ${vol.length} m`,
            `- **Flow Area:** ${vol.flowArea} m²`,
            `- **Volume:** ${vol.volume} m³`,
            `- **Elevation Change:** ${vol.elevationChange} m`,
            `- **Pressure:** ${(vol.initialPressure / 1e6).toFixed(2)} MPa`,
            `- **Temperature:** ${vol.initialTemperature.toFixed(1)} K`,
            `- **Void Fraction:** ${vol.initialVoidFraction ?? 0.0}`,
          ].join("\n"),
        },
      };
    }
  }

  // Check Junction match
  for (const junc of deck.junctions.values()) {
    if (lineText.includes(`Junc_${junc.id}`) || lineText.startsWith(String(junc.id * 10000))) {
      return {
        contents: {
          kind: "markdown",
          value: [
            `### RELAP5 Junction: **Junc_${junc.id}**`,
            `- **From Volume:** ${junc.fromVolume}`,
            `- **To Volume:** ${junc.toVolume}`,
            `- **Area:** ${junc.area} m²`,
            `- **Form Loss Coefficients:** K_forw = ${junc.forwardLoss}, K_rev = ${junc.reverseLoss}`,
            `- **Initial Velocities:** vf = ${junc.initialLiquidVelocity} m/s, vg = ${junc.initialVaporVelocity} m/s`,
          ].join("\n"),
        },
      };
    }
  }

  // Check Kinetics match
  if (deck.kinetics && (lineText.includes("6000000") || lineText.toLowerCase().includes("kinetics"))) {
    return {
      contents: {
        kind: "markdown",
        value: [
          `### Reactor Point Kinetics (PKE)`,
          `- **Thermal Power:** ${(deck.kinetics.initialPower / 1e6).toFixed(1)} MWth`,
          `- **Prompt Neutron Lifetime:** ${deck.kinetics.promptGenerationTime.toExponential(2)} s`,
          `- **Delayed Neutron Fraction (beta):** ${deck.kinetics.totalDelayedFraction}`,
          `- **Precursor Groups:** ${deck.kinetics.delayedGroups.length}`,
          `- **Doppler Coeff:** ${deck.kinetics.fuelTempReactivityCoeff} / K`,
          `- **Moderator Temp Coeff:** ${deck.kinetics.moderatorTempReactivityCoeff} / K`,
        ].join("\n"),
      },
    };
  }

  return null;
}

export interface Relap5ActionParams {
  options?: KineticsSolverOptions | undefined;
  modelName?: string | undefined;
}

export type Relap5ActionResult =
  | ReturnType<typeof lintRelap5>
  | ReturnType<typeof solvePointKinetics>
  | { modelName: string; variableCount: number; equationCount: number }
  | string;

export async function executeRelap5Action(
  action: "lint_relap5",
  text: string,
  params?: Relap5ActionParams,
): Promise<ReturnType<typeof lintRelap5>>;
export async function executeRelap5Action(
  action: "relap5_kinetics_solve",
  text: string,
  params?: Relap5ActionParams,
): Promise<ReturnType<typeof solvePointKinetics>>;
export async function executeRelap5Action(
  action: "relap5_to_dae",
  text: string,
  params?: Relap5ActionParams,
): Promise<{ modelName: string; variableCount: number; equationCount: number }>;
export async function executeRelap5Action(
  action: "relap5_to_modelica",
  text: string,
  params?: Relap5ActionParams,
): Promise<string>;
export async function executeRelap5Action(
  action: string,
  text: string,
  params?: Relap5ActionParams,
): Promise<Relap5ActionResult>;
export async function executeRelap5Action(
  action: string,
  text: string,
  params?: Relap5ActionParams,
): Promise<Relap5ActionResult> {
  const deck = parseRelap5(text);

  switch (action) {
    case "lint_relap5":
      return lintRelap5(deck);

    case "relap5_kinetics_solve":
      return solvePointKinetics(deck, params?.options);

    case "relap5_to_dae": {
      const dae = lowerRelap5ToDae(deck);
      return {
        modelName: deck.title || "Relap5NuclearPlant",
        variableCount: dae.variables().length,
        equationCount: dae.equations().length,
      };
    }

    case "relap5_to_modelica":
      return relap5ToModelica(deck, params?.modelName);

    default:
      throw new Error(`Unknown RELAP5 action: ${action}`);
  }
}
