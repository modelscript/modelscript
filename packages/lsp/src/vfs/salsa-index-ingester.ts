// SPDX-License-Identifier: AGPL-3.0-or-later

import { deserializeMemo, type Memo, type QueryCacheStore, type SymbolEntry } from "@modelscript/runtime";
import { createRequire } from "node:module";
import initSqlJs from "sql.js";

type SqlJsStatic = Awaited<ReturnType<typeof initSqlJs>>;

export interface SalsaQueryEngineLike {
  index?:
    | {
        symbols: Map<number, SymbolEntry>;
        byName?: Map<string, number[]> | undefined;
        childrenOf?: Map<number | null, number[]> | undefined;
        symbolsByResource?: Map<string, number[]> | undefined;
      }
    | undefined;
  hydrateMemos?: ((memos: Map<number, Memo>) => void) | undefined;
}

let sqlPromise: Promise<SqlJsStatic> | null = null;
function getSqlInstance(): Promise<SqlJsStatic> {
  if (!sqlPromise) {
    let wasmBinary: ArrayBuffer | undefined;
    try {
      if (typeof process !== "undefined" && process.versions?.node) {
        const req = createRequire(import.meta.url);
        const wasmPath = req.resolve("sql.js/dist/sql-wasm.wasm");
        const fs = req("node:fs") as { readFileSync(p: string): Buffer };
        const buf: Buffer = fs.readFileSync(wasmPath);
        const copy = new Uint8Array(buf.length);
        copy.set(buf);
        wasmBinary = copy.buffer;
      }
    } catch {
      // Fallback for browser or non-Node environments
    }

    sqlPromise = initSqlJs({
      ...(wasmBinary ? { wasmBinary } : {}),
      useOldExtensionFunctions: false,
      locateFile: (file: string) => {
        const base = (globalThis as { serverDistBase?: string }).serverDistBase;
        if (base) {
          return `${base}/${file}`;
        }
        return file;
      },
    }).catch((err: unknown) => {
      sqlPromise = null;
      throw err;
    });
  }
  return sqlPromise;
}

export async function ingestSalsaIndex(
  buffer: ArrayBuffer,
  cacheStore: QueryCacheStore,
  queryEngine?: SalsaQueryEngineLike,
): Promise<{ symbols: number; memos: number }> {
  const SQL = await getSqlInstance();

  const db = new SQL.Database(new Uint8Array(buffer));

  try {
    // Check schema version
    const metaRows = db.exec("SELECT value FROM meta WHERE key = 'schema_version'");
    const version = metaRows[0]?.values[0]?.[0] ?? null;
    if (version !== "1") {
      throw new Error(`Unsupported salsa-index schema version: ${String(version)}`);
    }

    // Stream symbols into queryEngine.index with collision-safe ID remapping
    let symbolCount = 0;
    const symbolRows = db.exec("SELECT id, data FROM symbols");
    const symTable = symbolRows[0];
    if (symTable && queryEngine?.index?.symbols) {
      const parsedEntries: Array<{ rawId: number; entry: SymbolEntry }> = [];
      let hasCollision = false;
      for (const row of symTable.values) {
        try {
          const rawId = Number(row[0]);
          const entry = JSON.parse(String(row[1])) as SymbolEntry;
          if (queryEngine.index.symbols.has(rawId)) {
            hasCollision = true;
          }
          parsedEntries.push({ rawId, entry });
        } catch {
          // Ignore malformed symbol entry
        }
      }

      const idMap = new Map<number, number>();
      if (hasCollision) {
        let maxLocalSeq = 0;
        for (const existingId of queryEngine.index.symbols.keys()) {
          const seq = existingId & 0x00ffffff;
          if (seq > maxLocalSeq) maxLocalSeq = seq;
        }
        let nextSeq = maxLocalSeq + 1;
        for (const { rawId } of parsedEntries) {
          const domain = (rawId >>> 24) & 0xff;
          const remapped = (((domain & 0xff) << 24) | (nextSeq++ & 0x00ffffff)) >>> 0;
          idMap.set(rawId, remapped);
        }
      }
      const remapId = (id: number): number => (hasCollision ? (idMap.get(id) ?? id) : id);

      for (const { rawId, entry } of parsedEntries) {
        const id = remapId(rawId);
        const parentId =
          entry.parentId !== null && entry.parentId !== undefined
            ? entry.parentId === 0
              ? 0
              : remapId(entry.parentId)
            : null;
        const hydratedEntry: SymbolEntry = hasCollision ? { ...entry, id, parentId } : entry;
        queryEngine.index.symbols.set(id, hydratedEntry);

        if (hydratedEntry.name && queryEngine.index.byName) {
          const existing = queryEngine.index.byName.get(hydratedEntry.name) || [];
          if (!existing.includes(id)) {
            existing.push(id);
            queryEngine.index.byName.set(hydratedEntry.name, existing);
          }
        }

        if (queryEngine.index.childrenOf) {
          const parentKey = hydratedEntry.parentId ?? null;
          const siblings = queryEngine.index.childrenOf.get(parentKey) || [];
          if (!siblings.includes(id)) {
            siblings.push(id);
            queryEngine.index.childrenOf.set(parentKey, siblings);
          }
        }

        if (hydratedEntry.resourceId && queryEngine.index.symbolsByResource) {
          const resList = queryEngine.index.symbolsByResource.get(hydratedEntry.resourceId) || [];
          if (!resList.includes(id)) {
            resList.push(id);
            queryEngine.index.symbolsByResource.set(hydratedEntry.resourceId, resList);
          }
        }

        symbolCount++;
      }
    }

    // Stream memos into cache store
    const memoRows = db.exec("SELECT key, data FROM memos");
    const memos = new Map<number, Memo>();
    const memoTable = memoRows[0];
    if (memoTable) {
      for (const row of memoTable.values) {
        try {
          const key = Number(row[0]);
          const data = deserializeMemo(JSON.parse(String(row[1])) as Parameters<typeof deserializeMemo>[0]);
          memos.set(key, data);
        } catch {
          // Ignore malformed memos
        }
      }
      await cacheStore.setMemos(memos);
      if (queryEngine && typeof queryEngine.hydrateMemos === "function") {
        queryEngine.hydrateMemos(memos);
      }
    }

    return { symbols: symbolCount, memos: memos.size };
  } finally {
    db.close();
  }
}
