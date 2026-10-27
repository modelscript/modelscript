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
    return {
      className: "Component",
      name: params.componentName,
      description: "",
      parameters: [],
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
          if (config?.placement?.persistence === "inline" && docText !== undefined) {
            for (const item of action.items) {
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
            itemsToSave.push(...action.items);
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
            const paramRegex = new RegExp(`\\b(${escParam}\\s*=\\s*)([^,;\\)\\}\\n]+)`);
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
      (uri.endsWith(".owl") || uri.endsWith(".ofn") || uri.endsWith(".owx") || uri.endsWith(".ttl"))
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

    const formatKinematicDiagramData = (rawDiagram: any): DiagramData => {
      const nodes = rawDiagram.cells.filter((c: any) => c.shape !== "edge");
      const edges = rawDiagram.cells.filter((c: any) => c.shape === "edge");
      return {
        nodes,
        edges,
        coordinateSystem: null,
        diagramBackground: null,
        cells: rawDiagram.cells,
      } as any;
    };

    if (uri.endsWith(".spck") || uri.endsWith(".sim")) {
      if (backends.simpack) return backends.simpack;
      return {
        async getData(params: DiagramGetDataParams): Promise<DiagramData | null> {
          try {
            const text = await readKinematicSource(params.uri);
            if (!text) return null;
            const { parseSpckXml, parseSimDeck, buildSimpackDiagram } = await import("@modelscript/simpack");
            const model = params.uri.endsWith(".sim") ? parseSimDeck(text) : parseSpckXml(text);
            const rawDiagram = buildSimpackDiagram(model);
            return formatKinematicDiagramData(rawDiagram);
          } catch {
            return null;
          }
        },
        async getComponentProperties(): Promise<ComponentPropertyData | null> {
          return null;
        },
        async applyEdits(params: DiagramApplyEditsParams): Promise<DiagramApplyEditsResult> {
          return { seq: params.seq, edits: [], renderHint: "none" };
        },
      };
    }

    if (uri.endsWith(".calc") || uri.endsWith(".trax")) {
      if (backends.gensys) return backends.gensys;
      return {
        async getData(params: DiagramGetDataParams): Promise<DiagramData | null> {
          try {
            const text = await readKinematicSource(params.uri);
            if (!text) return null;
            const { parseGensysDeck, buildGensysDiagram } = await import("@modelscript/gensys");
            const model = parseGensysDeck(text);
            const rawDiagram = buildGensysDiagram(model);
            return formatKinematicDiagramData(rawDiagram);
          } catch {
            return null;
          }
        },
        async getComponentProperties(): Promise<ComponentPropertyData | null> {
          return null;
        },
        async applyEdits(params: DiagramApplyEditsParams): Promise<DiagramApplyEditsResult> {
          return { seq: params.seq, edits: [], renderHint: "none" };
        },
      };
    }

    if (uri.endsWith(".adm") || uri.endsWith(".cmd") || uri.endsWith(".mnf")) {
      if (backends.adams) return backends.adams;
      return {
        async getData(params: DiagramGetDataParams): Promise<DiagramData | null> {
          try {
            const text = await readKinematicSource(params.uri);
            if (!text) return null;
            const { parseAdams, buildAdamsDiagram } = await import("@modelscript/adams");
            const model = parseAdams(text);
            const rawDiagram = buildAdamsDiagram(model);
            return formatKinematicDiagramData(rawDiagram);
          } catch {
            return null;
          }
        },
        async getComponentProperties(): Promise<ComponentPropertyData | null> {
          return null;
        },
        async applyEdits(params: DiagramApplyEditsParams): Promise<DiagramApplyEditsResult> {
          return { seq: params.seq, edits: [], renderHint: "none" };
        },
      };
    }

    if (uri.endsWith(".urdf") || uri.endsWith(".xacro")) {
      if (backends.urdf) return backends.urdf;
      return {
        async getData(params: DiagramGetDataParams): Promise<DiagramData | null> {
          try {
            const text = await readKinematicSource(params.uri);
            if (!text) return null;
            const { parseUrdf, buildUrdfDiagram } = await import("@modelscript/urdf");
            const model = parseUrdf(text);
            const rawDiagram = buildUrdfDiagram(model);
            return formatKinematicDiagramData(rawDiagram);
          } catch {
            return null;
          }
        },
        async getComponentProperties(): Promise<ComponentPropertyData | null> {
          return null;
        },
        async applyEdits(params: DiagramApplyEditsParams): Promise<DiagramApplyEditsResult> {
          return { seq: params.seq, edits: [], renderHint: "none" };
        },
      };
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
