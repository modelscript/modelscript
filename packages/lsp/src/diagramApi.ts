// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  createOpenDriveDiagramBackend,
  createPscadDiagramBackend,
  createSimulinkDiagramBackend,
  createSpiceDiagramBackend,
  createSspDiagramBackend,
} from "./diagrams/index.js";
//
// Unified Diagram API dispatch layer.
// Routes diagram requests to language-specific backends (Modelica / SysML2)
// based on the document URI. This replaces the per-method if-branching that
// was previously scattered across 12 handlers in browserServerMain.ts.

import { buildDiagramFromDSL, buildPolyglotDiagram } from "@modelscript/diagram/builder";
import type { FileSystemBridge } from "@modelscript/diagram/fs-bridge";
import { SidecarLayoutStorage, parseLayout } from "@modelscript/diagram/layout-storage";
import { compileDiagramConfigToPolyglot } from "@modelscript/dsl";
import {
  buildOWL2DiagramData,
  computeOWL2ConnectionDelete,
  computeOWL2ConnectionInsert,
  computeOWL2ElementDelete,
  computeOWL2ElementInsert,
  computeOWL2NameEdit,
} from "@modelscript/owl2/diagram";
import type { TextEdit } from "vscode-languageserver";
import type {
  ComponentPropertyData,
  DiagramApplyEditsParams,
  DiagramApplyEditsResult,
  DiagramData,
  DiagramDrillDownParams,
  DiagramDrillDownResult,
  DiagramGetComponentPropertiesParams,
  DiagramGetDataParams,
  DiagramGetPaletteParams,
  DiagramPalette,
  EntityPropertySchema,
  PlacementItem,
  PropertyFieldConfig,
  PropertyGroupConfig,
  PropertyTabConfig,
} from "./diagramProtocol.js";
import { globalLanguageRegistry } from "./registry/LanguageRegistry.js";

function getModelicaDiagramOps(): any {
  return (globalThis as any).modelicaDiagramOps ?? {};
}

export function deduplicateAndSort(edits: TextEdit[]): TextEdit[] {
  edits.sort((a, b) => {
    if (a.range.start.line !== b.range.start.line) return a.range.start.line - b.range.start.line;
    if (a.range.start.character !== b.range.start.character) return a.range.start.character - b.range.start.character;
    if (a.range.end.line !== b.range.end.line) return a.range.end.line - b.range.end.line;
    return a.range.end.character - b.range.end.character;
  });

  const accepted: TextEdit[] = [];
  for (const edit of edits) {
    if (accepted.length === 0) {
      accepted.push(edit);
      continue;
    }
    const prev = accepted[accepted.length - 1]!;
    const isPrevInsert =
      prev.range.start.line === prev.range.end.line && prev.range.start.character === prev.range.end.character;
    const isCurrInsert =
      edit.range.start.line === edit.range.end.line && edit.range.start.character === edit.range.end.character;

    if (
      edit.range.start.line < prev.range.end.line ||
      (edit.range.start.line === prev.range.end.line && edit.range.start.character < prev.range.end.character)
    ) {
      continue;
    }
    if (
      !isPrevInsert &&
      !isCurrInsert &&
      edit.range.start.line === prev.range.start.line &&
      edit.range.start.character === prev.range.start.character
    ) {
      continue;
    }
    if (
      isPrevInsert &&
      isCurrInsert &&
      edit.range.start.line === prev.range.start.line &&
      edit.range.start.character === prev.range.start.character &&
      edit.newText === prev.newText
    ) {
      continue;
    }
    accepted.push(edit);
  }
  return accepted;
}

// ── Backend Interface ──

/**
 * Language-specific diagram backend. Each language (Modelica, SysML2)
 * implements this interface to handle diagram data generation and editing.
 */
export interface DiagramBackend {
  /** Build diagram data for a class/document */
  getData(params: DiagramGetDataParams): Promise<DiagramData | null> | DiagramData | null;

  /** Get component properties on-demand */
  getComponentProperties(
    params: DiagramGetComponentPropertiesParams,
  ): Promise<ComponentPropertyData | null> | ComponentPropertyData | null;

  /** Apply a batch of edit actions, returning a unified result */
  applyEdits(params: DiagramApplyEditsParams): Promise<DiagramApplyEditsResult> | DiagramApplyEditsResult;

  /** Stencil palette items for the palette panel */
  getPalette?(params: DiagramGetPaletteParams): Promise<DiagramPalette | null> | DiagramPalette | null;

  /** Drill-down navigation into sub-diagram */
  drillDown?(params: DiagramDrillDownParams): Promise<DiagramDrillDownResult | null> | DiagramDrillDownResult | null;
}

// ── Modelica Backend ──

export interface ModelicaBackendDeps {
  getDocumentInstances: (uri: string) => any[] | undefined;
  getDocumentText: (uri: string) => string | undefined;

  resolveClassInstance: (uri: string, className?: string) => any | null;
  flushValidation: (uri: string) => Promise<void>;
  isDocumentStale?: (uri: string) => boolean;
}

export class ModelicaDiagramBackend implements DiagramBackend {
  constructor(private readonly deps: ModelicaBackendDeps) {}

  async getData(params: DiagramGetDataParams): Promise<DiagramData | null> {
    const classInstance = this.deps.resolveClassInstance(params.uri, params.className);
    if (!classInstance) return null;

    try {
      const ops = getModelicaDiagramOps();
      return ops.buildDiagramData ? await ops.buildDiagramData(classInstance) : null;
    } catch (e: unknown) {
      console.error(`[diagram] Error building diagram data: ${e}`);
      return null;
    }
  }

  getComponentProperties(params: DiagramGetComponentPropertiesParams): ComponentPropertyData | null {
    const classInstance = this.deps.resolveClassInstance(params.uri, params.className);
    if (!classInstance) return null;

    try {
      const ops = getModelicaDiagramOps();
      return ops.buildComponentProperties ? ops.buildComponentProperties(classInstance, params.componentName) : null;
    } catch (e: unknown) {
      console.error(`[diagram] Error building component properties: ${e}`);
      return null;
    }
  }

  private resolveTargetInstance(
    uri: string,
    className: string | undefined,
    instances: any[] | undefined,
    docText: string,
  ): any | null {
    if (className) {
      const simpleName = className.split(".").pop()!;
      const matched =
        instances?.find(
          (inst: any) =>
            inst?.compositeName === className ||
            inst?.name === className ||
            inst?.compositeName?.endsWith(`.${className}`) ||
            inst?.name === simpleName,
        ) ?? this.deps.resolveClassInstance(uri, className);
      if (matched) return matched;
    }

    const primary = instances?.[0] ?? this.deps.resolveClassInstance(uri);
    if (primary) return primary;

    const ops = getModelicaDiagramOps();
    if (typeof ops.buildFallbackClassInstance === "function") {
      return ops.buildFallbackClassInstance(docText, className);
    }
    return null;
  }

  async applyEdits(params: DiagramApplyEditsParams): Promise<DiagramApplyEditsResult> {
    let instances = this.deps.getDocumentInstances(params.uri);
    let docText = this.deps.getDocumentText(params.uri);

    // Flush validation synchronously if instances are not yet available or if the indexed CST is stale
    if (!instances?.[0] || !docText || this.deps.isDocumentStale?.(params.uri)) {
      await this.deps.flushValidation(params.uri);
      instances = this.deps.getDocumentInstances(params.uri);
      docText = this.deps.getDocumentText(params.uri);
    }

    if (!docText) {
      return { seq: params.seq, edits: [], renderHint: "none" };
    }

    let targetInstance = this.resolveTargetInstance(params.uri, params.className, instances, docText);
    if (!targetInstance) {
      const currentText = docText ?? "";
      const strippedText = currentText.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, "").trim();
      const addActions = params.actions.filter((a) => a.type === "addComponent");
      if (strippedText.length === 0 && addActions.length > 0) {
        const cleanUri = params.uri.split(/[?#]/)[0] ?? "";
        const baseFile =
          cleanUri
            .split(/[/\\]/)
            .pop()
            ?.replace(/\.[^.]+$/, "") ?? "";
        const modelName = /^[A-Za-z_][A-Za-z0-9_]*$/.test(baseFile) ? baseFile : "Model1";
        const usedNames = new Set<string>();
        const declLines: string[] = [];
        for (const act of addActions) {
          if (act.type !== "addComponent") continue;
          const rawClass = act.className ?? "";
          if (
            !rawClass ||
            rawClass.startsWith("__LOADING__:") ||
            rawClass.startsWith("__ONTOLOGY__:") ||
            (rawClass.startsWith("__LIB__:") && !rawClass.includes("/") && !rawClass.includes("."))
          ) {
            continue;
          }
          const cleanClass = rawClass.replace(/^__LIB__:[^/]+\//, "").replace(/^__LIB__:/, "");
          const baseName = (cleanClass.split(".").pop() || "comp").replace(/[^A-Za-z0-9_]/g, "") || "comp";
          let uniqueName = act.name || `${baseName}1`;
          let idx = 1;
          if (!act.name) {
            while (usedNames.has(uniqueName)) {
              idx++;
              uniqueName = `${baseName}${idx}`;
            }
          }
          usedNames.add(uniqueName);
          const ox = Math.round(act.x ?? 0);
          const oy = -Math.round(act.y ?? 0);
          declLines.push(
            `  ${cleanClass} ${uniqueName} annotation(Placement(transformation(origin={${ox},${oy}}, extent={{-10,-10},{10,10}})));`,
          );
        }
        if (declLines.length > 0) {
          const lines = currentText.split("\n");
          const endLine = Math.max(0, lines.length - 1);
          const endChar = lines[endLine]?.length ?? 0;
          const prefix = currentText.length > 0 && !currentText.endsWith("\n") ? `${currentText}\n` : currentText;
          const newText = `${prefix}model ${modelName}\n${declLines.join("\n")}\nend ${modelName};\n`;
          return {
            seq: params.seq,
            edits: [
              {
                range: {
                  start: { line: 0, character: 0 },
                  end: { line: endLine, character: endChar },
                },
                newText,
              },
            ],
            renderHint: "immediate",
          };
        }
      }
      return { seq: params.seq, edits: [], renderHint: "none" };
    }

    let result = processDiagramEditBatch(params, targetInstance, docText);

    // If no edits could be produced (e.g. stale AST where component ranges no longer match),
    // flush validation once to synchronize AST and retry.
    if (
      result.edits.length === 0 &&
      params.actions.some(
        (a) =>
          a.type === "move" ||
          a.type === "resize" ||
          a.type === "rotate" ||
          a.type === "moveEdge" ||
          a.type === "updateParameter" ||
          a.type === "updateProperty" ||
          a.type === "updateName" ||
          a.type === "updateDescription",
      )
    ) {
      await this.deps.flushValidation(params.uri);
      const freshInstances = this.deps.getDocumentInstances(params.uri);
      const freshDocText = this.deps.getDocumentText(params.uri);
      if (freshDocText) {
        const freshTarget = this.resolveTargetInstance(params.uri, params.className, freshInstances, freshDocText);
        if (freshTarget) {
          result = processDiagramEditBatch(params, freshTarget, freshDocText);
        }
      }
    }

    return result;
  }

  async drillDown(params: DiagramDrillDownParams): Promise<DiagramDrillDownResult | null> {
    const targetName = params.className || params.componentName;
    if (!targetName) return null;
    const classInstance = this.deps.resolveClassInstance(params.uri, targetName);
    if (!classInstance) return null;
    const ops = getModelicaDiagramOps();
    const childData = ops.buildDiagramData ? await ops.buildDiagramData(classInstance) : null;
    return {
      targetUri: params.uri,
      targetClassName: targetName,
      breadcrumbs: [
        { id: "root", label: "Root", uri: params.uri },
        { id: params.nodeId || targetName, label: targetName, uri: params.uri },
      ],
      data: childData ?? undefined,
    };
  }
}

// ── SysML2 Backend ──

export interface SysML2BackendDeps {
  getDocumentText: (uri: string) => string | undefined;
  getLayout: (uri: string) => any;
  setLayout: (uri: string, layout: any) => void;
  createEmptyLayout: () => any;
  updateElementPositions: (
    layout: any,
    items: { name: string; x: number; y: number; width: number; height: number; rotation?: number | undefined }[],
  ) => any;
  updateConnectionVertices: (layout: any, updates: { id: string; vertices: { x: number; y: number }[] }[]) => any;
  removeElements: (layout: any, names: string[]) => any;
  renameElement?: ((layout: any, oldName: string, newName: string) => any) | undefined;
  serializeLayout?: ((layout: any) => string) | undefined;
  parseLayout?: ((text: string) => any) | undefined;
  getSidecarUri?: ((uri: string) => string) | undefined;

  buildDiagramData: (params: DiagramGetDataParams) => any;
  getSysML2Parser: () => { parse: (text: string) => unknown } | null;
  computeConnectionInsert: (text: string, source: string, target: string, tree?: unknown) => TextEdit[];
  computeConnectionDelete: (text: string, source: string, target: string, tree?: unknown) => TextEdit[];
  computeElementInsert: (
    text: string,
    elementType: string,
    name: string,
    insertionLine?: number,
    tree?: unknown,
  ) => TextEdit[];
  computeElementDelete: (text: string, names: string[], tree?: unknown) => TextEdit[];
  generateUniqueName: (text: string, baseName: string) => string;
  computeNameEdit: (tree: unknown, text: string, oldName: string, newName: string) => TextEdit[];
  computeDescriptionEdit: (tree: unknown, text: string, name: string, desc: string) => TextEdit[];
  computeParameterEdit: (tree: unknown, text: string, name: string, param: string, value: string) => TextEdit[];
  /** Query symbol data from the unified index for the component properties panel. */
  getSymbolData?:
    | ((
        uri: string,
        componentName: string,
      ) => {
        ruleName: string;
        name: string;
        description?: string | undefined;
        children?:
          | {
              name: string;
              ruleName: string;
              value?: string | undefined;
              description?: string | undefined;
              direction?: string | undefined;
            }[]
          | undefined;
      } | null)
    | undefined;
}

export class SysML2DiagramBackend implements DiagramBackend {
  constructor(private readonly deps: SysML2BackendDeps) {}

  getData(params: DiagramGetDataParams): DiagramData | null {
    return this.deps.buildDiagramData(params);
  }

  getComponentProperties(params: DiagramGetComponentPropertiesParams): ComponentPropertyData | null {
    if (!this.deps.getSymbolData) return null;
    const data = this.deps.getSymbolData(params.uri, params.componentName);
    if (!data) return null;

    // Build parameters from child attribute/usage entries
    const parameters: ComponentPropertyData["parameters"] = [];
    const attrFields: PropertyFieldConfig[] = [];
    const portFields: PropertyFieldConfig[] = [];
    const values: Record<string, any> = {
      name: data.name,
      description: data.description ?? "",
    };

    if (data.children) {
      for (const child of data.children) {
        const isPort = child.ruleName.includes("Port");
        const isAttr = child.ruleName.includes("Attribute");
        const isUsage = child.ruleName.includes("Usage");

        if (isPort || isAttr || isUsage) {
          const val = child.value ?? "";
          parameters.push({
            name: child.name,
            value: val,
            description: child.description,
            group: isPort ? "Ports" : "Attributes",
            tab: isPort ? "Ports" : "General",
          });
          values[child.name] = val;

          const field: PropertyFieldConfig = {
            key: child.name,
            label: child.name,
            kind: isPort ? "typeReference" : "expression",
            description: child.description,
            defaultValue: val,
          };

          if (isPort) {
            portFields.push(field);
          } else {
            attrFields.push(field);
          }
        }
      }
    }

    const generalGroups: PropertyGroupConfig[] = [
      {
        id: "identification",
        label: "Identification",
        fields: [
          { key: "name", label: "Name", kind: "string", defaultValue: data.name },
          {
            key: "type",
            label: "Type",
            kind: "string",
            defaultValue: data.ruleName.replace(/(Definition|Usage)$/, ""),
            readOnly: true,
          },
        ],
      },
    ];

    if (attrFields.length > 0) {
      generalGroups.push({
        id: "attributes",
        label: "Attributes",
        fields: attrFields,
      });
    }

    const tabs: PropertyTabConfig[] = [
      {
        id: "general",
        label: "General",
        groups: generalGroups,
      },
    ];

    if (portFields.length > 0) {
      tabs.push({
        id: "ports",
        label: "Ports",
        groups: [
          {
            id: "ports-group",
            label: "Directed Ports",
            fields: portFields,
          },
        ],
      });
    }

    const schema: EntityPropertySchema = {
      title: `${data.name} : ${data.ruleName.replace(/(Definition|Usage)$/, "")}`,
      tabs,
    };

    return {
      className: data.ruleName.replace(/(Definition|Usage)$/, ""),
      name: data.name,
      description: data.description ?? "",
      parameters,
      schema,
      values,
    };
  }

  applyEdits(params: DiagramApplyEditsParams): DiagramApplyEditsResult {
    const docText = this.deps.getDocumentText(params.uri);
    if (!docText) return { seq: params.seq, edits: [], renderHint: "none" };

    const allEdits: TextEdit[] = [];
    let needsRender: "none" | "immediate" | "debounced" = "none";
    let layout = this.deps.getLayout(params.uri) ?? this.deps.createEmptyLayout();

    const parser = this.deps.getSysML2Parser ? this.deps.getSysML2Parser() : null;
    let tree: any = null;
    if (parser && typeof parser.parse === "function") {
      try {
        tree = parser.parse(docText);
      } catch {
        // Fallback to heuristic editing if parse fails
      }
    }

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
            allEdits.push(...this.deps.computeConnectionInsert(docText, action.source, action.target, tree));
            if (action.points && action.points.length > 0) {
              layout = this.deps.updateConnectionVertices(layout, [
                { id: `${action.source}→${action.target}`, vertices: action.points },
              ]);
            }
            needsRender = "immediate";
            break;
          case "disconnect":
            allEdits.push(...this.deps.computeConnectionDelete(docText, action.source, action.target, tree));
            needsRender = "immediate";
            break;
          case "reconnect":
            allEdits.push(...this.deps.computeConnectionDelete(docText, action.oldSource, action.oldTarget, tree));
            allEdits.push(...this.deps.computeConnectionInsert(docText, action.newSource, action.newTarget, tree));
            needsRender = "immediate";
            break;
          case "moveEdge":
            layout = this.deps.updateConnectionVertices(
              layout,
              action.edges.map((e) => ({ id: `${e.source}→${e.target}`, vertices: e.points })),
            );
            break;
          case "deleteComponents":
            allEdits.push(...this.deps.computeElementDelete(docText, action.names, tree));
            layout = this.deps.removeElements(layout, action.names);
            needsRender = "immediate";
            break;
          case "updateName": {
            if (action.oldName && action.newName && this.deps.renameElement) {
              layout = this.deps.renameElement(layout, action.oldName, action.newName);
            }
            if (tree) {
              allEdits.push(...this.deps.computeNameEdit(tree, docText, action.oldName, action.newName));
            }
            needsRender = "debounced";
            break;
          }
          case "updateDescription": {
            if (tree) {
              allEdits.push(...this.deps.computeDescriptionEdit(tree, docText, action.name, action.description));
            }
            needsRender = "debounced";
            break;
          }
          case "updateParameter": {
            if (tree) {
              allEdits.push(
                ...this.deps.computeParameterEdit(tree, docText, action.name, action.parameter, action.value),
              );
            }
            needsRender = "debounced";
            break;
          }
          case "updateProperty": {
            if (tree) {
              allEdits.push(
                ...this.deps.computeParameterEdit(tree, docText, action.name, action.key, String(action.value)),
              );
            }
            needsRender = "debounced";
            break;
          }
          case "addComponent": {
            const elementType = action.className;
            const baseParts = elementType.replace("Definition", "").replace("Usage", "");
            const baseName = baseParts.charAt(0).toLowerCase() + baseParts.slice(1);
            const uniqueName = this.deps.generateUniqueName(docText, baseName);
            allEdits.push(...this.deps.computeElementInsert(docText, elementType, uniqueName, undefined, tree));
            // Store position in layout
            layout = this.deps.updateElementPositions(layout, [
              {
                name: uniqueName,
                x: Math.round(action.x),
                y: Math.round(action.y),
                width: 180,
                height: 60,
              },
            ]);
            needsRender = "immediate";
            break;
          }
        }
      }
      this.deps.setLayout(params.uri, layout);
    } catch (e) {
      console.error("[sysml2-diagram] diagramEdit error:", e);
    } finally {
      tree?.delete?.();
    }

