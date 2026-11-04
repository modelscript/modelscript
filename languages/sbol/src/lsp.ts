// SPDX-License-Identifier: AGPL-3.0-or-later

import { lowerSbolToDae } from "./dae/sbol-to-dae.js";
import { lintSbol } from "./lints/index.js";
import { parseSbol } from "./parser/sbol-parser.js";
import { sbolToModelica, sbolToSbmlXml } from "./projections/sbol-projections.js";
import { solveGeneticCircuit, type GeneticCircuitSolverOptions } from "./solvers/genetic-circuit-solver.js";
import { SEQUENCE_ONTOLOGY, SYSTEMS_BIOLOGY_ONTOLOGY } from "./types.js";

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

export function validateSbol(text: string): LspDiagnostic[] {
  try {
    const doc = parseSbol(text);
    const diags = lintSbol(doc);

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
        source: "sbol-linter",
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
        code: "M9500",
        source: "sbol-parser",
        message: `SBOL parse error: ${errMsg}`,
      },
    ];
  }
}

export function getSbolDocumentSymbols(text: string): LspDocumentSymbol[] {
  const doc = parseSbol(text);
  const rootRange: LspRange = {
    start: { line: 0, character: 0 },
    end: { line: text.split("\n").length, character: 0 },
  };

  const children: LspDocumentSymbol[] = [];

  for (const comp of doc.components) {
    const startLine = comp.range ? Math.max(0, comp.range.startLine - 1) : 0;
    const endLine = comp.range ? Math.max(0, comp.range.endLine - 1) : startLine;
    const r: LspRange = {
      start: { line: startLine, character: 0 },
      end: { line: endLine, character: 40 },
    };

    const compChildren: LspDocumentSymbol[] = [];
    for (const sub of comp.subComponents) {
      const subStart = sub.range ? Math.max(0, sub.range.startLine - 1) : startLine;
      const subEnd = sub.range ? Math.max(0, sub.range.endLine - 1) : subStart;
      const subR: LspRange = {
        start: { line: subStart, character: 0 },
        end: { line: subEnd, character: 40 },
      };
      compChildren.push({
        name: sub.displayId,
        detail: `SubComponent -> ${sub.instanceOf}`,
        kind: LspSymbolKind.Property,
        range: subR,
        selectionRange: subR,
      });
    }

    for (const feat of comp.features) {
      const fStart = feat.range ? Math.max(0, feat.range.startLine - 1) : startLine;
      const fEnd = feat.range ? Math.max(0, feat.range.endLine - 1) : fStart;
      const fR: LspRange = {
        start: { line: fStart, character: 0 },
        end: { line: fEnd, character: 40 },
      };
      compChildren.push({
        name: feat.displayId,
        detail: `Feature (${feat.roles.join(", ")})`,
        kind: LspSymbolKind.Field,
        range: fR,
        selectionRange: fR,
      });
    }

    children.push({
      name: comp.displayId,
      detail: `Component (${comp.roles.join(", ") || "generic"})`,
      kind: LspSymbolKind.Class,
      range: r,
      selectionRange: r,
      children: compChildren,
    });
  }

  for (const seq of doc.sequences) {
    const startLine = seq.range ? Math.max(0, seq.range.startLine - 1) : 0;
    const endLine = seq.range ? Math.max(0, seq.range.endLine - 1) : startLine;
    const r: LspRange = {
      start: { line: startLine, character: 0 },
      end: { line: endLine, character: 40 },
    };
    children.push({
      name: seq.displayId,
      detail: `Sequence (${seq.elements.length} bp, ${seq.encoding ?? "IUPAC_DNA"})`,
      kind: LspSymbolKind.Constant,
      range: r,
      selectionRange: r,
    });
  }

  for (const inter of doc.interactions) {
    const startLine = inter.range ? Math.max(0, inter.range.startLine - 1) : 0;
    const endLine = inter.range ? Math.max(0, inter.range.endLine - 1) : startLine;
    const r: LspRange = {
      start: { line: startLine, character: 0 },
      end: { line: endLine, character: 40 },
    };
    const parts = inter.participants.map((p) => p.participant).join(" -> ");
    children.push({
      name: inter.displayId,
      detail: `Interaction [${inter.type}] (${parts})`,
      kind: LspSymbolKind.Function,
      range: r,
      selectionRange: r,
    });
  }

  return [
    {
      name: doc.namespace || "SbolDocument",
      detail: `SBOL3 Document (${doc.components.length} components, ${doc.interactions.length} interactions)`,
      kind: LspSymbolKind.Package,
      range: rootRange,
      selectionRange: rootRange,
      children,
    },
  ];
}

