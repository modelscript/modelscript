// SPDX-License-Identifier: AGPL-3.0-or-later

import * as fs from "node:fs";
import { fileURLToPath } from "node:url";
import { Connection } from "vscode-languageserver";
import {
  GenericDSLDiagramBackend,
  ModelicaDiagramBackend,
  Owl2DiagramBackend,
  SysML2DiagramBackend,
  createDiagramDispatch,
} from "../diagramApi.js";
import { globalLanguageRegistry } from "../registry/LanguageRegistry.js";
import { DocumentManager } from "./document-manager.js";
import { WorkspaceManager } from "./workspace-manager.js";

/**
 * Retrieves the globally registered Modelica diagram operations module.
 */
function getModelicaDiagramOps(): any {
  return (globalThis as any).modelicaDiagramOps ?? {};
}

/**
 * Retrieves the globally registered SysML v2 diagram operations module.
 */
function getSysML2DiagramOps(): any {
  return (globalThis as any).sysml2DiagramOps ?? {};
}

/**
 * Computes a fast 32-bit rolling hash of a string for diagram cache invalidation.
 *
 * @param str - Input text to hash.
 * @returns Signed 32-bit integer hash.
 */
function simpleHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return hash;
}

/**
 * Language server service responsible for building, caching, and mutating
 * interactive graphical diagrams across Modelica, SysML v2, OWL2, PSCAD, and generic DSLs.
 */
export class DiagramService {
  /** In-memory cache of SysML v2 `.layout` sidecar data keyed by document URI. */
  private sysml2Layouts = new Map<string, any>();
  /** In-memory cache of OWL2 `.layout` sidecar data keyed by document URI. */
  private owl2Layouts = new Map<string, any>();
  /** Lazily initialized multi-language diagram protocol dispatcher. */
  private diagramDispatch: any;
  /** Versioned cache of computed diagram payloads keyed by URI, class name, and diagram type. */
  private diagramCache = new Map<string, { version: string; data: any }>();
  /** Optional reference to the validation service for checking indexing and dependency readiness. */
  public validationService?: any;
  /** Optional reference to the parser service for retrieving active WASM parsers. */
  public parserService?: any;

  /**
   * Clears both the local and global diagram payload caches.
   */
  clearCache(): void {
    this.diagramCache.clear();
    (globalThis as any).diagramCache?.clear();
  }

  /**
   * Creates a new `DiagramService`.
   *
   * @param connection - Active LSP connection for logging and notifications.
   * @param documentManager - Document manager providing access to open text buffers.
   * @param workspaceManager - Workspace manager providing symbol resolution and class instantiation.
   * @param validationService - Optional validation service reference.
   * @param parserService - Optional parser service reference.
   */
  constructor(
    private connection: Connection,
    private documentManager: DocumentManager,
    private workspaceManager: WorkspaceManager,
    validationService?: any,
    parserService?: any,
  ) {
    this.validationService = validationService;
    this.parserService = parserService;
    (globalThis as any).clearDiagramCache = () => this.clearCache();
  }

