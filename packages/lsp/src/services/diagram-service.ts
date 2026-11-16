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
import { isIdentContCode, isWsCode, readIdentAt, skipWs } from "../utils/lexical-utils.js";
import { DocumentManager } from "./document-manager.js";
import { WorkspaceManager } from "./workspace-manager.js";

function extractDocCommentBody(snippet: string): string | undefined {
  let pos = 0;
  while (pos < snippet.length) {
    const idx = snippet.indexOf("doc", pos);
    if (idx === -1) return undefined;
    const prevOk = idx === 0 || !isIdentContCode(snippet.charCodeAt(idx - 1));
    if (prevOk && !isIdentContCode(snippet.charCodeAt(idx + 3))) {
      const wsEnd = skipWs(snippet, idx + 3);
      if (snippet.startsWith("/*", wsEnd)) {
        const close = snippet.indexOf("*/", wsEnd + 2);
        if (close !== -1) {
          return snippet.slice(wsEnd + 2, close).trim();
        }
      }
    }
    pos = idx + 3;
  }
  return undefined;
}

const MODELICA_CLASS_KINDS = new Set(["model", "block", "class"]);

function hasModelicaDiagramHint(text: string): boolean {
  let headerPos = -1;
  let i = 0;
  while (i < text.length) {
    if (isWsCode(text.charCodeAt(i))) {
      i++;
      continue;
    }
    const prevOk = i === 0 || !isIdentContCode(text.charCodeAt(i - 1));
    const tok = readIdentAt(text, i);
    if (tok) {
      if (prevOk && MODELICA_CLASS_KINDS.has(tok.token.toLowerCase())) {
        headerPos = tok.next;
        break;
      }
      i = tok.next;
    } else {
      i++;
    }
  }
  if (headerPos === -1) return false;
  const tail = text.slice(headerPos);
  if (tail.includes("annotation") && tail.includes("Placement")) return true;
  let j = 0;
  while (j < tail.length) {
    const t1 = readIdentAt(tail, j);
    if (!t1) {
      j++;
      continue;
    }
    const prevOk = j === 0 || !isIdentContCode(tail.charCodeAt(j - 1));
    if (prevOk) {
      const ws1 = skipWs(tail, t1.next);
      if (ws1 > t1.next) {
        const t2 = readIdentAt(tail, ws1);
        if (t2) {
          const ws2 = skipWs(tail, t2.next);
          if (tail[ws2] === "(" || tail[ws2] === ";") return true;
        }
      }
    }
    j = t1.next;
  }
  return false;
}

export interface DiagramServiceOptions {
  modelicaDiagramOps?: any;
  sysml2DiagramOps?: any;
}

/**
 * Retrieves the registered Modelica diagram operations module.
 */
function getModelicaDiagramOps(service?: DiagramService): any {
  return service?.modelicaDiagramOps ?? (globalThis as any).modelicaDiagramOps ?? {};
}

/**
 * Retrieves the registered SysML v2 diagram operations module.
 */