    let sidecarUri: string | undefined;
    let sidecarContent: string | undefined;
    if (layout) {
      const serialize = this.deps.serializeLayout ?? ((l: any) => JSON.stringify(l, null, 2) + "\n");
      try {
        sidecarContent = serialize(layout);
        sidecarUri = this.deps.getSidecarUri ? this.deps.getSidecarUri(params.uri) : `${params.uri}.layout`;
      } catch (e) {
        console.error("[sysml2-diagram] layout serialization error:", e);
      }
    }

    return {
      seq: params.seq,
      edits: deduplicateAndSort(allEdits),
      renderHint: needsRender,
      sidecarUri,
      sidecarContent,
    };
  }

  getPalette(_params: DiagramGetPaletteParams): DiagramPalette | null {
    return {
      categories: [
        {
          name: "Structure",
          items: [
            { label: "Part", className: "PartDefinition" },
            { label: "Port", className: "PortDefinition" },
            { label: "Item", className: "ItemDefinition" },
          ],
        },
        {
          name: "Behavior",
          items: [
            { label: "Action", className: "ActionDefinition" },
            { label: "State", className: "StateDefinition" },
          ],
        },
        {
          name: "Requirements",
          items: [
            { label: "Requirement", className: "RequirementDefinition" },
            { label: "Constraint", className: "ConstraintDefinition" },
          ],
        },
      ],
    };
  }

  drillDown(params: DiagramDrillDownParams): DiagramDrillDownResult | null {
    const targetName = params.className || params.componentName;
    if (!targetName) return null;
    const childData = this.deps.buildDiagramData({
      uri: params.uri,
      className: targetName,
    });
    return {
      targetUri: params.uri,
      targetClassName: targetName,
      breadcrumbs: [
        { id: "root", label: "Root", uri: params.uri },
        { id: params.nodeId || targetName, label: targetName, uri: params.uri },
      ],
      data: childData ?? undefined,
    };
  }
}

// ── OWL 2 Backend ──

export interface Owl2BackendDeps {
  getDocumentText: (uri: string) => string | undefined;
  getAxioms: (uri: string) => any[];
  getInferredSubClassOf?:
    | ((uri: string, axioms: any[]) => { subClassIri: string; superClassIri: string }[])
    | undefined;
  getLayout?: ((uri: string) => any) | undefined;
  setLayout?: ((uri: string, layout: any) => void) | undefined;
  createEmptyLayout?: (() => any) | undefined;
  updateElementPositions?:
    | ((
        layout: any,
        items: { name: string; x: number; y: number; width: number; height: number; rotation?: number | undefined }[],
      ) => any)
    | undefined;
  updateConnectionVertices?:
    | ((layout: any, updates: { id: string; vertices: { x: number; y: number }[] }[]) => any)
    | undefined;
  removeElements?: ((layout: any, names: string[]) => any) | undefined;
  computeConnectionInsert?:
    | ((text: string, source: string, target: string, edgeType?: string) => TextEdit[])
    | undefined;
  computeConnectionDelete?: ((text: string, source: string, target: string) => TextEdit[]) | undefined;
  computeElementInsert?: ((text: string, elementType: string, name: string) => TextEdit[]) | undefined;
  computeElementDelete?: ((text: string, names: string[]) => TextEdit[]) | undefined;
  computeNameEdit?: ((text: string, oldIri: string, newIri: string) => TextEdit[]) | undefined;
  buildDiagramData?: ((axioms: any[], layout?: any, diagramType?: string, options?: any) => DiagramData) | undefined;
  getEntityData?:
    | ((
        uri: string,
        entityIri: string,
      ) => {
        iri: string;
        type: string;
        axioms?: string[] | undefined;
        annotations?: Record<string, string> | undefined;
      } | null)
    | undefined;
}

export class Owl2DiagramBackend implements DiagramBackend {
  constructor(private readonly deps: Owl2BackendDeps) {}

  getData(params: DiagramGetDataParams): DiagramData | null {
    const axioms = this.deps.getAxioms(params.uri);
    const layout = this.deps.getLayout ? this.deps.getLayout(params.uri) : undefined;
    const inferredSubClassOf = this.deps.getInferredSubClassOf
      ? this.deps.getInferredSubClassOf(params.uri, axioms)
      : undefined;
    const builder = this.deps.buildDiagramData ?? buildOWL2DiagramData;
    return builder(axioms, layout, params.diagramType, inferredSubClassOf ? { inferredSubClassOf } : undefined);
  }

  getComponentProperties(params: DiagramGetComponentPropertiesParams): ComponentPropertyData | null {
    const name = params.componentName;
    const uri = params.uri;
    const axioms = this.deps.getAxioms(uri);

    const relatedAxioms: string[] = [];
    let entityType = "Class";
    const namePattern = name.replace(/^:/, "");

    for (const ax of axioms) {
      const axStr = JSON.stringify(ax);
      if (axStr.includes(namePattern)) {
        if (ax.type === "ClassDeclaration" && ax.iri?.includes(namePattern)) entityType = "Class";
        else if (ax.type === "ObjectPropertyDeclaration" && ax.iri?.includes(namePattern))
          entityType = "ObjectProperty";
        else if (ax.type === "DataPropertyDeclaration" && ax.iri?.includes(namePattern)) entityType = "DataProperty";
        else if (ax.type === "IndividualDeclaration" && ax.iri?.includes(namePattern)) entityType = "Individual";

        if (ax.type === "SubClassOf") {
          relatedAxioms.push(`SubClassOf(${ax.subClassIri} ${ax.superClassIri})`);
        } else if (ax.type === "EquivalentClasses") {
          relatedAxioms.push(`EquivalentClasses(${ax.classIris?.join(" ")})`);
        } else if (ax.type === "DisjointClasses") {
          relatedAxioms.push(`DisjointClasses(${ax.classIris?.join(" ")})`);
        } else if (ax.type === "ObjectPropertyAssertion") {
          relatedAxioms.push(`ObjectPropertyAssertion(${ax.propertyIri} ${ax.subjectIri} ${ax.objectIri})`);
        }
      }
    }

    const generalFields: PropertyFieldConfig[] = [
      { key: "iri", label: "IRI", kind: "string", defaultValue: name, readOnly: true },
      { key: "name", label: "Short Name", kind: "string", defaultValue: name.replace(/^.*[#/:]/, "") },
      { key: "type", label: "Entity Type", kind: "string", defaultValue: entityType, readOnly: true },
    ];

    const generalGroups: PropertyGroupConfig[] = [
      {
        id: "identification",
        label: "Identification",
        fields: generalFields,
      },
    ];

    const axiomFields: PropertyFieldConfig[] = relatedAxioms.map((ax, idx) => ({
      key: `axiom_${idx}`,
      label: `Axiom ${idx + 1}`,
      kind: "expression",
      defaultValue: ax,
      readOnly: true,
    }));

    const axiomGroups: PropertyGroupConfig[] =
      axiomFields.length > 0
        ? [
            {
              id: "axioms",
              label: "Axioms",
              fields: axiomFields,
            },
          ]
        : [];

    const tabs: PropertyTabConfig[] = [
      { id: "general", label: "General", groups: generalGroups },
      { id: "axioms", label: "Axioms", groups: axiomGroups },
      { id: "annotations", label: "Annotations", groups: [] },
    ];

    const values: Record<string, any> = {
      iri: name,
      name: name.replace(/^.*[#/:]/, ""),
      type: entityType,
    };
    relatedAxioms.forEach((ax, idx) => {
      values[`axiom_${idx}`] = ax;
    });

    return {
      name,
      className: entityType,
      description: name,
      schema: { tabs },
      values,
      parameters: [],
    };
  }

  applyEdits(params: DiagramApplyEditsParams): DiagramApplyEditsResult {
    const docText = this.deps.getDocumentText(params.uri) ?? "";
    const allEdits: TextEdit[] = [];
    let needsRender: "none" | "immediate" | "debounced" = "none";
    let layout = this.deps.getLayout ? this.deps.getLayout(params.uri) : undefined;
    if (!layout && this.deps.createEmptyLayout) {
      layout = this.deps.createEmptyLayout();
    }

    for (const action of params.actions) {
      switch (action.type) {
        case "move":
          if (this.deps.updateElementPositions) {
            layout = this.deps.updateElementPositions(layout, action.items);
          }
          if (needsRender === "none") needsRender = "none";
          break;
        case "resize":
          if (this.deps.updateElementPositions) {
            layout = this.deps.updateElementPositions(layout, [action.item]);
          }
          if (needsRender === "none") needsRender = "none";
          break;
        case "moveEdge":
          if (this.deps.updateConnectionVertices) {
            layout = this.deps.updateConnectionVertices(
              layout,
              action.edges.map((e) => ({ id: `${e.source}→${e.target}`, vertices: e.points })),
            );
          }
          if (needsRender === "none") needsRender = "none";
          break;
        case "connect": {
          const insertFn = this.deps.computeConnectionInsert ?? computeOWL2ConnectionInsert;
          const edgeType = (action as any).edgeType ?? "subClassOf";
          allEdits.push(...insertFn(docText, action.source, action.target, edgeType));
          if (action.points && action.points.length > 0 && this.deps.updateConnectionVertices) {
            layout = this.deps.updateConnectionVertices(layout, [
              { id: `${action.source}→${action.target}`, vertices: action.points },
            ]);
          }
          needsRender = "immediate";
          break;
        }
        case "disconnect": {
          const delFn = this.deps.computeConnectionDelete ?? computeOWL2ConnectionDelete;
          allEdits.push(...delFn(docText, action.source, action.target));
          needsRender = "immediate";
          break;
        }
        case "reconnect": {
          const delFn = this.deps.computeConnectionDelete ?? computeOWL2ConnectionDelete;
          const insertFn = this.deps.computeConnectionInsert ?? computeOWL2ConnectionInsert;
          allEdits.push(...delFn(docText, action.oldSource, action.oldTarget));
          allEdits.push(...insertFn(docText, action.newSource, action.newTarget));
          needsRender = "immediate";
          break;
        }
        case "deleteComponents": {
          const delFn = this.deps.computeElementDelete ?? computeOWL2ElementDelete;
          allEdits.push(...delFn(docText, action.names));
          if (this.deps.removeElements) {
            layout = this.deps.removeElements(layout, action.names);
          }
          needsRender = "immediate";
          break;
        }
        case "updateName": {
          const nameFn = this.deps.computeNameEdit ?? computeOWL2NameEdit;
          allEdits.push(...nameFn(docText, action.oldName, action.newName));
          needsRender = "debounced";
          break;
        }
        case "addComponent": {
          const insertFn = this.deps.computeElementInsert ?? computeOWL2ElementInsert;
          const elementType = action.className || "Class";
          const uniqueName = (action as any).name || (action.className ? `${action.className}_1` : "Entity_1");
          allEdits.push(...insertFn(docText, elementType, uniqueName));
          if (this.deps.updateElementPositions) {
            layout = this.deps.updateElementPositions(layout, [
              { name: uniqueName, x: action.x, y: action.y, width: 140, height: 50 },
            ]);
          }
          needsRender = "immediate";
          break;
        }
      }
    }

    if (layout && this.deps.setLayout) {
      this.deps.setLayout(params.uri, layout);
    }

    let sidecarUri: string | undefined;
    let sidecarContent: string | undefined;
    if (layout) {
      const serialize = (this.deps as any).serializeLayout ?? ((l: any) => JSON.stringify(l, null, 2) + "\n");
      try {
        sidecarContent = serialize(layout);
        sidecarUri = (this.deps as any).getSidecarUri
          ? (this.deps as any).getSidecarUri(params.uri)
          : `${params.uri}.layout`;
      } catch {
        // ignore
      }
    }

    return {
      seq: params.seq,
      edits: deduplicateAndSort(allEdits),
      renderHint: needsRender,
      sidecarUri,
      sidecarContent,
    };
  }

  getPalette(_params: DiagramGetPaletteParams): DiagramPalette | null {
    return {
      categories: [
        {
          name: "Classes & Concepts",
          items: [
            { label: "Class", className: "Class" },
            { label: "Defined Class", className: "DefinedClass" },
            { label: "Individual", className: "Individual" },
          ],
        },
        {
          name: "Properties",
          items: [
            { label: "Object Property", className: "ObjectProperty" },
            { label: "Data Property", className: "DataProperty" },
          ],
        },
      ],
    };
  }

  drillDown(_params: DiagramDrillDownParams): DiagramDrillDownResult | null {
    return null;
  }
}

// ── Generic DSL Diagram Backend ──

export interface GenericDSLBackendDeps {
  getDocumentText: (uri: string) => string | undefined;
  getDiagramConfig?: ((uri: string) => any) | undefined;
  getSyntaxNames?: ((uri: string) => Record<number, string> | string[] | undefined) | undefined;
  getRawAstData?: ((uri: string) => { nodes: any[]; edges: any[] } | null) | undefined;
  getSymbolIndex?: ((uri: string) => any) | undefined;
  getScopeResolver?: ((uri: string) => any) | undefined;
  layoutStorage?: SidecarLayoutStorage | undefined;
  fsBridge?: FileSystemBridge | undefined;
}

function findSectionClosingLine(lines: string[], sectionName: string): number | null {
  const secRegex = new RegExp(`\\b${sectionName}\\b`);
  let inSection = false;
  let depth = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!inSection) {
      if (secRegex.test(line)) {
        inSection = true;
        for (const ch of line.substring(line.search(secRegex))) {
          if (ch === "{") depth++;
          else if (ch === "}") depth--;
        }
      }
    } else {
      for (const ch of line) {
        if (ch === "{") depth++;
        else if (ch === "}") {
          depth--;
          if (depth <= 0) {
            return i;
          }
        }
      }
    }
  }
  return null;
}

function insertIntoSectionOrRoot(lines: string[], allEdits: TextEdit[], content: string, targetSection?: string) {
  if (targetSection) {
    const secLine = findSectionClosingLine(lines, targetSection);
    if (secLine !== null) {
      allEdits.push({
        range: {
          start: { line: secLine, character: 0 },
          end: { line: secLine, character: 0 },
        },
        newText: "    " + content.trim() + "\n",
      });
      return;
    } else {
      let insertLine = lines.length;
      for (let i = lines.length - 1; i >= 0; i--) {
        if (lines[i]!.trim() === "}") {
          insertLine = i;
          break;
        }
      }
      allEdits.push({
        range: {
          start: { line: insertLine, character: 0 },
          end: { line: insertLine, character: 0 },
        },
        newText: `  ${targetSection} {\n    ${content.trim()}\n  }\n`,
      });
      return;
    }
  }

  let insertLine = lines.length;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i]!.trim() === "}") {
      insertLine = i;
      break;
    }
  }
  allEdits.push({
    range: {
      start: { line: insertLine, character: 0 },
      end: { line: insertLine, character: 0 },
    },
    newText: (insertLine < lines.length ? "  " : "") + content.trim() + "\n",
  });
}

