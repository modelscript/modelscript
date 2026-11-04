// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/igtl — Language Server Protocol (LSP) Service Integration.
 *
 * Provides validation, document symbols, SE(3) matrix & TRE hover cards,
 * completions, go-to-definition, and custom OpenIGTLink / PLUS action execution.
 */

import {
  computeOrthogonalityError,
  computeRotationDeterminant,
  lowerIgtlToDae,
  solveTransformChainAndPivot,
  type TransformChainAndPivotResult,
} from "./kinematics/index.js";
import { lintIgtlDocument } from "./lints/rules.js";
import { parseIgtl } from "./parser/index.js";
import { igtlToModelica, igtlToUrdf } from "./projections/index.js";
import type { IgtlDiagnostic, IgtlDocument, IgtlSourceRange } from "./types.js";

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

function toLspRange(r: IgtlSourceRange): LspRange {
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

export function validateIgtl(content: string, sourceUri?: string): LspDiagnostic[] {
  let doc: IgtlDocument;
  try {
    doc = parseIgtl(content, sourceUri);
  } catch (err: unknown) {
    return [
      {
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 1 },
        },
        severity: 1,
        code: "M9800",
        source: "igtl-parser",
        message: `Parse error: ${err instanceof Error ? err.message : String(err)}`,
      },
    ];
  }

  const rawDiags = lintIgtlDocument(doc);
  return rawDiags.map((d) => {
    let sev: 1 | 2 | 3 | 4 = 1;
    if (d.severity === "warning") sev = 2;
    else if (d.severity === "info") sev = 3;

    return {
      range: toLspRange(d.range),
      severity: sev,
      code: d.code,
      source: "igtl-linter",
      message: d.message,
    };
  });
}

export function getIgtlDocumentSymbols(content: string): LspDocumentSymbol[] {
  let doc: IgtlDocument;
  try {
    doc = parseIgtl(content);
  } catch {
    return [];
  }

  const symbols: LspDocumentSymbol[] = [];

  for (const dev of doc.devices) {
    const r = toLspRange(dev.range);
    const children: LspDocumentSymbol[] = dev.dataSources.map((ds) => {
      const dsr = toLspRange(ds.range);
      return {
        name: ds.id,
        detail: `${ds.type}${ds.portName ? ` (Port ${ds.portName})` : ""}`,
        kind: LspSymbolKind.Property,
        range: dsr,
        selectionRange: dsr,
      };
    });
    symbols.push({
      name: dev.id,
      detail: `${dev.type}${dev.acquisitionRate !== undefined ? ` @ ${dev.acquisitionRate} Hz` : ""}`,
      kind: LspSymbolKind.Class,
      range: r,
      selectionRange: r,
      children,
    });
  }

  for (const tf of doc.transforms) {
    const r = toLspRange(tf.range);
    symbols.push({
      name: `${tf.from} -> ${tf.to}`,
      detail: `t=(${tf.matrix[3]}, ${tf.matrix[7]}, ${tf.matrix[11]}) mm${tf.errorMm !== undefined ? `, err=${tf.errorMm} mm` : ""}`,
      kind: LspSymbolKind.Function,
      range: r,
      selectionRange: r,
    });
  }

  for (const srv of doc.servers) {
    const r = toLspRange(srv.range);
    symbols.push({
      name: srv.id,
      detail: `TCP Port ${srv.listeningPort} (${srv.outputChannelId ?? "Unbound"})`,
      kind: LspSymbolKind.Event,
      range: r,
      selectionRange: r,
    });
  }

  return symbols;
}

export function getIgtlHover(content: string, offset: number): LspHover | null {
  let doc: IgtlDocument;
  try {
    doc = parseIgtl(content);
  } catch {
    return null;
  }

  for (const tf of doc.transforms) {
    if (offset >= tf.range.startOffset && offset <= tf.range.endOffset) {
      const det = Math.round(computeRotationDeterminant(tf.matrix) * 1e6) / 1e6;
      const frob = Math.round(computeOrthogonalityError(tf.matrix) * 1e6) / 1e6;
      const lines = [
        `### $SE(3)$ Coordinate Transform: **${tf.from} $\\rightarrow$ ${tf.to}**`,
        `* **Translation:** \`(${tf.matrix[3]}, ${tf.matrix[7]}, ${tf.matrix[11]}) mm\``,
        `* **Rotation Determinant $\\det(\\mathbf{R})$:** \`${det}\``,
        `* **Orthogonality Error $\\lVert \\mathbf{R}^\\top \\mathbf{R} - \\mathbf{I} \\rVert_F$:** \`${frob}\``,
        tf.errorMm !== undefined ? `* **Calibration RMS Error:** \`${tf.errorMm} mm\`` : "",
      ].filter(Boolean);

      return {
        contents: {
          kind: "markdown",
          value: lines.join("\n"),
        },
        range: toLspRange(tf.range),
      };
    }
  }

  for (const dev of doc.devices) {
    if (offset >= dev.range.startOffset && offset <= dev.range.endOffset) {
      return {
        contents: {
          kind: "markdown",
          value: [
            `### Tracking / Ultrasound Device: **${dev.id}**`,
            `* **Type:** \`${dev.type}\``,
            dev.acquisitionRate !== undefined ? `* **Acquisition Rate:** \`${dev.acquisitionRate} Hz\`` : "",
            dev.outputChannelIds.length > 0 ? `* **Output Channels:** \`${dev.outputChannelIds.join(", ")}\`` : "",
          ]
            .filter(Boolean)
            .join("\n"),
        },
        range: toLspRange(dev.range),
      };
    }
  }

  return null;
}

