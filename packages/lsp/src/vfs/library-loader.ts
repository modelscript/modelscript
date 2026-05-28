import { Context, WorkspaceIndex } from "@modelscript/compiler";

import type { BrowserFileSystem } from "./browser-file-system";
import { getSalsaIndexCache, idbGet, idbPut, openMSLCache, putSalsaIndexCache } from "./browser-file-system";

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
    const cacheKey = `lsp-bundle:dep:${label}`;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let cached = await idbGet<any>(db, cacheKey);

    if (!cached || !cached.indexJson || !cached.files) {
      const baseUrl = ctx.registryUrl?.replace(/\/$/, "") || "http://127.0.0.1:3000";
      const res = await fetch(`${baseUrl}/api/v1/libraries/${dep.name}/${dep.version}/lsp-bundle`);

      if (!res.ok) {
        db.close();
        throw new Error(`HTTP ${res.status}`);
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

    // 1. Hydrate icons
    if (cached.iconsJson) {
      for (const [className, svg] of Object.entries(cached.iconsJson)) {
        iconCache.set(className, svg as string);
      }
    }

    // 2. Load sources into VFS
    const pkg = { name: dep.name, version: dep.version, files: cached.files };
    // We bypass the lazy registration of `loadRegistryPackage` since we have a pre-computed index
    // But we still need the files in the VFS so hovers and goto-definition work!
    const basePath = `/modelscript_registry/${pkg.name}/${pkg.version}`;
    ctx.sharedFs.mkdir(basePath, { recursive: true });

    let fileCount = 0;
    for (const [relPath, content] of Object.entries(pkg.files)) {
      const fullPath = ctx.sharedFs.join(basePath, relPath);
      const dir = ctx.sharedFs.dirname(fullPath);
      ctx.sharedFs.mkdir(dir, { recursive: true });
      ctx.sharedFs.write(fullPath, content);
      fileCount++;
    }

    // 3. Hydrate WorkspaceIndex
    if (cached.indexJson) {
      const uri = `library-bundle:/${dep.name}@${dep.version}`;

      const symbols = new Map(cached.indexJson.symbols);
      const byName = new Map(cached.indexJson.byName);
      const childrenOf = new Map(cached.indexJson.childrenOf);

      ctx.globalWorkspaceIndex.hydrate(uri, {
        symbols,
        byName,
        childrenOf,
      });

      ctx.logger.log(`[registry] Hydrated ${label}: ${fileCount} files, index hydrated with ${symbols.size} symbols.`);
    }
  } catch (e) {
    ctx.logger.error(`[deps] Failed to load ${label} from registry:`, e);
    throw e;
  }
}