/**
 * Replaces comment content (// line comments and /* block comments * /) with whitespace,
 * preserving exact string lengths, line numbers, and character column indices.
 */
export function maskComments(text: string): string {
  let inBlockComment = false;
  let inLineComment = false;
  let inString: string | null = null;
  const chars = text.split("");

  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    const next = i + 1 < chars.length ? chars[i + 1] : "";

    if (inLineComment) {
      if (ch === "\n") {
        inLineComment = false;
      } else if (ch !== "\r") {
        chars[i] = " ";
      }
    } else if (inBlockComment) {
      if (ch === "*" && next === "/") {
        chars[i] = " ";
        chars[i + 1] = " ";
        i++;
        inBlockComment = false;
      } else if (ch !== "\n" && ch !== "\r") {
        chars[i] = " ";
      }
    } else if (inString) {
      if (ch === "\\") {
        // Escape next character inside string
        i++;
      } else if (ch === inString) {
        inString = null;
      }
    } else {
      if (ch === '"' || ch === "'") {
        inString = ch;
      } else if (ch === "/" && next === "/") {
        inLineComment = true;
        chars[i] = " ";
        chars[i + 1] = " ";
        i++;
      } else if (ch === "/" && next === "*") {
        inBlockComment = true;
        chars[i] = " ";
        chars[i + 1] = " ";
        i++;
      }
    }
  }

  return chars.join("");
}

/**
 * Generic diagram backend for any DSL defined via @modelscript/dsl.
 * Uses declarative grammar diagram configuration and SidecarLayoutStorage.
 */
export class GenericDSLDiagramBackend implements DiagramBackend {
  private readonly defaultLayoutStorage: SidecarLayoutStorage;
  private readonly layoutStorageCache = new Map<string, SidecarLayoutStorage>();

  constructor(private readonly deps: GenericDSLBackendDeps) {
    this.defaultLayoutStorage =
      deps.layoutStorage ??
      new SidecarLayoutStorage({
        fsBridge: deps.fsBridge,
      });
  }

  getLayoutStorage(uri: string): SidecarLayoutStorage {
    if (this.deps.layoutStorage) return this.deps.layoutStorage;
    const cached = this.layoutStorageCache.get(uri);
    if (cached) return cached;

    const config = this.deps.getDiagramConfig?.(uri);
    const sidecarConfig = config?.placement?.sidecar;
    const storage = sidecarConfig
      ? new SidecarLayoutStorage({
          ...sidecarConfig,
          fsBridge: this.deps.fsBridge,
        })
      : this.defaultLayoutStorage;

    this.layoutStorageCache.set(uri, storage);
    return storage;
  }

