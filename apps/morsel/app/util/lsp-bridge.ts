// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Typed wrappers around every custom `modelscript/*` LSP request that
 * Morsel needs. Each function is a thin async call through the protocol
 * connection established by `lsp-worker.ts`.
 */

import type { ProtocolConnection } from "vscode-languageserver-protocol/browser";
import { getLsp } from "./lsp-worker";

// ────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────

function lsp(): ProtocolConnection {
  const c = getLsp();
  if (!c) throw new Error("LSP not started — call startLsp() first");
  return c;
}

/** Version counter for incremental didChange notifications. */
const versions = new Map<string, number>();

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
  lsp().sendNotification("textDocument/didOpen", {
    textDocument: { uri, languageId, version: nextVersion(uri), text },
  });
}

/** Notify the LSP that the full content of a document changed. */
export function didChange(uri: string, text: string): void {
  lsp().sendNotification("textDocument/didChange", {
    textDocument: { uri, version: nextVersion(uri) },
    contentChanges: [{ text }],
  });
}

/** Notify the LSP that a document was closed. */
export function didClose(uri: string): void {
  lsp().sendNotification("textDocument/didClose", {
    textDocument: { uri },
  });
  versions.delete(uri);
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

export interface PlacementItem {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  edges?: { source: string; target: string; points: { x: number; y: number }[] }[];
}

export interface EdgeUpdate {
  source: string;
  target: string;
  points: { x: number; y: number }[];
}

export interface DiagramPort {
  id: string;
  group: string;
  x?: number;
  y?: number;
}

export interface DiagramNode {
  id: string;
  label?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  angle?: number;
  rotation?: number;
  zIndex?: number;
  opacity?: number;
  markup?: any;
  iconSvg?: string;
  classKind?: string;
  className?: string;
  description?: string;
  ports?: { items: DiagramPort[] };
  autoLayout?: boolean;
  properties?: any;
}

export interface DiagramEdge {
  id: string;
  source: { cell: string; port: string };
  target: { cell: string; port: string };
  vertices?: { x: number; y: number }[];
  zIndex?: number;
  connector?: any;
  attrs?: any;
}

export interface DiagramData {
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  coordinateSystem: { x: number; y: number; width: number; height: number };
  diagramBackground?: any;
}

export interface SimulateParams {
  className?: string;
  startTime?: number;
  stopTime?: number;
  interval?: number;
  equidistant?: boolean;
  solver?: string;
  format?: string;
  parameterOverrides?: Record<string, number>;
}

export interface SimulateResult {
  t: number[];
  y: number[][];
  states: string[];
  parameters?: {
    name: string;
    type: "real" | "integer" | "boolean" | "enumeration";
    defaultValue: number;
    min?: number;
    max?: number;
    step: number;
    unit?: string;
    enumLiterals?: { ordinal: number; label: string }[];
  }[];
  experiment?: { startTime?: number; stopTime?: number; interval?: number; tolerance?: number };
  error?: string;
}

export interface TreeNodeInfo {
  id: string;
  name: string;
  compositeName?: string;
  localizedName?: string;
  classKind?: string;
  hasChildren: boolean;
  iconSvg?: string | null;
}

export interface PropertyData {
  name: string;
  localizedName?: string;
  localizedDescription?: string;
  value: string;
  defaultValue: string;
  unit?: string;
  isBoolean?: boolean;
}

export interface ComponentProperties {
  name: string;
  className: string;
  localizedClassName: string;
  description: string;
  iconSvg?: string | null;
  parameters: PropertyData[];
  documentation?: { info?: string; revisions?: string };
}

// ────────────────────────────────────────────────────────────────────
// Diagram — Unified API
// ────────────────────────────────────────────────────────────────────

/** Method constants matching the unified Diagram API protocol */
export const DiagramMethods = {
  getData: "modelscript/diagram.getData",
  applyEdits: "modelscript/diagram.applyEdits",
  getComponentProperties: "modelscript/diagram.getComponentProperties",
} as const;

/** Union of all diagram edit actions supported by the batch API */
export type DiagramEditAction =
  | { type: "move"; items: PlacementItem[] }
  | { type: "resize"; item: PlacementItem }
  | { type: "rotate"; item: PlacementItem }
  | { type: "connect"; source: string; target: string; points?: { x: number; y: number }[] }
  | { type: "disconnect"; source: string; target: string }
  | { type: "moveEdge"; edges: EdgeUpdate[] }
  | { type: "addComponent"; className: string; x: number; y: number }
  | { type: "deleteComponents"; names: string[] }
  | { type: "updateName"; oldName: string; newName: string }
  | { type: "updateDescription"; name: string; description: string }
  | { type: "updateParameter"; name: string; parameter: string; value: string };

export interface DiagramApplyEditsResult {
  seq: number;
  edits: LspTextEdit[];
  renderHint: "none" | "immediate" | "debounced";
}

/** Apply a batch of diagram edit actions atomically via the unified API */
export async function applyDiagramEdits(
  uri: string,
  actions: DiagramEditAction[],
  seq = 1,
): Promise<DiagramApplyEditsResult> {
  return lsp().sendRequest(DiagramMethods.applyEdits, { uri, seq, actions });
}

export async function getDiagramData(
  uri: string,
  className?: string,
  diagramType?: string,
): Promise<DiagramData | null> {
  return lsp().sendRequest(DiagramMethods.getData, { uri, className, diagramType });
}

/** @deprecated Use applyDiagramEdits instead */
export async function updatePlacement(uri: string, items: PlacementItem[]): Promise<LspTextEdit[]> {
  return lsp().sendRequest("modelscript/updatePlacement", { uri, items });
}

/** @deprecated Use applyDiagramEdits instead */
export async function sendDiagramEdit(request: any): Promise<any> {
  return lsp().sendRequest(DiagramMethods.applyEdits, request);
}

export async function addConnect(
  uri: string,
  source: string,
  target: string,
  points?: { x: number; y: number }[],
): Promise<LspTextEdit[]> {
  return lsp().sendRequest("modelscript/addConnect", { uri, source, target, points });
}

export async function removeConnect(uri: string, source: string, target: string): Promise<LspTextEdit[]> {
  return lsp().sendRequest("modelscript/removeConnect", { uri, source, target });
}

export async function updateEdgePoints(uri: string, edges: EdgeUpdate[]): Promise<LspTextEdit[]> {
  return lsp().sendRequest("modelscript/updateEdgePoints", { uri, edges });
}

export async function addComponent(uri: string, className: string, x: number, y: number): Promise<LspTextEdit[]> {
  return lsp().sendRequest("modelscript/addComponent", { uri, className, x, y });
}

export async function deleteComponents(uri: string, names: string[]): Promise<LspTextEdit[]> {
  return lsp().sendRequest("modelscript/deleteComponents", { uri, names });
}

export async function updateComponentName(uri: string, oldName: string, newName: string): Promise<LspTextEdit[]> {
  return lsp().sendRequest("modelscript/updateComponentName", { uri, oldName, newName });
}

export async function updateComponentDescription(
  uri: string,
  name: string,
  description: string,
): Promise<LspTextEdit[]> {
  return lsp().sendRequest("modelscript/updateComponentDescription", { uri, name, description });
}

export async function updateComponentParameter(
  uri: string,
  name: string,
  parameter: string,
  value: string,
): Promise<LspTextEdit[]> {
  return lsp().sendRequest("modelscript/updateComponentParameter", { uri, name, parameter, value });
}

export async function getComponentProperties(
  uri: string,
  className: string,
  componentName: string,
): Promise<ComponentProperties | null> {
  return lsp().sendRequest(DiagramMethods.getComponentProperties, { uri, className, componentName });
}

// ────────────────────────────────────────────────────────────────────
// Simulation
// ────────────────────────────────────────────────────────────────────

export async function simulate(uri: string, params: SimulateParams = {}): Promise<SimulateResult> {
  return lsp().sendRequest("modelscript/simulate", { uri, ...params });
}

// ────────────────────────────────────────────────────────────────────
// Flatten
// ────────────────────────────────────────────────────────────────────

export async function flatten(name: string, uri?: string): Promise<{ text: string | null; error?: string }> {
  return lsp().sendRequest("modelscript/flatten", { name, uri });
}

// ────────────────────────────────────────────────────────────────────
// Library tree
// ────────────────────────────────────────────────────────────────────

export async function getLibraryTree(uri: string, parentId?: string): Promise<TreeNodeInfo[]> {
  return lsp().sendRequest("modelscript/getLibraryTree", { uri, parentId });
}

export async function getClassSource(className: string): Promise<{ content: string | null; error?: string }> {
  return lsp().sendRequest("modelscript/getClassSource", { className });
}

export async function getClassIcon(className: string, uri?: string): Promise<string | null> {
  return lsp().sendRequest("modelscript/getClassIcon", { className, uri });
}

export async function searchClasses(query: string, limit = 50): Promise<{ results: TreeNodeInfo[] }> {
  return lsp().sendRequest("modelscript/searchClasses", { query, limit });
}

// ────────────────────────────────────────────────────────────────────
// CAD
// ────────────────────────────────────────────────────────────────────

export async function getCadComponents(
  uri: string,
): Promise<{ name: string; cad: string; dynamicBindings: { property: string; index: number; variable: string }[] }[]> {
  return lsp().sendRequest("modelscript/getCadComponents", { uri });
}

// ────────────────────────────────────────────────────────────────────
// List classes (for model tabs)
// ────────────────────────────────────────────────────────────────────

export async function listClasses(): Promise<{
  classes: { name: string; kind: string; uri: string }[];
}> {
  return lsp().sendRequest("modelscript/listClasses", {});
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
