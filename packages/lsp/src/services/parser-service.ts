// SPDX-License-Identifier: AGPL-3.0-or-later

// ts-check

import { createWasmParser } from "@modelscript/dsl/bindings";
import { getStdlibsForLanguage } from "@modelscript/exchange/catalog";
import { ArenaQueryFlattener } from "@modelscript/modelica/flattener";
import {
  FederatedQueryCacheStore,
  IndexedDBQueryCacheStore,
  MemoryQueryCacheStore,
} from "@modelscript/runtime/wasm_cache_store.js";
import { Connection, TextDocuments } from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";
import { globalLanguageRegistry } from "../registry/LanguageRegistry.js";
import { computeTreeEdit } from "../utils/ast-utils.js";
import type { SyntaxNode, Tree as TreeSitterTree } from "../utils/cst-facade.js";
import { LineIndex, TokenData } from "../utils/line-index.js";
import { BrowserFileSystem } from "../vfs/browser-file-system.js";
import {
  loadDependencyFromRegistry,
  LoaderContext,
  loadMSL,
  loadSysML2StandardLibrary,
  mountPolyglotLibrary,
  resolveWorkspaceLibraryVersions,
} from "../vfs/library-loader.js";
import { DocumentManager } from "./document-manager.js";
import { WorkspaceManager } from "./workspace-manager.js";

export class ParserService {
  private parserEntries = new Map<string, { parser: any; facade: any; ready: boolean }>();
  public sharedContext: any = null;

  private registeringLangs = new Set<string>();

  public registerParser(langId: string, parser: any, facade: any = null): void {
    const norm = langId.toLowerCase();
    const prev = this.parserEntries.get(norm);
    const resolvedFacade = facade ?? prev?.facade ?? null;
    this.parserEntries.set(norm, { parser, facade: resolvedFacade, ready: !!parser });
    if (this.registeringLangs.has(norm)) return;
    this.registeringLangs.add(norm);
    try {
      const plugin = globalLanguageRegistry.getPluginById(norm);
      if (plugin) {
        const pDesc = Object.getOwnPropertyDescriptor(plugin, "parser");
        if (!pDesc || pDesc.writable || typeof pDesc.set === "function") {
          try {
            plugin.parser = parser;
          } catch {}
        }
        if (resolvedFacade !== null) {
          const fDesc = Object.getOwnPropertyDescriptor(plugin, "facade");
          if (!fDesc || fDesc.writable || typeof fDesc.set === "function") {
            try {
              plugin.facade = resolvedFacade;
            } catch {}
          }
        }
      }
      const alt = norm === "sysml" ? "sysml2" : norm === "sysml2" ? "sysml" : null;
      if (alt) {
        this.parserEntries.set(alt, { parser, facade: resolvedFacade, ready: !!parser });
        const altPlugin = globalLanguageRegistry.getPluginById(alt);
        if (altPlugin) {
          const pDesc = Object.getOwnPropertyDescriptor(altPlugin, "parser");
          if (!pDesc || pDesc.writable || typeof pDesc.set === "function") {
            try {
              altPlugin.parser = parser;
            } catch {}
          }
          if (resolvedFacade !== null) {
            const fDesc = Object.getOwnPropertyDescriptor(altPlugin, "facade");
            if (!fDesc || fDesc.writable || typeof fDesc.set === "function") {
              try {
                altPlugin.facade = resolvedFacade;
              } catch {}
            }
          }
        }
      }
      const setGlobalPlain = (key: string, val: any) => {
        const desc = Object.getOwnPropertyDescriptor(globalThis, key);
        if (desc?.set || desc?.get) return;
        (globalThis as any)[key] = val;
      };
      if (norm === "modelica") {
        setGlobalPlain("parser", parser);
        setGlobalPlain("modelicaParser", parser);
        setGlobalPlain("parserReady", !!parser);
      } else if (norm === "sysml2" || norm === "sysml") {
        setGlobalPlain("sysml2Parser", parser);
        setGlobalPlain("sysml2ParserReady", !!parser);
      } else if (norm === "step") {
        setGlobalPlain("stepParser", parser);
        setGlobalPlain("stepParserReady", !!parser);
      } else if (norm === "owl2") {
        setGlobalPlain("owl2Parser", parser);
        setGlobalPlain("owl2ParserReady", !!parser);
      } else if (norm === "csv") {
        setGlobalPlain("csvParser", parser);
        setGlobalPlain("csvParserReady", !!parser);
      }
    } finally {
      this.registeringLangs.delete(norm);
    }
  }

  private inGetParser = false;
  private inGetFacade = false;

  public getParser(langId: string): any | null {
    const norm = langId.toLowerCase();
    const entry = this.parserEntries.get(norm);
    if (entry?.parser) return entry.parser;
    if (this.inGetParser) return null;
    this.inGetParser = true;
    try {
      const p = globalLanguageRegistry.getPluginById(norm)?.parser;
      if (p) return p;
      const alternate = norm === "sysml" ? "sysml2" : norm === "sysml2" ? "sysml" : null;
      if (alternate) {
        return (
          this.parserEntries.get(alternate)?.parser ?? globalLanguageRegistry.getPluginById(alternate)?.parser ?? null
        );
      }
      return null;
    } finally {
      this.inGetParser = false;
    }
  }

  public getFacade(langId: string): any | null {
    const norm = langId.toLowerCase();
    const entry = this.parserEntries.get(norm);
    if (entry?.facade) return entry.facade;
    if (this.inGetFacade) return null;
    this.inGetFacade = true;
    try {
      const f = globalLanguageRegistry.getPluginById(norm)?.facade;
      if (f) return f;
      const alternate = norm === "sysml" ? "sysml2" : norm === "sysml2" ? "sysml" : null;
      if (alternate) {
        return (
          this.parserEntries.get(alternate)?.facade ?? globalLanguageRegistry.getPluginById(alternate)?.facade ?? null
        );
      }
      return null;
    } finally {
      this.inGetFacade = false;
    }
  }

  public isParserReady(langId: string): boolean {
    const norm = langId.toLowerCase();
    const entry = this.parserEntries.get(norm);
    if (entry?.ready && entry.parser) return true;
    const alternate = norm === "sysml" ? "sysml2" : norm === "sysml2" ? "sysml" : null;
    if (alternate) {
      const altEntry = this.parserEntries.get(alternate);
      if (altEntry?.ready && altEntry.parser) return true;
    }
    if (!this.inGetParser) {
      this.inGetParser = true;
      try {
        const p = globalLanguageRegistry.getPluginById(norm)?.parser;
        if (p) return true;
        if (alternate) {
          const ap = globalLanguageRegistry.getPluginById(alternate)?.parser;
          if (ap) return true;
        }
      } finally {
        this.inGetParser = false;
      }
    }
    return false;
  }

  public getParserForUri(uri: string): any | null {
    const plugin =
      globalLanguageRegistry.getPluginForLanguageIdOrUri(undefined, uri) ||
      globalLanguageRegistry.getPluginById(uri) ||
      globalLanguageRegistry.getPluginForUri(uri);
    if (plugin?.id) {
      const p = this.getParser(plugin.id);
      if (p) return p;
    }
    return null;
  }

