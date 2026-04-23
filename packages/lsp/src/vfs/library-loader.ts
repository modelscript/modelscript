import { Context, WorkspaceIndex } from "@modelscript/core";
import { unzipSync } from "fflate";
import type { BrowserFileSystem } from "./browser-file-system";
import { idbGet, idbPut, MSL_VERSION_KEY, openMSLCache } from "./browser-file-system";

import type { Parser, Tree } from "@modelscript/utils";

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

    const libEntries = ctx.sharedFs.readdir("/lib");
    const hasPackage = libEntries.some((e) => e.name === "package.mo");
    if (hasPackage) {
      await ctx.sharedContext.addLibrary("/lib", { skipIndex: true });
    } else {
      for (const entry of libEntries) {
        if (entry.isDirectory()) {
          try {
            await ctx.sharedContext.addLibrary(`/lib/${entry.name}`, { skipIndex: true });
          } catch (e) {
            ctx.logger.warn(`Failed to load library from /lib/${entry.name}: ${e}`);
          }
        }
      }
    }

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
                  null) as unknown as import("@modelscript/utils").SyntaxNode;
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
        if (!ctx.sysml2Parser) return null;
        const tree = ctx.sysml2Parser.parse(text);
        const node = ctx.documentTrees.get(uri);
        if (node && tree) node.tree = tree;
        return (tree ? tree.rootNode : null) as unknown as import("@modelscript/utils").SyntaxNode;
      });
      fileCount++;
    }

    ctx.logger.log(`SysML2 Standard Library loaded: ${fileCount} files registered in sysml2WorkspaceIndex.`);
  } catch (e) {
    ctx.logger.error("Failed to load SysML2 standard library:", e);
  }
}
