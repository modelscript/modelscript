// SPDX-License-Identifier: AGPL-3.0-or-later

import { lowerCanteraToDae } from "./dae/cantera-to-dae.js";
import { lintCantera } from "./lints/index.js";
import { parseCantera } from "./parser/cantera-parser.js";
import { canteraToModelica } from "./projections/cantera-to-modelica.js";
import { evaluateNasa7Thermo, solveCanteraReactor, type CanteraReactorOptions } from "./solvers/kinetics-solver.js";

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

export interface LspCompletionItem {
  label: string;
  kind: number;
  detail?: string | undefined;
  documentation?: string | undefined;
  insertText?: string | undefined;
}

export function validateCantera(text: string): LspDiagnostic[] {
  try {
    const doc = parseCantera(text);
    const diags = lintCantera(doc);

    return diags.map((d) => {
      const line = d.range ? Math.max(0, d.range.startLine - 1) : 0;
      const col = d.range ? Math.max(0, d.range.startColumn - 1) : 0;
      const endLine = d.range ? Math.max(0, d.range.endLine - 1) : line;
      const endCol = d.range ? Math.max(0, d.range.endColumn - 1) : col + 12;

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
        source: "cantera-linter",
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
        code: "M9200",
        source: "cantera-parser",
        message: `Cantera parse error: ${errMsg}`,
      },
    ];
  }
}

export function getCanteraDocumentSymbols(text: string): LspDocumentSymbol[] {
  const doc = parseCantera(text);
  const mech = doc.mechanism;
  const symbols: LspDocumentSymbol[] = [];

  const rootRange: LspRange = {
    start: { line: 0, character: 0 },
    end: { line: text.split("\n").length, character: 0 },
  };

  const children: LspDocumentSymbol[] = [];

  // Phases
  for (const phase of mech.phases.values()) {
    const startLine = phase.range ? Math.max(0, phase.range.startLine - 1) : 0;
    const endLine = phase.range ? Math.max(0, phase.range.endLine - 1) : startLine;
    const r: LspRange = {
      start: { line: startLine, character: 0 },
      end: { line: endLine, character: 40 },
    };
    children.push({
      name: phase.name,
      detail: `Phase (${phase.thermo}, ${phase.species.length} species)`,
      kind: LspSymbolKind.Struct,
      range: r,
      selectionRange: r,
    });
  }

  // Species
  for (const sp of mech.species.values()) {
    const startLine = sp.range ? Math.max(0, sp.range.startLine - 1) : 0;
    const endLine = sp.range ? Math.max(0, sp.range.endLine - 1) : startLine;
    const r: LspRange = {
      start: { line: startLine, character: 0 },
      end: { line: endLine, character: 40 },
    };
    const compStr = Object.entries(sp.composition)
      .map(([k, v]) => `${k}:${v}`)
      .join(", ");
    children.push({
      name: sp.name,
      detail: `Species {${compStr}}`,
      kind: LspSymbolKind.Variable,
      range: r,
      selectionRange: r,
    });
  }

  // Reactions
  for (const rxn of mech.reactions) {
    const startLine = rxn.range ? Math.max(0, rxn.range.startLine - 1) : 0;
    const endLine = rxn.range ? Math.max(0, rxn.range.endLine - 1) : startLine;
    const r: LspRange = {
      start: { line: startLine, character: 0 },
      end: { line: endLine, character: 40 },
    };
    children.push({
      name: rxn.id,
      detail: `${rxn.equation} (${rxn.type})`,
      kind: LspSymbolKind.Function,
      range: r,
      selectionRange: r,
    });
  }

  symbols.push({
    name: mech.name || "CanteraMechanism",
    detail: `Cantera Mechanism (${mech.species.size} species, ${mech.reactions.length} reactions)`,
    kind: LspSymbolKind.Package,
    range: rootRange,
    selectionRange: rootRange,
    children,
  });

  return symbols;
}

export function getCanteraHover(text: string, position: LspPosition): LspHover | null {
  const doc = parseCantera(text);
  const mech = doc.mechanism;
  const lines = text.split("\n");
  const lineText = lines[position.line] ?? "";
  const lineNum1 = position.line + 1;

  // Check Species match
  for (const sp of mech.species.values()) {
    const inRange = sp.range !== undefined && lineNum1 >= sp.range.startLine && lineNum1 <= sp.range.endLine;
    if (inRange || lineText.includes(sp.name)) {
      const compStr = Object.entries(sp.composition)
        .map(([k, v]) => `${k}: ${v}`)
        .join(", ");
      const infoLines = [`### Cantera Species: **${sp.name}**`, `- **Composition:** \`{${compStr}}\``];
      if (sp.charge !== undefined) {
        infoLines.push(`- **Charge:** \`${sp.charge}\``);
      }
      if (sp.thermo) {
        const th298 = evaluateNasa7Thermo(sp.thermo, 298.15);
        infoLines.push(
          `- **NASA-7 Temperature Range:** \`[${sp.thermo.Tmin}, ${sp.thermo.Tmid}, ${sp.thermo.Tmax}] K\``,
        );
        infoLines.push(
          `- **Thermo (298.15 K):** $C_p^\\circ = ${th298.cp_J_molK.toFixed(2)}\\text{ J/(mol}\\cdot\\text{K)}$, $H^\\circ = ${(th298.h_J_mol / 1000).toFixed(2)}\\text{ kJ/mol}$, $S^\\circ = ${th298.s_J_molK.toFixed(2)}\\text{ J/(mol}\\cdot\\text{K)}$`,
        );
      }
      return {
        contents: {
          kind: "markdown",
          value: infoLines.join("\n"),
        },
      };
    }
  }

  // Check Reaction match
  for (const rxn of mech.reactions) {
    const inRange = rxn.range !== undefined && lineNum1 >= rxn.range.startLine && lineNum1 <= rxn.range.endLine;
    if (inRange || (rxn.equation.length > 0 && lineText.includes(rxn.equation))) {
      const infoLines = [
        `### Cantera Reaction: **${rxn.id}** (\`${rxn.equation}\`)`,
        `- **Type:** \`${rxn.type}\``,
        `- **Reversible:** \`${rxn.reversible}\``,
        `- **Arrhenius Rate:** $A = ${rxn.rateConstant.A.toExponential(3)},\\; b = ${rxn.rateConstant.b},\\; E_a = ${rxn.rateConstant.Ea}\\text{ J/mol}$`,
      ];
      if (rxn.lowRateConstant) {
        infoLines.push(
          `- **Low-P Rate:** $A_0 = ${rxn.lowRateConstant.A.toExponential(3)},\\; b_0 = ${rxn.lowRateConstant.b},\\; E_{a,0} = ${rxn.lowRateConstant.Ea}\\text{ J/mol}$`,
        );
      }
      if (rxn.troe) {
        infoLines.push(
          `- **Troe Falloff:** $A = ${rxn.troe.A},\\; T_3 = ${rxn.troe.T3}\\text{ K},\\; T_1 = ${rxn.troe.T1}\\text{ K}$`,
        );
      }
      return {
        contents: {
          kind: "markdown",
          value: infoLines.join("\n"),
        },
      };
    }
  }

  return null;
}

