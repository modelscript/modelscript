// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Typed wrappers around every custom `modelscript/*` LSP request that
 * Morsel needs. Each function is a thin async call through the protocol
 * connection established by `lsp-worker.ts`.
 */

import {
  DiagramMethods,
  type ComponentPropertyData,
  type DiagramApplyEditsResult,
  type DiagramData,
  type DiagramEdge,
  type DiagramEditAction,
  type DiagramNode,
  type DiagramPort,
} from "@modelscript/diagram/protocol";
import pako from "pako";
import type { ProtocolConnection } from "vscode-languageserver-protocol/browser";
import { getLsp, startLsp } from "./lsp-worker";

export type { DiagramApplyEditsResult, DiagramData, DiagramEdge, DiagramEditAction, DiagramNode, DiagramPort };

// ────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────

async function lsp(initialLanguageId?: string): Promise<ProtocolConnection> {
  const c = getLsp();
  if (c) return c;
  return startLsp(initialLanguageId);
}

/** Version counter for incremental didChange notifications. */
const versions = new Map<string, number>();
const openedDocuments = new Map<string, { text: string; languageId: string }>();

function nextVersion(uri: string): number {
  const v = (versions.get(uri) ?? 0) + 1;
  versions.set(uri, v);
  return v;
}

// ────────────────────────────────────────────────────────────────────
// Document synchronisation
// ────────────────────────────────────────────────────────────────────

/** Notify the LSP that a document was opened. */
export function didOpen(uri: string, text: string, languageId = "modelica"): void {
  const existing = openedDocuments.get(uri);
  if (existing && existing.text === text && existing.languageId === languageId) {
    return;
  }
  openedDocuments.set(uri, { text, languageId });
  lsp(languageId).then((c) => {
    c.sendNotification("textDocument/didOpen", {
      textDocument: { uri, languageId, version: nextVersion(uri), text },
    });
  });
}

/** Notify the LSP that the full content of a document changed. */
export function didChange(uri: string, text: string): void {
  const existing = openedDocuments.get(uri);
  if (existing) {
    openedDocuments.set(uri, { ...existing, text });
  }
  lsp().then((c) => {
    c.sendNotification("textDocument/didChange", {
      textDocument: { uri, version: nextVersion(uri) },
      contentChanges: [{ text }],
    });
  });
}

/** Notify the LSP that a document was closed. */
export function didClose(uri: string): void {
  openedDocuments.delete(uri);
  lsp().then((c) => {
    c.sendNotification("textDocument/didClose", {
      textDocument: { uri },
    });
  });
  versions.delete(uri);
}

/** Notify the LSP of the currently visible line ranges in the editor. */
export function didChangeVisibleRanges(uri: string, ranges: { startLine: number; endLine: number }[]): void {
  lsp().then((c) => {
    c.sendNotification("modelscript/visibleRanges", { uri, ranges });
  });
}

// ────────────────────────────────────────────────────────────────────
// LSP types used in Morsel
// ────────────────────────────────────────────────────────────────────

export interface LspTextEdit {
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
  newText: string;
}

export interface SimulateParams {
  className?: string | undefined;
  startTime?: number | undefined;
  stopTime?: number | undefined;
  interval?: number | undefined;
  equidistant?: boolean | undefined;
  solver?: string | undefined;
  rtol?: number | undefined;
  atol?: number | undefined;
  numberOfIntervals?: number | undefined;
  steadyStateOnly?: boolean | undefined;
  format?: string | undefined;
  parameterOverrides?: Record<string, number> | undefined;
  sweepConfig?: { parameterName: string; start: number; end: number; steps: number } | undefined;
}

export interface SimulateResult {
  t: number[];
  y: number[][];
  states: string[];
  parameters?:
    | {
        name: string;
        type: "real" | "integer" | "boolean" | "enumeration";
        defaultValue: number;
        min?: number | undefined;
        max?: number | undefined;
        step: number;
        unit?: string | undefined;
        enumLiterals?: { ordinal: number; label: string }[] | undefined;
      }[]
    | undefined;
  experiment?:
    | {
        startTime?: number | undefined;
        stopTime?: number | undefined;
        interval?: number | undefined;
        tolerance?: number | undefined;
      }
    | undefined;
  error?: string | undefined;
  sweepResults?: { value: number; y: number[][] }[] | undefined;
}

