import { Context, WorkspaceIndex } from "@modelscript/compiler";
import { unzipSync } from "fflate";
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
import { ingestSalsaIndex } from "./salsa-index-ingester";

export const SYSML_VERSION_KEY = "SysML-v2-Release-2026-03";

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

    const mslTreeCache = new Map<string, Tree | null>();
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
                if (!mslTreeCache.has(fullPath)) {
                  try {
                    const text = ctx.sharedFs.read(fullPath);
                    if (text) {
                      const tree = ctx.sharedContext.parse(".mo", text);
                      mslTreeCache.set(fullPath, tree);
                    }
                  } catch {
                    mslTreeCache.set(fullPath, null);
                  }
                }
                return (mslTreeCache.get(fullPath)?.rootNode ??
                  null) as unknown as import("@modelscript/compiler/symbol-indexer").CSTNode;
              },
              parentFQN,
            );
            registeredCount++;
          }
        }
      } catch {
        /* ignore */
      }
    };
    registerDirLazy("/lib");
    ctx.logger.log(`[polyglot] Registered ${registeredCount} MSL files lazily in globalWorkspaceIndex`);
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
    for (const [name, data] of Object.entries(fileEntries)) {
      if (!name.endsWith(".sysml")) continue;
      if (!name.includes("kerml/") && !name.includes("sysml.library/")) continue;

      const text = textDecoder.decode(data);
      const uri = `sysml2://stdlib/${name}`;

      ctx.documentTrees.set(uri, { text, tree: null, classCache: new Map() });
      ctx.sysml2WorkspaceIndex.register(uri, () => {
        if (!ctx.sysml2Parser) return null as unknown as import("@modelscript/compiler/symbol-indexer").CSTNode;
        const tree = ctx.sysml2Parser.parse(text);
        const node = ctx.documentTrees.get(uri);
        if (node && tree) node.tree = tree;
        return (tree ? tree.rootNode : null) as unknown as import("@modelscript/compiler/symbol-indexer").CSTNode;
      });
      fileCount++;
    }

    ctx.logger.log(`SysML2 Standard Library loaded: ${fileCount} files registered in sysml2WorkspaceIndex.`);
  } catch (e) {
    ctx.logger.error("Failed to load SysML2 standard library:", e);
  }
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

    // Register files lazily in the global workspace index
    const pkgTreeCache = new Map<string, Tree | null>();
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
                if (!pkgTreeCache.has(fullPath)) {
                  try {
                    const text = ctx.sharedFs.read(fullPath);
                    if (text) {
                      const tree = ctx.sharedContext.parse(".mo", text);
                      pkgTreeCache.set(fullPath, tree);
                    }
                  } catch {
                    pkgTreeCache.set(fullPath, null);
                  }
                }
                return (pkgTreeCache.get(fullPath)?.rootNode ??
                  null) as unknown as import("@modelscript/compiler/symbol-indexer").CSTNode;
              },
              parentFQN,
            );
            registeredCount++;
          }
        }
      } catch {
        /* ignore */
      }
    };
    registerDirLazy(basePath);

    ctx.logger.log(`[registry] Loaded ${label}: ${fileCount} files, ${registeredCount} registered in workspace index`);
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
