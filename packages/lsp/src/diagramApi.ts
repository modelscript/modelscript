// SPDX-License-Identifier: AGPL-3.0-or-later
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
    return a.range.start.character - b.range.start.character;
  });

  return edits.filter((edit, i) => {
    if (i === 0) return true;
    const prev = edits[i - 1]!;
    if (
      edit.range.start.line < prev.range.end.line ||
      (edit.range.start.line === prev.range.end.line && edit.range.start.character < prev.range.end.character)
    ) {
      return false;
    }
    return true;
  });
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

  async applyEdits(params: DiagramApplyEditsParams): Promise<DiagramApplyEditsResult> {
    let instances = this.deps.getDocumentInstances(params.uri);
    let docText = this.deps.getDocumentText(params.uri);

    // Flush validation synchronously if instances are not yet available or if the indexed CST is stale
    if (!instances?.[0] || !docText || this.deps.isDocumentStale?.(params.uri)) {
      await this.deps.flushValidation(params.uri);
      instances = this.deps.getDocumentInstances(params.uri);
      docText = this.deps.getDocumentText(params.uri);
    }

    if (!instances?.[0] || !docText) {
      return { seq: params.seq, edits: [], renderHint: "none" };
    }

    let result = processDiagramEditBatch(params, instances[0], docText);

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
      if (freshInstances?.[0] && freshDocText) {
        result = processDiagramEditBatch(params, freshInstances[0], freshDocText);
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
        const lines = docText.split(/\r?\n/);
        const seenIds = new Set<string>();
        const pushNode = (rawName: string, kind: string, detail = "") => {
          const cleanName = rawName.trim().replace(/^["'<]+|["'>;,{]+$/g, "");
          if (!cleanName || seenIds.has(cleanName)) return;
          seenIds.add(cleanName);
          const idx = nodes.length;
          const col = idx % 3;
          const row = Math.floor(idx / 3);
          const palette: Record<string, { stroke: string; fill: string }> = {
            Section: { stroke: "#4f46e5", fill: "#eef2ff" },
            Block: { stroke: "#0d9488", fill: "#f0fdfa" },
            Parameter: { stroke: "#0284c7", fill: "#f0f9ff" },
            Channel: { stroke: "#059669", fill: "#ecfdf5" },
          };
          const colors = palette[kind] ?? { stroke: "#0284c7", fill: "#f8fafc" };
          nodes.push(
            makeStyledNode({
              id: cleanName,
              name: cleanName,
              kind,
              stereotype: kind.toLowerCase(),
              subtitle: detail || undefined,
              stroke: colors.stroke,
              fill: colors.fill,
              x: 80 + col * 240,
              y: 80 + row * 130,
            }),
          );
        };

        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line || line.startsWith("//") || line.startsWith("/*") || line.startsWith("!")) continue;
          // Section headers: [SECTION] or *CARD
          const secMatch = /^\[([A-Za-z0-9_ -]+)\]$/.exec(line) ?? /^\*([A-Za-z0-9_ ]+)/.exec(line);
          if (secMatch) {
            pushNode(secMatch[1]!.trim(), "Section");
            continue;
          }
          // STEP entity: #10 = ADVANCED_BREP_SHAPE_REPRESENTATION('name', ...)
          const stepMatch = /^(#\d+)\s*=\s*([A-Z0-9_]+)\s*\((?:'([^']*)')?/.exec(line);
          if (stepMatch && nodes.length < 16) {
            pushNode(stepMatch[3] || stepMatch[1]!, stepMatch[2]!, stepMatch[1]!);
            continue;
          }
          // C / Fortran / SCAD / ModelScript declarations
          const declMatch =
            /^(?:subroutine|function|program|module|model|study|part|block|class|struct|void|double|int|real)\s+([A-Za-z_][A-Za-z0-9_]*)/i.exec(
              line,
            ) ?? /^([A-Za-z_][A-Za-z0-9_]*)\s*\([^)]*\)\s*\{/.exec(line);
          if (declMatch) {
            pushNode(declMatch[1]!, "Block");
            continue;
          }
          // XML element with id/name
          const xmlMatch = /<([A-Za-z0-9_:-]+)[^>]*\b(?:id|name|SHORT-NAME)\s*=\s*["']([^"']+)["']/i.exec(line);
          if (xmlMatch && nodes.length < 16) {
            pushNode(xmlMatch[2]!, xmlMatch[1]!);
            continue;
          }
          // Key = Value directive (CFD / CCSDS / SIMA)
          const kvMatch = /^([A-Za-z_][A-Za-z0-9_.-]*)\s*=\s*([^\r\n;#%]+)/.exec(line);
          if (kvMatch && nodes.length < 12) {
            pushNode(kvMatch[1]!, "Parameter", kvMatch[2]!.trim().slice(0, 24));
            continue;
          }
        }

        // CSV header fallback
        if (nodes.length === 0 && lines.length > 0) {
          const firstLine = lines.find((l) => l.trim().length > 0 && !l.trim().startsWith("#")) ?? "";
          if (firstLine.includes(",")) {
            for (const colName of firstLine.split(",").slice(0, 10)) {
              pushNode(colName.trim(), "Channel");
            }
          }
        }

        if (nodes.length === 0) {
          pushNode(plugin?.name || "RootModel", "Model");
        }

        for (let i = 0; i < nodes.length - 1; i++) {
          edges.push(makeStyledEdge(`edge_${i}_${i + 1}`, nodes[i]!.id, nodes[i + 1]!.id));
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

                  const layoutRegex = /(@layout\([^)]*\)|annotation\(Placement\([^)]*\)\))/;
                  const match = layoutRegex.exec(line);
                  if (match) {
                    allEdits.push({
                      range: {
                        start: { line: i, character: match.index },
                        end: { line: i, character: match.index + match[0].length },
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

                const layoutRegex = /(@layout\([^)]*\)|annotation\(Placement\([^)]*\)\))/;
                const match = layoutRegex.exec(line);
                if (match) {
                  allEdits.push({
                    range: {
                      start: { line: i, character: match.index },
                      end: { line: i, character: match.index + match[0].length },
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
            for (let i = 0; i < lines.length; i++) {
              if (maskedLines[i]!.includes(action.source) && maskedLines[i]!.includes(action.target)) {
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
          break;
        }
        case "reconnect": {
          if (docText !== undefined) {
            let replaced = false;
            for (let i = 0; i < lines.length; i++) {
              const line = lines[i]!;
              if (maskedLines[i]!.includes(action.oldSource) && maskedLines[i]!.includes(action.oldTarget)) {
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
                  newEdgeText = `connect(${src}, ${tgt});`;
                }

                const indent = line.match(/^\s*/)?.[0] ?? "";
                allEdits.push({
                  range: {
                    start: { line: i, character: 0 },
                    end: { line: i, character: line.length },
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
      const readPscxSource = async (targetUri: string): Promise<string | null> => {
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

      const formatDiagramData = (rawDiagram: any): DiagramData => {
        const nodes = rawDiagram.cells.filter((c: any) => c.shape !== "edge");
        const edges = rawDiagram.cells.filter((c: any) => c.shape === "edge");
        return {
          nodes,
          edges,
          coordinateSystem: null,
          diagramBackground: null,
          cells: rawDiagram.cells,
          metadata: rawDiagram.metadata,
        } as any;
      };

      return {
        async getData(params: DiagramGetDataParams): Promise<DiagramData | null> {
          try {
            const text = await readPscxSource(params.uri);
            if (!text) return null;
            const { parsePscx } = await import("@modelscript/pscad");
            const { buildPscadDiagram } = await import("@modelscript/diagram/pscad-diagram-builder");
            const project = parsePscx(text);
            const rawDiagram = buildPscadDiagram(project, params.className);
            return formatDiagramData(rawDiagram);
          } catch {
            return null;
          }
        },

        async getComponentProperties(
          params: DiagramGetComponentPropertiesParams,
        ): Promise<ComponentPropertyData | null> {
          try {
            const text = await readPscxSource(params.uri);
            if (!text) return null;
            const { parsePscx, getMasterComponentSchema, getUserDefinitionForm } = await import("@modelscript/pscad");
            const project = parsePscx(text);
            const mod =
              params.className && project.subModules.has(params.className)
                ? project.subModules.get(params.className)!
                : project.rootModule;

            const rawName = params.componentName;
            const strippedCmpId = rawName.startsWith("cmp_") ? rawName.slice(4) : rawName;
            const strippedBusId = rawName.startsWith("bus_") ? rawName.slice(4) : rawName;

            const allMods = [project.rootModule, ...Array.from(project.subModules.values())];
            const cmp =
              mod.components.find((c) => c.id === strippedCmpId || c.id === rawName || c.instanceName === rawName) ??
              allMods
                .flatMap((m) => m.components)
                .find((c) => c.id === strippedCmpId || c.id === rawName || c.instanceName === rawName);

            if (cmp) {
              const masterSchema = getMasterComponentSchema(cmp.definitionName);
              const mergedValues: Record<string, any> = {};
              if (masterSchema) {
                for (const p of masterSchema.parameters) {
                  mergedValues[p.key] = p.defaultValue;
                }
              }
              for (const [k, v] of Object.entries(cmp.parameters)) {
                mergedValues[k] = v;
              }

              const parameters: ComponentPropertyData["parameters"] = [];
              const tabs: PropertyTabConfig[] = [];

              if (masterSchema) {
                const seenKeys = new Set<string>();
                const tabMap = new Map<string, Map<string, PropertyFieldConfig[]>>();

                for (const p of masterSchema.parameters) {
                  seenKeys.add(p.key);
                  const currentVal = mergedValues[p.key] ?? p.defaultValue;
                  parameters.push({
                    name: p.key,
                    localizedName: p.label,
                    value: String(currentVal),
                    defaultValue: String(p.defaultValue),
                    description: p.description,
                    unit: p.unit,
                    tab: p.tab,
                    group: p.group || "Configuration",
                  });

                  const tabName = p.tab || "General";
                  const groupName = p.group || "Configuration";
                  if (!tabMap.has(tabName)) tabMap.set(tabName, new Map());
                  const groupMap = tabMap.get(tabName)!;
                  if (!groupMap.has(groupName)) groupMap.set(groupName, []);

                  const field: PropertyFieldConfig = {
                    key: p.key,
                    label: p.label,
                    kind: p.kind === "select" ? "choice" : p.kind,
                    description: p.description,
                    defaultValue: p.defaultValue,
                    unit: p.unit,
                    choices: p.options?.map((o) => ({ label: o.label, value: o.value })),
                    validation: p.min !== undefined || p.max !== undefined ? { min: p.min, max: p.max } : undefined,
                  };
                  groupMap.get(groupName)!.push(field);
                }

                // Include any additional instance-specific parameters not in the catalog schema
                for (const [k, v] of Object.entries(cmp.parameters)) {
                  if (seenKeys.has(k)) continue;
                  parameters.push({
                    name: k,
                    value: String(v),
                    description: `PSCAD parameter '${k}'`,
                    tab: "General",
                    group: "Instance Parameters",
                  });
                  if (!tabMap.has("General")) tabMap.set("General", new Map());
                  const gMap = tabMap.get("General")!;
                  if (!gMap.has("Instance Parameters")) gMap.set("Instance Parameters", []);
                  gMap.get("Instance Parameters")!.push({
                    key: k,
                    label: k,
                    kind: typeof v === "number" ? "number" : "string",
                    defaultValue: v,
                  });
                }

                for (const [tabLabel, groupMap] of tabMap.entries()) {
                  const groups: PropertyGroupConfig[] = [];
                  for (const [groupLabel, fields] of groupMap.entries()) {
                    groups.push({
                      id: groupLabel.toLowerCase().replace(/[^a-z0-9]+/g, "_"),
                      label: groupLabel,
                      fields,
                    });
                  }
                  tabs.push({
                    id: tabLabel.toLowerCase().replace(/[^a-z0-9]+/g, "_"),
                    label: tabLabel,
                    groups,
                  });
                }
              } else if (getUserDefinitionForm(text, cmp.definitionName)) {
                const form = getUserDefinitionForm(text, cmp.definitionName)!;
                const seenKeys = new Set<string>();
                for (const cat of form.categories) {
                  if (!cat.visible) continue;
                  const fields: PropertyFieldConfig[] = [];
                  for (const p of cat.parameters) {
                    seenKeys.add(p.name);
                    const current = cmp.parameters[p.name];
                    const value = current !== undefined ? String(current) : p.defaultValue;
                    const numeric =
                      (p.type === "Real" || p.type === "Integer") && value.trim() !== "" && !isNaN(Number(value));
                    parameters.push({
                      name: p.name,
                      localizedName: p.label,
                      value,
                      defaultValue: p.defaultValue,
                      description: p.help || p.label,
                      unit: p.unit || undefined,
                      tab: cat.name,
                      group: cat.name,
                    });
                    fields.push({
                      key: p.name,
                      label: p.label,
                      kind: numeric ? "number" : "string",
                      description: p.help || undefined,
                      defaultValue: numeric ? Number(p.defaultValue) : p.defaultValue,
                      unit: p.unit || undefined,
                      validation: p.min !== undefined || p.max !== undefined ? { min: p.min, max: p.max } : undefined,
                    });
                  }
                  if (fields.length > 0) {
                    tabs.push({
                      id: cat.name.toLowerCase().replace(/[^a-z0-9]+/g, "_"),
                      label: cat.name,
                      groups: [{ id: "parameters", label: cat.name, fields }],
                    });
                  }
                }
                // Instance parameters the definition's form does not declare (e.g. Name, hidden defaults).
                const extra = Object.entries(cmp.parameters).filter(([k]) => !seenKeys.has(k));
                if (extra.length > 0) {
                  tabs.push({
                    id: "instance",
                    label: "Instance",
                    groups: [
                      {
                        id: "instance_parameters",
                        label: "Instance Parameters",
                        fields: extra.map(([k, v]) => {
                          parameters.push({ name: k, value: String(v), description: `PSCAD parameter '${k}'` });
                          return {
                            key: k,
                            label: k,
                            kind: typeof v === "number" ? ("number" as const) : ("string" as const),
                            defaultValue: v,
                          };
                        }),
                      },
                    ],
                  });
                }
              } else {
                const fields: PropertyFieldConfig[] = Object.entries(cmp.parameters).map(([k, v]) => {
                  parameters.push({
                    name: k,
                    value: String(v),
                    description: `PSCAD parameter '${k}'`,
                  });
                  return {
                    key: k,
                    label: k,
                    kind: typeof v === "number" ? "number" : "string",
                    defaultValue: v,
                  };
                });
                tabs.push({
                  id: "general",
                  label: "General",
                  groups: [{ id: "configuration", label: "Configuration", fields }],
                });
              }

              return {
                classKind: "component",
                className: cmp.definitionName,
                localizedClassName: masterSchema?.label,
                name: cmp.instanceName || cmp.id,
                description: masterSchema?.description || `PSCAD ${cmp.definitionName} (${cmp.id})`,
                parameters,
                schema: {
                  title: masterSchema?.label || cmp.instanceName || cmp.definitionName,
                  tabs,
                },
                values: mergedValues,
              };
            }

            const bus =
              mod.buses.find((b) => b.id === strippedBusId || b.id === rawName || b.name === rawName) ??
              allMods
                .flatMap((m) => m.buses)
                .find((b) => b.id === strippedBusId || b.id === rawName || b.name === rawName);
            if (bus) {
              return {
                classKind: "bus",
                className: "Bus",
                name: bus.name,
                description: `PSCAD Electrical Bus (${bus.phaseCount}-phase)`,
                parameters: [
                  { name: "Name", value: bus.name, description: "Bus identifier" },
                  {
                    name: "BaseKV",
                    value: String(bus.voltageBaseKv ?? 230.0),
                    unit: "kV",
                    description: "Base line-to-line RMS voltage",
                  },
                ],
                schema: {
                  title: `3-Phase Electrical Bus (${bus.name})`,
                  tabs: [
                    {
                      id: "general",
                      label: "General",
                      groups: [
                        {
                          id: "ratings",
                          label: "Bus Ratings",
                          fields: [
                            { key: "Name", label: "Bus Name", kind: "string", defaultValue: bus.name },
                            {
                              key: "BaseKV",
                              label: "Base Voltage (L-L RMS)",
                              kind: "number",
                              unit: "kV",
                              defaultValue: bus.voltageBaseKv ?? 230.0,
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
                values: {
                  Name: bus.name,
                  BaseKV: bus.voltageBaseKv ?? 230.0,
                },
              };
            }
          } catch {
            return null;
          }
          return null;
        },

        async applyEdits(params: DiagramApplyEditsParams): Promise<DiagramApplyEditsResult> {
          try {
            const text = await readPscxSource(params.uri);
            if (!text) return { seq: params.seq, edits: [], renderHint: "none" };
            const { parsePscx, buildComponentXmlSnippet, planDiagramActions } = await import("@modelscript/pscad");
            // Preferred path: structural edits on the lossless XML tree. If an action references something
            // the model cannot resolve, fall back to the legacy line-based logic below.
            try {
              const planned = planDiagramActions(text, params.actions as never);
              if (planned.unresolved.length === 0) {
                return { seq: params.seq, edits: planned.edits as TextEdit[], renderHint: planned.renderHint };
              }
            } catch {
              // fall through to legacy path
            }
            const project = parsePscx(text);
            const lines = text.split("\n");
            const allEdits: TextEdit[] = [];
            let renderHint: "none" | "immediate" | "debounced" = "none";

            const allComponents = [
              ...project.rootModule.components,
              ...Array.from(project.subModules.values()).flatMap((m) => m.components),
            ];
            const allBuses = [
              ...project.rootModule.buses,
              ...Array.from(project.subModules.values()).flatMap((m) => m.buses),
            ];
            const allWires = [
              ...project.rootModule.wires,
              ...Array.from(project.subModules.values()).flatMap((m) => m.wires),
            ];

            const stripPrefix = (raw: string) =>
              raw.startsWith("cmp_") || raw.startsWith("bus_")
                ? raw.slice(4)
                : raw.startsWith("wire_")
                  ? raw.slice(5)
                  : raw;

            const findSchematicEndLine = (sectionName?: string): number => {
              if (sectionName) {
                const defLineIdx = lines.findIndex(
                  (l) => /<Definition\b/i.test(l) && new RegExp(`name\\s*=\\s*["']${sectionName}["']`, "i").test(l),
                );
                if (defLineIdx >= 0) {
                  for (let i = defLineIdx; i < lines.length; i++) {
                    if (/<\/schematic>/i.test(lines[i]!)) return i;
                    if (/<\/Definition>/i.test(lines[i]!)) return i;
                  }
                }
              }
              for (let i = lines.length - 1; i >= 0; i--) {
                if (/<\/schematic>/i.test(lines[i]!)) return i;
              }
              for (let i = lines.length - 1; i >= 0; i--) {
                if (/<\/project>/i.test(lines[i]!)) return i;
              }
              return Math.max(0, lines.length - 1);
            };

            const resolveEndpointCoords = (
              cellOrPortId: string,
              explicitPortName?: string,
            ): { x: number; y: number } | null => {
              const cleanId = stripPrefix(cellOrPortId);
              const cmp = allComponents.find(
                (c) =>
                  c.id === cleanId ||
                  c.id === cellOrPortId ||
                  c.instanceName === cellOrPortId ||
                  c.ports.some((p) => p.id === cellOrPortId || p.id === cleanId),
              );
              if (cmp) {
                const matchedPort =
                  (explicitPortName
                    ? cmp.ports.find(
                        (p) =>
                          p.name === explicitPortName ||
                          p.id === explicitPortName ||
                          p.id === `${cmp.id}_${explicitPortName}`,
                      )
                    : undefined) ??
                  cmp.ports.find((p) => p.id === cellOrPortId || p.id === cleanId) ??
                  cmp.ports[0];
                if (matchedPort) {
                  const rotRad = (((cmp.rotation ?? 0) % 360) * Math.PI) / 180;
                  const cos = Math.round(Math.cos(rotRad) * 1e6) / 1e6;
                  const sin = Math.round(Math.sin(rotRad) * 1e6) / 1e6;
                  const lx = cmp.mirror ? -matchedPort.position.x : matchedPort.position.x;
                  const ly = matchedPort.position.y;
                  return {
                    x: Math.round(cmp.position.x + (lx * cos - ly * sin)),
                    y: Math.round(cmp.position.y + (lx * sin + ly * cos)),
                  };
                }
                return { x: Math.round(cmp.position.x), y: Math.round(cmp.position.y) };
              }
              const bus = allBuses.find((b) => b.id === cleanId || b.id === cellOrPortId || b.name === cellOrPortId);
              if (bus) {
                return { x: Math.round(bus.position.x), y: Math.round(bus.position.y) };
              }
              return null;
            };

            const hasPositiveY =
              allComponents.some((c) => c.position.y > 0) ||
              allBuses.some((b) => b.position.y > 0) ||
              allWires.some((w) => w.vertices.some((v) => v.y > 0));
            const normalizeWirePt = (pt: { x: number; y: number }): { x: number; y: number } => ({
              x: Math.round(pt.x),
              y: Math.round(hasPositiveY && pt.y < 0 ? Math.abs(pt.y) : pt.y),
            });

            const parseEndpointTokens = (ep: string): string[] => {
              const raw = ep.trim();
              const tokens = new Set<string>([raw, stripPrefix(raw)]);
              if (raw.includes(".")) {
                const [cellPart, portPart] = raw.split(".", 2);
                if (cellPart) {
                  tokens.add(cellPart);
                  tokens.add(stripPrefix(cellPart));
                }
                if (portPart) {
                  tokens.add(portPart);
                  tokens.add(stripPrefix(portPart));
                }
              }
              return [...tokens];
            };

            const wireMatchesEndpoint = (w: (typeof allWires)[number], ep: string): boolean => {
              const tokens = parseEndpointTokens(ep);
              if (tokens.some((t) => w.id === t || `wire_${w.id}` === t)) return true;
              if (w.startPortId && tokens.some((t) => w.startPortId === t || stripPrefix(w.startPortId!) === t)) {
                return true;
              }
              if (w.endPortId && tokens.some((t) => w.endPortId === t || stripPrefix(w.endPortId!) === t)) {
                return true;
              }
              return w.connectedPortIds.some((pid) =>
                tokens.some((t) => pid === t || pid.startsWith(`${t}_`) || stripPrefix(pid) === t),
              );
            };

            const findMatchingWire = (src: string, dst: string) =>
              allWires.find((w) => {
                if (w.id === src || w.id === stripPrefix(src) || `wire_${w.id}` === src) return true;
                return wireMatchesEndpoint(w, src) && wireMatchesEndpoint(w, dst);
              });

            const editedWireIds = new Set<string>();
            const rewriteWireVertices = (w: (typeof allWires)[number], pts: { x: number; y: number }[]) => {
              if (!w.line || w.line - 1 >= lines.length || editedWireIds.has(w.id)) return;
              editedWireIds.add(w.id);
              const startLine = w.line - 1;
              let endLine = startLine;
              while (endLine < lines.length && !/<\/Wire>/i.test(lines[endLine]!)) {
                endLine++;
              }
              const openLine = lines[startLine]!;
              const indent = /^(\s*)/.exec(openLine)?.[1] ?? "          ";
              const vertexLines = pts
                .map((pt) => {
                  const np = normalizeWirePt(pt);
                  return `${indent}  <vertex x="${np.x}" y="${np.y}" />`;
                })
                .join("\n");
              const replacement = `${openLine}\n${vertexLines}\n${indent}</Wire>`;
              allEdits.push({
                range: {
                  start: { line: startLine, character: 0 },
                  end: { line: endLine, character: lines[endLine]?.length ?? 0 },
                },
                newText: replacement,
              });
            };

            for (const action of params.actions) {
              if (action.type === "move") {
                for (const item of action.items) {
                  const strippedId = stripPrefix(item.name);
                  const cmp = allComponents.find(
                    (c) => c.id === strippedId || c.id === item.name || c.instanceName === item.name,
                  );
                  const targetLineIdx = cmp?.line ? cmp.line - 1 : -1;
                  const newX = Math.round(item.width > 0 ? item.x + item.width / 2 : item.x);
                  const newY = Math.round(item.height > 0 ? item.y + item.height / 2 : item.y);

                  if (targetLineIdx >= 0 && targetLineIdx < lines.length && cmp) {
                    const lineText = lines[targetLineIdx]!;
                    let updatedLine = lineText
                      .replace(/\bx\s*=\s*(["'])[^"']*\1/i, `x=$1${newX}$1`)
                      .replace(/\by\s*=\s*(["'])[^"']*\1/i, `y=$1${newY}$1`);
                    if (item.rotation !== undefined) {
                      const deg = ((Math.round(item.rotation) % 360) + 360) % 360;
                      const orientCode = deg % 90 === 0 ? (deg / 90) % 4 : deg;
                      if (/\borient\s*=\s*["'][^"']*["']/i.test(updatedLine)) {
                        updatedLine = updatedLine.replace(/\borient\s*=\s*(["'])[^"']*\1/i, `orient=$1${orientCode}$1`);
                      } else {
                        updatedLine = updatedLine.replace(/(\s*\/?>)\s*$/, ` orient="${orientCode}"$1`);
                      }
                    }
                    if (updatedLine !== lineText) {
                      allEdits.push({
                        range: {
                          start: { line: targetLineIdx, character: 0 },
                          end: { line: targetLineIdx, character: lineText.length },
                        },
                        newText: updatedLine,
                      });
                    }

                    // Update connected wire vertices from item.edges or rubber-band snapped endpoints
                    if (item.edges && item.edges.length > 0) {
                      for (const edge of item.edges) {
                        if (!edge.points || edge.points.length < 2) continue;
                        const matched = findMatchingWire(edge.source, edge.target);
                        if (matched) {
                          rewriteWireVertices(matched, edge.points);
                        }
                      }
                    }
                    const dx = newX - cmp.position.x;
                    const dy = newY - cmp.position.y;
                    if (dx !== 0 || dy !== 0) {
                      const cmpPortIds = new Set(cmp.ports.map((p) => p.id));
                      for (const w of allWires) {
                        if (editedWireIds.has(w.id) || w.vertices.length < 2) continue;
                        const startAttached = Boolean(w.startPortId && cmpPortIds.has(w.startPortId));
                        const endAttached = Boolean(w.endPortId && cmpPortIds.has(w.endPortId));
                        if (!startAttached && !endAttached) continue;
                        const updatedPts = w.vertices.map((v, idx) => {
                          if (idx === 0 && startAttached) return { x: v.x + dx, y: v.y + dy };
                          if (idx === w.vertices.length - 1 && endAttached) return { x: v.x + dx, y: v.y + dy };
                          return { x: v.x, y: v.y };
                        });
                        rewriteWireVertices(w, updatedPts);
                      }
                    }
                  } else {
                    const bus = allBuses.find((b) => b.id === strippedId || b.id === item.name || b.name === item.name);
                    if (bus?.line && bus.line - 1 < lines.length) {
                      const bLineIdx = bus.line - 1;
                      const lineText = lines[bLineIdx]!;
                      // Buses are left-aligned horizontally at bus.position.x
                      const busX = Math.round(item.x);
                      const busY = Math.round(item.height > 0 && item.height <= 16 ? item.y + item.height / 2 : item.y);
                      const updatedLine = lineText
                        .replace(/\bx\s*=\s*(["'])[^"']*\1/i, `x=$1${busX}$1`)
                        .replace(/\by\s*=\s*(["'])[^"']*\1/i, `y=$1${busY}$1`);
                      if (updatedLine !== lineText) {
                        allEdits.push({
                          range: {
                            start: { line: bLineIdx, character: 0 },
                            end: { line: bLineIdx, character: lineText.length },
                          },
                          newText: updatedLine,
                        });
                      }
                    }
                  }
                }
              } else if (action.type === "rotate") {
                const strippedId = stripPrefix(action.item.name);
                const cmp = allComponents.find(
                  (c) => c.id === strippedId || c.id === action.item.name || c.instanceName === action.item.name,
                );
                if (cmp?.line && cmp.line - 1 < lines.length) {
                  const lineIdx = cmp.line - 1;
                  const lineText = lines[lineIdx]!;
                  const deg = ((Math.round(action.item.rotation ?? 0) % 360) + 360) % 360;
                  const orientCode = deg % 90 === 0 ? (deg / 90) % 4 : deg;
                  let updatedLine = lineText;
                  if (/\borient\s*=\s*["'][^"']*["']/i.test(lineText)) {
                    updatedLine = lineText.replace(/\borient\s*=\s*(["'])[^"']*\1/i, `orient=$1${orientCode}$1`);
                  } else {
                    updatedLine = lineText.replace(/(\s*\/?>)\s*$/, ` orient="${orientCode}"$1`);
                  }
                  if (updatedLine !== lineText) {
                    allEdits.push({
                      range: {
                        start: { line: lineIdx, character: 0 },
                        end: { line: lineIdx, character: lineText.length },
                      },
                      newText: updatedLine,
                    });
                    renderHint = "immediate";
                  }
                }
              } else if (action.type === "resize") {
                const strippedId = stripPrefix(action.item.name);
                const bus = allBuses.find(
                  (b) => b.id === strippedId || b.id === action.item.name || b.name === action.item.name,
                );
                if (bus?.line && bus.line - 1 < lines.length) {
                  const bLineIdx = bus.line - 1;
                  const lineText = lines[bLineIdx]!;
                  const newLen = Math.max(20, Math.round(Math.max(action.item.width || 0, action.item.height || 0)));
                  let updatedLine = lineText;
                  if (/\blength\s*=\s*["'][^"']*["']/i.test(lineText)) {
                    updatedLine = lineText.replace(/\blength\s*=\s*(["'])[^"']*\1/i, `length=$1${newLen}$1`);
                  } else {
                    updatedLine = lineText.replace(/(\s*\/?>)\s*$/, ` length="${newLen}"$1`);
                  }
                  if (updatedLine !== lineText) {
                    allEdits.push({
                      range: {
                        start: { line: bLineIdx, character: 0 },
                        end: { line: bLineIdx, character: lineText.length },
                      },
                      newText: updatedLine,
                    });
                    renderHint = "immediate";
                  }
                }
              } else if (action.type === "updateParameter" || action.type === "updateProperty") {
                const paramName = action.type === "updateProperty" ? action.key : action.parameter;
                const paramVal = String(action.value);
                const strippedId = stripPrefix(action.name);
                const cmp = allComponents.find(
                  (c) => c.id === strippedId || c.id === action.name || c.instanceName === action.name,
                );
                if (cmp) {
                  const paramLoc = cmp.paramLocations?.[paramName];
                  if (paramLoc && paramLoc.line - 1 < lines.length) {
                    const pLineIdx = paramLoc.line - 1;
                    const lineText = lines[pLineIdx]!;
                    const updatedLine = lineText.replace(/(value\s*=\s*["'])([^"']*)(["'])/i, `$1${paramVal}$3`);
                    if (updatedLine !== lineText) {
                      allEdits.push({
                        range: {
                          start: { line: pLineIdx, character: 0 },
                          end: { line: pLineIdx, character: lineText.length },
                        },
                        newText: updatedLine,
                      });
                      renderHint = "debounced";
                    }
                  } else if (cmp.line && cmp.line - 1 < lines.length) {
                    // Upsert new <param name="..." value="..." /> inside <paramlist> or expand self-closing component
                    const startLine = cmp.line - 1;
                    const openLineText = lines[startLine]!;
                    const indentMatch = /^(\s*)/.exec(openLineText);
                    const baseIndent = indentMatch?.[1] ?? "          ";

                    if (/\/>\s*$/.test(openLineText)) {
                      const tagMatch = /^(\s*<(?:User|Component)\b)/i.exec(openLineText);
                      const tagName = tagMatch?.[1]?.toLowerCase().includes("user") ? "User" : "Component";
                      const expanded =
                        openLineText.replace(/\s*\/>\s*$/, ">") +
                        `\n${baseIndent}  <paramlist>\n${baseIndent}    <param name="${paramName}" value="${paramVal}" />\n${baseIndent}  </paramlist>\n${baseIndent}</${tagName}>`;
                      allEdits.push({
                        range: {
                          start: { line: startLine, character: 0 },
                          end: { line: startLine, character: openLineText.length },
                        },
                        newText: expanded,
                      });
                      renderHint = "debounced";
                    } else {
                      let plistLine = -1;
                      let endCmpLine = startLine;
                      while (endCmpLine < lines.length && !/<\/(?:User|Component)>/i.test(lines[endCmpLine]!)) {
                        if (plistLine < 0 && /<paramlist\b/i.test(lines[endCmpLine]!)) {
                          plistLine = endCmpLine;
                        }
                        endCmpLine++;
                      }
                      if (plistLine >= 0) {
                        const plistText = lines[plistLine]!;
                        allEdits.push({
                          range: {
                            start: { line: plistLine, character: plistText.length },
                            end: { line: plistLine, character: plistText.length },
                          },
                          newText: `\n${baseIndent}    <param name="${paramName}" value="${paramVal}" />`,
                        });
                        renderHint = "debounced";
                      } else if (endCmpLine < lines.length) {
                        allEdits.push({
                          range: {
                            start: { line: endCmpLine, character: 0 },
                            end: { line: endCmpLine, character: 0 },
                          },
                          newText: `${baseIndent}  <paramlist>\n${baseIndent}    <param name="${paramName}" value="${paramVal}" />\n${baseIndent}  </paramlist>\n`,
                        });
                        renderHint = "debounced";
                      }
                    }
                  }
                } else {
                  const bus = allBuses.find(
                    (b) => b.id === strippedId || b.id === action.name || b.name === action.name,
                  );
                  if (bus?.line && bus.line - 1 < lines.length) {
                    const bLineIdx = bus.line - 1;
                    const lineText = lines[bLineIdx]!;
                    let updatedLine = lineText;
                    if (paramName.toLowerCase() === "name") {
                      updatedLine = lineText.replace(/\bname\s*=\s*(["'])[^"']*\1/i, `name=$1${paramVal}$1`);
                    } else if (paramName.toLowerCase() === "basekv" || paramName.toLowerCase() === "vbase") {
                      if (/\bv_?base\s*=\s*["'][^"']*["']/i.test(lineText)) {
                        updatedLine = lineText.replace(/\bv_?base\s*=\s*(["'])[^"']*\1/i, `vbase=$1${paramVal}$1`);
                      } else {
                        updatedLine = lineText.replace(/(\s*\/?>)\s*$/, ` vbase="${paramVal}"$1`);
                      }
                    }
                    if (updatedLine !== lineText) {
                      allEdits.push({
                        range: {
                          start: { line: bLineIdx, character: 0 },
                          end: { line: bLineIdx, character: lineText.length },
                        },
                        newText: updatedLine,
                      });
                      renderHint = "debounced";
                    }
                  }
                }
              } else if (action.type === "addComponent") {
                const shortDef = (action.className.split(":").pop() || "Cmp").replace(/[^a-zA-Z0-9_]/g, "_");
                const instanceId = action.name || `${shortDef}_${allComponents.length + 1}`;
                const snippet = buildComponentXmlSnippet(action.className, instanceId, action.x, action.y);
                const insertLine = findSchematicEndLine(action.section);
                allEdits.push({
                  range: {
                    start: { line: insertLine, character: 0 },
                    end: { line: insertLine, character: 0 },
                  },
                  newText: `${snippet}\n`,
                });
                renderHint = "immediate";
              } else if (action.type === "deleteComponents") {
                for (const name of action.names) {
                  const strippedId = stripPrefix(name);
                  const cmp = allComponents.find(
                    (c) => c.id === strippedId || c.id === name || c.instanceName === name,
                  );
                  if (cmp?.line && cmp.line - 1 < lines.length) {
                    const startLine = cmp.line - 1;
                    let endLine = startLine;
                    if (!/\/>\s*$/.test(lines[startLine]!)) {
                      while (endLine < lines.length && !/<\/(?:User|Component)>/i.test(lines[endLine]!)) {
                        endLine++;
                      }
                    }
                    allEdits.push({
                      range: {
                        start: { line: startLine, character: 0 },
                        end: { line: Math.min(lines.length, endLine + 1), character: 0 },
                      },
                      newText: "",
                    });
                    renderHint = "immediate";
                    continue;
                  }
                  const bus = allBuses.find((b) => b.id === strippedId || b.id === name || b.name === name);
                  if (bus?.line && bus.line - 1 < lines.length) {
                    const startLine = bus.line - 1;
                    let endLine = startLine;
                    if (!/\/>\s*$/.test(lines[startLine]!)) {
                      while (endLine < lines.length && !/<\/(?:Bus|Wire)>/i.test(lines[endLine]!)) {
                        endLine++;
                      }
                    }
                    allEdits.push({
                      range: {
                        start: { line: startLine, character: 0 },
                        end: { line: Math.min(lines.length, endLine + 1), character: 0 },
                      },
                      newText: "",
                    });
                    renderHint = "immediate";
                  }
                }
              } else if (action.type === "connect") {
                let vertices: { x: number; y: number }[] = [];
                if (action.points && action.points.length >= 2) {
                  vertices = action.points.map((pt) => normalizeWirePt(pt));
                } else {
                  const srcPt = resolveEndpointCoords(action.source, action.sourcePort) ?? { x: 100, y: 100 };
                  const dstPt = resolveEndpointCoords(action.target, action.targetPort) ?? {
                    x: srcPt.x + 80,
                    y: srcPt.y,
                  };
                  if (srcPt.x !== dstPt.x && srcPt.y !== dstPt.y) {
                    vertices = [srcPt, { x: dstPt.x, y: srcPt.y }, dstPt];
                  } else {
                    vertices = [srcPt, dstPt];
                  }
                }
                const wireId = `w_${allWires.length + 1}_${vertices[0]!.x}_${vertices[0]!.y}`;
                const vertexLines = vertices.map((v) => `            <vertex x="${v.x}" y="${v.y}" />`).join("\n");
                const wireSnippet = `          <Wire classid="WireOrthogonal" id="${wireId}">\n${vertexLines}\n          </Wire>\n`;
                const insertLine = findSchematicEndLine(action.section);
                allEdits.push({
                  range: {
                    start: { line: insertLine, character: 0 },
                    end: { line: insertLine, character: 0 },
                  },
                  newText: wireSnippet,
                });
                renderHint = "immediate";
              } else if (action.type === "disconnect") {
                const matchedWire = findMatchingWire(action.source, action.target);
                if (matchedWire?.line && matchedWire.line - 1 < lines.length) {
                  const startLine = matchedWire.line - 1;
                  let endLine = startLine;
                  if (!/\/>\s*$/.test(lines[startLine]!)) {
                    while (endLine < lines.length && !/<\/Wire>/i.test(lines[endLine]!)) {
                      endLine++;
                    }
                  }
                  allEdits.push({
                    range: {
                      start: { line: startLine, character: 0 },
                      end: { line: Math.min(lines.length, endLine + 1), character: 0 },
                    },
                    newText: "",
                  });
                  renderHint = "immediate";
                }
              } else if (action.type === "moveEdge") {
                for (const edge of action.edges) {
                  if (!edge.points || edge.points.length < 2) continue;
                  const matchedWire = findMatchingWire(edge.source, edge.target);
                  if (matchedWire) {
                    rewriteWireVertices(matchedWire, edge.points);
                    renderHint = "immediate";
                  }
                }
              } else if (action.type === "reconnect") {
                const matchedWire =
                  (action.edgeId ? findMatchingWire(action.edgeId, action.edgeId) : undefined) ??
                  findMatchingWire(action.oldSource, action.oldTarget);
                if (matchedWire) {
                  let newVertices: { x: number; y: number }[] = [];
                  if (action.points && action.points.length >= 2) {
                    newVertices = action.points.map((pt) => normalizeWirePt(pt));
                  } else {
                    const srcPt = resolveEndpointCoords(action.newSource, action.newSourcePort) ??
                      matchedWire.vertices[0] ?? { x: 100, y: 100 };
                    const dstPt = resolveEndpointCoords(action.newTarget, action.newTargetPort) ??
                      matchedWire.vertices[matchedWire.vertices.length - 1] ?? { x: srcPt.x + 80, y: srcPt.y };
                    if (srcPt.x !== dstPt.x && srcPt.y !== dstPt.y) {
                      newVertices = [srcPt, { x: dstPt.x, y: srcPt.y }, dstPt];
                    } else {
                      newVertices = [srcPt, dstPt];
                    }
                  }
                  rewriteWireVertices(matchedWire, newVertices);
                  renderHint = "immediate";
                }
              } else if (action.type === "updateName") {
                const strippedOld = stripPrefix(action.oldName);
                const cmp = allComponents.find(
                  (c) => c.id === strippedOld || c.id === action.oldName || c.instanceName === action.oldName,
                );
                if (cmp) {
                  const nameLoc = cmp.paramLocations?.["Name"] ?? cmp.paramLocations?.["name"];
                  if (nameLoc && nameLoc.line - 1 < lines.length) {
                    const pLineIdx = nameLoc.line - 1;
                    const lineText = lines[pLineIdx]!;
                    const updatedLine = lineText.replace(/(value\s*=\s*["'])([^"']*)(["'])/i, `$1${action.newName}$3`);
                    if (updatedLine !== lineText) {
                      allEdits.push({
                        range: {
                          start: { line: pLineIdx, character: 0 },
                          end: { line: pLineIdx, character: lineText.length },
                        },
                        newText: updatedLine,
                      });
                      renderHint = "immediate";
                    }
                  } else if (cmp.line && cmp.line - 1 < lines.length) {
                    const cLineIdx = cmp.line - 1;
                    const lineText = lines[cLineIdx]!;
                    let updatedLine = lineText;
                    if (/\bname\s*=\s*["'][^"']*["']/i.test(lineText)) {
                      updatedLine = lineText.replace(/\bname\s*=\s*(["'])[^"']*\1/i, `name=$1${action.newName}$1`);
                    } else {
                      updatedLine = lineText.replace(/(\s*\/?>)\s*$/, ` name="${action.newName}"$1`);
                    }
                    if (updatedLine !== lineText) {
                      allEdits.push({
                        range: {
                          start: { line: cLineIdx, character: 0 },
                          end: { line: cLineIdx, character: lineText.length },
                        },
                        newText: updatedLine,
                      });
                      renderHint = "immediate";
                    }
                  }
                } else {
                  const bus = allBuses.find(
                    (b) => b.id === strippedOld || b.id === action.oldName || b.name === action.oldName,
                  );
                  if (bus?.line && bus.line - 1 < lines.length) {
                    const bLineIdx = bus.line - 1;
                    const lineText = lines[bLineIdx]!;
                    const updatedLine = lineText.replace(/\bname\s*=\s*(["'])[^"']*\1/i, `name=$1${action.newName}$1`);
                    if (updatedLine !== lineText) {
                      allEdits.push({
                        range: {
                          start: { line: bLineIdx, character: 0 },
                          end: { line: bLineIdx, character: lineText.length },
                        },
                        newText: updatedLine,
                      });
                      renderHint = "immediate";
                    }
                  }
                }
              }
            }

            return {
              seq: params.seq,
              edits: deduplicateAndSort(allEdits),
              renderHint,
            };
          } catch {
            return { seq: params.seq, edits: [], renderHint: "none" };
          }
        },

        async drillDown(params: DiagramDrillDownParams): Promise<DiagramDrillDownResult | null> {
          try {
            const text = await readPscxSource(params.uri);
            if (!text) return null;
            const { parsePscx } = await import("@modelscript/pscad");
            const { buildPscadDiagram } = await import("@modelscript/diagram/pscad-diagram-builder");
            const project = parsePscx(text);

            const candidateId = params.componentId || params.nodeId || params.componentName || params.className || "";
            const strippedId = candidateId.startsWith("cmp_") ? candidateId.slice(4) : candidateId;

            const allComponents = [
              ...project.rootModule.components,
              ...Array.from(project.subModules.values()).flatMap((m) => m.components),
            ];

            let targetModuleName = params.className || "";
            if (!targetModuleName || !project.subModules.has(targetModuleName)) {
              const cmp = allComponents.find(
                (c) => c.id === strippedId || c.id === candidateId || c.instanceName === candidateId,
              );
              if (cmp) {
                const cleanDef = cmp.definitionName.split(":").pop() || cmp.definitionName;
                if (project.subModules.has(cleanDef)) {
                  targetModuleName = cleanDef;
                } else if (cmp.instanceName && project.subModules.has(cmp.instanceName)) {
                  targetModuleName = cmp.instanceName;
                }
              } else if (project.subModules.has(strippedId)) {
                targetModuleName = strippedId;
              }
            }

            if (!targetModuleName || !project.subModules.has(targetModuleName)) {
              return null;
            }

            const rawDiagram = buildPscadDiagram(project, targetModuleName);
            return {
              data: formatDiagramData(rawDiagram),
              breadcrumbs: [
                { id: "Main", label: project.rootModule.name || "Main", uri: params.uri },
                { id: targetModuleName, label: targetModuleName, uri: params.uri },
              ],
              targetUri: params.uri,
              targetClassName: targetModuleName,
            };
          } catch {
            return null;
          }
        },

        async getPalette(): Promise<DiagramPalette> {
          const { getPscadPaletteCategories } = await import("@modelscript/pscad");
          return {
            categories: getPscadPaletteCategories(),
          };
        },
      };
    }
    if (uri.endsWith(".ssd") || uri.endsWith(".ssp")) {
      const readSsdSource = async (targetUri: string): Promise<string | null> => {
        const memText =
          (backends.generic as any)?.deps?.getDocumentText?.(targetUri) ??
          (backends.modelica as any)?.deps?.getDocumentText?.(targetUri);
        if (typeof memText === "string") return memText;
        try {
          const fs = await import("node:fs");
          const { fileURLToPath } = await import("node:url");
          const filePath = targetUri.startsWith("file://") ? fileURLToPath(targetUri) : targetUri;
          if (fs.existsSync(filePath)) {
            if (filePath.endsWith(".ssp")) {
              const { defaultContainerToolkit } = await import("@modelscript/runtime");
              const bytes = new Uint8Array(fs.readFileSync(filePath));
              return defaultContainerToolkit.zip.readText(bytes, "SystemStructure.ssd") ?? null;
            }
            return fs.readFileSync(filePath, "utf-8");
          }
        } catch {
          // ignore fs errors
        }
        return null;
      };

      return {
        async getData(params: DiagramGetDataParams): Promise<DiagramData | null> {
          try {
            const text = await readSsdSource(params.uri);
            if (!text) return null;
            const { buildSspDiagramData } = await import("@modelscript/ssp/diagram");
            return buildSspDiagramData(text) as unknown as DiagramData;
          } catch {
            return null;
          }
        },

        async getComponentProperties(
          params: DiagramGetComponentPropertiesParams,
        ): Promise<ComponentPropertyData | null> {
          try {
            const text = await readSsdSource(params.uri);
            if (!text) return null;
            const { parseSsd } = await import("@modelscript/ssp");
            const system = parseSsd(text);
            const cmp = system.components.find((c) => c.name === params.componentName);
            if (cmp) {
              const parameters: ComponentPropertyData["parameters"] = [
                { name: "source", value: cmp.source, description: "FMU archive path", group: "FMU Resource" },
                ...(cmp.type
                  ? [{ name: "type", value: cmp.type, description: "MIME type", group: "FMU Resource" }]
                  : []),
              ];
              const fields: PropertyFieldConfig[] = [
                { key: "source", label: "FMU Source", kind: "string", defaultValue: cmp.source },
                {
                  key: "type",
                  label: "Component Type",
                  kind: "string",
                  defaultValue: cmp.type ?? "application/x-fmu-sharedlibrary",
                },
              ];
              const values: Record<string, any> = {
                source: cmp.source,
                type: cmp.type ?? "application/x-fmu-sharedlibrary",
              };

              for (const b of system.parameterBindings || []) {
                if (!b.prefix || b.prefix === cmp.name) {
                  for (const pv of b.values) {
                    const shortKey = pv.name.startsWith(`${cmp.name}.`) ? pv.name.slice(cmp.name.length + 1) : pv.name;
                    parameters.push({
                      name: shortKey,
                      value: String(pv.value),
                      description: `SSP bound parameter (${pv.type})`,
                      group: "Parameters",
                    });
                    fields.push({
                      key: shortKey,
                      label: shortKey,
                      kind:
                        pv.type === "Real" || pv.type === "Integer"
                          ? "number"
                          : pv.type === "Boolean"
                            ? "boolean"
                            : "string",
                      defaultValue: pv.value,
                    });
                    values[shortKey] = pv.value;
                  }
                }
              }

              return {
                classKind: "component",
                className: cmp.type || "FMUComponent",
                name: cmp.name,
                description: cmp.source,
                parameters,
                schema: {
                  title: `SSP Component (${cmp.name})`,
                  tabs: [
                    {
                      id: "general",
                      label: "General",
                      groups: [{ id: "fmu", label: "Configuration", fields }],
                    },
                  ],
                },
                values,
              };
            }
          } catch {
            return null;
          }
          return null;
        },

        async applyEdits(params: DiagramApplyEditsParams): Promise<DiagramApplyEditsResult> {
          try {
            const text = await readSsdSource(params.uri);
            if (!text) return { seq: params.seq, edits: [], renderHint: "none" };
            const { applySspDiagramEdits } = await import("@modelscript/ssp/diagram");
            const rawEdits = applySspDiagramEdits(
              text,
              params.actions as unknown as Parameters<typeof applySspDiagramEdits>[1],
            );
            const hasStructural = params.actions.some(
              (a) =>
                a.type === "connect" ||
                a.type === "disconnect" ||
                a.type === "addComponent" ||
                a.type === "deleteComponents" ||
                a.type === "updateName",
            );
            return {
              seq: params.seq,
              edits: deduplicateAndSort(rawEdits),
              renderHint: hasStructural ? "immediate" : "none",
            };
          } catch {
            return { seq: params.seq, edits: [], renderHint: "none" };
          }
        },

        async getPalette(): Promise<DiagramPalette> {
          const { getSspPaletteCategories } = await import("@modelscript/ssp/diagram");
          return {
            categories: getSspPaletteCategories(),
          };
        },
      };
    }
    if (uri.endsWith(".slx") || uri.endsWith(".mdl")) {
      if (backends.simulink) return backends.simulink;

      const readSimulinkSource = async (targetUri: string): Promise<string | Buffer | null> => {
        const memText =
          (backends.generic as any)?.deps?.getDocumentText?.(targetUri) ??
          (backends.modelica as any)?.deps?.getDocumentText?.(targetUri);
        if (typeof memText === "string") return memText;
        try {
          const fs = await import("node:fs");
          const { fileURLToPath } = await import("node:url");
          const filePath = targetUri.startsWith("file://") ? fileURLToPath(targetUri) : targetUri;
          if (fs.existsSync(filePath)) {
            if (filePath.endsWith(".slx")) {
              return fs.readFileSync(filePath);
            }
            return fs.readFileSync(filePath, "utf-8");
          }
        } catch {
          // ignore fs errors
        }
        return null;
      };

      const getSystemBlocks = (sys: any): any[] => {
        if (!sys || !sys.blocks) return [];
        if (Array.isArray(sys.blocks)) return sys.blocks;
        if (sys.blocks instanceof Map) return Array.from(sys.blocks.values());
        if (typeof sys.blocks === "object") return Object.values(sys.blocks);
        return [];
      };

      const formatSimulinkDiagramData = (rawDiagram: any, meta?: Record<string, any>): DiagramData => {
        const nodes = rawDiagram.cells.filter((c: any) => c.shape !== "edge");
        const edges = rawDiagram.cells.filter((c: any) => c.shape === "edge");
        return {
          nodes,
          edges,
          coordinateSystem: null,
          diagramBackground: null,
          cells: rawDiagram.cells,
          metadata: { title: rawDiagram.title, ...(meta ?? {}) },
        } as any;
      };

      return {
        async getData(params: DiagramGetDataParams): Promise<DiagramData | null> {
          try {
            const raw = await readSimulinkSource(params.uri);
            if (!raw) return null;
            const { parseSimulink, buildSimulinkDiagram } = await import("@modelscript/simulink");
            const model = parseSimulink(raw, params.uri);
            let targetSystem: any = model.rootSystem;
            if (params.className && model.rootSystem) {
              const findSubsystem = (sys: any, name: string): any => {
                const blks = getSystemBlocks(sys);
                for (const b of blks) {
                  if (b.name === name && b.subsystem) return b.subsystem;
                  if (b.subsystem) {
                    const sub = findSubsystem(b.subsystem, name);
                    if (sub) return sub;
                  }
                }
                return null;
              };
              const found = findSubsystem(model.rootSystem, params.className);
              if (found) targetSystem = found;
            }
            const rawDiagram = buildSimulinkDiagram(targetSystem);
            return formatSimulinkDiagramData(rawDiagram, { solver: model.solver, version: model.version });
          } catch {
            return null;
          }
        },

        async getComponentProperties(
          params: DiagramGetComponentPropertiesParams,
        ): Promise<ComponentPropertyData | null> {
          try {
            const raw = await readSimulinkSource(params.uri);
            if (!raw) return null;
            const { parseSimulink } = await import("@modelscript/simulink");
            const model = parseSimulink(raw, params.uri);

            const findBlock = (sys: any, name: string): any => {
              const blks = getSystemBlocks(sys);
              for (const b of blks) {
                const bId = b.name || b.id;
                if (bId === name || `block_${bId}` === name) return b;
                if (b.subsystem) {
                  const sub = findBlock(b.subsystem, name);
                  if (sub) return sub;
                }
              }
              return null;
            };

            const blk = findBlock(model.rootSystem, params.componentName);
            if (!blk) return null;

            const parameters: ComponentPropertyData["parameters"] = [
              { name: "BlockType", value: blk.type, group: "Configuration" },
            ];
            const fields: PropertyFieldConfig[] = [
              { key: "BlockType", label: "Block Type", kind: "string", defaultValue: blk.type },
            ];
            const values: Record<string, any> = {
              BlockType: blk.type,
            };

            if (blk.parameters) {
              const pEntries: [string, any][] =
                blk.parameters instanceof Map ? Array.from(blk.parameters.entries()) : Object.entries(blk.parameters);
              for (const [k, v] of pEntries) {
                const strVal = String(v);
                parameters.push({
                  name: k,
                  value: strVal,
                  description: `Simulink parameter '${k}'`,
                  group: "Parameters",
                });
                fields.push({
                  key: k,
                  label: k,
                  kind: typeof v === "number" ? "number" : "string",
                  defaultValue: v,
                });
                values[k] = v;
              }
            }

            return {
              classKind: blk.subsystem ? "subsystem" : "block",
              className: blk.type,
              name: blk.name || blk.id || "Block",
              description: `Simulink ${blk.type} Block (${blk.name || blk.id})`,
              parameters,
              schema: {
                title: `Block: ${blk.name || blk.id}`,
                tabs: [
                  {
                    id: "general",
                    label: "Parameters",
                    groups: [{ id: "main", label: "Block Configuration", fields }],
                  },
                ],
              },
              values,
            };
          } catch {
            return null;
          }
        },

        async applyEdits(params: DiagramApplyEditsParams): Promise<DiagramApplyEditsResult> {
          return { seq: params.seq, edits: [], renderHint: "none" };
        },

        async drillDown(params: DiagramDrillDownParams): Promise<DiagramDrillDownResult | null> {
          try {
            const raw = await readSimulinkSource(params.uri);
            if (!raw) return null;
            const { parseSimulink, buildSimulinkDiagram } = await import("@modelscript/simulink");
            const model = parseSimulink(raw, params.uri);
            const targetName = params.className || params.componentName || params.nodeId || "";
            const cleanName = targetName.startsWith("block_") ? targetName.slice(6) : targetName;

            const findSubsystem = (sys: any, name: string): { sys: any; path: string[] } | null => {
              const blks = getSystemBlocks(sys);
              for (const b of blks) {
                const bId = b.name || b.id;
                if ((bId === name || b.name === name) && b.subsystem) {
                  return { sys: b.subsystem, path: [model.rootSystem.name || "Root", b.name] };
                }
                if (b.subsystem) {
                  const res = findSubsystem(b.subsystem, name);
                  if (res)
                    return { sys: res.sys, path: [model.rootSystem.name || "Root", b.name, ...res.path.slice(1)] };
                }
              }
              return null;
            };

            const found = findSubsystem(model.rootSystem, cleanName);
            if (!found) return null;
            const rawDiagram = buildSimulinkDiagram(found.sys);
            return {
              data: formatSimulinkDiagramData(rawDiagram),
              breadcrumbs: found.path.map((p) => ({ id: p, label: p, uri: params.uri })),
              targetUri: params.uri,
              targetClassName: cleanName,
            };
          } catch {
            return null;
          }
        },

        async getPalette(): Promise<DiagramPalette> {
          return {
            categories: [
              {
                name: "Math Operations",
                items: [
                  { className: "Gain", label: "Gain", description: "Multiply input by constant factor" },
                  { className: "Sum", label: "Sum", description: "Add or subtract signals" },
                  { className: "Product", label: "Product", description: "Multiply or divide signals" },
                  { className: "Abs", label: "Abs", description: "Absolute value" },
                  {
                    className: "MathFunction",
                    label: "Math Function",
                    description: "Mathematical functions (exp, log, sqrt)",
                  },
                ],
              },
              {
                name: "Continuous",
                items: [
                  { className: "Integrator", label: "Integrator", description: "Continuous-time integration 1/s" },
                  { className: "Derivative", label: "Derivative", description: "Continuous-time derivative du/dt" },
                  {
                    className: "TransferFcn",
                    label: "Transfer Fcn",
                    description: "Linear continuous transfer function num(s)/den(s)",
                  },
                  {
                    className: "StateSpace",
                    label: "State-Space",
                    description: "Linear state-space system dx/dt = Ax + Bu",
                  },
                ],
              },
              {
                name: "Discrete",
                items: [
                  { className: "UnitDelay", label: "Unit Delay", description: "Delay signal by 1 sample z^-1" },
                  {
                    className: "DiscreteIntegrator",
                    label: "Discrete-Time Integrator",
                    description: "Discrete integration",
                  },
                ],
              },
              {
                name: "Sources",
                items: [
                  { className: "Constant", label: "Constant", description: "Generate constant value" },
                  { className: "Step", label: "Step", description: "Step signal output" },
                  { className: "Sine", label: "Sine Wave", description: "Sinusoidal signal generator" },
                  { className: "Inport", label: "Inport", description: "Subsystem signal input port" },
                ],
              },
              {
                name: "Sinks",
                items: [
                  { className: "Scope", label: "Scope", description: "Display signal in time domain" },
                  { className: "Outport", label: "Outport", description: "Subsystem signal output port" },
                  { className: "Terminator", label: "Terminator", description: "Terminate unconnected signal" },
                ],
              },
            ],
          };
        },
      };
    }

    if (uri.endsWith(".cir") || uri.endsWith(".sp") || uri.endsWith(".spice")) {
      if (backends.spice) return backends.spice;

      const readSpiceSource = async (targetUri: string): Promise<string | null> => {
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

      const formatSpiceDiagramData = (rawDiagram: any, meta?: Record<string, any>): DiagramData => {
        const nodes = rawDiagram.cells.filter((c: any) => c.shape !== "edge");
        const edges = rawDiagram.cells.filter((c: any) => c.shape === "edge");
        return {
          nodes,
          edges,
          coordinateSystem: null,
          diagramBackground: null,
          cells: rawDiagram.cells,
          metadata: { title: rawDiagram.title, ...(meta ?? {}) },
        } as any;
      };

      return {
        async getData(params: DiagramGetDataParams): Promise<DiagramData | null> {
          try {
            const text = await readSpiceSource(params.uri);
            if (!text) return null;
            const { parseSpice, buildSpiceDiagram } = await import("@modelscript/spice");
            const circuit = parseSpice(text);
            const rawDiagram = buildSpiceDiagram(circuit);
            return formatSpiceDiagramData(rawDiagram, {
              componentCount: circuit.components.length,
              directiveCount: circuit.directives.length,
            });
          } catch {
            return null;
          }
        },

        async getComponentProperties(
          params: DiagramGetComponentPropertiesParams,
        ): Promise<ComponentPropertyData | null> {
          try {
            const text = await readSpiceSource(params.uri);
            if (!text) return null;
            const { parseSpice, formatSpiceValue } = await import("@modelscript/spice");
            const circuit = parseSpice(text);
            const rawName = params.componentName;
            const cleanName = rawName.startsWith("cmp_") ? rawName.slice(4) : rawName;
            const cmp = circuit.components.find(
              (c) => c.name.toLowerCase() === cleanName.toLowerCase() || c.name.toLowerCase() === rawName.toLowerCase(),
            );
            if (!cmp) return null;

            const parameters: ComponentPropertyData["parameters"] = [
              { name: "Kind", value: cmp.kind, group: "Component Info" },
              { name: "Nodes", value: cmp.nodes.join(", "), group: "Connectivity" },
            ];
            const fields: PropertyFieldConfig[] = [
              { key: "Kind", label: "Kind", kind: "string", defaultValue: cmp.kind },
              { key: "Nodes", label: "Nodes", kind: "string", defaultValue: cmp.nodes.join(", ") },
            ];
            const values: Record<string, any> = {
              Kind: cmp.kind,
              Nodes: cmp.nodes.join(", "),
            };

            if (cmp.value !== undefined) {
              const formatted = formatSpiceValue(cmp.value, cmp.kind);
              parameters.push({
                name: "Value",
                value: formatted,
                description: `Numerical value (${cmp.value})`,
                group: "Electrical",
              });
              fields.push({ key: "Value", label: "Value", kind: "string", defaultValue: formatted });
              values["Value"] = formatted;
            }
            if (cmp.model) {
              parameters.push({
                name: "Model",
                value: cmp.model,
                description: "SPICE .MODEL reference",
                group: "Model",
              });
              fields.push({ key: "Model", label: "Model", kind: "string", defaultValue: cmp.model });
              values["Model"] = cmp.model;
            }
            if (cmp.params) {
              const pEntries: [string, any][] =
                cmp.params instanceof Map ? Array.from(cmp.params.entries()) : Object.entries(cmp.params);
              for (const [k, v] of pEntries) {
                parameters.push({ name: k, value: String(v), description: `Parameter ${k}`, group: "Parameters" });
                fields.push({ key: k, label: k, kind: typeof v === "number" ? "number" : "string", defaultValue: v });
                values[k] = v;
              }
            }

            return {
              classKind: "component",
              className: cmp.kind,
              name: cmp.name,
              description: `SPICE Component ${cmp.name} (${cmp.kind})`,
              parameters,
              schema: {
                title: `SPICE Component: ${cmp.name}`,
                tabs: [
                  {
                    id: "general",
                    label: "Parameters",
                    groups: [{ id: "main", label: "Attributes", fields }],
                  },
                ],
              },
              values,
            };
          } catch {
            return null;
          }
        },

        async applyEdits(params: DiagramApplyEditsParams): Promise<DiagramApplyEditsResult> {
          return { seq: params.seq, edits: [], renderHint: "none" };
        },

        async getPalette(): Promise<DiagramPalette> {
          return {
            categories: [
              {
                name: "Passive Components",
                items: [
                  { className: "R", label: "Resistor (R)", description: "Two-terminal resistor" },
                  { className: "C", label: "Capacitor (C)", description: "Two-terminal capacitor" },
                  { className: "L", label: "Inductor (L)", description: "Two-terminal inductor" },
                ],
              },
              {
                name: "Semiconductors",
                items: [
                  { className: "D", label: "Diode (D)", description: "PN junction diode" },
                  { className: "Q", label: "BJT (Q)", description: "Bipolar junction transistor (NPN/PNP)" },
                  { className: "M", label: "MOSFET (M)", description: "Metal-oxide FET (NMOS/PMOS)" },
                ],
              },
              {
                name: "Sources",
                items: [
                  { className: "V", label: "Voltage Source (V)", description: "Independent voltage source" },
                  { className: "I", label: "Current Source (I)", description: "Independent current source" },
                ],
              },
              {
                name: "Subcircuits & ICs",
                items: [{ className: "X", label: "Subcircuit (X)", description: "Subcircuit instance (.SUBCKT)" }],
              },
            ],
          };
        },
      };
    }
    if (uri.endsWith(".xodr") || uri.endsWith(".opendrive")) {
      if (backends.opendrive) return backends.opendrive;

      const readOpenDriveSource = async (targetUri: string): Promise<string | null> => {
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
          // ignore
        }
        return null;
      };

      backends.opendrive = {
        async getData(params: DiagramGetDataParams): Promise<DiagramData | null> {
          const text = await readOpenDriveSource(params.uri);
          if (!text) return null;
          const { parseOpenDrive } = await import("@modelscript/opendrive");
          const doc = parseOpenDrive(text);

          const nodes: any[] = [];
          const edges: any[] = [];

          let row = 0;
          let col = 0;
          for (const road of doc.roads) {
            const roadName = road.name ? `${road.name} (#${road.id})` : `Road ${road.id}`;
            const x = 50 + col * 260;
            const y = 50 + row * 160;
            col++;
            if (col > 3) {
              col = 0;
              row++;
            }

            nodes.push({
              id: `road_${road.id}`,
              label: roadName,
              kind: "road",
              position: { x, y },
              size: { width: 220, height: 100 },
              ports: [
                { id: "start", name: "start", direction: "inout" },
                { id: "end", name: "end", direction: "inout" },
              ],
              data: {
                roadId: road.id,
                length: road.length,
                junction: road.junction,
                segmentsCount: road.planView.length,
                lanesCount: road.lanes.laneSections.length,
                signalsCount: road.signals.length,
              },
            });

            if (road.link?.successor?.elementType === "road") {
              edges.push({
                id: `edge_${road.id}_succ_${road.link.successor.elementId}`,
                source: `road_${road.id}`,
                target: `road_${road.link.successor.elementId}`,
                sourcePort: "end",
                targetPort: road.link.successor.contactPoint === "end" ? "end" : "start",
                kind: "connection",
              });
            }
          }

          for (const junc of doc.junctions) {
            const x = 50 + col * 260;
            const y = 50 + row * 160;
            col++;
            if (col > 3) {
              col = 0;
              row++;
            }

            nodes.push({
              id: `junc_${junc.id}`,
              label: `Junction ${junc.name ?? junc.id}`,
              kind: "junction",
              position: { x, y },
              size: { width: 180, height: 80 },
              ports: [{ id: "junc_port", name: "junc", direction: "inout" }],
              data: {
                junctionId: junc.id,
                connectionsCount: junc.connections.length,
              },
            });

            for (const conn of junc.connections) {
              edges.push({
                id: `conn_${junc.id}_${conn.id}`,
                source: `road_${conn.incomingRoad}`,
                target: `road_${conn.connectingRoad}`,
                sourcePort: "end",
                targetPort: conn.contactPoint === "end" ? "end" : "start",
                kind: "junction_connection",
              });
            }
          }

          return {
            nodes,
            edges,
            coordinateSystem: null,
            diagramBackground: null,
          } as any;
        },

        async getComponentProperties(
          params: DiagramGetComponentPropertiesParams,
        ): Promise<ComponentPropertyData | null> {
          const text = await readOpenDriveSource(params.uri);
          if (!text) return null;
          const { parseOpenDrive } = await import("@modelscript/opendrive");
          const doc = parseOpenDrive(text);
          const rawId = (params.componentName || "").replace(/^road_/, "").replace(/^junc_/, "");

          const road = doc.roads.find((r) => r.id === rawId || r.name === rawId);
          if (road) {
            const parameters: ComponentPropertyData["parameters"] = [
              { name: "id", value: road.id, group: "General" },
              { name: "length", value: String(road.length), group: "Geometry" },
              { name: "junction", value: road.junction, group: "Topology" },
              { name: "segments", value: String(road.planView.length), group: "Geometry" },
              { name: "signals", value: String(road.signals.length), group: "Equipment" },
            ];
            const fields: PropertyFieldConfig[] = [
              { key: "id", label: "Road ID", kind: "string", defaultValue: road.id },
              { key: "length", label: "Length (m)", kind: "number", defaultValue: road.length },
              { key: "junction", label: "Junction ID", kind: "string", defaultValue: road.junction },
            ];
            return {
              classKind: "road",
              className: "Road",
              name: road.name ?? `Road_${road.id}`,
              description: `OpenDRIVE Road (${road.name ?? road.id}, length=${road.length}m)`,
              parameters,
              schema: {
                title: `Road: ${road.name ?? road.id}`,
                tabs: [
                  { id: "general", label: "Road Properties", groups: [{ id: "main", label: "Configuration", fields }] },
                ],
              },
              values: { id: road.id, length: road.length, junction: road.junction },
            };
          }

          const junc = doc.junctions.find((j) => j.id === rawId || j.name === rawId);
          if (junc) {
            const parameters: ComponentPropertyData["parameters"] = [
              { name: "id", value: junc.id, group: "General" },
              { name: "connections", value: String(junc.connections.length), group: "Topology" },
            ];
            const fields: PropertyFieldConfig[] = [
              { key: "id", label: "Junction ID", kind: "string", defaultValue: junc.id },
              { key: "connections", label: "Connection Count", kind: "number", defaultValue: junc.connections.length },
            ];
            return {
              classKind: "junction",
              className: "Junction",
              name: junc.name ?? `Junction_${junc.id}`,
              description: `OpenDRIVE Junction (${junc.name ?? junc.id})`,
              parameters,
              schema: {
                title: `Junction: ${junc.name ?? junc.id}`,
                tabs: [
                  {
                    id: "general",
                    label: "Junction Properties",
                    groups: [{ id: "main", label: "Configuration", fields }],
                  },
                ],
              },
              values: { id: junc.id, connections: junc.connections.length },
            };
          }
          return null;
        },

        async drillDown(params: DiagramDrillDownParams): Promise<DiagramDrillDownResult | null> {
          const text = await readOpenDriveSource(params.uri);
          if (!text) return null;
          const { parseOpenDrive } = await import("@modelscript/opendrive");
          const doc = parseOpenDrive(text);
          const targetName = params.className || params.componentName || params.nodeId || "";
          const rawId = targetName.replace(/^road_/, "");
          const road = doc.roads.find((r) => r.id === rawId || r.name === rawId);
          if (!road) return null;

          const nodes = road.planView.map((geom, idx) => ({
            id: `geom_${idx}`,
            label: `${geom.type.toUpperCase()} [${geom.length.toFixed(1)}m]`,
            kind: geom.type,
            position: { x: 50 + idx * 180, y: 100 },
            size: { width: 150, height: 70 },
            ports: [
              { id: "in", name: "in", direction: "in" },
              { id: "out", name: "out", direction: "out" },
            ],
            data: { ...geom },
          }));

          const edges = [];
          for (let i = 0; i < nodes.length - 1; i++) {
            edges.push({
              id: `geom_flow_${i}_${i + 1}`,
              source: `geom_${i}`,
              target: `geom_${i + 1}`,
              sourcePort: "out",
              targetPort: "in",
            });
          }

          return {
            data: {
              nodes,
              edges,
              coordinateSystem: null,
              diagramBackground: null,
            } as any,
            breadcrumbs: [{ id: road.id, label: road.name ?? `Road ${road.id}`, uri: params.uri }],
            targetUri: params.uri,
            targetClassName: road.name ?? road.id,
          };
        },

        async applyEdits(params: DiagramApplyEditsParams): Promise<DiagramApplyEditsResult> {
          if (backends.generic) {
            return await backends.generic.applyEdits(params);
          }
          return { seq: params.seq, edits: [], renderHint: "none" };
        },

        async getPalette(): Promise<DiagramPalette> {
          return {
            categories: [
              {
                name: "Roadway Entities",
                items: [
                  { className: "Road", label: "Road", description: "OpenDRIVE road segment" },
                  { className: "Junction", label: "Junction", description: "OpenDRIVE road junction" },
                ],
              },
              {
                name: "Geometry Elements",
                items: [
                  { className: "Line", label: "Line", description: "Straight road segment" },
                  { className: "Spiral", label: "Spiral (Clothoid)", description: "Transition spiral curve" },
                  { className: "Arc", label: "Arc", description: "Circular road curve" },
                  { className: "Poly3", label: "Cubic Polynomial", description: "Polynomial curve" },
                ],
              },
            ],
          };
        },
      };
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
        metadata: rawDiagram?.metadata,
      } as any;
    };

    const createDomainBuilderBackend = (
      buildFn: (text: string, params: DiagramGetDataParams) => Promise<any>,
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
        } catch {
          // fall back to generic backend
        }
        return backends.generic ? await backends.generic.getData(params) : null;
      },
      async getComponentProperties(params: DiagramGetComponentPropertiesParams): Promise<ComponentPropertyData | null> {
        return backends.generic ? await backends.generic.getComponentProperties(params) : null;
      },
      async applyEdits(params: DiagramApplyEditsParams): Promise<DiagramApplyEditsResult> {
        if (backends.generic) {
          return await backends.generic.applyEdits(params);
        }
        return { seq: params.seq, edits: [], renderHint: "none" };
      },
    });

    if (uri.endsWith(".spck") || uri.endsWith(".sim") || uri.endsWith(".mbs") || plugin?.id === "simpack") {
      if (backends.simpack) return backends.simpack;
      return createDomainBuilderBackend(async (text) => {
        const { parseSpckXml, parseSimDeck, buildSimpackDiagram } = await import("@modelscript/simpack");
        const isXml = text.trimStart().startsWith("<");
        const model = isXml ? parseSpckXml(text) : parseSimDeck(text);
        return buildSimpackDiagram(model);
      });
    }

    if (uri.endsWith(".calc") || uri.endsWith(".trax") || uri.endsWith(".run") || plugin?.id === "gensys") {
      if (backends.gensys) return backends.gensys;
      return createDomainBuilderBackend(async (text) => {
        const { parseGensysDeck, buildGensysDiagram } = await import("@modelscript/gensys");
        const model = parseGensysDeck(text);
        return buildGensysDiagram(model);
      });
    }

    if (
      uri.endsWith(".adm") ||
      uri.endsWith(".cmd") ||
      uri.endsWith(".mnf") ||
      uri.endsWith(".acf") ||
      plugin?.id === "adams"
    ) {
      if (backends.adams) return backends.adams;
      return createDomainBuilderBackend(async (text) => {
        const { parseAdams, buildAdamsDiagram } = await import("@modelscript/adams");
        const model = parseAdams(text);
        return buildAdamsDiagram(model);
      });
    }

    if (uri.endsWith(".urdf") || uri.endsWith(".xacro") || uri.endsWith(".sdf") || plugin?.id === "urdf") {
      if (backends.urdf) return backends.urdf;
      return createDomainBuilderBackend(async (text) => {
        const { parseUrdf, buildUrdfDiagram } = await import("@modelscript/urdf");
        const model = parseUrdf(text);
        return buildUrdfDiagram(model);
      });
    }

    if (plugin?.id === "aspen" || uri.endsWith(".bkp") || uri.endsWith(".in") || uri.endsWith(".aspen.inp")) {
      return createDomainBuilderBackend(async (text) => {
        const { parseAspen } = await import("@modelscript/aspen");
        const { buildAspenDiagram } = await import("@modelscript/diagram/aspen-diagram-builder");
        return buildAspenDiagram(parseAspen(text) as any);
      });
    }

    if (plugin?.id === "swmm" || uri.endsWith(".swmm") || uri.endsWith(".swmm.inp")) {
      return createDomainBuilderBackend(async (text) => {
        const { parseSwmm } = await import("@modelscript/swmm");
        const { buildSwmmDiagram } = await import("@modelscript/diagram/swmm-diagram-builder");
        return buildSwmmDiagram(parseSwmm(text) as any);
      });
    }

    if (plugin?.id === "eclipse" || uri.endsWith(".data") || uri.endsWith(".inc")) {
      return createDomainBuilderBackend(async (text) => {
        const { parseEclipse } = await import("@modelscript/eclipse");
        const { buildEclipseDiagram } = await import("@modelscript/diagram/eclipse-diagram-builder");
        return buildEclipseDiagram(parseEclipse(text) as any);
      });
    }

    if (plugin?.id === "jsbsim" || uri.endsWith(".jsbsim") || uri.endsWith(".jsbsim.xml")) {
      return createDomainBuilderBackend(async (text) => {
        const { parseJsbsim } = await import("@modelscript/jsbsim");
        const { buildJsbsimDiagram } = await import("@modelscript/diagram/jsbsim-diagram-builder");
        const doc = parseJsbsim(text) as any;
        return buildJsbsimDiagram(doc.fdm ?? doc);
      });
    }

    if (plugin?.id === "lps" || uri.endsWith(".lps") || uri.endsWith(".tgx") || uri.endsWith(".tlx")) {
      return createDomainBuilderBackend(async (text) => {
        const { parseLps } = await import("@modelscript/lps");
        const { buildLpsDiagram } = await import("@modelscript/diagram/lps-diagram-builder");
        return buildLpsDiagram(parseLps(text) as any);
      });
    }

    if (plugin?.id === "olga" || uri.endsWith(".opi") || uri.endsWith(".olga") || uri.endsWith(".genkey")) {
      return createDomainBuilderBackend(async (text) => {
        const { parseOpi } = await import("@modelscript/olga");
        const { buildOlgaDiagram } = await import("@modelscript/diagram/olga-diagram-builder");
        return buildOlgaDiagram(parseOpi(text) as any);
      });
    }

    if (plugin?.id === "opendss" || uri.endsWith(".dss")) {
      return createDomainBuilderBackend(async (text) => {
        const { parseOpenDss } = await import("@modelscript/opendss");
        const { buildOpenDssDiagram } = await import("@modelscript/diagram/opendss-diagram-builder");
        return buildOpenDssDiagram(parseOpenDss(text) as any);
      });
    }

    if (plugin?.id === "openscenario" || uri.endsWith(".xosc")) {
      return createDomainBuilderBackend(async (text) => {
        const { parseOpenScenario } = await import("@modelscript/openscenario");
        const { buildOpenScenarioDiagram } = await import("@modelscript/diagram/openscenario-diagram-builder");
        const doc = parseOpenScenario(text) as any;
        return buildOpenScenarioDiagram(doc);
      });
    }

    if (plugin?.id === "psse" || uri.endsWith(".raw") || uri.endsWith(".dyr")) {
      return createDomainBuilderBackend(async (text) => {
        const { parseRaw, solvePowerFlow, isLikelyDyrContent, parseDyr } = await import("@modelscript/psse");
        const { buildPsseDiagram } = await import("@modelscript/diagram/psse-diagram-builder");
        if (uri.endsWith(".dyr") || isLikelyDyrContent(text)) {
          const dyr = parseDyr(text);
          if (dyr.records.length > 0) {
            const buses = new Map<number, any>();
            const generators: any[] = [];
            for (const rec of dyr.records) {
              if (!buses.has(rec.ibus)) {
                buses.set(rec.ibus, {
                  i: rec.ibus,
                  name: `GEN BUS ${rec.ibus}`,
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
      });
    }

    if (plugin?.id === "relap5" || uri.endsWith(".r5") || uri.endsWith(".i") || uri.endsWith(".relap5.inp")) {
      return createDomainBuilderBackend(async (text) => {
        const { parseRelap5 } = await import("@modelscript/relap5");
        const { buildRelap5Diagram } = await import("@modelscript/diagram/relap5-diagram-builder");
        return buildRelap5Diagram(parseRelap5(text) as any);
      });
    }

    if (plugin?.id === "sbml" || uri.endsWith(".sbml") || uri.endsWith(".sbml.xml")) {
      return createDomainBuilderBackend(async (text) => {
        const { parseSbml } = await import("@modelscript/sbml");
        const { buildSbmlDiagram } = await import("@modelscript/diagram/sbml-diagram-builder");
        const doc = parseSbml(text) as any;
        return buildSbmlDiagram(doc.model ?? doc);
      });
    }

    if (plugin?.id === "touchstone" || /\.(s\d+p|ts)$/i.test(uri)) {
      return createDomainBuilderBackend(async (text) => {
        const { parseTouchstone } = await import("@modelscript/touchstone");
        const { buildTouchstoneDiagram } = await import("@modelscript/diagram/touchstone-diagram-builder");
        const doc = parseTouchstone(text) as any;
        return buildTouchstoneDiagram({ portCount: doc.numPorts ?? doc.portCount ?? 2, ...doc });
      });
    }

    if (plugin?.id === "easy5" || /\.(ezmf|ez5|ezm|ezd|eas)$/i.test(uri)) {
      return createDomainBuilderBackend(async (text) => {
        const { parseEasy5, buildEasy5DiagramData } = await import("@modelscript/easy5");
        return buildEasy5DiagramData(parseEasy5(text));
      });
    }

    if (plugin?.id === "rocets" || /\.(roc|deck)$/i.test(uri)) {
      return createDomainBuilderBackend(async (text) => {
        const { parseRocetsDeck, buildRocetsDiagramData } = await import("@modelscript/rocets");
        return buildRocetsDiagramData(parseRocetsDeck(text));
      });
    }

    if (plugin?.id === "gtsuite" || /\.(gtm|gtd|gtx|gt)$/i.test(uri)) {
      return createDomainBuilderBackend(async (text, params) => {
        const { parseGtmModel, buildGtSuiteDiagramData } = await import("@modelscript/gtsuite");
        return buildGtSuiteDiagramData(parseGtmModel(text, params.uri));
      });
    }

    if (plugin?.id === "ssp" || /\.(ssd|ssp|ssv)$/i.test(uri)) {
      return createDomainBuilderBackend(async (text) => {
        const { parseSsd, buildSspDiagramData } = (await import("@modelscript/ssp")) as any;
        return typeof buildSspDiagramData === "function" ? buildSspDiagramData(parseSsd(text)) : null;
      });
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
  };
}

// ── Modelica Batch Processor (preserved for backward compat) ──

export function processDiagramEditBatch(
  request: DiagramApplyEditsParams,

  classInstance: any,
  docText: string,
): DiagramApplyEditsResult {
  const ops = getModelicaDiagramOps();
  const allEdits: TextEdit[] = [];
  let needsRender: "none" | "immediate" | "debounced" = "none";

  for (const action of request.actions) {
    switch (action.type) {
      case "move":
        if (ops.computePlacementEdits)
          allEdits.push(...ops.computePlacementEdits(docText, classInstance, action.items));
        if (needsRender === "none") needsRender = "none"; // spatial
        break;
      case "resize":
      case "rotate":
        if (ops.computePlacementEdits)
          allEdits.push(...ops.computePlacementEdits(docText, classInstance, [action.item]));
        if (needsRender === "none") needsRender = "none"; // spatial
        break;
      case "moveEdge":
        {
          const lines = docText.split("\n");
          if (ops.computeEdgePointEdits)
            allEdits.push(...ops.computeEdgePointEdits(lines, classInstance, action.edges));
        }
        if (needsRender === "none") needsRender = "none"; // spatial
        break;
      case "connect":
        if (ops.computeConnectInsert)
          allEdits.push(
            ...ops.computeConnectInsert(
              docText,
              classInstance,
              action.source,
              action.target,
              action.points,
              action.color,
            ),
          );
        needsRender = "immediate";
        break;
      case "disconnect":
        if (ops.computeConnectRemove)
          allEdits.push(...ops.computeConnectRemove(docText, classInstance, action.source, action.target));
        needsRender = "immediate";
        break;
      case "reconnect":
        if (ops.computeConnectRemove)
          allEdits.push(...ops.computeConnectRemove(docText, classInstance, action.oldSource, action.oldTarget));
        if (ops.computeConnectInsert)
          allEdits.push(
            ...ops.computeConnectInsert(
              docText,
              classInstance,
              action.newSource,
              action.newTarget,
              action.points,
              action.color,
            ),
          );
        needsRender = "immediate";
        break;
      case "addComponent": {
        const baseName = action.className.split(".").pop() || "comp";
        let uniqueName = baseName + "1";
        let counter = 1;

        const existingNames = new Set(Array.from(classInstance.components || []).map((c: any) => c.name));
        while (existingNames.has(uniqueName)) {
          counter++;
          uniqueName = baseName + counter;
        }
        if (ops.computeComponentInsert) {
          allEdits.push(
            ...ops.computeComponentInsert(classInstance, action.className, uniqueName, action.x, action.y, docText),
          );
        }
        needsRender = "immediate";
        break;
      }
      case "deleteComponents":
        if (ops.computeComponentsDelete)
          allEdits.push(...ops.computeComponentsDelete(docText, classInstance, action.names));
        needsRender = "immediate";
        break;
      case "updateName":
        if (ops.computeNameEdit) allEdits.push(...ops.computeNameEdit(classInstance, action.oldName, action.newName));
        needsRender = "debounced";
        break;
      case "updateDescription":
        if (ops.computeDescriptionEdit)
          allEdits.push(...ops.computeDescriptionEdit(docText, classInstance, action.name, action.description));
        needsRender = "debounced";
        break;
      case "updateParameter":
        if (ops.computeParameterEdit)
          allEdits.push(...ops.computeParameterEdit(classInstance, action.name, action.parameter, action.value));
        if (needsRender === "none") needsRender = "none";
        break;
      case "updateProperty":
        if (ops.computeParameterEdit)
          allEdits.push(...ops.computeParameterEdit(classInstance, action.name, action.key, String(action.value)));
        if (needsRender === "none") needsRender = "none";
        break;
    }
  }

  const sortFn = ops.deduplicateAndSort ?? ((edits: TextEdit[]) => edits);
  return {
    seq: request.seq,
    edits: sortFn(allEdits),
    renderHint: needsRender,
  };
}