  // Compatibility getters/setters for legacy callers
  /** @deprecated Use `getParser("modelica")` instead. */
  get parser() {
    return this.getParser("modelica");
  }
  set parser(val: any) {
    this.registerParser("modelica", val, this.facade);
  }
  /** @deprecated Use `getFacade("modelica")` instead. */
  get facade() {
    return this.getFacade("modelica");
  }
  set facade(val: any) {
    const p = this.parser;
    this.registerParser("modelica", p, val);
  }
  /** @deprecated Use `isParserReady("modelica")` instead. */
  get parserReady() {
    return this.isParserReady("modelica");
  }
  set parserReady(val: boolean) {
    const entry = this.parserEntries.get("modelica");
    if (entry) entry.ready = val;
    else this.registerParser("modelica", null, null);
  }

  /** @deprecated Use `getParser("sysml2")` instead. */
  get sysml2Parser() {
    return this.getParser("sysml2");
  }
  set sysml2Parser(val: any) {
    this.registerParser("sysml2", val, this.sysml2Facade);
  }
  /** @deprecated Use `getFacade("sysml2")` instead. */
  get sysml2Facade() {
    return this.getFacade("sysml2");
  }
  set sysml2Facade(val: any) {
    const p = this.sysml2Parser;
    this.registerParser("sysml2", p, val);
  }
  /** @deprecated Use `isParserReady("sysml2")` instead. */
  get sysml2ParserReady() {
    return this.isParserReady("sysml2");
  }
  set sysml2ParserReady(val: boolean) {
    const entry = this.parserEntries.get("sysml2");
    if (entry) entry.ready = val;
    else this.registerParser("sysml2", null, null);
  }

  /** @deprecated Use `getParser("step")` instead. */
  get stepParser() {
    return this.getParser("step");
  }
  set stepParser(val: any) {
    this.registerParser("step", val, this.stepFacade);
  }
  get stepFacade() {
    return this.getFacade("step");
  }
  set stepFacade(val: any) {
    const p = this.stepParser;
    this.registerParser("step", p, val);
  }
  get stepParserReady() {
    return this.isParserReady("step");
  }
  set stepParserReady(val: boolean) {
    const entry = this.parserEntries.get("step");
    if (entry) entry.ready = val;
    else this.registerParser("step", null, null);
  }

  get owl2Parser() {
    return this.getParser("owl2");
  }
  set owl2Parser(val: any) {
    this.registerParser("owl2", val, this.owl2Facade);
  }
  get owl2Facade() {
    return this.getFacade("owl2");
  }
  set owl2Facade(val: any) {
    const p = this.owl2Parser;
    this.registerParser("owl2", p, val);
  }
  get owl2ParserReady() {
    return this.isParserReady("owl2");
  }
  set owl2ParserReady(val: boolean) {
    const entry = this.parserEntries.get("owl2");
    if (entry) entry.ready = val;
    else this.registerParser("owl2", null, null);
  }

  get csvParser() {
    return this.getParser("csv");
  }
  set csvParser(val: any) {
    this.registerParser("csv", val, this.csvFacade);
  }
  get csvFacade() {
    return this.getFacade("csv");
  }
  set csvFacade(val: any) {
    const p = this.csvParser;
    this.registerParser("csv", p, val);
  }
  get csvParserReady() {
    return this.isParserReady("csv");
  }
  set csvParserReady(val: boolean) {
    const entry = this.parserEntries.get("csv");
    if (entry) entry.ready = val;
    else this.registerParser("csv", null, null);
  }

  constructor(
    private connection: Connection,
    private documentManager: DocumentManager,
    private workspaceManager: WorkspaceManager,
    private documents: TextDocuments<TextDocument>,
  ) {}

