/* eslint-disable @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any, @typescript-eslint/no-non-null-assertion */
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
import { computeTreeEdit } from "../utils/astUtils.js";
import { getCompositeName } from "../utils/hierarchyUtils.js";
import { LineIndex, TokenData } from "../utils/line-index.js";
import type { SyntaxNode, Tree as TreeSitterTree } from "../utils/tree-sitter.js";
import { BrowserFileSystem } from "../vfs/browser-file-system.js";
import {
  loadDependencyFromRegistry,
  LoaderContext,
  loadMSL,
  loadSysML2StandardLibrary,
} from "../vfs/library-loader.js";
import { DocumentManager } from "./DocumentManager.js";
import { WorkspaceManager } from "./WorkspaceManager.js";

let registryUrl: any = undefined;
let savedLoaderCtx: any = undefined;
let projectTreeChangedTimer: any = undefined;
let projectTreeChangedPending: any = undefined;
let documentLSPBridges: any = undefined;
let ModelicaClassInstance: any = undefined;

export class ParserService {
  private parserEntries = new Map<string, { parser: any; facade: any; ready: boolean }>();
  public sharedContext: any = null;

  public registerParser(langId: string, parser: any, facade: any = null): void {
    const norm = langId.toLowerCase();
    this.parserEntries.set(norm, { parser, facade, ready: !!parser });
    const plugin = globalLanguageRegistry.getPluginById(norm);
    if (plugin) {
      plugin.parser = parser;
      plugin.facade = facade;
    }
    const alt = norm === "sysml" ? "sysml2" : norm === "sysml2" ? "sysml" : null;
    if (alt) {
      this.parserEntries.set(alt, { parser, facade, ready: !!parser });
      const altPlugin = globalLanguageRegistry.getPluginById(alt);
      if (altPlugin) {
        altPlugin.parser = parser;
        altPlugin.facade = facade;
      }
    }
  }

  public getParser(langId: string): any | null {
    const norm = langId.toLowerCase();
    const p = this.parserEntries.get(norm)?.parser ?? globalLanguageRegistry.getPluginById(norm)?.parser;
    if (p) return p;
    const alternate = norm === "sysml" ? "sysml2" : norm === "sysml2" ? "sysml" : null;
    if (alternate) {
      return (
        this.parserEntries.get(alternate)?.parser ?? globalLanguageRegistry.getPluginById(alternate)?.parser ?? null
      );
    }
    return null;
  }

  public getFacade(langId: string): any | null {
    const norm = langId.toLowerCase();
    const f = this.parserEntries.get(norm)?.facade ?? globalLanguageRegistry.getPluginById(norm)?.facade;
    if (f) return f;
    const alternate = norm === "sysml" ? "sysml2" : norm === "sysml2" ? "sysml" : null;
    if (alternate) {
      return (
        this.parserEntries.get(alternate)?.facade ?? globalLanguageRegistry.getPluginById(alternate)?.facade ?? null
      );
    }
    return null;
  }