  async getData(params: DiagramGetDataParams): Promise<DiagramData | null> {
    const docText = this.deps.getDocumentText(params.uri);
    const config = this.deps.getDiagramConfig?.(params.uri);
    const symbolIndex = this.deps.getSymbolIndex?.(params.uri);
    const resolver = this.deps.getScopeResolver?.(params.uri);

    let diagramData: any = null;

    if (symbolIndex && config) {
      const { graphicsConfig, options } = compileDiagramConfigToPolyglot(config);
      diagramData = buildPolyglotDiagram(
        symbolIndex,
        graphicsConfig,
        params.uri,
        resolver,
        params.diagramType ?? "All",
        options,
      );
    } else {
      const syntaxNames = this.deps.getSyntaxNames?.(params.uri);
      const rawData = this.deps.getRawAstData?.(params.uri) ?? { nodes: [], edges: [] };

      if (!docText && rawData.nodes.length === 0) return null;

      diagramData = buildDiagramFromDSL(rawData, config, syntaxNames, params.diagramType, docText);
    }

    if ((!diagramData || !Array.isArray(diagramData.nodes) || diagramData.nodes.length === 0) && docText) {
      const plugin = globalLanguageRegistry.getPluginForUri(params.uri, docText);
      const isScad = /\.scad($|\?|#)/i.test(params.uri) || plugin?.id === "scad";

      const makeStyledPorts = () => ({
        groups: {
          in: {
            position: "left",
            attrs: {
              circle: { r: 4, magnet: true, stroke: "#0284c7", fill: "#ffffff", strokeWidth: 1.5 },
            },
          },
          out: {
            position: "right",
            attrs: {
              circle: { r: 4, magnet: true, stroke: "#0284c7", fill: "#ffffff", strokeWidth: 1.5 },
            },
          },
        },
        items: [
          { id: "in", group: "in" },
          { id: "out", group: "out" },
        ],
      });

      const makeStyledNode = (opts: {
        id: string;
        name: string;
        kind: string;
        stereotype: string;
        subtitle?: string | undefined;
        entries?: string[] | undefined;
        stroke: string;
        fill: string;
        headerFill?: string | undefined;
        x?: number | undefined;
        y?: number | undefined;
      }) => {
        const entries = opts.entries ?? [];
        const hasEntries = entries.length > 0;
        const subtitle = opts.subtitle?.trim() || "";
        const HEADER_H = subtitle ? 54 : 40;
        const LINE_H = 16;
        const maxTextLen = Math.max(
          opts.name.length * 8.5 + 36,
          opts.stereotype.length * 7.5 + 32,
          subtitle.length * 6.8 + 32,
          ...entries.map((e) => e.length * 7.2 + 36),
        );
        const width = Math.min(320, Math.max(185, Math.ceil(maxTextLen)));
        const height = hasEntries ? HEADER_H + entries.length * LINE_H + 12 : subtitle ? 62 : 48;

        const markup: { tagName: string; selector: string }[] = [
          { tagName: "rect", selector: "body" },
          ...(hasEntries
            ? [
                { tagName: "path", selector: "headerBody" },
                { tagName: "line", selector: "headerSep" },
              ]
            : []),
          { tagName: "text", selector: "stereotype" },
          { tagName: "text", selector: "label" },
          ...(subtitle ? [{ tagName: "text", selector: "subtitle" }] : []),
        ];

        const headerPath = `M 0 6 A 6 6 0 0 1 6 0 L ${width - 6} 0 A 6 6 0 0 1 ${width} 6 L ${width} ${HEADER_H} L 0 ${HEADER_H} Z`;
        const attrs: Record<string, Record<string, unknown>> = {
          body: {
            fill: hasEntries ? "#ffffff" : opts.fill,
            stroke: opts.stroke,
            strokeWidth: 1.5,
            rx: 6,
            ry: 6,
            refWidth: "100%",
            refHeight: "100%",
          },
          ...(hasEntries
            ? {
                headerBody: {
                  d: headerPath,
                  fill: opts.headerFill ?? opts.fill,
                  stroke: "none",
                },
                headerSep: {
                  x1: 0,
                  y1: HEADER_H,
                  x2: width,
                  y2: HEADER_H,
                  stroke: opts.stroke,
                  strokeWidth: 1,
                },
              }
            : {}),
          stereotype: {
            text: `«${opts.stereotype}»`,
            fill: opts.stroke,
            fontSize: 10,
            fontStyle: "italic",
            textAnchor: "middle",
            textVerticalAnchor: "top",
            refX: 0.5,
            refY: 6,
          },
          label: {
            text: opts.name,
            fill: "#0f172a",
            fontSize: 12,
            fontWeight: "bold",
            textAnchor: "middle",
            textVerticalAnchor: "top",
            refX: 0.5,
            refY: 21,
          },
          ...(subtitle
            ? {
                subtitle: {
                  text: subtitle.length > 42 ? `${subtitle.slice(0, 39)}...` : subtitle,
                  fill: "#475569",
                  fontSize: 10,
                  fontFamily: "monospace",
                  textAnchor: "middle",
                  textVerticalAnchor: "top",
                  refX: 0.5,
                  refY: 38,
                },
              }
            : {}),
        };

        for (let i = 0; i < entries.length; i++) {
          const sel = `entry_${i}`;
          markup.push({ tagName: "text", selector: sel });
          attrs[sel] = {
            text: entries[i]!,
            fill: "#1e293b",
            fontSize: 11,
            fontFamily: "monospace",
            textAnchor: "start",
            textVerticalAnchor: "top",
            refX: 14,
            refY: HEADER_H + 6 + i * LINE_H,
          };
        }

        return {
          id: opts.id,
          name: opts.name,
          label: subtitle ? `${opts.name}\n${subtitle}` : opts.name,
          kind: opts.kind,
          x: opts.x ?? 80,
          y: opts.y ?? 80,
          width,
          height,
          rotation: 0,
          autoLayout: true,
          shape: "rect",
          markup,
          attrs,
          ports: makeStyledPorts(),
          properties: {
            className: opts.kind,
            name: opts.name,
            description: subtitle,
          },
        };
      };

      const makeStyledEdge = (id: string, source: string, target: string, dashed = false, labelText?: string) => ({
        id,
        source,
        target,
        sourcePort: "out",
        targetPort: "in",
        attrs: {
          line: {
            stroke: dashed ? "#0d9488" : "#64748b",
            strokeWidth: 1.5,
            ...(dashed ? { strokeDasharray: "5 3" } : {}),
            targetMarker: {
              name: "block",
              width: 8,
              height: 6,
            },
          },
        },
        ...(labelText
          ? {
              labels: [
                {
                  attrs: {
                    label: {
                      text: labelText,
                      fill: "#475569",
                      fontSize: 10,
                    },
                  },
                },
              ],
            }
          : {}),
      });

      const nodes: any[] = [];
      const edges: any[] = [];

      // Dedicated OpenSCAD (.scad) CSG Constructive Solid Geometry Tree & Parametric Diagram Builder
      if (isScad) {
        const paramEntries: string[] = [];
        const moduleNodeIds = new Map<string, string>();
        const topModuleCalls = new Map<string, string[]>();
        const blockStack: { parentId: string | null; depth: number }[] = [];
        let braceDepth = 0;
        let pendingParentId: string | null = null;
        let nodeCounter = 0;

        const currentParent = (): string | null => {
          if (pendingParentId) return pendingParentId;
          for (let i = blockStack.length - 1; i >= 0; i--) {
            if (blockStack[i]!.parentId) return blockStack[i]!.parentId;
          }
          return null;
        };

        const rawLines = docText.split(/\r?\n/);
        for (const rawLine of rawLines) {
          const stripped = rawLine.replace(/\/\/.*$/, "").trim();
          if (!stripped) continue;

          const openBraces = (stripped.match(/\{/g) || []).length;
          const closeBraces = (stripped.match(/\}/g) || []).length;

          // Pure closing brace line
          if (/^\}+;?\s*$/.test(stripped)) {
            braceDepth = Math.max(0, braceDepth - closeBraces);
            while (blockStack.length > 0 && blockStack[blockStack.length - 1]!.depth > braceDepth) {
              blockStack.pop();
            }
            pendingParentId = null;
            continue;
          }

          // 1. Top-level or local variable declaration: name = expr;
          const varMatch = /^(\$?[A-Za-z_][A-Za-z0-9_]*)\s*=\s*([^;]+);/.exec(stripped);
          if (varMatch && braceDepth === 0) {
            paramEntries.push(`${varMatch[1]} = ${varMatch[2]!.trim()}`);
            continue;
          }

          // 2. Module declaration: module name(params) {
          const modMatch = /^module\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)/.exec(stripped);
          if (modMatch) {
            const modName = modMatch[1]!;
            const modParams = modMatch[2]!.trim();
            const nodeId = `module_${modName}`;
            moduleNodeIds.set(modName, nodeId);
            nodes.push(
              makeStyledNode({
                id: nodeId,
                name: modName,
                kind: "Module",
                stereotype: "csg module",
                subtitle: modParams ? `(${modParams})` : "()",
                stroke: "#0d9488",
                fill: "#f0fdfa",
              }),
            );
            braceDepth += openBraces - closeBraces;
            if (openBraces > closeBraces) {
              blockStack.push({ parentId: nodeId, depth: braceDepth });
            }
            pendingParentId = null;
            continue;
          }

          // 3. Tagged boundary/mechanical port: tag_port("name", "type")
          const portMatch = /^tag_port\s*\(\s*"([^"]+)"(?:\s*,\s*"([^"]+)")?\s*\)/.exec(stripped);
          if (portMatch) {
            const portName = portMatch[1]!;
            const portType = portMatch[2] || "port";
            const nodeId = `port_${++nodeCounter}_${portName}`;
            const pId = currentParent();
            nodes.push(
              makeStyledNode({
                id: nodeId,
                name: portName,
                kind: "Port",
                stereotype: `port: ${portType}`,
                subtitle: `tag_port("${portName}", "${portType}")`,
                stroke: "#d97706",
                fill: "#fffbeb",
              }),
            );
            if (pId) {
              edges.push(makeStyledEdge(`edge_${pId}_${nodeId}`, pId, nodeId));
            }
            braceDepth += openBraces - closeBraces;
            if (openBraces > closeBraces) {
              blockStack.push({ parentId: nodeId, depth: braceDepth });
              pendingParentId = null;
            } else {
              pendingParentId = nodeId;
            }
            continue;
          }

          // 4. CSG Boolean operation: difference(), union(), intersection(), hull(), minkowski()
          const boolMatch = /^(difference|union|intersection|hull|minkowski)\s*\(\s*\)/.exec(stripped);
          if (boolMatch) {
            const opName = boolMatch[1]!;
            const nodeId = `bool_${++nodeCounter}_${opName}`;
            const pId = currentParent();
            nodes.push(
              makeStyledNode({
                id: nodeId,
                name: `${opName}()`,
                kind: "BooleanOp",
                stereotype: "csg boolean",
                stroke: "#7c3aed",
                fill: "#f5f3ff",
              }),
            );
            if (pId) {
              edges.push(makeStyledEdge(`edge_${pId}_${nodeId}`, pId, nodeId));
            }
            braceDepth += openBraces - closeBraces;
            if (openBraces > closeBraces) {
              blockStack.push({ parentId: nodeId, depth: braceDepth });
              pendingParentId = null;
            } else {
              pendingParentId = nodeId;
            }
            continue;
          }

          // 5. Transform operation: translate(...), rotate(...), scale(...), mirror(...), color(...), linear_extrude(...)
          const tfMatch = /^(translate|rotate|scale|mirror|color|linear_extrude)\s*\((.*)\)\s*(\{?)$/.exec(stripped);
          if (tfMatch) {
            const tfName = tfMatch[1]!;
            const tfArgs = tfMatch[2]!.trim();
            const nodeId = `tf_${++nodeCounter}_${tfName}`;
            const pId = currentParent();
            nodes.push(
              makeStyledNode({
                id: nodeId,
                name: tfName,
                kind: "Transform",
                stereotype: "transform",
                subtitle: tfArgs,
                stroke: "#0284c7",
                fill: "#f0f9ff",
              }),
            );
            if (pId) {
              edges.push(makeStyledEdge(`edge_${pId}_${nodeId}`, pId, nodeId));
            }
            braceDepth += openBraces - closeBraces;
            if (openBraces > closeBraces) {
              blockStack.push({ parentId: nodeId, depth: braceDepth });
              pendingParentId = null;
            } else {
              pendingParentId = nodeId;
            }
            continue;
          }

          // 6. 3D/2D Solid primitive: cylinder(...), cube(...), sphere(...), polyhedron(...), polygon(...), circle(...), square(...)
          const primMatch = /^(cylinder|cube|sphere|polyhedron|polygon|circle|square)\s*\((.*)\)\s*;/.exec(stripped);
          if (primMatch) {
            const primName = primMatch[1]!;
            const primArgs = primMatch[2]!.replace(/,\s*center\s*=\s*(true|false)/, "").trim();
            const nodeId = `prim_${++nodeCounter}_${primName}`;
            const pId = currentParent();
            nodes.push(
              makeStyledNode({
                id: nodeId,
                name: primName,
                kind: "Primitive",
                stereotype: "3d solid",
                subtitle: primArgs,
                stroke: "#059669",
                fill: "#ecfdf5",
              }),
            );
            if (pId) {
              edges.push(makeStyledEdge(`edge_${pId}_${nodeId}`, pId, nodeId));
            }
            pendingParentId = null;
            braceDepth = Math.max(0, braceDepth + openBraces - closeBraces);
            continue;
          }

          // 7. User module instantiation: modName(args);
          const callMatch = /^([A-Za-z_][A-Za-z0-9_]*)\s*\((.*)\)\s*;/.exec(stripped);
          if (callMatch) {
            const callee = callMatch[1]!;
            const callArgs = callMatch[2]!.trim();
            const pId = currentParent();
            if (!pId && braceDepth === 0) {
              const list = topModuleCalls.get(callee) ?? [];
              list.push(callArgs || "default");
              topModuleCalls.set(callee, list);
            } else {
              const targetModId = moduleNodeIds.get(callee);
              if (targetModId && pId) {
                edges.push(
                  makeStyledEdge(
                    `edge_call_${++nodeCounter}_${pId}_${targetModId}`,
                    pId,
                    targetModId,
                    true,
                    "instantiate",
                  ),
                );
              } else {
                const callId = `call_${++nodeCounter}_${callee}`;
                nodes.push(
                  makeStyledNode({
                    id: callId,
                    name: `${callee}(${callArgs})`,
                    kind: "ModuleCall",
                    stereotype: "instance",
                    stroke: "#0d9488",
                    fill: "#f0fdfa",
                  }),
                );
                if (pId) {
                  edges.push(makeStyledEdge(`edge_${pId}_${callId}`, pId, callId));
                }
              }
            }
            pendingParentId = null;
            braceDepth = Math.max(0, braceDepth + openBraces - closeBraces);
            continue;
          }

          braceDepth = Math.max(0, braceDepth + openBraces - closeBraces);
          while (blockStack.length > 0 && blockStack[blockStack.length - 1]!.depth > braceDepth) {
            blockStack.pop();
          }
        }

        // Emit grouped top-level module instantiations (e.g., 4x arm_assembly(45, 135, 225, 315))
        for (const [callee, argList] of topModuleCalls) {
          const instId = `inst_${callee}`;
          const summary =
            argList.length > 1 ? `${argList.length}× instances (${argList.join(", ")})` : `(${argList[0] ?? ""})`;
          nodes.push(
            makeStyledNode({
              id: instId,
              name: `${callee} Assembly`,
              kind: "AssemblyInstance",
              stereotype: argList.length > 1 ? `csg pattern (${argList.length}×)` : "csg instance",
              subtitle: summary,
              stroke: "#0d9488",
              fill: "#ccfbf1",
            }),
          );
          const targetModId = moduleNodeIds.get(callee);
          if (targetModId) {
            edges.push(makeStyledEdge(`edge_${instId}_${targetModId}`, instId, targetModId, true, "instantiates"));
          }
        }

        // Prepend consolidated Design Parameters compartment block
        if (paramEntries.length > 0) {
          nodes.unshift(
            makeStyledNode({
              id: "scad_parameters",
              name: "Design Parameters",
              kind: "Parameters",
              stereotype: "parameters",
              entries: paramEntries,
              stroke: "#4f46e5",
              fill: "#eef2ff",
              headerFill: "#e0e7ff",
            }),
          );
        }
      }

      // Dedicated Fortran (.f, .for, .f77, .f90, .f95, .f03, .f08) Dataflow & Block Schematic Builder
      const isFortran = /\.(f|for|f77|f90|f95|f03|f08)($|\?|#)/i.test(params.uri) || plugin?.id === "fortran";
      if (nodes.length === 0 && isFortran) {
        let routineName = "fortran_kernel";
        let routineKind = "subroutine";
        const dummyArgs: string[] = [];
        const inputVars = new Map<string, string>(); // lowerName -> displayName
        const outputVars = new Map<string, string>(); // lowerName -> displayName
        const varTypes = new Map<string, string>(); // lowerName -> typeStr
        const constants = new Map<string, { name: string; value: string }>(); // lowerName -> { name, value }
        const equations: {
          id: string;
          lhs: string;
          rhs: string;
          isState: boolean;
          lineIdx: number;
          condGuard?: string | undefined;
        }[] = [];
        const callBlocks: {
          id: string;
          subroutine: string;
          args: string[];
          lineIdx: number;
        }[] = [];

        const rawLines = docText.split(/\r?\n/);

        // Pre-scan all program units to identify the primary routine and helper subroutine signatures
        const unitSummaries = new Map<
          string,
          {
            name: string;
            kind: string;
            params: string[];
            intents: Map<string, string>;
            startLine: number;
            endLine: number;
          }
        >();
        let primaryUnitUpper: string | null = null;
        {
          let activeUnit: {
            name: string;
            kind: string;
            params: string[];
            intents: Map<string, string>;
            startLine: number;
            endLine: number;
          } | null = null;
          for (let i = 0; i < rawLines.length; i++) {
            const clean = rawLines[i]!.replace(/!.*$/, "").trim();
            if (!clean) continue;
            const hdr =
              /^(?:(?:pure|elemental|recursive|real(?:\s*\([^)]*\))?|integer(?:\s*\([^)]*\))?|double\s+precision|logical)\s+)*(subroutine|function|program)\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?:\(([^)]*)\))?/i.exec(
                clean,
              );
            if (hdr) {
              const kind = hdr[1]!.toLowerCase();
              const name = hdr[2]!;
              const params = hdr[3]
                ? hdr[3]
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean)
                : [];
              activeUnit = {
                name,
                kind,
                params,
                intents: new Map(),
                startLine: i,
                endLine: rawLines.length - 1,
              };
              unitSummaries.set(name.toUpperCase(), activeUnit);
              if (kind === "program" || !primaryUnitUpper) {
                primaryUnitUpper = name.toUpperCase();
              }
              continue;
            }
            if (activeUnit && /^end(?:\s+(?:subroutine|function|program))?\b/i.test(clean)) {
              activeUnit.endLine = i;
              activeUnit = null;
              continue;
            }
            if (activeUnit && clean.includes("::")) {
              const [attrPart, rhsPart] = clean.split("::");
              const im = /\bintent\s*\(\s*(in\s*out|inout|in|out)\s*\)/i.exec(attrPart ?? "");
              if (im && rhsPart) {
                const intent = im[1]!.replace(/\s+/g, "").toLowerCase();
                for (const tok of rhsPart.split(",")) {
                  const idm = /^([A-Za-z_][A-Za-z0-9_]*)/.exec(tok.trim());
                  if (idm) activeUnit.intents.set(idm[1]!.toLowerCase(), intent);
                }
              }
            }
          }
        }

        const primaryUnit = primaryUnitUpper ? unitSummaries.get(primaryUnitUpper) : undefined;
        const guardStack: string[] = [];
        let insideHelperUnit = false;

        for (let lineIdx = 0; lineIdx < rawLines.length; lineIdx++) {
          const rawLine = rawLines[lineIdx]!;
          if (/^[Cc*]\s/.test(rawLine) && !/^\s*call\b/i.test(rawLine)) continue;
          const clean = rawLine.replace(/!.*$/, "").trim();
          if (!clean || clean.startsWith("#")) continue;

          // Subroutine / Function / Program / Module header
          const headerMatch =
            /^(?:(?:pure|elemental|recursive|real(?:\s*\([^)]*\))?|integer(?:\s*\([^)]*\))?|double\s+precision|logical)\s+)*(subroutine|function|program|module)\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?:\(([^)]*)\))?/i.exec(
              clean,
            );
          if (headerMatch) {
            const hKind = headerMatch[1]!.toLowerCase();
            const hName = headerMatch[2]!;
            if (hKind === "module") {
              if (!primaryUnit) {
                routineKind = "module";
                routineName = hName;
              }
              continue;
            }
            if (primaryUnit && hName.toUpperCase() !== primaryUnit.name.toUpperCase()) {
              insideHelperUnit = true;
              continue;
            }
            insideHelperUnit = false;
            routineKind = hKind;
            routineName = hName;
            if (headerMatch[3]) {
              for (const arg of headerMatch[3].split(",")) {
                const a = arg.trim();
                if (a) dummyArgs.push(a);
              }
            }
            continue;
          }

          if (/^end\b/i.test(clean)) {
            if (/^end\s*(?:if|do)\b/i.test(clean)) {
              if (!insideHelperUnit && guardStack.length > 0) guardStack.pop();
            } else if (/^end(?:\s+(?:subroutine|function|program))?\b/i.test(clean)) {
              insideHelperUnit = false;
            }
            continue;
          }

          if (insideHelperUnit) continue;

          if (
            /^implicit\b/i.test(clean) ||
            /^return\b/i.test(clean) ||
            /^continue\b/i.test(clean) ||
            /^contains\b/i.test(clean) ||
            /^use\b/i.test(clean)
          ) {
            continue;
          }

          // IF / ELSEIF / ELSE / DO control headers
          const ifMatch = /^if\s*\((.+)\)\s*then$/i.exec(clean);
          if (ifMatch) {
            guardStack.push(`IF (${ifMatch[1]!.trim()})`);
            continue;
          }
          const elseIfMatch = /^else\s*if\s*\((.+)\)\s*then$/i.exec(clean);
          if (elseIfMatch) {
            if (guardStack.length > 0) guardStack.pop();
            guardStack.push(`ELSE IF (${elseIfMatch[1]!.trim()})`);
            continue;
          }
          if (/^else$/i.test(clean)) {
            const prev = guardStack.pop() ?? "IF";
            guardStack.push(`ELSE [${prev}]`);
            continue;
          }
          const doMatch = /^do\s+(?:\d+\s+)?([A-Za-z_][A-Za-z0-9_]*\s*=\s*.+)$/i.exec(clean);
          if (doMatch) {
            guardStack.push(`DO ${doMatch[1]!.trim()}`);
            continue;
          }

          // PARAMETER (NAME = VAL, ...)
          const paramStmtMatch = /^parameter\s*\((.+)\)$/i.exec(clean);
          if (paramStmtMatch) {
            for (const item of paramStmtMatch[1]!.split(",")) {
              const kv = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/.exec(item.trim());
              if (kv) {
                constants.set(kv[1]!.toLowerCase(), { name: kv[1]!, value: kv[2]!.trim() });
              }
            }
            continue;
          }

          // Type declarations: REAL(8), INTENT(IN), DIMENSION(3,3) :: p_c, a_t
          const declMatch =
            /^((?:real|integer|double\s+precision|logical|complex|character)\s*(?:\([^)]*\)|\*\d+)?)\s*((?:,\s*[A-Za-z_][A-Za-z0-9_]*(?:\s*\([^)]*\))?)*)\s*(?:::)?\s*(.+)$/i.exec(
              clean,
            );
          if (declMatch && (!clean.includes("=") || clean.includes("::"))) {
            const baseType = declMatch[1]!.toUpperCase().replace(/\s+/g, " ");
            const attrs = declMatch[2] ?? "";
            const varPart = declMatch[3]!;
            const intentMatch = /\bintent\s*\(\s*(in\s*out|inout|in|out)\s*\)/i.exec(attrs);
            const intent = intentMatch ? intentMatch[1]!.replace(/\s+/g, "").toLowerCase() : null;
            const attrDimMatch = /\bdimension\s*\(([^)]*)\)/i.exec(attrs);
            const attrDimStr = attrDimMatch ? `[${attrDimMatch[1]!.replace(/\s*,\s*/g, "×")}]` : "";

            const items: string[] = [];
            let depth = 0;
            let cur = "";
            for (const ch of varPart) {
              if (ch === "(" || ch === "[") depth++;
              else if (ch === ")" || ch === "]") depth = Math.max(0, depth - 1);
              if (ch === "," && depth === 0) {
                items.push(cur.trim());
                cur = "";
              } else {
                cur += ch;
              }
            }
            if (cur.trim()) items.push(cur.trim());

            for (const item of items) {
              const m = /^([A-Za-z_][A-Za-z0-9_]*)(?:\s*\(([^)]*)\))?(?:\s*=\s*(.+))?$/.exec(item);
              if (!m) continue;
              const vName = m[1]!;
              const lower = vName.toLowerCase();
              const inlineDim = m[2] ? `[${m[2].replace(/\s*,\s*/g, "×")}]` : attrDimStr;
              const initVal = m[3]?.trim();
              varTypes.set(lower, inlineDim ? `${baseType} ${inlineDim}` : baseType);
              if (intent === "in") {
                inputVars.set(lower, vName);
              } else if (intent === "out") {
                outputVars.set(lower, vName);
              } else if (intent === "inout") {
                inputVars.set(lower, vName);
                outputVars.set(lower, vName);
              } else if (initVal !== undefined) {
                constants.set(lower, { name: vName, value: initVal });
              }
            }
            continue;
          }

          // CALL statement: CALL SUB(a, b, c)
          const callMatch = /^call\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?:\((.*)\))?$/i.exec(clean);
          if (callMatch) {
            const subName = callMatch[1]!;
            const args = callMatch[2]
              ? callMatch[2]
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean)
              : [];
            callBlocks.push({
              id: `call_${lineIdx}_${subName}`,
              subroutine: subName,
              args,
              lineIdx,
            });
            continue;
          }

          // Assignment statement: LHS = RHS
          const assignMatch = /^(\$?[A-Za-z_][A-Za-z0-9_]*(?:\s*\([^)]+\))?)\s*=\s*(.+)$/.exec(clean);
          if (assignMatch && !assignMatch[2]!.startsWith("=")) {
            const lhs = assignMatch[1]!.trim();
            const rhs = assignMatch[2]!.trim();
            const isState = /^(?:STORF|STORI|SD|S)\s*\(/i.test(lhs) || /^der_/i.test(lhs);
            equations.push({
              id: `eq_${lineIdx}_${lhs.replace(/[^A-Za-z0-9_]/g, "_")}`,
              lhs,
              rhs,
              isState,
              lineIdx,
              condGuard: guardStack.length > 0 ? guardStack[guardStack.length - 1] : undefined,
            });

            // Discover $Port references on LHS/RHS
            if (lhs.startsWith("$")) {
              const pName = lhs.slice(1);
              outputVars.set(pName.toLowerCase(), pName);
            }
            const portRegex = /\$([A-Za-z_][A-Za-z0-9_]*)/g;
            let pm: RegExpExecArray | null;
            while ((pm = portRegex.exec(rhs)) !== null) {
              const pName = pm[1]!;
              if (!outputVars.has(pName.toLowerCase())) {
                inputVars.set(pName.toLowerCase(), pName);
              }
            }
          }
        }

        // If dummyArgs were declared without explicit INTENT(IN/OUT), infer inputs vs outputs from assignments
        const assignedLowers = new Set(
          equations.map((e) =>
            e.lhs
              .replace(/\s*\([^)]*\)$/, "")
              .replace(/^\$/, "")
              .toLowerCase(),
          ),
        );
        for (const arg of dummyArgs) {
          const lower = arg.toLowerCase();
          if (!inputVars.has(lower) && !outputVars.has(lower)) {
            if (assignedLowers.has(lower)) outputVars.set(lower, arg);
            else inputVars.set(lower, arg);
          }
        }

        // Track producer node ID for each variable (lowerName -> nodeId)
        const producerByVar = new Map<string, string>();

        // Column 0 (Left): Input Port Nodes & Referenced Constants
        let leftRow = 0;
        for (const [lower, dispName] of inputVars.entries()) {
          const nodeId = `in_${lower}`;
          const tStr = varTypes.get(lower) ?? "REAL(8)";
          nodes.push(
            makeStyledNode({
              id: nodeId,
              name: dispName,
              kind: "InputPort",
              stereotype: "intent(in)",
              subtitle: `${tStr} Input`,
              stroke: "#0d9488",
              fill: "#f0fdfa",
              headerFill: "#ccfbf1",
              x: 60,
              y: 70 + leftRow * 110,
            }),
          );
          producerByVar.set(lower, nodeId);
          leftRow++;
        }

        for (const [lower, cInfo] of constants.entries()) {
          const nodeId = `const_${lower}`;
          const tStr = varTypes.get(lower) ?? "REAL(8)";
          nodes.push(
            makeStyledNode({
              id: nodeId,
              name: cInfo.name,
              kind: "Constant",
              stereotype: "constant",
              subtitle: `${tStr} = ${cInfo.value}`,
              stroke: "#4f46e5",
              fill: "#eef2ff",
              headerFill: "#e0e7ff",
              x: 60,
              y: 70 + leftRow * 110,
            }),
          );
          producerByVar.set(lower, nodeId);
          leftRow++;
        }

        // Column 1 (Center): Equation & Subroutine Call Blocks
        let centerRow = 0;
        const intrinsicSet = new Set([
          "sqrt",
          "abs",
          "sin",
          "cos",
          "tan",
          "asin",
          "acos",
          "atan",
          "atan2",
          "exp",
          "log",
          "log10",
          "min",
          "max",
          "mod",
          "sign",
          "sum",
          "maxval",
          "minval",
          "size",
          "dot_product",
          "matmul",
          "storf",
          "stori",
          "sd",
          "s",
        ]);

        for (const eq of equations) {
          const baseLhs = eq.lhs.replace(/\s*\([^)]*\)$/, "").replace(/^\$/, "");
          const lowerLhs = baseLhs.toLowerCase();
          const isOutputTarget = outputVars.has(lowerLhs);
          const entries = [`${eq.lhs} = ${eq.rhs}`];
          if (eq.condGuard) {
            entries.unshift(`[Guard] ${eq.condGuard}`);
          }

          nodes.push(
            makeStyledNode({
              id: eq.id,
              name: eq.lhs,
              kind: eq.isState ? "StateEquation" : "Equation",
              stereotype: eq.isState ? "state derivative" : isOutputTarget ? "output equation" : "algebraic block",
              subtitle: `${routineName} · line ${eq.lineIdx + 1}`,
              entries,
              stroke: eq.isState ? "#e11d48" : "#0284c7",
              fill: eq.isState ? "#fff1f2" : "#f0f9ff",
              headerFill: eq.isState ? "#ffe4e6" : "#e0f2fe",
              x: 390,
              y: 70 + centerRow * 135,
            }),
          );
          centerRow++;

          // Connect upstream producers referenced in RHS -> eq.id
          const refRegex = /\$?([A-Za-z_][A-Za-z0-9_]*)/g;
          const connectedSources = new Set<string>();
          let rm: RegExpExecArray | null;
          while ((rm = refRegex.exec(eq.rhs)) !== null) {
            const refIdent = rm[1]!;
            const refLower = refIdent.toLowerCase();
            if (intrinsicSet.has(refLower)) continue;
            const srcNodeId = producerByVar.get(refLower);
            if (srcNodeId && srcNodeId !== eq.id && !connectedSources.has(srcNodeId)) {
              connectedSources.add(srcNodeId);
              edges.push(
                makeStyledEdge(
                  `edge_${srcNodeId}_${eq.id}`,
                  srcNodeId,
                  eq.id,
                  srcNodeId.startsWith("const_"),
                  refIdent,
                ),
              );
            }
          }

          producerByVar.set(lowerLhs, eq.id);
        }

        for (const callBlk of callBlocks) {
          const subUpper = callBlk.subroutine.toUpperCase();
          const calleeSummary = unitSummaries.get(subUpper);
          const callEntries: string[] = [];
          if (calleeSummary) {
            const inParams = calleeSummary.params.filter(
              (p) => (calleeSummary.intents.get(p.toLowerCase()) ?? "in") !== "out",
            );
            const outParams = calleeSummary.params.filter((p) => {
              const int = calleeSummary.intents.get(p.toLowerCase());
              return int === "out" || int === "inout";
            });
            callEntries.push(`${inParams.join(", ") || "()"} → ${outParams.join(", ") || "void"}`);
          }

          nodes.push(
            makeStyledNode({
              id: callBlk.id,
              name: `CALL ${callBlk.subroutine}`,
              kind: "SubroutineCall",
              stereotype: calleeSummary ? "module subroutine" : "subroutine call",
              subtitle: `(${callBlk.args.join(", ")})`,
              entries: callEntries.length > 0 ? callEntries : undefined,
              stroke: "#7c3aed",
              fill: "#f5f3ff",
              headerFill: "#ede9fe",
              x: 390,
              y: 70 + centerRow * 135,
            }),
          );
          centerRow++;

          // Wire arguments: use callee signature intents if known, else EMTDC convention (last arg = output)
          const defaultOutIdx =
            ["REALPOLE", "DELAY1", "INTGRL", "LEADLAG", "DIFF", "LIMITER", "LIMIT", "HARDLIMIT"].includes(subUpper) &&
            callBlk.args.length >= 2
              ? callBlk.args.length - 1
              : -1;

          callBlk.args.forEach((argStr, idx) => {
            const identMatch = /^\$?([A-Za-z_][A-Za-z0-9_]*)$/.exec(argStr);
            if (!identMatch) return;
            const vName = identMatch[1]!;
            const vLower = vName.toLowerCase();

            let isOutArg = idx === defaultOutIdx;
            let isInArg = idx !== defaultOutIdx;
            if (calleeSummary && calleeSummary.params[idx]) {
              const formalIntent = calleeSummary.intents.get(calleeSummary.params[idx]!.toLowerCase());
              if (formalIntent === "out") {
                isOutArg = true;
                isInArg = false;
              } else if (formalIntent === "inout") {
                isOutArg = true;
                isInArg = true;
              } else if (formalIntent === "in") {
                isOutArg = false;
                isInArg = true;
              }
            }

            if (isInArg) {
              const srcId = producerByVar.get(vLower);
              if (srcId) {
                edges.push(makeStyledEdge(`edge_${srcId}_${callBlk.id}`, srcId, callBlk.id, false, vName));
              }
            }
            if (isOutArg) {
              producerByVar.set(vLower, callBlk.id);
            }
          });
        }

        // Column 2 (Right): Output Port Terminal Nodes
        let rightRow = 0;
        for (const [lower, dispName] of outputVars.entries()) {
          const outNodeId = `out_${lower}`;
          const tStr = varTypes.get(lower) ?? "REAL(8)";
          nodes.push(
            makeStyledNode({
              id: outNodeId,
              name: dispName,
              kind: "OutputPort",
              stereotype: "intent(out)",
              subtitle: `${tStr} Output`,
              stroke: "#d97706",
              fill: "#fffbeb",
              headerFill: "#fef3c7",
              x: 780,
              y: 70 + rightRow * 120,
            }),
          );
          rightRow++;

          const srcId = producerByVar.get(lower);
          if (srcId && srcId !== outNodeId) {
            edges.push(makeStyledEdge(`edge_${srcId}_${outNodeId}`, srcId, outNodeId, false, dispName));
          }
        }

        // If the file only had a subroutine header with no equations yet, emit a clean header node
        if (nodes.length === 0) {
          nodes.push(
            makeStyledNode({
              id: `sub_${routineName}`,
              name: routineName,
              kind: "Subroutine",
              stereotype: routineKind,
              subtitle: dummyArgs.length > 0 ? `(${dummyArgs.join(", ")})` : "()",
              stroke: "#0284c7",
              fill: "#f0f9ff",
              headerFill: "#e0f2fe",
              x: 120,
              y: 80,
            }),
          );
        }
      }

      if (nodes.length === 0 && plugin?.customHandlers?.symbols) {
        try {
          const syms = plugin.customHandlers.symbols(docText) ?? [];
          let idx = 0;
          const visitSym = (sym: any, parentId?: string) => {
            if (!sym || !sym.name) return;
            const nodeId = parentId ? `${parentId}.${sym.name}` : sym.name;
            if (!nodes.some((n) => n.id === nodeId)) {
              const col = idx % 3;
              const row = Math.floor(idx / 3);
              idx++;
              const kindStr = String(sym.kind ?? "component");
              nodes.push(
                makeStyledNode({
                  id: nodeId,
                  name: sym.name,
                  kind: kindStr,
                  stereotype: kindStr.toLowerCase(),
                  subtitle: sym.detail ? String(sym.detail) : undefined,
                  stroke: "#0284c7",
                  fill: "#f0f9ff",
                  x: 80 + col * 240,
                  y: 80 + row * 130,
                }),
              );
            }
            if (parentId) {
              edges.push(makeStyledEdge(`edge_${parentId}_${nodeId}`, parentId, nodeId));
            }
            if (Array.isArray(sym.children)) {
              for (const child of sym.children) {
                visitSym(child, nodeId);
              }
            }
          };
          for (const s of syms) {
            visitSym(s);
          }
          if (edges.length === 0 && nodes.length > 1) {
            for (let i = 0; i < nodes.length - 1; i++) {
              edges.push(makeStyledEdge(`edge_${i}_${i + 1}`, nodes[i]!.id, nodes[i + 1]!.id));
            }
          }
        } catch {
          // fall through to structural line synthesis
        }
      }

      if (nodes.length === 0) {
        const hasGrammarOrSymbols = Boolean(
          config ||
          isScad ||
          isFortran ||
          plugin?.customHandlers?.symbols ||
          plugin?.languageDef?.diagram ||
          plugin?.id === "modelica" ||
          plugin?.id === "sysml2" ||
          plugin?.id === "owl2",
        );
        if (!hasGrammarOrSymbols) {
          const langLabel = plugin?.name || plugin?.id || "this file type";
          throw new Error(`Diagram view is not supported for ${langLabel}.`);
        }
      }

      diagramData = {
        nodes,
        edges,
        coordinateSystem: null,
        diagramBackground: null,
      };
    }

    if (!diagramData) return null;

    if (params.sidecarContent) {
      try {
        const storage = this.getLayoutStorage(params.uri);
        const parser = (storage as any).options?.parse ?? parseLayout;
        const parsed = parser(params.sidecarContent);
        if (parsed) {
          (storage as any).cache?.set(params.uri, parsed);
        }
      } catch {
        // ignore
      }
    }

    // Merge persisted layout if available
    const layout = await this.getLayoutStorage(params.uri).loadLayout(params.uri);
    if (layout && diagramData) {
      for (const node of diagramData.nodes) {
        const nodeName = (node as any).name || node.properties?.description;
        const el = layout.elements[node.id] || (nodeName && layout.elements[nodeName]);
        if (el) {
          node.x = el.x;
          node.y = el.y;
          if (el.width) node.width = el.width;
          if (el.height) node.height = el.height;
          node.autoLayout = false;
        }
      }
    }

    return diagramData as any;
  }

  getComponentProperties(params: DiagramGetComponentPropertiesParams): ComponentPropertyData | null {
    const config = this.deps.getDiagramConfig?.(params.uri);
    const propConfig = (config as any)?.properties;
    if (propConfig) {
      const className = params.className || "Component";

      // 1. Dynamic in-model discovery hook
      if (typeof propConfig.inModelDiscovery?.extractSchema === "function") {
        try {
          const symIndex = this.deps.getSymbolIndex?.(params.uri);
          const rawAst = this.deps.getRawAstData?.(params.uri);
          const dynamicSchema = propConfig.inModelDiscovery.extractSchema(rawAst, params.componentName, symIndex);
          if (dynamicSchema) {
            const dynamicValues =
              typeof propConfig.inModelDiscovery.extractValues === "function"
                ? propConfig.inModelDiscovery.extractValues(rawAst, params.componentName, symIndex)
                : { name: params.componentName };
            return {
              className,
              name: params.componentName,
              description: "",
              parameters: [],
              schema: dynamicSchema,
              values: dynamicValues || { name: params.componentName },
            };
          }
        } catch (e) {
          console.error("[diagram] inModelDiscovery.extractSchema error:", e);
        }
      }

      // 2. Static schema lookup fallback
      const schema =
        propConfig.entities?.[className] ||
        (propConfig.entities && Object.keys(propConfig.entities).length > 0
          ? Object.values(propConfig.entities)[0]
          : undefined);
      if (schema) {
        return {
          className,
          name: params.componentName,
          description: "",
          parameters: [],
          schema,
          values: { name: params.componentName },
        };
      }
    }

    // 3. Universal source-text parameter extraction fallback
    const docText = this.deps.getDocumentText(params.uri);
    const parameters: ComponentPropertyData["parameters"] = [];
    const values: Record<string, any> = { name: params.componentName };
    const fields: PropertyFieldConfig[] = [];
    if (docText) {
      const lines = docText.split(/\r?\n/);
      const targetName = params.componentName.split(".").pop() ?? params.componentName;
      let startLine = 0;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i]!.includes(targetName)) {
          startLine = i;
          break;
        }
      }
      const windowEnd = Math.min(lines.length, startLine + 12);
      const seenKeys = new Set<string>();
      for (let i = startLine; i < windowEnd; i++) {
        const line = lines[i]!;
        const kvRegex = /\b([A-Za-z_][A-Za-z0-9_.-]*)\s*(?:=|:)\s*["']?([^"',;)}\s>\r\n]+)["']?/g;
        let m: RegExpExecArray | null;
        while ((m = kvRegex.exec(line)) !== null) {
          const k = m[1]!;
          const v = m[2]!;
          if (seenKeys.has(k)) continue;
          seenKeys.add(k);
          parameters.push({ name: k, value: v, description: `Parameter '${k}'` });
          values[k] = v;
          fields.push({
            key: k,
            label: k,
            kind: !isNaN(Number(v)) ? "number" : "string",
            defaultValue: !isNaN(Number(v)) ? Number(v) : v,
          });
        }
      }
    }

    return {
      className: params.className || "Component",
      name: params.componentName,
      description: "",
      parameters,
      schema:
        fields.length > 0
          ? {
              title: params.componentName,
              tabs: [{ id: "general", label: "General", groups: [{ id: "params", label: "Parameters", fields }] }],
            }
          : undefined,
      values,
    };
  }

  getPalette(params: DiagramGetPaletteParams): DiagramPalette | null {
    const config = this.deps.getDiagramConfig?.(params.uri);
    if (config?.palette?.categories) {
      return { categories: config.palette.categories };
    }
    return null;
  }

  async drillDown(params: DiagramDrillDownParams): Promise<DiagramDrillDownResult | null> {
    const symbolIndex = this.deps.getSymbolIndex?.(params.uri);
    const targetName = params.className || params.componentName;
    if (!targetName) return null;

    let targetUri = params.uri;
    if (symbolIndex) {
      for (const [, sym] of symbolIndex.symbols) {
        if (sym.name === targetName) {
          if (sym.resourceId) targetUri = sym.resourceId;
          break;
        }
      }
    }

    const breadcrumbs = [
      { id: "root", label: "Root", uri: params.uri },
      { id: params.nodeId || targetName, label: targetName, uri: targetUri },
    ];

    const childData = await this.getData({
      uri: targetUri,
      className: targetName,
    });

    return {
      targetUri,
      targetClassName: targetName,
      breadcrumbs,
      data: childData ?? null,
    };
  }

  async applyEdits(params: DiagramApplyEditsParams): Promise<DiagramApplyEditsResult> {
    const allEdits: TextEdit[] = [];
    const itemsToSave: any[] = [];
    const docText = this.deps.getDocumentText(params.uri);
    const maskedText = docText !== undefined ? maskComments(docText) : undefined;
    const lines = docText !== undefined ? docText.split("\n") : [];
    const maskedLines = maskedText !== undefined ? maskedText.split("\n") : [];
    const config = this.deps.getDiagramConfig?.(params.uri);
    const mutations = config?.mutations;

    for (const action of params.actions) {
      switch (action.type) {
        case "move": {
          const moveItems: PlacementItem[] = Array.isArray(action.items)
            ? action.items
            : (action as any).nodeId && (action as any).position
              ? [
                  {
                    name: String((action as any).nodeId),
                    x: (action as any).position.x,
                    y: (action as any).position.y,
                    width: (action as any).width ?? (action as any).size?.width ?? 0,
                    height: (action as any).height ?? (action as any).size?.height ?? 0,
                  },
                ]
              : [];
          if (config?.placement?.persistence === "inline" && docText !== undefined) {
            for (const item of moveItems) {
              const name = item.name;
              const escName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
              const nameRegex = new RegExp(`\\b${escName}\\b`);
              for (let i = 0; i < lines.length; i++) {
                if (nameRegex.test(maskedLines[i]!)) {
                  const line = lines[i]!;
                  const placementStr = config.placement.formatPlacement
                    ? config.placement.formatPlacement(item.x, item.y, item.width, item.height, item.rotation)
                    : `@layout(x=${Math.round(item.x)}, y=${Math.round(item.y)})`;

                  const span = findInlinePlacementSpan(line);
                  if (span) {
                    allEdits.push({
                      range: {
                        start: { line: i, character: span.start },
                        end: { line: i, character: span.end },
                      },
                      newText: placementStr,
                    });
                  } else {
                    const semiIdx = line.lastIndexOf(";");
                    if (semiIdx !== -1) {
                      allEdits.push({
                        range: {
                          start: { line: i, character: semiIdx },
                          end: { line: i, character: semiIdx },
                        },
                        newText: ` ${placementStr}`,
                      });
                    } else {
                      allEdits.push({
                        range: {
                          start: { line: i, character: line.length },
                          end: { line: i, character: line.length },
                        },
                        newText: ` ${placementStr}`,
                      });
                    }
                  }
                  break;
                }
              }
            }
          } else {
            itemsToSave.push(...moveItems);
          }
          break;
        }
        case "resize":
        case "rotate": {
          if (config?.placement?.persistence === "inline" && docText !== undefined) {
            const item = action.item;
            const escName = item.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            const nameRegex = new RegExp(`\\b${escName}\\b`);
            for (let i = 0; i < lines.length; i++) {
              if (nameRegex.test(maskedLines[i]!)) {
                const line = lines[i]!;
                const placementStr = config.placement.formatPlacement
                  ? config.placement.formatPlacement(item.x, item.y, item.width, item.height, item.rotation)
                  : `@layout(x=${Math.round(item.x)}, y=${Math.round(item.y)})`;

                const span = findInlinePlacementSpan(line);
                if (span) {
                  allEdits.push({
                    range: {
                      start: { line: i, character: span.start },
                      end: { line: i, character: span.end },
                    },
                    newText: placementStr,
                  });
                } else {
                  const semiIdx = line.lastIndexOf(";");
                  if (semiIdx !== -1) {
                    allEdits.push({
                      range: {
                        start: { line: i, character: semiIdx },
                        end: { line: i, character: semiIdx },
                      },
                      newText: ` ${placementStr}`,
                    });
                  }
                }
                break;
              }
            }
          } else {
            itemsToSave.push(action.item);
          }
          break;
        }
        case "connect": {
          let edgeText = "";
          const edgeTemplates = mutations?.edgeTemplates;
          const edgeTemplate =
            (action.edgeType && edgeTemplates?.[action.edgeType]) || mutations?.edgeTemplate || mutations?.createEdge;

          if (typeof edgeTemplate === "function") {
            edgeText = edgeTemplate(action.source, action.target, action.sourcePort, action.targetPort);
          } else if (typeof edgeTemplate === "string") {
            edgeText = edgeTemplate
              .replace(/\$\{source\}/g, action.source)
              .replace(/\$\{target\}/g, action.target)
              .replace(/\$\{sourcePort\}/g, action.sourcePort ?? "")
              .replace(/\$\{targetPort\}/g, action.targetPort ?? "");
          } else {
            const src = action.sourcePort ? `${action.source}.${action.sourcePort}` : action.source;
            const tgt = action.targetPort ? `${action.target}.${action.targetPort}` : action.target;
            edgeText = `connect(${src}, ${tgt});\n`;
          }

          if (docText !== undefined && edgeText) {
            const targetSection =
              action.section || mutations?.sections?.edge || mutations?.insertionSection || mutations?.defaultSection;
            insertIntoSectionOrRoot(lines, allEdits, edgeText, targetSection);
          }

          if (action.points && action.points.length > 0) {
            await this.getLayoutStorage(params.uri).updatePositions(params.uri, [
              {
                name: action.source,
                x: 0,
                y: 0,
                width: 0,
                height: 0,
                rotation: 0,
                edges: [{ source: action.source, target: action.target, points: action.points }],
                connectedOnly: true,
              },
            ]);
          }
          break;
        }
        case "disconnect": {
          if (docText !== undefined) {
            const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            const srcPattern = action.sourcePort
              ? `${esc(action.source)}\\.${esc(action.sourcePort)}`
              : esc(action.source);
            const tgtPattern = action.targetPort
              ? `${esc(action.target)}\\.${esc(action.targetPort)}`
              : esc(action.target);
            const edgeRegex = new RegExp(
              `\\b${srcPattern}\\b.*\\b${tgtPattern}\\b|\\b${tgtPattern}\\b.*\\b${srcPattern}\\b`,
            );

            for (let i = 0; i < lines.length; i++) {
              if (edgeRegex.test(maskedLines[i]!)) {
                let endLine = i;
                if (maskedLines[i]!.includes("(") && !maskedLines[i]!.trimEnd().endsWith(";")) {
                  let parenDepth = 0;
                  for (let l = i; l < Math.min(lines.length, i + 20); l++) {
                    const ml = maskedLines[l]!;
                    for (let c = 0; c < ml.length; c++) {
                      if (ml[c] === "(" || ml[c] === "{") parenDepth++;
                      else if (ml[c] === ")" || ml[c] === "}") {
                        if (parenDepth > 0) parenDepth--;
                      } else if (ml[c] === ";" && parenDepth === 0) {
                        endLine = l;
                        l = lines.length;
                        break;
                      }
                    }
                  }
                }
                allEdits.push({
                  range: {
                    start: { line: i, character: 0 },
                    end: { line: endLine + 1, character: 0 },
                  },
                  newText: "",
                });
                break;
              }
            }
          }
          break;
        }
        case "reconnect": {
          if (docText !== undefined) {
            let replaced = false;
            const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            const oldSrcPattern = action.oldSourcePort
              ? `${esc(action.oldSource)}\\.${esc(action.oldSourcePort)}`
              : esc(action.oldSource);
            const oldTgtPattern = action.oldTargetPort
              ? `${esc(action.oldTarget)}\\.${esc(action.oldTargetPort)}`
              : esc(action.oldTarget);
            const oldEdgeRegex = new RegExp(
              `\\b${oldSrcPattern}\\b.*\\b${oldTgtPattern}\\b|\\b${oldTgtPattern}\\b.*\\b${oldSrcPattern}\\b`,
            );

            for (let i = 0; i < lines.length; i++) {
              const line = lines[i]!;
              if (oldEdgeRegex.test(maskedLines[i]!)) {
                let endLine = i;
                if (maskedLines[i]!.includes("(") && !maskedLines[i]!.trimEnd().endsWith(";")) {
                  let parenDepth = 0;
                  for (let l = i; l < Math.min(lines.length, i + 20); l++) {
                    const ml = maskedLines[l]!;
                    for (let c = 0; c < ml.length; c++) {
                      if (ml[c] === "(" || ml[c] === "{") parenDepth++;
                      else if (ml[c] === ")" || ml[c] === "}") {
                        if (parenDepth > 0) parenDepth--;
                      } else if (ml[c] === ";" && parenDepth === 0) {
                        endLine = l;
                        l = lines.length;
                        break;
                      }
                    }
                  }
                }

                let newEdgeText = "";
                const edgeTemplates = mutations?.edgeTemplates;
                const edgeTemplate =
                  (action.edgeType && edgeTemplates?.[action.edgeType]) ||
                  mutations?.edgeTemplate ||
                  mutations?.createEdge;

                if (typeof edgeTemplate === "function") {
                  newEdgeText = edgeTemplate(
                    action.newSource,
                    action.newTarget,
                    action.newSourcePort,
                    action.newTargetPort,
                  );
                } else if (typeof edgeTemplate === "string") {
                  newEdgeText = edgeTemplate
                    .replace(/\$\{source\}/g, action.newSource)
                    .replace(/\$\{target\}/g, action.newTarget)
                    .replace(/\$\{sourcePort\}/g, action.newSourcePort ?? "")
                    .replace(/\$\{targetPort\}/g, action.newTargetPort ?? "");
                } else {
                  const src = action.newSourcePort ? `${action.newSource}.${action.newSourcePort}` : action.newSource;
                  const tgt = action.newTargetPort ? `${action.newTarget}.${action.newTargetPort}` : action.newTarget;
                  const fullOldStatement = lines.slice(i, endLine + 1).join("\n");
                  const annotMatch = fullOldStatement.match(/(\s*annotation\s*\(.*\)\s*;?)/s);
                  const existingAnnot = annotMatch ? annotMatch[1] : ";";

                  if (action.points && action.points.length > 0) {
                    const ptsStr = action.points.map((p: any) => `{${p.x}, ${p.y}}`).join(", ");
                    if (existingAnnot && existingAnnot.includes("points")) {
                      const updatedAnnot = replaceBalancedBracesField(existingAnnot, "points", ptsStr);
                      newEdgeText = `connect(${src}, ${tgt})${updatedAnnot}`;
                    } else if (existingAnnot && existingAnnot.startsWith("annotation")) {
                      newEdgeText = `connect(${src}, ${tgt}) ${existingAnnot.trim()}`;
                    } else {
                      newEdgeText = `connect(${src}, ${tgt}) annotation(Line(points={${ptsStr}}));`;
                    }
                  } else {
                    newEdgeText = `connect(${src}, ${tgt})${existingAnnot && existingAnnot.startsWith("annotation") ? ` ${existingAnnot.trim()}` : ";"}`;
                  }
                }

                const indent = line.match(/^\s*/)?.[0] ?? "";
                allEdits.push({
                  range: {
                    start: { line: i, character: 0 },
                    end: { line: endLine, character: lines[endLine]!.length },
                  },
                  newText: indent + newEdgeText.trim(),
                });
                replaced = true;
                break;
              }
            }
            if (!replaced) {
              let edgeText = "";
              const edgeTemplates = mutations?.edgeTemplates;
              const edgeTemplate =
                (action.edgeType && edgeTemplates?.[action.edgeType]) ||
                mutations?.edgeTemplate ||
                mutations?.createEdge;
              if (typeof edgeTemplate === "function") {
                edgeText = edgeTemplate(action.newSource, action.newTarget, action.newSourcePort, action.newTargetPort);
              } else {
                const src = action.newSourcePort ? `${action.newSource}.${action.newSourcePort}` : action.newSource;
                const tgt = action.newTargetPort ? `${action.newTarget}.${action.newTargetPort}` : action.newTarget;
                edgeText = `connect(${src}, ${tgt});\n`;
              }
              const targetSection =
                action.section || mutations?.sections?.edge || mutations?.insertionSection || mutations?.defaultSection;
              insertIntoSectionOrRoot(lines, allEdits, edgeText, targetSection);
            }
          }
          break;
        }
        case "addComponent": {
          const baseName = action.name || action.className.charAt(0).toLowerCase() + action.className.slice(1);
          let uniqueName = action.name || `${baseName}1`;
          if (!action.name && maskedText) {
            let idx = 1;
            while (new RegExp(`\\b${baseName}${idx}\\b`).test(maskedText)) {
              idx++;
            }
            uniqueName = `${baseName}${idx}`;
          }

          let nodeText = "";
          if (typeof mutations?.createNode === "function") {
            nodeText = mutations.createNode(action.className, uniqueName, action.x, action.y);
          } else if (typeof mutations?.nodeTemplate === "function") {
            nodeText = mutations.nodeTemplate(action.className, uniqueName);
          } else if (typeof mutations?.nodeTemplate === "string") {
            nodeText = mutations.nodeTemplate
              .replace(/\$\{className\}/g, action.className)
              .replace(/\$\{name\}/g, uniqueName);
          } else {
            nodeText = `${action.className} ${uniqueName};\n`;
          }

          if (docText !== undefined && nodeText) {
            const targetSection = action.section || mutations?.sections?.node || mutations?.defaultSection;
            insertIntoSectionOrRoot(lines, allEdits, nodeText, targetSection);
          }

          itemsToSave.push({
            name: uniqueName,
            x: Math.round(action.x),
            y: Math.round(action.y),
            width: 120,
            height: 60,
            rotation: 0,
          });
          break;
        }
        case "deleteComponents": {
          if (docText !== undefined) {
            for (const name of action.names) {
              const escName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
              const declRegex = new RegExp(`\\b${escName}\\b`);
              for (let i = 0; i < lines.length; i++) {
                if (declRegex.test(maskedLines[i]!)) {
                  allEdits.push({
                    range: {
                      start: { line: i, character: 0 },
                      end: { line: i + 1, character: 0 },
                    },
                    newText: "",
                  });
                  break;
                }
              }
            }
          }
          break;
        }
        case "moveEdge": {
          for (const e of action.edges) {
            await this.getLayoutStorage(params.uri).updatePositions(params.uri, [
              {
                name: e.source,
                x: 0,
                y: 0,
                width: 0,
                height: 0,
                rotation: 0,
                edges: [{ source: e.source, target: e.target, points: e.points }],
                connectedOnly: true,
              },
            ]);
          }
          break;
        }
        case "updateName": {
          if (action.oldName && action.newName) {
            await this.getLayoutStorage(params.uri).renameElement(params.uri, action.oldName, action.newName);
          }
          if (docText !== undefined && action.oldName && action.newName) {
            const escOld = action.oldName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            const regex = new RegExp(`\\b${escOld}\\b`, "g");
            for (let i = 0; i < lines.length; i++) {
              let match: RegExpExecArray | null;
              while ((match = regex.exec(maskedLines[i]!)) !== null) {
                allEdits.push({
                  range: {
                    start: { line: i, character: match.index },
                    end: { line: i, character: match.index + action.oldName.length },
                  },
                  newText: action.newName,
                });
              }
            }
          }
          break;
        }
        case "updateParameter":
        case "updateProperty": {
          const paramName =
            action.type === "updateProperty"
              ? (action.key ?? (action as any).propertyName ?? (action as any).parameter)
              : action.parameter;
          const paramVal = action.type === "updateProperty" ? action.value : action.value;
          if (docText !== undefined && paramName && paramVal !== undefined) {
            // Check custom mutator hook
            const mutator = config?.properties?.mutator;
            if (typeof mutator?.updateProperty === "function") {
              try {
                const prevVal = (action as any).previousValue;
                const rawAst = this.deps.getRawAstData?.(params.uri);
                let customEdits = mutator.updateProperty(rawAst ?? docText, action.name, paramName, paramVal, prevVal);
                if (!customEdits) {
                  customEdits = (mutator.updateProperty as any)(action.name, paramName, paramVal, docText);
                }
                if (Array.isArray(customEdits) && customEdits.length > 0) {
                  allEdits.push(...customEdits);
                  break;
                }
              } catch (e) {
                console.error("[diagram] mutator.updateProperty error:", e);
              }
            } else if (typeof mutator?.updateModifier === "function") {
              try {
                const customEdits = mutator.updateModifier(docText, action.name, paramName, paramVal);
                if (Array.isArray(customEdits) && customEdits.length > 0) {
                  allEdits.push(...customEdits);
                  break;
                }
              } catch (e) {
                console.error("[diagram] mutator.updateModifier error:", e);
              }
            }

            const escParam = paramName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            const paramRegex = new RegExp(`\\b(${escParam}\\s*(?:=|:)\\s*["']?)([^"',;\\)\\}\\s>\\n]+)`);
            let matched = false;

            if (action.name) {
              const escName = action.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
              const nameRegex = new RegExp(`\\b${escName}\\b`);
              for (let i = 0; i < lines.length; i++) {
                if (nameRegex.test(maskedLines[i]!)) {
                  for (let j = i; j < Math.min(lines.length, i + 6); j++) {
                    const m = paramRegex.exec(maskedLines[j]!);
                    if (m) {
                      const startCol = m.index + m[1]!.length;
                      const endCol = startCol + m[2]!.trimEnd().length;
                      allEdits.push({
                        range: {
                          start: { line: j, character: startCol },
                          end: { line: j, character: endCol },
                        },
                        newText: String(paramVal),
                      });
                      matched = true;
                      break;
                    }
                  }
                  if (matched) break;
                }
              }
            }

            if (!matched) {
              for (let i = 0; i < lines.length; i++) {
                const m = paramRegex.exec(maskedLines[i]!);
                if (m) {
                  const startCol = m.index + m[1]!.length;
                  const endCol = startCol + m[2]!.trimEnd().length;
                  allEdits.push({
                    range: {
                      start: { line: i, character: startCol },
                      end: { line: i, character: endCol },
                    },
                    newText: String(paramVal),
                  });
                  matched = true;
                  break;
                }
              }
            }

            // If not matched, try appending new modifier to component declaration
            if (!matched && action.name) {
              const escName = action.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
              const nameRegex = new RegExp(`\\b${escName}\\b`);
              for (let i = 0; i < lines.length; i++) {
                if (nameRegex.test(maskedLines[i]!)) {
                  const openParen = lines[i]!.indexOf("(", lines[i]!.indexOf(action.name));
                  const closeParen = lines[i]!.lastIndexOf(")");
                  if (openParen !== -1 && closeParen !== -1 && closeParen > openParen) {
                    const hasArgs = lines[i]!.substring(openParen + 1, closeParen).trim().length > 0;
                    allEdits.push({
                      range: {
                        start: { line: i, character: closeParen },
                        end: { line: i, character: closeParen },
                      },
                      newText: `${hasArgs ? ", " : ""}${paramName} = ${paramVal}`,
                    });
                    matched = true;
                    break;
                  }
                }
              }
            }
          }
          break;
        }
      }
    }

    let sidecarUri: string | undefined;
    let sidecarContent: string | undefined;
    if (itemsToSave.length > 0) {
      const storage = this.getLayoutStorage(params.uri);
      await storage.updatePositions(params.uri, itemsToSave);
      const updatedLayout = await storage.loadLayout(params.uri);
      if (updatedLayout) {
        sidecarUri = storage.getSidecarUri(params.uri);
        const serialize = (storage as any).options?.serialize ?? ((l: any) => JSON.stringify(l, null, 2) + "\n");
        try {
          sidecarContent = serialize(updatedLayout);
        } catch {
          // ignore
        }
      }
    }

    return {
      seq: params.seq,
      edits: allEdits,
      renderHint: allEdits.length > 0 ? "immediate" : itemsToSave.length > 0 ? "none" : "immediate",
      sidecarUri,
      sidecarContent,
    };
  }
}

