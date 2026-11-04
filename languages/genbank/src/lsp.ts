// SPDX-License-Identifier: AGPL-3.0-or-later

import { lowerGenbankToDae } from "./dae/genbank-to-dae.js";
import { getFeatureDisplayName, lintGenbank } from "./lints/index.js";
import { parseGenbank } from "./parser/genbank-parser.js";
import { genbankToModelica, genbankToSbolXml } from "./projections/genbank-projections.js";
import { RESTRICTION_ENZYMES, analyzeGenbankSequence } from "./solvers/sequence-solver.js";
import type { SequenceAnalysisOptions } from "./types.js";

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

export interface LspCompletionItem {
  label: string;
  kind: number;
  detail?: string | undefined;
  documentation?: string | undefined;
  insertText?: string | undefined;
}

export function validateGenbank(text: string): LspDiagnostic[] {
  try {
    const doc = parseGenbank(text);
    const diags = lintGenbank(doc);

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
        source: "genbank-linter",
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
        code: "M9350",
        source: "genbank-parser",
        message: `GenBank/FASTA parse error: ${errMsg}`,
      },
    ];
  }
}

export function getGenbankDocumentSymbols(text: string): LspDocumentSymbol[] {
  const doc = parseGenbank(text);
  const rootRange: LspRange = {
    start: { line: 0, character: 0 },
    end: { line: text.split("\n").length, character: 0 },
  };

  const children: LspDocumentSymbol[] = [];

  for (const rec of doc.records) {
    const startLine = rec.range ? Math.max(0, rec.range.startLine - 1) : 0;
    const endLine = rec.range ? Math.max(0, rec.range.endLine - 1) : startLine;
    const r: LspRange = {
      start: { line: startLine, character: 0 },
      end: { line: endLine, character: 40 },
    };

    const recChildren: LspDocumentSymbol[] = [];
    for (let i = 0; i < rec.features.length; i++) {
      const feat = rec.features[i]!;
      const featName = getFeatureDisplayName(feat, i);
      const fStart = feat.range ? Math.max(0, feat.range.startLine - 1) : startLine;
      const fEnd = feat.range ? Math.max(0, feat.range.endLine - 1) : fStart;
      const fR: LspRange = {
        start: { line: fStart, character: 0 },
        end: { line: fEnd, character: 40 },
      };
      recChildren.push({
        name: featName,
        detail: `${feat.key} (${feat.location.raw})`,
        kind: feat.key === "CDS" ? LspSymbolKind.Function : LspSymbolKind.Field,
        range: fR,
        selectionRange: fR,
      });
    }

    children.push({
      name: rec.locus,
      detail: `${rec.moleculeType} ${rec.topology} (${rec.sequence.length} bp)`,
      kind: LspSymbolKind.Class,
      range: r,
      selectionRange: r,
      children: recChildren,
    });
  }

  return [
    {
      name: doc.records[0]?.locus ?? "GenbankDocument",
      detail: `GenBank/FASTA Document (${doc.records.length} records)`,
      kind: LspSymbolKind.Package,
      range: rootRange,
      selectionRange: rootRange,
      children,
    },
  ];
}

export function getGenbankHover(text: string, position: LspPosition): LspHover | null {
  const doc = parseGenbank(text);
  const lines = text.split("\n");
  const lineText = lines[position.line] ?? "";

  for (const rec of doc.records) {
    if (lineText.includes(rec.locus)) {
      const analysis = analyzeGenbankSequence(rec);
      return {
        contents: {
          kind: "markdown",
          value: [
            `### GenBank Locus: **${rec.locus}**`,
            rec.definition ? `- **Definition:** ${rec.definition}` : "",
            `- **Length:** ${rec.sequence.length} bp (declared: ${rec.declaredLength} bp)`,
            `- **Molecule / Topology:** \`${rec.moleculeType}\` / \`${rec.topology}\``,
            `- **GC Content:** ${analysis.gcPercent.toFixed(1)}% ($T_m = ${analysis.meltingTemperatureC}\\text{ °C}$)`,
            `- **Features:** ${rec.features.length} | **ORFs:** ${analysis.orfs.length}`,
          ]
            .filter(Boolean)
            .join("\n"),
        },
      };
    }

    for (let i = 0; i < rec.features.length; i++) {
      const feat = rec.features[i]!;
      const featName = getFeatureDisplayName(feat, i);
      const startLine = feat.range ? feat.range.startLine - 1 : -1;
      const endLine = feat.range ? feat.range.endLine - 1 : -1;
      if ((position.line >= startLine && position.line <= endLine) || lineText.includes(`"${featName}"`)) {
        return {
          contents: {
            kind: "markdown",
            value: [
              `### GenBank Feature: **${featName}** (\`${feat.key}\`)`,
              `- **Location:** \`${feat.location.raw}\` (${feat.location.strand === -1 ? "complement" : "forward"} strand)`,
              feat.qualifiers["product"] ? `- **Product:** ${feat.qualifiers["product"]}` : "",
              feat.qualifiers["translation"]
                ? `- **Translation (${feat.qualifiers["translation"].length} aa):** \`${feat.qualifiers["translation"].slice(0, 32)}${feat.qualifiers["translation"].length > 32 ? "..." : ""}\``
                : "",
            ]
              .filter(Boolean)
              .join("\n"),
          },
        };
      }
    }
  }

  return null;
}

