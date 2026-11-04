// SPDX-License-Identifier: AGPL-3.0-or-later

import { lowerSmilesToDae, type SmilesDaeOptions } from "./dae/smiles-to-dae.js";
import { lintSmiles } from "./lints/index.js";
import { parseSmilesDocument } from "./parser/smiles-parser.js";
import { smilesToAspenDeck, smilesToModelica } from "./projections/smiles-to-modelica.js";
import { estimateThermophysicalProperties, solveMolecularProperties } from "./solvers/property-estimator.js";

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

export function validateSmiles(text: string, sourceFile?: string): LspDiagnostic[] {
  try {
    const doc = parseSmilesDocument(text, sourceFile);
    const diags = lintSmiles(doc);

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
        source: "smiles-linter",
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
        code: "M9300",
        source: "smiles-parser",
        message: `SMILES parse error: ${errMsg}`,
      },
    ];
  }
}

export function getSmilesDocumentSymbols(text: string, sourceFile?: string): LspDocumentSymbol[] {
  const doc = parseSmilesDocument(text, sourceFile);
  const symbols: LspDocumentSymbol[] = [];

  const rootRange: LspRange = {
    start: { line: 0, character: 0 },
    end: { line: text.split("\n").length, character: 0 },
  };

  const children: LspDocumentSymbol[] = [];

  for (const mol of doc.molecules) {
    const startLine = mol.range ? Math.max(0, mol.range.startLine - 1) : 0;
    const endLine = mol.range ? Math.max(0, mol.range.endLine - 1) : startLine;
    const r: LspRange = {
      start: { line: startLine, character: 0 },
      end: { line: endLine, character: 40 },
    };
    const est = estimateThermophysicalProperties(mol);
    children.push({
      name: mol.name || mol.id,
      detail: `${est.formula} (MW=${est.molecularWeight.toFixed(2)} g/mol, Tb=${est.Tb.toFixed(1)} K, Tc=${est.Tc.toFixed(1)} K)`,
      kind: LspSymbolKind.Struct,
      range: r,
      selectionRange: r,
    });
  }

  symbols.push({
    name: "SmilesLibrary",
    detail: `Cheminformatics Document (${doc.format.toUpperCase()}, ${doc.molecules.length} molecules)`,
    kind: LspSymbolKind.Package,
    range: rootRange,
    selectionRange: rootRange,
    children,
  });

  return symbols;
}

export function getSmilesHover(text: string, position: LspPosition, sourceFile?: string): LspHover | null {
  const doc = parseSmilesDocument(text, sourceFile);
  if (doc.molecules.length === 0) return null;

  const targetLine = position.line + 1;
  let matchedMol = doc.molecules.find(
    (m) => m.range && targetLine >= m.range.startLine && targetLine <= m.range.endLine,
  );
  if (!matchedMol) {
    matchedMol = doc.molecules[0];
  }
  if (!matchedMol || matchedMol.atoms.length === 0) return null;

  const est = estimateThermophysicalProperties(matchedMol);
  return {
    contents: {
      kind: "markdown",
      value: [
        `### Molecule: **${matchedMol.name}** (\`${est.formula}\`)`,
        `- **SMILES:** \`${matchedMol.smiles}\``,
        `- **Molecular Weight:** ${est.molecularWeight.toFixed(3)} g/mol (Exact: ${est.exactMass.toFixed(4)} Da)`,
        `- **Topology:** ${est.heavyAtomCount} heavy atoms, ${est.ringCount} rings (${est.aromaticRingCount} aromatic)`,
        `- **ADME / Lipinski:** logP = ${est.logP.toFixed(2)}, TPSA = ${est.tpsa.toFixed(2)} Å², HBD = ${est.hBondDonors}, HBA = ${est.hBondAcceptors}`,
        `- **Joback Critical Properties:** $T_b$ = ${est.Tb.toFixed(2)} K, $T_c$ = ${est.Tc.toFixed(2)} K, $P_c$ = ${est.Pc.toFixed(2)} bar, $V_c$ = ${est.Vc.toFixed(1)} cm³/mol, $\\omega$ = ${est.acentricFactor.toFixed(4)}`,
        `- **Thermochemistry:** $\\Delta H_f^\\circ(298\\text{ K})$ = ${est.enthalpyOfFormation298K.toFixed(2)} kJ/mol, $C_p^\\circ(298\\text{ K})$ = ${est.idealGasCp298K.toFixed(2)} J/(mol·K)`,
      ].join("\n"),
    },
  };
}

