// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Unified Diagram API dispatch layer.
// Routes diagram requests to language-specific backends (Modelica / SysML2)
// based on the document URI. This replaces the per-method if-branching that
// was previously scattered across 12 handlers in browserServerMain.ts.

import { buildDiagramFromDSL, buildPolyglotDiagram } from "@modelscript/diagram/builder";
import { SidecarLayoutStorage } from "@modelscript/diagram/layout-storage";
import { compileDiagramConfigToPolyglot } from "@modelscript/dsl";
import {
  buildComponentProperties,
  buildDiagramData,
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
} from "@modelscript/modelica/diagram";
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
} from "./diagramProtocol.js";

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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getDocumentInstances: (uri: string) => any[] | undefined;
  getDocumentText: (uri: string) => string | undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  resolveClassInstance: (uri: string, className?: string) => any | null;
  flushValidation: (uri: string) => Promise<void>;
}

export class ModelicaDiagramBackend implements DiagramBackend {
  constructor(private readonly deps: ModelicaBackendDeps) {}

  async getData(params: DiagramGetDataParams): Promise<DiagramData | null> {
    const classInstance = this.deps.resolveClassInstance(params.uri, params.className);
    if (!classInstance) return null;

    try {
      return await buildDiagramData(classInstance);
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

  async applyEdits(params: DiagramApplyEditsParams): Promise<DiagramApplyEditsResult> {
    await this.deps.flushValidation(params.uri);
    const instances = this.deps.getDocumentInstances(params.uri);
    const docText = this.deps.getDocumentText(params.uri);
    if (!instances?.[0] || !docText) {
      return { seq: params.seq, edits: [], renderHint: "none" };
    }

    return processDiagramEditBatch(params, instances[0], docText);
  }

  async drillDown(params: DiagramDrillDownParams): Promise<DiagramDrillDownResult | null> {
    const targetName = params.className || params.componentName;
    if (!targetName) return null;
    const classInstance = this.deps.resolveClassInstance(params.uri, targetName);
    if (!classInstance) return null;
    const childData = await buildDiagramData(classInstance);
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
  getLayout: (uri: string) => import("@modelscript/sysml2/diagram").SysML2Layout | undefined;
  setLayout: (uri: string, layout: import("@modelscript/sysml2/diagram").SysML2Layout) => void;
  createEmptyLayout: () => import("@modelscript/sysml2/diagram").SysML2Layout;
  updateElementPositions: (
    layout: import("@modelscript/sysml2/diagram").SysML2Layout,
    items: { name: string; x: number; y: number; width: number; height: number; rotation?: number }[],
  ) => import("@modelscript/sysml2/diagram").SysML2Layout;
  updateConnectionVertices: (
    layout: import("@modelscript/sysml2/diagram").SysML2Layout,
    updates: { id: string; vertices: { x: number; y: number }[] }[],
  ) => import("@modelscript/sysml2/diagram").SysML2Layout;
  removeElements: (
    layout: import("@modelscript/sysml2/diagram").SysML2Layout,
    names: string[],
  ) => import("@modelscript/sysml2/diagram").SysML2Layout;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  buildDiagramData: (params: DiagramGetDataParams) => any;
  getSysML2Parser: () => { parse: (text: string) => unknown } | null;
  computeConnectionInsert: (text: string, source: string, target: string) => TextEdit[];
  computeConnectionDelete: (text: string, source: string, target: string) => TextEdit[];
  computeElementInsert: (text: string, elementType: string, name: string) => TextEdit[];
  computeElementDelete: (text: string, names: string[]) => TextEdit[];
  generateUniqueName: (text: string, baseName: string) => string;
  computeNameEdit: (tree: unknown, text: string, oldName: string, newName: string) => TextEdit[];
  computeDescriptionEdit: (tree: unknown, text: string, name: string, desc: string) => TextEdit[];
  computeParameterEdit: (tree: unknown, text: string, name: string, param: string, value: string) => TextEdit[];
  /** Query symbol data from the unified index for the component properties panel. */
  getSymbolData?: (
    uri: string,
    componentName: string,
  ) => {
    ruleName: string;
    name: string;
    description?: string;
    children?: { name: string; ruleName: string; value?: string; description?: string; direction?: string }[];
  } | null;
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
    if (data.children) {
      for (const child of data.children) {
        // Only show attribute-like children as parameters
        if (
          child.ruleName.includes("Attribute") ||
          child.ruleName.includes("Usage") ||
          child.ruleName.includes("Port")
        ) {
          parameters.push({
            name: child.name,
            value: child.value ?? "",
            description: child.description,
          });
        }
      }
    }

    return {
      className: data.ruleName.replace(/(Definition|Usage)$/, ""),
      name: data.name,
      description: data.description ?? "",
      parameters,
    };
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
          case "reconnect":
            allEdits.push(...this.deps.computeConnectionDelete(docText, action.oldSource, action.oldTarget));
            allEdits.push(...this.deps.computeConnectionInsert(docText, action.newSource, action.newTarget));
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
          case "addComponent": {
            const elementType = action.className;
            const baseParts = elementType.replace("Definition", "").replace("Usage", "");
            const baseName = baseParts.charAt(0).toLowerCase() + baseParts.slice(1);
            const uniqueName = this.deps.generateUniqueName(docText, baseName);
            allEdits.push(...this.deps.computeElementInsert(docText, elementType, uniqueName));
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
    }

    return {
      seq: params.seq,
      edits: deduplicateAndSort(allEdits),
      renderHint: needsRender,
    };
  }

  getPalette(params: DiagramGetPaletteParams): DiagramPalette | null {
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

// ── Generic DSL Diagram Backend ──

export interface GenericDSLBackendDeps {
  getDocumentText: (uri: string) => string | undefined;
  getDiagramConfig?: (uri: string) => any;
  getSyntaxNames?: (uri: string) => Record<number, string> | string[] | undefined;
  getRawAstData?: (uri: string) => { nodes: any[]; edges: any[] } | null;
  getSymbolIndex?: (uri: string) => any;
  getScopeResolver?: (uri: string) => any;
  layoutStorage?: SidecarLayoutStorage;
}

function findSectionClosingLine(lines: string[], sectionName: string): number | null {
  const secRegex = new RegExp(`\\b${sectionName}\\b`);
  let inSection = false;
  let depth = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
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
        if (lines[i].trim() === "}") {
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
    if (lines[i].trim() === "}") {
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
  private readonly layoutStorage: SidecarLayoutStorage;

  constructor(private readonly deps: GenericDSLBackendDeps) {
    this.layoutStorage = deps.layoutStorage ?? new SidecarLayoutStorage();
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

    // Merge persisted layout if available
    const layout = await this.layoutStorage.loadLayout(params.uri);
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
      data: childData ?? undefined,
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
                if (nameRegex.test(maskedLines[i])) {
                  const line = lines[i];
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
              if (nameRegex.test(maskedLines[i])) {
                const line = lines[i];
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
            await this.layoutStorage.updatePositions(params.uri, [
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
              if (maskedLines[i].includes(action.source) && maskedLines[i].includes(action.target)) {
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
              const line = lines[i];
              if (maskedLines[i].includes(action.oldSource) && maskedLines[i].includes(action.oldTarget)) {
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
                if (declRegex.test(maskedLines[i])) {
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
            await this.layoutStorage.updatePositions(params.uri, [
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
          if (docText !== undefined && action.oldName && action.newName) {
            const escOld = action.oldName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            const regex = new RegExp(`\\b${escOld}\\b`, "g");
            for (let i = 0; i < lines.length; i++) {
              let match: RegExpExecArray | null;
              while ((match = regex.exec(maskedLines[i])) !== null) {
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
        case "updateParameter": {
          if (docText !== undefined && action.parameter && action.value !== undefined) {
            const escParam = action.parameter.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            const paramRegex = new RegExp(`\\b(${escParam}\\s*=\\s*)([^,;\\)\\}\\n]+)`);
            let matched = false;

            if (action.name) {
              const escName = action.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
              const nameRegex = new RegExp(`\\b${escName}\\b`);
              for (let i = 0; i < lines.length; i++) {
                if (nameRegex.test(maskedLines[i])) {
                  for (let j = i; j < Math.min(lines.length, i + 6); j++) {
                    const m = paramRegex.exec(maskedLines[j]);
                    if (m) {
                      const startCol = m.index + m[1].length;
                      const endCol = startCol + m[2].trimEnd().length;
                      allEdits.push({
                        range: {
                          start: { line: j, character: startCol },
                          end: { line: j, character: endCol },
                        },
                        newText: String(action.value),
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
                const m = paramRegex.exec(maskedLines[i]);
                if (m) {
                  const startCol = m.index + m[1].length;
                  const endCol = startCol + m[2].trimEnd().length;
                  allEdits.push({
                    range: {
                      start: { line: i, character: startCol },
                      end: { line: i, character: endCol },
                    },
                    newText: String(action.value),
                  });
                  break;
                }
              }
            }
          }
          break;
        }
      }
    }

    if (itemsToSave.length > 0) {
      await this.layoutStorage.updatePositions(params.uri, itemsToSave);
    }

    return {
      seq: params.seq,
      edits: allEdits,
      renderHint: allEdits.length > 0 ? "immediate" : itemsToSave.length > 0 ? "none" : "immediate",
    };
  }
}

// ── Dispatch Factory ──

export interface DiagramDispatchDeps {
  modelica: DiagramBackend;
  sysml2: DiagramBackend;
  generic?: DiagramBackend;
  customBackends?: Map<string | RegExp, DiagramBackend>;
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
    if (uri.endsWith(".sysml")) return backends.sysml2;
    if (uri.endsWith(".mo")) return backends.modelica;
    return backends.generic ?? backends.modelica;
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  classInstance: any,
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
      case "reconnect":
        allEdits.push(...computeConnectRemove(docText, classInstance, action.oldSource, action.oldTarget));
        allEdits.push(...computeConnectInsert(docText, classInstance, action.newSource, action.newTarget));
        needsRender = "immediate";
        break;
      case "addComponent": {
        const baseName = action.className.split(".").pop() || "comp";
        let uniqueName = baseName + "1";
        let counter = 1;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const existingNames = new Set(Array.from(classInstance.components).map((c: any) => c.name));
        while (existingNames.has(uniqueName)) {
          counter++;
          uniqueName = baseName + counter;
        }
        allEdits.push(
          ...computeComponentInsert(classInstance, action.className, uniqueName, action.x, action.y, docText),
        );
        needsRender = "immediate";
        break;
      }
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
        // Parameter edits are treated as optimistic — the webview patches the
        // diagram text in-place without a full re-render.
        if (needsRender === "none") needsRender = "none";
        break;
    }
  }

  return {
    seq: request.seq,
    edits: deduplicateAndSort(allEdits),
    renderHint: needsRender,
  };
}