export interface TreeNodeInfo {
  id: string;
  name: string;
  compositeName?: string | undefined;
  localizedName?: string | undefined;
  classKind?: string | undefined;
  hasChildren: boolean;
  iconSvg?: string | null | undefined;
}

export type ComponentProperties = ComponentPropertyData;
export type PropertyData = ComponentPropertyData["parameters"][0];

// ────────────────────────────────────────────────────────────────────
// Diagram — Unified API
// ────────────────────────────────────────────────────────────────────

/** Apply a batch of diagram edit actions atomically via the unified API */
export async function applyDiagramEdits(
  uri: string,
  actions: DiagramEditAction[],
  seq = 1,
): Promise<DiagramApplyEditsResult> {
  return (await lsp()).sendRequest(DiagramMethods.applyEdits, { uri, seq, actions });
}

export async function getDiagramData(
  uri: string,
  className?: string,
  diagramType?: string,
  sidecarContent?: string,
): Promise<DiagramData | null> {
  return (await lsp()).sendRequest(DiagramMethods.getData, { uri, className, diagramType, sidecarContent });
}

export async function getComponentProperties(
  uri: string,
  className?: string,
  componentName?: string,
): Promise<ComponentPropertyData | null> {
  return (await lsp()).sendRequest(DiagramMethods.getComponentProperties, { uri, className, componentName });
}

// ────────────────────────────────────────────────────────────────────
// Simulation
// ────────────────────────────────────────────────────────────────────

export async function simulate(uri: string, params: SimulateParams = {}): Promise<SimulateResult> {
  return (await lsp()).sendRequest("modelscript/simulate", { uri, ...params });
}

// ────────────────────────────────────────────────────────────────────
// Calibration
// ────────────────────────────────────────────────────────────────────

export async function calibrate(uri: string, params: Omit<CalibrateParams, "uri">): Promise<CalibrateResult> {
  return (await lsp()).sendRequest("modelscript/calibrate", { uri, ...params });
}

// ────────────────────────────────────────────────────────────────────
// Flatten
// ────────────────────────────────────────────────────────────────────

export async function flatten(
  name: string,
  uri?: string,
): Promise<{ text: string | null; error?: string | undefined }> {
  return (await lsp()).sendRequest("modelscript/flatten", { name, uri });
}

// ────────────────────────────────────────────────────────────────────
// Library tree
// ────────────────────────────────────────────────────────────────────

export async function getLibraryTree(uri: string, parentId?: string): Promise<TreeNodeInfo[]> {
  return (await lsp()).sendRequest("modelscript/getLibraryTree", { uri, parentId });
}

export async function getClassSource(
  className: string,
): Promise<{ content: string | null; error?: string | undefined }> {
  return (await lsp()).sendRequest("modelscript/getClassSource", { className });
}

export async function getClassIcon(className: string, uri?: string): Promise<string | null> {
  return (await lsp()).sendRequest("modelscript/getClassIcon", { className, uri });
}

export async function searchClasses(query: string, limit = 50): Promise<{ results: TreeNodeInfo[] }> {
  return (await lsp()).sendRequest("modelscript/searchClasses", { query, limit });
}

// ────────────────────────────────────────────────────────────────────
// CAD
// ────────────────────────────────────────────────────────────────────

export async function getCadComponents(
  uri: string,
): Promise<{ name: string; cad: string; dynamicBindings: { property: string; index: number; variable: string }[] }[]> {
  return (await lsp()).sendRequest("modelscript/getCadComponents", { uri });
}

// ────────────────────────────────────────────────────────────────────
// List classes (for model tabs)
// ────────────────────────────────────────────────────────────────────

export async function listClasses(): Promise<{
  classes: { name: string; kind: string; uri: string }[];
}> {
  return (await lsp()).sendRequest("modelscript/listClasses", {});
}

