// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/febio — Language Server Protocol (LSP) Service Integration.
 *
 * Provides validation, document symbols, constitutive hover cards, completions,
 * go-to-definition, and custom biomechanics action execution for .feb and .scn files.
 */

import { lintFebioDocument } from "./lints/rules.js";
import { parseFebio } from "./parser/index.js";
import { febioToCalculixInp, febioToModelica } from "./projections/index.js";
import {
  deriveConstitutiveParameters,
  type FebioMechanicsSummary,
  lowerFebioToDae,
  solveHyperelasticMechanics,
} from "./solver/index.js";
import type { FebioDiagnostic, FebioDocument, FebioSourceRange } from "./types.js";

export interface LspPosition {
  line: number;
  character: number;
}

export interface LspRange {
  start: LspPosition;
  end: LspPosition;
}

export interface LspLocation {
  uri: string;
  range: LspRange;
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
  code: string | number;
  source: string;
  message: string;
}

export interface LspHover {
  contents: {
    kind: "markdown" | "plaintext";
    value: string;
  };
  range?: LspRange | undefined;
}

export interface LspCompletionItem {
  label: string;
  kind: number;
  detail?: string | undefined;
  documentation?: string | undefined;
  insertText?: string | undefined;
}

function toLspRange(r: FebioSourceRange): LspRange {
  return {
    start: {
      line: Math.max(0, r.startLine - 1),
      character: Math.max(0, r.startColumn - 1),
    },
    end: {
      line: Math.max(0, r.endLine - 1),
      character: Math.max(0, r.endColumn - 1),
    },
  };
}

export function validateFebio(content: string): LspDiagnostic[] {
  let doc: FebioDocument;
  try {
    doc = parseFebio(content);
  } catch (err: unknown) {
    return [
      {
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 1 },
        },
        severity: 1,
        code: "M9400",
        source: "febio-parser",
        message: `Parse error: ${err instanceof Error ? err.message : String(err)}`,
      },
    ];
  }

  const rawDiags = lintFebioDocument(doc);
  return rawDiags.map((d) => {
    let sev: 1 | 2 | 3 | 4 = 1;
    if (d.severity === "warning") sev = 2;
    else if (d.severity === "info") sev = 3;

    return {
      range: toLspRange(d.range),
      severity: sev,
      code: d.code,
      source: "febio-linter",
      message: d.message,
    };
  });
}

export function getFebioDocumentSymbols(content: string): LspDocumentSymbol[] {
  let doc: FebioDocument;
  try {
    doc = parseFebio(content);
  } catch {
    return [];
  }

  const symbols: LspDocumentSymbol[] = [];

  for (const mat of doc.materials) {
    const r = toLspRange(mat.range);
    symbols.push({
      name: mat.name,
      detail: `${mat.type} (id=${mat.id})`,
      kind: LspSymbolKind.Class,
      range: r,
      selectionRange: r,
    });
  }

  for (const ns of doc.nodeSets) {
    const r = toLspRange(ns.range);
    symbols.push({
      name: ns.name,
      detail: `NodeSet (${ns.nodeIds.length} nodes)`,
      kind: LspSymbolKind.Struct,
      range: r,
      selectionRange: r,
    });
  }

  for (const surf of doc.surfaces) {
    const r = toLspRange(surf.range);
    symbols.push({
      name: surf.name,
      detail: `Surface (${surf.facets.length} facets)`,
      kind: LspSymbolKind.Interface,
      range: r,
      selectionRange: r,
    });
  }

  for (const bc of doc.boundaryConditions) {
    const r = toLspRange(bc.range);
    symbols.push({
      name: bc.name,
      detail: `${bc.type} [${bc.dofs.join(",")}] on ${bc.nodeSet}`,
      kind: LspSymbolKind.Property,
      range: r,
      selectionRange: r,
    });
  }

  for (const c of doc.contacts) {
    const r = toLspRange(c.range);
    symbols.push({
      name: c.name,
      detail: `${c.type} (${c.primarySurface} <-> ${c.secondarySurface})`,
      kind: LspSymbolKind.Event,
      range: r,
      selectionRange: r,
    });
  }

  for (const sn of doc.sofaNodes) {
    const r = toLspRange(sn.range);
    const children: LspDocumentSymbol[] = sn.forceFields.map((ff) => {
      const fr = toLspRange(ff.range);
      return {
        name: ff.name,
        detail: ff.type,
        kind: LspSymbolKind.Variable,
        range: fr,
        selectionRange: fr,
      };
    });
    symbols.push({
      name: sn.name,
      detail: `SOFA Node${sn.hasMechanicalObject ? " (MechanicalObject)" : ""}`,
      kind: LspSymbolKind.Module,
      range: r,
      selectionRange: r,
      children,
    });
  }

  return symbols;
}

