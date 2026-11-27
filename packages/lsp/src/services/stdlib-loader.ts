// SPDX-License-Identifier: AGPL-3.0-or-later

import { createWasmParser } from "@modelscript/dsl/bindings";
import { getStdlibsForLanguage } from "@modelscript/exchange/catalog";
import { clearIconCache } from "@modelscript/modelica/diagram";
import { createModelicaQueryEngine } from "@modelscript/modelica/factory";
import { globalLibraryRegistry, type CSTTree, type SymbolIndex, type WorkspaceParser } from "@modelscript/runtime";
import {
  FederatedQueryCacheStore,
  IndexedDBQueryCacheStore,
  MemoryQueryCacheStore,
} from "@modelscript/runtime/wasm_cache_store.js";
import type { Connection, TextDocuments } from "vscode-languageserver";
import type { TextDocument } from "vscode-languageserver-textdocument";
import { ensureLazyLanguagePluginLoaded } from "../registry/core-plugins.js";
import { globalLanguageRegistry, type WasmParserInstance } from "../registry/LanguageRegistry.js";
import { mountedLibraryMetadata, normalizeLibraryName } from "../utils/hierarchy-utils.js";
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
import type { DocumentManager, SharedCompilerContext } from "./document-manager.js";
import type { ParserService, ParserServiceFacade, ParserServiceParser } from "./parser-service.js";
import type { WorkspaceManager } from "./workspace-manager.js";

export interface SyntaxTableEntry {
  syntaxNames?: string[] | undefined;
  fieldNames?: Record<string, number> | undefined;
}

export interface WasmManifestEntry {
  id: string;
  wasm?: string | undefined;
  displayName?: string | undefined;
  fileExtensions?: string[] | undefined;
  extensions?: string[] | undefined;
  syntaxNames?: string[] | undefined;
  fieldNames?: Record<string, number> | undefined;
}

export interface ValidationServiceRefLike {
  declaredDependencies: { name: string; version: string }[];
  dependenciesReady?: boolean | undefined;
  markDependencyLoaded(name: string, version: string): void;
  validateTextDocument?(doc: TextDocument): Promise<void>;
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
}

