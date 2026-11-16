// SPDX-License-Identifier: AGPL-3.0-or-later

import { collectWasmSyntaxErrors } from "@modelscript/dsl";
import { lowerPhreeqcToDae } from "./dae/phreeqc-to-dae.js";
import { lintPhreeqc } from "./lints/index.js";
import { getPhreeqcWasmParser, parsePhreeqc } from "./parser/phreeqc-parser.js";
import { phreeqcToModelica } from "./projections/phreeqc-to-modelica.js";
import {
  KNOWN_MASTER_SPECIES,
  STANDARD_MINERAL_PHASES,
  solvePhreeqcSpeciation,
  type SpeciationSolverOptions,
} from "./solvers/speciation-solver.js";

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
  severity: 1 | 2 | 3 | 4;
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

export function validatePhreeqc(text: string): LspDiagnostic[] {
  try {
    const cstTree = getPhreeqcWasmParser().parse(text);
    const syntaxDiags: LspDiagnostic[] = collectWasmSyntaxErrors(cstTree?.rootNode).map((err) => ({
      range: {
        start: { line: Math.max(0, err.startLine - 1), character: Math.max(0, err.startColumn - 1) },
        end: { line: Math.max(0, err.endLine - 1), character: Math.max(0, err.endColumn - 1) },
      },
      severity: 1,
      code: "M9550",
      source: "phreeqc-parser",
      message: err.message,
    }));
    if (syntaxDiags.length === 0 && cstTree?.rootNode?.hasError) {
      const ep = cstTree.rootNode.endPosition ?? { row: 0, column: 0 };
      syntaxDiags.push({
        range: {
          start: { line: Math.max(0, ep.row), character: Math.max(0, ep.column - 1) },
          end: { line: Math.max(0, ep.row), character: Math.max(1, ep.column) },
        },
        severity: 1,
        code: "M9550",
        source: "phreeqc-parser",
        message: "Syntax error: incomplete or invalid PHREEQC construct.",
      });
    }

    const doc = parsePhreeqc(text);
    const diags = lintPhreeqc(doc);

    const semanticDiags: LspDiagnostic[] = diags.map((d) => {
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
        source: "phreeqc-linter",
        message: d.message,
      };
    });

    return [...syntaxDiags, ...semanticDiags];
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return [
      {
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 1 },
        },
        severity: 1,
        code: "M9550",
        source: "phreeqc-parser",
        message: `PHREEQC parse error: ${errMsg}`,
      },
    ];
  }
}

export function getPhreeqcDocumentSymbols(text: string): LspDocumentSymbol[] {
  const doc = parsePhreeqc(text);
  const symbols: LspDocumentSymbol[] = [];

  const rootRange: LspRange = {
    start: { line: 0, character: 0 },
    end: { line: text.split("\n").length, character: 0 },
  };

  const children: LspDocumentSymbol[] = [];

  for (const [, sol] of doc.solutions) {
    const startLine = sol.range ? Math.max(0, sol.range.startLine - 1) : 0;
    const endLine = sol.range ? Math.max(0, sol.range.endLine - 1) : startLine;
    const r: LspRange = {
      start: { line: startLine, character: 0 },
      end: { line: endLine, character: 40 },
    };
    children.push({
      name: `SOLUTION ${sol.number}`,
      detail: `T=${sol.temp}°C, pH=${sol.pH}, pe=${sol.pe} (${sol.solutes.size} solutes)`,
      kind: LspSymbolKind.Struct,
      range: r,
      selectionRange: r,
    });
  }

  for (const ep of doc.equilibriumPhases) {
    const startLine = ep.range ? Math.max(0, ep.range.startLine - 1) : 0;
    const endLine = ep.range ? Math.max(0, ep.range.endLine - 1) : startLine;
    const r: LspRange = {
      start: { line: startLine, character: 0 },
      end: { line: endLine, character: 40 },
    };
    children.push({
      name: ep.name,
      detail: `EQUILIBRIUM_PHASES (SI=${ep.targetSI}, moles=${ep.initialMoles})`,
      kind: LspSymbolKind.Constant,
      range: r,
      selectionRange: r,
    });
  }

  for (const kin of doc.kinetics) {
    const startLine = kin.range ? Math.max(0, kin.range.startLine - 1) : 0;
    const endLine = kin.range ? Math.max(0, kin.range.endLine - 1) : startLine;
    const r: LspRange = {
      start: { line: startLine, character: 0 },
      end: { line: endLine, character: 40 },
    };
    children.push({
      name: kin.name,
      detail: `KINETICS (m0=${kin.m0}, k=${kin.rateConstant})`,
      kind: LspSymbolKind.Function,
      range: r,
      selectionRange: r,
    });
  }

  symbols.push({
    name: doc.title ?? "PhreeqcDeck",
    detail: `PHREEQC Deck (${doc.solutions.size} solutions, ${doc.equilibriumPhases.length} phases)`,
    kind: LspSymbolKind.Package,
    range: rootRange,
    selectionRange: rootRange,
    children,
  });

  return symbols;
}