function getSysML2DiagramOps(service?: DiagramService): any {
  return service?.sysml2DiagramOps ?? (globalThis as any).sysml2DiagramOps ?? {};
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
  /** Injected Modelica diagram operations module. */
  public modelicaDiagramOps?: any;
  /** Injected SysML v2 diagram operations module. */
  public sysml2DiagramOps?: any;

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
   * @param options - Optional diagram operations injection options.
   */
  constructor(
    private connection: Connection,
    private documentManager: DocumentManager,
    private workspaceManager: WorkspaceManager,
    validationService?: any,
    parserService?: any,
    options?: DiagramServiceOptions,
  ) {
    this.validationService = validationService;
    this.parserService = parserService;
    this.modelicaDiagramOps = options?.modelicaDiagramOps;
    this.sysml2DiagramOps = options?.sysml2DiagramOps;
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
    documentText?: string | undefined;
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
          const targetModule = params.className;
          const pscadCacheKey = `pscad:${params.uri}:${targetModule ?? ""}`;
          const pscadVersion = `idx:${text.length}:${simpleHash(text)}`;
          const cachedPscad = this.diagramCache.get(pscadCacheKey);
          if (cachedPscad && cachedPscad.version === pscadVersion) {
            return cachedPscad.data;
          }

          const { parsePscx } = await import("@modelscript/pscad");
          const { buildPscadDiagram } = await import("@modelscript/diagram/pscad-diagram-builder");
          const project = parsePscx(text);
          const rawDiagram = buildPscadDiagram(project, targetModule);
          const nodes = rawDiagram.cells.filter((c) => c.shape !== "edge");
          const edges = rawDiagram.cells.filter((c) => c.shape === "edge");
          const rootName = project.rootModule.name || "Main";
          const isSubModule = Boolean(targetModule && targetModule !== rootName);
          const breadcrumbs = isSubModule
            ? [
                { id: rootName, label: `${rootName} (Overview)`, uri: params.uri },
                { id: targetModule!, label: targetModule!, uri: params.uri },
              ]
            : [{ id: rootName, label: rootName, uri: params.uri }];
          const pscadResult = {
            nodes,
            edges,
            coordinateSystem: null,
            cells: rawDiagram.cells,
            breadcrumbs,
            metadata: {
              ...rawDiagram.metadata,
              currentModule: targetModule || rootName,
              isSubModule,
              breadcrumbs,
            },
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
          const sysmlOps = getSysML2DiagramOps(this);
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
      await this.parserService?.ensureLanguageParserLoaded(params.uri);
      return this.getDiagramDispatch().getData(params);
    }

    // Modelica — check cache first.
    const effectiveUri = params.uri.startsWith("modelscript-lib://global")
      ? "file://" + params.uri.substring("modelscript-lib://global".length)
      : params.uri;

    // Check if the document has pending edits or has not been re-indexed yet.
    // If so, run the fast diagram sync immediately to produce up-to-date CST/index/QueryEngine data without waiting on full lints.
    if (this.validationService) {
      const doc = this.documentManager.documents.get(params.uri) ?? this.documentManager.documents.get(effectiveUri);
      const textToCheck = params.documentText ?? doc?.getText();
      const lastIndexed =
        this.validationService.lastIndexedText.get(params.uri) ??
        this.validationService.lastIndexedText.get(effectiveUri);
      const isTextStale = textToCheck !== undefined && (lastIndexed === undefined || textToCheck !== lastIndexed);
      const hasInstances =
        (this.workspaceManager.documentInstances.get(params.uri)?.length ?? 0) > 0 ||
        (this.workspaceManager.documentInstances.get(effectiveUri)?.length ?? 0) > 0;

      if (isTextStale || !hasInstances) {
        if (typeof this.validationService.syncDocumentForDiagram === "function") {
          await this.validationService.syncDocumentForDiagram(params.uri, params.documentText);
          if (effectiveUri !== params.uri) {
            await this.validationService.syncDocumentForDiagram(effectiveUri, params.documentText);
          }
        } else {
          await this.validationService.flushValidation(params.uri);
          if (effectiveUri !== params.uri) {
            await this.validationService.flushValidation(effectiveUri);
          }
        }
      }
    }

    const lastIndexedMap = this.validationService?.lastIndexedText ?? (globalThis as any).lastIndexedText;
    const dependenciesReady =
      this.validationService?.dependenciesReady ?? (globalThis as any).dependenciesReady ?? true;
    const indexedText = params.documentText !== undefined ? params.documentText : lastIndexedMap?.get(effectiveUri);
    const version =
      indexedText != null
        ? `idx:${indexedText.length}:${simpleHash(indexedText)}|${dependenciesReady}`
        : dependenciesReady
          ? "deps-ready"
          : "deps-loading";
    const cacheKey = `${params.uri}|${params.className ?? ""}|${params.diagramType ?? "All"}`;
    const cached = this.diagramCache.get(cacheKey) ?? (globalThis as any).diagramCache?.get(cacheKey);
    if (cached && cached.version === version) {
      const text = indexedText ?? "";
      let likelyHasComponents = false;
      const treeRoot = this.documentManager.documentTrees.get(effectiveUri)?.tree?.rootNode;
      if (treeRoot) {
        const stack: import("../utils/ast-utils.js").CstNodeLike[] = [treeRoot];
        while (stack.length > 0 && !likelyHasComponents) {
          const n = stack.pop();
          if (!n) continue;
          if (n.type === "component_clause" || (n.type === "annotation_clause" && n.text.includes("Placement"))) {
            likelyHasComponents = true;
            break;
          }
          for (const c of n.children || []) stack.push(c);
        }
      } else {
        likelyHasComponents = hasModelicaDiagramHint(text);
      }
      if (!(likelyHasComponents && (!cached.data?.nodes || cached.data.nodes.length === 0))) {
        this.connection.console.info(`[diagram-perf] cache hit for ${params.uri}`);
        return cached.data;
      }
      this.diagramCache.delete(cacheKey);
      (globalThis as any).diagramCache?.delete(cacheKey);
    }

    if (!dependenciesReady) {
      return {
        nodes: [],
        edges: [],
        coordinateSystem: { x: -100, y: -100, width: 200, height: 200 },
        diagramBackground: null,
        isLoading: true,
      };
    }

    const t0 = performance.now();
    let classInstance = this.workspaceManager.resolveClassInstance(params.uri, params.className);

    if (!classInstance && params.className) {
      // Requested class was not found in this document (e.g. stale class name from previously open model).
      // Fall back to resolving the primary class instance in this document.
      classInstance = this.workspaceManager.resolveClassInstance(params.uri);
    }

    if (!classInstance) {
      // Dependencies are ready but class instance not yet available (re-validation in progress).
      // Return last cached data to avoid blanking the diagram during the brief window
      // between dependencies loading and re-validation completing.
      if (cached && cached.data?.nodes && cached.data.nodes.length > 0) {
        this.connection.console.info(`[diagram-perf] class not resolved, returning stale cache for ${params.uri}`);
        return cached.data;
      }
      return null;
    }

    const tResolve = performance.now() - t0;

    try {
      const tBuild0 = performance.now();
      const ops = getModelicaDiagramOps(this);
      const result = ops.buildDiagramData ? await ops.buildDiagramData(classInstance) : null;
      const tBuild = performance.now() - tBuild0;
      if (result) {
        (result as any).isLoading = !dependenciesReady;
      }
      this.connection.console.info(
        `[diagram-perf] ${classInstance.name}: resolve=${tResolve.toFixed(0)}ms build=${tBuild.toFixed(0)}ms nodes=${result?.nodes?.length ?? 0} edges=${result?.edges?.length ?? 0}`,
      );

      // Cache the result (do not cache empty nodes if class actually had component declarations)
      const hasDeclaredComponents = Array.isArray(classInstance.components) && classInstance.components.length > 0;
      if (result && (!hasDeclaredComponents || (result.nodes && result.nodes.length > 0))) {
        this.diagramCache.set(cacheKey, { version, data: result });
      }

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
        getUnifiedIndex: () => {
          try {
            return this.workspaceManager.unifiedWorkspace?.getIndex?.({ eager: false }) ?? null;
          } catch {
            return null;
          }
        },
        isDocumentStale: (uri: string) => {
          if (!this.validationService) return false;
          const doc = this.documentManager.documents.get(uri);
          if (doc && this.validationService.lastIndexedText) {
            const effectiveUri = uri.startsWith("modelscript-lib://global")
              ? "file://" + uri.substring("modelscript-lib://global".length)
              : uri;
            const normUri = effectiveUri.replace(/^([a-z0-9+-]+):\/{1,3}/i, "$1:///");
            const indexedText =
              this.validationService.lastIndexedText.get(uri) ??
              this.validationService.lastIndexedText.get(effectiveUri) ??
              this.validationService.lastIndexedText.get(normUri);
            if (indexedText === undefined || indexedText !== doc.getText()) {
              return true;
            }
          }
          const hasInstances = (this.workspaceManager.documentInstances.get(uri)?.length ?? 0) > 0;
          if (!hasInstances) return true;
          return false;
        },
        flushValidation: async (uri: string) => {
          if (typeof this.validationService?.syncDocumentForDiagram === "function") {
            await this.validationService.syncDocumentForDiagram(uri);
            return;
          }
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

      const sysmlOps = getSysML2DiagramOps(this);
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
            const unified = this.workspaceManager.unifiedWorkspace.getIndex({ eager: true });
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
            ] as const;
            const matchedType = validTypes.find((t) => t.toLowerCase() === diagramTypeRaw.toLowerCase());
            const diagramType = matchedType ?? "All";
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
                  const symbolId = sym ? String(sym.id) : undefined;
                  const el = sysmlOps.findElementLayout
                    ? sysmlOps.findElementLayout(layout, name ?? "", symbolId)
                    : name
                      ? layout.elements[name]
                      : undefined;
                  if (el) {
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
          const p = globalLanguageRegistry.getPluginById("sysml2")?.parser;
          if (p) return p;
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
            const unified = this.workspaceManager.unifiedWorkspace.getIndex();
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
                // Try to extract doc comment from CST node or source slice
                let description: string | undefined;
                const docText = this.documentManager.documents.get(uri)?.getText();
                const startOff = sym.startOffset;
                const endOff = sym.endOffset;
                const treeRoot = this.documentManager.documentTrees.get(uri)?.tree?.rootNode;
                if (treeRoot && typeof startOff === "number" && typeof endOff === "number") {
                  const stack: import("../utils/ast-utils.js").CstNodeLike[] = [treeRoot];
                  while (stack.length > 0) {
                    const n = stack.pop();
                    if (!n) continue;
                    if (
                      typeof n.startIndex === "number" &&
                      n.startIndex >= startOff &&
                      typeof n.endIndex === "number" &&
                      n.endIndex <= endOff &&
                      (n.type === "Documentation" || n.type === "DOC_COMMENT" || n.type === "COMMENT")
                    ) {
                      description = extractDocCommentBody(n.text);
                      if (description !== undefined) break;
                    }
                    for (let i = (n.children?.length ?? 0) - 1; i >= 0; i--) {
                      const ch = n.children?.[i];
                      if (ch) stack.push(ch);
                    }
                  }
                }
                if (
                  description === undefined &&
                  docText &&
                  typeof startOff === "number" &&
                  typeof endOff === "number"
                ) {
                  description = extractDocCommentBody(docText.substring(startOff, endOff));
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
        getUnifiedIndex: () => {
          try {
            return this.workspaceManager.unifiedWorkspace?.getIndex?.({ eager: false }) ?? null;
          } catch {
            return null;
          }
        },
      });

      const genericBackend = new GenericDSLDiagramBackend({
        getDocumentText: (uri) => this.documentManager.documents.get(uri)?.getText(),
        getSymbolIndex: () => {
          try {
            return this.workspaceManager.unifiedWorkspace.getIndex();
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
        getParser: (langId) => this.parserService?.getParser(langId),
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