export const DEFAULT_WASM_MANIFEST: WasmManifestEntry[] = [
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

export interface StdlibLoaderHost {
  parserService: ParserService;
  connection: Connection;
  documents: TextDocuments<TextDocument>;
  documentManager: DocumentManager;
  workspaceManager: WorkspaceManager;
  syntaxTables: Map<string, SyntaxTableEntry>;
  loadingParserPromises: Map<string, Promise<void>>;
  failedParserLoads: Set<string>;
  loadingStdlibPromises: Map<string, Promise<void>>;
  failedStdlibKeys: Set<string>;
  getServerDistBase(): string;
  setServerDistBase(base: string): void;
  getLoaderCtx(): LoaderContext | null;
  setLoaderCtx(ctx: LoaderContext): void;
  getSharedFs(): BrowserFileSystem | undefined;
  getSharedContext(): SharedCompilerContext | null;
  getRegistryUrl(): string | undefined;
  getManifest(): WasmManifestEntry[];
  setManifest(manifest: WasmManifestEntry[]): void;
  isLazyLoadParsers(): boolean;
  setLazyLoadParsers(val: boolean): void;
  isUseLocalMsl(): boolean;
  setUseLocalMsl(val: boolean): void;
  getValidationServiceRef(): ValidationServiceRefLike | null;
  setValidationServiceRef(ref: ValidationServiceRefLike | null): void;
  getProjectDependenciesRef(): { name: string; version: string }[];
  setProjectDependenciesRef(deps: { name: string; version: string }[]): void;
  clearDiagramCache(): void;
  ensureSharedContext(): void;
  resolveNormalizedLanguageId(languageIdOrUri: string): string;
  registerParser(
    langId: string,
    parser: ParserServiceParser | WasmParserInstance | null | undefined,
    facade?: ParserServiceFacade | null | undefined,
  ): void;
  getParser(langId: string): ParserServiceParser | null;
  isParserReady(langId: string): boolean;
  setParserReady(val: boolean): void;
  getSharedCstTreeWrapper(): CSTTree;
  getReadyMessage(): string;
  sendProjectTreeChanged(): void;
}

function assignPluginParserFacade(
  plugin: { parser?: unknown; facade?: unknown },
  loadedParser: ParserServiceParser,
  loadedFacade: ParserServiceFacade,
): void {
  const pDesc = Object.getOwnPropertyDescriptor(plugin, "parser");
  if (!pDesc || pDesc.writable || typeof pDesc.set === "function") {
    try {
      plugin.parser = loadedParser;
    } catch {
      // Plugin object may be frozen or define a throwing setter for parser.
    }
  }
  const fDesc = Object.getOwnPropertyDescriptor(plugin, "facade");
  if (!fDesc || fDesc.writable || typeof fDesc.set === "function") {
    try {
      plugin.facade = loadedFacade;
    } catch {
      // Plugin object may be frozen or define a throwing setter for facade.
    }
  }
}

export function getOrCreateLoaderContextImpl(host: StdlibLoaderHost): LoaderContext {
  const existing = host.getLoaderCtx();
  if (existing) return existing;
  host.ensureSharedContext();
  const localStore =
    typeof indexedDB !== "undefined"
      ? new IndexedDBQueryCacheStore("modelscript-lsp-cache")
      : new MemoryQueryCacheStore();
  const federatedEndpoints: string[] = [];
  const cacheStore = new FederatedQueryCacheStore(localStore, {
    getEndpoints: () => federatedEndpoints,
  });
  const createdLoaderCtx: LoaderContext = {
    connectionState: host.connection,
    logger: {
      log: (msg) => host.connection.console.info(msg),
      warn: (msg) => host.connection.console.warn(msg),
      error: (msg, e) => host.connection.console.error(`${msg} ${e}`),
    },
    sharedFs: host.getSharedFs() ?? new BrowserFileSystem(),
    sharedContext: host.getSharedContext(),
    globalWorkspaceIndex: host.workspaceManager.getWorkspaceIndex("modelica") ?? null,
    sysml2WorkspaceIndex: host.workspaceManager.getWorkspaceIndex("sysml2") ?? null,
    globalModelicaQueryEngine: host.workspaceManager.globalModelicaQueryEngine as
      LoaderContext["globalModelicaQueryEngine"] | undefined,
    serverDistBase: host.getServerDistBase() || undefined,
    documentTrees: host.documentManager.documentTrees,
    sysml2Parser: host.getParser("sysml2"),
    cacheStore,
    registryUrl: host.getRegistryUrl(),
    federatedEndpoints,
  };
  host.setLoaderCtx(createdLoaderCtx);
  // Minimal test-compatibility bridge: asserted by packages/lsp/tests/libraries-panel-unified.test.ts.
  (globalThis as { savedLoaderCtx?: LoaderContext }).savedLoaderCtx = createdLoaderCtx;
  return createdLoaderCtx;
}

export async function loadSingleWasmEntryImpl(host: StdlibLoaderHost, entry: WasmManifestEntry): Promise<void> {
  const serverDistBase = host.getServerDistBase();
  if (serverDistBase) {
    host.setServerDistBase(serverDistBase);
  }
  const isNode = typeof process !== "undefined" && Boolean(process.versions?.node);
  if (!serverDistBase && !isNode) return;
  if (host.isParserReady(entry.id)) {
    host.ensureSharedContext();
    return;
  }
  if (host.failedParserLoads.has(entry.id)) {
    return;
  }

  const existingPromise = host.loadingParserPromises.get(entry.id);
  if (existingPromise) {
    await existingPromise;
    host.ensureSharedContext();
    return;
  }

  const loadPromise = (async () => {
    const table = host.syntaxTables.get(entry.id.toLowerCase());
    const syntaxNames = entry.syntaxNames || table?.syntaxNames;
    const fieldNames = entry.fieldNames || table?.fieldNames;
    const exts = entry.fileExtensions || entry.extensions || [`.${entry.id}`];
    const candidates: string[] = [];

    if (serverDistBase) {
      if (entry.wasm) candidates.push(`${serverDistBase}/${entry.wasm}`);
      candidates.push(`${serverDistBase}/${entry.id}.wasm`);
      if (entry.id === "modelica") candidates.push(`${serverDistBase}/parser.wasm`);
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
        host.registerParser(entry.id, loadedParser, loadedFacade);
        host.ensureSharedContext();
        if (host.workspaceManager?.unifiedWorkspace && result.parser) {
          for (const ext of exts) {
            host.workspaceManager.unifiedWorkspace.registerParser(ext, result.parser as unknown as WorkspaceParser);
            host.workspaceManager.unifiedWorkspace.registerLanguageExtension(ext, entry.id);
          }
        }
        if (entry.id === "sysml2") {
          host.registerParser("sysml", loadedParser, loadedFacade);
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
            assignPluginParserFacade(existingSysml, loadedParser, loadedFacade);
          }
        }

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
          assignPluginParserFacade(existing, loadedParser, loadedFacade);
        }

        host.connection.console.info(`ModelScript ${entry.displayName || entry.id} parser initialized`);
        if (typeof host.connection.sendRequest === "function") {
          void host.connection.sendRequest("workspace/semanticTokens/refresh").catch(() => {});
        }
      }
    } catch (e) {
      host.failedParserLoads.add(entry.id);
      host.connection.console.warn(`Failed to load ${entry.id} language: ${e}`);
    }
  })();

  host.loadingParserPromises.set(entry.id, loadPromise);
  try {
    await loadPromise;
  } finally {
    if (!host.isParserReady(entry.id)) {
      host.loadingParserPromises.delete(entry.id);
    }
  }
}