  public isParserReady(langId: string): boolean {
    const norm = langId.toLowerCase();
    const r = this.parserEntries.get(norm)?.ready ?? Boolean(globalLanguageRegistry.getPluginById(norm)?.parser);
    if (r) return true;
    const alternate = norm === "sysml" ? "sysml2" : norm === "sysml2" ? "sysml" : null;
    if (alternate) {
      return (
        this.parserEntries.get(alternate)?.ready ?? Boolean(globalLanguageRegistry.getPluginById(alternate)?.parser)
      );
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
  get parser() {
    return this.getParser("modelica");
  }
  set parser(val: any) {
    this.registerParser("modelica", val, this.facade);
  }
  get facade() {
    return this.getFacade("modelica");
  }
  set facade(val: any) {
    const p = this.parser;
    this.registerParser("modelica", p, val);
  }
  get parserReady() {
    return this.isParserReady("modelica");
  }
  set parserReady(val: boolean) {
    const entry = this.parserEntries.get("modelica");
    if (entry) entry.ready = val;
    else this.registerParser("modelica", null, null);
  }

  get sysml2Parser() {
    return this.getParser("sysml2");
  }
  set sysml2Parser(val: any) {
    this.registerParser("sysml2", val, this.sysml2Facade);
  }
  get sysml2Facade() {
    return this.getFacade("sysml2");
  }
  set sysml2Facade(val: any) {
    const p = this.sysml2Parser;
    this.registerParser("sysml2", p, val);
  }
  get sysml2ParserReady() {
    return this.isParserReady("sysml2");
  }
  set sysml2ParserReady(val: boolean) {
    const entry = this.parserEntries.get("sysml2");
    if (entry) entry.ready = val;
    else this.registerParser("sysml2", null, null);
  }

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
      getText: (startByte: number, endByte: number, entry?: any): string | null => {
        if (!entry || !entry.resourceId) return null;
        const uri = entry.resourceId;
        const docTree = this.documentManager.documentTrees.get(uri);
        if (docTree && docTree.tree && docTree.text) return docTree.text.substring(startByte, endByte);

        let lazyCache = this.documentManager.lazyLibTrees.get(uri);
        if (!lazyCache && this.sharedContext) {
          try {
            const fsPath = uri.startsWith("file://") ? uri.substring(7) : uri;
            let text = this.sharedContext.fs?.read(fsPath);
            if (!text && uri.startsWith("modelica:")) {
              const stripped = uri.replace(/^modelica:\/?\/?/, "/");
              text = this.sharedContext.fs?.read(stripped.startsWith("/") ? stripped : "/" + stripped);
            }
            if (text) {
              const tree = this.sharedContext.parse(
                uri.endsWith(".sysml") || uri.endsWith(".sysml2") ? ".sysml" : ".mo",
                text,
              );
              lazyCache = { tree, text };
              this.documentManager.lazyLibTrees.set(uri, lazyCache);
              if (this.documentManager.lazyLibTrees.size > 50) {
                const oldest = this.documentManager.lazyLibTrees.keys().next().value;
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
          } catch {
            // ignore
          }
        }
        if (lazyCache) return lazyCache.text.substring(startByte, endByte);
        return null;
      },
      getNode: (startByte: number, endByte: number, entry?: any): any | null => {
        if (!entry || !entry.resourceId) return null;
        const uri = entry.resourceId;
        const docTree = this.documentManager.documentTrees.get(uri);
        if (docTree && docTree.tree) {
          let n = docTree.tree.rootNode.descendantForIndex(startByte, Math.max(startByte, endByte - 1));
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

        let lazyCache = this.documentManager.lazyLibTrees.get(uri);
        if (!lazyCache && this.sharedContext) {
          try {
            const fsPath = uri.startsWith("file://") ? uri.substring(7) : uri;
            let text = this.sharedContext.fs.read(fsPath);
            if (!text && uri.startsWith("modelica:")) {
              const stripped = uri.replace(/^modelica:\/?\/?/, "/");
              text = this.sharedContext.fs.read(stripped.startsWith("/") ? stripped : "/" + stripped);
            }
            if (text) {
              const tree = this.sharedContext.parse(
                uri.endsWith(".sysml") || uri.endsWith(".sysml2") ? ".sysml" : ".mo",
                text,
              );
              lazyCache = { tree, text };
              this.documentManager.lazyLibTrees.set(uri, lazyCache);
              if (this.documentManager.lazyLibTrees.size > 50) {
                const oldest = this.documentManager.lazyLibTrees.keys().next().value;
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
            } else {
              this.connection.console.error(`[cstTreeWrapper] failed to read fsPath: ${fsPath}`);
            }
          } catch (e) {
            this.connection.console.error(`[cstTreeWrapper] exception parsing ${uri}: ${e}`);
          }
        }
        if (lazyCache) {
          let n = lazyCache.tree.rootNode.descendantForIndex(startByte, Math.max(startByte, endByte - 1));
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
              `[cstTreeWrapper] descendantForIndex returned null for ${uri} [${startByte}-${endByte}]`,
            );
          return n;
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
        tokensData.push({
          line: node.startPosition.row,
          startCol: node.startPosition.column,
          endCol: node.endPosition.column,
          nodeId: node.id,
        });
        nodes.push(node);
      } else {
        for (let i = 0; i < node.childCount; i++) {
          const child = node.child(i);
          if (child) walk(child);
        }
      }
    };

    walk(cached.tree.rootNode);
    const totalLines = cached.text.split("\n").length;
    cached.lineIndex = new LineIndex(totalLines, tokensData);
    cached.tokens = nodes;

    return { lineIndex: cached.lineIndex, tokens: cached.tokens };
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
        const origin = (globalThis as unknown as { location?: { origin?: string } }).location?.origin;
        if (origin && (origin.startsWith("http://") || origin.startsWith("https://"))) {
          serverDistBase = `${origin}/static/devextensions/server/dist`;
          this.connection.console.info(`[wasm-parser] Using fallback serverDistBase: ${serverDistBase}`);
        }
      }

      // Set this EARLY so that occt-import-js has the right path during early validation pass
      this.workspaceManager.stepWorkspaceIndex.serverDistBase = serverDistBase;
      (globalThis as any).serverDistBase = serverDistBase;

      this.connection.sendNotification("modelscript/status", {
        state: "loading",
        message: "Initializing this.parser...",
      });

      // Load languages from languages-manifest.json if present
      let manifest: {
        id: string;
        wasm?: string;
        displayName?: string;
        fileExtensions?: string[];
        syntaxNames?: string[];
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
          { id: "sysml2", wasm: "sysml2.wasm", displayName: "SysML v2", fileExtensions: [".sysml", ".sysml2"] },
          { id: "step", wasm: "step.wasm", displayName: "Step", fileExtensions: [".step"] },
          { id: "owl2", wasm: "owl2.wasm", displayName: "Owl2", fileExtensions: [".owl2"] },
          { id: "csv", wasm: "csv.wasm", displayName: "Csv", fileExtensions: [".csv"] },
          { id: "scad", wasm: "scad.wasm", displayName: "Scad", fileExtensions: [".scad"] },
        ];
      }

      await Promise.all(
        manifest.map(async (entry) => {
          if (!entry.wasm) return;
          const wasmUrl = `${serverDistBase}/${entry.wasm}`;
          const legacyWasmUrl = `${serverDistBase}/tree-sitter-${entry.id}.wasm`;
          const syntaxNames = entry.syntaxNames || (globalThis as any)[`${entry.id}SyntaxNames`];

          try {
            const result = await createWasmParser(wasmUrl, { syntaxNames }).catch(() =>
              createWasmParser(legacyWasmUrl, { syntaxNames }),
            );

            if (result) {
              this.registerParser(entry.id, result.parser, result.facade);
              if (this.workspaceManager?.unifiedWorkspace && result.parser) {
                for (const ext of entry.fileExtensions || [`.${entry.id}`]) {
                  this.workspaceManager.unifiedWorkspace.registerParser(ext, result.parser);
                }
              }
              if (entry.id === "modelica") {
                this.parser = result.parser;
                (globalThis as any).modelicaParser = this.parser;
                this.facade = result.facade;
                this.parserReady = true;
              } else if (entry.id === "sysml2") {
                this.sysml2Parser = result.parser;
                this.sysml2Facade = result.facade;
                this.sysml2ParserReady = true;
                this.registerParser("sysml", result.parser, result.facade);
                const existingSysml = globalLanguageRegistry.getPluginById("sysml");
                if (!existingSysml) {
                  globalLanguageRegistry.register({
                    id: "sysml",
                    name: "SysML v2",
                    extensions: [".sysml", ".sysml2"],
                    parser: result.parser,
                    facade: result.facade,
                    disposables: [],
                  });
                } else {
                  existingSysml.parser = result.parser;
                  existingSysml.facade = result.facade;
                }
              } else if (entry.id === "step") {
                this.stepParser = result.parser;
                this.stepFacade = result.facade;
                this.stepParserReady = true;
              } else if (entry.id === "owl2") {
                this.owl2Parser = result.parser;
                this.owl2Facade = result.facade;
                this.owl2ParserReady = true;
              } else if (entry.id === "csv") {
                this.csvParser = result.parser;
                this.csvFacade = result.facade;
                this.csvParserReady = true;
              }

              // Register in globalLanguageRegistry as well
              const existing = globalLanguageRegistry.getPluginById(entry.id);
              if (!existing) {
                globalLanguageRegistry.register({
                  id: entry.id,
                  name: entry.displayName || entry.id,
                  extensions: entry.fileExtensions || [`.${entry.id}`],
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
        }),
      );

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
          if (ext === ".sysml" || ext === ".sysml2") return (this.sysml2Parser as any)?.parse(input, ...rest);
          return (this.parser as any)?.parse(input, ...rest);
        },
        flattenArena: (name: string, classId?: any, uri?: string) => {
          const engine = this.workspaceManager.globalModelicaQueryEngine;
          if (!engine) return null;
          let targetId = classId;
          if (targetId === undefined) {
            const candidates = (engine as any).index?.byName.get(name);
            if (candidates && candidates.length > 0) {
              targetId = candidates[0];
            }
          }
          if (targetId === undefined) return null;
          const queryDB = engine.toQueryDB();
          const flattenerClass = (globalThis as any).ArenaQueryFlattener;
          if (!flattenerClass) return null;
          const flattener = new flattenerClass(queryDB);
          return flattener.flatten(targetId, uri);
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
      this.connection.sendNotification("modelscript/status", {
        state: "loading",
        message: "ModelScript (loading libraries...)",
      });

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
            this.workspaceManager.globalWorkspaceIndex?.toUnified?.() ??
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
        globalWorkspaceIndex: this.workspaceManager.globalWorkspaceIndex,
        sysml2WorkspaceIndex: this.workspaceManager.sysml2WorkspaceIndex,
        documentTrees: this.documentManager.documentTrees as any,
        sysml2Parser: this.sysml2Parser as any,
        cacheStore,
        registryUrl: typeof registryUrl !== "undefined" ? registryUrl : undefined,
        federatedEndpoints,
      };
      savedLoaderCtx = loaderCtx;

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
      (globalThis as any).diagramCache?.clear();

      for (const doc of this.documents.all()) {
        try {
          await (globalThis as any).validateTextDocument?.(doc);
        } catch (err) {
          this.connection.console.warn(`[lsp] Failed to validate open document on init: ${err}`);
        }
      }

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

  /**
   * Backward-compatible alias for third-party consumers.
   * @deprecated Use `initWasmParsers` instead.
   */
  public async initTreeSitter(
    extensionUri: string,
    validationService?: any,
    projectDependencies?: { name: string; version: string }[],
    useLocalMsl = false,
    onParsersReady?: () => void,
  ): Promise<void> {
    return this.initWasmParsers(extensionUri, validationService, projectDependencies, useLocalMsl, onParsersReady);
  }

  sendProjectTreeChanged() {
    if (projectTreeChangedTimer) {
      // Inside cooldown — mark pending so we fire once when the timer expires.
      projectTreeChangedPending = true;
      return;
    }
    // Fire immediately (leading edge)
    this.connection.sendNotification("modelscript/projectTreeChanged");
    projectTreeChangedTimer = setTimeout(() => {
      projectTreeChangedTimer = null;
      if (projectTreeChangedPending) {
        projectTreeChangedPending = false;
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
        if (
          entry &&
          entry.resourceId === currentUri &&
          typeof entry.startByte === "number" &&
          typeof entry.endByte === "number"
        ) {
          const bridge = documentLSPBridges.get(currentUri);
          if (bridge) {
            const start = bridge["positions"].offsetToPosition(entry.startByte);
            const end = bridge["positions"].offsetToPosition(entry.endByte);
            return { start, end };
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
    const isSysmlUri = uri.endsWith(".sysml") || uri.endsWith(".sysml2");
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
            savedLoaderCtx?.cacheStore,
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
            this.sharedContext.setWorkspaceIndex(this.workspaceManager.globalWorkspaceIndex);
          } else {
            this.sharedContext.workspaceIndex = this.workspaceManager.globalWorkspaceIndex;
          }
        }
      }
    }
    const db = engine!.toQueryDB();

    if (className) {
      const parts = className.split(".");
      const entries = unifiedIndex.byName.get(parts[parts.length - 1]);
      const entryId = entries?.find((id) => {
        const e = unifiedIndex.symbols.get(id);
        return e && getCompositeName(e, unifiedIndex) === className;
      });
      if (entryId !== undefined) {
        return new ModelicaClassInstance(entryId, db);
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
        return new ModelicaClassInstance(id, db);
      }
    }

    return null;
  }
}
