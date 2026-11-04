// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/nifti — Language Server Protocol (LSP) Service Integration.
 *
 * Provides validation, document symbols, volumetric header & RAS affine hover cards,
 * completions, go-to-definition, and custom mesh/DAE action execution for .nii, .nrrd, and .nhdr.
 */

import { computeSformAffineDeterminant, lintNiftiDocument } from "./lints/rules.js";
import { extractIsoSurfaceMesh, lowerNiftiToDae, type NiftiSurfaceMeshSummary } from "./mesh/index.js";
import { parseNifti } from "./parser/index.js";
import { niftiToScad, niftiToStep } from "./projections/index.js";
import type { NiftiDiagnostic, NiftiDocument, NiftiSourceRange } from "./types.js";

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

function toLspRange(r: NiftiSourceRange): LspRange {
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

export function validateNifti(content: string): LspDiagnostic[] {
  let doc: NiftiDocument;
  try {
    doc = parseNifti(content);
  } catch (err: unknown) {
    return [
      {
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 1 },
        },
        severity: 1,
        code: "M9500",
        source: "nifti-parser",
        message: `Parse error: ${err instanceof Error ? err.message : String(err)}`,
      },
    ];
  }

  const rawDiags = lintNiftiDocument(doc);
  return rawDiags.map((d) => {
    let sev: 1 | 2 | 3 | 4 = 1;
    if (d.severity === "warning") sev = 2;
    else if (d.severity === "info") sev = 3;

    return {
      range: toLspRange(d.range),
      severity: sev,
      code: d.code,
      source: "nifti-linter",
      message: d.message,
    };
  });
}

export function getNiftiDocumentSymbols(content: string): LspDocumentSymbol[] {
  let doc: NiftiDocument;
  try {
    doc = parseNifti(content);
  } catch {
    return [];
  }

  const h = doc.header;
  const volRange = toLspRange(doc.range);
  const children: LspDocumentSymbol[] = [];

  for (const lbl of doc.labels) {
    const r = toLspRange(lbl.range);
    children.push({
      name: lbl.name,
      detail: `Label #${lbl.id}`,
      kind: LspSymbolKind.Constant,
      range: r,
      selectionRange: r,
    });
  }

  for (const roi of doc.rois) {
    const r = toLspRange(roi.range);
    children.push({
      name: roi.name,
      detail: `ROI (label=${roi.labelId}, D=${roi.diffusionCoeffD ?? 0.12})`,
      kind: LspSymbolKind.Struct,
      range: r,
      selectionRange: r,
    });
  }

  return [
    {
      name: doc.title,
      detail: `${h.datatypeName} [${h.dim[1]}x${h.dim[2]}x${h.dim[3]}] (${h.pixdim[1]}x${h.pixdim[2]}x${h.pixdim[3]} mm)`,
      kind: LspSymbolKind.Class,
      range: volRange,
      selectionRange: volRange,
      children,
    },
  ];
}

export function getNiftiHover(content: string, offset: number): LspHover | null {
  let doc: NiftiDocument;
  try {
    doc = parseNifti(content);
  } catch {
    return null;
  }

  for (const lbl of doc.labels) {
    if (offset >= lbl.range.startOffset && offset <= lbl.range.endOffset) {
      return {
        contents: {
          kind: "markdown",
          value: [
            `### Anatomical Segmentation Label: **${lbl.name}**`,
            `* **Label Value:** \`${lbl.id}\``,
            lbl.color ? `* **RGB Color:** \`(${lbl.color.join(", ")})\`` : "",
          ]
            .filter(Boolean)
            .join("\n"),
        },
        range: toLspRange(lbl.range),
      };
    }
  }

  for (const roi of doc.rois) {
    if (offset >= roi.range.startOffset && offset <= roi.range.endOffset) {
      return {
        contents: {
          kind: "markdown",
          value: [
            `### Compartmental ROI: **${roi.name}** (\`${roi.id}\`)`,
            `* **Anatomical Label ID:** \`${roi.labelId}\``,
            `* **Diffusion Coefficient ($D$):** \`${roi.diffusionCoeffD ?? 0.12} mm^2/s\``,
            `* **Clearance Rate ($k$):** \`${roi.clearanceRateK ?? 0.05} 1/s\``,
          ].join("\n"),
        },
        range: toLspRange(roi.range),
      };
    }
  }

  const h = doc.header;
  const detA = computeSformAffineDeterminant(h);
  return {
    contents: {
      kind: "markdown",
      value: [
        `### NIfTI / NRRD Volume: **${doc.title}**`,
        `* **Dimensions:** \`${h.dim[1]} × ${h.dim[2]} × ${h.dim[3]}\` (ndim=${h.dim[0]})`,
        `* **Voxel Spacing:** \`${h.pixdim[1]} × ${h.pixdim[2]} × ${h.pixdim[3]} mm\``,
        `* **Datatype:** \`${h.datatypeName}\` (code=${h.datatypeCode}, ${h.bitpix}-bit)`,
        `* **sform Affine $\\det(\\mathbf{A})$:** \`${detA.toFixed(4)} mm^3\``,
      ].join("\n"),
    },
    range: toLspRange(doc.range),
  };
}