export async function ensureStdlibForLanguageImpl(host: StdlibLoaderHost, langId: string): Promise<void> {
  const norm = langId.toLowerCase();
  if (norm === "pscad" || norm === "pscx" || norm === "pslx") {
    if (mountedLibraryMetadata.has("MASTER")) return;
    const { ensureBuiltInPscadLibraryRegistered } = await import("@modelscript/pscad");
    const pkg = ensureBuiltInPscadLibraryRegistered();
    if (pkg) {
      mountedLibraryMetadata.set("MASTER", {
        name: "MASTER",
        version: pkg.version,
        language: "pscad",
        description: "PSCAD Master Library (@modelscript/pscad-master-lib)",
        category: "library",
      });
      host.sendProjectTreeChanged();
    }
    return;
  }

  const depName =
    norm === "modelica" || norm === "modelscript" ? "Modelica" : norm === "sysml2" || norm === "sysml" ? "SysML" : null;

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
      host.sendProjectTreeChanged();
    }

    // 2. Polyglot lazy activation: check if language has additional standard libraries in catalog
    const polyglotLibs = getStdlibsForLanguage(norm);
    if (polyglotLibs.length === 0) return;

    const loaderCtx = getOrCreateLoaderContextImpl(host);
    const serverDistBase = host.getServerDistBase();
    if (!serverDistBase) return;
    host.setServerDistBase(serverDistBase);

    let anyMounted = false;
    await Promise.all(
      polyglotLibs.map(async (lib) => {
        const libKey = `${lib.packageName}@${lib.version}`;
        if (host.failedStdlibKeys.has(libKey)) {
          return;
        }
        const existingPromise = host.loadingStdlibPromises.get(libKey);
        if (existingPromise) {
          await existingPromise;
          return;
        }

        let mountOk = false;
        const curatedFallback = findCuratedPackageFallback(lib.packageName);
        const hasBuiltInOrCurated = builtInPkgs.length > 0 || Boolean(curatedFallback);
        const mountPromise = (async () => {
          // Fast path: in browser mode, mount zero-I/O curated fallback directly instead of
          // issuing doomed HTTP fetches for unshipped .zip archives (which hit SPA fallback HTML).
          if (curatedFallback && host.isLazyLoadParsers()) {
            try {
              const fallbackOk = await mountCuratedFallbackPackage(lib.packageName, lib.version, loaderCtx);
              if (fallbackOk) {
                mountOk = true;
                anyMounted = true;
                host.connection.console.info(`[lsp] Mounted curated fallback stdlib ${libKey} for ${norm}.`);
                return;
              }
            } catch (fallbackErr) {
              host.connection.console.warn(`[lsp] Curated fallback failed for stdlib ${libKey}: ${fallbackErr}`);
            }
          }

          host.connection.sendNotification("modelscript/status", {
            state: "loading",
            message: `ModelScript (activating ${lib.packageName} standard library...)`,
          });

          try {
            const ok = await mountPolyglotLibrary(serverDistBase, loaderCtx, {
              packageName: lib.packageName,
              version: lib.version,
              filename: lib.filename,
              language: lib.language,
              quietIfMissing: hasBuiltInOrCurated,
            });

            if (ok) {
              mountOk = true;
              host.connection.console.info(`[lsp] Successfully lazy-mounted stdlib ${libKey} for ${norm}.`);
            }
          } catch (mountErr) {
            host.connection.console.warn(`[lsp] Failed to mount polyglot stdlib ${libKey}: ${mountErr}`);
          }

          if (!mountOk) {
            try {
              const fallbackOk = await mountCuratedFallbackPackage(lib.packageName, lib.version, loaderCtx);
              if (fallbackOk) {
                mountOk = true;
                host.connection.console.info(`[lsp] Mounted curated fallback stdlib ${libKey} for ${norm}.`);
              }
            } catch (fallbackErr) {
              host.connection.console.warn(`[lsp] Curated fallback failed for stdlib ${libKey}: ${fallbackErr}`);
            }
          }

          if (mountOk) {
            anyMounted = true;
          }
        })();

        host.loadingStdlibPromises.set(libKey, mountPromise);
        try {
          await mountPromise;
        } finally {
          if (!mountOk) {
            host.failedStdlibKeys.add(libKey);
            host.loadingStdlibPromises.delete(libKey);
          }
        }
      }),
    );

    if (anyMounted) {
      const validationServiceRef = host.getValidationServiceRef();
      for (const doc of host.documents.all()) {
        const docLang = host.resolveNormalizedLanguageId(doc.languageId || doc.uri);
        if (docLang === norm) {
          try {
            await validationServiceRef?.validateTextDocument?.(doc);
          } catch (err) {
            host.connection.console.warn(`[lsp] Failed to validate open doc after ${norm} stdlib load: ${err}`);
          }
        }
      }
      host.sendProjectTreeChanged();
    }

    host.connection.sendNotification("modelscript/status", {
      state: "ready",
      message: host.getReadyMessage(),
    });
    return;
  }

  const existingStdlib = host.loadingStdlibPromises.get(depName);
  if (existingStdlib) {
    await existingStdlib;
    return;
  }

  const loaderCtx = getOrCreateLoaderContextImpl(host);
  const serverDistBase = host.getServerDistBase();
  if (!serverDistBase) return;
  host.setServerDistBase(serverDistBase);

  const dep =
    host.getProjectDependenciesRef().find((d) => d.name === depName) ??
    (depName === "Modelica" ? { name: "Modelica", version: "4.1.0" } : { name: "SysML", version: "2026.3.0" });

  let loadSucceeded = false;
  const stdlibPromise = (async () => {
    const validationServiceRef = host.getValidationServiceRef();
    if (validationServiceRef) {
      const alreadyDeclared = validationServiceRef.declaredDependencies?.some(
        (d: { name: string; version: string }) => d.name === dep.name && d.version === dep.version,
      );
      if (!alreadyDeclared) {
        validationServiceRef.declaredDependencies.push(dep);
      }
    }

    if (depName === "SysML") {
      loaderCtx.sysml2Parser = host.getParser("sysml2");
    }

    host.connection.sendNotification("modelscript/status", {
      state: "loading",
      message: `ModelScript (loading ${dep.name} standard library...)`,
    });

    try {
      if (host.isUseLocalMsl() && dep.name === "Modelica") {
        await loadMSL(serverDistBase, loaderCtx, dep.version);
      } else if (host.isUseLocalMsl() && dep.name === "SysML" && dep.version === "2026.3.0") {
        await loadSysML2StandardLibrary(serverDistBase, loaderCtx);
      } else {
        try {
          await loadDependencyFromRegistry(dep, loaderCtx);
        } catch (regErr) {
          if (dep.name === "Modelica") {
            host.connection.console.warn(
              `[lsp] Registry load failed for Modelica, falling back to local MSL zip: ${regErr}`,
            );
            await loadMSL(serverDistBase, loaderCtx, dep.version, { skipRegistryRetry: true });
          } else if (dep.name === "SysML") {
            host.connection.console.warn(
              `[lsp] Registry load failed for SysML, falling back to local SysML zip: ${regErr}`,
            );
            await loadSysML2StandardLibrary(serverDistBase, loaderCtx);
          } else {
            throw regErr;
          }
        }
      }
      if (validationServiceRef) {
        validationServiceRef.markDependencyLoaded(dep.name, dep.version);
      }
      loadSucceeded = true;
    } catch (err) {
      host.connection.console.warn(`[lsp] Failed to load ${dep.name}@${dep.version}: ${err}`);
    }

    if (loadSucceeded) {
      clearIconCache();
      host.clearDiagramCache();

      if (!validationServiceRef?.dependenciesReady) {
        const isModelicaDep = dep.name === "Modelica";
        const isSysmlDep = dep.name === "SysML";
        for (const doc of host.documents.all()) {
          const docLangId = (doc.languageId || "").toLowerCase();
          if (
            isModelicaDep &&
            docLangId !== "modelica" &&
            docLangId !== "modelscript" &&
            !/\.(mo|msx)$/i.test(doc.uri)
          ) {
            continue;
          }
          if (isSysmlDep && docLangId !== "sysml2" && docLangId !== "sysml" && !/\.(sysml|kerml)$/i.test(doc.uri)) {
            continue;
          }
          try {
            await validationServiceRef?.validateTextDocument?.(doc);
          } catch (err) {
            host.connection.console.warn(`[lsp] Failed to validate open document after ${dep.name} load: ${err}`);
          }
        }
      }

      host.sendProjectTreeChanged();
      host.connection.sendNotification("modelscript/status", {
        state: "ready",
        message: host.getReadyMessage(),
      });
    }
  })();

  host.loadingStdlibPromises.set(depName, stdlibPromise);
  try {
    await stdlibPromise;
  } finally {
    if (!loadSucceeded) {
      host.loadingStdlibPromises.delete(depName);
    }
  }
}

