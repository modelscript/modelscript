// SPDX-License-Identifier: AGPL-3.0-or-later

import { collectWasmSyntaxErrors } from "@modelscript/dsl";
import { CANONICAL_MOLFILES } from "./catalog/molfile-std-schemas.js";
import { lowerMolfileToDae, type MolfileDaeOptions } from "./dae/molfile-to-dae.js";
import { lintMolfile } from "./lints/index.js";
import { parseMolfileDocument } from "./parser/molfile-parser.js";
import { getMolfileWasmParser } from "./parser/wasm-loader.js";
import { molfileToPdb, type MolfileToPdbOptions } from "./projections/molfile-to-pdb.js";
import { molfileToSmiles } from "./projections/molfile-to-smiles.js";
import { analyzeMolfileDocument, analyzeMolRecord } from "./solver/analyzer.js";

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
  detail: string;
  insertText: string;
  documentation?: string | undefined;
}

/**
 * Validates a Molfile / SDF document using both the native WASM GLR parser and chemical structure linter.
 */
export function validateMolfile(text: string, sourceFile?: string): LspDiagnostic[] {
  try {
    const syntaxDiags: LspDiagnostic[] = [];
    try {
      const cstTree = getMolfileWasmParser().parse(text);
      for (const err of collectWasmSyntaxErrors(cstTree?.rootNode)) {
        syntaxDiags.push({
          range: {
            start: { line: Math.max(0, err.startLine - 1), character: Math.max(0, err.startColumn - 1) },
            end: { line: Math.max(0, err.endLine - 1), character: Math.max(0, err.endColumn - 1) },
          },
          severity: 1,
          code: "MOL1001",
          source: "molfile-parser",
          message: err.message,
        });
      }
    } catch {
      // Fallback gracefully if WASM parser is unavailable in a minimal test environment
    }

    const doc = parseMolfileDocument(text, sourceFile);
    const lintDiags: LspDiagnostic[] = lintMolfile(doc).map((d) => {
      const line = Math.max(0, d.range.startLine - 1);
      const col = Math.max(0, d.range.startColumn - 1);
      const endLine = Math.max(0, d.range.endLine - 1);
      const endCol = Math.max(0, d.range.endColumn - 1);

      let sev: 1 | 2 | 3 = 1;
      if (d.severity === "warning") sev = 2;
      if (d.severity === "info") sev = 3;

      return {
        range: {
          start: { line, character: col },
          end: { line: endLine, character: endCol },
        },
        severity: sev,
        code: d.code,
        source: "molfile-linter",
        message: d.message,
      };
    });

    return [...syntaxDiags, ...lintDiags];
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return [
      {
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 1 },
        },
        severity: 1,
        code: "MOL1001",
        source: "molfile-parser",
        message: `Molfile parse error: ${errMsg}`,
      },
    ];
  }
}

/**
 * Extracts hierarchical LSP document symbols for Molfile / SDF records and SDF data tags.
 */
export function getMolfileDocumentSymbols(text: string, sourceFile?: string): LspDocumentSymbol[] {
  const doc = parseMolfileDocument(text, sourceFile);
  const rootRange: LspRange = {
    start: { line: 0, character: 0 },
    end: { line: text.split("\n").length, character: 0 },
  };

  const children: LspDocumentSymbol[] = [];
  for (const rec of doc.records) {
    const startLine = Math.max(0, rec.range.startLine - 1);
    const endLine = Math.max(0, rec.range.endLine - 1);
    const r: LspRange = {
      start: { line: startLine, character: 0 },
      end: { line: endLine, character: 40 },
    };
    const analysis = analyzeMolRecord(rec);
    const tagChildren: LspDocumentSymbol[] = rec.sdfDataItems.map((item) => {
      const tagLine = Math.max(0, item.line - 1);
      const tagRange: LspRange = {
        start: { line: tagLine, character: 0 },
        end: { line: tagLine, character: item.tag.length + 4 },
      };
      return {
        name: item.tag,
        detail: item.value.slice(0, 48),
        kind: LspSymbolKind.Property,
        range: tagRange,
        selectionRange: tagRange,
      };
    });

    children.push({
      name: rec.name || rec.id,
      detail: `${analysis.formula} (${rec.counts.version}, MW=${analysis.molecularWeight.toFixed(2)} g/mol, ${analysis.ringCount} rings)`,
      kind: LspSymbolKind.Struct,
      range: r,
      selectionRange: r,
      children: tagChildren.length > 0 ? tagChildren : undefined,
    });
  }

  return [
    {
      name: "MolfileLibrary",
      detail: `MDL ${doc.format.toUpperCase()} Document (${doc.records.length} records)`,
      kind: LspSymbolKind.Package,
      range: rootRange,
      selectionRange: rootRange,
      children,
    },
  ];
}

/**
 * Provides Markdown hover information for the Molfile/SDF record at `position`.
 */
