// SPDX-License-Identifier: AGPL-3.0-or-later

import { lowerPdbToDae, type PdbDaeOptions } from "./dae/pdb-to-dae.js";
import { lintPdb } from "./lints/index.js";
import { parsePdb } from "./parser/pdb-parser.js";
import { pdbToModelica } from "./projections/pdb-to-modelica.js";
import { solveProteinBiophysics, type ProteinBiophysicsOptions } from "./solvers/protein-biophysics-solver.js";

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
  detail: string;
  insertText: string;
  documentation?: string | undefined;
}

export function validatePdb(text: string, sourceFile?: string): LspDiagnostic[] {
  try {
    const doc = parsePdb(text, sourceFile);
    const diags = lintPdb(doc);

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
        source: "pdb-linter",
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
        code: "M9250",
        source: "pdb-parser",
        message: `PDB/mmCIF parse error: ${errMsg}`,
      },
    ];
  }
}

export function getPdbDocumentSymbols(text: string, sourceFile?: string): LspDocumentSymbol[] {
  const doc = parsePdb(text, sourceFile);
  const bio = solveProteinBiophysics(doc);

  const rootRange: LspRange = {
    start: { line: 0, character: 0 },
    end: { line: text.split("\n").length, character: 0 },
  };

  const chainSymbols: LspDocumentSymbol[] = [];
  for (const chain of doc.chains) {
    const startLine = chain.range ? Math.max(0, chain.range.startLine - 1) : 0;
    const endLine = chain.range ? Math.max(0, chain.range.endLine - 1) : startLine;
    const cRange: LspRange = {
      start: { line: startLine, character: 0 },
      end: { line: endLine, character: 80 },
    };

    const resSymbols: LspDocumentSymbol[] = chain.residues.map((res) => {
      const rStart = res.range ? Math.max(0, res.range.startLine - 1) : startLine;
      const rEnd = res.range ? Math.max(0, res.range.endLine - 1) : rStart;
      const rRange: LspRange = {
        start: { line: rStart, character: 0 },
        end: { line: rEnd, character: 80 },
      };
      return {
        name: `${res.resName}${res.resSeq}`,
        detail: `${res.atoms.length} atoms (${res.oneLetterCode})`,
        kind: LspSymbolKind.Struct,
        range: rRange,
        selectionRange: rRange,
      };
    });

    chainSymbols.push({
      name: `Chain ${chain.id}`,
      detail: `${chain.residues.length} residues (${chain.sequence})`,
      kind: LspSymbolKind.Module,
      range: cRange,
      selectionRange: cRange,
      children: resSymbols,
    });
  }

  return [
    {
      name: doc.id || "PDBStructure",
      detail: `${doc.title} (MW=${bio.molecularWeightDa.toFixed(1)} Da, Rg=${bio.radiusOfGyration.toFixed(2)} Å)`,
      kind: LspSymbolKind.Package,
      range: rootRange,
      selectionRange: rootRange,
      children: chainSymbols,
    },
  ];
}

export function getPdbHover(text: string, position: LspPosition, sourceFile?: string): LspHover | null {
  const doc = parsePdb(text, sourceFile);
  if (doc.atoms.length === 0 && doc.hetAtoms.length === 0) return null;

  const bio = solveProteinBiophysics(doc);
  const targetLine = position.line + 1;
  const matchedRes = doc.residues.find(
    (r) => r.range && targetLine >= r.range.startLine && targetLine <= r.range.endLine,
  );
  const matchedRama = matchedRes
    ? bio.ramachandran.find((rm) => rm.chainId === matchedRes.chainId && rm.resSeq === matchedRes.resSeq)
    : undefined;

  const lines: string[] = [
    `### Macromolecular Structure: **${doc.id}** (${doc.format.toUpperCase()})`,
    `- **Title:** ${doc.title}`,
    `- **Composition:** ${bio.chainCount} chains, ${bio.residueCount} residues, ${bio.atomCount} atoms`,
    `- **Molecular Weight:** ${bio.molecularWeightDa.toFixed(2)} Da`,
    `- **Radius of Gyration ($R_g$):** ${bio.radiusOfGyration.toFixed(3)} Å`,
    `- **Center of Mass:** (${bio.centerOfMass[0].toFixed(2)}, ${bio.centerOfMass[1].toFixed(2)}, ${bio.centerOfMass[2].toFixed(2)}) Å`,
    `- **GNM Elastic Network:** ${bio.caAtoms.length} $\\text{C}_\\alpha$ nodes, ${bio.contacts.length} harmonic contacts ($r_c = ${bio.cutoffDistance.toFixed(1)}$ Å)`,
  ];

  if (matchedRes) {
    lines.push(
      `- **Residue at Cursor:** \`${matchedRes.chainId}:${matchedRes.resName}${matchedRes.resSeq}\` (${matchedRes.atoms.length} atoms)`,
    );
    if (matchedRama && (matchedRama.phi !== null || matchedRama.psi !== null)) {
      const phiStr = matchedRama.phi !== null ? `${matchedRama.phi.toFixed(1)}°` : "N/A";
      const psiStr = matchedRama.psi !== null ? `${matchedRama.psi.toFixed(1)}°` : "N/A";
      lines.push(`- **Ramachandran Torsion:** $\\phi = ${phiStr}$, $\\psi = ${psiStr}$ (${matchedRama.region})`);
    }
  }

  return {
    contents: {
      kind: "markdown",
      value: lines.join("\n"),
    },
  };
}

