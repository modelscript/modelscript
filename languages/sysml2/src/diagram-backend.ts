// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  deduplicateAndSort,
  type ComponentPropertyData,
  type DiagramApplyEditsParams,
  type DiagramApplyEditsResult,
  type DiagramBackend,
  type DiagramData,
  type DiagramDrillDownParams,
  type DiagramDrillDownResult,
  type DiagramGetComponentPropertiesParams,
  type DiagramGetDataParams,
  type DiagramGetPaletteParams,
  type DiagramPalette,
  type EntityPropertySchema,
  type PropertyFieldConfig,
  type PropertyGroupConfig,
  type PropertyTabConfig,
  type DiagramTextEdit as TextEdit,
} from "@modelscript/diagram/protocol";

function hasWordMatch(text: string, word: string): boolean {
  if (!word) return false;
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`).test(text);
}

export interface SysML2CrossLanguageDropResult {
  baseName?: string | undefined;
  className: string;
  importPath?: string | undefined;
  stubName?: string | undefined;
  stubBlock?: string | undefined;
  sysmlUsageKind?: string | undefined;
}

export interface SysML2BackendDeps {
  getDocumentText: (uri: string) => string | undefined;
  getLayout: (uri: string) => unknown;
  setLayout: (uri: string, layout: unknown) => void;
  createEmptyLayout: () => unknown;
  updateElementPositions: (
    layout: unknown,
    items: { name: string; x: number; y: number; width: number; height: number; rotation?: number | undefined }[],
  ) => unknown;
  updateConnectionVertices: (
    layout: unknown,
    updates: { id: string; vertices: { x: number; y: number }[] }[],
  ) => unknown;
  removeElements: (layout: unknown, names: string[]) => unknown;
  renameElement?: ((layout: unknown, oldName: string, newName: string) => unknown) | undefined;
  serializeLayout?: ((layout: unknown) => string) | undefined;
  parseLayout?: ((text: string) => unknown) | undefined;
  getSidecarUri?: ((uri: string) => string) | undefined;

  buildDiagramData: (params: DiagramGetDataParams) => DiagramData | null;
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
  getUnifiedIndex?: (() => unknown) | undefined;
  resolveCrossLanguageDrop?:
    | ((
        unifiedIndex: unknown,
        className: string,
        targetLang: "modelica" | "sysml2",
        docText: string,
      ) => SysML2CrossLanguageDropResult)
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
    const values: Record<string, unknown> = {
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
    let tree: unknown = null;
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
            const resolved = this.deps.resolveCrossLanguageDrop?.(
              unifiedIndex,
              action.className,
              "sysml2",
              docText,
            ) ?? {
              className: action.className,
            };
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
      (tree as { delete?: () => void } | null)?.delete?.();
    }

    let sidecarUri: string | undefined;
    let sidecarContent: string | undefined;
    if (layout) {
      const serialize = this.deps.serializeLayout ?? ((l: unknown) => JSON.stringify(l, null, 2) + "\n");
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
      data: childData ?? null,
    };
  }
}