export function getMolfileHover(text: string, position: LspPosition, sourceFile?: string): LspHover | null {
  const doc = parseMolfileDocument(text, sourceFile);
  if (doc.records.length === 0) return null;

  const targetLine = position.line + 1;
  const matched =
    doc.records.find((r) => targetLine >= r.range.startLine && targetLine <= r.range.endLine) ?? doc.records[0];
  if (!matched) return null;

  const analysis = analyzeMolRecord(matched);
  return {
    contents: {
      kind: "markdown",
      value: [
        `### Molecule: **${matched.name}** (\`${analysis.formula}\`)`,
        `- **Format:** MDL ${matched.counts.version} (${matched.header.dimensionCode || "2D"})`,
        `- **Molecular Weight:** ${analysis.molecularWeight.toFixed(3)} g/mol (Exact: ${analysis.exactMass.toFixed(4)} Da)`,
        `- **Topology:** ${analysis.heavyAtomCount} heavy atoms, ${analysis.totalHydrogenCount} H (${analysis.implicitHydrogenCount} implicit), ${analysis.bondCount} bonds, ${analysis.ringCount} SSSR rings`,
        `- **UFF Stretch Energy:** ${analysis.totalStretchEnergy.toFixed(3)} kcal/mol`,
      ].join("\n"),
    },
  };
}

export const provideMolfileHover = getMolfileHover;

/**
 * Provides LSP completion items for MDL Molfile directives, V3000 blocks, SDF tags, and canonical molecules.
 */
export function provideMolfileCompletions(_text?: string, _position?: LspPosition): LspCompletionItem[] {
  return [
    {
      label: "M  END",
      kind: 14,
      detail: "End of MDL Molfile CTAB block",
      insertText: "M  END",
    },
    {
      label: "M  CHG",
      kind: 14,
      detail: "V2000 formal charge property line",
      insertText: "M  CHG  1   1   1",
    },
    {
      label: "M  ISO",
      kind: 14,
      detail: "V2000 isotope mass property line",
      insertText: "M  ISO  1   1  13",
    },
    {
      label: "M  RAD",
      kind: 14,
      detail: "V2000 radical spin multiplicity property line",
      insertText: "M  RAD  1   1   2",
    },
    {
      label: "M  V30 BEGIN CTAB",
      kind: 14,
      detail: "MDL V3000 extended connection table block",
      insertText:
        "M  V30 BEGIN CTAB\nM  V30 COUNTS 0 0 0 0 0\nM  V30 BEGIN ATOM\nM  V30 END ATOM\nM  V30 BEGIN BOND\nM  V30 END BOND\nM  V30 END CTAB\nM  END",
    },
    {
      label: "$$$$",
      kind: 14,
      detail: "SDF multi-record delimiter",
      insertText: "$$$$",
    },
    {
      label: "Aspirin (C9H8O4)",
      kind: 12,
      detail: "Canonical V2000 Molfile — MW = 180.157 g/mol",
      insertText: CANONICAL_MOLFILES.Aspirin,
    },
    {
      label: "Benzene (C6H6)",
      kind: 12,
      detail: "Canonical V2000 Molfile — 6-membered aromatic ring",
      insertText: CANONICAL_MOLFILES.Benzene,
    },
    {
      label: "Caffeine (C8H10N4O2)",
      kind: 12,
      detail: "Canonical V2000 Molfile — MW = 194.191 g/mol",
      insertText: CANONICAL_MOLFILES.Caffeine,
    },
  ];
}

export const getMolfileCompletions = provideMolfileCompletions;

export interface MolfileActionParams {
  options?: MolfileDaeOptions | undefined;
  pdbOptions?: MolfileToPdbOptions | undefined;
}

export type MolfileActionResult =
  | ReturnType<typeof lintMolfile>
  | ReturnType<typeof analyzeMolfileDocument>
  | { modelName: string; variableCount: number; equationCount: number }
  | string;

export async function executeMolfileAction(
  action: "lint_molfile",
  text: string,
  params?: MolfileActionParams,
): Promise<ReturnType<typeof lintMolfile>>;
export async function executeMolfileAction(
  action: "molfile_analyze",
  text: string,
  params?: MolfileActionParams,
): Promise<ReturnType<typeof analyzeMolfileDocument>>;
export async function executeMolfileAction(
  action: "molfile_to_dae",
  text: string,
  params?: MolfileActionParams,
): Promise<{ modelName: string; variableCount: number; equationCount: number }>;
export async function executeMolfileAction(
  action: "molfile_to_smiles" | "molfile_to_pdb",
  text: string,
  params?: MolfileActionParams,
): Promise<string>;
export async function executeMolfileAction(
  action: string,
  text: string,
  params?: MolfileActionParams,
): Promise<MolfileActionResult>;
export async function executeMolfileAction(
  action: string,
  text: string,
  params?: MolfileActionParams,
): Promise<MolfileActionResult> {
  const doc = parseMolfileDocument(text);

  switch (action) {
    case "lint_molfile":
      return lintMolfile(doc);

    case "molfile_analyze":
      return analyzeMolfileDocument(doc);

    case "molfile_to_dae": {
      const dae = lowerMolfileToDae(doc, params?.options);
      return {
        modelName: doc.records[0]?.name || "MolfileMechanicsSystem",
        variableCount: dae.variables().length,
        equationCount: dae.equations().length,
      };
    }

    case "molfile_to_smiles":
      return molfileToSmiles(doc);

    case "molfile_to_pdb":
      return molfileToPdb(doc, params?.pdbOptions);

    default:
      throw new Error(`Unknown Molfile action: ${action}`);
  }
}