export const providePdbHover = getPdbHover;

export function providePdbCompletions(_text?: string, _position?: LspPosition): LspCompletionItem[] {
  return [
    {
      label: "HEADER (wwPDB Header Record)",
      kind: 14,
      detail: "Defines macromolecular classification, deposition date, and 4-char PDB ID",
      insertText: "HEADER    PROTEIN                                 01-JAN-26   1CRN",
    },
    {
      label: "ATOM (Main-Chain Coordinate Record)",
      kind: 12,
      detail: "Standard 80-column PDB ATOM coordinate record",
      insertText: "ATOM      1  N   ALA A   1       0.000   0.000   0.000  1.00 15.00           N  ",
    },
    {
      label: "HELIX (Alpha-Helix Secondary Structure)",
      kind: 14,
      detail: "Declares an alpha-helical segment along a polypeptide chain",
      insertText: "HELIX    1   1 ALA A    1  ALA A   10  1                                  10",
    },
    {
      label: "SHEET (Beta-Sheet Strand Record)",
      kind: 14,
      detail: "Declares a beta-sheet strand segment",
      insertText: "SHEET    1   A 2 ALA A   1  ALA A   5  0",
    },
    {
      label: "SSBOND (Disulfide Bridge Record)",
      kind: 14,
      detail: "Declares a covalent cysteine SG-SG disulfide bond",
      insertText: "SSBOND   1 CYS A    1    CYS A    5                          1555   1555  2.04",
    },
    {
      label: "CONECT (Explicit Covalent Connectivity)",
      kind: 14,
      detail: "Specifies explicit atom-to-atom covalent connectivity serials",
      insertText: "CONECT    1    2",
    },
  ];
}

export const getPdbCompletions = providePdbCompletions;

export interface PdbActionParams {
  biophysicsOptions?: ProteinBiophysicsOptions | undefined;
  daeOptions?: PdbDaeOptions | undefined;
  modelName?: string | undefined;
}

export type PdbActionResult =
  | ReturnType<typeof lintPdb>
  | ReturnType<typeof solveProteinBiophysics>
  | { modelName: string; variableCount: number; equationCount: number }
  | string;

export async function executePdbAction(
  action: "lint_pdb",
  text: string,
  params?: PdbActionParams,
): Promise<ReturnType<typeof lintPdb>>;
export async function executePdbAction(
  action: "pdb_solve_biophysics",
  text: string,
  params?: PdbActionParams,
): Promise<ReturnType<typeof solveProteinBiophysics>>;
export async function executePdbAction(
  action: "pdb_to_dae",
  text: string,
  params?: PdbActionParams,
): Promise<{ modelName: string; variableCount: number; equationCount: number }>;
export async function executePdbAction(
  action: "pdb_to_modelica",
  text: string,
  params?: PdbActionParams,
): Promise<string>;
export async function executePdbAction(
  action: string,
  text: string,
  params?: PdbActionParams,
): Promise<PdbActionResult>;
export async function executePdbAction(
  action: string,
  text: string,
  params?: PdbActionParams,
): Promise<PdbActionResult> {
  const doc = parsePdb(text);

  switch (action) {
    case "lint_pdb":
      return lintPdb(doc);

    case "pdb_solve_biophysics":
    case "pdb_simulate":
      return solveProteinBiophysics(doc, params?.biophysicsOptions);

    case "pdb_to_dae": {
      const dae = lowerPdbToDae(doc, params?.daeOptions);
      return {
        modelName: doc.id ? `PDB_${doc.id}` : "ProteinElasticNetwork",
        variableCount: dae.variables().length,
        equationCount: dae.equations().length,
      };
    }

    case "pdb_to_modelica":
      return pdbToModelica(doc, params?.modelName);

    default:
      throw new Error(`Unknown PDB action: ${action}`);
  }
}
