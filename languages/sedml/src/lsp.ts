// SPDX-License-Identifier: AGPL-3.0-or-later

import { lowerSedmlToDae } from "./dae/sedml-to-dae.js";
import { lintSedml } from "./lints/index.js";
import { parseSedml } from "./parser/sedml-parser.js";
import { sedmlToModelica } from "./projections/sedml-to-modelica.js";
import { executeSedmlExperiment, type SedmlRunnerOptions } from "./solvers/sedml-runner.js";

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

export function validateSedml(text: string): LspDiagnostic[] {
  try {
    const doc = parseSedml(text);
    const diags = lintSedml(doc);

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
        source: "sedml-linter",
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
        code: "M9150",
        source: "sedml-parser",
        message: `SED-ML parse error: ${errMsg}`,
      },
    ];
  }
}

export function getSedmlDocumentSymbols(text: string): LspDocumentSymbol[] {
  const doc = parseSedml(text);
  const symbols: LspDocumentSymbol[] = [];

  const rootRange: LspRange = {
    start: { line: 0, character: 0 },
    end: { line: text.split("\n").length, character: 0 },
  };

  const children: LspDocumentSymbol[] = [];

  // Simulations
  for (const sim of doc.simulations) {
    const startLine = sim.range ? Math.max(0, sim.range.startLine - 1) : 0;
    const endLine = sim.range ? Math.max(0, sim.range.endLine - 1) : startLine;
    const r: LspRange = {
      start: { line: startLine, character: 0 },
      end: { line: endLine, character: 40 },
    };
    const kisao = sim.algorithm?.kisaoID ?? "no-kisao";
    children.push({
      name: sim.id,
      detail: `${sim.type} (${kisao})`,
      kind: LspSymbolKind.Event,
      range: r,
      selectionRange: r,
    });
  }

  // Models
  for (const m of doc.models) {
    const startLine = m.range ? Math.max(0, m.range.startLine - 1) : 0;
    const endLine = m.range ? Math.max(0, m.range.endLine - 1) : startLine;
    const r: LspRange = {
      start: { line: startLine, character: 0 },
      end: { line: endLine, character: 40 },
    };
    children.push({
      name: m.id,
      detail: `Model (${m.source}) [${m.changes.length} changes]`,
      kind: LspSymbolKind.Struct,
      range: r,
      selectionRange: r,
    });
  }

  // Tasks
  for (const t of doc.tasks) {
    const startLine = t.range ? Math.max(0, t.range.startLine - 1) : 0;
    const endLine = t.range ? Math.max(0, t.range.endLine - 1) : startLine;
    const r: LspRange = {
      start: { line: startLine, character: 0 },
      end: { line: endLine, character: 40 },
    };
    children.push({
      name: t.id,
      detail:
        t.type === "task"
          ? `${t.modelReference ?? ""} -> ${t.simulationReference ?? ""}`
          : `RepeatedTask (${t.subTasks?.length ?? 0} subTasks)`,
      kind: LspSymbolKind.Function,
      range: r,
      selectionRange: r,
    });
  }

  // DataGenerators
  for (const dg of doc.dataGenerators) {
    const startLine = dg.range ? Math.max(0, dg.range.startLine - 1) : 0;
    const endLine = dg.range ? Math.max(0, dg.range.endLine - 1) : startLine;
    const r: LspRange = {
      start: { line: startLine, character: 0 },
      end: { line: endLine, character: 40 },
    };
    children.push({
      name: dg.id,
      detail: `DataGenerator (${dg.math})`,
      kind: LspSymbolKind.Variable,
      range: r,
      selectionRange: r,
    });
  }

  // Outputs
  for (const out of doc.outputs) {
    const startLine = out.range ? Math.max(0, out.range.startLine - 1) : 0;
    const endLine = out.range ? Math.max(0, out.range.endLine - 1) : startLine;
    const r: LspRange = {
      start: { line: startLine, character: 0 },
      end: { line: endLine, character: 40 },
    };
    children.push({
      name: out.id,
      detail: `${out.type} (${out.curves.length} curves, ${out.dataSets.length} dataSets)`,
      kind: LspSymbolKind.Interface,
      range: r,
      selectionRange: r,
    });
  }

  symbols.push({
    name: "SedmlExperiment",
    detail: `SED-ML L${doc.level}V${doc.version} (${doc.simulations.length} simulations, ${doc.tasks.length} tasks, ${doc.outputs.length} outputs)`,
    kind: LspSymbolKind.Package,
    range: rootRange,
    selectionRange: rootRange,
    children,
  });

  return symbols;
}

