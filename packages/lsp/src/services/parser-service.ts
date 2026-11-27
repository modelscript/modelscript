// SPDX-License-Identifier: AGPL-3.0-or-later

// ts-check

import { createWasmParser, registerPreloadedWasmParser } from "@modelscript/dsl/bindings";
import { getStdlibsForLanguage } from "@modelscript/exchange/catalog";
import { ArenaQueryFlattener, type FlattenOptions } from "@modelscript/modelica/flattener";
import { ensureBuiltInPscadLibraryRegistered } from "@modelscript/pscad";
import {
  globalLibraryRegistry,
  type CSTTree,
  type QueryEngine,
  type SymbolEntry,
  type SymbolIndex,
  type WorkspaceParser,
} from "@modelscript/runtime";
import {
  FederatedQueryCacheStore,
  IndexedDBQueryCacheStore,
  MemoryQueryCacheStore,
} from "@modelscript/runtime/wasm_cache_store.js";
import { Connection, TextDocuments } from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";
import {
  globalLanguageRegistry,
  type WasmFacadeInstance,
  type WasmParserInstance,
} from "../registry/LanguageRegistry.js";
import {
  computeTreeEdit,
  isLargeXmlForWasm,
  isWasmTreeActiveInFacade,
  parseXmlFallbackTree,
  type CstNodeLike,
  type CstTreeLike,
  type XmlFallbackTree,
} from "../utils/ast-utils.js";
import type { Tree as CstTree, Parser as FacadeParser, SyntaxNode } from "../utils/cst-facade.js";
import { mountedLibraryMetadata, normalizeLibraryName } from "../utils/hierarchy-utils.js";
import { LineIndex, TokenData } from "../utils/line-index.js";
import { BrowserFileSystem } from "../vfs/browser-file-system.js";
import { findCuratedPackageFallback } from "../vfs/curated-package-fallbacks.js";
import {
  loadDependencyFromRegistry,
  LoaderContext,
  loadMSL,
  loadSysML2StandardLibrary,
  mountCuratedFallbackPackage,
  mountPolyglotLibrary,
  resolveWorkspaceLibraryVersions,
} from "../vfs/library-loader.js";
import {
  DocumentManager,
  type CachedCstTree,
  type DocumentTreeMap,
  type LazyTreeMap,
  type SharedCompilerContext,
} from "./document-manager.js";
import { WorkspaceManager } from "./workspace-manager.js";

/** Structural WASM parser handle managed by `ParserService`. */
export interface ParserServiceParser {
  parse(
    input: string,
    oldTree?: unknown,
    startIndex?: number,
    oldEndIndex?: number,
    newEndIndex?: number,
    uri?: string,
  ): CachedCstTree | null;
  setLanguage?(language: unknown): void;
  getLanguage?(): unknown;
  setTimeoutMicros?(micros: number): void;
}

/** Structural WASM LSP facade handle managed by `ParserService`. */
export type ParserServiceFacade = WasmFacadeInstance & {
  removeDocument?(uri: string): void;
  getDocumentRoot?(uriOrFileId?: string | number): number;
};

interface ValidationServiceRefLike {
  declaredDependencies: { name: string; version: string }[];
  dependenciesReady?: boolean | undefined;
  markDependencyLoaded(name: string, version: string): void;
  validateTextDocument?(doc: TextDocument): Promise<void>;
}

interface ParserServiceGlobalHooks {
  serverDistBase?: string | undefined;
  savedLoaderCtx?: LoaderContext | undefined;
  sharedFs?: BrowserFileSystem | undefined;
  sharedContext?: SharedCompilerContext | null | undefined;
  registryUrl?: string | undefined;
  clearIconCache?: (() => void) | undefined;
  clearDiagramCache?: (() => void) | undefined;
  diagramCache?: { clear(): void } | undefined;
  validateTextDocument?: ((doc: TextDocument) => Promise<void>) | undefined;
  getReadyMessage?: (() => string) | undefined;
  createModelicaQueryEngine?:
    ((index: SymbolIndex, tree: CSTTree, cacheStore?: unknown, maxMemos?: number) => QueryEngine) | undefined;
  create_modelica_query_engine?:
    ((index: SymbolIndex, tree: CSTTree, cacheStore?: unknown, maxMemos?: number) => QueryEngine) | undefined;
  documentLSPBridges?:
    | Map<
        string,
        {
          positions: {
            rangeFromOffsets(
              start: number,
              end: number,
            ): { start: { line: number; character: number }; end: { line: number; character: number } };
          };
        }
      >
    | undefined;
  [key: string]: unknown;
}

interface ParserEntryRecord {
  parser: ParserServiceParser | null;
  facade: ParserServiceFacade | null;
  ready: boolean;
}

function getGlobalHooks(): ParserServiceGlobalHooks {
  return globalThis as unknown as ParserServiceGlobalHooks;
}

export class ParserService {
  private static readonly MAX_LOADED_PARSERS_BROWSER = 5;
  private parserEntries = new Map<string, ParserEntryRecord>();
  private parserLru: string[] = [];
  public sharedContext: SharedCompilerContext | null = null;

  private registeringLangs = new Set<string>();

  private touchParserLru(langId: string): void {
    const norm = langId.toLowerCase();
    const idx = this.parserLru.indexOf(norm);
    if (idx !== -1) {
      this.parserLru.splice(idx, 1);
    }
    this.parserLru.push(norm);
  }

  private evictUnusedParsersIfNeeded(): void {
    if (!this.lazyLoadParsers) return;
    const isNode = typeof process !== "undefined" && Boolean(process.versions?.node);
    if (isNode) return;
    const maxLoaded = ParserService.MAX_LOADED_PARSERS_BROWSER;
    if (this.parserLru.length <= maxLoaded) return;

    const activeLangs = new Set<string>();
    for (const doc of this.documents.all()) {
      activeLangs.add(this.resolveNormalizedLanguageId(doc.languageId || doc.uri));
    }

    for (let i = 0; i < this.parserLru.length && this.parserLru.length > maxLoaded;) {
      const candidate = this.parserLru[i]!;
      if (activeLangs.has(candidate)) {
        i++;
        continue;
      }
      this.parserLru.splice(i, 1);
      this.parserEntries.delete(candidate);
      this.loadingParserPromises.delete(candidate);
      const plugin = globalLanguageRegistry.getPluginById(candidate);
      if (plugin) {
        try {
          plugin.parser = null;
          plugin.facade = null;
        } catch {
          // Plugin object may be frozen or expose read-only parser/facade properties.
        }
      }
      if (candidate === "sysml2" || candidate === "sysml") {
        const alt = candidate === "sysml2" ? "sysml" : "sysml2";
        this.parserEntries.delete(alt);
        this.loadingParserPromises.delete(alt);
      }
    }
  }