export async function syncDocumentLibraryVersionsImpl(
  host: StdlibLoaderHost,
  uri: string,
  text: string,
): Promise<void> {
  const loaderCtx = getOrCreateLoaderContextImpl(host);
  const serverDistBase = host.getServerDistBase();
  if (!loaderCtx || !serverDistBase) return;
  try {
    const swapped = await resolveWorkspaceLibraryVersions(text, loaderCtx, uri, serverDistBase);
    if (swapped.length > 0) {
      const deps = host.getProjectDependenciesRef();
      const validationServiceRef = host.getValidationServiceRef();
      for (const dep of swapped) {
        const existingIdx = deps.findIndex((d) => d.name === dep.name);
        if (existingIdx >= 0) {
          deps[existingIdx] = dep;
        } else {
          deps.push(dep);
        }
        validationServiceRef?.markDependencyLoaded?.(dep.name, dep.version);
      }
      host.clearDiagramCache();
      host.sendProjectTreeChanged();
      for (const doc of host.documents.all()) {
        try {
          await validationServiceRef?.validateTextDocument?.(doc);
        } catch {
          // Best-effort re-validation after library version swap; continue with remaining documents.
        }
      }
    }
  } catch (err) {
    host.connection.console.warn(`[lsp] syncDocumentLibraryVersions failed for ${uri}: ${err}`);
  }
}