export function getIgtlCompletions(content: string, _offset?: number): LspCompletionItem[] {
  const items: LspCompletionItem[] = [
    {
      label: "Transform",
      kind: 14,
      detail: "PLUS 4x4 Homogeneous Coordinate Transform",
      insertText: '<Transform From="StylusTip" To="Stylus" Matrix="1 0 0 0 0 1 0 0 0 0 1 150 0 0 0 1" Error="0.35"/>',
    },
    {
      label: "Device",
      kind: 14,
      detail: "PLUS Optical/EM Tracker or Ultrasound Device",
      insertText:
        '<Device Id="TrackerDevice" Type="PolarisTracker" AcquisitionRate="60" ToolReferenceFrame="Tracker"/>',
    },
    {
      label: "PlusOpenIGTLinkServer",
      kind: 14,
      detail: "PLUS OpenIGTLink TCP Streaming Server",
      insertText:
        '<PlusOpenIGTLinkServer MaxNumberOfIgtlMessagesToSend="5" ListeningPort="18944" OutputChannelId="TrackerStream"/>',
    },
  ];

  try {
    const doc = parseIgtl(content);
    for (const dev of doc.devices) {
      items.push({
        label: dev.id,
        kind: 6,
        detail: `Device ${dev.id} (${dev.type})`,
      });
      for (const oc of dev.outputChannelIds) {
        items.push({
          label: oc,
          kind: 10,
          detail: `OutputChannel ${oc} on ${dev.id}`,
        });
      }
    }
    for (const tf of doc.transforms) {
      items.push({
        label: `${tf.from}To${tf.to}`,
        kind: 12,
        detail: `SE(3) Transform ${tf.from} -> ${tf.to}`,
      });
    }
  } catch {
    // ignore parse errors
  }

  return items;
}

export function getIgtlDefinition(
  content: string,
  offset: number,
  uri = "file:///navigation.plus.xml",
): LspLocation | null {
  let doc: IgtlDocument;
  try {
    doc = parseIgtl(content, uri);
  } catch {
    return null;
  }

  const word = extractWordAtOffset(content, offset);
  if (word) {
    const dev = doc.devices.find((d) => d.id === word || d.outputChannelIds.includes(word));
    if (dev) return { uri, range: toLspRange(dev.range) };

    const tf = doc.transforms.find((t) => `${t.from}To${t.to}` === word || t.from === word || t.to === word);
    if (tf) return { uri, range: toLspRange(tf.range) };
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

export async function executeIgtlAction(
  actionId: "igtl_lint",
  content: string,
  params?: Record<string, unknown>,
): Promise<IgtlDiagnostic[]>;
export async function executeIgtlAction(
  actionId: "igtl_solve_kinematics",
  content: string,
  params?: Record<string, unknown>,
): Promise<TransformChainAndPivotResult>;
export async function executeIgtlAction(
  actionId: "igtl_to_dae",
  content: string,
  params?: Record<string, unknown>,
): Promise<{ variableCount: number; equationCount: number }>;
export async function executeIgtlAction(
  actionId: "igtl_to_urdf" | "igtl_to_modelica",
  content: string,
  params?: Record<string, unknown>,
): Promise<string>;
export async function executeIgtlAction(
  actionId: string,
  content: string,
  params?: Record<string, unknown>,
): Promise<unknown>;
export async function executeIgtlAction(
  actionId: string,
  content: string,
  _params?: Record<string, unknown>,
): Promise<unknown> {
  const doc = parseIgtl(content);

  switch (actionId) {
    case "igtl_lint":
      return lintIgtlDocument(doc);
    case "igtl_solve_kinematics":
      return solveTransformChainAndPivot(doc);
    case "igtl_to_dae": {
      const arena = lowerIgtlToDae(doc);
      return {
        variableCount: arena.getVarCount(),
        equationCount: arena.getEqCount(),
      };
    }
    case "igtl_to_urdf":
      return igtlToUrdf(doc);
    case "igtl_to_modelica":
      return igtlToModelica(doc);
    default:
      throw new Error(`Unknown IGTL action: ${actionId}`);
  }
}