export function getPhreeqcHover(text: string, position: LspPosition): LspHover | null {
  const doc = parsePhreeqc(text);
  const lines = text.split("\n");
  const lineText = lines[position.line] ?? "";
  const lineTokens = lineText
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0);

  // Check mineral phase hover
  for (const [minName, meta] of STANDARD_MINERAL_PHASES) {
    if (lineTokens.includes(minName)) {
      return {
        contents: {
          kind: "markdown",
          value: [
            `### PHREEQC Mineral Phase: **${minName}** (\`${meta.formula}\`)`,
            `- **$\\log_{10} K_{sp}$ (25 °C):** \`${meta.logKsp25}\``,
            `- **$\\Delta H_r^\\circ$:** \`${meta.deltaHkJ} kJ/mol\``,
            `- **Stoichiometry:** ${meta.ions.map((i) => `${i.stoich} ${i.species}`).join(" + ")}`,
          ].join("\n"),
        },
      };
    }
  }

  // Check SOLUTION hover
  if (lineTokens[0]?.toUpperCase() === "SOLUTION") {
    const firstSol = doc.solutions.values().next().value;
    if (firstSol) {
      return {
        contents: {
          kind: "markdown",
          value: [
            `### PHREEQC **SOLUTION ${firstSol.number}** ${firstSol.name ? `(${firstSol.name})` : ""}`,
            `- **Temperature:** \`${firstSol.temp} °C\``,
            `- **pH:** \`${firstSol.pH}\``,
            `- **pe:** \`${firstSol.pe}\``,
            `- **Units:** \`${firstSol.units}\``,
          ].join("\n"),
        },
      };
    }
  }

  // Check Master Species hover
  for (const [elem, meta] of KNOWN_MASTER_SPECIES) {
    if (lineTokens.includes(elem)) {
      return {
        contents: {
          kind: "markdown",
          value: [
            `### PHREEQC Master Species: **${meta.canonicalElement}**`,
            `- **Primary Aqueous Species:** \`${meta.aqueousSpecies}\``,
            `- **Ionic Charge ($z_i$):** \`${meta.charge}\``,
            `- **Gram Formula Weight:** \`${meta.gfw} g/mol\``,
          ].join("\n"),
        },
      };
    }
  }

  return null;
}

export interface PhreeqcActionParams {
  options?: SpeciationSolverOptions | undefined;
  modelName?: string | undefined;
}

export type PhreeqcActionResult =
  | ReturnType<typeof lintPhreeqc>
  | ReturnType<typeof solvePhreeqcSpeciation>
  | { modelName: string; variableCount: number; equationCount: number }
  | string;

export async function executePhreeqcAction(
  action: "lint_phreeqc",
  text: string,
  params?: PhreeqcActionParams,
): Promise<ReturnType<typeof lintPhreeqc>>;
export async function executePhreeqcAction(
  action: "phreeqc_speciate",
  text: string,
  params?: PhreeqcActionParams,
): Promise<ReturnType<typeof solvePhreeqcSpeciation>>;
export async function executePhreeqcAction(
  action: "phreeqc_to_dae",
  text: string,
  params?: PhreeqcActionParams,
): Promise<{ modelName: string; variableCount: number; equationCount: number }>;
export async function executePhreeqcAction(
  action: "phreeqc_to_modelica",
  text: string,
  params?: PhreeqcActionParams,
): Promise<string>;
export async function executePhreeqcAction(
  action: string,
  text: string,
  params?: PhreeqcActionParams,
): Promise<PhreeqcActionResult>;
export async function executePhreeqcAction(
  action: string,
  text: string,
  params?: PhreeqcActionParams,
): Promise<PhreeqcActionResult> {
  const doc = parsePhreeqc(text);

  switch (action) {
    case "lint_phreeqc":
      return lintPhreeqc(doc);

    case "phreeqc_speciate":
      return solvePhreeqcSpeciation(doc, params?.options);

    case "phreeqc_to_dae": {
      const dae = lowerPhreeqcToDae(doc, { modelName: params?.modelName });
      return {
        modelName: doc.title ?? "PhreeqcAqueousSystem",
        variableCount: dae.variables().length,
        equationCount: dae.equations().length,
      };
    }

    case "phreeqc_to_modelica":
      return phreeqcToModelica(doc, params?.modelName);

    default:
      throw new Error(`Unknown PHREEQC action: ${action}`);
  }
}
