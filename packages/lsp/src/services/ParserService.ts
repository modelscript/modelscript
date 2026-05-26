/* eslint-disable @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any, @typescript-eslint/no-non-null-assertion */

import { Connection } from "vscode-languageserver";
import { DocumentManager } from "./DocumentManager";
import { WorkspaceManager } from "./WorkspaceManager";

export class ParserService {
  public parserReady = false;
  public parser: any = null;
  public sysml2ParserReady = false;
  public sysml2Parser: any = null;
  public stepParserReady = false;
  public stepParser: any = null;

  constructor(
    private connection: Connection,
    private documentManager: DocumentManager,
    private workspaceManager: WorkspaceManager,
  ) {}

  getSharedCstTreeWrapper() {
    return {
      getText(startByte: number, endByte: number, entry?: any): string | null {
        if (!entry || !entry.resourceId) return null;
        const uri = entry.resourceId;
        const docTree = this.documentManager.documentTrees.get(uri);
        if (docTree && docTree.tree && docTree.text) return docTree.text.substring(startByte, endByte);

        let lazyCache = this.documentManager.lazyLibTrees.get(uri);
        if (!lazyCache && this.sharedContext) {
          try {
            let fsPath = uri.startsWith("file://") ? uri.substring(7) : uri.replace(/^modelica:\/?\/?/, "/");
            if (!fsPath.startsWith("/")) fsPath = "/" + fsPath;
            const text = this.sharedContext.fs.read(fsPath);
            if (text) {
              const tree = this.sharedContext.parse(uri.endsWith(".sysml") ? ".sysml" : ".mo", text);
              lazyCache = { tree, text };
              this.documentManager.lazyLibTrees.set(uri, lazyCache);
            }
          } catch (e) {
            // ignore
          }
        }
        if (lazyCache) return lazyCache.text.substring(startByte, endByte);
        return null;
      },
      getNode(startByte: number, endByte: number, entry?: any): any | null {
        if (!entry || !entry.resourceId) return null;
        const uri = entry.resourceId;
        const docTree = this.documentManager.documentTrees.get(uri);
        if (docTree && docTree.tree) return docTree.tree.rootNode.descendantForIndex(startByte, endByte);

        let lazyCache = this.documentManager.lazyLibTrees.get(uri);
        if (!lazyCache && this.sharedContext) {
          try {
            let fsPath = uri.startsWith("file://") ? uri.substring(7) : uri.replace(/^modelica:\/?\/?/, "/");
            if (!fsPath.startsWith("/")) fsPath = "/" + fsPath;
            const text = this.sharedContext.fs.read(fsPath);
            if (text) {
              const tree = this.sharedContext.parse(uri.endsWith(".sysml") ? ".sysml" : ".mo", text);
              lazyCache = { tree, text };
              this.documentManager.lazyLibTrees.set(uri, lazyCache);
            } else {
              this.connection.console.error(`[cstTreeWrapper] failed to read fsPath: ${fsPath}`);
            }
          } catch (e) {
            this.connection.console.error(`[cstTreeWrapper] exception parsing ${uri}: ${e}`);
          }
        }
        if (lazyCache) {
          const n = lazyCache.tree.rootNode.descendantForIndex(startByte, Math.max(startByte, endByte - 1));
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
      cached.tree.edit(edit as never);
      const tEdit2 = performance.now();

      // Attempt to set timeout to 100ms if supported
      if (typeof (this.parser as any).setTimeoutMicros === "function") {
        (this.parser as any).setTimeoutMicros(100000);
      }
      try {
        tree = this.parser.parse(newText, cached.tree);
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
    return this.documentManager.updateDocumentTree(uri, text);
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

  async initTreeSitter(extensionUri: string): Promise<void> {
    try {
      // Construct absolute URLs for WASM files using the extension URI.
      // The extensionUri may be an HTTP URL or a VS Code internal URI scheme.
      // For static deployments, we need to ensure it resolves to an HTTP URL.
      let serverDistBase = `${extensionUri}/server/dist`;
      this.connection.console.info(`[tree-sitter] extensionUri: ${extensionUri}`);
      this.connection.console.info(`[tree-sitter] serverDistBase: ${serverDistBase}`);

      // If the URI isn't HTTP(S), try to construct an HTTP URL from the worker's location
      if (!serverDistBase.startsWith("http://") && !serverDistBase.startsWith("https://")) {
        // Fallback: use the worker's origin with the known static path
        const origin = (globalThis as unknown as { location?: { origin?: string } }).location?.origin;
        if (origin && (origin.startsWith("http://") || origin.startsWith("https://"))) {
          serverDistBase = `${origin}/static/devextensions/server/dist`;
          this.connection.console.info(`[tree-sitter] Using fallback serverDistBase: ${serverDistBase}`);
        }
      }

      // Set this EARLY so that occt-import-js has the right path during early validation pass
      this.workspaceManager.stepWorkspaceIndex.serverDistBase = serverDistBase;

      this.connection.sendNotification("modelscript/status", {
        state: "loading",
        message: "Initializing this.parser...",
      });

      await Parser.init({
        locateFile: (file: string) => {
          return `${serverDistBase}/${file}`;
        },
      });

      const Modelica = await Language.load(`${serverDistBase}/tree-sitter-modelica.wasm`);
      this.parser = new Parser();
      this.parser.setLanguage(Modelica);
      Context.registerParser(".mo", this.parser);
      Context.registerParser(".mos", this.parser);
      this.parserReady = true;
      this.connection.console.info("Tree-sitter Modelica this.parser initialized");

      // === EARLY VALIDATION PASS ===
      // Validate open documents NOW — before any library loading.
      // This gives users instant syntax error feedback (~1s after page load)
      // instead of waiting 10-30s for MSL/SysML2 decompression.
      this.connection.console.info(
        `[lsp] Parser ready. Early-validating ${this.documents.all().length} open documents for syntax errors.`,
      );
      for (const doc of this.documents.all()) {
        await validateTextDocument(doc);
      }
      this.connection.sendNotification("modelscript/status", {
        state: "loading",
        message: "ModelScript (loading libraries...)",
      });

      // Initialize SysML2 this.parser (non-blocking — WASM load is fast)
      try {
        const SysML2 = await Language.load(`${serverDistBase}/tree-sitter-sysml2.wasm`);
        this.sysml2Parser = new Parser();
        this.sysml2Parser.setLanguage(SysML2);
        Context.registerParser(".sysml", this.sysml2Parser as any);
        this.sysml2ParserReady = true;
        this.connection.console.info("Tree-sitter SysML2 this.parser initialized");
      } catch (e) {
        this.connection.console.warn(`[tree-sitter] Failed to load SysML2 language: ${e}`);
      }

      // Initialize STEP this.parser
      try {
        const StepLang = await Language.load(`${serverDistBase}/tree-sitter-step.wasm`);
        stepParser = new Parser();
        stepParser.setLanguage(StepLang);
        Context.registerParser(".step", stepParser as any);
        Context.registerParser(".stp", stepParser as any);
        Context.registerParser(".p21", stepParser as any);
        stepParserReady = true;
        this.connection.console.info("Tree-sitter STEP this.parser initialized");
      } catch (e) {
        this.connection.console.warn(`[tree-sitter] Failed to load STEP language: ${e}`);
      }

      // Initialize OWL2 this.parser
      try {
        const Owl2Lang = await Language.load(`${serverDistBase}/tree-sitter-owl2.wasm`);
        owl2Parser = new Parser();
        owl2Parser.setLanguage(Owl2Lang);
        Context.registerParser(".owl", owl2Parser as any);
        owl2ParserReady = true;
        this.connection.console.info("Tree-sitter OWL2 this.parser initialized");
      } catch (e) {
        this.connection.console.warn(`[tree-sitter] Failed to load OWL2 language: ${e}`);
      }

      // Initialize CSV this.parser
      try {
        const CsvLang = await Language.load(`${serverDistBase}/tree-sitter-csv.wasm`);
        csvParser = new Parser();
        csvParser.setLanguage(CsvLang);
        Context.registerParser(".csv", csvParser as any);
        csvParserReady = true;
        this.connection.console.info("Tree-sitter CSV this.parser initialized");
      } catch (e) {
        this.connection.console.warn(`[tree-sitter] Failed to load CSV language: ${e}`);
      }

      // Load the Modelica Standard Library from the bundled zip
      // Initialize FederatedCacheStore with local IndexedDB and (currently empty) federated endpoints
      const localStore = new IndexedDBQueryCacheStore("modelscript-lsp-cache");
      const federatedEndpoints: string[] = []; // Endpoints added later in loadRegistryPackages
      const cacheStore = new FederatedQueryCacheStore(localStore, {
        getEndpoints: () => federatedEndpoints,
      });
      const MAX_MEMOS = 2_000_000; // Limit in-memory memos

      this.workspaceManager.globalModelicaQueryEngine = createModelicaQueryEngine(
        this.workspaceManager.globalWorkspaceIndex.toUnified(),
        { getText: () => null, getNode: () => null },
        cacheStore,
        MAX_MEMOS,
      );
      this.sharedContext = new Context(
        sharedFs,
        this.workspaceManager.globalWorkspaceIndex,
        this.workspaceManager.globalModelicaQueryEngine,
      );
      this.workspaceManager.globalModelicaQueryEngine.updateTree({
        getText: (start: number, end: number, entry?: any) =>
          this.sharedContext!.getTreeText(entry?.resourceId, start, end),
        getNode: (start: number, end: number, entry?: any) =>
          this.sharedContext!.getTreeNode(entry?.resourceId, start, end),
      });
      const loaderCtx: LoaderContext = {
        connectionState: connection,
        logger: {
          log: (msg) => this.connection.console.info(msg),
          warn: (msg) => this.connection.console.warn(msg),
          error: (msg, e) => this.connection.console.error(`${msg} ${e}`),
        },
        sharedFs,
        sharedContext: this.sharedContext,
        globalWorkspaceIndex: this.workspaceManager.globalWorkspaceIndex,
        sysml2WorkspaceIndex: this.workspaceManager.sysml2WorkspaceIndex,
        documentTrees: this.documentManager.documentTrees as any,
        sysml2Parser: this.sysml2Parser as any,
        cacheStore,
        registryUrl,
        federatedEndpoints,
      };
      savedLoaderCtx = loaderCtx;
      await loadMSL(serverDistBase, loaderCtx);

      // Re-validate after MSL is loaded for semantic diagnostics
      this.connection.console.info(
        `[lsp] MSL loaded. Re-validating ${this.documents.all().length} open this.documents.`,
      );
      for (const doc of this.documents.all()) {
        await validateTextDocument(doc);
      }

      // Background-index remaining MSL files progressively, then re-validate
      // with the full unified index for cross-file resolution.
      const pending = this.workspaceManager.globalWorkspaceIndex.pendingFileCount;
      if (pending > 0) {
        this.connection.console.info(`[lsp] Background-indexing ${pending} remaining files...`);

        const workerUrl = `${serverDistBase}/indexerWorker.js`;

        this.workspaceManager.globalWorkspaceIndex
          .indexRemainingInWorker(
            workerUrl,
            serverDistBase,
            (uri: string) => {
              try {
                let fsPath = uri.startsWith("file://") ? uri.substring(7) : uri.replace(/^modelica:\/?\/?/, "/");
                if (!fsPath.startsWith("/")) fsPath = "/" + fsPath;
                return sharedFs.read(fsPath);
              } catch {
                return null;
              }
            },
            (indexed, total) => {
              if (indexed % 100 === 0) {
                this.connection.console.info(`[lsp] Background indexing: ${indexed}/${total}`);
                this.connection.sendNotification("modelscript/status", {
                  state: "loading",
                  message: `Indexing MSL classes (${indexed}/${total})...`,
                });
              }
            },
            () =>
              activeValidationPromises.size > 0 ||
              activeSemanticTimers.size > 0 ||
              activeValidationTimers.size > 0 ||
              revalidationTimer !== null,
          )
          .then(async () => {
            mslStdlibReady = true;
            clearIconCache(); // Icons rendered before MSL was ready may be incomplete
            diagramCache.clear(); // Force diagram rebuild with full MSL types
            this.connection.console.info(`[lsp] Background indexing complete. Re-validating this.documents.`);
            // Re-validate with full index for cross-file resolution
            for (const doc of this.documents.all()) {
              await validateTextDocument(doc);
            }
            this.connection.sendNotification("modelscript/status", { state: "ready", message: getReadyMessage() });
          });
      } else {
        // No MSL files to index (or all already indexed) — mark ready immediately
        mslStdlibReady = true;
        clearIconCache();
        diagramCache.clear();
        this.connection.sendNotification("modelscript/status", { state: "ready", message: getReadyMessage() });
      }

      // Load the SysML v2 Standard Library in the BACKGROUND — the 61MB zip
      // decompression is very heavy and must not block Modelica diagnostics.
      if (this.sysml2ParserReady) {
        loadSysML2StandardLibrary(serverDistBase, loaderCtx)
          .then(() => {
            sysml2StdlibReady = true;
            this.connection.console.info("[lsp] SysML2 stdlib loaded in background.");
            this.connection.sendNotification("modelscript/status", { state: "ready", message: getReadyMessage() });
          })
          .catch((e) => {
            this.connection.console.warn(`[lsp] SysML2 stdlib background load failed: ${e}`);
            this.connection.sendNotification("modelscript/status", { state: "ready", message: getReadyMessage() });
          });
      }
    } catch (e: any) {
      this.connection.console.error(`Failed to initialize tree-sitter: ${e}\n${e.stack}`);
      this.parserReady = false;
      this.connection.sendNotification("modelscript/status", {
        state: "error",
        message: "Parser initialization failed",
      });
    }
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
    let engine = uri.endsWith(".sysml")
      ? this.workspaceManager.globalSysML2QueryEngine
      : this.workspaceManager.globalModelicaQueryEngine;
    if (!engine) {
      if (uri.endsWith(".sysml")) {
        engine = createSysML2QueryEngine(unifiedIndex) as any;
        this.workspaceManager.globalSysML2QueryEngine = engine;
      } else {
        engine = createModelicaQueryEngine(
          unifiedIndex,
          getSharedCstTreeWrapper(),
          savedLoaderCtx?.cacheStore,
          100_000,
        ) as any;
        this.workspaceManager.globalModelicaQueryEngine = engine;
        if (this.sharedContext) {
          this.sharedContext.setQueryEngine(this.workspaceManager.globalModelicaQueryEngine!);
          this.sharedContext.setWorkspaceIndex(this.workspaceManager.globalWorkspaceIndex);
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