export function getSedmlHover(text: string, position: LspPosition): LspHover | null {
  const doc = parseSedml(text);
  const lines = text.split("\n");
  const lineText = lines[position.line] ?? "";

  // Check Simulation match
  for (const sim of doc.simulations) {
    if (lineText.includes(`id="${sim.id}"`) || lineText.includes(`simulationReference="${sim.id}"`)) {
      return {
        contents: {
          kind: "markdown",
          value: [
            `### SED-ML Simulation: **${sim.id}** ${sim.name ? `(${sim.name})` : ""}`,
            `- **Type:** \`${sim.type}\``,
            `- **Algorithm KiSAO:** \`${sim.algorithm?.kisaoID ?? "unspecified"}\``,
            sim.type === "uniformTimeCourse"
              ? `- **Time Bounds:** \`[${sim.initialTime ?? 0}, ${sim.outputStartTime ?? 0} .. ${sim.outputEndTime ?? 10}]\` (${sim.numberOfSteps ?? 100} steps)`
              : "",
          ]
            .filter(Boolean)
            .join("\n"),
        },
      };
    }
  }

  // Check Model match
  for (const m of doc.models) {
    if (lineText.includes(`id="${m.id}"`) || lineText.includes(`modelReference="${m.id}"`)) {
      return {
        contents: {
          kind: "markdown",
          value: [
            `### SED-ML Model: **${m.id}** ${m.name ? `(${m.name})` : ""}`,
            `- **Language:** \`${m.language}\``,
            `- **Source:** \`${m.source}\``,
            `- **Pre-processing Changes:** ${m.changes.length}`,
          ].join("\n"),
        },
      };
    }
  }

  // Check Task match
  for (const t of doc.tasks) {
    if (lineText.includes(`id="${t.id}"`) || lineText.includes(`taskReference="${t.id}"`)) {
      return {
        contents: {
          kind: "markdown",
          value: [
            `### SED-ML Task: **${t.id}** ${t.name ? `(${t.name})` : ""}`,
            `- **Type:** \`${t.type}\``,
            t.modelReference ? `- **Model Reference:** \`${t.modelReference}\`` : "",
            t.simulationReference ? `- **Simulation Reference:** \`${t.simulationReference}\`` : "",
          ]
            .filter(Boolean)
            .join("\n"),
        },
      };
    }
  }

  // Check DataGenerator match
  for (const dg of doc.dataGenerators) {
    if (
      lineText.includes(`id="${dg.id}"`) ||
      lineText.includes(`xDataReference="${dg.id}"`) ||
      lineText.includes(`yDataReference="${dg.id}"`) ||
      lineText.includes(`dataReference="${dg.id}"`)
    ) {
      return {
        contents: {
          kind: "markdown",
          value: [
            `### SED-ML DataGenerator: **${dg.id}** ${dg.name ? `(${dg.name})` : ""}`,
            `- **Math:** \`${dg.math}\``,
            `- **Variables:** ${dg.variables.map((v) => v.id).join(", ") || "none"}`,
          ].join("\n"),
        },
      };
    }
  }

  return null;
}

export interface SedmlActionParams {
  options?: SedmlRunnerOptions | undefined;
  modelName?: string | undefined;
}

export type SedmlActionResult =
  | ReturnType<typeof lintSedml>
  | ReturnType<typeof executeSedmlExperiment>
  | { modelName: string; variableCount: number; equationCount: number }
  | string;

export async function executeSedmlAction(
  action: "lint_sedml",
  text: string,
  params?: SedmlActionParams,
): Promise<ReturnType<typeof lintSedml>>;
export async function executeSedmlAction(
  action: "sedml_simulate",
  text: string,
  params?: SedmlActionParams,
): Promise<ReturnType<typeof executeSedmlExperiment>>;
export async function executeSedmlAction(
  action: "sedml_to_dae",
  text: string,
  params?: SedmlActionParams,
): Promise<{ modelName: string; variableCount: number; equationCount: number }>;
export async function executeSedmlAction(
  action: "sedml_to_modelica",
  text: string,
  params?: SedmlActionParams,
): Promise<string>;
export async function executeSedmlAction(
  action: string,
  text: string,
  params?: SedmlActionParams,
): Promise<SedmlActionResult>;
export async function executeSedmlAction(
  action: string,
  text: string,
  params?: SedmlActionParams,
): Promise<SedmlActionResult> {
  const doc = parseSedml(text);

  switch (action) {
    case "lint_sedml":
      return lintSedml(doc);

    case "sedml_simulate":
    case "sedml_execute":
      return executeSedmlExperiment(doc, params?.options);

    case "sedml_to_dae": {
      const dae = lowerSedmlToDae(doc);
      return {
        modelName: doc.models[0]?.id || "SedmlExperiment",
        variableCount: dae.variables().length,
        equationCount: dae.equations().length,
      };
    }

    case "sedml_to_modelica":
      return sedmlToModelica(doc, params?.modelName);

    default:
      throw new Error(`Unknown SED-ML action: ${action}`);
  }
}