export async function parseCode(code: string): Promise<{
  classes: { name: string; kind: string }[];
  syntaxErrors: string[];
}> {
  return (await lsp()).sendRequest("modelscript/parse", { code });
}

export async function getDocumentSymbols(uri: string): Promise<any[]> {
  return (await lsp()).sendRequest("textDocument/documentSymbol", { textDocument: { uri } });
}

export async function installDependency(name: string, version: string): Promise<void> {
  (await lsp()).sendNotification("modelscript/installDependency", { name, version });
}

/** Place a component onto the diagram canvas at (x, y) via unified diagram edits. */
export async function placeComponent(uri: string, className: string, x = 0, y = 0): Promise<DiagramApplyEditsResult> {
  return applyDiagramEdits(uri, [{ type: "addComponent", className, x, y } as DiagramEditAction], 1);
}

/** Extract text entries from a standard ZIP archive buffer using pako.inflateRaw. */
function extractZipTextFiles(zipBytes: Uint8Array): Record<string, string> {
  const files: Record<string, string> = {};
  const view = new DataView(zipBytes.buffer, zipBytes.byteOffset, zipBytes.byteLength);
  const decoder = new TextDecoder("utf-8");

  // Try Central Directory at end of archive first for reliable sizes (handles data descriptors)
  let eocdOffset = -1;
  for (let i = zipBytes.byteLength - 22; i >= Math.max(0, zipBytes.byteLength - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }

  if (eocdOffset !== -1) {
    const cdEntries = view.getUint16(eocdOffset + 10, true);
    let cdOffset = view.getUint32(eocdOffset + 16, true);
    for (let e = 0; e < cdEntries && cdOffset + 46 <= zipBytes.byteLength; e++) {
      if (view.getUint32(cdOffset, true) !== 0x02014b50) break;
      const method = view.getUint16(cdOffset + 10, true);
      const compSize = view.getUint32(cdOffset + 20, true);
      const nameLen = view.getUint16(cdOffset + 28, true);
      const extraLen = view.getUint16(cdOffset + 30, true);
      const commentLen = view.getUint16(cdOffset + 32, true);
      const localHeaderOffset = view.getUint32(cdOffset + 42, true);
      const name = decoder.decode(zipBytes.subarray(cdOffset + 46, cdOffset + 46 + nameLen));
      cdOffset += 46 + nameLen + extraLen + commentLen;

      if (name.endsWith("/") || localHeaderOffset + 30 > zipBytes.byteLength) continue;
      if (!/\.(mo|msim|msx|sysml|sysml2|kerml|owl|step|stp|scad|cir|sp|dss|raw|inp|cfg|urdf)$/i.test(name)) {
        continue;
      }

      const localNameLen = view.getUint16(localHeaderOffset + 26, true);
      const localExtraLen = view.getUint16(localHeaderOffset + 28, true);
      const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
      if (dataStart + compSize > zipBytes.byteLength) continue;
      const rawSlice = zipBytes.subarray(dataStart, dataStart + compSize);

      try {
        if (method === 0) {
          files[name] = decoder.decode(rawSlice);
        } else if (method === 8) {
          const inflated = pako.inflateRaw(rawSlice);
          files[name] = decoder.decode(inflated);
        }
      } catch {
        // skip corrupt entry
      }
    }
    return files;
  }

  // Fallback: sequential scan of Local File Headers (PK\x03\x04)
  let offset = 0;
  while (offset + 30 <= zipBytes.byteLength) {
    const sig = view.getUint32(offset, true);
    if (sig !== 0x04034b50) break;
    const method = view.getUint16(offset + 8, true);
    const compSize = view.getUint32(offset + 18, true);
    const nameLen = view.getUint16(offset + 26, true);
    const extraLen = view.getUint16(offset + 28, true);
    const name = decoder.decode(zipBytes.subarray(offset + 30, offset + 30 + nameLen));
    const dataStart = offset + 30 + nameLen + extraLen;
    if (dataStart + compSize > zipBytes.byteLength) break;

    if (!name.endsWith("/") && compSize > 0) {
      const rawSlice = zipBytes.subarray(dataStart, dataStart + compSize);
      try {
        if (method === 0) {
          files[name] = decoder.decode(rawSlice);
        } else if (method === 8) {
          files[name] = decoder.decode(pako.inflateRaw(rawSlice));
        }
      } catch {
        // skip
      }
    }
    offset = dataStart + compSize;
  }

  return files;
}

/**
 * Load a library archive (.zip), FMU (.fmu), or Modelica/SysML source file from a Uint8Array
 * buffer into the active LSP workspace.
 */
export async function loadLibraryFromBuffer(buffer: Uint8Array, filename: string): Promise<void> {
  const conn = await lsp();
  const cleanName = filename.replace(/\.(zip|mo|fmu|msx|sysml|sysml2)$/i, "") || "UploadedLibrary";

  if (/\.fmu$/i.test(filename)) {
    const chunkSize = 0x8000;
    const chunks: string[] = [];
    for (let i = 0; i < buffer.length; i += chunkSize) {
      chunks.push(String.fromCharCode.apply(null, Array.from(buffer.subarray(i, i + chunkSize))));
    }
    const base64 = btoa(chunks.join(""));
    await conn.sendRequest("modelscript/importFmu", { name: cleanName, data: base64 });
    return;
  }

  const isZip =
    /\.zip$/i.test(filename) ||
    (buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04);

  if (isZip) {
    const extracted = extractZipTextFiles(buffer);
    const keys = Object.keys(extracted);
    if (keys.length === 0) {
      throw new Error(`No supported model files found inside archive '${filename}'.`);
    }
    // Infer top-level package name from root directory if present
    const firstSegment = keys[0]?.split("/")[0]?.split(" ")[0];
    const pkgName = firstSegment && keys[0]?.includes("/") ? firstSegment : cleanName;
    conn.sendNotification("modelscript/registryPackages", {
      packages: [
        {
          name: pkgName,
          version: "1.0.0",
          files: extracted,
        },
      ],
    });
    return;
  }

  // Single source file (.mo, .sysml, etc.)
  const text = new TextDecoder("utf-8").decode(buffer);
  conn.sendNotification("modelscript/registryPackages", {
    packages: [
      {
        name: cleanName,
        version: "1.0.0",
        files: { [`${cleanName}/${filename}`]: text },
      },
    ],
  });
}

// ────────────────────────────────────────────────────────────────────
// Utilities
// ────────────────────────────────────────────────────────────────────

/**
 * Convert an array of LSP TextEdits to Monaco IIdentifiedSingleEditOperation[]
 * and apply them to the given editor.
 */
export function applyLspEdits(
  monacoEditor: import("monaco-editor").editor.ICodeEditor,
  edits: LspTextEdit[],
  source = "lsp-bridge",
): void {
  if (!edits || edits.length === 0) return;

  const monacoEdits = edits.map((e) => ({
    range: {
      startLineNumber: e.range.start.line + 1,
      startColumn: e.range.start.character + 1,
      endLineNumber: e.range.end.line + 1,
      endColumn: e.range.end.character + 1,
    },
    text: e.newText,
  }));

  monacoEditor.pushUndoStop();
  monacoEditor.executeEdits(source, monacoEdits);
  monacoEditor.pushUndoStop();
}

export { applyLspTextEditsToString } from "./text-edits";

export interface CalibrateParams {
  uri: string;
  className?: string | undefined; // Target model to calibrate
  csvData: string; // Raw CSV text
  timeColumn?: string | undefined;
  columnMapping?: Record<string, string> | undefined; // e.g., { "csvVar": "modelVar" }
  parameters: string[]; // List of parameters to optimize
  parameterBounds?: Record<string, { min: number; max: number }> | undefined;
  tolerance?: number | undefined;
  maxIterations?: number | undefined;
  method?: "lm" | "sqp" | undefined;
}

export interface CalibrateResult {
  success: boolean;
  parameters: Record<string, number>; // The optimal values found
  residual: number;
  iterations: number;
  simulated: {
    t: number[];
    y: number[][];
    states: string[];
  };
  costHistory: number[];
  error?: string | undefined;
}