export const provideGenbankHover = getGenbankHover;

export function provideGenbankCompletions(text?: string, _position?: LspPosition): LspCompletionItem[] {
  const items: LspCompletionItem[] = [
    {
      label: "LOCUS",
      kind: 14,
      detail: "GenBank LOCUS record header",
      insertText: "LOCUS       Plasmid_1               1000 bp    ds-DNA  circular SYN 01-JAN-2026",
    },
    {
      label: "FEATURES",
      kind: 14,
      detail: "GenBank FEATURES table header",
      insertText: "FEATURES             Location/Qualifiers",
    },
    {
      label: "CDS",
      kind: 14,
      detail: "Coding Sequence feature entry",
      insertText: '     CDS             1..300\n                     /gene="$1"\n                     /product="$2"',
    },
    {
      label: "promoter",
      kind: 14,
      detail: "Transcriptional promoter feature",
      insertText: '     promoter        1..50\n                     /label="$1"',
    },
    {
      label: "RBS",
      kind: 14,
      detail: "Ribosome binding site feature",
      insertText: '     RBS             51..65\n                     /label="$1"',
    },
    {
      label: "terminator",
      kind: 14,
      detail: "Transcriptional terminator feature",
      insertText: '     terminator      301..350\n                     /label="$1"',
    },
    {
      label: "ORIGIN",
      kind: 14,
      detail: "GenBank nucleotide sequence ORIGIN block",
      insertText: "ORIGIN\n        1 atggccattg taatgggccg ctgaaagggt gcccgatag\n//",
    },
  ];

  for (const enz of Object.values(RESTRICTION_ENZYMES)) {
    items.push({
      label: enz.name,
      kind: 12,
      detail: `Restriction enzyme (${enz.recognitionSite}, ${enz.overhang})`,
      insertText: enz.recognitionSite,
    });
  }

  if (text) {
    try {
      const doc = parseGenbank(text);
      for (const rec of doc.records) {
        items.push({
          label: rec.locus,
          kind: 6,
          detail: `GenBank Locus (${rec.sequence.length} bp ${rec.topology})`,
          insertText: rec.locus,
        });
        for (let i = 0; i < rec.features.length; i++) {
          const feat = rec.features[i]!;
          const featName = getFeatureDisplayName(feat, i);
          items.push({
            label: featName,
            kind: 8,
            detail: `Feature ${feat.key} (${feat.location.raw})`,
            insertText: featName,
          });
        }
      }
    } catch {
      // Ignore parse errors while typing
    }
  }

  return items;
}

export interface GenbankActionParams {
  options?: SequenceAnalysisOptions | undefined;
  modelName?: string | undefined;
  namespace?: string | undefined;
}

export type GenbankActionResult =
  | ReturnType<typeof lintGenbank>
  | ReturnType<typeof analyzeGenbankSequence>
  | { modelName: string; variableCount: number; equationCount: number }
  | string;

export async function executeGenbankAction(
  action: "lint_genbank",
  text: string,
  params?: GenbankActionParams,
): Promise<ReturnType<typeof lintGenbank>>;
export async function executeGenbankAction(
  action: "genbank_analyze",
  text: string,
  params?: GenbankActionParams,
): Promise<ReturnType<typeof analyzeGenbankSequence>>;
export async function executeGenbankAction(
  action: "genbank_to_dae",
  text: string,
  params?: GenbankActionParams,
): Promise<{ modelName: string; variableCount: number; equationCount: number }>;
export async function executeGenbankAction(
  action: "genbank_to_modelica" | "genbank_to_sbol",
  text: string,
  params?: GenbankActionParams,
): Promise<string>;
export async function executeGenbankAction(
  action: string,
  text: string,
  params?: GenbankActionParams,
): Promise<GenbankActionResult>;
export async function executeGenbankAction(
  action: string,
  text: string,
  params?: GenbankActionParams,
): Promise<GenbankActionResult> {
  const doc = parseGenbank(text);

  switch (action) {
    case "lint_genbank":
      return lintGenbank(doc);

    case "genbank_analyze":
      return analyzeGenbankSequence(doc, params?.options);

    case "genbank_to_dae": {
      const dae = lowerGenbankToDae(doc, { modelName: params?.modelName });
      return {
        modelName: params?.modelName ?? doc.records[0]?.locus ?? "GenbankPlasmid",
        variableCount: dae.variables().length,
        equationCount: dae.equations().length,
      };
    }

    case "genbank_to_modelica":
      return genbankToModelica(doc, params?.modelName);

    case "genbank_to_sbol":
      return genbankToSbolXml(doc, params?.namespace);

    default:
      throw new Error(`Unknown GenBank action: ${action}`);
  }
}
