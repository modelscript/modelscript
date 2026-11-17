// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  createOpenDriveDiagramBackend,
  createPscadDiagramBackend,
  createPsseDiagramBackend,
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
import {
  computeModelicaComponentDropEdits,
  resolveCrossLanguageComponentDrop,
  resolveGenericComponentDrop,
} from "./cross-language-drop.js";
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
import type { CstNodeLike, CstParserLike } from "./utils/ast-utils.js";

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
  isDocumentStale?: ((uri: string) => boolean) | undefined;
  getUnifiedIndex?: (() => any) | undefined;
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

    if (docText === undefined) {
      return { seq: params.seq, edits: [], renderHint: "none" };
    }

    let targetInstance = this.resolveTargetInstance(params.uri, params.className, instances, docText);
    if (!targetInstance) {
      const currentText = docText ?? "";
      const strippedText = maskComments(currentText).trim();
      const addActions = params.actions.filter((a) => a.type === "addComponent");
      if (strippedText.length === 0 && addActions.length > 0) {
        const cleanUri = params.uri.split(/[?#]/)[0] ?? "";
        const baseFile =
          cleanUri
            .split(/[/\\]/)
            .pop()
            ?.replace(/\.[^.]+$/, "") ?? "";
        const modelName = isSimpleIdentifier(baseFile) ? baseFile : "Model1";
        const unifiedIndex = this.deps.getUnifiedIndex?.() ?? null;
        const usedNames = new Set<string>();
        const importLines: string[] = [];
        const seenImports = new Set<string>();
        const stubBlocks: string[] = [];
        const seenStubs = new Set<string>();
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
          const resolved = resolveCrossLanguageComponentDrop(unifiedIndex, rawClass, "modelica", currentText);
          if (resolved.importPath && !seenImports.has(resolved.importPath)) {
            seenImports.add(resolved.importPath);
            importLines.push(`  import ${resolved.importPath};`);
          }
          if (resolved.stubBlock && resolved.stubName && !seenStubs.has(resolved.stubName)) {
            seenStubs.add(resolved.stubName);
            const indentedStub = resolved.stubBlock
              .split("\n")
              .map((l) => (l.trim().length > 0 ? `  ${l}` : ""))
              .join("\n");
            stubBlocks.push(indentedStub);
          }
          const baseName =
            (resolved.baseName || resolved.className.split(".").pop() || "comp").replace(/[^A-Za-z0-9_]/g, "") ||
            "comp";
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
            `  ${resolved.className} ${uniqueName} annotation(Placement(transformation(origin={${ox},${oy}}, extent={{-10,-10},{10,10}})));`,
          );
        }
        if (declLines.length > 0) {
          const lines = currentText.split("\n");
          const endLine = Math.max(0, lines.length - 1);
          const endChar = lines[endLine]?.length ?? 0;
          const prefix = currentText.length > 0 && !currentText.endsWith("\n") ? `${currentText}\n` : currentText;
          const sections = [...importLines, ...stubBlocks, ...declLines];
          const newText = `${prefix}model ${modelName}\n${sections.join("\n")}\nend ${modelName};\n`;
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

    const needsUnifiedIndex = params.actions.some((a) => a.type === "addComponent");
    const unifiedIndex = needsUnifiedIndex ? (this.deps.getUnifiedIndex?.() ?? null) : null;
    let result = processDiagramEditBatch(params, targetInstance, docText, unifiedIndex);

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
          result = processDiagramEditBatch(params, freshTarget, freshDocText, unifiedIndex);
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
    options?: unknown,
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
  getUnifiedIndex?: (() => any) | undefined;
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
            const unifiedIndex = this.deps.getUnifiedIndex?.() ?? null;
            const resolved = resolveCrossLanguageComponentDrop(unifiedIndex, action.className, "sysml2", docText);
            const candidateBase = action.name || resolved.baseName || "part";
            let uniqueName = this.deps.generateUniqueName(docText, candidateBase);
            if (!action.name) {
              let idx = 1;
              while (allEdits.some((e) => hasWordMatch(e.newText, uniqueName))) {
                idx++;
                uniqueName = this.deps.generateUniqueName(docText, `${candidateBase}${idx}`);
              }
            }
            const dupImport =
              resolved.importPath && allEdits.some((e) => e.newText.includes(`import ${resolved.importPath};`));
            const dupStub =
              resolved.stubName && allEdits.some((e) => e.newText.includes(`part def ${resolved.stubName}`));
            const effectiveImport = dupImport ? undefined : resolved.importPath;
            const effectiveStub = dupStub ? undefined : resolved.stubBlock;
            const insertOptions =
              effectiveImport || effectiveStub || resolved.sysmlUsageKind || resolved.className !== action.className
                ? {
                    typeName: resolved.className,
                    usageKind: resolved.sysmlUsageKind,
                    importPath: effectiveImport,
                    stubBlock: effectiveStub,
                  }
                : undefined;
            allEdits.push(
              ...this.deps.computeElementInsert(
                docText,
                resolved.className,
                uniqueName,
                undefined,
                tree,
                insertOptions,
              ),
            );
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
  getUnifiedIndex?: (() => any) | undefined;
  getScopeResolver?: ((uri: string) => any) | undefined;
  getParser?: ((langId: string) => CstParserLike | undefined) | undefined;
  layoutStorage?: SidecarLayoutStorage | undefined;
  fsBridge?: FileSystemBridge | undefined;
}

function isWsChar(ch: string): boolean {
  return ch === " " || ch === "\t" || ch === "\r" || ch === "\n" || ch === "\f" || ch === "\v";
}

function isWordTokenChar(ch: string): boolean {
  if (!ch) return false;
  const c = ch.charCodeAt(0);
  return (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95;
}

function isSimpleIdentifier(s: string): boolean {
  if (!s) return false;
  const c0 = s.charCodeAt(0);
  const validStart = (c0 >= 65 && c0 <= 90) || (c0 >= 97 && c0 <= 122) || c0 === 95;
  if (!validStart) return false;
  for (let i = 1; i < s.length; i++) {
    if (!isWordTokenChar(s[i]!)) return false;
  }
  return true;
}

function stripWhitespace(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (!isWsChar(ch)) out += ch;
  }
  return out;
}

function collapseWhitespace(s: string): string {
  let out = "";
  let inWs = true; // trim leading whitespace
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (isWsChar(ch)) {
      if (!inWs) {
        out += " ";
        inWs = true;
      }
    } else {
      out += ch;
      inWs = false;
    }
  }
  return out.endsWith(" ") ? out.slice(0, -1) : out;
}

function leadingWhitespaceOf(s: string): string {
  let i = 0;
  while (i < s.length && isWsChar(s[i]!)) i++;
  return s.slice(0, i);
}

function findNextWordMatchIndex(text: string, word: string, fromIndex = 0): number {
  if (!word) return -1;
  const checkStart = isWordTokenChar(word[0]!);
  const checkEnd = isWordTokenChar(word[word.length - 1]!);
  let idx = text.indexOf(word, fromIndex);
  while (idx !== -1) {
    const beforeOk = !checkStart || idx === 0 || !isWordTokenChar(text[idx - 1]!);
    const afterPos = idx + word.length;
    const afterOk = !checkEnd || afterPos === text.length || !isWordTokenChar(text[afterPos]!);
    if (beforeOk && afterOk) return idx;
    idx = text.indexOf(word, idx + 1);
  }
  return -1;
}

function findAllWordMatchIndices(text: string, word: string): number[] {
  const out: number[] = [];
  if (!word) return out;
  let pos = 0;
  while (pos <= text.length - word.length) {
    const idx = findNextWordMatchIndex(text, word, pos);
    if (idx === -1) break;
    out.push(idx);
    pos = idx + word.length;
  }
  return out;
}

function hasWordMatch(text: string, word: string): boolean {
  return findNextWordMatchIndex(text, word, 0) !== -1;
}

function expandEdgeTemplateText(
  edgeTemplate: unknown,
  source: string,
  target: string,
  sourcePort?: string,
  targetPort?: string,
): string {
  if (typeof edgeTemplate === "function") {
    const fn = edgeTemplate as (src: string, tgt: string, sp?: string, tp?: string) => unknown;
    const result = fn(source, target, sourcePort, targetPort);
    return typeof result === "string" ? result : "";
  }
  if (typeof edgeTemplate !== "string" || !edgeTemplate.trim()) {
    const src = sourcePort ? `${source}.${sourcePort}` : source;
    const tgt = targetPort ? `${target}.${targetPort}` : target;
    return `connect(${src}, ${tgt});`;
  }
  const sPort = sourcePort ?? "";
  const tPort = targetPort ?? "";
  let out = edgeTemplate;
  if (!sPort) {
    out = out.replaceAll(".${sourcePort}", "").replaceAll(".{{sourcePort}}", "").replaceAll(".{sourcePort}", "");
  }
  if (!tPort) {
    out = out.replaceAll(".${targetPort}", "").replaceAll(".{{targetPort}}", "").replaceAll(".{targetPort}", "");
  }
  return out
    .replaceAll("${source}", source)
    .replaceAll("{{source}}", source)
    .replaceAll("{source}", source)
    .replaceAll("${target}", target)
    .replaceAll("{{target}}", target)
    .replaceAll("{target}", target)
    .replaceAll("${sourcePort}", sPort)
    .replaceAll("{{sourcePort}}", sPort)
    .replaceAll("{sourcePort}", sPort)
    .replaceAll("${targetPort}", tPort)
    .replaceAll("{{targetPort}}", tPort)
    .replaceAll("{targetPort}", tPort);
}

function countEndpointMatches(text: string, node: string, port: string | undefined): number {
  if (!node) return 0;
  const indices = findAllWordMatchIndices(text, node);
  if (!port) return indices.length;
  let count = 0;
  for (const idx of indices) {
    let p = idx + node.length;
    while (p < text.length && (text[p] === " " || text[p] === "\t")) p++;
    if (text[p] === "." || text[p] === ":") {
      p++;
      while (p < text.length && (text[p] === " " || text[p] === "\t")) p++;
      if (text.startsWith(port, p)) {
        const after = p + port.length;
        if (after === text.length || !isWordTokenChar(text[after]!)) {
          count++;
        }
      }
    }
  }
  if (count === 0 && text.includes("<") && indices.length > 0 && hasWordMatch(text, port)) {
    return 1;
  }
  return count;
}

function statementMatchesEndpoints(
  text: string,
  src: string,
  srcPort: string | undefined,
  tgt: string,
  tgtPort: string | undefined,
): boolean {
  const srcCount = countEndpointMatches(text, src, srcPort);
  if (srcCount === 0) return false;
  if (src === tgt && (srcPort ?? "") === (tgtPort ?? "")) {
    return srcCount >= 2;
  }
  return countEndpointMatches(text, tgt, tgtPort) > 0;
}

function findStatementEndLine(maskedLines: string[], startLine: number): number {
  let parenDepth = 0;
  let braceDepth = 0;
  let bracketDepth = 0;
  let inQuote: string | null = null;

  for (let j = startLine; j < maskedLines.length; j++) {
    const line = maskedLines[j]!;
    let sawTopLevelSemi = false;
    for (let k = 0; k < line.length; k++) {
      const ch = line[k]!;
      if (inQuote) {
        if (ch === "\\" && k + 1 < line.length) {
          k++;
        } else if (ch === inQuote) {
          inQuote = null;
        }
        continue;
      }
      if (ch === '"' || ch === "'") {
        inQuote = ch;
        continue;
      }
      if (ch === "(") parenDepth++;
      else if (ch === ")") parenDepth = Math.max(0, parenDepth - 1);
      else if (ch === "{") braceDepth++;
      else if (ch === "}") braceDepth = Math.max(0, braceDepth - 1);
      else if (ch === "[") bracketDepth++;
      else if (ch === "]") bracketDepth = Math.max(0, bracketDepth - 1);
      else if (ch === ";" && parenDepth === 0 && braceDepth === 0 && bracketDepth === 0) {
        sawTopLevelSemi = true;
      }
    }

    if (sawTopLevelSemi) return j;
    if (parenDepth === 0 && braceDepth === 0 && bracketDepth === 0) {
      const nextLine = j + 1 < maskedLines.length ? maskedLines[j + 1]!.trimStart() : "";
      if (nextLine.startsWith("annotation") && nextLine.length > 10 && !isWordTokenChar(nextLine[10]!)) {
        continue;
      }
      return j;
    }
  }
  return maskedLines.length - 1;
}

function findMatchingEdgeStatement(
  maskedLines: string[],
  src: string,
  srcPort: string | undefined,
  tgt: string,
  tgtPort: string | undefined,
): { startLine: number; endLine: number } | null {
  for (let i = 0; i < maskedLines.length; i++) {
    const line = maskedLines[i]!;
    if (!line.trim()) continue;
    if (statementMatchesEndpoints(line, src, srcPort, tgt, tgtPort)) {
      const endLine = findStatementEndLine(maskedLines, i);
      return { startLine: i, endLine };
    }
    const trimmed = line.trimStart();
    if ((trimmed.startsWith("connect") || hasWordMatch(line, src)) && (line.includes("(") || line.includes("{"))) {
      const endLine = findStatementEndLine(maskedLines, i);
      if (endLine > i) {
        const joined = maskedLines.slice(i, endLine + 1).join("\n");
        if (statementMatchesEndpoints(joined, src, srcPort, tgt, tgtPort)) {
          return { startLine: i, endLine };
        }
      }
    }
  }
  return null;
}

function extractTrailingAnnotationClause(stmtText: string): string | null {
  const matches = findAllWordMatchIndices(stmtText, "annotation");
  for (let m = matches.length - 1; m >= 0; m--) {
    const startIdx = matches[m]!;
    let p = startIdx + "annotation".length;
    while (p < stmtText.length && isWsChar(stmtText[p]!)) p++;
    if (stmtText[p] !== "(") continue;
    let depth = 0;
    let inQuote: string | null = null;
    for (let k = p; k < stmtText.length; k++) {
      const ch = stmtText[k]!;
      if (inQuote) {
        if (ch === "\\" && k + 1 < stmtText.length) k++;
        else if (ch === inQuote) inQuote = null;
        continue;
      }
      if (ch === '"' || ch === "'") {
        inQuote = ch;
        continue;
      }
      if (ch === "(") depth++;
      else if (ch === ")") {
        depth--;
        if (depth === 0) {
          let endIdx = k + 1;
          while (endIdx < stmtText.length && isWsChar(stmtText[endIdx]!)) endIdx++;
          return stmtText.slice(startIdx, stmtText[endIdx] === ";" ? endIdx + 1 : k + 1);
        }
      }
    }
  }
  return null;
}

function findParamAssignmentValueSpan(
  maskedLine: string,
  paramName: string,
): { startCol: number; endCol: number } | null {
  if (!paramName) return null;
  let searchFrom = 0;
  while (searchFrom < maskedLine.length) {
    const idx = findNextWordMatchIndex(maskedLine, paramName, searchFrom);
    if (idx === -1) return null;
    // Do not match qualified sub-segments like `foo.R` when looking for `R` unless `paramName` contains `.`
    if (!paramName.includes(".") && idx > 0 && maskedLine[idx - 1] === ".") {
      searchFrom = idx + paramName.length;
      continue;
    }
    let p = idx + paramName.length;
    while (p < maskedLine.length && (maskedLine[p] === " " || maskedLine[p] === "\t")) p++;
    const sep = maskedLine[p];
    if (sep !== "=" && sep !== ":") {
      searchFrom = idx + paramName.length;
      continue;
    }
    if (sep === "=" && maskedLine[p + 1] === "=") {
      searchFrom = idx + paramName.length;
      continue;
    }
    p++;
    if (sep === ":" && maskedLine[p] === "=") p++;
    while (p < maskedLine.length && (maskedLine[p] === " " || maskedLine[p] === "\t")) p++;
    const startCol = p;
    let parenDepth = 0;
    let braceDepth = 0;
    let bracketDepth = 0;
    let inQuote: string | null = null;
    let endCol = maskedLine.length;
    for (let k = startCol; k < maskedLine.length; k++) {
      const ch = maskedLine[k]!;
      if (inQuote) {
        if (ch === "\\" && k + 1 < maskedLine.length) k++;
        else if (ch === inQuote) inQuote = null;
        continue;
      }
      if (ch === '"' || ch === "'") {
        inQuote = ch;
        continue;
      }
      if (ch === "(") parenDepth++;
      else if (ch === ")") {
        if (parenDepth === 0 && braceDepth === 0 && bracketDepth === 0) {
          endCol = k;
          break;
        }
        parenDepth--;
      } else if (ch === "{") braceDepth++;
      else if (ch === "}") {
        if (parenDepth === 0 && braceDepth === 0 && bracketDepth === 0) {
          endCol = k;
          break;
        }
        braceDepth--;
      } else if (ch === "[") bracketDepth++;
      else if (ch === "]") bracketDepth = Math.max(0, bracketDepth - 1);
      else if ((ch === "," || ch === ";") && parenDepth === 0 && braceDepth === 0 && bracketDepth === 0) {
        endCol = k;
        break;
      }
    }
    while (endCol > startCol && (maskedLine[endCol - 1] === " " || maskedLine[endCol - 1] === "\t")) {
      endCol--;
    }
    if (endCol > startCol) {
      return { startCol, endCol };
    }
    searchFrom = idx + paramName.length;
  }
  return null;
}

function isKeyStartChar(ch: string): boolean {
  const c = ch.charCodeAt(0);
  return (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95;
}

function isKeyBodyChar(ch: string): boolean {
  return isWordTokenChar(ch) || ch === "." || ch === "-";
}

function isKvStopChar(ch: string): boolean {
  return ch === '"' || ch === "'" || ch === "," || ch === ";" || ch === ")" || ch === "}" || ch === ">" || isWsChar(ch);
}

function extractKeyValuePairsFromLine(line: string): Array<{ key: string; value: string }> {
  const out: Array<{ key: string; value: string }> = [];
  let i = 0;
  while (i < line.length) {
    const ch = line[i]!;
    const prevOk = i === 0 || !isWordTokenChar(line[i - 1]!);
    if (!prevOk || !isKeyStartChar(ch)) {
      i++;
      continue;
    }
    const keyStart = i;
    i++;
    while (i < line.length && isKeyBodyChar(line[i]!)) i++;
    const key = line.slice(keyStart, i);
    let p = i;
    while (p < line.length && isWsChar(line[p]!)) p++;
    if (p >= line.length || (line[p] !== "=" && line[p] !== ":")) {
      continue;
    }
    p++;
    while (p < line.length && isWsChar(line[p]!)) p++;
    if (p < line.length && (line[p] === '"' || line[p] === "'")) p++;
    const valStart = p;
    while (p < line.length && !isKvStopChar(line[p]!)) p++;
    if (p > valStart) {
      out.push({ key, value: line.slice(valStart, p) });
      i = p;
    }
  }
  return out;
}

function findSectionClosingLine(lines: string[], sectionName: string): number | null {
  let inSection = false;
  let depth = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!inSection) {
      const idx = findNextWordMatchIndex(line, sectionName);
      if (idx !== -1) {
        inSection = true;
        for (const ch of line.substring(idx)) {
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
        graphicsConfig as Parameters<typeof buildPolyglotDiagram>[1],
        params.uri,
        resolver,
        params.diagramType ?? "All",
        options as Parameters<typeof buildPolyglotDiagram>[5],
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
        try {
          const cachedOrProvided = this.deps.getParser?.("scad") ?? plugin?.parser;
          const scadParser = cachedOrProvided ?? (await (await import("@modelscript/scad")).getScadParser());
          const tree = scadParser?.parse?.(docText);
          if (tree?.rootNode) {
            buildScadDiagramFromCst(tree.rootNode, makeStyledNode, makeStyledEdge, nodes, edges);
          }
        } catch {
          // If SCAD WASM parser cannot be loaded, allow downstream fallbacks if any
        }
      }

      // Dedicated Fortran (.f, .for, .f77, .f90, .f95, .f03, .f08) Dataflow & Block Schematic Builder
      const isFortran = /\.(f|for|f77|f90|f95|f03|f08)($|\?|#)/i.test(params.uri) || plugin?.id === "fortran";
      if (nodes.length === 0 && isFortran) {
        try {
          const maskedFortran = maskFortranFixedCommentsAndPreprocessor(docText);
          const cachedOrProvided = this.deps.getParser?.("fortran") ?? plugin?.parser;
          const fortranParser = cachedOrProvided ?? (await (await import("@modelscript/fortran")).getFortranParser());
          const tree = fortranParser?.parse?.(maskedFortran);
          if (tree?.rootNode) {
            buildFortranDiagramFromCst(tree.rootNode, makeStyledNode, makeStyledEdge, nodes, edges);
          }
        } catch {
          // If Fortran WASM parser cannot be loaded, allow downstream fallbacks if any
        }
      }

      if (nodes.length === 0 && plugin?.customHandlers?.symbols) {
        try {
          const syms = plugin.customHandlers.symbols(docText) ?? [];
          let idx = 0;
          const visitSym = (
            sym:
              | {
                  name?: string;
                  kind?: unknown;
                  detail?: unknown;
                  children?: unknown[];
                }
              | null
              | undefined,
            parentId?: string,
          ) => {
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
                visitSym(
                  child as {
                    name?: string;
                    kind?: unknown;
                    detail?: unknown;
                    children?: unknown[];
                  },
                  nodeId,
                );
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
      const lines = docText.replaceAll("\r\n", "\n").split("\n");
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
        for (const { key: k, value: v } of extractKeyValuePairsFromLine(line)) {
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
              emitInlinePlacementEdit(item, lines, maskedLines, config.placement.formatPlacement, allEdits, true);
            }
          } else {
            itemsToSave.push(...moveItems);
          }
          break;
        }
        case "resize":
        case "rotate": {
          if (config?.placement?.persistence === "inline" && docText !== undefined) {
            emitInlinePlacementEdit(action.item, lines, maskedLines, config.placement.formatPlacement, allEdits, false);
          } else {
            itemsToSave.push(action.item);
          }
          break;
        }
        case "connect": {
          const edgeTemplate =
            (action.edgeType && mutations?.edgeTemplates?.[action.edgeType]) ||
            mutations?.edgeTemplate ||
            mutations?.createEdge;
          const edgeText = expandEdgeTemplateText(
            edgeTemplate,
            action.source,
            action.target,
            action.sourcePort,
            action.targetPort,
          );

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
            const matchSpan = findMatchingEdgeStatement(
              maskedLines,
              action.source,
              action.sourcePort,
              action.target,
              action.targetPort,
            );
            if (matchSpan) {
              allEdits.push({
                range: {
                  start: { line: matchSpan.startLine, character: 0 },
                  end: { line: matchSpan.endLine + 1, character: 0 },
                },
                newText: "",
              });
            }
          }
          break;
        }
        case "reconnect": {
          if (docText !== undefined) {
            const matchSpan = findMatchingEdgeStatement(
              maskedLines,
              action.oldSource,
              action.oldSourcePort,
              action.oldTarget,
              action.oldTargetPort,
            );
            const edgeTemplate =
              (action.edgeType && mutations?.edgeTemplates?.[action.edgeType]) ||
              mutations?.edgeTemplate ||
              mutations?.createEdge;

            if (matchSpan) {
              const { startLine: i, endLine } = matchSpan;
              const line = lines[i]!;
              let newEdgeText = "";

              if (typeof edgeTemplate === "function" || typeof edgeTemplate === "string") {
                newEdgeText = expandEdgeTemplateText(
                  edgeTemplate,
                  action.newSource,
                  action.newTarget,
                  action.newSourcePort,
                  action.newTargetPort,
                );
              } else {
                const src = action.newSourcePort ? `${action.newSource}.${action.newSourcePort}` : action.newSource;
                const tgt = action.newTargetPort ? `${action.newTarget}.${action.newTargetPort}` : action.newTarget;
                const fullOldStatement = lines.slice(i, endLine + 1).join("\n");
                const existingAnnot = extractTrailingAnnotationClause(fullOldStatement) ?? ";";

                if (action.points && action.points.length > 0) {
                  const ptsStr = action.points.map((p) => `{${p.x}, ${p.y}}`).join(", ");
                  if (existingAnnot.includes("points")) {
                    const updatedAnnot = replaceBalancedBracesField(existingAnnot, "points", ptsStr);
                    newEdgeText = `connect(${src}, ${tgt}) ${updatedAnnot.trim()}`;
                  } else if (existingAnnot.startsWith("annotation")) {
                    newEdgeText = `connect(${src}, ${tgt}) ${existingAnnot.trim()}`;
                  } else {
                    newEdgeText = `connect(${src}, ${tgt}) annotation(Line(points={${ptsStr}}));`;
                  }
                } else {
                  newEdgeText = `connect(${src}, ${tgt})${existingAnnot.startsWith("annotation") ? ` ${existingAnnot.trim()}` : ";"}`;
                }
              }

              const indent = leadingWhitespaceOf(line);
              allEdits.push({
                range: {
                  start: { line: i, character: 0 },
                  end: { line: endLine, character: lines[endLine]!.length },
                },
                newText: indent + newEdgeText.trim(),
              });
            } else {
              const edgeText = expandEdgeTemplateText(
                edgeTemplate,
                action.newSource,
                action.newTarget,
                action.newSourcePort,
                action.newTargetPort,
              );
              const targetSection =
                action.section || mutations?.sections?.edge || mutations?.insertionSection || mutations?.defaultSection;
              insertIntoSectionOrRoot(lines, allEdits, edgeText, targetSection);
            }
          }
          break;
        }
        case "addComponent": {
          const priorEditText = allEdits.map((e) => e.newText).join("\n");
          const resolvedGeneric = resolveGenericComponentDrop({
            uri: params.uri,
            rawClassName: action.className,
            docText: priorEditText ? `${docText ?? ""}\n${priorEditText}` : (docText ?? ""),
            instanceName: action.name,
            symbolIndex: this.deps.getUnifiedIndex?.() ?? this.deps.getSymbolIndex?.(params.uri) ?? null,
          });
          const resolvedClassName = resolvedGeneric.className;
          const uniqueName = resolvedGeneric.instanceName;

          let nodeText = "";
          if (typeof mutations?.createNode === "function") {
            nodeText = mutations.createNode(resolvedClassName, uniqueName, action.x, action.y);
          } else if (typeof mutations?.nodeTemplate === "function") {
            nodeText = mutations.nodeTemplate(resolvedClassName, uniqueName);
          } else if (typeof mutations?.nodeTemplate === "string") {
            nodeText = mutations.nodeTemplate
              .replaceAll("${className}", resolvedClassName)
              .replaceAll("${name}", uniqueName);
          } else {
            nodeText = `${resolvedClassName} ${uniqueName};\n`;
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
              for (let i = 0; i < lines.length; i++) {
                if (hasWordMatch(maskedLines[i]!, name)) {
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
            for (let i = 0; i < lines.length; i++) {
              for (const col of findAllWordMatchIndices(maskedLines[i]!, action.oldName)) {
                allEdits.push({
                  range: {
                    start: { line: i, character: col },
                    end: { line: i, character: col + action.oldName.length },
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
          const paramVal = action.value;
          if (docText !== undefined && paramName && paramVal !== undefined) {
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

            let matched = false;
            const searchWindow = (startLine: number, endLine: number): boolean => {
              for (let l = startLine; l < endLine; l++) {
                const valSpan = findParamAssignmentValueSpan(maskedLines[l]!, paramName);
                if (valSpan) {
                  allEdits.push({
                    range: {
                      start: { line: l, character: valSpan.startCol },
                      end: { line: l, character: valSpan.endCol },
                    },
                    newText: String(paramVal),
                  });
                  return true;
                }
              }
              return false;
            };

            if (action.name) {
              for (let i = 0; i < lines.length && !matched; i++) {
                if (hasWordMatch(maskedLines[i]!, action.name)) {
                  matched = searchWindow(i, Math.min(lines.length, i + 6));
                }
              }
            }

            if (!matched) {
              matched = searchWindow(0, lines.length);
            }

            // If not matched, try appending new modifier to component declaration
            if (!matched && action.name) {
              for (let i = 0; i < lines.length; i++) {
                if (hasWordMatch(maskedLines[i]!, action.name)) {
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
  getUnifiedIndex?: (() => any) | undefined;
  customBackends?: Map<string | RegExp, DiagramBackend> | undefined;
}

export function getUnifiedIndexFromDeps(backends: DiagramDispatchDeps): any {
  return (
    backends.getUnifiedIndex?.() ??
    (backends.modelica as any)?.deps?.getUnifiedIndex?.() ??
    (backends.sysml2 as any)?.deps?.getUnifiedIndex?.() ??
    (backends.generic as any)?.deps?.getUnifiedIndex?.() ??
    null
  );
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
    if (uri.endsWith(".raw") || uri.endsWith(".dyr")) {
      return createPsseDiagramBackend(backends);
    }
    if (uri.endsWith(".pscx") || uri.endsWith(".pslx") || uri.endsWith(".pswx") || uri.endsWith(".psmx")) {
      return createPscadDiagramBackend(backends);
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

function isWordCharCode(code: number): boolean {
  return (
    (code >= 65 && code <= 90) || // A-Z
    (code >= 97 && code <= 122) || // a-z
    (code >= 48 && code <= 57) || // 0-9
    code === 95 // _
  );
}

function skipWs(text: string, idx: number): number {
  let i = idx;
  while (i < text.length) {
    const ch = text[i]!;
    if (ch !== " " && ch !== "\t" && ch !== "\r" && ch !== "\n") break;
    i++;
  }
  return i;
}

function isWordBoundaryAt(text: string, index: number, len: number): boolean {
  if (len === 0) return false;
  const startsWord = isWordCharCode(text.charCodeAt(index));
  const endsWord = isWordCharCode(text.charCodeAt(index + len - 1));
  if (startsWord && index > 0 && isWordCharCode(text.charCodeAt(index - 1))) return false;
  if (endsWord && index + len < text.length && isWordCharCode(text.charCodeAt(index + len))) return false;
  return true;
}

function scanOutsideStrings(text: string, visitor: (index: number) => boolean): void {
  let inQuote: string | null = null;
  for (let i = 0; i < text.length; i++) {
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
    if (visitor(i) === true) return;
  }
}

function hasWordTokenOutsideStrings(text: string, token: string): boolean {
  if (!token) return false;
  let found = false;
  scanOutsideStrings(text, (i) => {
    if (text.startsWith(token, i) && isWordBoundaryAt(text, i, token.length)) {
      found = true;
      return true;
    }
    return false;
  });
  return found;
}

function emitInlinePlacementEdit(
  item: PlacementItem,
  lines: string[],
  maskedLines: string[],
  formatPlacement: ((x: number, y: number, width?: number, height?: number, rotation?: number) => string) | undefined,
  allEdits: TextEdit[],
  appendAtEolIfNoSemi: boolean,
): void {
  for (let i = 0; i < lines.length; i++) {
    if (hasWordTokenOutsideStrings(maskedLines[i]!, item.name)) {
      const line = lines[i]!;
      const placementStr = formatPlacement
        ? formatPlacement(item.x, item.y, item.width, item.height, item.rotation)
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
        } else if (appendAtEolIfNoSemi) {
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

function findInlinePlacementSpan(line: string): { start: number; end: number } | null {
  let layoutSpan: { start: number; end: number } | null = null;
  scanOutsideStrings(line, (i) => {
    if (!line.startsWith("@layout", i)) return false;
    const parenIdx = skipWs(line, i + 7);
    if (line[parenIdx] !== "(") return false;
    const closeIdx = findBalancedCloseSimple(line, parenIdx);
    if (closeIdx !== -1) {
      layoutSpan = { start: i, end: closeIdx + 1 };
      return true;
    }
    return false;
  });
  if (layoutSpan) return layoutSpan;

  let annotSpan: { start: number; end: number } | null = null;
  scanOutsideStrings(line, (i) => {
    if (!line.startsWith("annotation", i) || !isWordBoundaryAt(line, i, 10)) return false;
    const outerParen = skipWs(line, i + 10);
    if (line[outerParen] !== "(") return false;
    const placementStart = skipWs(line, outerParen + 1);
    if (!line.startsWith("Placement", placementStart) || !isWordBoundaryAt(line, placementStart, 9)) return false;
    const innerParen = skipWs(line, placementStart + 9);
    if (line[innerParen] !== "(") return false;
    const closeIdx = findBalancedCloseSimple(line, outerParen);
    if (closeIdx !== -1) {
      annotSpan = { start: i, end: closeIdx + 1 };
      return true;
    }
    return false;
  });
  return annotSpan;
}

function replaceBalancedBracesField(text: string, fieldName: string, newInner: string): string {
  if (!fieldName) return text;
  let openBraceIdx = -1;
  scanOutsideStrings(text, (i) => {
    if (!text.startsWith(fieldName, i) || !isWordBoundaryAt(text, i, fieldName.length)) return false;
    const eqIdx = skipWs(text, i + fieldName.length);
    if (text[eqIdx] !== "=") return false;
    const braceIdx = skipWs(text, eqIdx + 1);
    if (text[braceIdx] !== "{") return false;
    openBraceIdx = braceIdx;
    return true;
  });
  if (openBraceIdx === -1) return text;
  const closeBraceIdx = findBalancedCloseSimple(text, openBraceIdx);
  if (closeBraceIdx === -1) return text;
  return `${text.slice(0, openBraceIdx + 1)}${newInner}${text.slice(closeBraceIdx)}`;
}

type StyledNodeFn = (opts: {
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
}) => unknown;

type StyledEdgeFn = (id: string, source: string, target: string, dashed?: boolean, labelText?: string) => unknown;

function getCstChildren(node: CstNodeLike | null | undefined): readonly CstNodeLike[] {
  return Array.isArray(node?.children) ? node.children : [];
}

function findCstChild(node: CstNodeLike | null | undefined, type: string): CstNodeLike | undefined {
  return getCstChildren(node).find((c) => c.type === type);
}

function findFirstDescendant(node: CstNodeLike | null | undefined, type: string): CstNodeLike | null {
  for (const child of getCstChildren(node)) {
    if (child.type === type) return child;
    const found = findFirstDescendant(child, type);
    if (found) return found;
  }
  return null;
}

function unquoteCstString(raw: string): string {
  const s = raw.trim();
  if (s.length >= 2 && ((s[0] === '"' && s[s.length - 1] === '"') || (s[0] === "'" && s[s.length - 1] === "'"))) {
    let out = "";
    for (let i = 1; i < s.length - 1; i++) {
      if (s[i] === "\\" && i + 1 < s.length - 1) {
        const next = s[i + 1]!;
        if (next === '"' || next === "'" || next === "\\") {
          out += next;
          i++;
          continue;
        }
      }
      out += s[i]!;
    }
    return out;
  }
  return s;
}

function buildScadDiagramFromCst(
  rootNode: CstNodeLike,
  makeStyledNode: StyledNodeFn,
  makeStyledEdge: StyledEdgeFn,
  nodes: unknown[],
  edges: unknown[],
): void {
  const paramEntries: string[] = [];
  const moduleNodeIds = new Map<string, string>();
  const topModuleCalls = new Map<string, string[]>();
  let nodeCounter = 0;

  const unwrapStmt = (node: CstNodeLike | null | undefined): CstNodeLike | null => {
    if (!node) return null;
    if (node.type === "Statement") {
      return getCstChildren(node).find((c) => c.isNamed) ?? null;
    }
    return node;
  };

  for (const rawChild of getCstChildren(rootNode)) {
    const inner = unwrapStmt(rawChild);
    if (inner?.type === "ModuleDeclaration") {
      const modName = findCstChild(inner, "IDENTIFIER")?.text?.trim();
      if (modName) {
        moduleNodeIds.set(modName, `module_${modName}`);
      }
    }
  }

  const visitScadNode = (rawNode: CstNodeLike | null | undefined, parentId: string | null): void => {
    const node = unwrapStmt(rawNode);
    if (!node) return;

    if (
      node.type === "BlockStatement" ||
      node.type === "IfStatement" ||
      node.type === "ForStatement" ||
      node.type === "IntersectionForStatement"
    ) {
      for (const child of getCstChildren(node)) {
        if (child.type === "Statement" || child.type === "BlockStatement") {
          visitScadNode(child, parentId);
        }
      }
      return;
    }

    if (node.type === "ModuleDeclaration") {
      const modName = findCstChild(node, "IDENTIFIER")?.text?.trim();
      if (!modName) return;
      const paramList = findCstChild(node, "ParameterList");
      const modParams = paramList ? paramList.text.trim() : "";
      const nodeId = moduleNodeIds.get(modName) ?? `module_${modName}`;
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
      for (const child of getCstChildren(node)) {
        if (child.type === "Statement" || child.type === "BlockStatement") {
          visitScadNode(child, nodeId);
        }
      }
      return;
    }

    if (node.type === "PrefixSolid") {
      const children = getCstChildren(node);
      const opNode = children.find(
        (c) =>
          c.type === "TagPortOp" || c.type === "BooleanOp" || c.type === "TransformOp" || c.type === "LinearExtrudeOp",
      );
      const bodyNodes = children.filter((c) => c !== opNode && c.isNamed);
      let nextParentId = parentId;

      if (opNode?.type === "TagPortOp") {
        const argList = findCstChild(opNode, "ArgumentList");
        const positionalStrings: string[] = [];
        let namedPortName: string | undefined;
        let namedPortType: string | undefined;
        for (const arg of getCstChildren(argList)) {
          if (arg.type !== "Argument") continue;
          const hasEq = getCstChildren(arg).some((c) => c.text === "=");
          const keyName = hasEq ? findCstChild(arg, "IDENTIFIER")?.text?.trim().toLowerCase() : undefined;
          const strNode = findFirstDescendant(arg, "STRING");
          if (!strNode) continue;
          const val = unquoteCstString(strNode.text);
          if (keyName === "name" || keyName === "port") namedPortName = val;
          else if (keyName === "type" || keyName === "kind") namedPortType = val;
          else if (!keyName) positionalStrings.push(val);
        }
        const portName = namedPortName ?? positionalStrings[0];
        if (portName) {
          const portType = namedPortType ?? positionalStrings[1] ?? "port";
          const nodeId = `port_${++nodeCounter}_${portName}`;
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
          if (parentId) {
            edges.push(makeStyledEdge(`edge_${parentId}_${nodeId}`, parentId, nodeId));
          }
          nextParentId = nodeId;
        }
      } else if (opNode?.type === "BooleanOp") {
        const opName = getCstChildren(opNode)[0]?.text?.trim() || "boolean";
        const nodeId = `bool_${++nodeCounter}_${opName}`;
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
        if (parentId) {
          edges.push(makeStyledEdge(`edge_${parentId}_${nodeId}`, parentId, nodeId));
        }
        nextParentId = nodeId;
      } else if (opNode?.type === "TransformOp" || opNode?.type === "LinearExtrudeOp") {
        const tfName = getCstChildren(opNode)[0]?.text?.trim() || "transform";
        const tfArgs = findCstChild(opNode, "ArgumentList")?.text?.trim() ?? "";
        const nodeId = `tf_${++nodeCounter}_${tfName}`;
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
        if (parentId) {
          edges.push(makeStyledEdge(`edge_${parentId}_${nodeId}`, parentId, nodeId));
        }
        nextParentId = nodeId;
      }

      for (const body of bodyNodes) {
        visitScadNode(body, nextParentId);
      }
      return;
    }

    if (node.type === "ChainedSolidStatement") {
      const chained = findCstChild(node, "ChainedSolid");
      if (chained) visitScadNode(chained, parentId);
      return;
    }

    if (node.type === "ChainedSolid") {
      const primary = findCstChild(node, "PrimarySolid");
      if (primary) visitScadNode(primary, parentId);
      return;
    }

    if (node.type === "PrimarySolid") {
      const target = getCstChildren(node).find((c) => c.isNamed);
      if (target) visitScadNode(target, parentId);
      return;
    }

    if (
      node.type === "CubePrimitive" ||
      node.type === "CylinderPrimitive" ||
      node.type === "SpherePrimitive" ||
      node.type === "PolyhedronPrimitive" ||
      node.type === "PolygonPrimitive" ||
      node.type === "CirclePrimitive" ||
      node.type === "SquarePrimitive"
    ) {
      const primName = getCstChildren(node)[0]?.text?.trim() ?? "primitive";
      const argList = findCstChild(node, "ArgumentList");
      const keptArgs: string[] = [];
      for (const arg of getCstChildren(argList)) {
        if (arg.type !== "Argument") continue;
        const hasEq = getCstChildren(arg).some((c) => c.text === "=");
        const keyName = hasEq ? findCstChild(arg, "IDENTIFIER")?.text?.trim() : undefined;
        if (keyName === "center") continue;
        keptArgs.push(arg.text.trim());
      }
      const nodeId = `prim_${++nodeCounter}_${primName}`;
      nodes.push(
        makeStyledNode({
          id: nodeId,
          name: primName,
          kind: "Primitive",
          stereotype: "3d solid",
          subtitle: keptArgs.join(", "),
          stroke: "#059669",
          fill: "#ecfdf5",
        }),
      );
      if (parentId) {
        edges.push(makeStyledEdge(`edge_${parentId}_${nodeId}`, parentId, nodeId));
      }
      return;
    }

    if (node.type === "ModuleInstantiation") {
      const callee = findCstChild(node, "IDENTIFIER")?.text?.trim();
      if (!callee) return;
      const callArgs = findCstChild(node, "ArgumentList")?.text?.trim() ?? "";
      if (!parentId) {
        const list = topModuleCalls.get(callee) ?? [];
        list.push(callArgs || "default");
        topModuleCalls.set(callee, list);
      } else {
        const targetModId = moduleNodeIds.get(callee);
        if (targetModId) {
          edges.push(
            makeStyledEdge(
              `edge_call_${++nodeCounter}_${parentId}_${targetModId}`,
              parentId,
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
          edges.push(makeStyledEdge(`edge_${parentId}_${callId}`, parentId, callId));
        }
      }
    }
  };

  for (const rawChild of getCstChildren(rootNode)) {
    const inner = unwrapStmt(rawChild);
    if (!inner) continue;
    if (inner.type === "VariableDeclaration") {
      const varName = findCstChild(inner, "IDENTIFIER")?.text?.trim();
      const exprNode = findCstChild(inner, "Expression");
      if (varName && exprNode) {
        paramEntries.push(`${varName} = ${exprNode.text.trim()}`);
      }
      continue;
    }
    visitScadNode(inner, null);
  }

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

function maskFortranFixedCommentsAndPreprocessor(source: string): string {
  const chars = source.split("");
  let lineStart = 0;
  for (let i = 0; i <= source.length; i++) {
    if (i === source.length || source[i] === "\n") {
      const lineEnd = i > lineStart && source[i - 1] === "\r" ? i - 1 : i;
      const lineLen = lineEnd - lineStart;
      if (lineLen > 0) {
        const ch0 = source[lineStart]!;
        const ch1 = lineLen > 1 ? source[lineStart + 1]! : " ";
        const isFixedComment =
          (ch0 === "C" || ch0 === "c" || ch0 === "*") && (ch1 === " " || ch1 === "\t" || ch1 === "*" || lineLen === 1);
        let firstNonWs = lineStart;
        while (firstNonWs < lineEnd && (source[firstNonWs] === " " || source[firstNonWs] === "\t")) {
          firstNonWs++;
        }
        const isPreprocessor = firstNonWs < lineEnd && source[firstNonWs] === "#";
        if (isFixedComment || isPreprocessor) {
          for (let j = lineStart; j < lineEnd; j++) chars[j] = " ";
        }
      }
      lineStart = i + 1;
    }
  }
  return chars.join("");
}

function buildFortranDiagramFromCst(
  rootNode: CstNodeLike,
  makeStyledNode: StyledNodeFn,
  makeStyledEdge: StyledEdgeFn,
  nodes: unknown[],
  edges: unknown[],
): void {
  interface FortranUnitSummary {
    node: CstNodeLike;
    name: string;
    kind: string;
    params: string[];
    intents: Map<string, string>;
  }

  const unitKindByNodeType: Record<string, string> = {
    SubroutineDeclaration: "subroutine",
    FunctionDeclaration: "function",
    ProgramDeclaration: "program",
    ModuleDeclaration: "module",
  };

  const unitSummaries = new Map<string, FortranUnitSummary>();
  let primaryUnitUpper: string | null = null;
  let primaryRoutineUpper: string | null = null;

  const normalizeWhitespace = (s: string): string => collapseWhitespace(s);

  const extractSubscriptDims = (listNode: CstNodeLike | null | undefined): string => {
    if (!listNode) return "";
    const parts: string[] = [];
    for (const c of getCstChildren(listNode)) {
      if (c.type === "SubscriptItem" || c.type === "Expression" || c.isNamed) {
        const t = c.text?.trim();
        if (t && c.type !== "," && c.type !== "(" && c.type !== ")") parts.push(t);
      }
    }
    return parts.length > 0 ? `[${parts.join("×")}]` : "";
  };

  const unwrapFortranStmt = (node: CstNodeLike | null | undefined): CstNodeLike | null => {
    if (!node) return null;
    if (node.type === "Statement" || node.type === "ProgramUnit") {
      return getCstChildren(node).find((c) => c.isNamed) ?? null;
    }
    return node;
  };

  const collectUnitIntents = (unitNode: CstNodeLike): Map<string, string> => {
    const intents = new Map<string, string>();
    for (const child of getCstChildren(unitNode)) {
      const stmt = unwrapFortranStmt(child);
      if (stmt?.type !== "DeclarationStatement") continue;
      let intent: string | null = null;
      for (const sub of getCstChildren(stmt)) {
        if (sub.type === "AttributeSpec") {
          const specNode = findCstChild(sub, "INTENT_SPEC");
          if (specNode) {
            intent = stripWhitespace(specNode.text.toLowerCase());
          }
        }
      }
      if (!intent) continue;
      const declList = findCstChild(stmt, "DeclaratorList");
      for (const decl of getCstChildren(declList)) {
        if (decl.type !== "Declarator") continue;
        const idNode = findCstChild(decl, "IDENTIFIER");
        if (idNode) intents.set(idNode.text.trim().toLowerCase(), intent);
      }
    }
    return intents;
  };

  const collectUnits = (node: CstNodeLike): void => {
    for (const child of getCstChildren(node)) {
      const inner = unwrapFortranStmt(child);
      if (!inner) continue;
      const kind = unitKindByNodeType[inner.type];
      if (kind) {
        const name = findCstChild(inner, "IDENTIFIER")?.text?.trim();
        if (name) {
          const paramList = findCstChild(inner, "ParameterList");
          const params = getCstChildren(paramList)
            .filter((c) => c.type === "IDENTIFIER")
            .map((c) => c.text.trim());
          const summary: FortranUnitSummary = {
            node: inner,
            name,
            kind,
            params,
            intents: collectUnitIntents(inner),
          };
          const upper = name.toUpperCase();
          unitSummaries.set(upper, summary);
          if (kind === "program" || !primaryUnitUpper) {
            primaryUnitUpper = upper;
          }
          if (kind !== "module" && (!primaryRoutineUpper || kind === "program")) {
            primaryRoutineUpper = upper;
          }
        }
        if (inner.type === "ModuleDeclaration") {
          collectUnits(inner);
        }
      } else if (inner.type === "ProgramUnit") {
        collectUnits(inner);
      }
    }
  };

  collectUnits(rootNode);

  const selectedUpper = primaryRoutineUpper ?? primaryUnitUpper;
  const primaryUnit = selectedUpper ? unitSummaries.get(selectedUpper) : undefined;

  const routineName = primaryUnit?.name ?? "fortran_kernel";
  const routineKind = primaryUnit?.kind ?? "subroutine";
  const dummyArgs = primaryUnit?.params ? [...primaryUnit.params] : [];

  const inputVars = new Map<string, string>();
  const outputVars = new Map<string, string>();
  const varTypes = new Map<string, string>();
  const constants = new Map<string, { name: string; value: string }>();
  const equations: {
    id: string;
    lhs: string;
    lhsBase: string;
    rhs: string;
    rhsRefs: string[];
    isState: boolean;
    lineIdx: number;
    condGuard?: string | undefined;
  }[] = [];
  const callBlocks: {
    id: string;
    subroutine: string;
    args: string[];
    argIdentNames: (string | null)[];
    lineIdx: number;
  }[] = [];

  const guardStack: string[] = [];

  const sanitizeId = (s: string): string => {
    let out = "";
    for (let i = 0; i < s.length; i++) {
      const code = s.charCodeAt(i);
      out += isWordCharCode(code) ? s[i]! : "_";
    }
    return out;
  };

  const collectRefs = (node: CstNodeLike | null | undefined, outRefs: string[], discoveredPorts: string[]): void => {
    if (!node) return;
    if (node.type === "PORT_IDENTIFIER") {
      const pName = node.text.trim().slice(1);
      if (pName) {
        discoveredPorts.push(pName);
        outRefs.push(pName);
      }
      return;
    }
    if (node.type === "IDENTIFIER") {
      const idText = node.text.trim();
      if (idText) outRefs.push(idText);
      return;
    }
    for (const c of getCstChildren(node)) {
      collectRefs(c, outRefs, discoveredPorts);
    }
  };

  const unwrapSingleArgIdent = (subItem: CstNodeLike | null | undefined): string | null => {
    let cur = subItem;
    while (cur) {
      if (cur.type === "IDENTIFIER") return cur.text.trim();
      if (cur.type === "PORT_IDENTIFIER") return cur.text.trim().slice(1);
      if (cur.type === "StateRef") return findCstChild(cur, "STATE_ARRAY")?.text?.trim() ?? null;
      const named = getCstChildren(cur).filter((c) => c.isNamed);
      if (named.length !== 1) return null;
      cur = named[0]!;
    }
    return null;
  };

  const extractTargetInfo = (targetNode: CstNodeLike): { baseName: string; isState: boolean; portName?: string } => {
    const stateRef = findCstChild(targetNode, "StateRef");
    if (stateRef) {
      const arr = findCstChild(stateRef, "STATE_ARRAY")?.text?.trim() ?? "STORF";
      return { baseName: arr, isState: true };
    }
    const portRef = findCstChild(targetNode, "PortRef");
    if (portRef) {
      const pIdent = findCstChild(portRef, "PORT_IDENTIFIER")?.text?.trim() ?? "";
      const pName = pIdent.startsWith("$") ? pIdent.slice(1) : pIdent;
      return { baseName: pName, isState: false, portName: pName };
    }
    const portIdent = findCstChild(targetNode, "PORT_IDENTIFIER");
    if (portIdent) {
      const pText = portIdent.text.trim();
      const pName = pText.startsWith("$") ? pText.slice(1) : pText;
      return { baseName: pName, isState: false, portName: pName };
    }
    const arrOrCall = findCstChild(targetNode, "ArrayOrCallRef");
    if (arrOrCall) {
      const id = findCstChild(arrOrCall, "IDENTIFIER")?.text?.trim() ?? "";
      const upper = id.toUpperCase();
      return {
        baseName: id,
        isState: upper === "STORF" || upper === "STORI" || upper === "SD" || upper === "S" || upper.startsWith("DER_"),
      };
    }
    const idNode = findFirstDescendant(targetNode, "IDENTIFIER");
    const idText = idNode?.text?.trim() ?? targetNode.text.trim();
    const lower = idText.toLowerCase();
    return {
      baseName: idText,
      isState: lower.startsWith("der_") || lower === "storf" || lower === "stori",
    };
  };

  const visitStmt = (rawNode: CstNodeLike): void => {
    const stmt = unwrapFortranStmt(rawNode);
    if (!stmt || stmt.type === "ERROR") return;
    if (unitKindByNodeType[stmt.type]) return;

    if (stmt.type === "DeclarationStatement") {
      const children = getCstChildren(stmt);
      const typeSpec = findCstChild(stmt, "TYPE_SPECIFIER");
      let baseType = typeSpec ? normalizeWhitespace(typeSpec.text.toUpperCase()) : "REAL";
      // Check optional kind specification e.g. real(8) right before AttributeSpec/"::"/"DeclaratorList"
      const typeIdx = typeSpec ? children.indexOf(typeSpec) : -1;
      if (typeIdx !== -1 && children[typeIdx + 1]?.text === "(" && children[typeIdx + 2]?.type === "Expression") {
        baseType = `${baseType}(${children[typeIdx + 2]!.text.trim()})`;
      }

      let intent: string | null = null;
      let attrDimStr = "";
      let isParamAttr = false;
      for (const c of children) {
        if (c.type !== "AttributeSpec") continue;
        const spec = findCstChild(c, "INTENT_SPEC");
        if (spec) intent = stripWhitespace(spec.text.toLowerCase());
        const dimList = findCstChild(c, "DimensionList");
        if (dimList) attrDimStr = extractSubscriptDims(dimList);
        if (findCstChild(c, "PARAMETER_KEYWORD")) isParamAttr = true;
      }

      const declList = findCstChild(stmt, "DeclaratorList");
      for (const decl of getCstChildren(declList)) {
        if (decl.type !== "Declarator") continue;
        const vName = findCstChild(decl, "IDENTIFIER")?.text?.trim();
        if (!vName) continue;
        const lower = vName.toLowerCase();
        const dimNode = findCstChild(decl, "DimensionList") ?? findCstChild(decl, "ArgumentList");
        const inlineDim = dimNode ? extractSubscriptDims(dimNode) : attrDimStr;
        const eqTok = getCstChildren(decl).find((c) => c.text === "=");
        const initExpr = eqTok ? findCstChild(decl, "Expression") : null;
        const initVal = initExpr ? initExpr.text.trim() : undefined;
        varTypes.set(lower, inlineDim ? `${baseType} ${inlineDim}` : baseType);
        if (intent === "in") {
          inputVars.set(lower, vName);
        } else if (intent === "out") {
          outputVars.set(lower, vName);
        } else if (intent === "inout") {
          inputVars.set(lower, vName);
          outputVars.set(lower, vName);
        } else if ((initVal !== undefined || isParamAttr) && initVal !== undefined) {
          constants.set(lower, { name: vName, value: initVal });
        }
      }
      return;
    }

    if (stmt.type === "ParameterStatement") {
      const assignList = findCstChild(stmt, "ParameterAssignmentList");
      for (const pa of getCstChildren(assignList)) {
        if (pa.type !== "ParameterAssignment") continue;
        const pName = findCstChild(pa, "IDENTIFIER")?.text?.trim();
        const pExpr = findCstChild(pa, "Expression");
        if (pName && pExpr) {
          constants.set(pName.toLowerCase(), { name: pName, value: pExpr.text.trim() });
        }
      }
      return;
    }

    if (stmt.type === "BlockIfStatement") {
      const condExpr = findCstChild(stmt, "Expression");
      const condLabel = `IF (${condExpr?.text?.trim() ?? "..."})`;
      guardStack.push(condLabel);
      for (const c of getCstChildren(stmt)) {
        if (c.type === "Statement") {
          visitStmt(c);
        }
      }
      guardStack.pop();

      for (const c of getCstChildren(stmt)) {
        if (c.type === "ElseIfClause") {
          const eCond = findCstChild(c, "Expression");
          guardStack.push(`ELSE IF (${eCond?.text?.trim() ?? "..."})`);
          for (const sub of getCstChildren(c)) {
            if (sub.type === "Statement") visitStmt(sub);
          }
          guardStack.pop();
        } else if (c.type === "ElseClause") {
          guardStack.push(`ELSE [${condLabel}]`);
          for (const sub of getCstChildren(c)) {
            if (sub.type === "Statement") visitStmt(sub);
          }
          guardStack.pop();
        }
      }
      return;
    }

    if (stmt.type === "InlineIfStatement") {
      const condExpr = findCstChild(stmt, "Expression");
      guardStack.push(`IF (${condExpr?.text?.trim() ?? "..."})`);
      for (const c of getCstChildren(stmt)) {
        if (c.type === "Statement") visitStmt(c);
      }
      guardStack.pop();
      return;
    }

    if (stmt.type === "DoStatement") {
      const loopVar = findCstChild(stmt, "IDENTIFIER")?.text?.trim();
      const exprs = getCstChildren(stmt)
        .filter((c) => c.type === "Expression")
        .map((c) => c.text.trim());
      const doGuard = loopVar ? `DO ${loopVar} = ${exprs.join(", ")}` : `DO ${exprs.join(", ") || "LOOP"}`;
      guardStack.push(doGuard);
      for (const c of getCstChildren(stmt)) {
        if (c.type === "Statement") visitStmt(c);
      }
      guardStack.pop();
      return;
    }

    if (stmt.type === "CallStatement") {
      const subName = findCstChild(stmt, "IDENTIFIER")?.text?.trim();
      if (!subName) return;
      const argList = findCstChild(stmt, "ArgumentList");
      const args: string[] = [];
      const argIdentNames: (string | null)[] = [];
      for (const arg of getCstChildren(argList)) {
        if (!arg.isNamed || arg.type === "," || arg.type === "(" || arg.type === ")") continue;
        args.push(arg.text.trim());
        argIdentNames.push(unwrapSingleArgIdent(arg));
      }
      const lineIdx = stmt.startPosition?.row ?? 0;
      callBlocks.push({
        id: `call_${lineIdx}_${subName}`,
        subroutine: subName,
        args,
        argIdentNames,
        lineIdx,
      });
      return;
    }

    if (stmt.type === "AssignmentStatement") {
      const targetNode = findCstChild(stmt, "Target");
      const valueNode = findCstChild(stmt, "Expression");
      if (!targetNode || !valueNode) return;
      const lhs = targetNode.text.trim();
      const rhs = valueNode.text.trim();
      const lineIdx = stmt.startPosition?.row ?? 0;
      const tInfo = extractTargetInfo(targetNode);
      if (tInfo.portName) {
        outputVars.set(tInfo.portName.toLowerCase(), tInfo.portName);
      }
      const rhsRefs: string[] = [];
      const discoveredPorts: string[] = [];
      collectRefs(valueNode, rhsRefs, discoveredPorts);
      for (const pName of discoveredPorts) {
        const lower = pName.toLowerCase();
        if (!outputVars.has(lower)) {
          inputVars.set(lower, pName);
        }
      }
      equations.push({
        id: `eq_${lineIdx}_${sanitizeId(lhs)}`,
        lhs,
        lhsBase: tInfo.baseName,
        rhs,
        rhsRefs,
        isState: tInfo.isState,
        lineIdx,
        condGuard: guardStack.length > 0 ? guardStack[guardStack.length - 1] : undefined,
      });
    }
  };

  const stmtRoot = primaryUnit ? primaryUnit.node : rootNode;
  for (const child of getCstChildren(stmtRoot)) {
    visitStmt(child);
  }

  const assignedLowers = new Set(equations.map((e) => e.lhsBase.toLowerCase()));
  for (const arg of dummyArgs) {
    const lower = arg.toLowerCase();
    if (!inputVars.has(lower) && !outputVars.has(lower)) {
      if (assignedLowers.has(lower)) outputVars.set(lower, arg);
      else inputVars.set(lower, arg);
    }
  }

  const producerByVar = new Map<string, string>();
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

  const flowSteps = [
    ...equations.map((eq) => ({ kind: "eq" as const, lineIdx: eq.lineIdx, eq })),
    ...callBlocks.map((callBlk) => ({ kind: "call" as const, lineIdx: callBlk.lineIdx, callBlk })),
  ].sort((a, b) => a.lineIdx - b.lineIdx);

  for (const step of flowSteps) {
    if (step.kind === "eq") {
      const { eq } = step;
      const lowerLhs = eq.lhsBase.toLowerCase();
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

      const connectedSources = new Set<string>();
      for (const refIdent of eq.rhsRefs) {
        const refLower = refIdent.toLowerCase();
        if (intrinsicSet.has(refLower)) continue;
        const srcNodeId = producerByVar.get(refLower);
        if (srcNodeId && srcNodeId !== eq.id && !connectedSources.has(srcNodeId)) {
          connectedSources.add(srcNodeId);
          edges.push(
            makeStyledEdge(`edge_${srcNodeId}_${eq.id}`, srcNodeId, eq.id, srcNodeId.startsWith("const_"), refIdent),
          );
        }
      }
      producerByVar.set(lowerLhs, eq.id);
    } else {
      const { callBlk } = step;
      const subUpper = callBlk.subroutine.toUpperCase();
      const calleeSummary = unitSummaries.get(subUpper);
      const callEntries: string[] = [];
      if (calleeSummary) {
        const inParams = calleeSummary.params.filter(
          (p) => (calleeSummary.intents.get(p.toLowerCase()) ?? "in") !== "out",
        );
        const outParams = calleeSummary.params.filter((p) => {
          const intent = calleeSummary.intents.get(p.toLowerCase());
          return intent === "out" || intent === "inout";
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

      const defaultOutIdx =
        ["REALPOLE", "DELAY1", "INTGRL", "LEADLAG", "DIFF", "LIMITER", "LIMIT", "HARDLIMIT"].includes(subUpper) &&
        callBlk.args.length >= 2
          ? callBlk.args.length - 1
          : -1;

      callBlk.argIdentNames.forEach((vName, idx) => {
        if (!vName) return;
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
  }

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

  if (nodes.length === 0 && primaryUnit) {
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
  unifiedIndex?: any,
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
      case "resize":
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
          const resolved = resolveCrossLanguageComponentDrop(unifiedIndex, action.className, "modelica", currentText);
          const baseName = resolved.baseName || resolved.className.split(".").pop() || "comp";
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
          return computeModelicaComponentDropEdits({
            docText: currentText,
            uri: request.uri,
            rawClassName: action.className,
            x: action.x,
            y: action.y,
            classInstance: ci,
            computeComponentInsert: ops.computeComponentInsert,
            unifiedIndex,
            instanceName: uniqueName,
          });
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
