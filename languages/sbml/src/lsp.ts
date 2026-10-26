// SPDX-License-Identifier: AGPL-3.0-or-later
/* eslint-disable @typescript-eslint/no-explicit-any */

import { lowerSbmlToDae } from "./dae/sbml-to-dae.js";
import { lintSbml } from "./lints/index.js";
import { parseSbml } from "./parser/sbml-parser.js";
import { sbmlToModelica } from "./projections/sbml-to-modelica.js";
import { solveReactions } from "./solvers/reaction-solver.js";

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

export function validateSbml(text: string): LspDiagnostic[] {
  try {
    const doc = parseSbml(text);
    const diags = lintSbml(doc);

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
        source: "sbml-linter",
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
        code: "M8800",
        source: "sbml-parser",
        message: `SBML parse error: ${err.message}`,
      },
    ];
  }
}

export function getSbmlDocumentSymbols(text: string): LspDocumentSymbol[] {
  const doc = parseSbml(text);
  const model = doc.model;
  const symbols: LspDocumentSymbol[] = [];

  const rootRange: LspRange = {
    start: { line: 0, character: 0 },
    end: { line: text.split("\n").length, character: 0 },
  };

  const children: LspDocumentSymbol[] = [];

  // Species
  for (const s of model.species.values()) {
    const startLine = s.range ? Math.max(0, s.range.startLine - 1) : 0;
    const endLine = s.range ? Math.max(0, s.range.endLine - 1) : startLine;
    const r: LspRange = {
      start: { line: startLine, character: 0 },
      end: { line: endLine, character: 40 },
    };
    const conc = s.initialConcentration ?? s.initialAmount ?? 0;
    children.push({
      name: s.id,
      detail: `Species (${s.compartment}) [${conc}]`,
      kind: LspSymbolKind.Variable,
      range: r,
      selectionRange: r,
    });
  }

  // Reactions
  for (const rxn of model.reactions.values()) {
    const startLine = rxn.range ? Math.max(0, rxn.range.startLine - 1) : 0;
    const endLine = rxn.range ? Math.max(0, rxn.range.endLine - 1) : startLine;
    const r: LspRange = {
      start: { line: startLine, character: 0 },
      end: { line: endLine, character: 40 },
    };
    const reactStr = rxn.reactants.map((ref) => ref.species).join(" + ");
    const prodStr = rxn.products.map((ref) => ref.species).join(" + ");
    const arrow = rxn.reversible ? "<->" : "->";
    children.push({
      name: rxn.id,
      detail: `${reactStr} ${arrow} ${prodStr}`,
      kind: LspSymbolKind.Function,
      range: r,
      selectionRange: r,
    });
  }

  symbols.push({
    name: model.id || "SbmlModel",
    detail: `SBML L${doc.level}v${doc.version} Model (${model.species.size} species, ${model.reactions.size} reactions)`,
    kind: LspSymbolKind.Package,
    range: rootRange,
    selectionRange: rootRange,
    children,
  });

  return symbols;
}

export function getSbmlHover(text: string, position: LspPosition): LspHover | null {
  const doc = parseSbml(text);
  const model = doc.model;
  const lines = text.split("\n");
  const lineText = lines[position.line] ?? "";

  // Check Species match
  for (const s of model.species.values()) {
    if (lineText.includes(`id="${s.id}"`) || lineText.includes(`species="${s.id}"`)) {
      return {
        contents: {
          kind: "markdown",
          value: [
            `### SBML Species: **${s.id}** ${s.name ? `(${s.name})` : ""}`,
            `- **Compartment:** \`${s.compartment}\``,
            `- **Initial Quantity:** ${s.initialConcentration ?? s.initialAmount ?? 0}`,
            `- **Boundary Condition:** \`${s.boundaryCondition}\``,
            `- **Constant:** \`${s.constant}\``,
          ].join("\n"),
        },
      };
    }
  }

  // Check Reaction match
  for (const r of model.reactions.values()) {
    if (lineText.includes(`id="${r.id}"`)) {
      const reactStr = r.reactants
        .map((ref) => `${ref.stoichiometry > 1 ? ref.stoichiometry : ""}${ref.species}`)
        .join(" + ");
      const prodStr = r.products
        .map((ref) => `${ref.stoichiometry > 1 ? ref.stoichiometry : ""}${ref.species}`)
        .join(" + ");
      return {
        contents: {
          kind: "markdown",
          value: [
            `### SBML Reaction: **${r.id}** ${r.name ? `(${r.name})` : ""}`,
            `- **Stoichiometry:** ${reactStr} ${r.reversible ? "<=>" : "=>"} ${prodStr}`,
            `- **Reversible:** \`${r.reversible}\``,
            r.kineticLaw ? `- **Kinetic Law:** \`${r.kineticLaw.formula}\`` : "- **Kinetic Law:** None",
          ].join("\n"),
        },
      };
    }
  }

  return null;
}

export async function executeSbmlAction(action: string, text: string, params?: any): Promise<any> {
  const doc = parseSbml(text);

  switch (action) {
    case "lint_sbml":
      return lintSbml(doc);

    case "sbml_simulate":
      return solveReactions(doc, params?.options);

    case "sbml_to_dae": {
      const dae = lowerSbmlToDae(doc);
      return {
        modelName: doc.model.id || "SbmlModel",
        variableCount: dae.variables().length,
        equationCount: dae.equations().length,
      };
    }

    case "sbml_to_modelica":
      return sbmlToModelica(doc, params?.modelName);

    default:
      throw new Error(`Unknown SBML action: ${action}`);
  }
}