export function getSbolHover(text: string, position: LspPosition): LspHover | null {
  const doc = parseSbol(text);
  const lines = text.split("\n");
  const lineText = lines[position.line] ?? "";

  for (const comp of doc.components) {
    if (
      lineText.includes(`"${comp.displayId}"`) ||
      lineText.includes(`:${comp.displayId}`) ||
      lineText.includes(`/${comp.displayId}`)
    ) {
      return {
        contents: {
          kind: "markdown",
          value: [
            `### SBOL3 Component: **${comp.displayId}** ${comp.name ? `(${comp.name})` : ""}`,
            `- **Roles:** \`${comp.roles.join(", ") || "none"}\``,
            `- **SubComponents:** ${comp.subComponents.length}`,
            `- **Sequence Features:** ${comp.features.length}`,
            comp.sequences.length > 0 ? `- **Sequences:** \`${comp.sequences.join(", ")}\`` : "",
          ]
            .filter(Boolean)
            .join("\n"),
        },
      };
    }
  }

  for (const seq of doc.sequences) {
    if (lineText.includes(`"${seq.displayId}"`) || lineText.includes(`:${seq.displayId}`)) {
      const preview = seq.elements.length > 36 ? `${seq.elements.slice(0, 36)}...` : seq.elements;
      return {
        contents: {
          kind: "markdown",
          value: [
            `### SBOL3 Sequence: **${seq.displayId}**`,
            `- **Length:** ${seq.elements.length} nt`,
            `- **Encoding:** \`${seq.encoding ?? "IUPAC_DNA"}\``,
            `- **Elements:** \`${preview}\``,
          ].join("\n"),
        },
      };
    }
  }

  for (const inter of doc.interactions) {
    if (lineText.includes(`"${inter.displayId}"`) || lineText.includes(`:${inter.displayId}`)) {
      const partSummary = inter.participants
        .map((p) => `${p.participant} (${p.roles.join(", ") || "no role"})`)
        .join(", ");
      return {
        contents: {
          kind: "markdown",
          value: [
            `### SBOL3 Interaction: **${inter.displayId}**`,
            `- **Type:** \`${inter.type}\``,
            `- **Participants:** ${partSummary}`,
          ].join("\n"),
        },
      };
    }
  }

  return null;
}

export const provideSbolHover = getSbolHover;