// ── Dispatch Factory ──

export interface DiagramDispatchDeps {
  modelica?: DiagramBackend | undefined;
  sysml2?: DiagramBackend | undefined;
  generic?: DiagramBackend | undefined;
  owl2?: DiagramBackend | undefined;
  simulink?: DiagramBackend | undefined;
  spice?: DiagramBackend | undefined;
  opendrive?: DiagramBackend | undefined;
  simpack?: DiagramBackend | undefined;
  gensys?: DiagramBackend | undefined;
  adams?: DiagramBackend | undefined;
  urdf?: DiagramBackend | undefined;
  customBackends?: Map<string | RegExp, DiagramBackend> | undefined;
}

const DOMAIN_BUILDERS: Record<string, (text: string, params: DiagramGetDataParams) => Promise<unknown>> = {
  simpack: async (text) => {
    const { parseSpckXml, parseSimDeck, buildSimpackDiagram } = await import("@modelscript/simpack");
    const isXml = text.trimStart().startsWith("<");
    const model = isXml ? parseSpckXml(text) : parseSimDeck(text);
    return buildSimpackDiagram(model);
  },
  gensys: async (text) => {
    const { parseGensysDeck, buildGensysDiagram } = await import("@modelscript/gensys");
    return buildGensysDiagram(parseGensysDeck(text));
  },
  adams: async (text) => {
    const { parseAdams, buildAdamsDiagram } = await import("@modelscript/adams");
    return buildAdamsDiagram(parseAdams(text));
  },
  urdf: async (text) => {
    const { parseUrdf, buildUrdfDiagram } = await import("@modelscript/urdf");
    return buildUrdfDiagram(parseUrdf(text));
  },
  aspen: async (text) => {
    const { parseAspen } = await import("@modelscript/aspen");
    const { buildAspenDiagram } = await import("@modelscript/diagram/aspen-diagram-builder");
    return buildAspenDiagram(parseAspen(text) as any);
  },
  swmm: async (text) => {
    const { parseSwmm } = await import("@modelscript/swmm");
    const { buildSwmmDiagram } = await import("@modelscript/diagram/swmm-diagram-builder");
    return buildSwmmDiagram(parseSwmm(text) as any);
  },
  eclipse: async (text) => {
    const { parseEclipse } = await import("@modelscript/eclipse");
    const { buildEclipseDiagram } = await import("@modelscript/diagram/eclipse-diagram-builder");
    return buildEclipseDiagram(parseEclipse(text) as any);
  },
  jsbsim: async (text) => {
    const { parseJsbsim } = await import("@modelscript/jsbsim");
    const { buildJsbsimDiagram } = await import("@modelscript/diagram/jsbsim-diagram-builder");
    const doc = parseJsbsim(text) as any;
    return buildJsbsimDiagram(doc.fdm ?? doc);
  },
  lps: async (text) => {
    const { parseLps } = await import("@modelscript/lps");
    const { buildLpsDiagram } = await import("@modelscript/diagram/lps-diagram-builder");
    return buildLpsDiagram(parseLps(text) as any);
  },
  olga: async (text) => {
    const { parseOpi } = await import("@modelscript/olga");
    const { buildOlgaDiagram } = await import("@modelscript/diagram/olga-diagram-builder");
    return buildOlgaDiagram(parseOpi(text) as any);
  },
  opendss: async (text) => {
    const { parseOpenDss } = await import("@modelscript/opendss");
    const { buildOpenDssDiagram } = await import("@modelscript/diagram/opendss-diagram-builder");
    return buildOpenDssDiagram(parseOpenDss(text) as any);
  },
  openscenario: async (text) => {
    const { parseOpenScenario } = await import("@modelscript/openscenario");
    const { buildOpenScenarioDiagram } = await import("@modelscript/diagram/openscenario-diagram-builder");
    return buildOpenScenarioDiagram(parseOpenScenario(text) as any);
  },
  psse: async (text, params) => {
    const { parseRaw, solvePowerFlow, isLikelyDyrContent, parseDyr } = await import("@modelscript/psse");
    const { buildPsseDiagram } = await import("@modelscript/diagram/psse-diagram-builder");
    if (params.uri.endsWith(".dyr") || isLikelyDyrContent(text)) {
      const dyr = parseDyr(text);
      if (dyr.records.length > 0) {
        const buses = new Map<number, any>();
        const generators: any[] = [];
        for (const rec of dyr.records) {
          if (!buses.has(rec.ibus)) {
            buses.set(rec.ibus, {
              i: rec.ibus,
              name: `BUS ${rec.ibus}`,
              baseKv: 138,
              ide: 2,
              vm: 1.0,
            });
          }
          generators.push({
            i: rec.ibus,
            id: `${rec.model}_${rec.id}`,
            pg: rec.con[0] ?? 0,
            qg: 0,
            stat: 1,
          });
        }
        return buildPsseDiagram({
          title1: "PSS/E Dynamic Equipment Models (.dyr)",
          buses,
          branches: [],
          generators,
        });
      }
    }
    const parsed = parseRaw(text);
    const pf = parsed.buses.size > 0 ? solvePowerFlow(parsed) : undefined;
    return buildPsseDiagram(parsed as any, pf as any);
  },
  relap5: async (text) => {
    const { parseRelap5 } = await import("@modelscript/relap5");
    const { buildRelap5Diagram } = await import("@modelscript/diagram/relap5-diagram-builder");
    return buildRelap5Diagram(parseRelap5(text) as any);
  },
  sbml: async (text) => {
    const { parseSbml } = await import("@modelscript/sbml");
    const { buildSbmlDiagram } = await import("@modelscript/diagram/sbml-diagram-builder");
    const doc = parseSbml(text) as any;
    return buildSbmlDiagram(doc.model ?? doc);
  },
  touchstone: async (text) => {
    const { parseTouchstone } = await import("@modelscript/touchstone");
    const { buildTouchstoneDiagram } = await import("@modelscript/diagram/touchstone-diagram-builder");
    const doc = parseTouchstone(text) as any;
    return buildTouchstoneDiagram({ portCount: doc.numPorts ?? doc.portCount ?? 2, ...doc });
  },
  easy5: async (text) => {
    const { parseEasy5 } = await import("@modelscript/easy5");
    const { buildEasy5Diagram } = await import("@modelscript/diagram/easy5-diagram-builder");
    return buildEasy5Diagram(parseEasy5(text));
  },
  rocets: async (text) => {
    const { parseRocetsDeck } = await import("@modelscript/rocets");
    const { buildRocetsDiagram } = await import("@modelscript/diagram/rocets-diagram-builder");
    return buildRocetsDiagram(parseRocetsDeck(text));
  },
  gtsuite: async (text, params) => {
    const { parseGtmModel, buildGtSuiteDiagramData } = await import("@modelscript/gtsuite");
    return buildGtSuiteDiagramData(parseGtmModel(text, params.uri));
  },
  ssp: async (text) => {
    const { parseSsd, buildSspDiagramData } = (await import("@modelscript/ssp")) as any;
    return typeof buildSspDiagramData === "function" ? buildSspDiagramData(parseSsd(text)) : null;
  },
  autosar: async (text) => {
    const { parseArxml } = await import("@modelscript/autosar");
    const { buildAutosarDiagram } = await import("@modelscript/diagram/autosar-diagram-builder");
    return buildAutosarDiagram(parseArxml(text) as never);
  },
  "verilog-a": async (text) => {
    const { parseVerilogA } = await import("@modelscript/verilog-a");
    const { buildVerilogADiagram } = await import("@modelscript/diagram/verilog-a-diagram-builder");
    return buildVerilogADiagram(parseVerilogA(text) as never);
  },
  plcopen: async (text, params) => {
    const { parsePlcopen } = await import("@modelscript/plcopen");
    const { buildPlcopenDiagram } = await import("@modelscript/diagram/plcopen-diagram-builder");
    return buildPlcopenDiagram(parsePlcopen(text, params.uri) as never).diagram;
  },
  oscal: async (text, params) => {
    const { parseOscal } = await import("@modelscript/oscal");
    const { buildOscalDiagram } = await import("@modelscript/diagram/oscal-diagram-builder");
    const doc = parseOscal(text, params.uri);
    return buildOscalDiagram(doc as any);
  },
};

