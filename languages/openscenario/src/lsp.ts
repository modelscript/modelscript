// SPDX-License-Identifier: AGPL-3.0-or-later

import { lowerOpenScenarioToDae } from "./dae/openscenario-to-dae.js";
import { lintOpenScenario } from "./lints/index.js";
import { parseOpenScenario } from "./parser/openscenario-parser.js";
import { openScenarioToModelica } from "./projections/openscenario-to-modelica.js";
import {
  simulateScenario,
  type OrchestratorOptions,
  type ScenarioSimulationResult,
} from "./solvers/scenario-orchestrator.js";

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

export function validateOpenScenario(text: string): LspDiagnostic[] {
  try {
    const doc = parseOpenScenario(text);
    const diags = lintOpenScenario(doc);

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
        source: "openscenario-linter",
        message: d.message,
      };
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return [
      {
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 10 },
        },
        severity: 1,
        code: "M8500",
        source: "openscenario-parser",
        message: `OpenSCENARIO parse error: ${message}`,
      },
    ];
  }
}

export function getOpenScenarioDocumentSymbols(text: string): LspDocumentSymbol[] {
  const doc = parseOpenScenario(text);
  const symbols: LspDocumentSymbol[] = [];

  // Root Scenario
  const rootRange: LspRange = {
    start: { line: 0, character: 0 },
    end: { line: text.split("\n").length, character: 0 },
  };

  const entitySymbols: LspDocumentSymbol[] = [];
  for (const ent of doc.entities.values()) {
    const startLine = ent.range ? Math.max(0, ent.range.startLine - 1) : 0;
    const endLine = ent.range ? Math.max(0, ent.range.endLine - 1) : startLine;
    const r: LspRange = {
      start: { line: startLine, character: 0 },
      end: { line: endLine, character: 40 },
    };
    entitySymbols.push({
      name: ent.name,
      detail: `${ent.isEgo ? "Ego " : ""}${ent.objectType}${ent.performance ? ` (max: ${ent.performance.maxSpeed}m/s)` : ""}`,
      kind: ent.isEgo ? LspSymbolKind.Interface : LspSymbolKind.Class,
      range: r,
      selectionRange: r,
    });
  }

  const storySymbols: LspDocumentSymbol[] = [];
  for (const story of doc.stories) {
    const actSymbols: LspDocumentSymbol[] = [];
    for (const act of story.acts) {
      const mgSymbols: LspDocumentSymbol[] = [];
      for (const mg of act.maneuverGroups) {
        const mSymbols: LspDocumentSymbol[] = [];
        for (const m of mg.maneuvers) {
          const evSymbols: LspDocumentSymbol[] = [];
          for (const ev of m.events) {
            evSymbols.push({
              name: ev.name,
              detail: `priority: ${ev.priority}, actions: ${ev.actions.length}`,
              kind: LspSymbolKind.Event,
              range: rootRange,
              selectionRange: rootRange,
            });
          }
          mSymbols.push({
            name: m.name,
            detail: `events: ${m.events.length}`,
            kind: LspSymbolKind.Method,
            range: rootRange,
            selectionRange: rootRange,
            children: evSymbols,
          });
        }
        mgSymbols.push({
          name: mg.name,
          detail: `actors: [${mg.actors.join(", ")}]`,
          kind: LspSymbolKind.Struct,
          range: rootRange,
          selectionRange: rootRange,
          children: mSymbols,
        });
      }
      actSymbols.push({
        name: act.name,
        detail: `maneuvers: ${mgSymbols.length}`,
        kind: LspSymbolKind.Module,
        range: rootRange,
        selectionRange: rootRange,
        children: mgSymbols,
      });
    }
    storySymbols.push({
      name: story.name,
      detail: `acts: ${actSymbols.length}`,
      kind: LspSymbolKind.Package,
      range: rootRange,
      selectionRange: rootRange,
      children: actSymbols,
    });
  }

  symbols.push({
    name: doc.header.description || "OpenSCENARIO",
    detail: `ASAM OpenSCENARIO v${doc.header.revMajor}.${doc.header.revMinor} (${doc.entities.size} entities)`,
    kind: LspSymbolKind.Package,
    range: rootRange,
    selectionRange: rootRange,
    children: [...entitySymbols, ...storySymbols],
  });

  return symbols;
}

