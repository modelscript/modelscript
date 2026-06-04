import { Context, WorkspaceIndex } from "@modelscript/compiler";

import type { BrowserFileSystem } from "./browser-file-system";
import {
  getSalsaIndexCache,
  idbGet,
  idbPut,
  MSL_VERSION_KEY,
  openMSLCache,
  putSalsaIndexCache,
} from "./browser-file-system";

import type { FederatedQueryCacheStore } from "@modelscript/compiler";
import type { Parser, Tree } from "@modelscript/utils";
import { strFromU8, unzipSync } from "fflate";
import { iconCache } from "../handlers/treeHandler";
import { ingestSalsaIndex } from "./salsa-index-ingester";

export interface LoaderContext {
  connectionState: { sendNotification: (method: string, params: unknown) => void };
  logger: { log: (msg: string) => void; warn: (msg: string) => void; error: (msg: string, e: unknown) => void };
  sharedFs: BrowserFileSystem;
  sharedContext: Context;
  globalWorkspaceIndex: WorkspaceIndex;
  sysml2WorkspaceIndex: WorkspaceIndex;
  documentTrees: Map<string, { text: string; tree: Tree | null; classCache: Map<string, unknown> }>;
  sysml2Parser: Parser | null;
  cacheStore?: FederatedQueryCacheStore;
  registryUrl?: string;
  federatedEndpoints: string[];
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
   * Map of relative paths → file contents for all .mo files.
   * Keys are relative to the package root (e.g., "Motor/package.mo").
   */
  files: Record<string, string>;
  /** Optional modelscript metadata from package.json. */
  modelscript?: {
    languages?: string[];
    main?: string;
    modelicaVersion?: string;
  };
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
export async function loadRegistryPackage(pkg: RegistryPackageInfo, ctx: LoaderContext): Promise<void> {
  try {
    const safeName = pkg.name.replace(/\//g, "_").replace(/^@/, "");
    const basePath = `/packages/${safeName}`;
    const label = `${pkg.name}@${pkg.version}`;

    ctx.logger.log(`[registry] Loading package ${label} (${Object.keys(pkg.files).length} files)`);
    ctx.connectionState.sendNotification("modelscript/status", {
      state: "loading",
      message: `Loading ${label}...`,
    });

    // Register federated endpoint for cache store using the configured registry URL
    let baseUrl = "";
    if (ctx.registryUrl) {
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
      const cacheKey = `${pkg.name}@${pkg.version}`;
      let dbBuffer: ArrayBuffer | undefined;

      try {
        dbBuffer = await getSalsaIndexCache(cacheKey);
      } catch (err) {
        ctx.logger.warn(`[registry] IndexedDB read failed for salsa-index of ${label}: ${err}`);
      }

      if (dbBuffer) {
        ctx.logger.log(`[registry] Cache hit — loading salsa-index for ${label} from IndexedDB`);
        const { memos } = await ingestSalsaIndex(dbBuffer, ctx.cacheStore);
        ctx.logger.log(`[registry] Hydrated ${memos} memos from cached index for ${label}`);
      } else if (baseUrl) {
        const indexUrl = `${baseUrl}/api/v1/libraries/${encodeURIComponent(pkg.name)}/${encodeURIComponent(pkg.version)}/salsa-index.db`;
        try {
          const resp = await fetch(indexUrl);
          if (resp.ok) {
            const buffer = await resp.arrayBuffer();
            const { memos } = await ingestSalsaIndex(buffer, ctx.cacheStore);
            ctx.logger.log(`[registry] Loaded pre-computed index for ${label} (hydrated ${memos} memos)`);

            // Cache for subsequent loads
            try {
              await putSalsaIndexCache(cacheKey, buffer);
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

    // Write files to the VFS
    let fileCount = 0;
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

      const encoder = new TextEncoder();
      ctx.sharedFs.addFile(fullPath, encoder.encode(content));
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
        const entries = ctx.sharedFs.readdir(dir);
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
              pathParts[0] = pathParts[0].split(" ")[0];
            }
            parentFQN = pathParts.join(".");

            ctx.globalWorkspaceIndex.register(
              uri,
              () => {
                let tree: Tree | null = null;
                try {
                  const text = ctx.sharedFs.read(fullPath);
                  if (text) {
                    tree = ctx.sharedContext.parse(".mo", text);
                  }
                } catch {
                  /* ignore */
                }
                if (tree) {
                  // WorkspaceIndex uses the node synchronously.
                  // Schedule deletion to avoid WASM memory leaks.
                  setTimeout(() => {
                    try {
                      tree.delete();
                    } catch {
                      /* ignore */
                    }
                  }, 0);
                }
                return (tree?.rootNode ?? null) as unknown as import("@modelscript/compiler/symbol-indexer").CSTNode;
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

    // Eagerly trigger indexing for all registered files so their symbols
    // appear in toUnifiedPartial() and are available for name resolution.
    // Without this, lazy-registered files are invisible to the validation pipeline.
    let indexedCount = 0;
    let indexErrors = 0;
    for (const uri of registeredUris) {
      try {
        ctx.globalWorkspaceIndex.getFileIndex(uri);
        indexedCount++;
      } catch (err) {
        indexErrors++;
        if (indexErrors <= 3) {
          ctx.logger.warn(`[registry] Index error for ${uri}: ${err}`);
        }
      }
    }
    if (indexErrors > 3) {
      ctx.logger.warn(`[registry] ... and ${indexErrors - 3} more indexing errors`);
    }

    ctx.logger.log(
      `[registry] Loaded ${label}: ${fileCount} files, ${registeredCount} registered, ${indexedCount} indexed`,
    );
  } catch (e) {
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
  const label = `${dep.name}@${dep.version}`;
  ctx.logger.log(`[deps] Loading ${label} from registry via LSP bundle...`);

  try {
    const db = await openMSLCache();
    const cacheKey = `lsp-bundle:dep:v3:${label}`;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let cached = await idbGet<any>(db, cacheKey);

    if (!cached || !cached.indexJson || !cached.files) {
      const baseUrl = ctx.registryUrl?.replace(/\/$/, "") || "http://127.0.0.1:3000";
      const res = await fetch(`${baseUrl}/api/v1/libraries/${dep.name}/${dep.version}/lsp-bundle`);

      if (!res.ok) {
        db.close();

        // ── Fallback: fetch raw source files and register lazily ──
        // The lsp-bundle may not exist if the publish-worker hasn't run yet.
        // Fall back to the /files endpoint which serves extracted .mo sources.
        ctx.logger.warn(`[deps] lsp-bundle not available for ${label} (HTTP ${res.status}), trying /files fallback...`);

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
        for (const [relPath, content] of Object.entries(filesData.files)) {
          prefixedFiles[`${dep.name}/${relPath}`] = content;
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
              iconCache.set(className, svg);
              iconCount++;
            }
            ctx.logger.log(`[deps] Loaded ${iconCount} icons for ${label}`);
          }
        } catch {
          ctx.logger.warn(`[deps] Failed to fetch icons for ${label} (non-fatal)`);
        }
        return;
      }

      const buffer = await res.arrayBuffer();
      const zipped = unzipSync(new Uint8Array(buffer));

      let indexJson: Record<string, unknown> | null = null;
      let iconsJson: Record<string, string> | null = null;
      const files: Record<string, string> = {};

      for (const [relativePath, data] of Object.entries(zipped)) {
        if (data.length === 0) continue; // directory
        if (relativePath === "index.json") {
          indexJson = JSON.parse(strFromU8(data));
        } else if (relativePath === "icons.json") {
          iconsJson = JSON.parse(strFromU8(data));
        } else if (relativePath.startsWith("sources/")) {
          const fileRelPath = relativePath.substring("sources/".length);
          files[fileRelPath] = strFromU8(data);
        }
      }

      cached = { indexJson, iconsJson, files };
      await idbPut(db, cacheKey, cached);
    }

    db.close();

    // 1. Hydrate icons — from bundle first, then API fallback if empty
    let iconCount = 0;
    if (cached.iconsJson) {
      for (const [className, svg] of Object.entries(cached.iconsJson)) {
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
    for (const [relPath, content] of Object.entries(pkg.files)) {
      const fullPath = ctx.sharedFs.join(basePath, relPath);

      // Ensure parent directories exist
      const parts = fullPath.split("/");
      for (let i = 2; i < parts.length; i++) {
        const dir = parts.slice(0, i).join("/");
        try {
          ctx.sharedFs.addDir(dir);
        } catch {
          /* already exists */
        }
      }

      ctx.sharedFs.addFile(fullPath, encoder.encode(content as string));
      fileCount++;
    }

    // 3. Hydrate WorkspaceIndex
    if (cached.indexJson) {
      const uri = `library-bundle:/${dep.name}@${dep.version}`;

      const symbols = new Map(cached.indexJson.symbols);
      const byName = new Map(cached.indexJson.byName);
      const childrenOf = new Map(cached.indexJson.childrenOf);

      ctx.globalWorkspaceIndex.hydrate(
        uri,
        {
          // @ts-expect-error missing types
          symbols,
          // @ts-expect-error missing types
          byName,
          // @ts-expect-error missing types
          childrenOf,
        },
        undefined,
        (origPath) => {
          if (origPath.startsWith("sources/")) {
            return "file://" + ctx.sharedFs.join(basePath, origPath.substring("sources/".length));
          }
          return "file://" + ctx.sharedFs.join(basePath, origPath);
        },
      );

      ctx.logger.log(`[registry] Hydrated ${label}: ${fileCount} files, index hydrated with ${symbols.size} symbols.`);
    }
  } catch (e) {
    ctx.logger.error(`[deps] Failed to load ${label} from registry:`, e);
    throw e;
  }
}

export const SYSML_VERSION_KEY = "SysML-v2-Release-2026-03";

export async function loadMSL(serverDistBase: string, ctx: LoaderContext): Promise<void> {
  try {
    ctx.connectionState.sendNotification("modelscript/status", {
      state: "loading",
      message: "Loading Modelica Standard Library...",
    });

    let fileEntries: Record<string, Uint8Array> | null = null;

    try {
      const db = await openMSLCache();
      const cached = await idbGet<Record<string, ArrayBuffer>>(db, MSL_VERSION_KEY);
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
      db.close();
    } catch (cacheErr) {
      ctx.logger.warn(`[msl-cache] IndexedDB read failed, falling back to network: ${cacheErr}`);
    }

    if (!fileEntries) {
      const response = await fetch(`${serverDistBase}/ModelicaStandardLibrary_v4.1.0.zip`);
      if (!response.ok) {
        ctx.logger.warn("MSL zip not found — library features will be unavailable");
        return;
      }
      ctx.connectionState.sendNotification("modelscript/status", {
        state: "loading",
        message: "Decompressing MSL...",
      });
      const buffer = await response.arrayBuffer();
      const zipData = new Uint8Array(buffer);
      fileEntries = unzipSync(zipData);

      try {
        const db = await openMSLCache();
        const serializable: Record<string, ArrayBuffer> = {};
        for (const [name, data] of Object.entries(fileEntries)) {
          serializable[name] = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
        }
        await idbPut(db, MSL_VERSION_KEY, serializable);
        db.close();
        ctx.logger.log("[msl-cache] Cached extracted MSL in IndexedDB");
      } catch (cacheErr) {
        ctx.logger.warn(`[msl-cache] IndexedDB write failed: ${cacheErr}`);
      }
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
    ctx.connectionState.sendNotification("modelscript/status", {
      state: "loading",
      message: "Processing MSL classes...",
    });

    ctx.sharedFs.readdir("/lib");

    const registeredUris: string[] = [];
    let registeredCount = 0;

    const registerDirLazy = (dir: string) => {
      try {
        const entries = ctx.sharedFs.readdir(dir);
        for (const entry of entries) {
          const fullPath = ctx.sharedFs.join(dir, entry.name);
          if (entry.isDirectory()) {
            registerDirLazy(fullPath);
          } else if (entry.name.endsWith(".mo")) {
            const uri = `modelica:/${fullPath}`;
            let parentFQN = "";
            const relPath = fullPath.substring(5); // strip "/lib/"
            const parts = relPath.split("/");
            if (parts[parts.length - 1] === "package.mo") {
              parts.pop(); // Remove "package.mo"
              parts.pop(); // Remove the package dir name itself
            } else {
              parts.pop(); // Remove "Filename.mo"
            }
            if (parts.length > 0) {
              parts[0] = parts[0].split(" ")[0];
            }
            parentFQN = parts.join(".");

            ctx.globalWorkspaceIndex.register(
              uri,
              () => {
                let tree: Tree | null = null;
                try {
                  const text = ctx.sharedFs.read(fullPath);
                  if (text) {
                    tree = ctx.sharedContext.parse(".mo", text);
                  }
                } catch {
                  /* ignore */
                }
                if (tree) {
                  // WorkspaceIndex uses the node synchronously.
                  // Schedule deletion to avoid WASM memory leaks.
                  setTimeout(() => {
                    try {
                      tree.delete();
                    } catch {
                      /* ignore */
                    }
                  }, 0);
                }
                return (tree?.rootNode ?? null) as unknown as import("@modelscript/compiler/symbol-indexer").CSTNode;
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
    registerDirLazy("/lib");

    let indexedCount = 0;
    for (let i = 0; i < registeredUris.length; i++) {
      try {
        ctx.globalWorkspaceIndex.getFileIndex(registeredUris[i]);
        indexedCount++;
      } catch {
        /* ignore */
      }
      if (i % 5 === 0) {
        await new Promise((resolve) => setTimeout(resolve, 0));
        ctx.connectionState.sendNotification("modelscript/status", {
          state: "loading",
          message: `Indexing MSL classes (${indexedCount}/${registeredUris.length})...`,
        });
      }
    }

    ctx.logger.log(
      `[polyglot] Registered ${registeredCount} MSL files, indexed ${indexedCount} in globalWorkspaceIndex`,
    );
  } catch (e) {
    ctx.logger.error("Failed to load MSL zip:", e);
  }
}

export async function loadSysML2StandardLibrary(serverDistBase: string, ctx: LoaderContext): Promise<void> {
  try {
    ctx.connectionState.sendNotification("modelscript/status", {
      state: "loading",
      message: "Loading SysML v2 Standard Library...",
    });

    let fileEntries: Record<string, Uint8Array> | null = null;
    try {
      const db = await openMSLCache();
      const cached = await idbGet<Record<string, ArrayBuffer>>(db, SYSML_VERSION_KEY);
      if (cached) {
        ctx.logger.log("[sysml-cache] Cache hit — loading sysml stdlib from IndexedDB");
        fileEntries = {};
        for (const [name, buf] of Object.entries(cached)) {
          fileEntries[name] = new Uint8Array(buf);
        }
      }
      db.close();
    } catch {
      /* ignore */
    }

    if (!fileEntries) {
      const response = await fetch(`${serverDistBase}/SysML-v2-Release-2026-03.zip`);
      if (!response.ok) {
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
        const serializable: Record<string, ArrayBuffer> = {};
        for (const [name, data] of Object.entries(fileEntries)) {
          if (name.endsWith(".sysml")) {
            serializable[name] = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
          }
        }
        await idbPut(db, SYSML_VERSION_KEY, serializable);
        db.close();
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
      ctx.sysml2WorkspaceIndex.register(uri, () => {
        if (!ctx.sysml2Parser) return null as unknown as import("@modelscript/compiler/symbol-indexer").CSTNode;
        const tree = ctx.sysml2Parser.parse(text);
        if (tree) {
          // WorkspaceIndex uses the node synchronously. Schedule deletion to avoid memory leak.
          setTimeout(() => {
            try {
              tree.delete();
            } catch {
              /* ignore */
            }
          }, 0);
        }
        return (tree ? tree.rootNode : null) as unknown as import("@modelscript/compiler/symbol-indexer").CSTNode;
      });
      registeredUris.push(uri);
      fileCount++;
    }

    let indexedCount = 0;
    for (let i = 0; i < registeredUris.length; i++) {
      try {
        ctx.sysml2WorkspaceIndex.getFileIndex(registeredUris[i]);
        indexedCount++;
      } catch {
        /* ignore */
      }
      if (i % 50 === 0) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }

    ctx.logger.log(
      `SysML2 Standard Library loaded: ${fileCount} files registered, ${indexedCount} indexed in sysml2WorkspaceIndex.`,
    );
  } catch (e) {
    ctx.logger.error("Failed to load SysML2 standard library:", e);
  }
}