/**
 * Creates a dispatch object that routes diagram requests to the
 * appropriate language backend based on the document URI.
 */
export function createDiagramDispatch(backends: DiagramDispatchDeps) {
  const custom = backends.customBackends ?? new Map<string | RegExp, DiagramBackend>();

  function getBackend(uri: string): DiagramBackend {
    for (const [matcher, backend] of custom.entries()) {
      if (typeof matcher === "string" && uri.endsWith(matcher)) return backend;
      if (matcher instanceof RegExp && matcher.test(uri)) return backend;
    }
    const plugin = globalLanguageRegistry.getPluginForUri(uri);
    if (plugin?.diagramBackend) {
      return plugin.diagramBackend;
    }
    if (uri.endsWith(".sysml") && backends.sysml2) return backends.sysml2;
    if (uri.endsWith(".mo") && backends.modelica) return backends.modelica;
    if (
      backends.owl2 &&
      (uri.endsWith(".owl") ||
        uri.endsWith(".owl2") ||
        uri.endsWith(".ofn") ||
        uri.endsWith(".owx") ||
        uri.endsWith(".ttl"))
    ) {
      return backends.owl2;
    }
    if (uri.endsWith(".pscx") || uri.endsWith(".pslx") || uri.endsWith(".pswx") || uri.endsWith(".psmx")) {
      return createPscadDiagramBackend(backends);
    }
    if (uri.endsWith(".ssd") || uri.endsWith(".ssp")) {
      return createSspDiagramBackend(backends);
    }
    if (uri.endsWith(".slx") || uri.endsWith(".mdl")) {
      return backends.simulink ?? createSimulinkDiagramBackend(backends);
    }
    if (uri.endsWith(".cir") || uri.endsWith(".sp") || uri.endsWith(".spice")) {
      return backends.spice ?? createSpiceDiagramBackend(backends);
    }
    if (uri.endsWith(".xodr") || uri.endsWith(".opendrive")) {
      return backends.opendrive ?? createOpenDriveDiagramBackend(backends);
    }
    const readKinematicSource = async (targetUri: string): Promise<string | null> => {
      const memText =
        (backends.generic as any)?.deps?.getDocumentText?.(targetUri) ??
        (backends.modelica as any)?.deps?.getDocumentText?.(targetUri);
      if (typeof memText === "string") return memText;
      try {
        const fs = await import("node:fs");
        const { fileURLToPath } = await import("node:url");
        const filePath = targetUri.startsWith("file://") ? fileURLToPath(targetUri) : targetUri;
        if (fs.existsSync(filePath)) {
          return fs.readFileSync(filePath, "utf-8");
        }
      } catch {
        // ignore fs errors
      }
      return null;
    };

    const formatKinematicDiagramData = async (rawDiagram: any, targetUri: string): Promise<DiagramData> => {
      const cells = Array.isArray(rawDiagram?.cells) ? rawDiagram.cells : [];
      const nodes = Array.isArray(rawDiagram?.nodes) ? rawDiagram.nodes : cells.filter((c: any) => c.shape !== "edge");
      const edges = Array.isArray(rawDiagram?.edges) ? rawDiagram.edges : cells.filter((c: any) => c.shape === "edge");

      // Merge any persisted sidecar layout positions so drag/move edits persist
      try {
        const storage = (backends.generic as any)?.getLayoutStorage?.(targetUri);
        const layout = storage ? await storage.loadLayout(targetUri) : null;
        if (layout?.elements) {
          for (const node of nodes) {
            const nodeName = (node as any).name || node.label || node.id;
            const el = layout.elements[node.id] || (nodeName && layout.elements[nodeName]);
            if (el) {
              node.x = el.x;
              node.y = el.y;
              if (node.position) {
                node.position.x = el.x;
                node.position.y = el.y;
              }
              if (el.width) node.width = el.width;
              if (el.height) node.height = el.height;
            }
          }
        }
      } catch {
        // ignore layout storage errors
      }

      return {
        nodes,
        edges,
        coordinateSystem: null,
        diagramBackground: null,
        cells: cells.length > 0 ? cells : [...nodes, ...edges],
        readOnly: true,
        metadata: {
          ...rawDiagram?.metadata,
          readOnly: true,
        },
      } as any;
    };

    const domainBackendCache = new Map<string, DiagramBackend>();

    const createDomainBuilderBackend = (
      buildFn: (text: string, params: DiagramGetDataParams) => Promise<any>,
      domainName?: string,
    ): DiagramBackend => ({
      async getData(params: DiagramGetDataParams): Promise<DiagramData | null> {
        try {
          const text = await readKinematicSource(params.uri);
          if (!text) return null;
          const rawDiagram = await buildFn(text, params);
          if (rawDiagram) {
            const formatted = await formatKinematicDiagramData(rawDiagram, params.uri);
            if (formatted.nodes && formatted.nodes.length > 0) {
              return formatted;
            }
          }
        } catch (err) {
          console.error(`[Diagram] Error building diagram for ${params.uri} (${domainName ?? "domain"}):`, err);
          return {
            nodes: [],
            edges: [],
            coordinateSystem: null,
            diagramBackground: null,
            readOnly: true,
            metadata: {
              error: err instanceof Error ? err.message : String(err),
              readOnly: true,
              domain: domainName,
            },
          } as any;
        }
        return {
          nodes: [],
          edges: [],
          coordinateSystem: null,
          diagramBackground: null,
          readOnly: true,
          metadata: {
            readOnly: true,
            domain: domainName,
          },
        } as any;
      },
      async getComponentProperties(params: DiagramGetComponentPropertiesParams): Promise<ComponentPropertyData | null> {
        return backends.generic ? await backends.generic.getComponentProperties(params) : null;
      },
      async applyEdits(params: DiagramApplyEditsParams): Promise<DiagramApplyEditsResult> {
        console.warn(
          `[Diagram] Cannot apply visual edits: ${domainName ?? "domain"} diagram for ${params.uri} is read-only.`,
        );
        return { seq: params.seq, edits: [], renderHint: "none" };
      },
    });

    const pluginId = plugin?.id?.toLowerCase() || (/\.oscal(\.(json|ya?ml|xml))?$/i.test(uri) ? "oscal" : undefined);
    if (pluginId) {
      if ((backends as Record<string, unknown>)[pluginId]) {
        return (backends as Record<string, unknown>)[pluginId] as DiagramBackend;
      }
      const builder = DOMAIN_BUILDERS[pluginId];
      if (builder) {
        let cached = domainBackendCache.get(pluginId);
        if (!cached) {
          cached = createDomainBuilderBackend(builder, pluginId);
          domainBackendCache.set(pluginId, cached);
        }
        return cached;
      }
    }

    return backends.generic ?? backends.modelica ?? (backends.sysml2 as any);
  }

  return {
    getBackend,
    registerBackend(matcher: string | RegExp, backend: DiagramBackend) {
      custom.set(matcher, backend);
    },

    async getData(params: DiagramGetDataParams): Promise<DiagramData | null> {
      return await getBackend(params.uri).getData(params);
    },

    async getComponentProperties(params: DiagramGetComponentPropertiesParams): Promise<ComponentPropertyData | null> {
      return await getBackend(params.uri).getComponentProperties(params);
    },

    async applyEdits(params: DiagramApplyEditsParams): Promise<DiagramApplyEditsResult> {
      return await getBackend(params.uri).applyEdits(params);
    },

    async getPalette(params: DiagramGetPaletteParams): Promise<DiagramPalette | null> {
      const backend = getBackend(params.uri);
      return backend.getPalette ? await backend.getPalette(params) : null;
    },

    async drillDown(params: DiagramDrillDownParams): Promise<DiagramDrillDownResult | null> {
      const backend = getBackend(params.uri);
      return backend.drillDown ? await backend.drillDown(params) : null;
    },

    supports(uri: string): boolean {
      for (const matcher of custom.keys()) {
        if (typeof matcher === "string" ? uri.includes(matcher) : matcher.test(uri)) {
          return true;
        }
      }
      const plugin = globalLanguageRegistry.getPluginForUri(uri);
      const pluginId = plugin?.id?.toLowerCase() || (/\.oscal(\.(json|ya?ml|xml))?$/i.test(uri) ? "oscal" : undefined);
      if (pluginId) {
        if ((backends as Record<string, unknown>)[pluginId]) return true;
        if (DOMAIN_BUILDERS[pluginId]) return true;
      }
      if (uri.endsWith(".mo") || pluginId === "modelica") return true;
      if (uri.endsWith(".sysml") || pluginId === "sysml2") return true;
      if (uri.endsWith(".owl") || uri.endsWith(".ofn") || uri.endsWith(".owx") || pluginId === "owl2") {
        return true;
      }
      if (/\.scad($|\?|#)/i.test(uri) || plugin?.id === "scad") return true;
      if (/\.(f|for|f77|f90|f95|f03|f08)($|\?|#)/i.test(uri) || plugin?.id === "fortran") return true;
      if (plugin?.customHandlers?.symbols) return true;
      const config = (backends.generic as any)?.deps?.getDiagramConfig?.(uri);
      if (config) return true;
      return false;
    },
  };
}

function findBalancedCloseSimple(text: string, openIndex: number): number {
  const openCh = text[openIndex];
  const closeCh = openCh === "(" ? ")" : openCh === "{" ? "}" : openCh === "[" ? "]" : "";
  if (!closeCh) return -1;
  let depth = 0;
  let inQuote: string | null = null;
  for (let i = openIndex; i < text.length; i++) {
    const ch = text[i]!;
    if (inQuote) {
      if (ch === "\\" && i + 1 < text.length) {
        i++;
        continue;
      }
      if (ch === inQuote) inQuote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inQuote = ch;
      continue;
    }
    if (ch === openCh) depth++;
    else if (ch === closeCh) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function findInlinePlacementSpan(line: string): { start: number; end: number } | null {
  const layoutMatch = /@layout\s*\(/.exec(line);
  if (layoutMatch && layoutMatch.index !== undefined) {
    const openIdx = layoutMatch.index + layoutMatch[0].length - 1;
    const closeIdx = findBalancedCloseSimple(line, openIdx);
    if (closeIdx !== -1) {
      return { start: layoutMatch.index, end: closeIdx + 1 };
    }
  }

  const annotPlacementMatch = /\bannotation\s*\(\s*Placement\s*\(/.exec(line);
  if (annotPlacementMatch && annotPlacementMatch.index !== undefined) {
    const firstParenOffset = line.indexOf("(", annotPlacementMatch.index);
    if (firstParenOffset !== -1) {
      const closeIdx = findBalancedCloseSimple(line, firstParenOffset);
      if (closeIdx !== -1) {
        return { start: annotPlacementMatch.index, end: closeIdx + 1 };
      }
    }
  }

  return null;
}

function replaceBalancedBracesField(text: string, fieldName: string, newInner: string): string {
  const escField = fieldName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const fieldMatch = new RegExp(`\\b${escField}\\s*=\\s*\\{`).exec(text);
  if (!fieldMatch || fieldMatch.index === undefined) return text;
  const openBraceIdx = fieldMatch.index + fieldMatch[0].length - 1;
  const closeBraceIdx = findBalancedCloseSimple(text, openBraceIdx);
  if (closeBraceIdx === -1) return text;
  return `${text.slice(0, openBraceIdx + 1)}${newInner}${text.slice(closeBraceIdx)}`;
}

function applyTextEditsInMemory(baseText: string, edits: TextEdit[]): string {
  if (edits.length === 0) return baseText;

  const lineStarts = [0];
  for (let i = 0; i < baseText.length; i++) {
    if (baseText[i] === "\n") lineStarts.push(i + 1);
  }
  const toOffset = (line: number, character: number): number => {
    if (line < 0) return 0;
    if (line >= lineStarts.length) return baseText.length;
    return Math.min(baseText.length, lineStarts[line]! + Math.max(0, character));
  };

  const indexed = edits.map((edit, idx) => ({
    idx,
    start: toOffset(edit.range.start.line, edit.range.start.character),
    end: toOffset(edit.range.end.line, edit.range.end.character),
    newText: edit.newText,
  }));

  // Apply from bottom to top; for identical offsets, reverse original order so sequential inserts preserve order
  indexed.sort((a, b) => {
    if (a.start !== b.start) return b.start - a.start;
    if (a.end !== b.end) return b.end - a.end;
    return b.idx - a.idx;
  });

  let result = baseText;
  for (const item of indexed) {
    result = result.slice(0, item.start) + item.newText + result.slice(item.end);
  }
  return result;
}

function computeDelimiterImbalance(maskedText: string): { paren: number; brace: number; bracket: number } {
  let paren = 0;
  let brace = 0;
  let bracket = 0;
  for (let i = 0; i < maskedText.length; i++) {
    const ch = maskedText[i];
    if (ch === "(") paren++;
    else if (ch === ")") paren--;
    else if (ch === "{") brace++;
    else if (ch === "}") brace--;
    else if (ch === "[") bracket++;
    else if (ch === "]") bracket--;
  }
  return { paren, brace, bracket };
}

function validatePostEditBalance(
  beforeText: string,
  edits: TextEdit[],
  targetClassName: string | undefined,
  ops: any,
): boolean {
  if (edits.length === 0) return true;
  const afterText = applyTextEditsInMemory(beforeText, edits);
  const maskFn =
    typeof ops?.maskModelicaCommentsAndStrings === "function" ? ops.maskModelicaCommentsAndStrings : (s: string) => s;

  const beforeImp = computeDelimiterImbalance(maskFn(beforeText));
  const afterImp = computeDelimiterImbalance(maskFn(afterText));

  // Diagram-generated edits must never increase net delimiter imbalance
  if (
    Math.abs(afterImp.paren) > Math.abs(beforeImp.paren) ||
    Math.abs(afterImp.brace) > Math.abs(beforeImp.brace) ||
    Math.abs(afterImp.bracket) > Math.abs(beforeImp.bracket)
  ) {
    return false;
  }

  // If the enclosing class structure was scannable before, it must remain scannable after
  if (typeof ops?.scanModelicaClassLayout === "function") {
    const beforeLayout = ops.scanModelicaClassLayout(beforeText, targetClassName);
    if (beforeLayout) {
      const afterLayout = ops.scanModelicaClassLayout(afterText, beforeLayout.className);
      if (!afterLayout) return false;
    }
  }

  return true;
}

// ── Modelica Batch Processor ──

export function processDiagramEditBatch(
  request: DiagramApplyEditsParams,
  classInstance: any,
  docText: string,
): DiagramApplyEditsResult {
  const ops = getModelicaDiagramOps();
  const sortFn: (edits: TextEdit[]) => TextEdit[] = ops.deduplicateAndSort ?? deduplicateAndSort;
  let needsRender: "none" | "immediate" | "debounced" = "none";
  const createdComponentNames = new Set<string>();

  const targetClassName: string | undefined =
    request.className || classInstance?.compositeName || classInstance?.name || undefined;

  // Preserve Diagram coordinateSystem metadata across lightweight fallback class refreshes
  const preservedDiagramAnnotation =
    typeof classInstance?.annotation === "function" ? classInstance.annotation("Diagram") : null;

  const attachPreservedDiagram = (inst: any): any => {
    if (!inst || !preservedDiagramAnnotation) return inst;
    const origAnnot = typeof inst.annotation === "function" ? inst.annotation.bind(inst) : null;
    if (origAnnot && origAnnot("Diagram")) return inst;
    return {
      ...inst,
      annotation: (key: string) => {
        const own = origAnnot ? origAnnot(key) : null;
        if (own) return own;
        return key === "Diagram" ? preservedDiagramAnnotation : null;
      },
    };
  };

  let initialInstance = classInstance;
  if (!initialInstance && typeof ops.buildFallbackClassInstance === "function") {
    initialInstance = ops.buildFallbackClassInstance(docText, targetClassName);
  }

  // Record renderHint across all requested actions
  for (const action of request.actions) {
    switch (action.type) {
      case "connect":
      case "disconnect":
      case "reconnect":
      case "addComponent":
      case "deleteComponents":
        needsRender = "immediate";
        break;
      case "updateName":
      case "updateDescription":
        if (needsRender !== "immediate") needsRender = "debounced";
        break;
      case "updateParameter":
      case "updateProperty":
        if (needsRender === "none") needsRender = "debounced";
        break;
      default:
        break;
    }
  }

  // Expand `reconnect` into sequential `[disconnect, connect]` steps so removing the old
  // connection and inserting the new connection never emit conflicting edits or duplicate `equation`.
  type StepAction = Exclude<DiagramApplyEditsParams["actions"][number], { type: "reconnect" }>;
  const expandedActions: StepAction[] = [];
  for (const action of request.actions) {
    if (action.type === "reconnect") {
      expandedActions.push({
        type: "disconnect",
        source: action.oldSource,
        target: action.oldTarget,
      });
      expandedActions.push({
        type: "connect",
        source: action.newSource,
        target: action.newTarget,
        ...(action.points ? { points: action.points } : {}),
        ...(action.color ? { color: action.color } : {}),
      });
    } else {
      expandedActions.push(action);
    }
  }

  const runSingleAction = (action: StepAction, currentText: string, currentInstance: any): TextEdit[] => {
    const execWithInstance = (ci: any): TextEdit[] => {
      if (!ci) return [];
      switch (action.type) {
        case "move":
          return ops.computePlacementEdits ? ops.computePlacementEdits(currentText, ci, action.items) : [];
        case "resize":
        case "rotate":
          return ops.computePlacementEdits ? ops.computePlacementEdits(currentText, ci, [action.item]) : [];
        case "moveEdge": {
          const lines = currentText.split("\n");
          return ops.computeEdgePointEdits ? ops.computeEdgePointEdits(lines, ci, action.edges) : [];
        }
        case "connect":
          return ops.computeConnectInsert
            ? ops.computeConnectInsert(currentText, ci, action.source, action.target, action.points, action.color)
            : [];
        case "disconnect":
          return ops.computeConnectRemove
            ? ops.computeConnectRemove(currentText, ci, action.source, action.target)
            : [];
        case "addComponent": {
          const baseName = action.className.split(".").pop() || "comp";
          let uniqueName = action.name || baseName + "1";
          let counter = 1;

          const existingNames = new Set<string>(Array.from(ci.components || []).map((c: any) => c.name));
          if (typeof ops.scanModelicaClassLayout === "function") {
            const scanned = ops.scanModelicaClassLayout(currentText, targetClassName || ci.name);
            for (const c of scanned?.components ?? []) {
              existingNames.add(c.name);
            }
          }
          for (const n of createdComponentNames) existingNames.add(n);
          if (!action.name) {
            while (existingNames.has(uniqueName)) {
              counter++;
              uniqueName = baseName + counter;
            }
          }
          createdComponentNames.add(uniqueName);
          return ops.computeComponentInsert
            ? ops.computeComponentInsert(ci, action.className, uniqueName, action.x, action.y, currentText)
            : [];
        }
        case "deleteComponents":
          return ops.computeComponentsDelete ? ops.computeComponentsDelete(currentText, ci, action.names) : [];
        case "updateName":
          return ops.computeNameEdit ? ops.computeNameEdit(ci, action.oldName, action.newName, currentText) : [];
        case "updateDescription":
          return ops.computeDescriptionEdit
            ? ops.computeDescriptionEdit(currentText, ci, action.name, action.description)
            : [];
        case "updateParameter":
          return ops.computeParameterEdit
            ? ops.computeParameterEdit(ci, action.name, action.parameter, action.value, currentText)
            : [];
        case "updateProperty":
          return ops.computeParameterEdit
            ? ops.computeParameterEdit(ci, action.name, action.key, String(action.value), currentText)
            : [];
        default:
          return [];
      }
    };

    let edits = execWithInstance(currentInstance);
    // If CST-backed edit returned empty or invalid on a syntax-errored AST, retry with scanner fallback instance
    if (
      (edits.length === 0 || !validatePostEditBalance(currentText, sortFn([...edits]), targetClassName, ops)) &&
      typeof ops.buildFallbackClassInstance === "function"
    ) {
      const fallbackCi = attachPreservedDiagram(
        ops.buildFallbackClassInstance(currentText, targetClassName || currentInstance?.name),
      );
      if (fallbackCi && fallbackCi !== currentInstance) {
        const retryEdits = execWithInstance(fallbackCi);
        if (
          retryEdits.length > 0 &&
          validatePostEditBalance(currentText, sortFn([...retryEdits]), targetClassName, ops)
        ) {
          edits = retryEdits;
        }
      }
    }

    return sortFn(edits);
  };

  // Auto-heal stranded top-level class `annotation(...);` clauses placed above components/equations
  const healedBaseText =
    typeof ops.healStrandedClassAnnotationsInText === "function"
      ? ops.healStrandedClassAnnotationsInText(docText, targetClassName || initialInstance?.name)
      : docText;
  const didHealStrandedAnnotation = healedBaseText !== docText;

  // Fast surgical path: single action and no stranded class annotation relocation needed
  if (!didHealStrandedAnnotation && expandedActions.length === 1) {
    const singleEdits = runSingleAction(expandedActions[0]!, docText, initialInstance);
    if (validatePostEditBalance(docText, singleEdits, targetClassName, ops)) {
      return {
        seq: request.seq,
        edits: singleEdits,
        renderHint: needsRender,
      };
    }
    return {
      seq: request.seq,
      edits: [],
      renderHint: "none",
    };
  }

  // Sequential multi-step path: apply each step onto `workingText` and refresh `workingInstance`
  // so subsequent actions in the same batch see accurate line numbers, new `equation` sections,
  // renamed endpoints, and healed class annotations with zero overlapping or dropped edits.
  let workingText = healedBaseText;
  let workingInstance =
    didHealStrandedAnnotation && typeof ops.buildFallbackClassInstance === "function"
      ? attachPreservedDiagram(
          ops.buildFallbackClassInstance(workingText, targetClassName || initialInstance?.name) ?? initialInstance,
        )
      : initialInstance;

  for (const stepAction of expandedActions) {
    const stepEdits = runSingleAction(stepAction, workingText, workingInstance);
    if (stepEdits.length > 0) {
      workingText = applyTextEditsInMemory(workingText, stepEdits);
      if (typeof ops.buildFallbackClassInstance === "function") {
        const refreshed = ops.buildFallbackClassInstance(workingText, targetClassName || workingInstance?.name);
        if (refreshed) {
          workingInstance = attachPreservedDiagram(refreshed);
        }
      }
    }
  }

  if (workingText === docText) {
    return {
      seq: request.seq,
      edits: [],
      renderHint: needsRender,
    };
  }

  const finalEdits: TextEdit[] =
    typeof ops.computeMinimalNonOverlappingEdits === "function"
      ? ops.computeMinimalNonOverlappingEdits(docText, workingText)
      : [
          {
            range: {
              start: { line: 0, character: 0 },
              end: {
                line: Math.max(0, docText.split("\n").length - 1),
                character: docText.split("\n").pop()?.length ?? 0,
              },
            },
            newText: workingText,
          },
        ];

  if (!validatePostEditBalance(docText, finalEdits, targetClassName, ops)) {
    return {
      seq: request.seq,
      edits: [],
      renderHint: "none",
    };
  }

  return {
    seq: request.seq,
    edits: finalEdits,
    renderHint: needsRender,
  };
}
