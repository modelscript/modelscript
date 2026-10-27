// SPDX-License-Identifier: AGPL-3.0-or-later

// ts-check

import { createWasmParser } from "@modelscript/dsl/bindings";
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
import { getCompositeName } from "../utils/hierarchy-utils.js";
import { LineIndex, TokenData } from "../utils/line-index.js";
import { BrowserFileSystem } from "../vfs/browser-file-system.js";
import {
  loadDependencyFromRegistry,
  LoaderContext,
  loadMSL,
  loadSysML2StandardLibrary,
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
        plugin.parser = parser;
        if (resolvedFacade !== null) plugin.facade = resolvedFacade;
      }
      const alt = norm === "sysml" ? "sysml2" : norm === "sysml2" ? "sysml" : null;
      if (alt) {
        this.parserEntries.set(alt, { parser, facade: resolvedFacade, ready: !!parser });
        const altPlugin = globalLanguageRegistry.getPluginById(alt);
        if (altPlugin) {
          altPlugin.parser = parser;
          if (resolvedFacade !== null) altPlugin.facade = resolvedFacade;
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
              const tree = this.sharedContext.parse(
                uri.endsWith(".sysml") || uri.endsWith(".sysml2") || uri.endsWith(".kerml") ? ".sysml" : ".mo",
                text,
              );
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
    if (!this.parserReady || !this.parser) {
      throw new Error("Parser not ready");
    }

    const cached = this.documentManager.documentTrees.get(uri);
    let tree: TreeSitterTree;
    const t0 = performance.now();

    if (cached && cached.text !== newText) {
      // Incremental reparse: edit the old tree and pass it to parse()
      const tEdit0 = performance.now();
      const edit = computeTreeEdit(cached.text, newText);
      const tEdit1 = performance.now();
      if (typeof (cached.tree as any)?.edit === "function") {
        cached.tree.edit(edit as never);
      }
      const tEdit2 = performance.now();

      // Attempt to set timeout to 100ms if supported
      if (typeof (this.parser as any).setTimeoutMicros === "function") {
        (this.parser as any).setTimeoutMicros(100000);
      }
      try {
        tree = this.parser.parse(newText, cached.tree, edit.startIndex, edit.oldEndIndex, edit.newEndIndex);
      } finally {
        if (typeof (this.parser as any).setTimeoutMicros === "function") {
          (this.parser as any).setTimeoutMicros(0);
        }
      }
      const tEdit3 = performance.now();

      if (tEdit3 - t0 > 100) {
        this.connection.console.warn(
          `[perf] updateDocumentTree (incremental) slow: total=${(tEdit3 - t0).toFixed(2)}ms, diff=${(tEdit1 - tEdit0).toFixed(2)}ms, edit=${(tEdit2 - tEdit1).toFixed(2)}ms, parse=${(tEdit3 - tEdit2).toFixed(2)}ms`,
        );
      }
    } else if (cached) {
      // Text unchanged — reuse existing tree
      return cached.tree;
    } else {
      // First parse — no old tree available
      const tParse0 = performance.now();
      void tParse0;
      // Attempt to set timeout to 1000ms if supported
      if (typeof (this.parser as any).setTimeoutMicros === "function") {
        (this.parser as any).setTimeoutMicros(1000000);
      }
      try {
        tree = this.parser.parse(newText);
      } finally {
        if (typeof (this.parser as any).setTimeoutMicros === "function") {
          (this.parser as any).setTimeoutMicros(0);
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
    if (!this.parserReady || !this.parser) return null;

    const cached = this.documentManager.documentTrees.get(uri);
    if (cached) return cached.tree;

    // No cached tree — parse from current document text
    const document = this.documents.get(uri);
    if (!document) return null;

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

  private serverDistBase = "";
  private manifest: {
    id: string;
    wasm?: string | undefined;
    displayName?: string | undefined;
    fileExtensions?: string[] | undefined;
    extensions?: string[] | undefined;
    syntaxNames?: string[] | undefined;
    fieldNames?: Record<string, number> | undefined;
  }[] = [];
  private lazyLoadParsers = false;
  private useLocalMsl = false;
  private validationServiceRef: any = null;
  private projectDependenciesRef: { name: string; version: string }[] = [];
  private loadingParserPromises = new Map<string, Promise<void>>();
  private loadingStdlibPromises = new Map<string, Promise<void>>();

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
    if (!entry.wasm || !this.serverDistBase) return;
    if (this.isParserReady(entry.id)) return;

    const existingPromise = this.loadingParserPromises.get(entry.id);
    if (existingPromise) {
      await existingPromise;
      return;
    }

    const loadPromise = (async () => {
      const syntaxNames = entry.syntaxNames || (globalThis as any)[`${entry.id}SyntaxNames`];
      const fieldNames = entry.fieldNames || (globalThis as any)[`${entry.id}FieldNames`];
      const exts = entry.fileExtensions || entry.extensions || [`.${entry.id}`];
      const candidates = Array.from(
        new Set([
          `${this.serverDistBase}/${entry.wasm}`,
          `${this.serverDistBase}/${entry.id}.wasm`,
          `${this.serverDistBase}/parser.wasm`,
        ]),
      );

      try {
        let result: any = null;
        let lastError: any = null;
        for (const candUrl of candidates) {
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
          if (this.workspaceManager?.unifiedWorkspace && result.parser) {
            for (const ext of exts) {
              this.workspaceManager.unifiedWorkspace.registerParser(ext, result.parser);
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
              existingSysml.parser = result.parser;
              existingSysml.facade = result.facade;
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
            existing.parser = result.parser;
            existing.facade = result.facade;
          }

          this.connection.console.info(`ModelScript ${entry.displayName || entry.id} parser initialized`);
        }
      } catch (e) {
        this.connection.console.warn(`Failed to load ${entry.id} language: ${e}`);
      }
    })();

    this.loadingParserPromises.set(entry.id, loadPromise);
    await loadPromise;
  }

  private async ensureStdlibForLanguage(langId: string): Promise<void> {
    const norm = langId.toLowerCase();
    const depName =
      norm === "modelica" || norm === "modelscript"
        ? "Modelica"
        : norm === "sysml2" || norm === "sysml"
          ? "SysML"
          : null;
    if (!depName) return;

    const existingStdlib = this.loadingStdlibPromises.get(depName);
    if (existingStdlib) {
      await existingStdlib;
      return;
    }

    const loaderCtx = (globalThis as any).savedLoaderCtx as LoaderContext | undefined;
    if (!loaderCtx || !this.serverDistBase) return;

    const dep =
      this.projectDependenciesRef.find((d) => d.name === depName) ??
      (depName === "Modelica" ? { name: "Modelica", version: "4.1.0" } : { name: "SysML", version: "2026.3.0" });

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
        if (this.useLocalMsl && dep.name === "Modelica" && dep.version === "4.1.0") {
          await loadMSL(this.serverDistBase, loaderCtx);
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
              await loadMSL(this.serverDistBase, loaderCtx);
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
      } catch (err) {
        this.connection.console.warn(`[lsp] Failed to load ${dep.name}@${dep.version}: ${err}`);
        if (this.validationServiceRef) {
          this.validationServiceRef.markDependencyLoaded(dep.name, dep.version);
        }
      }

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
    })();

    this.loadingStdlibPromises.set(depName, stdlibPromise);
    await stdlibPromise;
  }

  public async ensureLanguageParserLoaded(languageIdOrUri: string): Promise<void> {
    if (!this.serverDistBase) return;
    const langId = this.resolveNormalizedLanguageId(languageIdOrUri);
    if (!this.isParserReady(langId)) {
      const entry = this.manifest.find((m) => m.id.toLowerCase() === langId.toLowerCase());
      if (entry && entry.wasm) {
        await this.loadSingleWasmEntry(entry);
      }
    }
    if (this.lazyLoadParsers && (langId === "modelica" || langId === "modelscript" || langId === "sysml2")) {
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
      const stepWs = this.workspaceManager.getWorkspaceIndex("step");
      if (stepWs) stepWs.serverDistBase = serverDistBase;
      (globalThis as any).serverDistBase = serverDistBase;
      this.serverDistBase = serverDistBase;
      this.lazyLoadParsers = Boolean(options?.lazyLoadParsers);
      this.useLocalMsl = useLocalMsl;
      this.validationServiceRef = validationService;
      this.projectDependenciesRef = projectDependencies;

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
        manifest = [
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
      }
      this.manifest = manifest;

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

      this.sharedContext = {
        fs: (globalThis as any).sharedFs,
        parse: (ext: string, input: string, ...rest: any[]) => {
          const parser = this.getParserForUri(`file:///dummy${ext}`);
          if (parser) return parser.parse(input, ...rest);
          if (ext === ".sysml" || ext === ".sysml2" || ext === ".kerml")
            return (this.sysml2Parser as any)?.parse(input, ...rest);
          return (this.parser as any)?.parse(input, ...rest);
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
          const flattenerClass = (globalThis as any).ArenaQueryFlattener;
          if (!flattenerClass) return null;
          const flattener = new flattenerClass(queryDB, options);
          return flattener.flatten(targetId, null, options);
        },
      };
      (globalThis as any).sharedContext = this.sharedContext;

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

      // Initialize FederatedCacheStore with local IndexedDB (browser) or Memory store (Node)
      const localStore =
        typeof indexedDB !== "undefined"
          ? new IndexedDBQueryCacheStore("modelscript-lsp-cache")
          : new MemoryQueryCacheStore();
      const federatedEndpoints: string[] = []; // Endpoints added later in loadRegistryPackages
      const cacheStore = new FederatedQueryCacheStore(localStore, {
        getEndpoints: () => federatedEndpoints,
      });
      const MAX_MEMOS = 2_000_000; // Limit in-memory memos

      const createModelicaQE =
        (globalThis as any).createModelicaQueryEngine ?? (globalThis as any).create_modelica_query_engine;
      if (createModelicaQE) {
        try {
          const unified =
            this.workspaceManager.getWorkspaceIndex("modelica")?.toUnified?.() ??
            this.workspaceManager.unifiedWorkspace?.toUnifiedPartial?.();
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
      const loaderCtx: LoaderContext = {
        connectionState: this.connection,
        logger: {
          log: (msg) => this.connection.console.info(msg),
          warn: (msg) => this.connection.console.warn(msg),
          error: (msg, e) => this.connection.console.error(`${msg} ${e}`),
        },
        sharedFs: (globalThis as any).sharedFs ?? new BrowserFileSystem(),
        sharedContext: this.sharedContext,
        globalWorkspaceIndex: this.workspaceManager.getWorkspaceIndex("modelica"),
        sysml2WorkspaceIndex: this.workspaceManager.getWorkspaceIndex("sysml2"),
        documentTrees: this.documentManager.documentTrees as any,
        sysml2Parser: this.getParser("sysml2") as any,
        cacheStore,
        registryUrl:
          typeof (globalThis as any).registryUrl !== "undefined" ? (globalThis as any).registryUrl : undefined,
        federatedEndpoints,
      };
      (globalThis as any).savedLoaderCtx = loaderCtx;

      if (this.lazyLoadParsers) {
        const initialTargets = new Set<string>();
        if (options?.initialLanguageId) {
          initialTargets.add(this.resolveNormalizedLanguageId(options.initialLanguageId));
        }
        for (const doc of this.documents.all()) {
          initialTargets.add(this.resolveNormalizedLanguageId(doc.languageId || doc.uri));
        }
        const stdlibPromises: Promise<void>[] = [];
        for (const langId of initialTargets) {
          if (langId === "modelica" || langId === "modelscript" || langId === "sysml2") {
            stdlibPromises.push(this.ensureStdlibForLanguage(langId));
          }
        }
        if (stdlibPromises.length > 0) {
          await Promise.all(stdlibPromises);
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
          if (useLocalMsl && dep.name === "Modelica" && dep.version === "4.1.0") {
            await loadMSL(serverDistBase, loaderCtx);
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
                await loadMSL(serverDistBase, loaderCtx);
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

  sendProjectTreeChanged() {
    if ((globalThis as any).projectTreeChangedTimer) {
      // Inside cooldown — mark pending so we fire once when the timer expires.
      (globalThis as any).projectTreeChangedPending = true;
      return;
    }
    // Fire immediately (leading edge)
    this.connection.sendNotification("modelscript/projectTreeChanged");
    (globalThis as any).projectTreeChangedTimer = setTimeout(() => {
      (globalThis as any).projectTreeChangedTimer = null;
      if ((globalThis as any).projectTreeChangedPending) {
        (globalThis as any).projectTreeChangedPending = false;
        this.connection.sendNotification("modelscript/projectTreeChanged");
      }
    }, 1000);
  }

  findRangeForIri(
    iri: string,
    currentUri: string,
  ): { start: { line: number; character: number }; end: { line: number; character: number } } | null {
    const db = this.workspaceManager.unifiedWorkspace.toUnifiedPartial();
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
    const instances = this.workspaceManager.documentInstances.get(uri);

    if (instances && instances.length > 0) {
      if (className) {
        const found = instances.find((i) => i.name === className || i.compositeName === className);
        if (found) return found;
      }
      return instances[0];
    }

    // Library class: get from polyglot index directly
    const unifiedIndex = this.workspaceManager.unifiedWorkspace.toUnifiedPartial();
    const isSysmlUri = uri.endsWith(".sysml") || uri.endsWith(".sysml2") || uri.endsWith(".kerml");
    let engine = isSysmlUri
      ? this.workspaceManager.globalSysML2QueryEngine
      : this.workspaceManager.globalModelicaQueryEngine;
    if (!engine) {
      if (isSysmlUri) {
        const sysmlFactory =
          (globalThis as any).createSysML2QueryEngine ?? (globalThis as any).create_sysml2_query_engine;
        if (typeof sysmlFactory === "function") {
          engine = sysmlFactory(unifiedIndex) as any;
          this.workspaceManager.globalSysML2QueryEngine = engine;
        }
      } else {
        const createModelicaQE =
          (globalThis as any).createModelicaQueryEngine ?? (globalThis as any).create_modelica_query_engine;
        if (createModelicaQE) {
          engine = createModelicaQE(
            unifiedIndex,
            this.getSharedCstTreeWrapper(),
            (globalThis as any).savedLoaderCtx?.cacheStore,
            100_000,
          ) as any;
          this.workspaceManager.globalModelicaQueryEngine = engine;
        }
        if (this.sharedContext) {
          if (typeof this.sharedContext.setQueryEngine === "function") {
            this.sharedContext.setQueryEngine(this.workspaceManager.globalModelicaQueryEngine!);
          } else {
            this.sharedContext.queryEngine = this.workspaceManager.globalModelicaQueryEngine;
          }
          if (typeof this.sharedContext.setWorkspaceIndex === "function") {
            this.sharedContext.setWorkspaceIndex(this.workspaceManager.getWorkspaceIndex("modelica"));
          } else {
            this.sharedContext.workspaceIndex = this.workspaceManager.getWorkspaceIndex("modelica");
          }
        }
      }
    }
    const db = engine!.toQueryDB();
    const ClassInst = (globalThis as any).ModelicaClassInstance;

    if (className) {
      const parts = className.split(".");
      const entries = unifiedIndex.byName.get(parts[parts.length - 1]!);
      const entryId = entries?.find((id) => {
        const e = unifiedIndex.symbols.get(id);
        return e && getCompositeName(e, unifiedIndex) === className;
      });
      if (entryId !== undefined && ClassInst) {
        return new ClassInst(entryId, db);
      }
    }

    // Fallback to first class in file.
    // Normalize URIs to handle scheme variations (file:// vs file:///)
    // and modelscript-lib://global prefix differences.
    const normalizeUri = (u: string) => {
      if (u.startsWith("modelscript-lib://global")) u = "file://" + u.substring("modelscript-lib://global".length);
      return u.replace(/^file:\/\/\//, "file://");
    };
    const normalizedParamsUri = normalizeUri(uri);
    const expectedSuffix = normalizedParamsUri.replace(/^file:\/\//, "");
    for (const [id, entry] of unifiedIndex.symbols) {
      if (
        entry.kind === "Class" &&
        entry.parentId === null &&
        entry.resourceId &&
        (normalizeUri(entry.resourceId) === normalizedParamsUri ||
          normalizeUri(entry.resourceId).endsWith(expectedSuffix))
      ) {
        if (ClassInst) return new ClassInst(id, db);
      }
    }

    return null;
  }
}
