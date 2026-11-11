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

/**
 * Synchronously extracts the primary simulatable class name from Modelica source code.
 * Prefers a `model`/`block`/`class` with an `experiment(...)` annotation, otherwise the last
 * `model`/`block`/`class` definition in the snippet (since helper components/connectors precede the system model).
 */
export function extractPrimaryModelicaClassName(code: string): string | null {
  if (!code || typeof code !== "string") return null;
  const cleaned = code.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");

  const classRegex =
    /\b(?:partial\s+|expandable\s+|encapsulated\s+)*(model|block|class|connector|record|package|function|type)\s+([A-Za-z_]\w*)\b/g;
  const matches: { kind: string; name: string; index: number }[] = [];
  let match: RegExpExecArray | null;
  while ((match = classRegex.exec(cleaned)) !== null) {
    const kind = match[1]!.toLowerCase();
    const name = match[2]!;
    matches.push({ kind, name, index: match.index });
  }
  if (matches.length === 0) return null;

  // Check if any model/block/class has an experiment(...) annotation before its `end <Name>;`
  for (const m of matches) {
    if (m.kind === "model" || m.kind === "block" || m.kind === "class") {
      const endRegex = new RegExp(`\\bend\\s+${m.name}\\s*;`);
      const rest = cleaned.slice(m.index);
      const endMatch = endRegex.exec(rest);
      const body = endMatch ? rest.slice(0, endMatch.index) : rest;
      if (/\bexperiment\s*\(/i.test(body)) {
        return m.name;
      }
    }
  }

  const simulatable = matches.filter((m) => m.kind === "model" || m.kind === "block" || m.kind === "class");
  if (simulatable.length > 0) {
    return simulatable[simulatable.length - 1]!.name;
  }

  return matches[0]!.name;
}

// ────────────────────────────────────────────────────────────────────
// Document synchronisation
// ────────────────────────────────────────────────────────────────────

/** Notify the LSP that a document was opened. */
export async function didOpen(uri: string, text: string, languageId = "modelica"): Promise<void> {
  const existing = openedDocuments.get(uri);
  if (existing && existing.text === text && existing.languageId === languageId) {
    return;
  }
  openedDocuments.set(uri, { text, languageId });
  const c = await lsp(languageId);
  c.sendNotification("textDocument/didOpen", {
    textDocument: { uri, languageId, version: nextVersion(uri), text },
  });
}

/** Notify the LSP that the full content of a document changed. */
export async function didChange(uri: string, text: string): Promise<void> {
  const existing = openedDocuments.get(uri);
  if (existing) {
    openedDocuments.set(uri, { ...existing, text });
  } else {
    openedDocuments.set(uri, { text, languageId: "modelica" });
  }
  const c = await lsp();
  c.sendNotification("textDocument/didChange", {
    textDocument: { uri, version: nextVersion(uri) },
    contentChanges: [{ text }],
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
  flattenerBackend?: "hybrid" | "wasm" | "ts" | "diff" | undefined;
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
  className?: string,
): Promise<DiagramApplyEditsResult> {
  return (await lsp()).sendRequest(DiagramMethods.applyEdits, {
    uri,
    seq,
    actions,
    ...(className ? { className } : {}),
  });
}

export async function getDiagramData(
  uri: string,
  className?: string,
  diagramType?: string,
  sidecarContent?: string,
  documentText?: string,
): Promise<DiagramData | null> {
  return (await lsp()).sendRequest(DiagramMethods.getData, {
    uri,
    className,
    diagramType,
    sidecarContent,
    documentText,
  });
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
  const conn = await lsp();
  const opened = openedDocuments.get(uri);
  const effectiveClassName =
    params.className || (opened?.text ? (extractPrimaryModelicaClassName(opened.text) ?? undefined) : undefined);
  const reqParams = { uri, ...params, className: effectiveClassName };

  let res: SimulateResult = await conn.sendRequest("modelscript/simulate", reqParams);
  for (let attempt = 0; attempt < 4 && res?.error?.includes("No class definition found"); attempt++) {
    if (opened?.text) {
      conn.sendNotification("textDocument/didChange", {
        textDocument: { uri, version: nextVersion(uri) },
        contentChanges: [{ text: opened.text }],
      });
    }
    await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
    res = await conn.sendRequest("modelscript/simulate", reqParams);
  }
  return res;
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

export const globalClassIconCache = new Map<string, string | null>();
const pendingIconRequests = new Map<string, Promise<string | null>>();

export async function getClassIcon(className: string, uri?: string): Promise<string | null> {
  if (!className) return null;
  const clean = className.startsWith("__LIB__:") ? className.slice("__LIB__:".length) : className;

  if (globalClassIconCache.has(clean)) {
    const val = globalClassIconCache.get(clean) ?? null;
    if (className !== clean && !globalClassIconCache.has(className)) {
      globalClassIconCache.set(className, val);
    }
    return val;
  }
  if (pendingIconRequests.has(clean)) {
    return pendingIconRequests.get(clean)!;
  }

  const req = (async () => {
    try {
      const conn = await lsp();
      const res = await conn.sendRequest<string | null>("modelscript/getClassIcon", { className: clean, uri });
      globalClassIconCache.set(clean, res ?? null);
      if (className !== clean) globalClassIconCache.set(className, res ?? null);
      return res ?? null;
    } catch {
      globalClassIconCache.set(clean, null);
      if (className !== clean) globalClassIconCache.set(className, null);
      return null;
    } finally {
      pendingIconRequests.delete(clean);
    }
  })();

  pendingIconRequests.set(clean, req);
  return req;
}

export async function getClassIcons(classNames: string[], uri?: string): Promise<Record<string, string>> {
  const missing: string[] = [];
  const out: Record<string, string> = {};
  for (const raw of classNames) {
    const clean = raw.startsWith("__LIB__:") ? raw.slice("__LIB__:".length) : raw;
    const cached = globalClassIconCache.get(clean);
    if (cached !== undefined) {
      if (cached) out[raw] = cached;
    } else if (clean) {
      missing.push(clean);
    }
  }
  if (missing.length === 0) return out;

  try {
    const batch = await (
      await lsp()
    ).sendRequest<Record<string, string | null>>("modelscript/getClassIcons", {
      classNames: missing,
      ...(uri ? { uri } : {}),
    });
    if (batch && typeof batch === "object") {
      for (const [cls, svg] of Object.entries(batch)) {
        globalClassIconCache.set(cls, svg ?? null);
        if (typeof svg === "string" && svg.includes("<svg")) {
          out[cls] = svg;
        }
      }
    }
  } catch {
    // Fall back silently if worker is still starting
  }
  return out;
}

export interface CatalogComponentInfo {
  fqn: string;
  name: string;
  kind: string;
  packageName: string;
  subpackage: string;
  description?: string | undefined;
  language?: string | undefined;
  hasLiveIcon: boolean;
}

export async function getComponentCatalog(): Promise<CatalogComponentInfo[]> {
  try {
    const res = await (
      await lsp()
    ).sendRequest<{ components?: CatalogComponentInfo[] }>("modelscript/getComponentCatalog", {});
    return Array.isArray(res?.components) ? res.components : [];
  } catch {
    return [];
  }
}

export async function searchClasses(query: string, limit = 50): Promise<{ results: TreeNodeInfo[] }> {
  return (await lsp()).sendRequest("modelscript/searchClasses", { query, limit });
}

// ────────────────────────────────────────────────────────────────────
// CAD
// ────────────────────────────────────────────────────────────────────

export async function getCadComponents(
  uri: string,
  className?: string,
): Promise<
  {
    name: string;
    cad: string;
    dynamicBindings: { property: string; index: number; variable: string }[];
    shapeType?: string | undefined;
    defaults?: Record<string, unknown> | undefined;
    proceduralMesh?:
      | {
          vertices: number[];
          normals: number[];
          indices: number[];
          color?: [number, number, number, number] | undefined;
        }
      | undefined;
  }[]
> {
  return (await lsp()).sendRequest("modelscript/getCadComponents", { uri, className });
}

export interface DiagramPreviewRequestItem {
  id: string;
  className?: string | undefined;
  uri?: string | undefined;
  documentText?: string | undefined;
  languageId?: string | undefined;
  diagramType?: string | undefined;
}

export interface DiagramPreviewResultItem {
  svg: string;
  nodeCount: number;
  edgeCount: number;
}

export async function getDiagramPreviewSvgs(
  items: DiagramPreviewRequestItem[],
  isDark = false,
): Promise<Record<string, DiagramPreviewResultItem>> {
  if (!items.length) return {};
  try {
    const res = await (
      await lsp()
    ).sendRequest<{
      previews?: Record<string, DiagramPreviewResultItem>;
    }>("modelscript/getDiagramPreviewSvgs", { items, isDark });
    return res?.previews ?? {};
  } catch {
    return {};
  }
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

export interface MountedLibraryEntry {
  name: string;
  version: string;
  description?: string | undefined;
  language?: string | undefined;
  explicitlyInstalled?: boolean | undefined;
}

export async function getMountedLibraries(): Promise<{
  mounted: MountedLibraryEntry[];
  loading: Array<{ name: string; version: string; status?: string; message?: string }>;
}> {
  try {
    return await (await lsp()).sendRequest("modelscript/getMountedLibraries", {});
  } catch {
    return { mounted: [], loading: [] };
  }
}

export async function installDependency(name: string, version: string): Promise<MountedLibraryEntry[]> {
  const conn = await lsp();
  try {
    const res = await conn.sendRequest<{
      ok: boolean;
      name: string;
      version: string;
      mounted: MountedLibraryEntry[];
      error?: string;
    }>("modelscript/installPackage", { name, version });
    if (res && res.ok === false) {
      throw new Error(res.error || `Failed to mount ${name}@${version}`);
    }
    return res?.mounted ?? [];
  } catch (err) {
    // Only fall back to notification if request method itself was unrecognized
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("Method not found") || msg.includes("-32601")) {
      conn.sendNotification("modelscript/installDependency", { name, version });
      return [];
    }
    throw err;
  }
}

export async function uninstallDependency(name: string): Promise<MountedLibraryEntry[]> {
  const conn = await lsp();
  try {
    const res = await conn.sendRequest<{
      ok: boolean;
      evicted: number;
      mounted: MountedLibraryEntry[];
      error?: string;
    }>("modelscript/uninstallPackage", { name });
    if (res && res.ok === false) {
      throw new Error(res.error || `Failed to remove ${name}`);
    }
    return res?.mounted ?? [];
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("Method not found") || msg.includes("-32601")) {
      conn.sendNotification("modelscript/uninstallDependency", { name });
      return [];
    }
    throw err;
  }
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
 * Register an FMU archive (base64-encoded) in the active LSP workspace.
 */
export async function registerFmu(name: string, data: string): Promise<{ ok: boolean; error?: string }> {
  const conn = await lsp();
  try {
    return await conn.sendRequest<{ ok: boolean; error?: string }>("modelscript/registerFmu", { name, data });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
}

export interface LoadLibraryResult {
  packageName: string;
  fileCount: number;
}

/**
 * Load a library archive (.zip), FMU (.fmu), or Modelica/SysML source file from a Uint8Array
 * buffer into the active LSP workspace.
 *
 * Accepts either `(buffer, filename)` or `(filename, buffer)`.
 */
export async function loadLibraryFromBuffer(
  arg1: Uint8Array | ArrayBuffer | string,
  arg2: string | Uint8Array | ArrayBuffer,
): Promise<LoadLibraryResult> {
  let buffer: Uint8Array;
  let filename: string;

  if (typeof arg1 === "string") {
    filename = arg1;
    buffer = arg2 instanceof Uint8Array ? arg2 : new Uint8Array(arg2 as ArrayBuffer);
  } else {
    buffer = arg1 instanceof Uint8Array ? arg1 : new Uint8Array(arg1 as ArrayBuffer);
    filename = typeof arg2 === "string" ? arg2 : "UploadedLibrary";
  }

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
    return { packageName: cleanName, fileCount: 1 };
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
    return { packageName: pkgName, fileCount: keys.length };
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
  return { packageName: cleanName, fileCount: 1 };
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

export interface FlatSemanticEdit {
  action: "none" | "insert" | "delete" | "update" | "move";
  description: string;
  kind?: string | undefined;
  oldRange?:
    | {
        startLine: number;
        startCharacter: number;
        endLine: number;
        endCharacter: number;
      }
    | undefined;
  newRange?:
    | {
        startLine: number;
        startCharacter: number;
        endLine: number;
        endCharacter: number;
      }
    | undefined;
  regulatoryImpact?:
    | {
        isSafetyCritical: boolean;
        hazardId?: string | undefined;
        hazardName?: string | undefined;
        requirementId?: string | undefined;
        riskSeverity?: number | undefined;
        invalidatedLinks?:
          | {
              targetName: string;
              targetKind: string;
              reason: string;
            }[]
          | undefined;
      }
    | undefined;
}

/**
 * Computes an AST-level semantic diff using the native WebAssembly GLR parser and Salsa query engine
 * via the background LSP worker, returning precise character ranges and ISO 14971 regulatory impact.
 */
export async function getSemanticDiff(
  uri: string,
  oldText: string,
  newText: string,
): Promise<{ diffs: FlatSemanticEdit[] }> {
  const isSysml = uri.endsWith(".sysml") || uri.endsWith(".sysml2");
  const langId = isSysml ? "sysml2" : "modelica";
  const c = await lsp(langId);
  return c.sendRequest<{ diffs: FlatSemanticEdit[] }>("modelscript/getSemanticDiff", {
    uri,
    oldText,
    newText,
  });
}
