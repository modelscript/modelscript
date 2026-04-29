// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Unified Diagram API dispatch layer.
// Routes diagram requests to language-specific backends (Modelica / SysML2)
// based on the document URI. This replaces the per-method if-branching that
// was previously scattered across 12 handlers in browserServerMain.ts.

import type { ModelicaClassInstance } from "@modelscript/core";
import type { TextEdit } from "vscode-languageserver";
import { buildComponentProperties, buildDiagramData } from "./diagramData";
import {
  computeComponentInsert,
  computeComponentsDelete,
  computeConnectInsert,
  computeConnectRemove,
  computeDescriptionEdit,
  computeEdgePointEdits,
  computeNameEdit,
  computeParameterEdit,
  computePlacementEdits,
  deduplicateAndSort,
} from "./diagramEdits";
import type {
  ComponentPropertyData,
  DiagramApplyEditsParams,
  DiagramApplyEditsResult,
  DiagramData,
  DiagramGetComponentPropertiesParams,
  DiagramGetDataParams,
} from "./diagramProtocol.js";

// ── Backend Interface ──

/**
 * Language-specific diagram backend. Each language (Modelica, SysML2)
 * implements this interface to handle diagram data generation and editing.
 */
export interface DiagramBackend {
  /** Build diagram data for a class/document */
  getData(params: DiagramGetDataParams): DiagramData | null;

  /** Get component properties on-demand */
  getComponentProperties(params: DiagramGetComponentPropertiesParams): ComponentPropertyData | null;

  /** Apply a batch of edit actions, returning a unified result */
  applyEdits(params: DiagramApplyEditsParams): DiagramApplyEditsResult;
}

// ── Modelica Backend ──

export interface ModelicaBackendDeps {
  getDocumentInstances: (uri: string) => ModelicaClassInstance[] | undefined;
  getDocumentText: (uri: string) => string | undefined;
  resolveClassInstance: (uri: string, className?: string) => ModelicaClassInstance | null;
  flushValidation: (uri: string) => void;
}

export class ModelicaDiagramBackend implements DiagramBackend {
  constructor(private readonly deps: ModelicaBackendDeps) {}

  getData(params: DiagramGetDataParams): DiagramData | null {
    this.deps.flushValidation(params.uri);
    const classInstance = this.deps.resolveClassInstance(params.uri, params.className);
    if (!classInstance) return null;

    try {
      return buildDiagramData(classInstance);
    } catch (e: unknown) {
      console.error(`[diagram] Error building diagram data: ${e}`);
      return null;
    }
  }

  getComponentProperties(params: DiagramGetComponentPropertiesParams): ComponentPropertyData | null {
    const classInstance = this.deps.resolveClassInstance(params.uri, params.className);
    if (!classInstance) return null;

    try {
      return buildComponentProperties(classInstance, params.componentName);
    } catch (e: unknown) {
      console.error(`[diagram] Error building component properties: ${e}`);
      return null;
    }
  }

  applyEdits(params: DiagramApplyEditsParams): DiagramApplyEditsResult {
    this.deps.flushValidation(params.uri);
    const instances = this.deps.getDocumentInstances(params.uri);
    const docText = this.deps.getDocumentText(params.uri);
    if (!instances?.[0] || !docText) {
      return { seq: params.seq, edits: [], renderHint: "none" };
    }

    return processDiagramEditBatch(params, instances[0], docText);
  }
}

// ── SysML2 Backend ──

