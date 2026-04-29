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
} from "@modelscript/lsp/src/diagramProtocol";
import type { ProtocolConnection } from "vscode-languageserver-protocol/browser";
import { getLsp } from "./lsp-worker";

export type { DiagramApplyEditsResult, DiagramData, DiagramEdge, DiagramEditAction, DiagramNode, DiagramPort };

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
  return lsp().sendRequest(DiagramMethods.applyEdits, { uri, seq, actions });
}

export async function getDiagramData(
  uri: string,
  className?: string,
  diagramType?: string,
): Promise<DiagramData | null> {
  return lsp().sendRequest(DiagramMethods.getData, { uri, className, diagramType });
}

export async function getComponentProperties(
  uri: string,
  className: string,
  componentName: string,
): Promise<ComponentPropertyData | null> {
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