export function getFebioHover(content: string, offset: number): LspHover | null {
  let doc: FebioDocument;
  try {
    doc = parseFebio(content);
  } catch {
    return null;
  }

  for (const mat of doc.materials) {
    if (offset >= mat.range.startOffset && offset <= mat.range.endOffset) {
      const params = deriveConstitutiveParameters(mat);
      const lines = [
        `### FEBio Soft-Tissue Material: **${mat.name}** (\`id="${mat.id}"\`)`,
        `* **Constitutive Law:** \`${mat.type}\``,
        `* **Mooney-Rivlin / neo-Hookean:** $C_1 = ${params.c1.toFixed(4)}$, $C_2 = ${params.c2.toFixed(4)}$, $K = ${params.bulkModulusK.toFixed(2)}$`,
        `* **Effective Linear Moduli:** $E = ${params.youngsModulusE.toFixed(2)}$, $\\nu = ${params.poissonRatioNu.toFixed(3)}$, $\\mu = ${params.shearModulusMu.toFixed(2)}$`,
        mat.perm !== undefined ? `* **Hydraulic Permeability ($k$):** \`${mat.perm}\`` : "",
        mat.phi0 !== undefined ? `* **Solid Volume Fraction ($\\phi^s$):** \`${mat.phi0}\`` : "",
      ].filter(Boolean);

      return {
        contents: {
          kind: "markdown",
          value: lines.join("\n"),
        },
        range: toLspRange(mat.range),
      };
    }
  }

  for (const bc of doc.boundaryConditions) {
    if (offset >= bc.range.startOffset && offset <= bc.range.endOffset) {
      return {
        contents: {
          kind: "markdown",
          value: [
            `### Boundary Condition: **${bc.name}**`,
            `* **Type:** \`${bc.type}\``,
            `* **NodeSet:** \`${bc.nodeSet}\``,
            `* **Constrained DOFs:** \`${bc.dofs.join(", ")}\``,
            bc.value !== undefined ? `* **Prescribed Value:** \`${bc.value}\`` : "",
          ]
            .filter(Boolean)
            .join("\n"),
        },
        range: toLspRange(bc.range),
      };
    }
  }

  for (const ns of doc.nodeSets) {
    if (offset >= ns.range.startOffset && offset <= ns.range.endOffset) {
      return {
        contents: {
          kind: "markdown",
          value: `### NodeSet: **${ns.name}**\n* **Node Count:** \`${ns.nodeIds.length}\``,
        },
        range: toLspRange(ns.range),
      };
    }
  }

  for (const sn of doc.sofaNodes) {
    if (offset >= sn.range.startOffset && offset <= sn.range.endOffset) {
      return {
        contents: {
          kind: "markdown",
          value: [
            `### SOFA Scene Node: **${sn.name}**`,
            `* **MechanicalObject Present:** \`${sn.hasMechanicalObject}\``,
            `* **ForceFields:** \`${sn.forceFields.map((f) => f.type).join(", ") || "none"}\``,
          ].join("\n"),
        },
        range: toLspRange(sn.range),
      };
    }
  }

  return null;
}

export function getFebioCompletions(content: string, _offset?: number): LspCompletionItem[] {
  const items: LspCompletionItem[] = [
    {
      label: "neo-Hookean",
      kind: 13,
      detail: "Hyperelastic neo-Hookean soft-tissue material",
      insertText: '<material id="1" name="SoftTissue" type="neo-Hookean"><E>1000</E><v>0.45</v></material>',
    },
    {
      label: "Mooney-Rivlin",
      kind: 13,
      detail: "Hyperelastic Mooney-Rivlin constitutive law",
      insertText:
        '<material id="1" name="Myocardium" type="Mooney-Rivlin"><c1>2.0</c1><c2>0.5</c2><k>50.0</k></material>',
    },
    {
      label: "biphasic",
      kind: 13,
      detail: "Biphasic poroelastic hydrated tissue",
      insertText:
        '<material id="1" name="Cartilage" type="biphasic"><phi0>0.2</phi0><perm>0.001</perm><E>500</E><v>0.3</v></material>',
    },
    {
      label: "TetrahedronFEMForceField",
      kind: 14,
      detail: "SOFA 3D Corotational / Hyperelastic Tetrahedron FEM ForceField",
      insertText: '<TetrahedronFEMForceField name="FEM" youngModulus="2500" poissonRatio="0.45" />',
    },
    {
      label: "MechanicalObject",
      kind: 14,
      detail: "SOFA Mechanical Degree-of-Freedom State Container",
      insertText: '<MechanicalObject name="DOFs" position="0 0 0 1 0 0 0 1 0 0 0 1" />',
    },
  ];

  try {
    const doc = parseFebio(content);
    for (const mat of doc.materials) {
      items.push({
        label: mat.name,
        kind: 7,
        detail: `Material ${mat.id} (${mat.type})`,
      });
    }
    for (const ns of doc.nodeSets) {
      items.push({
        label: ns.name,
        kind: 6,
        detail: `NodeSet (${ns.nodeIds.length} nodes)`,
      });
    }
    for (const surf of doc.surfaces) {
      items.push({
        label: surf.name,
        kind: 8,
        detail: `Surface (${surf.facets.length} facets)`,
      });
    }
  } catch {
    // ignore parse errors during completion
  }

  return items;
}

