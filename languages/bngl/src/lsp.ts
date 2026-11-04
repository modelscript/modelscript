// SPDX-License-Identifier: AGPL-3.0-or-later

import { lowerBnglToDae } from "./dae/bngl-to-dae.js";
import { lintBngl } from "./lints/index.js";
import { parseBngl, serializeComplexPattern } from "./parser/bngl-parser.js";
import { bnglToModelica, bnglToSbmlXml } from "./projections/bngl-projections.js";
import { generateBnglNetwork, solveBngl, type BnglSolverOptions } from "./solvers/bngl-solver.js";

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

export function validateBngl(text: string): LspDiagnostic[] {
  try {
    const doc = parseBngl(text);
    const diags = lintBngl(doc);

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
        source: "bngl-linter",
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
        code: "M9050",
        source: "bngl-parser",
        message: `BNGL parse error: ${errMsg}`,
      },
    ];
  }
}

export function getBnglDocumentSymbols(text: string): LspDocumentSymbol[] {
  const doc = parseBngl(text);
  const m = doc.model;
  const symbols: LspDocumentSymbol[] = [];

  const rootRange: LspRange = {
    start: { line: 0, character: 0 },
    end: { line: text.split("\n").length, character: 0 },
  };

  const children: LspDocumentSymbol[] = [];

  for (const mt of m.moleculeTypes.values()) {
    const startLine = mt.range ? Math.max(0, mt.range.startLine - 1) : 0;
    const endLine = mt.range ? Math.max(0, mt.range.endLine - 1) : startLine;
    const r: LspRange = {
      start: { line: startLine, character: 0 },
      end: { line: endLine, character: 40 },
    };
    const siteList = mt.sites.map((s) => s.name).join(", ");
    children.push({
      name: mt.name,
      detail: `MoleculeType (${siteList})`,
      kind: LspSymbolKind.Class,
      range: r,
      selectionRange: r,
    });
  }

  for (const obs of m.observables.values()) {
    const startLine = obs.range ? Math.max(0, obs.range.startLine - 1) : 0;
    const endLine = obs.range ? Math.max(0, obs.range.endLine - 1) : startLine;
    const r: LspRange = {
      start: { line: startLine, character: 0 },
      end: { line: endLine, character: 40 },
    };
    children.push({
      name: obs.name,
      detail: `Observable (${obs.type})`,
      kind: LspSymbolKind.Property,
      range: r,
      selectionRange: r,
    });
  }

  for (const rule of m.reactionRules.values()) {
    const startLine = rule.range ? Math.max(0, rule.range.startLine - 1) : 0;
    const endLine = rule.range ? Math.max(0, rule.range.endLine - 1) : startLine;
    const r: LspRange = {
      start: { line: startLine, character: 0 },
      end: { line: endLine, character: 40 },
    };
    const lhs = rule.reactants.map((p) => serializeComplexPattern(p)).join(" + ") || "0";
    const rhs = rule.products.map((p) => serializeComplexPattern(p)).join(" + ") || "0";
    const arrow = rule.reversible ? "<->" : "->";
    children.push({
      name: rule.id,
      detail: `${lhs} ${arrow} ${rhs}`,
      kind: LspSymbolKind.Function,
      range: r,
      selectionRange: r,
    });
  }

  symbols.push({
    name: m.id || "BioNetGenModel",
    detail: `BioNetGen Model (${m.moleculeTypes.size} molecule types, ${m.reactionRules.size} rules)`,
    kind: LspSymbolKind.Module,
    range: rootRange,
    selectionRange: rootRange,
    children,
  });

  return symbols;
}

export function getBnglHover(text: string, position: LspPosition): LspHover | null {
  const doc = parseBngl(text);
  const m = doc.model;
  const lines = text.split("\n");
  const lineText = lines[position.line] ?? "";

  for (const mt of m.moleculeTypes.values()) {
    if (lineText.includes(`${mt.name}(`) || lineText.includes(mt.name)) {
      const sitesDesc = mt.sites
        .map((s) => (s.allowedStates.length > 0 ? `${s.name}~${s.allowedStates.join("~")}` : s.name))
        .join(", ");
      return {
        contents: {
          kind: "markdown",
          value: [`### BioNetGen Molecule Type: **${mt.name}**`, `- **Sites:** \`${sitesDesc || "none"}\``].join("\n"),
        },
      };
    }
  }

  for (const obs of m.observables.values()) {
    if (lineText.includes(obs.name)) {
      const pats = obs.patterns.map((p) => serializeComplexPattern(p)).join(", ");
      return {
        contents: {
          kind: "markdown",
          value: [
            `### BioNetGen Observable: **${obs.name}**`,
            `- **Type:** \`${obs.type}\``,
            `- **Patterns:** \`${pats}\``,
          ].join("\n"),
        },
      };
    }
  }

  for (const rule of m.reactionRules.values()) {
    if (lineText.includes(rule.id)) {
      const lhs = rule.reactants.map((p) => serializeComplexPattern(p)).join(" + ") || "0";
      const rhs = rule.products.map((p) => serializeComplexPattern(p)).join(" + ") || "0";
      return {
        contents: {
          kind: "markdown",
          value: [
            `### BioNetGen Reaction Rule: **${rule.id}**`,
            `- **Rule:** \`${lhs} ${rule.reversible ? "<->" : "->"} ${rhs}\``,
            `- **Forward Rate:** \`${rule.forwardRate}\``,
            ...(rule.reverseRate ? [`- **Reverse Rate:** \`${rule.reverseRate}\``] : []),
          ].join("\n"),
        },
      };
    }
  }

  for (const p of m.parameters.values()) {
    if (lineText.includes(p.id)) {
      return {
        contents: {
          kind: "markdown",
          value: [`### BioNetGen Parameter: **${p.id}**`, `- **Value:** \`${p.value}\``].join("\n"),
        },
      };
    }
  }

  return null;
}