export function getOpenScenarioHover(text: string, position: LspPosition): LspHover | null {
  const doc = parseOpenScenario(text);
  const lines = text.split("\n");
  const lineText = lines[position.line] ?? "";

  // Check if hovering over entity name
  for (const [name, ent] of doc.entities) {
    if (lineText.includes(name)) {
      const parts: string[] = [];
      parts.push(`### OpenSCENARIO Entity: **${name}**`);
      parts.push(`- **Type:** \`${ent.objectType}\``);
      if (ent.isEgo) parts.push(`- **Role:** Autonomous Vehicle Under Test (EGO)`);
      if (ent.category) parts.push(`- **Category:** \`${ent.category}\``);
      if (ent.performance) {
        parts.push(
          `- **Performance:** Max Speed = ${ent.performance.maxSpeed} m/s, Max Accel = ${ent.performance.maxAcceleration} m/s², Max Decel = ${ent.performance.maxDeceleration} m/s²`,
        );
      }
      if (ent.boundingBox) {
        const d = ent.boundingBox.dimensions;
        parts.push(`- **Dimensions:** ${d.length}m (L) x ${d.width}m (W) x ${d.height}m (H)`);
      }
      if (ent.initialPosition) {
        if (ent.initialPosition.kind === "world" && ent.initialPosition.world) {
          const w = ent.initialPosition.world;
          parts.push(`- **Initial Position (World):** x = ${w.x}, y = ${w.y}, z = ${w.z}`);
        } else if (ent.initialPosition.kind === "lane" && ent.initialPosition.lane) {
          const l = ent.initialPosition.lane;
          parts.push(`- **Initial Position (Lane):** road = ${l.roadId}, lane = ${l.laneId}, s = ${l.s}`);
        }
      }
      return { contents: { kind: "markdown", value: parts.join("\n") } };
    }
  }

  // Check if hovering over Storyboard, Story, Act, Event
  for (const story of doc.stories) {
    if (lineText.includes(story.name)) {
      return {
        contents: {
          kind: "markdown",
          value: `### OpenSCENARIO Story: **${story.name}**\n- **Acts:** ${story.acts.length}`,
        },
      };
    }
    for (const act of story.acts) {
      if (lineText.includes(act.name)) {
        return {
          contents: {
            kind: "markdown",
            value: `### OpenSCENARIO Act: **${act.name}**\n- **Maneuver Groups:** ${act.maneuverGroups.length}`,
          },
        };
      }
      for (const mg of act.maneuverGroups) {
        for (const m of mg.maneuvers) {
          for (const ev of m.events) {
            if (lineText.includes(ev.name)) {
              return {
                contents: {
                  kind: "markdown",
                  value: `### OpenSCENARIO Event: **${ev.name}**\n- **Priority:** \`${ev.priority}\`\n- **Actions:** ${ev.actions.length}\n- **Trigger Conditions:** ${ev.triggerConditions.length}`,
                },
              };
            }
          }
        }
      }
    }
  }

  return null;
}

export interface OpenScenarioActionParams extends OrchestratorOptions {
  modelName?: string | undefined;
}

export async function executeOpenScenarioAction(
  action: "lint_openscenario",
  text: string,
  params?: OpenScenarioActionParams,
): Promise<ReturnType<typeof lintOpenScenario>>;
export async function executeOpenScenarioAction(
  action: "openscenario_simulate",
  text: string,
  params?: OpenScenarioActionParams,
): Promise<ScenarioSimulationResult>;
export async function executeOpenScenarioAction(
  action: "openscenario_to_dae",
  text: string,
  params?: OpenScenarioActionParams,
): Promise<{ modelName: string; variableCount: number; equationCount: number }>;
export async function executeOpenScenarioAction(
  action: "openscenario_to_modelica",
  text: string,
  params?: OpenScenarioActionParams,
): Promise<string>;
export async function executeOpenScenarioAction(
  action: string,
  text: string,
  params?: OpenScenarioActionParams,
): Promise<unknown>;
export async function executeOpenScenarioAction(
  action: string,
  text: string,
  params?: OpenScenarioActionParams,
): Promise<unknown> {
  const doc = parseOpenScenario(text);

  switch (action) {
    case "lint_openscenario":
      return lintOpenScenario(doc);

    case "openscenario_simulate":
      return simulateScenario(doc, params);

    case "openscenario_to_dae": {
      const dae = lowerOpenScenarioToDae(doc);
      return {
        modelName: "ScenarioSimulation",
        variableCount: dae.variables().length,
        equationCount: dae.equations().length,
      };
    }

    case "openscenario_to_modelica":
      return openScenarioToModelica(doc, params?.modelName);

    default:
      throw new Error(`Unknown OpenSCENARIO action: ${action}`);
  }
}