  public registerParser(
    langId: string,
    parser: ParserServiceParser | WasmParserInstance | null | undefined,
    facade: ParserServiceFacade | null | undefined = null,
  ): void {
    const norm = langId.toLowerCase();
    const prev = this.parserEntries.get(norm);
    const resolvedParser = (parser ?? null) as ParserServiceParser | null;
    const resolvedFacade = facade ?? prev?.facade ?? null;
    this.parserEntries.set(norm, { parser: resolvedParser, facade: resolvedFacade, ready: !!resolvedParser });
    if (resolvedParser) {
      this.touchParserLru(norm);
      this.evictUnusedParsersIfNeeded();
    }
    if (this.registeringLangs.has(norm)) return;
    this.registeringLangs.add(norm);
    try {
      const plugin = globalLanguageRegistry.getPluginById(norm);
      if (plugin) {
        const pDesc = Object.getOwnPropertyDescriptor(plugin, "parser");
        if (!pDesc || pDesc.writable || typeof pDesc.set === "function") {
          try {
            plugin.parser = resolvedParser as unknown as WasmParserInstance | null;
          } catch {
            // Plugin object may be frozen or define a throwing setter for parser.
          }
        }
        if (resolvedFacade !== null) {
          const fDesc = Object.getOwnPropertyDescriptor(plugin, "facade");
          if (!fDesc || fDesc.writable || typeof fDesc.set === "function") {
            try {
              plugin.facade = resolvedFacade;
            } catch {
              // Plugin object may be frozen or define a throwing setter for facade.
            }
          }
        }
      }
      const alt = norm === "sysml" ? "sysml2" : norm === "sysml2" ? "sysml" : null;
      if (alt) {
        this.parserEntries.set(alt, { parser: resolvedParser, facade: resolvedFacade, ready: !!resolvedParser });
        const altPlugin = globalLanguageRegistry.getPluginById(alt);
        if (altPlugin) {
          const pDesc = Object.getOwnPropertyDescriptor(altPlugin, "parser");
          if (!pDesc || pDesc.writable || typeof pDesc.set === "function") {
            try {
              altPlugin.parser = resolvedParser as unknown as WasmParserInstance | null;
            } catch {
              // Alias plugin object may be frozen or define a throwing setter for parser.
            }
          }
          if (resolvedFacade !== null) {
            const fDesc = Object.getOwnPropertyDescriptor(altPlugin, "facade");
            if (!fDesc || fDesc.writable || typeof fDesc.set === "function") {
              try {
                altPlugin.facade = resolvedFacade;
              } catch {
                // Alias plugin object may be frozen or define a throwing setter for facade.
              }
            }
          }
        }
      }
      registerPreloadedWasmParser(
        norm,
        resolvedParser as unknown as Parameters<typeof registerPreloadedWasmParser>[1],
        resolvedFacade as unknown as Parameters<typeof registerPreloadedWasmParser>[2],
      );
      if (alt) {
        registerPreloadedWasmParser(
          alt,
          resolvedParser as unknown as Parameters<typeof registerPreloadedWasmParser>[1],
          resolvedFacade as unknown as Parameters<typeof registerPreloadedWasmParser>[2],
        );
      }
      const setGlobalPlain = (key: string, val: unknown) => {
        const desc = Object.getOwnPropertyDescriptor(globalThis, key);
        if (desc?.set || desc?.get) return;
        getGlobalHooks()[key] = val;
      };
      if (norm === "modelica") {
        setGlobalPlain("parser", resolvedParser);
        setGlobalPlain("modelicaParser", resolvedParser);
        setGlobalPlain("parserReady", !!resolvedParser);
      } else if (norm === "sysml2" || norm === "sysml") {
        setGlobalPlain("sysml2Parser", resolvedParser);
        setGlobalPlain("sysml2ParserReady", !!resolvedParser);
      } else if (norm === "step") {
        setGlobalPlain("stepParser", resolvedParser);
        setGlobalPlain("stepParserReady", !!resolvedParser);
      } else if (norm === "owl2") {
        setGlobalPlain("owl2Parser", resolvedParser);
        setGlobalPlain("owl2ParserReady", !!resolvedParser);
      } else if (norm === "csv") {
        setGlobalPlain("csvParser", resolvedParser);
        setGlobalPlain("csvParserReady", !!resolvedParser);
      } else if (norm === "psse") {
        setGlobalPlain("psseParser", resolvedParser);
        setGlobalPlain("psseParserReady", !!resolvedParser);
      }
    } finally {
      this.registeringLangs.delete(norm);
    }
  }

  private inGetParser = false;
  private inGetFacade = false;

  public getParser(langId: string): ParserServiceParser | null {
    const norm = langId.toLowerCase();
    const entry = this.parserEntries.get(norm);
    if (entry?.parser) return entry.parser;
    if (this.inGetParser) return null;
    this.inGetParser = true;
    try {
      const p = globalLanguageRegistry.getPluginById(norm)?.parser;
      if (p) return p as unknown as ParserServiceParser;
      const alternate = norm === "sysml" ? "sysml2" : norm === "sysml2" ? "sysml" : null;
      if (alternate) {
        return (
          this.parserEntries.get(alternate)?.parser ??
          (globalLanguageRegistry.getPluginById(alternate)?.parser as unknown as ParserServiceParser | undefined) ??
          null
        );
      }
      return null;
    } finally {
      this.inGetParser = false;
    }
  }

