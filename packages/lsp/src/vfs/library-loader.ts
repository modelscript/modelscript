// SPDX-License-Identifier: AGPL-3.0-or-later

import type { BrowserFileSystem } from "./browser-file-system.js";
import {
  getSalsaIndexCache,
  idbGet,
  idbPut,
  MSL_VERSION_KEY,
  openMSLCache,
  putSalsaIndexCache,
} from "./browser-file-system.js";

import { loadPrebakedMslIcons } from "@modelscript/modelica/diagram";
import {
  globalLibraryRegistry,
  mountPackageIndex,
  MSIDX_COMPILER_ABI_VERSION,
  type ModelscriptLibraryManifest,
  type SymbolIndex,
} from "@modelscript/runtime";
import type { FederatedQueryCacheStore } from "@modelscript/runtime/wasm_cache_store.js";
import { strFromU8, unzipSync } from "fflate";
import { iconCache } from "../handlers/treeHandler.js";
import { globalLanguageRegistry } from "../registry/LanguageRegistry.js";
import type { Parser, SyntaxNode, Tree } from "../utils/cst-facade.js";
import {
  getLibraryName,
  loadingLibraryState,
  mountedLibraryMetadata,
  normalizeLibraryName,
  type MountedLibraryInfo,
} from "../utils/hierarchy-utils.js";
import {
  extractModelicaPackageAndNestedSplit,
  extractModelicaUsesDeps,
  extractSysmlAtAnnotationDeps,
  trimOuterChars,
} from "../utils/lexical-utils.js";
import { findCuratedPackageFallback } from "./curated-package-fallbacks.js";
import { ingestSalsaIndex, type SalsaQueryEngineLike } from "./salsa-index-ingester.js";

export interface LoaderQueryEngineLike extends SalsaQueryEngineLike {
  index?: SymbolIndex | undefined;
}

export interface LoaderSharedContextLike {
  queryEngine?: unknown;
  parse(ext: string, text: string): Tree | null;
}

export interface LoaderWorkspaceIndexLike {
  register?(uri: string, loader: () => SyntaxNode | null, parentFQN?: string): void;
  getFileIndex?(uri: string): unknown;
  ensureIndexed?(uri: string): unknown;
  hydrate?(
    uri: string,
    payload: {
      symbols: Map<number, HydratedSymbolLike>;
      byName: Map<string, number[]>;
      childrenOf: Map<number | null, number[]>;
    },
    version?: unknown,
    mapResourceId?: (origPath: string) => string,
  ): void;
  clear?(uri: string): void;
  fileLoaders?: Map<string, unknown> | undefined;
  fileSymbols?: Map<string, unknown> | undefined;
  unifiedTreeIndex?: { symbols?: Map<number, { resourceId?: string }> } | undefined;
  getIndex?(): { symbols?: Map<number, { resourceId?: string }> } | undefined;
  getLanguageDef?(langId: string): unknown;
  registerLanguageDef?(langId: string, langDef: unknown): void;
  indexDocumentText?(uri: string, text: string, langId: string): void;
}

interface CachedLspBundle {
  indexJson: {
    symbols?: [number | string, HydratedSymbolLike][] | Record<string, HydratedSymbolLike> | undefined;
    byName?: [string, number[]][] | undefined;
    childrenOf?: [number | null, number[]][] | undefined;
  } | null;
  indexMsidxBase64: string | null;
  iconsJson: Record<string, string> | null;
  files: Record<string, string>;
  binaryFilesBase64: Record<string, string>;
}

interface GlobalLoaderEnv {
  globalModelicaQueryEngine?: LoaderQueryEngineLike;
  serverDistBase?: string;
}

export interface LoaderContext {
  connectionState: { sendNotification: (method: string, params: unknown) => void };
  logger: { log: (msg: string) => void; warn: (msg: string) => void; error: (msg: string, e: unknown) => void };
  sharedFs: BrowserFileSystem;
  sharedContext: LoaderSharedContextLike | null | undefined;
  globalWorkspaceIndex: LoaderWorkspaceIndexLike | null | undefined;
  sysml2WorkspaceIndex: LoaderWorkspaceIndexLike | null | undefined;
  documentTrees: Map<string, { text: string; tree: Tree | null; classCache: Map<string, unknown> }>;
  sysml2Parser: Parser | null;
  cacheStore?: FederatedQueryCacheStore | undefined;
  registryUrl?: string | undefined;
  federatedEndpoints: string[];
}
/**
 * Largest file in the Modelica Standard Library (MSL 4.1.0) is
 * `Modelica/Media/IdealGases/Common/SingleGasesData.mo` (649,910 bytes ≈ 635 KB).
 */
export const LARGEST_MSL_FILE_SIZE = 649_910;

/** Multiplier for safe package size limit (3x largest MSL file). */
export const SAFE_PACKAGE_SIZE_MULTIPLIER = 3;

/**
 * Safe package size limit set to 3x the largest MSL file (~1.95 MB).
 * Files below this threshold will NOT be truncated, ensuring full indexation
 * of all MSL packages, nested classes, and annotations.
 */
export const SAFE_PACKAGE_SIZE_LIMIT = LARGEST_MSL_FILE_SIZE * SAFE_PACKAGE_SIZE_MULTIPLIER; // 1,949,730 bytes (~1.95 MB)

const warnedLargeFiles = new Set<string>();

export function decodeBase64Bytes(b64: string): Uint8Array {
  const bin = atob(b64.replace(/[^A-Za-z0-9+/=]/g, ""));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    out[i] = bin.charCodeAt(i);
  }
  return out;
}

export function encodeBytesBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) {
    bin += String.fromCharCode(bytes[i]!);
  }
  return btoa(bin);
}

function isSysmlSourcePath(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  return lower.endsWith(".sysml") || lower.endsWith(".sysml2") || lower.endsWith(".kerml");
}

function mountSysmlEntriesInContext(
  entries: Array<{ fullPath: string; content: string }>,
  ctx: LoaderContext,
  registerWorkspace = true,
): string[] {
  const registeredUris: string[] = [];
  for (const { fullPath, content } of entries) {
    if (!isSysmlSourcePath(fullPath)) continue;
    const uri = fullPath.startsWith("file://") ? fullPath : `file://${fullPath.startsWith("/") ? "" : "/"}${fullPath}`;
    ctx.documentTrees?.set(uri, { text: content, tree: null, classCache: new Map() });
    if (registerWorkspace && ctx.sysml2WorkspaceIndex) {
      ctx.sysml2WorkspaceIndex.register?.(uri, () => {
        if (!ctx.sysml2Parser)
          return null as unknown as ReturnType<NonNullable<LoaderContext["sysml2Parser"]>["parse"]>["rootNode"];
        const tree = ctx.sysml2Parser.parse(content);
        if (tree) {
          setTimeout(() => {
            try {
              (tree as { delete?(): void }).delete?.();
            } catch {
              /* ignore */
            }
          }, 0);
        }
        return (tree ? tree.rootNode : null) as unknown as ReturnType<
          NonNullable<LoaderContext["sysml2Parser"]>["parse"]
        >["rootNode"];
      });
      registeredUris.push(uri);
    }
  }
  return registeredUris;
}

interface HydratedSymbolLike {
  language?: unknown;
  resourceId?: unknown;
}

function partitionBundlePayload(
  subsetIds: Set<number>,
  allSymbols: [number, HydratedSymbolLike][],
  byNameRaw: [string, number[]][],
  childrenOfRaw: [number | null, number[]][],
) {
  const symbols = new Map<number, HydratedSymbolLike>(allSymbols.filter(([id]) => subsetIds.has(id)));
  const byName = new Map<string, number[]>();
  for (const [name, ids] of byNameRaw) {
    const filtered = ids.filter((id) => subsetIds.has(id));
    if (filtered.length > 0) byName.set(name, filtered);
  }
  const childrenOf = new Map<number | null, number[]>();
  for (const [parentId, cIds] of childrenOfRaw) {
    if (parentId !== null && !subsetIds.has(parentId)) continue;
    const filtered = cIds.filter((id) => subsetIds.has(id));
    if (filtered.length > 0) childrenOf.set(parentId, filtered);
  }
  return { symbols, byName, childrenOf };
}

function hydrateMultiLanguageBundle(
  uri: string,
  parsedIndex: {
    symbols?: [number | string, HydratedSymbolLike][] | Record<string, HydratedSymbolLike> | undefined;
    byName?: [string, number[]][] | undefined;
    childrenOf?: [number | null, number[]][] | undefined;
  },
  mapResourceId: (origPath: string) => string,
  ctx: LoaderContext,
): number {
  const rawSymbols: [number, HydratedSymbolLike][] = Array.isArray(parsedIndex.symbols)
    ? parsedIndex.symbols.map(([id, entry]) => [Number(id), entry])
    : Object.entries(parsedIndex.symbols ?? {}).map(([id, entry]) => [Number(id), entry]);
  const byNameRaw: [string, number[]][] = Array.isArray(parsedIndex.byName) ? parsedIndex.byName : [];
  const childrenOfRaw: [number | null, number[]][] = Array.isArray(parsedIndex.childrenOf)
    ? parsedIndex.childrenOf
    : [];

  const sysmlIds = new Set<number>();
  const otherIds = new Set<number>();
  for (const [id, entry] of rawSymbols) {
    const lang = String(entry?.language ?? "").toLowerCase();
    const resId = String(entry?.resourceId ?? "");
    if (lang === "sysml2" || lang === "sysml" || lang === "kerml" || isSysmlSourcePath(resId)) {
      sysmlIds.add(id);
    } else {
      otherIds.add(id);
    }
  }

  if (sysmlIds.size > 0 && ctx.sysml2WorkspaceIndex?.hydrate) {
    const sysmlPayload = partitionBundlePayload(sysmlIds, rawSymbols, byNameRaw, childrenOfRaw);
    ctx.sysml2WorkspaceIndex.hydrate(uri, sysmlPayload, undefined, mapResourceId);
  }
  if (otherIds.size > 0 && ctx.globalWorkspaceIndex?.hydrate) {
    const otherPayload = partitionBundlePayload(otherIds, rawSymbols, byNameRaw, childrenOfRaw);
    ctx.globalWorkspaceIndex.hydrate(uri, otherPayload, undefined, mapResourceId);
  } else if (sysmlIds.size === 0 && rawSymbols.length > 0 && ctx.globalWorkspaceIndex?.hydrate) {
    ctx.globalWorkspaceIndex.hydrate(
      uri,
      {
        symbols: new Map(rawSymbols),
        byName: new Map(byNameRaw),
        childrenOf: new Map(childrenOfRaw),
      },
      undefined,
      mapResourceId,
    );
  }
  return rawSymbols.length;
}