export const provideBnglHover = getBnglHover;

export function provideBnglCompletions(text?: string): LspCompletionItem[] {
  const items: LspCompletionItem[] = [
    {
      label: "begin model",
      kind: 14,
      detail: "Define a BioNetGen model block",
      insertText: "begin model\n\nend model",
    },
    {
      label: "begin parameters",
      kind: 14,
      detail: "Declare rate constants and initial concentrations",
      insertText: "begin parameters\n  k1 0.1\nend parameters",
    },
    {
      label: "begin molecule types",
      kind: 14,
      detail: "Declare structured molecule types and sites",
      insertText: "begin molecule types\n  R(l,Y~U~P)\nend molecule types",
    },
    {
      label: "begin seed species",
      kind: 14,
      detail: "Declare initial molecular species complexes",
      insertText: "begin seed species\n  R(l,Y~U) 100\nend seed species",
    },
    {
      label: "begin observables",
      kind: 14,
      detail: "Declare Molecules or Species observables",
      insertText: "begin observables\n  Molecules PhosphoR R(Y~P)\nend observables",
    },
    {
      label: "begin reaction rules",
      kind: 14,
      detail: "Declare pattern-based reaction rules",
      insertText: "begin reaction rules\n  R1: L(r) + R(l) <-> L(r!1).R(l!1) kp1, km1\nend reaction rules",
    },
    {
      label: "generate_network",
      kind: 3,
      detail: "Expand seed species across reaction rules",
      insertText: "generate_network({overwrite=>1})",
    },
    {
      label: "simulate",
      kind: 3,
      detail: "Integrate expanded reaction network",
      insertText: 'simulate({method=>"ode",t_end=>100,n_steps=>100})',
    },
  ];

  if (text) {
    try {
      const doc = parseBngl(text);
      for (const mt of doc.model.moleculeTypes.values()) {
        items.push({
          label: mt.name,
          kind: 7,
          detail: `MoleculeType (${mt.sites.map((s) => s.name).join(",")})`,
        });
      }
      for (const p of doc.model.parameters.values()) {
        items.push({
          label: p.id,
          kind: 21,
          detail: `Parameter = ${p.value}`,
        });
      }
      for (const obs of doc.model.observables.values()) {
        items.push({
          label: obs.name,
          kind: 10,
          detail: `Observable (${obs.type})`,
        });
      }
    } catch {
      // Ignore parse errors during completion
    }
  }

  return items;
}

export interface BnglActionParams {
  options?: BnglSolverOptions | undefined;
  modelName?: string | undefined;
}

export type BnglActionResult =
  | ReturnType<typeof lintBngl>
  | ReturnType<typeof generateBnglNetwork>
  | ReturnType<typeof solveBngl>
  | { modelName: string; variableCount: number; equationCount: number }
  | string;

export async function executeBnglAction(
  action: "lint_bngl",
  text: string,
  params?: BnglActionParams,
): Promise<ReturnType<typeof lintBngl>>;
export async function executeBnglAction(
  action: "bngl_generate_network",
  text: string,
  params?: BnglActionParams,
): Promise<ReturnType<typeof generateBnglNetwork>>;
export async function executeBnglAction(
  action: "bngl_simulate",
  text: string,
  params?: BnglActionParams,
): Promise<ReturnType<typeof solveBngl>>;
export async function executeBnglAction(
  action: "bngl_to_dae",
  text: string,
  params?: BnglActionParams,
): Promise<{ modelName: string; variableCount: number; equationCount: number }>;
export async function executeBnglAction(
  action: "bngl_to_modelica" | "bngl_to_sbml",
  text: string,
  params?: BnglActionParams,
): Promise<string>;
export async function executeBnglAction(
  action: string,
  text: string,
  params?: BnglActionParams,
): Promise<BnglActionResult>;
export async function executeBnglAction(
  action: string,
  text: string,
  params?: BnglActionParams,
): Promise<BnglActionResult> {
  const doc = parseBngl(text);

  switch (action) {
    case "lint_bngl":
      return lintBngl(doc);

    case "bngl_generate_network":
      return generateBnglNetwork(doc, {
        maxIterations: params?.options?.maxIterations,
        maxSpecies: params?.options?.maxSpecies,
      });

    case "bngl_simulate":
      return solveBngl(doc, params?.options);

    case "bngl_to_dae": {
      const dae = lowerBnglToDae(doc);
      return {
        modelName: doc.model.id || "BioNetGenModel",
        variableCount: dae.variables().length,
        equationCount: dae.equations().length,
      };
    }

    case "bngl_to_modelica":
      return bnglToModelica(doc, params?.modelName);

    case "bngl_to_sbml":
      return bnglToSbmlXml(doc);

    default:
      throw new Error(`Unknown BioNetGen action: ${action}`);
  }
}