export function provideCanteraCompletions(text: string, _position?: LspPosition): LspCompletionItem[] {
  const items: LspCompletionItem[] = [
    {
      label: "phases",
      kind: 14,
      detail: "Cantera phases block",
      insertText: "phases:\n- name: gas\n  thermo: ideal-gas\n  kinetics: gas\n  elements: [O, H, N]\n  species: []",
    },
    {
      label: "species",
      kind: 14,
      detail: "Cantera species block",
      insertText:
        "species:\n- name: H2\n  composition: {H: 2}\n  thermo:\n    model: NASA7\n    temperature-ranges: [200.0, 1000.0, 3500.0]\n    data:\n    - [3.5, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0]\n    - [3.5, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0]",
    },
    {
      label: "reactions",
      kind: 14,
      detail: "Cantera reactions block",
      insertText: "reactions:\n- equation: 2 H2 + O2 <=> 2 H2O\n  rate-constant: {A: 1.0e+08, b: 0.0, Ea: 15000.0}",
    },
    {
      label: "NASA7",
      kind: 12,
      detail: "7-coefficient NASA polynomial thermo model",
    },
    {
      label: "rate-constant",
      kind: 10,
      detail: "Modified Arrhenius rate parameters {A, b, Ea}",
      insertText: "rate-constant: {A: 1.0e+08, b: 0.0, Ea: 0.0}",
    },
    {
      label: "low-P-rate-constant",
      kind: 10,
      detail: "Low-pressure limit Arrhenius parameters for falloff reactions",
      insertText: "low-P-rate-constant: {A: 1.0e+14, b: 0.0, Ea: 0.0}",
    },
    {
      label: "Troe",
      kind: 10,
      detail: "Troe pressure-falloff broadening parameters {A, T3, T1, T2}",
      insertText: "Troe: {A: 0.7, T3: 100.0, T1: 1000.0, T2: 5000.0}",
    },
  ];

  try {
    const doc = parseCantera(text);
    for (const sp of doc.mechanism.species.values()) {
      items.push({
        label: sp.name,
        kind: 6,
        detail: `Declared species ${sp.name}`,
      });
    }
  } catch {
    // Ignore parse errors during completion
  }

  return items;
}

export interface CanteraActionParams {
  options?: CanteraReactorOptions | undefined;
  modelName?: string | undefined;
}

export type CanteraActionResult =
  | ReturnType<typeof lintCantera>
  | ReturnType<typeof solveCanteraReactor>
  | { modelName: string; variableCount: number; equationCount: number }
  | string;

export async function executeCanteraAction(
  action: "lint_cantera",
  text: string,
  params?: CanteraActionParams,
): Promise<ReturnType<typeof lintCantera>>;
export async function executeCanteraAction(
  action: "cantera_simulate",
  text: string,
  params?: CanteraActionParams,
): Promise<ReturnType<typeof solveCanteraReactor>>;
export async function executeCanteraAction(
  action: "cantera_to_dae",
  text: string,
  params?: CanteraActionParams,
): Promise<{ modelName: string; variableCount: number; equationCount: number }>;
export async function executeCanteraAction(
  action: "cantera_to_modelica",
  text: string,
  params?: CanteraActionParams,
): Promise<string>;
export async function executeCanteraAction(
  action: string,
  text: string,
  params?: CanteraActionParams,
): Promise<CanteraActionResult>;
export async function executeCanteraAction(
  action: string,
  text: string,
  params?: CanteraActionParams,
): Promise<CanteraActionResult> {
  const doc = parseCantera(text);

  switch (action) {
    case "lint_cantera":
      return lintCantera(doc);

    case "cantera_simulate":
      return solveCanteraReactor(doc, params?.options);

    case "cantera_to_dae": {
      const dae = lowerCanteraToDae(doc, { modelName: params?.modelName });
      return {
        modelName: params?.modelName ?? (doc.mechanism.name || "CanteraMechanism"),
        variableCount: dae.variables().length,
        equationCount: dae.equations().length,
      };
    }

    case "cantera_to_modelica":
      return canteraToModelica(doc, params?.modelName);

    default:
      throw new Error(`Unknown Cantera action: ${action}`);
  }
}