export function openModelicaDocsNeedMslImpl(documents: TextDocuments<TextDocument>): boolean {
  for (const doc of documents.all()) {
    const lang = (doc.languageId || "").toLowerCase();
    if (lang !== "modelica" && lang !== "modelscript" && !/\.(mo|msx)$/i.test(doc.uri)) {
      continue;
    }
    const text = doc.getText();
    if (/\bModelica\s*\./.test(text) || /\buses\s*\(\s*Modelica\b/.test(text) || /\bComplex\b/.test(text)) {
      return true;
    }
  }
  return false;
}

export async function ensureLanguageParserLoadedImpl(host: StdlibLoaderHost, languageIdOrUri: string): Promise<void> {
  const serverDistBase = host.getServerDistBase();
  if (serverDistBase) {
    host.setServerDistBase(serverDistBase);
  }
  const isNode = typeof process !== "undefined" && Boolean(process.versions?.node);
  if (!serverDistBase && !isNode) return;
  host.ensureSharedContext();
  const langId = host.resolveNormalizedLanguageId(languageIdOrUri);
  await ensureLazyLanguagePluginLoaded(langId, {
    workspaceManager: host.workspaceManager,
    parserService: host.parserService,
    connection: host.connection,
  });
  if (!host.isParserReady(langId)) {
    const manifest = host.getManifest();
    let entry = manifest.find((m) => m.id.toLowerCase() === langId.toLowerCase());
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
      await loadSingleWasmEntryImpl(host, entry);
    }
  }
  if (host.isLazyLoadParsers()) {
    // Avoid eagerly downloading & unzipping the 21 MB Modelica Standard Library when a
    // self-contained companion .mo file in a polyglot workspace does not reference MSL.
    if ((langId === "modelica" || langId === "modelscript") && !openModelicaDocsNeedMslImpl(host.documents)) {
      return;
    }
    // Trigger stdlib loading in background if not already loaded, after parser is ready
    void ensureStdlibForLanguageImpl(host, langId);
  }
}