export function getFebioDefinition(content: string, offset: number, uri = "file:///model.feb"): LspLocation | null {
  let doc: FebioDocument;
  try {
    doc = parseFebio(content, uri);
  } catch {
    return null;
  }

  const word = extractWordAtOffset(content, offset);
  if (word) {
    const mat = doc.materials.find((m) => m.id === word || m.name === word);
    if (mat) return { uri, range: toLspRange(mat.range) };

    const ns = doc.nodeSets.find((n) => n.name === word);
    if (ns) return { uri, range: toLspRange(ns.range) };

    const surf = doc.surfaces.find((s) => s.name === word);
    if (surf) return { uri, range: toLspRange(surf.range) };
  }

  for (const bc of doc.boundaryConditions) {
    if (offset >= bc.range.startOffset && offset <= bc.range.endOffset) {
      const ns = doc.nodeSets.find((n) => n.name === bc.nodeSet);
      if (ns) return { uri, range: toLspRange(ns.range) };
    }
  }

  for (const dom of doc.solidDomains) {
    if (offset >= dom.range.startOffset && offset <= dom.range.endOffset) {
      const mat = doc.materials.find((m) => m.id === dom.materialId || m.name === dom.materialId);
      if (mat) return { uri, range: toLspRange(mat.range) };
    }
  }

  return null;
}

function extractWordAtOffset(text: string, offset: number): string {
  if (offset < 0 || offset > text.length) return "";
  const isWordChar = (ch: string | undefined) => Boolean(ch && /[A-Za-z0-9_-]/.test(ch));
  let start = offset;
  while (start > 0 && isWordChar(text[start - 1])) start--;
  let end = offset;
  while (end < text.length && isWordChar(text[end])) end++;
  return text.slice(start, end);
}

export async function executeFebioAction(
  actionId: "febio_lint",
  content: string,
  params?: Record<string, unknown>,
): Promise<FebioDiagnostic[]>;
export async function executeFebioAction(
  actionId: "febio_solve",
  content: string,
  params?: { stretch?: number; volumeRatioJ?: number },
): Promise<FebioMechanicsSummary>;
export async function executeFebioAction(
  actionId: "febio_to_dae",
  content: string,
  params?: Record<string, unknown>,
): Promise<{ variableCount: number; equationCount: number }>;
export async function executeFebioAction(
  actionId: "febio_to_calculix" | "febio_to_modelica",
  content: string,
  params?: Record<string, unknown>,
): Promise<string>;
export async function executeFebioAction(
  actionId: string,
  content: string,
  params?: Record<string, unknown>,
): Promise<unknown>;
export async function executeFebioAction(
  actionId: string,
  content: string,
  params?: Record<string, unknown>,
): Promise<unknown> {
  const doc = parseFebio(content);

  switch (actionId) {
    case "febio_lint":
      return lintFebioDocument(doc);

    case "febio_solve": {
      const stretch = typeof params?.["stretch"] === "number" ? params["stretch"] : undefined;
      const volumeRatioJ = typeof params?.["volumeRatioJ"] === "number" ? params["volumeRatioJ"] : undefined;
      return solveHyperelasticMechanics(doc, { stretch, volumeRatioJ });
    }

    case "febio_to_dae": {
      const arena = lowerFebioToDae(doc);
      return {
        variableCount: arena.getVarCount(),
        equationCount: arena.getEqCount(),
      };
    }

    case "febio_to_calculix":
      return febioToCalculixInp(doc);

    case "febio_to_modelica":
      return febioToModelica(doc);

    default:
      throw new Error(`Unknown FEBio action: ${actionId}`);
  }
}