  getSharedCstTreeWrapper() {
    return {
      getText: (startOffset: number, endOffset: number, entry?: any): string | null => {
        if (!entry || !entry.resourceId) return null;
        const uri = entry.resourceId;
        const normUri = uri.replace(/^([a-z0-9+-]+):\/{0,3}/i, "$1:///");
        const oneSlashUri = uri.replace(/^([a-z0-9+-]+):\/{0,3}/i, "$1:/");
        const docTrees =
          this.documentManager?.documentTrees ??
          (this.workspaceManager as any)?.documentManager?.documentTrees ??
          (this.documentManager as any)?.documentManager?.documentTrees;
        const docTree = docTrees?.get(uri) ?? docTrees?.get(normUri) ?? docTrees?.get(oneSlashUri);
        if (docTree && typeof docTree.text === "string" && docTree.text.length > 0) {
          return docTree.text.substring(startOffset, endOffset);
        }

        const openDoc = this.documents?.get(uri) ?? this.documents?.get(normUri) ?? this.documents?.get(oneSlashUri);
        if (openDoc && typeof openDoc.getText === "function") {
          return openDoc.getText().substring(startOffset, endOffset);
        }

        const wsText =
          this.workspaceManager?.unifiedWorkspace?.getDocumentText?.(uri) ??
          this.workspaceManager?.unifiedWorkspace?.getDocumentText?.(normUri);
        if (typeof wsText === "string" && wsText.length > 0) {
          return wsText.substring(startOffset, endOffset);
        }

        const lazyLibTrees =
          this.documentManager?.lazyLibTrees ??
          (this.workspaceManager as any)?.documentManager?.lazyLibTrees ??
          (this.documentManager as any)?.documentManager?.lazyLibTrees;
        let lazyCache = lazyLibTrees?.get(uri);
        if (!lazyCache && this.sharedContext) {
          try {
            const fsPath = uri.startsWith("file://") ? uri.substring(7) : uri;
            let text = this.sharedContext.fs?.read(fsPath);
            if (!text && uri.startsWith("modelica:")) {
              const stripped = uri.replace(/^modelica:\/?\/?/, "/");
              text = this.sharedContext.fs?.read(stripped.startsWith("/") ? stripped : "/" + stripped);
            }
            if (!text && uri.startsWith("sources/")) {
              text = this.sharedContext.fs?.read(
                `/modelscript_registry/Modelica/4.1.0/${uri.substring("sources/".length)}`,
              );
            }
            if (text) {
              lazyCache = { tree: null, text };
              lazyLibTrees?.set(uri, lazyCache);
              if (lazyLibTrees && lazyLibTrees.size > 50) {
                const oldest = lazyLibTrees.keys().next().value;
                if (oldest !== undefined) {
                  const oldCache = lazyLibTrees.get(oldest);
                  if (oldCache && oldCache.tree && typeof oldCache.tree.delete === "function") {
                    try {
                      oldCache.tree.delete();
                    } catch {
                      /* ignore */
                    }
                  }
                  lazyLibTrees.delete(oldest);
                }
              }
            }
          } catch {
            // ignore
          }
        }
        if (lazyCache && typeof lazyCache.text === "string") return lazyCache.text.substring(startOffset, endOffset);
        return null;
      },
      getNode: (startOffset: number, endOffset: number, entry?: any): any | null => {
        if (!entry || !entry.resourceId) return null;
        const uri = entry.resourceId;
        const normUri = uri.replace(/^([a-z0-9+-]+):\/{0,3}/i, "$1:///");
        const oneSlashUri = uri.replace(/^([a-z0-9+-]+):\/{0,3}/i, "$1:/");
        const docTrees =
          this.documentManager?.documentTrees ??
          (this.workspaceManager as any)?.documentManager?.documentTrees ??
          (this.documentManager as any)?.documentManager?.documentTrees;
        const docTree = docTrees?.get(uri) ?? docTrees?.get(normUri) ?? docTrees?.get(oneSlashUri);
        if (docTree && docTree.tree) {
          const root = docTree.tree.rootNode ?? (docTree.tree as any)?.tree?.rootNode;
          if (root && typeof root.descendantForIndex === "function") {
            let n = root.descendantForIndex(startOffset, Math.max(startOffset, endOffset));
            if (n && n.type === "source_file") {
              for (let i = 0; i < n.childCount; i++) {
                if (n.child(i).type === "class_definition") {
                  n = n.child(i);
                  break;
                }
              }
            }
            return n;
          }
          return root ?? null;
        }

        const lazyLibTrees =
          this.documentManager?.lazyLibTrees ??
          (this.workspaceManager as any)?.documentManager?.lazyLibTrees ??
          (this.documentManager as any)?.documentManager?.lazyLibTrees;
        let lazyCache = lazyLibTrees?.get(uri);
        if ((!lazyCache || !lazyCache.tree) && this.sharedContext) {
          try {
            let text = lazyCache?.text;
            const fsPath = uri.startsWith("file://") ? uri.substring(7) : uri;
            if (!text) {
              text = this.sharedContext.fs.read(fsPath);
            }
            if (!text && uri.startsWith("modelica:")) {
              const stripped = uri.replace(/^modelica:\/?\/?/, "/");
              text = this.sharedContext.fs.read(stripped.startsWith("/") ? stripped : "/" + stripped);
            }
            if (!text && uri.startsWith("sources/")) {
              text = this.sharedContext.fs.read(
                `/modelscript_registry/Modelica/4.1.0/${uri.substring("sources/".length)}`,
              );
            }
            if (text) {
              const ext =
                (this.workspaceManager?.unifiedWorkspace as any)?.extractExtension?.(uri) ??
                (uri.includes(".") ? `.${uri.split(".").pop()}` : ".mo");
              const tree = this.sharedContext.parse(ext, text);
              lazyCache = { tree, text };
              this.documentManager.lazyLibTrees.set(uri, lazyCache);
              if (this.documentManager.lazyLibTrees.size > 50) {
                const oldest = this.documentManager.lazyLibTrees.keys().next().value;
                if (oldest !== undefined) {
                  const oldCache = this.documentManager.lazyLibTrees.get(oldest);
                  if (oldCache && oldCache.tree && typeof oldCache.tree.delete === "function") {
                    try {
                      oldCache.tree.delete();
                    } catch {
                      /* ignore */
                    }
                  }
                  this.documentManager.lazyLibTrees.delete(oldest);
                }
              }
            } else {
              this.connection.console.error(`[cstTreeWrapper] failed to read fsPath: ${fsPath}`);
            }
          } catch (e) {
            this.connection.console.error(`[cstTreeWrapper] exception parsing ${uri}: ${e}`);
          }
        }
        if (lazyCache && lazyCache.tree) {
          const root = lazyCache.tree.rootNode ?? (lazyCache.tree as any)?.tree?.rootNode;
          if (root && typeof root.descendantForIndex === "function") {
            let n = root.descendantForIndex(startOffset, Math.max(startOffset, endOffset));
            if (n && n.type === "source_file") {
              for (let i = 0; i < n.childCount; i++) {
                if (n.child(i).type === "class_definition") {
                  n = n.child(i);
                  break;
                }
              }
            }
            if (!n)
              this.connection.console.error(
                `[cstTreeWrapper] descendantForIndex returned null for ${uri} [${startOffset}-${endOffset}]`,
              );
            return n;
          }
          return root ?? null;
        }
        this.connection.console.error(`[cstTreeWrapper] lazyCache completely empty for ${uri}`);
        return null;
      },
    };
  }

  updateDocumentTree(uri: string, newText: string): TreeSitterTree {
    const plugin = globalLanguageRegistry.getPluginForUri(uri);
    const parser = plugin?.parser ?? this.getParserForUri(uri) ?? (this.isParserReady("modelica") ? this.parser : null);
    const facade = plugin?.facade ?? (this.isParserReady("modelica") ? this.facade : null);
    if (!parser) {
      throw new Error(`Parser not ready for URI: ${uri}`);
    }

    const cached = this.documentManager.documentTrees.get(uri);
    const cachedTree = cached?.tree as unknown as { rootPtr?: number; rootNode?: { id?: number } } | null | undefined;
    const oldRootPtr = cachedTree?.rootPtr ?? cachedTree?.rootNode?.id ?? 0;
    const isCachedTreeActive = Boolean(oldRootPtr && facade && facade.lastAstRoot === oldRootPtr);
    let tree: TreeSitterTree;
    const t0 = performance.now();

    if (cached && cached.text !== newText && isCachedTreeActive) {
      // Incremental reparse: edit the old tree and pass it to parse()
      const tEdit0 = performance.now();
      const edit = computeTreeEdit(cached.text, newText);
      const tEdit1 = performance.now();
      if (typeof (cached.tree as any)?.edit === "function") {
        cached.tree.edit(edit as never);
      }
      const tEdit2 = performance.now();

      // Attempt to set timeout to 100ms if supported
      if (typeof (parser as any).setTimeoutMicros === "function") {
        (parser as any).setTimeoutMicros(100000);
      }
      try {
        tree = parser.parse(newText, cached.tree, edit.startIndex, edit.oldEndIndex, edit.newEndIndex);
      } finally {
        if (typeof (parser as any).setTimeoutMicros === "function") {
          (parser as any).setTimeoutMicros(0);
        }
      }
      const tEdit3 = performance.now();

      if (tEdit3 - t0 > 100) {
        this.connection.console.warn(
          `[perf] updateDocumentTree (incremental) slow: total=${(tEdit3 - t0).toFixed(2)}ms, diff=${(tEdit1 - tEdit0).toFixed(2)}ms, edit=${(tEdit2 - tEdit1).toFixed(2)}ms, parse=${(tEdit3 - tEdit2).toFixed(2)}ms`,
        );
      }
    } else if (cached && cached.text === newText && isCachedTreeActive) {
      // Text unchanged — reuse existing tree
      return cached.tree;
    } else {
      // First parse — no old tree available
      const tParse0 = performance.now();
      void tParse0;
      // Attempt to set timeout to 1000ms if supported
      if (typeof (parser as any).setTimeoutMicros === "function") {
        (parser as any).setTimeoutMicros(1000000);
      }
      try {
        tree = parser.parse(newText);
      } finally {
        if (typeof (parser as any).setTimeoutMicros === "function") {
          (parser as any).setTimeoutMicros(0);
        }
      }
      const tParse1 = performance.now();
      if (tParse1 - t0 > 500) {
        this.connection.console.warn(`[perf] updateDocumentTree (full) slow: total=${(tParse1 - t0).toFixed(2)}ms`);
      }
    }

    this.documentManager.documentTrees.set(uri, {
      text: newText,
      tree,
      classCache: cached?.classCache ?? new Map(),
      lineIndex: undefined,
      tokens: undefined,
    });
    return tree;
  }

