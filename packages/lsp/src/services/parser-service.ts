// SPDX-License-Identifier: AGPL-3.0-or-later

// ts-check

import { registerPreloadedWasmParser } from "@modelscript/dsl/bindings";
import { ArenaQueryFlattener, type FlattenOptions } from "@modelscript/modelica/flattener";
import { type CSTTree, type SymbolEntry } from "@modelscript/runtime";
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
import type { Tree as CstTree, SyntaxNode } from "../utils/cst-facade.js";
import { LineIndex, TokenData } from "../utils/line-index.js";
import { BrowserFileSystem } from "../vfs/browser-file-system.js";
import type { LoaderContext } from "../vfs/library-loader.js";
import {
  DocumentManager,
  type CachedCstTree,
  type DocumentTreeMap,
  type LazyTreeMap,
  type SharedCompilerContext,
} from "./document-manager.js";
import {
  DEFAULT_WASM_MANIFEST,
  ensureLanguageParserLoadedImpl,
  getOrCreateLoaderContextImpl,
  initWasmParsersImpl,
  syncDocumentLibraryVersionsImpl,
  type StdlibLoaderHost,
  type SyntaxTableEntry,
  type ValidationServiceRefLike,
  type WasmManifestEntry,
} from "./stdlib-loader.js";
import { WorkspaceManager } from "./workspace-manager.js";

export type { SyntaxTableEntry };

/** Structural WASM parser handle managed by `ParserService`. */
export interface ParserServiceParser {
  parse(input: string, ...rest: unknown[]): CachedCstTree | null;
  setLanguage?(language: unknown): void;
  getLanguage?(): unknown;
  setTimeoutMicros?(micros: number): void;
}

/** Structural WASM LSP facade handle managed by `ParserService`. */
export type ParserServiceFacade = WasmFacadeInstance & {
  removeDocument?(uri: string): void;
  getDocumentRoot?(uriOrFileId?: string | number): number;
};

interface ParserEntryRecord {
  parser: ParserServiceParser | null;
  facade: ParserServiceFacade | null;
  ready: boolean;
}

export class ParserService {
  private static readonly MAX_LOADED_PARSERS_BROWSER = 12;
  private parserEntries = new Map<string, ParserEntryRecord>();
  private parserLru: string[] = [];
  private syntaxTables = new Map<string, SyntaxTableEntry>();
  public sharedContext: SharedCompilerContext | null = null;
  public sharedFs?: BrowserFileSystem | undefined;
  public registryUrl?: string | undefined;
  private clearDiagramCacheCallback?: (() => void) | undefined;

  /** Registers pre-bundled syntax and field name tables for browser WASM parser loading. */
  public registerSyntaxTables(tables: Record<string, SyntaxTableEntry>): void {
    for (const [id, entry] of Object.entries(tables)) {
      this.syntaxTables.set(id.toLowerCase(), entry);
    }
  }

  /** Wires the validation service for post-load document revalidation and bridge lookups. */
  public setValidationService(validationService: ValidationServiceRefLike | null): void {
    this.validationServiceRef = validationService;
  }

  /** Registers a callback to invalidate diagram caches when standard libraries finish loading. */
  public setClearDiagramCache(fn: () => void): void {
    this.clearDiagramCacheCallback = fn;
  }

