// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/three-mf — Language Server Protocol (LSP) Service Integration.
 *
 * Provides validation, document symbols, 2-manifold mesh topology & surgical guide hover cards,
 * completions, go-to-definition, and custom 3MF action execution.
 */

import { APPROVED_BIOCOMPATIBLE_MATERIALS, lintThreeMfDocument } from "./lints/rules.js";
import { parseThreeMf } from "./parser/index.js";
import { threeMfToScad, threeMfToStep } from "./projections/index.js";
import { lowerThreeMfToDae, type ThreeMfTopologySummary, verifyMeshTopology } from "./topology/index.js";
import type { ThreeMfDiagnostic, ThreeMfDocument, ThreeMfSourceRange } from "./types.js";

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

function toLspRange(r: ThreeMfSourceRange): LspRange {
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

export function validateThreeMf(content: string, sourceUri?: string): LspDiagnostic[] {
  let doc: ThreeMfDocument;
  try {
    doc = parseThreeMf(content, sourceUri);
  } catch (err: unknown) {
    return [
      {
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 1 },
        },
        severity: 1,
        code: "M9700",
        source: "three-mf-parser",
        message: `Parse error: ${err instanceof Error ? err.message : String(err)}`,
      },
    ];
  }

  const rawDiags = lintThreeMfDocument(doc);
  return rawDiags.map((d) => {
    let sev: 1 | 2 | 3 | 4 = 1;
    if (d.severity === "warning") sev = 2;
    else if (d.severity === "info") sev = 3;

    return {
      range: toLspRange(d.range),
      severity: sev,
      code: d.code,
      source: "three-mf-linter",
      message: d.message,
    };
  });
}

export function getThreeMfDocumentSymbols(content: string): LspDocumentSymbol[] {
  let doc: ThreeMfDocument;
  try {
    doc = parseThreeMf(content);
  } catch {
    return [];
  }

  const symbols: LspDocumentSymbol[] = [];

  for (const obj of doc.objects) {
    const r = toLspRange(obj.range);
    const children: LspDocumentSymbol[] = [];
    if (obj.surgicalGuide) {
      for (const p of obj.surgicalGuide.osteotomyPlanes) {
        const pr = toLspRange(p.range);
        children.push({
          name: `OsteotomyPlane ${p.id}`,
          detail: `normal=(${p.normal.join(", ")})`,
          kind: LspSymbolKind.Property,
          range: pr,
          selectionRange: pr,
        });
      }
      for (const s of obj.surgicalGuide.drillSleeves) {
        const sr = toLspRange(s.range);
        children.push({
          name: `DrillSleeve ${s.id}`,
          detail: `⌀${s.innerDiameterMm}/${s.outerDiameterMm} mm`,
          kind: LspSymbolKind.Property,
          range: sr,
          selectionRange: sr,
        });
      }
    }

    symbols.push({
      name: obj.name ?? `Object #${obj.id}`,
      detail: `id=${obj.id}, V=${obj.mesh?.vertices.length ?? 0}, F=${obj.mesh?.triangles.length ?? 0}`,
      kind: LspSymbolKind.Struct,
      range: r,
      selectionRange: r,
      children,
    });
  }

  for (const item of doc.buildItems) {
    const r = toLspRange(item.range);
    symbols.push({
      name: `Build Item -> Object #${item.objectId}`,
      detail: item.partNumber ?? "Build Platform Instance",
      kind: LspSymbolKind.Event,
      range: r,
      selectionRange: r,
    });
  }

  return symbols;
}

export function getThreeMfHover(content: string, offset: number): LspHover | null {
  let doc: ThreeMfDocument;
  try {
    doc = parseThreeMf(content);
  } catch {
    return null;
  }

  for (const obj of doc.objects) {
    if (offset >= obj.range.startOffset && offset <= obj.range.endOffset) {
      const rep = verifyMeshTopology(obj);
      const mat = obj.surgicalGuide?.biocompatibleMaterial ?? obj.materialName ?? "Unspecified";
      const lines = [
        `### 3MF Object: **${obj.name ?? `Object #${obj.id}`}** (\`id="${obj.id}"\`)`,
        `* **Biocompatible Material:** \`${mat}\``,
        `* **Topology:** $V = ${rep.vertexCount}$, $E = ${rep.edgeCount}$, $F = ${rep.faceCount}$, $\\chi = ${rep.eulerCharacteristic}$`,
        `* **2-Manifold Watertight:** \`${rep.isWatertightManifold ? "YES" : "NO"}\``,
        `* **Signed Volume:** \`${rep.signedVolumeMm3} mm³\``,
        `* **Surface Area:** \`${rep.surfaceAreaMm2} mm²\``,
        obj.wallThicknessMm !== undefined ? `* **Wall Thickness:** \`${obj.wallThicknessMm} mm\`` : "",
      ].filter(Boolean);

      return {
        contents: {
          kind: "markdown",
          value: lines.join("\n"),
        },
        range: toLspRange(obj.range),
      };
    }
  }

  return null;
}