  public getFacade(langId: string): ParserServiceFacade | null {
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

  public getParserForUri(uri: string): ParserServiceParser | null {
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
  get parser(): ParserServiceParser | null {
    return this.getParser("modelica");
  }
  set parser(val: ParserServiceParser | null | undefined) {
    this.registerParser("modelica", val, this.facade);
  }
  /** @deprecated Use `getFacade("modelica")` instead. */
  get facade(): ParserServiceFacade | null {
    return this.getFacade("modelica");
  }
  set facade(val: ParserServiceFacade | null | undefined) {
    const p = this.parser;
    this.registerParser("modelica", p, val);
  }
  /** @deprecated Use `isParserReady("modelica")` instead. */
  get parserReady(): boolean {
    return this.isParserReady("modelica");
  }
  set parserReady(val: boolean) {
    const entry = this.parserEntries.get("modelica");
    if (entry) entry.ready = val;
    else this.registerParser("modelica", null, null);
  }

  /** @deprecated Use `getParser("sysml2")` instead. */
  get sysml2Parser(): ParserServiceParser | null {
    return this.getParser("sysml2");
  }
  set sysml2Parser(val: ParserServiceParser | null | undefined) {
    this.registerParser("sysml2", val, this.getFacade("sysml2"));
  }
  /** @deprecated Use `isParserReady("sysml2")` instead. */
  get sysml2ParserReady(): boolean {
    return this.isParserReady("sysml2");
  }
  set sysml2ParserReady(val: boolean) {
    const entry = this.parserEntries.get("sysml2");
    if (entry) entry.ready = val;
    else this.registerParser("sysml2", null, null);
  }

  /** @deprecated Use `getParser("step")` instead. */
  get stepParser(): ParserServiceParser | null {
    return this.getParser("step");
  }
  set stepParser(val: ParserServiceParser | null | undefined) {
    this.registerParser("step", val, this.stepFacade);
  }
  get stepFacade(): ParserServiceFacade | null {
    return this.getFacade("step");
  }
  set stepFacade(val: ParserServiceFacade | null | undefined) {
    const p = this.stepParser;
    this.registerParser("step", p, val);
  }
  get stepParserReady(): boolean {
    return this.isParserReady("step");
  }
  set stepParserReady(val: boolean) {
    const entry = this.parserEntries.get("step");
    if (entry) entry.ready = val;
    else this.registerParser("step", null, null);
  }

  get owl2Parser(): ParserServiceParser | null {
    return this.getParser("owl2");
  }
  set owl2Parser(val: ParserServiceParser | null | undefined) {
    this.registerParser("owl2", val, this.owl2Facade);
  }
  get owl2Facade(): ParserServiceFacade | null {
    return this.getFacade("owl2");
  }
  set owl2Facade(val: ParserServiceFacade | null | undefined) {
    const p = this.owl2Parser;
    this.registerParser("owl2", p, val);
  }
  get owl2ParserReady(): boolean {
    return this.isParserReady("owl2");
  }
  set owl2ParserReady(val: boolean) {
    const entry = this.parserEntries.get("owl2");
    if (entry) entry.ready = val;
    else this.registerParser("owl2", null, null);
  }

  get csvParser(): ParserServiceParser | null {
    return this.getParser("csv");
  }
  set csvParser(val: ParserServiceParser | null | undefined) {
    this.registerParser("csv", val, this.csvFacade);
  }
  get csvFacade(): ParserServiceFacade | null {
    return this.getFacade("csv");
  }
  set csvFacade(val: ParserServiceFacade | null | undefined) {
    const p = this.csvParser;
    this.registerParser("csv", p, val);
  }
  get csvParserReady(): boolean {
    return this.isParserReady("csv");
  }
  set csvParserReady(val: boolean) {
    const entry = this.parserEntries.get("csv");
    if (entry) entry.ready = val;
    else this.registerParser("csv", null, null);
  }

  get lasParser(): ParserServiceParser | null {
    return this.getParser("las");
  }
  set lasParser(val: ParserServiceParser | null | undefined) {
    this.registerParser("las", val, this.lasFacade);
  }
  get lasFacade(): ParserServiceFacade | null {
    return this.getFacade("las");
  }
  set lasFacade(val: ParserServiceFacade | null | undefined) {
    const p = this.lasParser;
    this.registerParser("las", p, val);
  }
  get lasParserReady(): boolean {
    return this.isParserReady("las");
  }
  set lasParserReady(val: boolean) {
    const entry = this.parserEntries.get("las");
    if (entry) entry.ready = val;
    else this.registerParser("las", null, null);
  }

  constructor(
    private connection: Connection,
    private documentManager: DocumentManager,
    private workspaceManager: WorkspaceManager,
    private documents: TextDocuments<TextDocument>,
  ) {}

  private getDocumentTreesMap(): DocumentTreeMap | undefined {
    return (
      this.documentManager?.documentTrees ??
      (this.workspaceManager as unknown as { documentManager?: DocumentManager })?.documentManager?.documentTrees ??
      (this.documentManager as unknown as { documentManager?: DocumentManager })?.documentManager?.documentTrees
    );
  }

  private getLazyLibTreesMap(): LazyTreeMap | undefined {
    return (
      this.documentManager?.lazyLibTrees ??
      (this.workspaceManager as unknown as { documentManager?: DocumentManager })?.documentManager?.lazyLibTrees ??
      (this.documentManager as unknown as { documentManager?: DocumentManager })?.documentManager?.lazyLibTrees
    );
  }

  getSharedCstTreeWrapper(): CSTTree {
    type DescendantLookupNode = (SyntaxNode | CstNodeLike) & {
      descendantForIndex?: (startIndex: number, endIndex?: number) => SyntaxNode | CstNodeLike | null;
    };
    const unwrapRootNode = (tree: unknown): DescendantLookupNode | null => {
      if (!tree || typeof tree !== "object") return null;
      const t = tree as {
        rootNode?: DescendantLookupNode | null;
        tree?: { rootNode?: DescendantLookupNode | null } | null;
      };
      return t.rootNode ?? t.tree?.rootNode ?? null;
    };

    return {
      getText: (startOffset: number, endOffset: number, entry?: SymbolEntry): string | null => {
        if (!entry || !entry.resourceId) return null;
        const uri = entry.resourceId;
        const normUri = uri.replace(/^([a-z0-9+-]+):\/{0,3}/i, "$1:///");
        const oneSlashUri = uri.replace(/^([a-z0-9+-]+):\/{0,3}/i, "$1:/");
        const docTrees = this.getDocumentTreesMap();
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

        const MAX_LAZY_LIB_TREES = 512;
        const lazyLibTrees = this.getLazyLibTreesMap();
        let lazyCache: { tree: CachedCstTree | CstTreeLike | XmlFallbackTree | null; text: string } | undefined =
          lazyLibTrees?.get(uri);
        if (lazyCache && lazyLibTrees) {
          lazyLibTrees.delete(uri);
          lazyLibTrees.set(uri, lazyCache);
        }
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
              if (lazyLibTrees) {
                lazyLibTrees.delete(uri);
                lazyLibTrees.set(uri, lazyCache);
                while (lazyLibTrees.size > MAX_LAZY_LIB_TREES) {
                  const oldest = lazyLibTrees.keys().next().value;
                  if (oldest === undefined) break;
                  const evicted = lazyLibTrees.get(oldest);
                  const evictedTree = evicted?.tree as CachedCstTree | undefined;
                  evictedTree?.facade?.removeDocument?.(oldest);
                  evictedTree?.delete?.();
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
      getNode: (startOffset: number, endOffset: number, entry?: SymbolEntry): unknown | null => {
        if (!entry || !entry.resourceId) return null;
        const uri = entry.resourceId;
        if (
          typeof uri === "string" &&
          (uri.startsWith("builtin://") || uri.startsWith("library-bundle:") || uri.startsWith("virtual:"))
        ) {
          return null;
        }
        const normUri = uri.replace(/^([a-z0-9+-]+):\/{0,3}/i, "$1:///");
        const oneSlashUri = uri.replace(/^([a-z0-9+-]+):\/{0,3}/i, "$1:/");
        const docTrees = this.getDocumentTreesMap();
        const docTree = docTrees?.get(uri) ?? docTrees?.get(normUri) ?? docTrees?.get(oneSlashUri);
        if (docTree && docTree.tree) {
          const root = unwrapRootNode(docTree.tree);
          if (root && typeof root.descendantForIndex === "function") {
            let n = root.descendantForIndex(startOffset, Math.max(startOffset, endOffset));
            if (n && n.type === "source_file" && typeof n.childCount === "number" && typeof n.child === "function") {
              for (let i = 0; i < n.childCount; i++) {
                const child = n.child(i);
                if (child && child.type === "class_definition") {
                  n = child;
                  break;
                }
              }
            }
            return n;
          }
          return root ?? null;
        }

        const MAX_LAZY_LIB_TREES = 512;
        const lazyLibTrees = this.getLazyLibTreesMap();
        let lazyCache: { tree: CachedCstTree | CstTreeLike | XmlFallbackTree | null; text: string } | undefined =
          lazyLibTrees?.get(uri);
        if (lazyCache && lazyCache.tree && lazyLibTrees) {
          lazyLibTrees.delete(uri);
          lazyLibTrees.set(uri, lazyCache);
        }
        if ((!lazyCache || !lazyCache.tree) && (this.sharedContext || docTree?.text)) {
          try {
            let text = lazyCache?.text ?? docTree?.text;
            const fsPath = uri.startsWith("file://") ? uri.substring(7) : uri;
            if (!text && this.sharedContext) {
              text = this.sharedContext.fs.read(fsPath);
            }
            if (!text && this.sharedContext && uri.startsWith("modelica:")) {
              const stripped = uri.replace(/^modelica:\/?\/?/, "/");
              text = this.sharedContext.fs.read(stripped.startsWith("/") ? stripped : "/" + stripped);
            }
            if (!text && this.sharedContext && uri.startsWith("sources/")) {
              text = this.sharedContext.fs.read(
                `/modelscript_registry/Modelica/4.1.0/${uri.substring("sources/".length)}`,
              );
            }
            if (text) {
              const uwExt = this.workspaceManager?.unifiedWorkspace as unknown as
                { extractExtension?: (u: string) => string } | undefined;
              const ext = uwExt?.extractExtension?.(uri) ?? (uri.includes(".") ? `.${uri.split(".").pop()}` : ".mo");
              const uriParser = this.getParserForUri(uri);
              const tree = uriParser ? uriParser.parse(text, null, 0, 0, 0, uri) : this.sharedContext?.parse(ext, text);
              if (tree) {
                lazyCache = { tree: tree as CachedCstTree, text };
                if (lazyLibTrees) {
                  lazyLibTrees.delete(uri);
                  lazyLibTrees.set(uri, lazyCache);
                  while (lazyLibTrees.size > MAX_LAZY_LIB_TREES) {
                    const oldest = lazyLibTrees.keys().next().value;
                    if (oldest === undefined) break;
                    const evicted = lazyLibTrees.get(oldest);
                    const evictedTree = evicted?.tree as CachedCstTree | undefined;
                    evictedTree?.facade?.removeDocument?.(oldest);
                    evictedTree?.delete?.();
                    lazyLibTrees.delete(oldest);
                  }
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
          const root = unwrapRootNode(lazyCache.tree);
          if (root && typeof root.descendantForIndex === "function") {
            let n = root.descendantForIndex(startOffset, Math.max(startOffset, endOffset));
            if (n && n.type === "source_file" && typeof n.childCount === "number" && typeof n.child === "function") {
              for (let i = 0; i < n.childCount; i++) {
                const child = n.child(i);
                if (child && child.type === "class_definition") {
                  n = child;
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

  updateDocumentTree(uri: string, newText: string): CstTree {
    const plugin = globalLanguageRegistry.getPluginForUri(uri);
    const parser = (plugin?.parser ??
      this.getParserForUri(uri) ??
      (this.isParserReady("modelica") ? this.parser : null)) as ParserServiceParser | null;
    const facade = (plugin?.facade ??
      (this.isParserReady("modelica") ? this.facade : null)) as ParserServiceFacade | null;

    const cached = this.documentManager.documentTrees.get(uri);
    const cachedIsFallback = Boolean((cached?.tree as XmlFallbackTree | undefined)?.__isXmlCstFallback);
    const isWasmTreeActive = isWasmTreeActiveInFacade(cached?.tree, facade, uri);
    const isCachedTreeActive = cachedIsFallback || isWasmTreeActive;

    if (cached && cached.text === newText && isCachedTreeActive && cached.tree) {
      return cached.tree;
    }

    if (isLargeXmlForWasm(uri, newText, plugin)) {
      const tree = parseXmlFallbackTree(newText);
      this.documentManager.documentTrees.set(uri, {
        text: newText,
        tree,
        classCache: cached?.classCache ?? new Map(),
        lineIndex: undefined,
        tokens: undefined,
      });
      return tree;
    }

    if (!parser) {
      throw new Error(`Parser not ready for URI: ${uri}`);
    }

    let tree: CstTree;
    const t0 = performance.now();

    if (cached && cached.tree && cached.text !== newText && isWasmTreeActive) {
      // Incremental reparse: edit the old tree and pass it to parse()
      const tEdit0 = performance.now();
      const edit = computeTreeEdit(cached.text, newText);
      const tEdit1 = performance.now();
      if (typeof cached.tree.edit === "function") {
        cached.tree.edit(edit as never);
      }
      const tEdit2 = performance.now();

      // Attempt to set timeout to 100ms if supported
      if (typeof parser.setTimeoutMicros === "function") {
        parser.setTimeoutMicros(100000);
      }
      try {
        tree = parser.parse(newText, cached.tree, edit.startIndex, edit.oldEndIndex, edit.newEndIndex, uri) as CstTree;
      } finally {
        if (typeof parser.setTimeoutMicros === "function") {
          parser.setTimeoutMicros(0);
        }
      }
      const tEdit3 = performance.now();

      if (tEdit3 - t0 > 100) {
        this.connection.console.warn(
          `[perf] updateDocumentTree (incremental) slow: total=${(tEdit3 - t0).toFixed(2)}ms, diff=${(tEdit1 - tEdit0).toFixed(2)}ms, edit=${(tEdit2 - tEdit1).toFixed(2)}ms, parse=${(tEdit3 - tEdit2).toFixed(2)}ms`,
        );
      }
    } else {
      // First parse — no old tree available
      const tParse0 = performance.now();
      void tParse0;
      // Attempt to set timeout to 1000ms if supported
      if (typeof parser.setTimeoutMicros === "function") {
        parser.setTimeoutMicros(1000000);
      }
      try {
        tree = parser.parse(newText, null, 0, 0, 0, uri) as CstTree;
      } finally {
        if (typeof parser.setTimeoutMicros === "function") {
          parser.setTimeoutMicros(0);
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

  getDocumentTree(uri: string): CstTree | null {
    const plugin = globalLanguageRegistry.getPluginForUri(uri);
    const parser = plugin?.parser ?? this.getParserForUri(uri) ?? (this.isParserReady("modelica") ? this.parser : null);
    const facade = plugin?.facade ?? (this.isParserReady("modelica") ? this.facade : null);

    const cached = this.documentManager.documentTrees.get(uri);
    const cachedIsFallback = Boolean((cached?.tree as XmlFallbackTree | undefined)?.__isXmlCstFallback);
    const isCachedTreeActive = cachedIsFallback || isWasmTreeActiveInFacade(cached?.tree, facade, uri);
    if (cached && isCachedTreeActive) return cached.tree;

    // No cached tree — parse from current document text
    const document = this.documents.get(uri);
    if (!document) return cached?.tree ?? null;

    const text = document.getText();
    if (!parser && !isLargeXmlForWasm(uri, text, plugin)) return null;
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
    return this.serverDistBase || getGlobalHooks().serverDistBase || "";
  }

  public getOrCreateLoaderContext(): LoaderContext {
    if (this.loaderCtx) {
      return this.loaderCtx;
    }
    const globalCtx = getGlobalHooks();
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
    const createdLoaderCtx: LoaderContext = {
      connectionState: this.connection,
      logger: {
        log: (msg) => this.connection.console.info(msg),
        warn: (msg) => this.connection.console.warn(msg),
        error: (msg, e) => this.connection.console.error(`${msg} ${e}`),
      },
      sharedFs: globalCtx.sharedFs ?? new BrowserFileSystem(),
      sharedContext: this.sharedContext as unknown as LoaderContext["sharedContext"],
      globalWorkspaceIndex: (this.workspaceManager.getWorkspaceIndex("modelica") ??
        null) as unknown as LoaderContext["globalWorkspaceIndex"],
      sysml2WorkspaceIndex: (this.workspaceManager.getWorkspaceIndex("sysml2") ??
        null) as unknown as LoaderContext["sysml2WorkspaceIndex"],
      documentTrees: this.documentManager.documentTrees as unknown as LoaderContext["documentTrees"],
      sysml2Parser: this.getParser("sysml2") as unknown as FacadeParser | null,
      cacheStore,
      registryUrl: typeof globalCtx.registryUrl !== "undefined" ? globalCtx.registryUrl : undefined,
      federatedEndpoints,
    };
    this.loaderCtx = createdLoaderCtx;
    globalCtx.savedLoaderCtx = createdLoaderCtx;
    return createdLoaderCtx;
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
    { id: "las", wasm: "las.wasm", displayName: "Las", fileExtensions: [".las"] },
    { id: "scad", wasm: "scad.wasm", displayName: "Scad", fileExtensions: [".scad"] },
  ];
  private lazyLoadParsers = false;
  private useLocalMsl = false;
  private validationServiceRef: ValidationServiceRefLike | null = null;
  private projectDependenciesRef: { name: string; version: string }[] = [];
  private loadingParserPromises = new Map<string, Promise<void>>();
  private failedParserLoads = new Set<string>();
  private loadingStdlibPromises = new Map<string, Promise<void>>();
  private failedStdlibKeys = new Set<string>();

  private ensureSharedContext(): void {
    if (this.sharedContext) return;
    const globalHooks = getGlobalHooks();
    this.sharedContext = {
      fs: globalHooks.sharedFs ?? new BrowserFileSystem(),
      parse: (ext: string, input: string, ...rest: unknown[]): CachedCstTree => {
        const normExt = ext.startsWith(".") ? ext.toLowerCase() : `.${ext.toLowerCase()}`;
        const dummyUri = `file:///dummy${normExt}`;
        const plugin = globalLanguageRegistry.getPluginForUri(dummyUri);
        if (isLargeXmlForWasm(dummyUri, input, plugin)) {
          return parseXmlFallbackTree(input);
        }
        type VariadicParserLike = { parse(text: string, ...args: unknown[]): CachedCstTree | null };
        const uwWithParser = this.workspaceManager.unifiedWorkspace as unknown as
          { getParser?: (extension: string) => VariadicParserLike | null | undefined } | undefined;
        const parser =
          (this.getParserForUri(dummyUri) as unknown as VariadicParserLike | null) ??
          uwWithParser?.getParser?.(normExt);
        if (parser) return parser.parse(input, ...rest) as CachedCstTree;
        if (normExt === ".sysml" || normExt === ".sysml2" || normExt === ".kerml") {
          return ((this.sysml2Parser as unknown as VariadicParserLike | null)?.parse(input, ...rest) ??
            null) as unknown as CachedCstTree;
        }
        if (normExt === ".mo" || normExt === ".msim" || normExt === ".mos") {
          return ((this.parser as unknown as VariadicParserLike | null)?.parse(input, ...rest) ??
            null) as unknown as CachedCstTree;
        }
        return null as unknown as CachedCstTree;
      },
      flattenArena: (name: string, classId?: number, uri?: string, options?: Record<string, unknown>) => {
        const engine =
          this.workspaceManager.globalModelicaQueryEngine ?? this.workspaceManager.getQueryEngine("modelica");
        if (!engine) return null;
        let targetId = classId;
        if (targetId !== undefined && !engine.index?.symbols?.has(targetId)) {
          targetId = undefined;
        }
        if (targetId === undefined) {
          const candidates: number[] | undefined = engine.index?.byName?.get(name);
          if (candidates && candidates.length > 0) {
            if (uri) {
              const norm = (u: string | undefined) => (u ? u.replace(/^([a-z0-9+-]+):\/{1,3}/i, "$1:///") : "");
              const targetNorm = norm(uri);
              const matched = candidates.find(
                (id: number) => norm(engine.index?.symbols?.get(id)?.resourceId) === targetNorm,
              );
              targetId = matched !== undefined ? matched : candidates[0];
            } else {
              targetId = candidates[0];
            }
          }
        }
        if (targetId === undefined) return null;
        const rawDB = engine.toQueryDB();
        const flattenOpts = options as FlattenOptions | undefined;
        const deadlineMs = typeof options?.["deadlineMs"] === "number" ? options["deadlineMs"] : undefined;
        if (deadlineMs !== undefined) {
          if (Date.now() > deadlineMs) return null;
          const BUDGET_SENTINEL = new Error("DaeFlattenBudgetExceeded");
          let qCalls = 0;
          const budgetedDB = new Proxy(rawDB, {
            get(target, prop: string | symbol) {
              const val = Reflect.get(target, prop, target);
              if (typeof val !== "function") return val;
              return (...args: unknown[]) => {
                if ((++qCalls & 127) === 0 && Date.now() > deadlineMs) {
                  throw BUDGET_SENTINEL;
                }
                return (val as (...a: unknown[]) => unknown).apply(target, args);
              };
            },
          });
          try {
            const flattener = new ArenaQueryFlattener(budgetedDB, flattenOpts);
            return flattener.flatten(targetId, null, flattenOpts);
          } catch (err) {
            if (err === BUDGET_SENTINEL) return null;
            throw err;
          }
        }
        const flattener = new ArenaQueryFlattener(rawDB, flattenOpts);
        return flattener.flatten(targetId, null, flattenOpts);
      },
    };
    globalHooks.sharedContext = this.sharedContext;
  }

  private resolveNormalizedLanguageId(languageIdOrUri: string): string {
    const raw = (languageIdOrUri || "").trim();
    if (!raw) return "modelica";
    const lower = raw.toLowerCase();
    if (lower === "sysml") return "sysml2";

    // Direct match in manifest
    const directManifest = this.manifest.find((m) => m.id.toLowerCase() === lower);
    if (directManifest) return directManifest.id;

    // Prefer registry lookup first (supports compound extensions and content sniffing for shared extensions like .inp, .dat, .xml)
    const plugin =
      globalLanguageRegistry.getPluginById(lower) ||
      globalLanguageRegistry.getPluginForUri(raw) ||
      globalLanguageRegistry.getPluginForLanguageIdOrUri(raw, raw);
    if (plugin?.id) {
      return plugin.id === "sysml" ? "sysml2" : plugin.id;
    }

    // Fallback: extension match in manifest if URI or filename
    if (raw.includes(".") || raw.includes("/")) {
      const cleanUri = lower.split("?")[0]!.split("#")[0]!;
      for (const entry of this.manifest) {
        const exts = entry.fileExtensions || entry.extensions || [`.${entry.id}`];
        if (exts.some((ext) => cleanUri.endsWith(ext.toLowerCase()))) {
          return entry.id;
        }
      }
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
    if (this.failedParserLoads.has(entry.id)) {
      return;
    }

    const existingPromise = this.loadingParserPromises.get(entry.id);
    if (existingPromise) {
      await existingPromise;
      this.ensureSharedContext();
      return;
    }

    const loadPromise = (async () => {
      const globalHooks = getGlobalHooks();
      const syntaxNames = entry.syntaxNames || (globalHooks[`${entry.id}SyntaxNames`] as string[] | undefined);
      const fieldNames =
        entry.fieldNames || (globalHooks[`${entry.id}FieldNames`] as Record<string, number> | undefined);
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
          } catch {
            // Package root parser.wasm export not found; try dist path below.
          }
          try {
            candidates.push(req.resolve(`@modelscript/${entry.id}/dist/parser.wasm`));
          } catch {
            // Package dist/parser.wasm not found; remaining URL candidates will be tried.
          }
        } catch {
          // Node module resolution unavailable in this runtime; use URL candidates only.
        }
      }

      const uniqueCandidates = Array.from(new Set(candidates));

      try {
        let result: Awaited<ReturnType<typeof createWasmParser>> | null = null;
        let lastError: unknown = null;
        for (const candUrl of uniqueCandidates) {
          try {
            result = await createWasmParser(candUrl, { syntaxNames, fieldNames });
            if (result) break;
          } catch (err) {
            lastError = err;
          }
        }
        if (!result && lastError) {
          throw lastError instanceof Error ? lastError : new Error(String(lastError));
        }

        if (result) {
          const loadedParser = result.parser as unknown as ParserServiceParser;
          const loadedFacade = result.facade as unknown as ParserServiceFacade;
          this.registerParser(entry.id, loadedParser, loadedFacade);
          this.ensureSharedContext();
          if (this.workspaceManager?.unifiedWorkspace && result.parser) {
            for (const ext of exts) {
              this.workspaceManager.unifiedWorkspace.registerParser(ext, result.parser as unknown as WorkspaceParser);
              this.workspaceManager.unifiedWorkspace.registerLanguageExtension(ext, entry.id);
            }
          }
          if (entry.id === "sysml2") {
            this.registerParser("sysml", loadedParser, loadedFacade);
            const existingSysml = globalLanguageRegistry.getPluginById("sysml");
            if (!existingSysml) {
              globalLanguageRegistry.register({
                id: "sysml",
                name: "SysML v2",
                extensions: [".sysml", ".sysml2", ".kerml"],
                parser: loadedParser,
                facade: loadedFacade,
                disposables: [],
              });
            } else {
              const pDesc = Object.getOwnPropertyDescriptor(existingSysml, "parser");
              if (!pDesc || pDesc.writable || typeof pDesc.set === "function") {
                try {
                  existingSysml.parser = loadedParser;
                } catch {
                  // Plugin object may be frozen or define a throwing setter for parser.
                }
              }
              const fDesc = Object.getOwnPropertyDescriptor(existingSysml, "facade");
              if (!fDesc || fDesc.writable || typeof fDesc.set === "function") {
                try {
                  existingSysml.facade = loadedFacade;
                } catch {
                  // Plugin object may be frozen or define a throwing setter for facade.
                }
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
              parser: loadedParser,
              facade: loadedFacade,
              disposables: [],
            });
          } else {
            const pDesc = Object.getOwnPropertyDescriptor(existing, "parser");
            if (!pDesc || pDesc.writable || typeof pDesc.set === "function") {
              try {
                existing.parser = loadedParser;
              } catch {
                // Plugin object may be frozen or define a throwing setter for parser.
              }
            }
            const fDesc = Object.getOwnPropertyDescriptor(existing, "facade");
            if (!fDesc || fDesc.writable || typeof fDesc.set === "function") {
              try {
                existing.facade = loadedFacade;
              } catch {
                // Plugin object may be frozen or define a throwing setter for facade.
              }
            }
          }

          this.connection.console.info(`ModelScript ${entry.displayName || entry.id} parser initialized`);
          const connWithReq = this.connection as unknown as {
            sendRequest?: (method: string) => Promise<unknown>;
          };
          if (typeof connWithReq?.sendRequest === "function") {
            void connWithReq.sendRequest("workspace/semanticTokens/refresh").catch(() => {});
          }
        }
      } catch (e) {
        this.failedParserLoads.add(entry.id);
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
    if (norm === "pscad" || norm === "pscx" || norm === "pslx") {
      if (mountedLibraryMetadata.has("MASTER")) return;
      const pkg = ensureBuiltInPscadLibraryRegistered();
      if (pkg) {
        mountedLibraryMetadata.set("MASTER", {
          name: "MASTER",
          version: pkg.version,
          language: "pscad",
          description: "PSCAD Master Library (@modelscript/pscad-master-lib)",
          category: "library",
        });
        this.sendProjectTreeChanged();
      }
      return;
    }

    const depName =
      norm === "modelica" || norm === "modelscript"
        ? "Modelica"
        : norm === "sysml2" || norm === "sysml"
          ? "SysML"
          : null;

    if (!depName) {
      // 1. Surface any built-in zero-I/O cleanroom stdlibs registered in globalLibraryRegistry
      const builtInPkgs = globalLibraryRegistry.getPackagesForLanguage(norm);
      let mountedBuiltIn = false;
      for (const pkg of builtInPkgs) {
        const normPkg = normalizeLibraryName(pkg.packageName);
        if (!mountedLibraryMetadata.has(normPkg)) {
          mountedLibraryMetadata.set(normPkg, {
            name: normPkg,
            version: pkg.version,
            language: norm,
            description: `${pkg.packageName} built-in cleanroom standard library`,
            category: pkg.manifest?.category ?? "library",
          });
          mountedBuiltIn = true;
        }
      }
      if (mountedBuiltIn) {
        this.sendProjectTreeChanged();
      }

      // 2. Polyglot lazy activation: check if language has additional standard libraries in catalog
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

      let anyMounted = false;
      await Promise.all(
        polyglotLibs.map(async (lib) => {
          const libKey = `${lib.packageName}@${lib.version}`;
          if (this.failedStdlibKeys.has(libKey)) {
            return;
          }
          const existingPromise = this.loadingStdlibPromises.get(libKey);
          if (existingPromise) {
            await existingPromise;
            return;
          }

          let mountOk = false;
          const hasBuiltInOrCurated = builtInPkgs.length > 0 || Boolean(findCuratedPackageFallback(lib.packageName));
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
                quietIfMissing: hasBuiltInOrCurated,
              });

              if (ok) {
                mountOk = true;
                this.connection.console.info(`[lsp] Successfully lazy-mounted stdlib ${libKey} for ${norm}.`);
              }
            } catch (mountErr) {
              this.connection.console.warn(`[lsp] Failed to mount polyglot stdlib ${libKey}: ${mountErr}`);
            }

            if (!mountOk) {
              try {
                const fallbackOk = await mountCuratedFallbackPackage(lib.packageName, lib.version, loaderCtx);
                if (fallbackOk) {
                  mountOk = true;
                  this.connection.console.info(`[lsp] Mounted curated fallback stdlib ${libKey} for ${norm}.`);
                }
              } catch (fallbackErr) {
                this.connection.console.warn(`[lsp] Curated fallback failed for stdlib ${libKey}: ${fallbackErr}`);
              }
            }

            if (mountOk) {
              anyMounted = true;
            }
          })();

          this.loadingStdlibPromises.set(libKey, mountPromise);
          try {
            await mountPromise;
          } finally {
            if (!mountOk) {
              this.failedStdlibKeys.add(libKey);
              this.loadingStdlibPromises.delete(libKey);
            }
          }
        }),
      );

      if (anyMounted) {
        for (const doc of this.documents.all()) {
          const docLang = this.resolveNormalizedLanguageId(doc.languageId || doc.uri);
          if (docLang === norm) {
            try {
              await (this.validationServiceRef?.validateTextDocument?.(doc) ?? globalCtx.validateTextDocument?.(doc));
            } catch (err) {
              this.connection.console.warn(`[lsp] Failed to validate open doc after ${norm} stdlib load: ${err}`);
            }
          }
        }
        this.sendProjectTreeChanged();
      }

      this.connection.sendNotification("modelscript/status", {
        state: "ready",
        message: globalCtx.getReadyMessage?.() ?? "ModelScript",
      });
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
        loaderCtx.sysml2Parser = this.getParser("sysml2") as unknown as FacadeParser | null;
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
              await loadMSL(this.serverDistBase, loaderCtx, dep.version, { skipRegistryRetry: true });
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
        const gHooks = getGlobalHooks();
        gHooks.clearIconCache?.();
        gHooks.clearDiagramCache?.();
        gHooks.diagramCache?.clear();

        if (!this.validationServiceRef?.dependenciesReady) {
          const isModelicaDep = dep.name === "Modelica";
          const isSysmlDep = dep.name === "SysML";
          for (const doc of this.documents.all()) {
            const langId = (doc.languageId || "").toLowerCase();
            if (isModelicaDep && langId !== "modelica" && langId !== "modelscript" && !/\.(mo|msx)$/i.test(doc.uri)) {
              continue;
            }
            if (isSysmlDep && langId !== "sysml2" && langId !== "sysml" && !/\.(sysml|kerml)$/i.test(doc.uri)) {
              continue;
            }
            try {
              await (this.validationServiceRef?.validateTextDocument?.(doc) ?? gHooks.validateTextDocument?.(doc));
            } catch (err) {
              this.connection.console.warn(`[lsp] Failed to validate open document after ${dep.name} load: ${err}`);
            }
          }
        }

        this.sendProjectTreeChanged();
        this.connection.sendNotification("modelscript/status", {
          state: "ready",
          message: gHooks.getReadyMessage?.() ?? "ModelScript",
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
        const gHooks = getGlobalHooks();
        gHooks.clearDiagramCache?.();
        gHooks.diagramCache?.clear();
        this.sendProjectTreeChanged();
        for (const doc of this.documents.all()) {
          try {
            await (this.validationServiceRef?.validateTextDocument?.(doc) ?? gHooks.validateTextDocument?.(doc));
          } catch {
            // Best-effort re-validation after library version swap; continue with remaining documents.
          }
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
    validationService?: ValidationServiceRefLike,
    projectDependencies: { name: string; version: string }[] = [
      { name: "Modelica", version: "4.1.0" },
      { name: "SysML", version: "2026.3.0" },
    ],
    useLocalMsl = false,
    onParsersReady?: () => void,
    options?: { lazyLoadParsers?: boolean | undefined; initialLanguageId?: string | undefined } | undefined,
  ): Promise<void> {
    try {
      const gHooks = getGlobalHooks();
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
      gHooks.serverDistBase = serverDistBase;
      this.serverDistBase = serverDistBase;
      this.lazyLoadParsers = Boolean(options?.lazyLoadParsers);
      this.useLocalMsl = useLocalMsl;
      this.validationServiceRef = validationService ?? null;
      this.projectDependenciesRef = projectDependencies;
      this.ensureSharedContext();
      const loaderCtx = this.getOrCreateLoaderContext();
      gHooks.savedLoaderCtx = loaderCtx;

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
            manifest = (await resp.json()) as typeof manifest;
          }
        }
      } catch (err) {
        this.connection.console.warn(
          `[ParserService] Failed to fetch languages-manifest.json: ${err instanceof Error ? err.message : String(err)}`,
        );
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
          await (validationService?.validateTextDocument?.(doc) ?? gHooks.validateTextDocument?.(doc));
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          this.connection.console.warn(`[lsp] Early validation failed for ${doc.uri}: ${msg}`);
        }
      }

      const cacheStore = loaderCtx.cacheStore;
      const isNodeRuntime = typeof process !== "undefined" && Boolean(process.versions?.node);
      const MAX_MEMOS = isNodeRuntime ? 2_000_000 : 200_000; // Limit in-memory memos (tighter in browser)

      const createModelicaQE = gHooks.createModelicaQueryEngine ?? gHooks.create_modelica_query_engine;
      if (createModelicaQE) {
        try {
          const modelicaWs = this.workspaceManager.getWorkspaceIndex("modelica") as
            { getIndex?: (opts?: { eager?: boolean }) => SymbolIndex } | undefined;
          const unified =
            modelicaWs?.getIndex?.({ eager: true }) ?? this.workspaceManager.unifiedWorkspace?.getIndex?.();
          if (unified) {
            this.workspaceManager.globalModelicaQueryEngine = createModelicaQE(
              unified,
              { getText: () => null, getNode: () => null },
              cacheStore,
              MAX_MEMOS,
            );
          }
        } catch (qeErr: unknown) {
          const msg = qeErr instanceof Error ? qeErr.message : String(qeErr);
          this.connection.console.warn(`[lsp] Failed to initialize globalModelicaQueryEngine: ${msg}`);
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

      loaderCtx.globalWorkspaceIndex = (this.workspaceManager.getWorkspaceIndex("modelica") ??
        null) as unknown as LoaderContext["globalWorkspaceIndex"];
      loaderCtx.sysml2WorkspaceIndex = (this.workspaceManager.getWorkspaceIndex("sysml2") ??
        null) as unknown as LoaderContext["sysml2WorkspaceIndex"];
      loaderCtx.sysml2Parser = this.getParser("sysml2") as unknown as FacadeParser | null;
      loaderCtx.sharedContext = this.sharedContext as unknown as LoaderContext["sharedContext"];

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
          if (langId === "modelica" || langId === "modelscript" || langId === "sysml2" || langId === "pscad") {
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
            message: gHooks.getReadyMessage?.() ?? "ModelScript",
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
                await loadMSL(serverDistBase, loaderCtx, dep.version, { skipRegistryRetry: true });
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
      gHooks.clearIconCache?.();
      gHooks.clearDiagramCache?.();
      gHooks.diagramCache?.clear();

      for (const doc of this.documents.all()) {
        const langId = (doc.languageId || "").toLowerCase();
        if (langId === "step" && doc.getText().length > 262_144) continue;
        try {
          await gHooks.validateTextDocument?.(doc);
        } catch (err) {
          this.connection.console.warn(`[lsp] Failed to validate open document on init: ${err}`);
        }
      }

      this.sendProjectTreeChanged();

      this.connection.sendNotification("modelscript/status", {
        state: "ready",
        message: gHooks.getReadyMessage?.() ?? "ModelScript",
      });
    } catch (e: unknown) {
      const stack = e instanceof Error ? (e.stack ?? "") : "";
      this.connection.console.error(`Failed to initialize WASM parsers: ${e}\n${stack}`);
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
          const bridge = getGlobalHooks().documentLSPBridges?.get(currentUri);
          if (bridge) {
            return bridge.positions.rangeFromOffsets(startOff, endOff);
          }
        }
      }
    }
    return null;
  }

  resolveModelicaClassInstance(
    uri: string,
    className?: string,
  ): ReturnType<WorkspaceManager["resolveModelicaClassInstance"]> {
    return this.workspaceManager.resolveModelicaClassInstance(uri, className);
  }
}
