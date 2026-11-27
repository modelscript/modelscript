// SPDX-License-Identifier: AGPL-3.0-or-later

import { buildDiagramFromDSL, buildPolyglotDiagram } from "@modelscript/diagram/builder";
import { parseLayout, SidecarLayoutStorage } from "@modelscript/diagram/layout-storage";
import { compileDiagramConfigToPolyglot, CstUnparser, type SyntaxNode } from "@modelscript/dsl";
import { buildFortranDiagramFromCst, maskFortranFixedCommentsAndPreprocessor } from "@modelscript/fortran";
import { buildScadDiagramFromCst } from "@modelscript/scad";
import type { TextEdit } from "vscode-languageserver";
import { resolveGenericComponentDrop } from "../cross-language-drop.js";
import type {
  ComponentPropertyData,
  DiagramApplyEditsParams,
  DiagramApplyEditsResult,
  DiagramBackend,
  DiagramData,
  DiagramDrillDownParams,
  DiagramDrillDownResult,
  DiagramGetComponentPropertiesParams,
  DiagramGetDataParams,
  DiagramGetPaletteParams,
  DiagramPalette,
  PlacementItem,
  PropertyFieldConfig,
} from "../diagramProtocol.js";
import { globalLanguageRegistry } from "../registry/LanguageRegistry.js";
import type { GenericDSLBackendDeps } from "./diagram-api-types.js";
import {
  collectIdentifierNodesInCstScope,
  emitInlinePlacementEdit,
  expandEdgeTemplateText,
  extractKeyValuePairsFromLine,
  extractTrailingAnnotationClause,
  findAllWordMatchIndices,
  findBestCstNodeForSpan,
  findMatchingConnectionCstNode,
  findMatchingEdgeStatement,
  findParamAssignmentValueSpan,
  hasWordMatch,
  insertIntoSectionOrRoot,
  leadingWhitespaceOf,
  maskComments,
  offsetToLspPosition,
  replaceBalancedBracesField,
} from "./diagram-edit-helpers.js";

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

    interface MutableDiagramNodeLike {
      id: string;
      name?: string | undefined;
      label?: string | undefined;
      x?: number | undefined;
      y?: number | undefined;
      width?: number | undefined;
      height?: number | undefined;
      autoLayout?: boolean | undefined;
      properties?: { description?: string | undefined } | undefined;
      [key: string]: unknown;
    }

    interface MutableDiagramDataLike {
      nodes: MutableDiagramNodeLike[];
      edges: unknown[];
      coordinateSystem?: unknown;
      diagramBackground?: unknown;
      [key: string]: unknown;
    }

    let diagramData: MutableDiagramDataLike | null = null;

    if (symbolIndex && config) {
      const { graphicsConfig, options } = compileDiagramConfigToPolyglot(
        config as Parameters<typeof compileDiagramConfigToPolyglot>[0],
      );
      diagramData = buildPolyglotDiagram(
        symbolIndex as unknown as Parameters<typeof buildPolyglotDiagram>[0],
        graphicsConfig as Parameters<typeof buildPolyglotDiagram>[1],
        params.uri,
        resolver,
        params.diagramType ?? "All",
        options as Parameters<typeof buildPolyglotDiagram>[5],
      ) as unknown as MutableDiagramDataLike;
    } else {
      const syntaxNames = this.deps.getSyntaxNames?.(params.uri);
      const rawData = this.deps.getRawAstData?.(params.uri) ?? { nodes: [], edges: [] };

      if (!docText && rawData.nodes.length === 0) return null;

      diagramData = buildDiagramFromDSL(
        rawData as Parameters<typeof buildDiagramFromDSL>[0],
        config as Parameters<typeof buildDiagramFromDSL>[1],
        syntaxNames,
        params.diagramType,
        docText,
      ) as unknown as MutableDiagramDataLike;
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

      const nodes: MutableDiagramNodeLike[] = [];
      const edges: Array<ReturnType<typeof makeStyledEdge>> = [];

      // Dedicated OpenSCAD (.scad) CSG Constructive Solid Geometry Tree & Parametric Diagram Builder
      if (isScad) {
        try {
          const cachedOrProvided = this.deps.getParser?.("scad") ?? plugin?.parser;
          const scadParser = cachedOrProvided ?? (await (await import("@modelscript/scad")).getScadParser());
          const tree = scadParser?.parse?.(docText);
          if (tree?.rootNode) {
            buildScadDiagramFromCst(
              tree.rootNode,
              makeStyledNode,
              makeStyledEdge,
              nodes as Parameters<typeof buildScadDiagramFromCst>[3],
              edges as Parameters<typeof buildScadDiagramFromCst>[4],
            );
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
            buildFortranDiagramFromCst(
              tree.rootNode,
              makeStyledNode,
              makeStyledEdge,
              nodes as Parameters<typeof buildFortranDiagramFromCst>[3],
              edges as Parameters<typeof buildFortranDiagramFromCst>[4],
            );
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
                  name?: string | undefined;
                  kind?: unknown;
                  detail?: unknown;
                  children?: unknown[] | undefined;
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
        const storageObj: unknown = this.getLayoutStorage(params.uri);
        const storage =
          storageObj && typeof storageObj === "object"
            ? (storageObj as {
                options?: { parse?: typeof parseLayout } | undefined;
                cache?: Map<string, unknown> | undefined;
              })
            : null;
        const parser = storage?.options?.parse ?? parseLayout;
        const parsed = parser(params.sidecarContent);
        if (parsed) {
          storage?.cache?.set(params.uri, parsed);
        }
      } catch {
        // ignore
      }
    }

    // Merge persisted layout if available
    const layout = await this.getLayoutStorage(params.uri).loadLayout(params.uri);
    if (layout && diagramData) {
      for (const node of diagramData.nodes) {
        const nodeName = node.name || node.properties?.description;
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

    return diagramData as unknown as DiagramData;
  }

  getComponentProperties(params: DiagramGetComponentPropertiesParams): ComponentPropertyData | null {
    const config = this.deps.getDiagramConfig?.(params.uri);
    const propConfig = config?.properties;
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
    const values: Record<string, unknown> = { name: params.componentName };
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

  private resolveSymbolEntry(
    symbolIndex:
      | {
          byName?: Map<string, number[]>;
          symbols?: Map<
            number,
            { id: number; name: string; startOffset?: number; endOffset?: number; parentId?: number | null }
          >;
        }
      | null
      | undefined,
    name: string,
  ): { id: number; name: string; startOffset?: number; endOffset?: number; parentId?: number | null } | null {
    if (!symbolIndex || !name) return null;
    const candidateIds: number[] = symbolIndex.byName?.get?.(name) ?? [];
    for (const id of candidateIds) {
      const sym = symbolIndex.symbols?.get?.(id);
      if (sym) return sym;
    }
    if (symbolIndex.symbols?.values) {
      for (const sym of symbolIndex.symbols.values()) {
        if (sym?.name === name) return sym;
      }
    }
    return null;
  }

  private resolveChildSymbolEntry(
    symbolIndex:
      | {
          childrenOf?: Map<number | null, number[]>;
          symbols?: Map<
            number,
            { id: number; name: string; startOffset?: number; endOffset?: number; parentId?: number | null }
          >;
        }
      | null
      | undefined,
    parentEntry: { id: number } | null | undefined,
    name: string,
  ): { id: number; name: string; startOffset?: number; endOffset?: number; parentId?: number | null } | null {
    if (!symbolIndex || !parentEntry || !name) return null;
    const childIds: number[] = symbolIndex.childrenOf?.get?.(parentEntry.id) ?? [];
    for (const cid of childIds) {
      const sym = symbolIndex.symbols?.get?.(cid);
      if (sym?.name === name) return sym;
    }
    return null;
  }

  async applyEdits(params: DiagramApplyEditsParams): Promise<DiagramApplyEditsResult> {
    const allEdits: TextEdit[] = [];
    const itemsToSave: PlacementItem[] = [];
    const docText = this.deps.getDocumentText(params.uri);
    const maskedText = docText !== undefined ? maskComments(docText) : undefined;
    const lines = docText !== undefined ? docText.split("\n") : [];
    const maskedLines = maskedText !== undefined ? maskedText.split("\n") : [];
    const config = this.deps.getDiagramConfig?.(params.uri);
    const mutations = config?.mutations;
    const symbolIndex = this.deps.getSymbolIndex?.(params.uri);
    let cachedCstRoot: SyntaxNode | null | undefined = undefined;
    const getCstRoot = (): SyntaxNode | null => {
      if (cachedCstRoot !== undefined) return cachedCstRoot;
      cachedCstRoot = null;
      if (docText === undefined || !this.deps.getParser) return null;
      const ext = (params.uri || "").split(".").pop()?.split("?")[0] || "";
      const langHint = config?.language || config?.name || ext;
      const parser = this.deps.getParser(langHint) ?? (ext && ext !== langHint ? this.deps.getParser(ext) : undefined);
      try {
        const tree = parser?.parse?.(docText) as { rootNode?: SyntaxNode } | undefined;
        cachedCstRoot = tree?.rootNode ?? null;
      } catch {
        cachedCstRoot = null;
      }
      return cachedCstRoot;
    };

    const cleanUriLower = (params.uri || "").split("?")[0]!.toLowerCase();
    const isKnownNonModelicaExt =
      /\.(scad|sysml2?|spice|cir|sp|ssp|ssd|reqif|mdzip|mdxml|xmi|arxml|adm|cmd|acf|spck|sim|mbs|xodr|urdf|sdf|xacro|vhdl?|sv|v|f90|c|cpp|h|py|json|xml|yaml|yml)$/.test(
        cleanUriLower,
      );

    for (const action of params.actions) {
      switch (action.type) {
        case "move": {
          const legacyMove: {
            type?: string;
            nodeId?: string | number | undefined;
            position?: { x: number; y: number } | undefined;
            width?: number | undefined;
            height?: number | undefined;
            size?: { width?: number | undefined; height?: number | undefined } | undefined;
          } = action;
          const moveItems: PlacementItem[] = Array.isArray(action.items)
            ? action.items
            : legacyMove.nodeId && legacyMove.position
              ? [
                  {
                    name: String(legacyMove.nodeId),
                    x: legacyMove.position.x,
                    y: legacyMove.position.y,
                    width: legacyMove.width ?? legacyMove.size?.width ?? 0,
                    height: legacyMove.height ?? legacyMove.size?.height ?? 0,
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
          if (!edgeTemplate && isKnownNonModelicaExt) {
            break;
          }
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
          if (docText !== undefined && !isKnownNonModelicaExt) {
            const cstRoot = getCstRoot();
            if (cstRoot) {
              const connNode = findMatchingConnectionCstNode(
                cstRoot,
                docText,
                action.source,
                action.sourcePort,
                action.target,
                action.targetPort,
              );
              if (connNode && connNode.endIndex > connNode.startIndex) {
                const delRes = CstUnparser.deleteDeclaration(docText, cstRoot, {
                  startOffset: connNode.startIndex,
                  endOffset: connNode.endIndex,
                });
                if (delRes) {
                  allEdits.push({ range: delRes.edit.range, newText: "" });
                  break;
                }
              }
            }
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
            const cstRoot = getCstRoot();
            const cstConnNode = cstRoot
              ? findMatchingConnectionCstNode(
                  cstRoot,
                  docText,
                  action.oldSource,
                  action.oldSourcePort,
                  action.oldTarget,
                  action.oldTargetPort,
                )
              : null;
            const matchSpan =
              cstConnNode && cstConnNode.endIndex > cstConnNode.startIndex
                ? {
                    startLine: cstConnNode.startPosition
                      ? cstConnNode.startPosition.row
                      : offsetToLspPosition(docText, cstConnNode.startIndex).line,
                    endLine: cstConnNode.endPosition
                      ? cstConnNode.endPosition.row
                      : offsetToLspPosition(docText, Math.max(cstConnNode.startIndex, cstConnNode.endIndex - 1)).line,
                  }
                : findMatchingEdgeStatement(
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
            if (typeof edgeTemplate !== "function" && typeof edgeTemplate !== "string" && isKnownNonModelicaExt) {
              break;
            }

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
          } else if (!isKnownNonModelicaExt) {
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
          const hasExplicitMutations = Boolean(
            mutations?.createNode || mutations?.nodeTemplate || mutations?.deleteEntity,
          );
          if (docText !== undefined && (!isKnownNonModelicaExt || hasExplicitMutations)) {
            const cstRoot = getCstRoot();
            for (const name of action.names) {
              const entry = this.resolveSymbolEntry(symbolIndex, name);
              if (
                entry &&
                entry.startOffset != null &&
                entry.endOffset != null &&
                entry.endOffset > entry.startOffset
              ) {
                const delRes = CstUnparser.deleteDeclaration(docText, cstRoot, entry);
                if (delRes) {
                  allEdits.push({ range: delRes.edit.range, newText: "" });
                  continue;
                }
              }
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
          if (docText !== undefined && maskedLines.length > 0 && action.oldName && action.newName) {
            const entry = this.resolveSymbolEntry(symbolIndex, action.oldName);
            const parentSym = entry?.parentId != null ? symbolIndex?.symbols?.get?.(entry.parentId) : null;
            const cstRoot = getCstRoot();
            if (cstRoot) {
              const scopeNode =
                parentSym &&
                parentSym.startOffset != null &&
                parentSym.endOffset != null &&
                parentSym.endOffset > parentSym.startOffset
                  ? (findBestCstNodeForSpan(cstRoot, parentSym.startOffset, parentSym.endOffset) ?? cstRoot)
                  : cstRoot;
              const idNodes = collectIdentifierNodesInCstScope(scopeNode, docText, action.oldName);
              if (idNodes.length > 0) {
                for (const idNode of idNodes) {
                  if (idNode.startPosition && idNode.endPosition) {
                    const patchRes = CstUnparser.patchAndUnparse({
                      target: idNode,
                      replaceText: action.newName,
                    });
                    allEdits.push({
                      range: patchRes.edit.range,
                      newText: patchRes.edit.newText,
                    });
                  } else {
                    allEdits.push({
                      range: {
                        start: offsetToLspPosition(docText, idNode.startIndex),
                        end: offsetToLspPosition(docText, idNode.endIndex),
                      },
                      newText: action.newName,
                    });
                  }
                }
                break;
              }
            }
            let scopeStartLine = 0;
            let scopeEndLine = lines.length - 1;
            if (
              parentSym &&
              parentSym.startOffset != null &&
              parentSym.endOffset != null &&
              parentSym.endOffset > parentSym.startOffset
            ) {
              // Limit word matches to the enclosing parent declaration lines
              let lineStartIdx = 0;
              let offset = 0;
              for (let li = 0; li < lines.length; li++) {
                const nextOffset = offset + lines[li]!.length + 1;
                if (offset <= parentSym.startOffset && parentSym.startOffset < nextOffset) {
                  scopeStartLine = li;
                }
                if (offset <= parentSym.endOffset && parentSym.endOffset <= nextOffset) {
                  scopeEndLine = li;
                  break;
                }
                offset = nextOffset;
                lineStartIdx++;
              }
              void lineStartIdx;
            }
            for (let i = scopeStartLine; i <= scopeEndLine && i < lines.length; i++) {
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
          const legacyPropAction: {
            propertyName?: string | undefined;
            parameter?: string | undefined;
            previousValue?: unknown;
          } = action;
          const paramName =
            action.type === "updateProperty"
              ? (action.key ?? legacyPropAction.propertyName ?? legacyPropAction.parameter)
              : action.parameter;
          const paramVal = action.value;
          if (docText !== undefined && paramName && paramVal !== undefined) {
            const mutator = config?.properties?.mutator;
            if (typeof mutator?.updateProperty === "function") {
              try {
                const prevVal = legacyPropAction.previousValue;
                const rawAst = this.deps.getRawAstData?.(params.uri);
                let customEdits = mutator.updateProperty(rawAst ?? docText, action.name, paramName, paramVal, prevVal);
                if (!customEdits) {
                  customEdits = mutator.updateProperty(action.name, paramName, paramVal, docText);
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

            // Canonical CST Unparser writeback via SymbolIndex declaration/child entry
            const compEntry = action.name ? this.resolveSymbolEntry(symbolIndex, action.name) : null;
            const targetEntry = this.resolveChildSymbolEntry(symbolIndex, compEntry, paramName) ?? compEntry;
            if (targetEntry) {
              const cstRes = CstUnparser.patchWritebackValue(docText, getCstRoot(), targetEntry, String(paramVal));
              if (cstRes) {
                allEdits.push({
                  range: cstRes.edit.range,
                  newText: cstRes.edit.newText,
                });
                break;
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
        const storageObj: unknown = storage;
        const storageInternals =
          storageObj && typeof storageObj === "object"
            ? (storageObj as {
                options?: { serialize?: ((layout: unknown) => string) | undefined } | undefined;
              })
            : null;
        const serialize = storageInternals?.options?.serialize ?? ((l: unknown) => JSON.stringify(l, null, 2) + "\n");
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