export function provideSbolCompletions(text?: string, _position?: LspPosition): LspCompletionItem[] {
  const items: LspCompletionItem[] = [
    {
      label: SEQUENCE_ONTOLOGY.PROMOTER,
      kind: 14,
      detail: "Sequence Ontology: Promoter (SO:0000167)",
      insertText: SEQUENCE_ONTOLOGY.PROMOTER,
    },
    {
      label: SEQUENCE_ONTOLOGY.RBS,
      kind: 14,
      detail: "Sequence Ontology: Ribosome Entry Site / RBS (SO:0000139)",
      insertText: SEQUENCE_ONTOLOGY.RBS,
    },
    {
      label: SEQUENCE_ONTOLOGY.CDS,
      kind: 14,
      detail: "Sequence Ontology: Coding Sequence / CDS (SO:0000316)",
      insertText: SEQUENCE_ONTOLOGY.CDS,
    },
    {
      label: SEQUENCE_ONTOLOGY.TERMINATOR,
      kind: 14,
      detail: "Sequence Ontology: Terminator (SO:0000141)",
      insertText: SEQUENCE_ONTOLOGY.TERMINATOR,
    },
    {
      label: SEQUENCE_ONTOLOGY.ENGINEERED_REGION,
      kind: 14,
      detail: "Sequence Ontology: Engineered Region (SO:0000804)",
      insertText: SEQUENCE_ONTOLOGY.ENGINEERED_REGION,
    },
    {
      label: SYSTEMS_BIOLOGY_ONTOLOGY.INHIBITION,
      kind: 14,
      detail: "Systems Biology Ontology: Inhibition (SBO:0000169)",
      insertText: SYSTEMS_BIOLOGY_ONTOLOGY.INHIBITION,
    },
    {
      label: SYSTEMS_BIOLOGY_ONTOLOGY.STIMULATION,
      kind: 14,
      detail: "Systems Biology Ontology: Stimulation (SBO:0000170)",
      insertText: SYSTEMS_BIOLOGY_ONTOLOGY.STIMULATION,
    },
    {
      label: SYSTEMS_BIOLOGY_ONTOLOGY.GENETIC_PRODUCTION,
      kind: 14,
      detail: "Systems Biology Ontology: Genetic Production (SBO:0000589)",
      insertText: SYSTEMS_BIOLOGY_ONTOLOGY.GENETIC_PRODUCTION,
    },
    {
      label: "sbol:Component",
      kind: 7,
      detail: "SBOL3 Genetic Component definition",
      insertText: '<sbol:Component displayId="$1" role="SO:0000804">\n  $0\n</sbol:Component>',
    },
    {
      label: "sbol:Sequence",
      kind: 7,
      detail: "SBOL3 Nucleic Acid Sequence definition",
      insertText:
        '<sbol:Sequence displayId="$1" encoding="IUPAC_DNA">\n  <sbol:elements>$0</sbol:elements>\n</sbol:Sequence>',
    },
    {
      label: "sbol:Interaction",
      kind: 7,
      detail: "SBOL3 Regulatory Interaction definition",
      insertText:
        '<sbol:Interaction displayId="$1" type="inhibition">\n  <sbol:Participation participant="$2" role="inhibitor"/>\n</sbol:Interaction>',
    },
  ];

  if (text) {
    try {
      const doc = parseSbol(text);
      for (const comp of doc.components) {
        items.push({
          label: comp.displayId,
          kind: 6,
          detail: `SBOL Component (${comp.roles.join(", ") || "component"})`,
          insertText: comp.displayId,
        });
      }
      for (const seq of doc.sequences) {
        items.push({
          label: seq.displayId,
          kind: 13,
          detail: `SBOL Sequence (${seq.elements.length} bp)`,
          insertText: seq.displayId,
        });
      }
    } catch {
      // Ignore parse errors while typing
    }
  }

  return items;
}

export interface SbolActionParams {
  options?: GeneticCircuitSolverOptions | undefined;
  modelName?: string | undefined;
}

export type SbolActionResult =
  | ReturnType<typeof lintSbol>
  | ReturnType<typeof solveGeneticCircuit>
  | { modelName: string; variableCount: number; equationCount: number }
  | string;

export async function executeSbolAction(
  action: "lint_sbol",
  text: string,
  params?: SbolActionParams,
): Promise<ReturnType<typeof lintSbol>>;
export async function executeSbolAction(
  action: "sbol_simulate",
  text: string,
  params?: SbolActionParams,
): Promise<ReturnType<typeof solveGeneticCircuit>>;
export async function executeSbolAction(
  action: "sbol_to_dae",
  text: string,
  params?: SbolActionParams,
): Promise<{ modelName: string; variableCount: number; equationCount: number }>;
export async function executeSbolAction(
  action: "sbol_to_modelica" | "sbol_to_sbml",
  text: string,
  params?: SbolActionParams,
): Promise<string>;
export async function executeSbolAction(
  action: string,
  text: string,
  params?: SbolActionParams,
): Promise<SbolActionResult>;
export async function executeSbolAction(
  action: string,
  text: string,
  params?: SbolActionParams,
): Promise<SbolActionResult> {
  const doc = parseSbol(text);

  switch (action) {
    case "lint_sbol":
      return lintSbol(doc);

    case "sbol_simulate":
      return solveGeneticCircuit(doc, params?.options);

    case "sbol_to_dae": {
      const dae = lowerSbolToDae(doc, {
        modelName: params?.modelName,
        solverOptions: params?.options,
      });
      return {
        modelName: params?.modelName ?? doc.components[0]?.displayId ?? "SbolGeneticCircuit",
        variableCount: dae.variables().length,
        equationCount: dae.equations().length,
      };
    }

    case "sbol_to_modelica":
      return sbolToModelica(doc, params?.modelName);

    case "sbol_to_sbml":
      return sbolToSbmlXml(doc, params?.modelName);

    default:
      throw new Error(`Unknown SBOL action: ${action}`);
  }
}