  /**
   * Computes or returns cached graphical diagram data (nodes, edges, coordinate bounds)
   * for the specified document URI and optional target class or diagram type.
   *
   * @param params - Diagram request parameters including URI, class name, diagram kind, and optional layout sidecar content.
   * @returns Diagram data payload for rendering in the webview, or `null` if unavailable.
   */
  async handleGetDiagramData(params: {
    uri: string;
    className?: string | undefined;
    diagramType?: string | undefined;
    sidecarContent?: string | undefined;
  }): Promise<any> {
    // Do NOT flush validation here — it blocks the event loop and starves the
    // text editor of diagnostic updates. Instead, build the diagram from the
    // most recently indexed AST (at worst ~300ms stale).

    // PSCAD — generate AntV X6 diagram data directly (with content hash caching)
    if (/\.(pscx|pslx|pswx|psmx)($|\?|#)/i.test(params.uri)) {
      try {
        let text = this.documentManager.documents.get(params.uri)?.getText();
        if (!text) {
          const filePath = params.uri.startsWith("file://") ? fileURLToPath(params.uri) : params.uri;
          if (fs.existsSync(filePath)) {
            text = fs.readFileSync(filePath, "utf-8");
          }
        }
        if (text) {
          const pscadCacheKey = `pscad:${params.uri}`;
          const pscadVersion = `idx:${text.length}:${simpleHash(text)}`;
          const cachedPscad = this.diagramCache.get(pscadCacheKey);
          if (cachedPscad && cachedPscad.version === pscadVersion) {
            return cachedPscad.data;
          }

          const { parsePscx } = await import("@modelscript/pscad");
          const { buildPscadDiagram } = await import("@modelscript/diagram/pscad-diagram-builder");
          const project = parsePscx(text);
          const rawDiagram = buildPscadDiagram(project);
          const nodes = rawDiagram.cells.filter((c) => c.shape !== "edge");
          const edges = rawDiagram.cells.filter((c) => c.shape === "edge");
          let minX = Infinity;
          let minY = Infinity;
          let maxX = -Infinity;
          let maxY = -Infinity;
          for (const n of nodes) {
            const nx = n.x ?? 0;
            const ny = n.y ?? 0;
            const nw = n.width ?? 100;
            const nh = n.height ?? 60;
            if (nx < minX) minX = nx;
            if (ny < minY) minY = ny;
            if (nx + nw > maxX) maxX = nx + nw;
            if (ny + nh > maxY) maxY = ny + nh;
          }
          const cs =
            isFinite(minX) && isFinite(minY)
              ? {
                  x: Math.max(0, minX - 40),
                  y: Math.max(0, minY - 40),
                  width: Math.max(800, maxX - minX + 80),
                  height: Math.max(600, maxY - minY + 80),
                }
              : { x: 0, y: 0, width: 1200, height: 800 };
          const pscadResult = {
            nodes,
            edges,
            coordinateSystem: cs,
            cells: rawDiagram.cells,
            metadata: rawDiagram.metadata,
          };
          this.diagramCache.set(pscadCacheKey, { version: pscadVersion, data: pscadResult });
          return pscadResult;
        }
      } catch (err: any) {
        this.connection.console.error(`[diagram] Failed to build PSCAD diagram for ${params.uri}: ${err.message}`);
      }
      return null;
    }

    // Non-Modelica (SysML2 or generic DSL) — delegate directly to dispatch
    if (!params.uri.endsWith(".mo")) {
      if (params.sidecarContent) {
        try {
          const sysmlOps = getSysML2DiagramOps();
          const parsed = sysmlOps.parseLayout
            ? sysmlOps.parseLayout(params.sidecarContent)
            : JSON.parse(params.sidecarContent);
          if (parsed) {
            this.sysml2Layouts.set(params.uri, parsed);
            this.owl2Layouts.set(params.uri, parsed);
          }
        } catch {
          // ignore parse errors
        }
      }
      return this.getDiagramDispatch().getData(params);
    }

    // Modelica — check cache first.
    const effectiveUri = params.uri.startsWith("modelscript-lib://global")
      ? "file://" + params.uri.substring("modelscript-lib://global".length)
      : params.uri;
    const lastIndexedMap = this.validationService?.lastIndexedText ?? (globalThis as any).lastIndexedText;
    const dependenciesReady =
      this.validationService?.dependenciesReady ?? (globalThis as any).dependenciesReady ?? true;
    const indexedText = lastIndexedMap?.get(effectiveUri);
    const version =
      indexedText != null
        ? `idx:${indexedText.length}:${simpleHash(indexedText)}|${dependenciesReady}`
        : dependenciesReady
          ? "deps-ready"
          : "deps-loading";
    const cacheKey = `${params.uri}|${params.className ?? ""}|${params.diagramType ?? "All"}`;
    const cached = this.diagramCache.get(cacheKey) ?? (globalThis as any).diagramCache?.get(cacheKey);
    if (cached && cached.version === version) {
      this.connection.console.info(`[diagram-perf] cache hit for ${params.uri}`);
      return cached.data;
    }

    if (!dependenciesReady) {
      return {
        nodes: [],
        edges: [],
        coordinateSystem: { x: 0, y: 0, width: 1000, height: 1000 },
        diagramBackground: null,
        isLoading: true,
      };
    }

    const t0 = performance.now();
    const classInstance = this.workspaceManager.resolveClassInstance(params.uri, params.className);

    if (!classInstance) {
      // Dependencies are ready but class instance not yet available (re-validation in progress).
      // Return last cached data to avoid blanking the diagram during the brief window
      // between dependencies loading and re-validation completing.
      if (cached) {
        this.connection.console.info(`[diagram-perf] class not resolved, returning stale cache for ${params.uri}`);
        return cached.data;
      }
      return null;
    }

    const tResolve = performance.now() - t0;

    try {
      const tBuild0 = performance.now();
      const ops = getModelicaDiagramOps();
      const result = ops.buildDiagramData ? await ops.buildDiagramData(classInstance) : null;
      const tBuild = performance.now() - tBuild0;
      if (result) {
        (result as any).isLoading = !dependenciesReady;
      }
      this.connection.console.info(
        `[diagram-perf] ${classInstance.name}: resolve=${tResolve.toFixed(0)}ms build=${tBuild.toFixed(0)}ms nodes=${result?.nodes?.length ?? 0} edges=${result?.edges?.length ?? 0}`,
      );

      // Cache the result
      this.diagramCache.set(cacheKey, { version, data: result });

      return result;
    } catch (e: any) {
      this.connection.console.error(`[diagram] Error building diagram data: ${e?.message ?? e}\n${e?.stack ?? ""}`);
      return null;
    }
  }

  /**
   * Returns (lazily initializing if necessary) the multi-language diagram protocol dispatcher
   * configured with Modelica, SysML v2, OWL2, and generic DSL diagram backends.
   */
  getDiagramDispatch() {
    if (!this.diagramDispatch) {
      const modelicaBackend = new ModelicaDiagramBackend({
        getDocumentInstances: (uri) => {
          let insts = this.workspaceManager.documentInstances.get(uri);
          if (!insts || insts.length === 0 || typeof insts[0].annotation !== "function") {
            const resolved = this.workspaceManager.resolveClassInstance(uri);
            if (resolved) {
              insts = [resolved];
            }
          }
          return insts;
        },
        getDocumentText: (uri) => this.documentManager.documents.get(uri)?.getText(),
        resolveClassInstance: (uri: string, name?: string) => this.workspaceManager.resolveClassInstance(uri, name),
        flushValidation: async (uri: string) => {
          if (this.validationService?.flushValidation) {
            await this.validationService.flushValidation(uri);
            return;
          }
          const f = (globalThis as any).validateTextDocument;
          if (f) {
            const doc = this.documentManager.documents.get(uri);
            if (doc) await f(doc);
          }
        },
      });

      const sysmlOps = getSysML2DiagramOps();
      const sysml2Backend = new SysML2DiagramBackend({
        getDocumentText: (uri) => this.documentManager.documents.get(uri)?.getText(),
        getLayout: (uri) => {
          let layout = this.sysml2Layouts.get(uri);
          if (!layout && typeof uri === "string" && uri.startsWith("file://")) {
            try {
              const candidates = [fileURLToPath(`${uri}.layout`)];
              const lastDot = uri.lastIndexOf(".");
              if (lastDot !== -1) {
                candidates.push(fileURLToPath(`${uri.substring(0, lastDot)}.layout`));
              }
              for (const layoutPath of candidates) {
                if (fs.existsSync(layoutPath)) {
                  const content = fs.readFileSync(layoutPath, "utf-8");
                  layout = sysmlOps.parseLayout ? sysmlOps.parseLayout(content) : undefined;
                  if (layout) {
                    this.sysml2Layouts.set(uri, layout);
                    break;
                  }
                }
              }
            } catch {
              // ignore
            }
          }
          return layout;
        },
        setLayout: (uri, layout) => {
          this.sysml2Layouts.set(uri, layout);
          if (typeof uri === "string" && uri.startsWith("file://") && layout) {
            try {
              const layoutPath = fileURLToPath(`${uri}.layout`);
              if (sysmlOps.serializeLayout) {
                fs.writeFileSync(layoutPath, sysmlOps.serializeLayout(layout), "utf-8");
              }
            } catch {
              // ignore
            }
          }
        },
        createEmptyLayout: () =>
          sysmlOps.createEmptyLayout ? sysmlOps.createEmptyLayout() : { elements: {}, connections: {} },
        updateElementPositions: (...args: any[]) => sysmlOps.updateElementPositions?.(...args),
        updateConnectionVertices: (...args: any[]) => sysmlOps.updateConnectionVertices?.(...args),
        removeElements: (...args: any[]) => sysmlOps.removeElements?.(...args),
        renameElement: (...args: any[]) => sysmlOps.renameElement?.(...args),
        serializeLayout: (layout) =>
          sysmlOps.serializeLayout ? sysmlOps.serializeLayout(layout) : JSON.stringify(layout, null, 2) + "\n",
        parseLayout: (text) => (sysmlOps.parseLayout ? sysmlOps.parseLayout(text) : JSON.parse(text)),
        getSidecarUri: (uri) =>
          sysmlOps.layoutUriFromSysmlUri ? sysmlOps.layoutUriFromSysmlUri(uri) : `${uri}.layout`,
        buildDiagramData: (params) => {
          // Delegate to the existing SysML2 diagram data builder inline
          try {
            const unified = this.workspaceManager.unifiedWorkspace.toUnified();
            const diagramTypeRaw = params.diagramType ?? "All";
            const validTypes = [
              "All",
              "BDD",
              "IBD",
              "StateMachine",
              "Activity",
              "UseCase",
              "Requirement",
              "Parametric",
              "Sequence",
              "Package",
            ];
            const diagramType = validTypes.includes(diagramTypeRaw)
              ? (diagramTypeRaw as
                  | "All"
                  | "BDD"
                  | "IBD"
                  | "StateMachine"
                  | "Activity"
                  | "UseCase"
                  | "Requirement"
                  | "Parametric"
                  | "Sequence"
                  | "Package")
              : "All";
            const data = sysmlOps.buildSysML2DiagramData
              ? sysmlOps.buildSysML2DiagramData(unified, params.uri, undefined, diagramType)
              : null;

            // Merge stored layout positions
            const layout = this.sysml2Layouts.get(params.uri);
            if (layout && data) {
              if (layout.elements && data.nodes) {
                for (const node of data.nodes) {
                  const sym = [...unified.symbols.values()].find(
                    (s) => `n_${s.id}` === node.id && s.resourceId === params.uri,
                  );
                  const name = sym?.name;
                  if (name && layout.elements[name]) {
                    const el = layout.elements[name];
                    node.x = el.x;
                    node.y = el.y;
                    if (el.width) node.width = el.width;
                    if (el.height) node.height = el.height;
                    node.autoLayout = false;
                  }
                }
              }
              if (layout.connections && data.edges) {
                for (const edge of data.edges) {
                  const conn =
                    layout.connections[edge.id] || layout.connections[`${edge.source?.cell}→${edge.target?.cell}`];
                  if (conn?.vertices) {
                    edge.vertices = conn.vertices;
                  }
                }
              }
            }
            return data;
          } catch (e: any) {
            this.connection.console.error(
              `[sysml2-diagram] Error building diagram data: ${e?.message ?? e}\n${e?.stack ?? ""}`,
            );
            return null;
          }
        },
        getSysML2Parser: () => {
          if (this.parserService?.isParserReady("sysml2")) {
            return this.parserService.getParser("sysml2");
          }
          return (globalThis as any).sysml2ParserReady && (globalThis as any).sysml2Parser
            ? (globalThis as any).sysml2Parser
            : null;
        },
        computeConnectionInsert: (...args: any[]) => sysmlOps.computeSysML2ConnectionInsert?.(...args) ?? [],
        computeConnectionDelete: (...args: any[]) => sysmlOps.computeSysML2ConnectionDelete?.(...args) ?? [],
        computeElementInsert: (...args: any[]) => sysmlOps.computeSysML2ElementInsert?.(...args) ?? [],
        computeElementDelete: (...args: any[]) => sysmlOps.computeSysML2ElementDelete?.(...args) ?? [],
        generateUniqueName: (...args: any[]) => sysmlOps.generateUniqueName?.(...args) ?? "element",
        computeNameEdit: (...args: any[]) => sysmlOps.computeSysML2NameEdit?.(...args) ?? [],
        computeDescriptionEdit: (...args: any[]) => sysmlOps.computeSysML2DescriptionEdit?.(...args) ?? [],
        computeParameterEdit: (...args: any[]) => sysmlOps.computeSysML2ParameterEdit?.(...args) ?? [],
        getSymbolData: (uri, componentName) => {
          try {
            const unified = this.workspaceManager.unifiedWorkspace.toUnifiedPartial();
            // Find the symbol matching the component name in this document
            for (const [, sym] of unified.symbols) {
              if (sym.resourceId === uri && sym.name === componentName) {
                // Get children of this symbol
                const childIds = unified.childrenOf?.get(sym.id) ?? [];
                const children: {
                  name: string;
                  ruleName: string;
                  value?: string | undefined;
                  description?: string | undefined;
                }[] = [];
                for (const childId of childIds) {
                  const child = unified.symbols.get(childId);
                  if (child && child.name) {
                    children.push({
                      name: child.name,
                      ruleName: child.ruleName,
                      value: (child.metadata as any)?.defaultValue ?? undefined,
                      description: (child.metadata as any)?.description ?? undefined,
                    });
                  }
                }
                // Try to extract doc comment from source text
                let description: string | undefined;
                const docText = this.documentManager.documents.get(uri)?.getText();
                const startOff = sym.startOffset ?? sym.startByte;
                const endOff = sym.endOffset ?? sym.endByte;
                if (docText && typeof startOff === "number" && typeof endOff === "number") {
                  const snippet = docText.substring(startOff, endOff);
                  const docMatch = snippet.match(/doc\s*\/\*\s*(.*?)\s*\*\//);
                  if (docMatch) description = docMatch[1];
                }
                return {
                  ruleName: sym.ruleName,
                  name: sym.name,
                  description,
                  children,
                };
              }
            }
            return null;
          } catch (e) {
            this.connection.console.error(`[sysml2] Error getting symbol data: ${e}`);
            return null;
          }
        },
      });

      const genericBackend = new GenericDSLDiagramBackend({
        getDocumentText: (uri) => this.documentManager.documents.get(uri)?.getText(),
        getSymbolIndex: () => {
          try {
            return this.workspaceManager.unifiedWorkspace.toUnifiedPartial();
          } catch {
            return undefined;
          }
        },
        getScopeResolver: () => {
          try {
            return (this.workspaceManager as any).scopeResolver;
          } catch {
            return undefined;
          }
        },
        getDiagramConfig: (uri) => {
          try {
            const plugin = globalLanguageRegistry.getPluginForUri(uri);
            if (plugin?.languageDef?.diagram) return plugin.languageDef.diagram;
            const lang = (this.workspaceManager as any).getLanguageForUri?.(uri);
            return lang?.diagram;
          } catch {
            return undefined;
          }
        },
      });

      const owl2Backend = new Owl2DiagramBackend({
        getDocumentText: (uri) => this.documentManager.documents.get(uri)?.getText(),
        getAxioms: (uri) => {
          const store = this.workspaceManager.unifiedWorkspace?.owl2Store;
          if (store) {
            const uriAxioms = store.axiomsBySource?.get(uri);
            if (uriAxioms && uriAxioms.length > 0) return [...uriAxioms];
            if (store.axioms && store.axioms.length > 0) return [...store.axioms];
          }
          return [];
        },
        getInferredSubClassOf: (_uri, axioms) => {
          if (!axioms || axioms.length === 0) return [];
          try {
            const ReasonerCtor = (globalThis as any).TableauReasoner;
            if (typeof ReasonerCtor !== "function") return [];
            const reasoner = new ReasonerCtor();
            reasoner.loadOntology(axioms);
            reasoner.classify();
            const taxonomy = reasoner.getTaxonomy();
            const pairs: { subClassIri: string; superClassIri: string }[] = [];
            if (Array.isArray(taxonomy)) {
              for (const node of taxonomy) {
                for (const sup of node.directSuperClasses || []) {
                  if (sup !== "owl:Thing" && sup !== node.iri) {
                    pairs.push({ subClassIri: node.iri, superClassIri: sup });
                  }
                }
              }
            }
            return pairs;
          } catch {
            return [];
          }
        },

        getLayout: (uri) => {
          let layout = this.owl2Layouts.get(uri);
          if (!layout && typeof uri === "string" && uri.startsWith("file://")) {
            try {
              const layoutPath = fileURLToPath(`${uri}.layout`);
              if (fs.existsSync(layoutPath)) {
                const content = fs.readFileSync(layoutPath, "utf-8");
                layout = JSON.parse(content);
                if (layout) this.owl2Layouts.set(uri, layout);
              }
            } catch {
              // ignore
            }
          }
          return layout;
        },
        setLayout: (uri, layout) => {
          this.owl2Layouts.set(uri, layout);
          if (typeof uri === "string" && uri.startsWith("file://")) {
            try {
              const layoutPath = fileURLToPath(`${uri}.layout`);
              fs.writeFileSync(layoutPath, JSON.stringify(layout, null, 2), "utf-8");
            } catch {
              // ignore
            }
          }
        },
        createEmptyLayout: () => ({ elements: {}, connections: {} }),
        updateElementPositions: (layout, items) => {
          const updated = { ...layout, elements: { ...(layout?.elements ?? {}) } };
          for (const item of items) {
            updated.elements[item.name] = {
              x: item.x,
              y: item.y,
              width: item.width,
              height: item.height,
            };
          }
          return updated;
        },
        updateConnectionVertices: (layout, updates) => {
          const updated = { ...layout, connections: { ...(layout?.connections ?? {}) } };
          for (const u of updates) {
            updated.connections[u.id] = u.vertices;
          }
          return updated;
        },
        removeElements: (layout, names) => {
          const updated = { ...layout, elements: { ...(layout?.elements ?? {}) } };
          const nameSet = new Set(names);
          updated.elements = Object.fromEntries(Object.entries(updated.elements).filter(([key]) => !nameSet.has(key)));
          return updated;
        },
      });

      this.diagramDispatch = createDiagramDispatch({
        modelica: modelicaBackend,
        sysml2: sysml2Backend,
        generic: genericBackend,
        owl2: owl2Backend,
      });
    }
    return this.diagramDispatch;
  }
}