export interface SysML2BackendDeps {
  getDocumentText: (uri: string) => string | undefined;
  getLayout: (uri: string) => import("./sysml2-layout").SysML2Layout | undefined;
  setLayout: (uri: string, layout: import("./sysml2-layout").SysML2Layout) => void;
  createEmptyLayout: () => import("./sysml2-layout").SysML2Layout;
  updateElementPositions: (
    layout: import("./sysml2-layout").SysML2Layout,
    items: { name: string; x: number; y: number; width: number; height: number; rotation?: number }[],
  ) => import("./sysml2-layout").SysML2Layout;
  updateConnectionVertices: (
    layout: import("./sysml2-layout").SysML2Layout,
    updates: { id: string; vertices: { x: number; y: number }[] }[],
  ) => import("./sysml2-layout").SysML2Layout;
  removeElements: (
    layout: import("./sysml2-layout").SysML2Layout,
    names: string[],
  ) => import("./sysml2-layout").SysML2Layout;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  buildDiagramData: (params: DiagramGetDataParams) => any;
  getSysML2Parser: () => { parse: (text: string) => unknown } | null;
  computeConnectionInsert: (text: string, source: string, target: string) => TextEdit[];
  computeConnectionDelete: (text: string, source: string, target: string) => TextEdit[];
  computeElementDelete: (text: string, names: string[]) => TextEdit[];
  computeNameEdit: (tree: unknown, text: string, oldName: string, newName: string) => TextEdit[];
  computeDescriptionEdit: (tree: unknown, text: string, name: string, desc: string) => TextEdit[];
  computeParameterEdit: (tree: unknown, text: string, name: string, param: string, value: string) => TextEdit[];
}

export class SysML2DiagramBackend implements DiagramBackend {
  constructor(private readonly deps: SysML2BackendDeps) {}

