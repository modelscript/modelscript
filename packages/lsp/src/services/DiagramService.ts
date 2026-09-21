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
import { DocumentManager } from "./DocumentManager.js";
import { WorkspaceManager } from "./WorkspaceManager.js";

function getModelicaDiagramOps(): any {
  return (globalThis as any).modelicaDiagramOps ?? {};
}

function getSysML2DiagramOps(): any {
  return (globalThis as any).sysml2DiagramOps ?? {};
}

function simpleHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return hash;
}

export class DiagramService {
  private sysml2Layouts = new Map<string, any>();
  private owl2Layouts = new Map<string, any>();
  private diagramDispatch: any;
  private diagramCache = new Map<string, { version: string; data: any }>();
  public validationService?: any;
  public parserService?: any;

  constructor(
    private connection: Connection,
    private documentManager: DocumentManager,
    private workspaceManager: WorkspaceManager,
    validationService?: any,
    parserService?: any,
  ) {
    this.validationService = validationService;
    this.parserService = parserService;
  }

  async handleGetDiagramData(params: { uri: string; className?: string; diagramType?: string }): Promise<any> {
    // Do NOT flush validation here — it blocks the event loop and starves the
    // text editor of diagnostic updates. Instead, build the diagram from the
    // most recently indexed AST (at worst ~300ms stale).

    // Non-Modelica (SysML2 or generic DSL) — delegate directly to dispatch
    if (!params.uri.endsWith(".mo")) {
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

    const t0 = performance.now();
    const classInstance = this.workspaceManager.resolveClassInstance(params.uri, params.className);

    if (!classInstance) {
      if (!dependenciesReady) {
        return {
          nodes: [],
          edges: [],
          coordinateSystem: { x: 0, y: 0, width: 1000, height: 1000 },
          diagramBackground: null,
          isLoading: true,
        };
      }
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
      this.connection.console.error(
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

  getDiagramDispatch() {
    if (!this.diagramDispatch) {
      const modelicaBackend = new ModelicaDiagramBackend({
        getDocumentInstances: (uri) => this.workspaceManager.documentInstances.get(uri),
        getDocumentText: (uri) => this.documentManager.documents.get(uri)?.getText(),
        resolveClassInstance: (uri: string, name?: string) => this.workspaceManager.resolveClassInstance(uri, name),
        flushValidation: async (uri: string) => {
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
              const layoutPath = fileURLToPath(`${uri}.layout`);
              if (fs.existsSync(layoutPath)) {
                const content = fs.readFileSync(layoutPath, "utf-8");
                layout = sysmlOps.parseLayout ? sysmlOps.parseLayout(content) : undefined;
                if (layout) this.sysml2Layouts.set(uri, layout);
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
            return data;
          } catch (e: any) {
            this.connection.console.error(
              `[sysml2-diagram] Error building diagram data: ${e?.message ?? e}\n${e?.stack ?? ""}`,
            );
            return null;
          }
        },
        getSysML2Parser: () => {
          if (this.parserService?.sysml2ParserReady && this.parserService.sysml2Parser) {
            return this.parserService.sysml2Parser;
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
                const children: { name: string; ruleName: string; value?: string; description?: string }[] = [];
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
                if (docText && typeof sym.startByte === "number" && typeof sym.endByte === "number") {
                  const snippet = docText.substring(sym.startByte, sym.endByte);
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
