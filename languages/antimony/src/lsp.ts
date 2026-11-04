// SPDX-License-Identifier: AGPL-3.0-or-later

import { lowerAntimonyToDae } from "./dae/antimony-to-dae.js";
import { lintAntimony } from "./lints/index.js";
import { parseAntimony } from "./parser/antimony-parser.js";
import { antimonyToModelica, antimonyToSbmlXml } from "./projections/antimony-projections.js";
import { solveAntimony, type AntimonySolverOptions } from "./solvers/antimony-solver.js";

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
  insertText?: string | undefined;
}

export function validateAntimony(text: string): LspDiagnostic[] {
  try {
    const doc = parseAntimony(text);
    const diags = lintAntimony(doc);

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
        source: "antimony-linter",
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
        code: "M9000",
        source: "antimony-parser",
        message: `Antimony parse error: ${errMsg}`,
      },
    ];
  }
}

export function getAntimonyDocumentSymbols(text: string): LspDocumentSymbol[] {
  const doc = parseAntimony(text);
  const mod = doc.mainModule;
  const symbols: LspDocumentSymbol[] = [];

  const rootRange: LspRange = {
    start: { line: 0, character: 0 },
    end: { line: text.split("\n").length, character: 0 },
  };

  const children: LspDocumentSymbol[] = [];

  for (const s of mod.species.values()) {
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

  for (const rxn of mod.reactions.values()) {
    const startLine = rxn.range ? Math.max(0, rxn.range.startLine - 1) : 0;
    const endLine = rxn.range ? Math.max(0, rxn.range.endLine - 1) : startLine;
    const r: LspRange = {
      start: { line: startLine, character: 0 },
      end: { line: endLine, character: 40 },
    };
    const reactStr = rxn.reactants.map((ref) => ref.species).join(" + ");
    const prodStr = rxn.products.map((ref) => ref.species).join(" + ");
    const arrow = rxn.reversible ? "->" : "=>";
    children.push({
      name: rxn.id,
      detail: `${reactStr} ${arrow} ${prodStr}`,
      kind: LspSymbolKind.Function,
      range: r,
      selectionRange: r,
    });
  }

  for (const ev of mod.events) {
    const startLine = ev.range ? Math.max(0, ev.range.startLine - 1) : 0;
    const endLine = ev.range ? Math.max(0, ev.range.endLine - 1) : startLine;
    const r: LspRange = {
      start: { line: startLine, character: 0 },
      end: { line: endLine, character: 40 },
    };
    children.push({
      name: ev.id,
      detail: `at (${ev.trigger})`,
      kind: LspSymbolKind.Event,
      range: r,
      selectionRange: r,
    });
  }

  symbols.push({
    name: mod.id || "AntimonyModule",
    detail: `Antimony Module (${mod.species.size} species, ${mod.reactions.size} reactions)`,
    kind: LspSymbolKind.Module,
    range: rootRange,
    selectionRange: rootRange,
    children,
  });

  return symbols;
}

export function getAntimonyHover(text: string, position: LspPosition): LspHover | null {
  const doc = parseAntimony(text);
  const mod = doc.mainModule;
  const lines = text.split("\n");
  const lineText = lines[position.line] ?? "";

  for (const s of mod.species.values()) {
    if (lineText.includes(s.id)) {
      return {
        contents: {
          kind: "markdown",
          value: [
            `### Antimony Species: **${s.id}** ${s.name ? `(${s.name})` : ""}`,
            `- **Compartment:** \`${s.compartment}\``,
            `- **Initial Concentration:** ${s.initialConcentration ?? s.initialAmount ?? 0}`,
            `- **Boundary Condition:** \`${s.boundaryCondition}\``,
            `- **Constant:** \`${s.constant}\``,
          ].join("\n"),
        },
      };
    }
  }

  for (const r of mod.reactions.values()) {
    if (lineText.includes(r.id)) {
      const reactStr = r.reactants
        .map((ref) => `${ref.stoichiometry !== 1 ? `${ref.stoichiometry} ` : ""}${ref.species}`)
        .join(" + ");
      const prodStr = r.products
        .map((ref) => `${ref.stoichiometry !== 1 ? `${ref.stoichiometry} ` : ""}${ref.species}`)
        .join(" + ");
      return {
        contents: {
          kind: "markdown",
          value: [
            `### Antimony Reaction: **${r.id}** ${r.name ? `(${r.name})` : ""}`,
            `- **Stoichiometry:** ${reactStr} ${r.reversible ? "->" : "=>"} ${prodStr}`,
            `- **Reversible:** \`${r.reversible}\``,
            `- **Rate Law:** \`${r.rateLaw || "None"}\``,
          ].join("\n"),
        },
      };
    }
  }

  for (const c of mod.compartments.values()) {
    if (lineText.includes(c.id)) {
      return {
        contents: {
          kind: "markdown",
          value: [
            `### Antimony Compartment: **${c.id}** ${c.name ? `(${c.name})` : ""}`,
            `- **Volume (size):** ${c.size}`,
            `- **Constant:** \`${c.constant}\``,
          ].join("\n"),
        },
      };
    }
  }

  return null;
}

export const provideAntimonyHover = getAntimonyHover;

export function provideAntimonyCompletions(text?: string): LspCompletionItem[] {
  const items: LspCompletionItem[] = [
    {
      label: "model",
      kind: 14,
      detail: "Define an Antimony module block",
      insertText: "model MyModel()\n  \nend",
    },
    {
      label: "species",
      kind: 14,
      detail: "Declare floating or boundary ($S) chemical species",
      insertText: "species S1 in cell = 10.0;",
    },
    {
      label: "compartment",
      kind: 14,
      detail: "Declare cellular or reactor compartment",
      insertText: "compartment cell = 1.0;",
    },
    {
      label: "const",
      kind: 14,
      detail: "Declare constant kinetic parameter",
      insertText: "const k1 = 0.5;",
    },
    {
      label: "var",
      kind: 14,
      detail: "Declare time-varying variable",
      insertText: "var x = 0.0;",
    },
    {
      label: "at",
      kind: 14,
      detail: "Define a state-triggered discrete event",
      insertText: "E1: at (S1 < 1.0): S1 = 10.0;",
    },
    {
      label: "function",
      kind: 14,
      detail: "Define a reusable kinetic rate function",
      insertText: "function MM(Vmax, S, Km)\n  (Vmax * S) / (Km + S);\nend",
    },
  ];

  if (text) {
    try {
      const doc = parseAntimony(text);
      for (const s of doc.mainModule.species.values()) {
        items.push({
          label: s.id,
          kind: 6,
          detail: `Species in ${s.compartment}`,
        });
      }
      for (const p of doc.mainModule.parameters.values()) {
        items.push({
          label: p.id,
          kind: 21,
          detail: `Parameter = ${p.value}`,
        });
      }
    } catch {
      // Ignore parse errors during completion
    }
  }

  return items;
}

export interface AntimonyActionParams {
  options?: AntimonySolverOptions | undefined;
  modelName?: string | undefined;
}

export type AntimonyActionResult =
  | ReturnType<typeof lintAntimony>
  | ReturnType<typeof solveAntimony>
  | { modelName: string; variableCount: number; equationCount: number }
  | string;

export async function executeAntimonyAction(
  action: "lint_antimony",
  text: string,
  params?: AntimonyActionParams,
): Promise<ReturnType<typeof lintAntimony>>;
export async function executeAntimonyAction(
  action: "antimony_simulate",
  text: string,
  params?: AntimonyActionParams,
): Promise<ReturnType<typeof solveAntimony>>;
export async function executeAntimonyAction(
  action: "antimony_to_dae",
  text: string,
  params?: AntimonyActionParams,
): Promise<{ modelName: string; variableCount: number; equationCount: number }>;
export async function executeAntimonyAction(
  action: "antimony_to_modelica" | "antimony_to_sbml",
  text: string,
  params?: AntimonyActionParams,
): Promise<string>;
export async function executeAntimonyAction(
  action: string,
  text: string,
  params?: AntimonyActionParams,
): Promise<AntimonyActionResult>;
export async function executeAntimonyAction(
  action: string,
  text: string,
  params?: AntimonyActionParams,
): Promise<AntimonyActionResult> {
  const doc = parseAntimony(text);

  switch (action) {
    case "lint_antimony":
      return lintAntimony(doc);

    case "antimony_simulate":
      return solveAntimony(doc, params?.options);

    case "antimony_to_dae": {
      const dae = lowerAntimonyToDae(doc);
      return {
        modelName: doc.mainModule.id || "AntimonyModel",
        variableCount: dae.variables().length,
        equationCount: dae.equations().length,
      };
    }

    case "antimony_to_modelica":
      return antimonyToModelica(doc, params?.modelName);

    case "antimony_to_sbml":
      return antimonyToSbmlXml(doc);

    default:
      throw new Error(`Unknown Antimony action: ${action}`);
  }
}
