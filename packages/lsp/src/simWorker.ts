// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Lightweight, 100% client-side WebAssembly Modelica simulation worker.
 *
 * Works identically for ALL registry packages (Modelica, OpenIPSL, scoped @org/pkg,
 * and user-published packages) with ZERO server-side computation:
 *   1. Fetches binary `index.msidx` (cached in IndexedDB with ABI + ETag revalidation)
 *      and mounts all symbols in milliseconds via `mountPackageIndex`.
 *   2. If `index.msidx` is unavailable (404), falls back lazily using `/files?tree=true`
 *      and `WorkspaceIndex.register` so only the `.mo` files referenced by the target
 *      class are fetched and parsed — never downloading or parsing the entire package.
 *   3. Pre-fetches the target class's referenced `.mo` files in parallel via `fetch()`,
 *      with synchronous XHR against immutable `/resources/*` for any remaining misses.
 *   4. Flattens and simulates 100% client-side in WebAssembly (`Context.flattenArena`
 *      + `simulateArenaAsync`).
 */

import type { Dirent, FileSystem, Stats } from "@modelscript/dsl/utils";
import { Context } from "@modelscript/modelica";
import { createModelicaWorkspaceIndex, isSecondaryOutputName } from "@modelscript/modelica/factory";
import { createWasmParser } from "@modelscript/modelica/parser";
import {
  type DAEBuilder,
  ExprKind,
  initBltWasm,
  mountPackageIndex,
  MSIDX_COMPILER_ABI_VERSION,
  type SymbolIndex,
  Variability,
} from "@modelscript/runtime";
import { simulateArenaAsync } from "@modelscript/simulate";

interface SimWorkerRequest {
  id: number;
  type: "simulate";
  origin: string;
  libraryName: string;
  version: string;
  className: string;
  startTime?: number | undefined;
  stopTime?: number | undefined;
  numberOfIntervals?: number | undefined;
  interval?: number | undefined;
  rtol?: number | undefined;
  atol?: number | undefined;
  solver?: string | undefined;
  parameterOverrides?: Record<string, number> | undefined;
}

interface SimWorkerResponse {
  id: number;
  ok: boolean;
  fallbackToLsp?: boolean | undefined;
  error?: string | undefined;
  t?: number[] | undefined;
  y?: number[][] | undefined;
  states?: string[] | undefined;
  experiment?: {
    startTime: number;
    stopTime: number;
    interval: number;
    tolerance: number;
    solver: string;
  };
  telemetry?: {
    executionTimeMs: number;
    stepCount: number;
    filesFetched: number;
  };
}

interface CachedMsidxRecord {
  bytes: ArrayBuffer;
  etag: string | null;
}

const IDB_NAME = "modelscript-sim-cache-v1";
const IDB_STORE_MSIDX = "msidx";

function openSimCacheDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE_MSIDX)) {
          db.createObjectStore(IDB_STORE_MSIDX);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function idbGetMsidx(key: string): Promise<CachedMsidxRecord | null> {
  const db = await openSimCacheDb();
  if (!db) return null;
  try {
    return await new Promise<CachedMsidxRecord | null>((resolve) => {
      const tx = db.transaction(IDB_STORE_MSIDX, "readonly");
      const req = tx.objectStore(IDB_STORE_MSIDX).get(key);
      req.onsuccess = () => resolve((req.result as CachedMsidxRecord | undefined) ?? null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  } finally {
    db.close();
  }
}

async function idbPutMsidx(key: string, record: CachedMsidxRecord): Promise<void> {
  const db = await openSimCacheDb();
  if (!db) return;
  try {
    await new Promise<void>((resolve) => {
      const tx = db.transaction(IDB_STORE_MSIDX, "readwrite");
      tx.objectStore(IDB_STORE_MSIDX).put(record, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    // non-fatal
  } finally {
    db.close();
  }
}

function encodePkgPath(name: string): string {
  return name
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/");
}

function encodeResourcePath(relPath: string): string {
  return relPath
    .replace(/^\/+/, "")
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/");
}

/**
 * On-demand HTTP-backed FileSystem for WebWorkers.
 * Supports async parallel pre-fetching (`prefetchUris`) plus synchronous XHR fallback
 * against immutable static `/api/v1/libraries/.../resources/*`.
 */
class HttpPackageFileSystem implements FileSystem {
  private readonly textCache = new Map<string, string>();
  private readonly missingCache = new Set<string>();
  public fetchCount = 0;

  constructor(private readonly origin: string) {}

  private parsePkgUri(uri: string): { name: string; version: string; relPath: string } | null {
    if (!uri.startsWith("pkg://")) return null;
    const rest = uri.slice("pkg://".length);
    const atIdx = rest.lastIndexOf("@");
    if (atIdx <= 0) return null;
    const slashAfterVer = rest.indexOf("/", atIdx + 1);
    if (slashAfterVer < 0) return null;
    const name = rest.slice(0, atIdx);
    const version = rest.slice(atIdx + 1, slashAfterVer);
    const relPath = rest.slice(slashAfterVer + 1);
    return { name, version, relPath };
  }

  private toUrl(uri: string): string | null {
    const parsed = this.parsePkgUri(uri);
    if (!parsed) return null;
    return `${this.origin}/api/v1/libraries/${encodePkgPath(parsed.name)}/${encodeURIComponent(parsed.version)}/resources/${encodeResourcePath(parsed.relPath)}`;
  }

  async prefetchUris(uris: Iterable<string>): Promise<void> {
    const toFetch: Array<{ uri: string; url: string }> = [];
    const seen = new Set<string>();
    for (const uri of uris) {
      if (!uri || seen.has(uri) || this.textCache.has(uri) || this.missingCache.has(uri)) continue;
      seen.add(uri);
      const url = this.toUrl(uri);
      if (url) toFetch.push({ uri, url });
    }
    if (toFetch.length === 0) return;

    await Promise.all(
      toFetch.map(async ({ uri, url }) => {
        try {
          const resp = await fetch(url);
          if (resp.ok) {
            const text = await resp.text();
            this.textCache.set(uri, text);
            this.fetchCount++;
          } else if (resp.status === 404) {
            this.missingCache.add(uri);
          }
        } catch {
          // ignore; sync XHR fallback will retry if needed
        }
      }),
    );
  }

  read(filePath: string): string {
    const cached = this.textCache.get(filePath);
    if (cached !== undefined) return cached;
    if (this.missingCache.has(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const url = this.toUrl(filePath);
    if (!url) {
      this.missingCache.add(filePath);
      throw new Error(`Unsupported URI in HttpPackageFileSystem: ${filePath}`);
    }

    const xhr = new XMLHttpRequest();
    xhr.open("GET", url, false);
    xhr.send(null);
    if (xhr.status >= 200 && xhr.status < 300) {
      const text = xhr.responseText;
      this.textCache.set(filePath, text);
      this.fetchCount++;
      return text;
    }

    this.missingCache.add(filePath);
    throw new Error(`HTTP ${xhr.status} reading ${url}`);
  }

  readBinary(filePath: string): Uint8Array {
    return new TextEncoder().encode(this.read(filePath));
  }

  readdir(_filePath: string): Dirent[] {
    return [];
  }

  stat(filePath: string): Stats | null {
    if (this.textCache.has(filePath)) {
      return { isFile: () => true, isDirectory: () => false } as unknown as Stats;
    }
    return null;
  }

  basename(p: string): string {
    const idx = p.lastIndexOf("/");
    return idx >= 0 ? p.slice(idx + 1) : p;
  }

  extname(p: string): string {
    const base = this.basename(p);
    const idx = base.lastIndexOf(".");
    return idx > 0 ? base.slice(idx) : "";
  }

  join(...paths: string[]): string {
    return paths.filter(Boolean).join("/").replace(/\/+/g, "/");
  }

  resolve(...paths: string[]): string {
    return this.join(...paths);
  }

  readonly sep = "/";
}

type WasmParserInstance = Awaited<ReturnType<typeof createWasmParser>>["parser"];

let wasmInitPromise: Promise<void> | null = null;
let sharedParser: WasmParserInstance | null = null;
let sharedFs: HttpPackageFileSystem | null = null;
let sharedCtx: Context | null = null;
let sharedIndex: SymbolIndex | null = null;
let lazyWsIndex: ReturnType<typeof createModelicaWorkspaceIndex> | null = null;
const mountedPackages = new Set<string>();
const lazyMountedPackages = new Set<string>();
const inflightMounts = new Map<string, Promise<"msidx" | "lazy" | "none">>();

function ensureWasmReady(origin: string): Promise<void> {
  if (!wasmInitPromise) {
    wasmInitPromise = (async () => {
      const base = `${origin}/lsp/server/dist`;
      const [{ parser }] = await Promise.all([
        createWasmParser(`${base}/modelica.wasm`),
        initBltWasm(`${base}/release.wasm`),
      ]);
      sharedParser = parser;
      Context.registerParser(".mo", parser as unknown as Parameters<typeof Context.registerParser>[1]);
      sharedFs = new HttpPackageFileSystem(origin);
      sharedCtx = new Context(sharedFs);
      sharedIndex = {
        symbols: new Map(),
        byName: new Map(),
        childrenOf: new Map(),
        symbolsByResource: new Map(),
      };
    })().catch((err) => {
      wasmInitPromise = null;
      throw err;
    });
  }
  return wasmInitPromise;
}

function parseUsesFromSource(content: string): Array<{ name: string; version: string }> {
  const usesMatch = content.match(/uses\s*\(([\s\S]*?)\)\s*(?:[,)])/);
  if (!usesMatch || !usesMatch[1]) return [];
  const deps: Array<{ name: string; version: string }> = [];
  const entryRe = /([A-Za-z_][A-Za-z0-9_]*)\s*\(\s*version\s*=\s*"([^"]+)"\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = entryRe.exec(usesMatch[1])) !== null) {
    if (m[1] && m[2]) deps.push({ name: m[1], version: m[2] });
  }
  return deps;
}

function detectRootModelicaPackageName(pkgMoText: string, fallbackName: string): string {
  const m = pkgMoText.slice(0, 4096).match(/\b(?:encapsulated\s+)?(?:partial\s+)?package\s+([A-Za-z_][A-Za-z0-9_]*)\b/);
  if (m && m[1]) return m[1];
  return fallbackName.includes("/") ? fallbackName.split("/").pop() || fallbackName : fallbackName;
}

/**
 * Lazy file-manifest fallback when a package does not have a prebuilt `index.msidx`.
 * Fetches ONLY the JSON file list (`/files?tree=true`) and registers lazy `.mo` loaders
 * in `WorkspaceIndex` so only files referenced by the target class are ever fetched & parsed.
 */
async function mountPackageLazyFromTree(
  origin: string,
  name: string,
  version: string,
  pkgMoText: string,
): Promise<boolean> {
  const encodedPkg = encodePkgPath(name);
  const treeRes = await fetch(
    `${origin}/api/v1/libraries/${encodedPkg}/${encodeURIComponent(version)}/files?tree=true`,
  );
  if (!treeRes.ok) return false;
  const data = (await treeRes.json()) as {
    tree?: Array<{ path: string; rawPath?: string; size: number }>;
  };
  const moEntries = (data.tree ?? []).filter((e) => (e.rawPath || e.path).endsWith(".mo"));
  if (moEntries.length === 0) return false;

  if (!lazyWsIndex) {
    lazyWsIndex = createModelicaWorkspaceIndex();
    sharedCtx!.setWorkspaceIndex(lazyWsIndex);
  }

  const rootPkgName = detectRootModelicaPackageName(pkgMoText, name);
  const items = moEntries.map((entry) => {
    const relPath = (entry.rawPath || entry.path).replace(/^\/+/, "");
    const parts = entry.path.replace(/^\/+/, "").split("/");
    const fileName = parts[parts.length - 1] || "";
    const parentParts = fileName === "package.mo" ? parts.slice(0, -2) : parts.slice(0, -1);
    const fullParent =
      fileName === "package.mo" && parts.length === 1 ? "" : [rootPkgName, ...parentParts].filter(Boolean).join(".");
    return {
      uri: `pkg://${name}@${version}/${relPath}`,
      parentFQN: fullParent,
      isPkg: fileName === "package.mo",
    };
  });

  items.sort((a, b) => (a.isPkg ? 0 : 1) - (b.isPkg ? 0 : 1) || a.parentFQN.length - b.parentFQN.length);

  const ws = lazyWsIndex;
  for (const item of items) {
    ws.register(
      item.uri,
      () => {
        const src = sharedFs!.read(item.uri);
        const tree = sharedParser!.parse(src);
        return (tree?.rootNode ?? null) as unknown as ReturnType<NonNullable<Parameters<typeof ws.register>[1]>>;
      },
      item.parentFQN,
    );
  }

  const rootItem = items.find((i) => i.isPkg && i.parentFQN === "");
  if (rootItem) {
    try {
      lazyWsIndex.ensureIndexed(rootItem.uri);
    } catch {
      // non-fatal
    }
  }

  lazyMountedPackages.add(`${name}@${version}`);
  return true;
}

async function mountPackageWithDeps(
  origin: string,
  name: string,
  version: string,
  visited = new Set<string>(),
): Promise<"msidx" | "lazy" | "none"> {
  const key = `${name}@${version}`;
  if (mountedPackages.has(key)) return "msidx";
  if (lazyMountedPackages.has(key)) return "lazy";
  if (visited.has(key)) return "msidx";
  visited.add(key);

  const existing = inflightMounts.get(key);
  if (existing) return existing;

  const p = (async (): Promise<"msidx" | "lazy" | "none"> => {
    const encodedPkg = encodePkgPath(name);
    const msidxUrl = `${origin}/api/v1/libraries/${encodedPkg}/${encodeURIComponent(version)}/index.msidx`;
    const idbKey = `msidx:abi${MSIDX_COMPILER_ABI_VERSION}:${name}@${version}`;

    // Fetch package.mo concurrently for dependency discovery
    const pkgMoPromise = fetch(
      `${origin}/api/v1/libraries/${encodedPkg}/${encodeURIComponent(version)}/resources/package.mo`,
    )
      .then((r) => (r.ok ? r.text() : ""))
      .catch(() => "");

    // 1. Try IndexedDB cache first for instant warm mount, revalidating ETag in background
    let msidxBytes: Uint8Array | null = null;
    const cachedRecord = await idbGetMsidx(idbKey);
    if (cachedRecord && cachedRecord.bytes.byteLength > 0) {
      msidxBytes = new Uint8Array(cachedRecord.bytes);
      // Background ETag check: if package was republished, refresh IndexedDB for next load
      if (cachedRecord.etag) {
        setTimeout(() => {
          void fetch(msidxUrl, { headers: { "If-None-Match": cachedRecord.etag! } })
            .then(async (r) => {
              if (r.status === 200) {
                const freshBuf = await r.arrayBuffer();
                await idbPutMsidx(idbKey, { bytes: freshBuf, etag: r.headers.get("etag") });
              }
            })
            .catch(() => {});
        }, 1000);
      }
    } else {
      const resp = await fetch(msidxUrl);
      if (resp.ok) {
        const buf = await resp.arrayBuffer();
        msidxBytes = new Uint8Array(buf);
        const etag = resp.headers.get("etag");
        // Cache in IndexedDB asynchronously without blocking simulation
        setTimeout(() => {
          void idbPutMsidx(idbKey, { bytes: buf, etag });
        }, 0);
      }
    }

    const pkgMoText = await pkgMoPromise;
    let mode: "msidx" | "lazy" | "none" = "none";

    if (msidxBytes) {
      const resolveResourceUri = (relPath: string): string => {
        let clean = relPath.replace(/^\/+/, "");
        if (clean.startsWith("sources/")) {
          clean = clean.slice("sources/".length);
        }
        return `pkg://${name}@${version}/${clean}`;
      };

      mountPackageIndex(msidxBytes, {
        targetIndex: sharedIndex!,
        resolveResourceUri,
      });
      mountedPackages.add(key);
      mode = "msidx";
    } else {
      // Lazy fallback when index.msidx is unavailable (404)
      const ok = await mountPackageLazyFromTree(origin, name, version, pkgMoText);
      if (!ok) return "none";
      mode = "lazy";
    }

    // Discover & mount dependencies uniformly from package.mo uses(...) + companion libs
    const deps: Array<{ name: string; version: string }> = pkgMoText ? parseUsesFromSource(pkgMoText) : [];
    if (name === "Modelica") {
      for (const companion of ["Complex", "ModelicaServices"]) {
        if (!deps.some((d) => d.name === companion)) {
          deps.push({ name: companion, version });
        }
      }
    }

    await Promise.all(
      deps.map((dep) => mountPackageWithDeps(origin, dep.name, dep.version, visited).catch(() => "none" as const)),
    );

    return mode;
  })();

  inflightMounts.set(key, p);
  try {
    return await p;
  } finally {
    inflightMounts.delete(key);
  }
}

/**
 * Collects `.mo` resource URIs for `className`, its enclosing packages, and its direct
 * `Extends` / `Component` type targets from `SymbolIndex` so they can be fetched in parallel
 * before `flattenArena` runs.
 */
function collectPrefetchUris(index: SymbolIndex, className: string): Set<string> {
  const uris = new Set<string>();
  const parts = className.split(".");
  let currentIds = index.byName.get(parts[0] || "") ?? [];
  for (const id of currentIds) {
    const e = index.symbols.get(id);
    if (e?.resourceId) uris.add(e.resourceId);
  }

  for (let i = 1; i < parts.length && currentIds.length > 0; i++) {
    const part = parts[i]!;
    const nextIds: number[] = [];
    for (const parentId of currentIds) {
      const children = index.childrenOf.get(parentId);
      if (!children) continue;
      for (const childId of children) {
        const entry = index.symbols.get(childId);
        if (entry && entry.name === part) {
          nextIds.push(childId);
          if (entry.resourceId) uris.add(entry.resourceId);
        }
      }
    }
    currentIds = nextIds;
  }

  // Also pre-fetch resource URIs for direct children's type references (1-hop)
  for (const targetId of currentIds) {
    const children = index.childrenOf.get(targetId);
    if (!children) continue;
    for (const childId of children) {
      const child = index.symbols.get(childId);
      if (!child) continue;
      const typeName =
        (child.metadata?.["typeName"] as string | undefined) ||
        (child.metadata?.["baseClass"] as string | undefined) ||
        (child.kind === "Extends" ? child.name : undefined);
      if (!typeName) continue;
      const leaf = typeName.split(".").pop();
      if (!leaf) continue;
      const matches = index.byName.get(leaf);
      if (matches && matches.length <= 4) {
        for (const mId of matches) {
          const mEntry = index.symbols.get(mId);
          if (mEntry?.resourceId) uris.add(mEntry.resourceId);
        }
      }
    }
  }

  return uris;
}

function selectOutputStringIds(arena: DAEBuilder): number[] | undefined {
  const tier0Ids: number[] = [];
  const tier1Ids: number[] = [];
  const tier2Ids: number[] = [];
  const derIds: number[] = [];
  const seen = new Set<number>();

  for (let i = 0; i < arena.varCount; i++) {
    if (arena.isVarRemoved(i)) continue;
    if (arena.hiddenVarIndices?.has(i)) continue;
    const v = arena.getVarVariability(i);
    if (v === Variability.Parameter || v === Variability.Constant) continue;
    if (arena.getVarShape(i).length > 0) continue;
    const varName = arena.getVarName(i);
    const nameId = arena.getVarNameId(i);
    seen.add(nameId);
    if (arena.isVarFixed(i)) {
      tier0Ids.push(nameId);
    } else if (varName.split(".").length <= 2 && !isSecondaryOutputName(varName)) {
      tier1Ids.push(nameId);
    } else {
      tier2Ids.push(nameId);
    }
  }

  for (let e = 0; e < arena.exprCount; e++) {
    if (arena.getExprKind(e) === ExprKind.Der) {
      const argId = arena.getExprData1(e);
      if (argId >= 0 && arena.getExprKind(argId) === ExprKind.Name) {
        const baseName = arena.interner.resolve(arena.getExprData1(argId));
        if (baseName) {
          const baseIdx = arena.getVarIdxByName(baseName);
          if (baseIdx >= 0 && !arena.isVarRemoved(baseIdx) && !arena.hiddenVarIndices?.has(baseIdx)) {
            const derId = arena.interner.intern(`der(${baseName})`);
            if (!seen.has(derId)) {
              seen.add(derId);
              derIds.push(derId);
            }
          }
        }
      }
    }
  }

  const MAX_OUTPUTS = 64;
  const combined = [...tier0Ids, ...tier1Ids, ...tier2Ids, ...derIds];
  return combined.length > 0 ? combined.slice(0, MAX_OUTPUTS) : undefined;
}

let lastIndexSymbolCount = -1;

self.onmessage = async (event: MessageEvent<SimWorkerRequest>) => {
  const req = event.data;
  if (!req || req.type !== "simulate") return;

  const t0 = performance.now();
  try {
    const origin = req.origin.replace(/\/$/, "");
    await ensureWasmReady(origin);

    const mountMode = await mountPackageWithDeps(origin, req.libraryName, req.version);
    if (mountMode === "none") {
      const resp: SimWorkerResponse = {
        id: req.id,
        ok: false,
        fallbackToLsp: true,
        error: `Package ${req.libraryName}@${req.version} could not be mounted`,
      };
      self.postMessage(resp);
      return;
    }

    if (mountMode === "lazy" && lazyWsIndex) {
      lazyWsIndex.ensureFQNIndexed(req.className);
      const lazyIdx = lazyWsIndex.getIndex();
      sharedCtx!.setSymbolIndex(lazyIdx);
      lastIndexSymbolCount = -1;
    } else if (sharedIndex!.symbols.size !== lastIndexSymbolCount) {
      sharedCtx!.setSymbolIndex(sharedIndex!);
      lastIndexSymbolCount = sharedIndex!.symbols.size;
    }

    const fetchBefore = sharedFs!.fetchCount;
    if (mountMode === "msidx" && sharedIndex) {
      const prefetch = collectPrefetchUris(sharedIndex, req.className);
      await sharedFs!.prefetchUris(prefetch);
    }

    const arena = sharedCtx!.flattenArena(req.className, undefined, undefined, { arrayMode: "scalarize" });
    if (!arena) {
      const resp: SimWorkerResponse = {
        id: req.id,
        ok: false,
        fallbackToLsp: true,
        error: `Failed to flatten '${req.className}'`,
      };
      self.postMessage(resp);
      return;
    }

    const exp = arena.experiment;
    const startTime = req.startTime ?? exp.startTime ?? 0;
    const stopTime = req.stopTime ?? exp.stopTime ?? 1.0;
    const numberOfIntervals = req.numberOfIntervals ?? exp.numberOfIntervals ?? 500;
    const step = req.interval ?? exp.interval ?? (stopTime - startTime) / Math.max(1, numberOfIntervals);
    const rtol = req.rtol ?? exp.tolerance ?? 1e-4;
    const solver = (req.solver ?? exp.algorithm ?? "dopri5") as NonNullable<
      Parameters<typeof simulateArenaAsync>[1]
    >["solver"];

    const outputStringIds = selectOutputStringIds(arena);
    const parameterOverrides =
      req.parameterOverrides && Object.keys(req.parameterOverrides).length > 0
        ? new Map(Object.entries(req.parameterOverrides))
        : undefined;

    const result = await simulateArenaAsync(arena, {
      startTime,
      stopTime,
      step,
      numberOfIntervals,
      solver,
      rtol,
      atol: req.atol,
      outputStringIds,
      parameterOverrides,
    });

    const tArr = Array.from(result.t);
    const yArr = (result.y || []).map((row) => (Array.isArray(row) ? row : Array.from(row as Iterable<number>)));

    const resp: SimWorkerResponse = {
      id: req.id,
      ok: true,
      t: tArr,
      y: yArr,
      states: result.states,
      experiment: {
        startTime,
        stopTime,
        interval: step,
        tolerance: rtol,
        solver: String(solver ?? "dopri5"),
      },
      telemetry: {
        executionTimeMs: Math.round(performance.now() - t0),
        stepCount: tArr.length,
        filesFetched: sharedFs!.fetchCount - fetchBefore,
      },
    };
    self.postMessage(resp);
  } catch (err: unknown) {
    const resp: SimWorkerResponse = {
      id: req.id,
      ok: false,
      fallbackToLsp: true,
      error: err instanceof Error ? err.message : String(err),
    };
    self.postMessage(resp);
  }
};