export async function initWasmParsersImpl(
  host: StdlibLoaderHost,
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
    let serverDistBase = `${extensionUri}/server/dist`;
    host.connection.console.info(`[wasm-parser] extensionUri: ${extensionUri}`);
    host.connection.console.info(`[wasm-parser] serverDistBase: ${serverDistBase}`);

    if (!serverDistBase.startsWith("http://") && !serverDistBase.startsWith("https://")) {
      const origin = typeof self !== "undefined" ? self.location?.origin : undefined;
      if (origin && (origin.startsWith("http://") || origin.startsWith("https://"))) {
        serverDistBase = `${origin}/static/devextensions/server/dist`;
        host.connection.console.info(`[wasm-parser] Using fallback serverDistBase: ${serverDistBase}`);
      }
    }

    host.setServerDistBase(serverDistBase);
    (globalThis as { serverDistBase?: string }).serverDistBase = serverDistBase;
    host.setLazyLoadParsers(Boolean(options?.lazyLoadParsers));
    host.setUseLocalMsl(useLocalMsl);
    host.setValidationServiceRef(validationService ?? null);
    host.setProjectDependenciesRef(projectDependencies);
    host.ensureSharedContext();
    const loaderCtx = getOrCreateLoaderContextImpl(host);
    loaderCtx.serverDistBase = serverDistBase;

    host.connection.sendNotification("modelscript/status", {
      state: "loading",
      message: "Initializing this.parser...",
    });

    let manifest: WasmManifestEntry[] = [];
    try {
      const manifestUrl = `${serverDistBase}/languages-manifest.json`;
      if (typeof fetch !== "undefined") {
        const resp = await fetch(manifestUrl);
        if (resp.ok) {
          manifest = (await resp.json()) as WasmManifestEntry[];
        }
      }
    } catch (err) {
      host.connection.console.warn(
        `[ParserService] Failed to fetch languages-manifest.json: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (!manifest || manifest.length === 0) {
      manifest = host.getManifest();
    } else {
      host.setManifest(manifest);
    }

    if (host.isLazyLoadParsers()) {
      const initialTargets = new Set<string>();
      if (options?.initialLanguageId) {
        initialTargets.add(host.resolveNormalizedLanguageId(options.initialLanguageId));
      }
      for (const doc of host.documents.all()) {
        initialTargets.add(host.resolveNormalizedLanguageId(doc.languageId || doc.uri));
      }
      await Promise.all(
        Array.from(initialTargets).map(async (langId) => {
          const entry = manifest.find((m) => m.id.toLowerCase() === langId.toLowerCase());
          if (entry && entry.wasm) {
            await loadSingleWasmEntryImpl(host, entry);
          }
        }),
      );
    } else {
      await Promise.all(manifest.map((entry) => loadSingleWasmEntryImpl(host, entry)));
    }

    if (typeof onParsersReady === "function") {
      try {
        onParsersReady();
      } catch (cbErr) {
        host.connection.console.error(`[lsp] onParsersReady early callback error: ${cbErr}`);
      }
    }

    host.ensureSharedContext();

    host.connection.console.info(
      `[lsp] Parser ready. Early-validating ${host.documents.all().length} open documents for syntax errors.`,
    );
    for (const doc of host.documents.all()) {
      try {
        await validationService?.validateTextDocument?.(doc);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        host.connection.console.warn(`[lsp] Early validation failed for ${doc.uri}: ${msg}`);
      }
    }

    const cacheStore = loaderCtx.cacheStore;
    const isNodeRuntime = typeof process !== "undefined" && Boolean(process.versions?.node);
    const MAX_MEMOS = isNodeRuntime ? 2_000_000 : 200_000;

    try {
      const modelicaWs = host.workspaceManager.getWorkspaceIndex("modelica") as
        { getIndex?: (opts?: { eager?: boolean }) => SymbolIndex } | undefined;
      const unified = modelicaWs?.getIndex?.({ eager: true }) ?? host.workspaceManager.unifiedWorkspace?.getIndex?.();
      if (unified) {
        host.workspaceManager.globalModelicaQueryEngine = createModelicaQueryEngine(
          unified,
          { getText: () => null, getNode: () => null },
          cacheStore,
          MAX_MEMOS,
        );
      }
    } catch (qeErr: unknown) {
      const msg = qeErr instanceof Error ? qeErr.message : String(qeErr);
      host.connection.console.warn(`[lsp] Failed to initialize globalModelicaQueryEngine: ${msg}`);
    }
    const sharedContext = host.getSharedContext();
    if (sharedContext) {
      sharedContext.queryEngine = host.workspaceManager.globalModelicaQueryEngine;
    }
    host.workspaceManager.globalModelicaQueryEngine?.updateTree(host.getSharedCstTreeWrapper());

    if (typeof onParsersReady === "function") {
      try {
        onParsersReady();
      } catch (cbErr) {
        host.connection.console.error(`[lsp] onParsersReady callback error: ${cbErr}`);
      }
    }

    loaderCtx.globalWorkspaceIndex = host.workspaceManager.getWorkspaceIndex("modelica") ?? null;
    loaderCtx.sysml2WorkspaceIndex = host.workspaceManager.getWorkspaceIndex("sysml2") ?? null;
    loaderCtx.sysml2Parser = host.getParser("sysml2");
    loaderCtx.sharedContext = sharedContext;

    if (host.isLazyLoadParsers()) {
      const initialTargets = new Set<string>();
      if (options?.initialLanguageId) {
        initialTargets.add(host.resolveNormalizedLanguageId(options.initialLanguageId));
      }
      for (const doc of host.documents.all()) {
        initialTargets.add(host.resolveNormalizedLanguageId(doc.languageId || doc.uri));
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
          stdlibPromises.push(ensureStdlibForLanguageImpl(host, langId));
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
              host.connection.console.warn(`[lsp] Failed to load custom dependency ${dep.name}@${dep.version}: ${err}`);
            } finally {
              if (validationService) {
                validationService.markDependencyLoaded(dep.name, dep.version);
              }
            }
          })(),
        );
      }
      if (stdlibPromises.length > 0) {
        void Promise.all(stdlibPromises).then(() => {
          host.sendProjectTreeChanged();
        });
      } else {
        host.sendProjectTreeChanged();
        host.connection.sendNotification("modelscript/status", {
          state: "ready",
          message: host.getReadyMessage(),
        });
      }
      return;
    }

    host.connection.sendNotification("modelscript/status", {
      state: "loading",
      message: "ModelScript (loading libraries...)",
    });

    if (validationService) {
      for (const dep of projectDependencies) {
        validationService.declaredDependencies.push(dep);
      }
    }

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
              host.connection.console.warn(
                `[lsp] Registry load failed for Modelica, falling back to local MSL zip: ${regErr}`,
              );
              await loadMSL(serverDistBase, loaderCtx, dep.version, { skipRegistryRetry: true });
            } else if (dep.name === "SysML") {
              host.connection.console.warn(
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
        host.connection.console.warn(`[lsp] Failed to load ${dep.name}@${dep.version}: ${err}`);
        if (validationService) validationService.markDependencyLoaded(dep.name, dep.version);
      }
    });

    await Promise.all(loadPromises);

    host.connection.console.info(`[lsp] Dependencies loaded. Re-validating open documents.`);
    clearIconCache();
    host.clearDiagramCache();

    const validationServiceRef = host.getValidationServiceRef();
    for (const doc of host.documents.all()) {
      const langId = (doc.languageId || "").toLowerCase();
      if (langId === "step" && doc.getText().length > 262_144) continue;
      try {
        await validationServiceRef?.validateTextDocument?.(doc);
      } catch (err) {
        host.connection.console.warn(`[lsp] Failed to validate open document on init: ${err}`);
      }
    }

    host.sendProjectTreeChanged();

    host.connection.sendNotification("modelscript/status", {
      state: "ready",
      message: host.getReadyMessage(),
    });
  } catch (e: unknown) {
    const stack = e instanceof Error ? (e.stack ?? "") : "";
    host.connection.console.error(`Failed to initialize WASM parsers: ${e}\n${stack}`);
    host.setParserReady(false);
    host.connection.sendNotification("modelscript/status", {
      state: "error",
      message: "Parser initialization failed",
    });
  }
}