  getDocumentTree(uri: string): TreeSitterTree | null {
    const plugin = globalLanguageRegistry.getPluginForUri(uri);
    const parser = plugin?.parser ?? this.getParserForUri(uri) ?? (this.isParserReady("modelica") ? this.parser : null);
    const facade = plugin?.facade ?? (this.isParserReady("modelica") ? this.facade : null);
    if (!parser) return null;

    const cached = this.documentManager.documentTrees.get(uri);
    const cachedTree = cached?.tree as unknown as { rootPtr?: number; rootNode?: { id?: number } } | null | undefined;
    const oldRootPtr = cachedTree?.rootPtr ?? cachedTree?.rootNode?.id ?? 0;
    const isCachedTreeActive = Boolean(oldRootPtr && facade && facade.lastAstRoot === oldRootPtr);
    if (cached && isCachedTreeActive) return cached.tree;

    // No cached tree — parse from current document text
    const document = this.documents.get(uri);
    if (!document) return cached?.tree ?? null;

    const text = document.getText();
    return this.updateDocumentTree(uri, text);
  }

  getLineIndexForDoc(uri: string): { lineIndex: LineIndex; tokens: SyntaxNode[] } | null {
    const cached = this.documentManager.documentTrees.get(uri);
    if (!cached || !cached.tree) return null;

    if (cached.lineIndex && cached.tokens) {
      return { lineIndex: cached.lineIndex, tokens: cached.tokens };
    }

    const tokensData: TokenData[] = [];
    const nodes: SyntaxNode[] = [];

    const walk = (node: SyntaxNode) => {
      if (node.childCount === 0) {
        const startRow = node.startPosition.row;
        const endRow = node.endPosition.row;
        if (startRow === endRow) {
          tokensData.push({
            line: startRow,
            startCol: node.startPosition.column,
            endCol: node.endPosition.column,
            nodeId: node.id,
          });
          nodes.push(node);
        } else {
          const tokenLines = (node.text ?? "").split(/\r?\n|\r/);
          for (let r = startRow; r <= endRow; r++) {
            const lineIdx = r - startRow;
            const lineStr = tokenLines[lineIdx] ?? "";
            const startCol = r === startRow ? node.startPosition.column : 0;
            const endCol = r === endRow ? node.endPosition.column : startCol + lineStr.length;
            tokensData.push({
              line: r,
              startCol,
              endCol,
              nodeId: node.id,
            });
            nodes.push(node);
          }
        }
      } else {
        for (let i = 0; i < node.childCount; i++) {
          const child = node.child(i);
          if (child) walk(child);
        }
      }
    };

    walk(cached.tree.rootNode);
    const totalLines = cached.text.split(/\r?\n|\r/).length;
    cached.lineIndex = new LineIndex(totalLines, tokensData);
    cached.tokens = nodes;

    return { lineIndex: cached.lineIndex, tokens: cached.tokens };
  }

  public serverDistBase = "";
  private loaderCtx: LoaderContext | null = null;

  public getServerDistBase(): string {
    return this.serverDistBase || (globalThis as any).serverDistBase || "";
  }

  public getOrCreateLoaderContext(): LoaderContext {
    if (this.loaderCtx) {
      return this.loaderCtx;
    }
    const globalCtx = globalThis as any;
    if (globalCtx.savedLoaderCtx) {
      this.loaderCtx = globalCtx.savedLoaderCtx;
      return this.loaderCtx!;
    }
    this.ensureSharedContext();
    const localStore =
      typeof indexedDB !== "undefined"
        ? new IndexedDBQueryCacheStore("modelscript-lsp-cache")
        : new MemoryQueryCacheStore();
    const federatedEndpoints: string[] = [];
    const cacheStore = new FederatedQueryCacheStore(localStore, {
      getEndpoints: () => federatedEndpoints,
    });
    this.loaderCtx = {
      connectionState: this.connection,
      logger: {
        log: (msg) => this.connection.console.info(msg),
        warn: (msg) => this.connection.console.warn(msg),
        error: (msg, e) => this.connection.console.error(`${msg} ${e}`),
      },
      sharedFs: globalCtx.sharedFs ?? new BrowserFileSystem(),
      sharedContext: this.sharedContext,
      globalWorkspaceIndex: this.workspaceManager.getWorkspaceIndex("modelica"),
      sysml2WorkspaceIndex: this.workspaceManager.getWorkspaceIndex("sysml2"),
      documentTrees: this.documentManager.documentTrees as any,
      sysml2Parser: this.getParser("sysml2") as any,
      cacheStore,
      registryUrl: typeof globalCtx.registryUrl !== "undefined" ? globalCtx.registryUrl : undefined,
      federatedEndpoints,
    };
    globalCtx.savedLoaderCtx = this.loaderCtx;
    return this.loaderCtx;
  }

  private manifest: {
    id: string;
    wasm?: string | undefined;
    displayName?: string | undefined;
    fileExtensions?: string[] | undefined;
    extensions?: string[] | undefined;
    syntaxNames?: string[] | undefined;
    fieldNames?: Record<string, number> | undefined;
  }[] = [
    { id: "modelica", wasm: "modelica.wasm", displayName: "Modelica", fileExtensions: [".mo"] },
    {
      id: "sysml2",
      wasm: "sysml2.wasm",
      displayName: "SysML v2",
      fileExtensions: [".sysml", ".sysml2", ".kerml"],
    },
    { id: "step", wasm: "step.wasm", displayName: "Step", fileExtensions: [".step"] },
    { id: "owl2", wasm: "owl2.wasm", displayName: "Owl2", fileExtensions: [".owl", ".owl2", ".ofn", ".ttl"] },
    { id: "csv", wasm: "csv.wasm", displayName: "Csv", fileExtensions: [".csv"] },
    { id: "scad", wasm: "scad.wasm", displayName: "Scad", fileExtensions: [".scad"] },
  ];
  private lazyLoadParsers = false;
  private useLocalMsl = false;
  private validationServiceRef: any = null;
  private projectDependenciesRef: { name: string; version: string }[] = [];
  private loadingParserPromises = new Map<string, Promise<void>>();
  private loadingStdlibPromises = new Map<string, Promise<void>>();

  private ensureSharedContext(): void {
    if (this.sharedContext) return;
    this.sharedContext = {
      fs: (globalThis as any).sharedFs,
      parse: (ext: string, input: string, ...rest: any[]) => {
        const normExt = ext.startsWith(".") ? ext.toLowerCase() : `.${ext.toLowerCase()}`;
        const parser =
          this.getParserForUri(`file:///dummy${normExt}`) ??
          (this.workspaceManager.unifiedWorkspace as any)?.getParser?.(normExt);
        if (parser) return parser.parse(input, ...rest);
        if (normExt === ".sysml" || normExt === ".sysml2" || normExt === ".kerml")
          return (this.sysml2Parser as any)?.parse(input, ...rest);
        if (normExt === ".mo" || normExt === ".msim" || normExt === ".mos")
          return (this.parser as any)?.parse(input, ...rest);
        return null;
      },
      flattenArena: (name: string, classId?: any, _uri?: string, options?: any) => {
        const engine =
          this.workspaceManager.globalModelicaQueryEngine ?? this.workspaceManager.getQueryEngine("modelica");
        if (!engine) return null;
        let targetId = classId;
        if (targetId !== undefined && !engine.index?.symbols?.has(targetId)) {
          targetId = undefined;
        }
        if (targetId === undefined) {
          const candidates = (engine as any).index?.byName?.get(name);
          if (candidates && candidates.length > 0) {
            targetId = candidates[0];
          }
        }
        if (targetId === undefined) return null;
        const queryDB = engine.toQueryDB();
        const flattener = new ArenaQueryFlattener(queryDB, options);
        return flattener.flatten(targetId, null, options);
      },
    };
    (globalThis as any).sharedContext = this.sharedContext;
  }