async function registerRuntimeAssetsFromPackage(
  pkgName: string,
  version: string,
  opts: {
    files?: Record<string, string> | undefined;
    modelscript?: Record<string, unknown> | undefined;
    wasmBase64?: string | undefined;
    tables?: Record<string, unknown> | undefined;
    binaryFiles?: Record<string, Uint8Array> | undefined;
  },
): Promise<Partial<MountedLibraryInfo>> {
  let manifestMeta: Record<string, unknown> | undefined = opts.modelscript;
  const files = opts.files ?? {};
  const pkgJsonContent = files["package.json"] ?? files["sources/package.json"];
  if (!manifestMeta && typeof pkgJsonContent === "string") {
    try {
      const parsed = JSON.parse(pkgJsonContent) as Record<string, unknown>;
      if (parsed["modelscript"] && typeof parsed["modelscript"] === "object") {
        manifestMeta = parsed["modelscript"] as Record<string, unknown>;
      }
    } catch {
      /* ignore */
    }
  }
  if (!manifestMeta) return {};

  const cat = manifestMeta["category"];
  const stdRaw = manifestMeta["standard"] as Record<string, unknown> | undefined;
  const langs = Array.isArray(manifestMeta["languages"])
    ? manifestMeta["languages"].filter((l): l is string => typeof l === "string")
    : typeof manifestMeta["language"] === "string"
      ? [manifestMeta["language"]]
      : [];

  let tables: Record<string, unknown> | undefined = opts.tables ? { ...opts.tables } : undefined;
  const runtimeRaw = manifestMeta["runtime"] as
    { wasm?: string | undefined; tables?: Record<string, string> | undefined } | undefined;
  if (runtimeRaw?.tables && typeof runtimeRaw.tables === "object") {
    tables ??= {};
    for (const [k, rel] of Object.entries(runtimeRaw.tables)) {
      if (tables[k] !== undefined) continue;
      const cleanRel = rel.replace(/^\.\//, "");
      const text = files[cleanRel] ?? files[rel] ?? files[`sources/${cleanRel}`];
      if (typeof text === "string") {
        try {
          tables[k] = JSON.parse(text);
        } catch {
          /* ignore */
        }
      }
    }
  }

  let wasmBytes: Uint8Array | undefined;
  if (opts.wasmBase64) {
    wasmBytes = decodeBase64Bytes(opts.wasmBase64);
  } else if (runtimeRaw?.wasm && opts.binaryFiles) {
    const cleanWasm = runtimeRaw.wasm.replace(/^\.\//, "");
    wasmBytes = opts.binaryFiles[cleanWasm] ?? opts.binaryFiles[`sources/${cleanWasm}`];
  }

  if (cat === "library" || cat === "standard-pack" || stdRaw) {
    const normalizedManifest: ModelscriptLibraryManifest = {
      ...(manifestMeta as unknown as ModelscriptLibraryManifest),
      category: cat === "standard-pack" || stdRaw ? "standard-pack" : "library",
      ...(langs[0] ? { language: langs[0] } : {}),
      ...(langs.length > 0 ? { languages: langs } : {}),
    };
    const loaded = globalLibraryRegistry.registerLibraryBundle(
      { name: pkgName, version, modelscript: normalizedManifest },
      { wasmBytes, tables },
    );
    if (loaded.wasmBytes && !loaded.wasmExports) {
      await globalLibraryRegistry.ensureWasmInstantiated(loaded);
    }
  }

  return {
    language: langs[0] ?? (stdRaw ? "sysml2" : undefined),
    category: cat === "standard-pack" || stdRaw ? "standard-pack" : "library",
    standardCode: typeof stdRaw?.["code"] === "string" ? stdRaw["code"] : undefined,
    standardEdition: typeof stdRaw?.["edition"] === "string" ? stdRaw["edition"] : undefined,
    profile: typeof stdRaw?.["profile"] === "string" ? stdRaw["profile"] : undefined,
    activation:
      stdRaw?.["activation"] === "workspace" || stdRaw?.["activation"] === "explicit"
        ? (stdRaw["activation"] as "workspace" | "explicit")
        : stdRaw
          ? "import"
          : undefined,
  };
}

export function getSafePackageSource(text: string, fullPath: string, ctx?: LoaderContext): string {
  if (text.length <= SAFE_PACKAGE_SIZE_LIMIT) return text;
  // Don't truncate icon definition files — their nested class definitions
  // (e.g. Icons.Package, Icons.ExamplesPackage) are essential for extends
  // resolution during icon rendering of sub-packages.
  if (fullPath.endsWith("/Icons.mo")) return text;
  const splitInfo = extractModelicaPackageAndNestedSplit(text);
  if (!splitInfo) return text;
  const pkgName = splitInfo.pkgName;
  if (splitInfo.nestedOffset >= 0) {
    if (!warnedLargeFiles.has(fullPath)) {
      warnedLargeFiles.add(fullPath);
      const sizeMB = (text.length / (1024 * 1024)).toFixed(2);
      const limitMB = (SAFE_PACKAGE_SIZE_LIMIT / (1024 * 1024)).toFixed(2);
      const msg = `Modelica file "${fullPath}" (${sizeMB} MB) exceeds the safe limit (${limitMB} MB). Nested package contents were truncated to maintain editor responsiveness.`;
      ctx?.logger?.warn?.(msg);
      ctx?.connectionState?.sendNotification?.("window/showMessage", {
        type: 2, // MessageType.Warning
        message: msg,
      });
      ctx?.connectionState?.sendNotification?.("modelscript/warning", {
        message: msg,
      });
    }
    const header = text.slice(0, splitInfo.nestedOffset);
    return `${header}\nend ${pkgName};`;
  }
  return text;
}

// ── Registry package loading ────────────────────────────────────
// Loads ModelScript packages installed via npm (from node_modules/)
// into the global workspace index for cross-file resolution.

/**
 * ModelScript package descriptor sent by the client (VS Code extension)
 * after scanning node_modules/ for packages with `modelscript` metadata.
 */
export interface RegistryPackageInfo {
  /** Package name (e.g., "@modelscript/motor-library"). */
  name: string;
  /** Package version. */
  version: string;
  /**
   * Map of relative paths → file contents for package source/data files.
   * Keys are relative to the package root (e.g., "Motor/package.mo", "src/asme.sysml").
   */
  files: Record<string, string>;
  /** Optional modelscript metadata from package.json. */
  modelscript?:
    | ({
        languages?: string[] | undefined;
        main?: string | undefined;
        modelicaVersion?: string | undefined;
      } & Partial<ModelscriptLibraryManifest>)
    | undefined;
  /** Optional pre-loaded lookup tables keyed by runtime.tables entry name. */
  tables?: Record<string, unknown> | undefined;
  /** Optional base64-encoded sandboxed WASM runtime bytes. */
  wasmBase64?: string | undefined;
}

/**
 * Load a ModelScript registry package into the workspace.
 *
 * Called when the client discovers an installed package in node_modules/
 * that contains `modelscript` metadata in its package.json.
 *
 * Files are written to the BrowserFileSystem under /packages/{name}/
 * and registered lazily in the globalWorkspaceIndex.
 */
export async function loadRegistryPackage(
  pkg: RegistryPackageInfo,
  ctx: LoaderContext,
  options?: { skipRemoteIndex?: boolean },
): Promise<void> {
  const normName = normalizeLibraryName(pkg.name);
  const existingMeta = mountedLibraryMetadata.get(normName);
  if (existingMeta && existingMeta.version !== pkg.version) {
    unloadLibraryPackage(normName, ctx);
  }
  try {
    const safeName = pkg.name.replace(/\//g, "_").replace(/^@/, "");
    const basePath = `/packages/${safeName}`;
    const label = `${pkg.name}@${pkg.version}`;

    loadingLibraryState.set(normName, {
      name: normName,
      version: pkg.version,
      message: "Indexing package...",
    });
    ctx.connectionState.sendNotification("modelscript/projectTreeChanged", {});

    ctx.logger.log(`[registry] Loading package ${label} (${Object.keys(pkg.files).length} files)`);
    ctx.connectionState.sendNotification("modelscript/status", {
      state: "loading",
      message: `Loading ${label}...`,
    });

    // Register federated endpoint for cache store using the configured registry URL
    let baseUrl = "";
    if (!options?.skipRemoteIndex && ctx.registryUrl) {
      baseUrl = ctx.registryUrl.replace(/\/$/, "");
    }

    if (ctx.federatedEndpoints && baseUrl) {
      const endpoint = `${baseUrl}/api/v1/libraries/${encodeURIComponent(pkg.name)}/${encodeURIComponent(pkg.version)}/memos`;
      if (!ctx.federatedEndpoints.includes(endpoint)) {
        ctx.federatedEndpoints.push(endpoint);
        ctx.logger.log(`[registry] Registered federated endpoint: ${endpoint}`);
      }
    }

    if (ctx.cacheStore) {
      const activeQueryEngine =
        (ctx.sharedContext?.queryEngine as LoaderQueryEngineLike | undefined) ??
        (globalThis as GlobalLoaderEnv).globalModelicaQueryEngine;
      const msidxCacheKey = `msidx:abi${MSIDX_COMPILER_ABI_VERSION}:${pkg.name}@${pkg.version}`;
      const legacyCacheKey = `${pkg.name}@${pkg.version}`;
      let hydratedFromMsidx = false;

      // 1. Try ABI-versioned relocatable binary index (.msidx) from IndexedDB or registry
      let msidxBuffer: ArrayBuffer | undefined;
      try {
        msidxBuffer = await getSalsaIndexCache(msidxCacheKey);
      } catch (err) {
        ctx.logger.warn(`[registry] IndexedDB read failed for index.msidx of ${label}: ${err}`);
      }

      if (msidxBuffer && activeQueryEngine?.index) {
        try {
          const mounted = mountPackageIndex(new Uint8Array(msidxBuffer), {
            targetIndex: activeQueryEngine.index,
            resolveResourceUri: (rel) => `file://${basePath}/${rel}`,
          });
          ctx.logger.log(`[registry] Cache hit — mounted ${mounted.symbolCount} symbols from index.msidx for ${label}`);
          hydratedFromMsidx = true;
        } catch (err) {
          ctx.logger.warn(`[registry] Cached index.msidx invalid for ${label}, refetching: ${err}`);
        }
      }

      if (!hydratedFromMsidx && baseUrl && activeQueryEngine?.index) {
        const msidxUrl = `${baseUrl}/api/v1/libraries/${encodeURIComponent(pkg.name)}/${encodeURIComponent(pkg.version)}/index.msidx`;
        try {
          const resp = await fetch(msidxUrl);
          if (resp.ok) {
            const buffer = await resp.arrayBuffer();
            const mounted = mountPackageIndex(new Uint8Array(buffer), {
              targetIndex: activeQueryEngine.index,
              resolveResourceUri: (rel) => `file://${basePath}/${rel}`,
            });
            ctx.logger.log(
              `[registry] Loaded binary index.msidx for ${label} (mounted ${mounted.symbolCount} symbols)`,
            );
            hydratedFromMsidx = true;
            try {
              await putSalsaIndexCache(msidxCacheKey, buffer);
            } catch (cacheErr) {
              ctx.logger.warn(`[registry] IndexedDB write failed for index.msidx of ${label}: ${cacheErr}`);
            }
          }
        } catch (err) {
          ctx.logger.warn(`[registry] Failed to fetch index.msidx for ${label}: ${err}`);
        }
      }

      // 2. Legacy fallback: salsa-index.db
      if (!hydratedFromMsidx) {
        let dbBuffer: ArrayBuffer | undefined;
        try {
          dbBuffer = await getSalsaIndexCache(legacyCacheKey);
        } catch (err) {
          ctx.logger.warn(`[registry] IndexedDB read failed for salsa-index of ${label}: ${err}`);
        }

        if (dbBuffer) {
          ctx.logger.log(`[registry] Cache hit — loading salsa-index for ${label} from IndexedDB`);
          const { memos } = await ingestSalsaIndex(dbBuffer, ctx.cacheStore, activeQueryEngine);
          ctx.logger.log(`[registry] Hydrated ${memos} memos from cached index for ${label}`);
        } else if (baseUrl) {
          const indexUrl = `${baseUrl}/api/v1/libraries/${encodeURIComponent(pkg.name)}/${encodeURIComponent(pkg.version)}/salsa-index.db`;
          try {
            const resp = await fetch(indexUrl);
            if (resp.ok) {
              const buffer = await resp.arrayBuffer();
              const { memos } = await ingestSalsaIndex(buffer, ctx.cacheStore, activeQueryEngine);
              ctx.logger.log(`[registry] Loaded pre-computed index for ${label} (hydrated ${memos} memos)`);

              try {
                await putSalsaIndexCache(legacyCacheKey, buffer);
                ctx.logger.log(`[registry] Cached salsa-index for ${label} in IndexedDB`);
              } catch (cacheErr) {
                ctx.logger.warn(`[registry] IndexedDB write failed for salsa-index of ${label}: ${cacheErr}`);
              }
            } else {
              ctx.logger.warn(`[registry] Pre-computed index not available for ${label} (HTTP ${resp.status})`);
            }
          } catch (err) {
            ctx.logger.warn(`[registry] Failed to fetch pre-computed index for ${label}: ${err}`);
          }
        }
      }
    }

    // Write files to the VFS
    let fileCount = 0;
    const sysmlEntries: Array<{ fullPath: string; content: string }> = [];
    const encoder = new TextEncoder();
    for (const [relPath, content] of Object.entries(pkg.files)) {
      const fullPath = `${basePath}/${relPath}`;

      // Ensure parent directories exist
      const parts = fullPath.split("/");
      for (let i = 2; i < parts.length; i++) {
        const dir = parts.slice(0, i).join("/");
        try {
          ctx.sharedFs.addDir(dir);
        } catch {
          /* dir already exists */
        }
      }

      ctx.sharedFs.addFile(fullPath, encoder.encode(content));
      if (isSysmlSourcePath(fullPath)) {
        sysmlEntries.push({ fullPath, content });
      }
      fileCount++;
    }

    // Add as a library to the shared context
    try {
      ctx.sharedFs.readdir(basePath);
    } catch (e) {
      ctx.logger.warn(`[registry] Failed to read directory ${basePath}: ${e}`);
    }
    // Register files in the global workspace index

    let registeredCount = 0;
    const registeredUris: string[] = [];
    const registerDirLazy = (dir: string) => {
      try {
        const entries = [...ctx.sharedFs.readdir(dir)].sort((a, b) => {
          if (a.name === "package.mo") return -1;
          if (b.name === "package.mo") return 1;
          return a.name.localeCompare(b.name);
        });
        for (const entry of entries) {
          const fullPath = ctx.sharedFs.join(dir, entry.name);
          if (entry.isDirectory()) {
            registerDirLazy(fullPath);
          } else if (entry.name.endsWith(".mo") || entry.name.endsWith(".msim")) {
            const uri = `modelica:/${fullPath}`;
            let parentFQN = "";

            // Compute the parent FQN from the file path
            const relPath = fullPath.substring(basePath.length + 1); // strip basePath + "/"
            const pathParts = relPath.split("/");
            if (pathParts[pathParts.length - 1] === "package.mo") {
              pathParts.pop(); // Remove "package.mo"
              pathParts.pop(); // Remove the package dir name
            } else {
              pathParts.pop(); // Remove "Filename.mo"
            }
            // First part may contain spaces (e.g., "Motor Library v1"), take first word
            if (pathParts.length > 0) {
              pathParts[0] = pathParts[0]!.split(" ")[0]!;
            }
            parentFQN = pathParts.join(".");

            ctx.globalWorkspaceIndex?.register?.(
              uri,
              () => {
                let tree: Tree | null = null;
                try {
                  let text = ctx.sharedFs.read(fullPath);
                  if (text) {
                    if (text.length > SAFE_PACKAGE_SIZE_LIMIT) {
                      text = getSafePackageSource(text, fullPath, ctx);
                    }
                    tree = ctx.sharedContext?.parse(".mo", text) ?? null;
                  }
                } catch {
                  /* ignore */
                }
                if (tree) {
                  // WorkspaceIndex uses the node synchronously.
                  // Schedule deletion to avoid WASM memory leaks.
                  setTimeout(() => {
                    try {
                      (tree as { delete?(): void }).delete?.();
                    } catch {
                      /* ignore */
                    }
                  }, 0);
                }
                return tree?.rootNode ?? null;
              },
              parentFQN,
            );
            registeredUris.push(uri);
            registeredCount++;
          }
        }
      } catch {
        /* ignore */
      }
    };
    registerDirLazy(basePath);

    // Mount SysML v2 / KerML sources into sysml2WorkspaceIndex and documentTrees
    const sysmlUris = mountSysmlEntriesInContext(sysmlEntries, ctx, true);
    registeredCount += sysmlUris.length;

    // Eagerly trigger indexing for all registered files so their symbols
    // appear in getIndex() and are available for name resolution.
    // Without this, lazy-registered files are invisible to the validation pipeline.
    let indexedCount = 0;
    let indexErrors = 0;
    for (const uri of registeredUris) {
      try {
        ctx.globalWorkspaceIndex?.getFileIndex?.(uri);
        indexedCount++;
      } catch (err) {
        indexErrors++;
        if (indexErrors <= 3) {
          ctx.logger.warn(`[registry] Index error for ${uri}: ${err}`);
        }
      }
    }
    for (const sysmlUri of sysmlUris) {
      try {
        ctx.sysml2WorkspaceIndex?.getFileIndex?.(sysmlUri);
        indexedCount++;
      } catch (err) {
        indexErrors++;
        if (indexErrors <= 3) {
          ctx.logger.warn(`[registry] SysML index error for ${sysmlUri}: ${err}`);
        }
      }
    }
    if (indexErrors > 3) {
      ctx.logger.warn(`[registry] ... and ${indexErrors - 3} more indexing errors`);
    }

    const runtimeMeta = await registerRuntimeAssetsFromPackage(pkg.name, pkg.version, {
      files: pkg.files,
      modelscript: pkg.modelscript as Record<string, unknown> | undefined,
      wasmBase64: pkg.wasmBase64,
      tables: pkg.tables,
    });

    loadingLibraryState.delete(normName);
    mountedLibraryMetadata.set(normName, {
      ...runtimeMeta,
      name: normName,
      version: pkg.version,
      language: runtimeMeta.language ?? pkg.modelscript?.languages?.[0],
    });
    ctx.connectionState.sendNotification("modelscript/projectTreeChanged", {});

    ctx.logger.log(
      `[registry] Loaded ${label}: ${fileCount} files, ${registeredCount} registered, ${indexedCount} indexed`,
    );
  } catch (e) {
    loadingLibraryState.delete(normName);
    ctx.connectionState.sendNotification("modelscript/projectTreeChanged", {});
    ctx.logger.error(`[registry] Failed to load package ${pkg.name}:`, e);
  }
}

/**
 * Load all registry packages provided by the client.
 * Called after MSL loading when the client sends discovered packages.
 */
export async function loadRegistryPackages(packages: RegistryPackageInfo[], ctx: LoaderContext): Promise<void> {
  if (packages.length === 0) return;

  ctx.logger.log(`[registry] Loading ${packages.length} registry package(s)...`);

  for (const pkg of packages) {
    await loadRegistryPackage(pkg, ctx);
  }

  ctx.logger.log(`[registry] All registry packages loaded.`);
}

/**
 * Fetch a dependency's files from the registry and load it into the workspace.
 * Replaces hardcoded MSL/SysML loading paths.
 */
export async function loadDependencyFromRegistry(
  dep: { name: string; version: string },
  ctx: LoaderContext,
): Promise<void> {
  const normName = normalizeLibraryName(dep.name);
  const existingMeta = mountedLibraryMetadata.get(normName);
  if (existingMeta && existingMeta.version !== dep.version) {
    unloadLibraryPackage(normName, ctx);
  }
  const label = `${dep.name}@${dep.version}`;
  ctx.logger.log(`[deps] Loading ${label} from registry via LSP bundle...`);

  loadingLibraryState.set(normName, {
    name: normName,
    version: dep.version,
    message: "Fetching bundle...",
  });
  ctx.connectionState.sendNotification("modelscript/projectTreeChanged", {});

  try {
    let cached: CachedLspBundle | null = null;
    const db = await openMSLCache();
    try {
      const cacheKey = `lsp-bundle:dep:v4:${label}`;

      cached = (await idbGet<CachedLspBundle>(db, cacheKey)) ?? null;

      if (!cached || !cached.indexJson || !cached.files) {
        const baseUrl = ctx.registryUrl?.replace(/\/$/, "") || "http://127.0.0.1:3000";
        const res = await fetch(`${baseUrl}/api/v1/libraries/${dep.name}/${dep.version}/lsp-bundle`);

        if (!res.ok) {
          // ── Fallback: fetch raw source files and register lazily ──
          // The lsp-bundle may not exist if the publish-worker hasn't run yet.
          // Fall back to the /files endpoint which serves extracted .mo sources.
          ctx.logger.warn(
            `[deps] lsp-bundle not available for ${label} (HTTP ${res.status}), trying /files fallback...`,
          );

          const filesRes = await fetch(`${baseUrl}/api/v1/libraries/${dep.name}/${dep.version}/files`);
          if (!filesRes.ok) {
            throw new Error(
              `Neither lsp-bundle (HTTP ${res.status}) nor /files (HTTP ${filesRes.status}) available for ${label}`,
            );
          }

          const filesData = (await filesRes.json()) as { files: Record<string, string> };

          // The /files API returns paths relative to the library root (e.g., "Blocks/Continuous.mo")
          // but loadRegistryPackage expects paths that include the root package name (e.g., "Modelica/Blocks/Continuous.mo")
          // so the parentFQN computation can correctly determine the Modelica class hierarchy.
          const prefixedFiles: Record<string, string> = {};
          const fileKeys = Object.keys(filesData.files);
          const alreadyPrefixed = fileKeys.some((k) => k.startsWith(`${dep.name}/`) || k.startsWith(`${dep.name} `));
          for (const [relPath, content] of Object.entries(filesData.files)) {
            if (alreadyPrefixed || relPath.startsWith(`${dep.name}/`)) {
              prefixedFiles[relPath] = content;
            } else {
              prefixedFiles[`${dep.name}/${relPath}`] = content;
            }
          }

          const pkg: RegistryPackageInfo = {
            name: dep.name,
            version: dep.version,
            files: prefixedFiles,
          };

          ctx.logger.log(`[deps] Fallback: loading ${label} via /files (${Object.keys(pkg.files).length} files)`);
          await loadRegistryPackage(pkg, ctx);

          // Also try to fetch pre-rendered icons for the class tree
          try {
            const iconsRes = await fetch(`${baseUrl}/api/v1/libraries/${dep.name}/${dep.version}/icons`);
            if (iconsRes.ok) {
              const iconsData = (await iconsRes.json()) as { icons: Record<string, string> };
              let iconCount = 0;
              for (const [className, svg] of Object.entries(iconsData.icons)) {
                iconCache.set(`${normName}@${dep.version}:${className}`, svg);
                iconCache.set(className, svg);
                iconCount++;
              }
              ctx.logger.log(`[deps] Loaded ${iconCount} icons for ${label}`);
            }
          } catch {
            ctx.logger.warn(`[deps] Failed to fetch icons for ${label} (non-fatal)`);
          }
          loadingLibraryState.delete(normName);
          mountedLibraryMetadata.set(normName, {
            ...mountedLibraryMetadata.get(normName),
            name: normName,
            version: dep.version,
          });
          ctx.connectionState.sendNotification("modelscript/projectTreeChanged", {});
          return;
        }

        const buffer = await res.arrayBuffer();
        const zipped = unzipSync(new Uint8Array(buffer));

        let indexJson: CachedLspBundle["indexJson"] = null;
        let indexMsidxBase64: string | null = null;
        let iconsJson: Record<string, string> | null = null;
        const files: Record<string, string> = {};
        const binaryFilesBase64: Record<string, string> = {};

        for (const [relativePath, data] of Object.entries(zipped)) {
          if (data.length === 0) continue; // directory
          if (relativePath === "index.msidx") {
            indexMsidxBase64 = encodeBytesBase64(data);
          } else if (relativePath === "index.json") {
            indexJson = JSON.parse(strFromU8(data)) as CachedLspBundle["indexJson"];
          } else if (relativePath === "icons.json") {
            iconsJson = JSON.parse(strFromU8(data)) as Record<string, string>;
          } else if (relativePath.startsWith("sources/")) {
            const fileRelPath = relativePath.substring("sources/".length);
            if (fileRelPath.toLowerCase().endsWith(".wasm")) {
              binaryFilesBase64[fileRelPath] = encodeBytesBase64(data);
            } else {
              files[fileRelPath] = strFromU8(data);
            }
          } else if (relativePath === "package.json") {
            files["package.json"] = strFromU8(data);
          } else if (relativePath.toLowerCase().endsWith(".wasm")) {
            binaryFilesBase64[relativePath] = encodeBytesBase64(data);
          }
        }

        cached = { indexJson, indexMsidxBase64, iconsJson, files, binaryFilesBase64 };
        await idbPut(db, cacheKey, cached);
      }
    } finally {
      db.close();
    }

    // 1. Hydrate icons — from bundle first, then API fallback if empty
    let iconCount = 0;
    if (cached.iconsJson) {
      for (const [className, svg] of Object.entries(cached.iconsJson)) {
        iconCache.set(`${normName}@${dep.version}:${className}`, svg as string);
        iconCache.set(className, svg as string);
        iconCount++;
      }
    }

    // If the bundle had no icons (early bundle before SVG pass), fetch from API
    if (iconCount === 0) {
      const baseUrl = ctx.registryUrl?.replace(/\/$/, "") || "http://127.0.0.1:3000";
      try {
        const iconsRes = await fetch(`${baseUrl}/api/v1/libraries/${dep.name}/${dep.version}/icons`);
        if (iconsRes.ok) {
          const iconsData = (await iconsRes.json()) as { icons: Record<string, string> };
          for (const [className, svg] of Object.entries(iconsData.icons)) {
            iconCache.set(`${normName}@${dep.version}:${className}`, svg);
            iconCache.set(className, svg);
            iconCount++;
          }
          ctx.logger.log(`[deps] Loaded ${iconCount} icons for ${label} from API (bundle had none)`);
        }
      } catch {
        ctx.logger.warn(`[deps] Failed to fetch icons for ${label} from API (non-fatal)`);
      }
    }

    // 2. Load sources into VFS
    const pkg = { name: dep.name, version: dep.version, files: cached.files };
    // We bypass the lazy registration of `loadRegistryPackage` since we have a pre-computed index
    // But we still need the files in the VFS so hovers and goto-definition work!
    const basePath = `/modelscript_registry/${pkg.name}/${pkg.version}`;
    const encoder = new TextEncoder();
    let fileCount = 0;
    const sysmlEntries: Array<{ fullPath: string; content: string }> = [];
    const ensureParentDirs = (targetPath: string) => {
      const parts = targetPath.split("/");
      for (let i = 2; i < parts.length; i++) {
        const dir = parts.slice(0, i).join("/");
        try {
          ctx.sharedFs.addDir(dir);
        } catch {
          /* already exists */
        }
      }
    };
    for (const [relPath, content] of Object.entries(pkg.files)) {
      const fullPath = ctx.sharedFs.join(basePath, relPath);
      ensureParentDirs(fullPath);
      ctx.sharedFs.addFile(fullPath, encoder.encode(content as string));
      if (isSysmlSourcePath(fullPath)) {
        sysmlEntries.push({ fullPath, content: content as string });
      }
      fileCount++;
    }
    const binaryFiles: Record<string, Uint8Array> = {};
    if (cached.binaryFilesBase64 && typeof cached.binaryFilesBase64 === "object") {
      for (const [relPath, b64] of Object.entries(cached.binaryFilesBase64 as Record<string, string>)) {
        const bytes = decodeBase64Bytes(b64);
        binaryFiles[relPath] = bytes;
        const fullPath = ctx.sharedFs.join(basePath, relPath);
        ensureParentDirs(fullPath);
        ctx.sharedFs.addFile(fullPath, bytes);
        fileCount++;
      }
    }

    // Populate documentTrees (and lazy-index SysML files if bundle lacked an index)
    mountSysmlEntriesInContext(sysmlEntries, ctx, !cached.indexMsidxBase64 && !cached.indexJson);

    // 3. Hydrate WorkspaceIndex (prefer binary index.msidx, fall back to legacy index.json)
    const uri = `library-bundle:/${dep.name}@${dep.version}`;
    const mapResourceId = (origPath: string) => {
      if (origPath.startsWith("sources/")) {
        return "file://" + ctx.sharedFs.join(basePath, origPath.substring("sources/".length));
      }
      return "file://" + ctx.sharedFs.join(basePath, origPath);
    };

    let hydratedFromMsidx = false;
    if (cached.indexMsidxBase64) {
      try {
        const msidxBytes = decodeBase64Bytes(cached.indexMsidxBase64 as string);
        const mounted = mountPackageIndex(msidxBytes, { resolveResourceUri: mapResourceId });
        const symbolCount = hydrateMultiLanguageBundle(
          uri,
          {
            symbols: Array.from(mounted.index.symbols.entries()),
            byName: Array.from(mounted.index.byName.entries()),
            childrenOf: Array.from(mounted.index.childrenOf.entries()),
          },
          (p) => p,
          ctx,
        );
        ctx.logger.log(
          `[registry] Hydrated ${label} via binary index.msidx: ${fileCount} files, ${symbolCount} symbols.`,
        );
        hydratedFromMsidx = true;
      } catch (msidxErr) {
        ctx.logger.warn(`[registry] index.msidx mount failed for ${label}, falling back to index.json: ${msidxErr}`);
      }
    }

    if (!hydratedFromMsidx && cached.indexJson) {
      const symbolCount = hydrateMultiLanguageBundle(uri, cached.indexJson, mapResourceId, ctx);
      ctx.logger.log(`[registry] Hydrated ${label}: ${fileCount} files, index hydrated with ${symbolCount} symbols.`);
    }

    const runtimeMeta = await registerRuntimeAssetsFromPackage(dep.name, dep.version, {
      files: cached.files,
      binaryFiles,
    });

    loadingLibraryState.delete(normName);
    mountedLibraryMetadata.set(normName, {
      ...runtimeMeta,
      name: normName,
      version: dep.version,
    });
    ctx.connectionState.sendNotification("modelscript/projectTreeChanged", {});
  } catch (e) {
    const curated = findCuratedPackageFallback(dep.name);
    if (curated) {
      try {
        const effectiveVersion = dep.version || curated.version;
        if (curated.icons) {
          for (const [className, svg] of Object.entries(curated.icons)) {
            iconCache.set(`${normName}@${effectiveVersion}:${className}`, svg);
            iconCache.set(className, svg);
          }
        }
        // Native PSS/E standard dynamics models are already registered in UnifiedWorkspace via psseLanguage.indexing.builtins;
        // mounting the curated .mo stub would shadow their native port and DAE-lowering metadata.
        if (!(curated.language === "psse" && normName === "PSSE-Standard-Dynamics")) {
          await loadRegistryPackage(
            {
              name: curated.packageName,
              version: effectiveVersion,
              files: curated.files,
              modelscript: { languages: [curated.language] },
            },
            ctx,
            { skipRemoteIndex: true },
          );
        }
        loadingLibraryState.delete(normName);
        mountedLibraryMetadata.set(normName, {
          name: normName,
          version: effectiveVersion,
          language: curated.language,
        });
        ctx.connectionState.sendNotification("modelscript/projectTreeChanged", {});
        ctx.logger.log(`[deps] Mounted offline curated fallback for ${label}`);
        return;
      } catch (fallbackErr) {
        ctx.logger.warn(`[deps] Offline curated fallback failed for ${label}: ${fallbackErr}`);
      }
    }
    loadingLibraryState.delete(normName);
    ctx.connectionState.sendNotification("modelscript/projectTreeChanged", {});
    ctx.logger.error(`[deps] Failed to load ${label} from registry:`, e);
    throw e;
  }
}

export const SYSML_VERSION_KEY = "SysML-v2-Release-2026-03";

export async function loadMSL(
  serverDistBase: string,
  ctx: LoaderContext,
  version = "4.1.0",
  options?: { skipRegistryRetry?: boolean },
): Promise<void> {
  const existingMeta = mountedLibraryMetadata.get("Modelica");
  if (existingMeta && existingMeta.version !== version) {
    unloadLibraryPackage("Modelica", ctx);
  }
  const cacheKey = version === "4.1.0" ? MSL_VERSION_KEY : `ModelicaStandardLibrary_v${version}`;
  const zipFilename = `ModelicaStandardLibrary_v${version}.zip`;
  try {
    loadingLibraryState.set("Modelica", {
      name: "Modelica",
      version,
      message: `Loading MSL v${version}...`,
    });
    ctx.connectionState.sendNotification("modelscript/projectTreeChanged", {});
    ctx.connectionState.sendNotification("modelscript/status", {
      state: "loading",
      message: `Loading Modelica Standard Library v${version}...`,
    });

    let fileEntries: Record<string, Uint8Array> | null = null;

    try {
      const db = await openMSLCache();
      try {
        const cached = await idbGet<Record<string, ArrayBuffer>>(db, cacheKey);
        if (cached) {
          ctx.logger.log("[msl-cache] Cache hit — loading from IndexedDB");
          ctx.connectionState.sendNotification("modelscript/status", {
            state: "loading",
            message: "Loading MSL from cache...",
          });
          fileEntries = {};
          for (const [name, buf] of Object.entries(cached)) {
            fileEntries[name] = new Uint8Array(buf);
          }
        }
      } finally {
        db.close();
      }
    } catch (cacheErr) {
      ctx.logger.warn(`[msl-cache] IndexedDB read failed, falling back to network: ${cacheErr}`);
    }

    if (!fileEntries) {
      let zipData: Uint8Array | null = null;
      if (
        serverDistBase.startsWith("file://") ||
        (!serverDistBase.startsWith("http://") && !serverDistBase.startsWith("https://"))
      ) {
        const filePath = serverDistBase.startsWith("file://")
          ? serverDistBase.replace(/^file:\/\//, "")
          : serverDistBase;
        const zipPath = `${filePath}/${zipFilename}`;
        const nodeFs = await import("node:fs");
        if (nodeFs.existsSync(zipPath)) {
          zipData = nodeFs.readFileSync(zipPath);
        }
      } else {
        const response = await fetch(`${serverDistBase}/${zipFilename}`);
        if (response.ok) {
          ctx.connectionState.sendNotification("modelscript/status", {
            state: "loading",
            message: "Decompressing MSL...",
          });
          const buffer = await response.arrayBuffer();
          zipData = new Uint8Array(buffer);
        }
      }

      if (!zipData) {
        if (!options?.skipRegistryRetry && (ctx.registryUrl || version !== "4.1.0")) {
          try {
            await loadDependencyFromRegistry({ name: "Modelica", version }, ctx);
            return;
          } catch {
            // Fall through to warning
          }
        }
        loadingLibraryState.delete("Modelica");
        ctx.connectionState.sendNotification("modelscript/projectTreeChanged", {});
        ctx.logger.warn("MSL zip not found — library features will be unavailable");
        return;
      }

      fileEntries = unzipSync(zipData);

      // Cache extracted MSL in IndexedDB in the background so it doesn't block startup requests
      const entriesToCache = fileEntries;
      setTimeout(async () => {
        try {
          const db = await openMSLCache();
          try {
            const serializable: Record<string, ArrayBuffer> = {};
            for (const [name, data] of Object.entries(entriesToCache)) {
              serializable[name] =
                data.byteOffset === 0 && data.byteLength === data.buffer.byteLength
                  ? (data.buffer as ArrayBuffer)
                  : (data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer);
            }
            await idbPut(db, cacheKey, serializable);
            ctx.logger.log("[msl-cache] Cached extracted MSL in IndexedDB");
          } finally {
            db.close();
          }
        } catch (cacheErr) {
          ctx.logger.warn(`[msl-cache] IndexedDB write failed: ${cacheErr}`);
        }
      }, 500);
    }

    let fileCount = 0;
    for (const [name, data] of Object.entries(fileEntries)) {
      if (name.endsWith("/")) {
        ctx.sharedFs.addDir(`/lib/${name.slice(0, -1)}`);
        continue;
      }
      ctx.sharedFs.addFile(`/lib/${name}`, data);
      fileCount++;
    }
    ctx.logger.log(`MSL loaded: ${fileCount} files`);
    try {
      await loadPrebakedMslIcons(iconCache, serverDistBase);
    } catch {
      // non-fatal
    }
    ctx.connectionState.sendNotification("modelscript/status", {
      state: "loading",
      message: "Processing MSL classes...",
    });

    const moFiles: { fullPath: string; uri: string; parentFQN: string }[] = [];
    let modelicaPkgUri: string | null = null;
    let complexUri: string | null = null;
    let iconsUri: string | null = null;

    for (const name of Object.keys(fileEntries)) {
      if (name.endsWith(".mo")) {
        if (name.startsWith("ModelicaReference")) continue;
        const fullPath = `/lib/${name}`;
        const uri = `modelica:/${fullPath}`;
        let parentFQN = "";
        const parts = name.split("/");
        if (parts[parts.length - 1] === "package.mo") {
          parts.pop(); // Remove "package.mo"
          parts.pop(); // Remove the package dir name itself
        } else {
          parts.pop(); // Remove "Filename.mo"
        }
        if (parts.length > 0) {
          parts[0] = parts[0]!.split(" ")[0]!; // "Modelica 4.1.0" -> "Modelica"
        }
        parentFQN = parts.join(".");
        moFiles.push({ fullPath, uri, parentFQN });

        if (
          name === `Modelica ${version}/package.mo` ||
          name === "Modelica 4.1.0/package.mo" ||
          name === "Modelica/package.mo"
        ) {
          modelicaPkgUri = uri;
        } else if (name === "Complex.mo") {
          complexUri = uri;
        } else if (
          name === `Modelica ${version}/Icons.mo` ||
          name === "Modelica 4.1.0/Icons.mo" ||
          name === "Modelica/Icons.mo"
        ) {
          iconsUri = uri;
        }
      }
    }

    moFiles.sort((a, b) => {
      const aIsPkg = a.uri.endsWith("/package.mo") ? 0 : 1;
      const bIsPkg = b.uri.endsWith("/package.mo") ? 0 : 1;
      if (aIsPkg !== bIsPkg) return aIsPkg - bIsPkg;
      return a.parentFQN.length - b.parentFQN.length;
    });

    for (const file of moFiles) {
      ctx.globalWorkspaceIndex?.register?.(
        file.uri,
        () => {
          let tree: Tree | null = null;
          try {
            let text = ctx.sharedFs.read(file.fullPath);
            if (text) {
              if (text.length > SAFE_PACKAGE_SIZE_LIMIT) {
                text = getSafePackageSource(text, file.fullPath, ctx);
              }
              tree = ctx.sharedContext?.parse(".mo", text) ?? null;
            }
          } catch (err: unknown) {
            ctx.logger.error(`[loader] Error parsing ${file.fullPath}:`, err);
          }
          if (tree) {
            setTimeout(() => {
              try {
                (tree as { delete?(): void }).delete?.();
              } catch {
                /* ignore */
              }
            }, 0);
          }
          return tree?.rootNode ?? null;
        },
        file.parentFQN,
      );
    }

    // Eagerly index root packages so "Modelica", "Complex", and "Icons" exist in byName immediately
    if (modelicaPkgUri) {
      try {
        ctx.logger.log(`[loadMSL] Ensuring indexed: ${modelicaPkgUri}`);
        ctx.globalWorkspaceIndex?.ensureIndexed?.(modelicaPkgUri);
        ctx.logger.log(
          `[loadMSL] After ensureIndexed(${modelicaPkgUri}), symbols=${ctx.globalWorkspaceIndex?.getIndex?.()?.symbols?.size}`,
        );
      } catch (err: unknown) {
        ctx.logger.error(`[loadMSL] Failed to ensureIndexed ${modelicaPkgUri}:`, err);
      }
    }
    if (complexUri) {
      try {
        ctx.logger.log(`[loadMSL] Ensuring indexed: ${complexUri}`);
        ctx.globalWorkspaceIndex?.ensureIndexed?.(complexUri);
        ctx.logger.log(
          `[loadMSL] After ensureIndexed(${complexUri}), symbols=${ctx.globalWorkspaceIndex?.getIndex?.()?.symbols?.size}`,
        );
      } catch (err: unknown) {
        ctx.logger.error(`[loadMSL] Failed to ensureIndexed ${complexUri}:`, err);
      }
    }
    if (iconsUri) {
      try {
        ctx.globalWorkspaceIndex?.ensureIndexed?.(iconsUri);
      } catch {
        /* ignore */
      }
    }

    loadingLibraryState.delete("Modelica");
    mountedLibraryMetadata.set("Modelica", {
      name: "Modelica",
      version,
      language: "modelica",
    });

    ctx.logger.log(`[polyglot] Registered ${moFiles.length} MSL files in globalWorkspaceIndex`);
    ctx.connectionState.sendNotification("modelscript/status", {
      state: "ready",
      message: "ModelScript",
    });
    ctx.connectionState.sendNotification("modelscript/projectTreeChanged", {});
  } catch (e) {
    loadingLibraryState.delete("Modelica");
    ctx.logger.error("Failed to load MSL zip:", e);
    ctx.connectionState.sendNotification("modelscript/status", {
      state: "ready",
      message: "ModelScript",
    });
    ctx.connectionState.sendNotification("modelscript/projectTreeChanged", {});
  }
}

export async function loadSysML2StandardLibrary(serverDistBase: string, ctx: LoaderContext): Promise<void> {
  try {
    loadingLibraryState.set("SysML", {
      name: "SysML",
      version: "2026.3.0",
      message: "Loading SysML v2...",
    });
    ctx.connectionState.sendNotification("modelscript/projectTreeChanged", {});
    ctx.connectionState.sendNotification("modelscript/status", {
      state: "loading",
      message: "Loading SysML v2 Standard Library...",
    });

    let fileEntries: Record<string, Uint8Array> | null = null;
    try {
      const db = await openMSLCache();
      try {
        const cached = await idbGet<Record<string, ArrayBuffer>>(db, SYSML_VERSION_KEY);
        if (cached) {
          ctx.logger.log("[sysml-cache] Cache hit — loading sysml stdlib from IndexedDB");
          fileEntries = {};
          for (const [name, buf] of Object.entries(cached)) {
            fileEntries[name] = new Uint8Array(buf);
          }
        }
      } finally {
        db.close();
      }
    } catch {
      /* ignore */
    }

    if (!fileEntries) {
      const response = await fetch(`${serverDistBase}/SysML-v2-Release-2026-03.zip`);
      if (!response.ok) {
        loadingLibraryState.delete("SysML");
        ctx.connectionState.sendNotification("modelscript/projectTreeChanged", {});
        ctx.logger.warn("SysML v2 standard library zip not found in dist");
        return;
      }
      ctx.connectionState.sendNotification("modelscript/status", {
        state: "loading",
        message: "Decompressing SysML v2 library...",
      });
      const buffer = await response.arrayBuffer();
      const zipData = new Uint8Array(buffer);
      fileEntries = unzipSync(zipData);

      try {
        const db = await openMSLCache();
        try {
          const serializable: Record<string, ArrayBuffer> = {};
          for (const [name, data] of Object.entries(fileEntries)) {
            if (name.endsWith(".sysml")) {
              serializable[name] = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
            }
          }
          await idbPut(db, SYSML_VERSION_KEY, serializable);
        } finally {
          db.close();
        }
      } catch {
        /* ignore */
      }
    }

    let fileCount = 0;
    const textDecoder = new TextDecoder("utf-8");
    const registeredUris: string[] = [];
    for (const [name, data] of Object.entries(fileEntries)) {
      if (!name.endsWith(".sysml")) continue;
      if (!name.includes("kerml/") && !name.includes("sysml.library/")) continue;

      const text = textDecoder.decode(data);
      const uri = `sysml2://stdlib/${name}`;

      ctx.documentTrees.set(uri, { text, tree: null, classCache: new Map() });
      ctx.sysml2WorkspaceIndex?.register?.(uri, () => {
        if (!ctx.sysml2Parser) return null;
        const tree = ctx.sysml2Parser.parse(text);
        if (tree) {
          // WorkspaceIndex uses the node synchronously. Schedule deletion to avoid memory leak.
          setTimeout(() => {
            try {
              (tree as { delete?(): void }).delete?.();
            } catch {
              /* ignore */
            }
          }, 0);
        }
        return tree ? tree.rootNode : null;
      });
      registeredUris.push(uri);
      fileCount++;
    }

    loadingLibraryState.delete("SysML");
    mountedLibraryMetadata.set("SysML", {
      name: "SysML",
      version: "2026.3.0",
      language: "sysml2",
    });

    ctx.logger.log(
      `SysML2 Standard Library loaded: ${fileCount} files registered and indexed in sysml2WorkspaceIndex.`,
    );
    ctx.connectionState.sendNotification("modelscript/status", {
      state: "ready",
      message: "ModelScript",
    });
    ctx.connectionState.sendNotification("modelscript/projectTreeChanged", {});
  } catch (e) {
    loadingLibraryState.delete("SysML");
    ctx.logger.error("Failed to load SysML2 standard library:", e);
    ctx.connectionState.sendNotification("modelscript/status", {
      state: "ready",
      message: "ModelScript",
    });
    ctx.connectionState.sendNotification("modelscript/projectTreeChanged", {});
  }
}

export interface MountPolyglotOptions {
  packageName: string;
  version: string;
  filename: string;
  language?: string | undefined;
  cacheKey?: string | undefined;
  /** When true, missing archive responses (404 / ENOENT) return false without warning logs. */
  quietIfMissing?: boolean | undefined;
}

/**
 * Generic mounting function for polyglot libraries across all 44 languages.
 * Unpacks the archive into /lib/<packageName> and hydrates WorkspaceIndex
 * if an index.json pre-indexed bundle is present.
 */
export async function mountPolyglotLibrary(
  serverDistBase: string,
  ctx: LoaderContext,
  options: MountPolyglotOptions,
): Promise<boolean> {
  const normName = normalizeLibraryName(options.packageName);
  const existingMeta = mountedLibraryMetadata.get(normName);
  if (existingMeta && existingMeta.version !== options.version) {
    unloadLibraryPackage(normName, ctx);
  }
  const cacheKey = options.cacheKey || `${options.packageName}_v${options.version}`;
  const label = `${options.packageName}@${options.version}`;

  try {
    loadingLibraryState.set(normName, {
      name: normName,
      version: options.version,
      message: "Mounting archive...",
    });
    ctx.connectionState.sendNotification("modelscript/projectTreeChanged", {});
    ctx.connectionState.sendNotification("modelscript/status", {
      state: "loading",
      message: `Loading ${label} library...`,
    });

    let fileEntries: Record<string, Uint8Array> | null = null;

    try {
      const db = await openMSLCache();
      try {
        const cached = await idbGet<Record<string, ArrayBuffer>>(db, cacheKey);
        if (cached) {
          ctx.logger.log(`[vfs-mount] Cache hit for ${label} from IndexedDB`);
          fileEntries = {};
          for (const [name, buf] of Object.entries(cached)) {
            fileEntries[name] = new Uint8Array(buf);
          }
        }
      } finally {
        db.close();
      }
    } catch (cacheErr) {
      ctx.logger.warn(`[vfs-mount] IndexedDB read failed for ${label}: ${cacheErr}`);
    }

    if (!fileEntries) {
      let zipData: Uint8Array;
      if (
        serverDistBase.startsWith("file://") ||
        (!serverDistBase.startsWith("http://") && !serverDistBase.startsWith("https://"))
      ) {
        const filePath = serverDistBase.startsWith("file://")
          ? serverDistBase.replace(/^file:\/\//, "")
          : serverDistBase;
        const zipPath = `${filePath}/${options.filename}`;
        const nodeFs = await import("node:fs");
        if (!nodeFs.existsSync(zipPath)) {
          loadingLibraryState.delete(normName);
          ctx.connectionState.sendNotification("modelscript/projectTreeChanged", {});
          if (!options.quietIfMissing) {
            ctx.logger.warn(`[vfs-mount] Library archive not found at ${zipPath}`);
          }
          return false;
        }
        zipData = nodeFs.readFileSync(zipPath);
      } else {
        const response = await fetch(`${serverDistBase}/${options.filename}`);
        if (!response.ok) {
          loadingLibraryState.delete(normName);
          ctx.connectionState.sendNotification("modelscript/projectTreeChanged", {});
          if (!options.quietIfMissing) {
            ctx.logger.warn(`[vfs-mount] Library archive not found at ${serverDistBase}/${options.filename}`);
          }
          return false;
        }
        ctx.connectionState.sendNotification("modelscript/status", {
          state: "loading",
          message: `Decompressing ${label}...`,
        });
        const buffer = await response.arrayBuffer();
        zipData = new Uint8Array(buffer);
      }
      if (zipData.length < 4 || zipData[0] !== 0x50 || zipData[1] !== 0x4b) {
        loadingLibraryState.delete(normName);
        ctx.connectionState.sendNotification("modelscript/projectTreeChanged", {});
        if (!options.quietIfMissing) {
          ctx.logger.warn(
            `[vfs-mount] Library archive at ${serverDistBase}/${options.filename} is not a valid ZIP file (${zipData.length} bytes)`,
          );
        }
        return false;
      }
      fileEntries = unzipSync(zipData);

      // Cache extracted files into IndexedDB
      setTimeout(async () => {
        try {
          const db = await openMSLCache();
          try {
            const serializable: Record<string, ArrayBuffer> = {};
            for (const [name, data] of Object.entries(fileEntries!)) {
              serializable[name] = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
            }
            await idbPut(db, cacheKey, serializable);
            ctx.logger.log(`[vfs-mount] Cached ${label} in IndexedDB`);
          } finally {
            db.close();
          }
        } catch (cacheErr) {
          ctx.logger.warn(`[vfs-mount] IndexedDB write failed for ${label}: ${cacheErr}`);
        }
      }, 500);
    }

    // Mount files into VFS under /lib/<packageName>/
    const basePath = `/lib/${options.packageName}`;
    let fileCount = 0;
    const textDecoder = new TextDecoder("utf-8");
    const textFiles: Record<string, string> = {};
    const binaryFiles: Record<string, Uint8Array> = {};
    const sysmlEntries: Array<{ fullPath: string; content: string }> = [];
    const polyglotEntries: Array<{ fullPath: string; content: string }> = [];
    const hasPrebuiltIndex = Boolean(fileEntries["index.json"]);

    for (const [name, data] of Object.entries(fileEntries)) {
      if (name.endsWith("/")) {
        ctx.sharedFs.addDir(`${basePath}/${name.slice(0, -1)}`);
        continue;
      }
      const fullPath = `${basePath}/${name}`;
      ctx.sharedFs.addFile(fullPath, data);
      if (name.toLowerCase().endsWith(".wasm")) {
        binaryFiles[name] = data;
      } else if (
        isSysmlSourcePath(name) ||
        name === "package.json" ||
        name.endsWith("/package.json") ||
        (name.endsWith(".json") && name !== "index.json" && name !== "icons.json")
      ) {
        const text = textDecoder.decode(data);
        textFiles[name] = text;
        if (isSysmlSourcePath(fullPath)) {
          sysmlEntries.push({ fullPath, content: text });
        }
      } else if (!hasPrebuiltIndex && name !== "index.json" && name !== "icons.json") {
        const plugin = globalLanguageRegistry.getPluginForUri(fullPath);
        const langDefIndexing = (plugin?.languageDef as { indexing?: { indexFile?: unknown } } | undefined)?.indexing;
        const wsIndex = plugin?.workspaceIndex as { indexFile?: unknown } | undefined;
        if (plugin && (langDefIndexing?.indexFile || typeof wsIndex?.indexFile === "function")) {
          const text = textDecoder.decode(data);
          polyglotEntries.push({ fullPath, content: text });
        }
      }
      fileCount++;
    }

    if (fileEntries["icons.json"]) {
      try {
        const icons = JSON.parse(textDecoder.decode(fileEntries["icons.json"])) as Record<string, string>;
        for (const [className, svg] of Object.entries(icons)) {
          if (typeof svg === "string") {
            iconCache.set(`${normName}@${options.version}:${className}`, svg);
            iconCache.set(className, svg);
          }
        }
      } catch {
        /* ignore */
      }
    }

    // Populate documentTrees (and lazy-index SysML files if bundle lacked an index.json)
    mountSysmlEntriesInContext(sysmlEntries, ctx, !hasPrebuiltIndex);

    // Index non-SysML polyglot files (e.g. SPICE .lib/.cir) when bundle lacks an index.json
    for (const entry of polyglotEntries) {
      try {
        const plugin = globalLanguageRegistry.getPluginForUri(entry.fullPath);
        if (!plugin) continue;
        const uw = ctx.globalWorkspaceIndex;
        const langDefIndexing = (plugin.languageDef as { indexing?: { indexFile?: unknown } } | undefined)?.indexing;
        if (langDefIndexing?.indexFile && typeof uw?.indexDocumentText === "function") {
          if (typeof uw.getLanguageDef === "function" && !uw.getLanguageDef(plugin.id)) {
            uw.registerLanguageDef?.(plugin.id, plugin.languageDef);
          }
          uw.indexDocumentText(`file://${entry.fullPath}`, entry.content, plugin.id);
        } else {
          const wsIdx = plugin.workspaceIndex as { indexFile?: (uri: string, text: string) => void } | undefined;
          wsIdx?.indexFile?.(`file://${entry.fullPath}`, entry.content);
        }
      } catch {
        /* ignore */
      }
    }

    // If pre-indexed bundle (contains index.json):
    if (fileEntries["index.json"]) {
      try {
        const indexStr = textDecoder.decode(fileEntries["index.json"]);
        const parsed = JSON.parse(indexStr);
        if (parsed.symbols && parsed.byName && parsed.childrenOf) {
          const uri = `library-bundle:/${options.packageName}@${options.version}`;
          const symbolCount = hydrateMultiLanguageBundle(
            uri,
            parsed,
            (origPath: string) => {
              if (origPath.startsWith("sources/")) {
                return "file://" + ctx.sharedFs.join(basePath, origPath.substring("sources/".length));
              }
              return "file://" + ctx.sharedFs.join(basePath, origPath);
            },
            ctx,
          );
          ctx.logger.log(`[vfs-mount] Hydrated ${label} pre-indexed bundle with ${symbolCount} symbols.`);
        }
      } catch (indexErr) {
        ctx.logger.warn(`[vfs-mount] Failed to parse index.json for ${label}: ${indexErr}`);
      }
    }

    const runtimeMeta = await registerRuntimeAssetsFromPackage(options.packageName, options.version, {
      files: textFiles,
      binaryFiles,
    });

    loadingLibraryState.delete(normName);
    mountedLibraryMetadata.set(normName, {
      ...runtimeMeta,
      name: normName,
      version: options.version,
      language: options.language ?? runtimeMeta.language,
    });
    ctx.connectionState.sendNotification("modelscript/projectTreeChanged", {});

    ctx.logger.log(`[vfs-mount] Successfully mounted ${label} (${fileCount} files into ${basePath}).`);
    ctx.connectionState.sendNotification("modelscript/status", {
      state: "ready",
      message: "ModelScript",
    });
    return true;
  } catch (err: unknown) {
    loadingLibraryState.delete(normName);
    ctx.connectionState.sendNotification("modelscript/projectTreeChanged", {});
    ctx.logger.error(`[vfs-mount] Failed to mount ${label}:`, err);
    ctx.connectionState.sendNotification("modelscript/status", {
      state: "ready",
      message: "ModelScript",
    });
    return false;
  }
}

/**
 * Mounts an offline curated fallback package bundle (if one exists in
 * CURATED_PACKAGE_FALLBACKS) and pre-caches its component SVG icons.
 */
export async function mountCuratedFallbackPackage(
  packageName: string,
  version: string | undefined,
  ctx: LoaderContext,
): Promise<boolean> {
  const curated = findCuratedPackageFallback(packageName);
  if (!curated) return false;
  const targetVer = version || curated.version;
  ctx.logger.log(
    `[deps] Mounting curated fallback bundle for ${curated.packageName}@${targetVer} (${Object.keys(curated.files).length} files)`,
  );
  if (curated.icons) {
    for (const [cls, svg] of Object.entries(curated.icons)) {
      iconCache.set(`${curated.packageName}@${targetVer}:${cls}`, svg);
      iconCache.set(cls, svg);
    }
  }
  const normName = normalizeLibraryName(curated.packageName);
  // Native PSS/E standard dynamics models are already registered in UnifiedWorkspace via psseLanguage.indexing.builtins;
  // mounting the curated .mo stub would shadow their native port and DAE-lowering metadata.
  if (curated.language === "psse" && normName === "PSSE-Standard-Dynamics") {
    mountedLibraryMetadata.set(normName, {
      name: normName,
      version: targetVer,
      language: curated.language,
    });
    ctx.connectionState.sendNotification("modelscript/projectTreeChanged", {});
    return true;
  }
  await loadRegistryPackage(
    {
      name: curated.packageName,
      version: targetVer,
      files: curated.files,
      modelscript: { languages: [curated.language] },
    },
    ctx,
    { skipRemoteIndex: true },
  );
  return mountedLibraryMetadata.has(normName);
}

/**
 * Unmounts a library package (whether custom or standard library) from the
 * workspace indexes and refreshes the Libraries tree.
 */
export function unloadLibraryPackage(packageName: string, ctx: LoaderContext): number {
  const normName = normalizeLibraryName(packageName);
  mountedLibraryMetadata.delete(normName);
  loadingLibraryState.delete(normName);
  globalLibraryRegistry.unregisterPackage(packageName);
  if (normName !== packageName) {
    globalLibraryRegistry.unregisterPackage(normName);
  }

  let clearedUris = 0;

  type WorkspaceIndexEvictionTarget = {
    clear?(uri: string): void;
    fileLoaders?: Map<string, unknown> | undefined;
    fileSymbols?: Map<string, unknown> | undefined;
    unifiedTreeIndex?: { symbols?: Map<number, { resourceId?: string }> } | undefined;
    getIndex?(): { symbols?: Map<number, { resourceId?: string }> } | undefined;
  };

  const evictFromWorkspaceIndex = (wsIdx: WorkspaceIndexEvictionTarget | null | undefined) => {
    if (!wsIdx || typeof wsIdx.clear !== "function") return;
    const urisToClear = new Set<string>();

    // 1. Check lazy fileLoaders map
    if (wsIdx.fileLoaders instanceof Map) {
      for (const uri of wsIdx.fileLoaders.keys()) {
        if (getLibraryName(String(uri)) === normName) {
          urisToClear.add(String(uri));
        }
      }
    }

    // 2. Check indexed fileSymbols map (includes hydrated library-bundle:/ URIs)
    if (wsIdx.fileSymbols instanceof Map) {
      for (const uri of wsIdx.fileSymbols.keys()) {
        const uriStr = String(uri);
        if (
          getLibraryName(uriStr) === normName ||
          uriStr.startsWith(`library-bundle:/${packageName}@`) ||
          uriStr.startsWith(`library-bundle:/${normName}@`)
        ) {
          urisToClear.add(uriStr);
        }
      }
    }

    // 3. Check unified index symbols for any remapped file:// URIs
    try {
      const treeIdx = wsIdx.getIndex?.();
      if (treeIdx?.symbols instanceof Map) {
        for (const sym of treeIdx.symbols.values()) {
          if (sym?.resourceId && getLibraryName(String(sym.resourceId)) === normName) {
            urisToClear.add(String(sym.resourceId));
          }
        }
      }
    } catch {
      /* ignore */
    }

    for (const uri of urisToClear) {
      try {
        wsIdx.clear(uri);
        clearedUris++;
      } catch {
        /* ignore */
      }
    }
  };

  evictFromWorkspaceIndex(ctx.globalWorkspaceIndex);
  evictFromWorkspaceIndex(ctx.sysml2WorkspaceIndex);

  if (ctx.documentTrees instanceof Map) {
    for (const uri of [...ctx.documentTrees.keys()]) {
      if (getLibraryName(uri) === normName) {
        ctx.documentTrees.delete(uri);
      }
    }
  }

  ctx.logger?.log?.(`[library] Unloaded package '${normName}' (${clearedUris} resource URI(s) evicted)`);
  ctx.connectionState?.sendNotification?.("modelscript/projectTreeChanged", {});
  return clearedUris;
}

/**
 * Extracts declared library version dependencies from either a Modelica `uses(...)` annotation
 * or a `package.json` / `modelscript.json` manifest.
 */
export function extractDeclaredDependenciesFromSource(
  text: string,
  uri = "",
): Array<{ name: string; version: string }> {
  const deps: Array<{ name: string; version: string }> = [];
  const seen = new Set<string>();
  const addDep = (depName: string, depVer: string) => {
    const cleanName = depName.trim();
    const cleanVer = trimOuterChars(depVer.trim(), "^~>=<", "") || "1.0.0";
    if (cleanName && !seen.has(cleanName)) {
      seen.add(cleanName);
      deps.push({ name: cleanName, version: cleanVer });
    }
  };

  if (uri.endsWith(".json") || text.trim().startsWith("{")) {
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>;
      const msx =
        parsed["modelscript"] && typeof parsed["modelscript"] === "object"
          ? (parsed["modelscript"] as Record<string, unknown>)
          : undefined;
      for (const mapObj of [parsed["dependencies"], msx?.["dependencies"], msx?.["standards"]]) {
        if (Array.isArray(mapObj)) {
          for (const item of mapObj) {
            if (typeof item !== "string" || !item.trim()) continue;
            const trimmed = item.trim();
            const atIdx = trimmed.lastIndexOf("@");
            if (atIdx > 0) {
              addDep(trimmed.slice(0, atIdx), trimmed.slice(atIdx + 1));
            } else {
              addDep(trimmed, "1.0.0");
            }
          }
        } else if (mapObj && typeof mapObj === "object") {
          for (const [depName, depVer] of Object.entries(mapObj as Record<string, unknown>)) {
            if (typeof depVer === "string" && depVer.trim()) {
              addDep(depName, depVer);
            }
          }
        }
      }
      return deps;
    } catch {
      // Not valid JSON, fall through to source annotation extraction
    }
  }

  for (const dep of extractModelicaUsesDeps(text)) {
    addDep(dep.name, dep.version);
  }

  if (isSysmlSourcePath(uri) || text.includes("@LibraryDependency") || text.includes("@ComplianceProfile")) {
    for (const dep of extractSysmlAtAnnotationDeps(text, "@LibraryDependency", ["name"])) {
      addDep(dep.name, dep.version);
    }
    for (const dep of extractSysmlAtAnnotationDeps(text, "@ComplianceProfile", ["package", "standardPackage"])) {
      addDep(dep.name, dep.version);
    }
  }

  return deps;
}

/**
 * Ensures that the specified library package is mounted at `dep.version`.
 * If another version of the same library is currently mounted, it is cleanly unloaded
 * from `WorkspaceIndex` and replaced with `dep.version` (unified for both built-in
 * standard libraries like `Modelica` and user-published packages).
 */
export async function ensureLibraryVersionMounted(
  dep: { name: string; version: string },
  ctx: LoaderContext,
  serverDistBase?: string,
  explicitlyInstalled = false,
): Promise<boolean> {
  const normName = normalizeLibraryName(dep.name);
  const current = mountedLibraryMetadata.get(normName);
  if (current && current.version === dep.version) {
    if (explicitlyInstalled && !current.explicitlyInstalled) {
      mountedLibraryMetadata.set(normName, { ...current, explicitlyInstalled: true });
      ctx.connectionState.sendNotification("modelscript/projectTreeChanged", {});
    }
    return false;
  }

  if (current && current.version !== dep.version) {
    ctx.logger.log(`[deps] Switching ${normName} from v${current.version} to v${dep.version}...`);
    unloadLibraryPackage(normName, ctx);
  }

  // Activate any version-namespaced icons already in iconCache for this version
  const prefix = `${normName}@${dep.version}:`;
  for (const [k, svg] of iconCache.entries()) {
    if (k.startsWith(prefix)) {
      const className = k.slice(prefix.length);
      iconCache.set(className, svg);
    }
  }

  const effectiveDistBase = serverDistBase || (globalThis as GlobalLoaderEnv).serverDistBase || "";

  if (normName === "Modelica" && effectiveDistBase) {
    await loadMSL(effectiveDistBase, ctx, dep.version);
  } else if (normName === "SysML" && effectiveDistBase) {
    await loadSysML2StandardLibrary(effectiveDistBase, ctx);
  } else {
    try {
      await loadDependencyFromRegistry({ name: dep.name, version: dep.version }, ctx);
    } catch (regErr) {
      if (normName === "Modelica" && effectiveDistBase) {
        ctx.logger.warn(`[deps] Registry load failed for Modelica, falling back to local MSL: ${regErr}`);
        await loadMSL(effectiveDistBase, ctx, dep.version, { skipRegistryRetry: true });
      } else if (normName === "SysML" && effectiveDistBase) {
        ctx.logger.warn(`[deps] Registry load failed for SysML, falling back to local SysML: ${regErr}`);
        await loadSysML2StandardLibrary(effectiveDistBase, ctx);
      } else {
        const curated = findCuratedPackageFallback(dep.name);
        if (curated) {
          const targetVer = dep.version || curated.version;
          let polyglotOk = false;
          if (effectiveDistBase) {
            try {
              polyglotOk = await mountPolyglotLibrary(effectiveDistBase, ctx, {
                packageName: curated.packageName,
                version: targetVer,
                filename: curated.filename,
                language: curated.language,
              });
            } catch {
              polyglotOk = false;
            }
          }
          if (!polyglotOk) {
            await mountCuratedFallbackPackage(curated.packageName, targetVer, ctx);
          }
        } else {
          throw regErr;
        }
      }
    }
  }

  if (explicitlyInstalled) {
    const mounted = mountedLibraryMetadata.get(normName);
    if (mounted) {
      mountedLibraryMetadata.set(normName, { ...mounted, explicitlyInstalled: true });
    }
  }
  return true;
}

/**
 * Inspects a workspace document (`package.mo`, `.mo`, `package.json`, `modelscript.json`)
 * for declared library versions (`uses(Modelica(version="4.0.0"))`, etc.) and hot-swaps
 * any mounted library whose active version differs from the workspace's requirement.
 */
export async function resolveWorkspaceLibraryVersions(
  text: string,
  ctx: LoaderContext,
  uri = "",
  serverDistBase?: string,
): Promise<Array<{ name: string; version: string; swapped: boolean }>> {
  const declared = extractDeclaredDependenciesFromSource(text, uri);
  const results: Array<{ name: string; version: string; swapped: boolean }> = [];
  for (const dep of declared) {
    const swapped = await ensureLibraryVersionMounted(dep, ctx, serverDistBase);
    results.push({ name: dep.name, version: dep.version, swapped });
  }
  return results;
}

/**
 * Unpacks a base64-encoded or URL-fetched `.zip` archive containing `.mo` or `.sysml` files
 * and mounts it into the workspace as a library package.
 */
export async function importLibraryZip(
  params: {
    name?: string | undefined;
    version?: string | undefined;
    zipBase64?: string | undefined;
    url?: string | undefined;
  },
  ctx: LoaderContext,
): Promise<{ name: string; version: string; fileCount: number }> {
  let zipBytes: Uint8Array;
  if (params.zipBase64) {
    const bin = atob(params.zipBase64.replace(/[^A-Za-z0-9+/=]/g, ""));
    zipBytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) {
      zipBytes[i] = bin.charCodeAt(i);
    }
  } else if (params.url) {
    const resp = await fetch(params.url);
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status} fetching ${params.url}`);
    }
    zipBytes = new Uint8Array(await resp.arrayBuffer());
  } else {
    throw new Error("Either zipBase64 or url must be provided to importLibraryZip");
  }

  const unzipped = unzipSync(zipBytes);
  const files: Record<string, string> = {};
  const binaryWasmEntries: Array<{ path: string; bytes: Uint8Array }> = [];
  let parsedModelscript: RegistryPackageInfo["modelscript"];
  let packageRootPrefix = "";
  let detectedPkgName = params.name || "";
  let detectedVersion = params.version || "1.0.0";

  for (const [relPath, data] of Object.entries(unzipped)) {
    if (!data || data.length === 0 || relPath.endsWith("/")) continue;
    const cleanPath = relPath.replace(/^\/+/, "");
    const lower = cleanPath.toLowerCase();
    if (cleanPath.endsWith("package.json") && cleanPath.split("/").length <= 2) {
      try {
        const text = strFromU8(data);
        files[cleanPath] = text;
        const slashIdx = cleanPath.indexOf("/");
        if (slashIdx > 0) {
          packageRootPrefix = cleanPath.slice(0, slashIdx + 1);
        }
        const parsed = JSON.parse(text);
        if (!detectedPkgName && typeof parsed.name === "string") detectedPkgName = parsed.name;
        if (!params.version && typeof parsed.version === "string") detectedVersion = parsed.version;
        if (parsed.modelscript && typeof parsed.modelscript === "object") {
          parsedModelscript = parsed.modelscript as RegistryPackageInfo["modelscript"];
        }
      } catch {
        /* ignore */
      }
      continue;
    }
    if (lower.endsWith(".wasm")) {
      binaryWasmEntries.push({ path: cleanPath, bytes: data });
      continue;
    }
    if (
      lower.endsWith(".mo") ||
      lower.endsWith(".msim") ||
      isSysmlSourcePath(lower) ||
      (lower.endsWith(".json") && !lower.endsWith("tsconfig.json"))
    ) {
      files[cleanPath] = strFromU8(data);
      if (!detectedPkgName) {
        const firstSeg = cleanPath.split("/")[0]?.split(" ")[0];
        if (firstSeg && !firstSeg.endsWith(".mo") && !isSysmlSourcePath(firstSeg)) {
          detectedPkgName = firstSeg;
        }
      }
    }
  }

  let tables: Record<string, unknown> | undefined;
  const runtimeRaw = parsedModelscript?.runtime as
    { wasm?: string | undefined; tables?: Record<string, string> | undefined } | undefined;
  if (runtimeRaw?.tables && typeof runtimeRaw.tables === "object") {
    tables = {};
    for (const [key, rel] of Object.entries(runtimeRaw.tables)) {
      const cleanRel = rel.replace(/^\.\//, "");
      const text =
        files[cleanRel] ?? files[rel] ?? (packageRootPrefix ? files[`${packageRootPrefix}${cleanRel}`] : undefined);
      if (typeof text === "string") {
        try {
          tables[key] = JSON.parse(text);
        } catch {
          /* ignore */
        }
      }
    }
  }

  let wasmBase64: string | undefined;
  if (binaryWasmEntries.length > 0) {
    const cleanWasm = runtimeRaw?.wasm?.replace(/^\.\//, "");
    const match = cleanWasm
      ? binaryWasmEntries.find(
          (e) =>
            e.path === cleanWasm ||
            (packageRootPrefix && e.path === `${packageRootPrefix}${cleanWasm}`) ||
            e.path.endsWith(`/${cleanWasm}`),
        )
      : binaryWasmEntries[0];
    if (match) {
      wasmBase64 = encodeBytesBase64(match.bytes);
    }
  }

  const finalName = detectedPkgName || "ImportedLibrary";
  await loadRegistryPackage(
    {
      name: finalName,
      version: detectedVersion,
      files,
      ...(parsedModelscript ? { modelscript: parsedModelscript } : {}),
      ...(tables && Object.keys(tables).length > 0 ? { tables } : {}),
      ...(wasmBase64 ? { wasmBase64 } : {}),
    },
    ctx,
  );
  const normFinal = normalizeLibraryName(finalName);
  const mounted = mountedLibraryMetadata.get(normFinal);
  if (mounted) {
    mountedLibraryMetadata.set(normFinal, { ...mounted, explicitlyInstalled: true });
  }

  return { name: finalName, version: detectedVersion, fileCount: Object.keys(files).length };
}
