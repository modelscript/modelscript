// SPDX-License-Identifier: AGPL-3.0-or-later
/* eslint-disable @typescript-eslint/no-explicit-any */

import { lowerJsbsimToDae } from "./dae/jsbsim-to-dae.js";
import { lintJsbsim } from "./lints/index.js";
import { parseJsbsim } from "./parser/jsbsim-parser.js";
import { jsbsimToModelica } from "./projections/jsbsim-to-modelica.js";
import { solveFlightDynamics } from "./solvers/flight-solver.js";

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

export function validateJsbsim(text: string): LspDiagnostic[] {
  try {
    const doc = parseJsbsim(text);
    const diags = lintJsbsim(doc);

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
        source: "jsbsim-linter",
        message: d.message,
      };
    });
  } catch (err: any) {
    return [
      {
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 10 },
        },
        severity: 1,
        code: "M8900",
        source: "jsbsim-parser",
        message: `JSBSim parse error: ${err.message}`,
      },
    ];
  }
}

export function getJsbsimDocumentSymbols(text: string): LspDocumentSymbol[] {
  const doc = parseJsbsim(text);
  const model = doc.model;
  const symbols: LspDocumentSymbol[] = [];

  const rootRange: LspRange = {
    start: { line: 0, character: 0 },
    end: { line: text.split("\n").length, character: 0 },
  };

  const children: LspDocumentSymbol[] = [];

  // Metrics
  children.push({
    name: "Metrics",
    detail: `S=${model.metrics.wingArea} ft², b=${model.metrics.wingspan} ft, c=${model.metrics.chord} ft`,
    kind: LspSymbolKind.Struct,
    range: rootRange,
    selectionRange: rootRange,
  });

  // Mass Balance
  children.push({
    name: "MassBalance",
    detail: `EmptyWeight=${model.massBalance.emptyWeight} lbs, Ixx=${model.massBalance.ixx}, Iyy=${model.massBalance.iyy}`,
    kind: LspSymbolKind.Struct,
    range: rootRange,
    selectionRange: rootRange,
  });

  // Gear
  for (const g of model.groundReactions) {
    children.push({
      name: `Gear_${g.name}`,
      detail: `${g.type} (${g.steerable ? "steerable" : "fixed"})`,
      kind: LspSymbolKind.Field,
      range: rootRange,
      selectionRange: rootRange,
    });
  }

  // Aero
  for (const c of model.aeroCoefficients) {
    children.push({
      name: c.name,
      detail: `${c.axis} Coefficient (base=${c.baseValue})`,
      kind: LspSymbolKind.Variable,
      range: rootRange,
      selectionRange: rootRange,
    });
  }

  symbols.push({
    name: model.name || "JsbsimAircraft",
    detail: `JSBSim 2.0 Aircraft Model (${model.aeroCoefficients.length} aero coeffs, ${model.groundReactions.length} gear)`,
    kind: LspSymbolKind.Package,
    range: rootRange,
    selectionRange: rootRange,
    children,
  });

  return symbols;
}

export function getJsbsimHover(text: string, position: LspPosition): LspHover | null {
  const doc = parseJsbsim(text);
  const model = doc.model;
  const lines = text.split("\n");
  const lineText = lines[position.line] ?? "";

  // Check Metrics
  if (lineText.includes("<metrics>") || lineText.includes("<wingarea>")) {
    return {
      contents: {
        kind: "markdown",
        value: [
          `### Aircraft Geometric Metrics`,
          `- **Wing Area (S):** ${model.metrics.wingArea} ft²`,
          `- **Wingspan (b):** ${model.metrics.wingspan} ft`,
          `- **Mean Chord (c):** ${model.metrics.chord} ft`,
          `- **Aero Reference Point:** (${model.metrics.aeroCenter.x}, ${model.metrics.aeroCenter.y}, ${model.metrics.aeroCenter.z}) in`,
        ].join("\n"),
      },
    };
  }

  // Check Mass Balance
  if (lineText.includes("<mass_balance>") || lineText.includes("<emptywt>")) {
    return {
      contents: {
        kind: "markdown",
        value: [
          `### Mass & Inertia Properties`,
          `- **Empty Weight:** ${model.massBalance.emptyWeight} lbs (${(model.massBalance.emptyWeight / 32.174).toFixed(1)} slugs)`,
          `- **Center of Gravity:** (${model.massBalance.cgLocation.x}, ${model.massBalance.cgLocation.y}, ${model.massBalance.cgLocation.z}) in`,
          `- **Moments of Inertia:** Ixx=${model.massBalance.ixx}, Iyy=${model.massBalance.iyy}, Izz=${model.massBalance.izz} slug*ft²`,
        ].join("\n"),
      },
    };
  }

  return null;
}

export async function executeJsbsimAction(action: string, text: string, params?: any): Promise<any> {
  const doc = parseJsbsim(text);

  switch (action) {
    case "lint_jsbsim":
      return lintJsbsim(doc);

    case "jsbsim_simulate":
      return solveFlightDynamics(doc, params?.options);

    case "jsbsim_to_dae": {
      const dae = lowerJsbsimToDae(doc);
      return {
        modelName: doc.model.name || "JsbsimAircraft",
        variableCount: dae.variables().length,
        equationCount: dae.equations().length,
      };
    }

    case "jsbsim_to_modelica":
      return jsbsimToModelica(doc, params?.modelName);

    default:
      throw new Error(`Unknown JSBSim action: ${action}`);
  }
}