  private resolveNormalizedLanguageId(languageIdOrUri: string): string {
    const raw = (languageIdOrUri || "").trim();
    if (!raw) return "modelica";
    const lower = raw.toLowerCase();
    if (lower === "sysml") return "sysml2";

    // Direct match in manifest
    const directManifest = this.manifest.find((m) => m.id.toLowerCase() === lower);
    if (directManifest) return directManifest.id;

    // Extension match in manifest if URI or filename
    if (raw.includes(".") || raw.includes("/")) {
      const cleanUri = lower.split("?")[0]!.split("#")[0]!;
      for (const entry of this.manifest) {
        const exts = entry.fileExtensions || entry.extensions || [`.${entry.id}`];
        if (exts.some((ext) => cleanUri.endsWith(ext.toLowerCase()))) {
          return entry.id;
        }
      }
    }

    const plugin =
      globalLanguageRegistry.getPluginById(lower) ||
      globalLanguageRegistry.getPluginForLanguageIdOrUri(raw, raw) ||
      globalLanguageRegistry.getPluginForUri(raw);
    if (plugin?.id) {
      return plugin.id === "sysml" ? "sysml2" : plugin.id;
    }

    return lower;
  }

  private async loadSingleWasmEntry(entry: {
    id: string;
    wasm?: string | undefined;
    displayName?: string | undefined;
    fileExtensions?: string[] | undefined;
    extensions?: string[] | undefined;
    syntaxNames?: string[] | undefined;
    fieldNames?: Record<string, number> | undefined;
  }): Promise<void> {
    const serverDistBase = this.getServerDistBase();
    if (serverDistBase) {
      this.serverDistBase = serverDistBase;
    }
    const isNode = typeof process !== "undefined" && Boolean(process.versions?.node);
    if (!this.serverDistBase && !isNode) return;
    if (this.isParserReady(entry.id)) {
      this.ensureSharedContext();
      return;
    }

    const existingPromise = this.loadingParserPromises.get(entry.id);
    if (existingPromise) {
      await existingPromise;
      this.ensureSharedContext();
      return;
    }

    const loadPromise = (async () => {
      const syntaxNames = entry.syntaxNames || (globalThis as any)[`${entry.id}SyntaxNames`];
      const fieldNames = entry.fieldNames || (globalThis as any)[`${entry.id}FieldNames`];
      const exts = entry.fileExtensions || entry.extensions || [`.${entry.id}`];
      const candidates: string[] = [];

      if (this.serverDistBase) {
        if (entry.wasm) candidates.push(`${this.serverDistBase}/${entry.wasm}`);
        candidates.push(`${this.serverDistBase}/${entry.id}.wasm`);
        if (entry.id === "modelica") candidates.push(`${this.serverDistBase}/parser.wasm`);
      }

      if (isNode) {
        try {
          const modName = "node" + ":module";
          const { createRequire } = await import(/* @vite-ignore */ modName);
          const req = createRequire(import.meta.url);
          try {
            candidates.push(req.resolve(`@modelscript/${entry.id}/parser.wasm`));
          } catch {}
          try {
            candidates.push(req.resolve(`@modelscript/${entry.id}/dist/parser.wasm`));
          } catch {}
        } catch {}
      }

      const uniqueCandidates = Array.from(new Set(candidates));

      try {
        let result: any = null;
        let lastError: any = null;
        for (const candUrl of uniqueCandidates) {
          try {
            result = await createWasmParser(candUrl, { syntaxNames, fieldNames });
            if (result) break;
          } catch (err) {
            lastError = err;
          }
        }
        if (!result && lastError) {
          throw lastError;
        }

        if (result) {
          this.registerParser(entry.id, result.parser, result.facade);
          this.ensureSharedContext();
          if (this.workspaceManager?.unifiedWorkspace && result.parser) {
            for (const ext of exts) {
              this.workspaceManager.unifiedWorkspace.registerParser(ext, result.parser);
              this.workspaceManager.unifiedWorkspace.registerLanguageExtension(ext, entry.id);
            }
          }
          if (entry.id === "sysml2") {
            this.registerParser("sysml", result.parser, result.facade);
            const existingSysml = globalLanguageRegistry.getPluginById("sysml");
            if (!existingSysml) {
              globalLanguageRegistry.register({
                id: "sysml",
                name: "SysML v2",
                extensions: [".sysml", ".sysml2", ".kerml"],
                parser: result.parser,
                facade: result.facade,
                disposables: [],
              });
            } else {
              const pDesc = Object.getOwnPropertyDescriptor(existingSysml, "parser");
              if (!pDesc || pDesc.writable || typeof pDesc.set === "function") {
                try {
                  existingSysml.parser = result.parser;
                } catch {}
              }
              const fDesc = Object.getOwnPropertyDescriptor(existingSysml, "facade");
              if (!fDesc || fDesc.writable || typeof fDesc.set === "function") {
                try {
                  existingSysml.facade = result.facade;
                } catch {}
              }
            }
          }

          // Register in globalLanguageRegistry as well
          const existing = globalLanguageRegistry.getPluginById(entry.id);
          if (!existing) {
            globalLanguageRegistry.register({
              id: entry.id,
              name: entry.displayName || entry.id,
              extensions: exts,
              parser: result.parser,
              facade: result.facade,
              disposables: [],
            });
          } else {
            const pDesc = Object.getOwnPropertyDescriptor(existing, "parser");
            if (!pDesc || pDesc.writable || typeof pDesc.set === "function") {
              try {
                existing.parser = result.parser;
              } catch {}
            }
            const fDesc = Object.getOwnPropertyDescriptor(existing, "facade");
            if (!fDesc || fDesc.writable || typeof fDesc.set === "function") {
              try {
                existing.facade = result.facade;
              } catch {}
            }
          }

          this.connection.console.info(`ModelScript ${entry.displayName || entry.id} parser initialized`);
        }
      } catch (e) {
        this.connection.console.warn(`Failed to load ${entry.id} language: ${e}`);
      }
    })();

    this.loadingParserPromises.set(entry.id, loadPromise);
    try {
      await loadPromise;
    } finally {
      if (!this.isParserReady(entry.id)) {
        this.loadingParserPromises.delete(entry.id);
      }
    }
  }