  /** Formats a status bar readiness summary showing loaded MSL and SysML v2 file counts. */
  public getReadyMessage(): string {
    const parts: string[] = [];
    const mslCount = this.workspaceManager.getWorkspaceIndex("modelica")?.fileCount ?? 0;
    if (mslCount > 0) parts.push(`${mslCount} MSL`);
    const sysmlCount = this.workspaceManager.getWorkspaceIndex("sysml2")?.fileCount ?? 0;
    if (sysmlCount > 0) parts.push(`${sysmlCount} SysML2`);
    return parts.length > 0 ? `ModelScript (${parts.join(", ")})` : "ModelScript";
  }

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
      const resolved = this.resolveNormalizedLanguageId(doc.languageId || doc.uri);
      activeLangs.add(resolved);
      if (resolved === "sysml" || resolved === "sysml2") {
        activeLangs.add("sysml");
        activeLangs.add("sysml2");
      }
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
    return this.documentManager?.documentTrees ?? this.workspaceManager?.documentManager?.documentTrees;
  }

  private getLazyLibTreesMap(): LazyTreeMap | undefined {
    return this.documentManager?.lazyLibTrees ?? this.workspaceManager?.documentManager?.lazyLibTrees;
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

    if (cached && cached.text === newText && isCachedTreeActive && cached.tree && "edit" in cached.tree) {
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

    if (cached && cached.tree && "edit" in cached.tree && cached.text !== newText && isWasmTreeActive) {
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
    if (cached && isCachedTreeActive && cached.tree && "edit" in cached.tree) return cached.tree;

    // No cached tree — parse from current document text
    const document = this.documents.get(uri);
    if (!document) return cached?.tree && "edit" in cached.tree ? cached.tree : null;

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

    if (!("edit" in cached.tree)) return null;
    walk(cached.tree.rootNode);
    const totalLines = cached.text.split(/\r?\n|\r/).length;
    cached.lineIndex = new LineIndex(totalLines, tokensData);
    cached.tokens = nodes;

    return { lineIndex: cached.lineIndex, tokens: cached.tokens };
  }

  public serverDistBase = "";
  private loaderCtx: LoaderContext | null = null;

  public getServerDistBase(): string {
    return this.serverDistBase || "";
  }

  public getOrCreateLoaderContext(): LoaderContext {
    return getOrCreateLoaderContextImpl(this.getStdlibLoaderHost());
  }

  private manifest: WasmManifestEntry[] = [...DEFAULT_WASM_MANIFEST];
  private lazyLoadParsers = false;
  private useLocalMsl = false;
  private validationServiceRef: ValidationServiceRefLike | null = null;
  private projectDependenciesRef: { name: string; version: string }[] = [];
  private loadingParserPromises = new Map<string, Promise<void>>();
  private failedParserLoads = new Set<string>();
  private loadingStdlibPromises = new Map<string, Promise<void>>();
  private failedStdlibKeys = new Set<string>();

  private getStdlibLoaderHost(): StdlibLoaderHost {
    return {
      parserService: this,
      connection: this.connection,
      documents: this.documents,
      documentManager: this.documentManager,
      workspaceManager: this.workspaceManager,
      syntaxTables: this.syntaxTables,
      loadingParserPromises: this.loadingParserPromises,
      failedParserLoads: this.failedParserLoads,
      loadingStdlibPromises: this.loadingStdlibPromises,
      failedStdlibKeys: this.failedStdlibKeys,
      getServerDistBase: () => this.getServerDistBase(),
      setServerDistBase: (base: string) => {
        this.serverDistBase = base;
      },
      getLoaderCtx: () => this.loaderCtx,
      setLoaderCtx: (ctx: LoaderContext) => {
        this.loaderCtx = ctx;
      },
      getSharedFs: () => this.sharedFs,
      getSharedContext: () => this.sharedContext,
      getRegistryUrl: () => this.registryUrl,
      getManifest: () => this.manifest,
      setManifest: (m: WasmManifestEntry[]) => {
        this.manifest = m;
      },
      isLazyLoadParsers: () => this.lazyLoadParsers,
      setLazyLoadParsers: (val: boolean) => {
        this.lazyLoadParsers = val;
      },
      isUseLocalMsl: () => this.useLocalMsl,
      setUseLocalMsl: (val: boolean) => {
        this.useLocalMsl = val;
      },
      getValidationServiceRef: () => this.validationServiceRef,
      setValidationServiceRef: (ref: ValidationServiceRefLike | null) => {
        this.validationServiceRef = ref;
      },
      getProjectDependenciesRef: () => this.projectDependenciesRef,
      setProjectDependenciesRef: (deps: { name: string; version: string }[]) => {
        this.projectDependenciesRef = deps;
      },
      clearDiagramCache: () => {
        this.clearDiagramCacheCallback?.();
      },
      ensureSharedContext: () => this.ensureSharedContext(),
      resolveNormalizedLanguageId: (idOrUri: string) => this.resolveNormalizedLanguageId(idOrUri),
      registerParser: (langId, parser, facade) => this.registerParser(langId, parser, facade),
      getParser: (langId: string) => this.getParser(langId),
      isParserReady: (langId: string) => this.isParserReady(langId),
      setParserReady: (val: boolean) => {
        this.parserReady = val;
      },
      getSharedCstTreeWrapper: () => this.getSharedCstTreeWrapper(),
      getReadyMessage: () => this.getReadyMessage(),
      sendProjectTreeChanged: () => this.sendProjectTreeChanged(),
    };
  }

  private ensureSharedContext(): void {
    if (this.sharedContext) return;
    this.sharedContext = {
      fs: this.sharedFs ?? new BrowserFileSystem(),
      parse: (ext: string, input: string, ...rest: unknown[]): CachedCstTree | null => {
        const normExt = ext.startsWith(".") ? ext.toLowerCase() : `.${ext.toLowerCase()}`;
        const dummyUri = `file:///dummy${normExt}`;
        const plugin = globalLanguageRegistry.getPluginForUri(dummyUri);
        if (isLargeXmlForWasm(dummyUri, input, plugin)) {
          return parseXmlFallbackTree(input);
        }
        const uw = this.workspaceManager.unifiedWorkspace;
        const uwParser =
          "getParser" in uw && typeof uw.getParser === "function"
            ? (uw.getParser(normExt) as ParserServiceParser | null | undefined)
            : null;
        const parser = this.getParserForUri(dummyUri) ?? uwParser;
        if (parser) return parser.parse(input, ...rest);
        if (normExt === ".sysml" || normExt === ".sysml2" || normExt === ".kerml") {
          return this.sysml2Parser?.parse(input, ...rest) ?? null;
        }
        if (normExt === ".mo" || normExt === ".msim" || normExt === ".mos") {
          return this.parser?.parse(input, ...rest) ?? null;
        }
        return null;
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

  public async syncDocumentLibraryVersions(uri: string, text: string): Promise<void> {
    await syncDocumentLibraryVersionsImpl(this.getStdlibLoaderHost(), uri, text);
  }

  public async ensureLanguageParserLoaded(languageIdOrUri: string): Promise<void> {
    await ensureLanguageParserLoadedImpl(this.getStdlibLoaderHost(), languageIdOrUri);
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
    await initWasmParsersImpl(
      this.getStdlibLoaderHost(),
      extensionUri,
      validationService,
      projectDependencies,
      useLocalMsl,
      onParsersReady,
      options,
    );
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
          const bridge = this.validationServiceRef?.documentLSPBridges?.get(currentUri);
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