export const provideSmilesHover = getSmilesHover;

export function provideSmilesCompletions(_text?: string, _position?: LspPosition): LspCompletionItem[] {
  return [
    {
      label: "Aspirin (CC(=O)Oc1ccccc1C(=O)O)",
      kind: 12,
      detail: "C9H8O4 — Acetylsalicylic acid (MW = 180.16 g/mol)",
      insertText: "CC(=O)Oc1ccccc1C(=O)O Aspirin",
    },
    {
      label: "Caffeine (Cn1cnc2c1c(=O)n(C)c(=O)n2C)",
      kind: 12,
      detail: "C8H10N4O2 — 1,3,7-Trimethylxanthine (MW = 194.19 g/mol)",
      insertText: "Cn1cnc2c1c(=O)n(C)c(=O)n2C Caffeine",
    },
    {
      label: "Benzene (c1ccccc1)",
      kind: 12,
      detail: "C6H6 — Aromatic hydrocarbon ring (MW = 78.11 g/mol)",
      insertText: "c1ccccc1 Benzene",
    },
    {
      label: "Ethanol (CCO)",
      kind: 12,
      detail: "C2H6O — Primary alcohol (MW = 46.07 g/mol)",
      insertText: "CCO Ethanol",
    },
    {
      label: "Paracetamol (CC(=O)Nc1ccc(O)cc1)",
      kind: 12,
      detail: "C8H9NO2 — Acetaminophen (MW = 151.16 g/mol)",
      insertText: "CC(=O)Nc1ccc(O)cc1 Paracetamol",
    },
    {
      label: "[C@H] (Tetrahedral Chiral Center)",
      kind: 14,
      detail: "Counter-clockwise tetrahedral stereocenter",
      insertText: "[C@H]",
    },
    {
      label: "[C@@H] (Tetrahedral Chiral Center)",
      kind: 14,
      detail: "Clockwise tetrahedral stereocenter",
      insertText: "[C@@H]",
    },
    {
      label: "C(=O)O (Carboxylic Acid Group)",
      kind: 14,
      detail: "Joback -COOH functional group",
      insertText: "C(=O)O",
    },
  ];
}

export const getSmilesCompletions = provideSmilesCompletions;

export interface SmilesActionParams {
  options?: SmilesDaeOptions | undefined;
  modelName?: string | undefined;
  title?: string | undefined;
}

export type SmilesActionResult =
  | ReturnType<typeof lintSmiles>
  | ReturnType<typeof solveMolecularProperties>
  | { modelName: string; variableCount: number; equationCount: number }
  | string;

export async function executeSmilesAction(
  action: "lint_smiles",
  text: string,
  params?: SmilesActionParams,
): Promise<ReturnType<typeof lintSmiles>>;
export async function executeSmilesAction(
  action: "smiles_estimate_properties",
  text: string,
  params?: SmilesActionParams,
): Promise<ReturnType<typeof solveMolecularProperties>>;
export async function executeSmilesAction(
  action: "smiles_to_dae",
  text: string,
  params?: SmilesActionParams,
): Promise<{ modelName: string; variableCount: number; equationCount: number }>;
export async function executeSmilesAction(
  action: "smiles_to_modelica" | "smiles_to_aspen",
  text: string,
  params?: SmilesActionParams,
): Promise<string>;
export async function executeSmilesAction(
  action: string,
  text: string,
  params?: SmilesActionParams,
): Promise<SmilesActionResult>;
export async function executeSmilesAction(
  action: string,
  text: string,
  params?: SmilesActionParams,
): Promise<SmilesActionResult> {
  const doc = parseSmilesDocument(text);

  switch (action) {
    case "lint_smiles":
      return lintSmiles(doc);

    case "smiles_estimate_properties":
    case "smiles_simulate":
      return solveMolecularProperties(doc);

    case "smiles_to_dae": {
      const dae = lowerSmilesToDae(doc, params?.options);
      return {
        modelName: doc.molecules[0]?.name || "SmilesThermophysicalSystem",
        variableCount: dae.variables().length,
        equationCount: dae.equations().length,
      };
    }

    case "smiles_to_modelica":
      return smilesToModelica(doc, params?.modelName);

    case "smiles_to_aspen":
      return smilesToAspenDeck(doc, params?.title);

    default:
      throw new Error(`Unknown SMILES action: ${action}`);
  }
}