  getData(params: DiagramGetDataParams): DiagramData | null {
    return this.deps.buildDiagramData(params);
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  getComponentProperties(params: DiagramGetComponentPropertiesParams): ComponentPropertyData | null {
    // SysML2 doesn't have on-demand component properties yet
    return null;
  }

  applyEdits(params: DiagramApplyEditsParams): DiagramApplyEditsResult {
    const docText = this.deps.getDocumentText(params.uri);
    if (!docText) return { seq: params.seq, edits: [], renderHint: "none" };

    const allEdits: TextEdit[] = [];
    let needsRender: "none" | "immediate" | "debounced" = "none";
    let layout = this.deps.getLayout(params.uri) ?? this.deps.createEmptyLayout();

    try {
      for (const action of params.actions) {
        switch (action.type) {
          case "move":
            layout = this.deps.updateElementPositions(layout, action.items);
            if (action.items.some((i) => i.edges)) {
              const edgeUpdates: { id: string; vertices: { x: number; y: number }[] }[] = [];
              for (const i of action.items) {
                if (i.edges) {
                  for (const e of i.edges) edgeUpdates.push({ id: `${e.source}→${e.target}`, vertices: e.points });
                }
              }
              if (edgeUpdates.length > 0) layout = this.deps.updateConnectionVertices(layout, edgeUpdates);
            }
            break;
          case "resize":
          case "rotate":
            layout = this.deps.updateElementPositions(layout, [action.item]);
            break;
          case "connect":
            allEdits.push(...this.deps.computeConnectionInsert(docText, action.source, action.target));
            if (action.points && action.points.length > 0) {
              layout = this.deps.updateConnectionVertices(layout, [
                { id: `${action.source}→${action.target}`, vertices: action.points },
              ]);
            }
            needsRender = "immediate";
            break;
          case "disconnect":
            allEdits.push(...this.deps.computeConnectionDelete(docText, action.source, action.target));
            needsRender = "immediate";
            break;
          case "moveEdge":
            layout = this.deps.updateConnectionVertices(
              layout,
              action.edges.map((e) => ({ id: `${e.source}→${e.target}`, vertices: e.points })),
            );
            break;
          case "deleteComponents":
            allEdits.push(...this.deps.computeElementDelete(docText, action.names));
            layout = this.deps.removeElements(layout, action.names);
            needsRender = "immediate";
            break;
          case "updateName": {
            const parser = this.deps.getSysML2Parser();
            if (parser) {
              const tree = parser.parse(docText);
              allEdits.push(...this.deps.computeNameEdit(tree, docText, action.oldName, action.newName));
            }
            needsRender = "debounced";
            break;
          }
          case "updateDescription": {
            const parser = this.deps.getSysML2Parser();
            if (parser) {
              const tree = parser.parse(docText);
              allEdits.push(...this.deps.computeDescriptionEdit(tree, docText, action.name, action.description));
            }
            needsRender = "debounced";
            break;
          }
          case "updateParameter": {
            const parser = this.deps.getSysML2Parser();
            if (parser) {
              const tree = parser.parse(docText);
              allEdits.push(
                ...this.deps.computeParameterEdit(tree, docText, action.name, action.parameter, action.value),
              );
            }
            needsRender = "debounced";
            break;
          }
          case "addComponent":
            // SysML2 addComponent is handled separately via computeSysML2ElementInsert
            break;
        }
      }
      this.deps.setLayout(params.uri, layout);
    } catch (e) {
      console.error("[sysml2-diagram] diagramEdit error:", e);
    }

    return {
      seq: params.seq,
      edits: deduplicateAndSort(allEdits),
      renderHint: needsRender,
    };
  }
}

// ── Dispatch Factory ──

export interface DiagramDispatchDeps {
  modelica: DiagramBackend;
  sysml2: DiagramBackend;
}

/**
 * Creates a dispatch object that routes diagram requests to the
 * appropriate language backend based on the document URI.
 */
export function createDiagramDispatch(backends: DiagramDispatchDeps) {
  function getBackend(uri: string): DiagramBackend {
    return uri.endsWith(".sysml") ? backends.sysml2 : backends.modelica;
  }

  return {
    getData(params: DiagramGetDataParams): DiagramData | null {
      return getBackend(params.uri).getData(params);
    },

    getComponentProperties(params: DiagramGetComponentPropertiesParams): ComponentPropertyData | null {
      return getBackend(params.uri).getComponentProperties(params);
    },

    applyEdits(params: DiagramApplyEditsParams): DiagramApplyEditsResult {
      return getBackend(params.uri).applyEdits(params);
    },
  };
}

// ── Modelica Batch Processor (preserved for backward compat) ──

export function processDiagramEditBatch(
  request: DiagramApplyEditsParams,
  classInstance: ModelicaClassInstance,
  docText: string,
): DiagramApplyEditsResult {
  const allEdits: TextEdit[] = [];
  let needsRender: "none" | "immediate" | "debounced" = "none";

  for (const action of request.actions) {
    switch (action.type) {
      case "move":
        allEdits.push(...computePlacementEdits(docText, classInstance, action.items));
        if (needsRender === "none") needsRender = "none"; // spatial
        break;
      case "resize":
      case "rotate":
        allEdits.push(...computePlacementEdits(docText, classInstance, [action.item]));
        if (needsRender === "none") needsRender = "none"; // spatial
        break;
      case "moveEdge":
        {
          const lines = docText.split("\n");
          allEdits.push(...computeEdgePointEdits(lines, classInstance, action.edges));
        }
        if (needsRender === "none") needsRender = "none"; // spatial
        break;
      case "connect":
        allEdits.push(...computeConnectInsert(docText, classInstance, action.source, action.target, action.points));
        needsRender = "immediate";
        break;
      case "disconnect":
        allEdits.push(...computeConnectRemove(docText, classInstance, action.source, action.target));
        needsRender = "immediate";
        break;
      case "addComponent":
        allEdits.push(
          ...computeComponentInsert(
            classInstance,
            action.className,
            action.className.split(".").pop() || "comp",
            action.x,
            action.y,
            docText,
          ),
        );
        needsRender = "immediate";
        break;
      case "deleteComponents":
        allEdits.push(...computeComponentsDelete(docText, classInstance, action.names));
        needsRender = "immediate";
        break;
      case "updateName":
        allEdits.push(...computeNameEdit(classInstance, action.oldName, action.newName));
        needsRender = "debounced";
        break;
      case "updateDescription":
        allEdits.push(...computeDescriptionEdit(docText, classInstance, action.name, action.description));
        needsRender = "debounced";
        break;
      case "updateParameter":
        allEdits.push(...computeParameterEdit(classInstance, action.name, action.parameter, action.value));
        needsRender = "debounced";
        break;
    }
  }

  return {
    seq: request.seq,
    edits: deduplicateAndSort(allEdits),
    renderHint: needsRender,
  };
}