export function getThreeMfCompletions(content: string, _offset?: number): LspCompletionItem[] {
  const items: LspCompletionItem[] = [
    {
      label: "medical:SurgicalGuide",
      kind: 14,
      detail: "3MF Medical Extension Surgical Guide",
      insertText:
        '<medical:SurgicalGuide patientId="PT-001" anatomicalSite="Mandible" wallThickness="2.0" material="Surgical Guide Resin"/>',
    },
    {
      label: "medical:OsteotomyPlane",
      kind: 14,
      detail: "Osteotomy Cutting Slot Plane",
      insertText: '<medical:OsteotomyPlane id="Cut1" origin="0 0 10" normal="0 0 1" slotWidth="1.2"/>',
    },
    {
      label: "medical:DrillSleeve",
      kind: 14,
      detail: "Surgical K-Wire / Screw Drill Sleeve",
      insertText:
        '<medical:DrillSleeve id="Sleeve1" entry="5 5 10" axis="0 0 1" innerDiameter="2.0" outerDiameter="4.0" wallThickness="1.0"/>',
    },
  ];

  for (const mat of APPROVED_BIOCOMPATIBLE_MATERIALS) {
    items.push({
      label: mat,
      kind: 21,
      detail: "USP Class VI / ISO 10993 Biocompatible Material",
    });
  }

  try {
    const doc = parseThreeMf(content);
    for (const obj of doc.objects) {
      items.push({
        label: obj.id,
        kind: 6,
        detail: `3MF Object ${obj.name ?? obj.id}`,
      });
    }
  } catch {
    // ignore parse errors
  }

  return items;
}

export function getThreeMfDefinition(content: string, offset: number, uri = "file:///guide.3mf"): LspLocation | null {
  let doc: ThreeMfDocument;
  try {
    doc = parseThreeMf(content, uri);
  } catch {
    return null;
  }

  for (const item of doc.buildItems) {
    if (offset >= item.range.startOffset && offset <= item.range.endOffset) {
      const targetObj = doc.objects.find((o) => o.id === item.objectId);
      if (targetObj) {
        return { uri, range: toLspRange(targetObj.range) };
      }
    }
  }

  const word = extractWordAtOffset(content, offset);
  if (word) {
    const targetObj = doc.objects.find((o) => o.id === word || o.name === word);
    if (targetObj) {
      return { uri, range: toLspRange(targetObj.range) };
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

export async function executeThreeMfAction(
  actionId: "three_mf_lint",
  content: string,
  params?: Record<string, unknown>,
): Promise<ThreeMfDiagnostic[]>;
export async function executeThreeMfAction(
  actionId: "three_mf_topology",
  content: string,
  params?: Record<string, unknown>,
): Promise<ThreeMfTopologySummary>;
export async function executeThreeMfAction(
  actionId: "three_mf_to_dae",
  content: string,
  params?: Record<string, unknown>,
): Promise<{ variableCount: number; equationCount: number }>;
export async function executeThreeMfAction(
  actionId: "three_mf_to_step" | "three_mf_to_scad",
  content: string,
  params?: Record<string, unknown>,
): Promise<string>;
export async function executeThreeMfAction(
  actionId: string,
  content: string,
  params?: Record<string, unknown>,
): Promise<unknown>;
export async function executeThreeMfAction(
  actionId: string,
  content: string,
  _params?: Record<string, unknown>,
): Promise<unknown> {
  const doc = parseThreeMf(content);

  switch (actionId) {
    case "three_mf_lint":
      return lintThreeMfDocument(doc);
    case "three_mf_topology":
      return verifyMeshTopology(doc);
    case "three_mf_to_dae": {
      const arena = lowerThreeMfToDae(doc);
      return {
        variableCount: arena.getVarCount(),
        equationCount: arena.getEqCount(),
      };
    }
    case "three_mf_to_step":
      return threeMfToStep(doc);
    case "three_mf_to_scad":
      return threeMfToScad(doc);
    default:
      throw new Error(`Unknown 3MF action: ${actionId}`);
  }
}