export function getNiftiCompletions(content: string, _offset?: number): LspCompletionItem[] {
  const items: LspCompletionItem[] = [
    {
      label: "NRRD0004",
      kind: 14,
      detail: "NRRD v4 Volumetric Medical Image Header",
      insertText: "NRRD0004\ntype: int16\ndimension: 3\nsizes: 4 4 4\nspacings: 1.0 1.0 1.0",
    },
    {
      label: "DIM",
      kind: 14,
      detail: "NIfTI Volume Dimensions Declaration",
      insertText: "DIM ndim=3 nx=4 ny=4 nz=4 nt=1",
    },
    {
      label: "PIXDIM",
      kind: 14,
      detail: "NIfTI Voxel Spacing (mm)",
      insertText: "PIXDIM qfac=1 dx=1.0 dy=1.0 dz=1.0",
    },
    {
      label: "SFORM",
      kind: 14,
      detail: "NIfTI 4x4 RAS Affine Transform Rows",
      insertText: "SFORM code=1 srow_x=[1,0,0,0] srow_y=[0,1,0,0] srow_z=[0,0,1,0]",
    },
    {
      label: "LABEL",
      kind: 14,
      detail: "Anatomical Segmentation Label",
      insertText: 'LABEL id=1 name="LeftVentricle" color=[220,20,60]',
    },
    {
      label: "ROI",
      kind: 14,
      detail: "Compartmental Tracer / Diffusion Region of Interest",
      insertText: 'ROI id=ROI1 name="TumorCore" label=1 D=0.15 clearance=0.04 conc=1.0',
    },
  ];

  try {
    const doc = parseNifti(content);
    for (const lbl of doc.labels) {
      items.push({
        label: lbl.name,
        kind: 21,
        detail: `Anatomical Label #${lbl.id}`,
      });
    }
    for (const roi of doc.rois) {
      items.push({
        label: roi.name,
        kind: 6,
        detail: `ROI (${roi.id}, label=${roi.labelId})`,
      });
    }
  } catch {
    // ignore parse errors during completion
  }

  return items;
}

export function getNiftiDefinition(content: string, offset: number, uri = "file:///brain.nii"): LspLocation | null {
  let doc: NiftiDocument;
  try {
    doc = parseNifti(content, uri);
  } catch {
    return null;
  }

  const word = extractWordAtOffset(content, offset);
  if (word) {
    const lbl = doc.labels.find((l) => l.name === word || String(l.id) === word);
    if (lbl) return { uri, range: toLspRange(lbl.range) };

    const roi = doc.rois.find((r) => r.id === word || r.name === word);
    if (roi) return { uri, range: toLspRange(roi.range) };
  }

  for (const roi of doc.rois) {
    if (offset >= roi.range.startOffset && offset <= roi.range.endOffset) {
      const lbl = doc.labels.find((l) => l.id === roi.labelId);
      if (lbl) return { uri, range: toLspRange(lbl.range) };
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

export async function executeNiftiAction(
  actionId: "nifti_lint",
  content: string,
  params?: Record<string, unknown>,
): Promise<NiftiDiagnostic[]>;
export async function executeNiftiAction(
  actionId: "nifti_extract_mesh",
  content: string,
  params?: { isoValue?: number; labelId?: number },
): Promise<NiftiSurfaceMeshSummary>;
export async function executeNiftiAction(
  actionId: "nifti_to_dae",
  content: string,
  params?: Record<string, unknown>,
): Promise<{ variableCount: number; equationCount: number }>;
export async function executeNiftiAction(
  actionId: "nifti_to_scad" | "nifti_to_step",
  content: string,
  params?: { isoValue?: number; labelId?: number },
): Promise<string>;
export async function executeNiftiAction(
  actionId: string,
  content: string,
  params?: Record<string, unknown>,
): Promise<unknown>;
export async function executeNiftiAction(
  actionId: string,
  content: string,
  params?: Record<string, unknown>,
): Promise<unknown> {
  const doc = parseNifti(content);
  const isoValue = typeof params?.["isoValue"] === "number" ? params["isoValue"] : undefined;
  const labelId = typeof params?.["labelId"] === "number" ? params["labelId"] : undefined;

  switch (actionId) {
    case "nifti_lint":
      return lintNiftiDocument(doc);

    case "nifti_extract_mesh":
      return extractIsoSurfaceMesh(doc, { isoValue, labelId });

    case "nifti_to_dae": {
      const arena = lowerNiftiToDae(doc);
      return {
        variableCount: arena.getVarCount(),
        equationCount: arena.getEqCount(),
      };
    }

    case "nifti_to_scad":
      return niftiToScad(doc, { isoValue, labelId });

    case "nifti_to_step":
      return niftiToStep(doc, { isoValue, labelId });

    default:
      throw new Error(`Unknown NIfTI action: ${actionId}`);
  }
}