  private async ensureStdlibForLanguage(langId: string): Promise<void> {
    const norm = langId.toLowerCase();
    const depName =
      norm === "modelica" || norm === "modelscript"
        ? "Modelica"
        : norm === "sysml2" || norm === "sysml"
          ? "SysML"
          : null;

    if (!depName) {
      // Polyglot lazy activation: check if language has standard libraries in catalog
      const polyglotLibs = getStdlibsForLanguage(norm);
      if (polyglotLibs.length === 0) return;

      const globalCtx = globalThis as unknown as {
        savedLoaderCtx?: LoaderContext | undefined;
        validateTextDocument?: ((doc: unknown) => Promise<void>) | undefined;
        getReadyMessage?: (() => string) | undefined;
      };

      const loaderCtx = this.getOrCreateLoaderContext();
      const serverDistBase = this.getServerDistBase();
      if (!serverDistBase) return;
      this.serverDistBase = serverDistBase;

      for (const lib of polyglotLibs) {
        const libKey = `${lib.packageName}@${lib.version}`;
        const existingPromise = this.loadingStdlibPromises.get(libKey);
        if (existingPromise) {
          await existingPromise;
          continue;
        }

        let mountOk = false;
        const mountPromise = (async () => {
          this.connection.sendNotification("modelscript/status", {
            state: "loading",
            message: `ModelScript (activating ${lib.packageName} standard library...)`,
          });

          try {
            const ok = await mountPolyglotLibrary(this.serverDistBase, loaderCtx, {
              packageName: lib.packageName,
              version: lib.version,
              filename: lib.filename,
              language: lib.language,
            });

            if (ok) {
              mountOk = true;
              this.connection.console.info(`[lsp] Successfully lazy-mounted stdlib ${libKey} for ${norm}.`);
            }
          } catch (mountErr) {
            this.connection.console.warn(`[lsp] Failed to mount polyglot stdlib ${libKey}: ${mountErr}`);
          }

          if (mountOk) {
            for (const doc of this.documents.all()) {
              const docLang = this.resolveNormalizedLanguageId(doc.languageId || doc.uri);
              if (docLang === norm) {
                try {
                  await (this.validationServiceRef?.validateTextDocument?.(doc) ??
                    globalCtx.validateTextDocument?.(doc));
                } catch (err) {
                  this.connection.console.warn(`[lsp] Failed to validate open doc after ${libKey} load: ${err}`);
                }
              }
            }

            this.sendProjectTreeChanged();
            this.connection.sendNotification("modelscript/status", {
              state: "ready",
              message: globalCtx.getReadyMessage?.() ?? "ModelScript",
            });
          }
        })();

        this.loadingStdlibPromises.set(libKey, mountPromise);
        try {
          await mountPromise;
        } finally {
          if (!mountOk) {
            this.loadingStdlibPromises.delete(libKey);
          }
        }
      }
      return;
    }

    const existingStdlib = this.loadingStdlibPromises.get(depName);
    if (existingStdlib) {
      await existingStdlib;
      return;
    }

    const loaderCtx = this.getOrCreateLoaderContext();
    const serverDistBase = this.getServerDistBase();
    if (!serverDistBase) return;
    this.serverDistBase = serverDistBase;

    const dep =
      this.projectDependenciesRef.find((d) => d.name === depName) ??
      (depName === "Modelica" ? { name: "Modelica", version: "4.1.0" } : { name: "SysML", version: "2026.3.0" });

    let loadSucceeded = false;
    const stdlibPromise = (async () => {
      if (this.validationServiceRef) {
        const alreadyDeclared = this.validationServiceRef.declaredDependencies?.some(
          (d: { name: string; version: string }) => d.name === dep.name && d.version === dep.version,
        );
        if (!alreadyDeclared) {
          this.validationServiceRef.declaredDependencies.push(dep);
        }
      }

      if (depName === "SysML") {
        loaderCtx.sysml2Parser = this.getParser("sysml2") as any;
      }

      this.connection.sendNotification("modelscript/status", {
        state: "loading",
        message: `ModelScript (loading ${dep.name} standard library...)`,
      });

      try {
        if (this.useLocalMsl && dep.name === "Modelica") {
          await loadMSL(this.serverDistBase, loaderCtx, dep.version);
        } else if (this.useLocalMsl && dep.name === "SysML" && dep.version === "2026.3.0") {
          await loadSysML2StandardLibrary(this.serverDistBase, loaderCtx);
        } else {
          try {
            await loadDependencyFromRegistry(dep, loaderCtx);
          } catch (regErr) {
            if (dep.name === "Modelica") {
              this.connection.console.warn(
                `[lsp] Registry load failed for Modelica, falling back to local MSL zip: ${regErr}`,
              );
              await loadMSL(this.serverDistBase, loaderCtx, dep.version);
            } else if (dep.name === "SysML") {
              this.connection.console.warn(
                `[lsp] Registry load failed for SysML, falling back to local SysML zip: ${regErr}`,
              );
              await loadSysML2StandardLibrary(this.serverDistBase, loaderCtx);
            } else {
              throw regErr;
            }
          }
        }
        if (this.validationServiceRef) {
          this.validationServiceRef.markDependencyLoaded(dep.name, dep.version);
        }
        loadSucceeded = true;
      } catch (err) {
        this.connection.console.warn(`[lsp] Failed to load ${dep.name}@${dep.version}: ${err}`);
      }

      if (loadSucceeded) {
        (globalThis as any).clearIconCache?.();
        (globalThis as any).clearDiagramCache?.();
        (globalThis as any).diagramCache?.clear();

        for (const doc of this.documents.all()) {
          try {
            await (this.validationServiceRef?.validateTextDocument?.(doc) ??
              (globalThis as any).validateTextDocument?.(doc));
          } catch (err) {
            this.connection.console.warn(`[lsp] Failed to validate open document after ${dep.name} load: ${err}`);
          }
        }

        this.sendProjectTreeChanged();
        this.connection.sendNotification("modelscript/status", {
          state: "ready",
          message: (globalThis as any).getReadyMessage?.() ?? "ModelScript",
        });
      }
    })();

    this.loadingStdlibPromises.set(depName, stdlibPromise);
    try {
      await stdlibPromise;
    } finally {
      if (!loadSucceeded) {
        this.loadingStdlibPromises.delete(depName);
      }
    }
  }

  public async syncDocumentLibraryVersions(uri: string, text: string): Promise<void> {
    const loaderCtx = this.getOrCreateLoaderContext();
    const serverDistBase = this.getServerDistBase();
    if (!loaderCtx || !serverDistBase) return;
    try {
      const swapped = await resolveWorkspaceLibraryVersions(text, loaderCtx, uri, serverDistBase);
      if (swapped.length > 0) {
        for (const dep of swapped) {
          const existingIdx = this.projectDependenciesRef.findIndex((d) => d.name === dep.name);
          if (existingIdx >= 0) {
            this.projectDependenciesRef[existingIdx] = dep;
          } else {
            this.projectDependenciesRef.push(dep);
          }
          this.validationServiceRef?.markDependencyLoaded?.(dep.name, dep.version);
        }
        (globalThis as any).clearDiagramCache?.();
        (globalThis as any).diagramCache?.clear();
        this.sendProjectTreeChanged();
        for (const doc of this.documents.all()) {
          try {
            await (this.validationServiceRef?.validateTextDocument?.(doc) ??
              (globalThis as any).validateTextDocument?.(doc));
          } catch {}
        }
      }
    } catch (err) {
      this.connection.console.warn(`[lsp] syncDocumentLibraryVersions failed for ${uri}: ${err}`);
    }
  }

