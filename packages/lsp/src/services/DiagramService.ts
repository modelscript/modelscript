/* eslint-disable @typescript-eslint/ban-ts-comment, @typescript-eslint/no-explicit-any */
// @ts-nocheck
import { buildSysML2DiagramData, createSysML2ScopeResolver } from "@modelscript/sysml2/factory";
import { Connection } from "vscode-languageserver";
import { ModelicaDiagramBackend, SysML2DiagramBackend, createDiagramDispatch } from "../diagramApi";
import { buildDiagramData } from "../diagramData";
import { createEmptyLayout, removeElements, updateConnectionVertices, updateElementPositions } from "../sysml2-layout";
import {
  computeSysML2ConnectionDelete,
  computeSysML2ConnectionInsert,
  computeSysML2DescriptionEdit,
  computeSysML2ElementDelete,
  computeSysML2ElementInsert,
  computeSysML2NameEdit,
  computeSysML2ParameterEdit,
  generateUniqueName,
} from "../sysml2DiagramEdits";
import { DocumentManager } from "./DocumentManager";
import { WorkspaceManager } from "./WorkspaceManager";

export class DiagramService {
  private sysml2Layouts = new Map<string, any>();
  private diagramDispatch: any;

  constructor(
    private connection: Connection,
    private documentManager: DocumentManager,
    private workspaceManager: WorkspaceManager,
  ) {}

  async handleGetDiagramData(params: { uri: string; className?: string; diagramType?: string }): Promise<any> {
    // Do NOT flush validation here — it blocks the event loop and starves the
    // text editor of diagnostic updates. Instead, build the diagram from the
    // most recently indexed AST (at worst ~300ms stale).

    // SysML2 — delegate directly to dispatch (no caching needed, layout is in-memory)
    if (params.uri.endsWith(".sysml")) {
      return getDiagramDispatch().getData(params);
    }

    // Modelica — check cache first.
    // Use the last-indexed text as the cache key rather than doc.version.
    // doc.version increments on every keystroke, making the cache useless
    // during interactive editing. (globalThis as any).lastIndexedText only updates when the
    // semantic pipeline actually re-indexes, so intermediate keystrokes
    // reuse the previous diagram data.
    const effectiveUri = params.uri.startsWith("modelscript-lib://global")
      ? "file://" + params.uri.substring("modelscript-lib://global".length)
      : params.uri;
    const indexedText = (globalThis as any).lastIndexedText.get(effectiveUri);
    const version =
      indexedText != null
        ? `idx:${indexedText.length}:${(globalThis as any).simpleHash(indexedText)}|${(globalThis as any).dependenciesReady}`
        : (globalThis as any).dependenciesReady
          ? "deps-ready"
          : "deps-loading";
    const cacheKey = `${params.uri}|${params.className ?? ""}|${params.diagramType ?? "All"}`;
    const cached = (globalThis as any).diagramCache.get(cacheKey);
    if (cached && cached.version === version) {
      this.connection.console.info(`[diagram-perf] cache hit for ${params.uri}`);
      return cached.data;
    }

    const t0 = performance.now();
    const classInstance = this.workspaceManager.resolveModelicaClassInstance(params.uri, params.className);

    if (!classInstance) {
      if (!(globalThis as any).dependenciesReady) {
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
      const result = await buildDiagramData(classInstance);
      const tBuild = performance.now() - tBuild0;
      if (result) {
        (result as any).isLoading = !(globalThis as any).dependenciesReady;
      }
      this.connection.console.error(
        `[diagram-perf] ${classInstance.name}: resolve=${tResolve.toFixed(0)}ms build=${tBuild.toFixed(0)}ms nodes=${result?.nodes?.length ?? 0} edges=${result?.edges?.length ?? 0}`,
      );

      // Cache the result
      (globalThis as any).diagramCache.set(cacheKey, { version, data: result });

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
        resolveClassInstance: (uri: string, name?: string) =>
          this.workspaceManager.resolveModelicaClassInstance(uri, name),
        flushValidation: async (uri: string) => {
          const f = (globalThis as any).validateTextDocument;
          if (f) {
            const doc = this.documentManager.documents.get(uri);
            if (doc) await f(doc);
          }
        },
      });

      const sysml2Backend = new SysML2DiagramBackend({
        getDocumentText: (uri) => this.documentManager.documents.get(uri)?.getText(),
        getLayout: (uri) => this.sysml2Layouts.get(uri),
        setLayout: (uri, layout) => this.sysml2Layouts.set(uri, layout),
        createEmptyLayout,
        updateElementPositions,
        updateConnectionVertices,
        removeElements,
        buildDiagramData: (params) => {
          // Delegate to the existing SysML2 diagram data builder inline
          try {
            const unified = this.workspaceManager.unifiedWorkspace.toUnified();
            const resolver = createSysML2ScopeResolver(unified);
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
            const data = buildSysML2DiagramData(unified, params.uri, resolver, diagramType);

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
        getSysML2Parser: () =>
          (globalThis as any).sysml2ParserReady && (globalThis as any).sysml2Parser
            ? (globalThis as any).sysml2Parser
            : null,
        computeConnectionInsert: computeSysML2ConnectionInsert,
        computeConnectionDelete: computeSysML2ConnectionDelete,
        computeElementInsert: computeSysML2ElementInsert,
        computeElementDelete: computeSysML2ElementDelete,
        generateUniqueName,
        computeNameEdit: computeSysML2NameEdit,
        computeDescriptionEdit: computeSysML2DescriptionEdit,
        computeParameterEdit: computeSysML2ParameterEdit,
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

      this.diagramDispatch = createDiagramDispatch({
        modelica: modelicaBackend,
        sysml2: sysml2Backend,
      });
    }
    return this.diagramDispatch;
  }
}