  public async ensureLanguageParserLoaded(languageIdOrUri: string): Promise<void> {
    const serverDistBase = this.getServerDistBase();
    if (serverDistBase) {
      this.serverDistBase = serverDistBase;
    }
    const isNode = typeof process !== "undefined" && Boolean(process.versions?.node);
    if (!this.serverDistBase && !isNode) return;
    this.ensureSharedContext();
    const langId = this.resolveNormalizedLanguageId(languageIdOrUri);
    if (!this.isParserReady(langId)) {
      let entry = this.manifest.find((m) => m.id.toLowerCase() === langId.toLowerCase());
      if (!entry) {
        const plugin = globalLanguageRegistry.getPluginById(langId);
        if (plugin) {
          entry = {
            id: plugin.id,
            wasm: `${plugin.id}.wasm`,
            displayName: plugin.name,
            extensions: plugin.extensions,
          };
        }
      }
      if (entry && (entry.wasm || entry.id)) {
        await this.loadSingleWasmEntry(entry);
      }
    }
    if (this.lazyLoadParsers) {
      // Trigger stdlib loading in background if not already loaded, after parser is ready
      void this.ensureStdlibForLanguage(langId);
    }
  }

  async initWasmParsers(
    extensionUri: string,
    validationService?: any,
    projectDependencies: { name: string; version: string }[] = [
      { name: "Modelica", version: "4.1.0" },
      { name: "SysML", version: "2026.3.0" },
    ],
    useLocalMsl = false,
    onParsersReady?: () => void,
    options?: { lazyLoadParsers?: boolean | undefined; initialLanguageId?: string | undefined } | undefined,
  ): Promise<void> {
    try {
      // Construct absolute URLs for WASM files using the extension URI.
      // The extensionUri may be an HTTP URL or a VS Code internal URI scheme.
      // For static deployments, we need to ensure it resolves to an HTTP URL.
      let serverDistBase = `${extensionUri}/server/dist`;
      this.connection.console.info(`[wasm-parser] extensionUri: ${extensionUri}`);
      this.connection.console.info(`[wasm-parser] serverDistBase: ${serverDistBase}`);

      // If the URI isn't HTTP(S), try to construct an HTTP URL from the worker's location
      if (!serverDistBase.startsWith("http://") && !serverDistBase.startsWith("https://")) {
        // Fallback: use the worker's origin with the known static path
        const origin = (globalThis as unknown as { location?: { origin?: string | undefined } | undefined }).location
          ?.origin;
        if (origin && (origin.startsWith("http://") || origin.startsWith("https://"))) {
          serverDistBase = `${origin}/static/devextensions/server/dist`;
          this.connection.console.info(`[wasm-parser] Using fallback serverDistBase: ${serverDistBase}`);
        }
      }

      // Set this EARLY so that occt-import-js has the right path during early validation pass
      (globalThis as any).serverDistBase = serverDistBase;
      this.serverDistBase = serverDistBase;
      this.lazyLoadParsers = Boolean(options?.lazyLoadParsers);
      this.useLocalMsl = useLocalMsl;
      this.validationServiceRef = validationService;
      this.projectDependenciesRef = projectDependencies;
      this.ensureSharedContext();
      const loaderCtx = this.getOrCreateLoaderContext();
      (globalThis as any).savedLoaderCtx = loaderCtx;

      this.connection.sendNotification("modelscript/status", {
        state: "loading",
        message: "Initializing this.parser...",
      });

      // Load languages from languages-manifest.json if present
      let manifest: {
        id: string;
        wasm?: string | undefined;
        displayName?: string | undefined;
        fileExtensions?: string[] | undefined;
        extensions?: string[] | undefined;
        syntaxNames?: string[] | undefined;
        fieldNames?: Record<string, number> | undefined;
      }[] = [];
      try {
        const manifestUrl = `${serverDistBase}/languages-manifest.json`;
        if (typeof fetch !== "undefined") {
          const resp = await fetch(manifestUrl);
          if (resp.ok) {
            manifest = await resp.json();
          }
        }
      } catch {
        // ignore
      }

      if (!manifest || manifest.length === 0) {
        manifest = this.manifest;
      } else {
        this.manifest = manifest;
      }

      if (this.lazyLoadParsers) {
        const initialTargets = new Set<string>();
        if (options?.initialLanguageId) {
          initialTargets.add(this.resolveNormalizedLanguageId(options.initialLanguageId));
        }
        for (const doc of this.documents.all()) {
          initialTargets.add(this.resolveNormalizedLanguageId(doc.languageId || doc.uri));
        }
        await Promise.all(
          Array.from(initialTargets).map(async (langId) => {
            const entry = manifest.find((m) => m.id.toLowerCase() === langId.toLowerCase());
            if (entry && entry.wasm) {
              await this.loadSingleWasmEntry(entry);
            }
          }),
        );
      } else {
        await Promise.all(manifest.map((entry) => this.loadSingleWasmEntry(entry)));
      }

      // Early callback: notify as soon as Modelica/SysML2 parser is ready
      if (typeof onParsersReady === "function") {
        try {
          onParsersReady();
        } catch (cbErr) {
          this.connection.console.error(`[lsp] onParsersReady early callback error: ${cbErr}`);
        }
      }

      this.ensureSharedContext();

      // === EARLY VALIDATION PASS ===
      // Validate open documents NOW — before any library loading.
      // This gives users instant syntax error feedback (~1s after page load)
      // instead of waiting 10-30s for MSL/SysML2 decompression.
      this.connection.console.info(
        `[lsp] Parser ready. Early-validating ${this.documents.all().length} open documents for syntax errors.`,
      );
      for (const doc of this.documents.all()) {
        try {
          await (validationService?.validateTextDocument?.(doc) ?? (globalThis as any).validateTextDocument?.(doc));
        } catch (err: any) {
          this.connection.console.warn(`[lsp] Early validation failed for ${doc.uri}: ${err?.message ?? err}`);
        }
      }

      const cacheStore = loaderCtx.cacheStore;
      const MAX_MEMOS = 2_000_000; // Limit in-memory memos

      const createModelicaQE =
        (globalThis as any).createModelicaQueryEngine ?? (globalThis as any).create_modelica_query_engine;
      if (createModelicaQE) {
        try {
          const unified =
            this.workspaceManager.getWorkspaceIndex("modelica")?.getIndex?.({ eager: true }) ??
            this.workspaceManager.unifiedWorkspace?.getIndex?.();
          if (unified) {
            this.workspaceManager.globalModelicaQueryEngine = createModelicaQE(
              unified,
              { getText: () => null, getNode: () => null },
              cacheStore,
              MAX_MEMOS,
            ) as any;
          }
        } catch (qeErr: any) {
          this.connection.console.warn(
            `[lsp] Failed to initialize globalModelicaQueryEngine: ${qeErr?.message ?? qeErr}`,
          );
        }
      }
      if (this.sharedContext) {
        this.sharedContext.queryEngine = this.workspaceManager.globalModelicaQueryEngine;
      }
      this.workspaceManager.globalModelicaQueryEngine?.updateTree(this.getSharedCstTreeWrapper());

      // Early callback: notify that all parsers and query engines are ready
      if (typeof onParsersReady === "function") {
        try {
          onParsersReady();
        } catch (cbErr) {
          this.connection.console.error(`[lsp] onParsersReady callback error: ${cbErr}`);
        }
      }

      loaderCtx.globalWorkspaceIndex = this.workspaceManager.getWorkspaceIndex("modelica");
      loaderCtx.sysml2WorkspaceIndex = this.workspaceManager.getWorkspaceIndex("sysml2");
      loaderCtx.sysml2Parser = this.getParser("sysml2") as any;
      loaderCtx.sharedContext = this.sharedContext;

      if (this.lazyLoadParsers) {
        const initialTargets = new Set<string>();
        if (options?.initialLanguageId) {
          initialTargets.add(this.resolveNormalizedLanguageId(options.initialLanguageId));
        }
        for (const doc of this.documents.all()) {
          initialTargets.add(this.resolveNormalizedLanguageId(doc.languageId || doc.uri));
        }
        const customDeps: { name: string; version: string }[] = [];
        for (const dep of projectDependencies) {
          if (dep.name === "Modelica") {
            if (initialTargets.size === 0 || initialTargets.has("modelica") || initialTargets.has("modelscript")) {
              initialTargets.add("modelica");
            }
          } else if (dep.name === "SysML") {
            if (initialTargets.size === 0 || initialTargets.has("sysml2") || initialTargets.has("sysml")) {
              initialTargets.add("sysml2");
            }
          } else {
            customDeps.push(dep);
          }
        }
        const stdlibPromises: Promise<void>[] = [];
        for (const langId of initialTargets) {
          if (langId === "modelica" || langId === "modelscript" || langId === "sysml2") {
            stdlibPromises.push(this.ensureStdlibForLanguage(langId));
          }
        }
        for (const dep of customDeps) {
          if (validationService) {
            validationService.declaredDependencies.push(dep);
          }
          stdlibPromises.push(
            (async () => {
              try {
                await loadDependencyFromRegistry(dep, loaderCtx);
              } catch (err) {
                this.connection.console.warn(
                  `[lsp] Failed to load custom dependency ${dep.name}@${dep.version}: ${err}`,
                );
              } finally {
                if (validationService) {
                  validationService.markDependencyLoaded(dep.name, dep.version);
                }
              }
            })(),
          );
        }
        if (stdlibPromises.length > 0) {
          await Promise.all(stdlibPromises);
          this.sendProjectTreeChanged();
        } else {
          this.sendProjectTreeChanged();
          this.connection.sendNotification("modelscript/status", {
            state: "ready",
            message: (globalThis as any).getReadyMessage?.() ?? "ModelScript",
          });
        }
        return;
      }

      this.connection.sendNotification("modelscript/status", {
        state: "loading",
        message: "ModelScript (loading libraries...)",
      });

      // Load all project dependencies
      if (validationService) {
        for (const dep of projectDependencies) {
          validationService.declaredDependencies.push(dep);
        }
      }

      // Load dependencies concurrently
      const loadPromises = projectDependencies.map(async (dep) => {
        try {
          if (useLocalMsl && dep.name === "Modelica") {
            await loadMSL(serverDistBase, loaderCtx, dep.version);
          } else if (useLocalMsl && dep.name === "SysML" && dep.version === "2026.3.0") {
            await loadSysML2StandardLibrary(serverDistBase, loaderCtx);
          } else {
            try {
              await loadDependencyFromRegistry(dep, loaderCtx);
            } catch (regErr) {
              if (dep.name === "Modelica") {
                this.connection.console.warn(
                  `[lsp] Registry load failed for Modelica, falling back to local MSL zip: ${regErr}`,
                );
                await loadMSL(serverDistBase, loaderCtx, dep.version);
              } else if (dep.name === "SysML") {
                this.connection.console.warn(
                  `[lsp] Registry load failed for SysML, falling back to local SysML zip: ${regErr}`,
                );
                await loadSysML2StandardLibrary(serverDistBase, loaderCtx);
              } else {
                throw regErr;
              }
            }
          }
          if (validationService) validationService.markDependencyLoaded(dep.name, dep.version);
        } catch (err) {
          this.connection.console.warn(`[lsp] Failed to load ${dep.name}@${dep.version}: ${err}`);
          // Mark loaded anyway so we don't permanently block readiness
          if (validationService) validationService.markDependencyLoaded(dep.name, dep.version);
        }
      });

      await Promise.all(loadPromises);

      this.connection.console.info(`[lsp] Dependencies loaded. Re-validating open documents.`);
      (globalThis as any).clearIconCache?.();
      (globalThis as any).clearDiagramCache?.();
      (globalThis as any).diagramCache?.clear();

      for (const doc of this.documents.all()) {
        try {
          await (globalThis as any).validateTextDocument?.(doc);
        } catch (err) {
          this.connection.console.warn(`[lsp] Failed to validate open document on init: ${err}`);
        }
      }

      this.sendProjectTreeChanged();

      this.connection.sendNotification("modelscript/status", {
        state: "ready",
        message: (globalThis as any).getReadyMessage?.() ?? "ModelScript",
      });
    } catch (e: any) {
      this.connection.console.error(`Failed to initialize WASM parsers: ${e}\n${e.stack}`);
      this.parserReady = false;
      this.connection.sendNotification("modelscript/status", {
        state: "error",
        message: "Parser initialization failed",
      });
    }
  }

  private projectTreeChangedTimer: ReturnType<typeof setTimeout> | null = null;
  private projectTreeChangedPending: boolean = false;

  sendProjectTreeChanged() {
    if (this.projectTreeChangedTimer) {
      // Inside cooldown — mark pending so we fire once when the timer expires.
      this.projectTreeChangedPending = true;
      return;
    }
    // Fire immediately (leading edge)
    this.connection.sendNotification("modelscript/projectTreeChanged");
    this.projectTreeChangedTimer = setTimeout(() => {
      this.projectTreeChangedTimer = null;
      if (this.projectTreeChangedPending) {
        this.projectTreeChangedPending = false;
        this.connection.sendNotification("modelscript/projectTreeChanged");
      }
    }, 1000);
  }

  findRangeForIri(
    iri: string,
    currentUri: string,
  ): { start: { line: number; character: number }; end: { line: number; character: number } } | null {
    const db = this.workspaceManager.unifiedWorkspace.getIndex();
    const nameIds = db.byName.get(iri);
    if (nameIds && nameIds.length > 0) {
      for (const id of nameIds) {
        const entry = db.symbols.get(id);
        if (!entry) continue;
        const startOff = entry.startOffset;
        const endOff = entry.endOffset;
        if (entry.resourceId === currentUri && typeof startOff === "number" && typeof endOff === "number") {
          const bridge = (globalThis as any).documentLSPBridges?.get(currentUri);
          if (bridge) {
            return bridge["positions"].rangeFromOffsets(startOff, endOff);
          }
        }
      }
    }
    return null;
  }

  resolveModelicaClassInstance(uri: string, className?: string): any {
    return this.workspaceManager.resolveModelicaClassInstance(uri, className);
  }
}
